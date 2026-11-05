/* P111 R16 - deterministic chess rules fixtures. All files are opened via file:// */
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
  // A blocker prevents the facing-generals rule; moving it off the file is illegal.
  await load([[4,0,"black","将"],[4,9,"red","帅"],[4,5,"red","兵"]]);
  assert.equal(await xiangqi.evaluate(()=>window.__p111XiangqiTest.faces()),false);
  assert.equal((await getMoves()).some(m=>m.fx===4&&m.fy===5&&m.tx===4&&m.ty===4),false,
   "a move that exposes the generals to each other is illegal");
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
  await call("addCard",1,"wine","club");await call("setHp",1,1);await call("damage",1,2,2);
  await sg.waitForTimeout(30);
  assert.equal((await api()).players[1].hp,1,"AI self-rescue with 酒");
  assert.equal((await api()).players[1].alive,true);
  // 小乔's 红颜 turns spades into hearts for 天香; damage transfers and target draws.
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
  assert.equal(skillState.players[2].hand.length,targetHandBefore+1,"天香 target draws based on lost HP");
  await sg.close();
  await xiangqi.close();
  assert.deepEqual(errors,[]);
  console.log("P111 rule fixtures passed: chess special moves/draws; Xiangqi cannon/horse/generals/mate/stalemate/perpetual check; Sanguosha active/response cards, Peach/Wine rescue and Tianxiang.");
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exit(1);});
