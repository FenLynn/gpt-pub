(function(){
"use strict";
const el=document.getElementById("board"),status=document.getElementById("sudokuStatus");
const levelEl=document.getElementById("level"),filledEl=document.getElementById("filled"),
 remainingEl=document.getElementById("remaining"),conflictsEl=document.getElementById("conflicts"),
 hintCountEl=document.getElementById("hintCount"),numbersEl=document.getElementById("numbers");
let puzzle=null,solution=null,selected=-1,paused=true,level="normal",given=null,over=false,
 history=[],checkedErrors=new Set(),hasChecked=false,hintCell=-1,hintValue=0,hintCount=0;
const basePuzzle=[
[5,3,0,0,7,0,0,0,0],[6,0,0,1,9,5,0,0,0],[0,9,8,0,0,0,0,6,0],
[8,0,0,0,6,0,0,0,3],[4,0,0,8,0,3,0,0,1],[7,0,0,0,2,0,0,0,6],
[0,6,0,0,0,0,2,8,0],[0,0,0,4,1,9,0,0,5],[0,0,0,0,8,0,0,7,9]
];
const baseSolution=[
[5,3,4,6,7,8,9,1,2],[6,7,2,1,9,5,3,4,8],[1,9,8,3,4,2,5,6,7],
[8,5,9,7,6,1,4,2,3],[4,2,6,8,5,3,7,9,1],[7,1,3,9,2,4,8,5,6],
[9,6,1,5,3,7,2,8,4],[2,8,7,4,1,9,6,3,5],[3,4,5,2,8,6,1,7,9]
];
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function difficultyName(){return level==="easy"?"简单":level==="hard"?"困难":"标准";}
function transformedPuzzle(){
 const bands=shuffle([0,1,2]),stacks=shuffle([0,1,2]);
 const rows=bands.flatMap(b=>shuffle([0,1,2]).map(r=>b*3+r));
 const cols=stacks.flatMap(s=>shuffle([0,1,2]).map(c=>s*3+c));
 const digits=shuffle([1,2,3,4,5,6,7,8,9]),map=[0,...digits];
 solution=rows.map(r=>cols.map(c=>map[baseSolution[r][c]]));
 puzzle=rows.map(r=>cols.map(c=>basePuzzle[r][c]?map[basePuzzle[r][c]]:0));
 const clues=level==="easy"?40:level==="hard"?30:35,blanks=[];
 for(let y=0;y<9;y++)for(let x=0;x<9;x++)if(!puzzle[y][x])blanks.push([y,x]);
 shuffle(blanks);
 for(let i=0;i<clues-30;i++){const [y,x]=blanks[i];puzzle[y][x]=solution[y][x];}
}
function filledCount(){return puzzle?puzzle.flat().filter(Boolean).length:0;}
function isSolved(){return !!puzzle&&puzzle.every((row,y)=>row.every((v,x)=>v===solution[y][x]));}
function setStatus(message){status.textContent=message;}
function unitConflicts(indices,conflicts){
 const groups=new Map();
 for(const index of indices){
  const value=puzzle[Math.floor(index/9)][index%9];
  if(!value)continue;
  if(!groups.has(value))groups.set(value,[]);
  groups.get(value).push(index);
 }
 for(const group of groups.values())if(group.length>1)group.forEach(index=>conflicts.add(index));
}
function getConflicts(){
 const conflicts=new Set();
 for(let y=0;y<9;y++)unitConflicts(Array.from({length:9},(_,x)=>y*9+x),conflicts);
 for(let x=0;x<9;x++)unitConflicts(Array.from({length:9},(_,y)=>y*9+x),conflicts);
 for(let by=0;by<3;by++)for(let bx=0;bx<3;bx++){
  const indices=[];for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++)indices.push((by*3+dy)*9+bx*3+dx);
  unitConflicts(indices,conflicts);
 }
 return conflicts;
}
function getWrongEntries(){
 const errors=new Set();
 for(let y=0;y<9;y++)for(let x=0;x<9;x++)if(puzzle[y][x]&&puzzle[y][x]!==solution[y][x]&&!given[y][x])errors.add(y*9+x);
 return errors;
}
function updateStats(){
 const filled=filledCount(),conflicts=getConflicts();
 filledEl.textContent=filled+" / 81";remainingEl.textContent=String(81-filled);
 conflictsEl.textContent=String(conflicts.size);hintCountEl.textContent=String(hintCount);
 levelEl.textContent=difficultyName();
 document.getElementById("undo").disabled=paused||history.length===0||over;
 document.getElementById("hint").disabled=paused||over;document.getElementById("check").disabled=paused||over;
 numbersEl.querySelectorAll("button").forEach(button=>button.disabled=paused||over);
}
function render(){
 if(!puzzle||!given)return;
 const conflicts=getConflicts(),selectedValue=selected>=0?puzzle[Math.floor(selected/9)][selected%9]:0;
 const selectedRow=selected>=0?Math.floor(selected/9):-1,selectedCol=selected>=0?selected%9:-1;
 const fragment=document.createDocumentFragment();
 for(let y=0;y<9;y++)for(let x=0;x<9;x++){
  const index=y*9+x,value=puzzle[y][x],button=document.createElement("button");
  button.type="button";button.className="sudoku-cell";
  if(selected>=0&&(y===selectedRow||x===selectedCol||(Math.floor(y/3)===Math.floor(selectedRow/3)&&Math.floor(x/3)===Math.floor(selectedCol/3))))button.classList.add("related");
  if(value&&selectedValue&&value===selectedValue)button.classList.add("same-number");
  if(conflicts.has(index))button.classList.add("conflict");
  if(checkedErrors.has(index))button.classList.add("wrong");
  if(index===hintCell)button.classList.add("hinted");
  if(given[y][x])button.classList.add("given");
  if(index===selected)button.classList.add("selected");
  if(x===2||x===5)button.classList.add("box-right");
  if(y===2||y===5)button.classList.add("box-bottom");
  button.dataset.index=String(index);button.textContent=value?String(value):"";
  button.disabled=paused||over;button.setAttribute("role","gridcell");
  button.setAttribute("aria-selected",String(index===selected));
  button.setAttribute("aria-label","第"+(y+1)+"行第"+(x+1)+"列"+(given[y][x]?"，题目给定":"，可填写")+(value?"，数字"+value:"，空格"));
  button.addEventListener("click",()=>select(index));fragment.appendChild(button);
 }
 el.replaceChildren(fragment);updateStats();
}
function select(index){
 if(!Number.isInteger(index)||index<0||index>=81)return;
 selected=index;hintCell=-1;hintValue=0;
 const y=Math.floor(index/9),x=index%9;
 if(given[y][x])setStatus("第"+(y+1)+"行第"+(x+1)+"列是题目给定数字。");
 else setStatus("第"+(y+1)+"行第"+(x+1)+"列 · 输入 1–9 填写。");
 render();
}
function saveHistory(){
 history.push({index:selected,value:puzzle[Math.floor(selected/9)][selected%9],selected});
 if(history.length>200)history.shift();
}
function put(value){
 if(paused||over)return false;
 if(selected<0){setStatus("请先选择一个空格，再输入数字。");return false;}
 const y=Math.floor(selected/9),x=selected%9;
 if(given[y][x]){setStatus("这是题目给定数字，不能修改。");return false;}
 if(!Number.isInteger(value)||value<0||value>9)return false;
 const before=puzzle[y][x];if(before===value)return false;
 saveHistory();puzzle[y][x]=value;hintCell=-1;hintValue=0;
 if(hasChecked)checkedErrors=getWrongEntries();
 render();
 if(isSolved()){
  over=true;setStatus("恭喜！数独全部正确，完成本局。");updateStats();
  GameBridge.send("GAME_OVER",{message:"数独完成",score:81,win:true});
 }else setStatus(value?"已填写数字 · "+filledCount()+" / 81":"已清除该格 · "+filledCount()+" / 81");
 return true;
}
function hint(){
 if(paused||over)return;
 if(selected<0){setStatus("先选择一个空格，再点击提示。");return;}
 const y=Math.floor(selected/9),x=selected%9;
 if(given[y][x]){setStatus("该格已经是题目给定数字，请选择空格。");return;}
 if(puzzle[y][x]){setStatus("该格已有数字；如需修改，请直接输入新数字。");return;}
 hintCell=selected;hintValue=solution[y][x];hintCount++;
 setStatus("提示：第"+(y+1)+"行第"+(x+1)+"列应填 "+hintValue+"。按数字键或点右侧数字输入。");
 render();
}
function check(){
 if(paused||over)return;
 checkedErrors=getWrongEntries();hasChecked=true;
 const conflicts=getConflicts(),wrong=checkedErrors.size;render();
 if(wrong)setStatus("检查完成：发现 "+wrong+" 个错误，涉及 "+conflicts.size+" 个冲突格。");
 else setStatus("目前填写正确，还剩 "+(81-filledCount())+" 格。");
}
function undo(){
 if(paused||over||!history.length)return;
 const item=history.pop(),y=Math.floor(item.index/9),x=item.index%9;
 puzzle[y][x]=item.value;selected=item.selected;hintCell=-1;hintValue=0;
 if(hasChecked)checkedErrors=getWrongEntries();
 render();setStatus("已撤销上一次填写。");
}
function moveSelection(dx,dy){
 if(paused||over)return;
 if(selected<0){select(0);return;}
 const y=Math.max(0,Math.min(8,Math.floor(selected/9)+dy));
 const x=Math.max(0,Math.min(8,selected%9+dx));select(y*9+x);
}
function key(event){
 if(paused||over)return;
 const target=event.target instanceof Element?event.target:null;
 if(target&&(target.matches("input,textarea,select")||target.isContentEditable))return;
 if(event.key.length===1&&event.key>="1"&&event.key<="9"){event.preventDefault();put(Number(event.key));return;}
 if(event.key==="Backspace"||event.key==="Delete"){event.preventDefault();put(0);return;}
 const moves={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]};
 if(moves[event.key]){event.preventDefault();moveSelection(...moves[event.key]);}
}
function newGame(){
 transformedPuzzle();given=puzzle.map(row=>row.map(Boolean));selected=-1;over=false;
 history=[];checkedErrors=new Set();hasChecked=false;hintCell=-1;hintValue=0;hintCount=0;
 paused=false;render();setStatus("选择空格，再点数字或按键盘 1–9 填写。");
}
function validGrid(grid){
 return Array.isArray(grid)&&grid.length===9&&grid.every(row=>Array.isArray(row)&&row.length===9&&row.every(value=>Number.isInteger(value)&&value>=0&&value<=9));
}
function validSolution(grid){
 if(!validGrid(grid)||grid.some(row=>row.some(value=>value===0)))return false;
 const target="123456789",valid=values=>values.slice().sort().join("")===target;
 for(let i=0;i<9;i++)if(!valid(grid[i])||!valid(grid.map(row=>row[i])))return false;
 for(let by=0;by<3;by++)for(let bx=0;bx<3;bx++){
  const values=[];for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++)values.push(grid[by*3+dy][bx*3+dx]);
  if(!valid(values))return false;
 }
 return true;
}
function snapshot(){
 return{puzzle:puzzle.map(row=>row.slice()),solution:solution.map(row=>row.slice()),given:given.map(row=>row.slice()),
  selected,level,over,history:history.map(item=>({...item})),checkedErrors:[...checkedErrors],hasChecked,hintCell,hintValue,hintCount};
}
function restore(saved){
 const validGiven=grid=>Array.isArray(grid)&&grid.length===9&&grid.every(row=>Array.isArray(row)&&row.length===9&&row.every(value=>typeof value==="boolean"||value===0||value===1));
 if(!saved||!validGrid(saved.puzzle)||!validSolution(saved.solution)||!validGiven(saved.given))throw new Error("数独存档数据无效");
 const nextPuzzle=saved.puzzle.map(row=>row.slice()),nextGiven=saved.given.map(row=>row.map(Boolean)),nextSolution=saved.solution.map(row=>row.slice());
 for(let y=0;y<9;y++)for(let x=0;x<9;x++)if(nextGiven[y][x]&&nextPuzzle[y][x]!==nextSolution[y][x])throw new Error("数独存档中的题目数字不一致");
 puzzle=nextPuzzle;given=nextGiven;solution=nextSolution;
 selected=Number.isInteger(saved.selected)&&saved.selected>=0&&saved.selected<81?saved.selected:-1;
 level=["easy","normal","hard"].includes(saved.level)?saved.level:"normal";
 history=Array.isArray(saved.history)?saved.history.filter(item=>item&&Number.isInteger(item.index)&&item.index>=0&&item.index<81&&Number.isInteger(item.value)&&item.value>=0&&item.value<=9).slice(-200).map(item=>({index:item.index,value:item.value,selected:Number.isInteger(item.selected)?item.selected:-1})):[];
 checkedErrors=new Set(Array.isArray(saved.checkedErrors)?saved.checkedErrors.filter(index=>Number.isInteger(index)&&index>=0&&index<81):[]);
 hasChecked=!!saved.hasChecked;hintCell=Number.isInteger(saved.hintCell)&&saved.hintCell>=0&&saved.hintCell<81?saved.hintCell:-1;
 hintValue=Number.isInteger(saved.hintValue)&&saved.hintValue>=1&&saved.hintValue<=9?saved.hintValue:0;
 hintCount=Math.max(0,Number(saved.hintCount)||0);over=!!saved.over&&isSolved();paused=true;
 render();setStatus("进度已恢复，点击顶部「继续」后接着解题。");
}
function fixtureState(){
 return{puzzle:puzzle.map(row=>row.slice()),solution:solution.map(row=>row.slice()),given:given.map(row=>row.slice()),
  selected,paused,over,status:status.textContent,filled:filledCount(),conflicts:[...getConflicts()],errors:[...checkedErrors],hintCell,hintValue,hintCount,history:history.length};
}
numbersEl.innerHTML=Array.from({length:9},(_,i)=>'<button type="button" data-number="'+(i+1)+'" aria-label="填写 '+(i+1)+'">'+(i+1)+'</button>').join("")+
 '<button type="button" data-number="0" aria-label="清除选中格">⌫</button>';
