(function(){
"use strict";
const levels=window.GAME_SOKOBAN_LEVELS;
if(!Array.isArray(levels)||levels.length!==90)throw new Error("经典推箱子关卡集未正确加载");
const board=document.getElementById("board"),stage=document.querySelector(".soko-stage"),status=document.getElementById("sokobanStatus"),
 levelEl=document.getElementById("level"),movesEl=document.getElementById("moves"),
 pushesEl=document.getElementById("pushes"),goalProgressEl=document.getElementById("goalProgress"),
 goalBar=document.getElementById("goalBar"),undoButton=document.getElementById("undo"),
 resetButton=document.getElementById("reset"),nextButton=document.getElementById("next"),
 hintButton=document.getElementById("hint"),dpad=document.getElementById("sokoDpad"),
 chooseButton=document.getElementById("chooseLevel"),victory=document.getElementById("sokoVictory"),
 levelPicker=document.getElementById("sokoLevelPicker"),levelGrid=document.getElementById("sokoLevelGrid"),
 winTitle=document.getElementById("sokoWinTitle"),winSummary=document.getElementById("sokoWinSummary"),
 winNote=document.getElementById("sokoWinNote"),
 winNext=document.getElementById("sokoWinNext"),winStay=document.getElementById("sokoWinStay"),
 winPick=document.getElementById("sokoWinPick"),levelPickerClose=document.getElementById("sokoPickerClose"),
 difficultyEl=document.getElementById("sokoDifficulty"),unlockedEl=document.getElementById("sokoUnlocked");
let level=0,width=0,height=0,player=0,boxes=new Set(),goals=new Set(),walls=new Set(),voids=new Set(),staticDeadSquares=new Set(),goalDistanceMaps=[],
 moves=0,pushes=0,history=[],paused=true,complete=false,hintCount=0,hintTimer=null,
 unlockedThrough=0,bestResults={};
const solverDirections=[
 {dx:0,dy:-1,code:"U",label:"向上"},{dx:0,dy:1,code:"D",label:"向下"},
 {dx:-1,dy:0,code:"L",label:"向左"},{dx:1,dy:0,code:"R",label:"向右"}
];
function difficultyName(index){
 return index<23?"经典挑战 I":index<45?"经典挑战 II":index<68?"经典挑战 III":"经典挑战 IV";
}
function hideOverlays(){victory.hidden=true;levelPicker.hidden=true;}
function refreshLevelPicker(){
 const fragment=document.createDocumentFragment();
 levels.forEach((_,index)=>{
  const button=document.createElement("button");
  button.type="button";button.className="soko-level-option";
  if(index===level)button.classList.add("current");
  if(bestResults[index])button.classList.add("cleared");
  button.dataset.stage=String(index<23?1:index<45?2:index<68?3:4);
  button.disabled=paused;
  button.setAttribute("aria-label","第"+(index+1)+"关 "+difficultyName(index)+(bestResults[index]?" 已通关":index>unlockedThrough?" 自由挑战":" 可挑战"));
  button.textContent=String(index+1).padStart(2,"0")+(bestResults[index]?" ✓":"");
  button.addEventListener("click",()=>{
   if(paused)return;
   parseLevel(index);
   setStatus("已选择第 "+(index+1)+" 关 · "+difficultyName(index)+(index>unlockedThrough?" · 自由挑战":"")+"。");
  });
  fragment.appendChild(button);
 });
 levelGrid.replaceChildren(fragment);
}
function openLevelPicker(){
 if(paused)return;
 victory.hidden=true;levelPicker.hidden=false;refreshLevelPicker();
}
function closeLevelPicker(){levelPicker.hidden=true;if(complete)showVictory();}
function showVictory(){
 winTitle.textContent=level===levels.length-1?"全关通关！":"第 "+(level+1)+" 关胜利！";
 winSummary.textContent="移动 "+moves+" 步 · 推动 "+pushes+" 次 · 提示 "+hintCount+" 次";
 winNote.textContent=level===levels.length-1?"全部关卡已完成，可结束挑战或自由重玩。":"已记录最高进度；可继续下一关，也可自由选择任意关卡。";
 winNext.textContent=level===levels.length-1?"完成挑战":"进入第 "+(level+2)+" 关";
 winNext.disabled=paused;
 winPick.disabled=paused;
 victory.hidden=false;levelPicker.hidden=true;
}
function finishOrNext(){
 if(paused||!complete)return;
 if(level===levels.length-1){
  victory.hidden=true;
  GameBridge.send("GAME_OVER",{message:"推箱子全部 "+levels.length+" 关通关",score:moves,win:true});
 }else nextLevel();
}
function decodeLevel(rows){
 if(!Array.isArray(rows)||!rows.length)throw new Error("推箱子关卡为空");
 const height=rows.length,width=Math.max(...rows.map(row=>String(row).length));
 if(width<5||width>20||height<5||height>20)throw new Error("推箱子关卡尺寸超出范围");
 const grid=rows.map(row=>String(row).padEnd(width," "));
 const voids=new Set(),queue=[];
 const addVoid=(x,y)=>{
  if(x<0||y<0||x>=width||y>=height||grid[y][x]!==" ")return;
  const index=y*width+x;if(voids.has(index))return;voids.add(index);queue.push(index);
 };
 for(let x=0;x<width;x++){addVoid(x,0);addVoid(x,height-1);}
 for(let y=0;y<height;y++){addVoid(0,y);addVoid(width-1,y);}
 for(let cursor=0;cursor<queue.length;cursor++){
  const index=queue[cursor],x=index%width,y=Math.floor(index/width);
  addVoid(x+1,y);addVoid(x-1,y);addVoid(x,y+1);addVoid(x,y-1);
 }
 const walls=new Set(),boxes=new Set(),goals=new Set();let player=-1,players=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const index=y*width+x,symbol=grid[y][x];
  if(symbol==="#"){walls.add(index);continue;}
  if(voids.has(index)||symbol===" ")continue;
  if(symbol==="$")boxes.add(index);
  else if(symbol===".")goals.add(index);
  else if(symbol==="@"){player=index;players++;}
  else if(symbol==="*"){boxes.add(index);goals.add(index);}
  else if(symbol==="+"){player=index;players++;goals.add(index);}
  else throw new Error("推箱子关卡包含未知符号："+symbol);
 }
 if(players!==1||!boxes.size||boxes.size!==goals.size)throw new Error("推箱子关卡的玩家、箱子和目标数量不匹配");
 return{width,height,walls,voids,boxes,goals,player};
}
function sameSet(a,b){return a.size===b.size&&[...a].every(value=>b.has(value));}
function mapIndexForBoard(w,h,wallSet,voidSet,goalSet){
 for(let i=0;i<levels.length;i++){
  const layout=decodeLevel(levels[i]);
  if(layout.width===w&&layout.height===h&&sameSet(layout.walls,wallSet)&&
   sameSet(layout.voids,voidSet)&&sameSet(layout.goals,goalSet))return i;
 }
 return null;
}
function setStatus(message,notify){status.textContent=message;if(notify)GameBridge.report(message,{score:moves});}
function isInside(x,y){return x>=0&&x<width&&y>=0&&y<height;}
function isBlocked(x,y){return !isInside(x,y)||walls.has(y*width+x)||voids.has(y*width+x);}
function completedGoals(){let count=0;for(const goal of goals)if(boxes.has(goal))count++;return count;}
function isComplete(){return goals.size===boxes.size&&completedGoals()===goals.size;}
function computeStaticDeadSquares(){
 const canReachGoal=new Set(goals),queue=[...goals];
 for(let cursor=0;cursor<queue.length;cursor++){
  const index=queue[cursor],x=index%width,y=Math.floor(index/width);
  for(const direction of solverDirections){
   const px=x-direction.dx,py=y-direction.dy,sx=x-2*direction.dx,sy=y-2*direction.dy;
   if(isBlocked(px,py)||isBlocked(sx,sy))continue;
   const previous=py*width+px;
   if(!canReachGoal.has(previous)){canReachGoal.add(previous);queue.push(previous);}
  }
 }
 const dead=new Set();
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const index=y*width+x;if(!isBlocked(x,y)&&!canReachGoal.has(index))dead.add(index);
 }
 return dead;
}
function isCornerDeadlock(index){return staticDeadSquares.has(index);}
function clearHintHighlight(){
 if(hintTimer!==null){clearTimeout(hintTimer);hintTimer=null;}
 dpad.querySelectorAll(".soko-dir.suggested").forEach(button=>button.classList.remove("suggested"));
}
function reachableFrom(start,occupied){
 const parents=new Map([[start,null]]),queue=[start];
 for(let cursor=0;cursor<queue.length;cursor++){
  const index=queue[cursor],x=index%width,y=Math.floor(index/width);
  for(const direction of solverDirections){
   const nx=x+direction.dx,ny=y+direction.dy,next=ny*width+nx;
   if(isBlocked(nx,ny)||occupied.has(next)||parents.has(next))continue;
   parents.set(next,{previous:index,code:direction.code});queue.push(next);
  }
 }
 let canonical=Infinity;for(const index of parents.keys())if(index<canonical)canonical=index;
 return{
  parents,canonical,
  pathTo(target){
   if(!parents.has(target))return null;
   const path=[];let cursor=target;
   while(cursor!==start){const step=parents.get(cursor);if(!step)return null;path.push(step.code);cursor=step.previous;}
   return path.reverse();
  }
 };
}
function isTwoByTwoDeadlock(occupied,anchor){
 const x=anchor%width,y=Math.floor(anchor/width);
 for(const oy of [-1,0])for(const ox of [-1,0]){
  const cells=[[x+ox,y+oy],[x+ox+1,y+oy],[x+ox,y+oy+1],[x+ox+1,y+oy+1]];
  const full=cells.every(([cx,cy])=>{
   if(!isInside(cx,cy))return true;
   const index=cy*width+cx;
   return walls.has(index)||voids.has(index)||occupied.has(index);
  });
  const trappedBox=cells.some(([cx,cy])=>{
   if(!isInside(cx,cy))return false;
   const index=cy*width+cx;
   return occupied.has(index)&&!goals.has(index);
  });
  if(full&&trappedBox)return true;
 }
 return false;
}
function findSolutionPath(maxStates=50000){
 const startBoxes=[...boxes].sort((a,b)=>a-b),startReach=reachableFrom(player,new Set(startBoxes));
 const startKey=startBoxes.join(",")+"|"+startReach.canonical;
 const parents=new Map([[startKey,null]]),queue=[{player,boxes:startBoxes,key:startKey}];
 let finishKey=null;
 for(let cursor=0;cursor<queue.length;cursor++){
  const state=queue[cursor];
  if(state.boxes.length===goals.size&&state.boxes.every(index=>goals.has(index))){finishKey=state.key;break;}
  const occupied=new Set(state.boxes),reach=reachableFrom(state.player,occupied);
  for(const box of state.boxes)for(const direction of solverDirections){
   const x=box%width,y=Math.floor(box/width);
   const behindX=x-direction.dx,behindY=y-direction.dy,behind=behindY*width+behindX;
   if(isBlocked(behindX,behindY)||!reach.parents.has(behind))continue;
   const nx=x+direction.dx,ny=y+direction.dy,destination=ny*width+nx;
   if(isBlocked(nx,ny)||occupied.has(destination)||staticDeadSquares.has(destination))continue;
   const nextBoxes=state.boxes.filter(index=>index!==box).concat(destination).sort((a,b)=>a-b);
   if(isTwoByTwoDeadlock(new Set(nextBoxes),destination))continue;
   const nextPlayer=box,nextReach=reachableFrom(nextPlayer,new Set(nextBoxes));
   const nextKey=nextBoxes.join(",")+"|"+nextReach.canonical;
   if(parents.has(nextKey))continue;
   const walk=reach.pathTo(behind);if(!walk)continue;
   parents.set(nextKey,{previous:state.key,walk,push:direction.code});
   queue.push({player:nextPlayer,boxes:nextBoxes,key:nextKey});
   if(queue.length>=maxStates)return null;
  }
 }
 if(!finishKey)return null;
 const segments=[];let key=finishKey;
 while(key!==startKey){
  const step=parents.get(key);if(!step)return null;
  segments.push(step.walk.concat(step.push));key=step.previous;
 }
 return segments.reverse().flat();
}
function hint(){
 if(paused||complete)return;
 clearHintHighlight();
 const path=findHintPath();
 if(!path){setStatus("当前局面没有安全的直接推送建议；可撤销最近一步或重新规划。");return;}
 if(!path.length){setStatus("所有箱子已经到位，本关完成。");return;}
 const direction=solverDirections.find(item=>item.code===path[0]);
 const target=(Math.floor(player/width)+direction.dy)*width+(player%width)+direction.dx;
 const pushing=boxes.has(target),button=dpad.querySelector('[data-move="'+direction.dx+","+direction.dy+'"]');
 if(button){button.classList.add("suggested");hintTimer=setTimeout(()=>{button.classList.remove("suggested");hintTimer=null;},1800);}
 hintCount++;
 setStatus("建议下一步："+direction.label+(pushing?"推动前方木箱":"移动一步")+
  "。提示依据箱子到目标点的可达性评估，不保证全局最优，也不会自动移动。");
}
function updateControls(){
 undoButton.disabled=paused||history.length===0;resetButton.disabled=paused;hintButton.disabled=paused||complete;
 nextButton.disabled=paused||!complete||level>=levels.length-1;
 chooseButton.disabled=paused;winNext.disabled=paused;winPick.disabled=paused;
 nextButton.querySelector("span").textContent=level>=levels.length-1?"全部通关":"下一关";
 dpad.querySelectorAll("button[data-move]").forEach(button=>button.disabled=paused||complete);
}
function updateStats(){
 const done=completedGoals(),total=goals.size;
 levelEl.textContent=(level+1)+" / "+levels.length;
 difficultyEl.textContent=difficultyName(level);
 unlockedEl.textContent="第 "+(unlockedThrough+1)+" / "+levels.length+" 关";
 movesEl.textContent=String(moves);pushesEl.textContent=String(pushes);
 goalProgressEl.textContent=done+" / "+total;goalBar.style.width=(total?Math.round(done/total*100):0)+"%";updateControls();
}
function render(){
 const fragment=document.createDocumentFragment(),deadlocked=new Set();
 for(const box of boxes)if(isCornerDeadlock(box))deadlocked.add(box);
 board.style.gridTemplateColumns="repeat("+width+",minmax(0,1fr))";
 board.style.gridTemplateRows="repeat("+height+",minmax(0,1fr))";board.style.aspectRatio=width+" / "+height;
 board.setAttribute("aria-rowcount",String(height));board.setAttribute("aria-colcount",String(width));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const index=y*width+x,cell=document.createElement("div");cell.className="soko-cell";cell.setAttribute("role","gridcell");
  if(voids.has(index)){cell.classList.add("void");cell.setAttribute("aria-label","地图外");}
  else if(walls.has(index)){cell.classList.add("wall");cell.setAttribute("aria-label","墙");}
  else{
   cell.classList.add("floor");if(goals.has(index))cell.classList.add("goal");
   if(boxes.has(index)){
    cell.classList.add("box");if(goals.has(index))cell.classList.add("box-on-goal");
    if(deadlocked.has(index))cell.classList.add("deadlocked");
    cell.setAttribute("aria-label",goals.has(index)?"箱子已到达目标点":"木箱");
    const piece=document.createElement("span");piece.className="soko-piece";piece.setAttribute("aria-hidden","true");piece.textContent=goals.has(index)?"✓":"▣";cell.appendChild(piece);
   }else if(player===index){
    cell.classList.add("player");if(goals.has(index))cell.classList.add("player-on-goal");
    cell.setAttribute("aria-label",goals.has(index)?"玩家，站在目标点上":"玩家");
    const piece=document.createElement("span");piece.className="soko-piece";piece.setAttribute("aria-hidden","true");piece.textContent="●";cell.appendChild(piece);
   }else cell.setAttribute("aria-label",goals.has(index)?"目标点":"空地");
  }
  fragment.appendChild(cell);
 }
 board.replaceChildren(fragment);updateStats();
}
function fitStage(){
 if(!stage||!width||!height)return;
 const panel=stage.parentElement;
 if(!panel)return;
 const area=stage.closest(".game-main-board");
 const innerSize=element=>{
  const bounds=element.getBoundingClientRect(),css=getComputedStyle(element);
  return{
   width:bounds.width-parseFloat(css.paddingLeft||0)-parseFloat(css.paddingRight||0),
   height:bounds.height-parseFloat(css.paddingTop||0)-parseFloat(css.paddingBottom||0)
  };
 };
 const panelSize=innerSize(panel),areaSize=area?innerSize(area):panelSize;
 const availableWidth=Math.min(panelSize.width,areaSize.width)-2;
 const availableHeight=Math.min(panelSize.height,areaSize.height)-2;
 // The grid's 4px gaps, 10px padding and 3px border must be subtracted
 // before sizing cells; outer-board aspect ratio alone distorts rectangular maps.
 const gap=4,edge=13;
 const cell=Math.min((availableWidth-2*edge-gap*(width-1))/width,
  (availableHeight-2*edge-gap*(height-1))/height);
 if(!Number.isFinite(cell)||cell<=0)return;
 const side=Math.max(1,Math.floor(cell*100)/100);
 const boardWidth=width*side+gap*(width-1)+2*edge;
 const boardHeight=height*side+gap*(height-1)+2*edge;
 stage.style.width=boardWidth+"px";
 stage.style.height=boardHeight+"px";
 stage.style.aspectRatio=boardWidth+" / "+boardHeight;
}
function parseLevel(index){
 clearHintHighlight();hideOverlays();hintCount=0;
 level=Math.max(0,Math.min(levels.length-1,Math.floor(Number(index)||0)));
 const layout=decodeLevel(levels[level]);
 width=layout.width;height=layout.height;walls=layout.walls;voids=layout.voids;
 boxes=layout.boxes;goals=layout.goals;player=layout.player;
 staticDeadSquares=computeStaticDeadSquares();fitStage();
 moves=0;pushes=0;history=[];complete=isComplete();render();
 setStatus("第 "+(level+1)+" / "+levels.length+" 关 · "+difficultyName(level)+" · "+boxes.size+" 个木箱。先规划推送顺序，避免箱子进入死格。");
}
function save(){history.push({player,boxes:[...boxes],moves,pushes});if(history.length>200)history.shift();}
function move(dx,dy){
 if(paused||complete||Math.abs(dx)+Math.abs(dy)!==1)return false;
 clearHintHighlight();
 const x=player%width,y=Math.floor(player/width),nx=x+dx,ny=y+dy;
 if(isBlocked(nx,ny)){setStatus("前方是墙，不能通过。");return false;}
 const target=ny*width+nx;let pushed=false,destination=-1;
 if(boxes.has(target)){
  const bx=nx+dx,by=ny+dy;
  if(isBlocked(bx,by)||boxes.has(by*width+bx)){setStatus("箱子前方被挡住，无法推动。");return false;}
  destination=by*width+bx;pushed=true;
 }
 save();if(pushed){boxes.delete(target);boxes.add(destination);pushes++;}
 player=target;moves++;complete=isComplete();render();
 if(complete){
  unlockedThrough=Math.max(unlockedThrough,Math.min(level+1,levels.length-1));
  const prior=bestResults[level];
  if(!prior||moves<prior.moves||(moves===prior.moves&&pushes<prior.pushes))bestResults[level]={moves,pushes};
  updateStats();
  setStatus(level===levels.length-1?"全部 "+levels.length+" 关通关！":"第 "+(level+1)+" 关胜利！请在结算中选择下一关。",true);
  showVictory();
 }else if(pushed&&isCornerDeadlock(destination))setStatus("注意：箱子被推入角落，已经无法移动。按 Z 或点击撤销一步。");
 else if(pushed)setStatus("推动成功 · "+completedGoals()+" / "+goals.size+" 个箱子已到位。");
 else setStatus("移动 "+moves+" 步 · 已推动 "+pushes+" 次。");
 return true;
}
function undo(){
 if(paused||!history.length)return false;
 clearHintHighlight();
 const previous=history.pop();player=previous.player;boxes=new Set(previous.boxes);
 moves=previous.moves;pushes=previous.pushes;complete=isComplete();hideOverlays();render();
 setStatus("已撤销一步 · 可以重新规划推动方向。");return true;
}
function resetLevel(){if(paused)return;parseLevel(level);setStatus("本关已重置，从头规划路线。");}
function nextLevel(){
 if(paused||!complete||level>=levels.length-1)return false;
 parseLevel(level+1);setStatus("第 "+(level+1)+" 关 · 观察箱子和目标点的位置，再规划路线。");return true;
}
function newGame(){paused=false;parseLevel(0);}
function key(event){
 const target=event.target instanceof Element?event.target:null;
 if(target&&(target.matches("input,textarea,select")||target.isContentEditable))return;
 const key=event.key.toLowerCase(),directions={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0],w:[0,-1],s:[0,1],a:[-1,0],d:[1,0]};
 if(directions[event.key]||directions[key]){event.preventDefault();move(...(directions[event.key]||directions[key]));return;}
 if(key==="z"){event.preventDefault();undo();return;}if(key==="r"){event.preventDefault();resetLevel();}
}
function dpadClick(event){const button=event.target.closest("button[data-move]");if(!button)return;const parts=button.dataset.move.split(",").map(Number);move(parts[0],parts[1]);}
function snapshot(){
 return{layoutVersion:4,level,width,height,player,boxes:[...boxes],goals:[...goals],walls:[...walls],voids:[...voids],
  unlockedThrough,bestResults,
  moves,pushes,complete,hintCount,history:history.map(item=>({player:item.player,boxes:item.boxes.slice(),moves:item.moves,pushes:item.pushes}))};
}
function restore(saved){
 clearHintHighlight();
 const validIndex=(value,max)=>Number.isInteger(value)&&value>=0&&value<max;
 if(!saved||!Number.isInteger(saved.level)||!Array.isArray(saved.boxes)||!Array.isArray(saved.goals)||!Array.isArray(saved.walls))throw new Error("推箱子存档数据无效");
 const nextWidth=Number.isInteger(saved.width)?saved.width:9,nextHeight=Number.isInteger(saved.height)?saved.height:7,total=nextWidth*nextHeight;
 if(nextWidth<5||nextWidth>20||nextHeight<5||nextHeight>20||!validIndex(saved.player,total))throw new Error("推箱子存档位置无效");
 const toSet=values=>{
  if(!Array.isArray(values))throw new Error("推箱子存档地图无效");
  const result=new Set(values.map(Number));
  if(result.size!==values.length||[...result].some(index=>!validIndex(index,total)))throw new Error("推箱子存档地图越界");
  return result;
 };
 const nextWalls=toSet(saved.walls),nextVoids=saved.voids===undefined?new Set():toSet(saved.voids),nextGoals=toSet(saved.goals),nextBoxes=toSet(saved.boxes);
 if(!nextGoals.size||nextBoxes.size!==nextGoals.size||nextWalls.has(saved.player)||nextVoids.has(saved.player)||nextBoxes.has(saved.player)||
  [...nextVoids].some(index=>nextWalls.has(index))||[...nextGoals].some(index=>nextWalls.has(index)||nextVoids.has(index))||
  [...nextBoxes].some(index=>nextWalls.has(index)||nextVoids.has(index)))throw new Error("推箱子存档状态不一致");
 const nextHistory=Array.isArray(saved.history)?saved.history.filter(item=>item&&validIndex(item.player,total)&&Array.isArray(item.boxes)).slice(-200).map(item=>({
  player:item.player,boxes:item.boxes.map(Number),moves:Math.max(0,Number(item.moves)||0),pushes:Math.max(0,Number(item.pushes)||0)
 })): [];
 if(nextHistory.some(item=>!validIndex(item.player,total)||new Set(item.boxes).size!==item.boxes.length||item.boxes.some(index=>!validIndex(index,total)||nextWalls.has(index)||nextVoids.has(index))))throw new Error("推箱子撤销记录无效");
 const matchedIndex=mapIndexForBoard(nextWidth,nextHeight,nextWalls,nextVoids,nextGoals);
 level=matchedIndex===null?Math.max(0,Math.min(levels.length-1,saved.level)):matchedIndex;
 const legacyProgress=!Number.isInteger(saved.unlockedThrough)&&saved.layoutVersion!==3&&saved.level>=7?17:0;
 unlockedThrough=Math.max(level,legacyProgress,Number.isInteger(saved.unlockedThrough)?Math.min(levels.length-1,Math.max(0,saved.unlockedThrough)):0);
 bestResults={};
 if(saved.bestResults&&typeof saved.bestResults==="object"&&!Array.isArray(saved.bestResults)){
  for(const [key,value] of Object.entries(saved.bestResults)){
   const index=Number(key);
   if(Number.isInteger(index)&&index>=0&&index<levels.length&&
    Number.isFinite(value?.moves)&&value.moves>=0&&Number.isFinite(value?.pushes)&&value.pushes>=0)
    bestResults[index]={moves:Math.floor(value.moves),pushes:Math.floor(value.pushes)};
  }
 }
 width=nextWidth;height=nextHeight;
 walls=nextWalls;voids=nextVoids;goals=nextGoals;boxes=nextBoxes;player=saved.player;
 staticDeadSquares=computeStaticDeadSquares();fitStage();
 moves=Math.max(0,Number(saved.moves)||0);pushes=Math.max(0,Number(saved.pushes)||0);
 hintCount=Math.max(0,Number(saved.hintCount)||0);
 history=nextHistory;complete=isComplete();paused=true;
 if(complete){unlockedThrough=Math.max(unlockedThrough,Math.min(level+1,levels.length-1));}
 render();
 if(complete){showVictory();setStatus("本关已完成 · 点击顶部「继续」后可选择下一关。");}
 else setStatus("进度已恢复 · 点击顶部「继续」后接着推箱子。");
}
function fixtureState(){
 return{level,width,height,player,boxes:[...boxes].sort((a,b)=>a-b),goals:[...goals].sort((a,b)=>a-b),
  walls:[...walls].sort((a,b)=>a-b),voids:[...voids].sort((a,b)=>a-b),moves,pushes,hintCount,paused,complete,status:status.textContent,
  unlockedThrough,bestResults:{...bestResults},victoryVisible:!victory.hidden,pickerVisible:!levelPicker.hidden,history:history.length};
}
dpad.addEventListener("click",dpadClick);
undoButton.addEventListener("click",undo);resetButton.addEventListener("click",resetLevel);
nextButton.addEventListener("click",nextLevel);hintButton.addEventListener("click",hint);
chooseButton.addEventListener("click",openLevelPicker);
winNext.addEventListener("click",finishOrNext);
winStay.addEventListener("click",()=>{victory.hidden=true;setStatus("第 "+(level+1)+" 关已通关；可继续挑战下一关，也可自由选关。");});
winPick.addEventListener("click",openLevelPicker);
levelPickerClose.addEventListener("click",closeLevelPicker);
window.addEventListener("keydown",key);
const stagePanel=stage?.parentElement;
const stageObserver=typeof ResizeObserver!=="undefined"&&stagePanel
 ?new ResizeObserver(fitStage):null;
