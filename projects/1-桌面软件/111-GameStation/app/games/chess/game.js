(function(){
"use strict";
const boardEl=document.getElementById("board"),frame=document.querySelector(".chess-frame"),statusEl=document.getElementById("turnText");
const glyph={w:{K:"♔",Q:"♕",R:"♖",B:"♗",N:"♘",P:"♙"},b:{K:"♚",Q:"♛",R:"♜",B:"♝",N:"♞",P:"♟"}};
const value={P:100,N:320,B:335,R:500,Q:900,K:20000},files="abcdefgh";
let board=[],turn="w",mode="ai",difficulty="normal",paused=true,over=false,flip=false,selected=null,legal=[],history=[],moveLog=[],lastMove=null,ep=null,castle={},captured={w:[],b:[]},aiTimer=null,halfMoves=0,positions=[],promotionChoices=null;
const opposite=c=>c==="w"?"b":"w";
const inside=(x,y)=>x>=0&&x<8&&y>=0&&y<8;
function initialBoard(){
 const b=Array.from({length:8},()=>Array(8).fill(null)),back=["R","N","B","Q","K","B","N","R"];
 for(let x=0;x<8;x++){b[0][x]={c:"b",t:back[x]};b[1][x]={c:"b",t:"P"};b[6][x]={c:"w",t:"P"};b[7][x]={c:"w",t:back[x]};}
 return b;
}
function cloneBoard(b){return b.map(row=>row.map(p=>p?{c:p.c,t:p.t}:null));}
function cloneCastle(c){return{wK:!!c.wK,wQ:!!c.wQ,bK:!!c.bK,bQ:!!c.bQ};}
function snapshot(){return{board:cloneBoard(board),turn,castle:cloneCastle(castle),ep:ep?{x:ep.x,y:ep.y}:null,moveNo:moveNo,captured:{w:captured.w.slice(),b:captured.b.slice()},moveLog:moveLog.slice(),lastMove:lastMove?{...lastMove}:null,halfMoves,positions:positions.slice()};}
let moveNo=1;
function restore(s){board=cloneBoard(s.board);turn=s.turn;castle=cloneCastle(s.castle);ep=s.ep?{...s.ep}:null;moveNo=s.moveNo;captured={w:s.captured.w.slice(),b:s.captured.b.slice()};moveLog=s.moveLog.slice();lastMove=s.lastMove?{...s.lastMove}:null;halfMoves=s.halfMoves||0;positions=s.positions?s.positions.slice():[];promotionChoices=null;document.getElementById("promotionChooser")?.remove();selected=null;legal=[];}
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
  if(inside(x,y+d)&&!b[y+d][x]){if(y+d===promo){for(const promotion of ["Q","R","B","N"])add(x,y+d,{promotion});}else add(x,y+d);if(y===start&&!b[y+2*d][x])add(x,y+2*d,{double:true});}
  for(const dx of [-1,1]){const tx=x+dx,ty=y+d;if(!inside(tx,ty))continue;const q=b[ty][tx];if(q&&q.c!==color){if(ty===promo){for(const promotion of ["Q","R","B","N"])add(tx,ty,{promotion});}else add(tx,ty);}else if(epSquare&&epSquare.x===tx&&epSquare.y===ty)add(tx,ty,{enPassant:true});}
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
function positionKey(){
 const cells=board.map(row=>row.map(p=>p?(p.c==="w"?p.t:p.t.toLowerCase()):".").join("")).join("/");
 const rights=["wK","wQ","bK","bQ"].filter(k=>castle[k]).join("");
 const epRelevant=ep&&legalMoves(board,turn,castle,ep).some(m=>m.enPassant);
 return [cells,turn,rights,epRelevant?ep.x+","+ep.y:"-"].join(":");
}
function repetitions(){
 const key=positionKey();return positions.filter(p=>p===key).length;
}
function deadPosition(){
 const minor=[];
 for(let y=0;y<8;y++)for(let x=0;x<8;x++){
  const p=board[y][x];if(!p||p.t==="K")continue;
  if(!["N","B"].includes(p.t))return false;
  minor.push({type:p.t,squareColor:(x+y)%2});
 }
 if(minor.length===0)return true;
 if(minor.length===1)return true;
 return minor.every(p=>p.type==="B")&&minor.every(p=>p.squareColor===minor[0].squareColor);
}
function canClaimDraw(){return halfMoves>=100||repetitions()>=3;}
function finishDraw(message){
 if(over)return;
 over=true;paused=true;clearTimeout(aiTimer);statusEl.textContent=message;
 GameBridge.report(message,{score:0});GameBridge.send("GAME_OVER",{message,score:0,win:false});render();
}
function choosePromotion(moves){
 promotionChoices=moves;
 let chooser=document.getElementById("promotionChooser");
 if(!chooser){
  chooser=document.createElement("div");chooser.id="promotionChooser";chooser.className="chess-promotion-chooser";
  chooser.setAttribute("role","group");chooser.setAttribute("aria-label","选择升变棋子");
  document.querySelector(".game-main-board").appendChild(chooser);
 }
 chooser.innerHTML="";
 for(const type of ["Q","R","B","N"]){
  const move=moves.find(m=>m.promotion===type);if(!move)continue;
  const button=document.createElement("button");button.type="button";button.className="game-btn";
  button.textContent=glyph[turn][type]+" "+({Q:"后",R:"车",B:"象",N:"马"})[type];
  button.dataset.promotion=type;
  button.addEventListener("click",()=>{if(!promotionChoices)return;promotionChoices=null;chooser.remove();makeMove(move,false);});
  chooser.appendChild(button);
 }
 const cancel=document.createElement("button");cancel.type="button";cancel.className="game-btn";
 cancel.textContent="取消";cancel.onclick=()=>{promotionChoices=null;chooser.remove();};chooser.appendChild(cancel);
}
function animateChessMove(m){if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;const from=boardEl.querySelector('[data-square="'+squareName(m.fx,m.fy)+'"]'),to=boardEl.querySelector('[data-square="'+squareName(m.tx,m.ty)+'"] .chess-piece');if(!from||!to||!to.animate)return;const a=from.getBoundingClientRect(),b=to.getBoundingClientRect();to.animate([{transform:"translate("+(a.x+a.width/2-b.x-b.width/2)+"px,"+(a.y+a.height/2-b.y-b.height/2)+"px)"},{transform:"translate(0,0)"}],{duration:190,easing:"ease-out"});}
function makeMove(m,quiet){
 const moving=board[m.fy][m.fx],captured=m.enPassant?board[m.fy][m.tx]:board[m.ty][m.tx];
 history.push(snapshot());halfMoves=(moving.t==="P"||captured)?0:halfMoves+1;updateRights(m,moving,captured);applyPosition(board,m,ep);
 if(captured)capturedBy(moving.c,captured);
 ep=m.double?{x:m.fx,y:(m.fy+m.ty)/2}:null;
 lastMove={fx:m.fx,fy:m.fy,tx:m.tx,ty:m.ty};
 const notation=(moving.t==="P"?"":moving.t)+squareName(m.fx,m.fy)+(captured?"×":"–")+squareName(m.tx,m.ty)+(m.promotion?"="+m.promotion:"")+(m.castle?(m.castle==="Q"?" O-O-O":" O-O"):"");
 if(turn==="w")moveLog.push(moveNo+". "+notation);else{const idx=moveLog.length-1;if(idx>=0)moveLog[idx]+="   "+notation;moveNo++;}
 turn=opposite(turn);positions.push(positionKey());selected=null;legal=[];render();animateChessMove(m);
 if(!quiet&&!checkEnd()){
  reportTurn();
  if(mode==="ai"&&turn==="b")scheduleAI();
 }
}
function capturedBy(color,p){captured[color].push(p.t);}
function checkEnd(){
 const moves=legalMoves(board,turn,castle,ep),check=inCheck(board,turn);
 document.getElementById("checkState").textContent=check?"将军":"正常";
 if(moves.length){
  if(deadPosition()){finishDraw("和棋 · 子力不足");return true;}
  if(halfMoves>=150){finishDraw("和棋 · 75 回合规则");return true;}
  if(repetitions()>=5){finishDraw("和棋 · 五次重复局面");return true;}
  return false;
 }
 over=true;paused=true;clearTimeout(aiTimer);
 const win=opposite(turn)==="w",message=check?(win?"白方将死获胜":"黑方将死获胜"):"和棋 · 逼和";
 statusEl.textContent=message;GameBridge.report(message,{score:win?1:0});GameBridge.send("GAME_OVER",{message,score:win?1:0,win});render();return true;
}
function reportTurn(){const check=inCheck(board,turn);const label=turn==="w"?"白方":"黑方";const message=check?label+"被将军":label+"走棋";statusEl.textContent=message;document.getElementById("turnDot").className="turn-dot "+(turn==="w"?"white":"black");GameBridge.report(message,{score:0});}
function aiProfile(level=difficulty){return level==="easy"?{depth:0,width:0}:level==="hard"?{depth:3,width:8}:{depth:2,width:6};}
function aiScore(b){let n=0;for(let y=0;y<8;y++)for(let x=0;x<8;x++){const p=b[y][x];if(p)n+=(p.c==="b"?1:-1)*(value[p.t]+(p.t==="P"?(p.c==="b"?y:7-y)*7:0)+(p.t==="N"||p.t==="B"?11*(3.5-Math.abs(x-3.5)):0));}return n;}
function aiRights(r,b,m){const c={...r},p=b[m.fy][m.fx],q=b[m.ty][m.tx];if(p.t==="K"){c[p.c+"K"]=false;c[p.c+"Q"]=false;}if(p.t==="R"&&m.fy===(p.c==="w"?7:0)){if(m.fx===0)c[p.c+"Q"]=false;if(m.fx===7)c[p.c+"K"]=false;}if(q?.t==="R"&&m.ty===(q.c==="w"?7:0)){if(m.tx===0)c[q.c+"Q"]=false;if(m.tx===7)c[q.c+"K"]=false;}return c;}
function aiOrder(b,ms,width){return ms.map(m=>({m,s:(b[m.ty][m.tx]?value[b[m.ty][m.tx].t]*10:0)+(m.promotion?value[m.promotion]*9:0)+(3.5-Math.abs(m.tx-3.5))*6})).sort((a,b)=>b.s-a.s).slice(0,width).map(x=>x.m);}
function aiSearch(b,color,rights,epSquare,depth,width,alpha,beta,ply){
 const ms=legalMoves(b,color,rights,epSquare);
 if(!ms.length)return inCheck(b,color)?(color==="b"?-900000+ply:900000-ply):0;
 if(depth<=0)return aiScore(b);
 const max=color==="b";let best=max?-Infinity:Infinity;
 for(const m of aiOrder(b,ms,width)){const n=cloneBoard(b),r=aiRights(rights,b,m);applyPosition(n,m,epSquare);const epNext=m.double?{x:m.fx,y:(m.fy+m.ty)/2}:null,v=aiSearch(n,opposite(color),r,epNext,depth-1,width,alpha,beta,ply+1);
  if(max){best=Math.max(best,v);alpha=Math.max(alpha,best);}else{best=Math.min(best,v);beta=Math.min(beta,best);}if(alpha>=beta)break;}
 return best;
}
function chooseChessAI(){const ms=legalMoves(board,"b",castle,ep);if(!ms.length)return null;const p=aiProfile();if(!p.depth)return ms[Math.floor(Math.random()*ms.length)];
 const roots=aiOrder(board,ms,Math.max(14,p.width*2));let best=-Infinity,pick=roots[0];
 for(const m of roots){const n=cloneBoard(board),r=aiRights(castle,board,m);applyPosition(n,m,ep);const nextEp=m.double?{x:m.fx,y:(m.fy+m.ty)/2}:null,v=aiSearch(n,"w",r,nextEp,p.depth-1,p.width,-Infinity,Infinity,1);if(v>best+1e-5){best=v;pick=m;}}
 return pick;
}
function scheduleAI(){clearTimeout(aiTimer);if(paused||over||mode!=="ai"||turn!=="b")return;aiTimer=setTimeout(()=>{if(paused||over||turn!=="b")return;const m=chooseChessAI();if(m)makeMove(m,false);else checkEnd();},180);}

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
 const claim=document.getElementById("drawClaimButton");if(claim){claim.disabled=!canClaimDraw()||paused||over;claim.title=halfMoves>=100?"可按 50 回合规则要求和棋":"可按三次重复局面要求和棋";}
}
function clickSquare(x,y){
 if(paused||over||(mode==="ai"&&turn==="b"))return;
 const p=board[y][x];
 if(selected){const candidates=legal.filter(v=>v.tx===x&&v.ty===y);if(candidates.length>1){choosePromotion(candidates);return;}const m=candidates[0];if(m){makeMove(m,false);return;}}
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
 clearTimeout(aiTimer);board=initialBoard();turn="w";castle={wK:true,wQ:true,bK:true,bQ:true};ep=null;moveNo=1;history=[];moveLog=[];lastMove=null;captured={w:[],b:[]};halfMoves=0;positions=[positionKey()];promotionChoices=null;document.getElementById("promotionChooser")?.remove();selected=null;legal=[];over=false;paused=false;render();reportTurn();
}
function pause(){paused=true;clearTimeout(aiTimer);statusEl.textContent="已暂停";GameBridge.report("已暂停",{});}
function resume(){if(over)return;paused=false;reportTurn();if(mode==="ai"&&turn==="b")scheduleAI();}
function onKey(e){if(e.key==="Escape"){selected=null;legal=[];render();}if(e.key.toLowerCase()==="u"){e.preventDefault();undo();}}
document.addEventListener("keydown",onKey);
document.getElementById("flipButton").addEventListener("click",()=>{flip=!flip;render();});
document.getElementById("undoButton").addEventListener("click",undo);
const claimButton=document.createElement("button");claimButton.type="button";claimButton.id="drawClaimButton";
claimButton.className="game-btn";claimButton.textContent="申请和棋";claimButton.disabled=true;
claimButton.addEventListener("click",()=>{if(!paused&&!over&&canClaimDraw())finishDraw(halfMoves>=100?"和棋 · 50 回合规则":"和棋 · 三次重复局面");});
document.querySelector(".game-tools")?.appendChild(claimButton);
// Deterministic rules fixtures are only available on an explicitly test-only URL.
// No fixture controls are exposed in normal gameplay.
if(new URLSearchParams(location.search).has("p111Test")){
 window.__p111ChessTest={
  aiProfile,
  loadFen(fen){
   const fields=String(fen).trim().split(/\s+/);
   if(fields.length<4)throw new Error("Invalid fixture FEN");
   const rows=fields[0].split("/");
   if(rows.length!==8||!["w","b"].includes(fields[1]))throw new Error("Invalid fixture board");
   const next=[];
   for(const rank of rows){
    const row=[];
    for(const value of rank){
     if(/[1-8]/.test(value)){for(let i=0;i<Number(value);i++)row.push(null);}
     else if(/[KQRBNPkqrbnp]/.test(value))row.push({c:value===value.toUpperCase()?"w":"b",t:value.toUpperCase()});
     else throw new Error("Invalid fixture piece");
    }
    if(row.length!==8)throw new Error("Invalid fixture rank");
    next.push(row);
   }
   if(next.flat().filter(p=>p&&p.t==="K"&&p.c==="w").length!==1||
      next.flat().filter(p=>p&&p.t==="K"&&p.c==="b").length!==1)throw new Error("Invalid kings");
   board=next;turn=fields[1];mode="two";difficulty="normal";
   castle={wK:fields[2].includes("K"),wQ:fields[2].includes("Q"),bK:fields[2].includes("k"),bQ:fields[2].includes("q")};
   ep=fields[3]==="-"?null:{x:files.indexOf(fields[3][0]),y:8-Number(fields[3][1])};
   if(ep&&(!inside(ep.x,ep.y)))throw new Error("Invalid EP square");
   halfMoves=Math.max(0,Number(fields[4])||0);
   moveNo=Math.max(1,Number(fields[5])||1);
   captured={w:[],b:[]};history=[];moveLog=[];lastMove=null;selected=null;legal=[];
   promotionChoices=null;document.getElementById("promotionChooser")?.remove();
   paused=false;over=false;clearTimeout(aiTimer);
   positions=[positionKey()];render();reportTurn();
  },
  checkEnd(){return checkEnd();},
  state(){return{turn,halfMoves,repetitions:repetitions(),over,paused,castle:{...castle},ep:ep?{...ep}:null,
    board:board.map(row=>row.map(p=>p?p.c+p.t:""))};}
 };
}
GameBridge.register({
 init(payload){mode=payload.mode==="two"?"two":"ai";difficulty=payload.difficulty||"normal";newGame();},
 newGame,pause,resume,
 setMode(v){mode=v==="two"?"two":"ai";},
 setDifficulty(v){difficulty=v||"normal";},
 dispose(){clearTimeout(aiTimer);document.removeEventListener("keydown",onKey);}
});
})();