<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PlotCanvas from './components/PlotCanvas.vue'
import BeamProfileCanvas from './components/BeamProfileCanvas.vue'
import powerAcqGif from './assets/acq-power.gif'
import spectrumAcqGif from './assets/acq-spectrum.gif'
import beamAcqGif from './assets/acq-beam.gif'
import scopeAcqGif from './assets/acq-scope.gif'
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
const beamZDragging = ref(false)
const beamAttDragging = ref(false)
let beamZPending:number|null=null
let beamAttPending:number|null=null
let beamZSendBusy=false
let beamAttSendBusy=false
let beamZHoldUntil=0
let beamAttHoldUntil=0
const cameraFlash = ref(false)
const recordFlash = ref(false)
const recordElapsed = ref(0)
const saveNotice = ref('')
type BigReadoutKind = 'power0'|'power1'|'power2'|'spectrumCenter'|'spectrum3db'|'spectrumRms'|'spectrumPower'|'beamM2x'|'beamM2y'|'beamM2'|'scope0'|'scope1'
type BigReadoutWindow = { id:number; kind:BigReadoutKind; x:number; y:number; scale:number; light:boolean; z:number }
const BIG_READOUT_KINDS:BigReadoutKind[]=['power0','power1','power2','spectrumCenter','spectrum3db','spectrumRms','spectrumPower','beamM2x','beamM2y','beamM2','scope0','scope1']
const bigReadoutWindows = ref<BigReadoutWindow[]>([])
const BIG_READOUT_BASE_H = 90
let nextReadoutId = 1
let readoutZ = 12000
const settingsDraft = ref({
  experimentFolder: snapshot.value.config?.experimentFolder ?? '',
  autoScreenshot: snapshot.value.config?.autoScreenshot ?? false,
  aliases: { ...(snapshot.value.config?.aliases ?? {}) },
  powerWindow:snapshot.value.config?.powerWindow??600, osaStart:snapshot.value.config?.osaStart??1060, osaStop:snapshot.value.config?.osaStop??1100,
  scopeTimeSpan:snapshot.value.config?.scopeTimeSpan??0.24, scopeFftMax:snapshot.value.config?.scopeFftMax??50, scopeCh1:snapshot.value.config?.scopeCh1??true, scopeCh2:snapshot.value.config?.scopeCh2??true,
  dashboardPower1:snapshot.value.config?.dashboardPower1??true, dashboardPower2:snapshot.value.config?.dashboardPower2??true, dashboardMath1:snapshot.value.config?.dashboardMath1??true
})
const dataFilter=ref('')
let beamTimer:number|undefined
let clockTimer:number|undefined
let recordTimer:number|undefined
let recordStartedAt:number|undefined
let stopSnapshot: (()=>void)|undefined

