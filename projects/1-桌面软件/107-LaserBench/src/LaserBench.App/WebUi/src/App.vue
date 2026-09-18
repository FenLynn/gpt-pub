<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PlotCanvas from './components/PlotCanvas.vue'
import BeamProfileCanvas from './components/BeamProfileCanvas.vue'
import { createDemoSnapshot } from './demo'
import { hasNativeBridge, onSnapshot, request } from './bridge'
import type { LaserSnapshot, PlotSeries } from './types'

const snapshot = ref<LaserSnapshot>(createDemoSnapshot())
const activePage = ref('dashboard')
const pageNames: Record<string, string> = {
  power: '功率', spectrum: '光谱', beam: '光束', scope: '示波器', data: '数据', settings: '设置'
}
const labelDraft = ref(snapshot.value.label)
const beamZ = ref(snapshot.value.beam.z)
const beamAtt = ref(snapshot.value.beam.attenuation)
const beamPlaying = ref(false)
const cameraFlash = ref(false)
const recordElapsed = ref(0)
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
    const update=()=>recordElapsed.value=(Date.now()-(recordStartedAt??Date.now()))/1000
    update()
    recordTimer=window.setInterval(update,250)
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
    window.setTimeout(()=>cameraFlash.value=false,260)
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
function nav(page:string){activePage.value=page}

