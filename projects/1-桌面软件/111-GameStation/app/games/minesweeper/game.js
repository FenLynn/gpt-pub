(function(){
"use strict";
let W=9,H=9,MINES=10;
const boardEl=document.getElementById("board"),status=document.getElementById("status"),counter=document.getElementById("counter");
let cells=[],started=false,over=false,paused=false,flags=0,opened=0,difficulty="easy";
function setStatus(t){status.textContent=t;GameBridge.report(t,{score:opened});}
function configure(v){difficulty=v||"easy";if(difficulty==="hard"){W=30;H=16;MINES=99;}else if(difficulty==="normal"){W=16;H=16;MINES=40;}else{W=9;H=9;MINES=10;}}
function makeBoard(){cells=Array.from({length:W*H},()=>({mine:false,open:false,flag:false,n:0}));let placed=0;while(placed<MINES){const i=Math.floor(Math.random()*cells.length);if(!cells[i].mine){cells[i].mine=true;placed++;}}recount();started=false;over=false;paused=false;flags=0;opened=0;boardEl.style.setProperty("--cols",W);boardEl.style.width="min(90vw,"+Math.min(720,Math.round(window.innerHeight*.72))+"px)";render();setStatus("点击任意格子开始");}
function recount(){cells.forEach(c=>c.n=0);for(let y=0;y<H;y++)for(let x=0;x<W;x++){const c=cells[y*W+x];if(c.mine)continue;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const a=x+dx,b=y+dy;if(a>=0&&a<W&&b>=0&&b<H&&cells[b*W+a].mine)c.n++;}}}
function render(){boardEl.innerHTML="";cells.forEach((c,i)=>{const b=document.createElement("button");b.type="button";b.className="mine-cell"+(c.open?" open":"")+(c.flag?" flag":"")+(c.open&&c.mine?" mine":"");if(c.open){if(c.mine)b.textContent="✹";else if(c.n)b.textContent=c.n;b.dataset.n=c.n;}else if(c.flag)b.textContent="⚑";b.setAttribute("aria-label",c.open?(c.mine?"地雷":c.n?"数字 "+c.n:"空白"):c.flag?"已标记":"未翻开");b.addEventListener("click",()=>reveal(i));b.addEventListener("contextmenu",e=>{e.preventDefault();toggleFlag(i);});boardEl.appendChild(b);});counter.textContent="旗帜 "+flags+" / "+MINES+" · 已翻开 "+opened;}
function relocateFirst(i){if(!cells[i].mine)return;cells[i].mine=false;let j=-1;for(let k=0;k<cells.length;k++)if(k!==i&&!cells[k].mine){j=k;break;}if(j>=0)cells[j].mine=true;recount();}
function flood(i){const q=[i],seen=new Set();while(q.length){const k=q.pop();if(seen.has(k))continue;seen.add(k);const c=cells[k];if(!c||c.open||c.flag||c.mine)continue;c.open=true;opened++;if(c.n===0){const x=k%W,y=Math.floor(k/W);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const a=x+dx,b=y+dy;if(a>=0&&a<W&&b>=0&&b<H)q.push(b*W+a);}}}}
function reveal(i){if(paused||over||cells[i].open||cells[i].flag)return;if(!started){relocateFirst(i);started=true;}const c=cells[i];if(c.mine){c.open=true;over=true;cells.forEach(x=>{if(x.mine)x.open=true;});render();setStatus("踩到地雷 · 再试一次");GameBridge.send("GAME_OVER",{message:"踩到地雷",score:opened,win:false});return;}flood(i);if(opened===W*H-MINES){over=true;setStatus("恭喜，全部排除！");GameBridge.send("GAME_OVER",{message:"扫雷成功",score:opened,win:true});}else setStatus("继续排查");render();}
function toggleFlag(i){if(paused||over||cells[i].open)return;cells[i].flag=!cells[i].flag;flags+=cells[i].flag?1:-1;render();}
function newGame(){makeBoard();}
boardEl.addEventListener("contextmenu",e=>e.preventDefault());
GameBridge.register({init(p){configure(p.difficulty);newGame();},newGame,pause(){paused=true;setStatus("已暂停");},resume(){paused=false;setStatus("继续排查");},setDifficulty(v){configure(v);},dispose(){paused=true;}});
})();