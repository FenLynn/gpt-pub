(function(){
"use strict";
const root=document.getElementById("game");
const gameId=document.body.dataset.game||root?.dataset.game;
let handlers={},sessionId=null,disposed=false;
function send(type,payload={}){if(disposed)return;window.parent.postMessage({channel:"gamestation",protocolVersion:1,gameId,sessionId,type,payload},"*");}
function report(status,extra={}){send("STATE",{status,...extra});}
window.addEventListener("message",event=>{
 if(event.source!==window.parent)return;
 const m=event.data;
 if(!m||m.channel!=="gamestation"||m.protocolVersion!==1||m.gameId!==gameId)return;
 if(m.type==="INIT"){sessionId=m.payload?.sessionId||null;handlers.init?.(m.payload||{});return;}
 if(m.sessionId!==sessionId)return;
 if(m.type==="NEW_GAME")handlers.newGame?.();
 else if(m.type==="PAUSE")handlers.pause?.();
 else if(m.type==="RESUME")handlers.resume?.();
 else if(m.type==="SET_DIFFICULTY")handlers.setDifficulty?.(m.payload?.difficulty);
 else if(m.type==="DISPOSE"){disposed=true;handlers.dispose?.();}
});
window.GameBridge={register(value){handlers=value||{};send("READY");},send,report,gameId};
})();