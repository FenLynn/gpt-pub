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

const nav: Array<{ key: PageKey; label: string; glyph: string }> = [
  { key: "live", label: "实时字幕", glyph: "字" },
  { key: "batch", label: "后台转写", glyph: "转" },
  { key: "models", label: "模型", glyph: "模" },
  { key: "settings", label: "设置", glyph: "设" },
  { key: "docs", label: "文档", glyph: "文" }
];

const activePage = computed(() => snapshot.value?.app.activePage ?? "live");
const pageTitle = computed(() => nav.find(item => item.key === activePage.value)?.label ?? "LocalSub");
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
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark"><span></span><span></span></div>
        <strong>LocalSub</strong>
      </div>

      <nav class="nav-list">
        <button
          v-for="item in nav"
          :key="item.key"
          class="nav-item"
          :class="{ active: activePage === item.key }"
          type="button"
          @click="navigate(item.key)"
        >
          <span class="nav-glyph">{{ item.glyph }}</span>
          <b>{{ item.label }}</b>
        </button>
      </nav>

      <div
        class="sidebar-foot"
        :data-tip="snapshot?.core.pid ? 'LocalSub.Core 进程 ' + snapshot.core.pid + '，generation ' + snapshot.core.generation : 'LocalSub.Core 尚未启动'"
      >
        <div class="core-dot" :class="snapshot?.core.state ?? 'starting'"></div>
        <b>{{ snapshot?.core.state === "ready" ? "Core 就绪" : "Core 状态" }}</b>
        <span class="hint-dot">i</span>
      </div>
    </aside>

    <main class="workspace">
      <header class="topbar">
        <h1>{{ pageTitle }}</h1>
        <div class="top-actions">
          <span class="version">v{{ snapshot?.app.productVersion ?? "0.1.1" }}</span>
          <button class="icon-button" type="button" title="刷新状态" @click="refresh">↻</button>
        </div>
      </header>

      <section v-if="error" class="notice error">
        <b>操作失败</b>
        <span>{{ error }}</span>
      </section>

      <section v-if="loading" class="loading-card">正在连接 LocalSub Shell…</section>

      <template v-else-if="snapshot">
        <section v-if="activePage === 'live'" class="page-grid live-grid">
          <article class="hero-card">
            <div class="hero-row">
              <div class="hero-title">
                <h2>实时字幕</h2>
                <span
                  class="hint-dot"
                  data-tip="实时音频、VAD、Process Loopback 与模型推理运行在 LocalSub.Core。Web UI 只发送白名单命令和显示状态。"
                >i</span>
              </div>
              <div class="live-orb" :class="snapshot.live.state">
                <div class="orb-core"></div>
                <div class="orb-ring"></div>
              </div>
            </div>

            <div class="control-grid">
              <label class="control-field">
                <span>音源</span>
                <select v-model="selectedSource" :disabled="liveControlsLocked">
                  <option value="potplayer">PotPlayer</option>
                  <option value="allAudio">所有音频</option>
                </select>
              </label>

              <label class="control-field">
                <span>模型</span>
                <select v-model="selectedModelId" :disabled="liveControlsLocked || snapshot.live.availableModels.length === 0">
                  <option
                    v-for="model in snapshot.live.availableModels"
                    :key="model.id"
                    :value="model.id"
                  >{{ model.name }}</option>
                  <option v-if="snapshot.live.availableModels.length === 0" value="">未安装实时模型</option>
                </select>
              </label>

              <div class="state-field">
                <span>状态</span>
                <b :class="'state-' + snapshot.live.state">{{ liveStateLabel }}</b>
              </div>
            </div>

            <div class="level-block">
              <div class="level-head">
                <span>输入电平</span>
                <span class="status-text">{{ snapshot.live.status }}</span>
              </div>
              <div class="level-track">
                <div class="level-fill" :style="{ width: Math.max(7, snapshot.live.level * 100) + '%' }"></div>
              </div>
            </div>

            <div
              v-if="snapshot.live.currentText || snapshot.live.previousText"
              class="transcript-preview"
            >
              <span v-if="snapshot.live.previousText">{{ snapshot.live.previousText }}</span>
              <b>{{ snapshot.live.currentText }}</b>
            </div>

            <div v-if="snapshot.live.lastError" class="inline-error">
              {{ snapshot.live.lastError }}
            </div>

            <div class="hero-actions">
              <button
                class="primary-button"
                :class="{ stop: liveRunning }"
                type="button"
                :disabled="liveButtonDisabled"
                @click="toggleLive"
              >{{ liveButtonText }}</button>
              <span
                class="hint-dot"
                data-tip="开始后音源和模型会锁定。停止后恢复选择。实时识别逻辑仍由现有 Core session 执行。"
              >i</span>
            </div>
          </article>

          <aside class="stack">
            <article class="mini-card">
              <div class="mini-title">
                <span class="status-pulse" :class="{ off: snapshot.core.state !== 'ready' }"></span>
                <span>Core</span>
                <span
                  class="hint-dot"
                  data-tip="实时识别、音频捕获和后台转写的重任务均运行在独立 Core 进程。"
                >i</span>
              </div>
              <strong>{{ snapshot.core.state === "ready" ? "运行正常" : "需要检查" }}</strong>
            </article>

            <article class="mini-card accent">
              <div class="mini-title">
                <span>字幕 Overlay</span>
                <span
                  class="hint-dot"
                  data-tip="PotPlayer 窗口位置、TopMost、点击穿透和全屏跟随继续由 Windows Shell 管理。"
                >i</span>
              </div>
              <strong>{{ liveRunning ? "正在跟随" : "待命" }}</strong>
            </article>
          </aside>
        </section>

        <section v-else-if="activePage === 'batch'" class="page-grid">
          <article class="wide-card">
            <div class="section-title">
              <h2>后台转写</h2>
              <span class="hint-dot" data-tip="媒体分析、波形、VAD 和离线 ASR 均由 LocalSub.Core 执行。">i</span>
            </div>
            <div class="drop-zone">
              <div class="drop-icon">＋</div>
              <b>拖入视频或音频</b>
            </div>
          </article>
          <aside class="mini-card">
            <div class="mini-title">
              <span>队列</span>
              <span class="hint-dot" data-tip="文件选择、分析、转写与取消命令将在逐页迁移阶段接入。">i</span>
            </div>
            <strong>{{ snapshot.batch.queued }} 个任务</strong>
          </aside>
        </section>

        <section v-else-if="activePage === 'models'" class="page-grid models-grid">
          <article class="wide-card model-catalog-card">
            <div class="model-page-head">
              <div class="section-title">
                <h2>本地模型</h2>
                <span
                  class="hint-dot"
                  data-tip="模型目录状态与默认选择由 Shell 管理。下载、断点续传、解压、校验、修复和删除均通过 LocalSub.Core 长任务执行。"
                >i</span>
              </div>
              <button class="compact-button" type="button" :disabled="commandBusy" @click="refreshModels">
                重新扫描
              </button>
            </div>

            <div class="model-summary-strip">
              <div><b>{{ snapshot.models.installedCount }}</b><span>已安装</span></div>
              <div><b>{{ snapshot.models.catalogCount }}</b><span>Catalog</span></div>
              <div><b>{{ snapshot.models.catalog.filter(x => x.liveCapable && x.installed).length }}</b><span>实时可用</span></div>
              <div><b>{{ snapshot.models.catalog.filter(x => x.batchCapable && x.installed).length }}</b><span>后台可用</span></div>
            </div>

            <div class="model-filter-bar">
              <button
                v-for="item in modelFilters"
                :key="item.key"
                type="button"
                :class="{ active: modelFilter === item.key }"
                @click="modelFilter = item.key"
              >{{ item.label }}</button>
              <span>{{ snapshot.models.status }}</span>
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
                <div class="model-score-grid">
                  <span><small>实时</small><b>{{ model.realtimeScore || "·" }}</b></span>
                  <span><small>准确</small><b>{{ model.accuracyScore || "·" }}</b></span>
                  <span><small>性价比</small><b>{{ model.valueScore || "·" }}</b></span>
                </div>
              </button>

              <div v-if="filteredCatalogModels.length === 0" class="model-empty">
                当前筛选条件下没有模型。
              </div>
            </div>
          </article>

          <aside class="model-detail-stack">
            <article class="mini-card accent model-default-card">
              <div class="mini-title">
                <span>默认模型</span>
                <span class="hint-dot" data-tip="默认选择由 Shell 写入 AppSettings，旧 WinForms 与未来 Web 页面继续共用同一份配置。">i</span>
              </div>
              <div class="default-model-line">
                <span>实时字幕</span>
                <b>{{ snapshot.models.liveModelName }}</b>
              </div>
              <div class="default-model-line">
                <span>后台转写</span>
                <b>{{ snapshot.models.batchModelName }}</b>
              </div>
            </article>

            <article v-if="selectedCatalogModel" class="mini-card model-selection-card">
              <div class="mini-title">
                <span>当前选择</span>
                <span
                  class="model-state-dot"
                  :class="{ installed: selectedCatalogModel.installed }"
                ></span>
              </div>
              <strong>{{ selectedCatalogModel.name }}</strong>
              <p class="model-detail-purpose">{{ selectedCatalogModel.purpose }}</p>
              <div class="model-actions">
                <button
                  class="primary-button model-action"
                  type="button"
                  :disabled="commandBusy || modelOperationBusy || !selectedCatalogModel.installed || !selectedCatalogModel.liveCapable || selectedCatalogModel.liveSelected"
                  @click="setDefaultModel('live')"
                >{{ selectedCatalogModel.liveSelected ? "实时默认" : "设为实时默认" }}</button>
                <button
                  class="outline-button model-action"
                  type="button"
                  :disabled="commandBusy || modelOperationBusy || !selectedCatalogModel.installed || !selectedCatalogModel.batchCapable || selectedCatalogModel.batchSelected"
                  @click="setDefaultModel('batch')"
                >{{ selectedCatalogModel.batchSelected ? "后台默认" : "设为后台默认" }}</button>
              </div>

              <div class="model-heavy-actions">
                <button
                  class="primary-button model-action"
                  type="button"
                  :disabled="modelHeavyBlocked"
                  @click="downloadSelectedModel"
                >{{ selectedCatalogModel.installed ? "下载 / 修复" : "下载模型" }}</button>
                <button
                  class="outline-button danger model-action"
                  :class="{ armed: deleteConfirmId === selectedCatalogModel.id }"
                  type="button"
                  :disabled="modelHeavyBlocked || !selectedCatalogModel.installed"
                  @click="deleteSelectedModel"
                >{{ deleteConfirmId === selectedCatalogModel.id ? "确认删除" : "删除本地模型" }}</button>
              </div>
              <p v-if="deleteConfirmId === selectedCatalogModel.id" class="delete-warning">
                再次点击将删除模型目录、缓存和未完成下载。
              </p>
              <p v-if="liveState !== 'idle'" class="model-block-note">
                请先停止实时字幕，再执行模型下载、修复或删除。
              </p>
            </article>

            <article class="mini-card model-operation-card" :class="{ failed: snapshot.models.operation.state === 'failed' }">
              <div class="mini-title">
                <span>Core 模型任务</span>
                <span
                  class="model-state-dot"
                  :class="{ installed: modelOperationBusy }"
                ></span>
              </div>
              <strong>
                {{ modelOperationBusy
                  ? snapshot.models.operation.modelName + " · " + snapshot.models.operation.stage
                  : snapshot.models.operation.stage }}
              </strong>
              <p>{{ snapshot.models.operation.lastError || snapshot.models.operation.detail }}</p>
              <div v-if="modelOperationBusy" class="model-operation-progress">
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
                class="outline-button model-cancel-button"
                type="button"
                @click="cancelModelOperation"
              >取消任务</button>
            </article>
          </aside>
        </section>

        <section v-else-if="activePage === 'settings'" class="settings-grid">
          <article class="setting-card" data-tip="PotPlayer 模式使用进程专用 Process Loopback，不静默回退系统音频。">
            <div class="setting-head"><span>默认音源</span><span class="hint-dot">i</span></div>
            <b>{{ snapshot.settings.audioSource }}</b>
          </article>
          <article class="setting-card" data-tip="资源策略由 C# 与 Core 统一决定，Web UI 不直接管理识别线程。">
            <div class="setting-head"><span>资源策略</span><span class="hint-dot">i</span></div>
            <b>{{ snapshot.settings.resourceProfile }}</b>
          </article>
          <article class="setting-card" data-tip="字幕 Overlay 的大小、样式与窗口行为继续由 Shell 负责。">
            <div class="setting-head"><span>字幕字号</span><span class="hint-dot">i</span></div>
            <b>{{ snapshot.settings.subtitleAutoSize ? "自动" : snapshot.settings.subtitleFontSize + " px" }}</b>
          </article>
        </section>

        <section v-else class="docs-page">
          <div class="docs-hero">
            <div>
              <h2>LocalSub 文档</h2>
              <p>使用方式、功能边界和架构说明集中在这里。</p>
            </div>
            <span class="docs-version">v{{ snapshot.app.productVersion }}</span>
          </div>

          <div class="docs-grid">
            <article class="doc-card">
              <div class="doc-index">01</div>
              <h3>快速使用</h3>
              <ul>
                <li>实时字幕：选择 PotPlayer 或系统音频，选择已安装模型后开始。</li>
                <li>后台转写：导入媒体文件，分析波形后执行本地识别。</li>
                <li>字幕窗口：自动跟随 PotPlayer，可在设置中调整显示方式。</li>
              </ul>
            </article>

            <article class="doc-card">
              <div class="doc-index">02</div>
              <h3>运行边界</h3>
              <ul>
                <li>Web UI 只显示状态并发送白名单命令。</li>
                <li>Windows Shell 负责窗口、托盘、PotPlayer 与 Overlay。</li>
                <li>LocalSub.Core 负责音频、ASR、媒体分析和重任务。</li>
              </ul>
            </article>

            <article class="doc-card">
              <div class="doc-index">03</div>
              <h3>当前迁移</h3>
              <ul>
                <li>实时识别链已经迁入独立 Core。</li>
                <li>Web 实时页已经接入同一个 Core session。</li>
                <li>旧 WinForms 仍是默认入口，方便验证与回退。</li>
              </ul>
            </article>

            <article class="doc-card">
              <div class="doc-index">04</div>
              <h3>架构</h3>
              <div class="architecture-stack">
                <span>Vue 3 + TypeScript</span>
                <i>↓</i>
                <span>LocalSub.exe</span>
                <i>↓</i>
                <span>LocalSub.Core.exe</span>
              </div>
            </article>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>
