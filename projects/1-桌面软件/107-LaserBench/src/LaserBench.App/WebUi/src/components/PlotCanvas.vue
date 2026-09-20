<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PlotSeries } from '../types'

type AxisName = 'x'|'y'|'right'
type AxisEnd = 'min'|'max'
const emit = defineEmits<{
  (e:'axis-limit-change', payload:{axis:AxisName;end:AxisEnd;value:number}):void
  (e:'axis-unit-change', value:string):void
}>()

const props = withDefaults(defineProps<{
  series: PlotSeries[]
  xMin?: number
  xMax?: number
  yMin?: number
  yMax?: number
  rightYMin?: number
  rightYMax?: number
  xLabel?: string
  yLabel?: string
  rightYLabel?: string
  timeAxis?: boolean
  timeOriginMs?: number
  timeValidMax?: number
  compact?: boolean
  tight?: boolean
  stacked?: boolean
  showAxisLabels?: boolean
  xPadding?: number
  verticalMarker?: number | null
  editableAxes?: boolean
  yUnitOptions?: string[]
  yUnit?: string
}>(), {
  xLabel: '', yLabel: '', rightYLabel: '', timeAxis: false, timeOriginMs: undefined, timeValidMax: undefined,
  compact: false, tight: false, stacked: false, showAxisLabels: false, xPadding: 0, verticalMarker: null, editableAxes: false,
  yUnitOptions: () => [], yUnit: ''
})

const shell = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const editor = ref<HTMLInputElement | null>(null)
const axisHint = ref<AxisName|null>(null)
const edit = ref<{axis:AxisName;end:AxisEnd;left:number;top:number;value:string}|null>(null)
let observer: ResizeObserver | null = null
let axisShowTimer:number|undefined
let axisHideTimer:number|undefined
let pendingAxis:AxisName|null=null

function margins(){
  if(props.compact)return {l:0,r:0,t:0,b:0}
  if(props.showAxisLabels)return props.stacked
    ? {l:68,r:52,t:7,b:43}
    : {l:68,r:52,t:7,b:45}
  return props.stacked
    ? {l:36,r:36,t:4,b:18}
    : {l:36,r:36,t:4,b:21}
}

const bounds = computed(() => {
  const all = props.series.flatMap(s => s.points)
  const left = props.series.filter(s => s.axis !== 'right').flatMap(s => s.points)
  const right = props.series.filter(s => s.axis === 'right').flatMap(s => s.points)
  const xs = all.map(p => p.x), ys = left.map(p => p.y), rys = right.map(p => p.y)
  const pad = (min:number,max:number,ratio=.06) => {
    const span = Math.max(1e-9, max-min)
    return [min-span*ratio,max+span*ratio] as const
  }
  const rawX0 = xs.length ? Math.min(...xs) : 0
  const rawX1 = xs.length ? Math.max(...xs) : 1
  const xSpan = Math.max(1e-9, rawX1-rawX0)
  const xPad = Math.max(0, props.xPadding) * xSpan
  const x0 = props.xMin ?? (rawX0-xPad), x1 = props.xMax ?? (rawX1+xPad)
  const [ya,yb] = ys.length ? pad(Math.min(...ys),Math.max(...ys)) : [0,1]
  const [ra,rb] = rys.length ? pad(Math.min(...rys),Math.max(...rys)) : [0,1]
  return { x0, x1, y0: props.yMin ?? ya, y1: props.yMax ?? yb, r0: props.rightYMin ?? ra, r1: props.rightYMax ?? rb }
})

