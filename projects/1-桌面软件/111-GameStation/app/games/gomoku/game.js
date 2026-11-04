(function(){
"use strict";
const N=15,board=Array.from({length:N},()=>Array(N).fill(0)),el=document.getElementById("board"),status=document.getElementById("status"),undoButton=document.getElementById("undoButton");
let mode="ai",turn=1,over=false,paused=false,difficulty="normal",history=[],aiTimer=null;
function setStatus(t){status.textContent=t;GameBridge.report(t,{score:history.length});}
function render(){el.innerHTML="";for(let y=0;y<N;y++)for(let x=0;x<N;x++){const b=document.createElement("button");b.className="gomoku-cell";b.type="button";b.setAttribute("aria-label",(x+1)+"列 "+(y+1)+"行");if(board[y][x]){const s=document.createElement("span");s.className="stone "+(board[y][x]===1?"black":"white");b.appendChild(s);}b.addEventListener("click",()=>play(x,y));el.appendChild(b);}}
function winAt(x,y,p){const dirs=[[1,0],[0,1],[1,1],[1,-1]];return dirs.some(([dx,dy])=>{let n=1;for(let k=1;k<5;k++){const a=x+dx*k,b=y+dy*k;if(a<0||a>=N||b<0||b>=N||board[b][a]!==p)break;n++;}for(let k=1;k<5;k++){const a=x-dx*k,b=y-dy*k;if(a<0||a>=N||b<0||b>=N||board[b][a]!==p)break;n++;}return n>=5;});}
function candidates(){const set=new Set();for(let y=0;y<N;y++)for(let x=0;x<N;x++)if(board[y][x])for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const a=x+dx,b=y+dy;if(a>=0&&a<N&&b>=0&&b<N&&!board[b][a])set.add(b*N+a);}if(!set.size)set.add(7*N+7);return [...set].map(v=>[v%N,Math.floor(v/N)]);}
function lineScore(x,y,p){let total=0;for(const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]){let count=1,open=0;for(const sign of [-1,1]){let a=x+dx*sign,b=y+dy*sign;while(a>=0&&a<N&&b>=0&&b<N&&board[b][a]===p){count++;a+=dx*sign;b+=dy*sign;}if(a>=0&&a<N&&b>=0&&b<N&&!board[b][a])open++;}const weight=count>=5?1000000:count===4?(open===2?30000:6000):count===3?(open===2?1800:260):count===2?(open===2?160:35):4;total+=weight;}return total;}
function scoreAt(x,y,p){board[y][x]=p;const s=lineScore(x,y,p);board[y][x]=0;return s;}
function chooseAI(){const list=candidates();if(difficulty==="easy"){const scored=list.map(([x,y])=>({x,y,s:scoreAt(x,y,-1)+scoreAt(x,y,1)*.75})).sort((a,b)=>b.s-a.s).slice(0,Math.min(10,list.length));const pick=scored[Math.floor(Math.random()*scored.length)];return [pick.x,pick.y];}
 let best=null,bestValue=-Infinity;for(const [x,y] of list){board[y][x]=-1;const attack=lineScore(x,y,-1);if(attack>=1000000){board[y][x]=0;return [x,y];}board[y][x]=0;board[y][x]=1;const defense=lineScore(x,y,1);board[y][x]=0;let value=attack+defense*1.18;
 if(difficulty==="hard"){board[y][x]=-1;let threat=0;for(const [ox,oy] of candidates())threat=Math.max(threat,scoreAt(ox,oy,1));board[y][x]=0;value=attack*1.08+defense*1.35-threat*.92;}
 value+=Math.random()*.01;if(value>bestValue){bestValue=value;best=[x,y];}}
 return best||[7,7];}
function finish(p){over=true;const msg=p===1?"黑棋获胜！":"白棋获胜！";setStatus(msg);GameBridge.send("GAME_OVER",{message:p===1?"黑棋获胜":"白棋获胜",score:history.length,win:p===1});}
function place(x,y,p){if(board[y][x]||over)return false;board[y][x]=p;history.push({x,y,p});render();if(winAt(x,y,p)){finish(p);return true;}if(history.length===N*N){over=true;setStatus("平局");GameBridge.send("GAME_OVER",{message:"平局",score:history.length,win:false});return true;}return true;}
function scheduleAI(){clearTimeout(aiTimer);if(paused||over||mode!=="ai"||turn!==-1)return;aiTimer=setTimeout(()=>{if(paused||over||turn!==-1)return;const [x,y]=chooseAI();place(x,y,-1);turn=1;if(!over)setStatus("轮到你了 · 黑棋");},difficulty==="easy"?240:difficulty==="normal"?360:480);}
function play(x,y){if(paused||over||turn!==1)return;if(!place(x,y,1))return;if(mode==="ai"){turn=-1;setStatus("AI 思考中");scheduleAI();}else{turn=-1;setStatus("轮到白棋");}}
function newGame(){clearTimeout(aiTimer);for(let y=0;y<N;y++)board[y].fill(0);history=[];turn=1;over=false;paused=false;render();setStatus(mode==="ai"?"你执黑棋，请落子":"黑棋先行");}
function undo(){if(!history.length||over)return;clearTimeout(aiTimer);const count=mode==="ai"?Math.min(turn===-1?1:2,history.length):1;for(let i=0;i<count;i++){const m=history.pop();board[m.y][m.x]=0;}turn=1;render();setStatus("已悔棋");}
undoButton.addEventListener("click",undo);
GameBridge.register({init(p){difficulty=p.difficulty||"normal";mode=p.mode||"ai";newGame();},newGame,pause(){paused=true;clearTimeout(aiTimer);setStatus("已暂停");},resume(){paused=false;if(turn===-1&&mode==="ai")scheduleAI();else setStatus(turn===1?"轮到你了":"轮到白棋");},setMode(v){mode=v==="two"?"two":"ai";newGame();},setDifficulty(v){difficulty=v||"normal";},dispose(){clearTimeout(aiTimer);}});
})();