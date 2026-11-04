(function(){
"use strict";
const canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),status=document.getElementById("status"),scoreEl=document.getElementById("score"),SIZE=24,CELL=20;
let snake,food,dir,nextDir,score,paused=true,over=false,timer=null,difficulty="normal",speed=115;
function setStatus(t){status.textContent=t;GameBridge.report(t,{score});}
function configure(v){difficulty=v||"normal";speed=difficulty==="easy"?165:difficulty==="hard"?78:115;}
function placeFood(){let p;do{p={x:Math.floor(Math.random()*SIZE),y:Math.floor(Math.random()*SIZE)};}while(snake.some(s=>s.x===p.x&&s.y===p.y));return p;}
function draw(){ctx.fillStyle="#152536";ctx.fillRect(0,0,480,480);ctx.strokeStyle="#ffffff0a";for(let i=0;i<=SIZE;i++){ctx.beginPath();ctx.moveTo(i*CELL,0);ctx.lineTo(i*CELL,480);ctx.stroke();ctx.beginPath();ctx.moveTo(0,i*CELL);ctx.lineTo(480,i*CELL);ctx.stroke();}ctx.fillStyle="#e4a46e";ctx.beginPath();ctx.arc(food.x*CELL+10,food.y*CELL+10,7,0,Math.PI*2);ctx.fill();snake.forEach((s,i)=>{ctx.fillStyle=i?"#75b99a":"#9cdbc0";ctx.fillRect(s.x*CELL+1,s.y*CELL+1,CELL-2,CELL-2);});if(paused&&!over){ctx.fillStyle="#ffffffcc";ctx.font="600 18px sans-serif";ctx.textAlign="center";ctx.fillText("已暂停",240,245);}if(over){ctx.fillStyle="#ffffffdd";ctx.font="600 18px sans-serif";ctx.textAlign="center";ctx.fillText("游戏结束",240,245);}}
function stop(){if(timer!==null)clearInterval(timer);timer=null;}
function tick(){if(paused||over)return;dir=nextDir;const head={x:snake[0].x+dir.x,y:snake[0].y+dir.y},eating=head.x===food.x&&head.y===food.y;if(head.x<0||head.x>=SIZE||head.y<0||head.y>=SIZE||snake.slice(0,eating?snake.length:snake.length-1).some(s=>s.x===head.x&&s.y===head.y)){over=true;stop();setStatus("游戏结束");GameBridge.send("GAME_OVER",{message:"撞到边界或身体",score,win:false});draw();return;}snake.unshift(head);if(eating){score+=10;food=placeFood();scoreEl.textContent="得分 "+score;}else snake.pop();draw();}
function newGame(){stop();snake=[{x:11,y:12},{x:10,y:12},{x:9,y:12}];dir={x:1,y:0};nextDir={x:1,y:0};score=0;configure(difficulty);paused=false;over=false;food=placeFood();scoreEl.textContent="得分 0";setStatus("游戏进行中");timer=setInterval(tick,speed);draw();canvas.focus();}
function pause(){paused=true;stop();setStatus("已暂停");draw();}
function resume(){if(over)return;paused=false;setStatus("游戏进行中");stop();timer=setInterval(tick,speed);draw();}
function key(e){const map={ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1},ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0}};if(map[e.key]){e.preventDefault();const n=map[e.key];if(n.x!==-dir.x||n.y!==-dir.y)nextDir=n;}if(e.key===" "||e.key==="p"||e.key==="P"){e.preventDefault();paused?resume():pause();}}
window.addEventListener("keydown",key);
GameBridge.register({init(p){configure(p.difficulty);newGame();},newGame,pause,resume,setDifficulty(v){configure(v);},dispose(){pause();window.removeEventListener("keydown",key);}});
})();