function fmt(v:number, span:number) {
  if (Math.abs(span) >= 100) return v.toFixed(0)
  if (Math.abs(span) >= 10) return v.toFixed(1)
  if (Math.abs(span) >= 1) return v.toFixed(2).replace(/\.00$/,'')
  if (Math.abs(span) >= .1) return v.toFixed(2)
  if (Math.abs(span) >= .01) return v.toFixed(3)
  return v.toFixed(4)
}
function uniformTicks(min:number,max:number,count:number){
  if(count<=1)return [(min+max)/2]
  return Array.from({length:count},(_,i)=>min+(max-min)*i/(count-1))
}
function niceTimeStep(span:number){
  const target=Math.max(10,span/5)
  const choices=[10,20,30,60,120,300,600,900,1800,3600,7200,10800,21600,43200,86400,172800,432000,864000]
  const picked=choices.find(v=>v>=target)
  if(picked)return picked
  return Math.ceil(target/864000)*864000
}
function timeTicks(min:number,max:number){
  const span=Math.max(0,max-min)
  if(span<10)return {values:[(min+max)/2],step:span}
  const step=niceTimeStep(span)
  const first=Math.ceil(min/step)*step
  const values:number[]=[]
  for(let v=first;v<=max+step*1e-6;v+=step)values.push(v)
  if(values.length===0)values.push((min+max)/2)
  return {values,step}
}
function formatTime(value:number,step:number){
  const base=props.timeOriginMs ?? Date.now()
  const d=new Date(base+value*1000)
  const two=(n:number)=>String(n).padStart(2,'0')
  if(step<60)return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

function draw() {
  const el = canvas.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  const width = Math.max(1, Math.round(rect.width*dpr)), height = Math.max(1, Math.round(rect.height*dpr))
  if (el.width !== width || el.height !== height) { el.width = width; el.height = height }
  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr,0,0,dpr,0,0)
  const w = rect.width, h = rect.height
  ctx.clearRect(0,0,w,h)
  ctx.fillStyle = props.showAxisLabels ? '#314251' : '#3b4d5b'
  ctx.fillRect(0,0,w,h)

  const hasRight = props.series.some(s => s.axis === 'right')
  const m = margins()
  const pw = Math.max(10,w-m.l-m.r), ph = Math.max(10,h-m.t-m.b)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(m.l,m.t,pw,ph)
  const {x0,x1,y0,y1,r0,r1} = bounds.value
  const sx = (x:number) => m.l + (x-x0)/(x1-x0||1)*pw
  const sy = (y:number, axis:'left'|'right'='left') => {
    const a=axis==='right'?r0:y0, b=axis==='right'?r1:y1
    return m.t + (b-y)/(b-a||1)*ph
  }

  const xTickInfo=props.timeAxis?timeTicks(x0,x1):{values:uniformTicks(x0,x1,6),step:(x1-x0)/5}
  const visibleX=xTickInfo.values.filter(v=>props.timeValidMax===undefined||v<=props.timeValidMax+1e-6)
  const yTicks=uniformTicks(y0,y1,5)
  const rightTicks=uniformTicks(r0,r1,5)

  if (!props.compact) {
    ctx.save(); ctx.strokeStyle = '#d9e7f1'; ctx.lineWidth = 1; ctx.setLineDash([4,4])
    for(const v of visibleX){
      const x=sx(v)
      if(x>m.l+.5&&x<m.l+pw-.5){ctx.beginPath();ctx.moveTo(x,m.t);ctx.lineTo(x,m.t+ph);ctx.stroke()}
    }
    for(const v of yTicks){
      const y=sy(v)
      if(y>m.t+.5&&y<m.t+ph-.5){ctx.beginPath();ctx.moveTo(m.l,y);ctx.lineTo(m.l+pw,y);ctx.stroke()}
    }
    ctx.restore()
  }

  ctx.save(); ctx.beginPath(); ctx.rect(m.l,m.t,pw,ph); ctx.clip()
  for (const s of props.series) {
    if (s.points.length < 2) continue
    ctx.strokeStyle=s.color; ctx.lineWidth=props.compact?1.2:(props.showAxisLabels?2.0:1.7); ctx.lineJoin='round'; ctx.lineCap='round'; ctx.beginPath()
    s.points.forEach((p,i)=>{ const x=sx(p.x), y=sy(p.y,s.axis==='right'?'right':'left'); if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y) })
    ctx.stroke()
    if (s.markers && !props.compact) {
      ctx.fillStyle='#fff'; ctx.lineWidth=1.4
      for (let i=0;i<s.points.length;i+=Math.max(1,Math.floor(s.points.length/24))) {
        const p=s.points[i], x=sx(p.x), y=sy(p.y,s.axis==='right'?'right':'left')
        ctx.beginPath();ctx.arc(x,y,props.showAxisLabels?3.2:2.7,0,Math.PI*2);ctx.fill();ctx.strokeStyle=s.color;ctx.stroke()
      }
    }
  }
  if (props.verticalMarker != null && props.verticalMarker >= x0 && props.verticalMarker <= x1) {
    const x=sx(props.verticalMarker); ctx.strokeStyle='#5d7d99';ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x,m.t);ctx.lineTo(x,m.t+ph);ctx.stroke()
  }
  ctx.restore()
  if (props.compact) return

  ctx.font=(props.showAxisLabels?'13.5px':'11.5px')+' "Segoe UI","Microsoft YaHei UI",sans-serif'
  ctx.fillStyle=props.showAxisLabels?'#c8d5de':'#9fb2c0'
  ctx.textBaseline='middle'
  yTicks.forEach((v,i)=>{
    const y=sy(v), text=fmt(v,y1-y0)
    ctx.textBaseline=i===0?'bottom':i===yTicks.length-1?'top':'middle'
    ctx.textAlign='right';ctx.fillText(text,m.l-5,y)
    if(hasRight){ctx.textAlign='left';ctx.fillText(fmt(rightTicks[i],r1-r0),m.l+pw+5,y)}
  })

  ctx.textBaseline='top'
  visibleX.forEach((v,i)=>{
    const x=sx(v)
    const text=props.timeAxis?formatTime(v,xTickInfo.step):fmt(v,x1-x0)
    const first=i===0,last=i===visibleX.length-1
    ctx.textAlign=first?'left':last?'right':'center'
    ctx.fillText(text,x,m.t+ph+4)
  })

  if(props.series.length){
    if(props.showAxisLabels){
      let lx=m.l+13, ly=m.t+ph-17
      ctx.font='600 13px "Segoe UI","Microsoft YaHei UI",sans-serif';ctx.textBaseline='middle'
      for(const s of props.series){
        const tw=ctx.measureText(s.name).width
        ctx.strokeStyle=s.color;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(lx,ly);ctx.lineTo(lx+23,ly);ctx.stroke()
        ctx.fillStyle='#2b4358';ctx.textAlign='left';ctx.fillText(s.name,lx+29,ly)
        lx+=tw+62
      }
    }else{
      let lx=m.l+pw-8, ly=m.t+12;ctx.font='10.5px "Segoe UI", sans-serif';ctx.textBaseline='middle'
      for(let i=props.series.length-1;i>=0;i--){const s=props.series[i];const tw=ctx.measureText(s.name).width;lx-=tw+30;ctx.strokeStyle=s.color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(lx,ly);ctx.lineTo(lx+16,ly);ctx.stroke();ctx.fillStyle='#35516c';ctx.textAlign='left';ctx.fillText(s.name,lx+20,ly)}
    }
  }

  if(props.showAxisLabels){
    ctx.save()
    ctx.fillStyle='#dce6ed'
    ctx.font='700 15px "Segoe UI","Microsoft YaHei UI",sans-serif'
    ctx.textAlign='center';ctx.textBaseline='middle'
    if(props.xLabel)ctx.fillText(props.xLabel,m.l+pw/2,h-10)
    if(props.yLabel){ctx.translate(13,m.t+ph/2);ctx.rotate(-Math.PI/2);ctx.fillText(props.yLabel,0,0)}
    if(hasRight&&props.rightYLabel){ctx.setTransform(dpr,0,0,dpr,0,0);ctx.translate(w-13,m.t+ph/2);ctx.rotate(Math.PI/2);ctx.fillText(props.rightYLabel,0,0)}
    ctx.restore()
  }

  const hint=props.showAxisLabels?null:axisHint.value
  const hintText=hint==='x'?props.xLabel:hint==='y'?props.yLabel:hint==='right'?props.rightYLabel:''
  if(hintText){
    const drawHint=(text:string,x:number,y:number,angle=0)=>{
      ctx.save();ctx.translate(x,y);ctx.rotate(angle)
      ctx.font='600 13px "Segoe UI","Microsoft YaHei UI",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle'
      const tw=ctx.measureText(text).width
      ctx.fillStyle='rgba(25,43,56,.88)';ctx.fillRect(-tw/2-7,-10,tw+14,20)
      ctx.fillStyle='#f3f7fa';ctx.fillText(text,0,0);ctx.restore()
    }
    if(hint==='x') drawHint(hintText,m.l+pw/2,Math.min(h-10,m.t+ph+Math.max(10,m.b/2)))
    else if(hint==='y') drawHint(hintText,11,m.t+ph/2,-Math.PI/2)
    else if(hint==='right') drawHint(hintText,w-11,m.t+ph/2,Math.PI/2)
  }
}

