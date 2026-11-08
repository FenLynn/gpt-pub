(function(){"use strict";
const board=document.getElementById("board"),status=document.getElementById("status"),root=document.getElementById("game");
const key=(q,r)=>q+","+r,directions=[[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]],nodes=new Map(),arms=Array.from({length:6},()=>[]);
// Fixed physical seats: 1 at bottom, then 2..6 counterclockwise.
const layouts={2:[2,5],3:[2,0,4],4:[2,1,5,4],6:[2,1,0,5,4,3]};
const names=["1号玩家","2号玩家","3号玩家","4号玩家","5号玩家","6号玩家"],colors=["red","yellow","purple","blue","green","orange"];
const paint=["#da6556","#e4b74a","#9f82c4","#6199d2","#53a77a","#da9457"];
const rotate=(q,r)=>[-r,q+r];
for(let q=-4;q<=4;q++)for(let r=Math.max(-4,-q-4);r<=Math.min(4,-q+4);r++)nodes.set(key(q,r),{q,r,arm:-1});
for(let arm=0;arm<6;arm++)for(let q=5;q<=8;q++)for(let r=-4;r<=4-q;r++){
 let x=q,y=r;for(let step=0;step<arm;step++)[x,y]=rotate(x,y);
 const k=key(x,y);nodes.set(k,{q:x,r:y,arm});arms[arm].push(k);
}
let playerCount=2,pieces=new Map(),turn=0,mode="ai",difficulty="normal",paused=true,over=false,selected=null,targets=new Map(),history=[],aiTimer=null;
const activeArms=()=>layouts[playerCount],targetArm=seat=>(activeArms()[seat]+3)%6;
const isAI=()=>mode==="ai";
const isComputerTurn=()=>isAI()&&turn!==0;
const own=seat=>[...pieces.entries()].filter(entry=>entry[1]===seat).map(entry=>entry[0]);
// Record panel matches the physical wooden circle diameter, not the SVG viewBox.
const fit=()=>{const h=board.getBoundingClientRect().height;if(h>0)root.style.setProperty("--reversi-board-height",(h*812/900)+"px");};
if(typeof ResizeObserver!=="undefined")new ResizeObserver(fit).observe(board);
window.addEventListener("resize",fit);requestAnimationFrame(fit);
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
function allMoves(seat){const out=[];for(const from of own(seat))for(const [to,meta] of options(from))out.push({from,to,hops:meta.hops,path:meta.path});return out;}
function goalCenter(seat){
 const cells=arms[targetArm(seat)].map(k=>nodes.get(k));return{q:cells.reduce((v,n)=>v+n.q,0)/10,r:cells.reduce((v,n)=>v+n.r,0)/10};
}
function distanceToGoal(k,seat){const n=nodes.get(k),g=goalCenter(seat);return Math.abs(n.q-g.q)+Math.abs(n.r-g.r)+Math.abs(n.q+n.r-g.q-g.r);}
function assess(m,seat){return (distanceToGoal(m.from,seat)-distanceToGoal(m.to,seat))*9+(nodes.get(m.to).arm===targetArm(seat)?13:0)+Math.min(m.hops,8);}
function aiProfile(level=difficulty){return level==="easy"?{replyDepth:0,candidates:0}:level==="hard"?{replyDepth:1,candidates:12}:{replyDepth:0,candidates:24};}
function chooseAI(side=turn){
 const moves=allMoves(side);if(!moves.length)return null;
 if(difficulty==="easy")return moves[Math.floor(Math.random()*moves.length)];
 const contenders=moves.map(m=>({m,score:assess(m,side)})).sort((a,b)=>b.score-a.score).slice(0,aiProfile().candidates);
 if(difficulty==="hard")for(const item of contenders){
  pieces.delete(item.m.from);pieces.set(item.m.to,side);
  const next=(side+1)%playerCount;
  const counter=allMoves(next).reduce((best,m)=>Math.max(best,assess(m,next)),-Infinity);
  pieces.delete(item.m.to);pieces.set(item.m.from,side);
  item.score-=Number.isFinite(counter)?counter*.45:0;
 }
 contenders.sort((a,b)=>b.score-a.score);return contenders[0].m;
}
function report(message){status.textContent=message;GameBridge.report(message,{score:own(0).filter(k=>nodes.get(k).arm===targetArm(0)).length,turn});}
function node(tag,attrs){const el=document.createElementNS("http:"+"//www.w3.org/2000/svg",tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));return el;}
// Perspective never rotates during play: physical seat 1 is always at the bottom.
function projection(q,r){const x=(q+r/2)*53,y=r*.86602540378*53;return [450+x,450+y];}
function updateScore(){
 const host=document.getElementById("starCounters");host.replaceChildren();
 for(let seat=0;seat<playerCount;seat++){
  const row=document.createElement("div");row.className="reversi-count-row";row.dataset.side=colors[seat];row.dataset.seat=String(seat);
  const disc=document.createElement("span");disc.className="star-count-disc reversi-count-disc "+colors[seat];disc.setAttribute("aria-hidden","true");
  const name=document.createElement("span");name.className="reversi-count-name";name.textContent=names[seat]+"入营";
  const score=document.createElement("strong");score.id=seat===0?"redArrived":seat===1?"blueArrived":"starArrived"+seat;
  score.textContent=String(own(seat).filter(k=>nodes.get(k).arm===targetArm(seat)).length);
  row.append(disc,name,score);host.append(row);
 }
 host.dataset.players=String(playerCount);
}
function draw(last=null){
 const currentSeat=0;
 board.replaceChildren();
 board.append(node("circle",{cx:450,cy:450,r:406,class:"star-wood-rim"}));
 board.append(node("circle",{cx:450,cy:450,r:390,class:"star-center"}));
 for(const [seat,arm] of activeArms().entries()){
  const tip=nodes.get(arms[arm][arms[arm].length-1]),xy=projection(tip.q,tip.r);
  const radial=Math.atan2(xy[1]-450,xy[0]-450),x=450+Math.cos(radial)*425,y=450+Math.sin(radial)*425;
  const active=seat===turn;
  const label=node("g",{class:"star-seat-marker"+(active?" is-current":""),"data-arm":arm,
   "data-position":seat+1,"data-active":String(active),"aria-label":names[seat]+(active?"当前回合":"")});
  label.append(node("circle",{cx:x,cy:y,r:active?20:17,fill:paint[seat],stroke:"#fffaf0","stroke-width":active?4:3}));
  const t=node("text",{x,y:y+6,"text-anchor":"middle",class:"star-seat-number"});t.textContent=String(seat+1);
  label.append(t);board.append(label);
 }
 for(const entry of nodes.values()){
  const k=key(entry.q,entry.r),[x,y]=projection(entry.q,entry.r),occupant=pieces.get(k);
  const seat=activeArms().indexOf(entry.arm);
  const hole=node("circle",{cx:x,cy:y,r:20.5,"data-spot":k,role:"button",tabindex:0,
   class:"star-hole"+(entry.arm>=0?" arm-"+entry.arm:"")+(selected===k?" picked":"")+(targets.has(k)?" target":"")});
  if(seat>=0)hole.style.setProperty("--camp-color",paint[seat]+"45");
  hole.setAttribute("aria-label",entry.q+"列 "+entry.r+"行"+(occupant!==undefined?" "+names[occupant]:" 空位"));
  hole.addEventListener("click",()=>click(k));
  hole.addEventListener("keydown",e=>{if(e.key===" "||e.key==="Enter"){e.preventDefault();click(k);}});
  board.append(hole);
  if(occupant!==undefined){
   const piece=node("circle",{cx:x,cy:y,r:16.6,class:"star-token token-"+occupant,"data-player":occupant,"data-position":k});
   piece.style.pointerEvents="none";piece.style.fill=paint[occupant];piece.style.stroke=paint[occupant];
   board.append(piece);
   if(last?.to===k&&!window.matchMedia("(prefers-reduced-motion:reduce)").matches){
    const n=nodes.get(last.from),[ox,oy]=projection(n.q,n.r);
    piece.animate([{transform:"translate("+(ox-x)+"px,"+(oy-y)+"px)",opacity:.6},{transform:"translate(0,0)",opacity:1}],{duration:220,easing:"cubic-bezier(.25,.8,.25,1)"});
   }
  }
 }
 board.dataset.pieces=String(pieces.size);board.dataset.turn=String(turn);board.dataset.players=String(playerCount);
 board.dataset.viewSeat=String(currentSeat);board.dataset.fixedOrientation="true";root.dataset.turnSide=colors[turn];
 updateScore();
 document.getElementById("undoButton").disabled=paused||over||!history.length;
}
function won(seat){return own(seat).length===10&&own(seat).every(k=>nodes.get(k).arm===targetArm(seat));}
function apply(move){
 if(!move||pieces.get(move.from)!==turn||!options(move.from).has(move.to)||paused||over)return false;
 history.push({pieces:new Map(pieces),turn});
 const actor=turn;pieces.delete(move.from);pieces.set(move.to,actor);
 selected=null;targets.clear();
 if(won(actor)){
  over=true;paused=true;clearTimeout(aiTimer);
  window.GameTurnClock?.record(names[actor],names[actor],"走棋");
  draw(move);report(names[actor]+"获胜");
  GameBridge.send("GAME_OVER",{message:names[actor]+"获胜",winner:names[actor],score:10,win:actor===0});return true;
 }
 turn=(turn+1)%playerCount;
 window.GameTurnClock?.record(names[actor],names[turn],"走棋");
 draw(move);report(names[turn]+"回合");scheduleAI();return true;
}
function click(k){
 if(paused||over||isComputerTurn())return;
 if(selected&&targets.has(k)){apply({from:selected,to:k});return;}
 if(pieces.get(k)===turn){selected=k;targets=options(k);draw();report("选择绿色落点：走一步或连续跳跃");}
 else{selected=null;targets.clear();draw();}
}
function scheduleAI(){
 clearTimeout(aiTimer);if(paused||over||!isComputerTurn())return;
 const seat=turn;
 aiTimer=setTimeout(()=>{
  if(paused||over||turn!==seat||!isComputerTurn())return;
  const m=chooseAI(seat);
  if(m)apply(m);
  else{turn=(turn+1)%playerCount;window.GameTurnClock?.handover(names[turn]);draw();report(names[seat]+"无合法落点");scheduleAI();}
 },difficulty==="hard"?310:220);
}
function undo(){
 if(paused||!history.length)return;clearTimeout(aiTimer);
 let steps=1;
 if(isAI()&&turn===0){steps=0;for(let i=history.length-1;i>=0;i--){steps++;if(history[i].turn===0)break;}}
 for(let i=0;i<steps;i++){const prev=history.pop();pieces=new Map(prev.pieces);turn=prev.turn;}
 selected=null;targets.clear();over=false;
 window.GameTurnClock?.rewind(steps,names[turn]);draw();report("已悔棋");scheduleAI();
}
function newGame(){
 clearTimeout(aiTimer);pieces=new Map();
 activeArms().forEach((arm,seat)=>{for(const k of arms[arm])pieces.set(k,seat);});
 history=[];turn=0;selected=null;targets.clear();paused=false;over=false;
 window.GameTurnClock?.reset(names[0]);
 document.querySelectorAll("#starPlayerOptions button").forEach(btn=>btn.setAttribute("aria-pressed",String(Number(btn.dataset.players)===playerCount)));
 draw();report(names[0]+"先行");
}
document.getElementById("undoButton").onclick=undo;
document.querySelectorAll("#starPlayerOptions button").forEach(btn=>btn.addEventListener("click",()=>{
 const count=Number(btn.dataset.players);if(!layouts[count]||count===playerCount)return;
 playerCount=count;newGame();
}));
if(new URLSearchParams(location.search).has("p111Test")){
 newGame();
 window.__p111StarTest={
  count:()=>nodes.size,arms:()=>arms.map(a=>a.length),state:()=>({pieces:pieces.size,turn,over,red:own(0).length,blue:own(1).length,positions:[...pieces.entries()],playerCount,activeArms:activeArms(),viewSeat:Number(board.dataset.viewSeat)}),
  players:n=>{if(layouts[n]){playerCount=n;newGame();}return playerCount;},
  setPieces:entries=>{pieces=new Map(entries);turn=0;paused=false;over=false;history=[];selected=null;targets.clear();draw();},
  undo,moves:seat=>allMoves(seat),move:m=>apply(m),aiProfile,mode:v=>{mode=v;draw();scheduleAI();},difficulty:v=>{difficulty=v;},computer:()=>isComputerTurn(),ai:()=>{const m=chooseAI(turn);return m?apply(m):false;}
 };
}
GameBridge.register({
 init(p){mode=p.mode==="two"?"two":"ai";difficulty=p.difficulty||"normal";newGame();},
 newGame,pause(){paused=true;clearTimeout(aiTimer);document.getElementById("undoButton").disabled=true;report("已暂停");},
 resume(){paused=false;draw();report("对局继续");scheduleAI();},
 setMode:v=>{mode=v==="two"?"two":"ai";draw();scheduleAI();},setDifficulty:v=>{difficulty=v||"normal";},
 dispose(){paused=true;clearTimeout(aiTimer);}
});
})();