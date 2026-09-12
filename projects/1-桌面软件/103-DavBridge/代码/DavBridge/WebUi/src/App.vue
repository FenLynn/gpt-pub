<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { hasNativeBridge, invoke, onNotice, onSnapshot } from './bridge'
import { mockSnapshot } from './mock'
import type { DavBridgeSnapshot, PrimaryAction, RecycleGroup, RecycleKind } from './types'

type Tab = 'overview' | 'transfer' | 'recycle' | 'docs' | 'settings' | 'about'
const previewTab = new URLSearchParams(window.location.search).get('tab')
const initialTab:Tab = previewTab==='transfer'||previewTab==='recycle'||previewTab==='docs'||previewTab==='about' ? previewTab : 'overview'
const tab = ref<Tab>(initialTab)
const recycleFilter = ref<RecycleKind>('observing')
const snapshot = ref<DavBridgeSnapshot>(mockSnapshot)
const busy = ref(false)
const toast = ref('')
const notice = ref<{ title: string; message: string; tone: string } | null>(null)
const showActivity = ref(false)
const selected = ref(new Set<string>())
const pendingPrimaryAction = ref<PrimaryAction | null>(null)
const hoverTip = ref<{ text:string; left:number; top:number; above:boolean } | null>(null)
let activeTipTarget:HTMLElement|null=null
let detachSnapshot: (() => void) | undefined
let detachNotice: (() => void) | undefined
let toastTimer: number | undefined
let noticeTimer: number | undefined
const isNative = hasNativeBridge()
const coveragePercent = computed(() => Math.round(snapshot.value.coverage * 1000) / 10)
const uploadFraction = computed(() => Math.min(1, snapshot.value.quota.uploadUsed / Math.max(1, snapshot.value.quota.uploadMax)))
const downloadFraction = computed(() => Math.min(1, snapshot.value.quota.downloadUsed / Math.max(1, snapshot.value.quota.downloadMax)))
const filteredRecycle = computed(() => snapshot.value.recycle.filter(group => recycleFilter.value === 'observing' ? group.disposition === 'observing' : recycleFilter.value === 'review' ? group.disposition === 'review' || group.disposition === 'blocked' : group.disposition === 'history'))
const recycleCounts = computed(() => ({ observing: snapshot.value.recycle.filter(x => x.disposition === 'observing').length, review: snapshot.value.recycle.filter(x => x.disposition === 'review' || x.disposition === 'blocked').length, history: snapshot.value.recycle.filter(x => x.disposition === 'history').length }))
const quotaTip = computed(() => `${snapshot.value.cycleId ? `Cycle ${snapshot.value.cycleId}` : 'Cycle 未校准'}。额度按本地账本保守统计，重置后通过真实探测确认新周期。`)
const sideStatusTip = computed(() => `点击查看最近活动 · ${snapshot.value.routeStatus}${snapshot.value.cycleId ? ` · Cycle ${snapshot.value.cycleId}` : ''}`)
const sideStatusKind = computed(() => {
  if (pendingPrimaryAction.value === 'pause') return 'pause'
  if (pendingPrimaryAction.value === 'resume' || pendingPrimaryAction.value === 'retry') return 'run'
  const text = `${snapshot.value.engineState} ${snapshot.value.routeStatus}`
  if (/暂停/.test(text)) return 'pause'
  if (/运行|迁移中/.test(text)) return 'run'
  if (/网络/.test(text)) return 'network'
  if (/额度|周期/.test(text)) return 'wait'
  if (/人工|审查/.test(text)) return 'review'
  if (/完成/.test(text)) return 'complete'
  return 'idle'
})
const sideStatusText = computed(() => {
  if (pendingPrimaryAction.value === 'pause') return '正在暂停'
  if (pendingPrimaryAction.value === 'resume') return '正在继续'
  if (pendingPrimaryAction.value === 'retry') return '正在重试'
  return snapshot.value.engineState
})
const sideStatusSecondary = computed(() => {
  if (pendingPrimaryAction.value === 'pause') return '当前文件安全收尾后停止'
  if (pendingPrimaryAction.value === 'resume' || pendingPrimaryAction.value === 'retry') return snapshot.value.routeStatus || '正在恢复调度'
  if (snapshot.value.routeStatus && snapshot.value.routeStatus !== snapshot.value.engineState) return snapshot.value.routeStatus
  return snapshot.value.cycleId ? `Cycle ${snapshot.value.cycleId}` : '查看最近活动'
})
const taskStatusKind = computed(() => {
  if (pendingPrimaryAction.value === 'pause') return 'pause'
  if (pendingPrimaryAction.value === 'resume' || pendingPrimaryAction.value === 'retry') return 'run'
  return sideStatusKind.value
})
const taskStatusText = computed(() => {
  if (pendingPrimaryAction.value === 'pause') return '正在暂停'
  if (pendingPrimaryAction.value === 'resume') return '正在继续'
  if (pendingPrimaryAction.value === 'retry') return '正在重试'
  return snapshot.value.engineState
})
const taskStatusSecondary = computed(() => {
  const route=snapshot.value.routeStatus?.trim()
  if (route && route !== snapshot.value.engineState) return route
  if (snapshot.value.currentProgress !== null) return '当前任务执行中'
  return snapshot.value.cycleId ? `Cycle ${snapshot.value.cycleId}` : ''
})
const transferNextText = computed(() => {
  if (snapshot.value.humanActionCount > 0) return `先处理 ${snapshot.value.humanActionCount} 组人工审查，再继续自动队列`
  if (snapshot.value.primaryAction === 'resume') {
    if (snapshot.value.priorityCount > 0) return `恢复后先处理 ${snapshot.value.priorityCount} 组变化修复`
    if (snapshot.value.normalCount > 0) return `恢复后继续处理 ${snapshot.value.normalCount} 组普通迁移`
    return '恢复后重新检查当前清单'
  }
  return snapshot.value.currentDetail || snapshot.value.routeStatus
})
const resetLabel = computed(() => {
  const match = snapshot.value.quota.resetText.match(/(\d{4})-(\d{2})-(\d{2}).*?(\d{2}:\d{2})/)
  return match ? `${match[2]}/${match[3]} ${match[4]} 重置` : snapshot.value.quota.resetText
})
function formatQuotaBytes(bytes:number){
  return bytes >= 1_000_000_000 ? `${(bytes/1_000_000_000).toFixed(1)} GB` : `${(bytes/1_000_000).toFixed(1)} MB`
}
const uploadText = computed(() => `${formatQuotaBytes(snapshot.value.quota.uploadUsed)} / ${formatQuotaBytes(snapshot.value.quota.uploadMax)}`)
const downloadText = computed(() => `${formatQuotaBytes(snapshot.value.quota.downloadUsed)} / ${formatQuotaBytes(snapshot.value.quota.downloadMax)}`)
const automaticQueueCount = computed(() => snapshot.value.priorityCount + snapshot.value.normalCount)
const queueHeadline = computed(() => snapshot.value.humanActionCount > 0
  ? `${snapshot.value.humanActionCount} 组等待人工决定`
  : automaticQueueCount.value > 0
    ? `${automaticQueueCount.value} 组等待自动处理`
    : '当前队列已清空')
