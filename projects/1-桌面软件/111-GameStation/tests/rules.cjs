/* P111 R17 - deterministic rules fixtures. All files are opened via file:// */
const assert=require("node:assert/strict");
const path=require("node:path"),{pathToFileURL}=require("node:url");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:["--no-sandbox","--disable-dev-shm-usage","--allow-file-access-from-files"]});
 const page=await browser.newPage({viewport:{width:1200,height:900}});
 const errors=[];page.on("pageerror",err=>errors.push(err.message));
 try{
  const src=pathToFileURL(path.resolve(__dirname,"../app/games/chess/index.html")).href+"?p111Test=1";
  await page.goto(src);
  await page.waitForFunction(()=>typeof window.__p111ChessTest?.loadFen==="function");
  const fen=async f=>page.evaluate(value=>window.__p111ChessTest.loadFen(value),f);
  const move=async(from,to)=>{
   await page.locator('[data-square="'+from+'"]').click();
   await page.locator('[data-square="'+to+'"]').click();
  };
  const piece=async sq=>page.locator('[data-square="'+sq+'"] .chess-piece').innerText().catch(()=>"");
  const st=()=>page.evaluate(()=>window.__p111ChessTest.state());
  // Both castle directions reposition king AND rook, without creating a new piece.
  await fen("4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1");
  await move("e1","g1");
  assert.equal(await piece("g1"),"♔");assert.equal(await piece("f1"),"♖");
  assert.equal(await piece("e1"),"");assert.equal(await piece("h1"),"");
  await fen("4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1");
  await move("e1","c1");
  assert.equal(await piece("c1"),"♔");assert.equal(await piece("d1"),"♖");
  assert.equal(await piece("a1"),"");
  // Illegal castle through an attacked transit square.
  await fen("4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1");
  await move("e1","g1");
  assert.equal(await piece("e1"),"♔","King must not castle across attacked f1");
  // En passant is a capture from an empty destination and removes d5 pawn.
  await fen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
  await move("e5","d6");
  assert.equal(await piece("d6"),"♙");assert.equal(await piece("d5"),"");
  // Promotion explicitly offers four legal piece choices instead of auto-queen.
  await fen("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
  await move("a7","a8");
  assert.equal(await page.locator("#promotionChooser [data-promotion]").count(),4);
  await page.locator('#promotionChooser [data-promotion="N"]').click();
  assert.equal(await piece("a8"),"♘");
  assert.match(await page.locator("#moveList").innerText(),/=N/);
  // Both checkmate and stalemate, distinct outcomes.
  await fen("7k/6Q1/5K2/8/8/8/8/8 b - - 0 1");
  assert.equal(await page.evaluate(()=>window.__p111ChessTest.checkEnd()),true);
  assert.match(await page.locator("#turnText").innerText(),/白方将死获胜/);
  await fen("7k/5K2/6Q1/8/8/8/8/8 b - - 0 1");
  assert.equal(await page.evaluate(()=>window.__p111ChessTest.checkEnd()),true);
  assert.match(await page.locator("#turnText").innerText(),/逼和/);
  await fen("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
  assert.equal(await page.evaluate(()=>window.__p111ChessTest.checkEnd()),true);
  assert.match(await page.locator("#turnText").innerText(),/子力不足/);
  // Claims: 50-move rule or third position; automatic 75/fivefold rules.
  await fen("4k3/8/8/8/8/8/8/4K2R w K - 100 61");
  assert.equal(await page.locator("#drawClaimButton").isEnabled(),true);
  await page.locator("#gs-tools").click();await page.locator("#drawClaimButton").click();
  assert.match(await page.locator("#turnText").innerText(),/50 回合规则/);
  await fen("4k3/8/8/8/8/8/8/4K2R w K - 150 76");
  assert.equal(await page.evaluate(()=>window.__p111ChessTest.checkEnd()),true);
  assert.match(await page.locator("#turnText").innerText(),/75 回合规则/);
  await fen("4k1n1/8/8/8/8/8/8/4K1N1 w - - 0 1");
  for(let i=0;i<2;i++){
   await move("g1","f3");await move("g8","f6");
   await move("f3","g1");await move("f6","g8");
  }
  assert.equal((await st()).repetitions,3);
  assert.equal(await page.locator("#drawClaimButton").isEnabled(),true);
  await page.locator("#drawClaimButton").click();
  assert.match(await page.locator("#turnText").innerText(),/三次重复/);
  const xiangqi=await browser.newPage({viewport:{width:1100,height:850}});
  xiangqi.on("pageerror",err=>errors.push("Xiangqi: "+err.message));
  await xiangqi.goto(pathToFileURL(path.resolve(__dirname,"../app/games/xiangqi/index.html")).href+"?p111Test=1");
  await xiangqi.waitForFunction(()=>typeof window.__p111XiangqiTest?.loadPosition==="function");
  const load=(pieces,side="red")=>xiangqi.evaluate(([p,s])=>window.__p111XiangqiTest.loadPosition(p,s),[pieces,side]);
  const getMoves=(side="red")=>xiangqi.evaluate(s=>window.__p111XiangqiTest.legal(s),side);
  const base=[[4,0,"black","将"],[4,9,"red","帅"],[4,6,"red","兵"]];
  // The horse may not jump over an occupied straight-leg square.
  await load([...base,[4,7,"red","马"]]);
  const h=await getMoves();
  assert.equal(h.some(m=>m.fx===4&&m.fy===7&&m.tx===5&&m.ty===5),false,"horse must not jump over the leg at (4,6)");
  assert.equal(h.some(m=>m.fx===4&&m.fy===7&&m.tx===6&&m.ty===6),true,"unblocked horse jump remains legal");
  // Cannon captures only with exactly one screen.
  await load([...base,[0,7,"red","炮"],[0,5,"red","兵"],[0,2,"black","车"]]);
  const cannon=await getMoves();
  assert.equal(cannon.some(m=>m.fx===0&&m.fy===7&&m.tx===0&&m.ty===2),true,"screen permits cannon capture");
  await load([...base,[0,7,"red","炮"],[0,2,"black","车"]]);
  const noScreen=await getMoves();
  assert.equal(noScreen.some(m=>m.fx===0&&m.fy===7&&m.tx===0&&m.ty===2),false,"screenless cannon capture must be illegal");
  // Opposing generals on an empty shared file are mutually checking.
  await load([[4,0,"black","将"],[4,9,"red","帅"]]);
  assert.equal(await xiangqi.evaluate(()=>window.__p111XiangqiTest.faces()),true);
  assert.equal(await xiangqi.evaluate(()=>window.__p111XiangqiTest.check("red")),true);
  // Xiangqi no-move position is a loss (困毙), not a western-chess stalemate draw.
  await load([...base,[3,1,"red","车"],[5,1,"red","车"]],"black");
  assert.equal(await xiangqi.evaluate(()=>window.__p111XiangqiTest.check("black")),false);
  assert.equal((await getMoves("black")).length,0);
  assert.equal(await xiangqi.evaluate(()=>window.__p111XiangqiTest.terminal()),true);
  assert.match(await xiangqi.locator("#turnText").innerText(),/红方获胜.*困毙/);
  // Moving the cannon screen away must not leave a second capture available.
  await load([...base,[0,7,"red","炮"],[0,5,"red","兵"],[0,3,"black","卒"],[0,2,"black","车"]]);
  const twoScreens=await xiangqi.evaluate(()=>window.__p111XiangqiTest.pseudo());
  assert.equal(twoScreens.some(m=>m.fx===0&&m.fy===7&&m.tx===0&&m.ty===2),false,
   "cannon may capture only the first enemy piece after exactly one screen");
  // A rook blocks the generals; a sideways move exposes the file and must be rejected,
  // while moving along the same file keeps the blocker in place and remains legal.
  await load([[4,0,"black","将"],[4,9,"red","帅"],[4,5,"red","车"]]);
  assert.equal(await xiangqi.evaluate(()=>window.__p111XiangqiTest.faces()),false);
  const blockerMoves=await getMoves();
  assert.equal(blockerMoves.some(m=>m.fx===4&&m.fy===5&&m.tx===3&&m.ty===5),false,
   "moving the blocker sideways exposes the generals and is illegal");
  assert.equal(blockerMoves.some(m=>m.fx===4&&m.fy===5&&m.tx===4&&m.ty===4),true,
   "moving the blocker along the shared file keeps the generals separated");
  // Xiangqi threefold cycle: the side that continuously checks loses; neutral repetition draws.
  await load([[4,0,"black","将"],[3,9,"red","帅"],[4,2,"red","车"]],"black");
  assert.equal(await xiangqi.evaluate(()=>window.__p111XiangqiTest.check("black")),true);
  await xiangqi.evaluate(()=>window.__p111XiangqiTest.seedRepetition({redChecks:true,blackChecks:false}));
  assert.equal(await xiangqi.evaluate(()=>window.__p111XiangqiTest.terminal()),true);
  assert.match(await xiangqi.locator("#turnText").innerText(),/红方长将判负/);
  await load([[4,0,"black","将"],[3,9,"red","帅"],[4,2,"red","车"]],"black");
  await xiangqi.evaluate(()=>window.__p111XiangqiTest.seedRepetition({redChecks:false,blackChecks:false}));
  assert.equal(await xiangqi.evaluate(()=>window.__p111XiangqiTest.terminal()),true);
  assert.match(await xiangqi.locator("#turnText").innerText(),/循环局面和棋/);
  const sg=await browser.newPage({viewport:{width:1100,height:850}});
  sg.on("pageerror",err=>errors.push("Sanguosha: "+err.message));
  await sg.goto(pathToFileURL(path.resolve(__dirname,"../app/games/sanguosha/index.html")).href+"?p111Test=1");
  await sg.waitForFunction(()=>typeof window.__p111SanguoshaTest?.addCard==="function");
  const api=()=>sg.evaluate(()=>window.__p111SanguoshaTest.state());
  const call=(name,...args)=>sg.evaluate(([n,a])=>window.__p111SanguoshaTest[n](...a),[name,args]);
  for(let i=0;i<4;i++)await call("clearHand",i);
  await call("setTurn",0);
  await call("addCard",0,"dodge","club");
  assert.equal(await call("canPlay","dodge"),false,"闪 must not be an active-play card");
  await call("setHp",0,3);await call("addCard",0,"peach","heart");
  assert.equal(await call("canPlay","peach"),false,"桃 cannot be wasted at full HP");
  await call("setHp",0,2);
  assert.equal(await call("canPlay","peach"),true,"桃 is legal when wounded");
  // 酒 is once per active turn; it is not consumed as a dying-save quota.
  await call("clearHand",0);await call("addCard",0,"wine","diamond");await call("addCard",0,"wine","club");
  await call("setTurn",0);assert.equal(await call("canPlay","wine"),true);
  await call("play","wine");await sg.waitForTimeout(40);
  assert.equal((await call("flags")).usedWine,true);
  assert.equal(await call("canPlay","wine"),false,"second active 酒 is forbidden in the same turn");
  // 杀 is once per turn and must have a living target.
  await call("clearHand",0);await call("clearHand",1);await call("addCard",0,"kill","spade");await call("addCard",0,"kill","heart");
  await call("setTurn",0);await call("setDifficulty","hard");
  assert.equal(await call("canPlay","kill"),true);
  await call("play","kill",1);await sg.waitForTimeout(50);
  assert.equal((await call("flags")).usedKill,true);
  assert.equal(await call("canPlay","kill"),false,"second 杀 is forbidden in the same turn");
  // A response-only 闪 is consumed only after an explicit incoming response request.
  for(let i=0;i<4;i++)await call("clearHand",i);
  await call("addCard",0,"dodge","club");await call("setTurn",0);await call("response",0,"闪",1);
  await sg.locator("#responseBar").waitFor({state:"visible"});
  await sg.locator("#respondYes").click();await sg.waitForTimeout(30);
  assert.equal((await api()).players[0].hand.some(c=>c.type==="dodge"),false,"responded 闪 is discarded");
  // Player may use 酒 to save herself while dying, even after the active-use stage is over.
  for(let i=0;i<4;i++)await call("clearHand",i);
  await call("addCard",0,"wine","diamond");await call("setHp",0,3);await call("damage",0,3,-1);
  await sg.locator("#savePanel").waitFor({state:"visible"});
  assert.equal((await api()).pendingSave.target,0);
  await sg.locator("#saveWine").click();await sg.waitForTimeout(30);
  assert.equal((await api()).players[0].hp,1,"dying 酒 restores one HP");
  assert.equal((await api()).players[0].alive,true);
  // 桃 may save another dying character; the rescue window passes through the living seats.
  for(let i=0;i<4;i++)await call("clearHand",i);
  await call("addCard",0,"peach","heart");await call("setHp",2,2);await call("damage",2,2,1);
  await sg.locator("#savePanel").waitFor({state:"visible"});
  assert.equal((await api()).pendingSave.target,2);
  await sg.locator("#savePeach").click();await sg.waitForTimeout(30);
  assert.equal((await api()).players[2].hp,1);
  assert.equal((await api()).players[2].alive,true);
  // AI may use 酒 only to save itself when dying.
  for(let i=0;i<4;i++)await call("clearHand",i);
  await call("addCard",1,"wine","club");await call("setHp",1,2);await call("damage",1,2,2);
  await sg.waitForTimeout(30);
  assert.equal((await api()).players[1].hp,1,"AI self-rescue with 酒");
  assert.equal((await api()).players[1].alive,true);
  // 小乔's 红颜 turns spades into hearts for 天香; target starts at 3/4 HP, takes 1 damage, then draws 2 cards for 2 lost HP.
  for(let i=0;i<4;i++)await call("clearHand",i);
  await call("addCard",0,"kill","spade");await call("setHp",0,3);await call("setHp",2,3);
  const targetHandBefore=(await api()).players[2].hand.length;
  await call("damage",0,1,-1);
  await sg.locator("#tianxiangPanel").waitFor({state:"visible"});
  await sg.locator("#tianxiangCards [data-card]").click();
  await sg.locator('#tianxiangTargets [data-target="2"]').click();await sg.waitForTimeout(40);
  const skillState=await api();
  assert.equal(skillState.players[0].hp,3,"天香 prevents damage to 小乔");
  assert.equal(skillState.players[2].hp,2,"天香 transfers the damage");
  assert.equal(skillState.players[2].hand.length,targetHandBefore+2,"天香 target draws two cards for 4 max HP minus 2 remaining HP");
  // Card ID 0 is valid; Tianxiang must not treat it as absence of a selection.
  for(let i=0;i<4;i++)await call("clearHand",i);
  await call("setHp",0,3);await call("setHp",2,4);await call("addCard",0,"kill","spade",0);
  await call("damage",0,1,-1);
  await sg.locator("#tianxiangPanel").waitFor({state:"visible"});
  await sg.locator('#tianxiangCards [data-card="0"]').click();
  await sg.locator('#tianxiangTargets [data-target="2"]').click();
  assert.equal((await api()).players[2].hp,3,"天香 accepts selected card ID zero and transfers its damage");
  await sg.close();
  const ddz=await browser.newPage({viewport:{width:1100,height:850}});
  ddz.on("pageerror",err=>errors.push("Dou Dizhu: "+err.message));
  await ddz.goto(pathToFileURL(path.resolve(__dirname,"../app/games/doudizhu/index.html")).href);
  await ddz.waitForFunction(()=>!!window.DDZRules);
  const classify=ranks=>ddz.evaluate(rs=>{
   const ids=[],used={};for(const r of rs){const n=used[r]||0;used[r]=n+1;ids.push(r<13?r*4+n:r===13?52:53);}
   return window.DDZRules.classify(ids);
  },ranks);
  const type=async(ranks,name)=>assert.equal((await classify(ranks))?.type,await ddz.evaluate(n=>window.DDZRules.TYPE[n],name),name+" classifier");
  await type([0],"SOLO");await type([0,0],"PAIR");await type([0,0,0],"TRIO");
  await type([0,0,0,1],"TRIO_SOLO");await type([0,0,0,1,1],"TRIO_PAIR");
  await type([0,1,2,3,4],"STRAIGHT");await type([0,0,1,1,2,2],"PAIR_STRAIGHT");
  await type([0,0,0,1,1,1],"PLANE");
  await type([0,0,0,1,1,1,2,3],"PLANE_SOLO");
  await type([0,0,0,1,1,1,2,2,3,3],"PLANE_PAIR");
  await type([0,0,0,0,1,2],"FOUR_SOLO");
  await type([0,0,0,0,1,1,2,2],"FOUR_PAIR");
  await type([3,3,3,3],"BOMB");await type([13,14],"ROCKET");
  assert.equal(await classify([8,9,10,11,12]),null,"2 cannot enter a straight");
  assert.equal(await classify([0,0]),null,"same physical card ID cannot be repeated");
  assert.equal(await classify([54]),null,"card IDs outside the 54-card deck are invalid");
  const beats=async(a,b)=>ddz.evaluate(([x,y])=>{
   const R=window.DDZRules;const ids=ranks=>{const used={};return ranks.map(r=>{const n=used[r]||0;used[r]=n+1;return r<13?r*4+n:r===13?52:53;});};
   return R.beats(R.classify(ids(x)),R.classify(ids(y)));
  },[a,b]);
  assert.equal(await beats([5],[4]),true);
  assert.equal(await beats([0,0],[5]),false);
  assert.equal(await beats([0,0,0,0],[7,8,9,10,11]),true);
  assert.equal(await beats([1,1,1,1],[0,0,0,0]),true);
  assert.equal(await beats([13,14],[1,1,1,1]),true);
  assert.equal(await beats([1,1,1,1],[13,14]),false);
  await ddz.evaluate(()=>{const R=window.DDZRules;window.__p111DDZGame=R.createGame(20261105);R.deal(window.__p111DDZGame);});
  const readGame=()=>ddz.evaluate(()=>{const g=window.__p111DDZGame;return {phase:g.phase,hands:g.hands.map(h=>h.length),bottom:g.bottom.length,bidTurn:g.bidTurn,landlord:g.landlord,turn:g.turn,lastPlay:g.lastPlay,passCount:g.passCount,multiplier:g.multiplier,over:g.over};});
  let gs=await readGame();
  assert.equal(gs.phase,"bidding");assert.deepEqual(gs.hands,[17,17,17]);assert.equal(gs.bottom,3);
  const deckCount=await ddz.evaluate(()=>{const g=window.__p111DDZGame;return new Set([...g.hands.flat(),...g.bottom]).size;});
  assert.equal(deckCount,54,"all 54 physical cards are dealt once");
  const first=gs.bidTurn,wrong=(first+1)%3;
  assert.equal((await ddz.evaluate(([seat])=>window.DDZRules.nextBid(window.__p111DDZGame,seat,1),[wrong])).legal,false);
  assert.equal((await ddz.evaluate(([seat])=>window.DDZRules.nextBid(window.__p111DDZGame,seat,1),[first])).legal,true);
  gs=await readGame();const second=gs.bidTurn;
  assert.equal((await ddz.evaluate(([seat])=>window.DDZRules.nextBid(window.__p111DDZGame,seat,1),[second])).legal,false);
  assert.equal((await ddz.evaluate(([seat])=>window.DDZRules.nextBid(window.__p111DDZGame,seat,0),[second])).legal,true);
  gs=await readGame();
  const finalBid=await ddz.evaluate(([seat])=>window.DDZRules.nextBid(window.__p111DDZGame,seat,0),[gs.bidTurn]);
  assert.equal(finalBid.done,true);gs=await readGame();assert.equal(gs.landlord,first);
  assert.equal(await ddz.evaluate(()=>window.DDZRules.startPlay(window.__p111DDZGame)),true);
  gs=await readGame();assert.equal(gs.phase,"playing");assert.equal(gs.turn,first);assert.equal(gs.hands[first],20);
  assert.equal((await ddz.evaluate(([seat])=>window.DDZRules.pass(window.__p111DDZGame,seat),[first])).legal,false);
  const lead=await ddz.evaluate(seat=>window.__p111DDZGame.hands[seat][0],first);
  assert.equal((await ddz.evaluate(([seat,card])=>window.DDZRules.play(window.__p111DDZGame,seat,[card,card]),[first,lead])).legal,false);
  assert.equal((await ddz.evaluate(([seat])=>window.DDZRules.play(window.__p111DDZGame,seat,[999]),[first])).legal,false);
  assert.equal((await ddz.evaluate(([seat,card])=>window.DDZRules.play(window.__p111DDZGame,seat,[card]),[first,lead])).legal,true);
  gs=await readGame();const pass1=gs.turn;
  assert.equal((await ddz.evaluate(([seat])=>window.DDZRules.pass(window.__p111DDZGame,seat),[pass1])).legal,true);
  gs=await readGame();
  assert.equal((await ddz.evaluate(([seat])=>window.DDZRules.pass(window.__p111DDZGame,seat),[gs.turn])).legal,true);
  gs=await readGame();assert.equal(gs.turn,first);assert.equal(gs.lastPlay,null);assert.equal(gs.passCount,0);
  const context=await ddz.evaluate(seat=>window.DDZRules.aiContext(window.__p111DDZGame,seat),(first+1)%3);
  assert.equal(Object.hasOwn(context,"hands"),false,"AI context must not reveal hidden hands");
  assert.equal(Object.hasOwn(context,"hand"),false,"AI context contains no other player's cards");
  const redeal=await ddz.evaluate(()=>{
   const R=window.DDZRules,g=R.createGame(991);R.deal(g);let r;
   for(let i=0;i<3;i++)r=R.nextBid(g,g.bidTurn,0);
   return {result:r,phase:g.phase,landlord:g.landlord};
  });
  assert.equal(redeal.result.redeal,true);assert.equal(redeal.phase,"bidding");assert.equal(redeal.landlord,-1);
  const settlement=await ddz.evaluate(()=>{
   const R=window.DDZRules,g=R.createGame(17);R.deal(g);g.phase="playing";g.landlord=0;g.turn=0;g.highestBid=3;g.multiplier=3;
   g.hands=[[0],[1],[2]];g.lastPlay=null;
   const result=R.play(g,0,[0]);return {result,win:g.landlordWin,multiplier:g.multiplier,scores:R.settle(g)};
  });
  assert.equal(settlement.result.over,true);assert.equal(settlement.win,true);
  assert.equal(settlement.multiplier,6,"spring doubles multiplier");assert.equal(settlement.scores.reduce((a,b)=>a+b,0),0);
  const mj=await browser.newPage({viewport:{width:1100,height:850}});
  mj.on("pageerror",err=>errors.push("Mahjong: "+err.message));
  await mj.goto(pathToFileURL(path.resolve(__dirname,"../app/games/mahjong/index.html")).href+"?p111Test=1");
  await mj.waitForFunction(()=>typeof window.__p111MahjongTest?.loadState==="function");
  const mjCall=(name,...args)=>mj.evaluate(([n,a])=>window.__p111MahjongTest[n](...a),[name,args]);
  const mjState=()=>mj.evaluate(()=>window.__p111MahjongTest.state());
  const standard=[0,1,2,9,10,11,18,19,20,6,7,8,27,27];
  assert.equal(await mjCall("canHu",standard,0),true,"standard four melds plus pair");
  assert.equal(await mjCall("canHu",[0,1,2,9,10,11,18,19,20,27,27],1),true,"one open meld plus three concealed melds and a pair");
  assert.equal(await mjCall("canHu",standard.slice(0,13),0),false,"13 tiles cannot declare Hu");
  const sevenPairs=[0,0,1,1,2,2,9,9,10,10,27,27,28,28];
  assert.equal(await mjCall("canHu",sevenPairs,0),true,"seven pairs enabled");
  assert.equal(await mjCall("canHu",sevenPairs,1),false,"seven pairs not allowed with open melds");
  await mjCall("setRules",{sevenPairs:false});
  assert.equal(await mjCall("canHu",sevenPairs,0),false,"seven-pairs switch disables the pattern");
  await mjCall("setRules",{sevenPairs:true});
  const wall=await mjCall("wall");
  assert.equal(wall.length,136);
  for(let type=0;type<34;type++)assert.equal(wall.filter(x=>x===type).length,4,"four copies of tile "+type);
  const initial=await mjState();
  assert.deepEqual(initial.hands.map(x=>x.length),[14,13,13,13]);
  assert.equal(initial.wall,83);
  // Chi is available only to the next seat, while pong/kong are not seat-restricted.
  await mjCall("loadState",{hands:[[],[3,5],[3,5],[]],pendingSeat:0,pendingType:4,paused:true});
  assert.deepEqual((await mjCall("options",1,4)).chi,[[3,5]]);
  assert.deepEqual((await mjCall("options",2,4)).chi,[]);
  // Claims resolve by Hu > Kong > Pong > Chi, not by seat order alone.
  await mjCall("loadState",{hands:[[],[27,27],[27,27,27],standard.slice(0,13)],pendingSeat:0,pendingType:27,paused:true});
  await mjCall("buildClaims");
  assert.deepEqual((await mjState()).claimQueue.map(q=>[q.seat,q.priority]),[[3,"hu"],[2,"kong"],[1,"pong"]]);
  await mjCall("loadState",{hands:[[2,3,5,6],[],[],[]],pendingSeat:3,pendingType:4});
  assert.deepEqual(await mjCall("options",0,4).then(x=>x.chi),[[2,3],[3,5],[5,6]]);
  // Execute Pong, Chi and exposed Kong; tile counts and turn lifecycle remain consistent.
  await mjCall("loadState",{hands:[[27,27],[],[],[]],wallTypes:[],pendingSeat:3,pendingType:27});
  await mjCall("executeClaim",0,"pong",{});
  let mstate=await mjState();
  assert.equal(mstate.melds[0][0].kind,"pong");assert.deepEqual(mstate.melds[0][0].tiles,[27,27,27]);
  assert.equal(mstate.hands[0].length,0);assert.equal(mstate.current,0);assert.equal(mstate.phase,"discard");
  await mjCall("loadState",{hands:[[2,3,5,6],[],[],[]],pendingSeat:3,pendingType:4});
  await mjCall("executeClaim",0,"chi",{chi:[[5,6]]});
  mstate=await mjState();assert.equal(mstate.melds[0][0].kind,"chi");assert.deepEqual(mstate.melds[0][0].tiles,[4,5,6]);
  assert.deepEqual(mstate.hands[0],[2,3],"selected chi sequence consumes only its own two tiles");
  await mjCall("loadState",{hands:[[27,27,27],[],[],[]],wallTypes:[8],pendingSeat:3,pendingType:27});
  await mjCall("executeClaim",0,"kong",{});
  mstate=await mjState();assert.equal(mstate.melds[0][0].kind,"kong");assert.equal(mstate.hands[0].length,1);assert.equal(mstate.hands[0][0],8);assert.equal(mstate.wall,0);
  // Concealed Kong and added Kong both take a replacement tile.
  await mjCall("loadState",{hands:[[0,0,0,0,1,2,3,4,5,6,7,8,9,10],[],[],[]],wallTypes:[11]});
  assert.ok((await mjCall("kongOptions",0)).some(x=>x.kind==="concealed"&&x.type===0));
  await mjCall("concealedKong",0,0);
  mstate=await mjState();assert.equal(mstate.melds[0][0].kind,"concealed-kong");assert.equal(mstate.melds[0][0].tiles.length,4);
  assert.equal(mstate.hands[0].length,11);assert.equal(mstate.hands[0][10],11);assert.equal(mstate.wall,0);
  await mjCall("loadState",{hands:[[27,0,1,2,3,4,5,6,7,8,9],[],[],[]],melds:[[{kind:"pong",tiles:[27,27,27]}],[],[],[]],wallTypes:[12]});
  assert.ok((await mjCall("kongOptions",0)).some(x=>x.kind==="added"&&x.type===27));
  await mjCall("addedKong",0,27,0);
  mstate=await mjState();assert.equal(mstate.melds[0][0].kind,"added-kong");assert.equal(mstate.melds[0][0].tiles.length,4);
  assert.equal(mstate.hands[0].length,11);assert.equal(mstate.hands[0][10],12);assert.equal(mstate.wall,0);
  // Added Kong may be robbed by an opponent who can Hu with the fourth tile.
  await mjCall("loadState",{hands:[[27,0,1,2,3,4,5,6,7,8,9],standard.slice(0,13),[],[]],
   melds:[[{kind:"pong",tiles:[27,27,27]}],[],[],[]],wallTypes:[12]});
  await mjCall("addedKong",0,27,0);
  mstate=await mjState();assert.equal(mstate.over,true,"rob-kong Hu ends the hand before the replacement draw");
  assert.match(await mj.locator("#tableInfo").innerText(),/抢杠胡/);
  // Empty wall ends in a draw rather than an invalid undefined tile.
  await mjCall("loadState",{hands:[Array.from({length:14},(_,i)=>i),[],[],[]],wallTypes:[],phase:"draw"});
  await mjCall("drawHuman");
  assert.equal((await mjState()).over,true);
  assert.match(await mj.locator("#tableInfo").innerText(),/流局/);
  await mj.close();
  await ddz.close();
  await xiangqi.close();
  assert.deepEqual(errors,[]);
  console.log("P111 rule fixtures passed: chess; Xiangqi; Sanguosha; Dou Dizhu; Mahjong 136-tile wall, Hu patterns, claim priority, Chi/Pong/Kong, concealed/added/rob-kong and wall exhaustion.");
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exit(1);});
