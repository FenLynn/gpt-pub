<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import {
  disposeBridge,
  invoke,
  reportLiveLevelAck,
  subscribeLiveLevel,
  subscribeSnapshot,
  type LocalSubSnapshot,
  type ModelCatalogItem,
  type PageKey
} from "./bridge";

const snapshot = ref<LocalSubSnapshot | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const commandBusy = ref(false);
const selectedSource = ref<"potplayer" | "allAudio">("potplayer");
const selectedModelId = ref("");
const previewParams = new URLSearchParams(window.location.search);
const modelFilter = ref<"all" | "installed" | "live" | "batch">("all");
const modelTab = ref<"config" | "library">(previewParams.get("modelTab") === "library" ? "library" : "config");
const settingsTab = ref<"subtitle" | "startup" | "runtime">(
  previewParams.get("settingsTab") === "startup" ? "startup" :
  previewParams.get("settingsTab") === "runtime" ? "runtime" : "subtitle"
);
const deleteConfirmId = ref("");
const settingsSaveState = ref("");
const batchKeywords = ref("");
const batchRequestBusy = ref(false);
const batchClearArmed = ref(false);
let batchKeywordsInitialized = false;
const liveLevel = ref(0);
const levelHistory = ref<number[]>(Array.from({ length: 300 }, () => 0));
const transcriptHistory = ref<string[]>([]);
const transcriptScroll = ref<HTMLElement | null>(null);
const hoverTip = ref<{ text: string; left: number; top: number; above: boolean } | null>(null);
let activeTipTarget: HTMLElement | null = null;
let selectionInitialized = false;
let levelHistoryTick = 0;
let lastMeterAckAt = 0;
let unsubscribeSnapshot: (() => void) | null = null;
let unsubscribeLiveLevel: (() => void) | null = null;
let saveStateTimer: number | undefined;

const nav: Array<{ key: PageKey; label: string; path: string }> = [
  { key: "home", label: "主页", path: "M4 10.5 12 4l8 6.5v8.2c0 .7-.6 1.3-1.3 1.3h-4.2v-6h-5v6H5.3c-.7 0-1.3-.6-1.3-1.3z" },
  { key: "live", label: "实时字幕", path: "M3.5 12h3l1.7-4.4 3.2 8.8 2.8-6.3 1.7 1.9h4.6" },
  { key: "batch", label: "后台转写", path: "M6 3.5h8l4 4V20H6z M14 3.5V8h4 M9 12h6 M9 15.5h6" },
  { key: "models", label: "模型", path: "M5 7c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7 M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" },
  { key: "docs", label: "文档", path: "M4.5 5.5c2.5-.7 5-.3 7.5 1.2v12c-2.5-1.5-5-1.9-7.5-1.2z M19.5 5.5c-2.5-.7-5-.3-7.5 1.2v12c2.5-1.5 5-1.9 7.5-1.2z" },
  { key: "settings", label: "设置", path: "M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5z M12 3.5v2 M12 18.5v2 M3.5 12h2 M18.5 12h2 M6 6l1.4 1.4 M16.6 16.6 18 18 M18 6l-1.4 1.4 M7.4 16.6 6 18" },
  { key: "about", label: "关于", path: "M12 10.5v6 M12 7.2v.1 M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0z" }
];

const activePage = computed(() => snapshot.value?.app.activePage ?? "home");
const liveState = computed(() => snapshot.value?.live.state ?? "idle");
const liveRunning = computed(() => liveState.value === "running");
const livePending = computed(() => Boolean(snapshot.value?.system.autoStartPending));
const liveTransitioning = computed(() => liveState.value === "starting" || liveState.value === "stopping");
const liveControlsLocked = computed(() => liveRunning.value || livePending.value || liveTransitioning.value || commandBusy.value);
const liveButtonText = computed(() => {
  if (liveState.value === "starting") return "启动中";
  if (liveState.value === "stopping") return "停止中";
  if (livePending.value) return "停止等待";
  if (liveRunning.value) return "停止字幕";
  return "开始字幕";
});
const liveStateLabel = computed(() => {
  if (livePending.value) return snapshot.value?.system.autoStartStatus || "等待音源";
  switch (liveState.value) {
    case "starting": return "启动中";
    case "running": return "识别中";
    case "stopping": return "停止中";
    case "failed": return "异常";
    default: return "待命";
  }
});
const liveButtonDisabled = computed(() => {
  if (liveTransitioning.value || commandBusy.value) return true;
  if (liveRunning.value || livePending.value) return false;
  return !snapshot.value?.live.canStart || !selectedModelId.value;
});

const liveModelReady = computed(() =>
  Boolean(snapshot.value?.models.catalog.some(x => x.id === snapshot.value?.models.liveModelId && x.installed))
);
const batchModelReady = computed(() =>
  Boolean(snapshot.value?.models.catalog.some(x => x.id === snapshot.value?.models.batchModelId && x.installed))
);
const inputReady = computed(() =>
  snapshot.value?.settings.audioSourceId === "allAudio" || Boolean(snapshot.value?.system.potPlayerDetected)
);
const coreReady = computed(() => snapshot.value?.core.state === "ready" || snapshot.value?.core.state === "busy");
const coreOperational = computed(() => {
  const state = snapshot.value?.core.state;
  return Boolean(state && state !== "failed");
});
const allReady = computed(() => coreOperational.value && liveModelReady.value && inputReady.value);
const homeReadinessCount = computed(() =>
  Number(coreOperational.value) + Number(liveModelReady.value) + Number(inputReady.value)
);
const coreStateText = computed(() => {
  switch (snapshot.value?.core.state) {
    case "ready": return "已连接";
    case "busy": return "工作中";
    case "starting": return "启动中";
    case "failed": return "异常";
    default: return "按需启动";
  }
});
const homeStateText = computed(() => {
  if (liveRunning.value) return "实时字幕正在运行";
  if (snapshot.value?.system.autoStartPending) return snapshot.value.system.autoStartStatus || "等待自动启动";
  if (snapshot.value?.core.state === "failed") return "识别核心需要处理";
  if (!liveModelReady.value) return "实时模型需要处理";
  if (!inputReady.value) return "等待可用音源";
  return "全部条件已就绪";
});
const homeStateDetail = computed(() => {
  if (!snapshot.value) return "";
  if (liveRunning.value)
    return [snapshot.value.live.source, snapshot.value.live.modelName].filter(Boolean).join(" · ");
  if (snapshot.value.system.autoStartPending)
    return snapshot.value.system.autoStartStatus || "自动启动等待中";
  if (snapshot.value.core.state === "failed") return "Core 启动或连接异常";
  if (!liveModelReady.value) return snapshot.value.models.liveModelName + " 尚未安装";
  if (!inputReady.value)
    return snapshot.value.settings.audioSourceId === "potplayer" ? "等待检测 PotPlayer" : "当前音源暂不可用";
  return [snapshot.value.settings.audioSource, snapshot.value.models.liveModelName].filter(Boolean).join(" · ");
});
const homeActionLabel = computed(() => {
  if (liveState.value === "starting") return "启动中";
  if (liveState.value === "stopping") return "停止中";
  if (livePending.value) return "停止等待";
  return liveRunning.value ? "停止实时字幕" : "开始实时字幕";
});
const homeButtonDisabled = computed(() => {
  if (liveRunning.value || livePending.value) return commandBusy.value || liveTransitioning.value;
  return commandBusy.value || liveTransitioning.value || !liveModelReady.value;
});
const homeActionTip = computed(() => {
  if (livePending.value) return "已进入等待音源状态。点击可取消等待；打开 PotPlayer 后会自动开始识别。";
  if (liveRunning.value) return "安全停止当前实时字幕会话。";
  if (liveTransitioning.value) return liveState.value === "starting" ? "实时字幕正在启动。" : "实时字幕正在停止。";
  if (!liveModelReady.value) return "请先在模型页安装并选择可用的实时模型。";
  if (!inputReady.value && snapshot.value?.settings.audioSourceId === "potplayer")
    return "可以先启动 LocalSub。当前没有 PotPlayer 时会持续监测，检测到播放器后自动开始识别。";
  return "使用当前默认音源和实时模型开始字幕。";
});
const sideStatusKind = computed(() => {
  if (liveState.value === "running") return "run";
  if (liveTransitioning.value || snapshot.value?.system.autoStartPending) return "wait";
  if (liveState.value === "failed" || snapshot.value?.core.state === "failed") return "warning";
  if (allReady.value) return "complete";
  return "idle";
});
const sideStatusTitle = computed(() => {
  if (liveState.value === "running") return "实时字幕中";
  if (liveState.value === "starting") return "正在启动";
  if (liveState.value === "stopping") return "正在停止";
  if (snapshot.value?.system.autoStartPending) return snapshot.value.system.autoStartStatus || "等待自动启动";
  if (liveState.value === "failed" || snapshot.value?.core.state === "failed") return "需要处理";
  return allReady.value ? "已就绪" : "等待配置";
});
const sideStatusSecondary = computed(() => {
  if (liveState.value === "running")
    return snapshot.value?.live.source ?? "实时识别";
  if (snapshot.value?.system.autoStartPending)
    return snapshot.value.system.autoStartStatus || "自动启动";
  if (!liveModelReady.value) return "实时模型未就绪";
  if (!inputReady.value) return "等待音源";
  return coreOperational.value ? "本地识别" : "等待就绪";
});
const sideStatusTip = computed(() => {
  const core = coreReady.value ? "Core 已连接" : coreOperational.value ? "Core 按需启动" : "Core 需要处理";
  const model = liveModelReady.value ? "实时模型可用" : "实时模型需要安装";
  const input = inputReady.value ? "音源可用" : "音源等待中";
  return [sideStatusTitle.value, core, model, input].join(" · ");
});

