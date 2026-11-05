(function(){"use strict";
const board=document.getElementById("board"),status=document.getElementById("status"),key=(q,r)=>q+","+r;
const directions=[[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]],nodes=new Map(),arms=Array.from({length:6},()=>[]);
const rotate=(q,r)=>[-r,q+r];
for(let q=-4;q<=4;q++)for(let r=Math.max(-4,-q-4);r<=Math.min(4,-q+4);r++)nodes.set(key(q,r),{q,r,arm:-1});
for(let arm=0;arm<6;arm++)for(let q=5;q<=8;q++)for(let r=-4;r<=4-q;r++){
 let x=q,y=r;for(let step=0;step<arm;step++)[x,y]=rotate(x,y);
 const k=key(x,y);nodes.set(k,{q:x,r:y,arm});arms[arm].push(k);
}
let pieces=new Map(),turn=0,mode="ai",difficulty="normal",paused=true,over=false,selected=null,targets=new Map(),history=[],aiTimer=null;
function own(seat){return [...pieces.entries()].filter(entry=>entry[1]===seat).map(entry=>entry[0]);}
function options(from){
 if(!pieces.has(from))return new Map();
 const out=new Map(),origin=nodes.get(from),queue=[{k:from,path:[]}],seen=new Set([from]);
 for(const [dx,dy] of directions){const dest=key(origin.q+dx,origin.r+dy);if(nodes.has(dest)&&!pieces.has(dest))out.set(dest,{path:[dest],hops:0});}
 while(queue.length){
  const current=queue.shift(),p=nodes.get(current.k);
  for(const [dx,dy] of directions){
   const middle=key(p.q+dx,p.r+dy),dest=key(p.q+2*dx,p.r+2*dy);
   if(middle===from||!pieces.has(middle)||!nodes.has(dest)||pieces.has(dest)||seen.has(dest))continue;
   const path=current.path.concat(dest);seen.add(dest);out.set(dest,{path,hops:path.length});queue.push({k:dest,path});
  }
 }
 return out;
}
function allMoves(side){
 const moves=[];for(const from of own(side))for(const [to,meta] of options(from))moves.push({from,to,hops:meta.hops,path:meta.path});
 return moves;
}
function distanceToGoal(k,side){const n=nodes.get(k);return (side===0?-n.q:n.q)*9+(n.arm===(side===0?3:0)?110:0);}
function assess(m,side){return distanceToGoal(m.to,side)-distanceToGoal(m.from,side)+Math.min(m.hops,8);}
function aiProfile(level=difficulty){return level==="easy"?{replyDepth:0,candidates:0}:level==="hard"?{replyDepth:1,candidates:12}:{replyDepth:0,candidates:24};}
function chooseAI(){
 const moves=allMoves(1);if(!moves.length)return null;
 if(difficulty==="easy")return moves[Math.floor(Math.random()*moves.length)];
 const contenders=moves.map(m=>({m,score:assess(m,1)})).sort((a,b)=>b.score-a.score).slice(0,aiProfile().candidates);
 if(difficulty==="hard")for(const item of contenders){
  pieces.delete(item.m.from);pieces.set(item.m.to,1);
  const opponentMoves=allMoves(0),counter=opponentMoves.reduce((best,m)=>Math.max(best,assess(m,0)),-Infinity);
  pieces.delete(item.m.to);pieces.set(item.m.from,1);
  item.score-=Number.isFinite(counter)?counter*.45:0;
 }
 contenders.sort((a,b)=>b.score-a.score);
 return contenders[0].m;
}
function report(message){status.textContent=message;GameBridge.report(message,{score:own(0).filter(k=>nodes.get(k).arm===3).length,turn});}
function draw(last=null){
 const ns="http:"+"//www.w3.org/2000/svg";
 const node=(name,attributes)=>{const e=document.createElementNS(ns,name);for(const [k,v] of Object.entries(attributes))e.setAttribute(k,String(v));return e;};
 board.replaceChildren();
 const center=node("circle",{cx:500,cy:450,r:260,class:"star-center"});board.appendChild(center);
 for(const entry of nodes.values()){
  const k=key(entry.q,entry.r),x=500+(entry.q+entry.r/2)*61,y=450+entry.r*.86602540378*61,occupant=pieces.get(k);
  const hole=node("circle",{cx:x,cy:y,r:23,"data-spot":k,role:"button",tabindex:0,class:"star-hole"+(entry.arm>=0?" arm-"+entry.arm:"")+(selected===k?" picked":"")+(targets.has(k)?" target":"")});
  hole.setAttribute("aria-label",entry.q+"列 "+entry.r+"行"+(occupant===0?" 红棋":occupant===1?" 蓝棋":" 空位"));
  hole.addEventListener("click",()=>click(k));
  hole.addEventListener("keydown",e=>{if(e.key===" "){e.preventDefault();click(k);}});
  board.appendChild(hole);
  if(occupant!==undefined){
   const p=node("circle",{cx:x,cy:y,r:17,class:"star-token token-"+occupant,"data-player":occupant,"data-position":k});
   p.style.pointerEvents="none";board.appendChild(p);
   if(last?.to===k&&!window.matchMedia("(prefers-reduced-motion: reduce)").matches){
    const origin=nodes.get(last.from),dx=((origin.q+origin.r/2)-(entry.q+entry.r/2))*61,dy=(origin.r-entry.r)*.86602540378*61;
    p.animate([{transform:"translate("+dx+"px,"+dy+"px)",opacity:.6},{transform:"translate(0,0)",opacity:1}],{duration:210,easing:"cubic-bezier(.25,.8,.25,1)"});
   }
  }
 }
 board.dataset.pieces=String(pieces.size);board.dataset.turn=String(turn);
}
function won(side){return own(side).length===10&&own(side).every(k=>nodes.get(k).arm===(side===0?3:0));}
function apply(move){
 if(!move||pieces.get(move.from)!==turn||!options(move.from).has(move.to)||paused||over)return false;
 history.push({pieces:new Map(pieces),turn});
 pieces.delete(move.from);pieces.set(move.to,turn);selected=null;targets.clear();draw(move);
 if(won(turn)){over=true;paused=true;clearTimeout(aiTimer);const name=turn===0?"红方":"蓝方";report(name+"获胜");GameBridge.send("GAME_OVER",{message:name+"获胜",score:10,win:turn===0});return true;}
 turn=1-turn;report(turn===0?"红方回合":"蓝方回合");scheduleAI();return true;
}
function click(k){
 if(paused||over||(mode==="ai"&&turn===1))return;
 if(selected&&targets.has(k)){apply({from:selected,to:k});return;}
 if(pieces.get(k)===turn){selected=k;targets=options(k);draw();report("选择绿色落点：走一步或连续跳跃");}
 else{selected=null;targets.clear();draw();}
}
function scheduleAI(){
 clearTimeout(aiTimer);if(paused||over||mode!=="ai"||turn!==1)return;
 aiTimer=setTimeout(()=>{if(paused||over||turn!==1)return;const m=chooseAI();if(m)apply(m);else{turn=0;report("蓝方暂无合法落点");}},difficulty==="hard"?260:180);
}
function undo(){
 if(paused||!history.length)return;clearTimeout(aiTimer);
 const steps=mode==="ai"&&turn===0?Math.min(2,history.length):1;
 for(let i=0;i<steps;i++){const prev=history.pop();pieces=new Map(prev.pieces);turn=prev.turn;}
 selected=null;targets.clear();over=false;draw();report("已悔棋");scheduleAI();
}
function newGame(){
 clearTimeout(aiTimer);pieces=new Map();
 for(const seat of [0,1])for(const k of arms[seat===0?0:3])pieces.set(k,seat);
 history=[];turn=0;selected=null;targets.clear();paused=false;over=false;draw();report("红方先行");
}
document.getElementById("undoButton").onclick=undo;
if(new URLSearchParams(location.search).has("p111Test")){
 newGame();
 window.__p111StarTest={
  count:()=>nodes.size,arms:()=>arms.map(a=>a.length),state:()=>({pieces:pieces.size,turn,over,red:own(0).length,blue:own(1).length}),
  moves:seat=>allMoves(seat),move:m=>apply(m),aiProfile,mode:v=>{mode=v;},difficulty:v=>{difficulty=v;}
 };
}
GameBridge.register({
 init(p){mode=p.mode==="two"?"two":"ai";difficulty=p.difficulty||"normal";newGame();},
 newGame,pause(){paused=true;clearTimeout(aiTimer);report("已暂停");},resume(){paused=false;report("对局继续");scheduleAI();},
 setMode:v=>{mode=v==="two"?"two":"ai";},setDifficulty:v=>{difficulty=v||"normal";},
 dispose(){paused=true;clearTimeout(aiTimer);}
});
})();