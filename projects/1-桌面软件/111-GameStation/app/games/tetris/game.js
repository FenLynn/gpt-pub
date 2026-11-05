(function(){
"use strict";
const canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),status=document.getElementById("status");
const scoreEl=document.getElementById("score"),linesEl=document.getElementById("lines"),levelEl=document.getElementById("level");
const COLS=10,ROWS=20,S=30;
const SHAPES=[[[1,1,1,1]],[[1,0,0],[1,1,1]],[[0,0,1],[1,1,1]],[[1,1],[1,1]],[[0,1,1],[1,1,0]],[[0,1,0],[1,1,1]],[[1,1,0],[0,1,1]]];
const COLORS=["#62b8d8","#6f8ed0","#e1a15e","#d5bf66","#6cb98b","#a38bd0","#d77c78"];
let grid,piece,score=0,lines=0,paused=true,over=false,rafId=null,speed=480,baseSpeed=480,difficulty="normal",lastFrame=0,dropAccumulator=0;
function setStatus(message){status.textContent=message;GameBridge.report(message,{score,lines});}
function randomPiece(){const index=Math.floor(Math.random()*SHAPES.length),shape=SHAPES[index].map(row=>row.slice());return{shape,x:Math.floor(COLS/2)-Math.ceil(shape[0].length/2),y:0,color:COLORS[index]};}
function rotate(matrix){return matrix[0].map((_,index)=>matrix.map(row=>row[index]).reverse());}
function collision(candidate){
 for(let y=0;y<candidate.shape.length;y++)for(let x=0;x<candidate.shape[y].length;x++)if(candidate.shape[y][x]){
  const px=candidate.x+x,py=candidate.y+y;
  if(px<0||px>=COLS||py<0||py>=ROWS||py<0||grid[py][px])return true;
 }
 return false;
}
function block(x,y,color,alpha=1){ctx.globalAlpha=alpha;ctx.fillStyle=color;ctx.fillRect(x*S+1,y*S+1,S-2,S-2);ctx.fillStyle="#ffffff28";ctx.fillRect(x*S+3,y*S+3,S-6,4);ctx.globalAlpha=1;}
function ghostPiece(){let y=piece.y;while(!collision({...piece,y:y+1}))y++;return y;}
function draw(){
 ctx.fillStyle="#132538";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.strokeStyle="#ffffff0c";ctx.lineWidth=1;
 for(let x=1;x<COLS;x++){ctx.beginPath();ctx.moveTo(x*S,0);ctx.lineTo(x*S,canvas.height);ctx.stroke();}
 for(let y=1;y<ROWS;y++){ctx.beginPath();ctx.moveTo(0,y*S);ctx.lineTo(canvas.width,y*S);ctx.stroke();}
 for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++)if(grid[y][x])block(x,y,grid[y][x]);
 if(piece){
  const ghostY=ghostPiece();
  for(let y=0;y<piece.shape.length;y++)for(let x=0;x<piece.shape[y].length;x++)if(piece.shape[y][x])block(piece.x+x,ghostY+y,"#d6e5ee",.18);
  const fraction=Math.min(.98,dropAccumulator/speed);
  let top=ROWS;
  for(let y=0;y<piece.shape.length;y++)for(let x=0;x<piece.shape[y].length;x++)if(piece.shape[y][x]){
   top=Math.min(top,piece.y+y);const renderY=piece.y+y+fraction;
   if(renderY>=0&&renderY<ROWS)block(piece.x+x,renderY,piece.color);
  }
  canvas.dataset.pieceTop=String(top);canvas.dataset.pieceY=String(piece.y);
 }else{canvas.dataset.pieceTop="";canvas.dataset.pieceY="";}
 if(paused&&!over){ctx.fillStyle="#ffffffdc";ctx.font="600 18px sans-serif";ctx.textAlign="center";ctx.fillText("已暂停",150,305);}
 if(over){ctx.fillStyle="#ffffffed";ctx.font="700 19px sans-serif";ctx.textAlign="center";ctx.fillText("游戏结束",150,305);}
 canvas.dataset.paused=String(paused);
}
function updateScore(){scoreEl.textContent=score.toLocaleString("zh-CN");linesEl.textContent=String(lines);levelEl.textContent=String(Math.floor(lines/10)+1);}
function stop(){if(rafId!==null)cancelAnimationFrame(rafId);rafId=null;lastFrame=0;}
function run(){stop();if(paused||over)return;rafId=requestAnimationFrame(frame);}
function finishGame(message){over=true;paused=true;stop();setStatus(message);GameBridge.send("GAME_OVER",{message,score,win:false});updateScore();draw();}
function stepDown(){const next={...piece,y:piece.y+1};if(!collision(next)){piece=next;return true;}lock();return false;}
function frame(now){
 if(paused||over){rafId=null;lastFrame=0;draw();return;}
 if(!lastFrame)lastFrame=now;const delta=Math.min(50,Math.max(0,now-lastFrame));lastFrame=now;dropAccumulator+=delta;
 while(dropAccumulator>=speed&&!over){dropAccumulator-=speed;if(!stepDown()){dropAccumulator=0;break;}}
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
 let cleared=0;for(let y=ROWS-1;y>=0;){if(grid[y].every(Boolean)){grid.splice(y,1);grid.unshift(Array(COLS).fill(0));cleared++;}else y--;}
 if(cleared){lines+=cleared;score+=[0,100,300,500,800][cleared]*Math.max(1,Math.floor(lines/10)+1);speed=Math.max(90,baseSpeed-Math.floor(lines/5)*32);}
 piece=randomPiece();dropAccumulator=0;
 if(collision(piece)){finishGame("游戏结束 · 方块堆叠到顶");return;}
 updateScore();draw();
}
function configure(value){difficulty=value||"normal";baseSpeed=difficulty==="easy"?650:difficulty==="hard"?300:480;}
function newGame(){stop();grid=Array.from({length:ROWS},()=>Array(COLS).fill(0));score=0;lines=0;configure(difficulty);speed=baseSpeed;over=false;paused=false;dropAccumulator=0;piece=randomPiece();updateScore();setStatus("游戏进行中");draw();canvas.focus();run();}
function pause(){if(paused)return;paused=true;setStatus("已暂停");stop();draw();}
function resume(){if(over)return;paused=false;setStatus("游戏进行中");canvas.focus();run();draw();}
function move(dx,dy){if(paused||over||!piece)return;const next={...piece,x:piece.x+dx,y:piece.y+dy};if(!collision(next)){piece=next;if(dy>0){dropAccumulator=0;score++;updateScore();}draw();}else if(dy>0)lock();}
function hardDrop(){if(paused||over||!piece)return;let distance=0;while(!collision({...piece,y:piece.y+1})){piece.y++;distance++;}score+=distance*2;dropAccumulator=0;updateScore();lock();}
function rotatePiece(){if(paused||over||!piece)return;const shape=rotate(piece.shape);for(const dx of [0,-1,1,-2,2]){const next={...piece,shape,x:piece.x+dx};if(!collision(next)){piece=next;draw();return;}}}
function onKeyDown(event){if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"," "].includes(event.key))event.preventDefault();if(paused||over)return;if(event.key==="ArrowLeft")move(-1,0);else if(event.key==="ArrowRight")move(1,0);else if(event.key==="ArrowDown")move(0,1);else if(event.key==="ArrowUp"||event.key.toLowerCase()==="x")rotatePiece();else if(event.key===" ")hardDrop();}
function focusCanvas(){canvas.focus();}
window.addEventListener("keydown",onKeyDown);canvas.addEventListener("pointerdown",focusCanvas);
GameBridge.register({init(payload){configure(payload.difficulty);newGame();},newGame,pause,resume,setDifficulty(value){configure(value);},dispose(){paused=true;stop();window.removeEventListener("keydown",onKeyDown);canvas.removeEventListener("pointerdown",focusCanvas);}});
})();