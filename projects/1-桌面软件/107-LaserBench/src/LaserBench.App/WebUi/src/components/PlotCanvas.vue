<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PlotSeries } from '../types'

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
  xPadding?: number
  verticalMarker?: number | null
}>(), {
  xLabel: '', yLabel: '', rightYLabel: '', timeAxis: false, timeOriginMs: undefined, timeValidMax: undefined, compact: false, tight: false, stacked: false, xPadding: 0, verticalMarker: null
})

const canvas = ref<HTMLCanvasElement | null>(null)
const axisHint = ref<'x'|'y'|'right'|null>(null)
let observer: ResizeObserver | null = null
let axisShowTimer:number|undefined
let axisHideTimer:number|undefined
let pendingAxis:'x'|'y'|'right'|null=null

function margins(){
  return props.compact
    ? {l:0,r:0,t:0,b:0}
    : props.stacked
      ? {l:38,r:38,t:3,b:18}
      : {l:38,r:38,t:8,b:21}
}

const bounds = computed(() => {
  const all = props.series.flatMap(s => s.points)
  const left = props.series.filter(s => s.axis !== 'right').flatMap(s => s.points)
  const right = props.series.filter(s => s.axis === 'right').flatMap(s => s.points)
  const xs = all.map(p => p.x)
  const ys = left.map(p => p.y)
  const rys = right.map(p => p.y)
  const pad = (min:number,max:number,ratio=.06) => {
    const span = Math.max(1e-9, max-min)
    return [min-span*ratio,max+span*ratio] as const
  }
  const rawX0 = xs.length ? Math.min(...xs) : 0
  const rawX1 = xs.length ? Math.max(...xs) : 1
  const xSpan = Math.max(1e-9, rawX1-rawX0)
  const xPad = Math.max(0, props.xPadding) * xSpan
  const x0 = props.xMin ?? (rawX0-xPad)
  const x1 = props.xMax ?? (rawX1+xPad)
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

function draw() {
  const el = canvas.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  const width = Math.max(1, Math.round(rect.width*dpr))
  const height = Math.max(1, Math.round(rect.height*dpr))
  if (el.width !== width || el.height !== height) { el.width = width; el.height = height }
  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr,0,0,dpr,0,0)
  const w = rect.width, h = rect.height
  ctx.clearRect(0,0,w,h)
  ctx.fillStyle = '#3b4d5b'
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

  if (!props.compact) {
    ctx.save(); ctx.strokeStyle = '#d9e7f1'; ctx.lineWidth = 1; ctx.setLineDash([4,4])
    for (let i=1;i<6;i++) { const x=m.l+pw*i/6; ctx.beginPath();ctx.moveTo(x,m.t);ctx.lineTo(x,m.t+ph);ctx.stroke() }
    for (let i=1;i<5;i++) { const y=m.t+ph*i/5; ctx.beginPath();ctx.moveTo(m.l,y);ctx.lineTo(m.l+pw,y);ctx.stroke() }
    ctx.restore()
  }

  ctx.save(); ctx.beginPath(); ctx.rect(m.l,m.t,pw,ph); ctx.clip()
  for (const s of props.series) {
    if (s.points.length < 2) continue
    ctx.strokeStyle=s.color; ctx.lineWidth=props.compact?1.2:1.8; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.beginPath()
    s.points.forEach((p,i)=>{ const x=sx(p.x), y=sy(p.y,s.axis==='right'?'right':'left'); if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y) })
    ctx.stroke()
    if (s.markers && !props.compact) {
      ctx.fillStyle='#fff'; ctx.lineWidth=1.5
      for (let i=0;i<s.points.length;i+=Math.max(1,Math.floor(s.points.length/24))) {
        const p=s.points[i], x=sx(p.x), y=sy(p.y,s.axis==='right'?'right':'left')
        ctx.beginPath();ctx.arc(x,y,2.8,0,Math.PI*2);ctx.fill();ctx.strokeStyle=s.color;ctx.stroke()
      }
    }
  }
  if (props.verticalMarker != null && props.verticalMarker >= x0 && props.verticalMarker <= x1) {
    const x=sx(props.verticalMarker); ctx.strokeStyle='#5d7d99';ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x,m.t);ctx.lineTo(x,m.t+ph);ctx.stroke()
  }
  ctx.restore()
  if (props.compact) return

  ctx.font='11.5px "Segoe UI", sans-serif';ctx.fillStyle='#9fb2c0';ctx.textBaseline='middle'
  for(let i=0;i<4;i++) {
    const t=i/3, y=m.t+ph*t, v=y1-(y1-y0)*t, text=fmt(v,y1-y0)
    ctx.textAlign='right';ctx.fillText(text,m.l-4,y)
    if(hasRight){const rv=r1-(r1-r0)*t;ctx.textAlign='left';ctx.fillText(fmt(rv,r1-r0),m.l+pw+4,y)}
  }
  ctx.textBaseline='top'
  for(let i=0;i<6;i++) {
    const t=i/5, x=m.l+pw*t, v=x0+(x1-x0)*t
    let text:string
    if(props.timeAxis){
      if(props.timeValidMax!==undefined && v>props.timeValidMax+1e-6) text=''
      else {
        const base=props.timeOriginMs ?? Date.now()
        const d=new Date(base+v*1000)
        text=d.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})
      }
    } else text=fmt(v,x1-x0)
    ctx.textAlign=i===0?'left':i===5?'right':'center';ctx.fillText(text,x,m.t+ph+3)
  }
  if(props.series.length){
    let lx=m.l+pw-8, ly=m.t+12;ctx.font='10.5px "Segoe UI", sans-serif';ctx.textBaseline='middle'
    for(let i=props.series.length-1;i>=0;i--){const s=props.series[i];const tw=ctx.measureText(s.name).width;lx-=tw+30;ctx.strokeStyle=s.color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(lx,ly);ctx.lineTo(lx+16,ly);ctx.stroke();ctx.fillStyle='#35516c';ctx.textAlign='left';ctx.fillText(s.name,lx+20,ly)}
  }

  const hint=axisHint.value
  const hintText=hint==='x'?props.xLabel:hint==='y'?props.yLabel:hint==='right'?props.rightYLabel:''
  if(hintText){
    const drawHint=(text:string,x:number,y:number,angle=0)=>{
      ctx.save()
      ctx.translate(x,y);ctx.rotate(angle)
      ctx.font='600 12px "Segoe UI", sans-serif'
      ctx.textAlign='center';ctx.textBaseline='middle'
      const tw=ctx.measureText(text).width
      ctx.fillStyle='rgba(25,43,56,.88)'
      ctx.fillRect(-tw/2-7,-10,tw+14,20)
      ctx.fillStyle='#f3f7fa'
      ctx.fillText(text,0,0)
      ctx.restore()
    }
    if(hint==='x') drawHint(hintText,m.l+pw/2,Math.min(h-10,m.t+ph+Math.max(10,m.b/2)))
    else if(hint==='y') drawHint(hintText,11,m.t+ph/2,-Math.PI/2)
    else if(hint==='right') drawHint(hintText,w-11,m.t+ph/2,Math.PI/2)
  }
}

