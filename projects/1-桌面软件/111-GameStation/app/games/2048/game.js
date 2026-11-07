(function(){
"use strict";
const boardEl=document.getElementById("board"),status=document.getElementById("status"),scoreEl=document.getElementById("score"),bestEl=document.getElementById("best");
let grid,score=0,best=0,previous=null,paused=false,over=false,won=false;
try{best=Number(localStorage.getItem("gs2048.best"))||0;}catch(e){}
function report(t){status.textContent=t;GameBridge.report(t,{score});}
function empty(){const a=[];grid.forEach((r,y)=>r.forEach((v,x)=>{if(!v)a.push([y,x]);}));return a;}
function spawn(){const e=empty();if(!e.length)return;const [y,x]=e[Math.floor(Math.random()*e.length)];grid[y][x]=Math.random()<.9?2:4;}
function render(){
 boardEl.innerHTML="";
 for(const v of grid.flat()){
  const tile=document.createElement("div");tile.className="tile number-tile";
  tile.dataset.value=String(v);tile.textContent=v||"";
  tile.setAttribute("aria-label",v?String(v):"空格");
  boardEl.appendChild(tile);
 }
 scoreEl.textContent=score;bestEl.textContent=best;
}
function canMove(){if(empty().length)return true;for(let y=0;y<4;y++)for(let x=0;x<4;x++){if(x<3&&grid[y][x]===grid[y][x+1])return true;if(y<3&&grid[y][x]===grid[y+1][x])return true;}return false;}
function move(dir){if(paused||over)return;const old=grid.map(r=>r.slice()),oldScore=score,oldWon=won,oldOver=over;let gained=0;for(let i=0;i<4;i++){let line=[];for(let j=0;j<4;j++){const y=dir==="up"?j:dir==="down"?3-j:i,x=dir==="left"?j:dir==="right"?3-j:i;line.push(grid[y][x]);}line=line.filter(Boolean);const merged=[];for(let j=0;j<line.length;j++){if(line[j]===line[j+1]){const v=line[j]*2;merged.push(v);gained+=v;j++;}else merged.push(line[j]);}while(merged.length<4)merged.push(0);for(let j=0;j<4;j++){const y=dir==="up"?j:dir==="down"?3-j:i,x=dir==="left"?j:dir==="right"?3-j:i;grid[y][x]=merged[j];}}if(JSON.stringify(old)===JSON.stringify(grid))return;previous={grid:old,score:oldScore,won:oldWon,over:oldOver};score+=gained;if(score>best){best=score;try{localStorage.setItem("gs2048.best",best);}catch(e){}}spawn();if(!won&&grid.some(r=>r.includes(2048))){won=true;report("达成 2048！继续挑战更高分");}else if(!canMove()){over=true;report("没有可移动的位置");GameBridge.send("GAME_OVER",{message:"游戏结束 · 得分 "+score});}else report("继续合并");render();}
function newGame(){grid=Array.from({length:4},()=>Array(4).fill(0));score=0;previous=null;paused=false;over=false;won=false;spawn();spawn();render();report("使用方向键开始");}
function key(e){const map={ArrowLeft:"left",ArrowRight:"right",ArrowUp:"up",ArrowDown:"down"};if(map[e.key]){e.preventDefault();move(map[e.key]);}}
window.addEventListener("keydown",key);document.getElementById("undo").onclick=()=>{if(!previous)return;grid=previous.grid;score=previous.score;won=previous.won;over=previous.over;previous=null;render();report("已撤销一步");};
let touch=null;boardEl.addEventListener("touchstart",e=>{touch=[e.touches[0].clientX,e.touches[0].clientY];},{passive:true});boardEl.addEventListener("touchend",e=>{if(!touch)return;const dx=e.changedTouches[0].clientX-touch[0],dy=e.changedTouches[0].clientY-touch[1];if(Math.max(Math.abs(dx),Math.abs(dy))>25)move(Math.abs(dx)>Math.abs(dy)?(dx>0?"right":"left"):(dy>0?"down":"up"));touch=null;},{passive:true});
// Test-only deterministic fixture API. It is not exposed in normal gameplay.
if(new URLSearchParams(location.search).has("p111Test")){
 window.__p1112048Test={
  loadGrid(nextGrid,initialScore=0){
   if(!Array.isArray(nextGrid)||nextGrid.length!==4||nextGrid.some(row=>!Array.isArray(row)||row.length!==4||row.some(v=>!Number.isInteger(v)||v<0)))throw new Error("Invalid 2048 fixture");
   grid=nextGrid.map(row=>row.slice());score=Math.max(0,Number(initialScore)||0);previous=null;paused=false;over=false;won=grid.some(row=>row.includes(2048));render();report("测试局面");return this.state();
  },
  state(){return{grid:grid.map(row=>row.slice()),score,best,previous:!!previous,paused,over,won};},
  move(direction){move(direction);return this.state();},
  undo(){document.getElementById("undo").click();return this.state();}
 };
}
GameBridge.register({init:newGame,newGame,pause(){paused=true;report("已暂停");},resume(){paused=false;report("继续游戏");},dispose(){paused=true;window.removeEventListener("keydown",key);}});
})();