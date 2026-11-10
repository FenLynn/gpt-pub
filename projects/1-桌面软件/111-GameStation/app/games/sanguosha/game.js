(function(){
"use strict";
const handEl=document.getElementById("hand"),status=document.getElementById("tableInfo"),logEl=document.getElementById("gameLog");
const lordSeat=1,roleText={lord:"主公",loyalist:"忠臣",rebel:"反贼",spy:"内奸"};
let players=[],deck=[],discardPile=[],current=0,phase="play",selected=null,targetMode=false,usedKill=false,usedWine=false,paused=false,over=false,timer=null,difficulty="normal",score=0,hostility=[0,0,0,0],aggression=[0,0,0,0],pendingResponse=null,pendingTianxiang=null,pendingSave=null,aiBusy=false;
const defs=[["杀","kill",16],["闪","dodge",10],["桃","peach",8],["酒","wine",4],["决斗","duel",4],["过河拆桥","dismantle",4],["顺手牵羊","steal",4],["无中生有","draw2",4],["南蛮入侵","barbarian",2],["万箭齐发","arrows",2],["桃园结义","peachGarden",2]];
const suits=["spade","heart","club","diamond"],suitText={spade:"♠",heart:"♥",club:"♣",diamond:"♦"};
function makeDeck(){const a=[];let id=0;for(const [name,type,n] of defs)for(let i=0;i<n;i++)a.push({id:id++,name,type,suit:suits[i%4],rank:i%13+1});for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function report(t){status.textContent=t;GameBridge.report(t,{score});}
function log(t){
 const latest=logEl.firstElementChild;
 // Repeated INIT/READY cycles can announce the same opening turn more than once.
 // Keep the battle history semantic: identical consecutive events occupy one row.
 if(!latest||latest.textContent!==t){
  const row=document.createElement("div");row.textContent=t;logEl.prepend(row);
  while(logEl.children.length>5)logEl.lastChild.remove();
 }
 report(t);
}
function alive(){return players.filter(p=>p.alive);}
function heartCard(card,seat){return card.suit==="heart"||(seat===0&&card.suit==="spade");}
function cardText(c){return c.name+" "+suitText[c.suit]+c.rank;}
function drawCards(seat,n){for(let i=0;i<n&&deck.length;i++)players[seat].hand.push(deck.pop());}
function findCard(seat,name){return players[seat].hand.find(c=>c.name===name);}
function removeCard(seat,id){const i=players[seat].hand.findIndex(c=>c.id===id);return i<0?null:players[seat].hand.splice(i,1)[0];}
function validTarget(seat,target,card){
 const p=players[target];
 if(!p?.alive||target===seat)return false;
 if((card.type==="dismantle"||card.type==="steal")&&p.hand.length===0)return false;
 return true;
}
function cardPlayable(seat,card){
 if(!card||!players[seat]?.alive)return false;
 if(card.type==="dodge")return false;
 if(card.type==="peach")return players[seat].hp<players[seat].maxHp;
 if(card.type==="wine")return !usedWine;
 if(card.type==="kill")return !usedKill&&players.some((p,i)=>validTarget(seat,i,card));
 if(["duel","dismantle","steal"].includes(card.type))return players.some((p,i)=>validTarget(seat,i,card));
 if(card.type==="peachGarden")return alive().some(p=>p.hp<p.maxHp);
 return true;
}
function render(){document.getElementById("deckCount").textContent=deck.length;document.getElementById("turnLabel").textContent=current===0?"你":"AI "+current;document.getElementById("players").innerHTML=players.map((p,i)=>'<button class="metric-pill player-chip '+(i===current?"active":"")+'" data-seat="'+i+'" '+(!p.alive||i===0||!targetMode||i===current?"disabled":"")+'><strong>'+(i===0?"小乔":i===lordSeat?"主公":"AI "+i)+'</strong> <span>♥ '+p.hp+'/'+p.maxHp+'</span> <span>手牌 '+p.hand.length+'</span> '+(!p.alive?"· "+roleText[p.role]:"")+'</button>').join("");
 handEl.innerHTML="";players[0].hand.forEach(card=>{const b=document.createElement("button");b.className="playing-card"+(card.suit==="heart"||card.suit==="diamond"?" red":"")+(selected?.id===card.id?" selected":"");b.textContent=cardText(card);b.disabled=paused||over||current!==0||phase!=="play"||!cardPlayable(0,card);b.onclick=()=>{if(!cardPlayable(0,card))return;selected=selected?.id===card.id?null:card;targetMode=!!selected&&["kill","duel","dismantle","steal"].includes(selected.type);render();};handEl.appendChild(b);});
 document.getElementById("selectedCard").textContent=selected?cardText(selected):"未选择手牌";document.getElementById("useCard").disabled=!selected||!cardPlayable(0,selected)||paused||over||current!==0||phase!=="play"||targetMode;document.getElementById("endTurn").disabled=paused||over||current!==0||phase!=="play";document.getElementById("cancelCard").disabled=!selected;
 const targetPanel=document.getElementById("targetPanel");targetPanel.style.display=targetMode?"flex":"none";targetPanel.innerHTML=targetMode?players.map((p,i)=>validTarget(0,i,selected)?'<button class="game-btn" data-target="'+i+'">'+(i===lordSeat?"主公":"AI "+i)+" · "+p.hp+" HP</button>":"").join(""):"";
 document.getElementById("responseBar").style.display=pendingResponse&&!paused?"flex":"none";if(pendingResponse)document.getElementById("responseText").textContent="需要响应："+pendingResponse.kind;
 const tianxiangCards=document.getElementById("tianxiangCards");
 tianxiangCards.innerHTML=pendingTianxiang?pendingTianxiang.hearts.map(card=>'<button type="button" class="playing-card" data-card="'+card.id+'">'+cardText(card)+'</button>').join(""):"";
 if(!pendingTianxiang)document.getElementById("tianxiangTargets").innerHTML="";else if(pendingTianxiang.cardId!=null)document.getElementById("tianxiangTargets").innerHTML=players.map((p,i)=>p.alive&&i!==0?'<button class="game-btn" data-target="'+i+'">'+(i===lordSeat?"主公":"AI "+i)+'</button>':"").join("");
 document.getElementById("tianxiangPanel").style.display=pendingTianxiang&&!paused?"flex":"none";document.getElementById("savePanel").style.display=pendingSave&&pendingSave.responder===0&&!paused?"flex":"none";
 document.getElementById("saveText").textContent=pendingSave?(pendingSave.target===0?"你濒死了，使用桃或酒自救；也可以用桃救其他濒死角色。":(pendingSave.target===lordSeat?"主公":"AI "+pendingSave.target)+" 濒死，你可以使用桃救援。"):"";
 document.getElementById("savePeach").disabled=!pendingSave||!findCard(0,"桃");
 document.getElementById("saveWine").style.display=pendingSave?.target===0?"inline-flex":"none";
 document.getElementById("saveWine").disabled=!pendingSave||pendingSave.target!==0||!findCard(0,"酒");
}
function checkVictory(){const lordAlive=players[lordSeat].alive,rebelAlive=players.some(p=>p.alive&&p.role==="rebel"),spyAlive=players.some(p=>p.alive&&p.role==="spy");if(!lordAlive){if(spyAlive&&alive().length===1){finish("spy");return true;}if(rebelAlive){finish("rebel");return true;}if(!spyAlive){finish("rebel");return true;}return false;}if(!rebelAlive&&!spyAlive){finish("lord");return true;}return false;}
function finish(side){if(over)return;over=true;aiBusy=false;clearTimeout(timer);const teamWin=side==="lord",humanWin=teamWin&&players[0].alive,msg=teamWin?"主公阵营获胜":side==="spy"?"内奸获胜":"反贼获胜";log(msg);GameBridge.send("GAME_OVER",{message:msg,score:score+(humanWin?100:0),win:humanWin});render();}
function die(seat){const p=players[seat];if(!p.alive)return;p.alive=false;log((seat===0?"小乔":seat===lordSeat?"主公":"AI "+seat)+" 阵亡，身份："+roleText[p.role]);checkVictory();}
function nextAlive(seat){for(let i=1;i<=4;i++){const n=(seat+i)%4;if(players[n].alive)return n;}return seat;}
function startTurn(seat){if(over)return;current=seat;phase="play";usedKill=false;usedWine=false;players[seat].drunk=false;drawCards(seat,2);log(seat===0?"你的回合":seat===lordSeat?"主公的回合":"AI "+seat+" 的回合");render();if(seat!==0)scheduleAI();}
function endTurn(){if(paused||over||current!==0)return;selected=null;targetMode=false;startTurn(nextAlive(current));}
function aiProfile(level=difficulty){
 if(level==="easy")return{policy:"随机合法出牌",responseBase:.38,tacticalWeight:0};
 if(level==="hard")return{policy:"威胁评估与资源管理",responseBase:.88,tacticalWeight:1.35};
 return{policy:"局面评分与基础攻防",responseBase:.66,tacticalWeight:1};
}
function publicThreat(seat){
 const p=players[seat];if(!p)return 0;
 return (hostility[seat]||0)*3+(aggression[seat]||0)*.8+(p.maxHp-p.hp)*1.25;
}
function chooseTarget(seat){
 const self=players[seat];if(!self)return -1;
 const candidates=alive().filter(p=>p.seat!==seat);if(!candidates.length)return -1;
 if(self.role==="rebel"&&players[lordSeat]?.alive)return lordSeat;
 if(self.role==="spy"){
  return candidates.slice().sort((a,b)=>a.hp-b.hp||publicThreat(b.seat)-publicThreat(a.seat))[0].seat;
 }
 if(self.role==="loyalist"){
  const suspects=candidates.filter(p=>p.seat!==lordSeat&&((hostility[p.seat]||0)>0||(aggression[p.seat]||0)>0));
  if(!suspects.length)return -1;
  return suspects.sort((a,b)=>publicThreat(b.seat)-publicThreat(a.seat))[0].seat;
 }
 if(self.role==="lord"){
  const suspects=candidates.filter(p=>(hostility[p.seat]||0)>0||(aggression[p.seat]||0)>0);
  if(!suspects.length)return -1;
  return suspects.sort((a,b)=>publicThreat(b.seat)-publicThreat(a.seat))[0].seat;
 }
 return candidates.slice().sort((a,b)=>publicThreat(b.seat)-publicThreat(a.seat)||a.hp-b.hp)[0].seat;
}
function shouldAIRespond(target,kind,source){
 const card=findCard(target,kind);if(!card)return false;
 const p=players[target],profile=aiProfile();
 let chance=profile.responseBase;
 if(p.hp<=1)chance+=.12;
 else if(p.hp===2)chance+=.06;
 if(source>=0&&(hostility[source]||0)>0)chance+=.06;
 if(kind==="杀"&&p.role==="lord"&&p.hp<=2)chance+=.06;
 return Math.random()<Math.min(.98,chance);
}
function chooseAIAction(seat){
 const p=players[seat];if(!p?.alive)return null;
 const target=chooseTarget(seat),profile=aiProfile(),actions=[];
 const targetCard={type:"kill"};
 const valid=target>=0&&validTarget(seat,target,targetCard);
 const threat=valid?publicThreat(target):0;
 const add=(card,value,to=-1)=>{if(card)actions.push({card,target:to,value});};
 const injured=alive().filter(q=>q.hp<q.maxHp);
 for(const card of p.hand){
  if(card.type==="peach"&&p.hp<p.maxHp)add(card,25+(p.maxHp-p.hp)*8+(p.hp<=1?18:0));
  else if(card.type==="peachGarden"&&injured.length)add(card,8+injured.reduce((n,q)=>n+(q.maxHp-q.hp)*(q.seat===seat?2:1),0)*5);
  else if(card.type==="draw2")add(card,10+Math.max(0,5-p.hand.length)*2);
  else if(card.type==="wine"&&!usedWine&&!p.drunk&&p.hand.some(c=>c.type==="kill"&&!usedKill))add(card,7+(p.hp<=2?5:0)+(valid?3:0));
  else if(card.type==="kill"&&!usedKill&&valid)add(card,16+threat*profile.tacticalWeight+(p.drunk?8:0)+(players[target].hp<=1?8:0),target);
  else if(card.type==="duel"&&valid)add(card,9+threat*profile.tacticalWeight+(players[target].hand.length<=2?7:0)+(players[target].hp<=1?5:0),target);
  else if(card.type==="steal"&&valid&&players[target].hand.length)add(card,8+threat*.45+(players[target].hand.length<=2?5:0),target);
  else if(card.type==="dismantle"&&valid&&players[target].hand.length)add(card,7+threat*.5+(players[target].hand.length>=4?5:0),target);
  else if((card.type==="barbarian"||card.type==="arrows")&&alive().length>=3){
   const count=alive().filter(q=>q.seat!==seat).length;
   add(card,5+count*3+(profile.tacticalWeight>1?2:0));
  }
 }
 if(!actions.length)return null;
 if(difficulty==="easy")return actions[Math.floor(Math.random()*actions.length)];
 actions.sort((a,b)=>b.value-a.value||a.card.id-b.card.id);
 if(difficulty==="normal"&&actions.length>1&&Math.random()<.12)return actions[1];
 return actions[0];
}
players.seat=0;
function targetList(){return players.map((p,i)=>({...p,seat:i}));}
function completeAction(seat){if(seat===0){render();return;}aiBusy=false;render();scheduleAI();}
function runContinuation(state){
 if(!state)return;
 if(state.kind==="action"){completeAction(state.seat);return;}
 if(state.kind==="after-tianxiang"){const p=players[state.target];if(p?.alive){drawCards(state.target,Math.max(0,p.maxHp-p.hp));log("天香：目标摸牌");}runContinuation(state.done);return;}
 if(state.kind==="aoe-next"){continueAoe(state);return;}
}
function continueAoe(state){
 if(state.index>=state.targets.length){runContinuation(state.done);return;}
 const target=state.targets[state.index];
 requestResponse(target,state.response,state.seat,{kind:"aoe-response",seat:state.seat,response:state.response,targets:state.targets,index:state.index,target,done:state.done});
}
function resolveResponse(state,ok){
 if(!state)return;
 if(state.kind==="action"){runContinuation(state);return;}
 if(state.kind==="kill-response"){if(!ok)damage(state.target,state.amount,state.source,state.done);else runContinuation(state.done);return;}
 if(state.kind==="duel-response"){if(ok)requestResponse(state.opponent,"杀",state.responder,{kind:"duel-response",responder:state.opponent,opponent:state.responder,done:state.done});else damage(state.responder,1,state.opponent,state.done);return;}
 if(state.kind==="aoe-response"){const next={kind:"aoe-next",seat:state.seat,response:state.response,targets:state.targets,index:state.index+1,done:state.done};if(ok)continueAoe(next);else damage(state.target,1,state.seat,next);}
}
function finishDying(){
 if(!pendingSave)return;
 const continuation=pendingSave.continuation;pendingSave=null;runContinuation(continuation);render();
}
function advanceSave(){
 const state=pendingSave;if(!state||over)return;
 const target=players[state.target];
 if(!target?.alive){finishDying();return;}
 if(target.hp>0){finishDying();return;}
 if(state.cursor>=state.order.length){
  const seat=state.target,continuation=state.continuation;pendingSave=null;die(seat);runContinuation(continuation);render();return;
 }
 const seat=state.order[state.cursor++];
 if(!players[seat]?.alive){advanceSave();return;}
 if(seat===0){
  const peach=findCard(0,"桃"),wine=state.target===0?findCard(0,"酒"):null;
  if(peach||wine){state.responder=0;render();log(state.target===0?"你濒死：可以使用桃或酒自救":"角色濒死：你可以使用桃救援");return;}
  advanceSave();return;
 }
 const peach=findCard(seat,"桃"),wine=state.target===seat?findCard(seat,"酒"):null,card=peach||wine;
 if(card){
  removeCard(seat,card.id);discardPile.push(card);target.hp=Math.min(target.maxHp,target.hp+1);
  log((seat===lordSeat?"主公":"AI "+seat)+" 使用 "+card.name+" 救援");
  if(target.hp>0){finishDying();return;}
  state.cursor=0;advanceSave();return;
 }
 advanceSave();
}
function beginDying(target,continuation){
 const order=[];for(let offset=0;offset<players.length;offset++){const seat=(target+offset)%players.length;if(players[seat].alive)order.push(seat);}
 pendingSave={target,continuation,order,cursor:0,responder:null};advanceSave();
}
function saveWithCard(type){
 if(!pendingSave||pendingSave.responder!==0||paused)return;
 const state=pendingSave,card=findCard(0,type);
 if(!card||(type==="wine"&&state.target!==0))return;
 removeCard(0,card.id);discardPile.push(card);
 const target=players[state.target];target.hp=Math.min(target.maxHp,target.hp+1);
 log("你使用 "+card.name+" 救援");
 if(target.hp>0){finishDying();return;}
 state.responder=null;state.cursor=0;advanceSave();
}
function passSave(){
 if(!pendingSave||pendingSave.responder!==0||paused)return;
 pendingSave.responder=null;advanceSave();
}
function applyDamageNow(target,amount,source,continuation){
 const p=players[target];if(!p?.alive){runContinuation(continuation);return;}
 p.hp-=amount;
 if(source!==undefined&&source>=0&&source!==target){score+=target===lordSeat&&players[source].role==="rebel"?10:5;aggression[source]+=amount;if(target===lordSeat)hostility[source]+=amount;}
 log((target===0?"小乔":target===lordSeat?"主公":"AI "+target)+" 受到 "+amount+" 点伤害");
 if(p.hp<=0){beginDying(target,continuation);return;}
 runContinuation(continuation);render();
}
function damage(target,amount,source,continuation){if(target===0&&players[0].alive){const hearts=players[0].hand.filter(c=>heartCard(c,0));if(hearts.length){pendingTianxiang={amount,source,continuation,hearts,cardId:null};render();log("天香：可以转移伤害");return;}}applyDamageNow(target,amount,source,continuation);}
function resolveTianxiang(cardId,target){if(!pendingTianxiang||paused)return;const p=pendingTianxiang,card=removeCard(0,cardId);if(!card)return;pendingTianxiang=null;discardPile.push(card);applyDamageNow(target,p.amount,p.source,{kind:"after-tianxiang",target,done:p.continuation});render();}
function cancelTianxiang(){if(!pendingTianxiang||paused)return;const p=pendingTianxiang;pendingTianxiang=null;applyDamageNow(0,p.amount,p.source,p.continuation);render();}
// Response resolution reports whether a card was consumed; the effect caller owns damage.
function requestResponse(target,kind,source,continuation){
 const p=players[target],card=findCard(target,kind);
 if(!p?.alive){resolveResponse(continuation,false);return;}
 if(target===0){
  if(card){pendingResponse={target,kind,source,continuation,card:{...card}};document.getElementById("responseText").textContent="需要响应："+kind;render();}
  else resolveResponse(continuation,false);
  return;
 }
 const use=card&&shouldAIRespond(target,kind,source);
 if(use){removeCard(target,card.id);discardPile.push(card);log("AI "+target+" 使用 "+kind+" 响应");resolveResponse(continuation,true);}
 else resolveResponse(continuation,false);
}
function respondHuman(use){
 if(!pendingResponse||paused)return;
 const p=pendingResponse;pendingResponse=null;
 if(use){const card=removeCard(0,p.card.id);if(!card||card.name!==p.kind){resolveResponse(p.continuation,false);render();return;}discardPile.push(card);log("你使用 "+p.kind+" 响应");resolveResponse(p.continuation,true);}
 else resolveResponse(p.continuation,false);
 render();
}
function heal(seat,n){const p=players[seat];if(!p.alive)return;const old=p.hp;p.hp=Math.min(p.maxHp,p.hp+n);if(p.hp>old)log((seat===0?"小乔":seat===lordSeat?"主公":"AI "+seat)+" 回复体力");}
function randomCard(seat){const h=players[seat].hand;if(!h.length)return null;return h[Math.floor(Math.random()*h.length)];}
function discardRandom(seat){const c=randomCard(seat);if(c){removeCard(seat,c.id);discardPile.push(c);}}
function resolveCard(seat,card,target,continuation){const p=players[seat];if(!p.alive){runContinuation(continuation);return;}if(card.type==="kill"){if(usedKill&&seat===current){log("本回合已经使用过杀");runContinuation(continuation);return;}if(seat===current)usedKill=true;const amount=1+(p.drunk?1:0);p.drunk=false;requestResponse(target,"闪",seat,{kind:"kill-response",target,amount,source:seat,done:continuation});}
 else if(card.type==="duel"){requestResponse(target,"杀",seat,{kind:"duel-response",responder:target,opponent:seat,done:continuation});}
 else if(card.type==="dismantle"){discardRandom(target);log("拆除目标一张手牌");runContinuation(continuation);}
 else if(card.type==="steal"){const c=randomCard(target);if(c){removeCard(target,c.id);p.hand.push(c);log("获得目标一张手牌");}runContinuation(continuation);}
 else if(card.type==="draw2"){drawCards(seat,2);log("无中生有：摸两张牌");runContinuation(continuation);}
 else if(card.type==="peach"){heal(seat,1);runContinuation(continuation);}
 else if(card.type==="wine"){usedWine=true;p.drunk=true;log("酒：下一张杀伤害 +1");runContinuation(continuation);}
 else if(card.type==="peachGarden"){players.forEach((q,i)=>{if(q.alive)heal(i,1);});runContinuation(continuation);}
 else if(card.type==="barbarian"||card.type==="arrows"){const response=card.type==="barbarian"?"杀":"闪",targets=alive().map(q=>q.seat).filter(i=>i!==seat);continueAoe({kind:"aoe-next",seat,response,targets,index:0,done:continuation});}
 render();}
function playHuman(){if(paused||over||current!==0||phase!=="play"||!cardPlayable(0,selected))return;const c=removeCard(0,selected.id);if(!c)return;discardPile.push(c);const card=c;selected=null;targetMode=false;render();resolveCard(0,card,-1,{kind:"action",seat:0});}
function useOnTarget(target){if(paused||over||current!==0||!selected||!targetMode||!cardPlayable(0,selected)||!validTarget(0,target,selected))return;const card=removeCard(0,selected.id);if(!card)return;discardPile.push(card);selected=null;targetMode=false;render();resolveCard(0,card,target,{kind:"action",seat:0});}
function chooseAIAction(seat){const p=players[seat],target=chooseTarget(seat),hand=p.hand;const peach=hand.find(c=>c.name==="桃"),draw2=hand.find(c=>c.type==="draw2"),garden=hand.find(c=>c.type==="peachGarden"),wine=hand.find(c=>c.type==="wine"),kill=hand.find(c=>c.type==="kill"),duel=hand.find(c=>c.type==="duel"),dismantle=hand.find(c=>c.type==="dismantle"),steal=hand.find(c=>c.type==="steal"),aoe=hand.find(c=>c.type==="barbarian"||c.type==="arrows");
 if(peach&&p.hp<p.maxHp)return {card:peach,target:seat};if(garden&&alive().some(q=>q.hp<q.maxHp))return {card:garden,target:-1};if(draw2&&hand.length<7)return {card:draw2,target:-1};if(wine&&kill&&!p.drunk&&!usedWine&&p.hp<=2)return {card:wine,target:-1};if(dismantle&&players[target].hand.length>0)return {card:dismantle,target};if(steal&&players[target].hand.length>0)return {card:steal,target};if(duel&&difficulty!=="easy")return {card:duel,target};if(kill&&!usedKill)return {card:kill,target};if(aoe&&alive().length>=3&&difficulty!=="easy")return {card:aoe,target:-1};return null;}
function aiStep(){if(paused||over||current===0||aiBusy)return;aiBusy=true;const action=chooseAIAction(current);if(!action){aiBusy=false;startTurn(nextAlive(current));return;}const card=removeCard(current,action.card.id);if(!card){aiBusy=false;return;}discardPile.push(card);const seat=current;resolveCard(seat,card,action.target,{kind:"action",seat});}
function scheduleAI(){clearTimeout(timer);if(paused||over||current===0||aiBusy||pendingResponse||pendingTianxiang||pendingSave)return;timer=setTimeout(aiStep,difficulty==="easy"?350:difficulty==="hard"?650:500);}
function newGame(){clearTimeout(timer);discardPile=[];deck=makeDeck();hostility=[0,0,0,0];aggression=[0,0,0,0];players=[{seat:0,name:"小乔",character:"小乔",role:"loyalist",hp:3,maxHp:3,alive:true,hand:[]},{seat:1,name:"主公",character:"曹操",role:"lord",hp:4,maxHp:4,alive:true,hand:[]},{seat:2,name:"AI 2",character:"反贼",role:"rebel",hp:4,maxHp:4,alive:true,hand:[]},{seat:3,name:"AI 3",character:"内奸",role:"spy",hp:3,maxHp:3,alive:true,hand:[]}];hostility=[0,0,0,0];aggression=[0,0,0,0];score=0;selected=null;targetMode=false;pendingResponse=null;pendingTianxiang=null;pendingSave=null;current=0;phase="play";usedKill=false;usedWine=false;paused=false;over=false;aiBusy=false;players.forEach(p=>{for(let i=0;i<4;i++)p.hand.push(deck.pop());});logEl.replaceChildren();startTurn(0);}
document.getElementById("useCard").onclick=playHuman;document.getElementById("endTurn").onclick=endTurn;document.getElementById("cancelCard").onclick=()=>{selected=null;targetMode=false;render();};document.getElementById("respondYes").onclick=()=>respondHuman(true);document.getElementById("respondNo").onclick=()=>respondHuman(false);document.getElementById("tianxiangCancel").onclick=cancelTianxiang;document.getElementById("savePeach").onclick=()=>saveWithCard("桃");document.getElementById("saveWine").onclick=()=>saveWithCard("酒");document.getElementById("saveNo").onclick=passSave;
document.getElementById("players").addEventListener("click",e=>{const b=e.target.closest("[data-seat]");if(b)useOnTarget(Number(b.dataset.seat));});
document.getElementById("targetPanel").addEventListener("click",e=>{const b=e.target.closest("[data-target]");if(b)useOnTarget(Number(b.dataset.target));});
document.getElementById("tianxiangCards").addEventListener("click",e=>{const b=e.target.closest("[data-card]");if(!b||!pendingTianxiang)return;const id=Number(b.dataset.card);pendingTianxiang.cardId=id;document.getElementById("tianxiangTargets").innerHTML=players.map((p,i)=>p.alive&&i!==0?'<button class="game-btn" data-target="'+i+'">'+(i===lordSeat?"主公":"AI "+i)+'</button>':"").join("");});
document.getElementById("tianxiangTargets").addEventListener("click",e=>{const b=e.target.closest("[data-target]");if(!b||pendingTianxiang?.cardId==null)return;resolveTianxiang(pendingTianxiang.cardId,Number(b.dataset.target));});
if(new URLSearchParams(location.search).has("p111Test")){
 newGame();
  window.__p111SanguoshaTest={
  addCard(seat,type,suit="heart",forcedId=null){
   const def=defs.find(d=>d[1]===type);if(!def)throw Error("Unknown card type");
   const id=forcedId??(Math.max(-1,...players.flatMap(p=>p.hand.map(c=>c.id)),...discardPile.map(c=>c.id))+1);
   const card={id,name:def[0],type,suit,rank:7};players[seat].hand.push(card);render();return id;
  },
  clearHand(seat){players[seat].hand=[];render();},
  setHp(seat,hp){players[seat].hp=hp;players[seat].alive=true;render();},
  setTurn(seat=0){current=seat;phase="play";usedKill=false;usedWine=false;selected=null;targetMode=false;pendingResponse=null;pendingSave=null;pendingTianxiang=null;render();},
  canPlay(type,seat=0){const d=defs.find(x=>x[1]===type);return !!d&&cardPlayable(seat,{id:-1,name:d[0],type,suit:"heart",rank:7});},
  play(type,target=1){
   const d=defs.find(x=>x[1]===type),card=d&&findCard(0,d[0]);if(!card)return false;
   selected=card;targetMode=["kill","duel","dismantle","steal"].includes(type);
   if(targetMode)useOnTarget(target);else playHuman();return true;
  },
  setDifficulty(v){difficulty=v;},
  aiProfile(v){return aiProfile(v);},
  aiTarget(seat){return chooseTarget(seat);},
  aiPlan(seat){const a=chooseAIAction(seat);return a?{type:a.card.type,target:a.target}:null;},
  newGame(){newGame();},
  setRole(seat,role){players[seat].role=role;},
  setPublicSignals(seat,hostile,aggressive){hostility[seat]=hostile;aggression[seat]=aggressive;},
  flags(){return{usedKill,usedWine,current,phase};},
  damage(target,amount,source=-1){damage(target,amount,source,null);render();},
  response(target,kind,source=1){requestResponse(target,kind,source,{kind:"action",seat:0});render();},
  save(type){saveWithCard(type);},
  passSave,
  state(){return{players:players.map(p=>({hp:p.hp,maxHp:p.maxHp,alive:p.alive,hand:p.hand.map(c=>({id:c.id,type:c.type,name:c.name,suit:c.suit}))})),
   pendingSave:pendingSave?{target:pendingSave.target,responder:pendingSave.responder,cursor:pendingSave.cursor}:null,
   pendingResponse:!!pendingResponse,pendingTianxiang:!!pendingTianxiang,over};}
 };
}
GameBridge.register({init(p){difficulty=p.difficulty||"normal";newGame();},newGame,pause(){paused=true;clearTimeout(timer);report("已暂停");render();},resume(){paused=false;render();if(pendingSave){if(pendingSave.responder!==0)advanceSave();return;}if(pendingTianxiang||pendingResponse)return;report(current===0?"你的回合":"AI "+current+" 的回合");scheduleAI();},setDifficulty(v){difficulty=v||"normal";},
 snapshot(){const copy=v=>JSON.parse(JSON.stringify(v));return{players:copy(players),deck:copy(deck),discardPile:copy(discardPile),current,phase,selectedId:selected?.id??null,targetMode,usedKill,usedWine,difficulty,score,hostility:hostility.slice(),aggression:aggression.slice(),pendingResponse:pendingResponse?{target:pendingResponse.target,kind:pendingResponse.kind,source:pendingResponse.source,card:{...pendingResponse.card},continuation:copy(pendingResponse.continuation)}:null,pendingTianxiang:pendingTianxiang?{amount:pendingTianxiang.amount,source:pendingTianxiang.source,hearts:pendingTianxiang.hearts.map(c=>({...c})),cardId:pendingTianxiang.cardId,continuation:copy(pendingTianxiang.continuation)}:null,pendingSave:pendingSave?{target:pendingSave.target,order:pendingSave.order.slice(),cursor:pendingSave.cursor,responder:pendingSave.responder,continuation:copy(pendingSave.continuation)}:null,aiBusy,log:[...logEl.children].map(n=>n.textContent)};},
 restore(s){
  if(!s||!Array.isArray(s.players)||s.players.length!==4||!Array.isArray(s.deck)||!Array.isArray(s.discardPile))throw new Error("三国杀存档数据无效");
  clearTimeout(timer);players=JSON.parse(JSON.stringify(s.players));deck=JSON.parse(JSON.stringify(s.deck));discardPile=JSON.parse(JSON.stringify(s.discardPile));
  if(players.some((p,i)=>p.seat!==i||!Array.isArray(p.hand)))throw new Error("三国杀角色数据无效");
  current=Number.isInteger(Number(s.current))?Math.max(0,Math.min(3,Number(s.current))):0;phase="play";selected=s.selectedId==null?null:players[0].hand.find(c=>c.id===s.selectedId)||null;
  targetMode=!!s.targetMode;usedKill=!!s.usedKill;usedWine=!!s.usedWine;difficulty=["easy","normal","hard"].includes(s.difficulty)?s.difficulty:"normal";score=Math.max(0,Number(s.score)||0);
  hostility=Array.isArray(s.hostility)?s.hostility.slice(0,4):[0,0,0,0];aggression=Array.isArray(s.aggression)?s.aggression.slice(0,4):[0,0,0,0];
  const validContinuation=c=>!c||typeof c==="object"&&["action","kill-response","duel-response","aoe-response","aoe-next","after-tianxiang"].includes(c.kind);
  if(s.pendingResponse){if(!validContinuation(s.pendingResponse.continuation))throw new Error("三国杀响应状态无效");const card=players[0].hand.find(c=>c.id===s.pendingResponse.card?.id);if(!card)throw new Error("三国杀响应手牌已不存在");pendingResponse={...s.pendingResponse,card};}else pendingResponse=null;
  if(s.pendingTianxiang){if(!validContinuation(s.pendingTianxiang.continuation))throw new Error("三国杀天香状态无效");pendingTianxiang={...s.pendingTianxiang,hearts:(s.pendingTianxiang.hearts||[]).map(c=>({...c})),cardId:s.pendingTianxiang.cardId??null,continuation:s.pendingTianxiang.continuation};}else pendingTianxiang=null;
  if(s.pendingSave){if(!validContinuation(s.pendingSave.continuation))throw new Error("三国杀濒死状态无效");pendingSave={...s.pendingSave,order:s.pendingSave.order.slice(),continuation:s.pendingSave.continuation};}else pendingSave=null;
  aiBusy=!!s.aiBusy;over=false;paused=true;logEl.replaceChildren();(s.log||[]).slice(0,5).forEach(t=>{const row=document.createElement("div");row.textContent=String(t);logEl.append(row);});
  render();report("已恢复上次进度");
 },
 dispose(){paused=true;clearTimeout(timer);}});
})();