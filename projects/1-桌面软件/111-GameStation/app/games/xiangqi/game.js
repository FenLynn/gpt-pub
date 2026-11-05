(function(){
"use strict";
const el=document.getElementById("board"),status=document.getElementById("status"),turnText=document.getElementById("turnText"),turnDot=document.getElementById("turnDot"),boardArea=document.querySelector(".game-main-board");
let boardObserver=null;
function fitBoard(){const widthLimit=Math.max(0,boardArea.clientWidth),heightLimit=Math.max(0,boardArea.clientHeight),margin=Math.min(44,Math.max(24,Math.round(Math.min(widthLimit,heightLimit)*.05)));const innerW=Math.max(0,widthLimit-2*margin),innerH=Math.max(0,heightLimit-2*margin);const height=Math.min(innerH,innerW/(8/9));const width=height*(8/9);if(width>0&&height>0){el.style.width=width+"px";el.style.height=height+"px";}}
let board=[],turn="red",mode="ai",difficulty="normal",paused=false,over=false,flip=false,selected=null,selectedMoves=[],history=[],positionTrail=[],aiTimer=null;
const opposite=s=>s==="red"?"black":"red";
const values={"帅":10000,"将":10000,"车":900,"马":430,"炮":450,"仕":220,"士":220,"相":220,"象":220,"兵":100,"卒":100};
function clone(b){return b.map(row=>row.map(p=>p?{side:p.side,t:p.t}:null));}
function initial(){const b=Array.from({length:10},()=>Array(9).fill(null)),back=["车","马","象","士","将","士","象","马","车"];for(let x=0;x<9;x++){b[0][x]={side:"black",t:back[x]};b[9][x]={side:"red",t:back[x]==="将"?"帅":back[x]==="士"?"仕":back[x]==="象"?"相":back[x]};}for(const x of [1,7]){b[2][x]={side:"black",t:"炮"};b[7][x]={side:"red",t:"炮"};}for(const x of [0,2,4,6,8]){b[3][x]={side:"black",t:"卒"};b[6][x]={side:"red",t:"兵"};}return b;}
function findGeneral(b,side){for(let y=0;y<10;y++)for(let x=0;x<9;x++){const p=b[y][x];if(p&&p.side===side&&(p.t==="将"||p.t==="帅"))return {x,y};}return null;}
function palace(side,x,y){return x>=3&&x<=5&&(side==="red"?y>=7&&y<=9:y>=0&&y<=2);}
function add(out,b,p,fx,fy,tx,ty){if(tx<0||tx>8||ty<0||ty>9)return;const target=b[ty][tx];if(!target||target.side!==p.side)out.push({fx,fy,tx,ty});}
function pseudoMoves(b,x,y){const p=b[y][x];if(!p)return [];const out=[],side=p.side,t=p.t;
 if(t==="车"||t==="炮"){for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){let screen=false;for(let tx=x+dx,ty=y+dy;tx>=0&&tx<9&&ty>=0&&ty<10;tx+=dx,ty+=dy){const q=b[ty][tx];if(t==="车"){if(!q)out.push({fx:x,fy:y,tx,ty});else{if(q.side!==side)out.push({fx:x,fy:y,tx,ty});break;}}else if(!screen){if(!q)out.push({fx:x,fy:y,tx,ty});else screen=true;}else if(q){if(q.side!==side)out.push({fx:x,fy:y,tx,ty});break;}}}}
 else if(t==="马"){for(const [dx,dy,lx,ly] of [[1,2,0,1],[-1,2,0,1],[1,-2,0,-1],[-1,-2,0,-1],[2,1,1,0],[2,-1,1,0],[-2,1,-1,0],[-2,-1,-1,0]])if(!b[y+ly]?.[x+lx])add(out,b,p,x,y,x+dx,y+dy);}
 else if(t==="象"||t==="相"){for(const [dx,dy] of [[2,2],[-2,2],[2,-2],[-2,-2]]){const tx=x+dx,ty=y+dy,eyeX=x+dx/2,eyeY=y+dy/2;if(tx<0||tx>8||ty<0||ty>9||b[eyeY][eyeX])continue;if(side==="red"&&ty<5||side==="black"&&ty>4)continue;add(out,b,p,x,y,tx,ty);}}
 else if(t==="士"||t==="仕"){for(const [dx,dy] of [[1,1],[1,-1],[-1,1],[-1,-1]]){const tx=x+dx,ty=y+dy;if(palace(side,tx,ty))add(out,b,p,x,y,tx,ty);}}
 else if(t==="将"||t==="帅"){for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const tx=x+dx,ty=y+dy;if(palace(side,tx,ty))add(out,b,p,x,y,tx,ty);}}
 else if(t==="兵"||t==="卒"){const forward=side==="red"?-1:1;add(out,b,p,x,y,x,y+forward);const crossed=side==="red"?y<=4:y>=5;if(crossed){add(out,b,p,x,y,x-1,y);add(out,b,p,x,y,x+1,y);}}
 return out;}
