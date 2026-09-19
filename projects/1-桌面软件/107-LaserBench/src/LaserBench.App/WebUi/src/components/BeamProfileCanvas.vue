<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ widthX:number; widthY:number; attenuation:number }>()
const canvas=ref<HTMLCanvasElement|null>(null)
const zoom=ref(1)
const panX=ref(0)
const panY=ref(0)
const dragging=ref(false)
let observer:ResizeObserver|null=null
let dragStart:{x:number;y:number;panX:number;panY:number}|null=null

function lut(t:number):[number,number,number]{
  t=Math.max(0,Math.min(1,t))
  if(t<.2){const u=t/.2;return [0,0,Math.round(90+165*u)]}
  if(t<.4){const u=(t-.2)/.2;return [0,Math.round(220*u),255]}
  if(t<.6){const u=(t-.4)/.2;return [Math.round(70*u),255,Math.round(255*(1-u))]}
  if(t<.8){const u=(t-.6)/.2;return [Math.round(70+185*u),255,0]}
  const u=(t-.8)/.2;return [255,Math.round(255*(1-u)),0]
}

function draw(){
  const el=canvas.value
  if(!el)return
  const r=el.getBoundingClientRect()
  const w=Math.max(1,Math.round(r.width)),h=Math.max(1,Math.round(r.height))
  if(el.width!==w||el.height!==h){el.width=w;el.height=h}
  const ctx=el.getContext('2d')
  if(!ctx)return
  ctx.setTransform(1,0,0,1,0,0)
  ctx.fillStyle='#02081c'
  ctx.fillRect(0,0,w,h)

  const cx=w*.5+panX.value
  const cy=h*.5+panY.value
  const sx=Math.max(20,w*.16*(props.widthX/130))*zoom.value
  const sy=Math.max(20,h*.18*(props.widthY/130))*zoom.value
  const gain=Math.pow(10,-props.attenuation/55)
  const image=ctx.createImageData(w,h)
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const dx=(x-cx)/sx,dy=(y-cy)/sy
      let v=Math.exp(-2*(dx*dx+dy*dy))*Math.max(.25,gain*2.0)
      v=Math.min(1,v)
      const [rr,gg,bb]=lut(Math.pow(v,.55))
      const p=(y*w+x)*4
      image.data[p]=rr;image.data[p+1]=gg;image.data[p+2]=bb;image.data[p+3]=255
    }
  }
  ctx.putImageData(image,0,0)

  ctx.strokeStyle='rgba(255,255,255,.42)'
  ctx.lineWidth=1
  ctx.setLineDash([5,4])
  ctx.beginPath()
  ctx.moveTo(cx,0);ctx.lineTo(cx,h)
  ctx.moveTo(0,cy);ctx.lineTo(w,cy)
  ctx.stroke()
  ctx.setLineDash([])
}

function onWheel(e:WheelEvent){
  const el=canvas.value
  if(!el)return
  const rect=el.getBoundingClientRect()
  const mx=e.clientX-rect.left,my=e.clientY-rect.top
  const oldZoom=zoom.value
  const next=Math.max(.35,Math.min(6,oldZoom*Math.exp(-e.deltaY*.0014)))
  if(Math.abs(next-oldZoom)<1e-6)return
  const oldCx=rect.width*.5+panX.value
  const oldCy=rect.height*.5+panY.value
  const ratio=next/oldZoom
  panX.value=(mx-(mx-oldCx)*ratio)-rect.width*.5
  panY.value=(my-(my-oldCy)*ratio)-rect.height*.5
  zoom.value=next
  draw()
}
function onPointerDown(e:PointerEvent){
  if(e.button!==0)return
  const el=canvas.value
  if(!el)return
  el.setPointerCapture(e.pointerId)
  dragging.value=true
  dragStart={x:e.clientX,y:e.clientY,panX:panX.value,panY:panY.value}
}
function onPointerMove(e:PointerEvent){
  if(!dragStart)return
  panX.value=dragStart.panX+e.clientX-dragStart.x
  panY.value=dragStart.panY+e.clientY-dragStart.y
  draw()
}
function stopDrag(e?:PointerEvent){
  if(e&&canvas.value?.hasPointerCapture(e.pointerId)) canvas.value.releasePointerCapture(e.pointerId)
  dragging.value=false
  dragStart=null
}
function resetView(){
  zoom.value=1
  panX.value=0
  panY.value=0
  draw()
}

watch(()=>[props.widthX,props.widthY,props.attenuation],draw)
onMounted(()=>{observer=new ResizeObserver(draw);if(canvas.value)observer.observe(canvas.value);draw()})
onBeforeUnmount(()=>observer?.disconnect())
</script>

<template>
  <canvas
    ref="canvas"
    class="beam-canvas beam-interactive"
    :class="{dragging}"
    title="滚轮缩放；按住左键拖动；双击复位"
    @wheel.prevent="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="stopDrag"
    @pointercancel="stopDrag"
    @dblclick="resetView"
  ></canvas>
</template>
