(function(){
"use strict";
const boardEl=document.getElementById("board"),frame=document.querySelector(".chess-frame"),statusEl=document.getElementById("turnText");
const glyph={w:{K:"♔",Q:"♕",R:"♖",B:"♗",N:"♘",P:"♙"},b:{K:"♚",Q:"♛",R:"♜",B:"♝",N:"♞",P:"♟"}};
const value={P:100,N:320,B:335,R:500,Q:900,K:20000},files="abcdefgh";
let board=[],turn="w",mode="ai",difficulty="normal",paused=true,over=false,flip=false,selected=null,legal=[],history=[],moveLog=[],lastMove=null,ep=null,castle={},captured={w:[],b:[]},aiTimer=null;
const opposite=c=>c==="w"?"b":"w";
const inside=(x,y)=>x>=0&&x<8&&y>=0&&y<8;
function initialBoard(){
 const b=Array.from({length:8},()=>Array(8).fill(null)),back=["R","N","B","Q","K","B","N","R"];
 for(let x=0;x<8;x++){b[0][x]={c:"b",t:back[x]};b[1][x]={c:"b",t:"P"};b[6][x]={c:"w",t:"P"};b[7][x]={c:"w",t:back[x]};}
 return b;
}
function cloneBoard(b){return b.map(row=>row.map(p=>p?{c:p.c,t:p.t}:null));}
function cloneCastle(c){return{wK:!!c.wK,wQ:!!c.wQ,bK:!!c.bK,bQ:!!c.bQ};}
function snapshot(){return{board:cloneBoard(board),turn,castle:cloneCastle(castle),ep:ep?{x:ep.x,y:ep.y}:null,moveNo:moveNo,captured:{w:captured.w.slice(),b:captured.b.slice()},moveLog:moveLog.slice(),lastMove:lastMove?{...lastMove}:null};}
let moveNo=1;
function restore(s){board=cloneBoard(s.board);turn=s.turn;castle=cloneCastle(s.castle);ep=s.ep?{...s.ep}:null;moveNo=s.moveNo;captured={w:s.captured.w.slice(),b:s.captured.b.slice()};moveLog=s.moveLog.slice();lastMove=s.lastMove?{...s.lastMove}:null;selected=null;legal=[];}
function squareName(x,y){return files[x]+String(8-y);}
function attacked(b,x,y,by){
 for(let sy=0;sy<8;sy++)for(let sx=0;sx<8;sx++){
  const p=b[sy][sx];if(!p||p.c!==by)continue;
  const dx=x-sx,dy=y-sy,ax=Math.abs(dx),ay=Math.abs(dy);
  if(p.t==="P"){const d=p.c==="w"?-1:1;if(ay===1&&dy===d)return true;continue;}
  if(p.t==="N"){if((ax===1&&ay===2)||(ax===2&&ay===1))return true;continue;}
  if(p.t==="K"){if(Math.max(ax,ay)===1)return true;continue;}
  const diagonal=ax===ay&&ax>0,straight=(dx===0||dy===0)&&(ax+ay>0);
  if((p.t==="B"&&!diagonal)||(p.t==="R"&&!straight)||(p.t==="Q"&&!diagonal&&!straight))continue;
  const stepx=Math.sign(dx),stepy=Math.sign(dy);let cx=sx+stepx,cy=sy+stepy,clear=true;
  while(cx!==x||cy!==y){if(b[cy][cx]){clear=false;break;}cx+=stepx;cy+=stepy;}
  if(clear)return true;
 }
 return false;
}
function kingAt(b,color){for(let y=0;y<8;y++)for(let x=0;x<8;x++){const p=b[y][x];if(p&&p.c===color&&p.t==="K")return{x,y};}return null;}
function inCheck(b,color){const k=kingAt(b,color);return !!k&&attacked(b,k.x,k.y,opposite(color));}
function pseudoMoves(b,x,y,color,rights,epSquare){
 const p=b[y][x];if(!p||p.c!==color)return[];const out=[];
 const add=(tx,ty,extra={})=>{if(!inside(tx,ty))return;const q=b[ty][tx];if(q&&q.t==="K")return;if(!q||q.c!==color)out.push({fx:x,fy:y,tx,ty,...extra});};
 if(p.t==="P"){
  const d=color==="w"?-1:1,start=color==="w"?6:1,promo=color==="w"?0:7;
  if(inside(x,y+d)&&!b[y+d][x]){add(x,y+d,{promotion:y+d===promo?"Q":null});if(y===start&&!b[y+2*d][x])add(x,y+2*d,{double:true});}
  for(const dx of [-1,1]){const tx=x+dx,ty=y+d;if(!inside(tx,ty))continue;const q=b[ty][tx];if(q&&q.c!==color)add(tx,ty,{promotion:ty===promo?"Q":null});else if(epSquare&&epSquare.x===tx&&epSquare.y===ty)add(tx,ty,{enPassant:true});}
 }else if(p.t==="N"){
  for(const [dx,dy] of [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]])add(x+dx,y+dy);
 }else if(p.t==="K"){
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)if(dx||dy)add(x+dx,y+dy);
  const row=color==="w"?7:0,enemy=opposite(color);
  if(x===4&&y===row&&!inCheck(b,color)){
   const kingRight=rights[color+"K"],queenRight=rights[color+"Q"];
   if(kingRight&&b[row][7]?.c===color&&b[row][7]?.t==="R"&&!b[row][5]&&!b[row][6]&&!attacked(b,5,row,enemy)&&!attacked(b,6,row,enemy))add(6,row,{castle:"K"});
   if(queenRight&&b[row][0]?.c===color&&b[row][0]?.t==="R"&&!b[row][1]&&!b[row][2]&&!b[row][3]&&!attacked(b,3,row,enemy)&&!attacked(b,2,row,enemy))add(2,row,{castle:"Q"});
  }
 }else{
  const dirs=[];
  if(p.t==="B"||p.t==="Q")dirs.push([1,1],[1,-1],[-1,1],[-1,-1]);
  if(p.t==="R"||p.t==="Q")dirs.push([1,0],[-1,0],[0,1],[0,-1]);
  for(const [dx,dy] of dirs){let tx=x+dx,ty=y+dy;while(inside(tx,ty)){const q=b[ty][tx];if(!q){out.push({fx:x,fy:y,tx,ty});}else{if(q.c!==color&&q.t!=="K")out.push({fx:x,fy:y,tx,ty});break;}tx+=dx;ty+=dy;}}
 }
 return out;
}
function applyPosition(b,m,epSquare){
 const moving=b[m.fy][m.fx],captured=m.enPassant?b[m.fy][m.tx]:b[m.ty][m.tx];
 b[m.fy][m.fx]=null;if(m.enPassant)b[m.fy][m.tx]=null;
 b[m.ty][m.tx]={c:moving.c,t:m.promotion||moving.t};
 if(m.castle){const row=m.fy;if(m.castle==="K"){b[row][5]=b[row][7];b[row][7]=null;}else{b[row][3]=b[row][0];b[row][0]=null;}}
 return captured;
}
function legalMoves(b,color,rights,epSquare){
 const out=[];
 for(let y=0;y<8;y++)for(let x=0;x<8;x++){const p=b[y][x];if(!p||p.c!==color)continue;for(const m of pseudoMoves(b,x,y,color,rights,epSquare)){const copy=cloneBoard(b);applyPosition(copy,m,epSquare);if(!inCheck(copy,color))out.push(m);}}
 return out;
}
function updateRights(m,moving,captured){
 if(moving.t==="K"){castle[moving.c+"K"]=false;castle[moving.c+"Q"]=false;}
 if(moving.t==="R"){if(m.fx===0&&m.fy===(moving.c==="w"?7:0))castle[moving.c+"Q"]=false;if(m.fx===7&&m.fy===(moving.c==="w"?7:0))castle[moving.c+"K"]=false;}
 if(captured&&captured.t==="R"){const c=captured.c;if(m.tx===0&&m.ty===(c==="w"?7:0))castle[c+"Q"]=false;if(m.tx===7&&m.ty===(c==="w"?7:0))castle[c+"K"]=false;}
}
function makeMove(m,quiet){
 const moving=board[m.fy][m.fx],captured=m.enPassant?board[m.fy][m.tx]:board[m.ty][m.tx];
 history.push(snapshot());updateRights(m,moving,captured);applyPosition(board,m,ep);
 if(captured)capturedBy(moving.c,captured);
 ep=m.double?{x:m.fx,y:(m.fy+m.ty)/2}:null;
 lastMove={fx:m.fx,fy:m.fy,tx:m.tx,ty:m.ty};
 const notation=(moving.t==="P"?"":moving.t)+squareName(m.fx,m.fy)+(captured?"×":"–")+squareName(m.tx,m.ty)+(m.promotion?"=Q":"")+(m.castle?" O-O":"");
 if(turn==="w")moveLog.push(moveNo+". "+notation);else{const idx=moveLog.length-1;if(idx>=0)moveLog[idx]+="   "+notation;moveNo++;}
 turn=opposite(turn);selected=null;legal=[];render();
 if(!quiet&&!checkEnd()){
  reportTurn();
  if(mode==="ai"&&turn==="b")scheduleAI();
 }
}
function capturedBy(color,p){captured[color].push(p.t);}
function checkEnd(){
 const moves=legalMoves(board,turn,castle,ep),check=inCheck(board,turn);
 document.getElementById("checkState").textContent=check?"将军":"正常";
 if(moves.length)return false;
 over=true;paused=true;clearTimeout(aiTimer);
 const win=opposite(turn)==="w",message=check?(win?"白方将死获胜":"黑方将死获胜"):"和棋 · 逼和";
 statusEl.textContent=message;GameBridge.report(message,{score:win?1:0});GameBridge.send("GAME_OVER",{message,score:win?1:0,win});render();return true;
}
function reportTurn(){const check=inCheck(board,turn);const label=turn==="w"?"白方":"黑方";const message=check?label+"被将军":label+"走棋";statusEl.textContent=message;document.getElementById("turnDot").className="turn-dot "+(turn==="w"?"white":"black");GameBridge.report(message,{score:0});}
function scheduleAI(){
 clearTimeout(aiTimer);if(paused||over||mode!=="ai"||turn!=="b")return;
 aiTimer=setTimeout(()=>{if(paused||over||turn!=="b")return;const moves=legalMoves(board,"b",castle,ep);if(!moves.length){checkEnd();return;}
  const scored=moves.map(m=>{const q=board[m.ty][m.tx]||(m.enPassant?board[m.fy][m.tx]:null),copy=cloneBoard(board);applyPosition(copy,m,ep);let score=(q?value[q.t]*1.8:0)+(m.promotion?850:0)+(inCheck(copy,"w")?70:0)+(Math.random()*18);if(difficulty==="hard")score+=(m.ty>m.fy?8:0);return{m,score};});
  scored.sort((a,b)=>b.score-a.score);const pick=difficulty==="easy"?moves[Math.floor(Math.random()*moves.length)]:scored[0].m;makeMove(pick,false);
 },difficulty==="easy"?220:difficulty==="hard"?480:340);
}
function render(){
 boardEl.innerHTML="";
 for(let vy=0;vy<8;vy++)for(let vx=0;vx<8;vx++){
  const x=flip?7-vx:vx,y=flip?7-vy:vy,p=board[y][x],button=document.createElement("button");
  button.type="button";button.className="chess-square "+(((x+y)%2===0)?"light":"dark");button.dataset.square=squareName(x,y);
  if(selected&&selected.x===x&&selected.y===y)button.classList.add("selected");
  if(lastMove&&lastMove.fx===x&&lastMove.fy===y)button.classList.add("last-from");
  if(lastMove&&lastMove.tx===x&&lastMove.ty===y)button.classList.add("last-to");
  const target=selected&&legal.find(m=>m.tx===x&&m.ty===y);if(target)button.classList.add(p?"capture":"legal");
  if(p){const span=document.createElement("span");span.className="chess-piece "+(p.c==="w"?"white":"black");span.textContent=glyph[p.c][p.t];button.appendChild(span);}
  button.setAttribute("aria-label",squareName(x,y)+(p?(" "+(p.c==="w"?"白":"黑")+p.t):" 空格"));button.addEventListener("click",()=>clickSquare(x,y));boardEl.appendChild(button);
 }
 frame.querySelectorAll(".chess-axis-x,.chess-axis-y").forEach(e=>e.remove());
 const ax=document.createElement("div");ax.className="chess-axis-x";ax.setAttribute("aria-hidden","true");ax.innerHTML=Array.from({length:8},(_,i)=>"<span>"+files[flip?7-i:i]+"</span>").join("");
 const ay=document.createElement("div");ay.className="chess-axis-y";ay.setAttribute("aria-hidden","true");ay.innerHTML=Array.from({length:8},(_,i)=>"<span>"+(flip?i+1:8-i)+"</span>").join("");frame.append(ax,ay);
 document.getElementById("whiteCaptured").textContent=captured.w.length?captured.w.map(t=>glyph.b[t]).join(" "):"—";
 document.getElementById("blackCaptured").textContent=captured.b.length?captured.b.map(t=>glyph.w[t]).join(" "):"—";
 document.getElementById("moveNumber").textContent=String(moveNo);
 const list=document.getElementById("moveList");list.innerHTML="";moveLog.slice(-24).forEach(row=>{const li=document.createElement("li");li.textContent=row;list.appendChild(li);});
 document.getElementById("undoButton").disabled=!history.length||paused;
 document.getElementById("checkState").textContent=inCheck(board,turn)?"将军":"正常";
}
function clickSquare(x,y){
 if(paused||over||(mode==="ai"&&turn==="b"))return;
 const p=board[y][x];
 if(selected){const m=legal.find(v=>v.tx===x&&v.ty===y);if(m){makeMove(m,false);return;}}
 if(p&&p.c===turn){selected={x,y};legal=legalMoves(board,turn,castle,ep).filter(m=>m.fx===x&&m.fy===y);render();statusEl.textContent="已选中 "+squareName(x,y)+" · 选择落点";}
 else{selected=null;legal=[];render();}
}
function undo(){
 if(!history.length||paused)return;clearTimeout(aiTimer);
 let n=mode==="ai"&&turn==="w"?2:1;
 while(n--&&history.length)restore(history.pop());
 over=false;render();reportTurn();
}
function newGame(){
 clearTimeout(aiTimer);board=initialBoard();turn="w";castle={wK:true,wQ:true,bK:true,bQ:true};ep=null;moveNo=1;history=[];moveLog=[];lastMove=null;captured={w:[],b:[]};selected=null;legal=[];over=false;paused=false;render();reportTurn();
}
function pause(){paused=true;clearTimeout(aiTimer);statusEl.textContent="已暂停";GameBridge.report("已暂停",{});}
function resume(){if(over)return;paused=false;reportTurn();if(mode==="ai"&&turn==="b")scheduleAI();}
function onKey(e){if(e.key==="Escape"){selected=null;legal=[];render();}if(e.key.toLowerCase()==="u"){e.preventDefault();undo();}}
document.addEventListener("keydown",onKey);
document.getElementById("flipButton").addEventListener("click",()=>{flip=!flip;render();});
document.getElementById("undoButton").addEventListener("click",undo);
GameBridge.register({
 init(payload){mode=payload.mode==="two"?"two":"ai";difficulty=payload.difficulty||"normal";newGame();},
 newGame,pause,resume,
 setMode(v){mode=v==="two"?"two":"ai";},
 setDifficulty(v){difficulty=v||"normal";},
 dispose(){clearTimeout(aiTimer);document.removeEventListener("keydown",onKey);}
});
})();