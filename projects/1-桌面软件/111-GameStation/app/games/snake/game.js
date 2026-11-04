(function(){
"use strict";
const canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),status=document.getElementById("status"),scoreEl=document.getElementById("score"),SIZE=24,CELL=20;
let snake=[],food=null,dir={x:1,y:0},directionQueue=[],score=0,paused=true,over=false,timer=null,difficulty="normal",speed=115;
function setStatus(message){status.textContent=message;GameBridge.report(message,{score});}
function configure(value){difficulty=value||"normal";speed=difficulty==="easy"?165:difficulty==="hard"?78:115;}
function placeFood(){
 const free=[];
 for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++)if(!snake.some(part=>part.x===x&&part.y===y))free.push({x,y});
 return free.length?free[Math.floor(Math.random()*free.length)]:null;
}
function draw(){
 ctx.fillStyle="#152536";ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.strokeStyle="#ffffff0a";
 for(let i=0;i<=SIZE;i++){
  ctx.beginPath();ctx.moveTo(i*CELL,0);ctx.lineTo(i*CELL,canvas.height);ctx.stroke();
  ctx.beginPath();ctx.moveTo(0,i*CELL);ctx.lineTo(canvas.width,i*CELL);ctx.stroke();
 }
 if(food){ctx.fillStyle="#e4a46e";ctx.beginPath();ctx.arc(food.x*CELL+10,food.y*CELL+10,7,0,Math.PI*2);ctx.fill();}
 snake.forEach((part,index)=>{ctx.fillStyle=index?"#75b99a":"#9cdbc0";ctx.fillRect(part.x*CELL+1,part.y*CELL+1,CELL-2,CELL-2);});
 if(paused&&!over){ctx.fillStyle="#ffffffcc";ctx.font="600 18px sans-serif";ctx.textAlign="center";ctx.fillText("已暂停",240,245);}
 if(over){ctx.fillStyle="#ffffffdd";ctx.font="600 18px sans-serif";ctx.textAlign="center";ctx.fillText("游戏结束",240,245);}
 canvas.dataset.headX=String(snake[0]?.x??"");
 canvas.dataset.headY=String(snake[0]?.y??"");
 canvas.dataset.score=String(score);
 canvas.dataset.paused=String(paused);
}
function stop(){if(timer!==null)clearInterval(timer);timer=null;}
function finish(message,win=false){
 over=true;paused=true;stop();setStatus(message);
 GameBridge.send("GAME_OVER",{message,score,win});
 draw();
}
function tick(){
 if(paused||over||!snake.length)return;
 if(directionQueue.length)dir=directionQueue.shift();
 const head={x:snake[0].x+dir.x,y:snake[0].y+dir.y};
 const eating=!!food&&head.x===food.x&&head.y===food.y;
 const body=eating?snake:snake.slice(0,-1);
 if(head.x<0||head.x>=SIZE||head.y<0||head.y>=SIZE||body.some(part=>part.x===head.x&&part.y===head.y)){
  finish("游戏结束 · 撞到边界或身体");return;
 }
 snake.unshift(head);
 if(eating){
  score+=10;food=placeFood();scoreEl.textContent="得分 "+score;
  if(!food){finish("恭喜，棋盘已清空！",true);return;}
 }else snake.pop();
 draw();
}
function queueDirection(next){
 const basis=directionQueue.length?directionQueue[directionQueue.length-1]:dir;
 if(next.x===basis.x&&next.y===basis.y)return;
 if(next.x===-basis.x&&next.y===-basis.y)return;
 if(directionQueue.length<2)directionQueue.push(next);
}
function newGame(){
 stop();
 snake=[{x:11,y:12},{x:10,y:12},{x:9,y:12}];
 dir={x:1,y:0};directionQueue=[];score=0;configure(difficulty);
 paused=false;over=false;food=placeFood();scoreEl.textContent="得分 0";
 setStatus("游戏进行中");timer=setInterval(tick,speed);draw();canvas.focus();
}
function pause(){paused=true;setStatus("已暂停");draw();}
function resume(){
 if(over)return;
 paused=false;setStatus("游戏进行中");stop();timer=setInterval(tick,speed);draw();canvas.focus();
}
function keydown(event){
 const key=event.key.length===1?event.key.toLowerCase():event.key;
 const map={
  ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1},ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0},
  w:{x:0,y:-1},s:{x:0,y:1},a:{x:-1,y:0},d:{x:1,y:0}
 };
 const next=map[key];if(!next)return;
 event.preventDefault();
 if(paused||over)return;
 queueDirection(next);
}
function focusCanvas(){canvas.focus();}
window.addEventListener("keydown",keydown);
canvas.addEventListener("pointerdown",focusCanvas);
GameBridge.register({
 init(payload){configure(payload.difficulty);newGame();},
 newGame,
 pause,
 resume,
 setDifficulty(value){configure(value);},
 dispose(){paused=true;stop();window.removeEventListener("keydown",keydown);canvas.removeEventListener("pointerdown",focusCanvas);}
});
})();