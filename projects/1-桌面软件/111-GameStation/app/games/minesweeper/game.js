/* P111 Minesweeper R29 — classic blue glass board, reliable rules and records.
   No network or external assets; all gameplay remains local to this iframe. */
(function(){
"use strict";
let W=16,H=16,MINES=40,difficulty="normal";
const root=document.getElementById("game");
const boardEl=document.getElementById("board");
const status=document.getElementById("status");
const counter=document.getElementById("counter");
const timerEl=document.getElementById("timer");
const levelEl=document.getElementById("level");
const openedEl=document.getElementById("openedCount");
const remainingEl=document.getElementById("remaining");
const face=document.getElementById("reset");
const gameArea=document.querySelector(".game-main-board");
const headline=document.getElementById("mineHeadline");
const bestInline=document.getElementById("mineBestInline");
const recordBest=document.getElementById("mineRecordBest");
const recordPlayed=document.getElementById("mineRecordPlayed");
const recordWin=document.getElementById("mineRecordWin");
const isFixture=new URLSearchParams(location.search).has("p111Test");
const RECORD_KEY="p111-minesweeper-records-v1";
const levelNames={easy:"初级",normal:"中级",hard:"高级"};
const flagSVG='<svg class="mine-symbol mine-flag-svg" viewBox="0 0 32 32" aria-hidden="true"><path d="M10 27V5" fill="none" stroke="#53677e" stroke-width="2.5" stroke-linecap="round"/><path d="M11 6h17l-5 7 5 7H11z" fill="#df4949" stroke="#a42e35" stroke-width="1.3" stroke-linejoin="round"/><path d="M5 28h13" stroke="#4b6278" stroke-width="3" stroke-linecap="round"/></svg>';
const bombSVG='<svg class="mine-symbol mine-bomb-svg" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2v5M16 25v5M2 16h5M25 16h5M6.2 6.2l3.5 3.5M22.3 22.3l3.5 3.5M25.8 6.2l-3.5 3.5M9.7 22.3l-3.5 3.5" stroke="#344c5f" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="16" r="9.2" fill="#24313d" stroke="#131e2b" stroke-width="1.5"/><circle cx="12.9" cy="12.6" r="2.7" fill="#a8b9c4"/></svg>';
let cells=[],nodes=[],started=false,over=false,paused=false,flags=0,opened=0,seconds=0,triggerMine=-1;
let elapsedMs=0,runningSince=null,timerId=null,resizeObserver=null,flashTimer=null,middleTarget=-1,dualTarget=-1;
function emptyRecord(){return{played:0,won:0,best:null,streak:0};}
function readRecords(){
 try{
  const raw=JSON.parse(localStorage.getItem(RECORD_KEY)||"{}"),out={};
  for(const name of Object.keys(levelNames)){
   const item=raw&&typeof raw==="object"?raw[name]:null;
   out[name]={
    played:Math.max(0,Math.min(999999,Math.floor(Number(item?.played)||0))),
    won:Math.max(0,Math.min(999999,Math.floor(Number(item?.won)||0))),
    best:Number.isFinite(item?.best)&&item.best>=0?Math.min(999,item.best):null,
    streak:Math.max(0,Math.floor(Number(item?.streak)||0))
   };
  }
  return out;
 }catch{return{easy:emptyRecord(),normal:emptyRecord(),hard:emptyRecord()};}
}
const records=readRecords();
function persistRecords(){
 if(isFixture)return;
 try{localStorage.setItem(RECORD_KEY,JSON.stringify(records));}catch{}
}
function formatCounter(value){
 const n=Math.trunc(Number(value)||0);
 if(n<0)return "-"+String(Math.min(99,Math.abs(n))).padStart(2,"0");
 return String(Math.min(999,n)).padStart(3,"0");
}
function formatTime(value){return value===null?"—":Math.floor(value/60)+":"+String(value%60).padStart(2,"0");}
function renderRecords(){
 const item=records[difficulty];
 if(bestInline)bestInline.textContent=item.best===null?"尚无通关记录":"最佳 "+formatTime(item.best);
 if(recordBest)recordBest.textContent=formatTime(item.best);
 if(recordPlayed)recordPlayed.textContent=String(item.played);
 if(recordWin)recordWin.textContent=item.played?Math.round(item.won/item.played*100)+"%":"—";
}
function report(message){
 status.textContent=message;
 if(headline)headline.textContent=message;
 root.dataset.phase=over?(triggerMine>=0?"lost":"won"):paused?"paused":started?"playing":"ready";
 GameBridge.report(message,{score:opened,remaining:MINES-flags});
}
function fitBoard(){
 const rect=gameArea.getBoundingClientRect(),areaStyle=getComputedStyle(gameArea);
 const classic=document.querySelector(".mine-classic"),footer=document.querySelector(".mine-bottom-panel");
 const classicStyle=getComputedStyle(classic),gridStyle=getComputedStyle(boardEl);
 const px=value=>Number.parseFloat(value)||0;
 const overheadX=px(classicStyle.paddingLeft)+px(classicStyle.paddingRight)+
  px(classicStyle.borderLeftWidth)+px(classicStyle.borderRightWidth)+
  px(gridStyle.paddingLeft)+px(gridStyle.paddingRight)+px(gridStyle.borderLeftWidth)+
  px(gridStyle.borderRightWidth)+Math.max(0,W-1)*px(gridStyle.columnGap);
 const overheadY=footer.getBoundingClientRect().height+
  px(classicStyle.rowGap)+px(classicStyle.paddingTop)+px(classicStyle.paddingBottom)+
  px(classicStyle.borderTopWidth)+px(classicStyle.borderBottomWidth)+
  px(gridStyle.paddingTop)+px(gridStyle.paddingBottom)+px(gridStyle.borderTopWidth)+
  px(gridStyle.borderBottomWidth)+Math.max(0,H-1)*px(gridStyle.rowGap);
 const availX=Math.max(0,rect.width-px(areaStyle.paddingLeft)-px(areaStyle.paddingRight)-overheadX-3);
 const availY=Math.max(0,rect.height-px(areaStyle.paddingTop)-px(areaStyle.paddingBottom)-overheadY-3);
 const size=Math.max(10,Math.min(51,availX/W,availY/H));
 const rounded=Math.floor(size*10)/10;
 boardEl.style.setProperty("--mine-cell-size",rounded+"px");
 boardEl.dataset.cellSize=String(rounded);
}
function configure(value){
 difficulty=Object.hasOwn(levelNames,value)?value:"normal";
 if(difficulty==="easy"){W=9;H=9;MINES=10;}
 else if(difficulty==="hard"){W=30;H=16;MINES=99;}
 else{W=16;H=16;MINES=40;}
 levelEl.textContent=levelNames[difficulty];
 boardEl.style.setProperty("--cols",W);
 boardEl.dataset.rows=String(H);
 boardEl.dataset.columns=String(W);
 renderRecords();
}
function now(){return performance.now();}
function activeMs(){return elapsedMs+(runningSince===null?0:Math.max(0,now()-runningSince));}
function updateTimer(){
 seconds=Math.min(999,Math.floor(activeMs()/1000));
 timerEl.textContent=formatCounter(seconds);
}
function startTimer(){
 if(runningSince===null)runningSince=now();
 if(timerId===null)timerId=setInterval(updateTimer,200);
}
function freezeTimer(){
 if(runningSince!==null){elapsedMs+=Math.max(0,now()-runningSince);runningSince=null;}
 updateTimer();
}
function stopTimer(){
 freezeTimer();
 if(timerId!==null){clearInterval(timerId);timerId=null;}
}
function updateCounters(){
 const left=MINES-flags;
 counter.textContent=formatCounter(left);
 remainingEl.textContent=formatCounter(left);
 openedEl.textContent=String(opened);
 updateTimer();
}
function neighbors(index){
 const x=index%W,y=Math.floor(index/W),out=[];
 for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
  if(dx===0&&dy===0)continue;
  const nx=x+dx,ny=y+dy;
  if(nx>=0&&nx<W&&ny>=0&&ny<H)out.push(ny*W+nx);
 }
 return out;
}
function recount(){
 cells.forEach(c=>{c.n=0;});
 for(let i=0;i<cells.length;i++){
  if(cells[i].mine)continue;
  for(const j of neighbors(i))if(cells[j].mine)cells[i].n++;
 }
}
function buildBoard(){
 nodes=[];
 const fragment=document.createDocumentFragment();
 for(let i=0;i<cells.length;i++){
  const button=document.createElement("button");
  button.type="button";button.className="mine-cell";
  button.dataset.index=String(i);button.dataset.render="";
  button.tabIndex=i===0?0:-1;
  nodes.push(button);fragment.appendChild(button);
 }
 boardEl.replaceChildren(fragment);
}
function paint(index){
 const cell=cells[index],button=nodes[index];if(!button)return;
 const key=[cell.open,cell.flag,cell.mine,cell.n,over,triggerMine===index].join(":");
 if(button.dataset.render===key)return;
 button.dataset.render=key;
 button.className="mine-cell"+(cell.open?" open":"")+(cell.flag?" flag":"")+
  (cell.open&&cell.mine?" mine":"")+
  (over&&cell.flag&&!cell.mine?" wrong-flag":"")+
  (cell.open&&cell.mine&&index===triggerMine?" exploded":"");
 button.dataset.n=String(cell.n);
 if(cell.flag){
  button.innerHTML=flagSVG+(over&&!cell.mine?'<span class="mine-false-mark" aria-hidden="true">×</span>':"");
 }else if(cell.open&&cell.mine){
  button.innerHTML=bombSVG;
 }else if(cell.open&&cell.n){
  button.textContent=String(cell.n);
 }else button.textContent="";
 const name=cell.flag?(over&&!cell.mine?"错误旗帜":"已插旗"):
  cell.open?(cell.mine?(index===triggerMine?"踩中的地雷":"地雷"):cell.n?"数字 "+cell.n:"空白"):
  "未翻开";
 button.setAttribute("aria-label",name);
 button.setAttribute("title",name);
 button.setAttribute("aria-pressed",cell.flag?"true":"false");
}
function render(){
 if(nodes.length!==cells.length)buildBoard();
 for(let i=0;i<cells.length;i++)paint(i);
 updateCounters();
}
function makeBoard(){
 stopTimer();
 if(flashTimer!==null){clearTimeout(flashTimer);flashTimer=null;}
 middleTarget=-1;dualTarget=-1;
 nodes.forEach(node=>node.classList.remove("chord-flash"));
 cells=Array.from({length:W*H},()=>({mine:false,open:false,flag:false,n:0}));
 let placed=0;
 while(placed<MINES){
  const i=Math.floor(Math.random()*cells.length);
  if(!cells[i].mine){cells[i].mine=true;placed++;}
 }
 recount();
 started=false;over=false;paused=false;flags=0;opened=0;seconds=0;
 elapsedMs=0;runningSince=null;triggerMine=-1;
 face.textContent="🙂";face.setAttribute("aria-label","重新开始扫雷");
 render();renderRecords();fitBoard();report("点击任意方格开始");
}
function protectFirstClick(index){
 const region=[index,...neighbors(index)];
 const regionSet=new Set(region);
 const blocked=region.filter(i=>cells[i].mine);
 let choices=[];
 for(let i=0;i<cells.length;i++)if(!regionSet.has(i)&&!cells[i].mine)choices.push(i);
 // If the full 3x3 region cannot be cleared, the chosen square itself
 // must still be safe. Never silently change the number of mines.
 const moveFull=choices.length>=blocked.length;
 if(!moveFull){
  if(!cells[index].mine)return;
  choices=[];for(let i=0;i<cells.length;i++)if(i!==index&&!cells[i].mine)choices.push(i);
  if(!choices.length)throw new Error("扫雷棋盘没有安全格");
 }
 for(let i=choices.length-1;i>0;i--){
  const j=Math.floor(Math.random()*(i+1));
  [choices[i],choices[j]]=[choices[j],choices[i]];
 }
 const moving=moveFull?blocked:[index];
 for(let i=0;i<moving.length;i++){
  cells[moving[i]].mine=false;
  cells[choices[i]].mine=true;
 }
 recount();
}
function flood(index){
 const queue=[index],seen=new Set();
 while(queue.length){
  const current=queue.pop();
  if(seen.has(current))continue;seen.add(current);
  const cell=cells[current];
  if(!cell||cell.open||cell.flag||cell.mine)continue;
  cell.open=true;opened++;
  if(cell.n===0)queue.push(...neighbors(current));
 }
}
function conclude(won,exploded=-1){
 if(over)return;
 over=true;triggerMine=won?-1:exploded;
 stopTimer();
 face.textContent=won?"😎":"😵";
 const item=records[difficulty];
 if(won){
  item.won++;item.streak++;
  if(item.best===null||seconds<item.best)item.best=seconds;
  cells.forEach(cell=>{if(cell.mine&&!cell.flag){cell.flag=true;flags++;}});
 }else{
  item.streak=0;
  cells.forEach(cell=>{if(cell.mine&&!cell.flag)cell.open=true;});
 }
 persistRecords();
 render();renderRecords();
 report(won?"扫雷成功 · 用时 "+formatTime(seconds):"踩到地雷 · 再试一次");
 GameBridge.send("GAME_OVER",{message:won?"扫雷成功 · "+levelNames[difficulty]+" "+formatTime(seconds):"踩到地雷",
  score:opened,win:won,difficulty,seconds});
}
function evaluateWin(){if(opened===W*H-MINES)conclude(true);}
function reveal(index){
 if(paused||over||index<0||index>=cells.length)return;
 const cell=cells[index];
 if(cell.open)return;
 if(cell.flag)return;
 if(!started){
  protectFirstClick(index);
  started=true;
  const item=records[difficulty];item.played++;persistRecords();
  startTimer();renderRecords();
 }
 if(cells[index].mine){conclude(false,index);return;}
 flood(index);render();
 if(opened===W*H-MINES){conclude(true);return;}
 report("游戏进行中");
}
function toggleFlag(index){
 if(paused||over||index<0||index>=cells.length||cells[index].open)return;
 cells[index].flag=!cells[index].flag;
 flags+=cells[index].flag?1:-1;
 render();
}
function chord(index){
 const cell=cells[index];
 if(paused||over||!cell||!cell.open||cell.n===0)return;
 const around=neighbors(index),flagged=around.filter(i=>cells[i].flag).length;
 if(flagged!==cell.n)return;
 const covered=around.filter(i=>!cells[i].open&&!cells[i].flag);
 if(!covered.length)return;
 const dangerous=covered.find(i=>cells[i].mine);
 if(dangerous!==undefined){conclude(false,dangerous);return;}
 covered.forEach(flood);render();
 if(opened===W*H-MINES){conclude(true);return;}
 report("游戏进行中");
}
function cellFromEvent(event){
 const b=event.target instanceof Element?event.target.closest(".mine-cell"):null;
 return b&&boardEl.contains(b)?Number(b.dataset.index):-1;
}
function flashNeighbors(index){
 const cell=cells[index];
 if(paused||over||!cell?.open||cell.n===0)return false;
 nodes.forEach(node=>node.classList.remove("chord-flash"));
 const targets=neighbors(index).filter(i=>!cells[i].open);
 targets.forEach(i=>nodes[i]?.classList.add("chord-flash"));
 if(flashTimer!==null)clearTimeout(flashTimer);
 flashTimer=setTimeout(()=>{
  targets.forEach(i=>nodes[i]?.classList.remove("chord-flash"));
  flashTimer=null;
 },380);
 return true;
}
function previewChord(index){
 const cell=cells[index];
 if(!flashNeighbors(index))return;
 const board=cells,expected=cell.n;
 const flagged=neighbors(index).filter(i=>cells[i].flag).length;
 // The covered neighbours flash first, just like classic Minesweeper.
 // Reveal only when the number of flags matches the number on the centre tile.
 if(flagged!==expected)return;
 setTimeout(()=>{
  if(cells!==board||paused||over||!cells[index]?.open)return;
  if(neighbors(index).filter(i=>cells[i].flag).length===expected)chord(index);
 },230);
}
boardEl.addEventListener("click",event=>{const i=cellFromEvent(event);if(i>=0)reveal(i);});
boardEl.addEventListener("contextmenu",event=>{event.preventDefault();const i=cellFromEvent(event);if(i>=0)toggleFlag(i);});
boardEl.addEventListener("mousedown",event=>{
 const i=cellFromEvent(event);
 if(event.button===1){
  event.preventDefault();
  if(i>=0&&cells[i]?.open&&cells[i].n>0){middleTarget=i;flashNeighbors(i);}
 }
 // Traditional Windows chord: press left and right together on a number.
 if(event.buttons===3&&i>=0&&cells[i]?.open&&cells[i].n>0){
  dualTarget=i;flashNeighbors(i);
 }
});
boardEl.addEventListener("mouseup",event=>{
 const i=cellFromEvent(event);
 if(event.button===1&&middleTarget>=0){
  const target=middleTarget;middleTarget=-1;
  if(i===target)previewChord(target);
 }
 if(dualTarget>=0&&event.buttons!==3){
  const target=dualTarget;dualTarget=-1;
  if(i===target)chord(target);
 }
});
boardEl.addEventListener("auxclick",event=>{
 if(event.button===1)event.preventDefault();
});
boardEl.addEventListener("dblclick",event=>{
 const i=cellFromEvent(event);
 if(i<0||!cells[i]?.open||cells[i].n===0)return;
 event.preventDefault();previewChord(i);
});
boardEl.addEventListener("pointerdown",event=>{
 if(event.button===0&&!over&&!paused&&started)face.textContent="😮";
});
window.addEventListener("pointerup",()=>{
 if(!over)face.textContent="🙂";
});
boardEl.addEventListener("keydown",event=>{
 const i=cellFromEvent(event);if(i<0||paused||over)return;
 if(event.key.toLowerCase()==="f"){
  event.preventDefault();toggleFlag(i);return;
 }
 const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-W,ArrowDown:W}[event.key];
 if(delta===undefined)return;
 const next=i+delta;
 if(next<0||next>=W*H||(event.key==="ArrowLeft"&&i%W===0)||
  (event.key==="ArrowRight"&&i%W===W-1))return;
 event.preventDefault();
 nodes[i].tabIndex=-1;nodes[next].tabIndex=0;nodes[next].focus();
});
function newGame(){makeBoard();}
face.addEventListener("click",()=>GameBridge.send("REQUEST_NEW_GAME"));
window.addEventListener("resize",fitBoard);
if(typeof ResizeObserver!=="undefined"){
 resizeObserver=new ResizeObserver(fitBoard);
 resizeObserver.observe(gameArea);
}
if(isFixture){
 configure("normal");newGame();
 const fixtureState=()=>({width:W,height:H,mines:MINES,started,over,paused,flags,opened,seconds,
  phase:root.dataset.phase,cells:cells.map(c=>({mine:c.mine,open:c.open,flag:c.flag,n:c.n})),
  records:JSON.parse(JSON.stringify(records))});
 window.__p111MineTest={
  loadBoard({width=3,height=3,mines=[]}={}){
   stopTimer();W=Math.max(2,Math.floor(width));H=Math.max(2,Math.floor(height));MINES=mines.length;
   boardEl.style.setProperty("--cols",W);
   boardEl.dataset.rows=String(H);boardEl.dataset.columns=String(W);
   cells=Array.from({length:W*H},()=>({mine:false,open:false,flag:false,n:0}));
   for(const i of mines){
    if(!Number.isInteger(i)||i<0||i>=cells.length||cells[i].mine)throw new Error("Invalid mine index");
    cells[i].mine=true;
   }
   recount();started=false;over=false;paused=false;flags=0;opened=0;seconds=0;
   elapsedMs=0;runningSince=null;triggerMine=-1;
   face.textContent="🙂";nodes=[];render();fitBoard();report("测试局面");
   return fixtureState();
  },
  state:fixtureState,
  reveal(index){reveal(index);return fixtureState();},
  toggleFlag(index){toggleFlag(index);return fixtureState();},
  chord(index){chord(index);return fixtureState();},
  previewChord(index){previewChord(index);return fixtureState();},
  flashNeighbors(index){flashNeighbors(index);return fixtureState();},
  stopTimer,
  forceFlag(index){if(cells[index]){cells[index].flag=true;render();}return fixtureState();},
  forceMine(index){
   cells.forEach(c=>{c.open=false;c.mine=false;});
   if(cells[index]){cells[index].mine=true;cells[index].open=true;render();}
   return fixtureState();
  },
  forceNumber(index,n){
   if(cells[index]){cells[index].open=true;cells[index].flag=false;cells[index].mine=false;cells[index].n=n;render();}
   return fixtureState();
  },
  cellSize(){return Number(boardEl.dataset.cellSize)||0;},
  nodeIdentity(index){return nodes[index]||null;},
  resetRecords(){
   for(const name of Object.keys(levelNames))records[name]=emptyRecord();
   renderRecords();return fixtureState();
  }
 };
}
GameBridge.register({
 init(payload){configure(payload.difficulty);newGame();},
 newGame,
 pause(){paused=true;freezeTimer();report("已暂停");},
 resume(){paused=false;if(started&&!over)startTimer();if(!over)report(started?"游戏进行中":"点击任意方格开始");},
 setDifficulty(value){configure(value);},
 dispose(){
  paused=true;stopTimer();resizeObserver?.disconnect();
  window.removeEventListener("resize",fitBoard);
 }
});
})();
