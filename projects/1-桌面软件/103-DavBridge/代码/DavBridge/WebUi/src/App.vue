<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { hasNativeBridge, invoke, onSnapshot } from './bridge'
import { mockSnapshot } from './mock'
import type { DavBridgeSnapshot, RecycleGroup, RecycleKind } from './types'

type Tab = 'overview' | 'transfer' | 'recycle' | 'docs' | 'about'
const tab = ref<Tab>('overview')
const recycleFilter = ref<RecycleKind>('observing')
const snapshot = ref<DavBridgeSnapshot>(mockSnapshot)
const busy = ref(false)
const toast = ref('')
const selected = ref(new Set<string>())
let detachSnapshot: (() => void) | undefined
let toastTimer: number | undefined
const isNative = hasNativeBridge()
const coveragePercent = computed(() => Math.round(snapshot.value.coverage * 1000) / 10)
const uploadFraction = computed(() => Math.min(1, snapshot.value.quota.uploadUsed / Math.max(1, snapshot.value.quota.uploadMax)))
const downloadFraction = computed(() => Math.min(1, snapshot.value.quota.downloadUsed / Math.max(1, snapshot.value.quota.downloadMax)))
const filteredRecycle = computed(() => snapshot.value.recycle.filter(group => recycleFilter.value === 'observing' ? group.disposition === 'observing' : recycleFilter.value === 'review' ? group.disposition === 'review' || group.disposition === 'blocked' : group.disposition === 'history'))
const recycleCounts = computed(() => ({ observing: snapshot.value.recycle.filter(x => x.disposition === 'observing').length, review: snapshot.value.recycle.filter(x => x.disposition === 'review' || x.disposition === 'blocked').length, history: snapshot.value.recycle.filter(x => x.disposition === 'history').length }))
const quotaTip = computed(() => `${snapshot.value.cycleId ? `Cycle ${snapshot.value.cycleId}` : 'Cycle 未校准'}。额度按本地账本保守统计，重置后通过真实探测确认新周期。`)
const sideStatusTip = computed(() => `${snapshot.value.routeStatus}${snapshot.value.cycleId ? ` · Cycle ${snapshot.value.cycleId}` : ''}`)
const resetLabel = computed(() => {
  const match = snapshot.value.quota.resetText.match(/(\d{4})-(\d{2})-(\d{2}).*?(\d{2}:\d{2})/)
  return match ? `${match[2]}/${match[3]} ${match[4]} 重置` : snapshot.value.quota.resetText
})
function formatQuotaBytes(bytes:number){
  return bytes >= 1_000_000_000 ? `${(bytes/1_000_000_000).toFixed(1)} GB` : `${(bytes/1_000_000).toFixed(1)} MB`
}
const uploadText = computed(() => `${formatQuotaBytes(snapshot.value.quota.uploadUsed)} / ${formatQuotaBytes(snapshot.value.quota.uploadMax)}`)
const downloadText = computed(() => `${formatQuotaBytes(snapshot.value.quota.downloadUsed)} / ${formatQuotaBytes(snapshot.value.quota.downloadMax)}`)

function notify(message: string) { toast.value = message; if (toastTimer) window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => toast.value = '', 2600) }
async function refresh() { if (!isNative) return; try { snapshot.value = await invoke<DavBridgeSnapshot>('app.getSnapshot') } catch (error) { notify(error instanceof Error ? error.message : '状态读取失败') } }
async function command(method: string, params?: unknown) { if (!isNative || busy.value) return; busy.value = true; try { const result = await invoke<{ snapshot?: DavBridgeSnapshot; message?: string }>(method, params); if (result?.snapshot) snapshot.value = result.snapshot; if (result?.message) notify(result.message); await refresh() } catch (error) { notify(error instanceof Error ? error.message : '操作失败') } finally { busy.value = false } }
async function primaryAction() { if (snapshot.value.primaryAction === 'review') { tab.value='recycle'; recycleFilter.value='review'; return } if (snapshot.value.primaryAction === 'pause') await command('migration.pause'); if (snapshot.value.primaryAction === 'resume') await command('migration.resume') }
function selectGroup(group: RecycleGroup) { const next = new Set(selected.value); next.has(group.groupKey) ? next.delete(group.groupKey) : next.add(group.groupKey); selected.value = next }
async function deferSelected() { const keys=[...selected.value]; if (!keys.length) return notify('请先选择待审查附件组'); await command('recycle.defer',{groupKeys:keys}); selected.value=new Set() }
async function deleteSelected() { const keys=[...selected.value]; if (!keys.length) return notify('请先选择待审查附件组'); if (!window.confirm(`准备审查删除 ${keys.length} 个附件组。DavBridge 还会显示一次原生最终确认，并在删除前重新核对源端与目标身份。继续吗？`)) return; await command('recycle.delete',{groupKeys:keys}); selected.value=new Set() }
function quotaClass(value:number){ return value>=.9?'danger':value>=.6?'warn':'safe' }
function goOverview(){ tab.value='overview' }
onMounted(async()=>{ detachSnapshot=onSnapshot(value=>snapshot.value=value); window.addEventListener('davbridge:navigate-overview',goOverview); await refresh() })
onBeforeUnmount(()=>{ detachSnapshot?.(); window.removeEventListener('davbridge:navigate-overview',goOverview); if(toastTimer) window.clearTimeout(toastTimer) })
</script>

