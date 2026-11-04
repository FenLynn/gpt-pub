(function(){
"use strict";
const handEl=document.getElementById("hand"),status=document.getElementById("status");let wall=[],hands=[],discards=[],phase="draw",paused=false,over=false,turn=0;
const types=[];["万","筒","条"].forEach(s=>{for(let n=1;n<=9;n++)types.push(n+s);});["东","南","西","北","中","发","白"].forEach(s=>types.push(s));
function makeWall(){const a=[];types.forEach(t=>{for(let i=0;i<4;i++)a.push(t);});for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function report(t){status.textContent=t;GameBridge.report(t,{score:hands[0]?.length||0});document.getElementById("hint").textContent=t;}
function counts(t){return hands[0].filter(x=>x===t).length;}
function canHu(hand){if(hand.length%3!==2)return false;const c={};hand.forEach(t=>c[t]=(c[t]||0)+1);function meld(){const t=Object.keys(c).find(k=>c[k]>0);if(!t)return true;if(c[t]>=3){c[t]-=3;if(meld())return true;c[t]+=3;}if(/^[1-9][万筒条]$/.test(t)){const n=Number(t[0]),s=t.slice(1);if(n<=7&&c[(n+1)+s]>0&&c[(n+2)+s]>0){c[t]--;c[(n+1)+s]--;c[(n+2)+s]--;if(meld())return true;c[t]++;c[(n+1)+s]++;c[(n+2)+s]++;}}return false;}for(const t of Object.keys(c))if(c[t]>=2){c[t]-=2;if(meld())return true;c[t]+=2;}return false;}
function render(){handEl.innerHTML="";hands[0].forEach((t,i)=>{const b=document.createElement("button");b.className="playing-card";b.style.width="38px";b.style.height="52px";b.textContent=t;b.onclick=()=>discard(i);handEl.appendChild(b);});document.getElementById("wall").textContent=wall.length;document.getElementById("handCount").textContent=hands[0].length;document.getElementById("table").innerHTML=hands.slice(1).map((h,i)=>'<span class="metric-pill">AI '+(i+1)+' <strong>'+h.length+' 张</strong></span>').join("");}
function newGame(){wall=makeWall();hands=[[],[],[],[]];discards=[[],[],[],[]];for(let r=0;r<13;r++)for(let p=0;p<4;p++)hands[p].push(wall.pop());phase="draw";turn=0;paused=false;over=false;render();report("你的回合 · 先摸牌");}
function discard(i){if(paused||over||phase!=="discard")return;const t=hands[0].splice(i,1)[0];discards[0].push(t);render();phase="ai";report("你打出 "+t+" · AI 轮流摸打");setTimeout(aiRound,350);}
function aiRound(){if(paused||over)return;for(let p=1;p<4;p++){if(!wall.length){over=true;report("牌墙已空 · 流局");GameBridge.send("GAME_OVER",{message:"麻将流局"});return;}hands[p].push(wall.pop());if(canHu(hands[p])){over=true;report("AI "+p+" 胡牌");GameBridge.send("GAME_OVER",{message:"AI "+p+" 胡牌"});return;}const i=Math.floor(Math.random()*hands[p].length);discards[p].push(hands[p].splice(i,1)[0]);}phase="draw";render();report("你的回合 · 摸牌");}
document.getElementById("draw").onclick=()=>{if(paused||over||phase!=="draw"||!wall.length)return;hands[0].push(wall.pop());phase="discard";render();report(canHu(hands[0])?"可以自摸，或打出一张牌":"选择一张牌打出");};
document.getElementById("hu").onclick=()=>{if(phase==="discard"&&canHu(hands[0])){over=true;report("自摸胡牌！");GameBridge.send("GAME_OVER",{message:"自摸胡牌"});}else report("当前手牌不满足基础胡牌结构");};
document.getElementById("reset").onclick=newGame;
GameBridge.register({init:newGame,newGame,pause(){paused=true;report("已暂停");},resume(){paused=false;report("继续牌局");},dispose(){paused=true;}});
})();