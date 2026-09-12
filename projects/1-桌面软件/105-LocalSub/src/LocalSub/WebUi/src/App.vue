<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import {
  disposeBridge,
  invoke,
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
const levelHistory = ref<number[]>(Array.from({ length: 300 }, () => 0));
const transcriptHistory = ref<string[]>([]);
const transcriptScroll = ref<HTMLElement | null>(null);
const hoverTip = ref<{ text: string; left: number; top: number; above: boolean } | null>(null);
let activeTipTarget: HTMLElement | null = null;
let selectionInitialized = false;
let unsubscribeSnapshot: (() => void) | null = null;
let saveStateTimer: number | undefined;

const nav: Array<{ key: PageKey; label: string; path: string }> = [
  { key: "home", label: "主页", path: "M4 10.5 12 4l8 6.5v8.2c0 .7-.6 1.3-1.3 1.3h-4.2v-6h-5v6H5.3c-.7 0-1.3-.6-1.3-1.3z" },
  { key: "live", label: "实时字幕", path: "M3.5 12h3l1.7-4.4 3.2 8.8 2.8-6.3 1.7 1.9h4.6" },
  { key: "batch", label: "后台转写", path: "M6 3.5h8l4 4V20H6z M14 3.5V8h4 M9 12h6 M9 15.5h6" },
  { key: "models", label: "模型", path: "M5 7c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7 M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" },
  { key: "settings", label: "设置", path: "M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5z M12 3.5v2 M12 18.5v2 M3.5 12h2 M18.5 12h2 M6 6l1.4 1.4 M16.6 16.6 18 18 M18 6l-1.4 1.4 M7.4 16.6 6 18" },
  { key: "docs", label: "文档", path: "M4.5 5.5c2.5-.7 5-.3 7.5 1.2v12c-2.5-1.5-5-1.9-7.5-1.2z M19.5 5.5c-2.5-.7-5-.3-7.5 1.2v12c2.5-1.5 5-1.9 7.5-1.2z" }
];

const activePage = computed(() => snapshot.value?.app.activePage ?? "home");
const liveState = computed(() => snapshot.value?.live.state ?? "idle");
const liveRunning = computed(() => liveState.value === "running");
const liveTransitioning = computed(() => liveState.value === "starting" || liveState.value === "stopping");
const liveControlsLocked = computed(() => liveRunning.value || liveTransitioning.value || commandBusy.value);
const liveButtonText = computed(() => {
  if (liveState.value === "starting") return "正在启动";
  if (liveState.value === "stopping") return "正在停止";
  if (liveRunning.value) return "停止实时字幕";
  return "开始实时字幕";
});
const liveStateLabel = computed(() => {
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
  if (liveRunning.value) return false;
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
const allReady = computed(() => coreReady.value && liveModelReady.value && inputReady.value);
const homeStateText = computed(() => {
  if (liveRunning.value) return "实时字幕正在运行";
  if (snapshot.value?.system.autoStartPending) return snapshot.value.system.autoStartStatus || "等待自动启动";
  return allReady.value ? "LocalSub 已就绪" : "还有项目需要处理";
});
const homeButtonDisabled = computed(() => {
  if (liveRunning.value) return commandBusy.value || liveTransitioning.value;
  return commandBusy.value || liveTransitioning.value || !liveModelReady.value || !inputReady.value;
});
const sideStatusKind = computed(() => {
  if (liveState.value === "running") return "run";
  if (liveTransitioning.value || snapshot.value?.system.autoStartPending) return "wait";
  if (liveState.value === "failed" || snapshot.value?.core.state === "failed") return "warning";
  if (allReady.value) return "complete";
  return "idle";
});
const sideStatusTitle = computed(() => {
  if (liveState.value === "running") return "实时字幕运行中";
  if (liveState.value === "starting") return "实时字幕启动中";
  if (liveState.value === "stopping") return "实时字幕停止中";
  if (snapshot.value?.system.autoStartPending) return snapshot.value.system.autoStartStatus || "等待自动启动";
  if (liveState.value === "failed" || snapshot.value?.core.state === "failed") return "需要处理";
  return allReady.value ? "LocalSub 已就绪" : "等待配置";
});
const sideStatusSecondary = computed(() => {
  if (liveState.value === "running")
    return snapshot.value?.live.source ?? "实时识别";
  if (snapshot.value?.system.autoStartPending)
    return snapshot.value.system.autoStartStatus || "自动启动";
  if (!liveModelReady.value) return "实时模型未就绪";
  if (!inputReady.value) return "等待音源";
  return "v" + (snapshot.value?.app.productVersion ?? "0.1.7");
});
const sideStatusTip = computed(() => {
  const core = coreReady.value ? "Core 就绪" : "Core 未就绪";
  const model = liveModelReady.value ? "实时模型可用" : "实时模型需要安装";
  const input = inputReady.value ? "音源可用" : "音源等待中";
  return [sideStatusTitle.value, core, model, input].join(" · ");
});

const waveformPoints = computed(() => {
  const values = levelHistory.value;
  const n = Math.max(1, values.length - 1);
  return values.map((value, index) => {
    const x = (index / n) * 100;
    const centered = Math.max(0, Math.min(1, value));
    const y = 21 - centered * 17;
    return x.toFixed(2) + "," + y.toFixed(2);
  }).join(" ");
});
const waveformMirrorPoints = computed(() => {
  const values = levelHistory.value;
  const n = Math.max(1, values.length - 1);
  return values.map((value, index) => {
    const x = (index / n) * 100;
    const centered = Math.max(0, Math.min(1, value));
    const y = 21 + centered * 17;
    return x.toFixed(2) + "," + y.toFixed(2);
  }).join(" ");
});

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
const modelOperationBusy = computed(() => snapshot.value?.models.operation.state === "running");
const modelHeavyBlocked = computed(() => liveState.value !== "idle" || modelOperationBusy.value || commandBusy.value);

function applySnapshot(next: LocalSubSnapshot) {
  const previous = snapshot.value;
  const previousLevel = previous?.live.level ?? 0;
  const startingNewSession = previous?.live.state !== "starting" && next.live.state === "starting";
  const transcriptChanged =
    next.live.currentText !== (previous?.live.currentText ?? "") ||
    next.live.previousText !== (previous?.live.previousText ?? "");

  if (startingNewSession) {
    transcriptHistory.value = [];
    levelHistory.value = Array.from({ length: 300 }, () => 0);
  }

  const finalized = next.live.previousText.trim();
  if (finalized && transcriptHistory.value.at(-1) !== finalized) {
    transcriptHistory.value = [...transcriptHistory.value.slice(-79), finalized];
  }

  snapshot.value = next;

  if (!selectionInitialized || next.live.state === "idle" || next.live.state === "failed") {
    selectedSource.value = next.live.sourceId;
    selectedModelId.value = next.live.modelId || next.live.availableModels[0]?.id || "";
    selectionInitialized = true;
  }

  if (next.settings.showLiveLevelHistory && next.live.state === "running") {
    const value = Number.isFinite(next.live.level) ? next.live.level : previousLevel;
    levelHistory.value = [...levelHistory.value.slice(-299), Math.max(0, Math.min(1, value))];
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
    if (liveRunning.value) {
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
  if (liveRunning.value) {
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
    applySnapshot(await invoke<LocalSubSnapshot>("model.download", { modelId: model.id }));
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
        await invoke<LocalSubSnapshot>("model.delete", { modelId: "__ci_missing_model__" });
      } catch { }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }
});

onBeforeUnmount(() => {
  unsubscribeSnapshot?.();
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
        <div class="brand-copy"><h1>LocalSub</h1><small>本地字幕</small></div>
      </div>

      <nav class="side-nav" aria-label="主导航">
        <button v-for="item in nav.slice(0,4)" :key="item.key" type="button"
          :class="{ active: activePage === item.key }" @click="navigate(item.key)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="item.path"></path></svg>
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <div class="side-spacer"></div>

      <nav class="side-nav side-secondary" aria-label="辅助导航">
        <button v-for="item in nav.slice(4)" :key="item.key" type="button"
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
          <header class="home-toolbar">
            <div class="home-title">
              <span class="compact-feature" :class="{ ready: allReady || liveRunning }">
                <svg viewBox="0 0 24 24">
                  <path v-if="allReady || liveRunning" d="m5.5 12.5 4.2 4.2 8.8-9.4"></path>
                  <path v-else d="M3 12h3l2-6 4 12 3-9 2 3h4"></path>
                </svg>
              </span>
              <div><h2>{{ homeStateText }}</h2><span>LocalSub</span></div>
            </div>
            <button class="home-action-button" type="button" :class="{ stop: liveRunning }"
              :disabled="homeButtonDisabled" @click="toggleHomeLive">
              <svg v-if="!liveRunning" viewBox="0 0 24 24"><path d="M8 5.5 18 12 8 18.5Z"></path></svg>
              <svg v-else viewBox="0 0 24 24"><rect x="7" y="6" width="3.2" height="12" rx="1"></rect><rect x="13.8" y="6" width="3.2" height="12" rx="1"></rect></svg>
              {{ liveRunning ? "停止实时字幕" : "开始实时字幕" }}
            </button>
          </header>

          <section class="home-status-list">
            <div class="home-status-row" :data-tip="coreReady ? 'LocalSub.Core 已可接受识别、媒体分析和模型任务。' : 'Core 会在需要时自动启动；若启动失败会在这里显示异常。'">
              <span class="status-mark" :class="{ ok: coreReady }"><i></i><svg v-if="coreReady" viewBox="0 0 24 24"><path d="m6.5 12.5 3.4 3.4 7.8-8"></path></svg></span>
              <strong>识别核心</strong><span>{{ coreReady ? "Core 已就绪" : "按需启动" }}</span><b :class="{ ok: coreReady }">{{ coreReady ? "正常" : "待命" }}</b>
            </div>
            <div class="home-status-row" :data-tip="'当前实时默认模型：' + snapshot.models.liveModelName">
              <span class="status-mark" :class="{ ok: liveModelReady }"><i></i><svg v-if="liveModelReady" viewBox="0 0 24 24"><path d="m6.5 12.5 3.4 3.4 7.8-8"></path></svg></span>
              <strong>实时模型</strong><span>{{ snapshot.models.liveModelName }}</span><b :class="{ ok: liveModelReady }">{{ liveModelReady ? "可用" : "需安装" }}</b>
            </div>
            <div class="home-status-row" :data-tip="snapshot.settings.audioSourceId === 'potplayer' ? 'PotPlayer 模式使用进程专用音频捕获，不会静默回退到所有音频。' : '所有音频模式监听系统输出混音。'">
              <span class="status-mark" :class="{ ok: inputReady }"><i></i><svg v-if="inputReady" viewBox="0 0 24 24"><path d="m6.5 12.5 3.4 3.4 7.8-8"></path></svg></span>
              <strong>音源</strong><span>{{ snapshot.settings.audioSource }}</span><b :class="{ ok: inputReady }">{{ inputReady ? "正常" : "等待" }}</b>
            </div>
            <div class="home-status-row" data-tip="Overlay 由 Windows Shell 管理，实时字幕运行时自动显示并跟随播放器窗口。">
              <span class="status-mark ok"><i></i><svg viewBox="0 0 24 24"><path d="m6.5 12.5 3.4 3.4 7.8-8"></path></svg></span>
              <strong>字幕 Overlay</strong><span>{{ liveRunning ? "正在显示" : "随实时字幕启动" }}</span><b class="ok">{{ liveRunning ? "运行" : "就绪" }}</b>
            </div>
            <div class="home-status-row" :data-tip="'当前后台默认模型：' + snapshot.models.batchModelName">
              <span class="status-mark" :class="{ ok: batchModelReady }"><i></i><svg v-if="batchModelReady" viewBox="0 0 24 24"><path d="m6.5 12.5 3.4 3.4 7.8-8"></path></svg></span>
              <strong>后台模型</strong><span>{{ snapshot.models.batchModelName }}</span><b :class="{ ok: batchModelReady }">{{ batchModelReady ? "可用" : "需安装" }}</b>
            </div>
          </section>

          <footer class="home-startup-row" data-tip="可在设置中组合开机启动、静默进入托盘和启动后自动开启实时字幕。">
            <span class="startup-row-icon"><svg viewBox="0 0 24 24"><path d="M12 3v8 M8.5 5.5A8 8 0 1 0 15.5 5.5"></path></svg></span>
            <strong>启动方式</strong>
            <span>{{ snapshot.settings.startWithWindows ? "开机启动" : "手动启动" }}{{ snapshot.settings.silentStartup ? " · 静默托盘" : "" }}{{ snapshot.settings.autoStartLive ? " · 自动实时" : "" }}</span>
            <button type="button" @click="navigate('settings')">调整</button>
          </footer>
        </section>

        <section v-else-if="activePage === 'live'" class="page live-page">
          <header class="live-topbar">
            <div class="live-title">
              <span class="compact-feature live"><svg viewBox="0 0 24 24"><path d="M3 12h3l2-6 4 12 3-9 2 3h4"></path></svg></span>
              <h2>实时字幕</h2>
              <span class="info-dot" data-tip="实时音频、VAD、Process Loopback 与 ASR 运行在 LocalSub.Core；Overlay 和 PotPlayer 窗口跟随由 Shell 管理。">i</span>
            </div>
            <div class="instant-level" data-tip="当前输入电平，来自 Core 限频后的归一化音频幅度。">
              <span>输入</span><div><i :style="{ width: Math.max(2, snapshot.live.level * 100) + '%' }"></i></div><b>{{ Math.round(snapshot.live.level * 100) }}%</b>
            </div>
            <div class="live-head-actions">
              <label class="header-monitor" data-tip="显示或隐藏最近约 30 秒的输入电平历史。">
                <svg viewBox="0 0 24 24"><path d="M3 12h3l2-6 4 12 3-9 2 3h4"></path></svg>
                <span class="switch small-switch"><input type="checkbox" :checked="snapshot.settings.showLiveLevelHistory" @change="boolSetting('showLiveLevelHistory',$event)"><span></span></span>
              </label>
              <span class="live-state" :class="'state-' + liveState"><i></i>{{ liveStateLabel }}</span>
            </div>
          </header>

          <section class="option-list live-options">
            <label class="option-row">
              <span class="option-name"><span class="row-icon audio"><svg viewBox="0 0 24 24"><path d="M5 9h4l4-4v14l-4-4H5z M16 9.5a4 4 0 0 1 0 5 M18.5 7a7.5 7.5 0 0 1 0 10"></path></svg></span><strong>音源</strong></span>
              <select v-model="selectedSource" :disabled="liveControlsLocked"><option value="potplayer">PotPlayer</option><option value="allAudio">所有音频</option></select>
            </label>
            <label class="option-row">
              <span class="option-name"><span class="row-icon model"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="6.5" rx="7" ry="3"></ellipse><path d="M5 6.5V12c0 1.7 3.1 3 7 3s7-1.3 7-3V6.5 M5 12v5.5c0 1.7 3.1 3 7 3s7-1.3 7-3V12"></path></svg></span><strong>识别模型</strong></span>
              <select v-model="selectedModelId" :disabled="liveControlsLocked || snapshot.live.availableModels.length === 0"><option v-for="model in snapshot.live.availableModels" :key="model.id" :value="model.id">{{ model.name }}</option><option v-if="snapshot.live.availableModels.length === 0" value="">未安装实时模型</option></select>
            </label>
          </section>

          <section v-if="snapshot.settings.showLiveLevelHistory" class="waveform-section">
            <div class="wave-head"><strong>输入电平历史</strong><span>最近约 30 秒</span></div>
            <svg class="level-wave" viewBox="0 0 100 42" preserveAspectRatio="none" aria-label="最近约 30 秒输入电平历史">
              <line x1="0" y1="21" x2="100" y2="21"></line>
              <polyline :points="waveformPoints"></polyline>
              <polyline class="mirror" :points="waveformMirrorPoints"></polyline>
            </svg>
            <div class="wave-axis"><span>30 s</span><span>15 s</span><span>现在</span></div>
          </section>

          <section class="transcript-section">
            <div class="transcript-head"><strong>字幕</strong><span>{{ snapshot.live.status }}</span></div>
            <div ref="transcriptScroll" class="transcript-scroll">
              <p v-for="(line,index) in transcriptHistory" :key="index">{{ line }}</p>
              <p v-if="snapshot.live.currentText" class="current">{{ snapshot.live.currentText }}</p>
              <p v-else-if="transcriptHistory.length === 0" class="empty">实时识别结果会显示在这里。</p>
            </div>
          </section>

          <footer class="live-actions">
            <button class="primary-button large" :class="{ stop: liveRunning }" type="button" :disabled="liveButtonDisabled" @click="toggleLive">
              <svg v-if="!liveRunning" viewBox="0 0 24 24"><path d="M8 5.5 18 12 8 18.5Z"></path></svg>
              <svg v-else viewBox="0 0 24 24"><rect x="7" y="6" width="3.2" height="12" rx="1"></rect><rect x="13.8" y="6" width="3.2" height="12" rx="1"></rect></svg>
              {{ liveButtonText }}
            </button>
            <div class="status-strip"><span><i class="status-dot" :class="{ ok: coreReady }"></i>Core</span><span><i class="status-dot overlay" :class="{ ok: liveRunning }"></i>Overlay</span></div>
          </footer>
        </section>

        <section v-else-if="activePage === 'batch'" class="page batch-page">
          <header class="page-head simple-head">
            <div class="page-feature batch-feature"><svg viewBox="0 0 48 48"><path d="M12 7h16l8 8v26H12z M28 7v9h8 M18 24h12 M18 30h12"></path></svg></div>
            <div class="page-title"><div class="title-line"><h2>后台转写</h2><span class="info-dot" data-tip="媒体分析、波形、VAD 和离线 ASR 已在 LocalSub.Core 中。Web 工作区继续复用同一 Core 链。">i</span></div><span>{{ snapshot.batch.status }}</span></div>
          </header>
          <section class="batch-surface" data-tip="完整后台工作区正在迁移到 Web。当前绿色版本仍可通过 --legacy-ui 使用旧后台工作区。">
            <span class="drop-feature"><svg viewBox="0 0 48 48"><path d="M24 11v26 M11 24h26"></path></svg></span>
            <strong>拖入视频或音频</strong>
            <span>0 个任务</span>
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
                    <td><span class="install-state" :class="{installed:model.installed}">{{ model.installed ? "已安装" : "未安装" }}</span></td>
                    <td class="table-actions">
                      <button type="button" :disabled="modelHeavyBlocked" @click="downloadModel(model)">{{ model.installed ? "修复" : "下载" }}</button>
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

        <section v-else class="page docs-page">
          <header class="page-head simple-head"><div class="page-feature docs-feature"><svg viewBox="0 0 48 48"><path d="M7 11c6-2 11-.8 17 2.8V40c-6-3.6-11-4.8-17-2.8z M41 11c-6-2-11-.8-17 2.8V40c6-3.6 11-4.8 17-2.8z"></path></svg></div><div class="page-title"><h2>文档</h2><span>LocalSub v{{ snapshot.app.productVersion }}</span></div></header>
          <section class="docs-list">
            <div><b>01</b><span><strong>主页</strong><p>状态、自检和实时字幕主开关都集中在主页。</p></span></div>
            <div><b>02</b><span><strong>零触感运行</strong><p>可设置开机启动、静默托盘和自动实时字幕。PotPlayer 未打开时保持等待，不静默切换音源。</p></span></div>
            <div><b>03</b><span><strong>运行边界</strong><p>Vue 只显示状态和发送白名单命令。Shell 管理 Windows 原生能力，Core 负责音频、ASR、媒体分析和模型重任务。</p></span></div>
          </section>
        </section>
      </template>
    </section>

    <Teleport to="body"><div v-if="hoverTip" class="global-tooltip" :class="{above:hoverTip.above}" :style="{left:hoverTip.left+'px',top:hoverTip.top+'px'}">{{ hoverTip.text }}</div></Teleport>
  </main>
</template>