function scheduleAxisHint(next:AxisName|null){
  if(props.showAxisLabels){axisHint.value=null;return}
  if(axisHideTimer!==undefined){window.clearTimeout(axisHideTimer);axisHideTimer=undefined}
  if(next===null){
    pendingAxis=null
    if(axisShowTimer!==undefined){window.clearTimeout(axisShowTimer);axisShowTimer=undefined}
    if(axisHint.value!==null && axisHideTimer===undefined){
      axisHideTimer=window.setTimeout(()=>{axisHint.value=null;axisHideTimer=undefined;draw()},460)
    }
    return
  }
  if(axisHint.value===next||pendingAxis===next)return
  pendingAxis=next
  if(axisShowTimer!==undefined)window.clearTimeout(axisShowTimer)
  axisShowTimer=window.setTimeout(()=>{axisShowTimer=undefined;if(pendingAxis===next){axisHint.value=next;draw()}},300)
}
function onPointerMove(e:PointerEvent){
  if(props.compact){scheduleAxisHint(null);return}
  const el=canvas.value
  if(!el)return
  const rect=el.getBoundingClientRect(), x=e.clientX-rect.left, y=e.clientY-rect.top
  const m=margins(),pw=Math.max(10,rect.width-m.l-m.r),ph=Math.max(10,rect.height-m.t-m.b),cx=m.l+pw/2,cy=m.t+ph/2
  let next:AxisName|null=null
  const nearX=y>=m.t+ph-3 && y<=rect.height && Math.abs(x-cx)<=pw*.30
  const nearY=x>=0 && x<=m.l+5 && Math.abs(y-cy)<=ph*.30
  const hasRight=props.series.some(s=>s.axis==='right')
  const nearRight=hasRight && x>=m.l+pw-4 && x<=rect.width && Math.abs(y-cy)<=ph*.30
  if(nearY && props.yLabel)next='y'
  else if(nearRight && props.rightYLabel)next='right'
  else if(nearX && props.xLabel)next='x'
  scheduleAxisHint(next)
}
function onPointerLeave(){scheduleAxisHint(null)}

