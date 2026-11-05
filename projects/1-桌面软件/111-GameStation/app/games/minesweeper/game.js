(function(){
"use strict";
let W=16,H=16,MINES=40,difficulty="normal";
const boardEl=document.getElementById("board"),status=document.getElementById("status"),counter=document.getElementById("counter");
const timerEl=document.getElementById("timer"),levelEl=document.getElementById("level"),openedEl=document.getElementById("openedCount"),remainingEl=document.getElementById("remaining"),face=document.getElementById("reset");
const gameArea=document.querySelector(".game-main-board");
let cells=[],started=false,over=false,paused=false,flags=0,opened=0,seconds=0,timerId=null,resizeObserver=null;
function formatCounter(value){const n=Math.trunc(Number(value)||0);if(n<0)return "-"+String(Math.min(99,Math.abs(n))).padStart(2,"0");return String(Math.min(999,n)).padStart(3,"0");}
function setStatus(message){status.textContent=message;GameBridge.report(message,{score:opened,remaining:MINES-flags});}
function fitBoard(){
 const rect=gameArea.getBoundingClientRect(),areaStyle=getComputedStyle(gameArea);
 const classic=document.querySelector(".mine-classic"),panel=document.querySelector(".mine-top-panel");
 const classicStyle=getComputedStyle(classic),gridStyle=getComputedStyle(boardEl);
 const px=value=>Number.parseFloat(value)||0;
 const horizontalOverhead=
  px(classicStyle.paddingLeft)+px(classicStyle.paddingRight)+px(classicStyle.borderLeftWidth)+px(classicStyle.borderRightWidth)+
  px(gridStyle.paddingLeft)+px(gridStyle.paddingRight)+px(gridStyle.borderLeftWidth)+px(gridStyle.borderRightWidth)+
  Math.max(0,W-1)*px(gridStyle.columnGap);
 const verticalOverhead=
  panel.getBoundingClientRect().height+px(classicStyle.rowGap)+
  px(classicStyle.paddingTop)+px(classicStyle.paddingBottom)+px(classicStyle.borderTopWidth)+px(classicStyle.borderBottomWidth)+
  px(gridStyle.paddingTop)+px(gridStyle.paddingBottom)+px(gridStyle.borderTopWidth)+px(gridStyle.borderBottomWidth)+
  Math.max(0,H-1)*px(gridStyle.rowGap);
 const availableWidth=Math.max(0,rect.width-px(areaStyle.paddingLeft)-px(areaStyle.paddingRight)-horizontalOverhead);
 const availableHeight=Math.max(0,rect.height-px(areaStyle.paddingTop)-px(areaStyle.paddingBottom)-verticalOverhead);
 const size=Math.max(10,Math.min(48,availableWidth/W,availableHeight/H));
 const rounded=Math.round(size*10)/10;
 boardEl.style.setProperty("--mine-cell-size",rounded+"px");
 boardEl.dataset.cellSize=String(rounded);
}
function configure(value){
 difficulty=value||"normal";
 if(difficulty==="easy"){W=9;H=9;MINES=10;levelEl.textContent="初级";}
 else if(difficulty==="hard"){W=30;H=16;MINES=99;levelEl.textContent="高级";}
 else{W=16;H=16;MINES=40;levelEl.textContent="中级";}
 boardEl.style.setProperty("--cols",W);
 boardEl.dataset.rows=String(H);
 boardEl.dataset.columns=String(W);
 fitBoard();
}
function stopTimer(){if(timerId!==null){clearInterval(timerId);timerId=null;}}
function updateTimer(){timerEl.textContent=formatCounter(seconds);}
function startTimer(){if(timerId!==null)return;timerId=setInterval(()=>{if(!paused&&!over){seconds++;updateTimer();}},1000);}
function updateCounters(){
 const left=MINES-flags;
 counter.textContent=formatCounter(left);
 remainingEl.textContent=formatCounter(left);
 openedEl.textContent=String(opened);
 updateTimer();
}
function makeBoard(){
 stopTimer();
 cells=Array.from({length:W*H},()=>({mine:false,open:false,flag:false,n:0}));
 let placed=0;
 while(placed<MINES){const i=Math.floor(Math.random()*cells.length);if(!cells[i].mine){cells[i].mine=true;placed++;}}
 recount();started=false;over=false;paused=false;flags=0;opened=0;seconds=0;
 face.textContent="🙂";updateCounters();render();fitBoard();setStatus("点击任意方格开始");
}
function recount(){
 cells.forEach(cell=>cell.n=0);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const cell=cells[y*W+x];if(cell.mine)continue;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   const nx=x+dx,ny=y+dy;
   if(nx>=0&&nx<W&&ny>=0&&ny<H&&cells[ny*W+nx].mine)cell.n++;
  }
 }
}
function neighbors(index){
 const x=index%W,y=Math.floor(index/W),out=[];
 for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
  if(!dx&&!dy)continue;
  const nx=x+dx,ny=y+dy;
  if(nx>=0&&nx<W&&ny>=0&&ny<H)out.push(ny*W+nx);
 }
 return out;
}
function render(){
 boardEl.innerHTML="";
 cells.forEach((cell,index)=>{
  const button=document.createElement("button");
  button.type="button";
  button.className="mine-cell"+(cell.open?" open":"")+(cell.flag?" flag":"")+(cell.open&&cell.mine?" mine":"");
  button.dataset.n=String(cell.n);
  if(cell.open){
   if(cell.mine)button.innerHTML='<svg class="mine-symbol" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2.5M9.5 3.5h5" fill="none" stroke="#26384a" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="14" r="7" fill="#202a34" stroke="#111820" stroke-width="1.2"/><circle cx="9.5" cy="11.5" r="2" fill="#aab7c2"/><path d="M17.5 7.5l2-2M19.5 10h2" stroke="#c34a36" stroke-width="1.8" stroke-linecap="round"/></svg>';
   else if(cell.n)button.textContent=String(cell.n);
  }else if(cell.flag)button.innerHTML='<svg class="mine-symbol" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 22V2.5" stroke="#52677a" stroke-width="2" stroke-linecap="round"/><path d="M7 3.5h12l-3.5 5L19 13H7z" fill="#e13e3e" stroke="#9f2525" stroke-width="1.2" stroke-linejoin="round"/><path d="M4 22h8" stroke="#52677a" stroke-width="2" stroke-linecap="round"/></svg>';
  button.setAttribute("aria-label",cell.open?(cell.mine?"地雷":cell.n?"数字 "+cell.n:"空白"):cell.flag?"已标记":"未翻开");
  button.addEventListener("click",()=>reveal(index));
  button.addEventListener("contextmenu",event=>{event.preventDefault();toggleFlag(index);});
  button.addEventListener("mousedown",event=>{if(event.button===1)event.preventDefault();});
  button.addEventListener("auxclick",event=>{if(event.button===1){event.preventDefault();chord(index);}});
  boardEl.appendChild(button);
 });
 updateCounters();fitBoard();
}
function relocateFirst(index){
 if(!cells[index].mine)return;
 cells[index].mine=false;
 let replacement=-1;
 for(let i=0;i<cells.length;i++)if(i!==index&&!cells[i].mine){replacement=i;break;}
 if(replacement>=0)cells[replacement].mine=true;
 recount();
}
function flood(index){
 const queue=[index],seen=new Set();
 while(queue.length){
  const current=queue.pop();
  if(seen.has(current))continue;
  seen.add(current);
  const cell=cells[current];
  if(!cell||cell.open||cell.flag||cell.mine)continue;
  cell.open=true;opened++;
  if(cell.n===0)queue.push(...neighbors(current));
 }
}
function lose(){
 over=true;stopTimer();face.textContent="😵";
 cells.forEach(cell=>{if(cell.mine)cell.open=true;});
 render();setStatus("踩到地雷 · 再试一次");
 GameBridge.send("GAME_OVER",{message:"踩到地雷",score:opened,win:false});
}
function win(){
 over=true;stopTimer();face.textContent="😎";
 cells.forEach(cell=>{if(cell.mine&&!cell.flag){cell.flag=true;flags++;}});
 render();setStatus("恭喜，全部排除！");
 GameBridge.send("GAME_OVER",{message:"扫雷成功",score:opened,win:true});
}
function reveal(index){
 if(paused||over||cells[index].open||cells[index].flag)return;
 if(!started){relocateFirst(index);started=true;startTimer();}
 if(cells[index].mine){lose();return;}
 flood(index);render();
 if(opened===W*H-MINES){win();return;}
 setStatus("游戏进行中");
}
function toggleFlag(index){
 if(paused||over||cells[index].open)return;
 cells[index].flag=!cells[index].flag;
 flags+=cells[index].flag?1:-1;
 render();
}
function chord(index){
 const cell=cells[index];
 if(paused||over||!cell?.open||cell.n===0)return;
 const around=neighbors(index),flagged=around.filter(i=>cells[i].flag).length;
 if(flagged!==cell.n)return;
 const covered=around.filter(i=>!cells[i].open&&!cells[i].flag);
 if(!covered.length)return;
 if(covered.some(i=>cells[i].mine)){lose();return;}
 covered.forEach(flood);
 render();
 if(opened===W*H-MINES){win();return;}
 setStatus("游戏进行中");
}
function newGame(){makeBoard();}
function onResize(){fitBoard();}
function requestNewGame(){GameBridge.send("REQUEST_NEW_GAME");}
face.addEventListener("click",requestNewGame);
boardEl.addEventListener("contextmenu",event=>event.preventDefault());
window.addEventListener("resize",onResize);
if(typeof ResizeObserver!=="undefined"){resizeObserver=new ResizeObserver(fitBoard);resizeObserver.observe(gameArea);}
if(new URLSearchParams(location.search).has("p111Test")){
 configure("normal");newGame();
 window.__p111MineTest={
  forceFlag(index){if(cells[index]){cells[index].flag=true;render();}},
  forceMine(index){cells.forEach(cell=>{cell.open=false;cell.mine=false;});if(cells[index]){cells[index].mine=true;cells[index].open=true;render();}},
  forceNumber(index,n){if(cells[index]){cells[index].open=true;cells[index].flag=false;cells[index].mine=false;cells[index].n=n;render();}},
  cellSize(){return Number(boardEl.dataset.cellSize)||0;}
 };
}
GameBridge.register({
 init(payload){configure(payload.difficulty);newGame();},
 newGame,
 pause(){paused=true;setStatus("已暂停");},
 resume(){paused=false;if(!over)setStatus(started?"游戏进行中":"点击任意方格开始");},
 setDifficulty(value){configure(value);},
 dispose(){paused=true;stopTimer();resizeObserver?.disconnect();window.removeEventListener("resize",onResize);}
});
})();