const startupModeLabel = computed(() => {
  if (!snapshot.value) return "";
  const parts = [snapshot.value.settings.startWithWindows ? "开机启动" : "手动启动"];
  if (snapshot.value.settings.silentStartup) parts.push("静默托盘");
  if (snapshot.value.settings.autoStartLive) parts.push("自动实时");
  return parts.join(" · ");
});

const waveformPoints = computed(() => {
  const values = levelHistory.value;
  const n = Math.max(1, values.length - 1);
  return values.map((value, index) => {
    const x = (index / n) * 100;
    const normalized = Math.max(0, Math.min(1, value));
    const y = 31 - normalized * 27;
    return x.toFixed(2) + "," + y.toFixed(2);
  }).join(" ");
});

function transcriptLineClass(index: number) {
  const distance = Math.max(0, transcriptHistory.value.length - 1 - index);
  if (distance === 0) return "recent";
  if (distance <= 2) return "mid";
  return "old";
}

function applyLiveLevel(value: number) {
  const level = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  liveLevel.value = level;

  const now = Date.now();
  if (now - lastMeterAckAt >= 1000) {
    lastMeterAckAt = now;
    reportLiveLevelAck(level);
  }

  if (!snapshot.value?.settings.showLiveLevelHistory || snapshot.value.live.state !== "running") return;

  levelHistoryTick = (levelHistoryTick + 1) % 3;
  if (levelHistoryTick !== 0) return;
  levelHistory.value = [...levelHistory.value.slice(-299), level];
}

const modelFilters = [
  { key: "all", label: "全部" },
  { key: "installed", label: "已安装" },
  { key: "live", label: "实时" },
  { key: "batch", label: "后台" }
] as const;

const filteredCatalogModels = computed(() => {
  const catalog = snapshot.value?.models.catalog ?? [];
  switch (modelFilter.value) {
    case "installed": return catalog.filter(x => x.installed);
    case "live": return catalog.filter(x => x.liveCapable);
    case "batch": return catalog.filter(x => x.batchCapable);
    default: return catalog;
  }
});
const installedLiveModels = computed(() => (snapshot.value?.models.catalog ?? []).filter(x => x.installed && x.liveCapable));
const installedBatchModels = computed(() => (snapshot.value?.models.catalog ?? []).filter(x => x.installed && x.batchCapable));
const vadModel = computed(() => (snapshot.value?.models.catalog ?? []).find(x => x.isComponent) ?? null);
const batchBusy = computed(() => snapshot.value?.batch.state === "analyzing" || snapshot.value?.batch.state === "transcribing");
const batchSelected = computed(() => snapshot.value?.batch.queue.find(x => x.id === snapshot.value?.batch.selectedId) ?? null);
const batchPrimaryLabel = computed(() => snapshot.value?.batch.canRetry ? "重试当前" : "当前转写");
const batchWaveformPoints = computed(() => {
  const values = snapshot.value?.batch.media?.waveform ?? [];
  if (values.length === 0) return "";
  const n = Math.max(1, values.length - 1);
  return values.map((value, index) => {
    const x = index / n * 100;
    const y = 14 - Math.max(-1, Math.min(1, value)) * 11;
    return x.toFixed(2) + "," + y.toFixed(2);
  }).join(" ");
});

const modelOperationBusy = computed(() => snapshot.value?.models.operation.state === "running");
const modelHeavyBlocked = computed(() => liveState.value !== "idle" || modelOperationBusy.value || commandBusy.value);

function applySnapshot(next: LocalSubSnapshot) {
  const previous = snapshot.value;
  const startingNewSession = previous?.live.state !== "starting" && next.live.state === "starting";
  const transcriptChanged =
    next.live.currentText !== (previous?.live.currentText ?? "") ||
    next.live.previousText !== (previous?.live.previousText ?? "");

  if (startingNewSession) {
    transcriptHistory.value = [];
    levelHistory.value = Array.from({ length: 300 }, () => 0);
    levelHistoryTick = 0;
  }

  const finalized = next.live.previousText.trim();
  if (finalized && transcriptHistory.value.at(-1) !== finalized) {
    transcriptHistory.value = [...transcriptHistory.value.slice(-79), finalized];
  }

  snapshot.value = next;
  if (!batchKeywordsInitialized) {
    batchKeywords.value = next.batch.keywords ?? "";
    batchKeywordsInitialized = true;
  }
  if (next.live.state !== "running")
    liveLevel.value = Math.max(0, Math.min(1, next.live.level));

  if (!selectionInitialized || next.live.state === "idle" || next.live.state === "failed") {
    selectedSource.value = next.live.sourceId;
    selectedModelId.value = next.live.modelId || next.live.availableModels[0]?.id || "";
    selectionInitialized = true;
  }

  if (transcriptChanged) {
    void nextTick(() => {
      const target = transcriptScroll.value;
      if (target) target.scrollTop = target.scrollHeight;
    });
  }
}

