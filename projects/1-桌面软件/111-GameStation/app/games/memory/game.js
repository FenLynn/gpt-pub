(function(){
"use strict";
const allIcons=window.GameMemoryArt?.icons||["🐱","🐶","🐰","🐻","🐼","🦊","🐸","🐥","🐷","🐨","🐧","🐹"];
const boardEl=document.getElementById("board"),status=document.getElementById("status");
let cards=[],opened=[],matched=0,moves=0,locked=false,paused=false,over=false;
let tick=null,flipTimer=null,resultTimer=null,animationTimer=null,resizeObserver=null,seconds=0,hostElapsedMs=null,gameplayStarted=false,pairCount=8,difficulty="normal";
let flipAnimationIndices=new Set(),matchedAnimationIndices=new Set(),closingAnimationIndices=new Set();
function report(t){status.textContent=t;GameBridge.report(t,{score:Math.max(0,10000-moves*10-seconds*3)});}
function timeText(){return Math.floor(seconds/60)+":"+String(seconds%60).padStart(2,"0");}
function colsForCount(count){return count<=6?3:count<=8?4:6;}
function fitBoard(){
 const area=boardEl.closest(".game-main-board");if(!area)return;
 const rect=area.getBoundingClientRect(),cols=colsForCount(pairCount),rows=Math.ceil(cards.length/cols);
 const gap=Math.max(8,Math.min(16,Math.floor(Math.min(rect.width,rect.height)*.014)));
 const maxW=Math.max(0,rect.width*.9),maxH=Math.max(0,rect.height*.86);
 const cell=Math.max(0,Math.min(180,(maxW-gap*(cols-1))/cols,(maxH-gap*(rows-1))/rows));
 if(!cell)return;
 boardEl.style.width=(cell*cols+gap*(cols-1))+"px";
 boardEl.style.height=(cell*rows+gap*(rows-1))+"px";
 boardEl.style.setProperty("--memory-gap",gap+"px");
}
function clearAnimations(){
 if(animationTimer!==null){clearTimeout(animationTimer);animationTimer=null;}
 flipAnimationIndices.clear();matchedAnimationIndices.clear();closingAnimationIndices.clear();
}
function animateCards({flip=[],matched=[],closing=[]}={}){
 clearAnimations();
 flipAnimationIndices=new Set(flip);matchedAnimationIndices=new Set(matched);closingAnimationIndices=new Set(closing);
 animationTimer=setTimeout(()=>{flipAnimationIndices.clear();matchedAnimationIndices.clear();closingAnimationIndices.clear();animationTimer=null;},700);
}
function render(){
 boardEl.replaceChildren();
 const cols=colsForCount(pairCount),rows=Math.ceil(cards.length/cols);
 boardEl.style.gridTemplateColumns="repeat("+cols+",minmax(0,1fr))";
 boardEl.style.gridTemplateRows="repeat("+rows+",minmax(0,1fr))";
 boardEl.classList.toggle("memory-complete",matched===pairCount);
 cards.forEach((c,i)=>{
  const card=document.createElement("button");card.type="button";
  card.className="game-cell memory-card "+(c.matched?"matched":c.open?"revealed":"face-down");
  if(flipAnimationIndices.has(i))card.classList.add("is-flipping");
  if(matchedAnimationIndices.has(i))card.classList.add("is-matched-pop");
  if(closingAnimationIndices.has(i))card.classList.add("is-closing");
  card.dataset.index=String(i);card.style.setProperty("--memory-index",String(i));
  card.style.setProperty("--memory-win-delay",Math.min(850,i*28)+"ms");
  const face=(c.open||c.matched)?window.GameMemoryArt?.face(c.icon):null;
  const palette=window.GameMemoryArt?.colors(c.icon);
  if(palette){card.style.setProperty("--memory-card-tint",palette.tint);card.style.setProperty("--memory-card-accent",palette.accent);}
  if(face)card.innerHTML=face;
  else if(c.open||c.matched)card.textContent=c.icon;
  else card.innerHTML=window.GameMemoryArt?.back||"";
  card.disabled=c.matched||c.open||paused||over;
  const label=window.GameMemoryArt?.named(c.icon)||c.icon;
  card.setAttribute("aria-label",c.matched?"已匹配 "+label:c.open?"已翻开 "+label:"未翻开");
  card.addEventListener("click",()=>flip(i));boardEl.appendChild(card);
 });
 document.getElementById("moves").textContent=moves;
 document.getElementById("pairs").textContent=matched+" / "+pairCount;
 document.getElementById("time").textContent=timeText();
 fitBoard();
}
function stopClock(){if(tick!==null)clearInterval(tick);tick=null;}
function startClock(){if(tick!==null||paused||over||matched===pairCount||hostElapsedMs!==null)return;tick=setInterval(()=>{seconds++;document.getElementById("time").textContent=timeText();},1000);}
window.addEventListener("message",event=>{
 if(event.source!==window.parent)return;
 const m=event.data;
 if(m?.channel!=="gamestation"||m.protocolVersion!==1||m.gameId!=="memory"||m.type!=="HUD_STATE")return;
 const match=/^(\d+):(\d{2})$/.exec(String(m.payload?.elapsed||""));
 if(!match)return;
 hostElapsedMs=(Number(match[1])*60+Number(match[2]))*1000;
 seconds=Math.floor(hostElapsedMs/1000);
 if(tick!==null){clearInterval(tick);tick=null;}
 document.getElementById("time").textContent=timeText();
});
function configure(v){difficulty=["easy","normal","hard"].includes(v)?v:"normal";pairCount=difficulty==="easy"?6:difficulty==="hard"?12:8;}
function newGame(){
 stopClock();clearTimeout(flipTimer);clearTimeout(resultTimer);flipTimer=resultTimer=null;clearAnimations();
 const icons=allIcons.slice(0,pairCount);
 cards=[...icons,...icons].map((icon,i)=>({icon,key:i,open:false,matched:false}));
 for(let i=cards.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[cards[i],cards[j]]=[cards[j],cards[i]];}
 opened=[];matched=0;moves=0;seconds=0;hostElapsedMs=null;gameplayStarted=false;locked=false;paused=false;over=false;
 render();report("翻开两张卡片开始");
}
function finishGame(){
 if(over)return;
 over=true;stopClock();GameBridge.send("CLOCK_STOP");
 const score=Math.max(0,10000-moves*10-seconds*3);
 report("全部配对成功！");
 render();
 resultTimer=setTimeout(()=>{resultTimer=null;GameBridge.send("GAME_OVER",{message:"记忆挑战完成 · "+moves+" 步",score,win:true});},1600);
}
function flip(i){
 if(paused||over||locked||!cards[i]||cards[i].open||cards[i].matched)return;
 if(!gameplayStarted){gameplayStarted=true;GameBridge.send("CLOCK_START");}
 startClock();cards[i].open=true;opened.push(i);
 if(opened.length===2){
  moves++;const [a,b]=opened;
  if(cards[a].icon===cards[b].icon){
   cards[a].matched=cards[b].matched=true;matched++;opened=[];
   animateCards({matched:[a,b]});
   if(matched===pairCount){finishGame();return;}
   report("配对成功");
  }else{
   locked=true;animateCards({flip:[a,b]});report("不一样，再记住位置");
   flipTimer=setTimeout(()=>{
    cards[a].open=cards[b].open=false;opened=[];locked=false;flipTimer=null;
    animateCards({closing:[a,b]});render();
   },750);
  }
 }else{
  animateCards({flip:[i]});
 }
 render();
}
if(new URLSearchParams(location.search).has("p111Test")){
 const fixtureState=()=>({cards:cards.map(c=>({icon:c.icon,open:c.open,matched:c.matched})),opened:opened.slice(),matched,moves,locked,paused,over,seconds,pairCount,resultPending:resultTimer!==null});
 window.__p111MemoryTest={
  loadDeck(icons){
   if(!Array.isArray(icons)||!icons.length||icons.some(v=>typeof v!=="string"))throw new Error("Invalid Memory fixture");
   stopClock();clearTimeout(flipTimer);clearTimeout(resultTimer);flipTimer=resultTimer=null;clearAnimations();
   pairCount=icons.length;cards=icons.concat(icons).map(icon=>({icon,key:icon,open:false,matched:false}));
   opened=[];matched=0;moves=0;locked=false;paused=false;over=false;seconds=0;hostElapsedMs=null;gameplayStarted=false;render();report("测试牌组");return fixtureState();
  },
  state:fixtureState,
  flip(i){flip(i);return fixtureState();}
 };
}
const playArea=boardEl.closest(".game-main-board");
if(typeof ResizeObserver!=="undefined"&&playArea){resizeObserver=new ResizeObserver(fitBoard);resizeObserver.observe(playArea);}
window.addEventListener("resize",fitBoard);
GameBridge.register({
 init(p){configure(p.difficulty);newGame();},
 newGame,
 pause(){paused=true;report("已暂停");render();},
 resume(){paused=false;if(!over&&(seconds>0||moves>0||opened.length>0||matched>0))startClock();report(over?"本局已完成":"继续挑战");render();},
 setDifficulty(v){configure(v);},
 snapshot(){return{cards:cards.map(c=>({...c})),opened:opened.slice(),matched,moves,seconds,elapsedMs:hostElapsedMs===null?seconds*1000:hostElapsedMs,gameplayStarted,pairCount,difficulty,locked,over};},
 restore(s){
  if(!s||!Array.isArray(s.cards)||!s.cards.length)throw new Error("记忆翻牌存档数据无效");
  stopClock();clearTimeout(flipTimer);clearTimeout(resultTimer);flipTimer=resultTimer=null;clearAnimations();
  cards=s.cards.map(c=>({icon:String(c.icon),key:Number(c.key),open:!!c.open,matched:!!c.matched}));
  opened=Array.isArray(s.opened)?s.opened.map(Number).filter(i=>Number.isInteger(i)&&i>=0&&i<cards.length):[];
  matched=Math.max(0,Number(s.matched)||0);moves=Math.max(0,Number(s.moves)||0);seconds=Math.max(0,Number(s.seconds)||0);
  pairCount=Math.max(1,Number(s.pairCount)||Math.floor(cards.length/2));difficulty=["easy","normal","hard"].includes(s.difficulty)?s.difficulty:difficulty;
  locked=!!s.locked;over=!!s.over||matched===pairCount;paused=true;
  gameplayStarted=typeof s.gameplayStarted==="boolean"?s.gameplayStarted:(seconds>0||moves>0||opened.length>0||matched>0);
  hostElapsedMs=Math.max(0,Number(s.elapsedMs)||seconds*1000);seconds=Math.floor(hostElapsedMs/1000);
  render();
  if(locked&&opened.length===2){const [a,b]=opened;flipTimer=setTimeout(()=>{if(cards[a]&&cards[b]){cards[a].open=cards[b].open=false;}opened=[];locked=false;flipTimer=null;render();},750);}
  report(over?"本局已完成":"已恢复上次进度");
 },
 dispose(){
  paused=true;stopClock();clearTimeout(flipTimer);clearTimeout(resultTimer);clearAnimations();
  resizeObserver?.disconnect();window.removeEventListener("resize",fitBoard);
 }
});
})();