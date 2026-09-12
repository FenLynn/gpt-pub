<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  disposeBridge,
  invoke,
  subscribeSnapshot,
  type LocalSubSnapshot,
  type PageKey
} from "./bridge";

const snapshot = ref<LocalSubSnapshot | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const commandBusy = ref(false);
const selectedSource = ref<"potplayer" | "allAudio">("potplayer");
const selectedModelId = ref("");
const modelFilter = ref<"all" | "installed" | "live" | "batch">("all");
const selectedCatalogModelId = ref("");
const deleteConfirmId = ref("");
const hoverTip = ref<{ text: string; left: number; top: number; above: boolean } | null>(null);
let activeTipTarget: HTMLElement | null = null;
let selectionInitialized = false;
let unsubscribeSnapshot: (() => void) | null = null;

const nav: Array<{ key: PageKey; label: string; path: string }> = [
  { key: "live", label: "实时字幕", path: "M3.5 12h3l1.7-4.4 3.2 8.8 2.8-6.3 1.7 1.9h4.6" },
  { key: "batch", label: "后台转写", path: "M6 3.5h8l4 4V20H6z M14 3.5V8h4 M9 12h6 M9 15.5h6" },
  { key: "models", label: "模型", path: "M5 7c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7 M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" },
  { key: "settings", label: "设置", path: "M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5z M12 3.5v2 M12 18.5v2 M3.5 12h2 M18.5 12h2 M6 6l1.4 1.4 M16.6 16.6 18 18 M18 6l-1.4 1.4 M7.4 16.6 6 18" },
  { key: "docs", label: "文档", path: "M4.5 5.5c2.5-.7 5-.3 7.5 1.2v12c-2.5-1.5-5-1.9-7.5-1.2z M19.5 5.5c-2.5-.7-5-.3-7.5 1.2v12c2.5-1.5 5-1.9 7.5-1.2z" }
];

