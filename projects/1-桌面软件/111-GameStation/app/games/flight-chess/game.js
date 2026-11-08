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
// Coordinates traced from the user's physical aeroplane board after
// perspective correction. The 52 points are ordered clockwise; index 0
// is the red launch tile, index 26 the opposite blue launch tile.
const photoTrack=[
 [417,692],[375,695],[332,695],[289,696],[245,685],[222,642],[221,600],
 [243,551],[202,520],[155,537],[114,538],[70,523],[56,477],[56,435],
 [56,392],[56,350],[56,309],[69,265],[111,243],[153,240],[204,260],
 [235,219],[219,173],[219,134],[235,91],[283,73],[327,72],[370,70],
 [413,68],[454,67],[502,78],[519,122],[519,163],[503,211],[544,244],
 [591,223],[633,222],[676,233],[695,285],[695,328],[695,371],[695,415],
 [696,457],[685,500],[637,522],[593,524],[543,505],[508,545],[527,593],
 [527,633],[512,679],[461,692]
];
const photoToGrid=([x,y])=>[(60+x*780/750-100)/50,(60+y*780/750-100)/50];
const track=photoTrack.map(photoToGrid);
const camps=[
 {name:"red",cx:673,cy:675,pads:[[645,645],[699,643],[647,699],[701,697]]},
 {name:"blue",cx:85,cy:103,pads:[[58,78],[109,73],[60,129],[112,126]]},
 {name:"yellow",cx:84,cy:678,pads:[[58,652],[111,650],[60,705],[113,703]]},
 {name:"green",cx:663,cy:82,pads:[[634,56],[688,52],[636,108],[690,105]]}
];
const airportPads=camp=>camp.pads.map(photoToGrid);
const pads=[airportPads(camps[0]),airportPads(camps[1])];
const houses=[
 [[641,377],[591,377],[551,376],[507,377],[464,378],[415,382]].map(photoToGrid),
 [[112,391],[153,390],[195,389],[239,388],[281,386],[331,384]].map(photoToGrid)
];
const yellowLane=[[375,641],[375,598],[375,554],[375,511],[375,465],[370,421]].map(photoToGrid);
const greenLane=[[369,126],[369,168],[369,211],[369,254],[370,296],[370,345]].map(photoToGrid);
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
let isMoving=false,travelAnimation=null,travelMarker=null;
function cancelTravel(){
 const old=travelAnimation;travelAnimation=null;if(old)old.cancel();
 travelMarker?.remove();travelMarker=null;isMoving=false;
 el.querySelectorAll("[data-travel-hidden]").forEach(node=>{
  node.removeAttribute("visibility");node.removeAttribute("data-travel-hidden");
 });
}
function animateTravel(seat,index,from,route,to){
 const root=el.querySelector(".flight-scene"),last=el.querySelector('[data-pawn="'+seat+'-'+index+'"]');
 if(!route||!root||!last||typeof last.animate!=="function"){
  isMoving=false;draw();scheduleAI();return;
 }
 const seq=[from,...route.steps.map(x=>x.progress),...route.shortcuts.map(x=>x.to),to];
 const points=seq.map(p=>position(seat,index,p)).map(([x,y])=>[100+x*50,100+y*50])
  .filter((p,i,all)=>i===0||p[0]!==all[i-1][0]||p[1]!==all[i-1][1]);
 if(points.length<2){isMoving=false;draw();scheduleAI();return;}
 const ghost=last.cloneNode(true);ghost.removeAttribute("data-pawn");
 ghost.removeAttribute("role");ghost.removeAttribute("tabindex");
 ghost.classList.remove("can-move","is-selected");ghost.classList.add("flight-travel-ghost");
 ghost.removeAttribute("transform");
 last.setAttribute("visibility","hidden");last.dataset.travelHidden="true";
 root.append(ghost);travelMarker=ghost;
 const steps=points.slice(1).map((p,i)=>Math.min(2.5,Math.max(.85,
  Math.hypot(p[0]-points[i][0],p[1]-points[i][1])/50)));
 const total=steps.reduce((a,b)=>a+b,0);let t=0;
 const frames=points.map(([x,y],i)=>{
  if(i)t+=steps[i-1];
  return{offset:i===points.length-1?1:t/total,transform:"translate("+x+"px,"+y+"px)"};
 });
 const anim=ghost.animate(frames,{duration:Math.min(1450,Math.max(320,total*115)),easing:"linear",fill:"both"});
 travelAnimation=anim;anim.onfinish=()=>{
  if(travelAnimation!==anim)return;
  cancelTravel();draw();scheduleAI();
 };
}
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
 if(paused||over||isRolling||isMoving||roll===null||(mode==="ai"&&turn===1))return false;
 if(!moves().some(m=>m.index===index))return false;
 if(selectedPlane===index)return play(index);
 expandedStackKey=null;selectedPlane=index;draw();
 report((turn===0?"红方":"蓝方")+(index+1)+"号：绿色序号为走棋步数，虚线为跳跃；点击落点确认");
 return true;
}
function renderChoices(){
 const host=document.getElementById("flightMoveOptions"),label=document.getElementById("flightMoveCount"),
  help=document.getElementById("flightMoveHelp");
 const legal=paused||over||isRolling||isMoving||roll===null||mode==="ai"&&turn===1?[]:moves();
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
  "已选"+(selectedPlane+1)+"号：序号是骰子步数，+4/✈是额外跳跃；点绿色落点确认。":
  legal.length?"请选择发光的飞机，预览绿色编号路线。":"没有可移动的飞机。";
}

