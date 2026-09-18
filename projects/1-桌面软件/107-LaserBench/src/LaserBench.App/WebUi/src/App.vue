<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PlotCanvas from './components/PlotCanvas.vue'
import BeamProfileCanvas from './components/BeamProfileCanvas.vue'
import { createDemoSnapshot } from './demo'
import { hasNativeBridge, onSnapshot, request } from './bridge'
import type { LaserSnapshot, PlotSeries } from './types'

const snapshot = ref<LaserSnapshot>(createDemoSnapshot())
const activePage = ref('dashboard')
const sidebarExpanded = ref(false)
const pageNames: Record<string, string> = {
  power: '功率', spectrum: '光谱', beam: '光束', scope: '示波器', data: '数据', settings: '设置'
}
const labelDraft = ref(snapshot.value.label)
const beamZ = ref(snapshot.value.beam.z)
const beamAtt = ref(snapshot.value.beam.attenuation)
const beamPlaying = ref(false)
const cameraFlash = ref(false)
const recordElapsed = ref(0)
const saveNotice = ref('')
const settingsDraft = ref({
  experimentFolder: snapshot.value.config?.experimentFolder ?? '',
  autoScreenshot: snapshot.value.config?.autoScreenshot ?? false,
  aliases: { ...(snapshot.value.config?.aliases ?? {}) },
  powerWindow:snapshot.value.config?.powerWindow??600, osaStart:snapshot.value.config?.osaStart??1060, osaStop:snapshot.value.config?.osaStop??1100,
  scopeTimeSpan:snapshot.value.config?.scopeTimeSpan??0.24, scopeFftMax:snapshot.value.config?.scopeFftMax??50, scopeCh1:snapshot.value.config?.scopeCh1??true, scopeCh2:snapshot.value.config?.scopeCh2??true
})
const dataFilter=ref('')
let beamTimer:number|undefined
let clockTimer:number|undefined
let recordTimer:number|undefined
let recordStartedAt:number|undefined
let stopSnapshot: (()=>void)|undefined

const powerSeries = computed<PlotSeries[]>(() => snapshot.value.power.traces.map(t => ({
  name: t.name,
  color: t.color,
  axis: t.unit === '%' ? 'right' : 'left',
  points: t.points
})))
const powerLeftMax = computed(() => Math.max(5, Math.ceil(Math.max(...snapshot.value.power.traces.filter(t=>t.unit!=='%').flatMap(t=>t.points.map(p=>p.y)), 1) / 5) * 5))
const devicesShown = computed(() => snapshot.value.devices.slice(0,5))
const moduleActive = (name:string) => snapshot.value.captureState==='running' && !!snapshot.value.captureSelection[name]
const captureStateText=computed(()=>({idle:'就绪',starting:'启动中',running:'采集中',stopping:'停止中',error:'错误'}[snapshot.value.captureState]??'就绪'))
const filteredFiles=computed(()=>{const q=dataFilter.value.trim().toLowerCase();return q?snapshot.value.data.files.filter(f=>f.name.toLowerCase().includes(q)):snapshot.value.data.files})
const recordDurationText = computed(() => {
  const total=Math.max(0,Math.floor(recordElapsed.value))
  const h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60
  const pad=(v:number)=>String(v).padStart(2,'0')
  return h>0?`${pad(h)}:${pad(m)}:${pad(s)}`:`${pad(m)}:${pad(s)}`
})
const clockText = computed(() => {
  const d = new Date(snapshot.value.timestamp)
  if (Number.isNaN(d.getTime())) return snapshot.value.timestamp
  const pad=(v:number)=>String(v).padStart(2,'0')
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})

