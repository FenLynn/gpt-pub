/* P111 — shared local turn timer for nine board games. */
(function(){
"use strict";
const root=document.getElementById("game"),gameId=document.body.dataset.game;
if(!root||!gameId)return;
/* Reversi's move-time history occupies a dedicated left record rail.
   Other board games retain their own right-side timing cards. */
const historyRail=(["reversi","connect4","battleship","checkers","chinese-checkers","flight-chess"].includes(gameId))?
 root.querySelector(":scope > .reversi-record-rail"):null;
const host=root.querySelector(":scope > .game-tools");
if(!host)return;
const panel=document.createElement("section");
panel.id="gs-turn-clock";panel.className="gs-turn-clock";
panel.setAttribute("aria-label","本回合耗时和逐次操作记录");
panel.innerHTML='<div class="gs-turn-clock-header"><span>本回合耗时</span><b id="gs-turn-side">—</b></div>'+
 '<strong class="gs-turn-clock-value" id="gs-turn-elapsed" role="timer">00:00</strong>'+
 '<div class="gs-turn-clock-latest" id="gs-turn-latest">暂无操作记录</div>'+
 '<details class="gs-turn-clock-history" id="gs-turn-details"><summary>操作用时 <span id="gs-turn-count">0</span></summary>'+
 '<ol id="gs-turn-log" aria-label="逐次操作耗时"></ol></details>';
host.prepend(panel);
root.classList.add("gs-turn-clock-enabled");
/* Fit both special SVG stages from the REAL first-column rectangle. SVG height:auto
   otherwise falls back to 300px intrinsic width after the timer rail is introduced. */
let boardFitObserver=null;
if(gameId==="chinese-checkers"||gameId==="flight-chess"){
 const wrap=root.querySelector(".board-wrap");
 const board=gameId==="chinese-checkers"?root.querySelector("#board.star-checkers-board"):root.querySelector(".flight-stage");
 const ratio=1; // Both square SVG viewBox and flight stage occupy maximum safe height.
 if(wrap&&board){
  const fit=()=>{
   const bounds=wrap.getBoundingClientRect();
   const width=Math.min(Math.max(0,bounds.width-10),Math.max(0,bounds.height-10)*ratio);
   if(width>0){
    board.style.setProperty("width",width+"px","important");
    board.style.setProperty("height",width/ratio+"px","important");
   }
  };
  if(typeof ResizeObserver!=="undefined"){boardFitObserver=new ResizeObserver(fit);boardFitObserver.observe(wrap);}
  window.addEventListener("resize",fit);
  fit();
 }
}
let side="—",turnMs=0,actionMs=0,mark=performance.now(),running=false,records=[];
const sideNode=panel.querySelector("#gs-turn-side"),elapsedNode=panel.querySelector("#gs-turn-elapsed");
const latest=panel.querySelector("#gs-turn-latest"),counter=panel.querySelector("#gs-turn-count"),list=panel.querySelector("#gs-turn-log");
function fmt(ms){
 const deciseconds=Math.max(0,Math.floor(ms/100)),seconds=Math.floor(deciseconds/10),m=Math.floor(seconds/60),s=seconds%60;
 return String(m).padStart(2,"0")+":"+String(s).padStart(2,"0")+"."+(deciseconds%10);
}
function advance(now=performance.now()){
 if(running){const dt=Math.max(0,now-mark);turnMs+=dt;actionMs+=dt;}
 mark=now;
}
function refresh(){
 sideNode.textContent=side;
 elapsedNode.textContent=fmt(turnMs+(running?Math.max(0,performance.now()-mark):0));
 counter.textContent=String(records.length);
 if(historyRail)historyRail.querySelector("#reversiHistoryCount").textContent=records.length+" 步";
 root.dataset.turnClockSide=side;
 root.dataset.turnClockCount=String(records.length);
 root.dataset.turnClockRunning=String(running);
 const last=records[records.length-1];
 latest.textContent=last?"上一步 · "+last.side+" · "+fmt(last.ms):"暂无操作记录";
 list.replaceChildren();
 for(let i=Math.max(0,records.length-30);i<records.length;i++){
  const item=records[i],li=document.createElement("li"),name=document.createElement("span"),time=document.createElement("time");
  name.textContent=String(i+1)+". "+item.side+" · "+item.label;
  time.textContent=fmt(item.ms);
  li.append(name,time);list.appendChild(li);
 }
 if(historyRail){
  const leftList=historyRail.querySelector("#reversiMoveList");
  leftList.replaceChildren();
  for(let i=0;i<records.length;i++){
   const item=records[i],li=document.createElement("li"),
    index=document.createElement("span"),action=document.createElement("span"),
    time=document.createElement("time");
   index.className="reversi-move-index";index.textContent=String(i+1)+".";
   action.className="reversi-move-action";action.textContent=item.side+" · "+item.label;
   time.textContent=fmt(item.ms);
   li.title=index.textContent+" "+action.textContent+" "+time.textContent;
   li.append(index,action,time);leftList.appendChild(li);
  }
  if(records.length)leftList.scrollTop=leftList.scrollHeight;
 }
}
function reset(nextSide){
 advance();side=String(nextSide||"—");turnMs=0;actionMs=0;records=[];refresh();
}
function record(actingSide,nextSide,label="走棋"){
 advance();
 const actor=String(actingSide||side);
 if(side!==actor){side=actor;turnMs=0;actionMs=0;}
 records.push({side:actor,label:String(label||"走棋"),ms:actionMs});
 if(records.length>1000)records.shift();
 actionMs=0;
 const target=String(nextSide||actor);
 if(target!==actor){side=target;turnMs=0;}else side=actor;
 refresh();
}
function handover(nextSide){
 advance();const next=String(nextSide||side);
 if(next!==side){side=next;turnMs=0;actionMs=0;}
 refresh();
}
function rewind(steps,nextSide){
 advance();
 for(let i=0;i<Math.max(0,Number(steps)||0)&&records.length;i++)records.pop();
 side=String(nextSide||side);turnMs=0;actionMs=0;refresh();
}
function sync(payload){
 const p=payload||{},next=!!p.started&&!p.paused&&!p.finished;
 advance();running=next;refresh();
}
function snapshot(){advance();return{side,turnMs,actionMs,records:records.map(r=>({...r})),running};}
function restore(value){
 const p=value&&typeof value==="object"?value:{};
 running=false;mark=performance.now();
 side=String(p.side||"—");
 turnMs=Math.max(0,Number(p.turnMs)||0);
 actionMs=Math.max(0,Number(p.actionMs)||0);
 records=Array.isArray(p.records)?p.records.slice(-1000).map(r=>({side:String(r?.side||"—"),label:String(r?.label||"走棋"),ms:Math.max(0,Number(r?.ms)||0)})):[];
 refresh();
}
window.GameTurnClock=Object.freeze({reset,record,handover,rewind,snapshot,restore});
window.addEventListener("message",event=>{
 if(event.source!==window.parent)return;
 const m=event.data;
 if(m?.channel!=="gamestation"||m.protocolVersion!==1||m.gameId!==gameId)return;
 if(m.type==="HUD_STATE")sync(m.payload);
 if(m.type==="DISPOSE"){clearInterval(ticker);running=false;}
});
const ticker=setInterval(()=>{
 elapsedNode.textContent=fmt(turnMs+(running?Math.max(0,performance.now()-mark):0));
},200);
refresh();
})();