(function(){
"use strict";
const allIcons=["🍀","🌙","🎈","🍉","🚀","🎧","🐳","🌻","🧩","⭐","🍄","🪁"],boardEl=document.getElementById("board"),status=document.getElementById("status");
let cards=[],opened=[],matched=0,moves=0,locked=false,paused=false,tick=null,flipTimer=null,seconds=0,pairCount=8,difficulty="normal";
function report(t){status.textContent=t;GameBridge.report(t,{score:Math.max(0,10000-moves*10-seconds*3)});}
function timeText(){return Math.floor(seconds/60)+":"+String(seconds%60).padStart(2,"0");}
function render(){
 boardEl.innerHTML="";
 const cols=pairCount<=6?3:pairCount<=8?4:6;
 boardEl.style.gridTemplateColumns="repeat("+cols+",minmax(0,1fr))";
 cards.forEach((c,i)=>{
  const card=document.createElement("button");card.type="button";
  card.className="game-cell memory-card "+(c.matched?"matched":c.open?"revealed":"face-down");
  card.textContent=c.open||c.matched?c.icon:"✦";
  card.disabled=c.matched||c.open||paused;
  card.setAttribute("aria-label",c.matched?"已匹配":c.open?"已翻开":"未翻开");
  card.addEventListener("click",()=>flip(i));boardEl.appendChild(card);
 });
 document.getElementById("moves").textContent=moves;
 document.getElementById("pairs").textContent=matched+" / "+pairCount;
 document.getElementById("time").textContent=timeText();
}
function stopClock(){if(tick!==null)clearInterval(tick);tick=null;}
function startClock(){if(tick!==null||paused||matched===pairCount)return;tick=setInterval(()=>{seconds++;document.getElementById("time").textContent=timeText();},1000);}
function configure(v){difficulty=v||"normal";pairCount=difficulty==="easy"?6:difficulty==="hard"?12:8;}
function newGame(){stopClock();clearTimeout(flipTimer);const icons=allIcons.slice(0,pairCount);cards=[...icons,...icons].map((icon,i)=>({icon,key:i,open:false,matched:false}));for(let i=cards.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[cards[i],cards[j]]=[cards[j],cards[i]];}opened=[];matched=0;moves=0;seconds=0;locked=false;paused=false;render();report("翻开两张卡片开始");}
function flip(i){if(paused||locked||cards[i].open||cards[i].matched)return;startClock();cards[i].open=true;opened.push(i);if(opened.length===2){moves++;const [a,b]=opened;if(cards[a].icon===cards[b].icon){cards[a].matched=cards[b].matched=true;matched++;opened=[];if(matched===pairCount){stopClock();const score=Math.max(0,10000-moves*10-seconds*3);report("全部配对成功！");GameBridge.send("GAME_OVER",{message:"记忆挑战完成 · "+moves+" 步",score,win:true});}else report("配对成功");}else{locked=true;report("不一样，再记住位置");flipTimer=setTimeout(()=>{cards[a].open=cards[b].open=false;opened=[];locked=false;render();},750);}}render();}
// Test-only deterministic fixture API. It is not exposed in normal gameplay.
if(new URLSearchParams(location.search).has("p111Test")){
 const fixtureState=()=>({cards:cards.map(c=>({icon:c.icon,open:c.open,matched:c.matched})),opened:opened.slice(),matched,moves,locked,paused,seconds,pairCount});
 window.__p111MemoryTest={
  loadDeck(icons){
   if(!Array.isArray(icons)||!icons.length||icons.some(v=>typeof v!=="string"))throw new Error("Invalid Memory fixture");
   stopClock();clearTimeout(flipTimer);flipTimer=null;pairCount=icons.length;cards=icons.concat(icons).map(icon=>({icon,open:false,matched:false}));opened=[];matched=0;moves=0;locked=false;paused=false;seconds=0;render();report("测试牌组");return fixtureState();
  },
  state:fixtureState,
  flip(i){flip(i);return fixtureState();}
 };
}
GameBridge.register({init(p){configure(p.difficulty);newGame();},newGame,pause(){paused=true;report("已暂停");render();},resume(){paused=false;if(seconds>0||moves>0||opened.length>0||matched>0)startClock();report("继续挑战");render();},setDifficulty(v){configure(v);},snapshot(){return{cards:cards.map(c=>({...c})),opened:opened.slice(),matched,moves,seconds,pairCount,difficulty,locked};},restore(s){if(!s||!Array.isArray(s.cards)||!s.cards.length)throw new Error("记忆翻牌存档数据无效");stopClock();clearTimeout(flipTimer);flipTimer=null;cards=s.cards.map(c=>({icon:String(c.icon),key:Number(c.key),open:!!c.open,matched:!!c.matched}));opened=Array.isArray(s.opened)?s.opened.map(Number):[];matched=Math.max(0,Number(s.matched)||0);moves=Math.max(0,Number(s.moves)||0);seconds=Math.max(0,Number(s.seconds)||0);pairCount=Math.max(1,Number(s.pairCount)||Math.floor(cards.length/2));difficulty=s.difficulty||difficulty;locked=!!s.locked;paused=true;render();if(locked&&opened.length===2){const [a,b]=opened;flipTimer=setTimeout(()=>{if(cards[a]&&cards[b]){cards[a].open=cards[b].open=false;}opened=[];locked=false;render();},750);}report("已恢复上次进度");},dispose(){paused=true;stopClock();clearTimeout(flipTimer);}});
})();