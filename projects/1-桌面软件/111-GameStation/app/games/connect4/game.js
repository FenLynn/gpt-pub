(function(){
"use strict";
const el=document.getElementById("board"),status=document.getElementById("status");let b,turn=1,mode="ai",paused=false,over=false,difficulty="normal",timer=null,history=[];
function copy(a){return a.map(r=>r.slice());}
function save(){history.push({b:copy(b),turn,over});if(history.length>100)history.shift();}
function undo(){if(!history.length)return;clearTimeout(timer);const count=mode==="ai"?(turn===1?2:1):1;let snap=null;for(let i=0;i<count&&history.length;i++)snap=history.pop();if(!snap)return;b=copy(snap.b);turn=snap.turn;over=false;paused=false;render();report("已撤销一步");if(mode==="ai"&&turn===2)scheduleAI();}
function drop(a,c,p){for(let r=5;r>=0;r--)if(!a[r][c]){a[r][c]=p;return r;}return -1;}
function win(a,p){for(let y=0;y<6;y++)for(let x=0;x<7;x++)if(a[y][x]===p)for(const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]){let n=1;for(let k=1;k<4;k++){let xx=x+dx*k,yy=y+dy*k;if(xx<0||xx>=7||yy<0||yy>=6||a[yy][xx]!==p)break;n++;}if(n===4)return true;}return false;}
function evaluate(a){let s=0;for(let y=0;y<6;y++)s+=a[y][3]===2?5:a[y][3]===1?-5:0;for(const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]])for(let y=0;y<6;y++)for(let x=0;x<7;x++){let c=[];for(let k=0;k<4;k++){let xx=x+dx*k,yy=y+dy*k;if(xx>=0&&xx<7&&yy>=0&&yy<6)c.push(a[yy][xx]);}if(c.length!==4)continue;const me=c.filter(v=>v===2).length,opp=c.filter(v=>v===1).length;if(!opp)s+=[0,2,12,90,100000][me];if(!me)s-=[0,2,14,110,100000][opp];}return s;}
function search(a,d,alpha,beta,p){if(win(a,2))return 100000+d;if(win(a,1))return -100000-d;if(!d||a.every(r=>r.every(Boolean)))return evaluate(a);const maximizing=p===2;let best=maximizing?-Infinity:Infinity;for(const c of [3,2,4,1,5,0,6]){const n=copy(a);if(drop(n,c,p)<0)continue;const v=search(n,d-1,alpha,beta,3-p);if(maximizing){best=Math.max(best,v);alpha=Math.max(alpha,best);}else{best=Math.min(best,v);beta=Math.min(beta,best);}if(beta<=alpha)break;}return best;}
function choose(){const available=[3,2,4,1,5,0,6].filter(c=>b[0][c]===0);if(!available.length)return -1;if(difficulty==="easy")return available[Math.floor(Math.random()*available.length)];const depth=difficulty==="hard"?5:3;let best=-Infinity,choices=[];for(const c of available){const n=copy(b);drop(n,c,2);const v=search(n,depth-1,-Infinity,Infinity,1);if(v>best){best=v;choices=[c];}else if(v===best)choices.push(c);}return choices[Math.floor(Math.random()*choices.length)];}
function report(t){status.textContent=t;GameBridge.report(t,{score:b.flat().filter(v=>v===1).length});}
function render(){
 el.innerHTML="";
 for(let y=0;y<6;y++)for(let x=0;x<7;x++){
  const slot=document.createElement("button");slot.type="button";slot.className="game-cell connect4-slot";
  slot.dataset.column=String(x);slot.setAttribute("aria-label",(x+1)+"列"+(b[y][x]===1?"红棋":b[y][x]===2?"黄棋":"空位"));
  const disc=document.createElement("span");
  disc.className="connect4-disc "+(b[y][x]===1?"red":b[y][x]===2?"yellow":"empty");
  disc.setAttribute("aria-hidden","true");slot.appendChild(disc);
  slot.addEventListener("click",()=>play(x));el.appendChild(slot);
 }
 document.getElementById("red").textContent=b.flat().filter(v=>v===1).length;
 document.getElementById("yellow").textContent=b.flat().filter(v=>v===2).length;
}
function finish(p){over=true;const msg=p===1?"红方获胜":p===2?"黄方获胜":"平局";report(msg);GameBridge.send("GAME_OVER",{message:msg,score:b.flat().filter(v=>v===1).length,win:p===1});}
function scheduleAI(){clearTimeout(timer);if(paused||over||mode!=="ai"||turn!==2)return;timer=setTimeout(()=>{if(paused||over||turn!==2)return;const col=choose();if(col>=0){save();drop(b,col,2);}render();if(win(b,2)){finish(2);return;}if(b.every(r=>r.every(Boolean))){finish(0);return;}turn=1;report("轮到你了");},difficulty==="easy"?220:320);}
function play(c){if(paused||over||(mode==="ai"&&turn===2))return;if(b[0][c]!==0)return;save();if(drop(b,c,turn)<0)return;render();if(win(b,turn)){finish(turn);return;}if(b.every(r=>r.every(Boolean))){finish(0);return;}turn=3-turn;report(turn===1?"红方回合":mode==="ai"?"AI 思考中":"黄方回合");if(mode==="ai"&&turn===2)scheduleAI();}
function newGame(){clearTimeout(timer);history=[];b=Array.from({length:6},()=>Array(7).fill(0));turn=1;over=false;paused=false;render();report("红方先行");}
document.getElementById("undoButton").addEventListener("click",undo);
GameBridge.register({init(p){difficulty=p.difficulty||"normal";mode=p.mode||"ai";newGame();},newGame,pause(){paused=true;clearTimeout(timer);report("已暂停");},resume(){paused=false;if(turn===2&&mode==="ai")scheduleAI();else report("继续游戏");},setMode(v){mode=v==="two"?"two":"ai";},setDifficulty(v){difficulty=v||"normal";},dispose(){paused=true;clearTimeout(timer);}});
})();