(function(){
"use strict";
const canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),status=document.getElementById("status");
const scoreEl=document.getElementById("score"),linesEl=document.getElementById("lines"),levelEl=document.getElementById("level");
const COLS=10,ROWS=20,S=30;
const SHAPES=[[[1,1,1,1]],[[1,0,0],[1,1,1]],[[0,0,1],[1,1,1]],[[1,1],[1,1]],[[0,1,1],[1,1,0]],[[0,1,0],[1,1,1]],[[1,1,0],[0,1,1]]];
let grid,piece,score=0,lines=0,paused=true,over=false,rafId=null,speed=480,baseSpeed=480,difficulty="normal",lastFrame=0,dropAccumulator=0;
function setStatus(message){status.textContent=message;GameBridge.report(message,{score,lines});}
function randomPiece(){const shape=SHAPES[Math.floor(Math.random()*SHAPES.length)].map(row=>row.slice());return {shape,x:Math.floor(COLS/2)-Math.ceil(shape[0].length/2),y:0};}
function rotate(matrix){return matrix[0].map((_,index)=>matrix.map(row=>row[index]).reverse());}
function collision(candidate){
 for(let y=0;y<candidate.shape.length;y++)for(let x=0;x<candidate.shape[y].length;x++)if(candidate.shape[y][x]){
  const px=candidate.x+x,py=candidate.y+y;
  if(px<0||px>=COLS||py>=ROWS||(py>=0&&grid[py][px]))return true;
 }
 return false;
}
function block(x,y,color){
 ctx.fillStyle=color;ctx.fillRect(x*S+1,y*S+1,S-2,S-2);
 ctx.fillStyle="#ffffff22";ctx.fillRect(x*S+3,y*S+3,S-6,4);
}
function draw(){
 ctx.fillStyle="#152536";ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.strokeStyle="#ffffff0c";ctx.lineWidth=1;
 for(let x=1;x<COLS;x++){ctx.beginPath();ctx.moveTo(x*S,0);ctx.lineTo(x*S,canvas.height);ctx.stroke();}
 for(let y=1;y<ROWS;y++){ctx.beginPath();ctx.moveTo(0,y*S);ctx.lineTo(canvas.width,y*S);ctx.stroke();}
 for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++)if(grid[y][x])block(x,y,grid[y][x]);
 if(piece){const fraction=Math.min(.98,dropAccumulator/speed);for(let y=0;y<piece.shape.length;y++)for(let x=0;x<piece.shape[y].length;x++)if(piece.shape[y][x])block(piece.x+x,piece.y+y+fraction,"#78a9c7");}
 if(paused&&!over){ctx.fillStyle="#ffffffd9";ctx.font="600 18px sans-serif";ctx.textAlign="center";ctx.fillText("已暂停",150,305);}
 if(over){ctx.fillStyle="#ffffffed";ctx.font="700 19px sans-serif";ctx.textAlign="center";ctx.fillText("游戏结束",150,305);}
}
function updateScore(){
 scoreEl.textContent=score.toLocaleString("zh-CN");
 linesEl.textContent=String(lines);
 levelEl.textContent=String(Math.floor(lines/10)+1);
}
function stop(){if(rafId!==null)cancelAnimationFrame(rafId);rafId=null;lastFrame=0;}
function run(){stop();if(paused||over)return;rafId=requestAnimationFrame(frame);}
function stepDown(){
 const next={...piece,y:piece.y+1};
 if(!collision(next)){piece=next;return true;}
 lock();return false;
}
function frame(now){
 if(paused||over){rafId=null;lastFrame=0;draw();return;}
 if(!lastFrame)lastFrame=now;
 const delta=Math.min(50,Math.max(0,now-lastFrame));lastFrame=now;dropAccumulator+=delta;
 while(dropAccumulator>=speed&&!over){dropAccumulator-=speed;if(!stepDown()){dropAccumulator=0;break;}}
 if(over){rafId=null;draw();return;}
 draw();rafId=requestAnimationFrame(frame);
}
function lock(){
 piece.shape.forEach((row,y)=>row.forEach((value,x)=>{if(value&&piece.y+y>=0)grid[piece.y+y][piece.x+x]="#78a9c7";}));
 let cleared=0;
 for(let y=ROWS-1;y>=0;y--)if(grid[y].every(Boolean)){grid.splice(y,1);grid.unshift(Array(COLS).fill(0));cleared++;y++;}
 if(cleared){lines+=cleared;score+=[0,100,300,500,800][cleared]*Math.max(1,Math.floor(lines/10)+1);speed=Math.max(90,baseSpeed-Math.floor(lines/5)*32);}
 piece=randomPiece();dropAccumulator=0;
 if(collision(piece)){over=true;setStatus("游戏结束");GameBridge.send("GAME_OVER",{message:"方块堆叠到顶",score,win:false});}
 updateScore();draw();
}
function configure(value){difficulty=value||"normal";baseSpeed=difficulty==="easy"?650:difficulty==="hard"?300:480;}
function newGame(){
 stop();grid=Array.from({length:ROWS},()=>Array(COLS).fill(0));score=0;lines=0;configure(difficulty);speed=baseSpeed;over=false;paused=false;dropAccumulator=0;piece=randomPiece();updateScore();setStatus("游戏进行中");run();draw();canvas.focus();
}
function pause(){if(paused)return;paused=true;setStatus("已暂停");draw();}
function pauseLocal(){if(paused)return;paused=true;stop();setStatus("已暂停");draw();}
function resume(){if(over)return;paused=false;setStatus("游戏进行中");run();draw();canvas.focus();}
function move(dx,dy){
 if(paused||over)return;
 const next={...piece,x:piece.x+dx,y:piece.y+dy};
 if(!collision(next)){piece=next;if(dy>0){dropAccumulator=0;score+=1;updateScore();}draw();}
 else if(dy>0)lock();
}
function hardDrop(){
 if(paused||over)return;
 let distance=0;
 while(!collision({...piece,y:piece.y+1})){piece.y++;distance++;}
 score+=distance*2;dropAccumulator=0;updateScore();lock();
}
function onKeyDown(event){
 if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"," "].includes(event.key))event.preventDefault();
 if(event.key==="p"||event.key==="P"){if(paused)resume();else pauseLocal();return;}
 if(paused||over)return;
 if(event.key==="ArrowLeft")move(-1,0);
 else if(event.key==="ArrowRight")move(1,0);
 else if(event.key==="ArrowDown")move(0,1);
 else if(event.key==="ArrowUp"){const candidate={...piece,shape:rotate(piece.shape)};if(!collision(candidate)){piece=candidate;draw();}}
 else if(event.key===" ")hardDrop();
}
window.addEventListener("keydown",onKeyDown);
canvas.addEventListener("pointerdown",()=>canvas.focus());
GameBridge.register({
 init(payload){configure(payload.difficulty);newGame();},
 newGame,
 pause,
 resume,
 setDifficulty(value){configure(value);},
 dispose(){paused=true;stop();window.removeEventListener("keydown",onKeyDown);}
});
})();