(function(){
"use strict";
const canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),status=document.getElementById("status");let playerY=145,aiY=145,ball,ps=0,as=0,paused=true,over=false,raf=0,last=0,keys={},difficulty="normal";
function report(t){status.textContent=t;GameBridge.report(t,{score:ps});}
function resetBall(dir){ball={x:320,y:180,vx:dir*4,vy:(Math.random()-.5)*4};}
function predictY(){if(!ball||Math.abs(ball.vx)<.01)return ball?.y||180;const t=(610-ball.x)/ball.vx;let y=ball.y+ball.vy*t;const span=346,period=span*2;let z=((y-7)%period+period)%period;if(z>span)z=period-z;return z+7;}
function draw(){
 const bg=ctx.createLinearGradient(0,0,640,360);
 bg.addColorStop(0,"#111e32");bg.addColorStop(.5,"#1b3048");bg.addColorStop(1,"#11253b");
 ctx.fillStyle=bg;ctx.fillRect(0,0,640,360);
 ctx.strokeStyle="#668aa522";ctx.lineWidth=1;
 for(let x=40;x<=600;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,360);ctx.stroke();}
 for(let y=40;y<360;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(640,y);ctx.stroke();}
 ctx.strokeStyle="#dfedf366";ctx.lineWidth=3;ctx.setLineDash([12,10]);
 ctx.beginPath();ctx.moveTo(320,0);ctx.lineTo(320,360);ctx.stroke();ctx.setLineDash([]);
 ctx.fillStyle="#86b0cc18";ctx.beginPath();ctx.arc(320,180,54,0,Math.PI*2);ctx.fill();
 ctx.strokeStyle="#dceaf324";ctx.lineWidth=2;ctx.beginPath();ctx.arc(320,180,54,0,Math.PI*2);ctx.stroke();
 const p=ctx.createLinearGradient(20,0,30,0);p.addColorStop(0,"#a8cadc");p.addColorStop(.5,"#f1fafb");p.addColorStop(1,"#79a8c4");
 ctx.fillStyle=p;ctx.fillRect(20,playerY,11,70);
 const a=ctx.createLinearGradient(609,0,620,0);a.addColorStop(0,"#c2d6e7");a.addColorStop(.5,"#f7fbff");a.addColorStop(1,"#7a9dbb");
 ctx.fillStyle=a;ctx.fillRect(609,aiY,11,70);
 ctx.fillStyle="#7fc1d331";
 for(let i=4;i>=1;i--){ctx.beginPath();ctx.arc(ball.x-ball.vx*i*1.7,ball.y-ball.vy*i*1.7,Math.max(1,6-i),0,Math.PI*2);ctx.fill();}
 ctx.shadowColor="#89e4ed";ctx.shadowBlur=12;ctx.fillStyle="#d7fafe";
 ctx.beginPath();ctx.arc(ball.x,ball.y,7,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
 ctx.fillStyle="#d8e8f3";ctx.font="bold 30px monospace";ctx.textAlign="center";
 ctx.fillText(String(ps),267,46);ctx.fillText(String(as),373,46);
 ctx.fillStyle="#9ab9c9";ctx.font="11px monospace";ctx.fillText("FIRST TO 7",320,346);
 if(paused||over){
  ctx.fillStyle="#0d1c2ac4";ctx.fillRect(0,0,640,360);
  ctx.fillStyle="#eef9fd";ctx.font="700 21px sans-serif";
  ctx.fillText(over?(ps>as?"YOU WIN":"COMPUTER WINS"):"已暂停",320,185);
 }
}
function tick(t){if(paused||over)return;const dt=Math.min((t-last)/16.67,2);last=t;if(keys.ArrowUp||keys.w)playerY-=6*dt;if(keys.ArrowDown||keys.s)playerY+=6*dt;playerY=Math.max(0,Math.min(290,playerY));const target=difficulty==="hard"?predictY()-35:ball.y-35,offset=difficulty==="easy"?Math.sin(t/280)*24:0,speed=difficulty==="easy"?2.3:difficulty==="hard"?6.2:4.1;aiY+=Math.max(-speed,Math.min(speed,(target+offset-aiY)*.09))*dt;aiY=Math.max(0,Math.min(290,aiY));ball.x+=ball.vx*dt;ball.y+=ball.vy*dt;if(ball.y<7||ball.y>353)ball.vy*=-1;if(ball.x<36&&ball.x>20&&ball.y>playerY-3&&ball.y<playerY+73){ball.vx=Math.abs(ball.vx)*1.04;ball.vy+=(ball.y-(playerY+35))*.06;}if(ball.x>604&&ball.x<620&&ball.y>aiY-3&&ball.y<aiY+73){ball.vx=-Math.abs(ball.vx)*1.04;ball.vy+=(ball.y-(aiY+35))*.06;}if(ball.x<0){as++;document.getElementById("aiScore").textContent=as;resetBall(1);}if(ball.x>640){ps++;document.getElementById("playerScore").textContent=ps;resetBall(-1);}if(ps>=7||as>=7){over=true;report(ps>as?"你赢了！":"电脑获胜");GameBridge.send("GAME_OVER",{message:ps>as?"Pong 胜利":"Pong 结束",score:ps,win:ps>as});}draw();if(!paused&&!over)raf=requestAnimationFrame(tick);}
function start(){cancelAnimationFrame(raf);ps=as=0;playerY=aiY=145;document.getElementById("playerScore").textContent=0;document.getElementById("aiScore").textContent=0;resetBall(Math.random()<.5?1:-1);paused=false;over=false;last=performance.now();report("比赛开始");draw();raf=requestAnimationFrame(tick);canvas.focus();}
function pause(){paused=true;cancelAnimationFrame(raf);report("已暂停");draw();}
function resume(){if(over)return;cancelAnimationFrame(raf);paused=false;last=performance.now();report("继续比赛");raf=requestAnimationFrame(tick);canvas.focus();}
function keydown(e){if(["ArrowUp","ArrowDown"].includes(e.key))e.preventDefault();const key=e.key.length===1?e.key.toLowerCase():e.key;keys[key]=true;}
function keyup(e){const key=e.key.length===1?e.key.toLowerCase():e.key;keys[key]=false;}
function focusCanvas(){canvas.focus();}
window.addEventListener("keydown",keydown);window.addEventListener("keyup",keyup);canvas.addEventListener("pointerdown",focusCanvas);canvas.addEventListener("mousemove",e=>{const r=canvas.getBoundingClientRect();playerY=(e.clientY-r.top)/r.height*360-35;playerY=Math.max(0,Math.min(290,playerY));});
resetBall(1);draw();
GameBridge.register({init(){pause();},newGame:start,pause,resume,setDifficulty(v){difficulty=v||"normal";},dispose(){pause();window.removeEventListener("keydown",keydown);window.removeEventListener("keyup",keyup);canvas.removeEventListener("pointerdown",focusCanvas);}});
})();