function apply(b,m){const moving=b[m.fy][m.fx],captured=b[m.ty][m.tx];b[m.ty][m.tx]=moving;b[m.fy][m.fx]=null;return captured;}
function generalsFacing(b){
 const red=findGeneral(b,"red"),black=findGeneral(b,"black");
 if(!red||!black||red.x!==black.x)return false;
 for(let y=Math.min(red.y,black.y)+1;y<Math.max(red.y,black.y);y++)if(b[y][red.x])return false;
 return true;
}
function inCheck(b,side){
 const king=findGeneral(b,side);if(!king)return true;
 if(generalsFacing(b))return true;
 const enemy=opposite(side);
 for(let y=0;y<10;y++)for(let x=0;x<9;x++){
  const p=b[y][x];
  if(p&&p.side===enemy&&pseudoMoves(b,x,y).some(m=>m.tx===king.x&&m.ty===king.y))return true;
 }
 return false;
}
function legalMoves(b,side){
 const out=[];
 for(let y=0;y<10;y++)for(let x=0;x<9;x++){
  const p=b[y][x];if(!p||p.side!==side)continue;
  for(const m of pseudoMoves(b,x,y)){
   const target=b[m.ty][m.tx];
   if(target&&(target.t==="将"||target.t==="帅"))continue;
   const next=clone(b);apply(next,m);if(!inCheck(next,side))out.push(m);
  }
 }
 return out;
}
// Rules baseline: forbid repeating the same checking position indefinitely.
// This is a constrained perpetual-check rule, not the full tournament long-chase adjudicator.
function keyPosition(b,side){
 return b.map(row=>row.map(p=>p?(p.side==="red"?"r":"b")+p.t:".").join(",")).join("/")+":"+side;
}
function liveMoves(side){return legalMoves(board,side);}
function recordPosition(mover){
 const key=keyPosition(board,turn);
 positionTrail.push({key,lastMover:mover,gaveCheck:inCheck(board,turn)});
}
function repetitionOutcome(){
 const key=keyPosition(board,turn),hits=[];
 positionTrail.forEach((entry,index)=>{if(entry.key===key)hits.push(index);});
 if(hits.length<3)return null;
 const from=hits[hits.length-2]+1,to=hits[hits.length-1]+1;
 const cycle=positionTrail.slice(from,to);
 const moves={red:cycle.filter(x=>x.lastMover==="red"),black:cycle.filter(x=>x.lastMover==="black")};
 const continuous={red:moves.red.length>0&&moves.red.every(x=>x.gaveCheck),
                   black:moves.black.length>0&&moves.black.every(x=>x.gaveCheck)};
 if(continuous.red&&!continuous.black)return {winner:"black",reason:"红方长将判负"};
 if(continuous.black&&!continuous.red)return {winner:"red",reason:"黑方长将判负"};
 return {winner:null,reason:"循环局面和棋"};
}
function evaluate(b){let score=0;for(let y=0;y<10;y++)for(let x=0;x<9;x++){const p=b[y][x];if(!p)continue;let v=values[p.t]||0;if(p.t==="兵"||p.t==="卒")v+=((p.side==="red"?6-y:y-3)*9)+(x>=2&&x<=6?8:0);if(p.t==="马")v+=(x>=2&&x<=6?18:0);if(p.t==="车")v+=(x>=2&&x<=6?7:0);score+=p.side==="red"?v:-v;}return score;}
function search(b,side,depth,alpha,beta,ply){if(!findGeneral(b,"red"))return -100000+ply;if(!findGeneral(b,"black"))return 100000-ply;const moves=legalMoves(b,side);if(!moves.length)return side==="red"?-99000+ply:99000-ply;if(depth===0)return evaluate(b);moves.sort((a,c)=>{const av=b[a.ty][a.tx]?values[b[a.ty][a.tx].t]||0:0,cv=b[c.ty][c.tx]?values[b[c.ty][c.tx].t]||0:0;return cv-av;});if(side==="red"){let best=-Infinity;for(const m of moves){const n=clone(b);apply(n,m);best=Math.max(best,search(n,"black",depth-1,alpha,beta,ply+1));alpha=Math.max(alpha,best);if(beta<=alpha)break;}return best;}let best=Infinity;for(const m of moves){const n=clone(b);apply(n,m);best=Math.min(best,search(n,"red",depth-1,alpha,beta,ply+1));beta=Math.min(beta,best);if(beta<=alpha)break;}return best;}
function chooseAI(){const ms=liveMoves("black");if(!ms.length)return null;const depth=difficulty==="easy"?1:difficulty==="hard"?3:2;let best=Infinity,choices=[];for(const m of ms){const n=clone(board),captured=apply(n,m);let v=search(n,"red",depth-1,-Infinity,Infinity,1);if(captured)v-=0.01;if(v<best){best=v;choices=[m];}else if(v===best)choices.push(m);}return choices[Math.floor(Math.random()*choices.length)];}
function report(t){
 status.textContent=t;
 document.getElementById("undoButton").disabled=!history.length||paused;
 if(turnText&&turnDot){
  const terminal=/获胜|将死|困毙|和棋/.test(t)&&over,winner=/红方/.test(t)?"red":"black",side=terminal&&!/和棋/.test(t)?winner:turn==="red"?"red":"black";
  turnDot.className="turn-dot "+side;
  if(terminal)turnText.textContent=t;
  else if(/AI 思考中/.test(t))turnText.textContent="黑方正在思考";
  else if(/已选中/.test(t))turnText.textContent="轮到"+(turn==="red"?"红方":"黑方")+"走 · "+t;
  else turnText.textContent="轮到"+(turn==="red"?"红方":"黑方")+"走";
 }
 GameBridge.report(t,{turn,side:turn});
}
function drawBoardLines(){
 const ns="http:"+"//www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");
 svg.setAttribute("viewBox","0 0 800 900");svg.setAttribute("preserveAspectRatio","none");svg.classList.add("xiangqi-lines");svg.setAttribute("aria-hidden","true");
 const X0=46,X1=754,Y0=48,Y1=852,xAt=x=>X0+(X1-X0)*x/8,yAt=y=>Y0+(Y1-Y0)*y/9;
 const line=(x1,y1,x2,y2)=>{const e=document.createElementNS(ns,"line");for(const [k,v] of Object.entries({x1,y1,x2,y2}))e.setAttribute(k,String(v));svg.appendChild(e);};
 const path=d=>{const e=document.createElementNS(ns,"path");e.setAttribute("d",d);svg.appendChild(e);};
 const rect=document.createElementNS(ns,"rect");rect.setAttribute("x",String(X0));rect.setAttribute("y",String(Y0));rect.setAttribute("width",String(X1-X0));rect.setAttribute("height",String(Y1-Y0));rect.setAttribute("class","xiangqi-border");svg.appendChild(rect);
 for(let x=0;x<=8;x++){const px=xAt(x);if(x===0||x===8)line(px,Y0,px,Y1);else{line(px,Y0,px,yAt(4));line(px,yAt(5),px,Y1);}}
 for(let y=0;y<=9;y++)line(X0,yAt(y),X1,yAt(y));
 path("M"+xAt(3)+" "+yAt(0)+" L"+xAt(5)+" "+yAt(2)+" M"+xAt(5)+" "+yAt(0)+" L"+xAt(3)+" "+yAt(2)+" M"+xAt(3)+" "+yAt(7)+" L"+xAt(5)+" "+yAt(9)+" M"+xAt(5)+" "+yAt(7)+" L"+xAt(3)+" "+yAt(9));
 const label=(x,text)=>{const e=document.createElementNS(ns,"text");e.setAttribute("x",String(x));e.setAttribute("y","474");e.setAttribute("text-anchor","middle");e.setAttribute("class","xiangqi-river-label");e.textContent=text;svg.appendChild(e);};
 label(270,"楚河");label(530,"汉界");
 const mark=(x,y,dx,dy)=>{const a=8,b=17;path("M"+(x+dx*a)+" "+(y+dy*a)+" l"+(-dx*a)+" 0 l0 "+(-dy*b)+" M"+(x+dx*a)+" "+(y+dy*a)+" l0 "+(-dy*a)+" l"+(-dx*b)+" 0");};
 [[1,2],[7,2],[1,7],[7,7],[0,3],[2,3],[4,3],[6,3],[8,3],[0,6],[2,6],[4,6],[6,6],[8,6]].forEach(([x,y])=>{const px=xAt(x),py=yAt(y);if(x>0)mark(px,py,-1,-1);if(x<8)mark(px,py,1,-1);if(x>0)mark(px,py,-1,1);if(x<8)mark(px,py,1,1);});
 el.appendChild(svg);
}
function renderMoveList(){
 const list=document.getElementById("moveList");if(!list)return;
 list.innerHTML="";
 history.forEach((h,i)=>{
  if(!h.move)return;
  const m=h.move,p=h.board[m.fy]?.[m.fx],side=h.turn==="red"?"红":"黑",target=h.board[m.ty]?.[m.tx];
  const row=document.createElement("li");
  const source=String.fromCharCode(65+m.fx)+(10-m.fy),dest=String.fromCharCode(65+m.tx)+(10-m.ty);
  row.innerHTML='<span class="xiangqi-move-index">'+(i+1)+'.</span><span class="xiangqi-move-side '+h.turn+'">'+side+'</span><span>'+((p&&p.t)||"棋")+' '+source+' → '+dest+(target?" ×":"")+'</span>';
  list.appendChild(row);
 });
 document.getElementById("moveCount").textContent=history.length+" 步";
 list.scrollTop=list.scrollHeight;
}
function render(){
 renderMoveList();
 el.querySelectorAll(".xiangqi-cell").forEach(cell=>cell.remove());
 if(!el.querySelector(".xiangqi-lines"))drawBoardLines();
 const targets=new Set(selectedMoves.map(m=>m.tx+","+m.ty));
 for(let y=0;y<10;y++)for(let x=0;x<9;x++){
  const px=flip?8-x:x,py=flip?9-y:y,cell=document.createElement("button");
  cell.type="button";cell.className="xiangqi-cell";const boardX=46+(754-46)*x/8,boardY=48+(852-48)*y/9;cell.style.left=(boardX/800*100)+"%";cell.style.top=(boardY/900*100)+"%";cell.style.width=((754-46)/8/800*100)+"%";cell.style.height=((852-48)/9/900*100)+"%";
  cell.dataset.x=String(px);cell.dataset.y=String(py);
  if(selected&&selected.x===px&&selected.y===py)cell.classList.add("selected");
  if(targets.has(px+","+py))cell.classList.add("target");
  const p=board[py][px];
  if(p){const s=document.createElement("span");s.className="xiangqi-piece "+p.side;s.textContent=p.t;cell.appendChild(s);cell.setAttribute("aria-label",(p.side==="red"?"红":"黑")+p.t);}
  else cell.setAttribute("aria-label","空位");
  cell.addEventListener("click",()=>clickCell(px,py));el.appendChild(cell);
 }
 el.dataset.pieceCount=String(board.flat().filter(Boolean).length);
 fitBoard();
}
function endIfNeeded(){const king=findGeneral(board,turn);if(!king){over=true;const winner=opposite(turn);report(winner==="red"?"红方获胜":"黑方获胜");GameBridge.send("GAME_OVER",{message:winner==="red"?"红方获胜":"黑方获胜",score:winner==="red"?1:0,win:winner==="red"});return true;}const ms=liveMoves(turn);if(!ms.length){over=true;const winner=opposite(turn);const label=winner==="red"?"红方":"黑方",reason=inCheck(board,turn)?"将死":"困毙";report(label+"获胜 · "+reason);GameBridge.send("GAME_OVER",{message:label+"获胜 · "+reason,score:winner==="red"?1:0,win:winner==="red"});return true;}
 const repetition=repetitionOutcome();
 if(repetition){
  over=true;paused=true;clearTimeout(aiTimer);const message=repetition.winner?(repetition.winner==="red"?"红方":"黑方")+"获胜 · "+repetition.reason:repetition.reason;
  report(message);GameBridge.send("GAME_OVER",{message,score:repetition.winner==="red"?1:0,win:repetition.winner==="red"});return true;
 }
 return false;}
