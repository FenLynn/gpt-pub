(function(){
"use strict";
const el=document.getElementById("board"),status=document.getElementById("status");
const boardRoot=document.getElementById("game");
const fitHistoryHeight=()=>{const h=el.getBoundingClientRect().height;if(h>0){boardRoot.style.setProperty("--reversi-board-height",h+"px");boardRoot.dataset.boardMeasured="true";}};
if(typeof ResizeObserver!=="undefined")new ResizeObserver(fitHistoryHeight).observe(el);
else window.addEventListener("resize",fitHistoryHeight);
requestAnimationFrame(fitHistoryHeight);
let b,turn=1,mode="ai",paused=false,over=false,difficulty="normal",timer=null,history=[],lastDrop=null;
function copy(a){return a.map(r=>r.slice());}
function save(){history.push({b:copy(b),turn,over});if(history.length>100)history.shift();}
function undo(){if(paused||over||!history.length)return;clearTimeout(timer);const count=mode==="ai"?(turn===1?2:1):1;let snap=null;for(let i=0;i<count&&history.length;i++)snap=history.pop();if(!snap)return;b=copy(snap.b);turn=snap.turn;over=false;paused=false;window.GameTurnClock?.rewind(count,turn===1?"红方":"黄方");render();report("已撤销一步");if(mode==="ai"&&turn===2)scheduleAI();}
function drop(a,c,p){for(let r=5;r>=0;r--)if(!a[r][c]){a[r][c]=p;return r;}return -1;}
function win(a,p){for(let y=0;y<6;y++)for(let x=0;x<7;x++)if(a[y][x]===p)for(const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]){let n=1;for(let k=1;k<4;k++){let xx=x+dx*k,yy=y+dy*k;if(xx<0||xx>=7||yy<0||yy>=6||a[yy][xx]!==p)break;n++;}if(n===4)return true;}return false;}
function evaluate(a){let s=0;for(let y=0;y<6;y++)s+=a[y][3]===2?5:a[y][3]===1?-5:0;for(const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]])for(let y=0;y<6;y++)for(let x=0;x<7;x++){let c=[];for(let k=0;k<4;k++){let xx=x+dx*k,yy=y+dy*k;if(xx>=0&&xx<7&&yy>=0&&yy<6)c.push(a[yy][xx]);}if(c.length!==4)continue;const me=c.filter(v=>v===2).length,opp=c.filter(v=>v===1).length;if(!opp)s+=[0,2,12,90,100000][me];if(!me)s-=[0,2,14,110,100000][opp];}return s;}
function search(a,d,alpha,beta,p){if(win(a,2))return 100000+d;if(win(a,1))return -100000-d;if(!d||a.every(r=>r.every(Boolean)))return evaluate(a);const maximizing=p===2;let best=maximizing?-Infinity:Infinity;for(const c of [3,2,4,1,5,0,6]){const n=copy(a);if(drop(n,c,p)<0)continue;const v=search(n,d-1,alpha,beta,3-p);if(maximizing){best=Math.max(best,v);alpha=Math.max(alpha,best);}else{best=Math.min(best,v);beta=Math.min(beta,best);}if(beta<=alpha)break;}return best;}
function choose(){const available=[3,2,4,1,5,0,6].filter(c=>b[0][c]===0);if(!available.length)return -1;if(difficulty==="easy")return available[Math.floor(Math.random()*available.length)];const depth=difficulty==="hard"?5:3;let best=-Infinity,choices=[];for(const c of available){const n=copy(b);drop(n,c,2);const v=search(n,depth-1,-Infinity,Infinity,1);if(v>best){best=v;choices=[c];}else if(v===best)choices.push(c);}return choices[Math.floor(Math.random()*choices.length)];}
function report(t){status.textContent=t;GameBridge.report(t,{score:b.flat().filter(v=>v===1).length});}
function render(){
 el.innerHTML="";
 for(let y=0;y<6;y++)for(let x=0;x<7;x++){
  const slot=document.createElement("button");slot.type="button";slot.className="game-cell connect4-slot";
  slot.dataset.column=String(x);slot.setAttribute("aria-label",(x+1)+"列"+(b[y][x]===1?"红棋":b[y][x]===2?"黄棋":"空位"));
  const disc=document.createElement("span");
  disc.className="connect4-disc "+(b[y][x]===1?"red":b[y][x]===2?"yellow":"empty")+(lastDrop?.x===x&&lastDrop.y===y?" just-dropped":"");if(lastDrop?.x===x&&lastDrop.y===y)disc.style.setProperty("--drop-travel","-"+(y+1)*102+"%");
  disc.setAttribute("aria-hidden","true");slot.appendChild(disc);
  slot.addEventListener("click",()=>play(x));el.appendChild(slot);
 }
 document.getElementById("red").textContent=b.flat().filter(v=>v===1).length;
 document.getElementById("yellow").textContent=b.flat().filter(v=>v===2).length;
 document.getElementById("undoButton").disabled=paused||over||!history.length;
 document.getElementById("game").dataset.turnSide=turn===1?"red":"yellow";
}
function finish(p){over=true;const msg=p===1?"红方获胜":p===2?"黄方获胜":"平局";
 report(msg);GameBridge.send("GAME_OVER",{message:msg,winner:p===1?"红方":p===2?"黄方":null,
 draw:p===0,score:b.flat().filter(v=>v===1).length,win:mode==="ai"?p===1:p!==0});}
