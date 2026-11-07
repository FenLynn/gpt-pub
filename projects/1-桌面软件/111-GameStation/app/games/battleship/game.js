(function(){
"use strict";
const enemyEl=document.getElementById("enemy"),ownEl=document.getElementById("own"),status=document.getElementById("status");
let ownFleet,enemyFleet,own,enemy,remainingShips,shots,hits,paused=false,over=false,aiTimer=null,difficulty="normal",lastShot=null;
const fleetLengths=[5,4,3,3,2];
function fleet(){const grid=Array.from({length:10},()=>Array(10).fill(0)),lengths={};let id=1;for(const len of fleetLengths){let ok=false,tries=0;while(!ok&&tries++<1500){const horizontal=Math.random()<.5,x=Math.floor(Math.random()*(horizontal?11-len:10)),y=Math.floor(Math.random()*(horizontal?10:11-len));let valid=true;for(let k=0;k<len;k++){const xx=x+(horizontal?k:0),yy=y+(horizontal?0:k);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const ax=xx+dx,ay=yy+dy;if(ax>=0&&ax<10&&ay>=0&&ay<10&&grid[ay][ax])valid=false;}}if(valid){for(let k=0;k<len;k++)grid[y+(horizontal?0:k)][x+(horizontal?k:0)]=id;lengths[id]=len;id++;ok=true;}}}return {grid,lengths};}
function report(t){status.textContent=t;GameBridge.report(t,{score:hits});}
function render(){
 enemyEl.innerHTML="";ownEl.innerHTML="";
 for(let y=0;y<10;y++)for(let x=0;x<10;x++){
  const a=document.createElement("button");a.type="button";
  a.className="game-cell sea-cell enemy-sea";
  if(enemy[y][x]===1){a.textContent="×";a.classList.add("hit");if(lastShot?.side==="enemy"&&lastShot.x===x&&lastShot.y===y)a.classList.add("shot-impact");}
  else if(enemy[y][x]===2){a.textContent="·";a.classList.add("miss");if(lastShot?.side==="enemy"&&lastShot.x===x&&lastShot.y===y)a.classList.add("shot-splash");}
  a.disabled=enemy[y][x]!==0||paused||over;
  a.setAttribute("aria-label",(x+1)+"列 "+(y+1)+"行"+(enemy[y][x]===1?"命中":enemy[y][x]===2?"未命中":"未攻击"));
  a.addEventListener("click",()=>attack(x,y));enemyEl.appendChild(a);
  const q=document.createElement("div");
  q.className="game-cell sea-cell own-sea";
  if(ownFleet.grid[y][x]>0)q.classList.add("ship");
  if(own[y][x]===-1||own[y][x]===-3){q.textContent="×";q.classList.add("hit");if(lastShot?.side==="own"&&lastShot.x===x&&lastShot.y===y)q.classList.add("shot-impact");}
  else if(own[y][x]===-2){q.textContent="·";q.classList.add("miss");if(lastShot?.side==="own"&&lastShot.x===x&&lastShot.y===y)q.classList.add("shot-splash");}
  ownEl.appendChild(q);
 }
 document.getElementById("hits").textContent=hits;
 document.getElementById("shots").textContent=shots;
}
function randomUnknown(){const cells=[];for(let y=0;y<10;y++)for(let x=0;x<10;x++)if(own[y][x]===0)cells.push([x,y]);return cells.length?cells[Math.floor(Math.random()*cells.length)]:null;}
function huntTarget(){const targets=new Set();for(let y=0;y<10;y++)for(let x=0;x<10;x++)if(own[y][x]===-1){for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<10&&yy>=0&&yy<10&&own[yy][xx]===0)targets.add(yy*10+xx);}}if(targets.size){const a=[...targets];const v=a[Math.floor(Math.random()*a.length)];return [v%10,Math.floor(v/10)];}const parity=[];for(let y=0;y<10;y++)for(let x=0;x<10;x++)if(own[y][x]===0&&(x+y)%2===0)parity.push([x,y]);return parity.length?parity[Math.floor(Math.random()*parity.length)]:randomUnknown();}
function probabilityTarget(){const score=Array.from({length:10},()=>Array(10).fill(0)),hitsNow=[];for(let y=0;y<10;y++)for(let x=0;x<10;x++)if(own[y][x]===-1)hitsNow.push([x,y]);let placements=0;for(const len of remainingShips)for(const horizontal of [true,false])for(let y=0;y<(horizontal?10:11-len);y++)for(let x=0;x<(horizontal?11-len:10);x++){const cells=[];let valid=true,covered=0;for(let k=0;k<len;k++){const xx=x+(horizontal?k:0),yy=y+(horizontal?0:k),v=own[yy][xx];if(v===-2||v===-3){valid=false;break;}if(v===-1)covered++;cells.push([xx,yy]);}if(!valid||(hitsNow.length&&!covered))continue;placements++;const weight=covered?4:1;for(const [xx,yy] of cells)if(own[yy][xx]===0)score[yy][xx]+=weight;}
 let best=-1,cells=[];for(let y=0;y<10;y++)for(let x=0;x<10;x++)if(own[y][x]===0){const v=score[y][x]+((x+y)%2===0?.2:0);if(v>best){best=v;cells=[[x,y]];}else if(v===best)cells.push([x,y]);}return cells.length?cells[Math.floor(Math.random()*cells.length)]:randomUnknown();}
