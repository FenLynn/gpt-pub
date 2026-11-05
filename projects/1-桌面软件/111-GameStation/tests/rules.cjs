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
  assert.deepEqual(errors,[]);
  console.log("P111 chess rules fixtures: both castles, attacked transit, en passant, four promotions, mate/stalemate, insufficient material, 50/75 moves, repetition passed");
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exit(1);});
