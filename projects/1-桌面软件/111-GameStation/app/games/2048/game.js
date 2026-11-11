(function(){
"use strict";
const boardEl=document.getElementById("board"),status=document.getElementById("status"),scoreEl=document.getElementById("score"),bestEl=document.getElementById("best");
let grid,score=0,best=0,previous=null,paused=false,over=false,won=false;
let lastSpawnIndices=new Set(),lastMergedIndices=new Set();
try{best=Number(localStorage.getItem("gs2048.best"))||0;}catch(e){}
function report(t){status.textContent=t;GameBridge.report(t,{score});}
function empty(){const a=[];grid.forEach((r,y)=>r.forEach((v,x)=>{if(!v)a.push([y,x]);}));return a;}
function spawn(){
 const e=empty();if(!e.length)return -1;
 const [y,x]=e[Math.floor(Math.random()*e.length)];
 grid[y][x]=Math.random()<.9?2:4;
 return y*4+x;
}
function render(){
 boardEl.replaceChildren();
 grid.forEach((row,y)=>row.forEach((v,x)=>{
  const index=y*4+x,tile=document.createElement("div");
  tile.className="tile number-tile";
  tile.dataset.value=String(v);tile.dataset.index=String(index);
  if(lastSpawnIndices.has(index))tile.classList.add("is-new");
  if(lastMergedIndices.has(index))tile.classList.add("is-merged");
  tile.textContent=v||"";
  tile.setAttribute("role","gridcell");
  tile.setAttribute("aria-label",v?String(v):"空格");
  boardEl.appendChild(tile);
 }));
 boardEl.classList.toggle("is-won",won);
 boardEl.classList.toggle("is-over",over);
 scoreEl.textContent=score;bestEl.textContent=best;
}
function canMove(){
 if(empty().length)return true;
 for(let y=0;y<4;y++)for(let x=0;x<4;x++){
  if(x<3&&grid[y][x]===grid[y][x+1])return true;
  if(y<3&&grid[y][x]===grid[y+1][x])return true;
 }
 return false;
}
function move(dir){
 if(paused||over)return;
 const old=grid.map(r=>r.slice()),oldScore=score,oldWon=won,oldOver=over;
 let gained=0;const mergedIndices=[];
 for(let i=0;i<4;i++){
  const line=[];
  for(let j=0;j<4;j++){
   const y=dir==="up"?j:dir==="down"?3-j:i;
   const x=dir==="left"?j:dir==="right"?3-j:i;
   line.push(grid[y][x]);
  }
  const compact=line.filter(Boolean),merged=[];
  for(let j=0;j<compact.length;j++){
   if(compact[j]===compact[j+1]){
    const value=compact[j]*2,destination=merged.length;
    const y=dir==="up"?destination:dir==="down"?3-destination:i;
    const x=dir==="left"?destination:dir==="right"?3-destination:i;
    mergedIndices.push(y*4+x);
    merged.push(value);gained+=value;j++;
   }else merged.push(compact[j]);
  }
  while(merged.length<4)merged.push(0);
  for(let j=0;j<4;j++){
   const y=dir==="up"?j:dir==="down"?3-j:i;
   const x=dir==="left"?j:dir==="right"?3-j:i;
   grid[y][x]=merged[j];
  }
 }
 if(JSON.stringify(old)===JSON.stringify(grid))return;
 previous={grid:old,score:oldScore,won:oldWon,over:oldOver};
 score+=gained;
 if(score>best){best=score;try{localStorage.setItem("gs2048.best",best);}catch(e){}}
 lastMergedIndices=new Set(mergedIndices);
 const spawned=spawn();
 lastSpawnIndices=new Set(spawned>=0?[spawned]:[]);
 if(!won&&grid.some(r=>r.includes(2048))){won=true;report("达成 2048！继续挑战更高分");}
 else if(!canMove()){over=true;report("没有可移动的位置");GameBridge.send("GAME_OVER",{message:"游戏结束 · 得分 "+score});}
 else report("继续合并");
 render();
}
function undo(){
 if(!previous)return;
 grid=previous.grid.map(r=>r.slice());score=previous.score;won=previous.won;over=previous.over;previous=null;
 lastSpawnIndices.clear();lastMergedIndices.clear();
 render();report("已撤销一步");
}
function newGame(){
 grid=Array.from({length:4},()=>Array(4).fill(0));
 score=0;previous=null;paused=false;over=false;won=false;
 lastMergedIndices.clear();
 const a=spawn(),b=spawn();lastSpawnIndices=new Set([a,b].filter(v=>v>=0));
 render();report("使用方向键开始");
}
function key(e){
 const map={ArrowLeft:"left",ArrowRight:"right",ArrowUp:"up",ArrowDown:"down"};
 if(map[e.key]){e.preventDefault();move(map[e.key]);}
}
window.addEventListener("keydown",key);
document.getElementById("undo").onclick=undo;
let touch=null;
boardEl.addEventListener("touchstart",e=>{touch=[e.touches[0].clientX,e.touches[0].clientY];},{passive:true});
boardEl.addEventListener("touchend",e=>{
 if(!touch)return;
 const dx=e.changedTouches[0].clientX-touch[0],dy=e.changedTouches[0].clientY-touch[1];
 if(Math.max(Math.abs(dx),Math.abs(dy))>25)move(Math.abs(dx)>Math.abs(dy)?(dx>0?"right":"left"):(dy>0?"down":"up"));
 touch=null;
},{passive:true});
if(new URLSearchParams(location.search).has("p111Test")){
 window.__p1112048Test={
  loadGrid(nextGrid,initialScore=0){
   if(!Array.isArray(nextGrid)||nextGrid.length!==4||nextGrid.some(row=>!Array.isArray(row)||row.length!==4||row.some(v=>!Number.isInteger(v)||v<0)))throw new Error("Invalid 2048 fixture");
   grid=nextGrid.map(row=>row.slice());score=Math.max(0,Number(initialScore)||0);previous=null;paused=false;over=false;won=grid.some(row=>row.includes(2048));
   lastSpawnIndices.clear();lastMergedIndices.clear();render();report("测试局面");return this.state();
  },
  state(){return{grid:grid.map(row=>row.slice()),score,best,previous:!!previous,paused,over,won,lastSpawn:[...lastSpawnIndices],lastMerged:[...lastMergedIndices]};},
  move(direction){move(direction);return this.state();},
  undo(){undo();return this.state();}
 };
}
GameBridge.register({
 init:newGame,newGame,
 pause(){paused=true;report("已暂停");},
 resume(){paused=false;report("继续游戏");},
 snapshot(){return{grid:grid.map(r=>r.slice()),score,best,previous:previous?{grid:previous.grid.map(r=>r.slice()),score:previous.score,won:previous.won,over:previous.over}:null,won,over};},
 restore(s){
  if(!s||!Array.isArray(s.grid)||s.grid.length!==4||s.grid.some(r=>!Array.isArray(r)||r.length!==4||r.some(v=>!Number.isInteger(v)||v<0)))throw new Error("2048 存档数据无效");
  grid=s.grid.map(r=>r.slice());score=Math.max(0,Number(s.score)||0);best=Math.max(0,Number(s.best)||best);
  previous=s.previous?{grid:s.previous.grid.map(r=>r.slice()),score:Number(s.previous.score)||0,won:!!s.previous.won,over:!!s.previous.over}:null;
  won=!!s.won;over=!!s.over;paused=true;lastSpawnIndices.clear();lastMergedIndices.clear();
  render();report("已恢复上次进度");
 },
 dispose(){paused=true;window.removeEventListener("keydown",key);}
});
})();