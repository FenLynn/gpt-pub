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
const includeTools = ref(true)
const scanBusy = ref(false)
const listBusy = ref(false)
const previewBusy = ref(false)
const exportBusy = ref(false)
const status = ref('等待手动扫描')
const progress = ref(0)
const logs = ref<string[]>([])
const logOpen = ref(true)
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
const selectionText = computed(() => {
  if (!project.value) return '未选择项目'
  if (selectionMode.value === 'project') return `项目全部 ${total.value} 个会话`
  return `已选择 ${selected.size} 个会话`
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
      for (const s of sessions.value) selected.set(s.id, s)
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
    preflight.value = await preflightExport(pendingExportSessions.value)
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
    appendLog(`导出完成：${result.outputPath}，${result.sessionCount} 个会话，${result.messageCount} 条可见消息，${humanBytes(result.bytesWritten)}，耗时 ${result.elapsedMs} ms。`)
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
        <div>
          <div class="brand-name">CodexHandoff</div>
          <div class="brand-version">v1.0.0 alpha 2</div>
        </div>
      </div>
      <nav class="nav">
        <button :class="['nav-item', { active: page === 'export' }]" @click="page = 'export'"><span class="nav-icon">↗</span><span>对话导出</span></button>
        <button :class="['nav-item', { active: page === 'safety' }]" @click="page = 'safety'"><span class="nav-icon">◇</span><span>安全规则</span></button>
        <button :class="['nav-item', { active: page === 'about' }]" @click="page = 'about'"><span class="nav-icon">i</span><span>关于</span></button>
      </nav>
      <div class="side-footer"><span class="status-dot"></span><span>Codex 只读模式</span></div>
    </aside>

    <main class="main">
      <template v-if="page === 'export'">
        <header class="page-header">
          <div><h1>对话导出</h1><p>以 Codex state thread 为主索引，活动与归档会话统一整理为 Antigravity 可接续开发的 Markdown</p></div>
          <div class="route-brand"><div class="agent-badge"><span class="agent-icon codex-icon">C</span>Codex</div><span class="route-arrow">→</span><div class="agent-badge"><span class="agent-icon agy-icon">A</span>Antigravity</div></div>
        </header>

        <section class="source-row">
          <label>Codex 数据</label>
          <input v-model="root" class="text-input" :disabled="scanBusy || exportBusy" />
          <label class="mini-check" title="把同一 Git 仓库下不同 cwd 归到一起"><input v-model="mergeGitRoots" type="checkbox" :disabled="scanBusy || exportBusy" />Git 根目录归并</label>
          <button class="primary-button" :disabled="exportBusy" @click="scanBusy ? doCancelScan() : requestScan()">{{ scanBusy ? '取消扫描' : '开始扫描' }}</button>
        </section>

        <section class="project-row">
          <label>项目</label>
          <select v-model="projectKey" class="select-input" :disabled="!projects.length || scanBusy">
            <option value="">请选择项目</option>
            <option v-for="p in projects" :key="p.key" :value="p.key">{{ p.displayPath }}（{{ p.sessionCount }} 个：活动 {{ p.activeCount }} / 归档 {{ p.archivedCount }}）</option>
          </select>
        </section>

        <div class="workspace-grid">
          <section class="session-panel">
            <div class="section-title-row">
              <div><h2>对话 <span class="subtle">{{ total }} 个匹配会话</span></h2></div>
              <div class="table-actions"><button class="ghost-button" :disabled="!sessions.length" @click="selectWholeProject">全选项目</button><button class="ghost-button" :disabled="!sessions.length" @click="selectVisible">全选本页</button><button class="ghost-button" :disabled="!selected.size" @click="clearSelection">清空</button></div>
            </div>
            <div class="toolbar">
              <div class="search-box"><span>⌕</span><input v-model="search" placeholder="搜索对话标题" /></div>
              <select v-model="filter" class="compact-select"><option value="all">全部</option><option value="active">仅活动</option><option value="archived">仅归档</option><option value="7d">最近 7 天</option><option value="30d">最近 30 天</option></select>
              <label class="mini-check"><input v-model="includeArchived" type="checkbox" />包含归档</label>
              <label class="mini-check"><input v-model="includeInternal" type="checkbox" />内部/非用户线程</label>
            </div>
            <div class="session-table-wrap">
              <table class="session-table">
                <thead><tr><th class="check-col"></th><th>对话标题</th><th class="preview-col">最后用户输入</th><th class="date-col">最后活动</th></tr></thead>
                <tbody>
                  <tr v-if="listBusy"><td colspan="4" class="empty-cell">正在读取当前页…</td></tr>
                  <tr v-else-if="!sessions.length"><td colspan="4" class="empty-cell">{{ projects.length ? '当前筛选没有会话' : '请先手动扫描 Codex 数据' }}</td></tr>
                  <tr v-for="s in sessions" v-else :key="s.id" :class="{ current: current?.id === s.id }" @click="selectSession(s)">
                    <td class="check-col" @click.stop><input type="checkbox" :disabled="!s.bodyExists" :checked="s.bodyExists && (selectionMode === 'project' || selected.has(s.id))" @change="toggleSession(s, ($event.target as HTMLInputElement).checked)" /></td>
                    <td><div class="session-title">{{ s.title }}</div><div class="session-flags"><span v-if="s.archived" class="pill">归档</span><span v-if="s.internal || !s.hasUserEvent" class="pill warning">内部/非用户</span><span v-if="!s.bodyExists" class="pill warning">正文缺失</span></div></td>
                    <td class="preview-col"><span class="ellipsis">{{ s.bodyExists ? (s.lastUserPreview || '点击读取预览') : '仅有索引，正文文件缺失' }}</span></td>
                    <td class="date-col">{{ formatTime(s.modified) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="pager"><span>{{ selectionText }}</span><div class="pager-buttons"><button class="ghost-button" :disabled="pageIndex <= 0 || listBusy" @click="changePage(pageIndex - 1)">上一页</button><span>第 {{ pageIndex + 1 }} / {{ totalPages }} 页</span><button class="ghost-button" :disabled="pageIndex + 1 >= totalPages || listBusy" @click="changePage(pageIndex + 1)">下一页</button></div></div>
          </section>

          <section class="detail-panel">
            <div class="section-title-row"><h2>当前对话</h2></div>
            <div class="preview-card">
              <div v-if="previewBusy" class="empty-card">正在读取当前会话预览…</div>
              <div v-else-if="!current" class="empty-card">选择一条对话查看详情</div>
              <template v-else>
                <div class="detail-title">{{ current.title }}</div>
                <dl class="meta-list"><div><dt>项目</dt><dd>{{ current.cwd }}</dd></div><div><dt>时间</dt><dd>{{ preview?.created || formatTime(current.modified) }}</dd></div><div><dt>大小</dt><dd>{{ humanBytes(current.size) }}</dd></div></dl>
                <div class="last-user-label">最后用户输入</div><div class="last-user-text">{{ current.bodyExists ? (preview?.lastUser || current.lastUserPreview || '未找到可见用户输入') : 'Codex state 中存在该 thread，但 rollout 正文文件没有找到。' }}</div>
              </template>
            </div>
            <div class="export-options">
              <label class="check-row"><input v-model="includeTools" type="checkbox" /><span>包含关键工具调用与结果</span><small>单条工具结果最多 32 KB</small></label>
              <label class="field-label">输出文件</label><div class="output-row"><input v-model="outputPath" class="text-input" placeholder="CODEX-HANDOFF.md" /><button class="ghost-button" @click="chooseOutput">选择位置</button></div>
              <div class="safety-line"><span class="status-dot"></span><span>Codex 原始目录始终只读，输出路径禁止位于 .codex / .gemini</span></div>
            </div>
            <div class="action-row"><button v-if="exportBusy" class="danger-button" @click="doCancelExport">取消导出</button><button class="primary-button wide" :disabled="!project || scanBusy || exportBusy" @click="requestExportPlan">查看执行计划</button></div>
          </section>
        </div>

        <section class="activity-panel">
          <div class="activity-header"><div><strong>状态 / 进度</strong><span>{{ status }}</span></div><div class="activity-actions"><button class="text-button" @click="logOpen = !logOpen">{{ logOpen ? '收起日志' : '展开日志' }}</button><button class="text-button" :disabled="!logs.length" @click="logs = []">清空日志</button></div></div>
          <div class="progress-track"><div class="progress-bar" :style="{ width: `${progress}%` }"></div></div>
          <div v-if="logOpen" class="log-box"><div v-if="!logs.length" class="log-empty">尚无操作日志。软件启动不会自动扫描。</div><div v-for="(line, i) in logs" :key="i" class="log-line">{{ line }}</div></div>
        </section>
        <div v-if="errorText" class="error-banner">{{ errorText }}</div>
      </template>

      <template v-else-if="page === 'safety'">
        <header class="page-header simple"><div><h1>安全规则</h1><p>这些限制由程序底层固定，不依赖用户记忆。</p></div></header>
        <div class="info-grid">
          <article class="info-card"><h3>原始数据只读</h3><p>Codex 数据源只使用读取 API。不会删除、移动、重命名、归档、追加或覆盖任何原始会话、索引或数据库。</p></article>
          <article class="info-card"><h3>启动零扫描</h3><p>程序启动只初始化界面。只有你查看并确认扫描计划后，才读取指定的 Codex 数据目录。</p></article>
          <article class="info-card"><h3>禁止写回源目录</h3><p>任何导出目标只要位于 .codex 或 .gemini 目录内都会被拒绝。</p></article>
          <article class="info-card"><h3>不读取认证文件</h3><p>扫描器不会读取 auth.json、OAuth Token、Cookie 或其他登录凭据文件。</p></article>
          <article class="info-card"><h3>敏感信息预检</h3><p>正式写入 Markdown 前检查疑似 API Key、Bearer Token、access_token、refresh_token 与 password 字段，并把结果交给你确认。</p></article>
          <article class="info-card"><h3>原子导出</h3><p>先写独立临时文件，完整成功后才重命名为最终 Markdown。已有目标文件默认不覆盖。</p></article>
        </div>
      </template>

      <template v-else>
        <header class="page-header simple"><div><h1>关于</h1><p>CodexHandoff 是一个本地、只读、面向 AI 编程工具迁移的项目交接工具。</p></div></header>
        <div class="about-card"><div class="about-logo">CH</div><div><h2>CodexHandoff</h2><p class="about-version">v1.0.0 alpha 2</p><p>第一阶段专注于 Codex → Antigravity。会话发现以最新 state_N.sqlite 的 Codex thread 为主索引，同时扫描 sessions 与 archived_sessions 的 rollout JSONL 作为正文源和兜底，并按 thread ID 去重。</p><p>架构：Tauri 2 + Rust + Vue 3。Windows 运行依赖系统 WebView2，不依赖 .NET、Python 或 Node。</p></div></div>
      </template>
    </main>

    <div v-if="modal" class="modal-backdrop" @click.self="!exportBusy && (modal = null)">
      <div class="modal-card">
        <template v-if="modal === 'scan-plan'">
          <h2>扫描执行计划</h2><p class="modal-lead">确认前不会读取 Codex 会话文件。</p>
          <div class="plan-box"><div><b>来源</b><span>{{ root }}</span></div><div><b>将读取</b><span>最新 state_N.sqlite（只读主索引）、sessions、archived_sessions、session_index.jsonl</span></div><div><b>扫描方式</b><span>先读取 Codex thread 索引，再用活动与归档 rollout 定位正文，最后按 thread ID 去重并用孤立 JSONL 补漏；正文只在当前页预览或导出时深读取</span></div><div><b>项目归并</b><span>{{ mergeGitRoots ? '启用 Git 根目录归并' : '按 Codex cwd 原样归组' }}</span></div><div><b>不会执行</b><span>不修改、不删除、不移动、不重命名、不归档、不写入 .codex</span></div></div>
          <div class="modal-actions"><button class="ghost-button" @click="modal = null">取消</button><button class="primary-button" @click="confirmScan">确认并开始扫描</button></div>
        </template>
        <template v-else-if="modal === 'export-plan'">
          <h2>导出执行计划</h2><p class="modal-lead">先做只读预检，预检完成后仍需再次确认才会创建文件。</p>
          <div class="plan-box"><div><b>项目</b><span>{{ project?.displayPath }}</span></div><div><b>会话</b><span>{{ pendingExportSessions.length }} 个</span></div><div><b>输出</b><span>{{ outputPath }}</span></div><div><b>内容</b><span>用户消息、Codex 可见回复{{ includeTools ? '、关键工具调用与结果' : '' }}、对话索引、Antigravity 接续说明</span></div><div><b>保护</b><span>先进行敏感信息预检；正式导出采用临时文件 + 原子改名；已有文件不覆盖</span></div></div>
          <div class="modal-actions"><button class="ghost-button" @click="modal = null">取消</button><button class="primary-button" :disabled="exportBusy" @click="runPreflight">开始只读预检</button></div>
        </template>
        <template v-else-if="modal === 'sensitive'">
          <h2>预检结果</h2><p class="modal-lead">{{ preflight?.warnings.length ? '发现需要你确认的风险项。程序不会擅自删除或改写聊天内容。' : '未发现常见明文凭据特征，可以继续导出。' }}</p>
          <div class="plan-box"><div><b>会话</b><span>{{ preflight?.sessionCount }} 个</span></div><div><b>读取量</b><span>{{ humanBytes(preflight?.totalBytes || 0) }}</span></div><template v-if="preflight && Object.keys(preflight.sensitiveHits).length"><div v-for="(count, name) in preflight.sensitiveHits" :key="name"><b>{{ name }}</b><span>{{ count }} 处疑似命中</span></div></template><div v-if="preflight?.warnings.length"><b>提醒</b><span>{{ preflight.warnings.join('；') }}</span></div></div>
          <div class="modal-actions"><button class="ghost-button" @click="modal = null">取消</button><button class="primary-button" @click="confirmExport">{{ preflight?.warnings.length ? '我已知晓，仍然导出' : '确认导出' }}</button></div>
        </template>
      </div>
    </div>

    <div v-if="resultOpen && exportResult" class="result-toast"><button class="close-result" @click="resultOpen = false">×</button><div class="result-check">✓</div><div class="result-body"><strong>导出完成</strong><span>{{ exportResult.sessionCount }} 个对话，{{ exportResult.messageCount }} 条可见消息，{{ humanBytes(exportResult.bytesWritten) }}</span><code>{{ exportResult.outputPath }}</code><div class="result-actions"><button @click="openPath(exportResult.outputPath, false)">打开文件</button><button @click="openPath(exportResult.outputPath, true)">打开所在文件夹</button><button @click="copyAgyPrompt">复制 Antigravity 接续提示</button></div></div></div>
  </div>
</template>
