(function(){
"use strict";
const el=document.getElementById("hand"),status=document.getElementById("tableInfo");
let wall=[],hands=[],discards=[],melds=[],current=0,phase="discard",pending=null,pendingKong=null,claimQueue=[],humanClaims=null,paused=false,over=false,selfHuAllowed=true,timer=null,difficulty="normal",rules={chi:true,sevenPairs:true,kong:true};
function tileLabel(t){if(t<9)return (t+1)+"万";if(t<18)return (t-8)+"筒";if(t<27)return (t-17)+"条";return ["东","南","西","北","中","发","白"][t-27];}
function sortHand(h){h.sort((a,b)=>a.type-b.type);}
function makeWall(){const a=[];for(let t=0;t<34;t++)for(let n=0;n<4;n++)a.push({id:a.length,type:t});for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function counts(types){const c=Array(34).fill(0);types.forEach(t=>c[t]++);return c;}
function canMeld(c,need,memo){const key=c.join("")+":"+need;if(memo.has(key))return memo.get(key);let i=c.findIndex(v=>v>0);if(i<0)return need===0;if(need<=0)return false;let ok=false;if(c[i]>=3){c[i]-=3;ok=canMeld(c,need-1,memo);c[i]+=3;}if(!ok&&i<27&&i%9<=6&&c[i+1]&&c[i+2]){c[i]--;c[i+1]--;c[i+2]--;ok=canMeld(c,need-1,memo);c[i]++;c[i+1]++;c[i+2]++;}memo.set(key,ok);return ok;}
function canHu(types,meldCount){if(types.length+meldCount*3!==14)return false;const c=counts(types);if(rules.sevenPairs&&meldCount===0&&c.reduce((s,v)=>s+v,0)===14&&c.every(v=>v%2===0))return true;const need=4-meldCount;for(let i=0;i<34;i++)if(c[i]>=2){c[i]-=2;const ok=canMeld(c,need,new Map());c[i]+=2;if(ok)return true;}return false;}
function draw(seat){if(!wall.length)return null;const tile=wall.pop();hands[seat].push(tile);sortHand(hands[seat]);return tile;}
function removeType(hand,type,n){if(hand.filter(t=>t.type===type).length<n)return null;const out=[];for(let i=0;i<n;i++){const idx=hand.findIndex(t=>t.type===type);out.push(hand.splice(idx,1)[0]);}return out;}
function report(t){status.textContent=t;GameBridge.report(t,{score:136-wall.length});}
function render(){document.getElementById("wallCount").textContent=wall.length;document.getElementById("turnLabel").textContent=current===0?"你":"AI "+current;document.getElementById("meldCount").textContent=melds[0].length;document.getElementById("opponents").innerHTML=[1,2,3].map(s=>'<span class="metric-pill">AI '+s+' <strong>'+hands[s].length+' 张</strong><span>副露 '+melds[s].length+'</span></span>').join("");
 document.getElementById("melds").innerHTML=melds.map((m,s)=>m.length?'<div class="meld-seat">'+(s===0?"你":"AI "+s)+'：'+m.map(v=>'<span class="tile-mini">'+v.tiles.map(tileLabel).join("")+'</span>').join(" ")+'</div>':"").join("");
 document.getElementById("discards").innerHTML=discards.map((arr,s)=>'<div class="discard-seat"><span>'+(s===0?"你":"AI "+s)+'</span>'+arr.slice(-8).map(t=>'<span class="tile-mini">'+tileLabel(t.type)+'</span>').join("")+'</div>').join("");
 el.innerHTML="";hands[0].forEach(tile=>{const b=document.createElement("button");b.type="button";b.className="playing-card tile-card";b.textContent=tileLabel(tile.type);b.disabled=paused||over||current!==0||phase!=="discard";b.onclick=()=>discardHuman(tile.id);el.appendChild(b);});
 document.getElementById("drawButton").classList.toggle("hidden",over||current!==0||phase!=="draw");document.getElementById("drawButton").disabled=paused;document.getElementById("huButton").classList.toggle("hidden",over||current!==0||phase!=="discard"||!selfHuAllowed||!canHu(hands[0].map(t=>t.type),melds[0].length));document.getElementById("huButton").disabled=paused;document.getElementById("claimBar").classList.toggle("hidden",!humanClaims||paused||over);document.getElementById("phaseLabel").textContent=phase==="draw"?"等待摸牌":phase==="discard"?"选择一张打出":"响应弃牌";
 const ownTurn=current===0&&phase==="discard"&&!paused&&!over&&!humanClaims&&!pendingKong;
 const kongChoices=ownTurn?kongOptions(0):[];
 const kongBar=document.getElementById("kongBar");kongBar.classList.toggle("hidden",kongChoices.length===0);
 kongBar.innerHTML=kongChoices.map(k=>'<button class="game-btn" data-kong-kind="'+k.kind+'" data-kong-type="'+k.type+'">'+(k.kind==="concealed"?"暗杠 ":"补杠 ")+tileLabel(k.type)+'</button>').join("");
 const claim=humanClaims||{};document.getElementById("claimHu").classList.toggle("hidden",!claim.hu);document.getElementById("claimKong").classList.toggle("hidden",!claim.kong);document.getElementById("claimPong").classList.toggle("hidden",!claim.pong);document.getElementById("claimChi").classList.toggle("hidden",!claim.chi?.length);
 const chiSelect=document.getElementById("chiChoice");chiSelect.innerHTML=(claim.chi||[]).map((seq,i)=>'<option value="'+i+'">'+seq.map(tileLabel).join(" + ")+'</option>').join("");chiSelect.classList.toggle("hidden",(claim.chi||[]).length<2);
}
function finish(winner,reason){if(over)return;over=true;pendingKong=null;claimQueue=[];humanClaims=null;clearTimeout(timer);const human=winner===0,msg=winner<0?"流局":human?"你胡牌！":"AI "+winner+" 胡牌";report(msg+(reason?" · "+reason:""));GameBridge.send("GAME_OVER",{message:msg,score:human?100+wall.length:0,win:human});render();}
function optionsFor(seat,discard){const hand=hands[seat],types=hand.map(t=>t.type),c=counts(types),plus=types.concat(discard.type);const opts={hu:canHu(plus,melds[seat].length),kong:rules.kong&&c[discard.type]>=3,pong:c[discard.type]>=2,chi:[]};if(rules.chi&&seat===(pending.seat+1)%4&&discard.type<27){const suit=Math.floor(discard.type/9)*9,rank=discard.type%9;for(let start=Math.max(0,rank-2);start<=Math.min(6,rank);start++){const seq=[suit+start,suit+start+1,suit+start+2];if(!seq.includes(discard.type))continue;const other=seq.filter(t=>t!==discard.type);if(c[other[0]]&&c[other[1]])opts.chi.push(other);}}return opts;}
function buildClaims(){claimQueue=[];for(const priority of ["hu","kong","pong","chi"])for(let step=1;step<=3;step++){const seat=(pending.seat+step)%4,opts=optionsFor(seat,pending.tile);if(opts[priority]&&(priority!=="chi"||opts.chi.length))if(!claimQueue.some(q=>q.seat===seat))claimQueue.push({seat,opts,priority});}resolveClaims();}
function chooseAIClaim(q){if(q.opts.hu)return "hu";if(q.opts.kong&&difficulty!=="easy")return "kong";if(q.opts.pong&&difficulty!=="easy")return "pong";if(q.opts.chi.length&&difficulty==="hard")return "chi";return "pass";}
function resolveClaims(){if(paused||over)return;if(!claimQueue.length){humanClaims=null;current=(pending.seat+1)%4;phase="draw";pending=null;render();report(current===0?"轮到你摸牌":"AI "+current+" 摸牌");scheduleAI();return;}const q=claimQueue[0];if(q.seat===0){humanClaims=q.opts;render();report("可以响应上家的弃牌");return;}const action=chooseAIClaim(q);if(action==="pass"){claimQueue.shift();resolveClaims();return;}executeClaim(q.seat,action,q.opts);}
function executeClaim(seat,action,opts){if(paused||over)return;if(action==="hu"){finish(seat,"荣和");return;}const tile=pending.tile,hand=hands[seat];if(action==="pong"){removeType(hand,tile.type,2);melds[seat].push({kind:"pong",tiles:[tile.type,tile.type,tile.type]});}else if(action==="kong"){removeType(hand,tile.type,3);melds[seat].push({kind:"kong",tiles:[tile.type,tile.type,tile.type,tile.type]});}else if(action==="chi"){const seq=opts.chi[0];seq.forEach(t=>removeType(hand,t,1));melds[seat].push({kind:"chi",tiles:[...seq,tile.type].sort((a,b)=>a-b)});}discards[pending.seat].pop();pending=null;claimQueue=[];humanClaims=null;current=seat;phase="discard";selfHuAllowed=false;if(action==="kong"){if(!draw(seat)){finish(-1,"牌墙已空");return;}selfHuAllowed=true;if(canHu(hands[seat].map(t=>t.type),melds[seat].length)){if(seat!==0){finish(seat,"杠上开花");return;}}}sortHand(hand);render();report((seat===0?"你": "AI "+seat)+(action==="pong"?"碰":action==="kong"?"杠": "吃")+" · 请打出一张");scheduleAI();}
function passClaim(){if(paused||!humanClaims)return;claimQueue.shift();humanClaims=null;if(pendingKong){resolveKongClaims();return;}resolveClaims();}
function discard(seat,tileId){if(paused||over)return;selfHuAllowed=false;const hand=hands[seat],idx=hand.findIndex(t=>t.id===tileId);if(idx<0)return;const [tile]=hand.splice(idx,1);discards[seat].push(tile);pending={seat,tile};phase="claim";humanClaims=null;render();report((seat===0?"你":"AI "+seat)+" 打出 "+tileLabel(tile.type));buildClaims();}
function shapeValue(types){const c=counts(types);let value=0;for(let t=0;t<34;t++){if(c[t]>=3)value+=7;if(c[t]===2)value+=3;if(t<27){if(c[t]&&c[t+1]&&t%9<8)value+=2;if(c[t]&&c[t+2]&&t%9<7)value+=1;}}return value;}
function chooseDiscard(seat){const hand=hands[seat];if(difficulty==="easy")return hand[Math.floor(Math.random()*hand.length)];let best=-Infinity,choices=[];for(const tile of hand){const rest=hand.filter(t=>t.id!==tile.id).map(t=>t.type);let value=shapeValue(rest);if(tile.type>=27)value+=-1;if(difficulty==="hard"){let waits=0;for(let t=0;t<34;t++)if(canHu(rest.concat(t),melds[seat].length))waits++;value+=waits*8;}value+=Math.random()*.01;if(value>best){best=value;choices=[tile];}else if(value===best)choices.push(tile);}return choices[Math.floor(Math.random()*choices.length)];}
function kongOptions(seat){
 if(!rules.kong||!hands[seat])return [];
 const c=counts(hands[seat].map(t=>t.type)),out=[];
 for(let type=0;type<34;type++)if(c[type]>=4)out.push({kind:"concealed",type});
 for(let i=0;i<melds[seat].length;i++){
  const m=melds[seat][i];if(m.kind==="pong"&&c[m.tiles[0]]>=1)out.push({kind:"added",type:m.tiles[0],meldIndex:i});
 }
 return out;
}
function drawReplacement(seat){
 if(!draw(seat)){finish(-1,"牌墙已空");return false;}
 current=seat;phase="discard";selfHuAllowed=true;render();
 if(seat!==0&&canHu(hands[seat].map(t=>t.type),melds[seat].length)){finish(seat,"杠上开花");return true;}
 report((seat===0?"你":"AI "+seat)+" 杠牌完成 · 请打出一张");
 if(seat!==0)scheduleAI();
 return true;
}
function declareConcealedKong(seat,type){
 if(paused||over||current!==seat||phase!=="discard")return false;
 const tiles=removeType(hands[seat],type,4);if(!tiles)return false;
 melds[seat].push({kind:"concealed-kong",tiles:tiles.map(t=>t.type)});
 return drawReplacement(seat);
}
function finalizeAddedKong(){
 const state=pendingKong;if(!state)return;
 pendingKong=null;
 const meld=melds[state.seat][state.meldIndex];
 if(!meld||meld.kind!=="pong")return;
 meld.kind="added-kong";meld.tiles.push(state.tile.type);
 drawReplacement(state.seat);
}
function resolveKongClaims(){
 if(paused||over||!pendingKong)return;
 if(!claimQueue.length){finalizeAddedKong();return;}
 const q=claimQueue[0];
 if(q.seat===0){humanClaims={hu:true,kongRob:true};render();report("可以抢杠胡，也可以放弃");return;}
 if(q.opts.hu){pendingKong=null;finish(q.seat,"抢杠胡");return;}
 claimQueue.shift();resolveKongClaims();
}
function declareAddedKong(seat,type,meldIndex){
 if(paused||over||current!==seat||phase!=="discard")return false;
 const tile=removeType(hands[seat],type,1)?.[0];if(!tile)return false;
 pendingKong={seat,tile,meldIndex};claimQueue=[];
 for(let step=1;step<=3;step++){
  const target=(seat+step)%4,types=hands[target].map(t=>t.type).concat(tile.type);
  if(canHu(types,melds[target].length))claimQueue.push({seat:target,opts:{hu:true}});
 }
 resolveKongClaims();return true;
}
function performAiKong(seat){
 const options=kongOptions(seat);if(!options.length)return false;
 const added=options.find(x=>x.kind==="added");
 if(added)return declareAddedKong(seat,added.type,added.meldIndex);
 const concealed=options.find(x=>x.kind==="concealed");
 return concealed?declareConcealedKong(seat,concealed.type):false;
}
function aiTurn(){if(paused||over||current===0)return;if(phase==="draw"){if(!draw(current)){finish(-1,"牌墙已空");return;}selfHuAllowed=true;if(canHu(hands[current].map(t=>t.type),melds[current].length)){finish(current,"自摸");return;}phase="discard";}if(phase==="discard"){if(performAiKong(current))return;const tile=chooseDiscard(current);discard(current,tile.id);}}
function scheduleAI(){clearTimeout(timer);if(paused||over||current===0)return;timer=setTimeout(aiTurn,difficulty==="easy"?420:difficulty==="hard"?650:520);}
function drawHuman(){if(paused||over||current!==0||phase!=="draw")return;if(!draw(0)){finish(-1,"牌墙已空");return;}selfHuAllowed=true;phase="discard";render();if(canHu(hands[0].map(t=>t.type),melds[0].length))report("可以自摸胡牌，也可以继续打牌");else report("摸牌完成，选择一张打出");}
function discardHuman(id){if(paused||over||current!==0||phase!=="discard"||humanClaims)return;discard(0,id);}
function huHuman(){if(paused||over||current!==0||!selfHuAllowed||!canHu(hands[0].map(t=>t.type),melds[0].length))return;finish(0,"自摸");}
function newGame(){clearTimeout(timer);wall=makeWall();hands=[[],[],[],[]];for(let i=0;i<13;i++)for(let s=0;s<4;s++)hands[s].push(wall.pop());hands[0].push(wall.pop());hands.forEach(sortHand);discards=[[],[],[],[]];melds=[[],[],[],[]];current=0;phase="discard";pending=null;pendingKong=null;claimQueue=[];humanClaims=null;paused=false;over=false;selfHuAllowed=true;render();report("庄家先打牌");}
document.getElementById("kongBar").addEventListener("click",e=>{const b=e.target.closest("[data-kong-kind]");if(!b)return;const kind=b.dataset.kongKind,type=Number(b.dataset.kongType);if(kind==="concealed")declareConcealedKong(0,type);else{const option=kongOptions(0).find(x=>x.kind==="added"&&x.type===type);if(option)declareAddedKong(0,type,option.meldIndex);}});
document.getElementById("drawButton").onclick=drawHuman;document.getElementById("huButton").onclick=huHuman;document.getElementById("claimHu").onclick=()=>{if(pendingKong){pendingKong=null;finish(0,"抢杠胡");}else executeClaim(0,"hu",humanClaims);};document.getElementById("claimKong").onclick=()=>executeClaim(0,"kong",humanClaims);document.getElementById("claimPong").onclick=()=>executeClaim(0,"pong",humanClaims);document.getElementById("claimChi").onclick=()=>{const choices=humanClaims?.chi||[],index=Number(document.getElementById("chiChoice").value)||0;executeClaim(0,"chi",{chi:choices[index]?[choices[index]]:[]});};document.getElementById("claimPass").onclick=passClaim;
document.getElementById("applyRules").onclick=()=>{rules={chi:document.getElementById("ruleChi").checked,sevenPairs:document.getElementById("ruleSevenPairs").checked,kong:document.getElementById("ruleKong").checked};report("规则已应用于当前对局");render();};
if(new URLSearchParams(location.search).has("p111Test")){
 window.__p111MahjongTest={
  wall(){return makeWall().map(t=>t.type);},
  canHu(types,meldCount=0){return canHu(types,meldCount);},
  loadState(state){
   clearTimeout(timer);
   hands=(state.hands||[[],[],[],[]]).map((types,seat)=>types.map((type,i)=>({id:10000+seat*100+i,type})));
   wall=(state.wallTypes||[]).map((type,i)=>({id:20000+i,type}));
   discards=[[],[],[],[]];melds=(state.melds||[[],[],[],[]]).map(ms=>ms.map(m=>({kind:m.kind,tiles:m.tiles.slice()})));
   current=state.current??0;phase=state.phase||"discard";pending=null;pendingKong=null;claimQueue=[];humanClaims=null;
   paused=!!state.paused;over=false;selfHuAllowed=state.selfHuAllowed!==false;
   rules={...rules,...(state.rules||{})};
   if(state.pendingSeat!==undefined&&state.pendingType!==undefined){
    const tile={id:30000,type:state.pendingType};pending={seat:state.pendingSeat,tile};discards[state.pendingSeat].push(tile);phase="claim";
   }
   render();
  },
  options(seat,type){return optionsFor(seat,{type});},
  buildClaims(){buildClaims();},
  queue(){return claimQueue.map(q=>({seat:q.seat,priority:q.priority,hu:!!q.opts.hu,kong:!!q.opts.kong,pong:!!q.opts.pong,chi:q.opts.chi}));},
  executeClaim(seat,action,opts={}){executeClaim(seat,action,opts);},
  drawHuman,
  discardHuman,
  kongOptions(seat=0){return kongOptions(seat);},
  concealedKong(seat,type){return declareConcealedKong(seat,type);},
  addedKong(seat,type,index){return declareAddedKong(seat,type,index);},
  setRules(next){rules={...rules,...next};render();},
  state(){return{wall:wall.length,hands:hands.map(h=>h.map(t=>t.type)),handIds:hands.map(h=>h.map(t=>t.id)),
   melds:melds.map(ms=>ms.map(m=>({kind:m.kind,tiles:m.tiles.slice()}))),discards:discards.map(ds=>ds.map(t=>t.type)),
   current,phase,pending:pending?{seat:pending.seat,type:pending.tile.type}:null,pendingKong:pendingKong?{seat:pendingKong.seat,type:pendingKong.tile.type}:null,
   claimQueue:this.queue(),humanClaims,paused,over,selfHuAllowed,rules:{...rules}};}
 };
}
GameBridge.register({init(p){difficulty=p.difficulty||"normal";newGame();},newGame,pause(){paused=true;clearTimeout(timer);report("已暂停");render();},resume(){paused=false;render();if(pendingKong)resolveKongClaims();else scheduleAI();},setDifficulty(v){difficulty=v||"normal";},setOptions(v){rules={...rules,...v};},dispose(){paused=true;clearTimeout(timer);}});
})();