function scheduleAI(){clearTimeout(aiTimer);if(paused||over||mode!=="ai"||turn!=="black")return;aiTimer=setTimeout(()=>{if(paused||over||turn!=="black")return;const m=chooseAI();if(!m){endIfNeeded();return;}history.push({board:clone(board),turn,move:{...m}});const mover=turn;apply(board,m);turn="red";recordPosition(mover);selected=null;selectedMoves=[];render();if(!endIfNeeded())report(inCheck(board,"red")?"红方被将军":"红方回合");},difficulty==="easy"?180:360);}
function clickCell(x,y){if(paused||over||(mode==="ai"&&turn==="black"))return;const p=board[y][x];if(selected){const m=selectedMoves.find(v=>v.tx===x&&v.ty===y);if(m){history.push({board:clone(board),turn,move:{...m}});const mover=turn;apply(board,m);selected=null;selectedMoves=[];turn=opposite(turn);recordPosition(mover);render();if(!endIfNeeded()){if(mode==="ai"&&turn==="black"){report(inCheck(board,"black")?"黑方被将军 · AI 思考中":"AI 思考中");scheduleAI();}else report(turn==="red"?"红方回合":"黑方回合");}return;}}if(p&&p.side===turn){selected={x,y};selectedMoves=liveMoves(turn).filter(m=>m.fx===x&&m.fy===y);render();report("已选中 "+p.t+" · 选择合法落点");}else{selected=null;selectedMoves=[];render();}}
function undo(){if(!history.length||paused)return;clearTimeout(aiTimer);let count=mode==="ai"?(turn==="red"?2:1):1;while(count--&&history.length){const h=history.pop();board=h.board;turn=h.turn;positionTrail.pop();}selected=null;selectedMoves=[];over=false;render();report("已悔棋");}
function newGame(){clearTimeout(aiTimer);board=initial();turn="red";selected=null;selectedMoves=[];history=[];positionTrail=[{key:keyPosition(board,turn),lastMover:null,gaveCheck:false}];over=false;paused=false;render();report("红方先行");}
document.getElementById("resignButton").addEventListener("click",()=>{
 if(paused||over)return;clearTimeout(aiTimer);over=true;
 const winner=opposite(turn),message=(turn==="red"?"红方":"黑方")+"认输 · "+(winner==="red"?"红方":"黑方")+"获胜";
 render();report(message);GameBridge.send("GAME_OVER",{message,score:winner==="red"?1:0,win:winner==="red"});
});
document.getElementById("flip").addEventListener("click",()=>{flip=!flip;render();});
document.getElementById("undoButton").addEventListener("click",undo);
window.addEventListener("resize",fitBoard);
if(typeof ResizeObserver!=="undefined"){boardObserver=new ResizeObserver(fitBoard);boardObserver.observe(boardArea);}
if(new URLSearchParams(location.search).has("p111Test")){
 window.__p111XiangqiTest={
  loadPosition(pieces,side="red"){
   if(!["red","black"].includes(side))throw Error("Invalid side");
   const next=Array.from({length:10},()=>Array(9).fill(null));
   for(const [x,y,s,t] of pieces){
    if(x<0||x>8||y<0||y>9||!["red","black"].includes(s)||next[y][x])throw Error("Invalid fixture");
    next[y][x]={side:s,t};
   }
   if(!findGeneral(next,"red")||!findGeneral(next,"black"))throw Error("Missing generals");
   board=next;turn=side;mode="two";paused=false;over=false;history=[];selected=null;selectedMoves=[];
   positionTrail=[{key:keyPosition(board,turn),lastMover:null,gaveCheck:false}];clearTimeout(aiTimer);
   render();report(turn==="red"?"红方回合":"黑方回合");
  },
  legal(side=turn){return liveMoves(side);},
  pseudo(side=turn){return legalMoves(board,side);},
  faces(){return generalsFacing(board);},
  check(side=turn){return inCheck(board,side);},
  terminal(){return endIfNeeded();},
  seedRepetition({redChecks=true,blackChecks=false}={}){
    const key=keyPosition(board,turn);
    positionTrail=[
     {key,lastMover:null,gaveCheck:false},
     {key,lastMover:null,gaveCheck:false},
     {key:key+":intermediate",lastMover:"red",gaveCheck:!!redChecks},
     {key,lastMover:"black",gaveCheck:!!blackChecks}
    ];
   }
 };
}
GameBridge.register({init(p){mode=p.mode||"ai";difficulty=p.difficulty||"normal";newGame();},newGame,pause(){paused=true;clearTimeout(aiTimer);report("已暂停");},resume(){paused=false;if(turn==="black"&&mode==="ai")scheduleAI();else report(turn==="red"?"红方回合":"黑方回合");},setMode(v){mode=v==="two"?"two":"ai";},setDifficulty(v){difficulty=v||"normal";},dispose(){clearTimeout(aiTimer);boardObserver?.disconnect();window.removeEventListener("resize",fitBoard);}});
})();