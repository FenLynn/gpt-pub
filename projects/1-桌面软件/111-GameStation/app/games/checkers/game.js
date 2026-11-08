(function(){
"use strict";
const el=document.getElementById("board"),status=document.getElementById("status");
const layoutRoot=document.getElementById("game");
const fitHistoryHeight=()=>{const h=el.getBoundingClientRect().height;if(h>0)layoutRoot.style.setProperty("--reversi-board-height",h+"px");};
if(typeof ResizeObserver!=="undefined")new ResizeObserver(fitHistoryHeight).observe(el);
else window.addEventListener("resize",fitHistoryHeight);
requestAnimationFrame(fitHistoryHeight);
let b,turn=1,selected=null,legal=[],continuing=null,mode="ai",paused=false,over=false,difficulty="normal",timer=null,history=[],lastHop=null;
const side=v=>(v===1||v===3)?1:(v===2||v===4)?2:0;
function clone(a){return a.map(r=>r.slice());}
function saveTurn(){history.push({board:clone(b),turn});if(history.length>100)history.shift();}
function undo(){if(paused||over||!history.length)return;clearTimeout(timer);const count=mode==="ai"?(turn===1?2:1):1;let snap=null;for(let i=0;i<count&&history.length;i++)snap=history.pop();if(!snap)return;b=clone(snap.board);turn=snap.turn;selected=null;legal=moves(b,turn);continuing=null;over=false;paused=false;window.GameTurnClock?.rewind(count,turn===1?"红方":"黑方");render();report("已撤销本回合");if(mode==="ai"&&turn===2)scheduleAI();}
function pieceMoves(a,x,y){const out=[],caps=[],v=a[y][x],p=side(v);if(!p)return out;const king=v===3||v===4,dirs=king?[-1,1]:[p===1?-1:1];for(const dy of dirs)for(const dx of [-1,1]){const xx=x+dx,yy=y+dy;if(xx<0||xx>7||yy<0||yy>7)continue;if(!a[yy][xx])out.push({x,y,tx:xx,ty:yy});else if(side(a[yy][xx])!==p){const x2=x+2*dx,y2=y+2*dy;if(x2>=0&&x2<8&&y2>=0&&y2<8&&!a[y2][x2])caps.push({x,y,tx:x2,ty:y2,capture:[xx,yy]});}}return caps.length?caps:out;}
function moves(a,p){const out=[],caps=[];for(let y=0;y<8;y++)for(let x=0;x<8;x++)if(side(a[y][x])===p){for(const m of pieceMoves(a,x,y)){if(m.capture)caps.push(m);else out.push(m);}}return caps.length?caps:out;}
function apply(a,m){let v=a[m.y][m.x];a[m.y][m.x]=0;a[m.ty][m.tx]=v;if(m.capture)a[m.capture[1]][m.capture[0]]=0;let promoted=false;if((v===1&&m.ty===0)||(v===2&&m.ty===7)){a[m.ty][m.tx]=v===1?3:4;promoted=true;}return {promoted,capture:!!m.capture};}
function counts(a){let r=0,k=0;for(const row of a)for(const v of row){if(side(v)===1)r++;if(side(v)===2)k++;}return [r,k];}
function evaluate(a,p){let score=0;for(let y=0;y<8;y++)for(let x=0;x<8;x++){const v=a[y][x],s=side(v);if(!s)continue;const king=v===3||v===4;let value=king?180:100;if(!king)value+=(s===1?7-y:y)*4;if(x>=2&&x<=5)value+=3;score+=s===p?value:-value;}return score;}
function choose(ms){if(!ms.length)return null;if(difficulty==="easy")return ms[Math.floor(Math.random()*ms.length)];let best=-Infinity,choices=[];for(const m of ms){const n=clone(b),result=apply(n,m);let value=evaluate(n,2)+(result.capture?16:0)+(result.promoted?35:0)+(m.tx>=2&&m.tx<=5?3:0);if(difficulty==="hard"){const replies=moves(n,1);let worst=Infinity;for(const r of replies){const q=clone(n);apply(q,r);worst=Math.min(worst,evaluate(q,2));}if(replies.length)value=worst+(result.capture?14:0)+(result.promoted?30:0);}value+=Math.random()*.02;if(value>best){best=value;choices=[m];}else if(value===best)choices.push(m);}return choices[Math.floor(Math.random()*choices.length)];}
function report(t){status.textContent=t;GameBridge.report(t,{score:counts(b)[0]});}
function finishIfNeeded(){const [red,black]=counts(b);if(!red||!moves(b,1).length){over=true;report("黑方获胜");GameBridge.send("GAME_OVER",{message:"黑方获胜",score:black,win:false});return true;}if(!black||!moves(b,2).length){over=true;report("红方获胜");GameBridge.send("GAME_OVER",{message:"红方获胜",score:red,win:true});return true;}return false;}
function render(){
 el.innerHTML="";
 const targets=new Set(legal.map(m=>m.tx+","+m.ty));
 for(let y=0;y<8;y++)for(let x=0;x<8;x++){
  const cell=document.createElement("button");cell.type="button";
  cell.className="game-cell checkers-square "+((x+y)%2?"dark":"light");
  const v=b[y][x];
  if(selected&&selected.x===x&&selected.y===y)cell.classList.add("selected");
  if(targets.has(x+","+y))cell.classList.add("valid");
  if(v){
   const checker=document.createElement("span");
   checker.className="checkers-disc "+(side(v)===1?"red":"black")+(v===3||v===4?" king":"")+(lastHop?.x===x&&lastHop.y===y?" just-hopped":"");
   if(v===3||v===4)checker.textContent="♛";
   checker.setAttribute("aria-hidden","true");cell.appendChild(checker);
  }
  cell.setAttribute("aria-label",(x+1)+"列"+(y+1)+"行"+(v?((side(v)===1?"红":"黑")+(v>2?"王棋":"方棋")):"空位"));
  cell.addEventListener("click",()=>click(x,y));el.appendChild(cell);
 }
 const [r,k]=counts(b);document.getElementById("red").textContent=r;document.getElementById("black").textContent=k;document.getElementById("undoButton").disabled=paused||over||!history.length;
 layoutRoot.dataset.turnSide=turn===1?"red":"black";
}
function switchTurn(){continuing=null;selected=null;legal=[];turn=3-turn;
 if(finishIfNeeded()){render();return;}
 if(mode==="ai"&&turn===2){render();report("黑方思考中");scheduleAI();}
 else{legal=moves(b,turn);render();report(turn===1?"红方回合":"黑方回合");}}
function afterStep(m,result){const mover=turn;const continuation=!!(result.capture&&!result.promoted&&pieceMoves(b,m.tx,m.ty).some(x=>x.capture));window.GameTurnClock?.record(mover===1?"红方":"黑方",continuation?(mover===1?"红方":"黑方"):(mover===1?"黑方":"红方"),result.capture?"吃子":"走棋");if(result.capture&&!result.promoted){const more=pieceMoves(b,m.tx,m.ty).filter(x=>x.capture);if(more.length){continuing={x:m.tx,y:m.ty};selected=continuing;legal=more;render();report(turn===1?"必须继续吃子":"AI 连续吃子");if(turn===2)scheduleAI(true);return;}}switchTurn();}
function scheduleAI(chain){clearTimeout(timer);if(paused||over||mode!=="ai"||turn!==2)return;timer=setTimeout(()=>{if(paused||over||turn!==2)return;const ms=chain&&continuing?pieceMoves(b,continuing.x,continuing.y).filter(m=>m.capture):moves(b,2);if(!ms.length){switchTurn();return;}if(!chain)saveTurn();const m=choose(ms),result=apply(b,m);lastHop={x:m.tx,y:m.ty};afterStep(m,result);},difficulty==="easy"?220:360);}
function click(x,y){if(paused||over||(mode==="ai"&&turn===2))return;const v=b[y][x];if(selected){const m=legal.find(m=>m.x===selected.x&&m.y===selected.y&&m.tx===x&&m.ty===y);if(m){if(!continuing)saveTurn();const result=apply(b,m);lastHop={x:m.tx,y:m.ty};afterStep(m,result);return;}}if(side(v)===turn&&(!continuing||(continuing.x===x&&continuing.y===y))){selected={x,y};legal=continuing?pieceMoves(b,x,y).filter(m=>m.capture):moves(b,turn).filter(m=>m.x===x&&m.y===y);render();}else if(!continuing){selected=null;legal=[];render();}}
function newGame(){clearTimeout(timer);history=[];lastHop=null;b=Array.from({length:8},()=>Array(8).fill(0));for(let y=0;y<3;y++)for(let x=0;x<8;x++)if((x+y)%2)b[y][x]=2;for(let y=5;y<8;y++)for(let x=0;x<8;x++)if((x+y)%2)b[y][x]=1;turn=1;selected=null;legal=[];continuing=null;paused=false;over=false;window.GameTurnClock?.reset("红方");render();report("红方先行");}
document.getElementById("undoButton").addEventListener("click",undo);
// Test-only deterministic fixture API. It is not exposed in normal gameplay.
if(new URLSearchParams(location.search).has("p111Test")){
 const fixtureState=()=>({board:clone(b),turn,over,paused,continuing:continuing?{...continuing}:null,legal:legal.map(m=>({...m,capture:m.capture?m.capture.slice():null}))});
 window.__p111CheckersTest={
  loadBoard(board,side=1){
   if(!Array.isArray(board)||board.length!==8||board.some(r=>!Array.isArray(r)||r.length!==8||r.some(v=>![0,1,2,3,4].includes(v))))throw new Error("Invalid Checkers fixture");
   clearTimeout(timer);b=clone(board);turn=side===2?2:1;mode="two";difficulty="normal";paused=false;over=false;selected=null;continuing=null;history=[];lastHop=null;legal=moves(b,turn);window.GameTurnClock?.reset(turn===1?"红方":"黑方");render();report(turn===1?"红方回合":"黑方回合");
   return fixtureState();
  },
  state:fixtureState,
  legalMoves(p=turn){return moves(b,p).map(m=>({...m,capture:m.capture?m.capture.slice():null}));},
  pieceMoves(x,y){return pieceMoves(b,x,y).map(m=>({...m,capture:m.capture?m.capture.slice():null}));},
  playMove(move){
   const candidates=continuing?pieceMoves(b,continuing.x,continuing.y).filter(m=>m.capture):moves(b,turn);
   const m=candidates.find(v=>v.x===move.x&&v.y===move.y&&v.tx===move.tx&&v.ty===move.ty);
   if(!m)throw new Error("Illegal Checkers fixture move");
   if(!continuing)saveTurn();const result=apply(b,m);lastHop={x:m.tx,y:m.ty};afterStep(m,result);return fixtureState();
  },
  choose(){return choose(moves(b,2));},
  setDifficulty(v){difficulty=v||"normal";},
  undo(){undo();return fixtureState();}
 };
}
GameBridge.register({init(p){mode=p.mode||"ai";difficulty=p.difficulty||"normal";newGame();},newGame,pause(){paused=true;clearTimeout(timer);document.getElementById("undoButton").disabled=true;report("已暂停");},resume(){paused=false;render();if(turn===2&&mode==="ai")scheduleAI(!!continuing);else report(turn===1?"红方回合":"黑方回合");},setMode(v){mode=v==="two"?"two":"ai";},setDifficulty(v){difficulty=v||"normal";},dispose(){paused=true;clearTimeout(timer);}});
})();