function scheduleAI(){clearTimeout(timer);if(paused||over||mode!=="ai"||turn!==2)return;timer=setTimeout(()=>{if(paused||over||turn!==2)return;const col=choose();if(col>=0){save();lastDrop={x:col,y:drop(b,col,2)};window.GameTurnClock?.record("黄方","红方","落子");}if(win(b,2)){render();finish(2);return;}if(b.every(r=>r.every(Boolean))){render();finish(0);return;}turn=1;render();report("轮到你了");},difficulty==="easy"?220:320);}
function play(c){if(paused||over||(mode==="ai"&&turn===2))return;if(b[0][c]!==0)return;save();const row=drop(b,c,turn);if(row<0)return;lastDrop={x:c,y:row};window.GameTurnClock?.record(turn===1?"红方":"黄方",turn===1?"黄方":"红方","落子");
 if(win(b,turn)){render();finish(turn);return;}if(b.every(r=>r.every(Boolean))){render();finish(0);return;}
 turn=3-turn;render();report(turn===1?"红方回合":mode==="ai"?"AI 思考中":"黄方回合");if(mode==="ai"&&turn===2)scheduleAI();}
function newGame(){clearTimeout(timer);history=[];lastDrop=null;b=Array.from({length:6},()=>Array(7).fill(0));turn=1;over=false;paused=false;window.GameTurnClock?.reset("红方");render();report("红方先行");}
document.getElementById("undoButton").addEventListener("click",undo);
// Test-only deterministic fixture API. It is not exposed in normal gameplay.
if(new URLSearchParams(location.search).has("p111Test")){
 window.__p111Connect4Test={
  loadBoard(board,side=1){
   if(!Array.isArray(board)||board.length!==6||board.some(r=>!Array.isArray(r)||r.length!==7||r.some(v=>![0,1,2].includes(v))))throw new Error("Invalid Connect Four fixture");
   clearTimeout(timer);b=copy(board);turn=side===2?2:1;mode="two";difficulty="normal";paused=false;over=false;history=[];lastDrop=null;window.GameTurnClock?.reset(turn===1?"红方":"黄方");render();report(turn===1?"红方回合":"黄方回合");
   return this.state();
  },
  state(){return{board:copy(b),turn,over,winner:win(b,1)?1:win(b,2)?2:0,counts:{red:b.flat().filter(v=>v===1).length,yellow:b.flat().filter(v=>v===2).length}};},
  play(column){play(column);return this.state();},
  choose(){return choose();},
  setDifficulty(v){difficulty=v||"normal";},
  undo(){undo();return this.state();},
  forceResult(winner){
   if(![0,1,2].includes(winner))throw new Error("Invalid Connect Four result");
   finish(winner);return this.state();
  }
 };
}
function resign(){
 if(paused||over)return false;
 const loser=mode==="ai"?1:turn,winner=3-loser;
 const label=s=>s===1?"红方":"黄方";
 clearTimeout(timer);over=true;paused=true;lastDrop=null;
 render();const message=label(loser)+"认输 · "+label(winner)+"获胜";
 report(message);GameBridge.send("GAME_OVER",{message,winner:label(winner),score:b.flat().filter(v=>v===1).length,win:mode==="ai"?false:winner===1});
 return true;
}
window.addEventListener("gamestation:resign",resign);
GameBridge.register({init(p){difficulty=p.difficulty||"normal";mode=p.mode||"ai";newGame();},newGame,pause(){paused=true;clearTimeout(timer);document.getElementById("undoButton").disabled=true;report("已暂停");},resume(){paused=false;render();if(turn===2&&mode==="ai")scheduleAI();else report("继续游戏");},setMode(v){mode=v==="two"?"two":"ai";},setDifficulty(v){difficulty=v||"normal";},snapshot(){return{board:copy(b),turn,mode,difficulty,history:history.map(h=>({b:copy(h.b),turn:h.turn,over:!!h.over})),lastDrop:lastDrop?{...lastDrop}:null,turnClock:window.GameTurnClock?.snapshot?.()||null};},restore(s){if(!s||!Array.isArray(s.board)||s.board.length!==6||s.board.some(r=>!Array.isArray(r)||r.length!==7))throw new Error("四子棋存档数据无效");clearTimeout(timer);b=copy(s.board);turn=Number(s.turn)===2?2:1;mode=s.mode==="two"?"two":"ai";difficulty=s.difficulty||difficulty;history=Array.isArray(s.history)?s.history.map(h=>({b:copy(h.b),turn:h.turn,over:!!h.over})):[];lastDrop=s.lastDrop?{x:Number(s.lastDrop.x),y:Number(s.lastDrop.y)}:null;over=false;paused=true;window.GameTurnClock?.restore?.(s.turnClock);render();report("已恢复上次进度 · "+(turn===1?"红方回合":"黄方回合"));},dispose(){paused=true;clearTimeout(timer);}});
})();