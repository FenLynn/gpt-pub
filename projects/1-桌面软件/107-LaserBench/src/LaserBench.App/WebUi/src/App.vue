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
const focusConfigCollapsed = ref(false)
const modulePaneTab = ref<Record<'power'|'spectrum'|'beam'|'scope','settings'|'results'>>({
  power:'settings', spectrum:'settings', beam:'settings', scope:'settings'
})
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
  power1DisplayUnit:snapshot.value.config?.power1DisplayUnit??'kW', power2DisplayUnit:snapshot.value.config?.power2DisplayUnit??'kW', math1DisplayUnit:snapshot.value.config?.math1DisplayUnit??'%',
  power1AxisMin:snapshot.value.config?.power1AxisMin??0, power1AxisMax:snapshot.value.config?.power1AxisMax??0,
  power2AxisMin:snapshot.value.config?.power2AxisMin??0, power2AxisMax:snapshot.value.config?.power2AxisMax??0,
  math1AxisMin:snapshot.value.config?.math1AxisMin??0, math1AxisMax:snapshot.value.config?.math1AxisMax??100,
  osaResolution:snapshot.value.config?.osaResolution??0.05, osaSensitivity:snapshot.value.config?.osaSensitivity??'MID',
  osaAverage:snapshot.value.config?.osaAverage??1, osaRefLevel:snapshot.value.config?.osaRefLevel??0, osaDbPerDiv:snapshot.value.config?.osaDbPerDiv??10,
  osaShowRef:snapshot.value.config?.osaShowRef??true, osaSweepMode:snapshot.value.config?.osaSweepMode??'REPEAT', osaMarkerPeak:snapshot.value.config?.osaMarkerPeak??true,
  osaSamplePoints:snapshot.value.config?.osaSamplePoints??1001, osaVideoBandwidthHz:snapshot.value.config?.osaVideoBandwidthHz??1000,
  osaTraceMode:snapshot.value.config?.osaTraceMode??'WRITE', osaSmoothingPoints:snapshot.value.config?.osaSmoothingPoints??1,
  osaWavelengthOffsetNm:snapshot.value.config?.osaWavelengthOffsetNm??0, osaWavelengthReference:snapshot.value.config?.osaWavelengthReference??'AIR',
  osaAutoPeakSearch:snapshot.value.config?.osaAutoPeakSearch??true, osaPeakThresholdDb:snapshot.value.config?.osaPeakThresholdDb??3,
  beamRunMode:snapshot.value.config?.beamRunMode??'AUTO', beamWidthMethod:snapshot.value.config?.beamWidthMethod??'D4SIGMA',
  beamAutoOutlier:snapshot.value.config?.beamAutoOutlier??true, beamShowX:snapshot.value.config?.beamShowX??true, beamShowY:snapshot.value.config?.beamShowY??true,
  scopeVoltsDiv:snapshot.value.config?.scopeVoltsDiv??0.25, scopeOffset:snapshot.value.config?.scopeOffset??0, scopeCoupling:snapshot.value.config?.scopeCoupling??'DC',
  scopeActiveChannel:snapshot.value.config?.scopeActiveChannel??1,
  scopeCh1VoltsDiv:snapshot.value.config?.scopeCh1VoltsDiv??snapshot.value.config?.scopeVoltsDiv??0.25,
  scopeCh1Offset:snapshot.value.config?.scopeCh1Offset??snapshot.value.config?.scopeOffset??0,
  scopeCh1Coupling:snapshot.value.config?.scopeCh1Coupling??snapshot.value.config?.scopeCoupling??'DC',
  scopeCh2VoltsDiv:snapshot.value.config?.scopeCh2VoltsDiv??snapshot.value.config?.scopeVoltsDiv??0.25,
  scopeCh2Offset:snapshot.value.config?.scopeCh2Offset??snapshot.value.config?.scopeOffset??0,
  scopeCh2Coupling:snapshot.value.config?.scopeCh2Coupling??snapshot.value.config?.scopeCoupling??'DC',
  scopeTriggerSource:snapshot.value.config?.scopeTriggerSource??'CH1', scopeTriggerLevel:snapshot.value.config?.scopeTriggerLevel??0,
  scopeTriggerSlope:snapshot.value.config?.scopeTriggerSlope??'RISING', scopeAcquisition:snapshot.value.config?.scopeAcquisition??'SAMPLE', scopeAverage:snapshot.value.config?.scopeAverage??16,
  powerInterfaceEnabled:snapshot.value.config?.powerInterfaceEnabled??false, powerInterfaceEndpoint:snapshot.value.config?.powerInterfaceEndpoint??'AUTO',
  spectrumInterfaceEnabled:snapshot.value.config?.spectrumInterfaceEnabled??false, spectrumInterfaceEndpoint:snapshot.value.config?.spectrumInterfaceEndpoint??'TCPIP::AUTO',
  beamInterfaceEnabled:snapshot.value.config?.beamInterfaceEnabled??false, beamInterfaceEndpoint:snapshot.value.config?.beamInterfaceEndpoint??'AUTO',
  scopeInterfaceEnabled:snapshot.value.config?.scopeInterfaceEnabled??false, scopeInterfaceEndpoint:snapshot.value.config?.scopeInterfaceEndpoint??'TCPIP::AUTO'
})
const dataFilter=ref('')
const powerRangeStartPct=ref(0)
const powerRangeEndPct=ref(100)
const powerOverviewShell=ref<HTMLElement|null>(null)
const beamAxisXMin=ref<number|undefined>(undefined)
const beamAxisXMax=ref<number|undefined>(undefined)
const beamAxisYMin=ref<number|undefined>(undefined)
const beamAxisYMax=ref<number|undefined>(undefined)
const scopeFftYMin=ref<number|undefined>(undefined)
const scopeFftYMax=ref<number|undefined>(undefined)
let beamTimer:number|undefined
let clockTimer:number|undefined
let recordTimer:number|undefined
let recordStartedAt:number|undefined
let stopSnapshot: (()=>void)|undefined

