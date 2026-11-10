(function(){
"use strict";
const el=document.getElementById("board"),status=document.getElementById("status");
const boardRoot=document.getElementById("game");
const fitHistoryHeight=()=>{const h=el.getBoundingClientRect().height;if(h>0)boardRoot.style.setProperty("--reversi-board-height",h+"px");};
if(typeof ResizeObserver!=="undefined"){new ResizeObserver(fitHistoryHeight).observe(el);}
else window.addEventListener("resize",fitHistoryHeight);
requestAnimationFrame(fitHistoryHeight);
let b,turn=1,mode="ai",paused=false,over=false,difficulty="normal",timer=null,history=[],lastFlips=new Set();
const dirs=[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
function copy(a){return a.map(r=>r.slice());}
function save(){history.push({b:copy(b),turn,over});if(history.length>100)history.shift();}
function undo(){if(paused||over||!history.length)return;clearTimeout(timer);const count=mode==="ai"?(turn===1?2:1):1;let snap=null;for(let i=0;i<count&&history.length;i++)snap=history.pop();if(!snap)return;b=copy(snap.b);turn=snap.turn;over=false;paused=false;window.GameTurnClock?.rewind(count,turn===1?"黑色棋子":"白色棋子");render();report("已撤销一步");if(mode==="ai"&&turn===2)scheduleAI();}
function moves(a,p){const out=[];for(let y=0;y<8;y++)for(let x=0;x<8;x++)if(!a[y][x]){let flips=[];for(const [dx,dy] of dirs){let xx=x+dx,yy=y+dy,line=[];while(xx>=0&&xx<8&&yy>=0&&yy<8&&a[yy][xx]===3-p){line.push([xx,yy]);xx+=dx;yy+=dy;}if(line.length&&xx>=0&&xx<8&&yy>=0&&yy<8&&a[yy][xx]===p)flips.push(...line);}if(flips.length)out.push({x,y,flips});}return out;}
function apply(a,m,p){a[m.y][m.x]=p;m.flips.forEach(([x,y])=>a[y][x]=p);}
function counts(a){let black=0,white=0;for(const row of a)for(const v of row){if(v===1)black++;if(v===2)white++;}return [black,white];}
function evaluate(a,root){const [black,white]=counts(a),disc=(root===1?black-white:white-black),empty=64-black-white;let positional=0,frontier=0;for(let y=0;y<8;y++)for(let x=0;x<8;x++){const v=a[y][x];if(!v)continue;const sign=v===root?1:-1;let w=(x===0||x===7)&&(y===0||y===7)?100:(x===0||x===7||y===0||y===7)?12:(x===1||x===6)&&(y===1||y===6)?-28:1;positional+=sign*w;for(const [dx,dy] of dirs){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<8&&yy>=0&&yy<8&&!a[yy][xx]){frontier-=sign;break;}}}const mobility=moves(a,root).length-moves(a,3-root).length;return positional+mobility*7+frontier*(empty>24?3:1)+disc*(empty<14?12:1);}
function search(a,p,depth,alpha,beta,root){const ms=moves(a,p);if(!ms.length){const other=moves(a,3-p);if(!other.length){const [black,white]=counts(a);return (root===1?black-white:white-black)*1000;}if(depth<=0)return evaluate(a,root);return search(a,3-p,depth-1,alpha,beta,root);}if(depth<=0)return evaluate(a,root);const maximizing=p===root;ms.sort((m,n)=>{const val=m=>((m.x===0||m.x===7)&&(m.y===0||m.y===7)?100:0)+m.flips.length;return val(n)-val(m);});let best=maximizing?-Infinity:Infinity;for(const m of ms){const c=copy(a);apply(c,m,p);const v=search(c,3-p,depth-1,alpha,beta,root);if(maximizing){best=Math.max(best,v);alpha=Math.max(alpha,best);}else{best=Math.min(best,v);beta=Math.min(beta,best);}if(beta<=alpha)break;}return best;}
function choose(){const list=moves(b,2);if(!list.length)return null;if(difficulty==="easy")return list[Math.floor(Math.random()*list.length)];const depth=difficulty==="hard"?4:2;let best=-Infinity,choices=[];for(const m of list){const c=copy(b);apply(c,m,2);const v=search(c,1,depth-1,-Infinity,Infinity,2);if(v>best){best=v;choices=[m];}else if(v===best)choices.push(m);}return choices[Math.floor(Math.random()*choices.length)];}
function report(t){status.textContent=t;const [black,white]=counts(b);GameBridge.report(t,{score:black,white});}
function render(){
 el.innerHTML="";
 const valid=new Set(moves(b,turn).map(m=>m.y*8+m.x));
 for(let y=0;y<8;y++)for(let x=0;x<8;x++){
  const cell=document.createElement("button");cell.type="button";
  cell.className="game-cell reversi-square";
  cell.dataset.x=String(x);cell.dataset.y=String(y);
  const v=b[y][x];
  if(v){
   const disc=document.createElement("span");disc.className="reversi-disc "+(v===1?"black":"white")+(lastFlips.has(y*8+x)?" just-flipped":"");
   disc.setAttribute("aria-hidden","true");cell.appendChild(disc);
  }else if(valid.has(y*8+x)){
   cell.classList.add("legal");const hint=document.createElement("span");hint.className="reversi-move-hint";hint.setAttribute("aria-hidden","true");cell.appendChild(hint);
  }
  cell.setAttribute("aria-label",(x+1)+"列"+(y+1)+"行"+(v?(v===1?"黑色棋子":"白色棋子"):valid.has(y*8+x)?"可落子":"空位"));
  cell.addEventListener("click",()=>play(x,y));el.appendChild(cell);
 }
 const [black,white]=counts(b);
 document.getElementById("black").textContent=black;document.getElementById("white").textContent=white;
 document.getElementById("undoButton").disabled=!history.length||paused||over;
 document.getElementById("game").dataset.turnSide=turn===1?"black":"white";
}
function finish(){over=true;const [black,white]=counts(b),msg=black===white?"平局":black>white?"黑色棋子获胜":"白色棋子获胜";report(msg+" · "+black+":"+white);GameBridge.send("GAME_OVER",{message:msg,winner:black===white?null:black>white?"黑色棋子":"白色棋子",
 draw:black===white,score:black,win:mode==="ai"?black>white:black!==white});}
function scheduleAI(){clearTimeout(timer);if(paused||over||mode!=="ai"||turn!==2)return;timer=setTimeout(()=>{if(paused||over||turn!==2)return;const m=choose();if(m){save();lastFlips=new Set(m.flips.map(([x,y])=>y*8+x).concat(m.y*8+m.x));apply(b,m,2);window.GameTurnClock?.record("白色棋子","黑色棋子","落子");}else window.GameTurnClock?.record("白色棋子","黑色棋子","无合法步");turn=1;next();},difficulty==="easy"?240:360);}
function next(){if(over||paused)return;const list=moves(b,turn);if(!list.length){if(!moves(b,3-turn).length){finish();return;}const skipped=turn;turn=3-turn;window.GameTurnClock?.record(skipped===1?"黑色棋子":"白色棋子",turn===1?"黑色棋子":"白色棋子","自动跳过");report((turn===1?"黑色棋子":"白色棋子")+"无合法步，自动跳过");render();if(mode==="ai"&&turn===2)scheduleAI();return;}render();report(turn===1?"黑色棋子回合":"白色棋子回合");if(mode==="ai"&&turn===2)scheduleAI();}
function play(x,y){if(paused||over||(mode==="ai"&&turn!==1))return;const m=moves(b,turn).find(v=>v.x===x&&v.y===y);if(!m)return;save();lastFlips=new Set(m.flips.map(([x,y])=>y*8+x).concat(m.y*8+m.x));apply(b,m,turn);const mover=turn;turn=3-turn;window.GameTurnClock?.record(mover===1?"黑色棋子":"白色棋子",turn===1?"黑色棋子":"白色棋子","落子");next();}
function newGame(){clearTimeout(timer);history=[];lastFlips=new Set();b=Array.from({length:8},()=>Array(8).fill(0));b[3][3]=b[4][4]=2;b[3][4]=b[4][3]=1;turn=1;paused=false;over=false;window.GameTurnClock?.reset("黑色棋子");render();report("黑色棋子先行 · 点击浅色圆点落子，夹住白色棋子即可翻转");}

document.getElementById("undoButton").addEventListener("click",undo);
// Test-only deterministic fixture API. It is not exposed in normal gameplay.
if(new URLSearchParams(location.search).has("p111Test")){
 window.__p111ReversiTest={
  loadBoard(board,side=1){
   if(!Array.isArray(board)||board.length!==8||board.some(r=>!Array.isArray(r)||r.length!==8||r.some(v=>![0,1,2].includes(v))))throw new Error("Invalid Reversi fixture");
   clearTimeout(timer);b=copy(board);turn=side===2?2:1;mode="two";difficulty="normal";paused=false;over=false;history=[];lastFlips=new Set();window.GameTurnClock?.reset(turn===1?"黑色棋子":"白色棋子");render();report(turn===1?"黑色棋子回合":"白色棋子回合");
   return this.state();
  },
  state(){const [black,white]=counts(b);return{board:copy(b),turn,over,paused,counts:{black,white}};},
  legalMoves(side=turn){return moves(b,side).map(m=>({x:m.x,y:m.y,flips:m.flips.map(p=>p.slice())}));},
  play(x,y){play(x,y);return this.state();},
  choose(){return choose();},
  setDifficulty(v){difficulty=v||"normal";},
  undo(){undo();return this.state();}
 };
}
function resign(){
 if(paused||over)return false;
 const loser=mode==="ai"?1:turn,winner=3-loser;
 const label=s=>s===1?"黑色棋子":"白色棋子";
 clearTimeout(timer);over=true;paused=true;lastFlips=new Set();
 render();const message=label(loser)+"认输 · "+label(winner)+"获胜";
 report(message);GameBridge.send("GAME_OVER",{message,winner:label(winner),score:counts(b)[0],win:mode==="ai"?false:winner===1});
 return true;
}
window.addEventListener("gamestation:resign",resign);
GameBridge.register({init(p){difficulty=p.difficulty||"normal";mode=p.mode||"ai";newGame();},newGame,pause(){paused=true;clearTimeout(timer);document.getElementById("undoButton").disabled=true;report("已暂停");},resume(){paused=false;next();},setMode(v){mode=v==="two"?"two":"ai";},setDifficulty(v){difficulty=v||"normal";},snapshot(){return{board:copy(b),turn,mode,difficulty,history:history.map(h=>({b:copy(h.b),turn:h.turn,over:!!h.over})),lastFlips:[...lastFlips],turnClock:window.GameTurnClock?.snapshot?.()||null};},restore(s){if(!s||!Array.isArray(s.board)||s.board.length!==8||s.board.some(r=>!Array.isArray(r)||r.length!==8))throw new Error("黑白棋存档数据无效");clearTimeout(timer);b=copy(s.board);turn=Number(s.turn)===2?2:1;mode=s.mode==="two"?"two":"ai";difficulty=s.difficulty||difficulty;history=Array.isArray(s.history)?s.history.map(h=>({b:copy(h.b),turn:h.turn,over:!!h.over})):[];lastFlips=new Set(Array.isArray(s.lastFlips)?s.lastFlips.map(Number):[]);over=false;paused=true;window.GameTurnClock?.restore?.(s.turnClock);render();report("已恢复上次进度 · "+(turn===1?"黑色棋子回合":"白色棋子回合"));},dispose(){paused=true;clearTimeout(timer);}});
})();