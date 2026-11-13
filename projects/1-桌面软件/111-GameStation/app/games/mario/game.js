(function(){
"use strict";
const canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),status=document.getElementById("status");
const W=960,H=540,GROUND=454,WORLD=3400,GRAVITY=.62;
const root=document.getElementById("game"),cartridge=window.P111MarioCartridge;
let mode="builtin",terrainVersion=2,jumpHeld=false;
let player,platforms,coins,enemies,score=0,coinCount=0,lives=3,camera=0,paused=true,over=false,raf=0,last=0,difficulty="normal",keys={},invuln=0,goalX=3260,worldTime=0;
function cfg(){return difficulty==="easy"?{speed:4.1,enemy:.65,lives:5}:difficulty==="hard"?{speed:5.5,enemy:1.35,lives:2}:{speed:4.8,enemy:1,lives:3};}
function report(t){status.textContent=t;GameBridge.report(t,{score});}
function makeLevel(){
 terrainVersion=2;
 const tile=16;
 const block=(column,height,type="brick")=>({x:column*tile,y:GROUND-height*tile,w:tile,h:tile,type});
 platforms=[block(16,4,"question"),block(20,4),block(21,4,"question"),block(22,4),block(23,4,"question"),block(24,4),block(22,8,"question")];
 for(const [column,height] of [[28,2],[38,3],[46,4],[57,4],[163,2],[179,2]])platforms.push({x:column*tile,y:GROUND-height*tile,w:32,h:height*tile,type:"pipe"});
 for(const [from,to,height] of [[77,79,4],[80,87,8],[91,94,8],[100,101,4],[106,112,4],[121,123,8],[128,131,8],[168,171,4]]){
  for(let column=from;column<=to;column++)platforms.push(block(column,height,[78,94,106,109,112,129,130,170].includes(column)?"question":"brick"));
 }
 for(const [column,heights] of [[134,[1,2,3,4]],[140,[4,3,2,1]],[148,[1,2,3,4,4]],[155,[4,3,2,1]],[181,[1,2,3,4,5,6,7,8,8]]]){
  heights.forEach((height,i)=>platforms.push({x:(column+i)*tile,y:GROUND-height*tile,w:tile,h:height*tile,type:"stone"}));
 }
 goalX=3160;
 coins=[];
 [[78,5],[91,9],[92,9],[93,9],[101,5],[121,9],[122,9],[169,5]].forEach(([x,y])=>coins.push({x:x*tile+8,y:GROUND-y*tile,got:false,phase:0}));
 enemies=[22,42,51,53,80,82,97,99,107,114,116,124,126,128,130,174,176].map(column=>{
  const x=column*tile, raised=column===80||column===82;
  return{x,y:(raised?GROUND-128:GROUND)-21,w:20,h:21,dir:-1,min:raised?1280:x-28,max:raised?1374:x+30,alive:true};
 });
}
function updateHud(){document.getElementById("world").textContent="1-1";document.getElementById("coins").textContent=String(coinCount);document.getElementById("lives").textContent=String(lives);document.getElementById("score").textContent=String(score);}
function newGame(){if(mode==="cartridge"){cartridge.reset();return;}cancelAnimationFrame(raf);const c=cfg();player={x:42,y:GROUND-25,w:19,h:25,vx:0,vy:0,onGround:false,face:1};score=0;coinCount=0;lives=c.lives;camera=0;worldTime=0;invuln=0;paused=false;over=false;keys={};jumpHeld=false;makeLevel();updateHud();report("世界 1-1 · 出发");last=performance.now();draw();raf=requestAnimationFrame(tick);}
function hit(){if(invuln>0||over)return;lives--;invuln=1.6;player.vx=-player.face*2.5;player.vy=-7;updateHud();if(lives<=0){finish(false,"游戏结束 · 生命耗尽");}else report("受到碰撞 · 剩余生命 "+lives);}
function finish(win,message){over=true;paused=true;cancelAnimationFrame(raf);report(message);GameBridge.send("GAME_OVER",{message,score,win});draw();}
function update(dt){
 const c=cfg(),oldBottom=player.y+player.h,oldTop=player.y;
 const left=keys.a||keys.arrowleft,right=keys.d||keys.arrowright,run=keys.Shift;
 const target=(right?1:0)-(left?1:0);if(target){const speed=target*c.speed*(run?1.35:1);player.vx+=(speed-player.vx)*Math.min(1,.26*dt);player.face=target;}else player.vx*=Math.pow(.72,dt);
 const oldX=player.x;
 player.x=Math.max(0,Math.min(WORLD-player.w,player.x+player.vx*dt));
 if(terrainVersion===2)for(const solid of platforms){
  if(oldBottom<=solid.y+.25||oldTop>=solid.y+solid.h||player.x+player.w<=solid.x||player.x>=solid.x+solid.w)continue;
  if(oldX+player.w<=solid.x+.3)player.x=solid.x-player.w;
  else if(oldX>=solid.x+solid.w-.3)player.x=solid.x+solid.w;
  else continue;
  player.vx=0;
 }
 if(keys.jump&&player.onGround){player.vy=terrainVersion===2?(run?-12.3:-10.5):-12.2;player.onGround=false;}
 keys.jump=false;
 player.vy=Math.min(15,player.vy+GRAVITY*dt);player.y+=player.vy*dt;player.onGround=false;
 if(terrainVersion===2&&player.vy<0){
  const ceiling=platforms.filter(p=>player.x+player.w>p.x&&player.x<p.x+p.w&&oldTop>=p.y+p.h-1&&player.y<=p.y+p.h).sort((a,b)=>b.y+b.h-a.y-a.h)[0];
  if(ceiling){
   player.y=ceiling.y+ceiling.h;player.vy=0;
   if(ceiling.type==="question"){ceiling.type="used";coinCount++;score+=100;updateHud();report("问号砖 · 金币 +100");}
  }
 }
 let landing=null;if(player.vy>=0){for(const p of platforms){if(player.x+player.w>p.x&&player.x<p.x+p.w&&oldBottom<=p.y+4&&player.y+player.h>=p.y){if(!landing||p.y<landing.y)landing=p;}}}
 if(landing){player.y=landing.y-player.h;player.vy=0;player.onGround=true;}
 if(hasGround(player.x,player.w)&&oldBottom<=GROUND+4&&player.y+player.h>=GROUND){player.y=GROUND-player.h;player.vy=0;player.onGround=true;}
 if(player.y>H+45){
  lives--;updateHud();
  if(lives<=0){finish(false,"游戏结束 · 生命耗尽");return;}
  Object.assign(player,{x:42,y:GROUND-player.h,vx:0,vy:0,onGround:true});camera=0;invuln=1.6;
  report(`掉进断坑 · 剩余 ${lives} 条生命`);
 }
 invuln=Math.max(0,invuln-dt/60);worldTime+=dt/60;
 coins.forEach(q=>{if(q.got)return;q.phase+=dt*.08;if(Math.abs(player.x+player.w/2-q.x)<22&&Math.abs(player.y+player.h/2-q.y)<28){q.got=true;coinCount++;score+=100;updateHud();}});
 const speed=c.enemy;enemies.forEach(e=>{if(!e.alive)return;e.x+=e.dir*1.15*speed*dt;if(e.x<e.min||e.x>e.max)e.dir*=-1;const overlap=player.x+player.w>e.x&&player.x<e.x+(e.w||28)&&player.y+player.h>e.y&&player.y<e.y+(e.h||27);if(overlap){if(player.vy>1&&oldBottom<e.y+13){e.alive=false;player.vy=-7.5;score+=200;updateHud();report("踩中敌人 +200");}else hit();}});
 const view=terrainVersion===2?W/2.65:W;
 camera=Math.max(camera,Math.min(WORLD-view,player.x-view*.36),0);
 if(player.x>goalX){score+=1000;updateHud();finish(true,"关卡完成 · 抵达终点！");}
}
const groundRuns=[[0,69],[71,86],[89,153],[155,213]];
function hasGround(x,width){return terrainVersion!==2||groundRuns.some(([a,b])=>x+width>a*16&&x<b*16);}
function drawCloud(x,y){ctx.fillStyle="#f5fbf0";ctx.fillRect(x+18,y,38,15);ctx.fillRect(x+6,y+12,62,16);ctx.fillRect(x+29,y-9,27,14);}
function drawMario(x,y,face,blink){
 ctx.save();ctx.translate(x,y);ctx.scale(face,1);
 ctx.fillStyle="#613d2d";ctx.fillRect(4,2,19,8);ctx.fillStyle="#d84a36";ctx.fillRect(3,0,20,7);ctx.fillRect(0,6,24,5);
 ctx.fillStyle="#f0bd83";ctx.fillRect(7,9,15,13);ctx.fillStyle="#6b3e2d";ctx.fillRect(6,8,6,5);ctx.fillRect(18,18,6,4);
 ctx.fillStyle="#2764a8";ctx.fillRect(5,21,19,14);ctx.fillRect(2,23,7,10);ctx.fillRect(19,23,7,10);
 ctx.fillStyle="#f0bd83";ctx.fillRect(0,22,6,9);ctx.fillRect(23,22,6,9);
 ctx.fillStyle="#263f77";ctx.fillRect(5,33,8,8);ctx.fillRect(17,33,8,8);
 ctx.fillStyle="#4b3528";ctx.fillRect(3,40,11,4);ctx.fillRect(16,40,12,4);
 ctx.fillStyle="#fff";ctx.fillRect(17,12,3,4);ctx.fillStyle="#222";ctx.fillRect(18,13,2,3);
 ctx.restore();
}
function drawEnemy(x,y){ctx.fillStyle="#754a2e";ctx.fillRect(x+3,y+5,22,16);ctx.fillRect(x,y+11,28,10);ctx.fillStyle="#d5a06c";ctx.fillRect(x+4,y+2,20,11);ctx.fillStyle="#fff";ctx.fillRect(x+7,y+9,5,5);ctx.fillRect(x+17,y+9,5,5);ctx.fillStyle="#1d2630";ctx.fillRect(x+9,y+10,2,3);ctx.fillRect(x+19,y+10,2,3);ctx.fillStyle="#4b3025";ctx.fillRect(x+4,y+20,8,6);ctx.fillRect(x+17,y+20,8,6);}
function draw(){
 ctx.save();ctx.imageSmoothingEnabled=false;
 ctx.fillStyle="#6486df";ctx.fillRect(0,0,W,H);
 const scale=terrainVersion===2?2.65:1;
 ctx.translate(0,H-GROUND*scale-76);ctx.scale(scale,scale);
 const viewWidth=W/scale;
 for(let i=0;i<12;i++){
  const x=i*170+85-camera;
  if(x<-110||x>viewWidth+110)continue;
  drawCloud(x,GROUND-128-(i%3)*18);
  ctx.fillStyle="#55a94d";
  for(let step=0;step<4;step++)ctx.fillRect(x+step*8,GROUND-(step+1)*8,68-step*16,(step+1)*8);
  ctx.fillStyle="#8ace59";ctx.fillRect(x+21,GROUND-9,37,9);
 }
 for(const p of platforms){
  const x=Math.round(p.x-camera);if(x+p.w<0||x>viewWidth)continue;
  if(p.type==="pipe"){
   ctx.fillStyle="#176637";ctx.fillRect(x+2,p.y,p.w-4,p.h);ctx.fillStyle="#49ac46";ctx.fillRect(x+4,p.y+2,17,p.h-2);
   ctx.fillStyle="#8ed863";ctx.fillRect(x+6,p.y+2,5,p.h-2);ctx.fillStyle="#183f34";ctx.fillRect(x,p.y,p.w,8);
   ctx.fillStyle="#5aba50";ctx.fillRect(x+2,p.y+1,p.w-4,5);continue;
  }
  ctx.fillStyle=p.type==="question"?"#ffc14b":p.type==="stone"?"#c48455":p.type==="used"?"#a36140":"#bd6233";ctx.fillRect(x,p.y,p.w,p.h);
  ctx.fillStyle="#efac65";ctx.fillRect(x+1,p.y+1,p.w-2,2);
  ctx.fillStyle="#683b34";ctx.fillRect(x,p.y+p.h-2,p.w,2);
  if(p.type==="brick"){ctx.fillRect(x,p.y+7,p.w,1);ctx.fillRect(x+7,p.y+1,1,7);ctx.fillRect(x+4,p.y+8,1,6);}
  if(p.type==="question"){ctx.fillStyle="#703725";ctx.font="bold 11px monospace";ctx.fillText("?",x+5,p.y+12);}
 }
 const first=Math.floor(camera/16),lastTile=Math.ceil((camera+viewWidth)/16);
 for(let tile=first;tile<=lastTile;tile++){
  if(!hasGround(tile*16+.5,15))continue;
  const x=tile*16-Math.round(camera);
  for(let row=0;row<3;row++){
   const y=GROUND+row*16;ctx.fillStyle="#a95b3a";ctx.fillRect(x,y,16,16);
   ctx.fillStyle="#eea067";ctx.fillRect(x,y,15,2);ctx.fillRect(x,y,2,14);
   ctx.fillStyle="#633b35";ctx.fillRect(x+14,y+2,2,14);ctx.fillRect(x+2,y+14,12,2);
   ctx.fillRect(x+5,y+5,6,1);
  }
 }
 // coins
 coins.forEach(q=>{if(q.got)return;const x=q.x-camera,y=q.y+Math.sin(q.phase)*3;ctx.fillStyle="#b77918";ctx.fillRect(x-8,y-12,16,25);ctx.fillStyle="#ffdf53";ctx.fillRect(x-6,y-11,12,22);ctx.fillStyle="#fff4a6";ctx.fillRect(x-3,y-8,3,14);});
 enemies.forEach(e=>{if(e.alive){ctx.save();ctx.translate(Math.round(e.x-camera),Math.round(e.y));ctx.scale(e.w?e.w/28:1,e.h?e.h/27:1);drawEnemy(0,0);ctx.restore();}});
 // flag and castle
 const flagX=goalX-camera;
 ctx.fillStyle="#397c4d";ctx.fillRect(flagX,GROUND-142,3,142);ctx.fillStyle="#eaf4c9";ctx.fillRect(flagX-2,GROUND-145,7,5);
 ctx.fillStyle="#eff6d5";ctx.beginPath();ctx.moveTo(flagX,GROUND-135);ctx.lineTo(flagX-22,GROUND-127);ctx.lineTo(flagX,GROUND-119);ctx.fill();
 const castle=flagX+42;ctx.fillStyle="#a85e40";ctx.fillRect(castle,GROUND-47,72,47);ctx.fillRect(castle+16,GROUND-63,40,18);
 ctx.fillStyle="#332f42";ctx.fillRect(castle+29,GROUND-23,15,23);ctx.fillRect(castle+10,GROUND-37,7,9);ctx.fillRect(castle+55,GROUND-37,7,9);
 ctx.save();ctx.translate(Math.round(player.x-camera)+(player.face<0?player.w:0),Math.round(player.y));ctx.scale(player.w/28,player.h/44);
 ctx.globalAlpha=invuln>0&&Math.floor(invuln*12)%2===0?.48:1;drawMario(0,0,player.face);ctx.restore();
 canvas.dataset.playerX=String(player.x);canvas.dataset.coins=String(coinCount);canvas.dataset.lives=String(lives);
 ctx.restore();ctx.save();ctx.fillStyle="#f4f6ff";ctx.font="bold 23px monospace";
 [["得分",String(score).padStart(6,"0"),33],["金币",`× ${String(coinCount).padStart(2,"0")}`,292],["世界","1–1",557],["生命",String(lives),789]].forEach(([label,value,x])=>{ctx.fillText(label,x,34);ctx.fillText(value,x,63);});
 ctx.restore();
}
function tick(t){if(paused||over)return;const dt=Math.min(2.2,Math.max(.3,(t-last)/16.67));last=t;update(dt);draw();if(!paused&&!over)raf=requestAnimationFrame(tick);}
function pause(){if(mode==="cartridge"){cartridge.pause();return;}paused=true;keys={};jumpHeld=false;cancelAnimationFrame(raf);if(player){report("已暂停");draw();}}
function resume(){if(mode==="cartridge"){cartridge.resume();return;}if(over)return;paused=false;last=performance.now();report("继续闯关");raf=requestAnimationFrame(tick);draw();}
function keydown(e){if(mode!=="builtin")return;const k=e.key.toLowerCase();if(["arrowleft","arrowright","arrowup"," ","shift"].includes(k))e.preventDefault();if(k==="a"||k==="arrowleft")keys.a=true;if(k==="d"||k==="arrowright")keys.d=true;if(k==="shift")keys.Shift=true;if(k===" "||k==="w"||k==="arrowup"){if(!jumpHeld){keys.jump=true;jumpHeld=true;}}}
function keyup(e){if(mode!=="builtin")return;const k=e.key.toLowerCase();if(k==="a"||k==="arrowleft")keys.a=false;if(k==="d"||k==="arrowright")keys.d=false;if(k==="shift")keys.Shift=false;if(k===" "||k==="w"||k==="arrowup"){keys.jump=false;jumpHeld=false;}}
window.addEventListener("keydown",keydown);window.addEventListener("keyup",keyup);canvas.addEventListener("pointerdown",()=>canvas.focus());
// Test-only deterministic fixture API. It is not exposed in normal gameplay.
if(new URLSearchParams(location.search).has("p111Test")){
 const clone=o=>o?JSON.parse(JSON.stringify(o)):o;
 const fixtureState=()=>({player:clone(player),platforms:clone(platforms),coins:clone(coins),enemies:clone(enemies),score,coinCount,lives,camera,paused,over,invuln});
 window.__p111MarioTest={
  loadState(s={}){cancelAnimationFrame(raf);difficulty=s.difficulty||"normal";makeLevel();terrainVersion=s.terrainVersion??1;if(terrainVersion===1)goalX=3260;player={x:70,y:GROUND-44,w:28,h:44,vx:0,vy:0,onGround:true,face:1,...(s.player||{})};if(s.platforms)platforms=clone(s.platforms);if(s.coins)coins=clone(s.coins);if(s.enemies)enemies=clone(s.enemies);score=Number(s.score)||0;coinCount=Number(s.coinCount)||0;lives=s.lives??cfg().lives;camera=Number(s.camera)||0;worldTime=0;invuln=Number(s.invuln)||0;paused=true;over=false;keys={};updateHud();draw();return fixtureState();},
  state:fixtureState,setKeys(next){keys={...next};return fixtureState();},update(dt=1){update(dt);draw();return fixtureState();},hit(){hit();return fixtureState();},finish(win,message){finish(!!win,message||"测试结束");return fixtureState();}
 };
}
function setMode(value){
 pause();mode=value==="cartridge"?"cartridge":"builtin";root.dataset.mode=mode;cartridge.show(mode==="cartridge");
}
GameBridge.register({init(p){setMode(p.mode);difficulty=p.difficulty||"normal";newGame();pause();},setMode,newGame,pause,resume,setDifficulty(v){difficulty=v||"normal";},snapshot(){if(mode!=="builtin")throw new Error("卡带只在当前页面运行");return{terrainVersion,player:JSON.parse(JSON.stringify(player)),platforms:JSON.parse(JSON.stringify(platforms)),coins:JSON.parse(JSON.stringify(coins)),enemies:JSON.parse(JSON.stringify(enemies)),score,coinCount,lives,camera,invuln,goalX,worldTime,difficulty};},restore(s){if(!s?.player||!Array.isArray(s.platforms)||!Array.isArray(s.coins)||!Array.isArray(s.enemies))throw new Error("超级马里奥存档数据无效");cancelAnimationFrame(raf);terrainVersion=s.terrainVersion??1;difficulty=s.difficulty||difficulty;player={...s.player};platforms=s.platforms.map(p=>({...p}));coins=s.coins.map(c=>({...c}));enemies=s.enemies.map(e=>({...e}));score=Math.max(0,Number(s.score)||0);coinCount=Math.max(0,Number(s.coinCount)||0);lives=Math.max(0,Number(s.lives)||0);camera=Math.max(0,Number(s.camera)||0);invuln=Math.max(0,Number(s.invuln)||0);goalX=Number(s.goalX)||3260;worldTime=Math.max(0,Number(s.worldTime)||0);paused=true;over=false;raf=0;last=0;keys={};updateHud();report("已恢复上次进度");draw();},dispose(){pause();cartridge.dispose();window.removeEventListener("keydown",keydown);window.removeEventListener("keyup",keyup);}});
})();