const powerVisibility = computed(() => [settingsDraft.value.dashboardPower1, settingsDraft.value.dashboardPower2, settingsDraft.value.dashboardMath1])
const visiblePowerTraces = computed(() => snapshot.value.power.traces.filter((_,index) => powerVisibility.value[index] ?? true))
const powerHistorySpan = computed(() => {
  const xs=visiblePowerTraces.value.flatMap(t=>t.points.map(p=>p.x))
  if(!xs.length)return 0
  return Math.max(0,Math.min(settingsDraft.value.powerWindow,Math.max(...xs)-Math.min(...xs)))
})
const powerSeries = computed<PlotSeries[]>(() => visiblePowerTraces.value.map(t => {
  const xs=t.points.map(p=>p.x)
  const minX=xs.length?Math.min(...xs):0
  return {
    name:t.name,
    color:t.color,
    axis:t.unit==='%'?'right':'left',
    points:t.points.map(p=>({x:p.x-minX,y:p.y}))
  }
}))
const powerTimeOriginMs = computed(() => {
  const now=new Date(snapshot.value.timestamp).getTime()
  return (Number.isFinite(now)?now:Date.now())-powerHistorySpan.value*1000
})
const powerProgressPct = computed(() => Math.max(1.5,Math.min(100,powerHistorySpan.value/settingsDraft.value.powerWindow*100)))
const powerLeftMax = computed(() => {
  const values=visiblePowerTraces.value.filter(t=>t.unit!=='%').flatMap(t=>t.points.map(p=>p.y))
  return Math.max(5, Math.ceil(Math.max(...values, 1) / 5) * 5)
})
function powerVisible(index:number){ return powerVisibility.value[index] ?? true }
function powerReadoutKind(index:number):BigReadoutKind { return (['power0','power1','power2'][index] ?? 'power0') as BigReadoutKind }
const devicesShown = computed(() => snapshot.value.devices.slice(0,5))
const moduleActive = (name:string) => snapshot.value.captureState==='running' && !!snapshot.value.captureSelection[name]
const captureStateText=computed(()=>({idle:'就绪',starting:'启动中',running:'采集中',stopping:'停止中',error:'错误'}[snapshot.value.captureState]??'就绪'))
const filteredFiles=computed(()=>{const q=dataFilter.value.trim().toLowerCase();return q?snapshot.value.data.files.filter(f=>f.name.toLowerCase().includes(q)):snapshot.value.data.files})
const recordDurationText = computed(() => {
  const total=Math.max(0,Math.floor(recordElapsed.value))
  const h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60
  const pad=(v:number)=>String(v).padStart(2,'0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
})
const clockText = computed(() => {
  const d = new Date(snapshot.value.timestamp)
  if (Number.isNaN(d.getTime())) return snapshot.value.timestamp
  const pad=(v:number)=>String(v).padStart(2,'0')
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})
type BigReadoutData = { title:string; value:string; unit:string }
function readoutData(kind:BigReadoutKind):BigReadoutData|null {
  const power=(index:number) => {
    const t=snapshot.value.power.traces[index]
    return t ? { title:t.name, value:t.value.toFixed(t.unit==='%'?1:2), unit:t.unit } : null
  }
  switch(kind){
    case 'power0': return power(0)
    case 'power1': return power(1)
    case 'power2': return power(2)
    case 'spectrumCenter': return { title:'中心波长', value:snapshot.value.spectrum.centerWavelength.toFixed(2), unit:'nm' }
    case 'spectrum3db': return { title:'3 dB 线宽', value:snapshot.value.spectrum.linewidth3Db.toFixed(2), unit:'nm' }
    case 'spectrumRms': return { title:'RMS 线宽', value:snapshot.value.spectrum.linewidthRms.toFixed(2), unit:'nm' }
    case 'spectrumPower': return { title:'光谱功率', value:snapshot.value.spectrum.power.toFixed(1), unit:'dBm' }
    case 'beamM2x': return { title:'M²x', value:snapshot.value.beam.m2x.toFixed(2), unit:'' }
    case 'beamM2y': return { title:'M²y', value:snapshot.value.beam.m2y.toFixed(2), unit:'' }
    case 'beamM2': return { title:'平均 M²', value:snapshot.value.beam.m2mean.toFixed(2), unit:'' }
    case 'scope0': {
      const t=snapshot.value.scope.time[0]; return t ? { title:t.name, value:(t.points.at(-1)?.y??0).toFixed(3), unit:'V' } : null
    }
    case 'scope1': {
      const t=snapshot.value.scope.time[1]; return t ? { title:t.name, value:(t.points.at(-1)?.y??0).toFixed(3), unit:'V' } : null
    }
  }
  return null
}
function readoutBaseWidth(kind:BigReadoutKind){
  const d=readoutData(kind)
  if(!d)return 220
  const valueChars=d.value.length
  const unitChars=Math.min(4,d.unit.length)
  return Math.max(180,Math.min(430,Math.round(28+valueChars*39+unitChars*13)))
}
function readoutSize(win:BigReadoutWindow){
  return {w:readoutBaseWidth(win.kind)*win.scale,h:BIG_READOUT_BASE_H*win.scale}
}
function readoutStyle(win:BigReadoutWindow){
  const size=readoutSize(win)
  return {
    left:`${win.x}px`,
    top:`${win.y}px`,
    width:`${size.w}px`,
    height:`${size.h}px`,
    zIndex:String(win.z),
    '--readout-scale':String(win.scale)
  }
}
function persistReadouts(){
  try{
    localStorage.setItem('laserbench.bigReadouts.v3',JSON.stringify(
      bigReadoutWindows.value.map(({kind,x,y,scale,light})=>({kind,x,y,scale,light}))
    ))
  }catch{}
}
function clampReadout(win:BigReadoutWindow){
  const size=readoutSize(win)
  win.x=Math.max(0,Math.min(win.x,Math.max(0,window.innerWidth-size.w)))
  win.y=Math.max(0,Math.min(win.y,Math.max(0,window.innerHeight-size.h)))
}
function bringReadoutToFront(win:BigReadoutWindow){
  win.z=++readoutZ
}
function openReadout(kind:BigReadoutKind){
  const existing=bigReadoutWindows.value.find(w=>w.kind===kind)
  if(existing){bringReadoutToFront(existing);clampReadout(existing);persistReadouts();return}
  const offset=(bigReadoutWindows.value.length%6)*24
  const win:BigReadoutWindow={id:nextReadoutId++,kind,x:118+offset,y:82+offset,scale:1,light:false,z:++readoutZ}
  clampReadout(win)
  bigReadoutWindows.value.push(win)
  persistReadouts()
}
function closeReadout(id:number){
  bigReadoutWindows.value=bigReadoutWindows.value.filter(w=>w.id!==id)
  persistReadouts()
}
function toggleReadoutTheme(win:BigReadoutWindow){
  bringReadoutToFront(win)
  win.light=!win.light
  persistReadouts()
}
function beginReadoutDrag(e:PointerEvent,win:BigReadoutWindow){
  bringReadoutToFront(win)
  const start={x:e.clientX,y:e.clientY,left:win.x,top:win.y}
  const move=(ev:PointerEvent)=>{
    const size=readoutSize(win)
    const maxX=Math.max(0,window.innerWidth-size.w)
    const maxY=Math.max(0,window.innerHeight-size.h)
    win.x=Math.max(0,Math.min(maxX,start.left+ev.clientX-start.x))
    win.y=Math.max(0,Math.min(maxY,start.top+ev.clientY-start.y))
  }
  const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);persistReadouts()}
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)
}
function beginReadoutResize(e:PointerEvent,win:BigReadoutWindow){
  e.stopPropagation()
  bringReadoutToFront(win)
  const baseW=readoutBaseWidth(win.kind)
  const start={x:e.clientX,y:e.clientY,scale:win.scale}
  const move=(ev:PointerEvent)=>{
    const dx=(ev.clientX-start.x)/baseW
    const dy=(ev.clientY-start.y)/BIG_READOUT_BASE_H
    const requested=start.scale+Math.max(dx,dy)
    const maxScale=Math.max(.5,Math.min(
      (window.innerWidth-win.x-3)/baseW,
      (window.innerHeight-win.y-3)/BIG_READOUT_BASE_H
    ))
    win.scale=Math.max(.5,Math.min(maxScale,requested))
  }
  const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);persistReadouts()}
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)
}

