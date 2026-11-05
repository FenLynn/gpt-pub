/* P111 R16 · iframe-local unified controls; no external game rails. */
(function(){
"use strict";
const root=document.getElementById("game");if(!root)return;
const gameId=document.body.dataset.game;
const sheet=document.createElement("link");sheet.rel="stylesheet";sheet.href="../shared/workspace.css";document.head.appendChild(sheet);
root.classList.remove("rail-collapsed");root.dataset.workspace="r16";
let hud=null,menu=null,state={};
function send(action,detail={}){window.GameBridge?.send("CONTROL",{action,...detail});}
function setup(){
 if(hud)return;
 hud=document.createElement("section");hud.className="gs-hud";hud.id="gs-hud";hud.setAttribute("aria-label","游戏内控制");
 hud.innerHTML='<div class="gs-hud-left"><strong class="gs-hud-name"></strong><span class="gs-hud-status" id="gs-hud-status">准备开始</span></div><div class="gs-hud-controls"><div class="gs-hud-options" id="gs-options"></div><time class="gs-hud-time" id="gs-hud-time">00:00</time><button type="button" class="gs-hud-button" data-action="start" id="gs-start">开始</button><button type="button" class="gs-hud-button" data-action="pause" id="gs-pause">暂停</button><button type="button" class="gs-hud-button" data-action="new" id="gs-next">新局</button><button type="button" class="gs-hud-button" data-action="tools" id="gs-tools" aria-expanded="false">工具</button><button type="button" class="gs-hud-button" data-action="help" id="gs-help">帮助</button></div>';
 root.prepend(hud);menu=hud.querySelector("#gs-tools");
 const side=root.querySelector(".game-tools");menu.hidden=!side?.querySelector("button,select,input,summary");
 hud.addEventListener("click",event=>{
  const button=event.target.closest("button[data-action]");if(!button)return;
  const action=button.dataset.action;
  if(action==="tools"){const open=root.classList.toggle("gs-tools-open");menu.setAttribute("aria-expanded",String(open));return;}
  if(action==="help")send("help");else if(action==="pause")send("toggle");else send(action);
 });
 hud.addEventListener("change",event=>{
  const el=event.target;
  if(el.id==="gs-mode")send("mode",{index:Number(el.value)});
  if(el.id==="gs-difficulty")send("difficulty",{value:el.value});
 });
 document.addEventListener("contextmenu",event=>{if(root.contains(event.target))event.preventDefault();},true);
 const status=document.getElementById("status");
 if(status){
  const sync=()=>{const t=status.textContent.trim();if(hud&&t&&!state.paused&&!state.finished)hud.querySelector("#gs-hud-status").textContent=t;};
  new MutationObserver(sync).observe(status,{childList:true,characterData:true,subtree:true});sync();
 }
 const alerts=["responseBar","tianxiangPanel","savePanel","claimBar","bidControls","pendingActions"].map(id=>document.getElementById(id)).filter(Boolean);
 if(side&&alerts.length){
  const sync=()=>{
   const urgent=alerts.some(el=>el.offsetHeight>0&&getComputedStyle(el).visibility!=="hidden"&&getComputedStyle(el).display!=="none");
   if(urgent){root.classList.add("gs-tools-open");menu.hidden=false;menu.setAttribute("aria-expanded","true");}
  };
  alerts.forEach(el=>new MutationObserver(sync).observe(el,{childList:true,subtree:true,attributes:true}));
 }
}
function initHud(p){
 setup();hud.querySelector(".gs-hud-name").textContent=String(p?.name||document.title);
 const opts=hud.querySelector("#gs-options");opts.replaceChildren();
 if(Array.isArray(p?.modes)&&p.modes.length>1){
  const el=document.createElement("select");el.id="gs-mode";el.className="gs-hud-select";el.setAttribute("aria-label","对战模式");
  p.modes.forEach((label,i)=>el.add(new Option(label,String(i))));opts.appendChild(el);
 }
 if(p?.hasDifficulty){
  const el=document.createElement("select");el.id="gs-difficulty";el.className="gs-hud-select";el.setAttribute("aria-label","游戏难度");
  const labels=p.difficultyLabels||["简单","中等","困难"];
  labels.forEach((label,i)=>el.add(new Option(label,["easy","normal","hard"][i]||"hard")));
  el.value=p.difficulty||"normal";opts.appendChild(el);
 }
 const guide=root.querySelector(".game-guide");
 const lines=guide?[...guide.querySelectorAll(".key-instruction")].map(el=>el.innerText.trim().replace(/\s+/g," ")):[];
 const note=root.querySelector(".game-tool-note")?.innerText?.trim()||"";
 window.GameBridge?.send("HELP_SOURCE",{lines,note});
}
function updateHud(p){
 setup();state=p||{};
 const started=!!state.started,paused=!!state.paused,finished=!!state.finished;
 const start=hud.querySelector("#gs-start"),pause=hud.querySelector("#gs-pause"),next=hud.querySelector("#gs-next");
 start.textContent=started?"结束":"开始";start.classList.toggle("is-running",started);
 start.disabled=!state.ready||finished;
 pause.textContent=paused?"继续":"暂停";pause.disabled=!state.ready||finished;
 next.disabled=!state.ready;
 hud.querySelector("#gs-hud-time").textContent=state.elapsed||"00:00";
 const mode=hud.querySelector("#gs-mode"),diff=hud.querySelector("#gs-difficulty");
 if(mode)mode.value=String(state.modeIndex||0);
 if(diff)diff.value=state.difficulty||"normal";
 if(finished)hud.querySelector("#gs-hud-status").textContent="本局结束";
 else if(paused)hud.querySelector("#gs-hud-status").textContent=started?"已暂停":"待开始";
 root.dataset.gsPaused=String(paused);
}
window.addEventListener("message",event=>{
 if(event.source!==window.parent)return;
 const m=event.data;
 if(!m||m.channel!=="gamestation"||m.protocolVersion!==1||m.gameId!==gameId)return;
 if(m.type==="INIT"){initHud(m.payload||{});return;}
 if(m.type==="HUD_STATE"){updateHud(m.payload||{});return;}
 if(m.type==="HUD_NOTICE"){setup();if(m.payload?.message)hud.querySelector("#gs-hud-status").textContent=String(m.payload.message);}
});
setup();
})();