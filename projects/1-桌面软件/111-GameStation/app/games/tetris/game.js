(function(){
"use strict";
const canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),status=document.getElementById("status"),scoreEl=document.getElementById("score"),COLS=10,ROWS=20,S=30;
const SHAPES=[[[1,1,1,1]],[[1,0,0],[1,1,1]],[[0,0,1],[1,1,1]],[[1,1],[1,1]],[[0,1,1],[1,1,0]],[[0,1,0],[1,1,1]],[[1,1,0],[0,1,1]]];
let grid,piece,score,lines,paused=true,over=false,timer=null,speed=480,baseSpeed=480,difficulty="normal";
function setStatus(t){status.textContent=t;GameBridge.report(t,{score});}
function randomPiece(){const shape=SHAPES[Math.floor(Math.random()*SHAPES.length)].map(r=>r.slice());return {shape,x:Math.floor(COLS/2)-Math.ceil(shape[0].length/2),y:0};}
function rotate(m){return m[0].map((_,i)=>m.map(row=>row[i]).reverse());}
function collision(p){for(let y=0;y<p.shape.length;y++)for(let x=0;x<p.shape[y].length;x++)if(p.shape[y][x]){const a=p.x+x,b=p.y+y;if(a<0||a>=COLS||b>=ROWS||(b>=0&&grid[b][a]))return true;}return false;}
function draw(){ctx.fillStyle="#152536";ctx.fillRect(0,0,canvas.width,canvas.height);for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++)if(grid[y][x])block(x,y,grid[y][x]);if(piece)for(let y=0;y<piece.shape.length;y++)for(let x=0;x<piece.shape[y].length;x++)if(piece.shape[y][x])block(piece.x+x,piece.y+y,"#78a9c7");if(paused&&!over){ctx.fillStyle="#ffffffcc";ctx.font="600 18px sans-serif";ctx.textAlign="center";ctx.fillText("已暂停",150,305);}if(over){ctx.fillStyle="#ffffffdd";ctx.font="600 18px sans-serif";ctx.textAlign="center";ctx.fillText("游戏结束",150,305);}}
function block(x,y,color){ctx.fillStyle=color;ctx.fillRect(x*S+1,y*S+1,S-2,S-2);ctx.fillStyle="#ffffff22";ctx.fillRect(x*S+3,y*S+3,S-6,4);}
function updateScore(){scoreEl.textContent="分数 "+score+" · 等级 "+(Math.floor(lines/10)+1);}
function stop(){if(timer!==null)clearInterval(timer);timer=null;}
function run(){stop();timer=setInterval(tick,speed);}
function lock(){piece.shape.forEach((r,y)=>r.forEach((v,x)=>{if(v&&piece.y+y>=0)grid[piece.y+y][piece.x+x]="#78a9c7";}));let cleared=0;for(let y=ROWS-1;y>=0;y--)if(grid[y].every(Boolean)){grid.splice(y,1);grid.unshift(Array(COLS).fill(0));cleared++;y++;}if(cleared){lines+=cleared;score+=[0,100,300,500,800][cleared]*Math.max(1,Math.floor(lines/10)+1);speed=Math.max(90,baseSpeed-Math.floor(lines/5)*32);}piece=randomPiece();if(collision(piece)){over=true;stop();setStatus("游戏结束");GameBridge.send("GAME_OVER",{message:"方块堆叠到顶",score,win:false});}updateScore();draw();if(!over&&cleared)run();}
function tick(){if(paused||over)return;const p={...piece,y:piece.y+1};if(!collision(p))piece=p;else lock();draw();}
function configure(v){difficulty=v||"normal";baseSpeed=difficulty==="easy"?650:difficulty==="hard"?300:480;}
function newGame(){stop();grid=Array.from({length:ROWS},()=>Array(COLS).fill(0));score=0;lines=0;configure(difficulty);speed=baseSpeed;over=false;paused=false;piece=randomPiece();updateScore();setStatus("游戏进行中");run();draw();canvas.focus();}
function pause(){paused=true;stop();setStatus("已暂停");draw();}
function resume(){if(over)return;paused=false;setStatus("游戏进行中");run();draw();}
function move(dx,dy){if(paused||over)return;const p={...piece,x:piece.x+dx,y:piece.y+dy};if(!collision(p)){piece=p;draw();}else if(dy>0)lock();}
function hardDrop(){if(paused||over)return;while(!collision({...piece,y:piece.y+1}))piece.y++;lock();draw();}
function key(e){if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"," "].includes(e.key))e.preventDefault();if(e.key==="p"||e.key==="P"){paused?resume():pause();return;}if(paused||over)return;if(e.key==="ArrowLeft")move(-1,0);if(e.key==="ArrowRight")move(1,0);if(e.key==="ArrowDown")move(0,1);if(e.key==="ArrowUp"){const p={...piece,shape:rotate(piece.shape)};if(!collision(p)){piece=p;draw();}}if(e.key===" ")hardDrop();}
window.addEventListener("keydown",key);
GameBridge.register({init(p){configure(p.difficulty);newGame();},newGame,pause,resume,setDifficulty(v){configure(v);},dispose(){pause();window.removeEventListener("keydown",key);}});
})();