function beginAxisEdit(e:MouseEvent){
  if(!props.editableAxes||props.compact)return
  const el=canvas.value
  if(!el)return
  const rect=el.getBoundingClientRect(), x=e.clientX-rect.left, y=e.clientY-rect.top
  const m=margins(),pw=Math.max(10,rect.width-m.l-m.r),ph=Math.max(10,rect.height-m.t-m.b)
  const b=bounds.value
  const candidates=[
    {axis:'x' as AxisName,end:'min' as AxisEnd,left:m.l,top:m.t+ph+5,value:b.x0},
    {axis:'x' as AxisName,end:'max' as AxisEnd,left:m.l+pw,top:m.t+ph+5,value:b.x1},
    {axis:'y' as AxisName,end:'max' as AxisEnd,left:m.l-6,top:m.t,value:b.y1},
    {axis:'y' as AxisName,end:'min' as AxisEnd,left:m.l-6,top:m.t+ph,value:b.y0}
  ]
  if(props.series.some(s=>s.axis==='right')){
    candidates.push(
      {axis:'right',end:'max',left:m.l+pw+6,top:m.t,value:b.r1},
      {axis:'right',end:'min',left:m.l+pw+6,top:m.t+ph,value:b.r0}
    )
  }
  const hit=candidates.map(c=>({...c,d:Math.hypot(x-c.left,y-c.top)})).sort((a,b)=>a.d-b.d)[0]
  if(!hit||hit.d>34)return
  const maxLeft=Math.max(4,rect.width-92),maxTop=Math.max(4,rect.height-31)
  edit.value={axis:hit.axis,end:hit.end,left:Math.min(maxLeft,Math.max(4,hit.left-(hit.axis==='y'?72:20))),top:Math.min(maxTop,Math.max(4,hit.top-12)),value:String(Number(hit.value.toPrecision(8)))}
  nextTick(()=>{editor.value?.focus();editor.value?.select()})
}
function commitEdit(){
  if(!edit.value)return
  const value=Number(edit.value.value)
  if(Number.isFinite(value))emit('axis-limit-change',{axis:edit.value.axis,end:edit.value.end,value})
  edit.value=null
}
function cancelEdit(){edit.value=null}
function onUnitSelect(e:Event){
  const target=e.target as HTMLSelectElement|null
  if(target)emit('axis-unit-change',target.value)
}