<template>
<main class="app-shell">
  <aside class="sidebar">
    <div class="side-brand">
      <div class="brand-mark" aria-hidden="true"><span></span><span></span></div>
      <div class="brand-copy"><h1>DavBridge</h1><small>Zotero 镜像</small></div>
    </div>

    <nav class="side-nav" aria-label="主导航">
      <button :class="{active:tab==='overview'}" @click="tab='overview'">
        <svg viewBox="0 0 24 24"><path d="M3 11.2 12 4l9 7.2v8.3a1.5 1.5 0 0 1-1.5 1.5h-5v-6h-5v6h-5A1.5 1.5 0 0 1 3 19.5Z"/></svg><span>总览</span>
      </button>
      <button :class="{active:tab==='transfer'}" @click="tab='transfer'">
        <svg viewBox="0 0 24 24"><path d="M4 8h13m0 0-3.5-3.5M17 8l-3.5 3.5M20 16H7m0 0 3.5-3.5M7 16l3.5 3.5"/></svg><span>转移</span>
      </button>
      <button :class="{active:tab==='recycle'}" @click="tab='recycle'">
        <svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg><span>回收站</span><b v-if="snapshot.humanActionCount">{{ snapshot.humanActionCount }}</b>
      </button>
      <button :class="{active:tab==='docs'}" @click="tab='docs'">
        <svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11a3 3 0 0 1 3 3v15a3 3 0 0 0-3-3H6.5A2.5 2.5 0 0 0 4 20.5Zm16 0A2.5 2.5 0 0 0 17.5 3H14v18a3 3 0 0 1 3-3h.5a2.5 2.5 0 0 1 2.5 2.5Z"/></svg><span>文档</span>
      </button>
    </nav>

    <div class="side-spacer"></div>
    <nav class="side-nav side-secondary">
      <button @click="command('app.openSettings')" :disabled="busy">
        <svg viewBox="0 0 24 24"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5 1.1 2.1 2.3.6 2-1.1 1.5 1.5-1.1 2 .6 2.3 2.1 1.1v2l-2.1 1.1-.6 2.3 1.1 2-1.5 1.5-2-1.1-2.3.6L12 20.5h-2l-1.1-2.1-2.3-.6-2 1.1-1.5-1.5 1.1-2-.6-2.3L1.5 12v-2l2.1-1.1.6-2.3-1.1-2 1.5-1.5 2 1.1 2.3-.6L10 1.5h2Z"/></svg><span>设置</span>
      </button>
      <button :class="{active:tab==='about'}" @click="tab='about'">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 10v6m0-9v.2"/></svg><span>关于</span>
      </button>
    </nav>

    <div class="side-status has-tip" :data-tip="sideStatusTip">
      <i :class="`tone-${snapshot.routeTone}`"></i>
      <strong>{{ snapshot.engineState }}</strong>
    </div>
  </aside>

  <section class="workspace">
    <header class="workspace-head">
      <div class="welcome"><h2>{{ tab==='overview' ? '你好，DavBridge' : tab==='transfer' ? '转移' : tab==='recycle' ? '回收站' : tab==='docs' ? '文档' : '关于 DavBridge' }}</h2></div>
      <div v-if="!snapshot.configured" class="top-actions">
        <button class="config-warning has-tip" data-tip="需要打开设置补充配置" @click="command('app.openSettings')" :disabled="busy"><i></i>需要配置</button>
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
          <div class="route-line"><i></i><b>›</b><i></i></div>
        </div>
        <div class="endpoint target has-tip" data-tip="坚果云保存经过 StrongVerified 的强校验镜像">
          <svg class="nut-logo" viewBox="0 0 42 48" aria-hidden="true">
            <path class="nut-body" d="M8.7 22.6c3.7-8.7 14.9-13 22.2-7.9 7.1 5 5 18.2-1.1 25.2-4.8 5.4-12 6.7-17 1.9-5.7-5.4-7.5-11.1-4.1-19.2Z"/>
            <path class="nut-cap" d="M7.7 21.1c4.7-9.2 18.7-14.3 27-6.8 1.2 1.1 1.2 3-.2 3.8-7.9 4.4-17.1 6.3-25.9 5.4-1.4-.1-1.7-1.3-.9-2.4Z"/>
            <path class="nut-stem" d="M21.7 10.4c-.1-4.1 1.4-6.9 4.5-8.3"/>
            <path class="nut-leaf" d="M27.2 7.6C30 2.2 35.1.8 39.2 1.6c-.7 5.1-4.4 8.1-10.7 8.4Z"/>
          </svg>
          <strong>坚果云</strong>
        </div>

        <div class="phase-row">
          <div v-for="(phase,index) in snapshot.phases" :key="phase.key" class="phase-wrap">
            <div class="phase has-tip" :class="phase.state" :data-tip="phase.hint"><span class="phase-icon">{{ phase.state==='done' ? '✓' : '' }}</span><strong>{{ phase.label }}</strong></div>
            <span v-if="index<snapshot.phases.length-1" class="phase-connector"></span>
          </div>
        </div>
      </section>

      <div class="dashboard-grid">
        <article class="dashboard-card coverage-card">
          <div class="feature-icon coverage-feature" aria-hidden="true"><i></i><i></i><i></i></div>
          <div class="coverage-copy">
            <div class="card-title"><h3>镜像覆盖</h3><span class="info-dot has-tip" data-tip="StrongVerified 表示源端与目标端均重新读取并完成 SHA-256 一致性验证">i</span></div>
            <span class="coverage-count">{{ snapshot.verified }} / {{ snapshot.total }} 已校准</span>
          </div>
          <div class="progress-track coverage-progress"><i :style="{width:`${coveragePercent}%`}"></i></div>
          <b class="coverage-percent">{{ coveragePercent }}<small>%</small></b>
        </article>

        <article class="dashboard-card quota-card">
          <div class="feature-icon quota-feature" aria-hidden="true"><span>↑</span><span>↓</span></div>
          <div class="quota-content">
            <div class="quota-head">
              <div class="card-title"><h3>流量预算</h3><span class="info-dot has-tip" :data-tip="quotaTip">i</span></div>
              <span class="quota-reset has-tip" :data-tip="snapshot.quota.resetText">{{ resetLabel }}</span>
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
            <strong class="task-name">{{ snapshot.currentTitle }}</strong>
            <div v-if="snapshot.currentProgress!==null" class="task-progress"><div class="progress-track"><i :style="{width:`${snapshot.currentProgress*100}%`}"></i></div><strong>{{ Math.round(snapshot.currentProgress*100) }}%</strong></div>
          </div>
          <div class="task-action-row"><button class="primary-button" v-if="snapshot.primaryAction!=='none'" @click="primaryAction" :disabled="busy">{{ busy?'处理中…':snapshot.primaryLabel }}</button></div>
        </article>
      </div>
    </section>

    <section v-else-if="tab==='transfer'" class="page transfer-page">
      <div class="pool-grid"><article class="pool-card priority"><span>优先修复</span><strong>{{ snapshot.priorityCount.toLocaleString() }}</strong><small>源端真实变化的历史 StrongVerified 组</small></article><article class="pool-card normal"><span>普通任务</span><strong>{{ snapshot.normalCount.toLocaleString() }}</strong><small>既有 backlog 与本周期新增对象</small></article></div>
      <article class="work-card"><div class="work-icon"><span></span></div><div class="work-copy"><span>当前任务</span><strong>{{ snapshot.currentTitle }}</strong><small>{{ snapshot.currentDetail }}</small></div><div class="work-state">{{ snapshot.currentProgress===null?snapshot.routeStatus:`${Math.round(snapshot.currentProgress*100)}%` }}</div></article>
      <div class="coverage-footer"><span>总体镜像覆盖</span><div class="progress-track"><i :style="{width:`${coveragePercent}%`}"></i></div><strong>{{ snapshot.coverageText }}</strong></div>
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
      <aside class="doc-nav"><a href="#overview-doc">使用概览</a><a href="#mirror-doc">镜像原则</a><a href="#verified-doc">StrongVerified</a><a href="#cycle-doc">Cycle 与额度</a><a href="#audit-doc">源端对账</a><a href="#recycle-doc">回收站</a><a href="#delete-doc">删除安全</a><a href="#faq-doc">常见问题</a></aside>
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
      <article class="about-card"><div class="about-logo"><span></span><span></span></div><h2>DavBridge</h2><p>安全、持续地维护 Zotero 单向强校验镜像。</p><dl><div><dt>版本</dt><dd>v{{ snapshot.version }}</dd></div><div><dt>引擎</dt><dd>.NET 8 + WebView2</dd></div><div><dt>界面</dt><dd>Vue 3</dd></div></dl></article>
    </section>
  </section>

  <div v-if="toast" class="toast" role="status">{{ toast }}</div>
</main>
</template>
