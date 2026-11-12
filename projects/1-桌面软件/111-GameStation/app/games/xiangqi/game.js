(function(){
"use strict";
const root=document.getElementById("game"),el=document.getElementById("board"),status=document.getElementById("status"),turnText=document.getElementById("turnText"),turnDot=document.getElementById("turnDot"),boardArea=document.querySelector(".game-main-board");
let boardObserver=null,layoutReadySent=false;
function syncRecordRailHeight(){const rail=document.querySelector(".xiangqi-record-rail"),actual=el.getBoundingClientRect().height;if(rail&&actual>0)rail.style.setProperty("--xiangqi-record-height",actual+"px");}
function tryMarkLayoutReady(){
 if(layoutReadySent||!root.classList.contains("gs-tools-open")||root.classList.contains("rail-collapsed"))return;
 const boardRect=el.getBoundingClientRect(),mainRect=boardArea.getBoundingClientRect();
 const rail=root.querySelector(".xiangqi-record-rail"),tools=root.querySelector(".game-tools");
 const railRect=rail?.getBoundingClientRect(),toolsRect=tools?.getBoundingClientRect();
 const cells=[...el.querySelectorAll(":scope > .xiangqi-cell")];
 if(cells.length!==90||boardRect.width<100||boardRect.height<100||mainRect.width<100||mainRect.height<100||!railRect||!toolsRect||railRect.width<100||toolsRect.width<40)return;
 if(Math.abs(boardRect.width/boardRect.height-8/9)>.02)return;
 if(window.innerWidth>900&&(railRect.right>mainRect.left+2||mainRect.right>toolsRect.left+2))return;
 const outOfBoard=cells.some(cell=>{const r=cell.getBoundingClientRect();return r.left<boardRect.left-1||r.top<boardRect.top-1||r.right>boardRect.right+1||r.bottom>boardRect.bottom+1;});
 if(outOfBoard)return;
 layoutReadySent=true;root.classList.add("xiangqi-layout-ready");
 GameBridge.send("LAYOUT_READY",{boardWidth:Math.round(boardRect.width),boardHeight:Math.round(boardRect.height),cellCount:cells.length});
}
let board=[],turn="red",mode="ai",difficulty="normal",paused=false,over=false,flip=false,selected=null,selectedMoves=[],history=[],positionTrail=[],aiTimer=null;
const opposite=s=>s==="red"?"black":"red";
const values={"帅":15000,"将":15000,"车":1000,"马":460,"炮":475,"仕":200,"士":200,"相":210,"象":210,"兵":105,"卒":105};
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
/* Iterative deepening alpha-beta with tactical capture extension, move ordering,
   per-difficulty deadlines and verified legal move generation. */
let lastAIStats={depth:0,nodes:0,elapsed:0};
const SEARCH_ABORT={aborted:true},MATE=120000;
const moveId=m=>[m.fx,m.fy,m.tx,m.ty].join(",");
function scorePosition(b,side){
 let red=0,black=0;
 for(let y=0;y<10;y++)for(let x=0;x<9;x++){
  const p=b[y][x];if(!p)continue;
  const progress=p.side==="red"?9-y:y,center=Math.max(0,4-Math.abs(x-4));
  let v=values[p.t]||0;
  if(p.t==="兵"||p.t==="卒"){
   const crossed=p.side==="red"?y<=4:y>=5;
   v+=(crossed?110:0)+Math.max(0,progress-3)*(crossed?19:5)+center*(crossed?8:3);
  }else if(p.t==="马")v+=center*14+Math.max(0,4-Math.abs(y-4.5))*8;
  else if(p.t==="炮")v+=center*10+(progress>1&&progress<7?24:0);
  else if(p.t==="车")v+=center*6+Math.min(6,progress)*5;
  else if(["仕","士","相","象"].includes(p.t))v+=progress<3?13:0;
  if(p.side==="red")red+=v;else black+=v;
 }
 return (side==="red"?red-black:black-red)+(inCheck(b,opposite(side))?35:0)-(inCheck(b,side)?100:0);
}
function checkDeadline(ctx){
 ctx.nodes++;
 if((ctx.nodes&63)===0&&performance.now()>ctx.deadline)throw SEARCH_ABORT;
}
function ordering(b,m,preferred=""){
 const target=b[m.ty][m.tx],mover=b[m.fy][m.fx];
 const capture=target?(values[target.t]||0)*12-(values[mover.t]||0):0;
 return (moveId(m)===preferred?25000:0)+capture+(4-Math.abs(m.tx-4))*4;
}
function ordered(b,moves,preferred=""){return moves.slice().sort((a,z)=>ordering(b,z,preferred)-ordering(b,a,preferred));}
function withMove(b,m,fn){
 const piece=b[m.fy][m.fx],capture=b[m.ty][m.tx];apply(b,m);
 try{return fn();}finally{b[m.fy][m.fx]=piece;b[m.ty][m.tx]=capture;}
}
function quiescence(b,side,alpha,beta,ply,remaining,ctx){
 checkDeadline(ctx);
 const checked=inCheck(b,side);
 let best=checked?-MATE:scorePosition(b,side);
 if(!checked){if(best>=beta)return best;alpha=Math.max(alpha,best);}
 if(remaining<=0)return checked?scorePosition(b,side)-160:best;
 let moves=legalMoves(b,side);
 if(!moves.length)return -MATE+ply;
 if(!checked)moves=moves.filter(m=>!!b[m.ty][m.tx]);
 if(!moves.length)return best;
 for(const m of ordered(b,moves)){
  const v=-withMove(b,m,()=>quiescence(b,opposite(side),-beta,-alpha,ply+1,remaining-1,ctx));
  best=Math.max(best,v);alpha=Math.max(alpha,v);
  if(alpha>=beta)break;
 }
 return best;
}
function searchAI(b,side,depth,alpha,beta,ply,ctx){
 checkDeadline(ctx);
 if(depth<=0)return quiescence(b,side,alpha,beta,ply,ctx.quiet,ctx);
 const moves=legalMoves(b,side);
 if(!moves.length)return -MATE+ply;
 const key=depth>1?keyPosition(b,side):null;
 let best=-Infinity;
 for(const m of ordered(b,moves,key?ctx.pv.get(key)||"":"")){
  const v=-withMove(b,m,()=>searchAI(b,opposite(side),depth-1,-beta,-alpha,ply+1,ctx));
  if(v>best){best=v;if(key)ctx.pv.set(key,moveId(m));}
  alpha=Math.max(alpha,v);if(alpha>=beta)break;
 }
 return best;
}
function chooseAI(){
 const moves=legalMoves(board,"black");if(!moves.length)return null;
 const start=performance.now();
 const budget=difficulty==="easy"?80:difficulty==="normal"?300:850;
 const maxDepth=difficulty==="easy"?1:difficulty==="normal"?3:5;
 const ctx={nodes:0,deadline:start+budget,quiet:difficulty==="hard"?3:2,pv:new Map()};
 let sorted=ordered(board,moves),chosen=sorted[0],finishedDepth=0;
 for(let depth=1;depth<=maxDepth;depth++){
  let bestScore=-Infinity,best=null,complete=false;
  try{
   for(const m of sorted){
    checkDeadline(ctx);
    const score=-withMove(board,m,()=>searchAI(board,"red",depth-1,-Infinity,Infinity,1,ctx));
    if(score>bestScore){best=m;bestScore=score;}
   }
   complete=true;
  }catch(e){if(e!==SEARCH_ABORT)throw e;}
  if(!complete)break;
  if(best){
   chosen=best;finishedDepth=depth;
   sorted=[best,...sorted.filter(m=>moveId(m)!==moveId(best))];
  }
  if(bestScore>MATE-500||performance.now()>ctx.deadline-12)break;
 }
 lastAIStats={depth:finishedDepth,nodes:ctx.nodes,elapsed:Math.round(performance.now()-start)};
 return chosen;
}
function report(t){
 status.textContent=t;
 document.getElementById("undoButton").disabled=!history.length||paused||over;
 GameBridge.report(t,{turn,side:turn,check:!over&&inCheck(board,turn)});
}
function displayPiece(p){
 const glyph={
  red:{"车":"俥","马":"傌","相":"相","仕":"仕","帅":"帥","炮":"炮","兵":"兵"},
  black:{"车":"車","马":"馬","象":"象","士":"士","将":"將","炮":"砲","卒":"卒"}
 };
 return glyph[p.side]?.[p.t]||p.t;
}
function fileNumber(side,x){
 const file=side==="red"?9-x:x+1;
 return side==="red"?"零一二三四五六七八九"[file]:String(file);
}
function moveNotation(b,m,side){
 const p=b[m.fy]?.[m.fx];if(!p)return "";
 const same=[];
 for(let y=0;y<10;y++)if(b[y][m.fx]?.side===side&&b[y][m.fx]?.t===p.t)same.push(y);
 same.sort((a,z)=>side==="red"?a-z:z-a);
 let prefix=p.t+fileNumber(side,m.fx);
 if(same.length>1){
  const index=same.indexOf(m.fy);
  const symbols=same.length===2?["前","后"]:same.length===3?["前","中","后"]:
   same.length===4?["前","二","三","后"]:["前","二","三","四","后"];
  prefix=(symbols[index]||"前")+p.t;
 }
 const forward=side==="red"?m.ty<m.fy:m.ty>m.fy;
 const direction=m.ty===m.fy?"平":forward?"进":"退";
 const last=m.ty===m.fy||m.tx!==m.fx?fileNumber(side,m.tx):
  side==="red"?"零一二三四五六七八九"[Math.abs(m.ty-m.fy)]:String(Math.abs(m.ty-m.fy));
 return prefix+direction+last;
}
function checkingAttackers(b,side){
 const king=findGeneral(b,side);if(!king)return [];
 const enemy=opposite(side),threats=[];
 for(let y=0;y<10;y++)for(let x=0;x<9;x++){
  const p=b[y][x];
  if(p?.side===enemy&&pseudoMoves(b,x,y).some(m=>m.tx===king.x&&m.ty===king.y))
   threats.push({x,y});
 }
 if(generalsFacing(b)){
  const other=findGeneral(b,enemy);
  if(other&&!threats.some(p=>p.x===other.x&&p.y===other.y))threats.push(other);
 }
 return threats;
}
const resultBox=document.getElementById("xiangqiResult");
function clearResult(){
 resultBox.hidden=true;resultBox.classList.remove("visible");resultBox.removeAttribute("data-result");
}
function showResult(winner,reason){
 over=true;clearTimeout(aiTimer);
 const title=!winner?"和棋":mode==="ai"?(winner==="red"?"获胜":"失败"):(winner==="red"?"红方获胜":"黑方获胜");
 const detail=!winner?"双方战成和棋":mode==="ai"?(winner==="red"?"你执红棋取得胜利":"黑方 AI 获胜"):
  (winner==="red"?"红方取得胜利":"黑方取得胜利");
 resultBox.dataset.result=!winner?"draw":mode==="ai"&&winner==="black"?"loss":"win";
 document.getElementById("xiangqiResultSeal").textContent=!winner?"和":winner==="red"?"帥":"將";
 document.getElementById("xiangqiResultTitle").textContent=title;
 document.getElementById("xiangqiResultDescription").textContent=detail+" · "+reason;
 resultBox.hidden=false;resultBox.classList.add("visible");
 const message=!winner?"和棋 · "+reason:mode==="ai"&&winner==="black"?"本局失败 · "+reason:
  (winner==="red"?"红方":"黑方")+"获胜 · "+reason;
 report(message);
 GameBridge.send("GAME_OVER",{message,score:winner==="red"?1:0,win:mode==="ai"?winner==="red":!!winner});
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
 const label=(x,text)=>{const e=document.createElementNS(ns,"text");e.setAttribute("x",String(x));e.setAttribute("y","450");e.setAttribute("dominant-baseline","middle");e.setAttribute("text-anchor","middle");e.setAttribute("class","xiangqi-river-label");e.textContent=text;svg.appendChild(e);};
 label(270,"楚河");label(530,"汉界");
 const mark=(x,y,dx,dy)=>{const a=8,b=17;path("M"+(x+dx*a)+" "+(y+dy*a)+" l"+(-dx*a)+" 0 l0 "+(-dy*b)+" M"+(x+dx*a)+" "+(y+dy*a)+" l0 "+(-dy*a)+" l"+(-dx*b)+" 0");};
 [[1,2],[7,2],[1,7],[7,7],[0,3],[2,3],[4,3],[6,3],[8,3],[0,6],[2,6],[4,6],[6,6],[8,6]].forEach(([x,y])=>{const px=xAt(x),py=yAt(y);if(x>0)mark(px,py,-1,-1);if(x<8)mark(px,py,1,-1);if(x>0)mark(px,py,-1,1);if(x<8)mark(px,py,1,1);});
 // Route numbers reflect each player's right-to-left perspective.
 for(let x=0;x<9;x++){
  const labels=flip?[fileNumber("red",8-x),fileNumber("black",8-x)]:
                    [fileNumber("black",x),fileNumber("red",x)];
  for(const [index,y] of [[0,23],[1,883]]){
   const t=document.createElementNS(ns,"text");
   t.setAttribute("x",String(xAt(x)));t.setAttribute("y",String(y));
   t.setAttribute("text-anchor","middle");t.setAttribute("class","xiangqi-file-label");
   t.textContent=labels[index];svg.appendChild(t);
  }
 }
 svg.dataset.flip=String(flip);
 el.appendChild(svg);
}
const moveList=document.getElementById("moveList"),scrollCue=document.getElementById("xiangqiScrollCue"),scrollThumb=document.getElementById("xiangqiScrollThumb");
function syncMoveScrollbar(){
 const max=Math.max(0,moveList.scrollHeight-moveList.clientHeight);
 scrollCue.hidden=max<=1;
 if(scrollCue.hidden)return;
 const track=Math.max(1,scrollCue.clientHeight),thumbHeight=Math.max(20,track*moveList.clientHeight/moveList.scrollHeight);
 scrollThumb.style.height=Math.min(track,thumbHeight)+"px";
 scrollThumb.style.transform="translateY("+((track-Math.min(track,thumbHeight))*moveList.scrollTop/max)+"px)";
}
moveList.addEventListener("scroll",syncMoveScrollbar,{passive:true});
if(typeof ResizeObserver!=="undefined")new ResizeObserver(syncMoveScrollbar).observe(moveList);
function compactMoveSeconds(ms){
 const ds=Math.max(0,Math.floor((Number(ms)||0)/100)),rest=ds%600;
 return ds>=600?String(Math.floor(ds/600))+":"+String(Math.floor(rest/10)).padStart(2,"0")+"."+(rest%10):
  String(Math.floor(ds/10))+"."+(ds%10);
}
function renderMoveList(){
 const list=document.getElementById("moveList"),times=window.GameTurnClock?.snapshot().records||[];
 list.replaceChildren();
 for(let i=0;i<history.length;i+=2){
  const row=document.createElement("li");
  const index=document.createElement("span");
  index.className="xiangqi-move-index";
  const pair=times.slice(i,Math.min(i+2,history.length));
  index.textContent=String(Math.floor(i/2)+1)+"."+
   (pair.length?"（"+pair.map(item=>compactMoveSeconds(item.ms)).join("/")+"s）":"");
  index.title=pair.map(item=>item.side+" "+compactMoveSeconds(item.ms)+" 秒").join(" / ");
  row.appendChild(index);
  for(let j=i;j<Math.min(i+2,history.length);j++){
   const h=history[j],note=document.createElement("span");
   note.className="xiangqi-move-side "+h.turn;
   note.textContent=h.notation||moveNotation(h.board,h.move,h.turn);
   row.appendChild(note);
  }
  list.appendChild(row);
 }
 document.getElementById("moveCount").textContent=history.length+" 步";
 list.scrollTop=list.scrollHeight;syncMoveScrollbar();
}
function render(animatedMove=null){
 renderMoveList();
 el.querySelectorAll(".xiangqi-cell").forEach(cell=>cell.remove());
 if(!el.querySelector(".xiangqi-lines"))drawBoardLines();
 const targets=new Set(selectedMoves.map(m=>m.tx+","+m.ty));
 const underCheck=!over&&inCheck(board,turn),checkedKing=underCheck?findGeneral(board,turn):null;
 const checking=new Set(underCheck?checkingAttackers(board,turn).map(p=>p.x+","+p.y):[]);
 for(let y=0;y<10;y++)for(let x=0;x<9;x++){
  const px=flip?8-x:x,py=flip?9-y:y,cell=document.createElement("button");
  cell.type="button";cell.className="xiangqi-cell";const boardX=46+(754-46)*x/8,boardY=48+(852-48)*y/9;cell.style.left=(boardX/800*100)+"%";cell.style.top=(boardY/900*100)+"%";cell.style.width=((754-46)/8/800*100)+"%";cell.style.height=((852-48)/9/900*100)+"%";
  cell.dataset.x=String(px);cell.dataset.y=String(py);
  if(selected&&selected.x===px&&selected.y===py)cell.classList.add("selected");
  if(targets.has(px+","+py))cell.classList.add("target");
   if(checkedKing?.x===px&&checkedKing?.y===py)cell.classList.add("checked");
   if(checking.has(px+","+py))cell.classList.add("threatening");
  const p=board[py][px];
  if(p){const s=document.createElement("span");s.className="xiangqi-piece "+p.side;s.textContent=displayPiece(p);cell.appendChild(s);cell.setAttribute("aria-label",(p.side==="red"?"红":"黑")+p.t);}
  else cell.setAttribute("aria-label","空位");
  cell.addEventListener("click",()=>clickCell(px,py));el.appendChild(cell);
 }
 el.dataset.pieceCount=String(board.flat().filter(Boolean).length);
 if(el.querySelector(".xiangqi-lines")?.dataset.flip!==String(flip)){
  el.querySelector(".xiangqi-lines")?.remove();drawBoardLines();
 }
 syncRecordRailHeight();tryMarkLayoutReady();
 animatePiece(animatedMove);
}
function animatePiece(move){
 if(!move||window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;
 const from=el.querySelector('[data-x="'+move.fx+'"][data-y="'+move.fy+'"]'),to=el.querySelector('[data-x="'+move.tx+'"][data-y="'+move.ty+'"] .xiangqi-piece');
 if(!from||!to||!to.animate)return;
 const a=from.getBoundingClientRect(),b=to.getBoundingClientRect();
 to.animate([{transform:"translate("+(a.x+a.width/2-b.x-b.width/2)+"px,"+(a.y+a.height/2-b.y-b.height/2)+"px) scale(1.05)"},{transform:"translate(0,0) scale(1)"}],{duration:215,easing:"cubic-bezier(.2,.73,.25,1)"});
}
function endIfNeeded(){
 const king=findGeneral(board,turn);
 if(!king){showResult(opposite(turn),"将帅被吃");return true;}
 if(!liveMoves(turn).length){showResult(opposite(turn),inCheck(board,turn)?"将死":"困毙");return true;}
 const repetition=repetitionOutcome();
 if(repetition){showResult(repetition.winner,repetition.reason);return true;}
 return false;
}
function nextTurnStatus(){
 return inCheck(board,turn)?(turn==="red"?"红方":"黑方")+"被将军 · 必须应将":
  (turn==="red"?"红方":"黑方")+"回合";
}
function scheduleAI(){
 clearTimeout(aiTimer);if(paused||over||mode!=="ai"||turn!=="black")return;
 aiTimer=setTimeout(()=>{
  if(paused||over||turn!=="black")return;
  const m=chooseAI();if(!m){endIfNeeded();return;}
  history.push({board:clone(board),turn,move:{...m},notation:moveNotation(board,m,turn)});
  const mover=turn;apply(board,m);turn="red";window.GameTurnClock?.record("黑方","红方",history[history.length-1].notation);recordPosition(mover);
  selected=null;selectedMoves=[];render(m);
  if(!endIfNeeded())report(nextTurnStatus());
 },difficulty==="easy"?120:230);
}
function clickCell(x,y){
 if(paused||over||(mode==="ai"&&turn==="black"))return;
 const p=board[y][x];
 if(selected){
  const m=selectedMoves.find(v=>v.tx===x&&v.ty===y);
  if(m){
   history.push({board:clone(board),turn,move:{...m},notation:moveNotation(board,m,turn)});
   const mover=turn;apply(board,m);selected=null;selectedMoves=[];
   turn=opposite(turn);window.GameTurnClock?.record(mover==="red"?"红方":"黑方",turn==="red"?"红方":"黑方",history[history.length-1].notation);recordPosition(mover);render(m);
   if(!endIfNeeded()){
    report(nextTurnStatus()+(mode==="ai"&&turn==="black"?" · AI 思考中":""));
    if(mode==="ai"&&turn==="black")scheduleAI();
   }
   return;
  }
 }
 if(p&&p.side===turn){
  selected={x,y};selectedMoves=liveMoves(turn).filter(m=>m.fx===x&&m.fy===y);
  render();report("已选中 "+p.t+" · 选择合法落点");
 }else{selected=null;selectedMoves=[];render();}
}
function undo(){
 if(!history.length||paused||over)return;
 clearTimeout(aiTimer);
 let count=mode==="ai"?(turn==="red"?2:1):1,removed=Math.min(count,history.length);
 while(count--&&history.length){
  const h=history.pop();board=h.board;turn=h.turn;positionTrail.pop();
 }
 selected=null;selectedMoves=[];over=false;clearResult();window.GameTurnClock?.rewind(removed,turn==="red"?"红方":"黑方");
 render();report("已悔棋 · "+nextTurnStatus());
}
function newGame(){
 clearTimeout(aiTimer);
 board=initial();turn="red";selected=null;selectedMoves=[];
 history=[];positionTrail=[{key:keyPosition(board,turn),lastMover:null,gaveCheck:false}];
 over=false;paused=false;lastAIStats={depth:0,nodes:0,elapsed:0};window.GameTurnClock?.reset("红方");
 clearResult();render();report("红方先行");
}
document.getElementById("resignButton").addEventListener("click",()=>{
 if(paused||over)return;
 const loser=mode==="ai"?"red":turn;
 showResult(opposite(loser),(loser==="red"?"红方":"黑方")+"认输");
});
document.getElementById("flip").addEventListener("click",()=>{flip=!flip;render();});
document.getElementById("undoButton").addEventListener("click",undo);
document.getElementById("xiangqiReplay").addEventListener("click",()=>GameBridge.send("REQUEST_NEW_GAME"));
document.getElementById("xiangqiLeave").addEventListener("click",()=>GameBridge.send("CONTROL",{action:"leave"}));
window.addEventListener("resize",()=>{syncRecordRailHeight();tryMarkLayoutReady();});
if(typeof ResizeObserver!=="undefined"){boardObserver=new ResizeObserver(()=>{syncRecordRailHeight();tryMarkLayoutReady();});boardObserver.observe(boardArea);}
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
   window.GameTurnClock?.reset(turn==="red"?"红方":"黑方");clearResult();render();report(nextTurnStatus());
  },
  legal(side=turn){return liveMoves(side);},
  pseudo(side=turn){return legalMoves(board,side);},
  faces(){return generalsFacing(board);},
  check(side=turn){return inCheck(board,side);},
  terminal(){return endIfNeeded();},
   notation(m,side=turn){return moveNotation(board,m,side);},
   record(){return history.map(h=>h.notation);},
   checkThreats(side=turn){return checkingAttackers(board,side);},
   redraw(){render();},
   aiChoice(level="hard"){difficulty=level;mode="ai";turn="black";return chooseAI();},
   aiStats(){return {...lastAIStats};},
   forceResult(winner,reason="测试终局"){showResult(winner,reason);},
   glyph(side,t){return displayPiece({side,t});},
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
/* The host's global "结束" action marks the session finished without a GAME_OVER.
   Show the same replay/leave surface here without changing any shared host code. */
function showManualEnd(){
 if(over)return;
 over=true;clearTimeout(aiTimer);
 resultBox.dataset.result="ended";
 document.getElementById("xiangqiResultSeal").textContent="終";
 document.getElementById("xiangqiResultTitle").textContent="本局结束";
 document.getElementById("xiangqiResultDescription").textContent="已手动结束 · 可以再开一局或离开";
 resultBox.hidden=false;resultBox.classList.add("visible");
}
window.addEventListener("message",event=>{
 if(event.source!==window.parent)return;
 const m=event.data;
 if(m?.channel!=="gamestation"||m.protocolVersion!==1||m.gameId!=="xiangqi")return;
 /* Manual ending is settled by the host; native effects remain for actual results. */
});
GameBridge.register({init(p){mode=p.mode||"ai";difficulty=p.difficulty||"normal";newGame();},newGame,pause(){paused=true;clearTimeout(aiTimer);report("已暂停");},resume(){paused=false;if(over)return;if(turn==="black"&&mode==="ai"){report(nextTurnStatus()+" · AI 思考中");scheduleAI();}else report(nextTurnStatus());},setMode(v){mode=v==="two"?"two":"ai";},setDifficulty(v){difficulty=v||"normal";},snapshot(){return{board:clone(board),turn,mode,difficulty,flip,history:history.map(h=>({...h,board:clone(h.board),move:h.move?{...h.move}:null})),positionTrail:positionTrail.map(p=>({...p})),turnClock:window.GameTurnClock?.snapshot?.()||null};},restore(s){if(!s||!Array.isArray(s.board)||s.board.length!==10||s.board.some(r=>!Array.isArray(r)||r.length!==9))throw new Error("中国象棋存档数据无效");clearTimeout(aiTimer);board=clone(s.board);turn=s.turn==="black"?"black":"red";mode=s.mode==="two"?"two":"ai";difficulty=s.difficulty||difficulty;flip=!!s.flip;history=Array.isArray(s.history)?s.history.map(h=>({...h,board:clone(h.board),move:h.move?{...h.move}:null})):[];positionTrail=Array.isArray(s.positionTrail)?s.positionTrail.map(p=>({...p})):[];selected=null;selectedMoves=[];over=false;paused=true;clearResult();window.GameTurnClock?.restore?.(s.turnClock);render();report("已恢复上次进度 · "+nextTurnStatus());},dispose(){clearTimeout(aiTimer);boardObserver?.disconnect();window.removeEventListener("resize",syncRecordRailHeight);}});
})();