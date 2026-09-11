<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { disposeBridge, invoke, type LocalSubSnapshot, type PageKey } from "./bridge";

const snapshot = ref<LocalSubSnapshot | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const nav: Array<{ key: PageKey; label: string; glyph: string }> = [
  { key: "live", label: "实时字幕", glyph: "字" },
  { key: "batch", label: "后台转写", glyph: "转" },
  { key: "models", label: "模型", glyph: "模" },
  { key: "settings", label: "设置", glyph: "设" },
  { key: "docs", label: "文档", glyph: "文" }
];

const activePage = computed(() => snapshot.value?.app.activePage ?? "live");
const pageTitle = computed(() => nav.find(item => item.key === activePage.value)?.label ?? "LocalSub");

async function refresh() {
  try {
    error.value = null;
    snapshot.value = await invoke<LocalSubSnapshot>("app.getSnapshot");
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

async function navigate(page: PageKey) {
  try {
    error.value = null;
    snapshot.value = await invoke<LocalSubSnapshot>("app.navigate", { page });
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

onMounted(refresh);
onBeforeUnmount(disposeBridge);
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
        <b>界面桥接失败</b>
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

            <div class="live-summary">
              <div class="summary-item">
                <span>音源</span>
                <b>{{ snapshot.live.source }}</b>
              </div>
              <div class="summary-item">
                <span>模型</span>
                <b>{{ snapshot.live.modelName }}</b>
              </div>
              <div class="summary-item">
                <span>状态</span>
                <b>{{ snapshot.live.state === "idle" ? "等待开始" : snapshot.live.state }}</b>
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

            <div class="hero-actions">
              <button class="primary-button" type="button" disabled>开始实时字幕</button>
              <span
                class="hint-dot"
                data-tip="当前 Phase 2A 只验证新主界面与 bridge。实时开始和停止将在下一阶段接入现有 Core session。"
              >i</span>
            </div>
          </article>

          <aside class="stack">
            <article class="mini-card">
              <div class="mini-title">
                <span class="status-pulse"></span>
                <span>Core</span>
                <span
                  class="hint-dot"
                  data-tip="实时识别、音频捕获和后台转写的重任务均运行在独立 Core 进程。"
                >i</span>
              </div>
              <strong>{{ snapshot.core.state === "ready" ? "运行正常" : "等待连接" }}</strong>
            </article>
            <article class="mini-card accent">
              <div class="mini-title">
                <span>字幕 Overlay</span>
                <span
                  class="hint-dot"
                  data-tip="PotPlayer 窗口位置、TopMost、点击穿透和全屏跟随继续由 Windows Shell 管理。"
                >i</span>
              </div>
              <strong>窗口跟随已保留</strong>
            </article>
          </aside>
        </section>

        <section v-else-if="activePage === 'batch'" class="page-grid">
          <article class="wide-card">
            <div class="section-title">
              <h2>后台转写</h2>
              <span
                class="hint-dot"
                data-tip="媒体分析、波形、VAD 和离线 ASR 均由 LocalSub.Core 执行。"
              >i</span>
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
              <span
                class="hint-dot"
                data-tip="模型不进入基础绿色包。下载、校验、解压和目录替换等重 IO 将继续收口到 Core。"
              >i</span>
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
                <li>Vue + WebView2 主 Shell 已完成第一版验证。</li>
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
