/* P111 — shared local turn timer for nine board games. */
(function(){
"use strict";
const root=document.getElementById("game"),gameId=document.body.dataset.game;
if(!root||!gameId)return;
const onExistingRail=gameId==="xiangqi"||gameId==="gomoku";
const host=onExistingRail?root.querySelector(":scope > .game-tools"):root.querySelector(":scope > .game-main-board");
if(!host)return;
const panel=document.createElement("section");
panel.id="gs-turn-clock";panel.className="gs-turn-clock";
panel.setAttribute("aria-label","本回合耗时和逐次操作记录");
panel.innerHTML='<div class="gs-turn-clock-header"><span>本回合耗时</span><b id="gs-turn-side">—</b></div>'+
 '<strong class="gs-turn-clock-value" id="gs-turn-elapsed" role="timer">00:00</strong>'+
 '<div class="gs-turn-clock-latest" id="gs-turn-latest">暂无操作记录</div>'+
 '<details class="gs-turn-clock-history" id="gs-turn-details"><summary>操作用时 <span id="gs-turn-count">0</span></summary>'+
 '<ol id="gs-turn-log" aria-label="逐次操作耗时"></ol></details>';
if(onExistingRail)host.prepend(panel);else host.appendChild(panel);
root.classList.add("gs-turn-clock-enabled");
let side="—",turnMs=0,actionMs=0,mark=performance.now(),running=false,records=[];
const sideNode=panel.querySelector("#gs-turn-side"),elapsedNode=panel.querySelector("#gs-turn-elapsed");
const latest=panel.querySelector("#gs-turn-latest"),counter=panel.querySelector("#gs-turn-count"),list=panel.querySelector("#gs-turn-log");
function fmt(ms){
 const seconds=Math.max(0,Math.floor(ms/1000)),m=Math.floor(seconds/60),s=seconds%60;
 return String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
}
function advance(now=performance.now()){
 if(running){const dt=Math.max(0,now-mark);turnMs+=dt;actionMs+=dt;}
 mark=now;
}
function refresh(){
 sideNode.textContent=side;
 elapsedNode.textContent=fmt(turnMs+(running?Math.max(0,performance.now()-mark):0));
 counter.textContent=String(records.length);
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
window.GameTurnClock=Object.freeze({reset,record,handover,rewind,snapshot});
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