numbersEl.addEventListener("click",event=>{const button=event.target.closest("[data-number]");if(button)put(Number(button.dataset.number));});
document.getElementById("hint").addEventListener("click",hint);
document.getElementById("check").addEventListener("click",check);
document.getElementById("undo").addEventListener("click",undo);
window.addEventListener("keydown",key);
if(new URLSearchParams(location.search).has("p111Test")){
 window.__p111SudokuTest={
  loadPuzzle(nextPuzzle,nextSolution){
   if(!validGrid(nextPuzzle)||!validSolution(nextSolution))throw new Error("Invalid Sudoku fixture");
   puzzle=nextPuzzle.map(row=>row.slice());solution=nextSolution.map(row=>row.slice());given=puzzle.map(row=>row.map(Boolean));
   selected=-1;paused=false;over=false;history=[];checkedErrors=new Set();hasChecked=false;hintCell=-1;hintValue=0;hintCount=0;
   render();setStatus("测试局面");return fixtureState();
  },
  state:fixtureState,select(index){select(index);return fixtureState();},put(value){put(value);return fixtureState();},
  check(){check();return fixtureState();},hint(){hint();return fixtureState();},undo(){undo();return fixtureState();},
  moveSelection(dx,dy){moveSelection(dx,dy);return fixtureState();},
  newGame(difficulty){if(["easy","normal","hard"].includes(difficulty))level=difficulty;newGame();return fixtureState();},
  snapshot,restore
 };
}
GameBridge.register({
 init(payload){
  level=["easy","normal","hard"].includes(payload?.difficulty)?payload.difficulty:"normal";
  newGame();paused=true;render();setStatus("准备开始 · 选择空格，再点数字或按键盘 1–9 填写。");
 },
 newGame,pause(){paused=true;render();setStatus("已暂停 · 当前题目和填写内容均已保留。");},
 resume(){paused=false;render();setStatus("继续解题 · 选择空格输入数字。");},
 setDifficulty(value){if(["easy","normal","hard"].includes(value))level=value;},
 snapshot,restore,dispose(){paused=true;window.removeEventListener("keydown",key);}
});
})();