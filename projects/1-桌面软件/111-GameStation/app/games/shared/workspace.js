/* Shared workspace actions, status reporting and input. The host owns the toolbar. */
(function(){
"use strict";
const root=document.getElementById("game");
if(!root)return;
const gameId=document.body.dataset.game||root.dataset.game;
let autoToolsOpen=false,syncUrgentTools=null;
function setExpanded(open){
 root.classList.toggle("gs-tools-open",open);
 root.classList.toggle("rail-collapsed",!open);
}
const actionGlyphs={
 undoButton:"M10 6 4 12l6 6M5 12h8a6 6 0 0 1 6 6",undo:"M10 6 4 12l6 6M5 12h8a6 6 0 0 1 6 6",
 flip:"M3 10a9 9 0 0 1 15-5l3 3M21 3v5h-5M21 14a9 9 0 0 1-15 5l-3-3M3 21v-5h5",
 flipButton:"M3 10a9 9 0 0 1 15-5l3 3M21 3v5h-5M21 14a9 9 0 0 1-15 5l-3-3M3 21v-5h5",
 drawClaimButton:"M5 12l4 4L19 6M4 21h16",
 resignButton:"M5 21V4m0 1q5-4 9 0t7 0v10q-5 4-9 0t-7 0",
 reset:"M3 11a9 9 0 1 1 2 6M3 4v7h7",next:"M5 4v16m5-16 9 8-9 8z",
 hint:"M9 18h6m-5 4h4m-8-11a6 6 0 1 1 12 0c0 3-3 4-3 7H9c0-3-3-4-3-7",
 check:"M20 6 9 17l-5-5"
};
// Add the same right-rail resignation action to board games that lacked it.
// Xiangqi already has its own button and native winner/loser animation.
const resignGames=new Set(["gomoku","reversi","connect4","chess","checkers","chinese-checkers","flight-chess","battleship"]);
function ensureResignAction(){
 const side=root.querySelector(".game-tools");
 if(!side||!resignGames.has(gameId)||side.querySelector("#resignButton"))return;
 const button=document.createElement("button");
 button.type="button";button.id="resignButton";button.className="game-btn";
 button.textContent="认输";button.setAttribute("aria-label","认输结束本局");
 button.disabled=true;
 button.addEventListener("click",()=>window.dispatchEvent(new Event("gamestation:resign")));
 const undo=side.querySelector("#undoButton");
 if(undo)undo.insertAdjacentElement("afterend",button);
 else if(side.querySelector(".side-score"))side.querySelector(".side-score").insertAdjacentElement("beforebegin",button);
 else side.appendChild(button);
}
function enhancePageActions(){
 const side=root.querySelector(".game-tools");if(!side)return;
 side.querySelectorAll(":scope > button.game-btn").forEach(button=>{
  button.classList.add("gs-page-action");
  if(button.querySelector("svg")||!Object.hasOwn(actionGlyphs,button.id))return;
  const svg=document.createElementNS("http:"+"//www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("aria-hidden","true");
  const path=document.createElementNS("http:"+"//www.w3.org/2000/svg","path");
  path.setAttribute("d",actionGlyphs[button.id]);svg.appendChild(path);
  button.prepend(svg);
 });
}

function setup(){
 ensureResignAction();
 enhancePageActions();
 const side=root.querySelector(".game-tools");
 document.addEventListener("contextmenu",event=>{
  if(root.contains(event.target))event.preventDefault();
 },true);
 const statusNodes=[...root.querySelectorAll("#status,#turnText,#solitaireStatus")];
 if(statusNodes.length){
  const observer=new MutationObserver(records=>{
   const node=records[records.length-1]?.target?.nodeType===3?records[records.length-1].target.parentElement:records[records.length-1]?.target;
   const value=String(node?.textContent||"").trim();
   if(value&&value!=="准备开始"&&value!=="点击任意方格开始")window.GameBridge?.report(value);
  });
  statusNodes.forEach(node=>observer.observe(node,{childList:true,characterData:true,subtree:true}));
 }
 const alertIds=["responseBar","tianxiangPanel","savePanel","claimBar","bidControls","playControls","actionPanel","gameControls","pendingActions"];
 const alerts=alertIds.map(id=>side?.querySelector("#"+id)).filter(Boolean);
 if(side&&alerts.length){
  const active=el=>!el.hidden&&getComputedStyle(el).visibility!=="hidden"&&getComputedStyle(el).display!=="none";
  const sync=()=>{
   const urgent=alerts.some(active);
   if(urgent&&!root.classList.contains("gs-tools-open")){
    autoToolsOpen=true;setExpanded(true);
    window.GameBridge?.report("请处理当前游戏操作");
   }else if(!urgent&&autoToolsOpen){
    autoToolsOpen=false;setExpanded(false);
   }
  };
  syncUrgentTools=sync;
  alerts.forEach(el=>new MutationObserver(sync).observe(el,{childList:true,subtree:true,attributes:true}));
  sync();
 }
}
function reportWorkspace(){
 const guide=root.querySelector(".game-guide");
 const lines=guide?[...guide.querySelectorAll(".key-instruction")].map(el=>el.innerText.trim().replace(/\s+/g," ")):[];
 const note=root.querySelector(".game-tool-note")?.innerText?.trim()||"";
 window.GameBridge?.send("HELP_SOURCE",{lines,note});
}
function updateWorkspace({ready,started,paused,finished}={}){
 const resign=root.querySelector(".game-tools #resignButton");
 if(resign&&resignGames.has(gameId))resign.disabled=!ready||!started||paused||finished;
 syncUrgentTools?.();
 root.dataset.gsPaused=String(paused);
}
window.addEventListener("message",event=>{
 if(event.source!==window.parent)return;
 const message=event.data;
 if(!message||message.channel!=="gamestation"||message.protocolVersion!==1||message.gameId!==gameId)return;
 if(message.type==="INIT"){
  updateWorkspace({ready:true,paused:true});
  reportWorkspace();
  enhancePageActions();
  const hasActions=!!root.querySelector(".game-tools button,.game-tools select,.game-tools input,.game-tools summary");
  window.GameBridge?.send("TOOLS_META",{hasActions});
  return;
 }
 if(message.type==="HUD_STATE")updateWorkspace(message.payload);
});
setup();
})();