watch(() => snapshot.value.beam.z, v => { if(!beamPlaying.value) beamZ.value=v })
watch(() => snapshot.value.beam.attenuation, v => beamAtt.value=v)
watch(() => snapshot.value.recording, recording => {
  if(recordTimer){window.clearInterval(recordTimer);recordTimer=undefined}
  if(recording){
    if(recordStartedAt===undefined) recordStartedAt=Date.now()
    const update=()=>recordElapsed.value=Math.floor((Date.now()-(recordStartedAt??Date.now()))/1000)
    update()
    recordTimer=window.setInterval(update,1000)
  }else{
    recordStartedAt=undefined
    recordElapsed.value=0
  }
},{immediate:true})

async function setLabel() {
  snapshot.value.label = labelDraft.value.trim()
  await request('app.setLabel',{label:snapshot.value.label})
}
async function toggleSource(module:string) {
  const next=!snapshot.value.captureSelection[module]
  snapshot.value.captureSelection[module]=next
  await request('app.setCaptureSelection',{module,selected:next})
}
async function toggleCapture(){ await request('app.capture') }
async function screenshot(){
  await request('app.screenshot')
  cameraFlash.value=false
  window.requestAnimationFrame(()=>{
    cameraFlash.value=true
    window.setTimeout(()=>cameraFlash.value=false,900)
  })
}
async function toggleRecord(){ await request('app.record') }
async function updateZ(value:number){beamZ.value=value;await request('beam.setZ',{value})}
async function updateAtt(value:number){beamAtt.value=value;await request('beam.setAttenuation',{value})}
function onZInput(e:Event){const target=e.target as HTMLInputElement;void updateZ(Number(target.value))}
function onAttInput(e:Event){const target=e.target as HTMLInputElement;void updateAtt(Number(target.value))}
function toggleBeamPlay(){
  beamPlaying.value=!beamPlaying.value
  if(beamTimer){window.clearInterval(beamTimer);beamTimer=undefined}
  if(!beamPlaying.value)return
  beamTimer=window.setInterval(()=>{
    let next=beamZ.value+1.0
    if(next>24)next=-24
    void updateZ(next)
  },260)
}
async function saveSettings(){
  await request('app.setConfig',settingsDraft.value)
  saveNotice.value='设置已保存'
  window.setTimeout(()=>saveNotice.value='',1600)
}
async function refreshData(){ await request('app.refreshData') }
async function openFolder(kind:'exp'|'pic'|'video'|'root'){ await request('app.openFolder',{kind}) }
function formatBytes(n:number){ if(n<1024)return n+' B'; if(n<1048576)return (n/1024).toFixed(1)+' KB'; return (n/1048576).toFixed(1)+' MB' }
function nav(page:string){activePage.value=page}