watch(()=>[props.series,props.xMin,props.xMax,props.yMin,props.yMax,props.rightYMin,props.rightYMax,props.xLabel,props.yLabel,props.rightYLabel,props.timeOriginMs,props.timeValidMax,props.showAxisLabels,props.xPadding,props.verticalMarker],draw,{deep:true})
onMounted(()=>{observer=new ResizeObserver(draw);if(shell.value)observer.observe(shell.value);draw()})
onBeforeUnmount(()=>{
  observer?.disconnect()
  if(axisShowTimer!==undefined)window.clearTimeout(axisShowTimer)
  if(axisHideTimer!==undefined)window.clearTimeout(axisHideTimer)
})
</script>

<template>
  <div ref="shell" class="plot-shell">
    <canvas ref="canvas" class="plot-canvas" :class="{editable:editableAxes}" :title="editableAxes?'点击坐标轴端点数字可直接修改范围':''" @pointermove="onPointerMove" @pointerleave="onPointerLeave" @click="beginAxisEdit"></canvas>
    <select v-if="showAxisLabels && yUnitOptions.length" class="axis-unit-select" :value="yUnit" title="切换纵轴显示单位" @change="onUnitSelect">
      <option v-for="unit in yUnitOptions" :key="unit" :value="unit">{{unit}}</option>
    </select>
    <input v-if="edit" ref="editor" class="axis-inline-editor" :style="{left:edit.left+'px',top:edit.top+'px'}" v-model="edit.value" @keydown.enter.prevent="commitEdit" @keydown.esc.prevent="cancelEdit" @blur="commitEdit" />
  </div>
</template>

<style scoped>
.plot-shell{position:relative;display:block;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden}
.plot-canvas{display:block;width:100%;height:100%}
.plot-canvas.editable{cursor:default}
.axis-unit-select{
  position:absolute;z-index:7;left:26px;top:50%;width:58px;height:21px;
  transform:translate(-50%,-50%) rotate(-90deg);transform-origin:center;
  border:0;border-radius:3px;background:rgba(37,57,70,.88);color:#dce6ed;
  font:650 10px "Segoe UI","Microsoft YaHei UI",sans-serif;text-align:center;
  padding:0 3px;outline:none;cursor:pointer
}
.axis-unit-select:hover,.axis-unit-select:focus{background:#315064;color:#fff}
.axis-inline-editor{position:absolute;z-index:8;width:84px;height:26px;padding:2px 6px;border:1px solid #4d7895;border-radius:3px;background:#20333f;color:#f3f7fa;font:600 12px "Segoe UI","Microsoft YaHei UI",sans-serif;box-shadow:0 3px 12px rgba(0,0,0,.24);outline:none;font-variant-numeric:tabular-nums}
.axis-inline-editor:focus{border-color:#6fc1ef;box-shadow:0 0 0 2px rgba(80,176,232,.16),0 3px 12px rgba(0,0,0,.24)}
</style>