const initializedCount = computed(() => snapshot.value.initialization.filter(step=>step.done).length)
const buildDateLabel = computed(() => {
  if(!snapshot.value.buildDate) return '本地构建'
  const date=new Date(snapshot.value.buildDate)
  return Number.isNaN(date.getTime()) ? snapshot.value.buildDate : date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})
})

function tipElement(event:Event){
  const node=event.target instanceof Element ? event.target : null
  return node?.closest('[data-tip]') as HTMLElement | null
}
function showGlobalTip(event:Event){
  const target=tipElement(event)
  if(!target) return
  const related=(event as MouseEvent).relatedTarget
  if(related instanceof Node && target.contains(related)) return
  const value=target.dataset.tip?.trim()
  if(!value) return
  const rect=target.getBoundingClientRect()
  const above=rect.bottom+125>window.innerHeight && rect.top>140
  const half=180
  const left=Math.min(Math.max(rect.left+rect.width/2,half),Math.max(half,window.innerWidth-half))
  hoverTip.value={text:value,left,top:above?rect.top-9:rect.bottom+9,above}
  activeTipTarget=target
}
function hideGlobalTip(event:Event){
  if(!activeTipTarget) return
  const related=(event as MouseEvent).relatedTarget
  if(related instanceof Node && activeTipTarget.contains(related)) return
  const target=tipElement(event)
  if(target!==activeTipTarget) return
  hoverTip.value=null
  activeTipTarget=null
}
function clearGlobalTip(){ hoverTip.value=null; activeTipTarget=null }
function notify(message: string) { toast.value = message; if (toastTimer) window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => toast.value = '', 2600) }
function showNotice(value:{ title:string; message:string; tone:string }) {
  notice.value=value
  if(noticeTimer) window.clearTimeout(noticeTimer)
  noticeTimer=window.setTimeout(()=>notice.value=null, value.tone==='warning' ? 9000 : 6500)
}
async function refresh() { if (!isNative) return; try { snapshot.value = await invoke<DavBridgeSnapshot>('app.getSnapshot') } catch (error) { notify(error instanceof Error ? error.message : '状态读取失败') } }
async function command(method: string, params?: unknown) { if (!isNative || busy.value) return; busy.value = true; try { const result = await invoke<{ snapshot?: DavBridgeSnapshot; message?: string }>(method, params); if (result?.snapshot) snapshot.value = result.snapshot; if (result?.message) notify(result.message); await refresh() } catch (error) { notify(error instanceof Error ? error.message : '操作失败') } finally { busy.value = false } }
async function primaryAction() {
  const action=snapshot.value.primaryAction
  if (action === 'review') { tab.value='recycle'; recycleFilter.value='review'; return }
  if (action === 'settings') { await openSettings(); return }
  if (action !== 'pause' && action !== 'resume' && action !== 'retry') return
  pendingPrimaryAction.value=action
  try {
    if (action === 'pause') await command('migration.pause')
    if (action === 'resume') await command('migration.resume')
    if (action === 'retry') await command('migration.retry')
  } finally {
    pendingPrimaryAction.value=null
  }
}
function selectGroup(group: RecycleGroup) { const next = new Set(selected.value); next.has(group.groupKey) ? next.delete(group.groupKey) : next.add(group.groupKey); selected.value = next }
async function deferSelected() { const keys=[...selected.value]; if (!keys.length) return notify('请先选择待审查附件组'); await command('recycle.defer',{groupKeys:keys}); selected.value=new Set() }
async function deleteSelected() { const keys=[...selected.value]; if (!keys.length) return notify('请先选择待审查附件组'); if (!window.confirm(`准备审查删除 ${keys.length} 个附件组。DavBridge 还会显示一次原生最终确认，并在删除前重新核对源端与目标身份。继续吗？`)) return; await command('recycle.delete',{groupKeys:keys}); selected.value=new Set() }
function quotaClass(value:number){ const percent=Math.round(value*100); return percent>=80?'danger':percent>=60?'warn':'safe' }
async function calibrateQuota(){ await command('quota.calibrate') }
async function openSettings(){
  if(tab.value==='settings') return
  tab.value='settings'
  if(!isNative) return
  try {
    const result=await invoke<{ snapshot?: DavBridgeSnapshot }>('app.openSettings')
    if(result?.snapshot) snapshot.value=result.snapshot
  } catch(error) {
    notify(error instanceof Error ? error.message : '设置页打开失败')
  } finally {
    if(tab.value==='settings') tab.value='overview'
  }
}
async function navigate(next:Tab){
  if(tab.value==='settings'&&next!=='settings'&&isNative){
    tab.value=next
    try { await invoke('app.closeSettings') } catch(error) { notify(error instanceof Error ? error.message : '设置页关闭失败') }
    return
  }
  tab.value=next
}
function goOverview(){ if(tab.value==='settings'&&isNative) void invoke('app.closeSettings').catch(()=>{}); tab.value='overview' }
onMounted(async()=>{
  detachSnapshot=onSnapshot(value=>snapshot.value=value)
  detachNotice=onNotice(showNotice)
  window.addEventListener('davbridge:navigate-overview',goOverview)
  document.addEventListener('mouseover',showGlobalTip)
  document.addEventListener('mouseout',hideGlobalTip)
  window.addEventListener('scroll',clearGlobalTip,true)
  window.addEventListener('resize',clearGlobalTip)
  await refresh()
})
onBeforeUnmount(()=>{
  detachSnapshot?.()
  detachNotice?.()
  window.removeEventListener('davbridge:navigate-overview',goOverview)
  document.removeEventListener('mouseover',showGlobalTip)
  document.removeEventListener('mouseout',hideGlobalTip)
  window.removeEventListener('scroll',clearGlobalTip,true)
  window.removeEventListener('resize',clearGlobalTip)
  if(toastTimer) window.clearTimeout(toastTimer)
  if(noticeTimer) window.clearTimeout(noticeTimer)
})
</script>