onMounted(()=>{
  stopSnapshot=onSnapshot(s=>{
    snapshot.value=s
    if(document.activeElement?.id!=='labelInput')labelDraft.value=s.label
    if(activePage.value!=='settings'){
      settingsDraft.value={experimentFolder:s.config?.experimentFolder??'',autoScreenshot:s.config?.autoScreenshot??false,aliases:{...(s.config?.aliases??{})},powerWindow:s.config?.powerWindow??600,osaStart:s.config?.osaStart??1060,osaStop:s.config?.osaStop??1100,scopeTimeSpan:s.config?.scopeTimeSpan??0.24,scopeFftMax:s.config?.scopeFftMax??50,scopeCh1:s.config?.scopeCh1??true,scopeCh2:s.config?.scopeCh2??true}
    }
  })
  if(hasNativeBridge) void request('app.getSnapshot')
  else clockTimer=window.setInterval(()=>snapshot.value.timestamp=new Date().toISOString(),1000)
})
onBeforeUnmount(()=>{stopSnapshot?.();if(beamTimer)window.clearInterval(beamTimer);if(clockTimer)window.clearInterval(clockTimer);if(recordTimer)window.clearInterval(recordTimer)})
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-lockup" title="LaserBench"><div class="brand-logo">LB</div><div v-if="sidebarExpanded" class="brand-copy"><b>LaserBench</b><small>v{{snapshot.version}}</small></div></div>
      <div class="vsep"></div>
      <button class="run-btn" :class="{stopping:snapshot.captureState==='stopping',running:snapshot.captureState==='running'}" @click="toggleCapture" :disabled="snapshot.captureState==='starting'" :title="snapshot.capturing?'停止采集':'开始采集'">
        <svg v-if="!snapshot.capturing" viewBox="0 0 24 24" class="fill-icon"><path d="M8 5v14l11-7z"/></svg>
        <svg v-else viewBox="0 0 24 24" class="fill-icon"><rect x="7" y="7" width="10" height="10" rx="1"/></svg>
      </button>
      <div class="label-wrap">
        <input id="labelInput" v-model="labelDraft" @keyup.enter="setLabel" placeholder="Label" />
        <button class="clear-label" @click="labelDraft=''">×</button>
      </div>
      <button class="icon-btn check-btn" @click="setLabel" title="确认标签"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></button>
      <div class="vsep"></div>

      <button class="module-toggle power-accent" :class="{active:snapshot.captureSelection.power,breathing:moduleActive('power')}" @click="toggleSource('power')" title="本次采集包含功率"><svg viewBox="0 0 24 24"><path d="M4 19V10M9 19V5M14 19v-8M19 19V8"/></svg></button>
      <button class="module-toggle spectrum-accent" :class="{active:snapshot.captureSelection.spectrum,breathing:moduleActive('spectrum')}" @click="toggleSource('spectrum')" title="本次采集包含光谱"><svg viewBox="0 0 24 24"><path d="M3 19c4 0 5-14 9-14s5 14 9 14"/></svg></button>
      <button class="module-toggle beam-accent" :class="{active:snapshot.captureSelection.beam,breathing:moduleActive('beam')}" @click="toggleSource('beam')" title="本次采集包含光束"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></button>
      <button class="module-toggle scope-accent" :class="{active:snapshot.captureSelection.scope,breathing:moduleActive('scope')}" @click="toggleSource('scope')" title="本次采集包含示波器"><svg viewBox="0 0 24 24"><path d="M2 12h3c1.5 0 1.5-7 3-7s1.5 14 3 14 1.5-14 3-14 1.5 14 3 14 1.5-7 3-7h2"/></svg></button>

      <span class="capture-state" :class="snapshot.captureState">{{captureStateText}}</span>
      <div class="top-spacer"></div>
      <div class="device-strip"><span v-for="d in devicesShown" :key="d.kind+d.alias" class="device-pill"><i :class="['status-dot',d.status]"></i>{{d.alias}}</span></div>
      <div class="vsep"></div>
      <button class="icon-btn camera-btn" :class="{flash:cameraFlash}" @click="screenshot" title="截图"><span v-if="cameraFlash" class="capture-bubble"></span><svg viewBox="0 0 24 24"><path d="M4 8h4l1.5-2h5L16 8h4v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></button>
      <button class="record-btn" :class="{active:snapshot.recording}" @click="toggleRecord" title="录像"><i></i><span>REC</span><span v-if="snapshot.recording" class="record-duration">{{recordDurationText}}</span></button>
      <div class="vsep"></div><span class="clock">{{clockText}}</span>
    </header>

    <aside class="sidebar" :class="{expanded:sidebarExpanded}">
      <button :class="{active:activePage==='dashboard'}" @click="nav('dashboard')" title="总览"><svg viewBox="0 0 24 24"><path d="m3 11 9-8 9 8v9H7v-7h10v7"/></svg><span v-if="sidebarExpanded">总览</span></button>
      <button class="power-accent" :class="{active:activePage==='power',breathing:moduleActive('power')}" @click="nav('power')" title="功率"><svg viewBox="0 0 24 24"><path d="M4 19V10M9 19V5M14 19v-8M19 19V8"/></svg><span v-if="sidebarExpanded">功率</span></button>
      <button class="spectrum-accent" :class="{active:activePage==='spectrum',breathing:moduleActive('spectrum')}" @click="nav('spectrum')" title="光谱"><svg viewBox="0 0 24 24"><path d="M3 19c4 0 5-14 9-14s5 14 9 14"/></svg><span v-if="sidebarExpanded">光谱</span></button>
      <button class="beam-accent" :class="{active:activePage==='beam',breathing:moduleActive('beam')}" @click="nav('beam')" title="光束"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg><span v-if="sidebarExpanded">光束</span></button>
      <button class="scope-accent" :class="{active:activePage==='scope',breathing:moduleActive('scope')}" @click="nav('scope')" title="示波器"><svg viewBox="0 0 24 24"><path d="M2 12h3c1.5 0 1.5-7 3-7s1.5 14 3 14 1.5-14 3-14 1.5 14 3 14 1.5-7 3-7h2"/></svg><span v-if="sidebarExpanded">示波器</span></button>
      <button :class="{active:activePage==='data'}" @click="nav('data')" title="数据"><svg viewBox="0 0 24 24"><path d="M5 3h11l3 3v15H5zM8 10h8M8 14h8M8 18h5"/></svg><span v-if="sidebarExpanded">数据</span></button>
      <div class="side-spacer"></div>
      <button :class="{active:activePage==='settings'}" @click="nav('settings')" title="设置"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/></svg><span v-if="sidebarExpanded">设置</span></button>
      <button class="side-search" title="搜索"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg><span v-if="sidebarExpanded">搜索</span></button>
      <button class="side-collapse" @click="sidebarExpanded=!sidebarExpanded" :title="sidebarExpanded?'折叠':'展开'"><svg viewBox="0 0 24 24"><path :d="sidebarExpanded?'m14 6-6 6 6 6':'m10 6 6 6-6 6'"/></svg><span v-if="sidebarExpanded">{{sidebarExpanded?'折叠':''}}</span></button>
    </aside>

    <main class="workspace">
      <div v-if="activePage!=='dashboard'" class="page-ribbon"><button @click="nav('dashboard')">总览</button><span>/</span><strong>{{pageNames[activePage]}}</strong></div>

      <section v-if="activePage==='data'" class="utility-page">
        <div class="utility-head"><div><h2>数据</h2><p>当前实验目录：{{snapshot.data.experimentFolder}}</p></div><div class="utility-actions"><input class="data-search" v-model="dataFilter" placeholder="按 Label / 文件名筛选"/><button @click="refreshData">刷新</button><button @click="openFolder('exp')">打开实验目录</button></div></div>
        <div class="capture-summary"><b>{{snapshot.lastCaptureMessage}}</b><span v-if="snapshot.lastCaptureAt">{{new Date(snapshot.lastCaptureAt).toLocaleString()}}</span></div>
        <div class="data-stats"><div><span>实验文件</span><b>{{snapshot.data.fileCount}}</b></div><div><span>截图</span><b>{{snapshot.data.pictureCount}}</b></div><div><span>录像</span><b>{{snapshot.data.videoCount}}</b></div></div>
        <div class="file-table"><div class="file-row file-head"><span>文件名</span><span>类型</span><span>大小</span><span>修改时间</span></div><div v-for="f in filteredFiles" :key="f.name" class="file-row"><span>{{f.name}}</span><span>{{f.extension.toUpperCase()}}</span><span>{{formatBytes(f.size)}}</span><span>{{new Date(f.modified).toLocaleString()}}</span></div><div v-if="!filteredFiles.length" class="empty-state">当前实验目录还没有数据文件</div></div>
      </section>

      <section v-if="activePage==='settings'" class="utility-page settings-page">
        <div class="utility-head"><div><h2>设置</h2><p>Portable 根目录：{{snapshot.config.rootPath}}</p></div><div class="utility-actions"><span class="save-notice">{{saveNotice}}</span><button class="primary" @click="saveSettings">保存设置</button></div></div>
        <div class="settings-grid">
          <div class="setting-group"><h3>实验与保存</h3><label><span>实验文件夹</span><input v-model="settingsDraft.experimentFolder" placeholder="留空则使用 YYYY-MM-DD"/></label><label class="switch-row"><span>测试完成后自动截图</span><input type="checkbox" v-model="settingsDraft.autoScreenshot"/></label><div class="folder-actions"><button @click="openFolder('root')">程序目录</button><button @click="openFolder('pic')">截图目录</button><button @click="openFolder('video')">录像目录</button></div></div>
          <div class="setting-group"><h3>设备 Alias</h3><label v-for="(v,k) in settingsDraft.aliases" :key="k"><span>{{k}}</span><input v-model="settingsDraft.aliases[k]"/></label></div><div class="setting-group"><h3>功率</h3><label><span>历史窗口</span><select v-model.number="settingsDraft.powerWindow"><option :value="120">2 min</option><option :value="300">5 min</option><option :value="600">10 min</option><option :value="1800">30 min</option></select></label></div><div class="setting-group"><h3>光谱 OSA</h3><label><span>起始波长</span><input type="number" v-model.number="settingsDraft.osaStart"/></label><label><span>终止波长</span><input type="number" v-model.number="settingsDraft.osaStop"/></label></div><div class="setting-group"><h3>示波器</h3><label><span>时间窗 (ms)</span><input type="number" step="0.01" v-model.number="settingsDraft.scopeTimeSpan"/></label><label><span>FFT 上限 (MHz)</span><input type="number" v-model.number="settingsDraft.scopeFftMax"/></label><label><span>CH1</span><input type="checkbox" v-model="settingsDraft.scopeCh1"/></label><label><span>CH2</span><input type="checkbox" v-model="settingsDraft.scopeCh2"/></label></div><div class="setting-group"><h3>运行环境</h3><label><span>运行模式</span><b>{{snapshot.mode==='SIM'?'Simulator 模拟器':'Hardware 硬件'}}</b></label><label><span>程序目录</span><small>{{snapshot.config.rootPath}}</small></label></div>
        </div>
      </section>

      <section v-if="!['data','settings'].includes(activePage)" class="dashboard-grid" :class="{'focus-mode':activePage!=='dashboard'}">
        <article class="instrument-panel power-panel" :class="{hidden:!['dashboard','power'].includes(activePage)}">
          <div class="module-head power-head"><div class="panel-mark power-accent" :class="{breathing:moduleActive('power')}"><svg viewBox="0 0 24 24"><path d="M4 19V10M9 19V5M14 19v-8M19 19V8"/></svg></div><strong>功率</strong><div class="head-metrics"><span v-for="t in snapshot.power.traces" :key="t.name"><em>{{t.name}}</em><b>{{t.value.toFixed(t.unit==='%'?1:2)}}</b><small>{{t.unit}}</small></span><span v-if="snapshot.power.traces[0]" class="head-muted"><em>Max</em><b>{{snapshot.power.traces[0].maxValue.toFixed(2)}}</b><small>{{snapshot.power.traces[0].unit}}</small></span></div></div>
          <div class="power-layout">
            <div class="power-chart-zone">
              <PlotCanvas class="main-plot" :series="powerSeries" :x-min="-settingsDraft.powerWindow" :x-max="0" :y-min="0" :y-max="powerLeftMax" :right-y-min="0" :right-y-max="100" x-label="时间" y-label="功率 (kW)" right-y-label="效率 (%)" :time-axis="true" />
              <div class="overview-row"><div class="overview-shell"><PlotCanvas :series="powerSeries.slice(0,1)" :x-min="-settingsDraft.powerWindow" :x-max="0" :compact="true" /><div class="overview-selected"><i></i><i></i></div></div></div>
            </div>
 
          </div>
        </article>

        <article class="instrument-panel spectrum-panel" :class="{hidden:!['dashboard','spectrum'].includes(activePage)}">
          <div class="spectrum-head"><div class="panel-mark inline spectrum-accent" :class="{breathing:moduleActive('spectrum')}"><svg viewBox="0 0 24 24"><path d="M3 19c4 0 5-14 9-14s5 14 9 14"/></svg></div><div class="osa-metrics"><span>λ<sub>c</sub><b>{{snapshot.spectrum.centerWavelength.toFixed(2)}}</b>nm</span><i></i><span><em>3 dB</em><b>{{snapshot.spectrum.linewidth3Db.toFixed(2)}}</b>nm</span><i></i><span><em>RMS</em><b>{{snapshot.spectrum.linewidthRms.toFixed(2)}}</b>nm</span><i></i><span><em>P</em><b>{{snapshot.spectrum.power.toFixed(1)}}</b>dBm</span></div><button class="select-like">OSA1<svg viewBox="0 0 24 24"><path d="m7 9 5 5 5-5"/></svg></button></div>
          <PlotCanvas class="spectrum-plot" :series="snapshot.spectrum.traces" :x-min="settingsDraft.osaStart" :x-max="settingsDraft.osaStop" :y-min="-100" :y-max="0" x-label="nm" y-label="功率 (dBm)" />
        </article>

        <article class="instrument-panel beam-panel" :class="{hidden:!['dashboard','beam'].includes(activePage)}">
          <div class="module-head beam-head"><div class="panel-mark beam-accent" :class="{breathing:moduleActive('beam')}"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></div><strong>光束</strong><div class="beam-top-controls"><span class="control-label">Z</span><input type="range" min="-24" max="24" step="0.1" :value="beamZ" @input="onZInput"/><b>{{beamZ.toFixed(1)}} mm</b><button class="play-mini" :class="{active:beamPlaying}" @click="toggleBeamPlay"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button><span class="control-label">Att</span><input type="range" min="0" max="40" step="0.1" :value="beamAtt" @input="onAttInput"/><b>{{beamAtt.toFixed(1)}} dB</b></div><div class="m2-block"><span>M²<sub>x</sub><b>{{snapshot.beam.m2x.toFixed(2)}}</b></span><span>M²<sub>y</sub><b>{{snapshot.beam.m2y.toFixed(2)}}</b></span><span>M̄²<b>{{snapshot.beam.m2mean.toFixed(2)}}</b></span></div></div>
          <div class="beam-body"><div class="beam-image-wrap"><BeamProfileCanvas :width-x="snapshot.beam.spotWidthX" :width-y="snapshot.beam.spotWidthY" :attenuation="beamAtt" /><div class="beam-tools"><button title="放大">＋</button><button title="缩小">−</button><button title="适应">⛶</button></div></div><PlotCanvas class="caustic-plot" :series="snapshot.beam.caustic" :vertical-marker="beamZ" x-label="Z (mm)" y-label="束宽 (μm)" /></div>
 
        </article>

        <article class="instrument-panel scope-panel" :class="{hidden:!['dashboard','scope'].includes(activePage)}"><div class="module-head scope-head"><div class="panel-mark scope-accent" :class="{breathing:moduleActive('scope')}"><svg viewBox="0 0 24 24"><path d="M2 12h3c1.5 0 1.5-7 3-7s1.5 14 3 14 1.5-14 3-14 1.5 14 3 14 1.5-7 3-7h2"/></svg></div><strong>示波器</strong><div class="scope-readouts"><span>CH1 <b>{{snapshot.scope.time[0]?.points.at(-1)?.y.toFixed(3) ?? '0.000'}}</b> V</span><span>CH2 <b>{{snapshot.scope.time[1]?.points.at(-1)?.y.toFixed(3) ?? '0.000'}}</b> V</span><span>采样 <b>2.5</b> MSa/s</span></div></div><div class="scope-plots"><PlotCanvas :series="snapshot.scope.time" :x-min="0" :x-max="settingsDraft.scopeTimeSpan" :y-min="-1" :y-max="1" x-label="ms" :tight="true" /><PlotCanvas :series="snapshot.scope.fft" :x-min="0" :x-max="settingsDraft.scopeFftMax*1000" x-label="kHz" :tight="true" /></div></article>
      </section>
    </main>
  </div>
</template>
