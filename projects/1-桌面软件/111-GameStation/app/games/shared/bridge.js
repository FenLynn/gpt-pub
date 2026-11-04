(function(){
"use strict";
const root=document.getElementById("game");
const gameId=document.body.dataset.game||root?.dataset.game;
const native={
 setTimeout:window.setTimeout.bind(window),
 clearTimeout:window.clearTimeout.bind(window),
 requestAnimationFrame:window.requestAnimationFrame.bind(window),
 cancelAnimationFrame:window.cancelAnimationFrame.bind(window)
};
let handlers={},sessionId=null,disposed=false,timerPaused=false,nextTimerId=1;
const timers=new Map();
function arm(record){
 if(timerPaused||disposed||!timers.has(record.id))return;
 if(record.kind==="raf"){
  record.due=performance.now();
  record.nativeId=native.requestAnimationFrame(ts=>{
   record.nativeId=null;
   if(timerPaused||disposed||!timers.has(record.id))return;
   timers.delete(record.id);
   record.callback(ts);
  });
  return;
 }
 record.due=performance.now()+record.remaining;
 record.nativeId=native.setTimeout(()=>{
  record.nativeId=null;
  if(timerPaused||disposed||!timers.has(record.id))return;
  if(record.kind==="timeout")timers.delete(record.id);
  else record.remaining=record.delay;
  try{record.callback.apply(window,record.args);}
  finally{if(record.kind==="interval"&&timers.has(record.id)&&!timerPaused&&!disposed)arm(record);}
 },record.remaining);
}
function createTimer(kind,callback,delay,args){
 if(typeof callback!=="function")return native.setTimeout(callback,delay);
 const id=nextTimerId++;
 const record={id,kind,callback,args:args||[],delay:Math.max(0,Number(delay)||0),remaining:Math.max(0,Number(delay)||0),nativeId:null,due:0};
 timers.set(id,record);arm(record);return id;
}
function cancelTimer(id){
 const record=timers.get(id);
 if(!record){native.clearTimeout(id);return;}
 if(record.nativeId!==null){
  if(record.kind==="raf")native.cancelAnimationFrame(record.nativeId);
  else native.clearTimeout(record.nativeId);
 }
 timers.delete(id);
}
function suspendTimers(){
 if(timerPaused)return;
 timerPaused=true;
 const now=performance.now();
 for(const record of timers.values()){
  if(record.nativeId!==null){
   if(record.kind==="raf"){native.cancelAnimationFrame(record.nativeId);record.remaining=0;}
   else{record.remaining=Math.max(0,record.due-now);native.clearTimeout(record.nativeId);}
   record.nativeId=null;
  }
 }
}
function resumeTimers(){
 if(!timerPaused||disposed)return;
 timerPaused=false;
 for(const record of timers.values())arm(record);
}
function disposeTimers(){
 disposed=true;timerPaused=true;
 for(const record of timers.values()){
  if(record.nativeId!==null){
   if(record.kind==="raf")native.cancelAnimationFrame(record.nativeId);
   else native.clearTimeout(record.nativeId);
  }
 }
 timers.clear();
}
window.setTimeout=function(callback,delay,...args){return createTimer("timeout",callback,delay,args);};
window.clearTimeout=cancelTimer;
window.setInterval=function(callback,delay,...args){return createTimer("interval",callback,delay,args);};
window.clearInterval=cancelTimer;
window.requestAnimationFrame=function(callback){return createTimer("raf",callback,0,[]);};
window.cancelAnimationFrame=cancelTimer;
function send(type,payload={}){
 if(disposed)return;
 window.parent.postMessage({channel:"gamestation",protocolVersion:1,gameId,sessionId,type,payload},"*");
}
function report(status,extra={}){send("STATE",{status,...extra});}
function safeCall(name,...args){if(typeof handlers[name]==="function")return handlers[name](...args);}
window.addEventListener("message",event=>{
 if(event.source!==window.parent)return;
 const m=event.data;
 if(!m||m.channel!=="gamestation"||m.protocolVersion!==1||m.gameId!==gameId)return;
 if(m.type==="INIT"){
  sessionId=m.payload?.sessionId||null;
  safeCall("init",m.payload||{});
  return;
 }
 if(m.sessionId!==sessionId)return;
 if(m.type==="NEW_GAME"){
  suspendTimers();safeCall("newGame");safeCall("pause");
 }else if(m.type==="PAUSE"){
  suspendTimers();safeCall("pause");
 }else if(m.type==="RESUME"){
  resumeTimers();safeCall("resume");
 }else if(m.type==="SET_DIFFICULTY"){
  suspendTimers();safeCall("setDifficulty",m.payload?.difficulty);safeCall("pause");
 }else if(m.type==="SET_MODE"){
  suspendTimers();safeCall("setMode",m.payload?.mode);safeCall("pause");
 }else if(m.type==="SET_OPTIONS"){
  suspendTimers();safeCall("setOptions",m.payload||{});safeCall("pause");
 }else if(m.type==="LOAD_STATE"){
  suspendTimers();safeCall("loadState",m.payload||{});safeCall("pause");
 }else if(m.type==="DISPOSE"){
  suspendTimers();safeCall("dispose");disposeTimers();
 }
});
window.GameBridge={
 register(value){handlers=value||{};send("READY");},
 send,report,gameId,
 now(){return performance.now();},
 get paused(){return timerPaused;}
};
})();