(function(){"use strict";
const el=document.getElementById("board"),status=document.getElementById("status"),rollButton=document.getElementById("rollButton"),diceFace=document.getElementById("diceFace"),turnText=document.getElementById("turnText");
const layoutRoot=document.getElementById("game");
// Align both side rails with the visible 810-unit wooden board frame,
// rather than the 900-unit SVG stage with blank drawing margins.
const fitHistoryHeight=()=>{
 const h=el.getBoundingClientRect().height*810/900;
 if(h>0)layoutRoot.style.setProperty("--reversi-board-height",h+"px");
};
if(typeof ResizeObserver!=="undefined")new ResizeObserver(fitHistoryHeight).observe(el);
window.addEventListener("resize",fitHistoryHeight);requestAnimationFrame(fitHistoryHeight);
const track=[
[6,14],[6,13],[6,12],[6,11],[6,10],[6,9],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8],[0,7],
[0,6],[1,6],[2,6],[3,6],[4,6],[5,6],[6,5],[6,4],[6,3],[6,2],[6,1],[6,0],[7,0],
[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[9,6],[10,6],[11,6],[12,6],[13,6],[14,6],[14,7],
[14,8],[13,8],[12,8],[11,8],[10,8],[9,8],[8,9],[8,10],[8,11],[8,12],[8,13],[8,14],[7,14]
];
const pads=[[[1,10],[3,10],[1,12],[3,12]],[[11,1],[13,1],[11,3],[13,3]]];
const houses=[[[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]],[[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]]];
const colors=["#d8584c","#4c91d2"];
const dicePips={1:[[50,50]],2:[[28,28],[72,72]],3:[[28,28],[50,50],[72,72]],4:[[28,28],[72,28],[28,72],[72,72]],5:[[28,28],[72,28],[50,50],[28,72],[72,72]],6:[[28,25],[72,25],[28,50],[72,50],[28,75],[72,75]]};
let pawns=[[-1,-1,-1,-1],[-1,-1,-1,-1]],turn=0,mode="ai",difficulty="normal",paused=true,over=false,roll=null,history=[],aiTimer=null,selectedPlane=null;
const start=seat=>seat===0?0:26;
const absolute=(seat,progress)=>progress<52?(start(seat)+progress)%52:-1;
const safe=cell=>cell%13===0||cell%4===0;
function position(seat,i,progress=pawns[seat][i]){
 if(progress<0)return pads[seat][i];
 if(progress<=51)return track[absolute(seat,progress)];
 return houses[seat][Math.min(5,progress-52)];
}
function advance(seat,progress,dice){
 if(progress===57)return null;
 if(progress===-1&&dice!==6)return null;
 let target=progress===-1?0:progress+dice;
 if(target>57)return null;
 if(target>0&&target<52){
  let cell=absolute(seat,target);
  // The color-marked flight squares provide a single four-square jump.
  if(cell%4===(seat===0?0:2)&&target+4<=51){target+=4;cell=absolute(seat,target);}
  // A flight channel crosses the 52-square circuit to the opposite side.
  // Its two endpoints are exactly 26 public-track positions apart.
  if(cell===(seat===0?12:38)&&target+26<=51)target+=26;
 }
 return target;
}
function moves(seat=turn,dice=roll){
 if(!dice)return [];
 return pawns[seat].map((p,index)=>({seat,index,from:p,to:advance(seat,p,dice)})).filter(m=>m.to!==null);
}
function opponentsAt(seat,progress){
 if(progress<0||progress>=52)return [];
 const slot=absolute(seat,progress);
 if(safe(slot))return [];
 const result=[];pawns[1-seat].forEach((p,index)=>{if(p>=0&&p<52&&absolute(1-seat,p)===slot)result.push(index);});
 return result;
}
function profile(level=difficulty){return level==="easy"?{risk:false,score:false}:level==="normal"?{risk:false,score:true}:{risk:true,score:true};}
function rankMove(m){
 let value=(m.to-m.from)+(m.to===57?95:0)+opponentsAt(m.seat,m.to).length*28;
 if(profile().risk&&m.to<52){
  const landing=absolute(m.seat,m.to);
  if(!safe(landing)){
   let threatened=0;
   for(const p of pawns[1-m.seat])if(p>=0&&p<52)for(let die=1;die<=6;die++){
    const next=advance(1-m.seat,p,die);
    if(next!=null&&next<52&&absolute(1-m.seat,next)===landing)threatened++;
   }
   value-=threatened*8;
  }else value+=8;
 }
 return value;
}
function chooseAI(){
 const candidates=moves();if(!candidates.length)return null;
 if(difficulty==="easy")return candidates[Math.floor(Math.random()*candidates.length)];
 return candidates.map(m=>({m,score:rankMove(m)})).sort((a,b)=>b.score-a.score)[0].m;
}
function turnLabel(){
 const side=turn===0?"红方":"蓝方";
 if(over)return side+"获胜";
 if(paused)return "已暂停";
 return roll===null?side+"回合":side+" · "+roll+"点";
}
function report(msg){status.textContent=msg;turnText.textContent=turnLabel();GameBridge.report(msg,{score:pawns[0].filter(p=>p===57).length,turn});}
function svgNode(tag,attrs){const ns="http:"+"//www.w3.org/2000/svg",e=document.createElementNS(ns,tag);for(const [key,val] of Object.entries(attrs))e.setAttribute(key,String(val));return e;}
// Animate visual faces and colorways while the logical die result stays fixed.
const diceInk=["#447c9c","#d96754","#378b6b","#9771be","#d6a044","#407bb5"];
const dicePaper=["#e8f4fc","#fff0e8","#eafaef","#f4ebff","#fff6e0","#ebf2fe"];
let diceAnimationTimer=null,isRolling=false;
function renderDice(display=null){
 const value=display??(roll||1),face=svgNode("svg",{viewBox:"0 0 100 100",class:"flight-dice-svg","aria-hidden":"true"});
 face.append(svgNode("rect",{x:7,y:7,width:86,height:86,rx:18,class:"flight-dice-body"}));
 for(const [cx,cy] of dicePips[value])face.append(svgNode("circle",{cx,cy,r:7.8,class:"flight-dice-pip"}));
 diceFace.style.setProperty("--dice-ink",diceInk[value-1]);diceFace.style.setProperty("--dice-paper",dicePaper[value-1]);
 diceFace.replaceChildren(face);diceFace.setAttribute("aria-label","骰子："+(roll||1)+"点");
 diceFace.dataset.value=String(roll||1);diceFace.dataset.displayFace=String(value);
}
function stopDiceAnimation(){
 clearTimeout(diceAnimationTimer);isRolling=false;diceFace.classList.remove("rolling");
}
function animateDice(){
 clearTimeout(diceAnimationTimer);isRolling=true;diceFace.classList.add("rolling");
 const faces=[2,5,3,6,1,4,6,2,5,3,4,1];let step=0;
 const tick=()=>{
  if(!isRolling)return;
  if(step>=faces.length){stopDiceAnimation();draw();return;}
  renderDice(faces[step++]);diceAnimationTimer=setTimeout(tick,75);
 };
 tick();
}
function routeFor(index){
 const move=moves().find(m=>m.index===index);if(!move)return null;
 const start=pawns[turn][index],steps=[];
 if(start<0)steps.push({progress:0,number:1});
 else for(let i=1;i<=roll;i++)steps.push({progress:start+i,number:i});
 return{move,steps,final:move.to};
}
function previewPlane(index){
 if(paused||over||isRolling||roll===null||(mode==="ai"&&turn===1))return false;
 if(!moves().some(m=>m.index===index))return false;
 if(selectedPlane===index)return play(index);
 selectedPlane=index;draw();
 report((turn===0?"红方":"蓝方")+(index+1)+"号飞机：绿色序号是路径，请点击绿色终点确认");
 return true;
}
function renderChoices(){
 const host=document.getElementById("flightMoveOptions"),label=document.getElementById("flightMoveCount"),
  help=document.getElementById("flightMoveHelp");
 const legal=paused||over||isRolling||roll===null||mode==="ai"&&turn===1?[]:moves();
 host.replaceChildren();label.textContent=legal.length+" 个";
 for(const m of legal){
  const btn=document.createElement("button");btn.type="button";
  btn.className="flight-move-choice"+(selectedPlane===m.index?" is-selected":"");
  btn.dataset.pawn=String(m.index);
  btn.textContent=(m.index+1)+"号飞机";
  btn.setAttribute("aria-label",(turn===0?"红方":"蓝方")+(m.index+1)+"号飞机，可选择预览");
  btn.setAttribute("aria-pressed",String(selectedPlane===m.index));
  btn.onclick=()=>previewPlane(m.index);host.append(btn);
 }
 help.textContent=roll===null?"掷骰后可选择飞机。":selectedPlane!==null?
  "已选"+(selectedPlane+1)+"号飞机；绿色圆圈标明移动路线，点“终”确认。":
  legal.length?"请选择发光的飞机，预览绿色编号路线。":"没有可移动的飞机。";
}
function draw(){
 el.replaceChildren();
 const pos=(x,y)=>[100+x*50,100+y*50];
 el.append(svgNode("rect",{x:45,y:45,width:810,height:810,rx:28,class:"flight-outline"}));
 const camps=[{x:66,y:535,c:"#eea49b"},{x:535,y:66,c:"#a5cde8"},{x:66,y:66,c:"#c2e1b5"},{x:535,y:535,c:"#f4e1a2"}];
 for(const camp of camps)el.append(svgNode("rect",{x:camp.x,y:camp.y,width:296,height:296,rx:26,fill:camp.c,opacity:".7"}));
 track.forEach(([x,y],index)=>{
  const [cx,cy]=pos(x,y),seatColor=index%4;
  const fill=index===0?"#db6454":index===26?"#528fcc":["#f8ebd7","#f0c5a0","#bddcce","#c5d9ee"][seatColor];
  el.append(svgNode("rect",{x:cx-22,y:cy-22,width:44,height:44,rx:7,fill,stroke:"#c9ac8e","stroke-width":2,"data-track":index}));
 });
 houses.forEach((home,seat)=>home.forEach(([x,y],i)=>{const [cx,cy]=pos(x,y);el.append(svgNode("rect",{x:cx-21,y:cy-21,width:42,height:42,rx:7,fill:seat===0?"#eba69b":"#a9cbed",stroke:"#c7ab93","stroke-width":2,"data-lane":seat+"-"+i}));}));
 // A single board only: keep the center open and the home lanes unobscured.
 el.append(svgNode("circle",{cx:450,cy:450,r:37,class:"flight-center-pad"}));
 // Numbered stepping stones belong to the chosen airplane only, never to a
 // decorative second board. A separate green end marker commits the move.
 const preview=selectedPlane===null||paused||over?null:routeFor(selectedPlane);
 if(preview){
  const coords=preview.steps.map(step=>{
   const [x,y]=position(turn,selectedPlane,step.progress);
   return{...step,cx:100+x*50,cy:100+y*50};
  });
  if(coords.length>1)el.append(svgNode("polyline",{
   points:coords.map(p=>p.cx+","+p.cy).join(" "),class:"flight-preview-path"}));
  for(const step of coords){
   const marker=svgNode("g",{class:"flight-path-step","data-preview-step":step.number,
    "aria-label":"前进第"+step.number+"格"});
   marker.append(svgNode("circle",{cx:step.cx,cy:step.cy,r:17,class:"flight-preview-circle"}));
   const label=svgNode("text",{x:step.cx,y:step.cy+6,"text-anchor":"middle",class:"flight-preview-number"});
   label.textContent=String(step.number);marker.append(label);el.append(marker);
  }
  const [gx,gy]=position(turn,selectedPlane,preview.final),tx=100+gx*50,ty=100+gy*50;
  const goal=svgNode("g",{class:"flight-path-target",role:"button",tabindex:"0",
    "data-preview-to":preview.final,"aria-label":"点击确认将飞机移动到目标位置"});
  goal.append(svgNode("circle",{cx:tx,cy:ty,r:24,class:"flight-target-ring"}));
  const end=svgNode("text",{x:tx,y:ty+6,"text-anchor":"middle",class:"flight-target-label"});
  end.textContent="终";goal.append(end);
  goal.addEventListener("click",()=>play(selectedPlane));
  goal.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();play(selectedPlane);}});
  el.append(goal);
 }

 const occupied=new Map();
 pawns.forEach((row,seat)=>row.forEach((progress,i)=>{
  const [x,y]=position(seat,i,progress),k=x+","+y;
  if(!occupied.has(k))occupied.set(k,[]);
  occupied.get(k).push([seat,i]);
 }));
 const displacements=n=>{
  if(n===1)return [[0,0]];
  const columns=Math.ceil(Math.sqrt(n)),rows=Math.ceil(n/columns),step=n>4?12:18;
  return Array.from({length:n},(_,i)=>[(i%columns-(columns-1)/2)*step,(Math.floor(i/columns)-(rows-1)/2)*step]);
 };
 pawns.forEach((row,seat)=>row.forEach((progress,i)=>{
  const [x,y]=position(seat,i,progress),[cx,cy]=pos(x,y);
  const stack=occupied.get(x+","+y),index=stack.findIndex(([s,p])=>s===seat&&p===i);
  const [dx,dy]=displacements(stack.length)[index];
  const canMove=!paused&&!over&&!isRolling&&turn===seat&&roll!==null&&moves().some(m=>m.seat===seat&&m.index===i);
  const selected=canMove&&selectedPlane===i;
  const group=svgNode("g",{"data-pawn":seat+"-"+i,role:"button",tabindex:"0",
   "data-slot-x":cx,"data-slot-y":cy,"data-center-x":cx+dx,"data-center-y":cy+dy,
   transform:"translate("+(cx+dx)+" "+(cy+dy)+")",
   class:"flight-aircraft"+(canMove?" can-move":"")+(selected?" is-selected":"")});
  group.append(svgNode("circle",{cx:0,cy:0,r:stack.length>1?14:19,fill:colors[seat],stroke:"#fff","stroke-width":3}));
  group.append(svgNode("path",{d:"M0 -12 l-6 15 l6 -4 l6 4 Z",fill:"#fff"}));
  const count=svgNode("text",{x:0,y:12,"text-anchor":"middle",class:"flight-aircraft-number"});count.textContent=String(i+1);group.append(count);
  group.addEventListener("click",()=>previewPlane(i));group.addEventListener("keydown",e=>{if(e.key===" "||e.key==="Enter"){e.preventDefault();previewPlane(i);}});
  el.append(group);
 }));
 el.dataset.turn=String(turn);el.dataset.dice=roll===null?"":String(roll);
 layoutRoot.dataset.turnSide=turn===0?"red":"blue";
 document.getElementById("redArrived").textContent=String(pawns[0].filter(p=>p===57).length);
 document.getElementById("blueArrived").textContent=String(pawns[1].filter(p=>p===57).length);
 rollButton.disabled=paused||over||isRolling||roll!==null||turn===1&&mode==="ai";
 document.getElementById("flightDiceCaption").textContent=roll===null?"等待掷骰":"点数 "+roll;
 renderChoices();
 document.getElementById("undoButton").disabled=paused||over||!history.length;
 renderDice();
}
function newTurn(dice){
 roll=null;selectedPlane=null;turn=dice===6?turn:1-turn;window.GameTurnClock?.handover(turn===0?"红方":"蓝方");
 report((turn===0?"红方":"蓝方")+(dice===6?" · 再掷一次":" · 请掷骰子"));
 draw();scheduleAI();
}
function throwDice(value=null){
 if(paused||over||isRolling||roll!==null)return false;
 selectedPlane=null;roll=value==null?1+Math.floor(Math.random()*6):value;
 if(!Number.isInteger(roll)||roll<1||roll>6){roll=null;return false;}
 const animated=value===null&&!window.matchMedia("(prefers-reduced-motion:reduce)").matches;
 isRolling=animated;
 window.GameTurnClock?.record(turn===0?"红方":"蓝方",turn===0?"红方":"蓝方","掷骰 "+roll);draw();
 if(animated)animateDice();else stopDiceAnimation();
 if(!moves().length){const d=roll;window.GameTurnClock?.record(turn===0?"红方":"蓝方",turn===0?"红方":"蓝方","无可移动飞机");newTurn(d);report("掷出 "+d+" 点暂无可走飞机 · "+(turn===0?"红方":"蓝方")+"回合");return true;}
 report((turn===0?"红方":"蓝方")+" 掷出 "+roll+" · 点击高亮飞机");return true;
}
function play(index){
 if(paused||over||isRolling||roll===null||(mode==="ai"&&turn===1))return false;
 const m=moves().find(x=>x.index===index);if(!m)return false;
 selectedPlane=null;
 history.push({pawns:pawns.map(row=>row.slice()),turn,roll});
 pawns[turn][index]=m.to;
 for(const enemy of opponentsAt(turn,m.to))pawns[1-turn][enemy]=-1;
 const die=roll;window.GameTurnClock?.record(turn===0?"红方":"蓝方",turn===0?"红方":"蓝方","飞机移动");draw();
 if(pawns[turn].every(p=>p===57)){
  over=true;paused=true;clearTimeout(aiTimer);const msg=turn===0?"红方获胜":"蓝方获胜";
  report(msg);GameBridge.send("GAME_OVER",{message:msg,win:turn===0,score:pawns[0].filter(p=>p===57).length});draw();return true;
 }
 newTurn(die);return true;
}
function scheduleAI(){
 clearTimeout(aiTimer);if(paused||over||turn!==1||mode!=="ai")return;
 aiTimer=setTimeout(()=>{
  if(paused||over||turn!==1)return;
  if(isRolling){scheduleAI();return;}
  if(roll===null){throwDice();if(turn===1&&roll!==null)scheduleAI();return;}
  const best=chooseAI();
  if(best){
   // The same game logic is used for both human and AI. Only selection is automated.
   const original=mode;mode="two";play(best.index);mode=original;
   if(turn===1)scheduleAI();
  }else newTurn(roll);
 },difficulty==="easy"?360:240);
}
function undo(){
 if(paused||over||!history.length)return;
 clearTimeout(aiTimer);stopDiceAnimation();const steps=mode==="ai"&&turn===0?Math.min(2,history.length):1;
 for(let i=0;i<steps;i++){const h=history.pop();pawns=h.pawns.map(row=>row.slice());turn=h.turn;roll=h.roll;}
 over=false;selectedPlane=null;window.GameTurnClock?.rewind(steps,turn===0?"红方":"蓝方");draw();report("已悔棋");scheduleAI();
}
function newGame(){
 clearTimeout(aiTimer);stopDiceAnimation();pawns=[[-1,-1,-1,-1],[-1,-1,-1,-1]];turn=0;roll=null;selectedPlane=null;history=[];over=false;paused=false;window.GameTurnClock?.reset("红方");draw();report("红方先行 · 掷出六点起飞");
}
function pauseGame(){paused=true;selectedPlane=null;clearTimeout(aiTimer);stopDiceAnimation();report("已暂停");draw();}
function resumeGame(){paused=false;report("继续游戏");draw();scheduleAI();}
rollButton.onclick=()=>{if(mode==="ai"&&turn===1)return;throwDice();};
diceFace.addEventListener("click",()=>rollButton.click());
document.getElementById("undoButton").onclick=undo;
if(new URLSearchParams(location.search).has("p111Test")){
 newGame();
 window.__p111FlightTest={
  track:()=>track.length,profile,state:()=>({pawns:pawns.map(r=>r.slice()),turn,roll,over,paused}),position:(seat,i)=>position(seat,i),
  roll:v=>throwDice(v),move:i=>play(i),moves:()=>moves(),preview:i=>previewPlane(i),route:i=>routeFor(i),
  setMode:v=>{mode=v;},setDifficulty:v=>{difficulty=v;},animateDice,stopDiceAnimation,pause:pauseGame,resume:resumeGame,undo,
  setPawns:v=>{pawns=v.map(r=>r.slice());turn=0;roll=null;selectedPlane=null;paused=false;over=false;history=[];window.GameTurnClock?.reset("红方");draw();}
 };
}
GameBridge.register({
 init(p){mode=p.mode==="two"?"two":"ai";difficulty=p.difficulty||"normal";newGame();},newGame,
 pause:pauseGame,
 resume:resumeGame,
 setMode:v=>{mode=v==="two"?"two":"ai";draw();},
 setDifficulty:v=>{difficulty=v||"normal";},
 dispose(){paused=true;clearTimeout(aiTimer);stopDiceAnimation();}
});
})();