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
const beamZDragging = ref(false)
const beamAttDragging = ref(false)
let beamZPending:number|null=null
let beamAttPending:number|null=null
let beamZSendBusy=false
let beamAttSendBusy=false
let beamZHoldUntil=0
let beamAttHoldUntil=0
const cameraFlash = ref(false)
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
  dashboardPower1:snapshot.value.config?.dashboardPower1??true, dashboardPower2:snapshot.value.config?.dashboardPower2??true, dashboardMath1:snapshot.value.config?.dashboardMath1??true,
  powerActiveTrace:snapshot.value.config?.powerActiveTrace??0, powerAverageSamples:snapshot.value.config?.powerAverageSamples??1,
  powerOffset:snapshot.value.config?.powerOffset??0, powerScale:snapshot.value.config?.powerScale??1,
  powerNormalize:snapshot.value.config?.powerNormalize??false, powerNormalizeValue:snapshot.value.config?.powerNormalizeValue??1,
  powerDensity:snapshot.value.config?.powerDensity??false, powerAreaCm2:snapshot.value.config?.powerAreaCm2??1,
  powerPassFail:snapshot.value.config?.powerPassFail??false, powerLow:snapshot.value.config?.powerLow??0, powerHigh:snapshot.value.config?.powerHigh??20,
  osaResolution:snapshot.value.config?.osaResolution??0.05, osaSensitivity:snapshot.value.config?.osaSensitivity??'MID',
  osaAverage:snapshot.value.config?.osaAverage??1, osaRefLevel:snapshot.value.config?.osaRefLevel??0, osaDbPerDiv:snapshot.value.config?.osaDbPerDiv??10,
  osaShowRef:snapshot.value.config?.osaShowRef??true, osaSweepMode:snapshot.value.config?.osaSweepMode??'REPEAT', osaMarkerPeak:snapshot.value.config?.osaMarkerPeak??true,
  beamRunMode:snapshot.value.config?.beamRunMode??'AUTO', beamWidthMethod:snapshot.value.config?.beamWidthMethod??'D4SIGMA',
  beamAutoOutlier:snapshot.value.config?.beamAutoOutlier??true, beamShowX:snapshot.value.config?.beamShowX??true, beamShowY:snapshot.value.config?.beamShowY??true,
  scopeVoltsDiv:snapshot.value.config?.scopeVoltsDiv??0.25, scopeOffset:snapshot.value.config?.scopeOffset??0, scopeCoupling:snapshot.value.config?.scopeCoupling??'DC',
  scopeTriggerSource:snapshot.value.config?.scopeTriggerSource??'CH1', scopeTriggerLevel:snapshot.value.config?.scopeTriggerLevel??0,
  scopeTriggerSlope:snapshot.value.config?.scopeTriggerSlope??'RISING', scopeAcquisition:snapshot.value.config?.scopeAcquisition??'SAMPLE', scopeAverage:snapshot.value.config?.scopeAverage??16
})
const dataFilter=ref('')
const powerRangeStartPct=ref(0)
const powerRangeEndPct=ref(100)
const powerOverviewShell=ref<HTMLElement|null>(null)
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
const powerRangeStart = computed(() => settingsDraft.value.powerWindow*powerRangeStartPct.value/100)
const powerRangeEnd = computed(() => settingsDraft.value.powerWindow*powerRangeEndPct.value/100)
const powerSelectionStyle = computed(() => ({
  '--range-left':`${powerRangeStartPct.value}%`,
  '--range-width':`${Math.max(0,powerRangeEndPct.value-powerRangeStartPct.value)}%`
}))
const powerLeftMax = computed(() => {
  const values=visiblePowerTraces.value.filter(t=>t.unit!=='%').flatMap(t=>t.points.map(p=>p.y))
  return Math.max(5, Math.ceil(Math.max(...values, 1) / 5) * 5)
})
function powerTransform(value:number,index:number){
  if(index!==settingsDraft.value.powerActiveTrace)return value
  let next=(value+settingsDraft.value.powerOffset)*settingsDraft.value.powerScale
  if(settingsDraft.value.powerNormalize) next/=Math.max(1e-12,settingsDraft.value.powerNormalizeValue)
  if(settingsDraft.value.powerDensity) next/=Math.max(1e-9,settingsDraft.value.powerAreaCm2)
  return next
}
function averagedPowerPoints(points:{x:number;y:number}[],count:number){
  const n=Math.max(1,Math.floor(count))
  if(n<=1)return points
  let sum=0
  const q:number[]=[]
  return points.map(p=>{
    q.push(p.y);sum+=p.y
    if(q.length>n)sum-=q.shift()!
    return {x:p.x,y:sum/q.length}
  })
}
const powerPageSeries = computed<PlotSeries[]>(() => powerSeries.value.map((s,index)=>{
  const transformed=s.points.map(p=>({x:p.x,y:powerTransform(p.y,index)}))
  return {...s,points:index===settingsDraft.value.powerActiveTrace?averagedPowerPoints(transformed,settingsDraft.value.powerAverageSamples):transformed}
}))
const powerPageLeftMax = computed(()=>{
  const values=powerPageSeries.value.filter(s=>s.axis!=='right').flatMap(s=>s.points.map(p=>p.y)).filter(Number.isFinite)
  return Math.max(1,Math.ceil(Math.max(...values,1)*1.08))
})
const powerPageUnit = computed(()=>{
  const t=snapshot.value.power.traces[settingsDraft.value.powerActiveTrace]
  if(!t)return ''
  if(settingsDraft.value.powerDensity && t.unit!=='%')return t.unit+'/cm²'
  if(settingsDraft.value.powerNormalize)return 'rel.'
  return t.unit
})
const powerPageAxisLabel = computed(()=>{
  const t=snapshot.value.power.traces[settingsDraft.value.powerActiveTrace]
  if(!t)return '功率'
  if(settingsDraft.value.powerDensity && t.unit!=='%')return `功率密度 (${t.unit}/cm²)`
  if(settingsDraft.value.powerNormalize)return '归一化值 (rel.)'
  return t.unit==='%'?'效率 (%)':`功率 (${t.unit})`
})
const powerActiveValue = computed(()=>{
  const t=snapshot.value.power.traces[settingsDraft.value.powerActiveTrace]
  return t?powerTransform(t.value,settingsDraft.value.powerActiveTrace):0
})
const powerPassState = computed(()=>{
  if(!settingsDraft.value.powerPassFail)return 'OFF'
  return powerActiveValue.value>=settingsDraft.value.powerLow && powerActiveValue.value<=settingsDraft.value.powerHigh?'PASS':'FAIL'
})
const spectrumPageSeries = computed(()=>snapshot.value.spectrum.traces.filter((_,i)=>i===0||settingsDraft.value.osaShowRef))
const osaCenterDraft = computed({
  get:()=> (settingsDraft.value.osaStart+settingsDraft.value.osaStop)/2,
  set:(v:number)=>{const span=settingsDraft.value.osaStop-settingsDraft.value.osaStart;settingsDraft.value.osaStart=v-span/2;settingsDraft.value.osaStop=v+span/2}
})
const osaSpanDraft = computed({
  get:()=> settingsDraft.value.osaStop-settingsDraft.value.osaStart,
  set:(v:number)=>{const span=Math.max(.01,v);const c=osaCenterDraft.value;settingsDraft.value.osaStart=c-span/2;settingsDraft.value.osaStop=c+span/2}
})
const osaYMax = computed(()=>settingsDraft.value.osaRefLevel)
const osaYMin = computed(()=>settingsDraft.value.osaRefLevel-settingsDraft.value.osaDbPerDiv*10)
const beamPageCaustic = computed(()=>snapshot.value.beam.caustic.filter((_,i)=>(i===0&&settingsDraft.value.beamShowX)||(i===1&&settingsDraft.value.beamShowY)))
const beamEllipticity = computed(()=>snapshot.value.beam.spotWidthX>0?snapshot.value.beam.spotWidthY/snapshot.value.beam.spotWidthX:0)
const scopeYMin = computed(()=>settingsDraft.value.scopeOffset-settingsDraft.value.scopeVoltsDiv*4)
const scopeYMax = computed(()=>settingsDraft.value.scopeOffset+settingsDraft.value.scopeVoltsDiv*4)
function powerVisible(index:number){ return powerVisibility.value[index] ?? true }
function powerReadoutKind(index:number):BigReadoutKind { return (['power0','power1','power2'][index] ?? 'power0') as BigReadoutKind }
function updatePowerRangeFromPointer(side:'start'|'end',clientX:number){
  const el=powerOverviewShell.value
  if(!el)return
  const rect=el.getBoundingClientRect()
  const pct=Math.max(0,Math.min(100,(clientX-rect.left)/Math.max(1,rect.width)*100))
  const minGap=2
  if(side==='start')powerRangeStartPct.value=Math.min(pct,powerRangeEndPct.value-minGap)
  else powerRangeEndPct.value=Math.max(pct,powerRangeStartPct.value+minGap)
}
function beginPowerRangeDrag(e:PointerEvent,side:'start'|'end'){
  e.preventDefault()
  updatePowerRangeFromPointer(side,e.clientX)
  const move=(ev:PointerEvent)=>updatePowerRangeFromPointer(side,ev.clientX)
  const stop=()=>{
    window.removeEventListener('pointermove',move)
    window.removeEventListener('pointerup',stop)
    window.removeEventListener('pointercancel',stop)
  }
  window.addEventListener('pointermove',move)
  window.addEventListener('pointerup',stop)
  window.addEventListener('pointercancel',stop)
}
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
    case 'beamM2': return { title:'M²', value:snapshot.value.beam.m2mean.toFixed(2), unit:'' }
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
  if(activePage.value!=='dashboard')return
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
async function toggleRecord(){ await request('app.record') }
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
function zeroPowerActive(){
  const t=snapshot.value.power.traces[settingsDraft.value.powerActiveTrace]
  if(!t)return
  settingsDraft.value.powerOffset=-t.value
  void saveSettings()
}
function normalizePowerAtCurrent(){
  const t=snapshot.value.power.traces[settingsDraft.value.powerActiveTrace]
  if(!t)return
  settingsDraft.value.powerNormalizeValue=Math.max(1e-12,Math.abs((t.value+settingsDraft.value.powerOffset)*settingsDraft.value.powerScale))
  settingsDraft.value.powerNormalize=true
  void saveSettings()
}
function resetPowerProcessing(){
  settingsDraft.value.powerAverageSamples=1
  settingsDraft.value.powerOffset=0
  settingsDraft.value.powerScale=1
  settingsDraft.value.powerNormalize=false
  settingsDraft.value.powerNormalizeValue=1
  settingsDraft.value.powerDensity=false
  settingsDraft.value.powerAreaCm2=1
  settingsDraft.value.powerPassFail=false
  void saveSettings()
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
  document.documentElement.dataset.acqVectors='mounted'
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
    if(!['settings','power','spectrum','beam','scope'].includes(activePage.value)){
      settingsDraft.value={experimentFolder:s.config?.experimentFolder??'',autoScreenshot:s.config?.autoScreenshot??false,aliases:{...(s.config?.aliases??{})},powerWindow:s.config?.powerWindow??600,osaStart:s.config?.osaStart??1060,osaStop:s.config?.osaStop??1100,scopeTimeSpan:s.config?.scopeTimeSpan??0.24,scopeFftMax:s.config?.scopeFftMax??50,scopeCh1:s.config?.scopeCh1??true,scopeCh2:s.config?.scopeCh2??true,dashboardPower1:s.config?.dashboardPower1??true,dashboardPower2:s.config?.dashboardPower2??true,dashboardMath1:s.config?.dashboardMath1??true,powerActiveTrace:s.config?.powerActiveTrace??0,powerAverageSamples:s.config?.powerAverageSamples??1,powerOffset:s.config?.powerOffset??0,powerScale:s.config?.powerScale??1,powerNormalize:s.config?.powerNormalize??false,powerNormalizeValue:s.config?.powerNormalizeValue??1,powerDensity:s.config?.powerDensity??false,powerAreaCm2:s.config?.powerAreaCm2??1,powerPassFail:s.config?.powerPassFail??false,powerLow:s.config?.powerLow??0,powerHigh:s.config?.powerHigh??20,osaResolution:s.config?.osaResolution??0.05,osaSensitivity:s.config?.osaSensitivity??'MID',osaAverage:s.config?.osaAverage??1,osaRefLevel:s.config?.osaRefLevel??0,osaDbPerDiv:s.config?.osaDbPerDiv??10,osaShowRef:s.config?.osaShowRef??true,osaSweepMode:s.config?.osaSweepMode??'REPEAT',osaMarkerPeak:s.config?.osaMarkerPeak??true,beamRunMode:s.config?.beamRunMode??'AUTO',beamWidthMethod:s.config?.beamWidthMethod??'D4SIGMA',beamAutoOutlier:s.config?.beamAutoOutlier??true,beamShowX:s.config?.beamShowX??true,beamShowY:s.config?.beamShowY??true,scopeVoltsDiv:s.config?.scopeVoltsDiv??0.25,scopeOffset:s.config?.scopeOffset??0,scopeCoupling:s.config?.scopeCoupling??'DC',scopeTriggerSource:s.config?.scopeTriggerSource??'CH1',scopeTriggerLevel:s.config?.scopeTriggerLevel??0,scopeTriggerSlope:s.config?.scopeTriggerSlope??'RISING',scopeAcquisition:s.config?.scopeAcquisition??'SAMPLE',scopeAverage:s.config?.scopeAverage??16}
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
        <div class="label-actions">
          <button class="clear-label" @click="labelDraft=''" title="清空 Label">×</button>
          <button class="check-btn" @click="setLabel" title="确认 Label"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></button>
        </div>
      </div>
      <div class="vsep"></div>

      <button class="module-toggle power-accent" :class="{active:snapshot.captureSelection.power}" @click="toggleSource('power')" title="本次采集包含功率">
        <svg class="acq-vector acq-power" viewBox="0 0 24 24" aria-hidden="true">
          <rect class="bar b1" x="2.5" y="10" width="4" height="10" rx="1.4"/>
          <rect class="bar b2" x="7.5" y="6" width="4" height="14" rx="1.4"/>
          <rect class="bar b3" x="12.5" y="12" width="4" height="8" rx="1.4"/>
          <rect class="bar b4" x="17.5" y="8" width="4" height="12" rx="1.4"/>
        </svg>
      </button>
      <button class="module-toggle spectrum-accent" :class="{active:snapshot.captureSelection.spectrum}" @click="toggleSource('spectrum')" title="本次采集包含光谱">
        <svg class="acq-vector acq-spectrum" viewBox="0 0 24 24" aria-hidden="true">
          <path class="peak" d="M2 18c3 0 4-12 8-12s4 12 7 12c2 0 2-4 5-4"/>
        </svg>
      </button>
      <button class="module-toggle beam-accent" :class="{active:snapshot.captureSelection.beam}" @click="toggleSource('beam')" title="本次采集包含光束">
        <svg class="acq-vector acq-beam" viewBox="0 0 24 24" aria-hidden="true">
          <path class="cross" d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>
          <circle class="core" cx="12" cy="12" r="2"/>
          <circle class="beam-ring" cx="12" cy="12" r="7"/>
        </svg>
      </button>
      <button class="module-toggle scope-accent" :class="{active:snapshot.captureSelection.scope}" @click="toggleSource('scope')" title="本次采集包含示波器">
        <svg class="acq-vector acq-scope" viewBox="0 0 24 24" aria-hidden="true">
          <g class="scope-wave-flow">
            <path d="M0 12h3c1.5 0 1.5-7 3-7s1.5 14 3 14 1.5-14 3-14 1.5 14 3 14 1.5-7 3-7h6"/>
            <path transform="translate(24 0)" d="M0 12h3c1.5 0 1.5-7 3-7s1.5 14 3 14 1.5-14 3-14 1.5 14 3 14 1.5-7 3-7h6"/>
          </g>
        </svg>
      </button>

      <span v-if="snapshot.captureState!=='idle'" class="capture-state" :class="snapshot.captureState">{{captureStateText}}</span>
      <div class="top-spacer"></div>
      <div class="device-strip"><span v-for="d in devicesShown" :key="d.kind+d.alias" class="device-pill"><i :class="['status-dot',d.status]"></i>{{d.alias}}</span></div>
      <div class="vsep"></div>
      <button class="icon-btn camera-btn" @click="screenshot" title="截图"><svg viewBox="0 0 24 24"><path d="M4 8h4l1.5-2h5L16 8h4v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></button>
      <button class="record-btn" :class="{active:snapshot.recording}" @click="toggleRecord" title="录像"><i></i><span>REC</span><span class="record-duration" :class="{shown:snapshot.recording}">{{snapshot.recording?recordDurationText:'00:00:00'}}</span></button>
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
      <button :class="{active:activePage==='settings'}" @click="nav('settings')" title="设置"><svg viewBox="0 0 24 24"><path d="M9.7 3.2h4.6l.7 2.1 2 .8 2-1 2.3 4-1.7 1.4.2 2.1 1.5 1.6-2.3 4-2.1-.8-1.8 1.2-.4 2.3H9.7L9 18.7l-2-.8-2 1-2.3-4 1.7-1.4-.2-2.1-1.5-1.6 2.3-4 2.1.8L9 5.5z"/><circle cx="12" cy="12" r="3"/></svg><span v-if="sidebarExpanded">设置</span></button>
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
              <template v-for="(t,index) in snapshot.power.traces" :key="t.name"><button v-if="powerVisible(index)" class="metric-trigger" @click="openReadout(powerReadoutKind(index))"><em>{{t.name}}</em><span class="metric-value-chip"><b>{{t.value.toFixed(t.unit==='%'?1:2)}}</b><small>{{t.unit}}</small></span></button></template>
            </div>
          </div>

          <div v-if="activePage==='power'" class="focus-summary focus-power-summary">
            <div v-for="(t,index) in snapshot.power.traces" :key="t.name" v-show="powerVisible(index)" class="focus-metric" :class="{selected:index===settingsDraft.powerActiveTrace}">
              <span>{{t.name}}</span><div><b>{{powerTransform(t.value,index).toFixed(t.unit==='%'?1:2)}}</b><small>{{index===settingsDraft.powerActiveTrace?powerPageUnit:t.unit}}</small></div><small>Max {{t.maxValue.toFixed(t.unit==='%'?1:2)}} {{t.unit}}</small>
            </div>
            <div class="focus-metric pass-state" :class="powerPassState.toLowerCase()"><span>判定</span><div><b>{{powerPassState}}</b></div><small v-if="settingsDraft.powerPassFail">{{settingsDraft.powerLow}} – {{settingsDraft.powerHigh}}</small></div>
          </div>

          <details v-if="activePage==='power'" class="module-config-dock workstation-config" open>
            <summary>功率计参数</summary>
            <div class="config-section"><h4>通道 / 显示</h4>
              <label class="config-row"><span>活动通道</span><select v-model.number="settingsDraft.powerActiveTrace" @change="saveSettings"><option v-for="(t,index) in snapshot.power.traces" :key="t.name" :value="index">{{t.name}}</option></select></label>
              <label class="config-row"><span>历史窗口</span><select v-model.number="settingsDraft.powerWindow" @change="saveSettings"><option :value="120">2 min</option><option :value="300">5 min</option><option :value="600">10 min</option><option :value="1800">30 min</option></select></label>
              <div class="config-checks"><label><input type="checkbox" v-model="settingsDraft.dashboardPower1" @change="saveSettings"/>{{snapshot.power.traces[0]?.name ?? 'power1'}}</label><label><input type="checkbox" v-model="settingsDraft.dashboardPower2" @change="saveSettings"/>{{snapshot.power.traces[1]?.name ?? 'power2'}}</label><label><input type="checkbox" v-model="settingsDraft.dashboardMath1" @change="saveSettings"/>{{snapshot.power.traces[2]?.name ?? 'math1'}}</label></div>
            </div>
            <div class="config-section"><h4>测量处理</h4>
              <label class="config-row"><span>平均采样数</span><input type="number" min="1" max="200" v-model.number="settingsDraft.powerAverageSamples" @change="saveSettings"/><small>samples</small></label>
              <label class="config-row"><span>Offset</span><input type="number" step="0.01" v-model.number="settingsDraft.powerOffset" @change="saveSettings"/><small>{{snapshot.power.traces[settingsDraft.powerActiveTrace]?.unit}}</small></label>
              <label class="config-row"><span>Scale</span><input type="number" step="0.01" v-model.number="settingsDraft.powerScale" @change="saveSettings"/><small>×</small></label>
              <label class="config-row switch"><span>Normalize</span><input type="checkbox" v-model="settingsDraft.powerNormalize" @change="saveSettings"/></label>
              <label class="config-row"><span>Normalize reference</span><input type="number" step="0.01" v-model.number="settingsDraft.powerNormalizeValue" @change="saveSettings"/><small>{{snapshot.power.traces[settingsDraft.powerActiveTrace]?.unit}}</small></label>
              <label class="config-row switch"><span>Power density</span><input type="checkbox" v-model="settingsDraft.powerDensity" @change="saveSettings"/></label>
              <label class="config-row"><span>Sensor area</span><input type="number" step="0.01" min="0.000001" v-model.number="settingsDraft.powerAreaCm2" @change="saveSettings"/><small>cm²</small></label>
              <div class="config-actions"><button @click="zeroPowerActive">Zero</button><button @click="normalizePowerAtCurrent">Normalize now</button><button @click="resetPowerProcessing">Reset processing</button></div>
            </div>
            <div class="config-section"><h4>Pass / Fail</h4>
              <label class="config-row switch"><span>Enable limits</span><input type="checkbox" v-model="settingsDraft.powerPassFail" @change="saveSettings"/></label>
              <label class="config-row"><span>Low limit</span><input type="number" step="0.01" v-model.number="settingsDraft.powerLow" @change="saveSettings"/></label>
              <label class="config-row"><span>High limit</span><input type="number" step="0.01" v-model.number="settingsDraft.powerHigh" @change="saveSettings"/></label>
            </div>
          </details>

          <div class="power-layout"><div class="power-chart-zone">
            <PlotCanvas class="main-plot" :series="activePage==='power'?powerPageSeries:powerSeries" :x-min="powerRangeStart" :x-max="powerRangeEnd" :y-min="0" :y-max="activePage==='power'?powerPageLeftMax:powerLeftMax" :right-y-min="0" :right-y-max="100" x-label="时间 (HH:MM)" :y-label="activePage==='power'?powerPageAxisLabel:'功率 (kW)'" right-y-label="效率 (%)" :show-axis-labels="activePage==='power'" :time-axis="true" :time-origin-ms="powerTimeOriginMs" :time-valid-max="powerHistorySpan" />
            <div class="overview-row"><div ref="powerOverviewShell" class="overview-shell"><PlotCanvas :series="powerSeries.slice(0,1)" :x-min="0" :x-max="settingsDraft.powerWindow" :compact="true" /><div class="overview-selected" :style="powerSelectionStyle"><i class="overview-handle start" @pointerdown.stop="beginPowerRangeDrag($event,'start')"></i><i class="overview-handle end" @pointerdown.stop="beginPowerRangeDrag($event,'end')"></i></div></div></div>
          </div></div>
        </article>

        <article class="instrument-panel spectrum-panel" :class="{hidden:!['dashboard','spectrum'].includes(activePage)}">
          <div class="spectrum-head graph-overlay">
            <div class="module-title"><div class="panel-mark inline spectrum-accent" :class="{selected:snapshot.captureSelection.spectrum}"><svg viewBox="0 0 24 24"><path d="M3 19c4 0 5-14 9-14s5 14 9 14"/></svg></div><strong>光谱</strong><span v-if="activePage==='spectrum'" class="focus-page-state" :class="{running:moduleActive('spectrum')}"><i></i>{{moduleActive('spectrum')?'采集中':'就绪'}}</span></div>
            <div class="osa-metrics"><button class="metric-trigger primary-metric" @click="openReadout('spectrumCenter')"><em>λc</em><span class="metric-value-chip"><b>{{snapshot.spectrum.centerWavelength.toFixed(2)}}</b><small>nm</small></span></button><button class="metric-trigger secondary-trigger" @click="openReadout('spectrum3db')"><em>3 dB</em><span class="metric-value-chip"><b>{{snapshot.spectrum.linewidth3Db.toFixed(2)}}</b><small>nm</small></span></button><button class="metric-trigger secondary-trigger" @click="openReadout('spectrumRms')"><em>RMS</em><span class="metric-value-chip"><b>{{snapshot.spectrum.linewidthRms.toFixed(2)}}</b><small>nm</small></span></button><button class="metric-trigger primary-metric" @click="openReadout('spectrumPower')"><em>P</em><span class="metric-value-chip"><b>{{snapshot.spectrum.power.toFixed(1)}}</b><small>dBm</small></span></button></div>
          </div>

          <div v-if="activePage==='spectrum'" class="focus-summary">
            <div class="focus-metric"><span>中心波长 λc</span><div><b>{{snapshot.spectrum.centerWavelength.toFixed(2)}}</b><small>nm</small></div></div>
            <div class="focus-metric"><span>3 dB 线宽</span><div><b>{{snapshot.spectrum.linewidth3Db.toFixed(2)}}</b><small>nm</small></div></div>
            <div class="focus-metric"><span>RMS 线宽</span><div><b>{{snapshot.spectrum.linewidthRms.toFixed(2)}}</b><small>nm</small></div></div>
            <div class="focus-metric"><span>积分功率</span><div><b>{{snapshot.spectrum.power.toFixed(1)}}</b><small>dBm</small></div></div>
          </div>

          <details v-if="activePage==='spectrum'" class="module-config-dock workstation-config" open>
            <summary>OSA 扫描 / 分析</summary>
            <div class="config-section"><h4>波长范围</h4>
              <label class="config-row"><span>Start wavelength</span><input type="number" step="0.01" v-model.number="settingsDraft.osaStart" @change="saveSettings"/><small>nm</small></label>
              <label class="config-row"><span>Stop wavelength</span><input type="number" step="0.01" v-model.number="settingsDraft.osaStop" @change="saveSettings"/><small>nm</small></label>
              <label class="config-row"><span>Center wavelength</span><input type="number" step="0.01" v-model.number="osaCenterDraft" @change="saveSettings"/><small>nm</small></label>
              <label class="config-row"><span>Span</span><input type="number" step="0.01" min="0.01" v-model.number="osaSpanDraft" @change="saveSettings"/><small>nm</small></label>
            </div>
            <div class="config-section"><h4>采集</h4>
              <label class="config-row"><span>Resolution bandwidth</span><select v-model.number="settingsDraft.osaResolution" @change="saveSettings"><option :value="0.02">0.02</option><option :value="0.05">0.05</option><option :value="0.1">0.10</option><option :value="0.2">0.20</option><option :value="0.5">0.50</option><option :value="1">1.00</option></select><small>nm</small></label>
              <label class="config-row"><span>Sensitivity</span><select v-model="settingsDraft.osaSensitivity" @change="saveSettings"><option>LOW</option><option>MID</option><option>HIGH1</option><option>HIGH2</option></select></label>
              <label class="config-row"><span>Averaging</span><input type="number" min="1" max="999" v-model.number="settingsDraft.osaAverage" @change="saveSettings"/><small>sweeps</small></label>
              <label class="config-row"><span>Sweep mode</span><select v-model="settingsDraft.osaSweepMode" @change="saveSettings"><option>SINGLE</option><option>REPEAT</option></select></label>
            </div>
            <div class="config-section"><h4>显示 / Marker</h4>
              <label class="config-row"><span>Reference level</span><input type="number" step="1" v-model.number="settingsDraft.osaRefLevel" @change="saveSettings"/><small>dBm</small></label>
              <label class="config-row"><span>Scale</span><input type="number" min="0.1" max="10" step="0.1" v-model.number="settingsDraft.osaDbPerDiv" @change="saveSettings"/><small>dB/div</small></label>
              <label class="config-row switch"><span>Reference trace</span><input type="checkbox" v-model="settingsDraft.osaShowRef" @change="saveSettings"/></label>
              <label class="config-row switch"><span>Peak marker</span><input type="checkbox" v-model="settingsDraft.osaMarkerPeak" @change="saveSettings"/></label>
            </div>
          </details>
          <PlotCanvas class="spectrum-plot" :series="activePage==='spectrum'?spectrumPageSeries:snapshot.spectrum.traces" :x-min="settingsDraft.osaStart" :x-max="settingsDraft.osaStop" :y-min="activePage==='spectrum'?osaYMin:-100" :y-max="activePage==='spectrum'?osaYMax:0" :vertical-marker="activePage==='spectrum'&&settingsDraft.osaMarkerPeak?snapshot.spectrum.centerWavelength:undefined" x-label="波长 (nm)" y-label="功率 (dBm)" :show-axis-labels="activePage==='spectrum'" />
        </article>

        <article class="instrument-panel beam-panel" :class="{hidden:!['dashboard','beam'].includes(activePage)}">
          <div class="module-head beam-head graph-overlay">
            <div class="module-title"><div class="panel-mark beam-accent" :class="{selected:snapshot.captureSelection.beam}"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></div><strong>光束</strong><span v-if="activePage==='beam'" class="focus-page-state" :class="{running:moduleActive('beam')}"><i></i>{{moduleActive('beam')?'采集中':'就绪'}}</span></div>
            <div class="beam-top-controls"><span class="control-label">Z</span><input type="range" min="-24" max="24" step="0.1" :value="beamZ" @pointerdown="beginZDrag" @pointerup="endZDrag" @pointercancel="endZDrag" @keydown="beginZDrag" @keyup="endZDrag" @blur="endZDrag" @input="onZInput"/><b>{{beamZ.toFixed(1)}} mm</b><button class="play-mini" :class="{active:beamPlaying}" @click="toggleBeamPlay"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button><span class="control-label">Att</span><input type="range" min="0" max="40" step="0.1" :value="beamAtt" @pointerdown="beginAttDrag" @pointerup="endAttDrag" @pointercancel="endAttDrag" @keydown="beginAttDrag" @keyup="endAttDrag" @blur="endAttDrag" @input="onAttInput"/><b>{{beamAtt.toFixed(1)}} dB</b></div>
            <div class="m2-block"><button class="metric-trigger secondary-trigger" @click="openReadout('beamM2x')"><em>M²x</em><span class="metric-value-chip"><b>{{snapshot.beam.m2x.toFixed(2)}}</b></span></button><button class="metric-trigger secondary-trigger" @click="openReadout('beamM2y')"><em>M²y</em><span class="metric-value-chip"><b>{{snapshot.beam.m2y.toFixed(2)}}</b></span></button><button class="metric-trigger primary-metric" @click="openReadout('beamM2')"><em>M²</em><span class="metric-value-chip"><b>{{snapshot.beam.m2mean.toFixed(2)}}</b></span></button></div>
          </div>

          <div v-if="activePage==='beam'" class="focus-summary">
            <div class="focus-metric"><span>M² X</span><div><b>{{snapshot.beam.m2x.toFixed(2)}}</b></div></div>
            <div class="focus-metric"><span>M² Y</span><div><b>{{snapshot.beam.m2y.toFixed(2)}}</b></div></div>
            <div class="focus-metric"><span>M²</span><div><b>{{snapshot.beam.m2mean.toFixed(2)}}</b></div></div>
            <div class="focus-metric"><span>Beam width X</span><div><b>{{snapshot.beam.spotWidthX.toFixed(0)}}</b><small>μm</small></div></div>
            <div class="focus-metric"><span>Beam width Y</span><div><b>{{snapshot.beam.spotWidthY.toFixed(0)}}</b><small>μm</small></div></div>
            <div class="focus-metric"><span>Ellipticity Y/X</span><div><b>{{beamEllipticity.toFixed(3)}}</b></div></div>
          </div>

          <details v-if="activePage==='beam'" class="module-config-dock workstation-config beam-page-config" open>
            <summary>BeamSquared / M²</summary>
            <div class="config-section"><h4>位置 / 衰减</h4>
              <label class="config-control"><span>Z position</span><input type="range" min="-24" max="24" step="0.1" :value="beamZ" @pointerdown="beginZDrag" @pointerup="endZDrag" @pointercancel="endZDrag" @input="onZInput"/><b>{{beamZ.toFixed(1)}} mm</b></label>
              <label class="config-control"><span>Attenuation</span><input type="range" min="0" max="40" step="0.1" :value="beamAtt" @pointerdown="beginAttDrag" @pointerup="endAttDrag" @pointercancel="endAttDrag" @input="onAttInput"/><b>{{beamAtt.toFixed(1)}} dB</b></label>
              <button class="config-action" :class="{active:beamPlaying}" @click="toggleBeamPlay">{{beamPlaying?'停止 Z 浏览':'自动 Z 浏览'}}</button>
            </div>
            <div class="config-section"><h4>M² 分析</h4>
              <label class="config-row"><span>Run mode</span><select v-model="settingsDraft.beamRunMode" @change="saveSettings"><option>AUTO</option><option>MANUAL</option></select></label>
              <label class="config-row"><span>Width method</span><select v-model="settingsDraft.beamWidthMethod" @change="saveSettings"><option value="D4SIGMA">D4σ / ISO 11146</option><option value="FWHM">FWHM</option></select></label>
              <label class="config-row switch"><span>Automatic outlier rejection</span><input type="checkbox" v-model="settingsDraft.beamAutoOutlier" @change="saveSettings"/></label>
              <label class="config-row switch"><span>Show X caustic</span><input type="checkbox" v-model="settingsDraft.beamShowX" @change="saveSettings"/></label>
              <label class="config-row switch"><span>Show Y caustic</span><input type="checkbox" v-model="settingsDraft.beamShowY" @change="saveSettings"/></label>
            </div>
          </details>
          <div class="beam-body"><div class="beam-image-wrap"><BeamProfileCanvas :width-x="snapshot.beam.spotWidthX" :width-y="snapshot.beam.spotWidthY" :attenuation="beamAtt" /></div><PlotCanvas class="caustic-plot" :series="activePage==='beam'?beamPageCaustic:snapshot.beam.caustic" :vertical-marker="beamZ" :x-padding="0.04" x-label="Z (mm)" y-label="束宽 (μm)" :show-axis-labels="activePage==='beam'" /></div>
        </article>

        <article class="instrument-panel scope-panel" :class="{hidden:!['dashboard','scope'].includes(activePage)}">
          <div class="module-head scope-head graph-overlay">
            <div class="module-title"><div class="panel-mark scope-accent" :class="{selected:snapshot.captureSelection.scope}"><svg viewBox="0 0 24 24"><path d="M2 12h3c1.5 0 1.5-7 3-7s1.5 14 3 14 1.5-14 3-14 1.5 14 3 14 1.5-7 3-7h2"/></svg></div><strong>示波器</strong><span v-if="activePage==='scope'" class="focus-page-state" :class="{running:moduleActive('scope')}"><i></i>{{moduleActive('scope')?'采集中':'就绪'}}</span></div>
            <div class="scope-readouts"><button v-for="(trace,index) in snapshot.scope.time" :key="trace.name" class="metric-trigger" @click="openReadout(index===0?'scope0':'scope1')"><em>{{trace.name}}</em><span class="metric-value-chip"><b>{{trace.points.at(-1)?.y.toFixed(3) ?? '0.000'}}</b><small>V</small></span></button><span class="secondary-metric"><em>SR</em><span class="metric-value-chip"><b>2.5</b><small>MSa/s</small></span></span></div>
          </div>

          <div v-if="activePage==='scope'" class="focus-summary">
            <div v-for="trace in snapshot.scope.time" :key="trace.name" class="focus-metric"><span>{{trace.name}}</span><div><b>{{trace.points.at(-1)?.y.toFixed(3) ?? '0.000'}}</b><small>V</small></div></div>
            <div class="focus-metric"><span>Sample rate</span><div><b>2.5</b><small>MSa/s</small></div></div>
            <div class="focus-metric"><span>Trigger</span><div><b>{{settingsDraft.scopeTriggerSource}}</b><small>{{settingsDraft.scopeTriggerLevel.toFixed(2)}} V</small></div></div>
          </div>

          <details v-if="activePage==='scope'" class="module-config-dock workstation-config" open>
            <summary>示波器参数</summary>
            <div class="config-section"><h4>Horizontal</h4>
              <label class="config-row"><span>Time span</span><input type="number" step="0.01" min="0.01" v-model.number="settingsDraft.scopeTimeSpan" @change="saveSettings"/><small>ms</small></label>
              <label class="config-row"><span>FFT upper limit</span><input type="number" step="0.1" min="0.1" v-model.number="settingsDraft.scopeFftMax" @change="saveSettings"/><small>MHz</small></label>
            </div>
            <div class="config-section"><h4>Vertical / Channels</h4>
              <label class="config-row"><span>Volts / div</span><input type="number" step="0.01" min="0.001" v-model.number="settingsDraft.scopeVoltsDiv" @change="saveSettings"/><small>V/div</small></label>
              <label class="config-row"><span>Vertical offset</span><input type="number" step="0.01" v-model.number="settingsDraft.scopeOffset" @change="saveSettings"/><small>V</small></label>
              <label class="config-row"><span>Coupling</span><select v-model="settingsDraft.scopeCoupling" @change="saveSettings"><option>DC</option><option>AC</option><option>GND</option></select></label>
              <div class="config-checks"><label><input type="checkbox" v-model="settingsDraft.scopeCh1" @change="saveSettings"/>CH1</label><label><input type="checkbox" v-model="settingsDraft.scopeCh2" @change="saveSettings"/>CH2</label></div>
            </div>
            <div class="config-section"><h4>Trigger / Acquisition</h4>
              <label class="config-row"><span>Trigger source</span><select v-model="settingsDraft.scopeTriggerSource" @change="saveSettings"><option>CH1</option><option>CH2</option></select></label>
              <label class="config-row"><span>Trigger level</span><input type="number" step="0.01" v-model.number="settingsDraft.scopeTriggerLevel" @change="saveSettings"/><small>V</small></label>
              <label class="config-row"><span>Trigger slope</span><select v-model="settingsDraft.scopeTriggerSlope" @change="saveSettings"><option>RISING</option><option>FALLING</option></select></label>
              <label class="config-row"><span>Acquisition</span><select v-model="settingsDraft.scopeAcquisition" @change="saveSettings"><option>SAMPLE</option><option>AVERAGE</option><option>PEAK</option></select></label>
              <label class="config-row"><span>Average count</span><input type="number" min="2" max="1024" v-model.number="settingsDraft.scopeAverage" @change="saveSettings"/><small>acq</small></label>
            </div>
          </details>
          <div class="scope-plots"><PlotCanvas :series="snapshot.scope.time" :x-min="0" :x-max="settingsDraft.scopeTimeSpan" :y-min="activePage==='scope'?scopeYMin:-1" :y-max="activePage==='scope'?scopeYMax:1" x-label="时间 (ms)" y-label="电压 (V)" :show-axis-labels="activePage==='scope'" :tight="true" :stacked="true" /><PlotCanvas :series="snapshot.scope.fft" :x-min="0" :x-max="settingsDraft.scopeFftMax*1000" x-label="频率 (kHz)" y-label="幅值 (a.u.)" :show-axis-labels="activePage==='scope'" :tight="true" :stacked="true" /></div>
        </article>
      </section>
    </main>
    <div v-if="cameraFlash" class="capture-toast">截图已保存</div>
    <template v-if="activePage==='dashboard'"><div v-for="win in bigReadoutWindows" :key="win.id" class="big-readout-window" :class="{light:win.light}" :style="readoutStyle(win)" role="dialog" aria-label="大读数" @pointerdown="beginReadoutDrag($event,win)">
      <div class="big-readout-top">
        <div class="big-readout-identity"><i></i><span>{{readoutData(win.kind)?.title}}</span></div>
        <div class="big-readout-actions">
          <button class="readout-theme-toggle" @pointerdown.stop @click="toggleReadoutTheme(win)" :title="win.light?'切换为黑底白字':'切换为白底黑字'"><span></span></button>
          <button class="readout-close" @pointerdown.stop @click="closeReadout(win.id)" title="关闭">×</button>
        </div>
      </div>
      <div class="big-readout-body"><div class="big-readout-value">{{readoutData(win.kind)?.value}}<small v-if="readoutData(win.kind)?.unit">{{readoutData(win.kind)?.unit}}</small></div></div>
      <div class="big-readout-resize" @pointerdown.stop="beginReadoutResize($event,win)" title="拖动缩放"><i></i><i></i><i></i></div>
    </div></template>
  </div>
</template>
