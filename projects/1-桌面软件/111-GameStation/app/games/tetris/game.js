(function(){
"use strict";
const canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),status=document.getElementById("status");
const nextCanvas=document.getElementById("nextCanvas");
const scoreEl=document.getElementById("score"),linesEl=document.getElementById("lines"),levelEl=document.getElementById("level");
const COLS=10,ROWS=20,S=30;
const SHAPES=[[[1,1,1,1]],[[1,0,0],[1,1,1]],[[0,0,1],[1,1,1]],[[1,1],[1,1]],[[0,1,1],[1,1,0]],[[0,1,0],[1,1,1]],[[1,1,0],[0,1,1]]];
const COLORS=["#41b8d0","#6684e8","#e68c52","#e8bf55","#55b98b","#a37bdb","#dc6b79"];
const profiles={easy:{gravity:900,min:115,lock:620},normal:{gravity:590,min:82,lock:480},hard:{gravity:340,min:54,lock:350}};
const previews=[nextCanvas,document.getElementById("nextSecond"),document.getElementById("nextThird")];
const holdButton=document.getElementById("holdButton"),holdCanvas=document.getElementById("holdCanvas"),holdEmpty=document.getElementById("holdEmpty"),levelProgress=document.getElementById("levelProgress");
const reducedMotion=matchMedia("(prefers-reduced-motion: reduce)");
let bag=[],queue=[],heldKind=null,holdUsed=false,lockElapsed=0,lockResets=0,combo=0,clearEffect=null;
const level=()=>Math.floor(lines/10)+1;
const profile=()=>profiles[difficulty];
const gravity=()=>Math.max(profile().min,Math.round(profile().gravity*.82**(level()-1)));
let grid,piece,nextPiece=null,score=0,lines=0,paused=true,over=false,rafId=null,speed=590,difficulty="normal",lastFrame=0,dropAccumulator=0,roundSerial=0;
function setStatus(message){status.textContent=message;GameBridge.report(message,{score,lines});}
function pieceOf(kind){
 const shape=SHAPES[kind].map(row=>row.slice());
 return{kind,shape,x:Math.floor((COLS-shape[0].length)/2),y:0,color:COLORS[kind]};
}
function drawKind(){
 if(!bag.length){
  bag=SHAPES.map((_,kind)=>kind);
  for(let i=bag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}
 }
 return bag.pop();
}
function renderPreview(target,preview){
 const c=target.getContext("2d"),w=target.width,h=target.height;
 c.clearRect(0,0,w,h);target.dataset.kind=preview?String(preview.kind):"";
 if(!preview)return;
 const step=Math.min(Math.floor(w/5),Math.floor(h/3.5));
 const left=(w-preview.shape[0].length*step)/2,top=(h-preview.shape.length*step)/2;
 preview.shape.forEach((row,y)=>row.forEach((cell,x)=>{
  if(cell)paintTile(c,left+x*step+1,top+y*step+1,step-2,preview.color);
 }));
}
function drawNext(){
 renderPreview(previews[0],nextPiece);
 previews.slice(1).forEach((target,index)=>renderPreview(target,pieceOf(queue[index])));
 renderPreview(holdCanvas,heldKind===null?null:pieceOf(heldKind));
 holdEmpty.hidden=heldKind!==null;
 holdButton.disabled=paused||over||holdUsed;
}
function resetDrop(){dropAccumulator=0;lockElapsed=0;lockResets=0;}
function spawnQueuedPiece(){
 const spawned=nextPiece||pieceOf(drawKind());
 queue.push(drawKind());nextPiece=pieceOf(queue.shift());
 canvas.dataset.pieceKind=String(spawned.kind);
 resetDrop();drawNext();
 return spawned;
}
function rotate(matrix){return matrix[0].map((_,index)=>matrix.map(row=>row[index]).reverse());}
function collision(candidate){
 for(let y=0;y<candidate.shape.length;y++)for(let x=0;x<candidate.shape[y].length;x++)if(candidate.shape[y][x]){
  const px=candidate.x+x,py=candidate.y+y;
  if(px<0||px>=COLS||py<0||py>=ROWS||grid[py][px])return true;
 }
 return false;
}
function paintTile(c,x,y,size,color){
 c.fillStyle=color;c.beginPath();c.roundRect(x,y,size,size,Math.min(4,size/5));c.fill();
 c.fillStyle="#ffffff3e";c.fillRect(x+4,y+3,Math.max(0,size-8),2);
 c.fillStyle="#14253632";c.fillRect(x+4,y+size-4,Math.max(0,size-8),2);
}
function block(x,y,color){paintTile(ctx,x*S+1,y*S+1,S-2,color);}
function draw(){
 ctx.fillStyle="#15283f";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.strokeStyle="#9bb4cd20";ctx.lineWidth=1;
 for(let x=1;x<COLS;x++){ctx.beginPath();ctx.moveTo(x*S,0);ctx.lineTo(x*S,canvas.height);ctx.stroke();}
 for(let y=1;y<ROWS;y++){ctx.beginPath();ctx.moveTo(0,y*S);ctx.lineTo(canvas.width,y*S);ctx.stroke();}
 for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++)if(grid[y][x])block(x,y,grid[y][x]);
 if(piece){
  canvas.dataset.ghostVisible="false";
  // Only interpolate when the *whole* piece can legally move one grid row.
  // Previously the fractional render offset continued even when collision()
  // blocked the next step. It drew the piece below the floor/stack and then
  // snapped it back up at lock(), appearing to fall and float upward.
  const canFall=!collision({...piece,y:piece.y+1});
  const fraction=canFall?Math.min(.98,Math.max(0,dropAccumulator/speed)):0;
  let top=ROWS,bottom=-1;
  for(let y=0;y<piece.shape.length;y++)for(let x=0;x<piece.shape[y].length;x++)if(piece.shape[y][x]){
   top=Math.min(top,piece.y+y);bottom=Math.max(bottom,piece.y+y);
   const renderY=piece.y+y+fraction;
   // Canvas will clip any paint outside its logical 20-row playfield,
   // but never allow an invalid offset to reach the block renderer.
   if(renderY>=0&&renderY<ROWS)block(piece.x+x,renderY,piece.color);
  }
  canvas.dataset.pieceTop=String(top);canvas.dataset.pieceY=String(piece.y);
  canvas.dataset.pieceCanFall=String(canFall);
  canvas.dataset.pieceVisualBottom=String(bottom+fraction);
  canvas.dataset.pieceLogicalBottom=String(bottom);
  canvas.dataset.pieceRenderFraction=String(fraction);
 }else{canvas.dataset.pieceTop="";canvas.dataset.pieceY="";canvas.dataset.pieceCanFall="";canvas.dataset.pieceVisualBottom="";canvas.dataset.pieceLogicalBottom="";canvas.dataset.pieceRenderFraction="";}
 if(clearEffect){
  ctx.save();ctx.globalAlpha=Math.max(0,1-clearEffect.age/230)*.65;
  ctx.fillStyle="#9fe7ed";
  for(const row of clearEffect.rows)ctx.fillRect(0,row*S,canvas.width,S);
  ctx.restore();
 }
 canvas.dataset.paused=String(paused);
}
function updateScore(){scoreEl.textContent=score.toLocaleString("zh-CN");linesEl.textContent=String(lines);levelEl.textContent=String(level());levelProgress.value=lines%10;canvas.dataset.score=String(score);canvas.dataset.gravity=String(speed);canvas.dataset.combo=String(combo);}
function stop(){if(rafId!==null)cancelAnimationFrame(rafId);rafId=null;lastFrame=0;}
function run(){stop();if(paused||over)return;rafId=requestAnimationFrame(frame);}
function finishGame(message){over=true;paused=true;stop();drawNext();setStatus(message);GameBridge.send("GAME_OVER",{message,score,win:false});updateScore();draw();}
function stepDown(){const next={...piece,y:piece.y+1};if(collision(next))return false;piece=next;return true;}
function frame(now){
 if(paused||over){rafId=null;lastFrame=0;draw();return;}
 if(!lastFrame)lastFrame=now;const delta=Math.min(50,Math.max(0,now-lastFrame));lastFrame=now;dropAccumulator+=delta;
 if(clearEffect){clearEffect.age+=delta;if(clearEffect.age>=230)clearEffect=null;}
 if(collision({...piece,y:piece.y+1})){
  dropAccumulator=0;
  lockElapsed+=delta;
  if(lockElapsed>=profile().lock)lock();
 }else if(dropAccumulator>=speed){dropAccumulator-=speed;stepDown();}
 if(over){rafId=null;draw();return;}draw();rafId=requestAnimationFrame(frame);
}
function lock(){
 if(!piece)return;const placements=[];
 for(let y=0;y<piece.shape.length;y++)for(let x=0;x<piece.shape[y].length;x++)if(piece.shape[y][x]){
  const px=piece.x+x,py=piece.y+y;
  if(px<0||px>=COLS||py<0||py>=ROWS){finishGame("游戏结束 · 方块触及顶部");return;}
  placements.push({x:px,y:py});
 }
 placements.forEach(c=>grid[c.y][c.x]=piece.color);
 const cleared=grid.flatMap((row,y)=>row.every(Boolean)?[y]:[]);
 if(cleared.length){
  grid=grid.filter((_,y)=>!cleared.includes(y));
  grid.unshift(...cleared.map(()=>Array(COLS).fill(0)));
  combo++;
  score+=([0,100,300,500,800][cleared.length]+50*(combo-1))*level();
  lines+=cleared.length;speed=gravity();
  if(!reducedMotion.matches)clearEffect={rows:cleared,age:0};
  const label=cleared.length===4?"四行全消":`消除 ${cleared.length} 行`;
  setStatus(combo>1?`${label} · ${combo} 连消`:label);
 }else combo=0;
 holdUsed=false;piece=spawnQueuedPiece();
 if(collision(piece)){finishGame("游戏结束 · 方块堆叠到顶");return;}
 updateScore();draw();
}
function configure(value){difficulty=Object.hasOwn(profiles,value)?value:"normal";speed=gravity();}
function newGame(){
 stop();roundSerial++;canvas.dataset.roundSerial=String(roundSerial);
 grid=Array.from({length:ROWS},()=>Array(COLS).fill(0));
 score=0;lines=0;combo=0;clearEffect=null;bag=[];queue=[];
 configure(difficulty);over=false;paused=false;heldKind=null;holdUsed=false;
 nextPiece=pieceOf(drawKind());queue=[drawKind(),drawKind()];piece=spawnQueuedPiece();
 updateScore();setStatus("游戏进行中");draw();canvas.focus();run();
}
function pause(){if(paused)return;paused=true;setStatus("已暂停");stop();drawNext();draw();}
function resume(){if(over)return;paused=false;setStatus("游戏进行中");canvas.focus();run();drawNext();draw();}
function reposition(next){
 if(collision(next))return false;
 if(collision({...piece,y:piece.y+1})&&lockResets<8){lockElapsed=0;lockResets++;}
 piece=next;
 return true;
}
function move(dx,dy){
 if(paused||over||!piece)return;
 if(dy){if(stepDown()){dropAccumulator=0;score++;updateScore();}}
 else reposition({...piece,x:piece.x+dx});
 draw();
}
function hardDrop(){if(paused||over||!piece)return;while(stepDown())score+=2;lock();}
function rotatePiece(direction=1){
 if(paused||over||!piece||piece.kind===3)return;
 const clockwise=rotate(piece.shape);
 const shape=direction===1?clockwise:rotate(rotate(clockwise));
 for(const [dx,dy] of [[0,0],[-1,0],[1,0],[-2,0],[2,0],[0,-1],[-1,-1],[1,-1],[0,-2]]){
  if(reposition({...piece,shape,x:piece.x+dx,y:piece.y+dy})){draw();return;}
 }
}
function hold(){
 if(paused||over||holdUsed||!piece)return;
 const incoming=heldKind;heldKind=piece.kind;holdUsed=true;
 piece=incoming===null?spawnQueuedPiece():pieceOf(incoming);
 canvas.dataset.pieceKind=String(piece.kind);resetDrop();drawNext();
 if(collision(piece)){finishGame("游戏结束 · 方块堆叠到顶");return;}
 canvas.focus();draw();
}
function onKeyDown(event){
 if(event.target===holdButton&&event.key===" ")return;
 const key=event.key.toLowerCase();
 if(!["arrowleft","arrowright","arrowup","arrowdown"," ","x","z","c"].includes(key))return;
 event.preventDefault();if(paused||over||event.altKey||event.ctrlKey||event.metaKey)return;
 if(key==="arrowleft")move(-1,0);
 else if(key==="arrowright")move(1,0);
 else if(key==="arrowdown")move(0,1);
 else if(!event.repeat){
  if(key===" ")hardDrop();
  else if(key==="c")hold();
  else rotatePiece(key==="z"?-1:1);
 }
}
function focusCanvas(){canvas.focus();}
window.addEventListener("keydown",onKeyDown);canvas.addEventListener("pointerdown",focusCanvas);holdButton.addEventListener("click",hold);
// Test-only deterministic fixture API. It is not exposed in normal gameplay.
if(new URLSearchParams(location.search).has("p111Test")){
 const copyPiece=p=>p?{...p,shape:p.shape.map(row=>row.slice())}:null;
 const fixtureState=()=>({grid:grid.map(row=>row.slice()),piece:copyPiece(piece),nextPiece:copyPiece(nextPiece),score,lines,paused,over,speed,roundSerial,queue:[...queue],heldKind,holdUsed,combo,lockDelay:profile().lock});
 window.__p111TetrisTest={
  loadState(s){stop();grid=s.grid.map(row=>row.slice());if(grid.length!==ROWS||grid.some(row=>row.length!==COLS))throw new Error("Invalid Tetris grid");piece=copyPiece(s.piece);bag=[];queue=[drawKind(),drawKind()];nextPiece=copyPiece(s.nextPiece||pieceOf(drawKind()));heldKind=null;holdUsed=false;combo=0;clearEffect=null;resetDrop();score=Number(s.score)||0;lines=Number(s.lines)||0;configure(s.difficulty||"normal");over=false;paused=false;dropAccumulator=0;updateScore();draw();return fixtureState();},
  state:fixtureState,
  move(dx,dy){move(dx,dy);return fixtureState();},
  rotate(direction){rotatePiece(direction);return fixtureState();},
  hold(){hold();return fixtureState();},
  deal(){bag=[];return Array.from({length:14},drawKind);},
  hardDrop(){hardDrop();return fixtureState();},
  stepDown(){const moved=stepDown();if(!moved)lock();draw();return{moved,...fixtureState()};}
 };
}
if(window===window.parent){newGame();pause();}
GameBridge.register({init(payload){configure(payload.difficulty);newGame();},newGame,pause,resume,setDifficulty(value){configure(value);},
 snapshot(){const copy=p=>p?{...p,shape:p.shape.map(row=>row.slice())}:null;return{grid:grid.map(row=>row.slice()),piece:copy(piece),nextPiece:copy(nextPiece),score,lines,difficulty,dropAccumulator,roundSerial,bag:[...bag],queue:[...queue],heldKind,holdUsed,lockElapsed,lockResets,combo};},
 restore(s){
  const validPiece=p=>p&&Number.isInteger(p.kind)&&p.kind>=0&&p.kind<SHAPES.length&&Array.isArray(p.shape)&&p.shape.length>0&&p.shape.every(row=>Array.isArray(row)&&row.every(v=>v===0||v===1))&&Number.isInteger(p.x)&&Number.isInteger(p.y);
  if(!s||!Array.isArray(s.grid)||s.grid.length!==ROWS||s.grid.some(row=>!Array.isArray(row)||row.length!==COLS)||!validPiece(s.piece)||!validPiece(s.nextPiece))throw new Error("俄罗斯方块存档数据无效");
  stop();grid=s.grid.map(row=>row.slice());piece={...s.piece,shape:s.piece.shape.map(row=>row.slice())};nextPiece={...s.nextPiece,shape:s.nextPiece.shape.map(row=>row.slice())};
  score=Math.max(0,Number(s.score)||0);lines=Math.max(0,Math.floor(Number(s.lines)||0));configure(s.difficulty||difficulty);
  const validKind=kind=>Number.isInteger(kind)&&kind>=0&&kind<SHAPES.length;
  bag=Array.isArray(s.bag)&&s.bag.every(validKind)?s.bag.slice(0,7):[];
  queue=Array.isArray(s.queue)&&s.queue.length===2&&s.queue.every(validKind)?[...s.queue]:[drawKind(),drawKind()];
  heldKind=validKind(s.heldKind)?s.heldKind:null;holdUsed=!!s.holdUsed;
  dropAccumulator=Math.min(speed,Math.max(0,Number(s.dropAccumulator)||0));
  lockElapsed=Math.min(profile().lock,Math.max(0,Number(s.lockElapsed)||0));
  lockResets=Math.min(8,Math.max(0,Number(s.lockResets)||0));combo=Math.max(0,Math.floor(Number(s.combo)||0));
  clearEffect=null;roundSerial=Math.max(0,Number(s.roundSerial)||roundSerial);
  over=false;paused=true;lastFrame=0;canvas.dataset.roundSerial=String(roundSerial);updateScore();drawNext();draw();setStatus("已恢复上次进度");
 },
 dispose(){paused=true;stop();window.removeEventListener("keydown",onKeyDown);canvas.removeEventListener("pointerdown",focusCanvas);holdButton.removeEventListener("click",hold);}});
})();