async function refresh() {
  try {
    error.value = null;
    applySnapshot(await invoke<LocalSubSnapshot>("app.getSnapshot"));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

async function navigate(page: PageKey) {
  try {
    error.value = null;
    applySnapshot(await invoke<LocalSubSnapshot>("app.navigate", { page }));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

async function toggleLive() {
  if (!snapshot.value) return;
  commandBusy.value = true;
  error.value = null;
  try {
    if (liveRunning.value || livePending.value) {
      applySnapshot(await invoke<LocalSubSnapshot>("live.stop"));
    } else {
      applySnapshot(await invoke<LocalSubSnapshot>("live.start", {
        source: selectedSource.value,
        modelId: selectedModelId.value
      }));
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    try { await refresh(); } catch { }
  } finally {
    commandBusy.value = false;
  }
}

async function toggleHomeLive() {
  if (!snapshot.value) return;
  if (liveRunning.value || livePending.value) {
    await toggleLive();
    return;
  }
  selectedSource.value = snapshot.value.live.sourceId;
  selectedModelId.value = snapshot.value.live.modelId;
  await toggleLive();
}

async function refreshModels() {
  commandBusy.value = true;
  error.value = null;
  try {
    applySnapshot(await invoke<LocalSubSnapshot>("model.list"));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    commandBusy.value = false;
  }
}

async function setDefaultModel(target: "live" | "batch", modelId: string) {
  if (!modelId) return;
  commandBusy.value = true;
  error.value = null;
  try {
    applySnapshot(await invoke<LocalSubSnapshot>("model.select", { target, modelId }));
    if (target === "live") selectedModelId.value = modelId;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    commandBusy.value = false;
  }
}

async function downloadModel(model: ModelCatalogItem) {
  if (modelHeavyBlocked.value) return;
  commandBusy.value = true;
  error.value = null;
  deleteConfirmId.value = "";
  try {
    const method = model.installed || model.needsRepair || model.hasLocalData ? "model.repair" : "model.download";
    applySnapshot(await invoke<LocalSubSnapshot>(method, { modelId: model.id }));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    try { await refreshModels(); } catch { }
  } finally {
    commandBusy.value = false;
  }
}

async function cancelModelOperation() {
  error.value = null;
  try {
    applySnapshot(await invoke<LocalSubSnapshot>("model.cancel"));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

async function deleteModel(model: ModelCatalogItem) {
  if (!model.installed || modelHeavyBlocked.value) return;
  if (deleteConfirmId.value !== model.id) {
    deleteConfirmId.value = model.id;
    return;
  }

  deleteConfirmId.value = "";
  commandBusy.value = true;
  error.value = null;
  try {
    applySnapshot(await invoke<LocalSubSnapshot>("model.delete", { modelId: model.id }));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    try { await refreshModels(); } catch { }
  } finally {
    commandBusy.value = false;
  }
}

function changeModelDefault(target: "live" | "batch", event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  void setDefaultModel(target, value);
}

function parseBatchKeywords() {
  return batchKeywords.value.split(/[,，;；\r\n]+/).map(x => x.trim()).filter(Boolean).slice(0, 32);
}
function formatBatchTime(ms: number) {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0") + "." + String(millis).padStart(3, "0");
}
async function pickBatchFiles() {
  batchRequestBusy.value = true;
  error.value = null;
  try {
    const next = await invoke<LocalSubSnapshot>("batch.pickFiles");
    applySnapshot(next);
    const selected = next.batch.queue.find(x => x.id === next.batch.selectedId);
    if (selected && !selected.analyzed)
      applySnapshot(await invoke<LocalSubSnapshot>("batch.analyze", { id: selected.id }));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    batchRequestBusy.value = false;
  }
}
async function analyzeBatch(id: string) {
  if (!id || batchBusy.value) return;
  batchRequestBusy.value = true;
  error.value = null;
  try {
    applySnapshot(await invoke<LocalSubSnapshot>("batch.analyze", { id }));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    try { await refresh(); } catch { }
  } finally {
    batchRequestBusy.value = false;
  }
}
async function transcribeBatch() {
  const id = snapshot.value?.batch.selectedId;
  if (!id || batchBusy.value) return;
  batchRequestBusy.value = true;
  error.value = null;
  try {
    const method = snapshot.value?.batch.canRetry ? "batch.retry" : "batch.transcribe";
    applySnapshot(await invoke<LocalSubSnapshot>(method, { id, keywords: parseBatchKeywords() }));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    try { await refresh(); } catch { }
  } finally {
    batchRequestBusy.value = false;
  }
}
async function transcribeAllBatch() {
  if (!snapshot.value?.batch.canTranscribeAll || batchBusy.value) return;
  batchRequestBusy.value = true;
  batchClearArmed.value = false;
  error.value = null;
  try {
    applySnapshot(await invoke<LocalSubSnapshot>("batch.transcribeAll", { keywords: parseBatchKeywords() }));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    try { await refresh(); } catch { }
  } finally {
    batchRequestBusy.value = false;
  }
}
async function removeBatchItem(id: string) {
  if (!id || batchBusy.value) return;
  batchRequestBusy.value = true;
  batchClearArmed.value = false;
  error.value = null;
  try {
    applySnapshot(await invoke<LocalSubSnapshot>("batch.remove", { id }));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    batchRequestBusy.value = false;
  }
}
async function clearBatchQueue() {
  if (!snapshot.value?.batch.canClear || batchBusy.value) return;
  if (!batchClearArmed.value) {
    batchClearArmed.value = true;
    return;
  }
  batchRequestBusy.value = true;
  error.value = null;
  try {
    applySnapshot(await invoke<LocalSubSnapshot>("batch.clear"));
    batchClearArmed.value = false;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    batchRequestBusy.value = false;
  }
}
async function exportBatch(format: "txt" | "srt" | "vtt") {
  const id = snapshot.value?.batch.selectedId;
  if (!id || !snapshot.value?.batch.canExport || batchBusy.value) return;
  batchRequestBusy.value = true;
  batchClearArmed.value = false;
  error.value = null;
  try {
    applySnapshot(await invoke<LocalSubSnapshot>("batch.export", { id, format }));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    batchRequestBusy.value = false;
  }
}
async function exportAllBatch() {
  if (!snapshot.value?.batch.canExportAll || batchBusy.value) return;
  batchRequestBusy.value = true;
  error.value = null;
  try {
    applySnapshot(await invoke<LocalSubSnapshot>("batch.exportAll"));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    batchRequestBusy.value = false;
  }
}
async function pickBatchOutputDirectory() {
  if (batchBusy.value) return;
  batchRequestBusy.value = true;
  error.value = null;
  try {
    applySnapshot(await invoke<LocalSubSnapshot>("batch.pickOutputDirectory"));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    batchRequestBusy.value = false;
  }
}
async function openBatchOutputDirectory() {
  try {
    applySnapshot(await invoke<LocalSubSnapshot>("batch.openOutputDirectory"));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

async function cancelBatch() {
  error.value = null;
  try {
    applySnapshot(await invoke<LocalSubSnapshot>("batch.cancel"));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

async function saveSettings(params: Record<string, unknown>) {
  commandBusy.value = true;
  error.value = null;
  settingsSaveState.value = "正在保存";
  try {
    const next = await invoke<LocalSubSnapshot>("settings.update", params);
    applySnapshot(next);
    if (typeof params.audioSource === "string")
      selectedSource.value = params.audioSource === "allAudio" ? "allAudio" : "potplayer";
    settingsSaveState.value = "已保存";
    if (saveStateTimer) window.clearTimeout(saveStateTimer);
    saveStateTimer = window.setTimeout(() => settingsSaveState.value = "", 1800);
  } catch (e) {
    settingsSaveState.value = "保存失败";
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    commandBusy.value = false;
  }
}

async function previewSubtitle() {
  commandBusy.value = true;
  error.value = null;
  try {
    applySnapshot(await invoke<LocalSubSnapshot>("settings.previewSubtitle"));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    commandBusy.value = false;
  }
}

function boolSetting(key: string, event: Event) {
  void saveSettings({ [key]: (event.target as HTMLInputElement).checked });
}
function numberSetting(key: string, event: Event) {
  void saveSettings({ [key]: Number((event.target as HTMLInputElement).value) });
}
function selectSetting(key: string, event: Event) {
  void saveSettings({ [key]: (event.target as HTMLSelectElement).value });
}
function colorSetting(key: string, event: Event) {
  void saveSettings({ [key]: (event.target as HTMLInputElement).value.toUpperCase() });
}

function tipElement(event: Event) {
  const node = event.target instanceof Element ? event.target : null;
  return node?.closest("[data-tip]") as HTMLElement | null;
}
function showGlobalTip(event: Event) {
  const target = tipElement(event);
  if (!target) return;
  const related = (event as MouseEvent).relatedTarget;
  if (related instanceof Node && target.contains(related)) return;
  const value = target.dataset.tip?.trim();
  if (!value) return;
  const rect = target.getBoundingClientRect();
  const above = rect.bottom + 135 > window.innerHeight && rect.top > 150;
  const half = 185;
  const left = Math.min(Math.max(rect.left + rect.width / 2, half), Math.max(half, window.innerWidth - half));
  hoverTip.value = { text: value, left, top: above ? rect.top - 10 : rect.bottom + 10, above };
  activeTipTarget = target;
}
function hideGlobalTip(event: Event) {
  if (!activeTipTarget) return;
  const related = (event as MouseEvent).relatedTarget;
  if (related instanceof Node && activeTipTarget.contains(related)) return;
  const target = tipElement(event);
  if (target !== activeTipTarget) return;
  hoverTip.value = null;
  activeTipTarget = null;
}
function clearGlobalTip() {
  hoverTip.value = null;
  activeTipTarget = null;
}

onMounted(async () => {
  unsubscribeSnapshot = subscribeSnapshot(applySnapshot);
  unsubscribeLiveLevel = subscribeLiveLevel(applyLiveLevel);
  document.addEventListener("mouseover", showGlobalTip);
  document.addEventListener("mouseout", hideGlobalTip);
  window.addEventListener("scroll", clearGlobalTip, true);
  window.addEventListener("resize", clearGlobalTip);
  await refresh();

  if (new URLSearchParams(window.location.search).get("smoke") === "1") {
    try {
      applySnapshot(await invoke<LocalSubSnapshot>("live.stop"));
      applySnapshot(await invoke<LocalSubSnapshot>("settings.update", { showLiveLevelHistory: true }));
      try {
        await invoke<LocalSubSnapshot>("live.start", { source: "allAudio", modelId: "__ci_missing_model__" });
      } catch { }
      applySnapshot(await invoke<LocalSubSnapshot>("model.list"));
      try {
        await invoke<LocalSubSnapshot>("model.select", { target: "live", modelId: "__ci_missing_model__" });
      } catch { }
      applySnapshot(await invoke<LocalSubSnapshot>("model.cancel"));
      try {
        await invoke<LocalSubSnapshot>("model.download", { modelId: "__ci_missing_model__" });
      } catch { }
      try {
        await invoke<LocalSubSnapshot>("model.repair", { modelId: "__ci_missing_model__" });
      } catch { }
      try {
        await invoke<LocalSubSnapshot>("model.delete", { modelId: "__ci_missing_model__" });
      } catch { }
      applySnapshot(await invoke<LocalSubSnapshot>("batch.pickFiles"));
      applySnapshot(await invoke<LocalSubSnapshot>("batch.analyze", { id: "__ci_batch__" }));
      applySnapshot(await invoke<LocalSubSnapshot>("batch.transcribe", { id: "__ci_batch__", keywords: [] }));
      applySnapshot(await invoke<LocalSubSnapshot>("batch.transcribeAll", { keywords: [] }));
      applySnapshot(await invoke<LocalSubSnapshot>("batch.retry", { id: "__ci_batch__", keywords: [] }));
      applySnapshot(await invoke<LocalSubSnapshot>("batch.pickOutputDirectory"));
      applySnapshot(await invoke<LocalSubSnapshot>("batch.export", { id: "__ci_batch__", format: "srt" }));
      applySnapshot(await invoke<LocalSubSnapshot>("batch.exportTxt", { id: "__ci_batch__" }));
      applySnapshot(await invoke<LocalSubSnapshot>("batch.exportAll"));
      applySnapshot(await invoke<LocalSubSnapshot>("batch.openOutputDirectory"));
      applySnapshot(await invoke<LocalSubSnapshot>("batch.remove", { id: "__ci_batch__" }));
      applySnapshot(await invoke<LocalSubSnapshot>("batch.clear"));
      applySnapshot(await invoke<LocalSubSnapshot>("batch.cancel"));
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }
});

onBeforeUnmount(() => {
  unsubscribeSnapshot?.();
  unsubscribeLiveLevel?.();
  document.removeEventListener("mouseover", showGlobalTip);
  document.removeEventListener("mouseout", hideGlobalTip);
  window.removeEventListener("scroll", clearGlobalTip, true);
  window.removeEventListener("resize", clearGlobalTip);
  if (saveStateTimer) window.clearTimeout(saveStateTimer);
  disposeBridge();
});
</script>

<template>
  <main class="app-shell">
    <aside class="sidebar">
      <div class="side-brand">
        <div class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 48 48"><path d="M9 19h7l4-8 8 26 5-13h6"></path></svg>
        </div>
        <div class="brand-copy"><h1>LocalSub</h1><small class="brand-version">v{{ snapshot?.app.productVersion ?? "0.1.23" }}</small></div>
      </div>

      <nav class="side-nav" aria-label="主导航">
        <button v-for="item in nav.slice(0,5)" :key="item.key" type="button"
          :class="{ active: activePage === item.key }" @click="navigate(item.key)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="item.path"></path></svg>
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <div class="side-spacer"></div>

      <nav class="side-nav side-secondary" aria-label="辅助导航">
        <button v-for="item in nav.slice(5)" :key="item.key" type="button"
          :class="{ active: activePage === item.key }" @click="navigate(item.key)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="item.path"></path></svg>
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <div class="side-status" :class="'state-' + sideStatusKind" :data-tip="sideStatusTip">
        <span class="side-status-icon" :class="'state-' + sideStatusKind" aria-hidden="true">
          <svg v-if="sideStatusKind === 'run'" viewBox="0 0 24 24"><path d="M8 5.5 18 12 8 18.5Z"></path></svg>
          <svg v-else-if="sideStatusKind === 'wait'" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"></circle><path d="M12 7.5V12l3 2"></path></svg>
          <svg v-else-if="sideStatusKind === 'warning'" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><path d="M12 7.5v6M12 17v.1"></path></svg>
          <svg v-else-if="sideStatusKind === 'complete'" viewBox="0 0 24 24"><path d="m6.5 12.5 3.4 3.4 7.8-8"></path></svg>
          <svg v-else viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle></svg>
        </span>
        <div><strong>{{ sideStatusTitle }}</strong><small>{{ sideStatusSecondary }}</small></div>
      </div>
    </aside>

    <section class="workspace">
      <section v-if="error" class="notice error">
        <span class="notice-icon">!</span><div><b>操作失败</b><span>{{ error }}</span></div>
      </section>

      <section v-if="loading" class="loading-card">正在连接 LocalSub Shell…</section>

      <template v-else-if="snapshot">
        <section v-if="activePage === 'home'" class="page home-page">
          <header class="home-control-head">
            <div class="home-control-copy">
              <div class="home-title-line">
                <h2>运行概览</h2>
                <span class="info-dot" data-tip="集中查看实时字幕、后台转写与启动方式。次要说明已收进悬浮提示。">i</span>
              </div>
            </div>

            <div class="home-control-state" :class="'state-' + sideStatusKind" :data-tip="homeStateDetail">
              <span class="home-state-icon" aria-hidden="true">
                <svg v-if="liveRunning" viewBox="0 0 24 24"><path d="M8 5.5 18 12 8 18.5Z"></path></svg>
                <svg v-else-if="liveTransitioning || livePending" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"></circle><path d="M12 7.5V12l3 2"></path></svg>
                <svg v-else-if="sideStatusKind === 'warning'" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><path d="M12 7.5v6M12 17v.1"></path></svg>
                <svg v-else-if="allReady" viewBox="0 0 24 24"><path d="m6.5 12.5 3.3 3.3 7.8-8"></path></svg>
                <svg v-else viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle></svg>
              </span>
              <strong>{{ homeStateText }}</strong>
            </div>

            <div class="home-action-slot">
              <button class="home-primary-action" type="button"
                :class="{ start: !liveRunning && !livePending && !homeButtonDisabled, stop: liveRunning || livePending, disabled: homeButtonDisabled }"
                :disabled="homeButtonDisabled" :aria-busy="liveTransitioning || commandBusy"
                :data-tip="homeActionTip" @click="toggleHomeLive">
                <svg v-if="liveTransitioning" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"></circle><path d="M12 7.5V12l3 2"></path></svg>
                <svg v-else-if="!liveRunning && !livePending" viewBox="0 0 24 24"><path d="M8 5.5 18 12 8 18.5Z"></path></svg>
                <svg v-else viewBox="0 0 24 24"><rect x="7" y="6" width="3.2" height="12" rx="1"></rect><rect x="13.8" y="6" width="3.2" height="12" rx="1"></rect></svg>
                {{ homeActionLabel }}
              </button>
            </div>
          </header>

          <section class="home-status-list">
            <article class="home-control-row" data-tip="Core 可按需启动；实时模型必须已安装。PotPlayer 未打开时也可以先开始，LocalSub 会持续等待音源。">
              <span class="home-row-feature readiness" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5 9.2 17 19 7"></path></svg></span>
              <div class="home-row-copy"><div class="home-row-title"><h3>运行条件</h3><span class="info-dot tiny">i</span></div></div>
              <div class="home-readiness">
                <span :class="{ ok: coreOperational }"><i></i>Core</span>
                <span :class="{ ok: liveModelReady }"><i></i>模型</span>
                <span :class="{ ok: inputReady }"><i></i>音源</span>
              </div>
              <b class="home-row-result" :class="{ ok: allReady }">{{ homeReadinessCount }}/3</b>
            </article>

            <article class="home-control-row" data-tip="开始实时字幕时使用当前默认音源与实时模型。等待音源期间配置会锁定，避免启动目标发生变化。">
              <span class="home-row-feature live" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 9h4l4-4v14l-4-4H5z M16 9.5a4 4 0 0 1 0 5 M18.5 7a7.5 7.5 0 0 1 0 10"></path></svg></span>
              <div class="home-row-copy"><div class="home-row-title"><h3>实时配置</h3><span class="info-dot tiny">i</span></div></div>
              <div class="home-row-main">{{ snapshot.settings.audioSource }} · {{ snapshot.models.liveModelName }}</div>
              <b class="home-row-result" :class="{ ok: liveModelReady }">{{ livePending ? "等待" : (liveRunning ? "运行" : "当前") }}</b>
            </article>

            <article class="home-control-row" data-tip="字幕 Overlay 随实时字幕自动开启，并跟随 PotPlayer 窗口。">
              <span class="home-row-feature overlay" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="13" rx="2"></rect><path d="M7 14h10M9 10h6"></path></svg></span>
              <div class="home-row-copy"><div class="home-row-title"><h3>字幕显示</h3><span class="info-dot tiny">i</span></div></div>
              <div class="home-row-main">自动跟随播放器</div>
              <b class="home-row-result ok">{{ liveRunning ? "运行" : "就绪" }}</b>
            </article>

            <article class="home-control-row" data-tip="后台转写使用独立默认模型。未安装时可到模型页下载或切换。">
              <span class="home-row-feature batch" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3.5h8l4 4V20H6z M14 3.5V8h4 M9 12h6 M9 15.5h6"></path></svg></span>
              <div class="home-row-copy"><div class="home-row-title"><h3>后台转写</h3><span class="info-dot tiny">i</span></div></div>
              <div class="home-row-main">{{ snapshot.models.batchModelName }}</div>
              <b class="home-row-result" :class="{ ok: batchModelReady }">{{ batchModelReady ? "可用" : "需安装" }}</b>
            </article>

            <article class="home-control-row startup" data-tip="可在设置中组合开机启动、静默托盘和启动后自动开启实时字幕。">
              <span class="home-row-feature startup" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v8 M8.5 5.5A8 8 0 1 0 15.5 5.5"></path></svg></span>
              <div class="home-row-copy"><div class="home-row-title"><h3>启动方式</h3><span class="info-dot tiny">i</span></div></div>
              <div class="home-row-main">{{ startupModeLabel }}</div>
              <button class="home-row-link" type="button" @click="navigate('settings')">调整</button>
            </article>
          </section>
        </section>

        <section v-else-if="activePage === 'live'" class="page live-page">
          <header class="live-task-card">
            <span class="live-module-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 12h3l2-6 4 12 3-9 2 3h4"></path></svg></span>

            <div class="live-task-copy">
              <div class="live-title-line">
                <h2>实时字幕</h2>
                <span class="info-dot" data-tip="识别在独立 Core 中运行；PotPlayer 音源未出现时可以先启动并持续等待。">i</span>
              </div>
            </div>

            <div class="live-task-center">
              <div class="live-task-status" :class="'state-' + (livePending ? 'starting' : liveState)" :data-tip="snapshot.live.status">
                <span class="live-task-status-icon" aria-hidden="true">
                  <svg v-if="liveRunning" viewBox="0 0 24 24"><path d="M8 5.5 18 12 8 18.5Z"></path></svg>
                  <svg v-else-if="liveTransitioning || livePending" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"></circle><path d="M12 7.5V12l3 2"></path></svg>
                  <svg v-else-if="liveState === 'failed'" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><path d="M12 7.5v6M12 17v.1"></path></svg>
                  <svg v-else viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle></svg>
                </span>
                <strong>{{ liveStateLabel }}</strong>
              </div>

              <div class="instant-level" data-tip="与 ASR 使用同一块 16 kHz mono PCM，约 30 Hz 更新。">
                <span>输入</span>
                <div class="meter-track"><i :style="{ width: Math.max(1, liveLevel * 100) + '%' }"></i></div>
                <b>{{ Math.round(liveLevel * 100) }}%</b>
              </div>
            </div>

            <div class="live-action-slot">
              <button class="live-primary-action" :class="{ stop: liveRunning || livePending, start: !liveRunning && !livePending }" type="button" :disabled="liveButtonDisabled" @click="toggleLive">
                <svg v-if="!liveRunning && !livePending" viewBox="0 0 24 24"><path d="M8 5.5 18 12 8 18.5Z"></path></svg>
                <svg v-else viewBox="0 0 24 24"><rect x="7" y="6" width="3.2" height="12" rx="1"></rect><rect x="13.8" y="6" width="3.2" height="12" rx="1"></rect></svg>
                {{ liveButtonText }}
              </button>
            </div>
          </header>

          <section class="live-control-strip">
            <label class="live-inline-control" data-tip="选择实时监听的音频来源。PotPlayer 未启动时仍可先点击开始，LocalSub 会等待播放器出现。">
              <span class="row-icon audio"><svg viewBox="0 0 24 24"><path d="M5 9h4l4-4v14l-4-4H5z M16 9.5a4 4 0 0 1 0 5 M18.5 7a7.5 7.5 0 0 1 0 10"></path></svg></span>
              <strong>音源</strong>
              <select v-model="selectedSource" :disabled="liveControlsLocked"><option value="potplayer">PotPlayer</option><option value="allAudio">所有音频</option></select>
              <span class="info-dot tiny">i</span>
            </label>
            <label class="live-inline-control model" data-tip="仅列出已经安装并支持实时识别的模型。">
              <span class="row-icon model"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="6.5" rx="7" ry="3"></ellipse><path d="M5 6.5V12c0 1.7 3.1 3 7 3s7-1.3 7-3V6.5 M5 12v5.5c0 1.7 3.1 3 7 3s7-1.3 7-3V12"></path></svg></span>
              <strong>识别模型</strong>
              <select v-model="selectedModelId" :disabled="liveControlsLocked || snapshot.live.availableModels.length === 0"><option v-for="model in snapshot.live.availableModels" :key="model.id" :value="model.id">{{ model.name }}</option><option v-if="snapshot.live.availableModels.length === 0" value="">未安装实时模型</option></select>
              <span class="info-dot tiny">i</span>
            </label>
          </section>

          <section class="waveform-section" :class="{ collapsed: !snapshot.settings.showLiveLevelHistory }">
            <div class="wave-head">
              <div><strong>输入电平</strong><span class="info-dot tiny" data-tip="显示最近约 30 秒输入峰值历史。">i</span></div>
              <label class="wave-history-toggle" data-tip="关闭后只隐藏历史曲线，顶部实时电平仍持续更新。">
                <span>历史</span>
                <span class="switch small-switch"><input type="checkbox" :checked="snapshot.settings.showLiveLevelHistory" @change="boolSetting('showLiveLevelHistory',$event)"><span></span></span>
              </label>
            </div>
            <template v-if="snapshot.settings.showLiveLevelHistory">
              <svg class="level-wave" viewBox="0 0 100 34" preserveAspectRatio="none" aria-label="最近约 30 秒输入电平历史">
                <line class="axis axis-x" x1="0" y1="31" x2="100" y2="31"></line>
                <polyline :points="waveformPoints"></polyline>
              </svg>
              <div class="wave-axis"><span>30 s</span><span>15 s</span><span>现在</span></div>
            </template>
          </section>

          <section class="transcript-section">
            <div class="transcript-head">
              <div><strong>字幕</strong><span class="info-dot tiny" data-tip="当前字幕突出显示，近期历史逐级弱化并自动跟随最新内容。">i</span></div>
            </div>
            <div ref="transcriptScroll" class="transcript-scroll">
              <p v-for="(line,index) in transcriptHistory" :key="index" class="history-line" :class="transcriptLineClass(index)">{{ line }}</p>
              <p v-if="snapshot.live.currentText" class="current">{{ snapshot.live.currentText }}</p>
              <p v-else-if="transcriptHistory.length === 0" class="empty">暂无字幕</p>
            </div>
          </section>
        </section>

        <section v-else-if="activePage === 'batch'" class="page batch-page">
          <header class="page-head simple-head">
            <div class="page-feature batch-feature"><svg viewBox="0 0 48 48"><path d="M12 7h16l8 8v26H12z M28 7v9h8 M18 24h12 M18 30h12"></path></svg></div>
            <div class="page-title">
              <div class="title-line"><h2>后台转写</h2><span class="info-dot" data-tip="文件选择由 Windows Shell 完成，媒体分析与离线识别在独立 Core 中执行。">i</span></div>
              <span>{{ batchBusy ? snapshot.batch.status : (snapshot.batch.queued ? snapshot.batch.completed + " / " + snapshot.batch.queued + " 已完成" : snapshot.batch.status) }}</span>
            </div>
            <button class="secondary-button icon-action" type="button" :disabled="batchBusy || batchRequestBusy" @click="pickBatchFiles">
              <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"></path></svg>添加媒体
            </button>
          </header>

          <section v-if="snapshot.batch.queue.length === 0" class="batch-empty">
            <span class="drop-feature"><svg viewBox="0 0 48 48"><path d="M24 11v26 M11 24h26"></path></svg></span>
            <strong>添加视频或音频</strong>
            <span>支持常见视频、音频格式，文件路径只由 Windows Shell 持有。</span>
            <button class="primary-button" type="button" @click="pickBatchFiles">选择媒体</button>
          </section>

          <section v-else class="batch-workspace">
            <div class="batch-toolbar">
              <div class="batch-model-summary">
                <span class="batch-tool-icon"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="6.5" rx="7" ry="3"></ellipse><path d="M5 6.5V12c0 1.7 3.1 3 7 3s7-1.3 7-3V6.5 M5 12v5.5c0 1.7 3.1 3 7 3s7-1.3 7-3V12"></path></svg></span>
                <div><small>后台模型</small><strong>{{ snapshot.batch.batchModelName }}</strong></div>
              </div>
              <label class="batch-keywords" data-tip="关键词会随下一次转写保存，之后重新打开 LocalSub 仍会保留。"><span>关键词</span><input v-model="batchKeywords" type="text" placeholder="可选，逗号分隔" :disabled="batchBusy"></label>
              <div class="batch-output-summary">
                <button type="button" class="batch-output-button" :disabled="batchBusy || batchRequestBusy" data-tip="选择默认结果目录。结构化 JSON 自动保存到这里，整队导出也使用这里。" @click="pickBatchOutputDirectory">
                  <svg viewBox="0 0 24 24"><path d="M3.5 7h6l2 2h9v10H3.5z"></path></svg>
                  <span><small>输出目录</small><strong>{{ snapshot.batch.outputDirectoryName }}</strong></span>
                </button>
                <button type="button" class="batch-open-output" data-tip="在资源管理器打开输出目录" @click="openBatchOutputDirectory">↗</button>
              </div>
              <div class="batch-run-actions">
                <button v-if="snapshot.batch.canExportAll" class="batch-export-all" type="button" :disabled="batchBusy || batchRequestBusy" @click="exportAllBatch">全部导出</button>
                <button class="batch-all-button" type="button" :disabled="!snapshot.batch.canTranscribeAll || batchBusy || batchRequestBusy || !batchModelReady" @click="transcribeAllBatch">全部转写</button>
                <button class="batch-start-button" type="button" :class="{retry:snapshot.batch.canRetry}" :disabled="!snapshot.batch.canTranscribe || batchBusy || batchRequestBusy || !batchModelReady" @click="transcribeBatch">
                  <svg viewBox="0 0 24 24"><path v-if="snapshot.batch.canRetry" d="M18 8a7 7 0 1 0 1 7 M18 8v5h-5"></path><path v-else d="M8 5.5 18 12 8 18.5Z"></path></svg>{{ batchPrimaryLabel }}
                </button>
              </div>
            </div>

            <div class="batch-queue-strip">
              <div class="batch-queue-summary">
                <strong>{{ snapshot.batch.completed }}/{{ snapshot.batch.queued }}</strong>
                <small>已完成</small>
                <button type="button" :class="{armed:batchClearArmed}" :disabled="batchBusy || batchRequestBusy" @click="clearBatchQueue">{{ batchClearArmed ? "确认清空" : "清空" }}</button>
              </div>
              <article v-for="item in snapshot.batch.queue" :key="item.id" class="batch-queue-item" :class="{active:item.id===snapshot.batch.selectedId,done:item.transcribed,missing:item.missing,retry:item.retryable}">
                <button class="batch-queue-select" type="button" :disabled="batchBusy" @click="analyzeBatch(item.id)">
                  <span class="batch-file-icon"><svg viewBox="0 0 24 24"><path d="M6 3.5h8l4 4V20H6z M14 3.5V8h4"></path></svg></span>
                  <span><strong>{{ item.name }}</strong><small>{{ item.state }}<template v-if="item.transcribed"> · {{ item.segments }} 段 · RTF {{ item.realTimeFactor?.toFixed(2) }}</template></small></span>
                </button>
                <button class="batch-remove" type="button" :disabled="batchBusy || batchRequestBusy" data-tip="从当前队列移除，不删除原始媒体文件。" @click.stop="removeBatchItem(item.id)">×</button>
              </article>
            </div>

            <section class="batch-media-panel">
              <div class="batch-media-head">
                <div><strong>{{ snapshot.batch.selectedName || "未选择媒体" }}</strong>
                  <small v-if="snapshot.batch.media">{{ Math.round(snapshot.batch.media.durationMs/1000) }} s · {{ snapshot.batch.media.sampleRate }} Hz · {{ snapshot.batch.media.channels }} 声道 · {{ snapshot.batch.media.decoderName }}</small>
                  <small v-else>选择队列中的媒体以生成声音轨道</small>
                </div>
                <div class="batch-media-actions">
                  <button v-if="batchSelected && !batchSelected.analyzed && !batchSelected.missing" type="button" :disabled="batchBusy" @click="analyzeBatch(batchSelected.id)">分析媒体</button>
                  <template v-if="snapshot.batch.canExport">
                    <button type="button" :disabled="batchBusy || batchRequestBusy" @click="exportBatch('srt')">SRT</button>
                    <button type="button" :disabled="batchBusy || batchRequestBusy" @click="exportBatch('vtt')">VTT</button>
                    <button type="button" :disabled="batchBusy || batchRequestBusy" @click="exportBatch('txt')">TXT</button>
                  </template>
                </div>
              </div>
              <div class="batch-wave-shell">
                <svg v-if="batchWaveformPoints" class="batch-wave" viewBox="0 0 100 28" preserveAspectRatio="none">
                  <line x1="0" y1="14" x2="100" y2="14"></line>
                  <polyline :points="batchWaveformPoints"></polyline>
                </svg>
                <span v-else>声音轨道将在媒体分析后显示</span>
              </div>
            </section>

            <section class="batch-transcript-panel">
              <div class="batch-transcript-head">
                <div><strong>转写结果</strong><span v-if="snapshot.batch.result">{{ snapshot.batch.result.segments }} 段 · RTF {{ snapshot.batch.result.realTimeFactor.toFixed(2) }}</span></div>
                <span>{{ snapshot.batch.transcript.length ? "结果已自动保存，可导出 SRT / VTT / TXT" : "等待转写" }}</span>
              </div>
              <div class="batch-transcript-scroll">
                <p v-for="(line,index) in snapshot.batch.transcript" :key="index"><b>{{ formatBatchTime(line.startMs) }}</b><span>{{ line.text }}</span></p>
                <div v-if="snapshot.batch.transcript.length===0" class="batch-transcript-empty">开始转写后，分段文本会显示在这里。</div>
              </div>
            </section>

            <footer class="batch-operation-bar" :class="{busy:batchBusy,failed:snapshot.batch.state==='failed'}">
              <div><strong>{{ snapshot.batch.progress.stage }}</strong><span>{{ snapshot.batch.progress.detail || snapshot.batch.status }}</span></div>
              <div class="batch-progress-track"><i :style="{width:(snapshot.batch.progress.percent ?? 0)+'%'}"></i></div>
              <b>{{ snapshot.batch.progress.percent == null ? "" : snapshot.batch.progress.percent + "%" }}</b>
              <button v-if="snapshot.batch.canCancel" type="button" @click="cancelBatch">取消</button>
            </footer>
          </section>
        </section>

        <section v-else-if="activePage === 'models'" class="page models-page">
          <header class="page-head compact-head">
            <div class="page-feature model-feature"><svg viewBox="0 0 48 48"><ellipse cx="24" cy="13" rx="14" ry="6"></ellipse><path d="M10 13v11c0 3.3 6.3 6 14 6s14-2.7 14-6V13 M10 24v11c0 3.3 6.3 6 14 6s14-2.7 14-6V24"></path></svg></div>
            <div class="page-title"><div class="title-line"><h2>本地模型</h2><span class="info-dot" data-tip="默认页只显示需要配置的模型。完整模型清单、评分和安装操作放在模型库。">i</span></div><span>{{ snapshot.models.installedCount }} / {{ snapshot.models.catalogCount }} 已安装</span></div>
            <button class="secondary-button icon-action" type="button" :disabled="commandBusy" @click="refreshModels"><svg viewBox="0 0 24 24"><path d="M19 7v5h-5 M18.2 12A6.7 6.7 0 1 1 16 6.7L19 9"></path></svg>重新扫描</button>
          </header>

          <nav class="inner-tabs">
            <button :class="{active:modelTab==='config'}" @click="modelTab='config'">配置</button>
            <button :class="{active:modelTab==='library'}" @click="modelTab='library'">模型库</button>
          </nav>

          <section v-if="modelTab==='config'" class="model-config">
            <label class="model-config-row">
              <span class="row-icon live-model"><svg viewBox="0 0 24 24"><path d="M3 12h3l2-6 4 12 3-9 2 3h4"></path></svg></span>
              <span><strong>实时字幕模型</strong><small>低延迟识别</small></span>
              <select :value="snapshot.models.liveModelId" @change="changeModelDefault('live',$event)"><option v-for="model in installedLiveModels" :key="model.id" :value="model.id">{{ model.name }}</option></select>
              <b :class="{ok:liveModelReady}">{{ liveModelReady ? "可用" : "需安装" }}</b>
            </label>
            <label class="model-config-row">
              <span class="row-icon batch-model"><svg viewBox="0 0 24 24"><path d="M6 4h8l4 4v12H6z M14 4v5h4 M9 13h6 M9 16h6"></path></svg></span>
              <span><strong>后台转写模型</strong><small>离线高准确识别</small></span>
              <select :value="snapshot.models.batchModelId" @change="changeModelDefault('batch',$event)"><option v-for="model in installedBatchModels" :key="model.id" :value="model.id">{{ model.name }}</option></select>
              <b :class="{ok:batchModelReady}">{{ batchModelReady ? "可用" : "需安装" }}</b>
            </label>
            <div class="model-config-row">
              <span class="row-icon vad"><svg viewBox="0 0 24 24"><path d="M4 13h2l2-7 4 13 3-10 2 4h3"></path></svg></span>
              <span><strong>语音检测 VAD</strong><small>{{ vadModel?.name ?? "Silero VAD" }}</small></span>
              <span></span>
              <b :class="{ok:vadModel?.installed}">{{ vadModel?.installed ? "已安装" : "未安装" }}</b>
            </div>
            <div class="model-config-foot"><button type="button" @click="modelTab='library'">打开模型库</button><span>{{ snapshot.models.status }}</span></div>
          </section>

          <section v-else class="model-library">
            <div class="library-toolbar">
              <div class="model-filter-bar"><button v-for="item in modelFilters" :key="item.key" :class="{active:modelFilter===item.key}" @click="modelFilter=item.key">{{ item.label }}</button></div>
              <span>{{ filteredCatalogModels.length }} 个模型</span>
            </div>
            <div class="model-table-shell">
              <table class="model-table">
                <thead><tr><th>模型</th><th>语言</th><th>体积</th><th>实时</th><th>准确</th><th>性价比</th><th>状态</th><th></th></tr></thead>
                <tbody>
                  <tr v-for="model in filteredCatalogModels" :key="model.id">
                    <td><div class="table-model-name"><span class="mini-model-icon" :class="{installed:model.installed}"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="6.5" rx="7" ry="3"></ellipse><path d="M5 6.5V12c0 1.7 3.1 3 7 3s7-1.3 7-3V6.5 M5 12v5.5c0 1.7 3.1 3 7 3s7-1.3 7-3V12"></path></svg></span><span><strong>{{ model.name }}</strong><small><i v-if="model.recommended">推荐</i><span class="info-dot tiny" :data-tip="model.purpose">i</span></small></span></div></td>
                    <td>{{ model.languages }}</td><td>{{ model.sizeText }}</td><td class="score">{{ model.realtimeScore || "·" }}</td><td class="score">{{ model.accuracyScore || "·" }}</td><td class="score">{{ model.valueScore || "·" }}</td>
                    <td><span class="install-state" :class="{installed:model.installed,repair:model.needsRepair}">{{ model.installed ? "已安装" : (model.needsRepair ? "需修复" : "未安装") }}</span></td>
                    <td class="table-actions">
                      <button type="button" :disabled="modelHeavyBlocked" @click="downloadModel(model)">{{ model.installed ? "校验/修复" : (model.needsRepair || model.hasLocalData ? "继续修复" : "下载") }}</button>
                      <button v-if="model.installed" type="button" class="delete-link" :class="{armed:deleteConfirmId===model.id}" :disabled="modelHeavyBlocked" @click="deleteModel(model)">{{ deleteConfirmId===model.id ? "确认" : "删除" }}</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="operation-bar" :class="{busy:modelOperationBusy,failed:snapshot.models.operation.state==='failed'}">
              <span>{{ snapshot.models.operation.stage }}</span><strong>{{ snapshot.models.operation.modelName }}</strong><small>{{ snapshot.models.operation.detail }}</small>
              <div v-if="modelOperationBusy" class="mini-progress"><i :style="{width:(snapshot.models.operation.percent ?? 36)+'%'}"></i></div>
              <button v-if="snapshot.models.operation.canCancel" type="button" @click="cancelModelOperation">取消</button>
            </div>
          </section>
        </section>

        <section v-else-if="activePage === 'settings'" class="page settings-page">
          <header class="page-head compact-head">
            <div class="page-feature settings-feature"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="7"></circle><path d="M24 7v5 M24 36v5 M7 24h5 M36 24h5 M12 12l4 4 M32 32l4 4 M36 12l-4 4 M16 32l-4 4"></path><circle cx="24" cy="24" r="14"></circle></svg></div>
            <div class="page-title"><div class="title-line"><h2>设置</h2><span v-if="settingsSaveState" class="save-state">{{ settingsSaveState }}</span></div><span>所有修改自动保存</span></div>
          </header>

          <nav class="inner-tabs">
            <button :class="{active:settingsTab==='subtitle'}" @click="settingsTab='subtitle'">字幕</button>
            <button :class="{active:settingsTab==='startup'}" @click="settingsTab='startup'">启动</button>
            <button :class="{active:settingsTab==='runtime'}" @click="settingsTab='runtime'">运行</button>
          </nav>

          <section v-if="settingsTab==='subtitle'" class="settings-body">
            <div class="settings-row"><span class="setting-label"><span class="row-icon subtitle"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2"></rect><path d="M7 11h4 M13 11h4 M7 15h7"></path></svg></span><span><strong>自动字号</strong><small>根据播放器窗口自动计算</small></span></span><label class="switch"><input type="checkbox" :checked="snapshot.settings.subtitleAutoSize" @change="boolSetting('subtitleAutoSize',$event)"><span></span></label></div>
            <div class="settings-row"><span class="setting-label"><strong>{{ snapshot.settings.subtitleAutoSize ? "自动字号倍率" : "字幕字号" }}</strong></span><div class="range-control"><input type="range" :min="snapshot.settings.subtitleAutoSize ? 60 : 20" :max="snapshot.settings.subtitleAutoSize ? 160 : 52" :value="snapshot.settings.subtitleAutoSize ? snapshot.settings.subtitleAutoScalePercent : snapshot.settings.subtitleFontSize" @change="numberSetting(snapshot.settings.subtitleAutoSize ? 'subtitleAutoScalePercent' : 'subtitleFontSize',$event)"><b>{{ snapshot.settings.subtitleAutoSize ? snapshot.settings.subtitleAutoScalePercent + '%' : snapshot.settings.subtitleFontSize + ' px' }}</b></div></div>
            <div class="settings-row"><span class="setting-label"><strong>底部距离</strong></span><div class="range-control"><input type="range" min="0" max="180" :value="snapshot.settings.subtitleBottomOffset" @change="numberSetting('subtitleBottomOffset',$event)"><b>{{ snapshot.settings.subtitleBottomOffset }} px</b></div></div>
            <div class="settings-row"><span class="setting-label"><strong>最大宽度</strong></span><div class="range-control"><input type="range" min="50" max="100" :value="snapshot.settings.subtitleMaxWidthPercent" @change="numberSetting('subtitleMaxWidthPercent',$event)"><b>{{ snapshot.settings.subtitleMaxWidthPercent }}%</b></div></div>
            <div class="settings-row"><span class="setting-label"><strong>字幕背景</strong></span><select :value="snapshot.settings.subtitleBackground" @change="selectSetting('subtitleBackground',$event)"><option value="None">无</option><option value="Light">浅色</option><option value="Dark">深色</option></select></div>
            <div class="settings-row"><span class="setting-label"><strong>背景透明度</strong></span><div class="range-control"><input type="range" min="0" max="70" :value="snapshot.settings.subtitleBackgroundOpacity" @change="numberSetting('subtitleBackgroundOpacity',$event)"><b>{{ snapshot.settings.subtitleBackgroundOpacity }}%</b></div></div>
            <div class="settings-row"><span class="setting-label"><strong>停留时间</strong></span><div class="range-control"><input type="range" min="1" max="10" step="0.5" :value="snapshot.settings.subtitleDisplaySeconds" @change="numberSetting('subtitleDisplaySeconds',$event)"><b>{{ snapshot.settings.subtitleDisplaySeconds.toFixed(1) }} s</b></div></div>
            <div class="settings-row color-row"><span class="setting-label"><strong>当前字幕颜色</strong></span><input type="color" :value="snapshot.settings.subtitleCurrentColor" @change="colorSetting('subtitleCurrentColor',$event)"></div>
            <div class="settings-row color-row"><span class="setting-label"><strong>上一条颜色</strong></span><input type="color" :value="snapshot.settings.subtitlePreviousColor" @change="colorSetting('subtitlePreviousColor',$event)"></div>
            <div class="settings-actions"><button class="secondary-button" type="button" @click="previewSubtitle">预览字幕</button></div>
          </section>

          <section v-else-if="settingsTab==='startup'" class="settings-body">
            <div class="settings-row"><span class="setting-label"><span class="row-icon tray"><svg viewBox="0 0 24 24"><path d="M4 17h16 M7 17v2h10v-2 M6 5h12v9H6z"></path></svg></span><span><strong>关闭后驻留托盘</strong><small>关闭或最小化窗口时继续后台运行</small></span></span><label class="switch"><input type="checkbox" :checked="snapshot.settings.minimizeToTray" @change="boolSetting('minimizeToTray',$event)"><span></span></label></div>
            <div class="settings-row"><span class="setting-label"><span class="row-icon startup"><svg viewBox="0 0 24 24"><path d="M12 3v8 M8.5 5.5A8 8 0 1 0 15.5 5.5"></path></svg></span><span><strong>Windows 登录时启动</strong><small>当前用户，无需管理员权限</small></span></span><label class="switch"><input type="checkbox" :checked="snapshot.settings.startWithWindows" @change="boolSetting('startWithWindows',$event)"><span></span></label></div>
            <div class="settings-row"><span class="setting-label"><span class="row-icon silent"><svg viewBox="0 0 24 24"><path d="M5 9h4l4-4v14l-4-4H5z M17 9l3 6 M20 9l-3 6"></path></svg></span><span><strong>静默启动到托盘</strong><small>仅 Windows 自动启动时不显示主窗口</small></span></span><label class="switch"><input type="checkbox" :checked="snapshot.settings.silentStartup" :disabled="!snapshot.settings.startWithWindows" @change="boolSetting('silentStartup',$event)"><span></span></label></div>
            <div class="settings-row"><span class="setting-label"><span class="row-icon auto-live"><svg viewBox="0 0 24 24"><path d="M8 5.5 18 12 8 18.5Z"></path></svg></span><span><strong>启动后自动开启实时字幕</strong><small>{{ snapshot.settings.audioSourceId==='potplayer' ? 'PotPlayer 未打开时自动等待，不回退系统音频' : '启动后直接监听所有音频' }}</small></span></span><label class="switch"><input type="checkbox" :checked="snapshot.settings.autoStartLive" @change="boolSetting('autoStartLive',$event)"><span></span></label></div>
            <div class="startup-summary"><span :class="{ok:snapshot.settings.startupRegistered}"></span><strong>{{ snapshot.settings.startWithWindows ? (snapshot.settings.startupRegistered ? "开机启动项已注册" : "正在更新启动项") : "未启用开机启动" }}</strong></div>
          </section>

          <section v-else class="settings-body">
            <div class="settings-row"><span class="setting-label"><span class="row-icon audio"><svg viewBox="0 0 24 24"><path d="M5 9h4l4-4v14l-4-4H5z M16 9.5a4 4 0 0 1 0 5"></path></svg></span><span><strong>默认音源</strong><small>实时字幕默认使用</small></span></span><select :value="snapshot.settings.audioSourceId" @change="selectSetting('audioSource',$event)"><option value="potplayer">PotPlayer</option><option value="allAudio">所有音频</option></select></div>
            <div class="settings-row"><span class="setting-label"><span class="row-icon compute"><svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"></rect><path d="M9 2.8v3.2 M15 2.8v3.2 M9 18v3.2 M15 18v3.2 M2.8 9H6 M18 9h3.2 M2.8 15H6 M18 15h3.2"></path></svg></span><span><strong>资源策略</strong><small>下一次识别任务生效</small></span></span><select :value="snapshot.settings.resourceProfile" @change="selectSetting('resourceProfile',$event)"><option value="Eco">节能</option><option value="Auto">自动</option><option value="MaxPerformance">最大性能</option></select></div>
            <div class="settings-row"><span class="setting-label"><span class="row-icon monitor"><svg viewBox="0 0 24 24"><path d="M3 12h3l2-6 4 12 3-9 2 3h4"></path></svg></span><span><strong>默认显示输入波形</strong><small>只保存归一化电平历史</small></span></span><label class="switch"><input type="checkbox" :checked="snapshot.settings.showLiveLevelHistory" @change="boolSetting('showLiveLevelHistory',$event)"><span></span></label></div>
          </section>
        </section>

        <section v-else-if="activePage === 'docs'" class="page docs-page">
          <header class="page-head simple-head"><div class="page-feature docs-feature"><svg viewBox="0 0 48 48"><path d="M7 11c6-2 11-.8 17 2.8V40c-6-3.6-11-4.8-17-2.8z M41 11c-6-2-11-.8-17 2.8V40c6-3.6 11-4.8 17-2.8z"></path></svg></div><div class="page-title"><h2>文档</h2><span>LocalSub v{{ snapshot.app.productVersion }}</span></div></header>
          <section class="docs-list">
            <div><b>01</b><span><strong>主页</strong><p>状态、自检和实时字幕主开关集中在主页，异常项会直接指出需要处理的 Core、模型或音源。</p></span></div>
            <div><b>02</b><span><strong>实时字幕</strong><p>PotPlayer 模式跟随播放器窗口、最小化状态与重新打开；所有音频模式用于不依赖播放器的系统输出识别。</p></span></div>
            <div><b>03</b><span><strong>后台转写</strong><p>支持多文件队列、整队顺序转写、取消和单项重试。队列与已完成结果会持久化，异常退出后可继续处理。</p></span></div>
            <div><b>04</b><span><strong>字幕与结果</strong><p>结构化结果自动保存到输出目录，完成项可导出 SRT、VTT、TXT，整队可一次生成三种格式。</p></span></div>
            <div><b>05</b><span><strong>本地模型</strong><p>模型支持下载、断点续传、关键文件健康检查、继续修复和删除；实时模型与后台模型分别选择。</p></span></div>
            <div><b>06</b><span><strong>零触感运行</strong><p>可设置开机启动、静默托盘和自动实时字幕。PotPlayer 未打开时保持等待，不静默切换音源。</p></span></div>
            <div><b>07</b><span><strong>运行边界</strong><p>Vue 只显示状态和发送白名单命令。Shell 管理 Windows 原生能力，Core 负责音频、ASR、媒体分析和模型重任务。</p></span></div>
          </section>
        </section>

        <section v-else-if="activePage === 'about'" class="page about-page">
          <article class="about-card">
            <div class="about-logo" aria-hidden="true">
              <svg viewBox="0 0 48 48"><path d="M9 19h7l4-8 8 26 5-13h6"></path></svg>
            </div>
            <h2>LocalSub</h2>
            <p>本地运行的实时字幕与媒体转写工具。</p>
            <dl>
              <div><dt>版本</dt><dd>v{{ snapshot.app.productVersion }}</dd></div>
              <div><dt>运行环境</dt><dd>Windows x64 · .NET 8</dd></div>
              <div><dt>应用架构</dt><dd>LocalSub.exe + LocalSub.Core.exe</dd></div>
              <div><dt>识别核心</dt><dd>{{ coreStateText }} · generation {{ snapshot.core.generation }}</dd></div>
              <div><dt>识别方式</dt><dd>本地离线 ASR</dd></div>
              <div><dt>界面</dt><dd>Vue 3 + WebView2</dd></div>
            </dl>
          </article>
        </section>
      </template>
    </section>

    <Teleport to="body"><div v-if="hoverTip" class="global-tooltip" :class="{above:hoverTip.above}" :style="{left:hoverTip.left+'px',top:hoverTip.top+'px'}">{{ hoverTip.text }}</div></Teleport>
  </main>
</template>