function drawClassicBoard(){
 const pt=(x,y)=>[100+x*50,100+y*50];
 const ink={red:"#bb3e39",blue:"#224fa8",yellow:"#dfb72b",green:"#228b47"};
 const tile={red:"#dc4c48",yellow:"#e9c63d",blue:"#285cad",green:"#329553"};
 const area={red:"#fff4dd",blue:"#fff4dd",yellow:"#fff4dd",green:"#fff4dd"};
 el.append(svgNode("rect",{x:45,y:45,width:810,height:810,rx:3,class:"flight-outline"}));
 // The four circular printed airports follow the reference photograph.
 for(const camp of camps){
  const [cx,cy]=pt(...photoToGrid([camp.cx,camp.cy]));
  el.append(svgNode("circle",{cx,cy,r:79,class:"flight-airport-circle",
   fill:"#f8eed0","data-airport":camp.name,"data-airport-circle":camp.name}));
  for(const [x,y] of airportPads(camp)){
   const [px,py]=pt(x,y);
   el.append(svgNode("circle",{cx:px,cy:py,r:23,class:"flight-airport-ring",
    fill:"#f8eed0",stroke:"#303127","data-airport-pad":camp.name}));
   el.append(svgNode("circle",{cx:px,cy:py,r:18,class:"flight-airport-hole",fill:ink[camp.name]}));
  }
 }
 // Thick dark printed route outline under all 52 colored tiles.
 const photoPoints=track.map(([x,y])=>pt(x,y));
 el.append(svgNode("polyline",{points:[...photoPoints,photoPoints[0]].map(p=>p.join(",")).join(" "),
  fill:"none",stroke:"#26302a","stroke-width":50,"stroke-linejoin":"round","stroke-linecap":"round",
  class:"flight-outer-outline","aria-hidden":"true"}));
 // Only TWO active flying lines. Draw them under the holes and home
 // tiles, not across arrows or over tokens.
 for(const leg of [
  {seat:"red",from:12,to:38,d:"M 108 440 Q 450 421 792 440",
   head:"M 780 435 l 12 5 l -12 5"},
  {seat:"blue",from:38,to:12,d:"M 792 460 Q 450 479 108 460",
   head:"M 120 455 l -12 5 l 12 5"}]){
  el.append(svgNode("path",{d:leg.d,class:"flight-air-corridor "+leg.seat,
   "data-flight-from":leg.from,"data-flight-to":leg.to,"aria-hidden":"true"}));
  el.append(svgNode("path",{d:leg.head,class:"flight-air-corridor-head "+leg.seat,
   "aria-hidden":"true"}));
 }
 // Ring: 52 real engine squares, four clean pastel colors and one white
 // round landing hole per square. No 52 overprinted arrows/+4 labels.
 const names=["red","yellow","blue","green"];
 track.forEach(([x,y],index)=>{
  const [cx,cy]=pt(x,y),name=names[index%4],
   relative=(index-start(name==="blue"?1:0)+52)%52;
  const jump=(name==="red"||name==="blue")&&relative>0&&relative+4<=51?name:null;
  const attributes={x:cx-23,y:cy-23,width:46,height:46,rx:0,
   fill:tile[name],class:"flight-track-tile","data-track":index,
   "data-track-color":name};
  if(jump)attributes["data-jump-seat"]=jump;
  if(index===0||index===26)attributes["data-launch"]=name;
  if(index===12||index===38)attributes["data-flight-gate"]=index===12?"red":"blue";
  el.append(svgNode("rect",attributes));
  const [nx,ny]=track[(index+1)%52],heading=Math.atan2(ny-y,nx-x)*180/Math.PI;
   // The physical board has white landing circles and only four entry arrows.
   el.append(svgNode("circle",{cx,cy,r:15,class:"flight-track-hole",
     "data-hole-track":index,fill:"#fffef0","aria-hidden":"true"}));
   if([7,8,20,21,33,34,46,47].includes(index)){
    el.append(svgNode("path",{d:"M -8 -5 L 0 -5 L 0 -10 L 11 0 L 0 10 L 0 5 L -8 5 Z",
     transform:"translate("+cx+" "+cy+") rotate("+heading+")",
     class:"flight-track-direction",fill:ink[name],"aria-hidden":"true"}));
   }
 });
 // Four lanes converge on a four-color center. Red and blue are playable;
 // yellow and green are visual lanes only (no change to two-player rules).
 const lanes=[
  {name:"red",squares:houses[0],dir:-90,active:0},
  {name:"blue",squares:houses[1],dir:90,active:1},
  {name:"yellow",squares:yellowLane,dir:0},
  {name:"green",squares:greenLane,dir:180}
 ];
 for(const lane of lanes){
  lane.squares.forEach(([x,y],i)=>{
   const [cx,cy]=pt(x,y),
    attrs={x:cx-24,y:cy-24,width:48,height:48,rx:0,
     class:"flight-home-tile",fill:tile[lane.name]};
   if(lane.active!==undefined)attrs["data-lane"]=lane.active+"-"+i;
   else attrs["data-decor-lane"]=lane.name+"-"+i;
   el.append(svgNode("rect",attrs));
   el.append(svgNode("circle",{cx,cy,r:15,class:"flight-home-hole",fill:"#fffef0"}));
  });
  const [ax,ay]=pt(...lane.squares[3]);
  el.append(svgNode("path",{d:"M -7 0 H 7 M 1 -5 L 7 0 L 1 5",
   transform:"translate("+ax+" "+ay+") rotate("+lane.dir+")",
   class:"flight-home-arrow","data-home-arrow":lane.name}));
 }
 // A small compass shows the circular direction without overcrowding all
 // 52 white holes; turn markers are on eight recognizable corner squares.
 for(const index of [0,12,26,38]){
  const [x,y]=track[index],[nx,ny]=track[(index+1)%52],
   [cx,cy]=pt(x,y),angle=Math.atan2(ny-y,nx-x)*180/Math.PI;
  el.append(svgNode("path",{d:"M -7 0 H 6 M 0 -5 L 6 0 L 0 5",
   transform:"translate("+cx+" "+cy+") rotate("+angle+")",
   class:"flight-route-arrow","data-flow-index":index,
   "data-flow-next":(index+1)%52,"aria-hidden":"true"}));
 }
 // The gate aircraft icons deliberately identify the same two shortcut
 // positions used by advance(), not additional playable squares.
 for(const index of [12,38]){
  const [cx,cy]=pt(...track[index]);
  const icon=svgNode("path",{d:"M 0 -13 L 3 -7 L 3 -3 L 13 4 L 13 8 L 3 5 L 3 13 L 7 16 L 7 18 L 0 16 L -7 18 L -7 16 L -3 13 L -3 5 L -13 8 L -13 4 L -3 -3 L -3 -7 Z",
   class:"flight-gate-icon","data-gate-icon":index,"aria-hidden":"true",
   transform:"translate("+cx+" "+cy+")",fill:"#24556c"});
  el.append(icon);
 }
 // Four inward HOME sectors, drawn as in the user's round pinwheel.
 const center=[
  {name:"blue",d:"M 450 450 L 393 393 A 80 80 0 0 0 393 507 Z",x:408,y:450},
  {name:"green",d:"M 450 450 L 393 393 A 80 80 0 0 1 507 393 Z",x:450,y:408},
  {name:"red",d:"M 450 450 L 507 393 A 80 80 0 0 1 507 507 Z",x:492,y:450},
  {name:"yellow",d:"M 450 450 L 507 507 A 80 80 0 0 1 393 507 Z",x:450,y:492}
 ];
 el.append(svgNode("circle",{cx:450,cy:450,r:80,class:"flight-center-outline"}));
 for(const sector of center){
  el.append(svgNode("path",{d:sector.d,class:"flight-center-sector",
   fill:tile[sector.name],"data-center-seat":sector.name}));
  el.append(svgNode("circle",{cx:sector.x,cy:sector.y,r:20,
   class:"flight-center-core",fill:"#fffbea"}));
  const label=svgNode("text",{x:sector.x,y:sector.y+4,
   "text-anchor":"middle",class:"flight-center-star","aria-hidden":"true"});
  label.textContent="HOME";el.append(label);
 }

}

