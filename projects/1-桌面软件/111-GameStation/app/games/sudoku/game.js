(function(){
"use strict";
const el=document.getElementById("board"),status=document.getElementById("status");
let puzzle,solution,selected=-1,paused=false,level="normal",given,over=false;
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
function transformedPuzzle(){const bands=shuffle([0,1,2]),stacks=shuffle([0,1,2]),rows=bands.flatMap(b=>shuffle([0,1,2]).map(r=>b*3+r)),cols=stacks.flatMap(s=>shuffle([0,1,2]).map(c=>s*3+c)),digits=shuffle([1,2,3,4,5,6,7,8,9]),map=[0,...digits];solution=rows.map(r=>cols.map(c=>map[baseSolution[r][c]]));puzzle=rows.map(r=>cols.map(c=>basePuzzle[r][c]?map[basePuzzle[r][c]]:0));const target=level==="easy"?40:level==="hard"?30:35,blanks=[];for(let y=0;y<9;y++)for(let x=0;x<9;x++)if(!puzzle[y][x])blanks.push([y,x]);shuffle(blanks);for(let i=0;i<target-30;i++){const [y,x]=blanks[i];puzzle[y][x]=solution[y][x];}}
function report(t){status.textContent=t;const filled=puzzle.flat().filter(Boolean).length;GameBridge.report(t,{score:filled});}
function render(){el.innerHTML="";let filled=0;for(let y=0;y<9;y++)for(let x=0;x<9;x++){const i=y*9+x,v=puzzle[y][x];if(v)filled++;const q=document.createElement("button");q.className="game-cell";q.style.width="clamp(29px,5.2vw,43px)";q.style.height="clamp(29px,5.2vw,43px)";q.style.borderRadius="2px";q.style.fontSize="clamp(12px,2vw,17px)";q.style.borderRight=(x===2||x===5)?"2px solid #9eacc0":"1px solid #e1e6ed";q.style.borderBottom=(y===2||y===5)?"2px solid #9eacc0":"1px solid #e1e6ed";q.style.background=i===selected?"#e5f0f6":v?"#f0f5f8":"#fff";q.style.color=v?"#455a79":"#5d8ac6";q.style.fontWeight=given[y][x]?"700":"500";q.textContent=v||"";q.onclick=()=>{selected=i;render();};el.appendChild(q);}document.getElementById("filled").textContent=filled+" / 81";}
function newGame(){transformedPuzzle();given=puzzle.map(r=>r.map(Boolean));selected=-1;paused=false;over=false;document.getElementById("level").textContent=level==="easy"?"简单":level==="hard"?"困难":"标准";render();report("选择空格开始填数");}
function put(v){if(paused||over||selected<0)return;const y=Math.floor(selected/9),x=selected%9;if(given[y][x])return;puzzle[y][x]=v;render();if(puzzle.every((r,yy)=>r.every((n,xx)=>n===solution[yy][xx]))){over=true;report("恭喜，数独完成！");GameBridge.send("GAME_OVER",{message:"数独完成",score:81,win:true});}else report("已填写");}
function check(){let errors=0;for(let y=0;y<9;y++)for(let x=0;x<9;x++)if(puzzle[y][x]&&puzzle[y][x]!==solution[y][x])errors++;report(errors?"发现 "+errors+" 个错误":"当前填写正确");}
function key(e){if(/^[1-9]$/.test(e.key))put(Number(e.key));if(e.key==="Backspace"||e.key==="Delete")put(0);}
document.getElementById("numbers").innerHTML=Array.from({length:9},(_,i)=>'<button type="button" data-number="'+(i+1)+'">'+(i+1)+'</button>').join("")+'<button type="button" data-number="0">⌫</button>';document.getElementById("numbers").addEventListener("click",e=>{const b=e.target.closest("[data-number]");if(b)put(Number(b.dataset.number));});document.getElementById("hint").onclick=()=>{if(selected<0)return;put(solution[Math.floor(selected/9)][selected%9]);};document.getElementById("check").onclick=check;window.addEventListener("keydown",key);
// Test-only deterministic fixture API. It is not exposed in normal gameplay.
if(new URLSearchParams(location.search).has("p111Test")){
 const fixtureState=()=>({puzzle:puzzle.map(r=>r.slice()),solution:solution.map(r=>r.slice()),given:given.map(r=>r.slice()),selected,paused,over,status:status.textContent});
 window.__p111SudokuTest={
  loadPuzzle(nextPuzzle,nextSolution){
   const valid=g=>Array.isArray(g)&&g.length===9&&g.every(r=>Array.isArray(r)&&r.length===9&&r.every(v=>Number.isInteger(v)&&v>=0&&v<=9));
   if(!valid(nextPuzzle)||!valid(nextSolution))throw new Error("Invalid Sudoku fixture");
   puzzle=nextPuzzle.map(r=>r.slice());solution=nextSolution.map(r=>r.slice());given=puzzle.map(r=>r.map(v=>v!==0));selected=-1;paused=false;over=false;render();report("测试局面");return fixtureState();
  },
  state:fixtureState,
  select(index){selected=index;render();return fixtureState();},
  put(value){put(value);return fixtureState();},
  check(){check();return fixtureState();}
 };
}
GameBridge.register({init(p){level=p.difficulty||"normal";newGame();},newGame,pause(){paused=true;report("已暂停");},resume(){paused=false;report("继续解题");},setDifficulty(v){level=v||"normal";},snapshot(){return{puzzle:puzzle.map(r=>r.slice()),solution:solution.map(r=>r.slice()),given:given.map(r=>r.slice()),selected,level,over};},restore(s){const valid=g=>Array.isArray(g)&&g.length===9&&g.every(r=>Array.isArray(r)&&r.length===9&&r.every(v=>Number.isInteger(v)&&v>=0&&v<=9));if(!s||!valid(s.puzzle)||!valid(s.solution)||!valid(s.given))throw new Error("数独存档数据无效");puzzle=s.puzzle.map(r=>r.slice());solution=s.solution.map(r=>r.slice());given=s.given.map(r=>r.map(Boolean));selected=Number.isInteger(s.selected)?s.selected:-1;level=s.level||level;over=!!s.over;paused=true;document.getElementById("level").textContent=level==="easy"?"简单":level==="hard"?"困难":"标准";render();report("已恢复上次进度");},dispose(){paused=true;window.removeEventListener("keydown",key);}});
})();