onMounted(()=>{
  stopSnapshot=onSnapshot(s=>{snapshot.value=s;if(document.activeElement?.id!=='labelInput')labelDraft.value=s.label})
  if(hasNativeBridge) void request('app.getSnapshot')
  else clockTimer=window.setInterval(()=>snapshot.value.timestamp=new Date().toISOString(),1000)
})
onBeforeUnmount(()=>{stopSnapshot?.();if(beamTimer)window.clearInterval(beamTimer);if(clockTimer)window.clearInterval(clockTimer);if(recordTimer)window.clearInterval(recordTimer)})
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <button class="icon-btn quiet" title="搜索"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg></button>
      <div class="vsep"></div>
      <button class="run-btn" :class="{stopping:snapshot.capturing}" @click="toggleCapture" :title="snapshot.capturing?'停止采集':'开始采集'">
        <svg v-if="!snapshot.capturing" viewBox="0 0 24 24" class="fill-icon"><path d="M8 5v14l11-7z"/></svg>
        <svg v-else viewBox="0 0 24 24" class="fill-icon"><rect x="7" y="7" width="10" height="10" rx="1"/></svg>
      </button>
      <div class="label-wrap">
        <input id="labelInput" v-model="labelDraft" @keyup.enter="setLabel" placeholder="Label" />
        <button class="clear-label" @click="labelDraft=''">×</button>
      </div>
      <button class="icon-btn check-btn" @click="setLabel" title="确认标签"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></button>
      <div class="vsep"></div>

      <button class="module-toggle" :class="{active:snapshot.captureSelection.power}" @click="toggleSource('power')" title="本次采集包含功率"><svg viewBox="0 0 24 24"><path d="M4 19V10M9 19V5M14 19v-8M19 19V8"/></svg></button>
      <button class="module-toggle" :class="{active:snapshot.captureSelection.spectrum}" @click="toggleSource('spectrum')" title="本次采集包含光谱"><svg viewBox="0 0 24 24"><path d="M3 19c4 0 5-14 9-14s5 14 9 14"/></svg></button>
      <button class="module-toggle" :class="{active:snapshot.captureSelection.beam}" @click="toggleSource('beam')" title="本次采集包含光束"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></button>
      <button class="module-toggle" :class="{active:snapshot.captureSelection.scope}" @click="toggleSource('scope')" title="本次采集包含示波器"><svg viewBox="0 0 24 24"><path d="M2 12h3c1.5 0 1.5-7 3-7s1.5 14 3 14 1.5-14 3-14 1.5 14 3 14 1.5-7 3-7h2"/></svg></button>

      <div class="top-spacer"></div>
      <div class="device-strip"><span v-for="d in devicesShown" :key="d.kind+d.alias" class="device-pill"><i :class="['status-dot',d.status]"></i>{{d.alias}}</span></div>
      <div class="vsep"></div>
      <button class="icon-btn camera-btn" :class="{flash:cameraFlash}" @click="screenshot" title="截图"><svg viewBox="0 0 24 24"><path d="M4 8h4l1.5-2h5L16 8h4v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></button>
      <button class="record-btn" :class="{active:snapshot.recording}" @click="toggleRecord" title="录像"><i></i><span>REC</span><span v-if="snapshot.recording" class="record-duration">{{recordDurationText}}</span></button>
      <div class="vsep"></div><span class="clock">{{clockText}}</span>
    </header>

    <aside class="sidebar">
      <button :class="{active:activePage==='dashboard'}" @click="nav('dashboard')" title="总览"><svg viewBox="0 0 24 24"><path d="m3 11 9-8 9 8v9H7v-7h10v7"/></svg></button>
      <button :class="{active:activePage==='power'}" @click="nav('power')" title="功率"><svg viewBox="0 0 24 24"><path d="M4 19V10M9 19V5M14 19v-8M19 19V8"/></svg></button>
      <button :class="{active:activePage==='spectrum'}" @click="nav('spectrum')" title="光谱"><svg viewBox="0 0 24 24"><path d="M3 19c4 0 5-14 9-14s5 14 9 14"/></svg></button>
      <button :class="{active:activePage==='beam'}" @click="nav('beam')" title="光束"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></button>
      <button :class="{active:activePage==='scope'}" @click="nav('scope')" title="示波器"><svg viewBox="0 0 24 24"><path d="M2 12h3c1.5 0 1.5-7 3-7s1.5 14 3 14 1.5-14 3-14 1.5 14 3 14 1.5-7 3-7h2"/></svg></button>
      <button :class="{active:activePage==='data'}" @click="nav('data')" title="数据"><svg viewBox="0 0 24 24"><path d="M5 3h11l3 3v15H5zM8 10h8M8 14h8M8 18h5"/></svg></button>
      <div class="side-spacer"></div>
      <button :class="{active:activePage==='settings'}" @click="nav('settings')" title="设置"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/></svg></button>
      <span class="sim-badge">{{snapshot.mode}}</span>
    </aside>

    <main class="workspace">
      <div v-if="activePage!=='dashboard'" class="page-ribbon"><button @click="nav('dashboard')">总览</button><span>/</span><strong>{{pageNames[activePage]}}</strong><span class="page-note">当前架构迁移阶段，主页面已切换为 WebView2 + Vue；模块详细配置将在此框架内继续收口。</span></div>

      <section class="dashboard-grid" :class="{'focus-mode':activePage!=='dashboard'}">
        <article class="instrument-panel power-panel" :class="{hidden:!['dashboard','power'].includes(activePage)}">
          <div class="panel-mark power-mark"><svg viewBox="0 0 24 24"><path d="M4 19V10M9 19V5M14 19v-8M19 19V8"/></svg></div>
          <div class="power-layout">
            <div class="power-chart-zone">
              <PlotCanvas class="main-plot" :series="powerSeries" :x-min="-600" :x-max="0" :y-min="0" :y-max="powerLeftMax" :right-y-min="0" :right-y-max="100" x-label="时间" y-label="功率 (kW)" right-y-label="效率 (%)" :time-axis="true" />
              <div class="overview-row"><div class="overview-shell"><PlotCanvas :series="powerSeries.slice(0,1)" :x-min="-600" :x-max="0" :compact="true" /><div class="overview-selected"><i></i><i></i></div></div></div>
            </div>
            <div class="metric-rail">
              <div v-for="t in snapshot.power.traces" :key="t.name" class="metric-item"><div class="metric-name"><i :style="{background:t.color}"></i>{{t.name}}</div><div class="metric-value">{{t.value.toFixed(t.unit==='%'?1:2)}}<span>{{t.unit}}</span></div></div>
              <div class="metric-rule"></div>
              <div class="metric-item compact-metric" v-if="snapshot.power.traces[0]"><div class="metric-name">最大值 ({{snapshot.power.traces[0].name}})</div><div class="metric-value">{{snapshot.power.traces[0].maxValue.toFixed(2)}}<span>{{snapshot.power.traces[0].unit}}</span></div></div>
            </div>
          </div>
        </article>

        <article class="instrument-panel spectrum-panel" :class="{hidden:!['dashboard','spectrum'].includes(activePage)}">
          <div class="spectrum-head"><div class="panel-mark inline"><svg viewBox="0 0 24 24"><path d="M3 19c4 0 5-14 9-14s5 14 9 14"/></svg></div><div class="osa-metrics"><span>λ<sub>c</sub><b>{{snapshot.spectrum.centerWavelength.toFixed(2)}}</b>nm</span><i></i><span><em>3 dB</em><b>{{snapshot.spectrum.linewidth3Db.toFixed(2)}}</b>nm</span><i></i><span><em>RMS</em><b>{{snapshot.spectrum.linewidthRms.toFixed(2)}}</b>nm</span><i></i><span><em>P</em><b>{{snapshot.spectrum.power.toFixed(1)}}</b>dBm</span></div><button class="select-like">OSA1<svg viewBox="0 0 24 24"><path d="m7 9 5 5 5-5"/></svg></button></div>
          <PlotCanvas class="spectrum-plot" :series="snapshot.spectrum.traces" :y-min="-100" :y-max="0" x-label="nm" y-label="功率 (dBm)" />
        </article>

        <article class="instrument-panel beam-panel" :class="{hidden:!['dashboard','beam'].includes(activePage)}">
          <div class="beam-body"><div class="beam-image-wrap"><BeamProfileCanvas :width-x="snapshot.beam.spotWidthX" :width-y="snapshot.beam.spotWidthY" :attenuation="beamAtt" /><div class="beam-tools"><button title="放大">＋</button><button title="缩小">−</button><button title="适应">⛶</button></div></div><PlotCanvas class="caustic-plot" :series="snapshot.beam.caustic" :vertical-marker="beamZ" x-label="Z (mm)" y-label="束宽 (μm)" /></div>
          <div class="beam-controls"><span class="control-label">Z</span><input type="range" min="-24" max="24" step="0.1" :value="beamZ" @input="onZInput"/><b>{{beamZ.toFixed(1)}} mm</b><button class="play-mini" :class="{active:beamPlaying}" @click="toggleBeamPlay"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button><span class="control-label">Att</span><input type="range" min="0" max="40" step="0.1" :value="beamAtt" @input="onAttInput"/><b>{{beamAtt.toFixed(1)}} dB</b><div class="m2-block"><span>M²<sub>x</sub><b>{{snapshot.beam.m2x.toFixed(2)}}</b></span><span>M²<sub>y</sub><b>{{snapshot.beam.m2y.toFixed(2)}}</b></span><span>M̄²<b>{{snapshot.beam.m2mean.toFixed(2)}}</b></span></div><div class="beam-mark" title="光束"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></div></div>
        </article>

        <article class="instrument-panel scope-panel" :class="{hidden:!['dashboard','scope'].includes(activePage)}"><div class="scope-plots"><PlotCanvas :series="snapshot.scope.time" :y-min="-1" :y-max="1" x-label="ms" :tight="true" /><PlotCanvas :series="snapshot.scope.fft" x-label="kHz" :tight="true" /></div><div class="scope-mark" title="示波器"><svg viewBox="0 0 24 24"><path d="M2 12h3c1.5 0 1.5-7 3-7s1.5 14 3 14 1.5-14 3-14 1.5 14 3 14 1.5-7 3-7h2"/></svg></div></article>
      </section>
    </main>
  </div>
</template>