function draw(){
 el.replaceChildren();
 const pos=(x,y)=>[100+x*50,100+y*50];
 drawClassicBoard();
 // Numbered stepping stones belong to the chosen airplane only, never to a
 // decorative second board. A separate green end marker commits the move.
 const preview=selectedPlane===null||paused||over?null:routeFor(selectedPlane);
 const previewMarkers=[];
 el.dataset.previewActive=preview?"true":"false";
 if(preview){
  const coords=preview.steps.map(step=>{
   const [x,y]=position(turn,selectedPlane,step.progress);
   return{...step,cx:100+x*50,cy:100+y*50};
  });
  // Include the aircraft's current square. Even a one-step die roll
  // must have a visible connection from the origin to square 1.
  if(coords.length){
   const [ox,oy]=position(turn,selectedPlane,pawns[turn][selectedPlane]);
   const origin=pos(ox,oy);
   el.append(svgNode("polyline",{points:[origin.join(","),
    ...coords.map(p=>p.cx+","+p.cy)].join(" "),
    class:"flight-preview-path","data-dice-path":coords.length}));
  }
  // Dice numbers are distinct from rule-triggered extra movement.
  // Dashed orange = +4, dashed colored = flight across the board.
  for(const bonus of preview.shortcuts){
   const progressList=bonus.kind==="jump"
    ?Array.from({length:5},(_,i)=>bonus.from+i)
    :[bonus.from,bonus.to];
   const points=progressList.map(p=>{
    const [x,y]=position(turn,selectedPlane,p);return pos(x,y);
   });
   el.append(svgNode("polyline",{points:points.map(([x,y])=>x+","+y).join(" "),
    class:"flight-preview-shortcut "+bonus.kind,
    "data-shortcut":bonus.kind,"data-shortcut-from":bonus.from,
    "data-shortcut-to":bonus.to,"aria-hidden":"true"}));
   const [x,y]=points[points.length-1],
    badge=svgNode("g",{class:"flight-shortcut-badge "+bonus.kind,
     "data-shortcut-label":bonus.kind,"aria-hidden":"true"});
   badge.append(svgNode("circle",{cx:x+12,cy:y-15,r:15}));
   const text=svgNode("text",{x:x+12,y:y-10,"text-anchor":"middle"});
   text.textContent=bonus.kind==="jump"?"+4":"✈";badge.append(text);previewMarkers.push(badge);
  }
  for(const step of coords){
   const marker=svgNode("g",{class:"flight-path-step","data-preview-step":step.number,
    "aria-label":"前进第"+step.number+"格"});
   marker.append(svgNode("circle",{cx:step.cx,cy:step.cy,r:17,class:"flight-preview-circle"}));
   const label=svgNode("text",{x:step.cx,y:step.cy+6,"text-anchor":"middle",class:"flight-preview-number"});
   label.textContent=String(step.number);marker.append(label);previewMarkers.push(marker);
  }
  const [gx,gy]=position(turn,selectedPlane,preview.final),tx=100+gx*50,ty=100+gy*50;
  const goal=svgNode("g",{class:"flight-path-target",role:"button",tabindex:"0",
    "data-preview-to":preview.final,"aria-label":"点击确认将飞机移动到目标位置"});
  goal.append(svgNode("circle",{cx:tx,cy:ty,r:24,class:"flight-target-ring"}));
  const end=svgNode("text",{x:tx,y:ty+6,"text-anchor":"middle",class:"flight-target-label"});
  end.textContent=preview.final===57?"终":"落";goal.append(end);
  goal.addEventListener("click",()=>play(selectedPlane));
  goal.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();play(selectedPlane);}});
  previewMarkers.push(goal);
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
 const playable=!paused&&!over&&!isRolling&&!isMoving&&roll!==null&&!(mode==="ai"&&turn===1);
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
 // Labels and the clickable landing marker must stay visible even if another
 // plane already occupies the destination (capture preview).
 for(const marker of previewMarkers)el.append(marker);
 // The photographed 52-slot geometry is already in reference orientation.
 const boardScene=svgNode("g",{class:"flight-scene"});
 boardScene.append(...Array.from(el.childNodes));el.append(boardScene);
 el.dataset.turn=String(turn);el.dataset.dice=roll===null?"":String(roll);
 layoutRoot.dataset.turnSide=turn===0?"red":"blue";
 document.getElementById("redArrived").textContent=String(pawns[0].filter(p=>p===57).length);
 document.getElementById("blueArrived").textContent=String(pawns[1].filter(p=>p===57).length);
 rollButton.disabled=paused||over||isRolling||isMoving||roll!==null||turn===1&&mode==="ai";
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
 if(paused||over||isRolling||isMoving||roll!==null)return false;
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
 if(paused||over||isRolling||isMoving||roll===null||(mode==="ai"&&turn===1))return false;
 const m=moves().find(x=>x.index===index);if(!m)return false;
 const seat=turn,prior=m.from,route=routeFor(index);
 const useMotion=!new URLSearchParams(location.search).has("p111Test")&&
  !window.matchMedia("(prefers-reduced-motion:reduce)").matches;
 isMoving=useMotion;
 selectedPlane=null;expandedStackKey=null;
 history.push({pawns:pawns.map(row=>row.slice()),turn,roll});
 pawns[turn][index]=m.to;
 for(const enemy of opponentsAt(turn,m.to))pawns[1-turn][enemy]=-1;
 const die=roll;window.GameTurnClock?.record(turn===0?"红方":"蓝方",turn===0?"红方":"蓝方","飞机移动");draw();
 if(pawns[turn].every(p=>p===57)){
  over=true;paused=true;clearTimeout(aiTimer);const msg=turn===0?"红方获胜":"蓝方获胜";
  report(msg);GameBridge.send("GAME_OVER",{message:msg,win:turn===0,score:pawns[0].filter(p=>p===57).length});draw();return true;
 }
 newTurn(die);
 if(useMotion)animateTravel(seat,index,prior,route,m.to);
 return true;
}
function scheduleAI(){
 clearTimeout(aiTimer);if(paused||over||isMoving||turn!==1||mode!=="ai")return;
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
 clearTimeout(aiTimer);cancelTravel();stopDiceAnimation();pendingNoMove=false;const steps=mode==="ai"&&turn===0?Math.min(2,history.length):1;
 for(let i=0;i<steps;i++){const h=history.pop();pawns=h.pawns.map(row=>row.slice());turn=h.turn;roll=h.roll;}
 over=false;selectedPlane=null;expandedStackKey=null;window.GameTurnClock?.rewind(steps,turn===0?"红方":"蓝方");draw();report("已悔棋");scheduleAI();
}
function newGame(){
 clearTimeout(aiTimer);cancelTravel();stopDiceAnimation();pawns=[[-1,-1,-1,-1],[-1,-1,-1,-1]];turn=0;roll=null;lastDie=1;hasRolled=false;pendingNoMove=false;selectedPlane=null;expandedStackKey=null;history=[];over=false;paused=false;window.GameTurnClock?.reset("红方");draw();report("红方先行 · 掷出六点起飞");
}
function pauseGame(){cancelTravel();paused=true;selectedPlane=null;expandedStackKey=null;clearTimeout(aiTimer);stopDiceAnimation();report("已暂停");draw();}
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
 clearTimeout(aiTimer);cancelTravel();stopDiceAnimation();
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
 dispose(){paused=true;clearTimeout(aiTimer);cancelTravel();stopDiceAnimation();}
});
})();