const activePage = computed(() => snapshot.value?.app.activePage ?? "live");
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
const liveButtonDisabled = computed(() => {
  if (liveTransitioning.value || commandBusy.value) return true;
  if (liveRunning.value) return false;
  return !snapshot.value?.live.canStart || !selectedModelId.value;
});
const liveStateLabel = computed(() => {
  switch (liveState.value) {
    case "starting": return "启动中";
    case "running": return "识别中";
    case "stopping": return "停止中";
    case "failed": return "失败";
    default: return "等待开始";
  }
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
const selectedCatalogModel = computed(() =>
  snapshot.value?.models.catalog.find(x => x.id === selectedCatalogModelId.value) ?? null
);
const modelOperation = computed(() => snapshot.value?.models.operation ?? null);
const modelOperationBusy = computed(() => modelOperation.value?.state === "running");
const modelHeavyBlocked = computed(() =>
  liveState.value !== "idle" || modelOperationBusy.value || commandBusy.value
);

function applySnapshot(next: LocalSubSnapshot) {
  snapshot.value = next;

  if (!selectionInitialized || next.live.state !== "idle") {
    selectedSource.value = next.live.sourceId;
    selectedModelId.value = next.live.modelId || next.live.availableModels[0]?.id || "";
    selectionInitialized = true;
  }

  if (!next.models.catalog.some(x => x.id === selectedCatalogModelId.value)) {
    selectedCatalogModelId.value =
      next.models.catalog.find(x => x.liveSelected)?.id ??
      next.models.catalog.find(x => x.batchSelected)?.id ??
      next.models.catalog.find(x => x.installed && x.recommended && !x.isComponent)?.id ??
      next.models.catalog[0]?.id ??
      "";
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

function selectCatalogModel(modelId: string) {
  selectedCatalogModelId.value = modelId;
  deleteConfirmId.value = "";
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

async function setDefaultModel(target: "live" | "batch") {
  const model = selectedCatalogModel.value;
  if (!model) return;

  commandBusy.value = true;
  error.value = null;
  try {
    applySnapshot(await invoke<LocalSubSnapshot>("model.select", {
      target,
      modelId: model.id
    }));
    if (target === "live") selectedModelId.value = model.id;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    commandBusy.value = false;
  }
}

async function downloadSelectedModel() {
  const model = selectedCatalogModel.value;
  if (!model || modelHeavyBlocked.value) return;

  error.value = null;
  deleteConfirmId.value = "";
  try {
    applySnapshot(await invoke<LocalSubSnapshot>("model.download", { modelId: model.id }));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    try { await refreshModels(); } catch { }
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

async function deleteSelectedModel() {
  const model = selectedCatalogModel.value;
  if (!model || !model.installed || modelHeavyBlocked.value) return;

  if (deleteConfirmId.value !== model.id) {
    deleteConfirmId.value = model.id;
    return;
  }

  deleteConfirmId.value = "";
  error.value = null;
  try {
    applySnapshot(await invoke<LocalSubSnapshot>("model.delete", { modelId: model.id }));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    try { await refreshModels(); } catch { }
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
  const left = Math.min(
    Math.max(rect.left + rect.width / 2, half),
    Math.max(half, window.innerWidth - half)
  );
  hoverTip.value = {
    text: value,
    left,
    top: above ? rect.top - 10 : rect.bottom + 10,
    above
  };
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
      try {
        await invoke<LocalSubSnapshot>("live.start", {
          source: "allAudio",
          modelId: "__ci_missing_model__"
        });
      } catch {
        // Expected: CI intentionally uses a missing model to exercise the
        // real WebView2 -> Shell live.start failure path without downloading models.
      }
      applySnapshot(await invoke<LocalSubSnapshot>("model.list"));
      try {
        await invoke<LocalSubSnapshot>("model.select", {
          target: "live",
          modelId: "__ci_missing_model__"
        });
      } catch {
        // Expected: model selection must reject unknown catalog entries cleanly.
      }
      applySnapshot(await invoke<LocalSubSnapshot>("model.cancel"));
      try {
        await invoke<LocalSubSnapshot>("model.download", { modelId: "__ci_missing_model__" });
      } catch {
        // Expected: CI validates the WebView2 -> Shell download command without network traffic.
      }
      try {
        await invoke<LocalSubSnapshot>("model.delete", { modelId: "__ci_missing_model__" });
      } catch {
        // Expected: CI validates the WebView2 -> Shell delete command without touching local models.
      }
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
  disposeBridge();
});
</script>

<template>
  <main class="app-shell">
    <aside class="sidebar">
      <div class="side-brand">
        <div class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 48 48">
            <path d="M9 19h7l4-8 8 26 5-13h6"></path>
          </svg>
        </div>
        <div class="brand-copy">
          <h1>LocalSub</h1>
          <small>本地字幕</small>
        </div>
      </div>

      <nav class="side-nav" aria-label="主导航">
        <button
          v-for="item in nav.slice(0, 3)"
          :key="item.key"
          type="button"
          :class="{ active: activePage === item.key }"
          @click="navigate(item.key)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="item.path"></path></svg>
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <div class="side-spacer"></div>

      <nav class="side-nav side-secondary" aria-label="辅助导航">
        <button
          v-for="item in nav.slice(3)"
          :key="item.key"
          type="button"
          :class="{ active: activePage === item.key }"
          @click="navigate(item.key)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="item.path"></path></svg>
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <div
        class="side-status"
        :data-tip="snapshot?.core.pid
          ? 'LocalSub.Core 进程 ' + snapshot.core.pid + '，generation ' + snapshot.core.generation
          : 'LocalSub.Core 会在需要识别、分析或模型重任务时启动。'"
      >
        <span class="side-status-icon" :class="snapshot?.core.state ?? 'starting'" aria-hidden="true">
          <svg v-if="snapshot?.core.state === 'ready'" viewBox="0 0 24 24"><path d="m6.5 12.5 3.4 3.4 7.8-8"></path></svg>
          <svg v-else-if="snapshot?.core.state === 'failed'" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><path d="M12 7.5v6M12 17v.1"></path></svg>
          <svg v-else viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"></circle><path d="M12 7.5V12l3 2"></path></svg>
        </span>
        <div>
          <strong>{{ snapshot?.core.state === "ready" ? "Core 就绪" : snapshot?.core.state === "failed" ? "Core 异常" : "Core 待命" }}</strong>
          <small>v{{ snapshot?.app.productVersion ?? "0.1.5" }}</small>
        </div>
      </div>
    </aside>

    <section class="workspace">
      <section v-if="error" class="notice error">
        <span class="notice-icon">!</span>
        <div><b>操作失败</b><span>{{ error }}</span></div>
      </section>

      <section v-if="loading" class="loading-card">正在连接 LocalSub Shell…</section>

      <template v-else-if="snapshot">
        <section v-if="activePage === 'live'" class="page live-page">
          <header class="page-head">
            <div class="page-feature live-feature" aria-hidden="true">
              <svg viewBox="0 0 48 48"><path d="M7 25h7l4-11 8 23 6-17 4 5h5"></path></svg>
            </div>
            <div class="page-title">
              <div class="title-line">
                <h2>实时字幕</h2>
                <span
                  class="info-dot"
                  data-tip="实时音频、VAD、Process Loopback 与模型推理运行在 LocalSub.Core。PotPlayer 窗口跟随与字幕 Overlay 由 Windows Shell 管理。"
                >i</span>
              </div>
              <span>PotPlayer 与系统音频</span>
            </div>
            <span class="state-pill" :class="'state-' + snapshot.live.state">
              <i></i>{{ liveStateLabel }}
            </span>
          </header>

          <article class="main-card live-card">
            <div class="control-row">
              <label class="control-field source-field">
                <span class="field-label">
                  <svg viewBox="0 0 24 24"><path d="M5 9h4l4-4v14l-4-4H5z M16 9.5a4 4 0 0 1 0 5 M18.5 7a7.5 7.5 0 0 1 0 10"></path></svg>
                  音源
                </span>
                <select v-model="selectedSource" :disabled="liveControlsLocked">
                  <option value="potplayer">PotPlayer</option>
                  <option value="allAudio">所有音频</option>
                </select>
              </label>

              <label class="control-field grow">
                <span class="field-label">
                  <svg viewBox="0 0 24 24"><path d="M5 7c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7 M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"></path></svg>
                  识别模型
                </span>
                <select v-model="selectedModelId" :disabled="liveControlsLocked || snapshot.live.availableModels.length === 0">
                  <option v-for="model in snapshot.live.availableModels" :key="model.id" :value="model.id">
                    {{ model.name }}
                  </option>
                  <option v-if="snapshot.live.availableModels.length === 0" value="">未安装实时模型</option>
                </select>
              </label>
            </div>

            <section class="level-panel">
              <div class="level-copy">
                <span class="level-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M4 13h2l2-6 4 12 3-9 2 3h3"></path></svg>
                </span>
                <div>
                  <strong>输入电平</strong>
                  <span
                    class="info-dot small"
                    :data-tip="snapshot.live.status || '输入音频电平由 Core 实时更新。'"
                  >i</span>
                </div>
              </div>
              <div class="level-meter">
                <div class="level-track"><i :style="{ width: Math.max(2, snapshot.live.level * 100) + '%' }"></i></div>
                <b>{{ Math.round(snapshot.live.level * 100) }}%</b>
              </div>
            </section>

            <section v-if="snapshot.live.currentText || snapshot.live.previousText" class="transcript-preview">
              <span v-if="snapshot.live.previousText">{{ snapshot.live.previousText }}</span>
              <strong>{{ snapshot.live.currentText }}</strong>
            </section>

            <div v-if="snapshot.live.lastError" class="inline-error">{{ snapshot.live.lastError }}</div>

            <footer class="live-footer">
              <button
                class="primary-button"
                :class="{ stop: liveRunning }"
                type="button"
                :disabled="liveButtonDisabled"
                @click="toggleLive"
              >
                <svg v-if="!liveRunning" viewBox="0 0 24 24"><path d="M8 5.5 18 12 8 18.5Z"></path></svg>
                <svg v-else viewBox="0 0 24 24"><rect x="7" y="6" width="3.2" height="12" rx="1"></rect><rect x="13.8" y="6" width="3.2" height="12" rx="1"></rect></svg>
                {{ liveButtonText }}
              </button>

              <div class="status-strip">
                <span :data-tip="snapshot.core.state === 'ready' ? 'LocalSub.Core 已连接并可接受任务。' : 'Core 尚未就绪，启动任务时会尝试恢复。'">
                  <i class="status-dot" :class="{ ok: snapshot.core.state === 'ready' }"></i>
                  Core
                </span>
                <span data-tip="Overlay 由 Windows Shell 管理，可跟随 PotPlayer 窗口。">
                  <i class="status-dot overlay" :class="{ ok: liveRunning }"></i>
                  Overlay
                </span>
              </div>
            </footer>
          </article>
        </section>

        <section v-else-if="activePage === 'batch'" class="page batch-page">
          <header class="page-head">
            <div class="page-feature batch-feature" aria-hidden="true">
              <svg viewBox="0 0 48 48"><path d="M12 7h16l8 8v26H12z M28 7v9h8 M18 24h12 M18 30h12"></path></svg>
            </div>
            <div class="page-title">
              <div class="title-line">
                <h2>后台转写</h2>
                <span class="info-dot" data-tip="媒体分析、波形、VAD 与离线 ASR 由 LocalSub.Core 执行。Web 工作区将在后续迁移中接入现有 analyze / transcribe / cancel。">i</span>
              </div>
              <span>视频与音频文件</span>
            </div>
            <span class="state-pill neutral">{{ snapshot.batch.queued }} 个任务</span>
          </header>

          <article class="main-card batch-card">
            <div class="drop-zone" data-tip="当前 Web 版后台工作区仍在迁移，完整后台转写暂时可通过 --legacy-ui 使用旧 WinForms 备用界面。">
              <span class="drop-feature" aria-hidden="true">
                <svg viewBox="0 0 48 48"><path d="M24 11v26 M11 24h26"></path></svg>
              </span>
              <strong>拖入视频或音频</strong>
              <span class="hover-hint">悬浮查看说明</span>
            </div>
            <div class="status-line">
              <span>当前状态</span>
              <strong>{{ snapshot.batch.status }}</strong>
            </div>
          </article>
        </section>

        <section v-else-if="activePage === 'models'" class="page models-page">
          <header class="page-head">
            <div class="page-feature model-feature" aria-hidden="true">
              <svg viewBox="0 0 48 48"><ellipse cx="24" cy="13" rx="14" ry="6"></ellipse><path d="M10 13v11c0 3.3 6.3 6 14 6s14-2.7 14-6V13 M10 24v11c0 3.3 6.3 6 14 6s14-2.7 14-6V24"></path></svg>
            </div>
            <div class="page-title">
              <div class="title-line">
                <h2>本地模型</h2>
                <span class="info-dot" data-tip="默认选择由 Shell 保存。下载、断点续传、解压、校验、修复和删除都通过 LocalSub.Core 执行。">i</span>
              </div>
              <span>{{ snapshot.models.installedCount }} / {{ snapshot.models.catalogCount }} 已安装</span>
            </div>
            <button class="secondary-button icon-action" type="button" :disabled="commandBusy" @click="refreshModels">
              <svg viewBox="0 0 24 24"><path d="M19 7v5h-5 M18.2 12A6.7 6.7 0 1 1 16 6.7L19 9"></path></svg>
              重新扫描
            </button>
          </header>

          <article class="main-card model-card">
            <div class="summary-strip">
              <span><b>{{ snapshot.models.installedCount }}</b> 已安装</span>
              <span><b>{{ snapshot.models.catalog.filter(x => x.liveCapable && x.installed).length }}</b> 实时</span>
              <span><b>{{ snapshot.models.catalog.filter(x => x.batchCapable && x.installed).length }}</b> 后台</span>
              <span class="summary-status">{{ snapshot.models.status }}</span>
            </div>

            <div class="model-filter-bar">
              <button
                v-for="item in modelFilters"
                :key="item.key"
                type="button"
                :class="{ active: modelFilter === item.key }"
                @click="modelFilter = item.key"
              >{{ item.label }}</button>
            </div>

            <div class="model-list">
              <button
                v-for="model in filteredCatalogModels"
                :key="model.id"
                class="model-row"
                :class="{
                  selected: selectedCatalogModelId === model.id,
                  unavailable: !model.installed,
                  working: snapshot.models.operation.modelId === model.id && modelOperationBusy
                }"
                type="button"
                @click="selectCatalogModel(model.id)"
              >
                <span class="model-row-icon" :class="{ installed: model.installed }" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><ellipse cx="12" cy="6.5" rx="7" ry="3"></ellipse><path d="M5 6.5V12c0 1.7 3.1 3 7 3s7-1.3 7-3V6.5 M5 12v5.5c0 1.7 3.1 3 7 3s7-1.3 7-3V12"></path></svg>
                </span>
                <span class="model-main">
                  <span class="model-name">
                    <b>{{ model.name }}</b>
                    <i v-if="model.recommended" class="model-badge recommended">推荐</i>
                    <i class="model-badge" :class="{ installed: model.installed }">{{ model.installed ? "已安装" : "未安装" }}</i>
                    <span class="info-dot small" :data-tip="model.purpose">i</span>
                  </span>
                  <span class="model-meta">
                    <i>{{ model.languages }}</i>
                    <i>{{ model.sizeText }}</i>
                    <i v-if="model.isComponent">组件</i>
                    <i v-else-if="model.liveCapable && model.batchCapable">实时 / 后台</i>
                    <i v-else-if="model.liveCapable">实时</i>
                    <i v-else-if="model.batchCapable">后台</i>
                  </span>
                </span>
                <span class="score-group">
                  <span data-tip="实时识别适配度">实时 <b>{{ model.realtimeScore || "·" }}</b></span>
                  <span data-tip="识别准确度">准确 <b>{{ model.accuracyScore || "·" }}</b></span>
                  <span data-tip="综合性价比">性价比 <b>{{ model.valueScore || "·" }}</b></span>
                </span>
              </button>

              <div v-if="filteredCatalogModels.length === 0" class="model-empty">当前筛选条件下没有模型。</div>
            </div>

            <section v-if="selectedCatalogModel" class="model-detail">
              <header class="detail-head">
                <div>
                  <div class="detail-title">
                    <span class="model-state-dot" :class="{ installed: selectedCatalogModel.installed }"></span>
                    <strong>{{ selectedCatalogModel.name }}</strong>
                    <span class="info-dot small" :data-tip="selectedCatalogModel.purpose">i</span>
                  </div>
                  <div class="default-line">
                    <span>实时默认 <b>{{ snapshot.models.liveModelName }}</b></span>
                    <span>后台默认 <b>{{ snapshot.models.batchModelName }}</b></span>
                  </div>
                </div>
                <span class="state-pill neutral">{{ selectedCatalogModel.installed ? "已安装" : "未安装" }}</span>
              </header>

              <div class="model-actions">
                <button class="secondary-button" type="button"
                  :disabled="commandBusy || modelOperationBusy || !selectedCatalogModel.installed || !selectedCatalogModel.liveCapable || selectedCatalogModel.liveSelected"
                  @click="setDefaultModel('live')">
                  {{ selectedCatalogModel.liveSelected ? "实时默认" : "设为实时默认" }}
                </button>
                <button class="secondary-button" type="button"
                  :disabled="commandBusy || modelOperationBusy || !selectedCatalogModel.installed || !selectedCatalogModel.batchCapable || selectedCatalogModel.batchSelected"
                  @click="setDefaultModel('batch')">
                  {{ selectedCatalogModel.batchSelected ? "后台默认" : "设为后台默认" }}
                </button>
                <button class="primary-button compact" type="button" :disabled="modelHeavyBlocked" @click="downloadSelectedModel">
                  <svg viewBox="0 0 24 24"><path d="M12 4v11 M7.5 10.5 12 15l4.5-4.5 M5 19h14"></path></svg>
                  {{ selectedCatalogModel.installed ? "下载 / 修复" : "下载模型" }}
                </button>
                <button class="danger-text" :class="{ armed: deleteConfirmId === selectedCatalogModel.id }" type="button"
                  :disabled="modelHeavyBlocked || !selectedCatalogModel.installed" @click="deleteSelectedModel">
                  {{ deleteConfirmId === selectedCatalogModel.id ? "确认删除" : "删除" }}
                </button>
              </div>

              <p v-if="deleteConfirmId === selectedCatalogModel.id" class="delete-warning">再次点击“确认删除”将清理模型目录、缓存和未完成下载。</p>
              <p v-if="liveState !== 'idle'" class="model-block-note">请先停止实时字幕，再执行模型下载、修复或删除。</p>

              <div class="operation-line">
                <span class="operation-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 1 0 2-5 M5 5v5h5"></path></svg>
                </span>
                <div class="operation-copy">
                  <span>Core 模型任务</span>
                  <strong>{{ modelOperationBusy ? snapshot.models.operation.modelName + " · " + snapshot.models.operation.stage : snapshot.models.operation.stage }}</strong>
                  <span class="info-dot small" :data-tip="snapshot.models.operation.lastError || snapshot.models.operation.detail">i</span>
                </div>
                <div v-if="modelOperationBusy" class="operation-progress">
                  <div class="level-track"><i :class="{ indeterminate: snapshot.models.operation.isIndeterminate }" :style="{ width: (snapshot.models.operation.percent ?? 36) + '%' }"></i></div>
                  <b v-if="snapshot.models.operation.percent !== null">{{ snapshot.models.operation.percent }}%</b>
                </div>
                <button v-if="snapshot.models.operation.canCancel" class="secondary-button" type="button" @click="cancelModelOperation">取消</button>
              </div>
            </section>
          </article>
        </section>

        <section v-else-if="activePage === 'settings'" class="page settings-page">
          <header class="page-head">
            <div class="page-feature settings-feature" aria-hidden="true">
              <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="7"></circle><path d="M24 7v5 M24 36v5 M7 24h5 M36 24h5 M12 12l4 4 M32 32l4 4 M36 12l-4 4 M16 32l-4 4"></path><circle cx="24" cy="24" r="14"></circle></svg>
            </div>
            <div class="page-title">
              <div class="title-line">
                <h2>设置</h2>
                <span class="info-dot" data-tip="当前 Web 设置页先展示关键运行偏好，编辑能力将在后续迁移中接入同一 AppSettings。">i</span>
              </div>
              <span>运行与字幕偏好</span>
            </div>
          </header>

          <article class="main-card settings-list">
            <div class="setting-row" data-tip="PotPlayer 模式使用进程专用 Process Loopback，不静默回退到系统音频。">
              <span class="setting-icon">
                <svg viewBox="0 0 24 24"><path d="M5 9h4l4-4v14l-4-4H5z M16 9.5a4 4 0 0 1 0 5 M18.5 7a7.5 7.5 0 0 1 0 10"></path></svg>
              </span>
              <strong>默认音源</strong>
              <b>{{ snapshot.settings.audioSource }}</b>
              <span class="row-chevron">›</span>
            </div>
            <div class="setting-row" data-tip="资源策略由 C# Shell 与 Core 统一决定，Web UI 不直接管理识别线程。">
              <span class="setting-icon compute">
                <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"></rect><path d="M9 2.8v3.2 M15 2.8v3.2 M9 18v3.2 M15 18v3.2 M2.8 9H6 M18 9h3.2 M2.8 15H6 M18 15h3.2"></path></svg>
              </span>
              <strong>资源策略</strong>
              <b>{{ snapshot.settings.resourceProfile }}</b>
              <span class="row-chevron">›</span>
            </div>
            <div class="setting-row" data-tip="字幕 Overlay 的大小、样式与窗口行为由 Windows Shell 负责。">
              <span class="setting-icon subtitle">
                <svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2"></rect><path d="M7 11h4 M13 11h4 M7 15h7"></path></svg>
              </span>
              <strong>字幕字号</strong>
              <b>{{ snapshot.settings.subtitleAutoSize ? "自动" : snapshot.settings.subtitleFontSize + " px" }}</b>
              <span class="row-chevron">›</span>
            </div>
          </article>
        </section>

        <section v-else class="page docs-page">
          <header class="page-head">
            <div class="page-feature docs-feature" aria-hidden="true">
              <svg viewBox="0 0 48 48"><path d="M7 11c6-2 11-.8 17 2.8V40c-6-3.6-11-4.8-17-2.8z M41 11c-6-2-11-.8-17 2.8V40c6-3.6 11-4.8 17-2.8z"></path></svg>
            </div>
            <div class="page-title">
              <div class="title-line"><h2>文档</h2></div>
              <span>LocalSub v{{ snapshot.app.productVersion }}</span>
            </div>
          </header>

          <article class="main-card docs-list">
            <section class="doc-row">
              <span class="doc-number">01</span>
              <div><h3>快速使用</h3><p>实时字幕中选择音源和已安装模型后启动。后台转写 Web 工作区仍在迁移。</p></div>
            </section>
            <section class="doc-row">
              <span class="doc-number">02</span>
              <div><h3>运行边界</h3><p>Vue 只发送白名单意图。Shell 管理 Windows 原生能力，Core 负责音频、ASR、媒体分析和模型重任务。</p></div>
            </section>
            <section class="doc-row">
              <span class="doc-number">03</span>
              <div><h3>备用界面</h3><p>Web UI 为默认入口。迁移期间可使用 <code>LocalSub.exe --legacy-ui</code> 打开旧 WinForms。</p></div>
            </section>
          </article>
        </section>
      </template>
    </section>

    <Teleport to="body">
      <div
        v-if="hoverTip"
        class="global-tooltip"
        :class="{ above: hoverTip.above }"
        :style="{ left: hoverTip.left + 'px', top: hoverTip.top + 'px' }"
      >{{ hoverTip.text }}</div>
    </Teleport>
  </main>
</template>
