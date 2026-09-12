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

onMounted(async () => {
  unsubscribeSnapshot = subscribeSnapshot(applySnapshot);
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
  disposeBridge();
});
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="top-chrome">
        <div class="brand" aria-label="LocalSub">
          <div class="brand-mark" aria-hidden="true"><span></span><span></span></div>
          <strong>LocalSub</strong>
        </div>

        <nav class="top-tabs" aria-label="主导航">
          <button
            v-for="item in nav"
            :key="item.key"
            class="top-tab"
            :class="{ active: activePage === item.key }"
            type="button"
            @click="navigate(item.key)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path :d="item.path"></path>
            </svg>
            <span>{{ item.label }}</span>
          </button>
        </nav>

        <div class="top-actions">
          <span
            class="core-status"
            :data-tip="snapshot?.core.pid ? 'LocalSub.Core 进程 ' + snapshot.core.pid + '，generation ' + snapshot.core.generation : 'LocalSub.Core 尚未启动'"
          >
            <i class="core-dot" :class="snapshot?.core.state ?? 'starting'"></i>
            <span>{{ snapshot?.core.state === "ready" ? "Core" : "Core 状态" }}</span>
          </span>
          <span class="version">v{{ snapshot?.app.productVersion ?? "0.1.4" }}</span>
          <button class="icon-button" type="button" title="刷新状态" aria-label="刷新状态" @click="refresh">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 7v5h-5 M18.2 12A6.7 6.7 0 1 1 16 6.7L19 9"></path></svg>
          </button>
        </div>
      </div>
    </header>

    <main class="workspace">
      <div class="workspace-inner">
        <section v-if="error" class="notice error">
          <b>操作失败</b>
          <span>{{ error }}</span>
        </section>

        <section v-if="loading" class="loading-card">正在连接 LocalSub Shell…</section>

        <template v-else-if="snapshot">
          <section v-if="activePage === 'live'" class="page live-page">
            <header class="page-heading">
              <div>
                <span class="eyebrow">实时字幕</span>
                <h1>让正在播放的声音直接变成字幕</h1>
                <p>选择音源和本地模型，识别与音频处理全部由独立 Core 执行。</p>
              </div>
              <span class="state-chip" :class="'state-' + snapshot.live.state">
                <i></i>{{ liveStateLabel }}
              </span>
            </header>

            <article class="surface-card live-panel">
              <div class="control-row">
                <label class="control-field">
                  <span>音源</span>
                  <select v-model="selectedSource" :disabled="liveControlsLocked">
                    <option value="potplayer">PotPlayer</option>
                    <option value="allAudio">所有音频</option>
                  </select>
                </label>

                <label class="control-field grow">
                  <span>识别模型</span>
                  <select v-model="selectedModelId" :disabled="liveControlsLocked || snapshot.live.availableModels.length === 0">
                    <option
                      v-for="model in snapshot.live.availableModels"
                      :key="model.id"
                      :value="model.id"
                    >{{ model.name }}</option>
                    <option v-if="snapshot.live.availableModels.length === 0" value="">未安装实时模型</option>
                  </select>
                </label>
              </div>

              <div class="level-block">
                <div class="level-head">
                  <div>
                    <span>输入电平</span>
                    <small>{{ snapshot.live.status }}</small>
                  </div>
                  <b>{{ Math.round(snapshot.live.level * 100) }}%</b>
                </div>
                <div class="level-track">
                  <div class="level-fill" :style="{ width: Math.max(2, snapshot.live.level * 100) + '%' }"></div>
                </div>
              </div>

              <div
                v-if="snapshot.live.currentText || snapshot.live.previousText"
                class="transcript-preview"
              >
                <span v-if="snapshot.live.previousText">{{ snapshot.live.previousText }}</span>
                <b>{{ snapshot.live.currentText }}</b>
              </div>

              <div v-if="snapshot.live.lastError" class="inline-error">{{ snapshot.live.lastError }}</div>

              <div class="panel-footer">
                <button
                  class="primary-button"
                  :class="{ stop: liveRunning }"
                  type="button"
                  :disabled="liveButtonDisabled"
                  @click="toggleLive"
                >{{ liveButtonText }}</button>

                <div class="inline-statuses">
                  <span>
                    <i class="status-pulse" :class="{ off: snapshot.core.state !== 'ready' }"></i>
                    Core {{ snapshot.core.state === "ready" ? "正常" : "待检查" }}
                  </span>
                  <span>
                    <i class="status-pulse soft" :class="{ off: !liveRunning }"></i>
                    Overlay {{ liveRunning ? "跟随中" : "待命" }}
                  </span>
                  <span
                    class="hint-dot"
                    data-tip="实时音频、VAD、Process Loopback 与模型推理运行在 LocalSub.Core。PotPlayer 窗口和 Overlay 由 Windows Shell 管理。"
                  >i</span>
                </div>
              </div>
            </article>
          </section>

          <section v-else-if="activePage === 'batch'" class="page batch-page">
            <header class="page-heading">
              <div>
                <span class="eyebrow">后台转写</span>
                <h1>本地处理视频和音频文件</h1>
                <p>媒体分析、波形、VAD 与离线 ASR 继续运行在 LocalSub.Core。</p>
              </div>
              <span class="subtle-chip">{{ snapshot.batch.queued }} 个任务</span>
            </header>

            <article class="surface-card">
              <div class="drop-zone">
                <div class="drop-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14 M5 12h14"></path></svg>
                </div>
                <b>拖入视频或音频</b>
                <span>Web 后台工作区正在迁移，现有 Core 转写链保持不变。</span>
              </div>
              <div class="simple-status-row">
                <span>当前状态</span>
                <b>{{ snapshot.batch.status }}</b>
              </div>
            </article>
          </section>

          <section v-else-if="activePage === 'models'" class="page models-page">
            <header class="page-heading">
              <div>
                <span class="eyebrow">模型</span>
                <h1>管理本地识别模型</h1>
                <p>浏览、选择和维护模型。下载、修复、解压与删除都由 Core 完成。</p>
              </div>
              <button class="secondary-button" type="button" :disabled="commandBusy" @click="refreshModels">
                重新扫描
              </button>
            </header>

            <div class="summary-line">
              <span><b>{{ snapshot.models.installedCount }}</b> 已安装</span>
              <span><b>{{ snapshot.models.catalogCount }}</b> Catalog</span>
              <span><b>{{ snapshot.models.catalog.filter(x => x.liveCapable && x.installed).length }}</b> 实时可用</span>
              <span><b>{{ snapshot.models.catalog.filter(x => x.batchCapable && x.installed).length }}</b> 后台可用</span>
              <span class="summary-note">{{ snapshot.models.status }}</span>
            </div>

            <article class="surface-card model-list-card">
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
                  <div class="model-row-main">
                    <div class="model-name-line">
                      <b>{{ model.name }}</b>
                      <span v-if="model.recommended" class="model-badge recommended">推荐</span>
                      <span class="model-badge" :class="{ installed: model.installed }">
                        {{ model.installed ? "已安装" : "未安装" }}
                      </span>
                    </div>
                    <p>{{ model.purpose }}</p>
                    <div class="model-meta">
                      <span>{{ model.languages }}</span>
                      <span>{{ model.sizeText }}</span>
                      <span v-if="model.isComponent">组件</span>
                      <span v-else-if="model.liveCapable && model.batchCapable">实时 / 后台</span>
                      <span v-else-if="model.liveCapable">实时</span>
                      <span v-else-if="model.batchCapable">后台</span>
                    </div>
                  </div>
                  <div class="model-score-line">
                    <span>实时 <b>{{ model.realtimeScore || "·" }}</b></span>
                    <span>准确 <b>{{ model.accuracyScore || "·" }}</b></span>
                    <span>性价比 <b>{{ model.valueScore || "·" }}</b></span>
                  </div>
                </button>

                <div v-if="filteredCatalogModels.length === 0" class="model-empty">
                  当前筛选条件下没有模型。
                </div>
              </div>
            </article>

            <article v-if="selectedCatalogModel" class="surface-card model-inspector">
              <div class="inspector-head">
                <div>
                  <div class="inspector-title-line">
                    <i class="model-state-dot" :class="{ installed: selectedCatalogModel.installed }"></i>
                    <strong>{{ selectedCatalogModel.name }}</strong>
                  </div>
                  <p>{{ selectedCatalogModel.purpose }}</p>
                </div>
                <span class="subtle-chip">{{ selectedCatalogModel.installed ? "已安装" : "未安装" }}</span>
              </div>

              <div class="default-model-strip">
                <span>实时默认 <b>{{ snapshot.models.liveModelName }}</b></span>
                <span>后台默认 <b>{{ snapshot.models.batchModelName }}</b></span>
              </div>

              <div class="model-action-row">
                <button
                  class="secondary-button"
                  type="button"
                  :disabled="commandBusy || modelOperationBusy || !selectedCatalogModel.installed || !selectedCatalogModel.liveCapable || selectedCatalogModel.liveSelected"
                  @click="setDefaultModel('live')"
                >{{ selectedCatalogModel.liveSelected ? "实时默认" : "设为实时默认" }}</button>
                <button
                  class="secondary-button"
                  type="button"
                  :disabled="commandBusy || modelOperationBusy || !selectedCatalogModel.installed || !selectedCatalogModel.batchCapable || selectedCatalogModel.batchSelected"
                  @click="setDefaultModel('batch')"
                >{{ selectedCatalogModel.batchSelected ? "后台默认" : "设为后台默认" }}</button>
                <button
                  class="primary-button compact"
                  type="button"
                  :disabled="modelHeavyBlocked"
                  @click="downloadSelectedModel"
                >{{ selectedCatalogModel.installed ? "下载 / 修复" : "下载模型" }}</button>
                <button
                  class="text-danger-button"
                  :class="{ armed: deleteConfirmId === selectedCatalogModel.id }"
                  type="button"
                  :disabled="modelHeavyBlocked || !selectedCatalogModel.installed"
                  @click="deleteSelectedModel"
                >{{ deleteConfirmId === selectedCatalogModel.id ? "确认删除" : "删除" }}</button>
              </div>

              <p v-if="deleteConfirmId === selectedCatalogModel.id" class="delete-warning">
                再次点击“确认删除”将清理模型目录、缓存和未完成下载。
              </p>
              <p v-if="liveState !== 'idle'" class="model-block-note">
                请先停止实时字幕，再执行模型下载、修复或删除。
              </p>

              <div class="operation-row" :class="{ failed: snapshot.models.operation.state === 'failed' }">
                <div class="operation-copy">
                  <span>Core 模型任务</span>
                  <b>
                    {{ modelOperationBusy
                      ? snapshot.models.operation.modelName + " · " + snapshot.models.operation.stage
                      : snapshot.models.operation.stage }}
                  </b>
                  <small>{{ snapshot.models.operation.lastError || snapshot.models.operation.detail }}</small>
                </div>
                <div v-if="modelOperationBusy" class="operation-progress">
                  <div class="level-track">
                    <div
                      class="level-fill"
                      :class="{ indeterminate: snapshot.models.operation.isIndeterminate }"
                      :style="{ width: (snapshot.models.operation.percent ?? 36) + '%' }"
                    ></div>
                  </div>
                  <span v-if="snapshot.models.operation.percent !== null">{{ snapshot.models.operation.percent }}%</span>
                </div>
                <button
                  v-if="snapshot.models.operation.canCancel"
                  class="secondary-button"
                  type="button"
                  @click="cancelModelOperation"
                >取消</button>
              </div>
            </article>
          </section>

          <section v-else-if="activePage === 'settings'" class="page settings-page">
            <header class="page-heading">
              <div>
                <span class="eyebrow">设置</span>
                <h1>保持简单的运行偏好</h1>
                <p>当前先展示由 Shell 管理的关键设置，编辑能力会在后续页面迁移中接入。</p>
              </div>
            </header>

            <article class="surface-card settings-list">
              <div class="setting-row" data-tip="PotPlayer 模式使用进程专用 Process Loopback，不静默回退系统音频。">
                <div><strong>默认音源</strong><span>实时字幕启动时使用的音频来源</span></div>
                <b>{{ snapshot.settings.audioSource }}</b>
              </div>
              <div class="setting-row" data-tip="资源策略由 C# 与 Core 统一决定，Web UI 不直接管理识别线程。">
                <div><strong>资源策略</strong><span>Core 的本地计算资源配置</span></div>
                <b>{{ snapshot.settings.resourceProfile }}</b>
              </div>
              <div class="setting-row" data-tip="字幕 Overlay 的大小、样式与窗口行为继续由 Shell 负责。">
                <div><strong>字幕字号</strong><span>Overlay 字幕的显示尺寸</span></div>
                <b>{{ snapshot.settings.subtitleAutoSize ? "自动" : snapshot.settings.subtitleFontSize + " px" }}</b>
              </div>
            </article>
          </section>

          <section v-else class="page docs-page">
            <header class="page-heading">
              <div>
                <span class="eyebrow">文档</span>
                <h1>LocalSub 使用与架构</h1>
                <p>只保留日常使用真正需要知道的内容。</p>
              </div>
              <span class="subtle-chip">v{{ snapshot.app.productVersion }}</span>
            </header>

            <article class="surface-card docs-list">
              <section class="docs-section">
                <span>01</span>
                <div><h2>快速使用</h2><p>实时字幕中选择 PotPlayer 或系统音频，再选择已经安装的本地模型。后台转写将在 Web 工作区完成迁移后直接从这里使用。</p></div>
              </section>
              <section class="docs-section">
                <span>02</span>
                <div><h2>运行边界</h2><p>Vue 只显示状态和发送白名单命令。Windows Shell 管理窗口、托盘、PotPlayer 与 Overlay。LocalSub.Core 负责音频、ASR、媒体分析和模型重任务。</p></div>
              </section>
              <section class="docs-section">
                <span>03</span>
                <div><h2>当前迁移</h2><p>Web UI 已经是默认入口，实时页和模型页已接入 Core。旧 WinForms 只通过 <code>--legacy-ui</code> 作为迁移期备用。</p></div>
              </section>
              <section class="docs-section">
                <span>04</span>
                <div><h2>架构</h2><p><code>Vue 3 + TypeScript → LocalSub.exe → LocalSub.Core.exe</code></p></div>
              </section>
            </article>
          </section>
        </template>
      </div>
    </main>
  </div>
</template>
