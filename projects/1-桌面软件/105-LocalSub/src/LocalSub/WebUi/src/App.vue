<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { disposeBridge, invoke, type LocalSubSnapshot, type PageKey } from "./bridge";

const snapshot = ref<LocalSubSnapshot | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const nav: Array<{ key: PageKey; label: string; hint: string; glyph: string }> = [
  { key: "live", label: "实时字幕", hint: "PotPlayer 与系统音频", glyph: "字" },
  { key: "batch", label: "后台转写", hint: "媒体文件与波形", glyph: "转" },
  { key: "models", label: "模型", hint: "本地 ASR 资源", glyph: "模" },
  { key: "settings", label: "设置", hint: "字幕与运行策略", glyph: "设" },
  { key: "about", label: "关于", hint: "架构与版本", glyph: "i" }
];

const activePage = computed(() => snapshot.value?.app.activePage ?? "live");
const pageTitle = computed(() => nav.find(item => item.key === activePage.value)?.label ?? "LocalSub");
const pageHint = computed(() => nav.find(item => item.key === activePage.value)?.hint ?? "");

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
        <div>
          <strong>LocalSub</strong>
          <small>local speech workspace</small>
        </div>
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
          <span class="nav-copy">
            <b>{{ item.label }}</b>
            <small>{{ item.hint }}</small>
          </span>
        </button>
      </nav>

      <div class="sidebar-foot">
        <div class="core-dot" :class="snapshot?.core.state ?? 'starting'"></div>
        <div>
          <b>{{ snapshot?.core.state === "ready" ? "Core 就绪" : "Core 状态" }}</b>
          <small v-if="snapshot?.core.pid">PID {{ snapshot.core.pid }} · G{{ snapshot.core.generation }}</small>
          <small v-else>LocalSub.Core</small>
        </div>
      </div>
    </aside>

    <main class="workspace">
      <header class="topbar">
        <div>
          <div class="eyebrow">LOCAL SPEECH WORKSPACE</div>
          <h1>{{ pageTitle }}</h1>
          <p>{{ pageHint }}</p>
        </div>
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
            <div class="card-kicker">REALTIME</div>
            <div class="hero-row">
              <div>
                <h2>让字幕跟着声音出现</h2>
                <p>实时音频和识别已经隔离到 LocalSub.Core。当前 Web Shell 只消费状态，不接触 WASAPI、Process Loopback 或模型推理。</p>
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
                <small>{{ snapshot.live.status }}</small>
              </div>
              <div class="level-track">
                <div class="level-fill" :style="{ width: Math.max(7, snapshot.live.level * 100) + '%' }"></div>
              </div>
            </div>

            <div class="hero-actions">
              <button class="primary-button" type="button" disabled>开始实时字幕</button>
              <span>Phase 2B 接入白名单命令后启用</span>
            </div>
          </article>

          <aside class="stack">
            <article class="mini-card">
              <div class="mini-title"><span class="status-pulse"></span>Core 隔离</div>
              <strong>{{ snapshot.core.state === "ready" ? "运行边界正常" : "等待 Core" }}</strong>
              <p>实时识别、VAD、音频捕获和 Process Loopback 均不在 Web UI 进程执行。</p>
            </article>
            <article class="mini-card accent">
              <div class="mini-title">字幕 Overlay</div>
              <strong>继续使用原生窗口跟随</strong>
              <p>PotPlayer PID、窗口位置、TopMost 和全屏跟随仍由轻量 Shell 负责。</p>
            </article>
          </aside>
        </section>

        <section v-else-if="activePage === 'batch'" class="page-grid">
          <article class="wide-card">
            <div class="card-kicker">BACKGROUND TRANSCRIPTION</div>
            <h2>后台转写工作台</h2>
            <p class="lead">保留现有媒体分析、波形与离线 ASR 的 Core 边界。Web 页面只负责队列、进度和结果展示。</p>
            <div class="drop-zone">
              <div class="drop-icon">＋</div>
              <b>拖入视频或音频</b>
              <span>{{ snapshot.batch.status }}</span>
            </div>
          </article>
          <aside class="mini-card">
            <div class="mini-title">队列</div>
            <strong>{{ snapshot.batch.queued }} 个任务</strong>
            <p>Phase 2B 再接入文件选择、分析、转写与取消命令。</p>
          </aside>
        </section>

        <section v-else-if="activePage === 'models'" class="page-grid">
          <article class="wide-card">
            <div class="card-kicker">LOCAL MODELS</div>
            <h2>模型保持在本地</h2>
            <p class="lead">模型不进入基础绿色包，也不会被 Vue 直接操作。下载、校验与目录替换将在 Core 中完成。</p>
            <div class="metric-row">
              <div><span>Catalog</span><b>{{ snapshot.models.catalogCount }}</b></div>
              <div><span>已安装</span><b>{{ snapshot.models.installedCount }}</b></div>
              <div><span>状态</span><b>{{ snapshot.models.status }}</b></div>
            </div>
          </article>
          <aside class="mini-card accent">
            <div class="mini-title">Phase 1B.2</div>
            <strong>重 IO 继续迁入 Core</strong>
            <p>下载、解压、校验和大目录替换不会复制到前端。</p>
          </aside>
        </section>

        <section v-else-if="activePage === 'settings'" class="settings-grid">
          <article class="setting-card">
            <span>默认音源</span>
            <b>{{ snapshot.settings.audioSource }}</b>
            <p>PotPlayer 使用进程专用 Process Loopback，不静默回退系统音频。</p>
          </article>
          <article class="setting-card">
            <span>资源策略</span>
            <b>{{ snapshot.settings.resourceProfile }}</b>
            <p>实时线程策略仍由 C# 与 Core 统一决定。</p>
          </article>
          <article class="setting-card">
            <span>字幕字号</span>
            <b>{{ snapshot.settings.subtitleAutoSize ? "自动" : snapshot.settings.subtitleFontSize + " px" }}</b>
            <p>Overlay 的样式与窗口行为继续由 Shell 管理。</p>
          </article>
        </section>

        <section v-else class="about-card">
          <div class="about-logo"><span></span><span></span></div>
          <h2>LocalSub</h2>
          <p>一个以本地识别、PotPlayer 实时字幕和后台媒体转写为核心的 Windows 工具。</p>
          <div class="architecture-line">
            <span>Vue 3 + TypeScript</span><i>→</i><span>LocalSub.exe</span><i>→</i><span>LocalSub.Core.exe</span>
          </div>
          <small>Web UI 只表达状态和意图，Shell 拥有 Windows 能力，Core 拥有重计算。</small>
        </section>
      </template>
    </main>
  </div>
</template>
