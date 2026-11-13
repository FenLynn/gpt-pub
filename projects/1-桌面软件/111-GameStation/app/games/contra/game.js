(function(){
"use strict";
const canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),status=document.getElementById("status");
const W=800,H=450,GROUND=374,STAGE_LENGTH=2200,STAGES=3;
const waves=[
 [{at:360,type:"walker"},{at:560,type:"flyer"},{at:780,type:"turret"},{at:1010,type:"walker"},{at:1260,type:"tank"},{at:1500,type:"flyer"},{at:1770,type:"turret"}],
 [{at:300,type:"flyer"},{at:520,type:"tank"},{at:760,type:"walker"},{at:940,type:"turret"},{at:1180,type:"flyer"},{at:1430,type:"tank"},{at:1740,type:"walker"}],
 [{at:320,type:"tank"},{at:570,type:"flyer"},{at:820,type:"turret"},{at:1080,type:"tank"},{at:1330,type:"flyer"},{at:1600,type:"turret"},{at:1840,type:"tank"}]
];
const weapons={
 rifle:{name:"脉冲枪",rate:220,speed:10,damage:1,angles:[0],pierce:false},
 fan:{name:"扇形弹",rate:380,speed:9,damage:1,angles:[-.23,0,.23],pierce:false},
 rapid:{name:"速射枪",rate:90,speed:11,damage:1,angles:[0],pierce:false},
 pierce:{name:"穿透炮",rate:340,speed:8,damage:3,angles:[0],pierce:true}
};
let player,bullets,enemyShots,enemies,pickups,grenades,explosions,boss,stage,worldX,cameraX,spawnIndex,score,lives,paused=true,over=false,raf=0,last=0,difficulty="normal",keys={},lastShot=0,grenadeCount=3,weapon="rifle",lastGrenade=0,invulnerable=0,stageIntro=0;
function configure(v){difficulty=v||"normal";}
function params(){return difficulty==="easy"?{lives:5,enemySpeed:.68,fireRate:.7,enemyDamage:.8}:difficulty==="hard"?{lives:2,enemySpeed:1.35,fireRate:1.35,enemyDamage:1.25}:{lives:3,enemySpeed:1,fireRate:1,enemyDamage:1};}
function report(t){status.textContent=t;GameBridge.report(t,{score});}
function resetStage(){worldX=80;cameraX=0;spawnIndex=0;enemies=[];enemyShots=[];bullets=[];pickups=[];grenades=[];explosions=[];boss=null;stageIntro=1.2;player.x=worldX;player.y=GROUND-42;player.vy=0;player.onGround=true;}
function newGame(){cancelAnimationFrame(raf);const p=params();stage=1;score=0;lives=p.lives;weapon="rifle";grenadeCount=3;player={x:80,y:GROUND-42,w:24,h:42,vy:0,onGround:true,face:1,inv:0,dead:false};paused=false;over=false;keys={};last=performance.now();resetStage();updateHud();report("第 1 区域：前进并清除敌军");draw();raf=requestAnimationFrame(tick);}
function updateHud(){document.getElementById("stage").textContent=stage+" / "+STAGES;document.getElementById("weapon").textContent=weapons[weapon].name+" · 手雷 "+grenadeCount;document.getElementById("lives").textContent=lives;document.getElementById("score").textContent=score;}
function spawnEnemy(type,x){const cfg={walker:{hp:2,w:25,h:35,speed:1.0,score:20},turret:{hp:4,w:34,h:42,speed:0,score:35},flyer:{hp:2,w:30,h:22,speed:1.35,score:30},tank:{hp:7,w:48,h:38,speed:.5,score:55}}[type];enemies.push({type,x,y:type==="flyer"?215:GROUND-cfg.h,w:cfg.w,h:cfg.h,hp:cfg.hp,maxHp:cfg.hp,speed:cfg.speed,score:cfg.score,phase:Math.random()*6,lastShot:0});}
function fire(){const cfg=weapons[weapon],now=performance.now();if(now-lastShot<cfg.rate)return;lastShot=now;for(const a of cfg.angles){bullets.push({x:player.x+player.w/2+player.face*13,y:player.y+17,vx:Math.cos(a)*cfg.speed*player.face,vy:Math.sin(a)*cfg.speed,damage:cfg.damage,pierce:cfg.pierce,hit:new Set()});}}
function throwGrenade(){if(!grenadeCount||performance.now()-lastGrenade<420)return;lastGrenade=performance.now();grenadeCount--;grenades.push({x:player.x+player.w/2,y:player.y+18,vx:player.face*5.4,vy:-6.4,fuse:.95});updateHud();}
function enemyFire(e,t){const p=params(),dx=player.x+player.w/2-(e.x+e.w/2),dy=player.y+player.h/2-(e.y+e.h/2),len=Math.max(1,Math.hypot(dx,dy)),speed=(e.type==="tank"?3.4:2.8)*p.fireRate;enemyShots.push({x:e.x+e.w/2,y:e.y+e.h/2,vx:dx/len*speed,vy:dy/len*speed,r:e.type==="tank"?5:4});e.lastShot=t;}
function spawnBoss(){if(boss)return;boss={x:STAGE_LENGTH-260,y:185,w:105,h:120,hp:36+(stage-1)*10,maxHp:36+(stage-1)*10,lastShot:0,phase:0};report("区域首领出现！攻击核心弱点");}
function hitPlayer(){if(player.inv>0||over)return;const p=params();lives--;player.inv=1.25;player.x=Math.max(0,player.x-55);player.y=GROUND-player.h;player.vy=0;updateHud();if(lives<=0){over=true;paused=true;report("任务失败 · 得分 "+score);GameBridge.send("GAME_OVER",{message:"原创射击任务失败",score,win:false});}else report("受到攻击 · 剩余生命 "+lives);}
function killEnemy(e){score+=e.score;if(Math.random()<.24){const types=["fan","rapid","pierce","grenade"];const type=types[Math.floor(Math.random()*types.length)];pickups.push({x:e.x,y:e.y,type,life:10});}updateHud();}
function explode(x,y){explosions.push({x,y,r:12,life:.42});for(const e of enemies)if(Math.hypot(e.x+e.w/2-x,e.y+e.h/2-y)<82)e.hp-=5;if(boss&&Math.hypot(boss.x+boss.w/2-x,boss.y+boss.h/2-y)<125)boss.hp-=7;}
function nextStage(){if(stage>=STAGES){over=true;paused=true;score+=500;updateHud();report("全部区域清除 · 任务完成！");GameBridge.send("GAME_OVER",{message:"原创射击任务通关",score,win:true});return;}stage++;weapon=weapon==="rifle"?"fan":weapon;resetStage();updateHud();report("进入第 "+stage+" 区域");}
function update(dt,t){const p=params();if(keys.a||keys.ArrowLeft){player.x-=5.2*dt;player.face=-1;}if(keys.d||keys.ArrowRight){player.x+=5.2*dt;player.face=1;}player.x=Math.max(0,Math.min(STAGE_LENGTH-70,player.x));if((keys.w||keys.ArrowUp||keys[" "])&&player.onGround){player.vy=-11.2;player.onGround=false;}player.vy+=.55*dt;const oldY=player.y;player.y+=player.vy*dt;if(player.y+player.h>=GROUND){player.y=GROUND-player.h;player.vy=0;player.onGround=true;}if(player.y>GROUND+100)hitPlayer();if(keys.j)fire();player.inv=Math.max(0,player.inv-dt/60);
 cameraX=Math.max(0,Math.min(STAGE_LENGTH-W,player.x-250));
 const list=waves[stage-1];while(spawnIndex<list.length&&player.x+560>list[spawnIndex].at){const w=list[spawnIndex++];spawnEnemy(w.type,w.at);}
 if(player.x>STAGE_LENGTH-630&&!boss)spawnBoss();
 enemies.forEach(e=>{e.phase+=dt/60;if(e.type==="walker"||e.type==="tank")e.x-=e.speed*p.enemySpeed*dt;else if(e.type==="flyer"){e.x-=e.speed*p.enemySpeed*dt;e.y=205+Math.sin(e.phase*2.1)*46;}if(e.type==="turret"||e.type==="tank"||e.type==="flyer"){if(t-e.lastShot>(e.type==="turret"?1700:e.type==="tank"?1300:2100)/p.fireRate)enemyFire(e,t);}if(Math.abs(e.x-player.x)<e.w+player.w-3&&Math.abs(e.y-player.y)<e.h+player.h-6)hitPlayer();});
 bullets.forEach(b=>{b.x+=b.vx*dt;b.y+=b.vy*dt;for(const e of enemies)if(!b.hit.has(e)&&b.x>e.x&&b.x<e.x+e.w&&b.y>e.y&&b.y<e.y+e.h){e.hp-=b.damage;b.hit.add(e);if(!b.pierce)b.dead=true;}if(boss&&b.x>boss.x+8&&b.x<boss.x+boss.w-8&&b.y>boss.y+12&&b.y<boss.y+boss.h-8){boss.hp-=b.damage;if(!b.pierce)b.dead=true;}});bullets=bullets.filter(b=>!b.dead&&b.x>cameraX-50&&b.x<cameraX+W+50);
 enemies=enemies.filter(e=>{if(e.hp<=0){killEnemy(e);return false;}return e.x>cameraX-120;});
 enemyShots.forEach(b=>{b.x+=b.vx*dt;b.y+=b.vy*dt;if(Math.abs(b.x-(player.x+12))<player.w/2+b.r&&Math.abs(b.y-(player.y+20))<player.h/2+b.r){b.dead=true;hitPlayer();}});enemyShots=enemyShots.filter(b=>!b.dead&&b.x>cameraX-60&&b.x<cameraX+W+60&&b.y>-20&&b.y<H+20);
 grenades.forEach(g=>{g.x+=g.vx*dt;g.y+=g.vy*dt;g.vy+=.28*dt;g.fuse-=dt/60;if(g.y>GROUND-5){g.y=GROUND-5;g.vy*=-.42;g.vx*=.75;}if(g.fuse<=0){explode(g.x,g.y);g.dead=true;}});grenades=grenades.filter(g=>!g.dead);
 pickups.forEach(q=>{q.life-=dt/60;if(Math.abs(q.x-player.x)<30&&Math.abs(q.y-player.y)<48){if(q.type==="grenade")grenadeCount=Math.min(6,grenadeCount+2);else weapon=q.type;score+=10;q.dead=true;report("获得补给："+(q.type==="grenade"?"手雷":weapons[q.type].name));updateHud();}});pickups=pickups.filter(q=>!q.dead&&q.life>0);
 explosions.forEach(e=>{e.life-=dt/60;e.r+=4*dt;});explosions=explosions.filter(e=>e.life>0);
 if(boss){boss.phase+=dt/60;boss.y=160+Math.sin(boss.phase*1.5)*65;if(t-boss.lastShot>900/p.fireRate){for(let i=-1;i<=1;i++)enemyShots.push({x:boss.x+12,y:boss.y+boss.h/2,vx:-3.2,vy:i*1.4,r:5});boss.lastShot=t;}if(boss.hp<=0){score+=350;boss=null;updateHud();nextStage();}}
 if(player.x>=STAGE_LENGTH-90&&boss){player.x=STAGE_LENGTH-90;}
 if(stageIntro>0)stageIntro-=dt/60;
}
function draw(){
 ctx.save();ctx.imageSmoothingEnabled=false;
 const sky=ctx.createLinearGradient(0,0,0,H);sky.addColorStop(0,"#070e1b");sky.addColorStop(.46,"#111d2a");sky.addColorStop(1,"#1a3441");ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
 const mountain=(worldX,base,peak,width,shade)=>{
  const x=worldX-cameraX*.16;if(x>W+width||x<-width)return;
  ctx.fillStyle=shade;ctx.beginPath();ctx.moveTo(x-width*.55,base);ctx.lineTo(x,peak);ctx.lineTo(x+width*.55,base);ctx.closePath();ctx.fill();
  ctx.fillStyle="#d8dedf";ctx.beginPath();ctx.moveTo(x-width*.18,peak+width*.18);ctx.lineTo(x,peak);ctx.lineTo(x+width*.15,peak+width*.2);ctx.lineTo(x+width*.04,peak+width*.16);ctx.lineTo(x-width*.02,peak+width*.28);ctx.closePath();ctx.fill();
 };
 for(let i=-1;i<8;i++){const wx=i*260+110;mountain(wx,285,68+(i%3)*24,245,i%2?"#354758":"#405263");mountain(wx+112,300,135+(i%2)*18,190,"#415863");}
 // Low-frequency parallax pixel stars, leaving the distant mountains legible.
 for(let i=0;i<84;i++){const x=((i*137+43-cameraX*.08)%940+940)%940-50,y=35+(i*79%225);ctx.fillStyle=i%5===0?"#d5e5e9":"#899da9";const z=i%6===0?3:2;ctx.fillRect(x,y,z,z);}
 // far tree line
 ctx.fillStyle="#2d5648";for(let i=-1;i<20;i++){const x=i*52-(cameraX*.42%52);const h=34+(i*17%31);ctx.fillRect(x,GROUND-105-h,11,h+105);ctx.fillRect(x-17,GROUND-112-h,45,28);ctx.fillRect(x-10,GROUND-132-h,30,24);ctx.fillRect(x-25,GROUND-91-h,55,23);}
 // layered jungle canopy
 for(let i=-1;i<12;i++){const x=i*88-(cameraX*.68%88),y=GROUND-100+(i%3)*8;ctx.fillStyle=i%2?"#1b5635":"#2a703b";ctx.fillRect(x,y,75,32);ctx.fillRect(x+10,y-17,50,22);ctx.fillRect(x+20,y-31,30,18);ctx.fillStyle="#4d9946";ctx.fillRect(x+6,y+3,18,7);ctx.fillRect(x+37,y-13,17,7);ctx.fillStyle="#173f31";ctx.fillRect(x+29,y+27,15,74);}
 // rock shelf and grass lip
 const groundY=GROUND;ctx.fillStyle="#253f35";ctx.fillRect(0,groundY,W,H-groundY);
 ctx.fillStyle="#4c773c";ctx.fillRect(0,groundY-4,W,8);ctx.fillStyle="#82a94b";for(let x=0;x<W;x+=24){ctx.fillRect(x,groundY-7,15,4);ctx.fillRect(x+8,groundY-10,4,4);}
 ctx.fillStyle="#795d3c";ctx.fillRect(0,groundY+5,W,H-groundY-5);
 for(let y=groundY+9;y<H;y+=26){for(let x=-24;x<W+24;x+=48){const xx=x-((cameraX*.8)%48)+(y%2?20:0);ctx.fillStyle=(Math.floor(x/48+y/26)%3===0)?"#a17a4c":(Math.floor(x/48+y/26)%3===1)?"#8c6b43":"#6c583c";ctx.fillRect(xx,y,42,20);ctx.fillStyle="#4d4b36";ctx.fillRect(xx+4,y+15,34,3);}}
 // waterfall and dark water at the beginning of the stage
 if(cameraX<210){const edge=Math.max(0,120-cameraX*.45);ctx.fillStyle="#237caa";ctx.fillRect(0,GROUND+6,edge,H-GROUND-6);ctx.fillStyle="#62c0d0";for(let y=GROUND+12;y<H;y+=17)ctx.fillRect(0,y,edge,3);ctx.fillStyle="#c7e3d9";ctx.fillRect(edge-4,GROUND-3,7,13);}
 // scattered stone highlights and grass tufts
 for(let i=0;i<18;i++){const x=((i*71-cameraX*.95)%900+900)%900-40;ctx.fillStyle="#b18a57";ctx.fillRect(x,GROUND+19+(i%4)*22,14,4);ctx.fillStyle="#a3b95b";ctx.fillRect(x+8,GROUND-12-(i%3)*3,3,8);}
 function soldier(x,y,face,coat,skin="#e8bd88",scale=1){
  ctx.save();ctx.translate(x,y);ctx.scale(face,1);
  const z=scale;ctx.fillStyle="#263b36";ctx.fillRect(3*z,32*z,7*z,10*z);ctx.fillRect(14*z,32*z,7*z,10*z);
  ctx.fillStyle="#1d2930";ctx.fillRect(1*z,39*z,10*z,4*z);ctx.fillRect(13*z,39*z,10*z,4*z);
  ctx.fillStyle=coat;ctx.fillRect(4*z,15*z,16*z,19*z);ctx.fillRect(1*z,18*z,5*z,12*z);ctx.fillRect(18*z,18*z,5*z,10*z);
  ctx.fillStyle=skin;ctx.fillRect(7*z,4*z,12*z,12*z);
  ctx.fillStyle="#354a3d";ctx.fillRect(6*z,1*z,14*z,5*z);ctx.fillRect(4*z,5*z,4*z,3*z);
  ctx.fillStyle="#17242b";ctx.fillRect(16*z,8*z,4*z,3*z);
  ctx.fillStyle="#aeb8a4";ctx.fillRect(18*z,18*z,12*z,4*z);ctx.fillStyle="#25333a";ctx.fillRect(26*z,17*z,8*z,3*z);
  ctx.restore();
 }
 function tankSprite(x,y,w,h,color){
  ctx.fillStyle="#263d37";ctx.fillRect(x+2,y+h-9,w-4,9);ctx.fillStyle="#6e7c50";for(let k=0;k<4;k++)ctx.fillRect(x+6+k*9,y+h-7,5,5);
  ctx.fillStyle=color;ctx.fillRect(x+5,y+8,w-10,h-17);ctx.fillRect(x+w*.3,y+1,w*.4,13);
  ctx.fillStyle="#d5c58a";ctx.fillRect(x+w*.48,y-4,w*.36,5);ctx.fillStyle="#1d2a2a";ctx.fillRect(x+w*.65,y-5,w*.28,3);
 }
 for(const e of enemies){
  const x=Math.round(e.x-cameraX),y=Math.round(e.y);
  if(e.type==="walker")soldier(x,y, -1,"#a44f3d","#dfb17b",1);
  else if(e.type==="turret"){ctx.fillStyle="#344c54";ctx.fillRect(x+4,y+17,e.w-8,e.h-17);ctx.fillStyle="#82918a";ctx.fillRect(x+9,y+7,e.w-18,15);ctx.fillStyle="#25343a";ctx.fillRect(x-3,y+10,e.w+10,6);ctx.fillStyle="#b8c2a7";ctx.fillRect(x+9,y+6,5,5);}
  else if(e.type==="tank")tankSprite(x,y,e.w,e.h,"#a16a4c");
  else{ctx.fillStyle="#3d5960";ctx.fillRect(x+4,y+7,e.w-8,10);ctx.fillStyle="#b9a66f";ctx.fillRect(x+12,y,e.w-24,12);ctx.fillStyle="#253b46";ctx.fillRect(x-4,y+10,e.w+8,4);ctx.fillRect(x+e.w/2-2,y-5,5,8);}
  if(e.hp<e.maxHp){ctx.fillStyle="#1d342e";ctx.fillRect(x,y-9,e.w,4);ctx.fillStyle="#e0a05e";ctx.fillRect(x,y-9,e.w*Math.max(0,e.hp/e.maxHp),4);}
 }
 if(boss){const x=Math.round(boss.x-cameraX),y=Math.round(boss.y);tankSprite(x,y,boss.w,boss.h,"#865044");ctx.fillStyle="#e3c17e";ctx.fillRect(x+18,y+27,22,20);ctx.fillRect(x+65,y+27,22,20);ctx.fillStyle="#182b35";ctx.fillRect(x+25,y+33,8,7);ctx.fillRect(x+73,y+33,8,7);ctx.fillStyle="#1c3039";ctx.fillRect(x,y-14,boss.w,7);ctx.fillStyle="#e35d50";ctx.fillRect(x,y-14,boss.w*Math.max(0,boss.hp/boss.maxHp),7);}
 for(const b of bullets){ctx.fillStyle="#ffe7a2";ctx.fillRect(Math.round(b.x-cameraX),Math.round(b.y),13,4);ctx.fillStyle="#fff";ctx.fillRect(Math.round(b.x-cameraX)+2,Math.round(b.y),6,2);}
 for(const b of enemyShots){ctx.fillStyle="#f07856";ctx.fillRect(Math.round(b.x-cameraX)-3,Math.round(b.y)-3,7,7);ctx.fillStyle="#ffd19a";ctx.fillRect(Math.round(b.x-cameraX)-1,Math.round(b.y)-1,3,3);}
 for(const q of pickups){ctx.fillStyle="#e8d59a";ctx.fillRect(q.x-cameraX-10,q.y-10,20,20);ctx.fillStyle="#2b493e";ctx.font="bold 12px monospace";ctx.textAlign="center";ctx.fillText(q.type==="grenade"?"G":q.type==="fan"?"F":q.type==="rapid"?"R":"P",q.x-cameraX,q.y+4);}
 for(const g of grenades){ctx.fillStyle="#e9c18b";ctx.fillRect(g.x-cameraX-5,g.y-5,10,10);ctx.fillStyle="#fff0c4";ctx.fillRect(g.x-cameraX-2,g.y-5,4,3);}
 for(const e of explosions){ctx.strokeStyle="rgba(255,204,126,"+Math.max(0,e.life*2)+")";ctx.lineWidth=4;ctx.beginPath();ctx.arc(e.x-cameraX,e.y,e.r,0,Math.PI*2);ctx.stroke();ctx.fillStyle="#f2a35c55";ctx.fillRect(e.x-cameraX-e.r/2,e.y-e.r/2,e.r,e.r);}
 const px=Math.round(player.x-cameraX),py=Math.round(player.y);
 ctx.globalAlpha=player.inv>0&&Math.floor(player.inv*12)%2===0?.35:1;soldier(px,py,player.face,"#316a70","#e7bf8d",1);ctx.globalAlpha=1;
 // Pixel-art HUD strip
 ctx.fillStyle="#102a34d9";ctx.fillRect(0,0,W,43);ctx.fillStyle="#e9d59f";ctx.font="bold 14px monospace";ctx.textAlign="left";ctx.fillText("CONTRA  //  ZONE "+stage,30,19);ctx.font="11px monospace";ctx.fillStyle="#d2e4c4";ctx.fillText("MISSION "+Math.round(player.x/STAGE_LENGTH*100)+"%",30,34);
 ctx.fillStyle="#28453e";ctx.fillRect(190,17,190,7);ctx.fillStyle="#e2b86d";ctx.fillRect(190,17,190*Math.min(1,player.x/STAGE_LENGTH),7);
 ctx.fillStyle="#f4e8c9";ctx.font="bold 12px monospace";ctx.fillText("SCORE "+String(score).padStart(6,"0"),W-210,19);ctx.fillText("LIFE "+lives+"   G "+grenadeCount,W-210,34);
 if(stageIntro>0){ctx.fillStyle="#0c1d26a8";ctx.fillRect(230,70,340,58);ctx.strokeStyle="#d5b477";ctx.strokeRect(230,70,340,58);ctx.fillStyle="#f5e6bd";ctx.font="bold 25px monospace";ctx.textAlign="center";ctx.fillText("AREA "+stage,400,108);}
 if(paused||over){ctx.fillStyle="#102330a8";ctx.fillRect(0,43,W,H-43);ctx.fillStyle="#f5e6bd";ctx.font="bold 27px monospace";ctx.textAlign="center";ctx.fillText(over?"MISSION COMPLETE":"PAUSED",400,225);}
 ctx.restore();
}
function tick(t){if(paused||over)return;const dt=Math.min((t-last)/16.67,2.2);last=t;update(dt,t);draw();if(!paused&&!over)raf=requestAnimationFrame(tick);}
function pause(){paused=true;cancelAnimationFrame(raf);report("已暂停");draw();}
function resume(){if(over)return;cancelAnimationFrame(raf);paused=false;last=performance.now();report("继续行动");raf=requestAnimationFrame(tick);draw();}
function keydown(e){const k=e.key.toLowerCase();if(["arrowleft","arrowright","arrowup"," "].includes(k))e.preventDefault();if(k==="a"||k==="arrowleft")keys.a=true;if(k==="d"||k==="arrowright")keys.d=true;if(k==="w"||k==="arrowup"||k===" ")keys.w=true;if(k==="j")keys.j=true;if(k==="k"&&!keys.k){keys.k=true;throwGrenade();}}
function keyup(e){const k=e.key.toLowerCase();if(k==="a"||k==="arrowleft")keys.a=false;if(k==="d"||k==="arrowright")keys.d=false;if(k==="w"||k==="arrowup"||k===" ")keys.w=false;if(k==="j")keys.j=false;if(k==="k")keys.k=false;}
window.addEventListener("keydown",keydown);window.addEventListener("keyup",keyup);canvas.addEventListener("pointerdown",()=>canvas.focus());
// Test-only deterministic fixture API. It is not exposed in normal gameplay.
if(new URLSearchParams(location.search).has("p111Test")){
 const clone=o=>o?JSON.parse(JSON.stringify(o)):o;
 const fixtureState=()=>({stage,score,lives,weapon,grenadeCount,player:clone(player),enemies:clone(enemies),bullets:clone(bullets.map(b=>({...b,hit:[...(b.hit||[])]}))),enemyShots:clone(enemyShots),grenades:clone(grenades),boss:clone(boss),paused,over});
 window.__p111ContraTest={
  start(level="normal"){configure(level);newGame();pause();return fixtureState();},
  loadState(s={}){cancelAnimationFrame(raf);configure(s.difficulty||"normal");stage=s.stage||1;score=Number(s.score)||0;lives=s.lives??params().lives;weapon=s.weapon||"rifle";grenadeCount=s.grenadeCount??3;player={x:80,y:GROUND-42,w:24,h:42,vy:0,onGround:true,face:1,inv:0,dead:false,...(s.player||{})};enemies=(s.enemies||[]).map(e=>({...e}));bullets=(s.bullets||[]).map(b=>({...b,hit:new Set(b.hit||[])}));enemyShots=(s.enemyShots||[]).map(e=>({...e}));pickups=(s.pickups||[]).map(e=>({...e}));grenades=(s.grenades||[]).map(e=>({...e}));explosions=(s.explosions||[]).map(e=>({...e}));boss=s.boss?{...s.boss}:null;worldX=player.x;cameraX=0;spawnIndex=0;lastShot=-1e9;lastGrenade=-1e9;invulnerable=0;stageIntro=0;paused=true;over=false;keys={};updateHud();draw();return fixtureState();},
  state:fixtureState,fire(){fire();return fixtureState();},throwGrenade(){throwGrenade();return fixtureState();},hitPlayer(){hitPlayer();return fixtureState();},spawnEnemy(type,x){spawnEnemy(type,x);return fixtureState();},spawnBoss(){spawnBoss();return fixtureState();},explode(x,y){explode(x,y);return fixtureState();},nextStage(){nextStage();return fixtureState();}
 };
}
GameBridge.register({init(p){configure(p.difficulty);newGame();pause();},newGame,resume,pause,setDifficulty(v){configure(v);},snapshot(){return{stage,score,lives,weapon,grenadeCount,player:JSON.parse(JSON.stringify(player)),enemies:JSON.parse(JSON.stringify(enemies)),bullets:bullets.map(b=>({...b,hit:[...(b.hit||[])]})),enemyShots:JSON.parse(JSON.stringify(enemyShots)),pickups:JSON.parse(JSON.stringify(pickups)),grenades:JSON.parse(JSON.stringify(grenades)),explosions:JSON.parse(JSON.stringify(explosions)),boss:boss?{...boss}:null,worldX,cameraX,spawnIndex,shotCooldown:Math.max(0,weapons[weapon].rate-(performance.now()-lastShot)),grenadeCooldown:Math.max(0,420-(performance.now()-lastGrenade)),invulnerable,stageIntro,difficulty};},restore(s){if(!s?.player||!Number.isInteger(s.stage)||s.stage<1||s.stage>STAGES)throw new Error("魂斗罗存档数据无效");cancelAnimationFrame(raf);configure(s.difficulty||difficulty);stage=s.stage;score=Math.max(0,Number(s.score)||0);lives=Math.max(0,Number(s.lives)||0);weapon=weapons[s.weapon]?s.weapon:"rifle";grenadeCount=Math.max(0,Number(s.grenadeCount)||0);player={...s.player};enemies=(s.enemies||[]).map(e=>({...e}));bullets=(s.bullets||[]).map(b=>({...b,hit:new Set(b.hit||[])}));enemyShots=(s.enemyShots||[]).map(e=>({...e}));pickups=(s.pickups||[]).map(e=>({...e}));grenades=(s.grenades||[]).map(e=>({...e}));explosions=(s.explosions||[]).map(e=>({...e}));boss=s.boss?{...s.boss}:null;worldX=Number(s.worldX)||player.x;cameraX=Math.max(0,Number(s.cameraX)||0);spawnIndex=Math.max(0,Number(s.spawnIndex)||0);last=performance.now();lastShot=last-(weapons[weapon].rate-Math.max(0,Number(s.shotCooldown)||0));lastGrenade=last-(420-Math.max(0,Number(s.grenadeCooldown)||0));invulnerable=Math.max(0,Number(s.invulnerable)||0);stageIntro=Math.max(0,Number(s.stageIntro)||0);paused=true;over=false;raf=0;keys={};updateHud();report("已恢复上次进度");draw();},dispose(){pause();window.removeEventListener("keydown",keydown);window.removeEventListener("keyup",keyup);}});
})();