function chooseTarget(){if(difficulty==="easy")return randomUnknown();if(difficulty==="normal")return huntTarget();return probabilityTarget()||huntTarget();}
function ai(){if(paused||over)return;const target=chooseTarget();if(!target){over=true;report("无可攻击海域");return;}const [x,y]=target,id=ownFleet.grid[y][x];lastShot={side:"own",x,y};if(id>0){own[y][x]=-1;const shipCells=[];for(let yy=0;yy<10;yy++)for(let xx=0;xx<10;xx++)if(ownFleet.grid[yy][xx]===id)shipCells.push([xx,yy]);if(shipCells.every(([xx,yy])=>own[yy][xx]===-1||own[yy][xx]===-3)){shipCells.forEach(([xx,yy])=>own[yy][xx]=-3);const len=ownFleet.lengths[id],i=remainingShips.indexOf(len);if(i>=0)remainingShips.splice(i,1);}}else own[y][x]=-2;render();if(ownFleet.grid.flat().filter((id,i)=>id>0&&own[Math.floor(i/10)][i%10]!==-1&&own[Math.floor(i/10)][i%10]!==-3).length===0){over=true;report("你的舰队被击沉");GameBridge.send("GAME_OVER",{message:"海战失败",score:hits,win:false});}else report("轮到你攻击");}
function scheduleAI(){clearTimeout(aiTimer);if(paused||over)return;aiTimer=setTimeout(()=>{if(!paused&&!over)ai();},difficulty==="easy"?560:420);}
function attack(x,y){if(paused||over||enemy[y][x]!==0)return;shots++;lastShot={side:"enemy",x,y};if(enemyFleet.grid[y][x]>0){enemy[y][x]=1;hits++;}else enemy[y][x]=2;render();if(hits>=17){over=true;report("敌方舰队全部击沉！");GameBridge.send("GAME_OVER",{message:"海战胜利",score:Math.round(hits/shots*100),win:true});return;}report("敌方回合");scheduleAI();}
function newGame(){clearTimeout(aiTimer);ownFleet=fleet();enemyFleet=fleet();own=Array.from({length:10},()=>Array(10).fill(0));enemy=Array.from({length:10},()=>Array(10).fill(0));remainingShips=fleetLengths.slice();shots=0;hits=0;paused=false;over=false;lastShot=null;render();report("选择敌方海域开始攻击");}
// Test-only deterministic fixture API. It is not exposed in normal gameplay.
if(new URLSearchParams(location.search).has("p111Test")){
 const copyGrid=g=>g.map(row=>row.slice());
 const fixtureState=()=>({own:copyGrid(own),enemy:copyGrid(enemy),ownFleet:copyGrid(ownFleet.grid),enemyFleet:copyGrid(enemyFleet.grid),remainingShips:remainingShips.slice(),shots,hits,paused,over,difficulty});
 const lengthsOf=g=>{const out={};for(const row of g)for(const id of row)if(id>0)out[id]=(out[id]||0)+1;return out;};
 window.__p111BattleshipTest={
  loadState(s){clearTimeout(aiTimer);ownFleet={grid:copyGrid(s.ownFleet),lengths:s.ownLengths||lengthsOf(s.ownFleet)};enemyFleet={grid:copyGrid(s.enemyFleet),lengths:s.enemyLengths||lengthsOf(s.enemyFleet)};own=copyGrid(s.own||Array.from({length:10},()=>Array(10).fill(0)));enemy=copyGrid(s.enemy||Array.from({length:10},()=>Array(10).fill(0)));remainingShips=(s.remainingShips||fleetLengths).slice();shots=Number(s.shots)||0;hits=Number(s.hits)||0;difficulty=s.difficulty||"normal";paused=false;over=false;lastShot=null;render();report("测试局面");return fixtureState();},
  state:fixtureState,
  makeFleet(){const f=fleet();return{grid:copyGrid(f.grid),lengths:{...f.lengths}};},
  chooseTarget(){const p=chooseTarget();return p?p.slice():null;},
  attack(x,y){attack(x,y);clearTimeout(aiTimer);return fixtureState();},
  ai(){ai();clearTimeout(aiTimer);return fixtureState();},
  pause(){paused=true;clearTimeout(aiTimer);return fixtureState();}
 };
}
GameBridge.register({init(p){difficulty=p.difficulty||"normal";newGame();},newGame,pause(){paused=true;clearTimeout(aiTimer);report("已暂停");},resume(){paused=false;},setDifficulty(v){difficulty=v||"normal";},dispose(){paused=true;clearTimeout(aiTimer);}});
})();