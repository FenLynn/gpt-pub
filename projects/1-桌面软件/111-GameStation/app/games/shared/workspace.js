/* P111 R17 · one shared in-game toolbar, centered timer and in-stage notices. */
(function(){
"use strict";
const root=document.getElementById("game");
if(!root)return;
const gameId=document.body.dataset.game||root.dataset.game;
if(!document.getElementById("gameWorkspaceStyles")){
 const sheet=document.createElement("link");sheet.id="gameWorkspaceStyles";
 sheet.rel="stylesheet";sheet.href="../shared/workspace.css";document.head.appendChild(sheet);
}
root.classList.remove("rail-collapsed");
root.dataset.workspace="r17";
let hud=null,menu=null,notice=null,state={},lastNotice="",lastNoticeAt=0,noticePersistent=false,autoToolsOpen=false,syncUrgentTools=null;
function send(action,detail={}){window.GameBridge?.send("CONTROL",{action,...detail});}
function setExpanded(open){
 const side=root.querySelector(".game-tools");
 if(!side||menu?.hidden)return;
 root.classList.toggle("gs-tools-open",!!open);
 menu.setAttribute("aria-expanded",String(!!open));
}
function hideNotice(){
 if(!notice)return;
 notice.classList.remove("is-visible","persistent","side-left","side-right");
 notice.hidden=true;
 noticePersistent=false;
 root.classList.remove("gs-notice-lane");
}
function positionNotice(){
 if(!notice)return;
 const stage=notice.parentElement,stageRect=stage.getBoundingClientRect();
 let surface=null;
 if(root.classList.contains("battleship-layout"))surface=root.querySelector(".fleet-boards");
 else surface=root.querySelector(".arcade-canvas,.gomoku-board,.xiangqi-board,.chess-frame,.mine-classic,.solitaire-table,.card-table-main,#board");
 notice.classList.remove("side-left","side-right");
 notice.style.maxWidth="";
 root.classList.remove("gs-notice-lane");
 if(!surface){root.classList.add("gs-notice-lane");return;}
 const r=surface.getBoundingClientRect();
 const leftGap=r.left-stageRect.left,rightGap=stageRect.right-r.right,topGap=r.top-stageRect.top;
 if(leftGap>=160){
  notice.classList.add("side-left");
  notice.style.maxWidth=Math.max(120,Math.min(240,leftGap-20))+"px";
 }else if(rightGap>=160){
  notice.classList.add("side-right");
  notice.style.maxWidth=Math.max(120,Math.min(240,rightGap-20))+"px";
 }else if(topGap<56){
  root.classList.add("gs-notice-lane");
 }
}
function showNotice(message,persistent=false){
 const value=String(message||"").trim();
 if(value){window.GameBridge?.report(value);return;}
 if(!value||!notice)return;
 const now=performance.now();
 if(noticePersistent&&!persistent)return;
 if(value===lastNotice&&now-lastNoticeAt<360&&!notice.hidden)return;
 lastNotice=value;lastNoticeAt=now;
 notice.textContent=value;
 positionNotice();
 notice.hidden=false;
 notice.classList.remove("is-visible","persistent");
 void notice.offsetWidth;
 notice.classList.add("is-visible");
 if(persistent){
  noticePersistent=true;
  notice.classList.add("persistent");
 }else noticePersistent=false;
}
function clearPersistentNotice(){
 if(!noticePersistent)return;
 hideNotice();
}
function makeSegment(id,label,items,attribute,selected){
 const group=document.createElement("div");
 group.className="gs-segment";
 group.id=id;
 group.setAttribute("role","group");
 group.setAttribute("aria-label",label);
 items.forEach(item=>{
  const button=document.createElement("button");
  button.type="button";
  button.textContent=item.label;
  button.dataset[attribute]=String(item.value);
  button.setAttribute("aria-pressed",String(String(item.value)===String(selected)));
  group.appendChild(button);
 });
 return group;
}
function renderOptions(){
 const options=hud?.querySelector("#gs-options");
 if(!options)return;
 const mode=options.querySelector("#gs-mode");
 if(mode)mode.querySelectorAll("[data-mode-index]").forEach(button=>
  button.setAttribute("aria-pressed",String(Number(button.dataset.modeIndex)===Number(state.modeIndex||0))));
 const difficulty=options.querySelector("#gs-difficulty");
 if(difficulty)difficulty.querySelectorAll("[data-difficulty]").forEach(button=>
  button.setAttribute("aria-pressed",String(button.dataset.difficulty===(state.difficulty||"normal"))));
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
function enhancePageActions(){
 const side=root.querySelector(".game-tools");if(!side)return;
 side.querySelectorAll(":scope > button.game-btn").forEach(button=>{
  if(button.querySelector("svg")||!Object.hasOwn(actionGlyphs,button.id))return;
  const svg=document.createElementNS("http:"+"//www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("aria-hidden","true");
  const path=document.createElementNS("http:"+"//www.w3.org/2000/svg","path");
  path.setAttribute("d",actionGlyphs[button.id]);svg.appendChild(path);
  button.classList.add("gs-page-action");button.prepend(svg);
 });
}

function setup(){
 if(hud)return;
 enhancePageActions();
 hud=document.createElement("section");
 hud.className="gs-hud";
 hud.id="gs-hud";
 hud.setAttribute("aria-label","游戏标题栏");
 hud.innerHTML='<div class="gs-hud-left"><strong class="gs-hud-name"></strong></div>'+
  '<div class="gs-hud-controls"><div class="gs-hud-options" id="gs-options"></div>'+
  '<div class="gs-hud-actions">'+
  '<button type="button" class="gs-hud-button" data-action="start" id="gs-start">开始</button>'+
  '<button type="button" class="gs-hud-button" data-action="pause" id="gs-pause" disabled>暂停</button>'+
  '<button type="button" class="gs-hud-button" data-action="new" id="gs-next" disabled>新局</button>'+
  '<button type="button" class="gs-hud-button" data-action="tools" id="gs-tools" aria-expanded="false">工具</button>'+
  '<button type="button" class="gs-hud-button" data-action="help" id="gs-help">帮助</button>'+
  '</div></div>';
 root.prepend(hud);
 menu=hud.querySelector("#gs-tools");
 const side=root.querySelector(".game-tools");
 menu.hidden=!side?.querySelector("button,select,input,summary");
 const main=root.querySelector(".game-main-board")||root;
 notice=document.createElement("div");
 notice.className="gs-notice";
 notice.id="gs-notice";
 notice.setAttribute("role","status");
 notice.setAttribute("aria-live","polite");
 notice.hidden=true;
 main.appendChild(notice);
 notice.addEventListener("animationend",()=>{
  if(!noticePersistent)hideNotice();
 });
 hud.addEventListener("click",event=>{
  const modeButton=event.target.closest("button[data-mode-index]");
  if(modeButton){
   const index=Number(modeButton.dataset.modeIndex);
   if(index!==Number(state.modeIndex||0)){state.modeIndex=index;renderOptions();send("mode",{index});}
   return;
  }
  const difficultyButton=event.target.closest("button[data-difficulty]");
  if(difficultyButton){
   const value=difficultyButton.dataset.difficulty;
   if(value!==(state.difficulty||"normal")){state.difficulty=value;renderOptions();send("difficulty",{value});}
   return;
  }
  const button=event.target.closest("button[data-action]");
  if(!button)return;
  const action=button.dataset.action;
  if(action==="tools"){autoToolsOpen=false;setExpanded(!root.classList.contains("gs-tools-open"));return;}
  if(action==="help")send("help");
  else if(action==="pause")send("toggle");
  else send(action);
 });
 document.addEventListener("contextmenu",event=>{
  if(root.contains(event.target))event.preventDefault();
 },true);
 const statusNodes=[...root.querySelectorAll("#status,#turnText,#solitaireStatus")];
 if(statusNodes.length){
  const observer=new MutationObserver(records=>{
   const node=records[records.length-1]?.target?.nodeType===3?records[records.length-1].target.parentElement:records[records.length-1]?.target;
   const value=String(node?.textContent||"").trim();
   if(value&&value!=="准备开始"&&value!=="点击任意方格开始")showNotice(value,false);
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
    showNotice("请处理当前游戏操作",false);
   }else if(!urgent&&autoToolsOpen){
    autoToolsOpen=false;setExpanded(false);
   }
  };
  syncUrgentTools=sync;
  alerts.forEach(el=>new MutationObserver(sync).observe(el,{childList:true,subtree:true,attributes:true}));
  sync();
 }
}
function initHud(payload){
 setup();
 const p=payload||{};
 hud.querySelector(".gs-hud-name").textContent=String(p.name||document.title);
 state={ready:true,started:false,paused:true,finished:false,elapsed:"00:00",
  modeIndex:p.mode==="two"?1:0,difficulty:p.difficulty||"normal"};
 const options=hud.querySelector("#gs-options");
 options.replaceChildren();
 if(Array.isArray(p.modes)&&p.modes.length>1){
  options.appendChild(makeSegment("gs-mode","对战方式",
   p.modes.map((label,index)=>({label,value:index})),"modeIndex",state.modeIndex));
 }
 if(p.hasDifficulty){
  const labels=p.difficultyLabels||["简单","中等","困难"];
  const values=["easy","normal","hard"];
  options.appendChild(makeSegment("gs-difficulty","游戏难度",
   labels.map((label,index)=>({label,value:values[index]||"hard"})),"difficulty",state.difficulty));
 }
 renderOptions();
 updateHud(state);
 const guide=root.querySelector(".game-guide");
 const lines=guide?[...guide.querySelectorAll(".key-instruction")].map(el=>el.innerText.trim().replace(/\s+/g," ")):[];
 const note=root.querySelector(".game-tool-note")?.innerText?.trim()||"";
 window.GameBridge?.send("HELP_SOURCE",{lines,note});
}
function updateHud(payload){
 setup();
 state={...state,...(payload||{})};
 const started=!!state.started,paused=!!state.paused,finished=!!state.finished;
 const start=hud.querySelector("#gs-start"),pause=hud.querySelector("#gs-pause"),next=hud.querySelector("#gs-next");
 start.textContent=started?"结束":"开始";
 start.classList.toggle("is-running",started);
 start.disabled=!state.ready||finished;
 pause.textContent=started&&paused?"继续":"暂停";
 pause.disabled=!state.ready||!started||finished;
 next.disabled=!state.ready;
 renderOptions();
 syncUrgentTools?.();
 root.dataset.gsPaused=String(paused);
 if(finished)showNotice("本局结束",true);
 else if(started&&paused)showNotice("已暂停",true);
 else if(!paused||!started)clearPersistentNotice();
}
window.addEventListener("message",event=>{
 if(event.source!==window.parent)return;
 const message=event.data;
 if(!message||message.channel!=="gamestation"||message.protocolVersion!==1||message.gameId!==gameId)return;
 if(message.type==="INIT"){
  initHud(message.payload||{});
  enhancePageActions();
  const hasActions=!!root.querySelector(".game-tools button,.game-tools select,.game-tools input,.game-tools summary");
  window.GameBridge?.send("TOOLS_META",{hasActions});
  return;
 }
 if(message.type==="HUD_STATE"){updateHud(message.payload||{});return;}
 if(message.type==="HUD_NOTICE"&&message.payload?.message)showNotice(message.payload.message,false);
});
window.addEventListener("resize",()=>{if(notice&&!notice.hidden)positionNotice();});
let lastToolsExpanded=null;
new MutationObserver(()=>{
 const expanded=root.classList.contains("gs-tools-open");
 if(expanded!==lastToolsExpanded){
  lastToolsExpanded=expanded;
  window.GameBridge?.send("TOOLS_STATE",{expanded});
 }
}).observe(root,{attributes:true,attributeFilter:["class"]});
setup();
})();