watch(() => snapshot.value.beam.z, v => {
  if(!beamPlaying.value && !beamZDragging.value && Date.now()>=beamZHoldUntil) beamZ.value=v
})
watch(() => snapshot.value.beam.attenuation, v => {
  if(!beamAttDragging.value && Date.now()>=beamAttHoldUntil) beamAtt.value=v
})
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
async function toggleRecord(){
  await request('app.record')
  recordFlash.value=false
  window.requestAnimationFrame(()=>{
    recordFlash.value=true
    window.setTimeout(()=>recordFlash.value=false,900)
  })
}
async function updateZ(value:number){beamZ.value=value;await request('beam.setZ',{value})}
async function updateAtt(value:number){beamAtt.value=value;await request('beam.setAttenuation',{value})}
async function flushBeamZ(){
  if(beamZSendBusy||beamZPending===null)return
  beamZSendBusy=true
  const value=beamZPending
  beamZPending=null
  try{await request('beam.setZ',{value})}
  finally{beamZSendBusy=false;if(beamZPending!==null)void flushBeamZ()}
}
async function flushBeamAtt(){
  if(beamAttSendBusy||beamAttPending===null)return
  beamAttSendBusy=true
  const value=beamAttPending
  beamAttPending=null
  try{await request('beam.setAttenuation',{value})}
  finally{beamAttSendBusy=false;if(beamAttPending!==null)void flushBeamAtt()}
}
function beginZDrag(){
  if(beamPlaying.value){
    beamPlaying.value=false
    if(beamTimer){window.clearInterval(beamTimer);beamTimer=undefined}
  }
  beamZDragging.value=true
  beamZHoldUntil=Number.POSITIVE_INFINITY
}
function endZDrag(){beamZDragging.value=false;beamZHoldUntil=Date.now()+450;beamZPending=beamZ.value;void flushBeamZ()}
function beginAttDrag(){beamAttDragging.value=true;beamAttHoldUntil=Number.POSITIVE_INFINITY}
function endAttDrag(){beamAttDragging.value=false;beamAttHoldUntil=Date.now()+450;beamAttPending=beamAtt.value;void flushBeamAtt()}
function onZInput(e:Event){
  const value=Number((e.target as HTMLInputElement).value)
  beamZ.value=value
  beamZHoldUntil=Date.now()+450
  beamZPending=value
  void flushBeamZ()
}
function onAttInput(e:Event){
  const value=Number((e.target as HTMLInputElement).value)
  beamAtt.value=value
  beamAttHoldUntil=Date.now()+450
  beamAttPending=value
  void flushBeamAtt()
}
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
  try{
    const saved=localStorage.getItem('laserbench.bigReadouts.v3')
    const parsed=saved?JSON.parse(saved):[]
    if(Array.isArray(parsed)){
      bigReadoutWindows.value=parsed.slice(0,12).filter(r=>r&&BIG_READOUT_KINDS.includes(r.kind)&&Number.isFinite(r.x)&&Number.isFinite(r.y)).map(r=>{
        const win:BigReadoutWindow={
          id:nextReadoutId++,
          kind:r.kind,
          x:r.x,
          y:r.y,
          scale:Number.isFinite(r.scale)?Math.max(.5,Math.min(3,r.scale)):1,
          light:!!r.light,
          z:++readoutZ
        }
        clampReadout(win)
        return win
      })
    }
  }catch{}
  stopSnapshot=onSnapshot(s=>{
    snapshot.value=s
    if(document.activeElement?.id!=='labelInput')labelDraft.value=s.label
    if(!['settings','power','spectrum','scope'].includes(activePage.value)){
      settingsDraft.value={experimentFolder:s.config?.experimentFolder??'',autoScreenshot:s.config?.autoScreenshot??false,aliases:{...(s.config?.aliases??{})},powerWindow:s.config?.powerWindow??600,osaStart:s.config?.osaStart??1060,osaStop:s.config?.osaStop??1100,scopeTimeSpan:s.config?.scopeTimeSpan??0.24,scopeFftMax:s.config?.scopeFftMax??50,scopeCh1:s.config?.scopeCh1??true,scopeCh2:s.config?.scopeCh2??true,dashboardPower1:s.config?.dashboardPower1??true,dashboardPower2:s.config?.dashboardPower2??true,dashboardMath1:s.config?.dashboardMath1??true}
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
      <div class="brand-lockup" title="LaserBench"><div class="brand-logo">L</div><div v-if="sidebarExpanded" class="brand-copy"><b>LaserBench</b><small>v{{snapshot.version}}</small></div></div>
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

      <button class="module-toggle power-accent" :class="{active:snapshot.captureSelection.power,breathing:moduleActive('power')}" @click="toggleSource('power')" title="本次采集包含功率"><img v-if="snapshot.captureSelection.power" class="acq-gif" :src="powerAcqGif" alt=""/><svg v-else viewBox="0 0 24 24"><path d="M4 19V10M9 19V5M14 19v-8M19 19V8"/></svg></button>
      <button class="module-toggle spectrum-accent" :class="{active:snapshot.captureSelection.spectrum,breathing:moduleActive('spectrum')}" @click="toggleSource('spectrum')" title="本次采集包含光谱"><img v-if="snapshot.captureSelection.spectrum" class="acq-gif" :src="spectrumAcqGif" alt=""/><svg v-else viewBox="0 0 24 24"><path d="M3 19c4 0 5-14 9-14s5 14 9 14"/></svg></button>
      <button class="module-toggle beam-accent" :class="{active:snapshot.captureSelection.beam,breathing:moduleActive('beam')}" @click="toggleSource('beam')" title="本次采集包含光束"><img v-if="snapshot.captureSelection.beam" class="acq-gif" :src="beamAcqGif" alt=""/><svg v-else viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></button>
      <button class="module-toggle scope-accent" :class="{active:snapshot.captureSelection.scope,breathing:moduleActive('scope')}" @click="toggleSource('scope')" title="本次采集包含示波器"><img v-if="snapshot.captureSelection.scope" class="acq-gif" :src="scopeAcqGif" alt=""/><svg v-else viewBox="0 0 24 24"><path d="M2 12h3c1.5 0 1.5-7 3-7s1.5 14 3 14 1.5-14 3-14 1.5 14 3 14 1.5-7 3-7h2"/></svg></button>

      <span v-if="snapshot.captureState!=='idle'" class="capture-state" :class="snapshot.captureState">{{captureStateText}}</span>
      <div class="top-spacer"></div>
      <div class="device-strip"><span v-for="d in devicesShown" :key="d.kind+d.alias" class="device-pill"><i :class="['status-dot',d.status]"></i>{{d.alias}}</span></div>
      <div class="vsep"></div>
      <button class="icon-btn camera-btn" :class="{flash:cameraFlash}" @click="screenshot" title="截图"><svg viewBox="0 0 24 24"><path d="M4 8h4l1.5-2h5L16 8h4v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></button>
      <button class="record-btn" :class="{active:snapshot.recording,flash:recordFlash}" @click="toggleRecord" title="录像"><i></i><span>REC</span><span class="record-duration" :class="{shown:snapshot.recording}">{{snapshot.recording?recordDurationText:'00:00:00'}}</span></button>
      <div class="vsep"></div><span class="clock">{{clockText}}</span>
    </header>

    <aside class="sidebar" :class="{expanded:sidebarExpanded}">
      <button :class="{active:activePage==='dashboard'}" @click="nav('dashboard')" title="总览"><svg viewBox="0 0 24 24"><path d="m3 11 9-8 9 8v9H7v-7h10v7"/></svg><span v-if="sidebarExpanded">总览</span></button>
      <button class="power-accent" :class="{active:activePage==='power'}" @click="nav('power')" title="功率"><svg viewBox="0 0 24 24"><path d="M4 19V10M9 19V5M14 19v-8M19 19V8"/></svg><span v-if="sidebarExpanded">功率</span></button>
      <button class="spectrum-accent" :class="{active:activePage==='spectrum'}" @click="nav('spectrum')" title="光谱"><svg viewBox="0 0 24 24"><path d="M3 19c4 0 5-14 9-14s5 14 9 14"/></svg><span v-if="sidebarExpanded">光谱</span></button>
      <button class="beam-accent" :class="{active:activePage==='beam'}" @click="nav('beam')" title="光束"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg><span v-if="sidebarExpanded">光束</span></button>
      <button class="scope-accent" :class="{active:activePage==='scope'}" @click="nav('scope')" title="示波器"><svg viewBox="0 0 24 24"><path d="M2 12h3c1.5 0 1.5-7 3-7s1.5 14 3 14 1.5-14 3-14 1.5 14 3 14 1.5-7 3-7h2"/></svg><span v-if="sidebarExpanded">示波器</span></button>
      <button :class="{active:activePage==='data'}" @click="nav('data')" title="数据"><svg viewBox="0 0 24 24"><path d="M5 3h11l3 3v15H5zM8 10h8M8 14h8M8 18h5"/></svg><span v-if="sidebarExpanded">数据</span></button>
      <div class="side-spacer"></div>
      <button :class="{active:activePage==='settings'}" @click="nav('settings')" title="设置"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/></svg><span v-if="sidebarExpanded">设置</span></button>
      <button class="side-search" title="搜索"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg><span v-if="sidebarExpanded">搜索</span></button>
      <button class="side-collapse" @click="sidebarExpanded=!sidebarExpanded" :title="sidebarExpanded?'折叠':'展开'"><svg viewBox="0 0 24 24"><path :d="sidebarExpanded?'m14 6-6 6 6 6':'m10 6 6 6-6 6'"/></svg><span v-if="sidebarExpanded">{{sidebarExpanded?'折叠':''}}</span></button>
    </aside>

    <main class="workspace">
      <div v-if="['data','settings'].includes(activePage)" class="page-ribbon"><button @click="nav('dashboard')">总览</button><span>/</span><strong>{{pageNames[activePage]}}</strong></div>

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
          <div class="setting-group"><h3>设备 Alias</h3><label v-for="(v,k) in settingsDraft.aliases" :key="k"><span>{{k}}</span><input v-model="settingsDraft.aliases[k]"/></label></div><div class="setting-group"><h3>运行环境</h3><label><span>运行模式</span><b>{{snapshot.mode==='SIM'?'Simulator 模拟器':'Hardware 硬件'}}</b></label><label><span>程序目录</span><small>{{snapshot.config.rootPath}}</small></label></div>
        </div>
      </section>

      <section v-if="!['data','settings'].includes(activePage)" class="dashboard-grid" :class="{'focus-mode':activePage!=='dashboard'}">
        <article class="instrument-panel power-panel" :class="{hidden:!['dashboard','power'].includes(activePage)}">
          <div class="module-head power-head graph-overlay">
            <div class="module-title"><div class="panel-mark power-accent" :class="{selected:snapshot.captureSelection.power}"><svg viewBox="0 0 24 24"><path d="M4 19V10M9 19V5M14 19v-8M19 19V8"/></svg></div><strong>功率</strong><span v-if="activePage==='power'" class="focus-page-state" :class="{running:moduleActive('power')}"><i></i>{{moduleActive('power')?'采集中':'就绪'}}</span></div>
            <div class="head-metrics">
              <template v-for="(t,index) in snapshot.power.traces" :key="t.name"><button v-if="powerVisible(index)" class="metric-trigger" @click="openReadout(powerReadoutKind(index))"><em>{{t.name}}</em><b>{{t.value.toFixed(t.unit==='%'?1:2)}}</b><small>{{t.unit}}</small></button></template>
            </div>
          </div>
          <div v-if="activePage==='power'" class="focus-summary">
            <button v-for="(t,index) in snapshot.power.traces" :key="t.name" v-show="powerVisible(index)" class="focus-metric" @click="openReadout(powerReadoutKind(index))"><span>{{t.name}}</span><b>{{t.value.toFixed(t.unit==='%'?1:2)}}</b><small>{{t.unit}}</small></button>
          </div>
          <details v-if="activePage==='power'" class="module-config-dock" open>
            <summary>显示 / 参数</summary>
            <div class="dock-row"><span>历史窗口</span><select v-model.number="settingsDraft.powerWindow" @change="saveSettings"><option :value="120">2 min</option><option :value="300">5 min</option><option :value="600">10 min</option><option :value="1800">30 min</option></select></div>
            <div class="dock-checks"><label><input type="checkbox" v-model="settingsDraft.dashboardPower1" @change="saveSettings"/>{{snapshot.power.traces[0]?.name ?? 'power1'}}</label><label><input type="checkbox" v-model="settingsDraft.dashboardPower2" @change="saveSettings"/>{{snapshot.power.traces[1]?.name ?? 'power2'}}</label><label><input type="checkbox" v-model="settingsDraft.dashboardMath1" @change="saveSettings"/>{{snapshot.power.traces[2]?.name ?? 'math1'}}</label></div>
          </details>
          <div class="power-layout"><div class="power-chart-zone">
            <PlotCanvas class="main-plot" :series="powerSeries" :x-min="0" :x-max="settingsDraft.powerWindow" :y-min="0" :y-max="powerLeftMax" :right-y-min="0" :right-y-max="100" x-label="时间 (HH:MM)" y-label="功率 (kW)" right-y-label="效率 (%)" :time-axis="true" :time-origin-ms="powerTimeOriginMs" :time-valid-max="powerHistorySpan" />
            <div class="overview-row"><div class="overview-shell"><PlotCanvas :series="powerSeries.slice(0,1)" :x-min="0" :x-max="settingsDraft.powerWindow" :compact="true" /><div class="overview-selected" :style="{width:powerProgressPct+'%'}"><i></i></div></div></div>
          </div></div>
        </article>

        <article class="instrument-panel spectrum-panel" :class="{hidden:!['dashboard','spectrum'].includes(activePage)}">
          <div class="spectrum-head graph-overlay"><div class="module-title"><div class="panel-mark inline spectrum-accent" :class="{selected:snapshot.captureSelection.spectrum}"><svg viewBox="0 0 24 24"><path d="M3 19c4 0 5-14 9-14s5 14 9 14"/></svg></div><strong>光谱</strong><span v-if="activePage==='spectrum'" class="focus-page-state" :class="{running:moduleActive('spectrum')}"><i></i>{{moduleActive('spectrum')?'采集中':'就绪'}}</span></div><div class="osa-metrics"><button class="metric-trigger primary-metric" @click="openReadout('spectrumCenter')"><em>λc</em><b>{{snapshot.spectrum.centerWavelength.toFixed(2)}}</b><small>nm</small></button><button class="metric-trigger secondary-trigger" @click="openReadout('spectrum3db')"><em>3 dB</em><b>{{snapshot.spectrum.linewidth3Db.toFixed(2)}}</b><small>nm</small></button><button class="metric-trigger secondary-trigger" @click="openReadout('spectrumRms')"><em>RMS</em><b>{{snapshot.spectrum.linewidthRms.toFixed(2)}}</b><small>nm</small></button><button class="metric-trigger primary-metric" @click="openReadout('spectrumPower')"><em>P</em><b>{{snapshot.spectrum.power.toFixed(1)}}</b><small>dBm</small></button></div></div>
          <div v-if="activePage==='spectrum'" class="focus-summary">
            <button class="focus-metric" @click="openReadout('spectrumCenter')"><span>中心波长</span><b>{{snapshot.spectrum.centerWavelength.toFixed(2)}}</b><small>nm</small></button>
            <button class="focus-metric" @click="openReadout('spectrum3db')"><span>3 dB</span><b>{{snapshot.spectrum.linewidth3Db.toFixed(2)}}</b><small>nm</small></button>
            <button class="focus-metric" @click="openReadout('spectrumRms')"><span>RMS</span><b>{{snapshot.spectrum.linewidthRms.toFixed(2)}}</b><small>nm</small></button>
            <button class="focus-metric" @click="openReadout('spectrumPower')"><span>功率</span><b>{{snapshot.spectrum.power.toFixed(1)}}</b><small>dBm</small></button>
          </div>
          <details v-if="activePage==='spectrum'" class="module-config-dock" open><summary>扫描参数</summary><div class="dock-row"><span>起始 nm</span><input type="number" v-model.number="settingsDraft.osaStart" @change="saveSettings"/></div><div class="dock-row"><span>终止 nm</span><input type="number" v-model.number="settingsDraft.osaStop" @change="saveSettings"/></div></details>
          <PlotCanvas class="spectrum-plot" :series="snapshot.spectrum.traces" :x-min="settingsDraft.osaStart" :x-max="settingsDraft.osaStop" :y-min="-100" :y-max="0" x-label="波长 (nm)" y-label="功率 (dBm)" />
        </article>

        <article class="instrument-panel beam-panel" :class="{hidden:!['dashboard','beam'].includes(activePage)}">
          <div class="module-head beam-head graph-overlay"><div class="module-title"><div class="panel-mark beam-accent" :class="{selected:snapshot.captureSelection.beam}"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></div><strong>光束</strong><span v-if="activePage==='beam'" class="focus-page-state" :class="{running:moduleActive('beam')}"><i></i>{{moduleActive('beam')?'采集中':'就绪'}}</span></div><div class="beam-top-controls"><span class="control-label">Z</span><input type="range" min="-24" max="24" step="0.1" :value="beamZ" @pointerdown="beginZDrag" @pointerup="endZDrag" @pointercancel="endZDrag" @keydown="beginZDrag" @keyup="endZDrag" @blur="endZDrag" @input="onZInput"/><b>{{beamZ.toFixed(1)}} mm</b><button class="play-mini" :class="{active:beamPlaying}" @click="toggleBeamPlay"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button><span class="control-label">Att</span><input type="range" min="0" max="40" step="0.1" :value="beamAtt" @pointerdown="beginAttDrag" @pointerup="endAttDrag" @pointercancel="endAttDrag" @keydown="beginAttDrag" @keyup="endAttDrag" @blur="endAttDrag" @input="onAttInput"/><b>{{beamAtt.toFixed(1)}} dB</b></div><div class="m2-block"><button class="metric-trigger secondary-trigger" @click="openReadout('beamM2x')"><em>M²x</em><b>{{snapshot.beam.m2x.toFixed(2)}}</b></button><button class="metric-trigger secondary-trigger" @click="openReadout('beamM2y')"><em>M²y</em><b>{{snapshot.beam.m2y.toFixed(2)}}</b></button><button class="metric-trigger primary-metric" @click="openReadout('beamM2')"><em>M̄²</em><b>{{snapshot.beam.m2mean.toFixed(2)}}</b></button></div></div>
          <div v-if="activePage==='beam'" class="focus-summary">
            <button class="focus-metric" @click="openReadout('beamM2x')"><span>M²x</span><b>{{snapshot.beam.m2x.toFixed(2)}}</b></button>
            <button class="focus-metric" @click="openReadout('beamM2y')"><span>M²y</span><b>{{snapshot.beam.m2y.toFixed(2)}}</b></button>
            <button class="focus-metric" @click="openReadout('beamM2')"><span>平均 M²</span><b>{{snapshot.beam.m2mean.toFixed(2)}}</b></button>
          </div>
          <details v-if="activePage==='beam'" class="module-config-dock beam-page-config" open>
            <summary>观察控制</summary>
            <div class="dock-control"><span>Z 位置</span><input type="range" min="-24" max="24" step="0.1" :value="beamZ" @pointerdown="beginZDrag" @pointerup="endZDrag" @pointercancel="endZDrag" @keydown="beginZDrag" @keyup="endZDrag" @blur="endZDrag" @input="onZInput"/><b>{{beamZ.toFixed(1)}} mm</b></div>
            <div class="dock-control"><span>Attenuation</span><input type="range" min="0" max="40" step="0.1" :value="beamAtt" @pointerdown="beginAttDrag" @pointerup="endAttDrag" @pointercancel="endAttDrag" @keydown="beginAttDrag" @keyup="endAttDrag" @blur="endAttDrag" @input="onAttInput"/><b>{{beamAtt.toFixed(1)}} dB</b></div>
            <button class="dock-play" :class="{active:beamPlaying}" @click="toggleBeamPlay">{{beamPlaying?'停止 Z 浏览':'自动 Z 浏览'}}</button>
          </details>
          <div class="beam-body"><div class="beam-image-wrap"><BeamProfileCanvas :width-x="snapshot.beam.spotWidthX" :width-y="snapshot.beam.spotWidthY" :attenuation="beamAtt" /></div><PlotCanvas class="caustic-plot" :series="snapshot.beam.caustic" :vertical-marker="beamZ" :x-padding="0.04" x-label="Z (mm)" y-label="束宽 (μm)" /></div>
        </article>

        <article class="instrument-panel scope-panel" :class="{hidden:!['dashboard','scope'].includes(activePage)}">
          <div class="module-head scope-head graph-overlay"><div class="module-title"><div class="panel-mark scope-accent" :class="{selected:snapshot.captureSelection.scope}"><svg viewBox="0 0 24 24"><path d="M2 12h3c1.5 0 1.5-7 3-7s1.5 14 3 14 1.5-14 3-14 1.5 14 3 14 1.5-7 3-7h2"/></svg></div><strong>示波器</strong><span v-if="activePage==='scope'" class="focus-page-state" :class="{running:moduleActive('scope')}"><i></i>{{moduleActive('scope')?'采集中':'就绪'}}</span></div><div class="scope-readouts"><button v-for="(trace,index) in snapshot.scope.time" :key="trace.name" class="metric-trigger" @click="openReadout(index===0?'scope0':'scope1')"><em>{{trace.name}}</em><b>{{trace.points.at(-1)?.y.toFixed(3) ?? '0.000'}}</b><small>V</small></button><span class="secondary-metric"><em>SR</em><b>2.5</b><small>MSa/s</small></span></div></div>
          <div v-if="activePage==='scope'" class="focus-summary">
            <button v-for="(trace,index) in snapshot.scope.time" :key="trace.name" class="focus-metric" @click="openReadout(index===0?'scope0':'scope1')"><span>{{trace.name}}</span><b>{{trace.points.at(-1)?.y.toFixed(3) ?? '0.000'}}</b><small>V</small></button>
            <div class="focus-metric passive"><span>采样率</span><b>2.5</b><small>MSa/s</small></div>
          </div>
          <details v-if="activePage==='scope'" class="module-config-dock" open><summary>显示 / 参数</summary><div class="dock-row"><span>时间窗 ms</span><input type="number" step="0.01" v-model.number="settingsDraft.scopeTimeSpan" @change="saveSettings"/></div><div class="dock-row"><span>FFT 上限 MHz</span><input type="number" v-model.number="settingsDraft.scopeFftMax" @change="saveSettings"/></div><div class="dock-checks"><label><input type="checkbox" v-model="settingsDraft.scopeCh1" @change="saveSettings"/>CH1</label><label><input type="checkbox" v-model="settingsDraft.scopeCh2" @change="saveSettings"/>CH2</label></div></details>
          <div class="scope-plots"><PlotCanvas :series="snapshot.scope.time" :x-min="0" :x-max="settingsDraft.scopeTimeSpan" :y-min="-1" :y-max="1" x-label="时间 (ms)" y-label="电压 (V)" :tight="true" :stacked="true" /><PlotCanvas :series="snapshot.scope.fft" :x-min="0" :x-max="settingsDraft.scopeFftMax*1000" x-label="频率 (kHz)" y-label="幅值 (a.u.)" :tight="true" :stacked="true" /></div>
        </article>
      </section>
    </main>
    <div v-if="cameraFlash" class="capture-toast">截图已保存</div>
    <div v-for="win in bigReadoutWindows" :key="win.id" class="big-readout-window" :class="{light:win.light}" :style="readoutStyle(win)" role="dialog" aria-label="大读数" @pointerdown="beginReadoutDrag($event,win)">
      <div class="big-readout-top">
        <div class="big-readout-identity"><i></i><span>{{readoutData(win.kind)?.title}}</span></div>
        <div class="big-readout-actions">
          <button class="readout-theme-toggle" @pointerdown.stop @click="toggleReadoutTheme(win)" :title="win.light?'切换为黑底白字':'切换为白底黑字'"><span></span></button>
          <button class="readout-close" @pointerdown.stop @click="closeReadout(win.id)" title="关闭">×</button>
        </div>
      </div>
      <div class="big-readout-body"><div class="big-readout-value">{{readoutData(win.kind)?.value}}<small v-if="readoutData(win.kind)?.unit">{{readoutData(win.kind)?.unit}}</small></div></div>
      <div class="big-readout-resize" @pointerdown.stop="beginReadoutResize($event,win)" title="拖动缩放"><i></i><i></i><i></i></div>
    </div>
  </div>
</template>