if(stageObserver)stageObserver.observe(stagePanel);
window.addEventListener("resize",fitStage);
if(new URLSearchParams(location.search).has("p111Test")){
 window.__p111SokobanTest={
  loadLevel(index){paused=false;parseLevel(index);return fixtureState();},
  // Browser rule fixture: exercises the real move/settlement/snapshot pipeline
  // without pretending the 90 classical maps are one-push tutorial boards.
  loadFixture(rows,index=0){
   const layout=decodeLevel(rows);
   paused=false;hideOverlays();clearHintHighlight();hintCount=0;
   level=Math.max(0,Math.min(levels.length-1,index));
   width=layout.width;height=layout.height;walls=layout.walls;voids=layout.voids;
   boxes=layout.boxes;goals=layout.goals;player=layout.player;
   staticDeadSquares=computeStaticDeadSquares();moves=0;pushes=0;history=[];
   complete=isComplete();fitStage();render();setStatus("规则测试局面");
   return fixtureState();
  },state:fixtureState,
  move(dx,dy){move(dx,dy);return fixtureState();},undo(){undo();return fixtureState();},
  nextLevel(){nextLevel();return fixtureState();},resetLevel(){resetLevel();return fixtureState();},
  openLevelPicker(){openLevelPicker();return fixtureState();},chooseLevel(index){if(Number.isInteger(index)&&index>=0&&index<levels.length&&!paused)parseLevel(index);return fixtureState();},
  snapshot,restore,isCornerDeadlock,levelCount:levels.length,levelRows:index=>levels[index]?.slice()||[],
  levelInfo(index){const d=decodeLevel(levels[index]);return{width:d.width,height:d.height,boxes:d.boxes.size,goals:d.goals.size,players:d.player>=0?1:0,voids:d.voids.size,sourceId:window.GAME_SOKOBAN_LEVEL_ORIGINAL_IDS?.[index],difficultyScore:window.GAME_SOKOBAN_LEVEL_DIFFICULTY_SCORES?.[index]};},
  hintPath(){return findHintPath();}
 };
}
GameBridge.register({
 init(){paused=true;parseLevel(0);setStatus("准备开始 · 经典挑战共 90 关，四阶段递增，可自由选关。");},newGame,
 pause(){paused=true;updateControls();setStatus("已暂停 · 当前关卡和步数均已保留。");},
 resume(){paused=false;updateControls();if(complete){showVictory();setStatus("本关已胜利 · 请选择下一关或留在本关。");}
  else setStatus("继续闯关 · 方向键或右侧方向按钮移动。");},
 snapshot,restore,dispose(){
   paused=true;clearHintHighlight();stageObserver?.disconnect();window.removeEventListener("resize",fitStage);window.removeEventListener("keydown",key);dpad.removeEventListener("click",dpadClick);
   undoButton.removeEventListener("click",undo);resetButton.removeEventListener("click",resetLevel);
   nextButton.removeEventListener("click",nextLevel);hintButton.removeEventListener("click",hint);
  },
});
})();