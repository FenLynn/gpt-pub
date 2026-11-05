(function(){
"use strict";
const canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),status=document.getElementById("status"),scoreEl=document.getElementById("score");
const SIZE=24,CELL=20,PIXEL=SIZE*CELL;
let snake=[],food=null,dir={x:1,y:0},queue=[],score=0,paused=true,over=false,rafId=null,difficulty="normal",speed=125,lastFrame=0,accumulator=0;
function setStatus(message){status.textContent=message;GameBridge.report(message,{score});}
function configure(value){difficulty=value||"normal";speed=difficulty==="easy"?170:difficulty==="hard"?88:125;}
function placeFood(){const occupied=new Set(snake.map(p=>p.y*SIZE+p.x)),free=[];for(let i=0;i<SIZE*SIZE;i++)if(!occupied.has(i))free.push(i);if(!free.length)return null;const n=free[Math.floor(Math.random()*free.length)];return{x:n%SIZE,y:Math.floor(n/SIZE)};}
function draw(){
 ctx.clearRect(0,0,PIXEL,PIXEL);
 const bg=ctx.createLinearGradient(0,0,PIXEL,PIXEL);
 bg.addColorStop(0,"#102b35");bg.addColorStop(.52,"#183e48");bg.addColorStop(1,"#0c2935");
 ctx.fillStyle=bg;ctx.fillRect(0,0,PIXEL,PIXEL);
 ctx.strokeStyle="#b7d6da10";ctx.lineWidth=1;
 for(let i=1;i<SIZE;i++){
  ctx.beginPath();ctx.moveTo(i*CELL+.5,0);ctx.lineTo(i*CELL+.5,PIXEL);ctx.stroke();
  ctx.beginPath();ctx.moveTo(0,i*CELL+.5);ctx.lineTo(PIXEL,i*CELL+.5);ctx.stroke();
 }
 if(food){
  const fx=food.x*CELL+CELL/2,fy=food.y*CELL+CELL/2;
  const glow=ctx.createRadialGradient(fx,fy,2,fx,fy,CELL*.8);
  glow.addColorStop(0,"#ec755f55");glow.addColorStop(1,"#ec755f00");
  ctx.fillStyle=glow;ctx.fillRect(fx-CELL*.8,fy-CELL*.8,CELL*1.6,CELL*1.6);
  ctx.fillStyle="#dc594c";ctx.beginPath();ctx.arc(fx,fy+1,8,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#ffb392";ctx.beginPath();ctx.arc(fx-3,fy-3,3,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#77c87d";ctx.fillRect(fx,fy-11,5,4);
 }
 snake.forEach((part,index)=>{
  const x=part.x*CELL+1,y=part.y*CELL+1,head=index===0;
  const grad=ctx.createLinearGradient(x,y,x+CELL,y+CELL);
  if(head){grad.addColorStop(0,"#c3f5a5");grad.addColorStop(.48,"#75cc86");grad.addColorStop(1,"#329b7d");}
  else{grad.addColorStop(0,"#7ad4a4");grad.addColorStop(.5,"#4bb58b");grad.addColorStop(1,"#279378");}
  ctx.fillStyle=grad;ctx.beginPath();ctx.roundRect(x,y,CELL-2,CELL-2,head?7:5);ctx.fill();
  ctx.fillStyle="#ffffff3d";ctx.fillRect(x+4,y+4,CELL-12,3);
  ctx.fillStyle="#0c544b66";ctx.fillRect(x+5,y+CELL-7,CELL-12,2);
  if(head){
   const ex=dir.y===0?dir.x>0?14:5:11,ey=dir.x===0?dir.y>0?14:5:6;
   ctx.fillStyle="#173e3a";ctx.beginPath();ctx.arc(part.x*CELL+ex,part.y*CELL+ey,1.8,0,Math.PI*2);ctx.fill();
   ctx.beginPath();ctx.arc(part.x*CELL+ex,part.y*CELL+ey+5,1.8,0,Math.PI*2);ctx.fill();
  }
 });
 if(paused||over){
  ctx.fillStyle="#091e2bc0";ctx.fillRect(0,0,PIXEL,PIXEL);
  ctx.fillStyle="#e5f6e7";ctx.font="700 22px sans-serif";ctx.textAlign="center";
  ctx.fillText(over?"游戏结束":"已暂停",PIXEL/2,PIXEL/2);
 }
 canvas.dataset.headX=String(snake[0]?.x??"");
 canvas.dataset.headY=String(snake[0]?.y??"");
 canvas.dataset.score=String(score);canvas.dataset.paused=String(paused);
}
function stop(){if(rafId!==null)cancelAnimationFrame(rafId);rafId=null;lastFrame=0;accumulator=0;}
function finish(message,win=false){over=true;paused=true;stop();setStatus(message);GameBridge.send("GAME_OVER",{message,score,win});draw();}
function tick(){
 if(paused||over||!snake.length)return;
 if(queue.length)dir=queue.shift();
 const head={x:snake[0].x+dir.x,y:snake[0].y+dir.y},eating=!!food&&head.x===food.x&&head.y===food.y;
 const collisionBody=eating?snake:snake.slice(0,-1);
 if(head.x<0||head.x>=SIZE||head.y<0||head.y>=SIZE||collisionBody.some(p=>p.x===head.x&&p.y===head.y)){finish("游戏结束 · 撞到边界或身体");return;}
 snake.unshift(head);
 if(eating){score+=10;food=placeFood();scoreEl.textContent=String(score);if(!food){finish("恭喜，填满整个棋盘！",true);return;}}
 else snake.pop();
}
function frame(now){
 rafId=null;if(paused||over)return;
 if(!lastFrame)lastFrame=now;
 accumulator+=Math.min(80,Math.max(0,now-lastFrame));lastFrame=now;
 let steps=0;while(accumulator>=speed&&steps<4&&!over){tick();accumulator-=speed;steps++;}
 draw();if(!paused&&!over)rafId=requestAnimationFrame(frame);
}
function run(){if(paused||over||rafId!==null)return;lastFrame=0;rafId=requestAnimationFrame(frame);}
function queueDirection(next){
 const basis=queue.length?queue[queue.length-1]:dir;
 if(next.x===basis.x&&next.y===basis.y)return;
 if(next.x===-basis.x&&next.y===-basis.y)return;
 if(queue.length<2)queue.push(next);
}
function newGame(){
 stop();snake=[{x:11,y:12},{x:10,y:12},{x:9,y:12}];dir={x:1,y:0};queue=[];score=0;configure(difficulty);
 paused=false;over=false;food=placeFood();scoreEl.textContent="0";setStatus("游戏进行中");draw();canvas.focus();run();
}
function pause(){if(paused)return;paused=true;setStatus("已暂停");draw();}
function resume(){if(over)return;paused=false;setStatus("游戏进行中");canvas.focus();stop();run();draw();}
function keydown(event){
 const key=event.key.length===1?event.key.toLowerCase():event.key;
 const map={ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1},ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0},w:{x:0,y:-1},s:{x:0,y:1},a:{x:-1,y:0},d:{x:1,y:0}};
 const next=map[key];if(!next)return;event.preventDefault();if(paused||over)return;queueDirection(next);
}
function focusCanvas(){canvas.focus();}
window.addEventListener("keydown",keydown);canvas.addEventListener("pointerdown",focusCanvas);
GameBridge.register({init(p){configure(p.difficulty);newGame();},newGame,pause,resume,setDifficulty(value){configure(value);},dispose(){paused=true;stop();window.removeEventListener("keydown",keydown);canvas.removeEventListener("pointerdown",focusCanvas);}});
})();