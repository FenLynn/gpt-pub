(function(){
"use strict";
const levels=[
 [
  "#########",
  "#       #",
  "#   .   #",
  "#   $   #",
  "#   @   #",
  "#       #",
  "#########"
 ],
 [
  "#########",
  "#       #",
  "#  $ .  #",
  "#  #    #",
  "#  @    #",
  "#       #",
  "#########"
 ],
 [
  "#########",
  "# . .   #",
  "# $ $   #",
  "#       #",
  "# @     #",
  "#       #",
  "#########"
 ],
 [
  "#########",
  "# .     #",
  "# #     #",
  "#   $@  #",
  "#       #",
  "#       #",
  "#########"
 ],
 [
  "#########",
  "#   .   #",
  "#   $   #",
  "#   .   #",
  "#   $   #",
  "#   @   #",
  "#########"
 ],
 [
  "#########",
  "# .   . #",
  "# $   $ #",
  "#       #",
  "#   @   #",
  "#       #",
  "#########"
 ],
 [
  "#########",
  "# .   . #",
  "# $ # $ #",
  "#   #   #",
  "#   @   #",
  "#       #",
  "#########"
 ],
 [
  "#########",
  "# . . . #",
  "# $ $ $ #",
  "#       #",
  "#   @   #",
  "#       #",
  "#########"
 ],
 [
  "#########",
  "# .   . #",
  "#   #   #",
  "# $   $ #",
  "#   @   #",
  "#       #",
  "#########"
 ],
 [
  "#########",
  "# . . . #",
  "# $ $ $ #",
  "#  # #  #",
  "#   @   #",
  "#       #",
  "#########"
 ],
 [
  "#########",
  "#  . .  #",
  "# $   $ #",
  "#  # #  #",
  "#   @   #",
  "#       #",
  "#########"
 ],
 [
  "#########",
  "#       #",
  "# $ #. $#",
  "#       #",
  "#   #@$ #",
  "#   .  .#",
  "#########"
 ],
 [
  "#########",
  "# .  .$ #",
  "#       #",
  "# # # # #",
  "# $  $  #",
  "#   +   #",
  "#########"
 ],
 [
  "#########",
  "# $   ..#",
  "# $# #  #",
  "# *     #",
  "#   # $.#",
  "#  @    #",
  "#########"
 ],
 [
  "#########",
  "# .   $ #",
  "#@$  . .#",
  "# # # # #",
  "# $     #",
  "#       #",
  "#########"
 ],
 [
  "#########",
  "# * #   #",
  "#     $ #",
  "# # @ # #",
  "#.$   $ #",
  "#.    . #",
  "#########"
 ],
 [
  "#########",
  "#.$ #   #",
  "#  $@  .#",
  "# #   # #",
  "#     $ #",
  "#.  . $ #",
  "#########"
 ],
 [
  "#########",
  "# . . . #",
  "# $   $ #",
  "# #   # #",
  "#  $@   #",
  "#       #",
  "#########"
 ],
 [
  "#########",
  "#@      #",
  "# $     #",
  "# # # # #",
  "# $    .#",
  "# $  . .#",
  "#########"
 ],
 [
  "#########",
  "#   .   #",
  "#. # #$ #",
  "#     $ #",
  "# @ # $ #",
  "#   . * #",
  "#########"
 ]
];
const board=document.getElementById("board"),status=document.getElementById("sokobanStatus"),
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
let level=0,width=9,height=7,player=0,boxes=new Set(),goals=new Set(),walls=new Set(),
 moves=0,pushes=0,history=[],paused=true,complete=false,hintCount=0,hintTimer=null,
 unlockedThrough=0,bestResults={};
const solverDirections=[
 {dx:0,dy:-1,code:"U",label:"向上"},{dx:0,dy:1,code:"D",label:"向下"},
 {dx:-1,dy:0,code:"L",label:"向左"},{dx:1,dy:0,code:"R",label:"向右"}
];
function difficultyName(index){
 return index<4?"入门":index<8?"基础":index<12?"进阶":index<16?"挑战":"大师";
}
function hideOverlays(){victory.hidden=true;levelPicker.hidden=true;}
function refreshLevelPicker(){
 const fragment=document.createDocumentFragment();
 levels.forEach((_,index)=>{
  const button=document.createElement("button");
  button.type="button";button.className="soko-level-option";
  if(index===level)button.classList.add("current");
  if(bestResults[index])button.classList.add("cleared");
  button.disabled=index>unlockedThrough||paused;
  button.setAttribute("aria-label","第"+(index+1)+"关 "+difficultyName(index)+(button.disabled?" 未解锁":bestResults[index]?" 已通关":" 可挑战"));
  button.textContent=String(index+1).padStart(2,"0")+(bestResults[index]?" ✓":"");
  button.addEventListener("click",()=>{
   if(index>unlockedThrough||paused)return;
   parseLevel(index);
   setStatus("已选择第 "+(index+1)+" 关 · "+difficultyName(index)+"。");
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
 winNote.textContent=level===levels.length-1?"全部关卡已完成，可结束挑战或自由重玩。":"已解锁下一关，是否继续挑战？";
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
function mapIndexForBoard(w,h,wallSet,goalSet){
 for(let i=0;i<levels.length;i++){
  const rows=levels[i];if(rows.length!==h||rows[0].length!==w)continue;
  const expectWalls=new Set(),expectGoals=new Set();
  rows.forEach((row,y)=>[...row].forEach((symbol,x)=>{
   const pos=y*w+x;
   if(symbol==="#")expectWalls.add(pos);
   if(symbol==="."||symbol==="*"||symbol==="+")expectGoals.add(pos);
  }));
  if(expectWalls.size===wallSet.size&&expectGoals.size===goalSet.size&&
   [...wallSet].every(pos=>expectWalls.has(pos))&&[...goalSet].every(pos=>expectGoals.has(pos)))return i;
 }
 return null;
}
function setStatus(message,notify){status.textContent=message;if(notify)GameBridge.report(message,{score:moves});}
function isInside(x,y){return x>=0&&x<width&&y>=0&&y<height;}
function isBlocked(x,y){return !isInside(x,y)||walls.has(y*width+x);}
function completedGoals(){let count=0;for(const goal of goals)if(boxes.has(goal))count++;return count;}
function isComplete(){return goals.size===boxes.size&&completedGoals()===goals.size;}
function isCornerDeadlock(index){
 if(goals.has(index))return false;
 const x=index%width,y=Math.floor(index/width);
 const up=isBlocked(x,y-1),down=isBlocked(x,y+1),left=isBlocked(x-1,y),right=isBlocked(x+1,y);
 return(up&&left)||(up&&right)||(down&&left)||(down&&right);
}
function clearHintHighlight(){
 if(hintTimer!==null){clearTimeout(hintTimer);hintTimer=null;}
 dpad.querySelectorAll(".soko-dir.suggested").forEach(button=>button.classList.remove("suggested"));
}
function findSolutionPath(maxStates=220000){
 const startBoxes=[...boxes].sort((a,b)=>a-b),startKey=player+"|"+startBoxes.join(",");
 const parents=new Map([[startKey,null]]),queue=[{player,boxes:startBoxes,key:startKey}];
 let finishKey=null;
 for(let cursor=0;cursor<queue.length;cursor++){
  const state=queue[cursor];
  if(state.boxes.length===goals.size&&state.boxes.every(index=>goals.has(index))){finishKey=state.key;break;}
  const occupied=new Set(state.boxes),px=state.player%width,py=Math.floor(state.player/width);
  for(const direction of solverDirections){
   const nx=px+direction.dx,ny=py+direction.dy;
   if(isBlocked(nx,ny))continue;
   const target=ny*width+nx;let nextBoxes=state.boxes;
   if(occupied.has(target)){
    const bx=nx+direction.dx,by=ny+direction.dy,destination=by*width+bx;
    if(isBlocked(bx,by)||occupied.has(destination)||isCornerDeadlock(destination))continue;
    nextBoxes=state.boxes.filter(index=>index!==target).concat(destination).sort((a,b)=>a-b);
   }
   const nextPlayer=target,nextKey=nextPlayer+"|"+nextBoxes.join(",");
   if(parents.has(nextKey))continue;
   parents.set(nextKey,{previous:state.key,code:direction.code});
   queue.push({player:nextPlayer,boxes:nextBoxes,key:nextKey});
   if(queue.length>=maxStates)return null;
  }
 }
 if(!finishKey)return null;
 const path=[];
 while(finishKey!==startKey){const step=parents.get(finishKey);if(!step)return null;path.push(step.code);finishKey=step.previous;}
 return path.reverse();
}
function hint(){
 if(paused||complete)return;
 clearHintHighlight();
 const path=findSolutionPath();
 if(!path){setStatus("暂时没有找到可行路线。检查是否有箱子被卡住，可撤销或重开本关。");return;}
 if(!path.length){setStatus("所有箱子已经到位，本关完成。");return;}
 const direction=solverDirections.find(item=>item.code===path[0]);
 const target=(Math.floor(player/width)+direction.dy)*width+(player%width)+direction.dx;
 const pushing=boxes.has(target),button=dpad.querySelector('[data-move="'+direction.dx+","+direction.dy+'"]');
 if(button){button.classList.add("suggested");hintTimer=setTimeout(()=>{button.classList.remove("suggested");hintTimer=null;},1800);}
 hintCount++;
 setStatus("建议下一步："+direction.label+(pushing?"推动前方木箱":"移动一步")+
  "。这是当前局面的最短路线第一步；提示不会自动移动。");
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
 unlockedEl.textContent=(unlockedThrough+1)+" / "+levels.length;
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
  if(walls.has(index)){cell.classList.add("wall");cell.setAttribute("aria-label","墙");}
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
function parseLevel(index){
 clearHintHighlight();hideOverlays();hintCount=0;
 level=Math.max(0,Math.min(levels.length-1,Math.floor(Number(index)||0)));
 const rows=levels[level];width=rows[0].length;height=rows.length;
 walls=new Set();boxes=new Set();goals=new Set();player=-1;
 rows.forEach((row,y)=>[...row].forEach((symbol,x)=>{
  const index=y*width+x;
  if(symbol==="#")walls.add(index);else if(symbol==="$")boxes.add(index);else if(symbol==="@")player=index;
  else if(symbol===".")goals.add(index);else if(symbol==="*"){boxes.add(index);goals.add(index);}else if(symbol==="+"){player=index;goals.add(index);}
 }));
 if(player<0||boxes.size!==goals.size)throw new Error("推箱子关卡数据无效");
 moves=0;pushes=0;history=[];complete=isComplete();render();
 setStatus("把所有木箱推到圆形目标点上。先站到箱子反方向，再朝目标推动。");
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
 return{layoutVersion:3,level,width,height,player,boxes:[...boxes],goals:[...goals],walls:[...walls],
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
 const nextWalls=toSet(saved.walls),nextGoals=toSet(saved.goals),nextBoxes=toSet(saved.boxes);
 if(!nextGoals.size||nextBoxes.size!==nextGoals.size||nextWalls.has(saved.player)||nextBoxes.has(saved.player)||
  [...nextGoals].some(index=>nextWalls.has(index))||[...nextBoxes].some(index=>nextWalls.has(index)))throw new Error("推箱子存档状态不一致");
 const nextHistory=Array.isArray(saved.history)?saved.history.filter(item=>item&&validIndex(item.player,total)&&Array.isArray(item.boxes)).slice(-200).map(item=>({
  player:item.player,boxes:item.boxes.map(Number),moves:Math.max(0,Number(item.moves)||0),pushes:Math.max(0,Number(item.pushes)||0)
 })): [];
 if(nextHistory.some(item=>!validIndex(item.player,total)||new Set(item.boxes).size!==item.boxes.length||item.boxes.some(index=>!validIndex(index,total)||nextWalls.has(index))))throw new Error("推箱子撤销记录无效");
 const matchedIndex=mapIndexForBoard(nextWidth,nextHeight,nextWalls,nextGoals);
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
 walls=nextWalls;goals=nextGoals;boxes=nextBoxes;player=saved.player;
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
  walls:[...walls].sort((a,b)=>a-b),moves,pushes,hintCount,paused,complete,status:status.textContent,
  unlockedThrough,bestResults:{...bestResults},victoryVisible:!victory.hidden,pickerVisible:!levelPicker.hidden,history:history.length};
}
dpad.addEventListener("click",dpadClick);
undoButton.addEventListener("click",undo);resetButton.addEventListener("click",resetLevel);
nextButton.addEventListener("click",nextLevel);hintButton.addEventListener("click",hint);
chooseButton.addEventListener("click",openLevelPicker);
winNext.addEventListener("click",finishOrNext);
winStay.addEventListener("click",()=>{victory.hidden=true;setStatus("第 "+(level+1)+" 关已通关；可在右侧选择下一关或重玩。");});
winPick.addEventListener("click",openLevelPicker);
levelPickerClose.addEventListener("click",closeLevelPicker);
window.addEventListener("keydown",key);
if(new URLSearchParams(location.search).has("p111Test")){
 window.__p111SokobanTest={
  loadLevel(index){paused=false;parseLevel(index);return fixtureState();},state:fixtureState,
  move(dx,dy){move(dx,dy);return fixtureState();},undo(){undo();return fixtureState();},
  nextLevel(){nextLevel();return fixtureState();},resetLevel(){resetLevel();return fixtureState();},
  openLevelPicker(){openLevelPicker();return fixtureState();},chooseLevel(index){if(index<=unlockedThrough&&!paused)parseLevel(index);return fixtureState();},
  snapshot,restore,isCornerDeadlock,levelCount:levels.length,levelRows:index=>levels[index]?.slice()||[]
 };
}
GameBridge.register({
 init(){paused=true;parseLevel(0);setStatus("准备开始 · 把所有木箱推到圆形目标点上。");},newGame,
 pause(){paused=true;updateControls();setStatus("已暂停 · 当前关卡和步数均已保留。");},
 resume(){paused=false;updateControls();if(complete){showVictory();setStatus("本关已胜利 · 请选择下一关或留在本关。");}
  else setStatus("继续闯关 · 方向键或右侧方向按钮移动。");},
 snapshot,restore,dispose(){
   paused=true;clearHintHighlight();window.removeEventListener("keydown",key);dpad.removeEventListener("click",dpadClick);
   undoButton.removeEventListener("click",undo);resetButton.removeEventListener("click",resetLevel);
   nextButton.removeEventListener("click",nextLevel);hintButton.removeEventListener("click",hint);
  },
});
})();