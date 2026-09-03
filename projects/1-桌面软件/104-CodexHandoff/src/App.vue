<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  cancelExport,
  cancelScan,
  chooseOutputPath,
  defaultCodexRoot,
  exportCandidates,
  exportMarkdown,
  listSessions,
  openPath,
  preflightExport,
  scanCatalog,
  sessionPreview,
} from './api'
import type {
  ExportResult,
  PreflightResult,
  ProgressEvent,
  ProjectInfo,
  SessionPreview,
  SessionSummary,
} from './types'

type PageName = 'export' | 'safety' | 'about'
type ModalKind = 'scan-plan' | 'export-plan' | 'sensitive' | null

const page = ref<PageName>('export')
const root = ref('')
const mergeGitRoots = ref(false)
const projects = ref<ProjectInfo[]>([])
const projectKey = ref('')
const sessions = ref<SessionSummary[]>([])
const total = ref(0)
const pageSize = 50
const pageIndex = ref(0)
const search = ref('')
const filter = ref('all')
const includeInternal = ref(false)
const includeArchived = ref(true)
const selected = reactive(new Map<string, SessionSummary>())
const selectionMode = ref<'project' | 'custom'>('project')
const current = ref<SessionSummary | null>(null)
const preview = ref<SessionPreview | null>(null)
const outputPath = ref('')
const includeTools = ref(false)
const scanBusy = ref(false)
const listBusy = ref(false)
const previewBusy = ref(false)
const exportBusy = ref(false)
const status = ref('等待手动扫描')
const progress = ref(0)
const logs = ref<string[]>([])
const logOpen = ref(false)
const modal = ref<ModalKind>(null)
const preflight = ref<PreflightResult | null>(null)
const pendingExportSessions = ref<SessionSummary[]>([])
const exportResult = ref<ExportResult | null>(null)
const errorText = ref('')
const resultOpen = ref(false)
let searchTimer: number | undefined
let unlistenScan: UnlistenFn | null = null
let unlistenExport: UnlistenFn | null = null

const project = computed(() => projects.value.find(p => p.key === projectKey.value) ?? null)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const scannedTotal = computed(() => projects.value.reduce((sum, p) => sum + p.sessionCount, 0))
const scannedActive = computed(() => projects.value.reduce((sum, p) => sum + p.activeCount, 0))
const scannedArchived = computed(() => projects.value.reduce((sum, p) => sum + p.archivedCount, 0))
const selectionText = computed(() => {
  if (!project.value) return '未选择项目'
  if (selectionMode.value === 'project') return `项目全部 ${total.value} 个对话`
  return `已选择 ${selected.size} 个对话`
})

function appendLog(message: string) {
  const now = new Date()
  const ts = now.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0')
  logs.value.push(`[${ts}] ${message}`)
  if (logs.value.length > 1500) logs.value.splice(0, logs.value.length - 1500)
}

function humanBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = units[0]
  for (let i = 1; i < units.length && value >= 1024; i++) {
    value /= 1024
    unit = units[i]
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${unit}`
}

function formatTime(ms: number) {
  if (!ms) return '未知'
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}

function shortTime(ms: number) {
  if (!ms) return '未知'
  const d = new Date(ms)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function projectName(path: string) {
  const cleaned = path.replace(/[\\/]+$/, '')
  const parts = cleaned.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) || cleaned || '未知项目'
}

function defaultOutputForProject(path: string) {
  const sep = path.includes('\\') ? '\\' : '/'
  return path.replace(/[\\/]+$/, '') + sep + 'CODEX-HANDOFF.md'
}

async function setupListeners() {
  unlistenScan = await listen<ProgressEvent>('scan-progress', event => {
    const p = event.payload
    status.value = p.message
    progress.value = p.percent
    appendLog(p.message)
  })
  unlistenExport = await listen<ProgressEvent>('export-progress', event => {
    const p = event.payload
    status.value = p.message
    progress.value = p.percent
    appendLog(p.message)
  })
}

onMounted(async () => {
  await setupListeners()
  root.value = await defaultCodexRoot()
})

onBeforeUnmount(() => {
  unlistenScan?.()
  unlistenExport?.()
})

function requestScan() {
  errorText.value = ''
  modal.value = 'scan-plan'
}

async function doCancelScan() {
  await cancelScan()
  appendLog('已请求取消扫描，将在当前文件处理完成后停止。')
  status.value = '正在取消扫描…'
}

async function confirmScan() {
  modal.value = null
  scanBusy.value = true
  progress.value = 0
  logs.value = []
  selected.clear()
  selectionMode.value = 'project'
  current.value = null
  preview.value = null
  projects.value = []
  sessions.value = []
  total.value = 0
  projectKey.value = ''
  exportResult.value = null
  appendLog(`用户确认扫描计划。源目录：${root.value}`)
  try {
    const result = await scanCatalog(root.value.trim(), mergeGitRoots.value)
    projects.value = result.projects
    status.value = `扫描完成，有效用户对话 ${result.totalSessions} 个（活动 ${result.activeSessions} / 归档 ${result.archivedSessions}），${result.projects.length} 个项目`
    progress.value = 100
    result.logs.forEach(line => appendLog(line))
    appendLog(`扫描总耗时 ${result.elapsedMs} ms；原始 thread ${result.rawThreads}；有效 ${result.totalSessions}；活动 ${result.activeSessions}；归档 ${result.archivedSessions}；内部 ${result.internalSessions}；无用户事件 ${result.nonUserSessions}；正文缺失 ${result.missingBodySessions}；JSONL 兜底 ${result.orphanSessions}`)
    if (projects.value.length) projectKey.value = projects.value[0].key
  } catch (err) {
    errorText.value = String(err)
    status.value = String(err).includes('scan_cancelled') ? '已取消扫描' : '扫描失败'
    appendLog(`扫描结束：${String(err)}`)
  } finally {
    scanBusy.value = false
  }
}

function sessionArgs() {
  return {
    projectKey: projectKey.value,
    offset: pageIndex.value * pageSize,
    limit: pageSize,
    filter: filter.value,
    search: search.value.trim(),
    includeInternal: includeInternal.value,
    includeArchived: includeArchived.value,
  }
}

async function loadSessions() {
  if (!projectKey.value) {
    sessions.value = []
    total.value = 0
    return
  }
  listBusy.value = true
  current.value = null
  preview.value = null
  try {
    const result = await listSessions(sessionArgs())
    sessions.value = result.sessions
    total.value = result.total
    if (selectionMode.value === 'project') {
      selected.clear()
      for (const s of sessions.value) if (s.bodyExists) selected.set(s.id, s)
    }
    if (sessions.value.length) await selectSession(sessions.value[0])
  } catch (err) {
    errorText.value = String(err)
    appendLog(`读取会话列表失败：${String(err)}`)
  } finally {
    listBusy.value = false
  }
}

watch(projectKey, async () => {
  pageIndex.value = 0
  selectionMode.value = 'project'
  selected.clear()
  if (project.value) outputPath.value = defaultOutputForProject(project.value.displayPath)
  await loadSessions()
})

watch([filter, includeInternal, includeArchived], async () => {
  pageIndex.value = 0
  await loadSessions()
})

watch(search, () => {
  if (searchTimer) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(async () => {
    pageIndex.value = 0
    await loadSessions()
  }, 300)
})

async function selectSession(s: SessionSummary) {
  current.value = s
  preview.value = null
  if (!s.bodyExists) {
    appendLog(`正文文件缺失，仅保留 Codex state 索引：${s.title}`)
    return
  }
  previewBusy.value = true
  try {
    preview.value = await sessionPreview(s.path)
  } catch (err) {
    appendLog(`读取预览失败：${s.title}：${String(err)}`)
  } finally {
    previewBusy.value = false
  }
}

function toggleSession(s: SessionSummary, checked: boolean) {
  selectionMode.value = 'custom'
  if (checked && s.bodyExists) selected.set(s.id, s)
  else selected.delete(s.id)
}

function selectVisible() {
  selectionMode.value = 'custom'
  for (const s of sessions.value) if (s.bodyExists) selected.set(s.id, s)
}

function clearSelection() {
  selectionMode.value = 'custom'
  selected.clear()
}

function selectWholeProject() {
  selectionMode.value = 'project'
  selected.clear()
  for (const s of sessions.value) if (s.bodyExists) selected.set(s.id, s)
}

async function changePage(next: number) {
  if (next < 0 || next >= totalPages.value) return
  pageIndex.value = next
  await loadSessions()
}

async function chooseOutput() {
  const chosen = await chooseOutputPath(outputPath.value || 'CODEX-HANDOFF.md')
  if (chosen) outputPath.value = chosen
}

async function resolveExportSessions() {
  if (selectionMode.value === 'project') {
    return await exportCandidates({
      projectKey: projectKey.value,
      filter: filter.value,
      search: search.value.trim(),
      includeInternal: includeInternal.value,
      includeArchived: includeArchived.value,
    })
  }
  return Array.from(selected.values()).filter(s => s.bodyExists)
}

async function requestExportPlan() {
  errorText.value = ''
  if (!project.value) {
    errorText.value = '请先选择一个项目。'
    return
  }
  if (!outputPath.value.trim()) {
    errorText.value = '请先选择输出文件。'
    return
  }
  try {
    pendingExportSessions.value = await resolveExportSessions()
  } catch (err) {
    errorText.value = String(err)
    return
  }
  if (!pendingExportSessions.value.length) {
    errorText.value = '当前没有可导出的会话正文。'
    return
  }
  preflight.value = null
  modal.value = 'export-plan'
}

async function runPreflight() {
  exportBusy.value = true
  status.value = '正在进行导出预检'
  progress.value = 0
  appendLog(`开始导出预检：${pendingExportSessions.value.length} 个会话。`)
  try {
    preflight.value = await preflightExport(pendingExportSessions.value, includeTools.value)
    modal.value = 'sensitive'
    appendLog(`预检完成：${humanBytes(preflight.value.totalBytes)}。`)
  } catch (err) {
    errorText.value = String(err)
    modal.value = null
    appendLog(`预检失败：${String(err)}`)
  } finally {
    exportBusy.value = false
  }
}

async function confirmExport() {
  if (!project.value) return
  modal.value = null
  exportBusy.value = true
  progress.value = 0
  resultOpen.value = false
  appendLog(`用户确认写入：${outputPath.value}`)
  try {
    const result = await exportMarkdown({
      sessions: pendingExportSessions.value,
      projectPath: project.value.displayPath,
      targetPath: outputPath.value.trim(),
      includeTools: includeTools.value,
      maxToolChars: 32768,
    })
    exportResult.value = result
    resultOpen.value = true
    progress.value = 100
    status.value = '导出完成'
    appendLog(`导出完成：${result.outputPath}，${result.sessionCount} 个会话，${result.messageCount} 条交接消息，${humanBytes(result.bytesWritten)}，耗时 ${result.elapsedMs} ms。`)
  } catch (err) {
    errorText.value = String(err)
    status.value = String(err).includes('cancel') ? '已取消导出' : '导出失败'
    appendLog(`导出结束：${String(err)}`)
  } finally {
    exportBusy.value = false
  }
}

async function doCancelExport() {
  await cancelExport()
  appendLog('已请求取消导出，将在当前记录处理完成后停止。')
}

async function copyAgyPrompt() {
  const name = outputPath.value.split(/[\\/]/).pop() || 'CODEX-HANDOFF.md'
  const text = `请先完整阅读 @${name}，恢复此前 Codex 的项目上下文。\n请结合当前工作区实际代码状态核验历史结论，历史聊天用于恢复上下文，当前代码与仓库状态作为最终事实依据。\n在确认当前断点后继续后续开发。`
  await navigator.clipboard.writeText(text)
  status.value = 'Antigravity 接续提示已复制'
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">CH</div>
        <div class="brand-copy">
          <div class="brand-name">CodexHandoff</div>
          <div class="brand-version">v1.0.0 alpha 4</div>
        </div>
      </div>

      <nav class="nav">
        <button :class="['nav-item', { active: page === 'export' }]" @click="page = 'export'"><span class="nav-icon">↗</span><span>对话导出</span></button>
        <button :class="['nav-item', { active: page === 'safety' }]" @click="page = 'safety'"><span class="nav-icon">◇</span><span>安全规则</span></button>
        <button :class="['nav-item', { active: page === 'about' }]" @click="page = 'about'"><span class="nav-icon">i</span><span>关于</span></button>
      </nav>

      <div class="side-footer"><span class="status-dot"></span><span>Codex 只读</span></div>
    </aside>

    <main class="main">
      <template v-if="page === 'export'">
        <header class="page-header compact-header">
          <div>
            <h1>对话导出</h1>
            <p>选择项目和历史对话，生成可直接交给 Antigravity 的精简项目交接 Markdown</p>
          </div>
          <div class="route-brand" aria-label="Codex to Antigravity">
            <div class="agent-badge"><span class="agent-icon codex-icon">C</span><span>Codex</span></div>
            <span class="route-arrow">→</span>
            <div class="agent-badge"><span class="agent-icon agy-icon">A</span><span>Antigravity</span></div>
          </div>
        </header>

        <section class="source-strip">
          <div class="source-symbol">C</div>
          <div class="source-main">
            <div class="source-title">Codex 数据源 <span class="readonly-chip">只读</span></div>
            <input v-model="root" class="source-input" :disabled="scanBusy || exportBusy" spellcheck="false" />
          </div>
          <label class="switch-line" title="把同一 Git 仓库下不同 cwd 归到一起"><input v-model="mergeGitRoots" type="checkbox" :disabled="scanBusy || exportBusy" /><span>Git 根目录归并</span></label>
          <button class="scan-button" :class="{ cancelling: scanBusy }" :disabled="exportBusy" @click="scanBusy ? doCancelScan() : requestScan()">{{ scanBusy ? '取消扫描' : '开始扫描' }}</button>
        </section>

        <section v-if="projects.length" class="summary-strip">
          <div><strong>{{ scannedTotal }}</strong><span>对话</span></div>
          <div><strong>{{ scannedActive }}</strong><span>活动</span></div>
          <div><strong>{{ scannedArchived }}</strong><span>归档</span></div>
          <div><strong>{{ projects.length }}</strong><span>项目</span></div>
          <div class="summary-status"><span class="status-dot"></span>{{ status }}</div>
        </section>

        <section class="workspace">
          <aside class="projects-pane">
            <div class="pane-heading">
              <div><span class="pane-kicker">PROJECTS</span><h2>项目</h2></div>
              <span class="count-bubble">{{ projects.length }}</span>
            </div>
            <div v-if="!projects.length" class="pane-empty">
              <span class="empty-icon">⌁</span>
              <strong>尚未扫描</strong>
              <small>点击上方“开始扫描”读取 Codex 项目索引</small>
            </div>
            <div v-else class="project-list">
              <button v-for="p in projects" :key="p.key" :title="p.displayPath" :class="['project-item', { active: projectKey === p.key }]" @click="projectKey = p.key">
                <span class="project-topline"><span class="project-name">{{ projectName(p.displayPath) }}</span><span class="project-count">{{ p.sessionCount }}</span></span>
                <span class="project-path">{{ p.displayPath }}</span>
                <span class="project-stats"><span>{{ p.activeCount }} 活动</span><span v-if="p.archivedCount">{{ p.archivedCount }} 归档</span><span v-if="p.missingBodyCount" class="warn-text">{{ p.missingBodyCount }} 缺正文</span></span>
              </button>
            </div>
          </aside>

          <section class="sessions-pane">
            <div class="pane-heading session-heading">
              <div>
                <span class="pane-kicker">CONVERSATIONS</span>
                <h2>{{ project ? projectName(project.displayPath) : '对话' }} <span class="heading-count">{{ total }}</span></h2>
              </div>
              <div class="selection-actions">
                <button class="icon-text-button" :disabled="!project" @click="selectWholeProject">全部</button>
                <button class="icon-text-button" :disabled="!sessions.length" @click="selectVisible">本页</button>
                <button class="icon-text-button" :disabled="!selected.size && selectionMode === 'custom'" @click="clearSelection">清空</button>
              </div>
            </div>

            <div class="filter-bar">
              <label class="search-field"><span>⌕</span><input v-model="search" placeholder="搜索对话标题" /></label>
              <div class="segmented">
                <button :class="{ active: filter === 'all' }" @click="filter = 'all'">全部</button>
                <button :class="{ active: filter === 'active' }" @click="filter = 'active'">活动</button>
                <button :class="{ active: filter === 'archived' }" @click="filter = 'archived'">归档</button>
              </div>
              <select v-model="filter" class="time-filter"><option value="all">全部时间</option><option value="7d">最近 7 天</option><option value="30d">最近 30 天</option><option value="active">仅活动</option><option value="archived">仅归档</option></select>
              <button class="more-filter" :class="{ active: includeInternal }" title="显示内部或非用户线程" @click="includeInternal = !includeInternal">···</button>
            </div>

            <div class="session-list">
              <div v-if="listBusy" class="list-empty">正在读取当前页…</div>
              <div v-else-if="!sessions.length" class="list-empty">{{ projects.length ? '当前筛选没有对话' : '扫描后会在这里显示对话' }}</div>
              <button v-for="s in sessions" v-else :key="s.id" :class="['session-row', { current: current?.id === s.id }]" @click="selectSession(s)">
                <span class="session-check" @click.stop><input type="checkbox" :disabled="!s.bodyExists" :checked="s.bodyExists && (selectionMode === 'project' || selected.has(s.id))" @change="toggleSession(s, ($event.target as HTMLInputElement).checked)" /></span>
                <span class="session-content">
                  <span class="session-title-line"><strong>{{ s.title }}</strong><span class="session-date">{{ shortTime(s.modified) }}</span></span>
                  <span class="session-preview">{{ s.bodyExists ? (s.lastUserPreview || '点击读取预览') : '仅有索引，正文文件缺失' }}</span>
                  <span v-if="s.archived || s.internal || !s.hasUserEvent || !s.bodyExists" class="session-tags"><em v-if="s.archived">归档</em><em v-if="s.internal || !s.hasUserEvent" class="warning">内部</em><em v-if="!s.bodyExists" class="warning">缺正文</em></span>
                </span>
              </button>
            </div>

            <div class="list-footer">
              <span>{{ selectionText }}</span>
              <div class="pager-buttons"><button :disabled="pageIndex <= 0" @click="changePage(pageIndex - 1)">‹</button><span>{{ pageIndex + 1 }} / {{ totalPages }}</span><button :disabled="pageIndex + 1 >= totalPages" @click="changePage(pageIndex + 1)">›</button></div>
            </div>
          </section>

          <aside class="detail-pane">
            <div class="pane-heading">
              <div><span class="pane-kicker">HANDOFF</span><h2>预览与导出</h2></div>
            </div>

            <div class="conversation-preview">
              <div v-if="previewBusy" class="detail-empty">正在读取预览…</div>
              <div v-else-if="!current" class="detail-empty"><span>◫</span><strong>选择一条对话</strong><small>这里会显示对话信息和最后用户输入</small></div>
              <template v-else>
                <div class="detail-title-row"><strong>{{ current.title }}</strong><span v-if="current.archived" class="soft-tag">归档</span></div>
                <div class="detail-meta"><span :title="current.cwd">{{ projectName(current.cwd) }}</span><span>·</span><span>{{ formatTime(current.modified) }}</span><span>·</span><span>{{ humanBytes(current.size) }}</span></div>
                <div class="last-message">
                  <span class="last-message-label">最后用户输入</span>
                  <p>{{ current.bodyExists ? (preview?.lastUser || current.lastUserPreview || '未找到可见用户输入') : 'Codex state 中存在该 thread，但没有找到 rollout 正文文件。' }}</p>
                </div>
              </template>
            </div>

            <div class="handoff-options">
              <label class="option-row"><input v-model="includeTools" type="checkbox" /><span><strong>包含过程细节（高级）</strong><small>默认关闭；开启后保留中间 Codex 回复、工具调用与结果</small></span></label>

              <label class="field-caption">输出文件</label>
              <div class="output-field"><input v-model="outputPath" class="text-input" spellcheck="false" /><button @click="chooseOutput">选择</button></div>
              <div class="read-only-note"><span class="status-dot"></span>原始 Codex 数据始终只读，输出不会写入 .codex / .gemini</div>
            </div>

            <div class="detail-actions">
              <button class="secondary-button" :disabled="!project || exportBusy" @click="requestExportPlan">查看执行计划</button>
              <button v-if="exportBusy" class="danger-button" @click="doCancelExport">取消导出</button>
            </div>
          </aside>
        </section>

        <section class="activity-drawer" :class="{ open: logOpen }">
          <button class="activity-toggle" @click="logOpen = !logOpen">
            <span><span class="activity-dot" :class="{ busy: scanBusy || exportBusy }"></span><strong>状态 / 进度</strong><em>{{ status }}</em></span>
            <span class="activity-right"><button v-if="logs.length" class="clear-inline" @click.stop="logs = []">清空</button><span>{{ logOpen ? '⌃' : '⌄' }}</span></span>
          </button>
          <div class="progress-track"><div class="progress-bar" :style="{ width: `${Math.max(0, Math.min(100, progress))}%` }"></div></div>
          <div v-if="logOpen" class="log-box"><div v-if="!logs.length" class="log-empty">尚无日志</div><div v-for="(line, index) in logs" :key="index" class="log-line">{{ line }}</div></div>
        </section>

        <div v-if="errorText" class="error-banner">{{ errorText }}</div>
      </template>

      <template v-else-if="page === 'safety'">
        <header class="page-header simple"><div><h1>安全规则</h1><p>这些限制由程序底层固定，不依赖用户记忆。</p></div></header>
        <div class="info-grid">
          <article class="info-card"><span class="info-icon">R</span><h3>原始数据只读</h3><p>Codex 数据源只使用读取 API，不删除、移动、重命名、归档、追加或覆盖任何原始会话、索引或数据库。</p></article>
          <article class="info-card"><span class="info-icon">0</span><h3>启动零扫描</h3><p>程序启动只初始化界面。只有你查看并确认扫描计划后，才读取指定的 Codex 数据目录。</p></article>
          <article class="info-card"><span class="info-icon">↗</span><h3>禁止写回源目录</h3><p>任何导出目标只要位于 .codex 或 .gemini 目录内都会被拒绝。</p></article>
          <article class="info-card"><span class="info-icon">K</span><h3>不读取认证文件</h3><p>扫描器不会读取 auth.json、OAuth Token、Cookie 或其他登录凭据文件。</p></article>
          <article class="info-card"><span class="info-icon">!</span><h3>敏感信息预检</h3><p>默认只检查最终会写入精简交接 Markdown 的文本；开启过程细节后会扩大到完整导出内容。</p></article>
          <article class="info-card"><span class="info-icon">✓</span><h3>原子导出</h3><p>先写独立临时文件，完整成功后才重命名为最终 Markdown，已有目标文件默认不覆盖。</p></article>
        </div>
      </template>

      <template v-else>
        <header class="page-header simple"><div><h1>关于</h1><p>轻量、只读、面向 AI 编程工具迁移的项目交接工具。</p></div></header>
        <div class="about-card"><div class="about-logo">CH</div><div><h2>CodexHandoff</h2><p class="about-version">v1.0.0 alpha 4</p><p>当前阶段专注 Codex → Antigravity。默认导出精简交接内容，只保留用户真实输入与每轮 Codex 最终可见回复。</p><p>架构：Tauri 2 + Rust + Vue 3。Windows 运行使用系统 WebView2，不依赖 .NET、Python 或 Node。</p></div></div>
      </template>
    </main>

    <div v-if="modal" class="modal-backdrop" @click.self="!exportBusy && (modal = null)">
      <div class="modal-card">
        <template v-if="modal === 'scan-plan'">
          <div class="modal-icon">⌁</div><h2>扫描执行计划</h2><p class="modal-lead">确认前不会读取 Codex 会话文件。</p>
          <div class="plan-box"><div><b>来源</b><span>{{ root }}</span></div><div><b>将读取</b><span>最新 state_N.sqlite（只读主索引）、sessions、archived_sessions、session_index.jsonl</span></div><div><b>扫描方式</b><span>先读取 Codex thread 索引，再用活动与归档 rollout 定位正文，按 thread ID 去重并用孤立 JSONL 补漏</span></div><div><b>项目归并</b><span>{{ mergeGitRoots ? '启用 Git 根目录归并' : '按 Codex cwd 原样归组' }}</span></div><div><b>不会执行</b><span>不修改、不删除、不移动、不重命名、不归档、不写入 .codex</span></div></div>
          <div class="modal-actions"><button class="secondary-button" @click="modal = null">取消</button><button class="primary-button" @click="confirmScan">确认并开始扫描</button></div>
        </template>
        <template v-else-if="modal === 'export-plan'">
          <div class="modal-icon">↗</div><h2>导出执行计划</h2><p class="modal-lead">先做只读预检，预检完成后仍需再次确认才会创建文件。</p>
          <div class="plan-box"><div><b>项目</b><span>{{ project?.displayPath }}</span></div><div><b>会话</b><span>{{ pendingExportSessions.length }} 个</span></div><div><b>输出</b><span>{{ outputPath }}</span></div><div><b>内容</b><span>{{ includeTools ? '你的消息、所有 Codex 可见回复、工具调用与结果、对话索引、Antigravity 接续说明' : '你的消息、每轮 Codex 最终可见回复、对话索引、Antigravity 接续说明' }}</span></div><div><b>模式</b><span>{{ includeTools ? '高级详细模式' : '精简交接模式（推荐）' }}</span></div><div><b>保护</b><span>敏感信息预检；临时文件 + 原子改名；已有文件不覆盖</span></div></div>
          <div class="modal-actions"><button class="secondary-button" @click="modal = null">取消</button><button class="primary-button" :disabled="exportBusy" @click="runPreflight">开始只读预检</button></div>
        </template>
        <template v-else-if="modal === 'sensitive'">
          <div class="modal-icon" :class="{ warning: preflight?.warnings.length }">{{ preflight?.warnings.length ? '!' : '✓' }}</div><h2>预检结果</h2><p class="modal-lead">{{ preflight?.warnings.length ? '发现需要你确认的风险项。程序不会擅自删除或改写聊天内容。' : '未发现常见明文凭据特征，可以继续导出。' }}</p>
          <div class="plan-box"><div><b>会话</b><span>{{ preflight?.sessionCount }} 个</span></div><div><b>读取量</b><span>{{ humanBytes(preflight?.totalBytes || 0) }}</span></div><template v-if="preflight && Object.keys(preflight.sensitiveHits).length"><div v-for="(count, name) in preflight.sensitiveHits" :key="name"><b>{{ name }}</b><span>{{ count }} 处疑似命中</span></div></template><div v-if="preflight?.warnings.length"><b>提醒</b><span>{{ preflight.warnings.join('；') }}</span></div></div>
          <div class="modal-actions"><button class="secondary-button" @click="modal = null">取消</button><button class="primary-button" @click="confirmExport">{{ preflight?.warnings.length ? '我已知晓，仍然导出' : '确认导出' }}</button></div>
        </template>
      </div>
    </div>

    <div v-if="resultOpen && exportResult" class="result-toast"><button class="close-result" @click="resultOpen = false">×</button><div class="result-check">✓</div><div class="result-body"><strong>导出完成</strong><span>{{ exportResult.sessionCount }} 个对话，{{ exportResult.messageCount }} 条交接消息，{{ humanBytes(exportResult.bytesWritten) }}</span><code>{{ exportResult.outputPath }}</code><div class="result-actions"><button @click="openPath(exportResult.outputPath, false)">打开文件</button><button @click="openPath(exportResult.outputPath, true)">打开文件夹</button><button class="primary-button" @click="copyAgyPrompt">复制 Antigravity 接续提示</button></div></div></div>
  </div>
</template>