const powerVisibility = computed(() => [settingsDraft.value.dashboardPower1, settingsDraft.value.dashboardPower2, settingsDraft.value.dashboardMath1])
const powerTraceIndices = computed(()=>snapshot.value.power.traces.map((t,index)=>({t,index})).filter(x=>x.t.unit!=='%').map(x=>x.index))
const mathTraceIndices = computed(()=>snapshot.value.power.traces.map((t,index)=>({t,index})).filter(x=>x.t.unit==='%').map(x=>x.index))
const powerHeaderSlots = computed(()=>{
  const slots:{key:string;label:string;traceIndex:number;kind:'power'|'math';available:boolean}[]=[]
  for(let n=1;n<=4;n++){
    const pi=powerTraceIndices.value[n-1] ?? -1
    const mi=mathTraceIndices.value[n-1] ?? -1
    slots.push({key:'power'+n,label:pi>=0?powerAliasForIndex(pi):'power'+n,traceIndex:pi,kind:'power',available:pi>=0})
    slots.push({key:'math'+n,label:mi>=0?powerAliasForIndex(mi):'math'+n,traceIndex:mi,kind:'math',available:mi>=0})
  }
  return slots
})
const visiblePowerTraces = computed(() => snapshot.value.power.traces.map((t,index)=>({t,index})).filter(x=>powerVisibility.value[x.index] ?? true))
const powerHistorySpan = computed(() => {
  const xs=visiblePowerTraces.value.flatMap(x=>x.t.points.map(p=>p.x))
  if(!xs.length)return 0
  return Math.max(0,Math.min(settingsDraft.value.powerWindow,Math.max(...xs)-Math.min(...xs)))
})
function powerAliasKey(index:number){ return index===0?'power1':index===1?'power2':index===2?'math1':'' }
function powerAliasForIndex(index:number){
  const key=powerAliasKey(index)
  return key ? (settingsDraft.value.aliases[key] || snapshot.value.power.traces[index]?.name || key) : (snapshot.value.power.traces[index]?.name || ('trace'+(index+1)))
}
function baseDisplayUnit(index:number){
  if(index===0)return settingsDraft.value.power1DisplayUnit
  if(index===1)return settingsDraft.value.power2DisplayUnit
  if(index===2)return settingsDraft.value.math1DisplayUnit
  return snapshot.value.power.traces[index]?.unit || ''
}
function powerUnitScale(index:number,baseUnit:string){
  if(baseUnit!=='kW')return 1
  const unit=baseDisplayUnit(index)
  if(unit==='W')return 1000
  if(unit==='mW')return 1_000_000
  return 1
}
function powerDisplayRaw(value:number,index:number){
  const base=snapshot.value.power.traces[index]?.unit ?? ''
  return value*powerUnitScale(index,base)
}
function convertPowerFromKw(value:number,unit:string){
  if(unit==='W')return value*1000
  if(unit==='mW')return value*1_000_000
  return value
}
function powerProcessedCanonical(value:number,index:number){
  let next=value
  if(index===settingsDraft.value.powerActiveTrace){
    next=(next+settingsDraft.value.powerOffset)*settingsDraft.value.powerScale
    if(settingsDraft.value.powerNormalize) next/=Math.max(1e-12,settingsDraft.value.powerNormalizeValue)
    if(settingsDraft.value.powerDensity) next/=Math.max(1e-9,settingsDraft.value.powerAreaCm2)
  }
  return next
}
// Dashboard uses one physical-power Y axis, so its curves stay in provider-canonical kW.
const powerSeries = computed<PlotSeries[]>(() => visiblePowerTraces.value.map(({t,index}) => {
  const xs=t.points.map(p=>p.x),minX=xs.length?Math.min(...xs):0
  return {
    name:powerAliasForIndex(index),color:t.color,axis:(t.unit==='%'?'right':'left') as 'left'|'right',
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
  const values=powerSeries.value.filter(t=>t.axis!=='right').flatMap(t=>t.points.map(p=>p.y))
  return Math.max(5, Math.ceil(Math.max(...values, 1) / 5) * 5)
})
function powerTransform(value:number,index:number){
  return powerDisplayRaw(powerProcessedCanonical(value,index),index)
}
function averagedPowerPoints(points:{x:number;y:number}[],count:number){
  const n=Math.max(1,Math.floor(count))
  if(n<=1)return points
  let sum=0
  const q:number[]=[]
  return points.map(p=>{q.push(p.y);sum+=p.y;if(q.length>n)sum-=q.shift()!;return {x:p.x,y:sum/q.length}})
}
const activePowerIsMath = computed(()=>snapshot.value.power.traces[settingsDraft.value.powerActiveTrace]?.unit==='%')
const powerAxisUnit = computed(()=>activePowerIsMath.value?settingsDraft.value.power1DisplayUnit:baseDisplayUnit(settingsDraft.value.powerActiveTrace))
const powerPageSeries = computed<PlotSeries[]>(() => snapshot.value.power.traces.map((t,index)=>{
  const xs=t.points.map(p=>p.x),minX=xs.length?Math.min(...xs):0
  const transformed=t.points.map(p=>{
    const raw=powerProcessedCanonical(p.y,index)
    const y=t.unit==='%'?raw:convertPowerFromKw(raw,powerAxisUnit.value)
    return {x:p.x-minX,y}
  })
  return {name:powerAliasForIndex(index),color:t.color,axis:(t.unit==='%'?'right':'left') as 'left'|'right',
    points:index===settingsDraft.value.powerActiveTrace?averagedPowerPoints(transformed,settingsDraft.value.powerAverageSamples):transformed}
}).filter((_,index)=>powerVisibility.value[index]??true))
const activePowerAlias = computed({
  get:()=>powerAliasForIndex(settingsDraft.value.powerActiveTrace),
  set:(value:string)=>{const key=powerAliasKey(settingsDraft.value.powerActiveTrace);if(key)settingsDraft.value.aliases[key]=value}
})
const activePowerDisplayUnit = computed({
  get:()=>baseDisplayUnit(settingsDraft.value.powerActiveTrace),
  set:(value:string)=>{
    if(settingsDraft.value.powerActiveTrace===0)settingsDraft.value.power1DisplayUnit=value
    else if(settingsDraft.value.powerActiveTrace===1)settingsDraft.value.power2DisplayUnit=value
    else if(settingsDraft.value.powerActiveTrace===2)settingsDraft.value.math1DisplayUnit=value
  }
})
const activePowerAxisMin = computed({
  get:()=>settingsDraft.value.powerActiveTrace===0?settingsDraft.value.power1AxisMin:settingsDraft.value.powerActiveTrace===1?settingsDraft.value.power2AxisMin:settingsDraft.value.math1AxisMin,
  set:(v:number)=>{if(settingsDraft.value.powerActiveTrace===0)settingsDraft.value.power1AxisMin=v;else if(settingsDraft.value.powerActiveTrace===1)settingsDraft.value.power2AxisMin=v;else settingsDraft.value.math1AxisMin=v}
})
const activePowerAxisMax = computed({
  get:()=>settingsDraft.value.powerActiveTrace===0?settingsDraft.value.power1AxisMax:settingsDraft.value.powerActiveTrace===1?settingsDraft.value.power2AxisMax:settingsDraft.value.math1AxisMax,
  set:(v:number)=>{if(settingsDraft.value.powerActiveTrace===0)settingsDraft.value.power1AxisMax=v;else if(settingsDraft.value.powerActiveTrace===1)settingsDraft.value.power2AxisMax=v;else settingsDraft.value.math1AxisMax=v}
})
const activePowerVisible = computed({
  get:()=>powerVisibility.value[settingsDraft.value.powerActiveTrace]??true,
  set:(v:boolean)=>{if(settingsDraft.value.powerActiveTrace===0)settingsDraft.value.dashboardPower1=v;else if(settingsDraft.value.powerActiveTrace===1)settingsDraft.value.dashboardPower2=v;else if(settingsDraft.value.powerActiveTrace===2)settingsDraft.value.dashboardMath1=v}
})
const powerPageAutoLeftMax = computed(()=>{
  const values=powerPageSeries.value.filter(s=>s.axis!=='right').flatMap(s=>s.points.map(p=>p.y)).filter(Number.isFinite)
  return Math.max(1,Math.ceil(Math.max(...values,1)*1.08))
})
const powerPageLeftMin = computed(()=>!activePowerIsMath.value?activePowerAxisMin.value:0)
const powerPageLeftMax = computed(()=>!activePowerIsMath.value && activePowerAxisMax.value>activePowerAxisMin.value ? activePowerAxisMax.value : powerPageAutoLeftMax.value)
const powerPageRightMin = computed(()=>activePowerIsMath.value?activePowerAxisMin.value:settingsDraft.value.math1AxisMin)
const powerPageRightMax = computed(()=>activePowerIsMath.value&&activePowerAxisMax.value>activePowerAxisMin.value?activePowerAxisMax.value:(settingsDraft.value.math1AxisMax>settingsDraft.value.math1AxisMin?settingsDraft.value.math1AxisMax:100))
const powerPageUnit = computed(()=>{
  const t=snapshot.value.power.traces[settingsDraft.value.powerActiveTrace]
  if(!t)return ''
  if(settingsDraft.value.powerDensity && t.unit!=='%')return baseDisplayUnit(settingsDraft.value.powerActiveTrace)+'/cm²'
  if(settingsDraft.value.powerNormalize)return 'rel.'
  return baseDisplayUnit(settingsDraft.value.powerActiveTrace)
})
const powerPageAxisLabel = computed(()=>{
  const t=snapshot.value.power.traces[settingsDraft.value.powerActiveTrace]
  if(!t)return '功率'
  if(settingsDraft.value.powerDensity && t.unit!=='%')return '功率密度'
  if(settingsDraft.value.powerNormalize)return '归一化值'
  return '功率'
})
const powerPageRightAxisLabel = computed(()=>`数学${settingsDraft.value.math1DisplayUnit?' ('+settingsDraft.value.math1DisplayUnit+')':''}`)
const dashboardMathAxisLabel = computed(()=>`数学${settingsDraft.value.math1DisplayUnit?' ('+settingsDraft.value.math1DisplayUnit+')':''}`)
const powerActiveValue = computed(()=>{
  const t=snapshot.value.power.traces[settingsDraft.value.powerActiveTrace]
  return t?powerTransform(t.value,settingsDraft.value.powerActiveTrace):0
})
const powerPassState = computed(()=>{
  if(!settingsDraft.value.powerPassFail)return 'OFF'
  return powerActiveValue.value>=settingsDraft.value.powerLow && powerActiveValue.value<=settingsDraft.value.powerHigh?'PASS':'FAIL'
})
function selectPowerTrace(index:number){if(index<0)return;settingsDraft.value.powerActiveTrace=index;void saveSettings()}
const powerConnectedCount = computed(()=>snapshot.value.devices.filter(d=>d.kind==='power'&&d.status==='online').length)
const mathChannelCount = computed(()=>snapshot.value.power.traces.filter(t=>t.unit==='%').length)
function interfaceFor(kind:'power'|'spectrum'|'beam'|'scope'){ return snapshot.value.interfaces.find(i=>i.kind===kind) }
function moduleStatusTone(kind:'power'|'spectrum'|'beam'|'scope'){
  const state=interfaceFor(kind)
  if(!state?.enabled)return 'ok'
  if(state.state==='ready')return 'ok'
  if(['faulted','dependency_missing','invalid'].includes(state.state))return 'error'
  if(['connecting','authenticating','streaming','configured','awaiting_endpoint'].includes(state.state))return 'warn'
  return 'offline'
}
function moduleStatusText(kind:'power'|'spectrum'|'beam'|'scope'){return interfaceStateText(interfaceFor(kind)?.state)}
const currentFolderDisplay=computed(()=>{
  const folder=(settingsDraft.value.experimentFolder||snapshot.value.config.experimentFolder||'').trim()
  if(folder){const parts=folder.replace(/\\/g,'/').split('/').filter(Boolean);return parts.at(-1)||folder}
  const root=(snapshot.value.config.rootPath||'').trim()
  const drive=root.match(/^[A-Za-z]:/)?.[0]
  return drive||root.replace(/\\/g,'/').split('/').filter(Boolean).at(-1)||'实验目录'
})
const beamFrameQuality=computed(()=>{
  if(settingsDraft.value.beamInterfaceEnabled){
    const st=interfaceFor('beam')
    if(st?.state==='ready')return {tone:'neutral',label:'等待 Frame Quality 映射',pct:52}
    return {tone:'neutral',label:'等待 BeamSquared',pct:24}
  }
  const a=beamAtt.value
  if(a<6)return {tone:'hot',label:'过亮',pct:94}
  if(a>32)return {tone:'dim',label:'偏暗',pct:24}
  const pct=Math.round(92-Math.abs(a-18)*2.4)
  return {tone:'good',label:'Frame 正常',pct:Math.max(55,Math.min(92,pct))}
})
function interfaceStateText(state?:string){
  return ({
    disabled:'未启用',
    configured:'已配置',
    awaiting_endpoint:'等待地址',
    connecting:'连接中',
    authenticating:'认证中',
    streaming:'等待数据',
    ready:'已连接 / 实时',
    faulted:'连接故障',
    dependency_missing:'缺少驱动/软件',
    invalid:'配置有误'
  } as Record<string,string>)[state??''] ?? '未知'
}
function dataPlaneText(){
  return ({SIM:'模拟器',HW:'全硬件',MIXED:'混合：硬件 + 模拟器',WAITING:'等待真实硬件'} as Record<string,string>)[snapshot.value.mode] ?? snapshot.value.mode
}
function sampleRateParts(){
  const rate=Math.max(0,snapshot.value.scope.sampleRate||0)
  if(rate>=1e9)return {value:(rate/1e9).toFixed(rate>=10e9?1:2),unit:'GSa/s'}
  if(rate>=1e6)return {value:(rate/1e6).toFixed(rate>=10e6?1:2),unit:'MSa/s'}
  if(rate>=1e3)return {value:(rate/1e3).toFixed(rate>=10e3?1:2),unit:'kSa/s'}
  return {value:rate.toFixed(0),unit:'Sa/s'}
}
function interfaceSampleTime(kind:'power'|'spectrum'|'beam'|'scope'){
  const value=interfaceFor(kind)?.lastSampleAt
  return value?new Date(value).toLocaleTimeString():'—'
}
async function probeInterface(kind:'power'|'spectrum'|'beam'|'scope'){
  await saveSettings()
  await request('app.probeInterfaces',{kind})
}
function smoothSpectrum(points:{x:number;y:number}[],count:number){
  const n=Math.max(1,Math.floor(count))
  if(n<=1)return points
  const half=Math.floor(n/2)
  return points.map((p,i)=>{
    let sum=0,c=0
    for(let j=Math.max(0,i-half);j<=Math.min(points.length-1,i+half);j++){sum+=points[j].y;c++}
    return {x:p.x,y:sum/Math.max(1,c)}
  })
}
function limitSpectrum(points:{x:number;y:number}[],count:number){
  const max=Math.max(101,Math.floor(count))
  if(points.length<=max)return points
  const step=(points.length-1)/(max-1)
  return Array.from({length:max},(_,i)=>points[Math.min(points.length-1,Math.round(i*step))])
}
const osaLocalWavelengthOffset = computed(()=>settingsDraft.value.spectrumInterfaceEnabled?0:settingsDraft.value.osaWavelengthOffsetNm)
const spectrumPageSeries = computed(()=>snapshot.value.spectrum.traces
  .filter((_,i)=>i===0||settingsDraft.value.osaShowRef)
  .map(trace=>({...trace,points:limitSpectrum(smoothSpectrum(trace.points,settingsDraft.value.osaSmoothingPoints),settingsDraft.value.osaSamplePoints)
    .map(p=>({x:p.x+osaLocalWavelengthOffset.value,y:p.y}))})))
const osaDisplayCenter = computed(()=>snapshot.value.spectrum.centerWavelength+osaLocalWavelengthOffset.value)
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
function scopeAlias(channel:1|2){
  const key=channel===1?'scope1':'scope2'
  return settingsDraft.value.aliases[key] || (channel===1?'CH1':'CH2')
}
function scopeTrace(channel:1|2,domain:'time'|'fft'='time'){
  const name=scopeAlias(channel).toUpperCase()
  return snapshot.value.scope[domain].find(t=>t.name.toUpperCase()===name)
}
const activeScopeChannel = computed<1|2>(()=>settingsDraft.value.scopeActiveChannel===2?2:1)
const activeScopeAlias = computed({
  get:()=>scopeAlias(activeScopeChannel.value),
  set:(value:string)=>{settingsDraft.value.aliases[activeScopeChannel.value===1?'scope1':'scope2']=value}
})
const activeScopeVisible = computed({
  get:()=>activeScopeChannel.value===1?settingsDraft.value.scopeCh1:settingsDraft.value.scopeCh2,
  set:(value:boolean)=>{if(activeScopeChannel.value===1)settingsDraft.value.scopeCh1=value;else settingsDraft.value.scopeCh2=value}
})
const activeScopeVoltsDiv = computed({
  get:()=>activeScopeChannel.value===1?settingsDraft.value.scopeCh1VoltsDiv:settingsDraft.value.scopeCh2VoltsDiv,
  set:(value:number)=>{if(activeScopeChannel.value===1)settingsDraft.value.scopeCh1VoltsDiv=value;else settingsDraft.value.scopeCh2VoltsDiv=value}
})
const activeScopeOffset = computed({
  get:()=>activeScopeChannel.value===1?settingsDraft.value.scopeCh1Offset:settingsDraft.value.scopeCh2Offset,
  set:(value:number)=>{if(activeScopeChannel.value===1)settingsDraft.value.scopeCh1Offset=value;else settingsDraft.value.scopeCh2Offset=value}
})
const activeScopeCoupling = computed({
  get:()=>activeScopeChannel.value===1?settingsDraft.value.scopeCh1Coupling:settingsDraft.value.scopeCh2Coupling,
  set:(value:string)=>{if(activeScopeChannel.value===1)settingsDraft.value.scopeCh1Coupling=value;else settingsDraft.value.scopeCh2Coupling=value}
})
const scopeCh1YMin = computed(()=>settingsDraft.value.scopeCh1Offset-settingsDraft.value.scopeCh1VoltsDiv*4)
const scopeCh1YMax = computed(()=>settingsDraft.value.scopeCh1Offset+settingsDraft.value.scopeCh1VoltsDiv*4)
const scopeCh2YMin = computed(()=>settingsDraft.value.scopeCh2Offset-settingsDraft.value.scopeCh2VoltsDiv*4)
const scopeCh2YMax = computed(()=>settingsDraft.value.scopeCh2Offset+settingsDraft.value.scopeCh2VoltsDiv*4)
const scopeTimeSeries = computed<PlotSeries[]>(()=>snapshot.value.scope.time.map(t=>({
  ...t,
  axis:(t.name.toUpperCase()===scopeAlias(2).toUpperCase()?'right':'left') as 'left'|'right'
})))
function selectScopeChannel(channel:1|2){settingsDraft.value.scopeActiveChannel=channel;void saveSettings()}
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
function onPowerAxisLimit(p:{axis:'x'|'y'|'right';end:'min'|'max';value:number}){
  if(p.axis==='y'&&!activePowerIsMath.value){if(p.end==='min')activePowerAxisMin.value=p.value;else activePowerAxisMax.value=p.value;void saveSettings()}
  if(p.axis==='right'&&activePowerIsMath.value){if(p.end==='min')activePowerAxisMin.value=p.value;else activePowerAxisMax.value=p.value;void saveSettings()}
}
function onSpectrumAxisLimit(p:{axis:'x'|'y'|'right';end:'min'|'max';value:number}){
  if(p.axis==='x'){
    if(p.end==='min')settingsDraft.value.osaStart=Math.min(p.value,settingsDraft.value.osaStop-.001)
    else settingsDraft.value.osaStop=Math.max(p.value,settingsDraft.value.osaStart+.001)
  }else if(p.axis==='y'){
    if(p.end==='max')settingsDraft.value.osaRefLevel=p.value
    else settingsDraft.value.osaDbPerDiv=Math.max(.1,(settingsDraft.value.osaRefLevel-p.value)/10)
  }
  void saveSettings()
}
function onScopeTimeAxisLimit(p:{axis:'x'|'y'|'right';end:'min'|'max';value:number}){
  if(p.axis==='x'&&p.end==='max')settingsDraft.value.scopeTimeSpan=Math.max(.01,p.value)
  if(p.axis==='y'){
    const min=p.end==='min'?p.value:scopeCh1YMin.value
    const max=p.end==='max'?p.value:scopeCh1YMax.value
    if(max>min){settingsDraft.value.scopeCh1Offset=(max+min)/2;settingsDraft.value.scopeCh1VoltsDiv=(max-min)/8}
  }
  if(p.axis==='right'){
    const min=p.end==='min'?p.value:scopeCh2YMin.value
    const max=p.end==='max'?p.value:scopeCh2YMax.value
    if(max>min){settingsDraft.value.scopeCh2Offset=(max+min)/2;settingsDraft.value.scopeCh2VoltsDiv=(max-min)/8}
  }
  void saveSettings()
}
function onScopeFftAxisLimit(p:{axis:'x'|'y'|'right';end:'min'|'max';value:number}){
  if(p.axis==='x'&&p.end==='max'){settingsDraft.value.scopeFftMax=Math.max(.0001,p.value/1000);void saveSettings()}
  else if(p.axis==='y'){if(p.end==='min')scopeFftYMin.value=p.value;else scopeFftYMax.value=p.value}
}
function onBeamAxisLimit(p:{axis:'x'|'y'|'right';end:'min'|'max';value:number}){
  if(p.axis==='x'){if(p.end==='min')beamAxisXMin.value=p.value;else beamAxisXMax.value=p.value}
  if(p.axis==='y'){if(p.end==='min')beamAxisYMin.value=p.value;else beamAxisYMax.value=p.value}
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
      const t=scopeTrace(1); return t ? { title:scopeAlias(1), value:(t.points.at(-1)?.y??0).toFixed(3), unit:'V' } : {title:scopeAlias(1),value:'—',unit:'V'}
    }
    case 'scope1': {
      const t=scopeTrace(2); return t ? { title:scopeAlias(2), value:(t.points.at(-1)?.y??0).toFixed(3), unit:'V' } : {title:scopeAlias(2),value:'—',unit:'V'}
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
async function pickExperimentFolder(){
  const result=await request<{cancelled:boolean;folder?:string}>('app.pickExperimentFolder')
  if(result && !result.cancelled && typeof result.folder==='string'){
    settingsDraft.value.experimentFolder=result.folder
  }
}
function flipSetting(key:string){
  const draft=settingsDraft.value as any
  draft[key]=!draft[key]
  void saveSettings()
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
      settingsDraft.value={experimentFolder:s.config?.experimentFolder??'',autoScreenshot:s.config?.autoScreenshot??false,aliases:{...(s.config?.aliases??{})},powerWindow:s.config?.powerWindow??600,osaStart:s.config?.osaStart??1060,osaStop:s.config?.osaStop??1100,scopeTimeSpan:s.config?.scopeTimeSpan??0.24,scopeFftMax:s.config?.scopeFftMax??50,scopeCh1:s.config?.scopeCh1??true,scopeCh2:s.config?.scopeCh2??true,dashboardPower1:s.config?.dashboardPower1??true,dashboardPower2:s.config?.dashboardPower2??true,dashboardMath1:s.config?.dashboardMath1??true,powerActiveTrace:s.config?.powerActiveTrace??0,powerAverageSamples:s.config?.powerAverageSamples??1,powerOffset:s.config?.powerOffset??0,powerScale:s.config?.powerScale??1,powerNormalize:s.config?.powerNormalize??false,powerNormalizeValue:s.config?.powerNormalizeValue??1,powerDensity:s.config?.powerDensity??false,powerAreaCm2:s.config?.powerAreaCm2??1,powerPassFail:s.config?.powerPassFail??false,powerLow:s.config?.powerLow??0,powerHigh:s.config?.powerHigh??20,power1DisplayUnit:s.config?.power1DisplayUnit??'kW',power2DisplayUnit:s.config?.power2DisplayUnit??'kW',math1DisplayUnit:s.config?.math1DisplayUnit??'%',power1AxisMin:s.config?.power1AxisMin??0,power1AxisMax:s.config?.power1AxisMax??0,power2AxisMin:s.config?.power2AxisMin??0,power2AxisMax:s.config?.power2AxisMax??0,math1AxisMin:s.config?.math1AxisMin??0,math1AxisMax:s.config?.math1AxisMax??100,osaResolution:s.config?.osaResolution??0.05,osaSensitivity:s.config?.osaSensitivity??'MID',osaAverage:s.config?.osaAverage??1,osaRefLevel:s.config?.osaRefLevel??0,osaDbPerDiv:s.config?.osaDbPerDiv??10,osaShowRef:s.config?.osaShowRef??true,osaSweepMode:s.config?.osaSweepMode??'REPEAT',osaMarkerPeak:s.config?.osaMarkerPeak??true,osaSamplePoints:s.config?.osaSamplePoints??1001,osaVideoBandwidthHz:s.config?.osaVideoBandwidthHz??1000,osaTraceMode:s.config?.osaTraceMode??'WRITE',osaSmoothingPoints:s.config?.osaSmoothingPoints??1,osaWavelengthOffsetNm:s.config?.osaWavelengthOffsetNm??0,osaWavelengthReference:s.config?.osaWavelengthReference??'AIR',osaAutoPeakSearch:s.config?.osaAutoPeakSearch??true,osaPeakThresholdDb:s.config?.osaPeakThresholdDb??3,beamRunMode:s.config?.beamRunMode??'AUTO',beamWidthMethod:s.config?.beamWidthMethod??'D4SIGMA',beamAutoOutlier:s.config?.beamAutoOutlier??true,beamShowX:s.config?.beamShowX??true,beamShowY:s.config?.beamShowY??true,scopeVoltsDiv:s.config?.scopeVoltsDiv??0.25,scopeOffset:s.config?.scopeOffset??0,scopeCoupling:s.config?.scopeCoupling??'DC',scopeActiveChannel:s.config?.scopeActiveChannel??1,scopeCh1VoltsDiv:s.config?.scopeCh1VoltsDiv??s.config?.scopeVoltsDiv??0.25,scopeCh1Offset:s.config?.scopeCh1Offset??s.config?.scopeOffset??0,scopeCh1Coupling:s.config?.scopeCh1Coupling??s.config?.scopeCoupling??'DC',scopeCh2VoltsDiv:s.config?.scopeCh2VoltsDiv??s.config?.scopeVoltsDiv??0.25,scopeCh2Offset:s.config?.scopeCh2Offset??s.config?.scopeOffset??0,scopeCh2Coupling:s.config?.scopeCh2Coupling??s.config?.scopeCoupling??'DC',scopeTriggerSource:s.config?.scopeTriggerSource??'CH1',scopeTriggerLevel:s.config?.scopeTriggerLevel??0,scopeTriggerSlope:s.config?.scopeTriggerSlope??'RISING',scopeAcquisition:s.config?.scopeAcquisition??'SAMPLE',scopeAverage:s.config?.scopeAverage??16,powerInterfaceEnabled:s.config?.powerInterfaceEnabled??false,powerInterfaceEndpoint:s.config?.powerInterfaceEndpoint??'AUTO',spectrumInterfaceEnabled:s.config?.spectrumInterfaceEnabled??false,spectrumInterfaceEndpoint:s.config?.spectrumInterfaceEndpoint??'TCPIP::AUTO',beamInterfaceEnabled:s.config?.beamInterfaceEnabled??false,beamInterfaceEndpoint:s.config?.beamInterfaceEndpoint??'AUTO',scopeInterfaceEnabled:s.config?.scopeInterfaceEnabled??false,scopeInterfaceEndpoint:s.config?.scopeInterfaceEndpoint??'TCPIP::AUTO'}
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
      <button class="folder-picker-btn" @click="pickExperimentFolder" :title="'选择 / 新建实验文件夹'+(snapshot.config.experimentFolder?'：'+snapshot.config.experimentFolder:'')">
        <svg viewBox="0 0 24 24"><path d="M3 6h7l2 2h9v11H3z"/></svg>
      </button>
      <span class="folder-current-name" :title="snapshot.config.experimentFolder||snapshot.config.rootPath">{{currentFolderDisplay}}</span>
      <div class="label-wrap">
        <input id="labelInput" v-model="labelDraft" @keyup.enter="setLabel" placeholder="Label" />
        <div class="label-actions">
          <button class="clear-label" @click="labelDraft=''" title="清空 Label">×</button>
          <button class="check-btn" @click="setLabel" title="确认 Label"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></button>
        </div>
      </div>
      <div class="vsep"></div>

      <button class="module-toggle power-accent" :class="{active:snapshot.captureSelection.power}" :aria-pressed="snapshot.captureSelection.power" @click="toggleSource('power')" title="本次采集包含功率">
        <svg class="acq-vector acq-power" viewBox="0 0 24 24" aria-hidden="true">
          <rect class="bar b1" x="3.0" y="10" width="2.7" height="10" rx="0.9"/>
          <rect class="bar b2" x="8.1" y="6" width="2.7" height="14" rx="0.9"/>
          <rect class="bar b3" x="13.2" y="12" width="2.7" height="8" rx="0.9"/>
          <rect class="bar b4" x="18.3" y="8" width="2.7" height="12" rx="0.9"/>
        </svg>
      </button>
      <button class="module-toggle spectrum-accent" :class="{active:snapshot.captureSelection.spectrum}" :aria-pressed="snapshot.captureSelection.spectrum" @click="toggleSource('spectrum')" title="本次采集包含光谱">
        <svg class="acq-vector acq-spectrum" viewBox="0 0 24 24" aria-hidden="true">
          <path class="peak" d="M2 18c3.5 0 4.5-12 10-12s6.5 12 10 12"/>
        </svg>
      </button>
      <button class="module-toggle beam-accent" :class="{active:snapshot.captureSelection.beam}" :aria-pressed="snapshot.captureSelection.beam" @click="toggleSource('beam')" title="本次采集包含光束">
        <svg class="acq-vector acq-beam" viewBox="0 0 24 24" aria-hidden="true">
          <path class="cross" d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>
          <circle class="core" cx="12" cy="12" r="2"/>
          <circle class="beam-ring" cx="12" cy="12" r="7"/>
        </svg>
      </button>
      <button class="module-toggle scope-accent" :class="{active:snapshot.captureSelection.scope}" :aria-pressed="snapshot.captureSelection.scope" @click="toggleSource('scope')" title="本次采集包含示波器">
        <svg class="acq-vector acq-scope" viewBox="0 0 24 24" aria-hidden="true">
          <g class="scope-wave-flow">
            <path d="M0 12C2.5 12 2.5 4 6 4C10 4 10 20 14 20C18 20 18 12 24 12"/>
            <path transform="translate(24 0)" d="M0 12C2.5 12 2.5 4 6 4C10 4 10 20 14 20C18 20 18 12 24 12"/>
          </g>
        </svg>
      </button>
      <button class="run-btn" :class="{stopping:snapshot.captureState==='stopping',running:snapshot.captureState==='running'}" @click="toggleCapture" :disabled="snapshot.captureState==='starting'" :title="snapshot.capturing?'停止采集':'开始采集'">
        <svg v-if="!snapshot.capturing" viewBox="0 0 24 24" class="fill-icon"><path d="M8 5v14l11-7z"/></svg>
        <svg v-else viewBox="0 0 24 24" class="fill-icon"><rect x="7" y="7" width="10" height="10" rx="1"/></svg>
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
          <div class="setting-group"><h3>设备 Alias</h3><label v-for="(v,k) in settingsDraft.aliases" :key="k"><span>{{k}}</span><input v-model="settingsDraft.aliases[k]"/></label></div><div class="setting-group"><h3>运行环境</h3><label><span>运行模式</span><b>{{dataPlaneText()}}</b></label><label><span>程序目录</span><small>{{snapshot.config.rootPath}}</small></label></div>
        </div>
      </section>

      <section v-if="!['data','settings'].includes(activePage)" class="dashboard-grid" :class="{'focus-mode':activePage!=='dashboard','config-collapsed':activePage!=='dashboard'&&focusConfigCollapsed}">
        <article class="instrument-panel power-panel" :class="{hidden:!['dashboard','power'].includes(activePage)}">
          <div class="module-head power-head graph-overlay">
            <div class="module-title"><div class="panel-mark power-accent" :class="['state-'+moduleStatusTone('power'),{selected:snapshot.captureSelection.power}]" :title="'功率：'+moduleStatusText('power')"><svg viewBox="0 0 24 24"><rect x="3.0" y="8" width="2.8" height="12" rx="0.9"/><rect x="8.1" y="4" width="2.8" height="16" rx="0.9"/><rect x="13.2" y="10" width="2.8" height="10" rx="0.9"/><rect x="18.3" y="6" width="2.8" height="14" rx="0.9"/></svg></div><strong>功率</strong></div>
            <template v-if="activePage==='power'">
              <div class="focus-head-metrics">
                <div v-for="(t,index) in snapshot.power.traces" :key="'power-head-'+t.name" v-show="powerVisible(index)" class="focus-head-value">
                  <span>{{powerAliasForIndex(index)}}</span><div><b>{{powerTransform(t.value,index).toFixed(t.unit==='%'?1:2)}}</b><small>{{index===settingsDraft.powerActiveTrace?powerPageUnit:baseDisplayUnit(index)}}</small></div>
                </div>
                <div class="focus-head-value focus-head-pass"><span>判定</span><div><b>{{powerPassState}}</b></div></div>
              </div>
              <div class="power-channel-board" aria-label="功率与数学通道">
                <button v-for="slot in powerHeaderSlots" :key="slot.key" :disabled="!slot.available" :class="{active:slot.traceIndex===settingsDraft.powerActiveTrace,math:slot.kind==='math'}" @click="selectPowerTrace(slot.traceIndex)">
                  <i class="channel-light" :class="{online:slot.available}"></i><span>{{slot.label}}</span>
                </button>
              </div>
            </template>
            <div v-else class="head-metrics">
              <template v-for="(t,index) in snapshot.power.traces" :key="t.name"><button v-if="powerVisible(index)" class="metric-trigger" @click="openReadout(powerReadoutKind(index))"><em>{{powerAliasForIndex(index)}}</em><span class="metric-value-chip"><b>{{powerDisplayRaw(t.value,index).toFixed(t.unit==='%'?1:2)}}</b><small>{{baseDisplayUnit(index)}}</small></span></button></template>
            </div>
          </div>

          <div v-if="activePage==='power'" class="focus-summary focus-power-summary">
            <div v-for="(t,index) in snapshot.power.traces" :key="t.name" v-show="powerVisible(index)" class="focus-metric" :class="{selected:index===settingsDraft.powerActiveTrace}">
              <span>{{powerAliasForIndex(index)}}</span><div><b>{{powerTransform(t.value,index).toFixed(t.unit==='%'?1:2)}}</b><small>{{index===settingsDraft.powerActiveTrace?powerPageUnit:baseDisplayUnit(index)}}</small></div><small>Max {{powerDisplayRaw(t.maxValue,index).toFixed(t.unit==='%'?1:2)}} {{baseDisplayUnit(index)}}</small>
            </div>
            <div class="focus-metric pass-state" :class="powerPassState.toLowerCase()"><span>判定</span><div><b>{{powerPassState}}</b></div><small v-if="settingsDraft.powerPassFail">{{settingsDraft.powerLow}} – {{settingsDraft.powerHigh}}</small></div>
          </div>

          <aside v-if="activePage==='power'" class="module-config-dock workstation-config module-side-pane" :class="{collapsed:focusConfigCollapsed}"><button class="module-pane-collapse" @click="focusConfigCollapsed=!focusConfigCollapsed" :title="focusConfigCollapsed?'展开参数面板':'折叠参数面板'"><svg viewBox="0 0 24 24"><path :d="focusConfigCollapsed?'m15 6-6 6 6 6':'m9 6 6 6-6 6'"/></svg></button><div class="module-side-inner"><div class="module-side-tabs"><button :class="{active:modulePaneTab.power==='settings'}" @click="modulePaneTab.power='settings'">设置</button><button :class="{active:modulePaneTab.power==='results'}" @click="modulePaneTab.power='results'">结果</button></div><div v-if="modulePaneTab.power==='settings'" class="module-pane-scroll">
<div class="config-section active-channel-config"><h4>当前通道 · {{activePowerAlias}}</h4>
<div class="config-static"><span>类型</span><b>{{activePowerIsMath?'数学通道':'功率通道'}}</b></div>
<label class="config-row"><span>显示名称</span><input type="text" v-model="activePowerAlias" @change="saveSettings"/></label>
<label v-if="!activePowerIsMath" class="config-row"><span>显示单位</span><select v-model="activePowerDisplayUnit" @change="saveSettings"><option value="kW">kW</option><option value="W">W</option><option value="mW">mW</option></select></label>
<label v-else class="config-row"><span>自定义单位</span><input type="text" maxlength="12" v-model="activePowerDisplayUnit" @change="saveSettings" placeholder="可留空"/></label>
<div v-if="activePowerIsMath" class="config-static"><span>数学模式</span><b>power2 / power1 × 100</b></div>
<div class="config-row switch"><span>Dashboard 显示</span><button type="button" class="toggle-pill" :class="{on:activePowerVisible}" @click="activePowerVisible=!activePowerVisible;saveSettings()"><span>{{activePowerVisible?'开':'关'}}</span></button></div>
<label class="config-row"><span>纵轴下限</span><input type="number" v-model.number="activePowerAxisMin" @change="saveSettings"/></label>
<label class="config-row"><span>纵轴上限（0=自动）</span><input type="number" v-model.number="activePowerAxisMax" @change="saveSettings"/></label>
<label class="config-row"><span>历史窗口</span><select v-model.number="settingsDraft.powerWindow" @change="saveSettings"><option :value="120">2 分钟</option><option :value="300">5 分钟</option><option :value="600">10 分钟</option><option :value="1800">30 分钟</option></select></label></div>
<div class="config-section"><h4>测量处理</h4><label class="config-row"><span>平均采样数（点）</span><input type="number" min="1" max="200" v-model.number="settingsDraft.powerAverageSamples" @change="saveSettings"/></label><label class="config-row"><span>偏移量（通道单位）</span><input type="number" step="0.01" v-model.number="settingsDraft.powerOffset" @change="saveSettings"/></label><label class="config-row"><span>缩放系数</span><input type="number" step="0.01" v-model.number="settingsDraft.powerScale" @change="saveSettings"/></label><div class="config-row switch"><span>归一化</span><button type="button" class="toggle-pill" :class="{on:settingsDraft.powerNormalize}" @click="flipSetting('powerNormalize')"><span>{{settingsDraft.powerNormalize?'开':'关'}}</span></button></div><label class="config-row"><span>归一化参考值（通道单位）</span><input type="number" step="0.01" v-model.number="settingsDraft.powerNormalizeValue" @change="saveSettings"/></label><div class="config-row switch"><span>功率密度</span><button type="button" class="toggle-pill" :class="{on:settingsDraft.powerDensity}" @click="flipSetting('powerDensity')"><span>{{settingsDraft.powerDensity?'开':'关'}}</span></button></div><label class="config-row"><span>传感器面积（cm²）</span><input type="number" step="0.01" min="0.000001" v-model.number="settingsDraft.powerAreaCm2" @change="saveSettings"/></label><div class="config-actions"><button @click="zeroPowerActive">清零</button><button @click="normalizePowerAtCurrent">按当前值归一化</button><button @click="resetPowerProcessing">重置处理</button></div></div>
<div class="config-section"><h4>判定</h4><div class="config-row switch"><span>启用上下限</span><button type="button" class="toggle-pill" :class="{on:settingsDraft.powerPassFail}" @click="flipSetting('powerPassFail')"><span>{{settingsDraft.powerPassFail?'开':'关'}}</span></button></div><label class="config-row"><span>下限值（处理后单位）</span><input type="number" step="0.01" v-model.number="settingsDraft.powerLow" @change="saveSettings"/></label><label class="config-row"><span>上限值（处理后单位）</span><input type="number" step="0.01" v-model.number="settingsDraft.powerHigh" @change="saveSettings"/></label></div><div class="config-section interface-config"><h4>设备接口</h4><div class="config-row switch"><span>启用真实接口</span><button type="button" class="toggle-pill" :class="{on:settingsDraft.powerInterfaceEnabled}" @click="flipSetting('powerInterfaceEnabled')"><span>{{settingsDraft.powerInterfaceEnabled?'开':'关'}}</span></button></div><div class="config-static"><span>目标设备</span><b>Ophir Juno</b></div><div class="config-static"><span>通信方式</span><b>USB / OphirLMMeasurement COM</b></div><label class="config-row"><span>序列号</span><input type="text" v-model="settingsDraft.powerInterfaceEndpoint" placeholder="AUTO 或指定序列号" @change="saveSettings"/></label><div class="interface-live" :class="interfaceFor('power')?.state"><i></i><span>{{interfaceStateText(interfaceFor('power')?.state)}}</span><small>{{interfaceFor('power')?.identity||'等待设备身份'}}</small></div><button class="probe-btn" @click="probeInterface('power')">立即重新探测</button></div></div>
<div v-else class="module-pane-scroll results-pane"><div class="result-section"><h4>测量结果</h4><div class="result-row"><span>活动通道</span><b>{{snapshot.power.traces[settingsDraft.powerActiveTrace]?.name}}</b></div><div class="result-row"><span>原始当前值</span><b>{{snapshot.power.traces[settingsDraft.powerActiveTrace]?.value.toFixed(4)}} {{snapshot.power.traces[settingsDraft.powerActiveTrace]?.unit}}</b></div><div class="result-row"><span>处理后值</span><b>{{powerActiveValue.toFixed(4)}} {{powerPageUnit}}</b></div><div class="result-row"><span>历史最大值</span><b>{{snapshot.power.traces[settingsDraft.powerActiveTrace]?.maxValue.toFixed(4)}}</b></div><div class="result-row"><span>历史窗口</span><b>{{settingsDraft.powerWindow/60}} 分钟</b></div><div class="result-row"><span>Dashboard 曲线</span><b>{{[settingsDraft.dashboardPower1?'power1':'',settingsDraft.dashboardPower2?'power2':'',settingsDraft.dashboardMath1?'math1':''].filter(Boolean).join(' / ')||'无'}}</b></div><div class="result-row"><span>判定状态</span><b>{{powerPassState}}</b></div></div><div class="result-section"><h4>处理参数</h4><div class="result-row"><span>平均采样数</span><b>{{settingsDraft.powerAverageSamples}} 点</b></div><div class="result-row"><span>偏移 / 缩放</span><b>{{settingsDraft.powerOffset}} / {{settingsDraft.powerScale}}</b></div><div class="result-row"><span>归一化</span><b>{{settingsDraft.powerNormalize?'启用':'关闭'}}</b></div><div class="result-row"><span>归一化参考值</span><b>{{settingsDraft.powerNormalizeValue}}</b></div><div class="result-row"><span>功率密度</span><b>{{settingsDraft.powerDensity?'启用':'关闭'}}</b></div><div class="result-row"><span>传感器面积</span><b>{{settingsDraft.powerAreaCm2}} cm²</b></div><div class="result-row"><span>判定上下限</span><b>{{settingsDraft.powerPassFail?(settingsDraft.powerLow+' – '+settingsDraft.powerHigh):'关闭'}}</b></div></div><div class="result-section"><h4>接口状态</h4><div class="result-row"><span>当前数据源</span><b>{{dataPlaneText()}}</b></div><div class="result-row"><span>目标设备</span><b>{{interfaceFor('power')?.deviceName}}</b></div><div class="result-row"><span>厂商软件</span><b>{{interfaceFor('power')?.vendorSoftware}}</b></div><div class="result-row"><span>通信接口</span><b>{{interfaceFor('power')?.interfaceName}}</b></div><div class="result-row"><span>接口地址</span><b>{{interfaceFor('power')?.endpoint}}</b></div><div class="result-row"><span>配置状态</span><b>{{interfaceStateText(interfaceFor('power')?.state)}}</b></div><div class="result-row"><span>设备身份</span><b>{{interfaceFor('power')?.identity||'—'}}</b></div><div class="result-row"><span>最后真实样本</span><b>{{interfaceSampleTime('power')}}</b></div><div class="result-row"><span>连续失败</span><b>{{interfaceFor('power')?.failureCount??0}}</b></div><p>{{interfaceFor('power')?.message}}</p></div></div></div></aside>

          <div class="power-layout"><div class="power-chart-zone">
            <PlotCanvas class="main-plot" :series="activePage==='power'?powerPageSeries:powerSeries" :x-min="powerRangeStart" :x-max="powerRangeEnd" :y-min="activePage==='power'?powerPageLeftMin:0" :y-max="activePage==='power'?powerPageLeftMax:powerLeftMax" :right-y-min="activePage==='power'?powerPageRightMin:settingsDraft.math1AxisMin" :right-y-max="activePage==='power'?powerPageRightMax:(settingsDraft.math1AxisMax||100)" x-label="时间" :y-label="activePage==='power'?powerPageAxisLabel:'功率 (kW)'" :right-y-label="activePage==='power'?powerPageRightAxisLabel:dashboardMathAxisLabel" :show-axis-labels="activePage==='power'" :editable-axes="activePage==='power'" :y-unit-options="activePage==='power'&&!activePowerIsMath&&!settingsDraft.powerNormalize&&!settingsDraft.powerDensity?['kW','W','mW']:[]" :y-unit="powerAxisUnit" @axis-unit-change="activePowerDisplayUnit=$event;saveSettings()" :time-axis="true" :time-origin-ms="powerTimeOriginMs" :time-valid-max="powerHistorySpan" @axis-limit-change="onPowerAxisLimit" />
            <div class="overview-row"><div ref="powerOverviewShell" class="overview-shell"><PlotCanvas :series="powerSeries.slice(0,1)" :x-min="0" :x-max="settingsDraft.powerWindow" :compact="true" /><div class="overview-selected" :style="powerSelectionStyle"><i class="overview-handle start" @pointerdown.stop="beginPowerRangeDrag($event,'start')"></i><i class="overview-handle end" @pointerdown.stop="beginPowerRangeDrag($event,'end')"></i></div></div></div>
          </div></div>
        </article>

        <article class="instrument-panel spectrum-panel" :class="{hidden:!['dashboard','spectrum'].includes(activePage)}">
          <div class="spectrum-head graph-overlay">
            <div class="module-title"><div class="panel-mark inline spectrum-accent" :class="['state-'+moduleStatusTone('spectrum'),{selected:snapshot.captureSelection.spectrum}]" :title="'光谱：'+moduleStatusText('spectrum')"><svg viewBox="0 0 24 24"><path d="M3 19c4 0 5-14 9-14s5 14 9 14"/></svg></div><strong>光谱</strong></div>
            <template v-if="activePage==='spectrum'">
              <div class="focus-head-metrics">
                <div class="focus-head-value"><span>中心波长</span><div><b>{{(activePage==='spectrum'?osaDisplayCenter:snapshot.spectrum.centerWavelength).toFixed(2)}}</b><small>nm</small></div></div>
                <div class="focus-head-value"><span>3 dB 线宽</span><div><b>{{snapshot.spectrum.linewidth3Db.toFixed(2)}}</b><small>nm</small></div></div>
                <div class="focus-head-value"><span>RMS 线宽</span><div><b>{{snapshot.spectrum.linewidthRms.toFixed(2)}}</b><small>nm</small></div></div>
                <div class="focus-head-value"><span>积分功率</span><div><b>{{snapshot.spectrum.power.toFixed(1)}}</b><small>dBm</small></div></div>
              </div>
              <div class="focus-head-status"><span><i class="channel-light online"></i>OSA1</span><span><i class="channel-light" :class="{online:settingsDraft.osaShowRef}"></i>参考光谱</span></div>
            </template>
            <div v-else class="osa-metrics"><button class="metric-trigger primary-metric" @click="openReadout('spectrumCenter')"><em>λc</em><span class="metric-value-chip"><b>{{osaDisplayCenter.toFixed(2)}}</b><small>nm</small></span></button><button class="metric-trigger secondary-trigger" @click="openReadout('spectrum3db')"><em>3 dB</em><span class="metric-value-chip"><b>{{snapshot.spectrum.linewidth3Db.toFixed(2)}}</b><small>nm</small></span></button><button class="metric-trigger secondary-trigger" @click="openReadout('spectrumRms')"><em>RMS</em><span class="metric-value-chip"><b>{{snapshot.spectrum.linewidthRms.toFixed(2)}}</b><small>nm</small></span></button><button class="metric-trigger primary-metric" @click="openReadout('spectrumPower')"><em>P</em><span class="metric-value-chip"><b>{{snapshot.spectrum.power.toFixed(1)}}</b><small>dBm</small></span></button></div>
          </div>

          <div v-if="activePage==='spectrum'" class="focus-summary">
            <div class="focus-metric"><span>中心波长 λc</span><div><b>{{osaDisplayCenter.toFixed(2)}}</b><small>nm</small></div></div>
            <div class="focus-metric"><span>3 dB 线宽</span><div><b>{{snapshot.spectrum.linewidth3Db.toFixed(2)}}</b><small>nm</small></div></div>
            <div class="focus-metric"><span>RMS 线宽</span><div><b>{{snapshot.spectrum.linewidthRms.toFixed(2)}}</b><small>nm</small></div></div>
            <div class="focus-metric"><span>积分功率</span><div><b>{{snapshot.spectrum.power.toFixed(1)}}</b><small>dBm</small></div></div>
          </div>

          <aside v-if="activePage==='spectrum'" class="module-config-dock workstation-config module-side-pane" :class="{collapsed:focusConfigCollapsed}"><button class="module-pane-collapse" @click="focusConfigCollapsed=!focusConfigCollapsed" :title="focusConfigCollapsed?'展开参数面板':'折叠参数面板'"><svg viewBox="0 0 24 24"><path :d="focusConfigCollapsed?'m15 6-6 6 6 6':'m9 6 6 6-6 6'"/></svg></button><div class="module-side-inner"><div class="module-side-tabs"><button :class="{active:modulePaneTab.spectrum==='settings'}" @click="modulePaneTab.spectrum='settings'">设置</button><button :class="{active:modulePaneTab.spectrum==='results'}" @click="modulePaneTab.spectrum='results'">结果</button></div><div v-if="modulePaneTab.spectrum==='settings'" class="module-pane-scroll">
<div class="config-section"><h4>波长范围</h4><label class="config-row"><span>起始波长（nm）</span><input type="number" step="0.01" v-model.number="settingsDraft.osaStart" @change="saveSettings"/></label><label class="config-row"><span>终止波长（nm）</span><input type="number" step="0.01" v-model.number="settingsDraft.osaStop" @change="saveSettings"/></label><label class="config-row"><span>中心波长（nm）</span><input type="number" step="0.01" v-model.number="osaCenterDraft" @change="saveSettings"/></label><label class="config-row"><span>扫描范围（nm）</span><input type="number" step="0.01" min="0.01" v-model.number="osaSpanDraft" @change="saveSettings"/></label></div>
<div class="config-section"><h4>采集</h4><label class="config-row"><span>分辨率带宽（nm）</span><select v-model.number="settingsDraft.osaResolution" @change="saveSettings"><option :value="0.02">0.02</option><option :value="0.05">0.05</option><option :value="0.1">0.10</option><option :value="0.2">0.20</option><option :value="0.5">0.50</option><option :value="1">1.00</option></select></label><label class="config-row"><span>灵敏度</span><select v-model="settingsDraft.osaSensitivity" @change="saveSettings"><option value="LOW">低</option><option value="MID">中</option><option value="HIGH1">高 1</option><option value="HIGH2">高 2</option></select></label><label class="config-row"><span>平均次数（次）</span><input type="number" min="1" max="999" v-model.number="settingsDraft.osaAverage" @change="saveSettings"/></label><label class="config-row"><span>扫描模式</span><select v-model="settingsDraft.osaSweepMode" @change="saveSettings"><option value="SINGLE">单次</option><option value="REPEAT">重复</option></select></label>
<label class="config-row"><span>采样点数</span><select v-model.number="settingsDraft.osaSamplePoints" @change="saveSettings"><option :value="251">251</option><option :value="501">501</option><option :value="1001">1001</option><option :value="2001">2001</option><option :value="5001">5001</option></select></label>
</div>
<div class="config-section"><h4>轨迹 / 本地处理</h4>
<label class="config-row"><span>轨迹模式</span><select v-model="settingsDraft.osaTraceMode" @change="saveSettings"><option value="WRITE">写入</option><option value="MAXHOLD">最大保持</option><option value="AVERAGE">轨迹平均</option></select></label>
<label class="config-row"><span>本地平滑点数</span><select v-model.number="settingsDraft.osaSmoothingPoints" @change="saveSettings"><option :value="1">关闭</option><option :value="3">3</option><option :value="5">5</option><option :value="9">9</option><option :value="15">15</option></select></label>
<label class="config-row"><span>波长偏移（nm）</span><input type="number" step="0.001" v-model.number="settingsDraft.osaWavelengthOffsetNm" @change="saveSettings"/></label>
<label class="config-row"><span>波长基准</span><select v-model="settingsDraft.osaWavelengthReference" @change="saveSettings"><option value="AIR">空气</option><option value="VACUUM">真空</option></select></label><p class="config-note">RBW、灵敏度、平均、扫描模式、采样点数、轨迹模式、波长基准与波长偏移会写入 AQ6370D；Simulator 下波长偏移由 LaserBench 本地模拟。本地平滑只影响显示。</p></div>
<div class="config-section"><h4>显示 / 标记</h4><label class="config-row"><span>参考电平（dBm）</span><input type="number" v-model.number="settingsDraft.osaRefLevel" @change="saveSettings"/></label><label class="config-row"><span>垂直刻度（dB/div）</span><input type="number" min="0.1" max="10" step="0.1" v-model.number="settingsDraft.osaDbPerDiv" @change="saveSettings"/></label><div class="config-row switch"><span>显示参考光谱</span><button type="button" class="toggle-pill" :class="{on:settingsDraft.osaShowRef}" @click="flipSetting('osaShowRef')"><span>{{settingsDraft.osaShowRef?'开':'关'}}</span></button></div><div class="config-row switch"><span>显示峰值标记</span><button type="button" class="toggle-pill" :class="{on:settingsDraft.osaMarkerPeak}" @click="flipSetting('osaMarkerPeak')"><span>{{settingsDraft.osaMarkerPeak?'开':'关'}}</span></button></div>
<div class="config-row switch"><span>本地自动峰值标记</span><button type="button" class="toggle-pill" :class="{on:settingsDraft.osaAutoPeakSearch}" @click="flipSetting('osaAutoPeakSearch')"><span>{{settingsDraft.osaAutoPeakSearch?'开':'关'}}</span></button></div></div><div class="config-section interface-config"><h4>设备接口</h4><div class="config-row switch"><span>启用真实接口</span><button type="button" class="toggle-pill" :class="{on:settingsDraft.spectrumInterfaceEnabled}" @click="flipSetting('spectrumInterfaceEnabled')"><span>{{settingsDraft.spectrumInterfaceEnabled?'开':'关'}}</span></button></div><div class="config-static"><span>目标设备</span><b>Yokogawa AQ6370D</b></div><div class="config-static"><span>通信方式</span><b>LAN TCP/SCPI · port 10001</b></div><label class="config-row"><span>IP / TCPIP 地址</span><input type="text" v-model="settingsDraft.spectrumInterfaceEndpoint" placeholder="192.168.1.100" @change="saveSettings"/></label><div class="interface-live" :class="interfaceFor('spectrum')?.state"><i></i><span>{{interfaceStateText(interfaceFor('spectrum')?.state)}}</span><small>{{interfaceFor('spectrum')?.identity||'等待 *IDN? 身份'}}</small></div><button class="probe-btn" @click="probeInterface('spectrum')">立即重新探测</button></div></div>
<div v-else class="module-pane-scroll results-pane"><div class="result-section"><h4>光谱结果</h4><div class="result-row"><span>中心波长</span><b>{{snapshot.spectrum.centerWavelength.toFixed(4)}} nm</b></div><div class="result-row"><span>3 dB 线宽</span><b>{{snapshot.spectrum.linewidth3Db.toFixed(4)}} nm</b></div><div class="result-row"><span>RMS 线宽</span><b>{{snapshot.spectrum.linewidthRms.toFixed(4)}} nm</b></div><div class="result-row"><span>积分功率</span><b>{{snapshot.spectrum.power.toFixed(3)}} dBm</b></div></div><div class="result-section"><h4>扫描参数</h4><div class="result-row"><span>波长范围</span><b>{{settingsDraft.osaStart}} – {{settingsDraft.osaStop}} nm</b></div><div class="result-row"><span>分辨率带宽</span><b>{{settingsDraft.osaResolution}} nm</b></div><div class="result-row"><span>采样点数</span><b>{{settingsDraft.osaSamplePoints}}</b></div><div class="result-row"><span>轨迹模式</span><b>{{settingsDraft.osaTraceMode==='WRITE'?'写入':settingsDraft.osaTraceMode==='MAXHOLD'?'最大保持':'轨迹平均'}}</b></div><div class="result-row"><span>本地平滑点数</span><b>{{settingsDraft.osaSmoothingPoints}}</b></div><div class="result-row"><span>波长偏移</span><b>{{settingsDraft.osaWavelengthOffsetNm}} nm</b></div><div class="result-row"><span>波长基准</span><b>{{settingsDraft.osaWavelengthReference==='AIR'?'空气':'真空'}}</b></div><div class="result-row"><span>灵敏度</span><b>{{settingsDraft.osaSensitivity==='LOW'?'低':settingsDraft.osaSensitivity==='MID'?'中':settingsDraft.osaSensitivity==='HIGH1'?'高 1':'高 2'}}</b></div><div class="result-row"><span>平均次数</span><b>{{settingsDraft.osaAverage}} 次</b></div><div class="result-row"><span>扫描模式</span><b>{{settingsDraft.osaSweepMode==='REPEAT'?'重复':'单次'}}</b></div><div class="result-row"><span>参考电平</span><b>{{settingsDraft.osaRefLevel}} dBm</b></div><div class="result-row"><span>垂直刻度</span><b>{{settingsDraft.osaDbPerDiv}} dB/div</b></div><div class="result-row"><span>参考光谱 / 峰值标记</span><b>{{settingsDraft.osaShowRef?'显示':'隐藏'}} / {{settingsDraft.osaMarkerPeak?'显示':'隐藏'}}</b></div><div class="result-row"><span>本地自动峰值标记</span><b>{{settingsDraft.osaAutoPeakSearch?'开启':'关闭'}}</b></div></div><div class="result-section"><h4>接口状态</h4><div class="result-row"><span>当前数据源</span><b>{{dataPlaneText()}}</b></div><div class="result-row"><span>目标设备</span><b>{{interfaceFor('spectrum')?.deviceName}}</b></div><div class="result-row"><span>通信接口</span><b>{{interfaceFor('spectrum')?.interfaceName}}</b></div><div class="result-row"><span>接口地址</span><b>{{interfaceFor('spectrum')?.endpoint}}</b></div><div class="result-row"><span>配置状态</span><b>{{interfaceStateText(interfaceFor('spectrum')?.state)}}</b></div><div class="result-row"><span>设备身份</span><b>{{interfaceFor('spectrum')?.identity||'—'}}</b></div><div class="result-row"><span>最后真实样本</span><b>{{interfaceSampleTime('spectrum')}}</b></div><div class="result-row"><span>连续失败</span><b>{{interfaceFor('spectrum')?.failureCount??0}}</b></div><p>{{interfaceFor('spectrum')?.message}}</p></div></div></div></aside>
          <PlotCanvas class="spectrum-plot" :series="activePage==='spectrum'?spectrumPageSeries:snapshot.spectrum.traces" :x-min="settingsDraft.osaStart" :x-max="settingsDraft.osaStop" :y-min="activePage==='spectrum'?osaYMin:-100" :y-max="activePage==='spectrum'?osaYMax:0" :vertical-marker="activePage==='spectrum'&&settingsDraft.osaMarkerPeak&&settingsDraft.osaAutoPeakSearch?osaDisplayCenter:undefined" x-label="波长 (nm)" y-label="功率 (dBm)" :show-axis-labels="activePage==='spectrum'" :editable-axes="activePage==='spectrum'" @axis-limit-change="onSpectrumAxisLimit" />
        </article>

        <article class="instrument-panel beam-panel" :class="{hidden:!['dashboard','beam'].includes(activePage)}">
          <div class="module-head beam-head graph-overlay">
            <div class="module-title"><div class="panel-mark beam-accent" :class="['state-'+moduleStatusTone('beam'),{selected:snapshot.captureSelection.beam}]" :title="'光束：'+moduleStatusText('beam')"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></div><strong>光束</strong></div>
            <template v-if="activePage==='beam'">
              <div class="focus-head-metrics beam-focus-values">
                <div class="focus-head-value"><span>M² X</span><div><b>{{snapshot.beam.m2x.toFixed(2)}}</b></div></div>
                <div class="focus-head-value"><span>M² Y</span><div><b>{{snapshot.beam.m2y.toFixed(2)}}</b></div></div>
                <div class="focus-head-value"><span>M²</span><div><b>{{snapshot.beam.m2mean.toFixed(2)}}</b></div></div>
                <div class="focus-head-value"><span>束宽 X</span><div><b>{{snapshot.beam.spotWidthX.toFixed(0)}}</b><small>μm</small></div></div>
                <div class="focus-head-value"><span>束宽 Y</span><div><b>{{snapshot.beam.spotWidthY.toFixed(0)}}</b><small>μm</small></div></div>
                <div class="focus-head-value"><span>椭圆度 Y/X</span><div><b>{{beamEllipticity.toFixed(3)}}</b></div></div>
              </div>
              <div class="focus-head-status"><span><i class="channel-light online"></i>{{settingsDraft.beamInterfaceEnabled?'BeamSquared 只读桥':(settingsDraft.beamRunMode==='AUTO'?'自动':'手动')}}</span><span>{{settingsDraft.beamInterfaceEnabled?'Rail 由厂商流程控制':'Z '+beamZ.toFixed(1)+' mm'}}</span></div>
            </template>
            <template v-else>
              <div class="beam-top-controls" :class="{'hardware-locked':settingsDraft.beamInterfaceEnabled}"><span class="control-label">{{settingsDraft.beamInterfaceEnabled?'Z Ref':'Z'}}</span><input type="range" min="-24" max="24" step="0.1" :value="beamZ" :disabled="settingsDraft.beamInterfaceEnabled" @pointerdown="beginZDrag" @pointerup="endZDrag" @pointercancel="endZDrag" @keydown="beginZDrag" @keyup="endZDrag" @blur="endZDrag" @input="onZInput"/><b>{{beamZ.toFixed(1)}} mm</b><button class="play-mini" :class="{active:beamPlaying}" :disabled="settingsDraft.beamInterfaceEnabled" @click="toggleBeamPlay"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button><span class="control-label">Att</span><input type="range" min="0" max="40" step="0.1" :value="beamAtt" :disabled="settingsDraft.beamInterfaceEnabled" @pointerdown="beginAttDrag" @pointerup="endAttDrag" @pointercancel="endAttDrag" @keydown="beginAttDrag" @keyup="endAttDrag" @blur="endAttDrag" @input="onAttInput"/><b>{{beamAtt.toFixed(1)}} dB</b></div>
              <div class="m2-block"><button class="metric-trigger secondary-trigger" @click="openReadout('beamM2x')"><em>M²x</em><span class="metric-value-chip"><b>{{snapshot.beam.m2x.toFixed(2)}}</b></span></button><button class="metric-trigger secondary-trigger" @click="openReadout('beamM2y')"><em>M²y</em><span class="metric-value-chip"><b>{{snapshot.beam.m2y.toFixed(2)}}</b></span></button><button class="metric-trigger primary-metric" @click="openReadout('beamM2')"><em>M²</em><span class="metric-value-chip"><b>{{snapshot.beam.m2mean.toFixed(2)}}</b></span></button></div>
            </template>
          </div>

          <div v-if="activePage==='beam'" class="focus-summary">
            <div class="focus-metric"><span>M² X</span><div><b>{{snapshot.beam.m2x.toFixed(2)}}</b></div></div>
            <div class="focus-metric"><span>M² Y</span><div><b>{{snapshot.beam.m2y.toFixed(2)}}</b></div></div>
            <div class="focus-metric"><span>M²</span><div><b>{{snapshot.beam.m2mean.toFixed(2)}}</b></div></div>
            <div class="focus-metric"><span>束宽 X</span><div><b>{{snapshot.beam.spotWidthX.toFixed(0)}}</b><small>μm</small></div></div>
            <div class="focus-metric"><span>束宽 Y</span><div><b>{{snapshot.beam.spotWidthY.toFixed(0)}}</b><small>μm</small></div></div>
            <div class="focus-metric"><span>椭圆度 Y/X</span><div><b>{{beamEllipticity.toFixed(3)}}</b></div></div>
          </div>

          <aside v-if="activePage==='beam'" class="module-config-dock workstation-config module-side-pane beam-page-config" :class="{collapsed:focusConfigCollapsed}"><button class="module-pane-collapse" @click="focusConfigCollapsed=!focusConfigCollapsed" :title="focusConfigCollapsed?'展开参数面板':'折叠参数面板'"><svg viewBox="0 0 24 24"><path :d="focusConfigCollapsed?'m15 6-6 6 6 6':'m9 6 6 6-6 6'"/></svg></button><div class="module-side-inner"><div class="module-side-tabs"><button :class="{active:modulePaneTab.beam==='settings'}" @click="modulePaneTab.beam='settings'">设置</button><button :class="{active:modulePaneTab.beam==='results'}" @click="modulePaneTab.beam='results'">结果</button></div><div v-if="modulePaneTab.beam==='settings'" class="module-pane-scroll">
<div class="config-section"><h4>位置 / 衰减</h4><p v-if="settingsDraft.beamInterfaceEnabled" class="config-note hardware-boundary-note">真实 BeamSquared 模式下，Rail 与衰减机械控制不会由 LaserBench v0.5.0 自动下发；避免未确认的机械运动。当前位置与 Run 流程由 BeamSquared Automation 管理。</p><label class="config-control"><span>{{settingsDraft.beamInterfaceEnabled?'本地 Z 参考（mm）':'Z 位置（mm）'}}</span><input type="range" min="-24" max="24" step="0.1" :value="beamZ" :disabled="settingsDraft.beamInterfaceEnabled" @pointerdown="beginZDrag" @pointerup="endZDrag" @pointercancel="endZDrag" @input="onZInput"/><b>{{beamZ.toFixed(1)}}</b></label><label class="config-control"><span>{{settingsDraft.beamInterfaceEnabled?'本地衰减预览（dB）':'衰减（dB）'}}</span><input type="range" min="0" max="40" step="0.1" :value="beamAtt" :disabled="settingsDraft.beamInterfaceEnabled" @pointerdown="beginAttDrag" @pointerup="endAttDrag" @pointercancel="endAttDrag" @input="onAttInput"/><b>{{beamAtt.toFixed(1)}}</b></label><button class="config-action" :class="{active:beamPlaying}" :disabled="settingsDraft.beamInterfaceEnabled" @click="toggleBeamPlay">{{beamPlaying?'停止 Z 浏览':'自动 Z 浏览'}}</button></div>
<div class="config-section"><h4>M² 分析</h4><p v-if="settingsDraft.beamInterfaceEnabled" class="config-note hardware-boundary-note">BeamSquared 只读桥：LaserBench v0.5.0 读取 RunStatus / BeamWidth / M²；Run / rail / Ultracal 与厂商分析算法仍由 BeamSquared 管理，不伪装成已接通控制。</p><template v-else><label class="config-row"><span>Simulator 运行模式</span><select v-model="settingsDraft.beamRunMode" @change="saveSettings"><option value="AUTO">自动</option><option value="MANUAL">手动</option></select></label><label class="config-row"><span>Simulator 束宽算法</span><select v-model="settingsDraft.beamWidthMethod" @change="saveSettings"><option value="D4SIGMA">D4σ / ISO 11146</option><option value="FWHM">FWHM</option></select></label><div class="config-row switch"><span>Simulator 自动剔除离群点</span><button type="button" class="toggle-pill" :class="{on:settingsDraft.beamAutoOutlier}" @click="flipSetting('beamAutoOutlier')"><span>{{settingsDraft.beamAutoOutlier?'开':'关'}}</span></button></div></template><div class="config-row switch"><span>显示 X 曲线</span><button type="button" class="toggle-pill" :class="{on:settingsDraft.beamShowX}" @click="flipSetting('beamShowX')"><span>{{settingsDraft.beamShowX?'开':'关'}}</span></button></div><div class="config-row switch"><span>显示 Y 曲线</span><button type="button" class="toggle-pill" :class="{on:settingsDraft.beamShowY}" @click="flipSetting('beamShowY')"><span>{{settingsDraft.beamShowY?'开':'关'}}</span></button></div></div><div class="config-section interface-config"><h4>设备接口</h4><div class="config-row switch"><span>启用真实接口</span><button type="button" class="toggle-pill" :class="{on:settingsDraft.beamInterfaceEnabled}" @click="flipSetting('beamInterfaceEnabled')"><span>{{settingsDraft.beamInterfaceEnabled?'开':'关'}}</span></button></div><div class="config-static"><span>目标设备</span><b>Spiricon SP920 / BeamSquared</b></div><div class="config-static"><span>通信方式</span><b>.NET Framework Automation Bridge</b></div><label class="config-row"><span>Automation 路径</span><input type="text" v-model="settingsDraft.beamInterfaceEndpoint" placeholder="AUTO 或 BeamSquared 安装目录" @change="saveSettings"/></label><div class="interface-live" :class="interfaceFor('beam')?.state"><i></i><span>{{interfaceStateText(interfaceFor('beam')?.state)}}</span><small>{{interfaceFor('beam')?.identity||'等待 BeamSquared Automation'}}</small></div><button class="probe-btn" @click="probeInterface('beam')">立即重新探测</button></div></div>
<div v-else class="module-pane-scroll results-pane"><div class="result-section"><h4>光束结果</h4><div class="result-row"><span>M² X</span><b>{{snapshot.beam.m2x.toFixed(4)}}</b></div><div class="result-row"><span>M² Y</span><b>{{snapshot.beam.m2y.toFixed(4)}}</b></div><div class="result-row"><span>M²</span><b>{{snapshot.beam.m2mean.toFixed(4)}}</b></div><div class="result-row"><span>束宽 X</span><b>{{snapshot.beam.spotWidthX.toFixed(2)}} μm</b></div><div class="result-row"><span>束宽 Y</span><b>{{snapshot.beam.spotWidthY.toFixed(2)}} μm</b></div><div class="result-row"><span>椭圆度</span><b>{{beamEllipticity.toFixed(4)}}</b></div></div><div class="result-section"><h4>分析参数</h4><template v-if="settingsDraft.beamInterfaceEnabled"><div class="result-row"><span>真实控制边界</span><b>结果只读桥</b></div><div class="result-row"><span>Run / rail / Ultracal</span><b>BeamSquared 管理</b></div><div class="result-row"><span>束宽算法 / outlier</span><b>BeamSquared 管理</b></div></template><template v-else><div class="result-row"><span>Z 位置</span><b>{{beamZ.toFixed(2)}} mm</b></div><div class="result-row"><span>衰减</span><b>{{beamAtt.toFixed(2)}} dB</b></div><div class="result-row"><span>Simulator 运行模式</span><b>{{settingsDraft.beamRunMode==='AUTO'?'自动':'手动'}}</b></div><div class="result-row"><span>Simulator 束宽算法</span><b>{{settingsDraft.beamWidthMethod==='D4SIGMA'?'D4σ / ISO 11146':'FWHM'}}</b></div><div class="result-row"><span>Simulator 离群点处理</span><b>{{settingsDraft.beamAutoOutlier?'自动剔除':'关闭'}}</b></div></template><div class="result-row"><span>X / Y 显示曲线</span><b>{{settingsDraft.beamShowX?'显示':'隐藏'}} / {{settingsDraft.beamShowY?'显示':'隐藏'}}</b></div></div><div class="result-section"><h4>接口状态</h4><div class="result-row"><span>当前数据源</span><b>{{dataPlaneText()}}</b></div><div class="result-row"><span>目标设备</span><b>{{interfaceFor('beam')?.deviceName}}</b></div><div class="result-row"><span>厂商软件</span><b>{{interfaceFor('beam')?.vendorSoftware}}</b></div><div class="result-row"><span>通信接口</span><b>{{interfaceFor('beam')?.interfaceName}}</b></div><div class="result-row"><span>接口地址</span><b>{{interfaceFor('beam')?.endpoint}}</b></div><div class="result-row"><span>配置状态</span><b>{{interfaceStateText(interfaceFor('beam')?.state)}}</b></div><div class="result-row"><span>设备身份</span><b>{{interfaceFor('beam')?.identity||'—'}}</b></div><div class="result-row"><span>最后真实样本</span><b>{{interfaceSampleTime('beam')}}</b></div><div class="result-row"><span>连续失败</span><b>{{interfaceFor('beam')?.failureCount??0}}</b></div><p>{{interfaceFor('beam')?.message}}</p></div></div></div></aside>
          <div class="beam-body"><div class="beam-profile-column"><div v-if="activePage==='beam'" class="beam-frame-quality" :class="beamFrameQuality.tone"><span>FRAME</span><div class="frame-meter"><i :style="{width:beamFrameQuality.pct+'%'}"></i></div><b>{{beamFrameQuality.label}}</b></div><div class="beam-image-wrap"><BeamProfileCanvas :width-x="snapshot.beam.spotWidthX" :width-y="snapshot.beam.spotWidthY" :attenuation="beamAtt" /></div></div><PlotCanvas class="caustic-plot" :series="activePage==='beam'?beamPageCaustic:snapshot.beam.caustic" :vertical-marker="beamZ" :x-min="activePage==='beam'?beamAxisXMin:undefined" :x-max="activePage==='beam'?beamAxisXMax:undefined" :y-min="activePage==='beam'?beamAxisYMin:undefined" :y-max="activePage==='beam'?beamAxisYMax:undefined" :x-padding="0.04" x-label="Z (mm)" y-label="束宽 (μm)" :show-axis-labels="activePage==='beam'" :editable-axes="activePage==='beam'" @axis-limit-change="onBeamAxisLimit" /></div>
        </article>

        <article class="instrument-panel scope-panel" :class="{hidden:!['dashboard','scope'].includes(activePage)}">
          <div class="module-head scope-head graph-overlay">
            <div class="module-title"><div class="panel-mark scope-accent" :class="['state-'+moduleStatusTone('scope'),{selected:snapshot.captureSelection.scope}]" :title="'示波器：'+moduleStatusText('scope')"><svg viewBox="0 0 24 24"><path d="M2 12h3c1.5 0 1.5-7 3-7s1.5 14 3 14 1.5-14 3-14 1.5 14 3 14 1.5-7 3-7h2"/></svg></div><strong>示波器</strong></div>
            <template v-if="activePage==='scope'">
              <div class="scope-channel-board" aria-label="示波器通道">
                <button :class="{active:activeScopeChannel===1}" @click="selectScopeChannel(1)"><i class="channel-light" :class="{online:settingsDraft.scopeCh1}"></i><span>{{scopeAlias(1)}}</span><b>{{scopeTrace(1)?.points.at(-1)?.y.toFixed(3) ?? '—'}} V</b></button>
                <button :class="{active:activeScopeChannel===2}" @click="selectScopeChannel(2)"><i class="channel-light" :class="{online:settingsDraft.scopeCh2}"></i><span>{{scopeAlias(2)}}</span><b>{{scopeTrace(2)?.points.at(-1)?.y.toFixed(3) ?? '—'}} V</b></button>
              </div>
              <div class="focus-head-metrics">
                <div class="focus-head-value focus-head-active"><span>{{activeScopeAlias}}</span><div><b>{{scopeTrace(activeScopeChannel)?.points.at(-1)?.y.toFixed(3) ?? '—'}}</b><small>V</small></div></div>
                <div class="focus-head-value"><span>采样率</span><div><b>{{sampleRateParts().value}}</b><small>{{sampleRateParts().unit}}</small></div></div>
                <div class="focus-head-value"><span>触发</span><div><b>{{settingsDraft.scopeTriggerSource}}</b><small>{{settingsDraft.scopeTriggerLevel.toFixed(2)}} V</small></div></div>
              </div>
            </template>
            <div v-else class="scope-readouts"><button v-for="(trace,index) in snapshot.scope.time" :key="trace.name" class="metric-trigger" @click="openReadout(index===0?'scope0':'scope1')"><em>{{trace.name}}</em><span class="metric-value-chip"><b>{{trace.points.at(-1)?.y.toFixed(3) ?? '0.000'}}</b><small>V</small></span></button><span class="secondary-metric"><em>SR</em><span class="metric-value-chip"><b>{{sampleRateParts().value}}</b><small>{{sampleRateParts().unit}}</small></span></span></div>
          </div>

          <div v-if="activePage==='scope'" class="focus-summary">
            <div v-for="trace in snapshot.scope.time" :key="trace.name" class="focus-metric"><span>{{trace.name}}</span><div><b>{{trace.points.at(-1)?.y.toFixed(3) ?? '0.000'}}</b></div></div>
            <div class="focus-metric"><span>采样率</span><div><b>{{sampleRateParts().value}}</b><small>{{sampleRateParts().unit}}</small></div></div>
            <div class="focus-metric"><span>触发</span><div><b>{{settingsDraft.scopeTriggerSource}}</b><small>{{settingsDraft.scopeTriggerLevel.toFixed(2)}} V</small></div></div>
          </div>

          <aside v-if="activePage==='scope'" class="module-config-dock workstation-config module-side-pane" :class="{collapsed:focusConfigCollapsed}"><button class="module-pane-collapse" @click="focusConfigCollapsed=!focusConfigCollapsed" :title="focusConfigCollapsed?'展开参数面板':'折叠参数面板'"><svg viewBox="0 0 24 24"><path :d="focusConfigCollapsed?'m15 6-6 6 6 6':'m9 6 6 6-6 6'"/></svg></button><div class="module-side-inner"><div class="module-side-tabs"><button :class="{active:modulePaneTab.scope==='settings'}" @click="modulePaneTab.scope='settings'">设置</button><button :class="{active:modulePaneTab.scope==='results'}" @click="modulePaneTab.scope='results'">结果</button></div><div v-if="modulePaneTab.scope==='settings'" class="module-pane-scroll">
<div class="config-section"><h4>水平</h4><label class="config-row"><span>时间范围（ms）</span><input type="number" step="0.01" min="0.01" v-model.number="settingsDraft.scopeTimeSpan" @change="saveSettings"/></label><label class="config-row"><span>FFT 上限频率（MHz）</span><input type="number" step="0.1" min="0.1" v-model.number="settingsDraft.scopeFftMax" @change="saveSettings"/></label></div>
<div class="config-section active-channel-config"><h4>当前通道 · {{activeScopeAlias}}</h4><div class="config-static"><span>通道</span><b>CH{{activeScopeChannel}}</b></div><label class="config-row"><span>显示名称</span><input type="text" v-model="activeScopeAlias" @change="saveSettings"/></label><div class="config-row switch"><span>显示曲线</span><button type="button" class="toggle-pill" :class="{on:activeScopeVisible}" @click="activeScopeVisible=!activeScopeVisible;saveSettings()"><span>{{activeScopeVisible?'开':'关'}}</span></button></div><label class="config-row"><span>垂直刻度（V/div）</span><input type="number" step="0.01" min="0.001" v-model.number="activeScopeVoltsDiv" @change="saveSettings"/></label><label class="config-row"><span>垂直偏移（V）</span><input type="number" step="0.01" v-model.number="activeScopeOffset" @change="saveSettings"/></label><label class="config-row"><span>耦合方式</span><select v-model="activeScopeCoupling" @change="saveSettings"><option value="DC">直流（DC）</option><option value="AC">交流（AC）</option><option value="GND">接地（GND）</option></select></label></div>
<div class="config-section"><h4>触发 / 采集</h4><label class="config-row"><span>触发源</span><select v-model="settingsDraft.scopeTriggerSource" @change="saveSettings"><option>CH1</option><option>CH2</option></select></label><label class="config-row"><span>触发电平（V）</span><input type="number" step="0.01" v-model.number="settingsDraft.scopeTriggerLevel" @change="saveSettings"/></label><label class="config-row"><span>触发沿</span><select v-model="settingsDraft.scopeTriggerSlope" @change="saveSettings"><option value="RISING">上升沿</option><option value="FALLING">下降沿</option></select></label><label class="config-row"><span>采集模式</span><select v-model="settingsDraft.scopeAcquisition" @change="saveSettings"><option value="SAMPLE">采样</option><option value="AVERAGE">平均</option><option value="PEAK">峰值检测</option></select></label><label class="config-row"><span>平均次数（次）</span><input type="number" min="2" max="1024" v-model.number="settingsDraft.scopeAverage" @change="saveSettings"/></label></div><div class="config-section interface-config"><h4>设备接口</h4><div class="config-row switch"><span>启用真实接口</span><button type="button" class="toggle-pill" :class="{on:settingsDraft.scopeInterfaceEnabled}" @click="flipSetting('scopeInterfaceEnabled')"><span>{{settingsDraft.scopeInterfaceEnabled?'开':'关'}}</span></button></div><div class="config-static"><span>目标设备</span><b>Tektronix MSO44</b></div><div class="config-static"><span>通信方式</span><b>LAN Raw TCP/SCPI · port 4000</b></div><label class="config-row"><span>IP / TCPIP 地址</span><input type="text" v-model="settingsDraft.scopeInterfaceEndpoint" placeholder="192.168.1.50" @change="saveSettings"/></label><div class="interface-live" :class="interfaceFor('scope')?.state"><i></i><span>{{interfaceStateText(interfaceFor('scope')?.state)}}</span><small>{{interfaceFor('scope')?.identity||'等待 *IDN? 身份'}}</small></div><button class="probe-btn" @click="probeInterface('scope')">立即重新探测</button></div></div>
<div v-else class="module-pane-scroll results-pane"><div class="result-section"><h4>波形结果</h4><div v-for="trace in snapshot.scope.time" :key="'scope-result-'+trace.name" class="result-row"><span>{{trace.name}} 当前值</span><b>{{trace.points.at(-1)?.y.toFixed(5) ?? '0.00000'}} V</b></div><div class="result-row"><span>采样率</span><b>{{sampleRateParts().value}} {{sampleRateParts().unit}}</b></div></div><div class="result-section"><h4>采集参数</h4><div class="result-row"><span>时间范围</span><b>{{settingsDraft.scopeTimeSpan}} ms</b></div><div class="result-row"><span>FFT 上限</span><b>{{settingsDraft.scopeFftMax}} MHz</b></div><div class="result-row"><span>{{scopeAlias(1)}} 垂直</span><b>{{settingsDraft.scopeCh1VoltsDiv}} V/div · {{settingsDraft.scopeCh1Offset}} V · {{settingsDraft.scopeCh1Coupling}}</b></div><div class="result-row"><span>{{scopeAlias(2)}} 垂直</span><b>{{settingsDraft.scopeCh2VoltsDiv}} V/div · {{settingsDraft.scopeCh2Offset}} V · {{settingsDraft.scopeCh2Coupling}}</b></div><div class="result-row"><span>通道显示</span><b>{{scopeAlias(1)}} {{settingsDraft.scopeCh1?'开':'关'}} / {{scopeAlias(2)}} {{settingsDraft.scopeCh2?'开':'关'}}</b></div><div class="result-row"><span>触发</span><b>{{settingsDraft.scopeTriggerSource}} / {{settingsDraft.scopeTriggerSlope==='RISING'?'上升沿':'下降沿'}} / {{settingsDraft.scopeTriggerLevel}} V</b></div><div class="result-row"><span>采集模式</span><b>{{settingsDraft.scopeAcquisition==='SAMPLE'?'采样':settingsDraft.scopeAcquisition==='AVERAGE'?'平均':'峰值检测'}}</b></div><div class="result-row"><span>平均次数</span><b>{{settingsDraft.scopeAverage}} 次</b></div></div><div class="result-section"><h4>接口状态</h4><div class="result-row"><span>当前数据源</span><b>{{dataPlaneText()}}</b></div><div class="result-row"><span>目标设备</span><b>{{interfaceFor('scope')?.deviceName}}</b></div><div class="result-row"><span>通信接口</span><b>{{interfaceFor('scope')?.interfaceName}}</b></div><div class="result-row"><span>接口地址</span><b>{{interfaceFor('scope')?.endpoint}}</b></div><div class="result-row"><span>配置状态</span><b>{{interfaceStateText(interfaceFor('scope')?.state)}}</b></div><div class="result-row"><span>设备身份</span><b>{{interfaceFor('scope')?.identity||'—'}}</b></div><div class="result-row"><span>最后真实样本</span><b>{{interfaceSampleTime('scope')}}</b></div><div class="result-row"><span>连续失败</span><b>{{interfaceFor('scope')?.failureCount??0}}</b></div><p>{{interfaceFor('scope')?.message}}</p></div></div></div></aside>
          <div class="scope-plots"><PlotCanvas class="scope-fft-plot" :series="snapshot.scope.fft" :x-min="0" :x-max="settingsDraft.scopeFftMax*1000" :y-min="activePage==='scope'?scopeFftYMin:undefined" :y-max="activePage==='scope'?scopeFftYMax:undefined" x-label="频率 (kHz)" y-label="FFT 幅值 (a.u.)" :show-axis-labels="activePage==='scope'" :editable-axes="activePage==='scope'" :tight="true" :stacked="true" @axis-limit-change="onScopeFftAxisLimit" /><PlotCanvas class="scope-time-plot" :series="activePage==='scope'?scopeTimeSeries:snapshot.scope.time" :x-min="0" :x-max="settingsDraft.scopeTimeSpan" :y-min="activePage==='scope'?scopeCh1YMin:-1" :y-max="activePage==='scope'?scopeCh1YMax:1" :right-y-min="activePage==='scope'?scopeCh2YMin:undefined" :right-y-max="activePage==='scope'?scopeCh2YMax:undefined" x-label="时间 (ms)" :y-label="activePage==='scope'?scopeAlias(1)+' (V)':'电压 (V)'" :right-y-label="activePage==='scope'?scopeAlias(2)+' (V)':''" :show-axis-labels="activePage==='scope'" :editable-axes="activePage==='scope'" :tight="true" :stacked="true" @axis-limit-change="onScopeTimeAxisLimit" /></div>
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