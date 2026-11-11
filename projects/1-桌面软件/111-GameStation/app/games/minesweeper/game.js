/* P111 Minesweeper R30 — classic blue glass board, reliable rules and records.
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
const menuGameButton=document.getElementById("mineMenuGame");
const menuHelpButton=document.getElementById("mineMenuHelp");
const gameMenu=document.getElementById("mineGameMenu");
const helpMenu=document.getElementById("mineHelpMenu");
const gameArea=document.querySelector(".game-main-board");
const headline=document.getElementById("mineHeadline");
const bestInline=document.getElementById("mineBestInline");
const recordBest=document.getElementById("mineRecordBest");
const recordPlayed=document.getElementById("mineRecordPlayed");
const recordWin=document.getElementById("mineRecordWin");
const isFixture=new URLSearchParams(location.search).has("p111Test");
const RECORD_KEY="p111-minesweeper-records-v1";
const levelNames={easy:"初级",normal:"中级",hard:"高级"};
const flagSVG='<svg class="mine-symbol mine-flag-svg" viewBox="0 0 32 32" aria-hidden="true"><path d="M7 28h19" stroke="#58616a" stroke-width="2.4" stroke-linecap="round"/><path d="M11.5 27V4.5" stroke="#303a43" stroke-width="2.7" stroke-linecap="round"/><path d="M13 5.5l14 3.2-7.2 5.8 7.2 4.2-14 3.2z" fill="#e52e2e" stroke="#7d171b" stroke-width="1.25" stroke-linejoin="round"/><path d="M13.8 6.8l10 2.3-5.3 4.1-4.7-1.1z" fill="#ff8b82"/><path d="M8 29h16" stroke="#353f47" stroke-width="2.7" stroke-linecap="round"/></svg>';
const bombSVG='<svg class="mine-symbol mine-bomb-svg" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 1.5v5M16 25.5v5M1.5 16h5M25.5 16h5M5.7 5.7l3.7 3.7M22.6 22.6l3.7 3.7M26.3 5.7l-3.7 3.7M9.4 22.6l-3.7 3.7" stroke="#202a32" stroke-width="2.3" stroke-linecap="round"/><path d="M13 7.4l3-2.2 3.1 2.3" fill="none" stroke="#222c34" stroke-width="2.2" stroke-linecap="round"/><circle cx="16" cy="17" r="9.4" fill="#171d22" stroke="#090e12" stroke-width="1.4"/><ellipse cx="12.4" cy="13.2" rx="3.1" ry="2.2" fill="#aebbc3"/><circle cx="21.4" cy="20.7" r="1.1" fill="#05090d"/></svg>';
const faceSVG={
 normal:'<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="13" fill="#ffd45b" stroke="#9e742b" stroke-width="1.6"/><path d="M10.5 12.5h.2M21.3 12.5h.2" stroke="#493b2a" stroke-width="2.8" stroke-linecap="round"/><path d="M9.5 18.2q6.5 8 13 0" fill="none" stroke="#493b2a" stroke-width="2" stroke-linecap="round"/></svg>',
 pressed:'<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="13" fill="#ffd45b" stroke="#9e742b" stroke-width="1.6"/><circle cx="10.8" cy="12.2" r="1.8" fill="#493b2a"/><circle cx="21.2" cy="12.2" r="1.8" fill="#493b2a"/><ellipse cx="16" cy="20" rx="3.1" ry="4" fill="#493b2a"/></svg>',
 won:'<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="13" fill="#ffd45b" stroke="#9e742b" stroke-width="1.6"/><rect x="6.8" y="10.5" width="8" height="5.7" rx="1.8" fill="#252a2d" stroke="#5a4325" stroke-width=".8"/><rect x="17.2" y="10.5" width="8" height="5.7" rx="1.8" fill="#252a2d" stroke="#5a4325" stroke-width=".8"/><path d="M14.8 12.6h2.4" stroke="#252a2d" stroke-width="1.7"/><path d="M9.5 19q6.5 8 13 0" fill="none" stroke="#493b2a" stroke-width="2.2" stroke-linecap="round"/><path d="M8.5 8.2l2-1M23.5 8.2l-2-1" stroke="#fff1a9" stroke-width="1.2" stroke-linecap="round"/></svg>',
 lost:'<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="13" fill="#ffd45b" stroke="#9e742b" stroke-width="1.6"/><path d="M9 10l4 4m0-4l-4 4m10-4l4 4m0-4l-4 4" stroke="#493b2a" stroke-width="2" stroke-linecap="round"/><path d="M10 24q6-8 12 0" fill="none" stroke="#493b2a" stroke-width="2" stroke-linecap="round"/></svg>'
};
const faceLabels={normal:"重新开始扫雷",pressed:"正在翻开方格",won:"扫雷胜利",lost:"扫雷失败"};
function setFace(state="normal"){
 const key=Object.prototype.hasOwnProperty.call(faceSVG,state)?state:"normal";
 face.dataset.face=key;face.innerHTML=faceSVG[key];face.setAttribute("aria-label",faceLabels[key]);
}
let cells=[],nodes=[],started=false,over=false,paused=false,flags=0,opened=0,seconds=0,triggerMine=-1;
let elapsedMs=0,runningSince=null,timerId=null,resizeObserver=null,flashTimer=null,resultTimer=null,middleTarget=-1,dualTarget=-1;
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
 if(n<0)return "-"+String(Math.min(99,Math.abs(n)));
 return String(Math.min(999,n));
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
 const victoryFlag=over&&triggerMine<0&&cell.mine&&cell.flag;
 const key=[cell.open,cell.flag,cell.mine,cell.n,over,triggerMine===index,victoryFlag].join(":");
 if(button.dataset.render===key)return;
 button.dataset.render=key;
 button.className="mine-cell"+(cell.open?" open":"")+(cell.flag?" flag":"")+
  (cell.open&&cell.mine?" mine":"")+
  (over&&cell.flag&&!cell.mine?" wrong-flag":"")+
  (cell.open&&cell.mine&&index===triggerMine?" exploded":"")+
  (victoryFlag?" victory-flag":"");
 button.dataset.n=String(cell.n);
 if(cell.flag){
  button.innerHTML=flagSVG+(over&&!cell.mine?'<span class="mine-false-mark" aria-hidden="true">×</span>':"");
 }else if(cell.open&&cell.mine){
  button.innerHTML=bombSVG+(index===triggerMine?'<span class="mine-explosion-burst" aria-hidden="true"></span>':"");
 }else if(cell.open&&cell.n){
  button.textContent=String(cell.n);
 }else button.textContent="";
 if(over&&triggerMine>=0&&cell.mine){const distance=Math.abs(index%W-triggerMine%W)+Math.abs(Math.floor(index/W)-Math.floor(triggerMine/W));button.style.setProperty("--mine-blast-delay",Math.min(720,distance*42)+"ms");}else button.style.removeProperty("--mine-blast-delay");
 if(victoryFlag)button.style.setProperty("--mine-victory-delay",Math.round(index/Math.max(1,cells.length-1)*780)+"ms");else button.style.removeProperty("--mine-victory-delay");
 const name=cell.flag?(over&&!cell.mine?"错误旗帜":"已插旗"):
  cell.open?(cell.mine?(index===triggerMine?"踩中的地雷":"地雷"):cell.n?"数字 "+cell.n:"空白"):
  "未翻开";
 button.setAttribute("aria-label",name);
 button.setAttribute("title",name);
 button.setAttribute("aria-pressed",cell.flag?"true":"false");
}
function render(){
 if(nodes.length!==cells.length)buildBoard();
 boardEl.classList.toggle("mine-blast-sequence",over&&triggerMine>=0);
 boardEl.classList.toggle("mine-victory-sequence",over&&triggerMine<0);
 for(let i=0;i<cells.length;i++)paint(i);
 updateCounters();
}
function makeBoard(){
 stopTimer();
 if(flashTimer!==null){clearTimeout(flashTimer);flashTimer=null;}
 if(resultTimer!==null){clearTimeout(resultTimer);resultTimer=null;}
 boardEl.classList.remove("mine-blast-sequence");
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
 setFace("normal");
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
 setFace(won?"won":"lost");
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
 const message=won?"扫雷成功 · "+levelNames[difficulty]+" "+formatTime(seconds):"踩到地雷";
 report(won?message+" · 庆祝中":"踩到地雷 · 爆炸中…");
 const settle=()=>GameBridge.send("GAME_OVER",{message,score:opened,win:won,difficulty,seconds});
 if(won){
  boardEl.classList.add("mine-victory-sequence");
  resultTimer=setTimeout(()=>{resultTimer=null;boardEl.classList.remove("mine-victory-sequence");settle();},1800);
 }else{
  boardEl.classList.add("mine-blast-sequence");
  resultTimer=setTimeout(()=>{resultTimer=null;settle();},2000);
 }
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
 const targets=neighbors(index).filter(i=>!cells[i].open&&!cells[i].flag);
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
 if(paused||over||!cell?.open||cell.n===0)return;
 const flagged=neighbors(index).filter(i=>cells[i].flag).length;
 if(flagged===cell.n){chord(index);return;}
 flashNeighbors(index);
}
boardEl.addEventListener("click",event=>{const i=cellFromEvent(event);if(i>=0)reveal(i);});
boardEl.addEventListener("contextmenu",event=>{event.preventDefault();const i=cellFromEvent(event);if(i>=0)toggleFlag(i);});
boardEl.addEventListener("mousedown",event=>{
 const i=cellFromEvent(event);
 if(event.button===1){
  event.preventDefault();
  if(i>=0&&cells[i]?.open&&cells[i].n>0)middleTarget=i;
 }
 // Traditional Windows chord: press left and right together on a number.
 if(event.buttons===3&&i>=0&&cells[i]?.open&&cells[i].n>0){
  dualTarget=i;
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
  if(i===target)previewChord(target);
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
 if(event.button===0&&!over&&!paused&&started)setFace("pressed");
});
window.addEventListener("pointerup",()=>{
 if(!over)setFace("normal");
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
function closeMineMenus(){
 for(const [button,popup] of [[menuGameButton,gameMenu],[menuHelpButton,helpMenu]]){
  if(button&&popup){popup.hidden=true;button.setAttribute("aria-expanded","false");}
 }
}
function toggleMineMenu(button,popup){
 if(!button||!popup)return;
 const opening=popup.hidden;closeMineMenus();popup.hidden=!opening;
 button.setAttribute("aria-expanded",String(opening));
}
menuGameButton?.addEventListener("click",()=>toggleMineMenu(menuGameButton,gameMenu));
menuHelpButton?.addEventListener("click",()=>toggleMineMenu(menuHelpButton,helpMenu));
gameMenu?.addEventListener("click",event=>{
 const action=event.target.closest("[data-mine-action]");
 const difficultyButton=event.target.closest("[data-mine-difficulty]");
 closeMineMenus();
 if(action?.dataset.mineAction==="new")GameBridge.send("REQUEST_NEW_GAME");
 if(action?.dataset.mineAction==="help")GameBridge.send("CONTROL",{action:"help"});
 if(difficultyButton)GameBridge.send("CONTROL",{action:"difficulty",value:difficultyButton.dataset.mineDifficulty});
});
helpMenu?.addEventListener("click",event=>{
 if(event.target.closest('[data-mine-action="help"]')){closeMineMenus();GameBridge.send("CONTROL",{action:"help"});}
});
document.addEventListener("pointerdown",event=>{
 if(!event.target.closest(".mine-menu-root"))closeMineMenus();
});
window.addEventListener("keydown",event=>{
 if(event.key==="Escape"){closeMineMenus();return;}
 if(event.key==="F1"&&!event.repeat){event.preventDefault();closeMineMenus();GameBridge.send("CONTROL",{action:"help"});return;}
 if(event.key==="F2"&&!event.repeat){event.preventDefault();closeMineMenus();GameBridge.send("REQUEST_NEW_GAME");}
});
window.addEventListener("resize",fitBoard);
if(typeof ResizeObserver!=="undefined"){
 resizeObserver=new ResizeObserver(fitBoard);
 resizeObserver.observe(gameArea);
}
if(isFixture){
 configure("normal");newGame();
 const fixtureState=()=>({width:W,height:H,mines:MINES,started,over,paused,flags,opened,seconds,resultPending:resultTimer!==null,
  phase:root.dataset.phase,cells:cells.map(c=>({mine:c.mine,open:c.open,flag:c.flag,n:c.n})),
  records:JSON.parse(JSON.stringify(records))});
 window.__p111MineTest={
  loadBoard({width=3,height=3,mines=[]}={}){
   stopTimer();if(resultTimer!==null){clearTimeout(resultTimer);resultTimer=null;}if(flashTimer!==null){clearTimeout(flashTimer);flashTimer=null;}
   W=Math.max(2,Math.floor(width));H=Math.max(2,Math.floor(height));MINES=mines.length;
   boardEl.style.setProperty("--cols",W);
   boardEl.dataset.rows=String(H);boardEl.dataset.columns=String(W);
   cells=Array.from({length:W*H},()=>({mine:false,open:false,flag:false,n:0}));
   for(const i of mines){
    if(!Number.isInteger(i)||i<0||i>=cells.length||cells[i].mine)throw new Error("Invalid mine index");
    cells[i].mine=true;
   }
   recount();started=false;over=false;paused=false;flags=0;opened=0;seconds=0;
   elapsedMs=0;runningSince=null;triggerMine=-1;
   setFace("normal");nodes=[];render();fitBoard();report("测试局面");
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
 snapshot(){return{width:W,height:H,mines:MINES,difficulty,started,flags,opened,seconds,elapsedMs:activeMs(),cells:cells.map(c=>({mine:!!c.mine,open:!!c.open,flag:!!c.flag,n:Number(c.n)||0}))};},
 restore(s){
  if(!s||!Number.isInteger(s.width)||!Number.isInteger(s.height)||!Array.isArray(s.cells)||s.cells.length!==s.width*s.height)throw new Error("扫雷存档数据无效");
  stopTimer();if(flashTimer!==null){clearTimeout(flashTimer);flashTimer=null;}if(resultTimer!==null){clearTimeout(resultTimer);resultTimer=null;}
  W=s.width;H=s.height;MINES=Math.max(0,Number(s.mines)||0);difficulty=Object.hasOwn(levelNames,s.difficulty)?s.difficulty:"normal";
  boardEl.style.setProperty("--cols",W);boardEl.dataset.rows=String(H);boardEl.dataset.columns=String(W);levelEl.textContent=levelNames[difficulty]||"自定义";
  cells=s.cells.map(c=>({mine:!!c.mine,open:!!c.open,flag:!!c.flag,n:Math.max(0,Number(c.n)||0)}));
  started=!!s.started;over=false;paused=true;flags=Math.max(0,Number(s.flags)||cells.filter(c=>c.flag).length);opened=Math.max(0,Number(s.opened)||cells.filter(c=>c.open&&!c.mine).length);
  elapsedMs=Math.max(0,Number(s.elapsedMs)||Math.max(0,Number(s.seconds)||0)*1000);runningSince=null;seconds=Math.min(999,Math.floor(elapsedMs/1000));triggerMine=-1;middleTarget=-1;dualTarget=-1;setFace("normal");nodes=[];render();renderRecords();fitBoard();report("已恢复上次进度");
 },
 dispose(){
  paused=true;stopTimer();if(resultTimer!==null){clearTimeout(resultTimer);resultTimer=null;}resizeObserver?.disconnect();
  window.removeEventListener("resize",fitBoard);
 }
});
})();
