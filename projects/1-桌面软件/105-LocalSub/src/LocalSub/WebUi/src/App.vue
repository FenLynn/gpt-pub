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

function applySnapshot(next: LocalSubSnapshot) {
  snapshot.value = next;

  if (!selectionInitialized || next.live.state !== "idle") {
    selectedSource.value = next.live.sourceId;
    selectedModelId.value = next.live.modelId || next.live.availableModels[0]?.id || "";
    selectionInitialized = true;
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

        <section v-else-if="activePage === 'models'" class="page-grid">
          <article class="wide-card">
            <div class="section-title">
              <h2>本地模型</h2>
              <span class="hint-dot" data-tip="模型不进入基础绿色包。下载、校验、解压和目录替换等重 IO 将继续收口到 Core。">i</span>
            </div>
            <div class="metric-row">
              <div><span>Catalog</span><b>{{ snapshot.models.catalogCount }}</b></div>
              <div><span>已安装</span><b>{{ snapshot.models.installedCount }}</b></div>
              <div><span>状态</span><b>{{ snapshot.models.status }}</b></div>
            </div>
          </article>
          <aside class="mini-card accent">
            <div class="mini-title">
              <span>模型目录</span>
              <span class="hint-dot" data-tip="Vue 不直接读写模型目录，文件操作必须经过 Shell/Core 白名单接口。">i</span>
            </div>
            <strong>本地管理</strong>
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
