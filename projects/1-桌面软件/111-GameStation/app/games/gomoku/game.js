(function(){
"use strict";
const N=15,board=Array.from({length:N},()=>Array(N).fill(0)),el=document.getElementById("board"),status=document.getElementById("status"),undoButton=document.getElementById("undoButton"),boardArea=document.querySelector(".game-main-board");
let boardObserver=null;
function fitBoard(){const host=el.parentElement,size=Math.max(0,Math.min(host.clientWidth,host.clientHeight));if(size>0){el.style.width=size+"px";el.style.height=size+"px";paintGrid();}}
function paintGrid(){
 const cells=el.querySelectorAll(".gomoku-cell");if(cells.length!==N*N||!el.clientWidth||!el.clientHeight)return;
 const rect=el.getBoundingClientRect(),first=cells[0].getBoundingClientRect(),last=cells[N*N-1].getBoundingClientRect();
 const left=first.left-rect.left+first.width/2,top=first.top-rect.top+first.height/2;
 const right=last.left-rect.left+last.width/2,bottom=last.top-rect.top+last.height/2;
 const ns="http:"+"//www.w3.org/2000/svg";let svg=el.querySelector(".gomoku-lines");
 if(!svg){svg=document.createElementNS(ns,"svg");svg.classList.add("gomoku-lines");svg.setAttribute("aria-hidden","true");el.prepend(svg);}
 svg.setAttribute("viewBox","0 0 "+rect.width+" "+rect.height);svg.replaceChildren();
 function add(tag,attrs){const node=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));svg.appendChild(node);}
 for(let i=0;i<N;i++){const pos=left+(right-left)*i/(N-1),yy=top+(bottom-top)*i/(N-1);add("line",{x1:pos,y1:top,x2:pos,y2:bottom});add("line",{x1:left,y1:yy,x2:right,y2:yy});}
 for(const y of [3,7,11])for(const xx of [3,7,11])add("circle",{cx:left+(right-left)*xx/(N-1),cy:top+(bottom-top)*y/(N-1),r:Math.max(2.5,first.width*.073)});
 const ax=el.querySelector(".gomoku-axis-x"),ay=el.querySelector(".gomoku-axis-y");
 if(ax){ax.style.setProperty("left",first.left-rect.left+"px","important");ax.style.setProperty("right",rect.right-last.right+"px","important");}
 if(ay){ay.style.setProperty("top",first.top-rect.top+"px","important");ay.style.setProperty("bottom",rect.bottom-last.bottom+"px","important");}
}
let mode="ai",turn=1,over=false,paused=false,difficulty="normal",history=[],aiTimer=null;
function setStatus(t){status.textContent=t;GameBridge.report(t,{score:history.length});}
function render(){el.innerHTML="";const moveAt=new Map(history.map((m,i)=>[m.y*N+m.x,i+1]));for(let y=0;y<N;y++)for(let x=0;x<N;x++){const b=document.createElement("button");b.className="gomoku-cell";b.type="button";b.setAttribute("aria-label",(x+1)+"列 "+(y+1)+"行");if(board[y][x]){const s=document.createElement("span");s.className="stone "+(board[y][x]===1?"black":"white");const moveNumber=moveAt.get(y*N+x);if(moveNumber){s.textContent=String(moveNumber);s.classList.add("numbered-stone");if(moveNumber===history.length)s.classList.add("latest-stone","stone-arrived");}b.appendChild(s);}b.addEventListener("click",()=>play(x,y));el.appendChild(b);}const axisX=document.createElement("div");axisX.className="gomoku-axis-x";axisX.setAttribute("aria-hidden","true");axisX.innerHTML=Array.from({length:N},(_,i)=>"<span>"+String.fromCharCode(65+i)+"</span>").join("");const axisY=document.createElement("div");axisY.className="gomoku-axis-y";axisY.setAttribute("aria-hidden","true");axisY.innerHTML=Array.from({length:N},(_,i)=>"<span>"+(N-i)+"</span>").join("");el.append(axisX,axisY);fitBoard();}
function winAt(x,y,p){const dirs=[[1,0],[0,1],[1,1],[1,-1]];return dirs.some(([dx,dy])=>{let n=1;for(let k=1;k<5;k++){const a=x+dx*k,b=y+dy*k;if(a<0||a>=N||b<0||b>=N||board[b][a]!==p)break;n++;}for(let k=1;k<5;k++){const a=x-dx*k,b=y-dy*k;if(a<0||a>=N||b<0||b>=N||board[b][a]!==p)break;n++;}return n>=5;});}
function candidates(){const set=new Set();for(let y=0;y<N;y++)for(let x=0;x<N;x++)if(board[y][x])for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const a=x+dx,b=y+dy;if(a>=0&&a<N&&b>=0&&b<N&&!board[b][a])set.add(b*N+a);}if(!set.size)set.add(7*N+7);return [...set].map(v=>[v%N,Math.floor(v/N)]);}
function lineScore(x,y,p){
 let total=0;
 for(const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]){
  let count=1,open=0;
  for(const sign of [-1,1]){
   let a=x+dx*sign,b=y+dy*sign;
   while(a>=0&&a<N&&b>=0&&b<N&&board[b][a]===p){count++;a+=dx*sign;b+=dy*sign;}
   if(a>=0&&a<N&&b>=0&&b<N&&!board[b][a])open++;
  }
  const weight=count>=5?1000000:count===4?(open===2?30000:6000):count===3?(open===2?1800:260):count===2?(open===2?160:35):4;
  total+=weight;
 }
 return total;
}
function patternScore(x,y,p){
 let total=0;
 for(const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]){
  let best=0;
  for(let offset=-4;offset<=0;offset++){
   let own=0,blocked=false;
   for(let i=0;i<5;i++){
    const a=x+(offset+i)*dx,b=y+(offset+i)*dy;
    if(a<0||a>=N||b<0||b>=N){blocked=true;break;}
    const value=board[b][a];
    if(value===-p){blocked=true;break;}
    if(value===p)own++;
   }
   if(blocked)continue;
   const weight=own>=5?1000000:own===4?12000:own===3?900:own===2?65:3;
   best=Math.max(best,weight);
  }
  total+=best;
 }
 return total;
}
function scoreAt(x,y,p){board[y][x]=p;const s=lineScore(x,y,p)+patternScore(x,y,p);board[y][x]=0;return s;}
function wouldWin(x,y,p){board[y][x]=p;const win=winAt(x,y,p);board[y][x]=0;return win;}
function rankedMoves(player,list=candidates(),limit=12){
 return list.map(([x,y])=>({x,y,score:scoreAt(x,y,player),center:14-Math.abs(x-7)-Math.abs(y-7)}))
  .sort((a,b)=>b.score-a.score||b.center-a.center).slice(0,limit);
}
function aiProfile(level=difficulty){
 if(level==="easy")return {strategy:"tactical-random",plies:0,beam:12};
 if(level==="hard")return {strategy:"beam-minimax",plies:3,beam:[12,8,6]};
 return {strategy:"weighted-greedy",plies:1,beam:0};
}
function chooseAI(){
 const list=candidates();
 const ownWins=list.filter(([x,y])=>wouldWin(x,y,-1));
 if(ownWins.length)return rankedMoves(-1,ownWins,1).map(m=>[m.x,m.y])[0];
 const forcedBlocks=list.filter(([x,y])=>wouldWin(x,y,1));
 if(forcedBlocks.length){const block=rankedMoves(-1,forcedBlocks,1)[0];return [block.x,block.y];}
 if(difficulty==="easy"){
  const ranked=rankedMoves(-1,list,12).map(m=>({...m,score:m.score+scoreAt(m.x,m.y,1)*.75}));
  const pool=ranked.slice(0,Math.min(10,ranked.length)),pick=pool[Math.floor(Math.random()*pool.length)];
  return [pick.x,pick.y];
 }
 if(difficulty==="normal"){
  const ranked=list.map(([x,y])=>({x,y,score:scoreAt(x,y,-1)+scoreAt(x,y,1)*1.18,center:14-Math.abs(x-7)-Math.abs(y-7)}))
   .sort((a,b)=>b.score-a.score||b.center-a.center);
  return ranked.length?[ranked[0].x,ranked[0].y]:[7,7];
 }
 let best=null,bestValue=-Infinity;
 for(const move of rankedMoves(-1,list,12)){
  board[move.y][move.x]=-1;
  let worst=Infinity;
  const replies=rankedMoves(1,candidates(),8);
  for(const reply of replies){
   board[reply.y][reply.x]=1;
   if(winAt(reply.x,reply.y,1)){
    worst=-1000000000;board[reply.y][reply.x]=0;break;
   }
   const aiReplies=rankedMoves(-1,candidates(),6);
   const bestReply=aiReplies.length?aiReplies[0].score:0;
   const replyPressure=scoreAt(reply.x,reply.y,1);
   worst=Math.min(worst,bestReply-replyPressure*.28);
   board[reply.y][reply.x]=0;
   if(worst<-100000000)break;
  }
  board[move.y][move.x]=0;
  const value=worst+move.score*.28;
  if(value>bestValue){bestValue=value;best=[move.x,move.y];}
 }
 return best||[7,7];
}
function finish(p){over=true;const msg=p===1?"黑棋获胜！":"白棋获胜！";setStatus(msg);GameBridge.send("GAME_OVER",{message:p===1?"黑棋获胜":"白棋获胜",score:history.length,win:p===1});}
function place(x,y,p){if(board[y][x]||over)return false;board[y][x]=p;history.push({x,y,p});render();if(winAt(x,y,p)){finish(p);return true;}if(history.length===N*N){over=true;setStatus("平局");GameBridge.send("GAME_OVER",{message:"平局",score:history.length,win:false});return true;}return true;}
function scheduleAI(){clearTimeout(aiTimer);if(paused||over||mode!=="ai"||turn!==-1)return;aiTimer=setTimeout(()=>{if(paused||over||turn!==-1)return;const [x,y]=chooseAI();place(x,y,-1);turn=1;if(!over)setStatus("轮到你了 · 黑棋");},difficulty==="easy"?240:difficulty==="normal"?360:480);}
function play(x,y){if(paused||over||(mode==="ai"&&turn!==1))return;const playing=turn;if(!place(x,y,playing))return;if(over)return;turn=-playing;if(mode==="ai"){setStatus("AI 思考中");scheduleAI();}else setStatus(turn===1?"轮到黑棋":"轮到白棋");}
function newGame(){clearTimeout(aiTimer);for(let y=0;y<N;y++)board[y].fill(0);history=[];turn=1;over=false;paused=false;render();setStatus(mode==="ai"?"你执黑棋，请落子":"黑棋先行");}
function undo(){if(!history.length||paused)return;clearTimeout(aiTimer);over=false;const count=mode==="ai"?Math.min(turn===-1?1:2,history.length):1;let lastSide=1;for(let i=0;i<count;i++){const m=history.pop();board[m.y][m.x]=0;lastSide=m.p;}turn=mode==="ai"?1:lastSide;render();setStatus("已悔棋 · "+(turn===1?"轮到黑棋":"轮到白棋"));}
if(new URLSearchParams(location.search).has("p111Test")){
 window.__p111GomokuTest={
  profile:aiProfile,
  loadPosition(pieces,level="hard"){
   for(let y=0;y<N;y++)board[y].fill(0);
   history=[];for(const [x,y,p] of pieces){board[y][x]=p;history.push({x,y,p});}
   mode="ai";difficulty=level;turn=-1;over=false;paused=false;render();
  },
  choose:()=>chooseAI(),
  scoreAt:(x,y,p)=>scoreAt(x,y,p),
  state:()=>({board:board.map(row=>row.slice()),turn,over,history:history.length})
 };
}
undoButton.addEventListener("click",undo);
window.addEventListener("resize",fitBoard);
if(typeof ResizeObserver!=="undefined"){boardObserver=new ResizeObserver(fitBoard);boardObserver.observe(boardArea);}
GameBridge.register({init(p){difficulty=p.difficulty||"normal";mode=p.mode||"ai";newGame();},newGame,pause(){paused=true;clearTimeout(aiTimer);setStatus("已暂停");},resume(){paused=false;if(turn===-1&&mode==="ai")scheduleAI();else setStatus(turn===1?"轮到你了":"轮到白棋");},setMode(v){mode=v==="two"?"two":"ai";},setDifficulty(v){difficulty=v||"normal";},dispose(){clearTimeout(aiTimer);boardObserver?.disconnect();window.removeEventListener("resize",fitBoard);}});
})();