<template>
<main class="app-shell">
  <aside class="sidebar">
    <div class="side-brand">
      <div class="brand-mark" aria-hidden="true"><span></span><span></span></div>
      <div class="brand-copy"><h1>DavBridge</h1><small>Zotero 镜像</small></div>
    </div>

    <nav class="side-nav" aria-label="主导航">
      <button :class="{active:tab==='overview'}" @click="navigate('overview')">
        <svg viewBox="0 0 24 24"><path d="M3.5 10.7 12 4l8.5 6.7v8.1c0 .9-.7 1.7-1.7 1.7h-4.6v-6h-4.4v6H5.2c-.9 0-1.7-.7-1.7-1.7Z"/></svg><span>总览</span>
      </button>
      <button :class="{active:tab==='transfer'}" @click="navigate('transfer')">
        <svg viewBox="0 0 24 24"><path d="M4 7.5h13"/><path d="m14 4.5 3 3-3 3"/><path d="M20 16.5H7"/><path d="m10 13.5-3 3 3 3"/></svg><span>转移</span>
      </button>
      <button :class="{active:tab==='recycle'}" @click="navigate('recycle')">
        <svg viewBox="0 0 24 24"><path d="M4.5 7h15"/><path d="M9 7V4.5h6V7"/><path d="m6.7 7 .8 12c.1.9.8 1.5 1.7 1.5h5.6c.9 0 1.6-.7 1.7-1.5l.8-12"/><path d="M10 10.5v6.5M14 10.5v6.5"/></svg><span>回收站</span><b v-if="snapshot.humanActionCount">{{ snapshot.humanActionCount }}</b>
      </button>
      <button :class="{active:tab==='docs'}" @click="navigate('docs')">
        <svg viewBox="0 0 24 24"><path d="M3.5 5.5c2.8-.8 5.6-.3 8.5 1.4v13c-2.9-1.7-5.7-2.2-8.5-1.4Z"/><path d="M20.5 5.5c-2.8-.8-5.6-.3-8.5 1.4v13c2.9-1.7 5.7-2.2 8.5-1.4Z"/></svg><span>文档</span>
      </button>
    </nav>

    <div class="side-spacer"></div>
    <nav class="side-nav side-secondary">
      <button :class="{active:tab==='settings'}" @click="openSettings">
        <svg class="settings-gear" viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/></svg><span>设置</span>
      </button>
      <button :class="{active:tab==='about'}" @click="navigate('about')">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 10v6m0-9v.2"/></svg><span>关于</span>
      </button>
    </nav>

    <button type="button" class="side-status has-tip" :class="`state-${sideStatusKind}`" :data-tip="sideStatusTip" @click="showActivity=true">
      <span class="side-status-icon" :class="`tone-${snapshot.routeTone}`" aria-hidden="true">
        <svg v-if="sideStatusKind==='pause'" viewBox="0 0 24 24"><rect x="7" y="5" width="3.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="3.2" height="14" rx="1.2"/></svg>
        <svg v-else-if="sideStatusKind==='run'" viewBox="0 0 24 24"><path d="M8 5.5 18 12 8 18.5Z"/></svg>
        <svg v-else-if="sideStatusKind==='network'" viewBox="0 0 24 24"><path d="M5 10.5a10 10 0 0 1 14 0M8 14a6 6 0 0 1 8 0M11.2 17.2a1.2 1.2 0 1 1 1.6 0"/></svg>
        <svg v-else-if="sideStatusKind==='wait'" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"/><path d="M12 7.5V12l3 2"/></svg>
        <svg v-else-if="sideStatusKind==='review'" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7.5v6M12 16.8v.2"/></svg>
        <svg v-else-if="sideStatusKind==='complete'" viewBox="0 0 24 24"><path d="m6.5 12.5 3.3 3.3 7.8-8"/></svg>
        <svg v-else viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/></svg>
      </span>
      <div><strong>{{ sideStatusText }}</strong><small>{{ sideStatusSecondary }}</small></div>
    </button>
  </aside>

  <section class="workspace">
    <header v-if="!snapshot.configured" class="workspace-head config-only-head">
      <div class="top-actions">
        <button class="config-warning has-tip" data-tip="需要打开设置补充配置" @click="openSettings" :disabled="busy"><i></i>需要配置</button>
      </div>
    </header>

    <section v-if="tab==='overview'" class="page overview-page">
      <div v-if="snapshot.humanActionCount" class="attention-card" @click="tab='recycle'; recycleFilter='review'">
        <strong>需要人工审查</strong><span>{{ snapshot.humanActionCount }} 个附件组</span><button>前往审查</button>
      </div>

      <section class="route-card route-card-polished">
        <div class="endpoint source has-tip" data-tip="InfiniCLOUD 是唯一 authoritative source，DavBridge 对源端只读">
          <svg class="cloud-logo" viewBox="0 0 56 38" aria-hidden="true">
            <path class="cloud-fill" d="M16.5 31.5h25.2c7.3 0 11.8-4.2 11.8-10.2 0-5.8-4.1-9.6-9.8-10.1C40.9 4.9 35.7 2 29.7 2 22 2 15.8 7.2 14.6 14.5 7.6 15 3 18.8 3 24.1c0 4.4 3.9 7.4 13.5 7.4Z"/>
            <path class="cloud-highlight" d="M15.8 26.5h27.4"/>
          </svg>
          <strong>InfiniCLOUD</strong>
        </div>
        <div class="route-core has-tip" :data-tip="snapshot.routeStatus">
          <svg class="route-arrow-art" viewBox="0 0 420 48" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="routeArrowGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stop-color="#bfeaf5"/>
                <stop offset="54%" stop-color="#5fc1ef"/>
                <stop offset="100%" stop-color="#1789e8"/>
              </linearGradient>
            </defs>
            <path d="M26 24 H394 L378 8 M394 24 L378 40"/>
          </svg>
        </div>
        <div class="endpoint target has-tip" data-tip="坚果云保存经过 StrongVerified 的强校验镜像">
          <svg class="nut-logo" viewBox="0 0 56 50" aria-hidden="true">
            <path class="nut-body" d="M9 22.5C9 14.7 16.5 10 28 10s19 4.7 19 12.5C47 33 39.5 42 28 46 16.5 42 9 33 9 22.5Z"/>
            <path class="nut-cap" d="M7.5 21.2C12.2 12.4 19 8.2 28 8.2s15.8 4.2 20.5 13c-11.6 4.2-29.4 4.2-41 0Z"/>
            <path class="nut-stem" d="M28 8.8C28 5.8 29.6 3.5 32.6 2.2"/>
            <path class="nut-leaf" d="M33.2 7.7c2.7-4.2 7.4-5.7 11.4-4.1-1.1 4.3-4.6 6.6-10.3 6.7Z"/>
          </svg>
          <strong>坚果云</strong>
        </div>

        <div class="phase-row">
          <div v-for="(phase,index) in snapshot.phases" :key="phase.key" class="phase-wrap">
            <div class="phase has-tip" :class="phase.state" :data-tip="phase.hint">
              <span class="phase-icon" aria-hidden="true">
                <svg v-if="phase.state==='done'" class="phase-check" viewBox="0 0 24 24"><path d="m5.5 12.5 4.2 4.2 8.8-9.4"/></svg>
                <span v-else-if="phase.state==='active'" class="phase-pulse"></span>
                <span v-else class="phase-idle-dot" :class="{warning:phase.state==='warning'}"></span>
              </span>
              <strong>{{ phase.label }}</strong>
            </div>
            <span v-if="index<snapshot.phases.length-1" class="phase-connector"></span>
          </div>
        </div>
      </section>

      <div class="dashboard-grid">
        <article class="dashboard-card coverage-card">
          <div class="feature-icon coverage-feature" aria-hidden="true"><svg class="coverage-glyph" viewBox="0 0 48 48"><path class="coverage-axis" d="M10 38h28"/><rect x="12" y="25" width="6" height="10" rx="3"/><rect x="21" y="18" width="6" height="17" rx="3"/><rect x="30" y="11" width="6" height="24" rx="3"/></svg></div>
          <div class="coverage-copy">
            <div class="card-title"><h3>镜像覆盖</h3><span class="info-dot has-tip" data-tip="StrongVerified 表示源端与目标端均重新读取并完成 SHA-256 一致性验证">i</span></div>
            <span class="coverage-count">{{ snapshot.verified }} / {{ snapshot.total }} 已校准</span>
          </div>
          <div class="progress-track coverage-progress"><i :style="{width:`${coveragePercent}%`}"></i></div>
          <b class="coverage-percent">{{ coveragePercent }}<small>%</small></b>
        </article>

        <article class="dashboard-card quota-card">
          <div class="feature-icon quota-feature" aria-hidden="true"><svg class="quota-glyph" viewBox="0 0 48 48"><path d="M16 35V13m0 0-5 5M16 13l5 5M32 13v22m0 0-5-5M32 35l5-5"/></svg></div>
          <div class="quota-content">
            <div class="quota-head">
              <div class="card-title"><h3>流量预算</h3><span class="info-dot has-tip" :data-tip="quotaTip">i</span></div>
              <span class="quota-reset has-tip" :data-tip="snapshot.quota.resetText">{{ resetLabel }}</span>
              <button class="quota-calibrate has-tip" data-tip="按坚果云账户页当前显示值重新校准本周期上传、下载已用量与重置日期" @click="calibrateQuota" :disabled="busy">校准</button>
            </div>
            <div class="quota-columns">
              <div class="quota-item">
                <span class="quota-arrow up">↑</span>
                <div class="quota-main">
                  <div class="quota-text"><span>上传</span><strong>{{ uploadText }}</strong></div>
                  <div class="quota-track" :class="quotaClass(uploadFraction)"><i :style="{width:`${uploadFraction*100}%`}"></i></div>
                </div>
                <b class="quota-percent" :class="quotaClass(uploadFraction)">{{ Math.round(uploadFraction*100) }}<small>%</small></b>
              </div>
              <div class="quota-item">
                <span class="quota-arrow down">↓</span>
                <div class="quota-main">
                  <div class="quota-text"><span>下载</span><strong>{{ downloadText }}</strong></div>
                  <div class="quota-track" :class="quotaClass(downloadFraction)"><i :style="{width:`${downloadFraction*100}%`}"></i></div>
                </div>
                <b class="quota-percent" :class="quotaClass(downloadFraction)">{{ Math.round(downloadFraction*100) }}<small>%</small></b>
              </div>
            </div>
          </div>
        </article>

        <article class="dashboard-card task-card">
          <div class="feature-icon task-feature" aria-hidden="true"><span>▤</span></div>
          <div class="task-copy">
            <div class="card-title"><h3>当前任务</h3><span class="info-dot has-tip" :data-tip="snapshot.currentDetail">i</span></div>
            <span class="task-name">{{ snapshot.currentTitle }}</span>
          </div>

          <div class="task-center">
            <div class="task-status">
              <span class="task-status-icon" :class="[`tone-${snapshot.routeTone}`,`state-${taskStatusKind}`]" aria-hidden="true">
                <svg v-if="taskStatusKind==='pause'" viewBox="0 0 24 24"><rect x="7" y="5" width="3.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="3.2" height="14" rx="1.2"/></svg>
                <svg v-else-if="taskStatusKind==='run'" viewBox="0 0 24 24"><path d="M8 5.5 18 12 8 18.5Z"/></svg>
                <svg v-else-if="taskStatusKind==='network'" viewBox="0 0 24 24"><path d="M5 10.5a10 10 0 0 1 14 0M8 14a6 6 0 0 1 8 0M11.2 17.2a1.2 1.2 0 1 1 1.6 0"/></svg>
                <svg v-else-if="taskStatusKind==='wait'" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"/><path d="M12 7.5V12l3 2"/></svg>
                <svg v-else-if="taskStatusKind==='review'" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7.5v6M12 16.8v.2"/></svg>
                <svg v-else-if="taskStatusKind==='complete'" viewBox="0 0 24 24"><path d="m6.5 12.5 3.3 3.3 7.8-8"/></svg>
                <svg v-else viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/></svg>
              </span>
              <div><strong>{{ taskStatusText }}</strong><small v-if="taskStatusSecondary">{{ taskStatusSecondary }}</small></div>
            </div>
            <div v-if="snapshot.currentProgress!==null" class="task-progress task-progress-center">
              <div class="progress-track"><i :style="{width:`${snapshot.currentProgress*100}%`}"></i></div>
              <strong>{{ Math.round(snapshot.currentProgress*100) }}%</strong>
            </div>
          </div>

          <div class="task-action-row">
            <button class="primary-button" :class="[`action-${snapshot.primaryAction}`]" v-if="snapshot.primaryAction!=='none'" @click="primaryAction" :disabled="busy" :aria-busy="busy">
              <svg v-if="snapshot.primaryAction==='pause'" class="action-icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="4" width="3" height="12" rx="1"/><rect x="12" y="4" width="3" height="12" rx="1"/></svg>
              <svg v-else-if="snapshot.primaryAction==='resume'" class="action-icon action-icon-play" viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 4.8 15 10l-8.5 5.2Z"/></svg>
              <svg v-else-if="snapshot.primaryAction==='retry'" class="action-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 7.4A6 6 0 1 0 16 12" fill="none"/><path d="m12.8 4.5 3.1 2.8-3.6 2" fill="none"/></svg>
              <svg v-else-if="snapshot.primaryAction==='review'" class="action-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4.5h10v11H5Z" fill="none"/><path d="M7.5 8h5M7.5 11h5" fill="none"/></svg>
              <svg v-else-if="snapshot.primaryAction==='settings'" class="action-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="2.5" fill="none"/><circle cx="10" cy="10" r="6" fill="none"/></svg>
              {{ snapshot.primaryLabel }}
            </button>
          </div>
        </article>
      </div>
    </section>

    <section v-else-if="tab==='transfer'" class="page transfer-page">
      <section class="transfer-head">
        <div>
          <span>迁移队列</span>
          <strong>{{ queueHeadline }}</strong>
        </div>
        <div class="transfer-head-state">
          <strong>{{ snapshot.currentTitle }}</strong>
          <small><template v-if="snapshot.cycleId">Cycle {{ snapshot.cycleId }} · </template>{{ snapshot.routeStatus }}</small>
        </div>
      </section>

      <section class="transfer-list" aria-label="迁移队列概览">
        <article class="transfer-row">
          <div class="transfer-feature repair-feature" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M35.5 19A13 13 0 1 0 37 29"/><path d="M35.5 19V10m0 9h-9"/></svg></div>
          <div class="transfer-label"><div class="card-title"><h3>变化修复</h3><span class="info-dot has-tip" data-tip="历史 StrongVerified 附件组发生真实内容变化时优先处理，先恢复既有镜像一致性。">i</span></div></div>
          <b class="transfer-count repair">{{ snapshot.priorityCount }}</b>
        </article>
        <article class="transfer-row">
          <div class="transfer-feature normal-feature" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M11 24h24"/><path d="m29 17 7 7-7 7"/></svg></div>
          <div class="transfer-label"><div class="card-title"><h3>普通迁移</h3><span class="info-dot has-tip" data-tip="尚未迁移的既有 backlog 与本周期新增附件进入同一个普通队列，按安全调度顺序处理。">i</span></div></div>
          <b class="transfer-count normal">{{ snapshot.normalCount }}</b>
        </article>
        <article class="transfer-row">
          <div class="transfer-feature review-feature" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M24 8 37 13v10c0 8.5-5.4 13.8-13 17-7.6-3.2-13-8.5-13-17V13Z"/><path d="m18.5 24 4 4 7.5-8"/></svg></div>
          <div class="transfer-label"><div class="card-title"><h3>人工审查</h3><span class="info-dot has-tip" data-tip="只有跨周期仍从源端缺失的历史 StrongVerified 附件组才需要人工决定保留或删除。">i</span></div></div>
          <b class="transfer-count review" :class="{attention:snapshot.humanActionCount>0}">{{ snapshot.humanActionCount }}</b>
        </article>
      </section>

      <section class="transfer-action">
        <div><span>{{ snapshot.primaryAction==='resume' ? '恢复后' : '当前动作' }}</span><strong>{{ transferNextText }}</strong></div>
        <span>{{ snapshot.routeStatus }}</span>
      </section>

      <div class="coverage-footer"><span>总体镜像覆盖</span><div class="progress-track"><i :style="{width:`${coveragePercent}%`}"></i></div><strong>{{ snapshot.verified }} / {{ snapshot.total }} · {{ coveragePercent }}%</strong></div>
    </section>

    <section v-else-if="tab==='recycle'" class="page recycle-page">
      <div class="recycle-tabs"><button :class="{active:recycleFilter==='observing'}" @click="recycleFilter='observing';selected=new Set()">待观察 <span>{{ recycleCounts.observing }}</span></button><button :class="{active:recycleFilter==='review'}" @click="recycleFilter='review';selected=new Set()">待审查 <span>{{ recycleCounts.review }}</span></button><button :class="{active:recycleFilter==='history'}" @click="recycleFilter='history';selected=new Set()">已处理 <span>{{ recycleCounts.history }}</span></button></div>
      <div class="recycle-table-wrap"><table class="recycle-table"><thead><tr><th v-if="recycleFilter==='review'" class="check-col"></th><th>附件组</th><th>首次缺失</th><th>上次决定</th><th>历史大小</th><th>最后强校验</th><th>状态</th></tr></thead><tbody>
        <tr v-for="group in filteredRecycle" :key="group.groupKey" :class="{selected:selected.has(group.groupKey)}" @click="recycleFilter==='review'&&selectGroup(group)" :title="group.issue||group.groupKey"><td v-if="recycleFilter==='review'" class="check-col"><input type="checkbox" :checked="selected.has(group.groupKey)" @click.stop="selectGroup(group)"/></td><td><strong>{{ group.name }}</strong></td><td>{{ group.firstMissing||'无' }}</td><td>{{ group.lastDecision||'无' }}</td><td>{{ group.sizeText }}</td><td>{{ group.verifiedText||'无' }}</td><td><span class="state-pill" :class="group.disposition">{{ group.state }}</span></td></tr>
        <tr v-if="!filteredRecycle.length"><td :colspan="recycleFilter==='review'?7:6" class="empty-cell">当前没有这一类附件组</td></tr>
      </tbody></table></div>
      <footer v-if="recycleFilter==='review'&&filteredRecycle.length" class="recycle-actions"><span>已选 {{ selected.size }} 组</span><div><button class="secondary-button" @click="deferSelected" :disabled="busy">本周期继续保留</button><button class="danger-button" @click="deleteSelected" :disabled="busy">删除所选</button></div></footer>
    </section>

    <section v-else-if="tab==='docs'" class="page docs-page">
      <article class="doc-content">
        <section id="overview-doc"><h2>DavBridge 是什么</h2><p>DavBridge 长期维护 Zotero 附件从 InfiniCLOUD 到坚果云的单向强校验镜像。InfiniCLOUD 始终是唯一 authoritative source，坚果云只保存已经确认或正在建立的镜像副本。</p></section>
        <section id="mirror-doc"><h2>镜像原则</h2><p>源端只读，不做双向同步，不把坚果云变化反写 InfiniCLOUD。Zotero 的 <code>.zip + .prop</code> 作为逻辑附件组处理。</p></section>
        <section id="verified-doc"><h2>StrongVerified</h2><p>只有读取源端并计算 SHA-256，目标建立后重新 GET 并计算 SHA-256，且两端完全一致时才记录 StrongVerified。历史 GoodSync 副本也必须经过相同双端强校验才能接管。</p></section>
        <section id="cycle-doc"><h2>Cycle 与额度</h2><p>Cycle 直接使用坚果云真实额度重置日期，例如 <code>260907</code>。到重置日 09:00 以后通过真实上传探测确认服务周期已经刷新，再进入新 Cycle。</p></section>
        <section id="audit-doc"><h2>每周期源端对账</h2><p>新 Cycle 先读取 InfiniCLOUD manifest。metadata 不变不重新读取内容，metadata 变化才重新计算源 SHA-256。SHA 真变化才进入 SourceChanged 并优先修复，新增对象不插队。</p></section>
        <section id="recycle-doc"><h2>回收站</h2><p>历史 StrongVerified 附件组第一次完整消失只观察。至少跨到后续确认 Cycle 仍完整缺失后才进入待审查。本周期保留的对象下个周期仍缺失会再次出现。</p></section>
        <section id="delete-doc"><h2>删除安全</h2><p>DELETE 永远不会后台自动发生。人工确认后，C# 安全链仍会重新检查源端、Zotero 组完整性和目标身份。任何异常都会停止删除，前端不能直接向 WebDAV 发送 DELETE。</p></section>
        <section id="faq-doc"><h2>常见问题</h2><details><summary>为什么新增文件不优先？</summary><p>新增对象与尚未迁移的 backlog 本质相同，因此进入同一个普通池。只有已存在镜像发生真实源端变化时才优先修复。</p></details><details><summary>Vue 能读取密码或直接删除文件吗？</summary><p>不能。Web 界面只接收安全 DTO，并通过固定白名单命令请求 C# 宿主执行操作。密码、DPAPI、WebDAV 客户端和真正写入逻辑不进入 JavaScript。</p></details></section>
      </article>
    </section>

    <section v-else class="page about-page">
      <article class="about-card">
        <div class="about-logo"><span></span><span></span></div>
        <h2>DavBridge</h2>
        <p>安全、持续地维护 Zotero 单向强校验镜像。</p>
        <dl>
          <div><dt>版本</dt><dd>v{{ snapshot.version }}</dd></div>
          <div><dt>构建</dt><dd>{{ snapshot.buildCommit || 'local' }} · {{ buildDateLabel }}</dd></div>
          <div><dt>运行环境</dt><dd :class="`health-text ${snapshot.health.status}`">{{ snapshot.health.summary }}</dd></div>
          <div><dt>运行会话</dt><dd>{{ snapshot.runtime.uptimeText }} · {{ snapshot.runtime.previousExitText }}</dd></div>
          <div><dt>初始化</dt><dd>{{ initializedCount }} / {{ snapshot.initialization.length }} 项完成</dd></div>
          <div><dt>引擎</dt><dd>.NET 8 + WebView2</dd></div>
          <div><dt>界面</dt><dd>Vue 3</dd></div>
        </dl>
      </article>
    </section>
  </section>

  <aside v-if="showActivity" class="activity-drawer" aria-label="最近活动">
    <header><div><span>最近活动</span><small>只记录状态事件，不记录文件名与凭据</small></div><button aria-label="关闭最近活动" @click="showActivity=false">×</button></header>
    <div class="activity-list">
      <article v-for="item in snapshot.activities" :key="item.time+item.title" :class="`tone-${item.tone}`">
        <time>{{ item.time }}</time><div><strong>{{ item.title }}</strong><span>{{ item.detail }}</span></div>
      </article>
      <p v-if="!snapshot.activities.length" class="activity-empty">暂时没有活动记录</p>
    </div>
  </aside>

  <div v-if="notice" class="notice-banner" :class="`tone-${notice.tone}`" role="status">
    <span class="notice-mark" aria-hidden="true">{{ notice.tone==='success' ? '✓' : notice.tone==='warning' ? '!' : 'i' }}</span>
    <div><strong>{{ notice.title }}</strong><span>{{ notice.message }}</span></div>
    <button aria-label="关闭提示" @click="notice=null">×</button>
  </div>
  <Teleport to="body"><div v-if="hoverTip" class="global-tooltip" :class="{above:hoverTip.above}" :style="{left:`${hoverTip.left}px`,top:`${hoverTip.top}px`}">{{ hoverTip.text }}</div></Teleport>
  <div v-if="toast" class="toast" role="status">{{ toast }}</div>
</main>
</template>
