(function(){
"use strict";
const canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),status=document.getElementById("status");
const N=16,T=39,W=N*T,H=N*T,MAX_KILLS=20,base={x:7,y:15};
const dirs={up:{x:0,y:-1,angle:0},right:{x:1,y:0,angle:Math.PI/2},down:{x:0,y:1,angle:Math.PI},left:{x:-1,y:0,angle:-Math.PI/2}};
let map=[],player,enemies=[],bullets=[],kills=0,lives=3,spawned=0,spawnTimer=0,moveTimer=0,fireTimer=0,aiTimer=0,paused=true,over=false,raf=0,last=0,difficulty="normal",keys={},baseAlive=true;
function report(t){status.textContent=t;GameBridge.report(t,{score:kills*100});}
function cfg(){return difficulty==="easy"?{enemyMove:.72,enemyFire:1.5,lives:5}:difficulty==="hard"?{enemyMove:1.25,enemyFire:.72,lives:2}:{enemyMove:1,enemyFire:1,lives:3};}
function makeMap(){
 map=Array.from({length:N},()=>Array(N).fill(0));
 const put=(x,y,t)=>{if(x>=0&&x<N&&y>=0&&y<N)map[y][x]=t;};
 // Brick corridors
 for(let y=2;y<6;y++){put(3,y,1);put(4,y,1);put(11,y,1);put(12,y,1);}
 for(let x=5;x<=10;x++)put(x,4,1);
 for(let x=1;x<=4;x++)put(x,8,1);
 for(let x=11;x<=14;x++)put(x,8,1);
 for(let y=9;y<=11;y++){put(5,y,1);put(10,y,1);}
 for(let x=6;x<=9;x++)put(x,11,1);
 // Steel barriers
 [[7,2],[8,2],[2,6],[13,6],[7,7],[8,7],[2,12],[13,12]].forEach(([x,y])=>put(x,y,2));
 // Water and forest
 [[6,6],[7,6],[8,6],[9,6],[6,7],[9,7]].forEach(([x,y])=>put(x,y,3));
 [[1,3],[14,3],[1,10],[14,10],[6,9],[9,9],[4,13],[11,13]].forEach(([x,y])=>put(x,y,4));
 // Protected base pocket: destructible walls, but open firing lane
 [[6,14],[7,14],[8,14],[6,15],[8,15]].forEach(([x,y])=>put(x,y,1));
 put(base.x,base.y,0);
}
function tank(x,y,enemy){return{x,y,dir:"up",enemy,alive:true,moveClock:0,fireClock:0};}
function reset(){
 makeMap();const c=cfg();player=tank(7,12,false);enemies=[];bullets=[];kills=0;lives=c.lives;spawned=0;spawnTimer=0;moveTimer=0;fireTimer=0;aiTimer=0;baseAlive=true;keys={};over=false;paused=false;updateHud();
 spawnEnemy(1);spawnEnemy(7);spawnEnemy(14);report("守卫基地 · 敌军来袭");
}
function updateHud(){document.getElementById("stage").textContent="1";document.getElementById("kills").textContent=kills+" / "+MAX_KILLS;document.getElementById("lives").textContent=String(lives);document.getElementById("baseState").textContent=baseAlive?"安全":"被摧毁";}
function occupied(x,y,except){
 if(x<0||x>=N||y<0||y>=N)return true;
 const tile=map[y][x];if(tile===1||tile===2||tile===3)return true;
 if(player&&player!==except&&player.alive&&player.x===x&&player.y===y)return true;
 return enemies.some(e=>e!==except&&e.alive&&e.x===x&&e.y===y);
}
function spawnEnemy(x){
 if(spawned>=MAX_KILLS)return;
 const slots=[x,1,7,14,4,11];let pos=null;
 for(const col of slots){if(!occupied(col,0,null)){pos=col;break;}}
 if(pos===null)return;
 enemies.push(tank(pos,0,true));spawned++;
}
function move(t,dir){
 t.dir=dir;const d=dirs[dir],nx=t.x+d.x,ny=t.y+d.y;
 if(occupied(nx,ny,t))return false;t.x=nx;t.y=ny;return true;
}
function fire(t){
 if(!t.alive)return;const d=dirs[t.dir],speed=340;
 bullets.push({x:(t.x+.5)*T,y:(t.y+.5)*T,vx:d.x*speed,vy:d.y*speed,enemy:t.enemy,dead:false});
}
function hitPlayer(){
 if(!player.alive||over)return;lives--;player.alive=false;updateHud();
 if(lives<=0){finish(false,"基地防线失守 · 任务失败");return;}
 setTimeout(()=>{if(over||paused)return;player=tank(7,12,false);report("坦克重生 · 剩余生命 "+lives);},650);
}
function finish(win,msg){over=true;paused=true;cancelAnimationFrame(raf);report(msg);GameBridge.send("GAME_OVER",{message:msg,score:kills*100,win});draw();}
function bulletHitTank(b,t){
 if(!t.alive||b.enemy===t.enemy)return false;
 const x=Math.floor(b.x/T),y=Math.floor(b.y/T);
 if(x===t.x&&y===t.y){
  b.dead=true;
  if(t.enemy){t.alive=false;kills++;updateHud();if(kills>=MAX_KILLS&&enemies.every(e=>!e.alive))finish(true,"全歼敌军 · 基地守卫成功");}
  else hitPlayer();
  return true;
 }
 return false;
}
function update(dt){
 const c=cfg();
 if(player.alive){
  const want=keys.arrowup||keys.w?"up":keys.arrowdown||keys.s?"down":keys.arrowleft||keys.a?"left":keys.arrowright||keys.d?"right":null;
  if(want){player.dir=want;moveTimer+=dt;if(moveTimer>=.12){move(player,want);moveTimer=0;}}
  else moveTimer=0;
  fireTimer+=dt;if(keys.fire&&fireTimer>.38){fire(player);fireTimer=0;}
 }
 spawnTimer+=dt;if(spawned<MAX_KILLS&&spawnTimer>1.8){spawnEnemy([1,7,14][spawned%3]);spawnTimer=0;}
 aiTimer+=dt;
 if(aiTimer>.42){
  aiTimer=0;
  enemies.forEach(e=>{if(!e.alive)return;e.moveClock+=.42*c.enemyMove;e.fireClock+=.42;
   if(e.moveClock>.36){const choices=["down","left","right","up"];choices.sort((a,b)=>{const da=dirs[a],db=dirs[b];return Math.abs(e.x+da.x-player.x)+Math.abs(e.y+da.y-player.y)-(Math.abs(e.x+db.x-player.x)+Math.abs(e.y+db.y-player.y));});const pick=Math.random()<.65?choices[0]:choices[Math.floor(Math.random()*4)];move(e,pick);e.moveClock=0;}
   if(e.fireClock>c.enemyFire){fire(e);e.fireClock=0;}
  });
 }
 bullets.forEach(b=>{
  const oldX=b.x,oldY=b.y;b.x+=b.vx*dt;b.y+=b.vy*dt;
  if(b.x<0||b.x>=W||b.y<0||b.y>=H){b.dead=true;return;}
  const x=Math.floor(b.x/T),y=Math.floor(b.y/T),tile=map[y]?.[x];
  if(tile===1){map[y][x]=0;b.dead=true;return;}if(tile===2||tile===3){b.dead=true;return;}
  if(b.enemy&&x===base.x&&y===base.y){b.dead=true;baseAlive=false;updateHud();finish(false,"基地被击中 · 任务失败");return;}
  if(bulletHitTank(b,player))return;
  for(const e of enemies)if(bulletHitTank(b,e))break;
 });
 bullets=bullets.filter(b=>!b.dead);
 if(kills>=MAX_KILLS&&enemies.every(e=>!e.alive)&&spawned>=MAX_KILLS)finish(true,"全歼敌军 · 基地守卫成功");
}
function drawTank(t){
 if(!t.alive)return;const cx=(t.x+.5)*T,cy=(t.y+.5)*T;ctx.save();ctx.translate(cx,cy);ctx.rotate(dirs[t.dir].angle);
 const body=t.enemy?"#a94d38":"#d6b64f",track=t.enemy?"#392f2c":"#343b2d";
 ctx.fillStyle=track;ctx.fillRect(-16,-17,32,34);ctx.fillStyle="#7f8a63";for(let y=-13;y<=10;y+=8){ctx.fillRect(-14,y,5,5);ctx.fillRect(9,y,5,5);}
 ctx.fillStyle=body;ctx.fillRect(-10,-13,20,26);ctx.fillStyle=t.enemy?"#d38a60":"#f0d77c";ctx.fillRect(-7,-10,14,20);
 ctx.fillStyle=t.enemy?"#613a30":"#6c6a3c";ctx.fillRect(-4,-7,8,14);ctx.fillStyle="#222d29";ctx.fillRect(-2,-24,4,17);
 ctx.fillStyle="#d7d4b4";ctx.fillRect(-1,-24,2,8);ctx.restore();
}
function draw(){
 canvas.dataset.playerX=String(player?.x??"");canvas.dataset.playerY=String(player?.y??"");canvas.dataset.kills=String(kills);canvas.dataset.bullets=String(bullets.length);
 ctx.save();ctx.imageSmoothingEnabled=false;ctx.fillStyle="#0b1712";ctx.fillRect(0,0,W,H);
 for(let y=0;y<N;y++)for(let x=0;x<N;x++){
  const px=x*T,py=y*T,tile=map[y][x];ctx.fillStyle="#182b1d";ctx.fillRect(px,py,T,T);
  if(tile===1){ctx.fillStyle="#b75b21";ctx.fillRect(px+1,py+1,T-2,T-2);ctx.fillStyle="#e38a36";ctx.fillRect(px+2,py+2,T-4,6);ctx.fillStyle="#6e3d20";ctx.fillRect(px+2,py+18,T-4,3);ctx.fillRect(px+17,py+2,3,18);ctx.fillRect(px+2,py+29,T-4,3);}
  else if(tile===2){ctx.fillStyle="#66737a";ctx.fillRect(px+1,py+1,T-2,T-2);ctx.fillStyle="#aeb9bc";ctx.fillRect(px+4,py+4,T-8,5);ctx.fillStyle="#3c4b52";ctx.fillRect(px+4,py+13,T-8,3);ctx.fillRect(px+4,py+25,T-8,5);}
  else if(tile===3){ctx.fillStyle="#1b6590";ctx.fillRect(px,py,T,T);ctx.strokeStyle="#5aa6c6";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(px+4,py+13);ctx.lineTo(px+17,py+9);ctx.lineTo(px+34,py+13);ctx.stroke();}
  else if(tile===4){ctx.fillStyle="#254d2e";ctx.fillRect(px+3,py+3,T-6,T-6);ctx.fillStyle="#4d8b3d";ctx.fillRect(px+6,py+4,10,10);ctx.fillRect(px+21,py+8,12,12);ctx.fillStyle="#193b29";ctx.fillRect(px+15,py+20,9,14);}
  ctx.strokeStyle="#ffffff0c";ctx.lineWidth=1;ctx.strokeRect(px+.5,py+.5,T-1,T-1);
 }
 // Base insignia
 const bx=(base.x+.5)*T,by=(base.y+.5)*T;ctx.fillStyle=baseAlive?"#c6a44e":"#4a3b30";ctx.fillRect(bx-15,by-15,30,30);ctx.fillStyle=baseAlive?"#f3d783":"#79685a";ctx.font="bold 25px serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(baseAlive?"★":"×",bx,by+1);
 enemies.forEach(drawTank);if(player.alive)drawTank(player);
 bullets.forEach(b=>{ctx.fillStyle=b.enemy?"#ff8158":"#ffe49a";ctx.fillRect(b.x-3,b.y-3,6,6);ctx.fillStyle="#fff";ctx.fillRect(b.x-1,b.y-1,2,2);});
 ctx.fillStyle="#09130f";ctx.fillRect(0,0,W,25);ctx.fillStyle="#e6d69b";ctx.font="bold 12px monospace";ctx.textAlign="left";ctx.fillText("TANK BATTLE  /  01",9,17);ctx.textAlign="right";ctx.fillText("ENEMY "+kills+"/"+MAX_KILLS+"   LIFE "+lives,W-9,17);
 if(paused||over){ctx.fillStyle="#08110dcc";ctx.fillRect(0,25,W,H-25);ctx.fillStyle="#f0d995";ctx.font="bold 27px monospace";ctx.textAlign="center";ctx.fillText(over?"MISSION END":"PAUSED",W/2,H/2);}
 ctx.restore();
}
function tick(t){if(paused||over)return;const dt=Math.min(.05,Math.max(.005,(t-last)/1000));last=t;update(dt);draw();if(!paused&&!over)raf=requestAnimationFrame(tick);}
function pause(){paused=true;cancelAnimationFrame(raf);report("已暂停");draw();}
function resume(){if(over)return;paused=false;last=performance.now();report("守卫基地");raf=requestAnimationFrame(tick);draw();}
function keydown(e){const k=e.key.toLowerCase();if(["arrowup","arrowdown","arrowleft","arrowright"," "].includes(k))e.preventDefault();if(["arrowup","arrowdown","arrowleft","arrowright","w","a","s","d"].includes(k))keys[k===" "?"fire":k]=true;if(k===" ")keys.fire=true;}
function keyup(e){const k=e.key.toLowerCase();keys[k]=false;if(k===" ")keys.fire=false;}
window.addEventListener("keydown",keydown);window.addEventListener("keyup",keyup);canvas.addEventListener("pointerdown",()=>canvas.focus());
GameBridge.register({init(p){difficulty=p.difficulty||"normal";reset();pause();},newGame:reset,pause,resume,setDifficulty(v){difficulty=v||"normal";},dispose(){pause();window.removeEventListener("keydown",keydown);window.removeEventListener("keyup",keyup);}});
})();