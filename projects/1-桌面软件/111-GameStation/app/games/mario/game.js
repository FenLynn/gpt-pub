(function(){
"use strict";
const canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),status=document.getElementById("status");
const W=960,H=540,GROUND=454,WORLD=3400,GRAVITY=.62;
let player,platforms,coins,enemies,score=0,coinCount=0,lives=3,camera=0,paused=true,over=false,raf=0,last=0,difficulty="normal",keys={},invuln=0,goalX=3260,worldTime=0;
function cfg(){return difficulty==="easy"?{speed:4.1,enemy:.65,lives:5}:difficulty==="hard"?{speed:5.5,enemy:1.35,lives:2}:{speed:4.8,enemy:1,lives:3};}
function report(t){status.textContent=t;GameBridge.report(t,{score});}
function makeLevel(){
 platforms=[
  {x:260,y:365,w:130,h:18,type:"brick"},{x:460,y:315,w:130,h:18,type:"brick"},{x:690,y:370,w:95,h:18,type:"brick"},
  {x:900,y:330,w:180,h:18,type:"brick"},{x:1220,y:365,w:150,h:18,type:"brick"},{x:1500,y:300,w:180,h:18,type:"brick"},
  {x:1820,y:360,w:130,h:18,type:"brick"},{x:2070,y:315,w:170,h:18,type:"brick"},{x:2380,y:365,w:180,h:18,type:"brick"},
  {x:2700,y:315,w:150,h:18,type:"brick"},{x:2960,y:360,w:120,h:18,type:"brick"}
 ];
 coins=[];
 [[300,330],[345,330],[510,280],[555,280],[730,335],[945,295],[990,295],[1035,295],[1260,330],[1310,330],[1550,265],[1600,265],[1650,265],[1860,325],[2110,280],[2160,280],[2420,330],[2470,330],[2740,280],[2790,280],[3010,325]]
 .forEach(([x,y])=>coins.push({x,y,got:false,phase:Math.random()*6}));
 enemies=[
  {x:590,y:GROUND-27,dir:-1,min:520,max:660,alive:true},
  {x:1110,y:GROUND-27,dir:1,min:1060,max:1190,alive:true},
  {x:1710,y:GROUND-27,dir:-1,min:1680,max:1800,alive:true},
  {x:2290,y:GROUND-27,dir:1,min:2240,max:2360,alive:true},
  {x:2860,y:GROUND-27,dir:-1,min:2820,max:2920,alive:true}
 ];
}
function updateHud(){document.getElementById("world").textContent="1-1";document.getElementById("coins").textContent=String(coinCount);document.getElementById("lives").textContent=String(lives);document.getElementById("score").textContent=String(score);}
function newGame(){cancelAnimationFrame(raf);const c=cfg();player={x:70,y:GROUND-44,w:28,h:44,vx:0,vy:0,onGround:false,face:1};score=0;coinCount=0;lives=c.lives;camera=0;worldTime=0;invuln=0;paused=false;over=false;keys={};makeLevel();updateHud();report("世界 1-1 · 出发");last=performance.now();draw();raf=requestAnimationFrame(tick);}
function hit(){if(invuln>0||over)return;lives--;invuln=1.6;player.vx=-player.face*2.5;player.vy=-7;updateHud();if(lives<=0){finish(false,"游戏结束 · 生命耗尽");}else report("受到碰撞 · 剩余生命 "+lives);}
function finish(win,message){over=true;paused=true;cancelAnimationFrame(raf);report(message);GameBridge.send("GAME_OVER",{message,score,win});draw();}
function update(dt){
 const c=cfg(),oldBottom=player.y+player.h;
 const left=keys.a||keys.arrowleft,right=keys.d||keys.arrowright,run=keys.Shift;
 const target=(right?1:0)-(left?1:0);if(target){player.vx=target*c.speed*(run?1.35:1);player.face=target;}else player.vx*=Math.pow(.72,dt);
 player.x=Math.max(0,Math.min(WORLD-player.w,player.x+player.vx*dt));
 if(keys.jump&&player.onGround){player.vy=-12.2;player.onGround=false;keys.jump=false;}
 player.vy=Math.min(15,player.vy+GRAVITY*dt);player.y+=player.vy*dt;player.onGround=false;
 let landing=null;if(player.vy>=0){for(const p of platforms){if(player.x+player.w>p.x&&player.x<p.x+p.w&&oldBottom<=p.y+4&&player.y+player.h>=p.y){if(!landing||p.y<landing.y)landing=p;}}}
 if(landing){player.y=landing.y-player.h;player.vy=0;player.onGround=true;}
 if(player.y+player.h>=GROUND){player.y=GROUND-player.h;player.vy=0;player.onGround=true;}
 if(player.y>H+90){hit();player.y=GROUND-player.h;}
 invuln=Math.max(0,invuln-dt/60);worldTime+=dt/60;
 coins.forEach(q=>{if(q.got)return;q.phase+=dt*.08;if(Math.abs(player.x+player.w/2-q.x)<22&&Math.abs(player.y+player.h/2-q.y)<28){q.got=true;coinCount++;score+=100;updateHud();}});
 const speed=c.enemy;enemies.forEach(e=>{if(!e.alive)return;e.x+=e.dir*1.15*speed*dt;if(e.x<e.min||e.x>e.max)e.dir*=-1;const overlap=player.x+player.w>e.x&&player.x<e.x+28&&player.y+player.h>e.y&&player.y<e.y+27;if(overlap){if(player.vy>1&&oldBottom<e.y+13){e.alive=false;player.vy=-7.5;score+=200;updateHud();report("踩中敌人 +200");}else hit();}});
 camera=Math.max(0,Math.min(WORLD-W,player.x-W*.36));
 if(player.x>goalX){score+=1000;updateHud();finish(true,"关卡完成 · 抵达终点！");}
}
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
 const sky=ctx.createLinearGradient(0,0,0,H);sky.addColorStop(0,"#62b6ed");sky.addColorStop(.72,"#bce6f5");sky.addColorStop(1,"#eff7e5");ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
 for(let i=0;i<8;i++){const x=((i*177-camera*.25)%1120+1120)%1120-80;drawCloud(x,62+(i%3)*65);}
 for(let i=0;i<8;i++){const x=((i*260-camera*.12)%1200+1200)%1200-120;ctx.fillStyle="#8acb75";ctx.beginPath();ctx.arc(x,GROUND-22,90,Math.PI,Math.PI*2);ctx.fill();ctx.fillStyle="#a8d98b";ctx.beginPath();ctx.arc(x+35,GROUND-26,55,Math.PI,Math.PI*2);ctx.fill();}
 // pipes and brick platforms
 platforms.forEach(p=>{const x=Math.round(p.x-camera);ctx.fillStyle="#9a5c31";ctx.fillRect(x,p.y,p.w,p.h);ctx.fillStyle="#d98b45";ctx.fillRect(x,p.y,p.w,5);ctx.strokeStyle="#754322";ctx.lineWidth=2;for(let bx=0;bx<p.w;bx+=28){ctx.beginPath();ctx.moveTo(x+bx,p.y+5);ctx.lineTo(x+bx,p.y+p.h);ctx.stroke();}ctx.beginPath();ctx.moveTo(x,p.y+11);ctx.lineTo(x+p.w,p.y+11);ctx.stroke();});
 for(const px of [820,1430,1960,2560]){const x=px-camera;ctx.fillStyle="#168b48";ctx.fillRect(x,GROUND-70,52,70);ctx.fillStyle="#35bd61";ctx.fillRect(x-5,GROUND-78,62,14);ctx.fillStyle="#0e6b39";ctx.fillRect(x+8,GROUND-61,8,42);}
 // ground and soil
 ctx.fillStyle="#49a93d";ctx.fillRect(0,GROUND,W,12);ctx.fillStyle="#2f842f";ctx.fillRect(0,GROUND+9,W,8);ctx.fillStyle="#8d4e2b";ctx.fillRect(0,GROUND+17,W,H-GROUND-17);
 for(let y=GROUND+23;y<H;y+=26)for(let x=-20;x<W+20;x+=42){const xx=x-((camera*.8)%42);ctx.fillStyle="#b56a35";ctx.fillRect(xx,y,38,22);ctx.fillStyle="#6c3e27";ctx.fillRect(xx+2,y+19,34,3);}
 // coins
 coins.forEach(q=>{if(q.got)return;const x=q.x-camera,y=q.y+Math.sin(q.phase)*3;ctx.fillStyle="#b77918";ctx.fillRect(x-8,y-12,16,25);ctx.fillStyle="#ffdf53";ctx.fillRect(x-6,y-11,12,22);ctx.fillStyle="#fff4a6";ctx.fillRect(x-3,y-8,3,14);});
 enemies.forEach(e=>{if(e.alive)drawEnemy(Math.round(e.x-camera),Math.round(e.y));});
 // flag and castle
 const flagX=goalX-camera;ctx.fillStyle="#7c5632";ctx.fillRect(flagX,GROUND-230,7,230);ctx.fillStyle="#2ebc63";ctx.fillRect(flagX+7,GROUND-224,56,34);ctx.fillStyle="#f4e6ae";ctx.fillRect(flagX+7,GROUND-224,10,34);ctx.fillStyle="#b66b3a";ctx.fillRect(flagX+85,GROUND-70,68,70);ctx.fillStyle="#e3c08b";ctx.fillRect(flagX+95,GROUND-61,48,61);
 const px=player.x-camera;canvas.dataset.playerX=String(player.x);canvas.dataset.coins=String(coinCount);canvas.dataset.lives=String(lives);ctx.globalAlpha=invuln>0&&Math.floor(invuln*12)%2===0?.35:1;drawMario(Math.round(px),Math.round(player.y),player.face);ctx.globalAlpha=1;
 // arcade HUD
 ctx.fillStyle="#27364cdd";ctx.fillRect(0,0,W,37);ctx.fillStyle="#fff1b2";ctx.font="bold 15px monospace";ctx.textAlign="left";ctx.fillText("WORLD 1-1",18,24);ctx.fillText("× "+coinCount,250,24);ctx.fillText("SCORE "+String(score).padStart(6,"0"),420,24);ctx.fillText("LIFE "+lives,790,24);
 if(paused||over){ctx.fillStyle="#1b2d3d88";ctx.fillRect(0,37,W,H-37);ctx.fillStyle="#fff4cf";ctx.font="bold 28px monospace";ctx.textAlign="center";ctx.fillText(over?"STAGE CLEAR":"PAUSED",W/2,H/2);}
 ctx.restore();
}
function tick(t){if(paused||over)return;const dt=Math.min(2.2,Math.max(.3,(t-last)/16.67));last=t;update(dt);draw();if(!paused&&!over)raf=requestAnimationFrame(tick);}
function pause(){paused=true;cancelAnimationFrame(raf);report("已暂停");draw();}
function resume(){if(over)return;paused=false;last=performance.now();report("继续闯关");raf=requestAnimationFrame(tick);draw();}
function keydown(e){const k=e.key.toLowerCase();if(["arrowleft","arrowright","arrowup"," ","shift"].includes(k))e.preventDefault();if(k==="a"||k==="arrowleft")keys.a=true;if(k==="d"||k==="arrowright")keys.d=true;if(k==="shift")keys.Shift=true;if(k===" "||k==="w"||k==="arrowup"){if(!keys.jump)keys.jump=true;}}
function keyup(e){const k=e.key.toLowerCase();if(k==="a"||k==="arrowleft")keys.a=false;if(k==="d"||k==="arrowright")keys.d=false;if(k==="shift")keys.Shift=false;if(k===" "||k==="w"||k==="arrowup")keys.jump=false;}
window.addEventListener("keydown",keydown);window.addEventListener("keyup",keyup);canvas.addEventListener("pointerdown",()=>canvas.focus());
// Test-only deterministic fixture API. It is not exposed in normal gameplay.
if(new URLSearchParams(location.search).has("p111Test")){
 const clone=o=>o?JSON.parse(JSON.stringify(o)):o;
 const fixtureState=()=>({player:clone(player),platforms:clone(platforms),coins:clone(coins),enemies:clone(enemies),score,coinCount,lives,camera,paused,over,invuln});
 window.__p111MarioTest={
  loadState(s={}){cancelAnimationFrame(raf);difficulty=s.difficulty||"normal";makeLevel();player={x:70,y:GROUND-44,w:28,h:44,vx:0,vy:0,onGround:true,face:1,...(s.player||{})};if(s.platforms)platforms=clone(s.platforms);if(s.coins)coins=clone(s.coins);if(s.enemies)enemies=clone(s.enemies);score=Number(s.score)||0;coinCount=Number(s.coinCount)||0;lives=s.lives??cfg().lives;camera=Number(s.camera)||0;worldTime=0;invuln=Number(s.invuln)||0;paused=true;over=false;keys={};updateHud();draw();return fixtureState();},
  state:fixtureState,setKeys(next){keys={...next};return fixtureState();},update(dt=1){update(dt);draw();return fixtureState();},hit(){hit();return fixtureState();},finish(win,message){finish(!!win,message||"测试结束");return fixtureState();}
 };
}
GameBridge.register({init(p){difficulty=p.difficulty||"normal";newGame();pause();},newGame,pause,resume,setDifficulty(v){difficulty=v||"normal";},dispose(){pause();window.removeEventListener("keydown",keydown);window.removeEventListener("keyup",keyup);}});
})();