(function(){"use strict";
const el=document.getElementById("board"),status=document.getElementById("status"),rollButton=document.getElementById("rollButton"),diceFace=document.getElementById("diceFace"),turnText=document.getElementById("turnText");
const layoutRoot=document.getElementById("game");
// Align both side rails with the visible 810-unit wooden board frame,
// rather than the 900-unit SVG stage with blank drawing margins.
const fitHistoryHeight=()=>{
 const rect=el.getBoundingClientRect(),h=rect.height*810/900;
 if(h>0&&layoutRoot.classList.contains("gs-tools-open")){
  layoutRoot.style.setProperty("--reversi-board-height",h+"px");
  // Release the first paint only after workspace CSS, HUD and sizing are set.
  if(document.getElementById("gs-turn-clock")&&el.childElementCount>0)layoutRoot.dataset.boardMeasured="true";
 }
};
if(typeof ResizeObserver!=="undefined")new ResizeObserver(fitHistoryHeight).observe(el);
window.addEventListener("resize",fitHistoryHeight);
fitHistoryHeight();requestAnimationFrame(fitHistoryHeight);
const track=[
[6,14],[6,13],[6,12],[6,11],[6,10],[6,9],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8],[0,7],
[0,6],[1,6],[2,6],[3,6],[4,6],[5,6],[6,5],[6,4],[6,3],[6,2],[6,1],[6,0],[7,0],
[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[9,6],[10,6],[11,6],[12,6],[13,6],[14,6],[14,7],
[14,8],[13,8],[12,8],[11,8],[10,8],[9,8],[8,9],[8,10],[8,11],[8,12],[8,13],[8,14],[7,14]
];
// Four parking positions divide each 296×296 airport into a symmetric 3×3
// spacing scheme; all four plane centers are equidistant from its edges.
const camps=[{x:66,y:535,c:"#eea49b"},{x:535,y:66,c:"#a5cde8"},
 {x:66,y:66,c:"#c2e1b5"},{x:535,y:535,c:"#f4e1a2"}];
const airportPads=({x,y})=>{
 const x1=(x+296/3-100)/50,x2=(x+592/3-100)/50;
 const y1=(y+296/3-100)/50,y2=(y+592/3-100)/50;
 return[[x1,y1],[x2,y1],[x1,y2],[x2,y2]];
};
const pads=[airportPads(camps[0]),airportPads(camps[1])];
const houses=[[[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]],[[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]]];
const colors=["#d8584c","#4c91d2"];
const dicePips={1:[[50,50]],2:[[28,28],[72,72]],3:[[28,28],[50,50],[72,72]],4:[[28,28],[72,28],[28,72],[72,72]],5:[[28,28],[72,28],[50,50],[28,72],[72,72]],6:[[28,25],[72,25],[28,50],[72,50],[28,75],[72,75]]};
let pawns=[[-1,-1,-1,-1],[-1,-1,-1,-1]],turn=0,mode="ai",difficulty="normal",paused=true,over=false,roll=null,history=[],aiTimer=null,selectedPlane=null,expandedStackKey=null;
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
 if(isRolling&&diceFace.dataset.phase==="spin")return side+" · 掷骰中";
 return roll===null?side+"回合":side+" · "+roll+"点";
}
function report(msg){status.textContent=msg;turnText.textContent=turnLabel();GameBridge.report(msg,{score:pawns[0].filter(p=>p===57).length,turn});}
function svgNode(tag,attrs){const ns="http:"+"//www.w3.org/2000/svg",e=document.createElementNS(ns,tag);for(const [key,val] of Object.entries(attrs))e.setAttribute(key,String(val));return e;}
// Animate visual faces and colorways while the logical die result stays fixed.
const diceInk=["#447c9c","#d96754","#378b6b","#9771be","#d6a044","#407bb5"];
const dicePaper=["#e8f4fc","#fff0e8","#eafaef","#f4ebff","#fff6e0","#ebf2fe"];
// Uniform mapping from 32-bit secure random values: reject the tiny
// modulo-bias tail, so faces 1–6 have exactly equal probabilities.
function fairDie(){
 if(!globalThis.crypto?.getRandomValues)return 1+Math.floor(Math.random()*6);
 const limit=0x100000000-0x100000000%6,words=new Uint32Array(1);
 do{crypto.getRandomValues(words);}while(words[0]>=limit);
 return words[0]%6+1;
}
let diceAnimationTimer=null,isRolling=false,lastDie=1,hasRolled=false,pendingNoMove=false,diceCube=null;
const diceOrientation={1:[0,0],2:[-90,0],3:[0,-90],4:[0,90],5:[90,0],6:[0,180]};
const DICE_SPIN_MS=500,DICE_SETTLE_MS=500;
function makeDiceCube(){
 diceCube=document.createElement("div");diceCube.className="flight-dice-cube";
 // Each color is associated with its physical face, not the random result.
 for(const value of [1,2,3,4,5,6]){
  const side=document.createElement("div");
  side.className="flight-dice-side";side.dataset.face=String(value);
  side.style.setProperty("--dice-ink",diceInk[value-1]);
  side.style.setProperty("--dice-paper",dicePaper[value-1]);
  const face=svgNode("svg",{viewBox:"0 0 100 100",class:"flight-dice-svg","aria-hidden":"true"});
  face.append(svgNode("rect",{x:3,y:3,width:94,height:94,rx:17,class:"flight-dice-body"}));
  for(const [cx,cy] of dicePips[value])
   face.append(svgNode("circle",{cx,cy,r:8,class:"flight-dice-pip"}));
  side.append(face);diceCube.append(side);
 }
 diceFace.replaceChildren(diceCube);
}
function renderDice(display=null){
 const value=display??(roll??lastDie);
 if(!diceCube||!diceFace.contains(diceCube))makeDiceCube();
 const [rx,ry]=diceOrientation[value];
 diceCube.style.transition="none";
 diceCube.style.transform=`rotateX(${rx}deg) rotateY(${ry}deg)`;
 diceFace.style.setProperty("--dice-ink",diceInk[value-1]);
 diceFace.style.setProperty("--dice-paper",dicePaper[value-1]);
 diceFace.dataset.value=String(roll??lastDie);
 diceFace.dataset.displayFace=String(value);
 diceFace.setAttribute("aria-label","骰子："+value+"点");
}
function stopDiceAnimation(){
 clearTimeout(diceAnimationTimer);diceAnimationTimer=null;
 isRolling=false;diceFace.classList.remove("rolling");
 diceFace.dataset.phase="idle";
 renderDice();
}
function finishPendingNoMove(){
 if(!pendingNoMove)return;
 pendingNoMove=false;
 const die=roll,from=turn;
 newTurn(die);
 report("掷出 "+die+" 点无可移动飞机 · "+(turn===0?"红方":"蓝方")+"回合");
}
function animateDice(){
 // ONE throw: an uninterrupted 500 ms 3D spin, one final result, then
 // 500 ms of complete stillness. No intermediate stops or face announcements.
 clearTimeout(diceAnimationTimer);
 if(!diceCube||!diceFace.contains(diceCube))makeDiceCube();
 isRolling=true;diceFace.classList.add("rolling");diceFace.dataset.phase="spin";
 const landing=roll??lastDie;
 const from=Number(diceFace.dataset.displayFace)||1;
 const [fx,fy]=diceOrientation[from],[tx,ty]=diceOrientation[landing];
 diceCube.style.transition="none";
 diceCube.style.transform=`rotateX(${fx}deg) rotateY(${fy}deg)`;
 // Commit starting pose before the continuous transition begins.
 void diceCube.offsetWidth;
 diceCube.style.transition=`transform ${DICE_SPIN_MS}ms cubic-bezier(.14,.55,.4,1)`;
 diceCube.style.transform=`rotateX(${720+tx}deg) rotateY(${720+ty}deg)`;
 diceFace.setAttribute("aria-label","骰子旋转中");
 diceAnimationTimer=setTimeout(()=>{
  if(!isRolling)return;
  diceFace.dataset.phase="settle";
  renderDice(landing);
  document.getElementById("flightDiceCaption").textContent="点数 "+landing;
  turnText.textContent=turnLabel();
  diceAnimationTimer=setTimeout(()=>{
   if(!isRolling)return;
   stopDiceAnimation();
   if(pendingNoMove)finishPendingNoMove();
   else{draw();if(roll!==null)report((turn===0?"红方":"蓝方")+" 掷出 "+roll+" 点 · 请选择飞机");}
  },DICE_SETTLE_MS);
 },DICE_SPIN_MS);
}
function routeFor(index){
 const move=moves().find(m=>m.index===index);if(!move)return null;
 const from=pawns[turn][index],steps=[],shortcuts=[];
 if(from<0)steps.push({progress:0,number:1});
 else for(let i=1;i<=roll;i++)steps.push({progress:from+i,number:i});
 // The annotation mirrors advance(): regular dice steps, then +4, then flight.
 let destination=from<0?0:from+roll;
 if(destination>0&&destination<52){
  let cell=absolute(turn,destination);
  if(cell%4===(turn===0?0:2)&&destination+4<=51){
   shortcuts.push({kind:"jump",from:destination,to:destination+4});
   destination+=4;cell=absolute(turn,destination);
  }
  if(cell===(turn===0?12:38)&&destination+26<=51){
   shortcuts.push({kind:"flight",from:destination,to:destination+26});
   destination+=26;
  }
 }
 return{move,steps,shortcuts,final:move.to,computedFinal:destination};
}
function previewPlane(index){
 if(paused||over||isRolling||roll===null||(mode==="ai"&&turn===1))return false;
 if(!moves().some(m=>m.index===index))return false;
 if(selectedPlane===index)return play(index);
 expandedStackKey=null;selectedPlane=index;draw();
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
 for(const camp of camps)el.append(svgNode("rect",{x:camp.x,y:camp.y,width:296,height:296,rx:26,fill:camp.c,opacity:".7"}));
 // Match visible colors to advance(): red = index % 4 === 0,
 // blue = index % 4 === 2. Others remain subdued reserve colors.
 const palette=["#efb8af","#f3dfb8","#b4d4ef","#c7e3d0"],
  borders=["#d48179","#d5b887","#83afcf","#a4cdb1"];
 track.forEach(([x,y],index)=>{
  const [cx,cy]=pos(x,y),shade=index%4,
   relative=(index-start(shade===2?1:0)+52)%52;
  const jump=(shade===0||shade===2)&&relative>0&&relative+4<=51?
   (shade===0?"red":"blue"):null;
  const launch=index===0?"red":index===26?"blue":null;
  const attributes={x:cx-22,y:cy-22,width:44,height:44,rx:6,
   fill:index===0?"#e99487":index===26?"#80b8e8":palette[shade],
   stroke:borders[shade],"stroke-width":2,"data-track":index,
   "data-track-color":["red","yellow","blue","green"][shade]};
  if(jump)attributes["data-jump-seat"]=jump;
  if(launch)attributes["data-launch"]=launch;
  if(index===12||index===38)attributes["data-flight-gate"]=index===12?"red":"blue";
  el.append(svgNode("rect",attributes));
 });
 const arrows=svgNode("g",{class:"flight-board-flow","aria-hidden":"true"});
 track.forEach(([x,y],index)=>{
  const [nx,ny]=track[(index+1)%52],[cx,cy]=pos(x,y),
   angle=Math.atan2(ny-y,nx-x)*180/Math.PI;
  arrows.append(svgNode("path",{d:"M -8 0 H 7 M 1 -5 L 7 0 L 1 5",
   transform:"translate("+cx+" "+cy+") rotate("+angle+")",
   class:"flight-route-arrow","data-flow-index":index,
   "data-flow-next":(index+1)%52}));
  const shade=index%4,relative=(index-start(shade===2?1:0)+52)%52;
  if((shade===0||shade===2)&&relative>0&&relative+4<=51){
   const tag=svgNode("text",{x:cx+18,y:cy+18,"text-anchor":"end",
    class:"flight-jump-tile-label","data-jump-label":index});
   tag.textContent="+4";arrows.append(tag);
  }
  if(index===0||index===26){
   const tag=svgNode("text",{x:cx-18,y:cy-11,
    class:"flight-launch-label","data-start-label":index});
   tag.textContent="起";arrows.append(tag);
  }
 });
 el.append(arrows);
 houses.forEach((home,seat)=>home.forEach(([x,y],i)=>{
  const [cx,cy]=pos(x,y);
  el.append(svgNode("rect",{x:cx-21,y:cy-21,width:42,height:42,rx:7,
   fill:seat===0?"#e89a8d":"#9ec5e9",
   stroke:seat===0?"#cf887c":"#75add5","stroke-width":2,
   "data-lane":seat+"-"+i}));
  el.append(svgNode("path",{d:"M -8 0 H 6 M 1 -5 L 6 0 L 1 5",
   transform:"translate("+cx+" "+cy+") rotate("+(seat===0?-90:90)+")",
   class:"flight-home-arrow","data-home-arrow":seat+"-"+i}));
 }));
 // Two continuous cross-board flight lanes correspond to the real
 // shortcuts: left red gate #12 -> right #38 and the reverse for blue.
 el.append(svgNode("circle",{cx:450,cy:450,r:37,class:"flight-center-pad"}));
 const corridors=[
  {seat:"red",from:12,to:38,d:"M 108 435 Q 450 390 792 435",head:[755,427,0]},
  {seat:"blue",from:38,to:12,d:"M 792 465 Q 450 510 108 465",head:[145,473,180]}];
 for(const r of corridors){
  el.append(svgNode("path",{d:r.d,class:"flight-air-corridor "+r.seat,
   "data-flight-from":r.from,"data-flight-to":r.to,"aria-hidden":"true"}));
  const [x,y,angle]=r.head;
  el.append(svgNode("path",{d:"M -11 -7 L 0 0 L -11 7",
   transform:"translate("+x+" "+y+") rotate("+angle+")",
   class:"flight-air-corridor-head "+r.seat,"aria-hidden":"true"}));
 }
 const legend=[
  ["路线说明",215,161,"flight-map-title"],
  ["→  沿格内箭头行进",215,195,"flight-map-legend"],
  ["+4  落同色格可跳跃",215,228,"flight-map-legend"],
  ["✈  虚线表示跨区飞行",215,261,"flight-map-legend"],
  ["红、蓝终点道通往中央",683,692,"flight-map-legend"]];
 for(const [value,x,y,cls] of legend){
  const label=svgNode("text",{x,y,"text-anchor":"middle",class:cls,"aria-hidden":"true"});
  label.textContent=value;el.append(label);
 }
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

 // A cell represents one or more airplanes. A pile never draws four
 // overlapping circles: show its team color(s) and a large ×N count instead.
 const posBuckets=new Map();
 pawns.forEach((row,seat)=>row.forEach((progress,index)=>{
  const [x,y]=position(seat,index,progress),key=x+","+y;
  if(!posBuckets.has(key))posBuckets.set(key,[]);
  const [cx,cy]=pos(x,y);
  posBuckets.get(key).push({seat,index,cx,cy,key});
 }));
 const playable=!paused&&!over&&!isRolling&&roll!==null&&!(mode==="ai"&&turn===1);
 const legal=playable?new Set(moves().map(m=>m.index)):new Set();
 for(const [key,members] of posBuckets){
  const {cx,cy}=members[0];
  if(members.length===1){
   const {seat,index}=members[0];
   const canMove=playable&&seat===turn&&legal.has(index);
   const selected=canMove&&selectedPlane===index;
   const group=svgNode("g",{"data-pawn":seat+"-"+index,role:"button",tabindex:"0",
    "data-slot-x":cx,"data-slot-y":cy,"data-center-x":cx,"data-center-y":cy,
    transform:"translate("+cx+" "+cy+")",
    class:"flight-aircraft"+(canMove?" can-move":"")+(selected?" is-selected":"")});
   group.append(svgNode("circle",{cx:0,cy:0,r:19,fill:colors[seat],stroke:"#fff","stroke-width":3}));
   group.append(svgNode("path",{d:"M0 -12 l-6 15 l6 -4 l6 4 Z",fill:"#fff"}));
   const label=svgNode("text",{x:0,y:12,"text-anchor":"middle",class:"flight-aircraft-number"});
   label.textContent=String(index+1);group.append(label);
   group.addEventListener("click",()=>previewPlane(index));
   group.addEventListener("keydown",e=>{if(e.key===" "||e.key==="Enter"){e.preventDefault();previewPlane(index);}});
   el.append(group);continue;
  }
  const choices=members.filter(m=>m.seat===turn&&legal.has(m.index));
  const selected=members.some(m=>m.seat===turn&&m.index===selectedPlane);
  const teams=[...new Set(members.map(m=>m.seat))];
  const group=svgNode("g",{transform:"translate("+cx+" "+cy+")",
   "data-stack-key":key,"data-stack-count":members.length,
   "data-stack-members":members.map(m=>m.seat+"-"+m.index).join(","),
   role:"button",tabindex:"0",
   "aria-label":members.length+"架飞机叠放"+(choices.length?"，点击选择具体飞机":""),
   class:"flight-stack"+(choices.length?" can-move":"")+(selected?" is-selected":"")});
  group.append(svgNode("circle",{cx:-3,cy:3,r:19,fill:colors[teams[0]],opacity:".47",stroke:"#fff","stroke-width":2}));
  group.append(svgNode("circle",{cx:0,cy:0,r:19,fill:colors[teams[0]],stroke:"#fff","stroke-width":3}));
  if(teams.length>1)group.append(svgNode("path",{d:"M 0 -19 A 19 19 0 0 1 0 19 Z",fill:colors[teams[1]]}));
  const tally=svgNode("text",{x:0,y:6,"text-anchor":"middle",class:"flight-stack-count"});
  tally.textContent="×"+members.length;group.append(tally);
  const pick=()=>{
   if(!choices.length)return;
   if(choices.length===1){previewPlane(choices[0].index);return;}
   expandedStackKey=expandedStackKey===key?null:key;draw();
   if(expandedStackKey)report("同格"+members.length+"架飞机 · 请选择飞机编号");
  };
  group.addEventListener("click",pick);
  group.addEventListener("keydown",e=>{if(e.key===" "||e.key==="Enter"){e.preventDefault();pick();}});
  el.append(group);
 }
 if(expandedStackKey&&posBuckets.has(expandedStackKey)){
  const bucket=posBuckets.get(expandedStackKey);
  const choices=bucket.filter(m=>m.seat===turn&&legal.has(m.index));
  if(choices.length>1){
   const {cx,cy}=bucket[0];
   const picker=svgNode("g",{class:"flight-stack-picker",role:"group","aria-label":"叠机选择"});
   picker.append(svgNode("circle",{cx,cy,r:68,class:"flight-stack-picker-backdrop"}));
   // Four cardinal quadrants leave the center count visible and fully
   // separate the individual numbered choices.
   const points=[[-42,-42],[42,-42],[-42,42],[42,42]];
   choices.forEach((member,i)=>{
    const [dx,dy]=points[i];
    const option=svgNode("g",{transform:"translate("+(cx+dx)+" "+(cy+dy)+")",
     class:"flight-stack-option","data-stack-choice":member.seat+"-"+member.index,
     role:"button",tabindex:"0","aria-label":"选择"+(member.index+1)+"号飞机"});
    option.append(svgNode("circle",{r:19,fill:colors[member.seat],stroke:"#fff","stroke-width":3}));
    const text=svgNode("text",{x:0,y:6,"text-anchor":"middle",class:"flight-stack-option-number"});
    text.textContent=String(member.index+1);option.append(text);
    option.addEventListener("click",()=>previewPlane(member.index));
    option.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();previewPlane(member.index);}});
    picker.append(option);
   });
   el.append(picker);
  }else expandedStackKey=null;
 }
 el.dataset.turn=String(turn);el.dataset.dice=roll===null?"":String(roll);
 layoutRoot.dataset.turnSide=turn===0?"red":"blue";
 document.getElementById("redArrived").textContent=String(pawns[0].filter(p=>p===57).length);
 document.getElementById("blueArrived").textContent=String(pawns[1].filter(p=>p===57).length);
 rollButton.disabled=paused||over||isRolling||roll!==null||turn===1&&mode==="ai";
 document.getElementById("flightDiceCaption").textContent=isRolling?"掷骰中…":roll===null?(hasRolled?"上次 "+lastDie+" 点":"等待掷骰"):"点数 "+roll;
 renderChoices();
 document.getElementById("undoButton").disabled=paused||over||!history.length;
 if(!isRolling)renderDice();
 fitHistoryHeight(); // Only reveal when the board has actually been drawn.
}
function newTurn(dice){
 roll=null;selectedPlane=null;expandedStackKey=null;turn=dice===6?turn:1-turn;window.GameTurnClock?.handover(turn===0?"红方":"蓝方");
 report((turn===0?"红方":"蓝方")+(dice===6?" · 再掷一次":" · 请掷骰子"));
 draw();scheduleAI();
}
function throwDice(value=null){
 if(paused||over||isRolling||roll!==null)return false;
 selectedPlane=null;expandedStackKey=null;roll=value==null?fairDie():value;
 if(!Number.isInteger(roll)||roll<1||roll>6){roll=null;return false;}
 lastDie=roll;hasRolled=true;
 const animated=value===null&&!window.matchMedia("(prefers-reduced-motion:reduce)").matches;
 isRolling=animated;
 pendingNoMove=moves().length===0;
 window.GameTurnClock?.record(turn===0?"红方":"蓝方",turn===0?"红方":"蓝方","掷骰 "+roll);
 if(pendingNoMove)
  window.GameTurnClock?.record(turn===0?"红方":"蓝方",turn===0?"红方":"蓝方","无可移动飞机");
 draw();
 if(animated)animateDice();
 else{stopDiceAnimation();if(pendingNoMove)finishPendingNoMove();}
 if(!animated&&!pendingNoMove)report((turn===0?"红方":"蓝方")+" 掷出 "+roll+" 点 · 点击高亮飞机");
 else if(animated)report((turn===0?"红方":"蓝方")+" 掷骰中 · 连续转动后显示结果");
 return true;
}
function play(index){
 if(paused||over||isRolling||roll===null||(mode==="ai"&&turn===1))return false;
 const m=moves().find(x=>x.index===index);if(!m)return false;
 selectedPlane=null;expandedStackKey=null;
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
 clearTimeout(aiTimer);stopDiceAnimation();pendingNoMove=false;const steps=mode==="ai"&&turn===0?Math.min(2,history.length):1;
 for(let i=0;i<steps;i++){const h=history.pop();pawns=h.pawns.map(row=>row.slice());turn=h.turn;roll=h.roll;}
 over=false;selectedPlane=null;expandedStackKey=null;window.GameTurnClock?.rewind(steps,turn===0?"红方":"蓝方");draw();report("已悔棋");scheduleAI();
}
function newGame(){
 clearTimeout(aiTimer);stopDiceAnimation();pawns=[[-1,-1,-1,-1],[-1,-1,-1,-1]];turn=0;roll=null;lastDie=1;hasRolled=false;pendingNoMove=false;selectedPlane=null;expandedStackKey=null;history=[];over=false;paused=false;window.GameTurnClock?.reset("红方");draw();report("红方先行 · 掷出六点起飞");
}
function pauseGame(){paused=true;selectedPlane=null;expandedStackKey=null;clearTimeout(aiTimer);stopDiceAnimation();report("已暂停");draw();}
function resumeGame(){paused=false;if(pendingNoMove)finishPendingNoMove();else{report("继续游戏");draw();scheduleAI();}}
rollButton.onclick=()=>{if(mode==="ai"&&turn===1)return;throwDice();};
diceFace.addEventListener("click",()=>rollButton.click());
document.getElementById("undoButton").onclick=undo;
if(new URLSearchParams(location.search).has("p111Test")){
 newGame();
 window.__p111FlightTest={
  track:()=>track.length,profile,state:()=>({pawns:pawns.map(r=>r.slice()),turn,roll,lastDie,hasRolled,pendingNoMove,isRolling,over,paused}),position:(seat,i)=>position(seat,i),
  roll:v=>throwDice(v),move:i=>play(i),moves:()=>moves(),preview:i=>previewPlane(i),route:i=>routeFor(i),
  setMode:v=>{mode=v;},setDifficulty:v=>{difficulty=v;},animateDice,stopDiceAnimation,fairDie,pause:pauseGame,resume:resumeGame,undo,
  setPawns:v=>{pawns=v.map(r=>r.slice());turn=0;roll=null;lastDie=1;hasRolled=false;pendingNoMove=false;selectedPlane=null;expandedStackKey=null;paused=false;over=false;history=[];window.GameTurnClock?.reset("红方");draw();}
 };
}
function resign(){
 if(paused||over)return false;
 const loser=mode==="ai"?0:turn,winner=1-loser;
 clearTimeout(aiTimer);stopDiceAnimation();
 over=true;paused=true;selectedPlane=null;expandedStackKey=null;roll=null;turn=winner;
 const label=s=>s===0?"红方":"蓝方";
 draw();const message=label(loser)+"认输 · "+label(winner)+"获胜";
 report(message);GameBridge.send("GAME_OVER",{message,winner:label(winner),score:pawns[0].filter(p=>p===57).length,
  win:mode==="ai"?false:winner===0});
 return true;
}
window.addEventListener("gamestation:resign",resign);
GameBridge.register({
 init(p){mode=p.mode==="two"?"two":"ai";difficulty=p.difficulty||"normal";newGame();},newGame,
 pause:pauseGame,
 resume:resumeGame,
 setMode:v=>{mode=v==="two"?"two":"ai";draw();},
 setDifficulty:v=>{difficulty=v||"normal";},
 dispose(){paused=true;clearTimeout(aiTimer);stopDiceAnimation();}
});
})();