function scheduleAxisHint(next:'x'|'y'|'right'|null){
  if(axisHideTimer!==undefined){window.clearTimeout(axisHideTimer);axisHideTimer=undefined}
  if(next===null){
    pendingAxis=null
    if(axisShowTimer!==undefined){window.clearTimeout(axisShowTimer);axisShowTimer=undefined}
    if(axisHint.value!==null && axisHideTimer===undefined){
      axisHideTimer=window.setTimeout(()=>{axisHint.value=null;axisHideTimer=undefined;draw()},460)
    }
    return
  }
  if(axisHint.value===next)return
  if(pendingAxis===next)return
  pendingAxis=next
  if(axisShowTimer!==undefined)window.clearTimeout(axisShowTimer)
  axisShowTimer=window.setTimeout(()=>{
    axisShowTimer=undefined
    if(pendingAxis===next){axisHint.value=next;draw()}
  },300)
}
function onPointerMove(e:PointerEvent){
  if(props.compact){scheduleAxisHint(null);return}
  const el=canvas.value
  if(!el)return
  const rect=el.getBoundingClientRect()
  const x=e.clientX-rect.left,y=e.clientY-rect.top
  const m=margins(),pw=Math.max(10,rect.width-m.l-m.r),ph=Math.max(10,rect.height-m.t-m.b)
  const cx=m.l+pw/2,cy=m.t+ph/2
  let next:'x'|'y'|'right'|null=null
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

watch(()=>[props.series,props.xMin,props.xMax,props.yMin,props.yMax,props.rightYMin,props.rightYMax,props.xLabel,props.yLabel,props.rightYLabel,props.timeOriginMs,props.timeValidMax,props.xPadding,props.verticalMarker],draw,{deep:true})
onMounted(()=>{observer=new ResizeObserver(draw);if(canvas.value)observer.observe(canvas.value);draw()})
onBeforeUnmount(()=>{
  observer?.disconnect()
  if(axisShowTimer!==undefined)window.clearTimeout(axisShowTimer)
  if(axisHideTimer!==undefined)window.clearTimeout(axisHideTimer)
})
</script>

<template><canvas ref="canvas" class="plot-canvas" @pointermove="onPointerMove" @pointerleave="onPointerLeave"></canvas></template>
