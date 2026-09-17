<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
const props = defineProps<{ widthX:number; widthY:number; attenuation:number }>()
const canvas=ref<HTMLCanvasElement|null>(null)
let observer:ResizeObserver|null=null

function lut(t:number):[number,number,number]{
  t=Math.max(0,Math.min(1,t))
  if(t<.2){const u=t/.2;return [0,0,Math.round(90+165*u)]}
  if(t<.4){const u=(t-.2)/.2;return [0,Math.round(220*u),255]}
  if(t<.6){const u=(t-.4)/.2;return [Math.round(70*u),255,Math.round(255*(1-u))]}
  if(t<.8){const u=(t-.6)/.2;return [Math.round(70+185*u),255,0]}
  const u=(t-.8)/.2;return [255,Math.round(255*(1-u)),0]
}
function draw(){
  const el=canvas.value;if(!el)return;const r=el.getBoundingClientRect();const w=Math.max(1,Math.round(r.width)),h=Math.max(1,Math.round(r.height));if(el.width!==w||el.height!==h){el.width=w;el.height=h}
  const ctx=el.getContext('2d');if(!ctx)return;ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#02081c';ctx.fillRect(0,0,w,h)
  const image=ctx.createImageData(Math.max(1,Math.floor(w)),Math.max(1,Math.floor(h)));const cx=w*.50,cy=h*.50;const sx=Math.max(20,w*.16*(props.widthX/130)),sy=Math.max(20,h*.18*(props.widthY/130));const gain=Math.pow(10,-props.attenuation/55)
  for(let y=0;y<image.height;y++){for(let x=0;x<image.width;x++){const dx=(x-cx)/sx,dy=(y-cy)/sy;let v=Math.exp(-2*(dx*dx+dy*dy))*Math.max(.25,gain*2.0);v=Math.min(1,v);const [rr,gg,bb]=lut(Math.pow(v,.55));const p=(y*image.width+x)*4;image.data[p]=rr;image.data[p+1]=gg;image.data[p+2]=bb;image.data[p+3]=255}}
  ctx.putImageData(image,0,0)
  ctx.strokeStyle='rgba(255,255,255,.55)';ctx.lineWidth=1;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(cx,0);ctx.lineTo(cx,h);ctx.moveTo(0,cy);ctx.lineTo(w,cy);ctx.stroke();ctx.setLineDash([])
  const barX=w-30,barY=28,barH=Math.max(80,h-56),barW=10;for(let i=0;i<barH;i++){const [rr,gg,bb]=lut(1-i/barH);ctx.fillStyle=`rgb(${rr},${gg},${bb})`;ctx.fillRect(barX,barY+i,barW,1)}ctx.strokeStyle='rgba(255,255,255,.8)';ctx.strokeRect(barX-.5,barY-.5,barW+1,barH+1);ctx.fillStyle='#fff';ctx.font='10px Segoe UI';ctx.fillText('1.0',barX+13,barY+7);ctx.fillText('0.0',barX+13,barY+barH)
  const scale=Math.min(90,w*.28);ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(18,h-26);ctx.lineTo(18+scale,h-26);ctx.stroke();ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(18,h-32);ctx.lineTo(18,h-20);ctx.moveTo(18+scale,h-32);ctx.lineTo(18+scale,h-20);ctx.stroke();ctx.fillStyle='#fff';ctx.font='12px Segoe UI';ctx.fillText('200 μm',18,h-39)
}
watch(()=>[props.widthX,props.widthY,props.attenuation],draw)
onMounted(()=>{observer=new ResizeObserver(draw);if(canvas.value)observer.observe(canvas.value);draw()})
onBeforeUnmount(()=>observer?.disconnect())
</script>
<template><canvas ref="canvas" class="beam-canvas"></canvas></template>
