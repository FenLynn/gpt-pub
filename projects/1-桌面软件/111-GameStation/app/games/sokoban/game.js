(function(){
"use strict";
const levels=[
["#########","#       #","#   .   #","#   $   #","#   @   #","#       #","#########"],
["#########","#       #","# .   . #","# $   $ #","#   @   #","#       #","#########"],
["#########","#       #","# .   . #","# $ $   #","#   @   #","#       #","#########"],
["#########","#  . .  #","#  $ $  #","#   @   #","#  $ $  #","#  . .  #","#########"]
];
const el=document.getElementById("board"),status=document.getElementById("status");let level=0,player,boxes,goals,walls,moves=0,history=[],paused=false;
function parse(){walls=new Set();boxes=new Set();goals=new Set();player=0;levels[level].forEach((row,y)=>[...row].forEach((c,x)=>{const k=y*9+x;if(c==="#")walls.add(k);if(c==="$")boxes.add(k);if(c==="@")player=k;if(c===".")goals.add(k);}));moves=0;history=[];render();report("推动箱子到目标点");}
function report(t){status.textContent=t;GameBridge.report(t,{score:moves});}
function save(){history.push({player,boxes:[...boxes],moves});if(history.length>100)history.shift();}
function render(){el.innerHTML="";for(let y=0;y<7;y++)for(let x=0;x<9;x++){const k=y*9+x,q=document.createElement("div");q.className="game-cell";q.style.width="clamp(30px,5.5vw,48px)";q.style.height="clamp(30px,5.5vw,48px)";q.style.borderRadius="3px";if(walls.has(k)){q.classList.add("wall");}else if(boxes.has(k)){q.classList.add("box");q.textContent=goals.has(k)?"✓":"▣";}else if(player===k){q.classList.add("player");q.textContent="●";}else if(goals.has(k)){q.classList.add("goal");q.textContent="◎";}else q.style.background="#f5f7fa";el.appendChild(q);}document.getElementById("level").textContent=(level+1)+" / "+levels.length;document.getElementById("moves").textContent=moves;}
function move(dx,dy){if(paused)return;const x=player%9,y=Math.floor(player/9),nx=x+dx,ny=y+dy;if(nx<0||nx>=9||ny<0||ny>=7)return;const target=ny*9+nx;if(walls.has(target))return;let dest=target;if(boxes.has(target)){const bx=nx+dx,by=ny+dy;dest=by*9+bx;if(bx<0||bx>=9||by<0||by>=7||walls.has(dest)||boxes.has(dest))return;}save();if(boxes.has(target)){boxes.delete(target);boxes.add(dest);}player=target;moves++;render();if([...goals].every(g=>boxes.has(g))){report("关卡完成！");GameBridge.send("GAME_OVER",{message:"第 "+(level+1)+" 关完成"});}else report("继续推箱子");}
function undo(){const s=history.pop();if(!s)return;player=s.player;boxes=new Set(s.boxes);moves=s.moves;render();report("已撤销一步");}
function key(e){const map={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]};if(map[e.key]){e.preventDefault();move(...map[e.key]);}if(e.key.toLowerCase()==="z")undo();if(e.key.toLowerCase()==="r")parse();}
document.getElementById("undo").onclick=undo;document.getElementById("reset").onclick=parse;document.getElementById("next").onclick=()=>{level=(level+1)%levels.length;parse();};window.addEventListener("keydown",key);
// Test-only deterministic fixture API. It is not exposed in normal gameplay.
if(new URLSearchParams(location.search).has("p111Test")){
 const fixtureState=()=>({level,player,boxes:[...boxes].sort((a,b)=>a-b),goals:[...goals].sort((a,b)=>a-b),walls:[...walls].sort((a,b)=>a-b),moves,paused,complete:[...goals].every(g=>boxes.has(g))});
 window.__p111SokobanTest={
  loadLevel(index=0){level=Math.max(0,Math.min(levels.length-1,Math.floor(Number(index)||0)));paused=false;parse();return fixtureState();},
  state:fixtureState,
  move(dx,dy){move(dx,dy);return fixtureState();},
  undo(){undo();return fixtureState();}
 };
}
GameBridge.register({init:parse,newGame:parse,pause(){paused=true;report("已暂停");},resume(){paused=false;report("继续闯关");},snapshot(){return{level,player,boxes:[...boxes],goals:[...goals],walls:[...walls],moves,history:history.map(h=>({player:h.player,boxes:h.boxes.slice(),moves:h.moves}))};},restore(s){if(!s||!Number.isInteger(s.level)||!Array.isArray(s.boxes)||!Array.isArray(s.goals)||!Array.isArray(s.walls))throw new Error("推箱子存档数据无效");level=Math.max(0,Math.min(levels.length-1,s.level));player=Number(s.player)||0;boxes=new Set(s.boxes.map(Number));goals=new Set(s.goals.map(Number));walls=new Set(s.walls.map(Number));moves=Math.max(0,Number(s.moves)||0);history=Array.isArray(s.history)?s.history.map(h=>({player:Number(h.player)||0,boxes:Array.isArray(h.boxes)?h.boxes.map(Number):[],moves:Math.max(0,Number(h.moves)||0)})):[];paused=true;render();report("已恢复上次进度");},dispose(){paused=true;window.removeEventListener("keydown",key);}});
})();