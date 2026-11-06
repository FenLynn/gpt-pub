/* P111 R16: current-screen UI and 22-game actual Chromium lifecycle regression. */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {pathToFileURL}=require("node:url");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const names=[
"五子棋","中国象棋","国际象棋","黑白棋","四子棋","海战棋","西洋跳棋（8×8）","中国跳棋","飞行棋",
"扫雷","2048","记忆翻牌","数独","推箱子",
"俄罗斯方块","贪吃蛇","Pong","魂斗罗（原创模式）","超级玛丽","90 坦克",
"经典纸牌","斗地主","麻将","三国杀"
];
(async()=>{
 const root=path.resolve(__dirname,"../app");
 const artifacts=path.resolve(__dirname,"../p111-smoke-artifacts");
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,
  args:["--no-sandbox","--disable-dev-shm-usage","--allow-file-access-from-files"]});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const remote=[],errors=[];
 let game="host";
 page.on("request",req=>{if(/^https?:/i.test(req.url()))remote.push(req.url());});
 page.on("pageerror",err=>errors.push(game+": "+err.message));
 const frame=page.frameLocator("#gameFrame");
 async function library(){
  if(await page.locator("#workspaceView").isVisible()||!(await page.locator("#libraryView").isVisible()))
   await page.locator('[data-category="all"]').click();
 }
 async function open(name){
  await library();game=name;
  await page.locator(".game-card").filter({hasText:name}).click();
  await frame.locator("#game").waitFor({state:"visible",timeout:10000});
  await page.locator("#gameActions:not(.hidden)").waitFor({state:"visible",timeout:10000});
  await page.locator("#startButton:not([disabled])").waitFor({state:"visible",timeout:10000});
  await page.waitForTimeout(55);
  return frame;
 }
 async function start(){
  await page.locator("#startButton").click();
  await page.waitForFunction(()=>document.querySelector("#startButton").getAttribute("aria-label")==="结束");
  assert.equal(await page.locator("#startButton svg").count(),1,"Start SVG icon must be visible");
  assert.equal(await page.locator("#pauseButton svg").count(),1,"Pause SVG icon must be visible");
 }
 async function pauseResume(){
  await page.locator("#pauseButton").click();
  await page.waitForFunction(()=>document.querySelector("#pauseButton").getAttribute("aria-label")==="继续");
  await page.locator("#pauseButton").click();
  await page.waitForFunction(()=>document.querySelector("#pauseButton").getAttribute("aria-label")==="暂停");
 }
 async function viewCheck(name,width,height){
  const v=await frame.locator("#game").evaluate(el=>{
   const box=x=>{const r=x.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
   const main=el.querySelector(".game-main-board"),tools=el.querySelector(".game-tools");
   const surface=el.querySelector(".arcade-canvas")||el.querySelector("canvas")||el.querySelector(".gomoku-board")||
    el.querySelector(".xiangqi-board")||el.querySelector(".chess-frame")||el.querySelector(".fleet-board .game-grid")||
    el.querySelector(".mine-classic")||el.querySelector(".solitaire-table")||el.querySelector(".card-table-main")||el.querySelector("#board");
   return {root:box(el),main:box(main),surface:box(surface),tools:box(tools),toolsVisible:getComputedStyle(tools).display!=="none",
    guide:getComputedStyle(el.querySelector(".game-guide")).display,
    hudVisible:getComputedStyle(el.querySelector("#gs-hud")).display!=="none",
    noticeVisible:getComputedStyle(el.querySelector("#gs-notice")).display!=="none",
    battleship:el.classList.contains("battleship-layout"),overflow:document.documentElement.scrollWidth,viewport:innerWidth};
  });
  assert.equal(v.guide,"none",name+" guide should not consume playfield space");
  assert.equal(v.hudVisible,false,name+" secondary iframe titlebar must be hidden");
  assert.equal(v.noticeVisible,false,name+" iframe notices must not appear on board");
  assert.ok(v.main.height>=v.root.height*.96,name+" game stage should use full iframe height: "+JSON.stringify(v));
  if(v.toolsVisible){
   assert.ok(v.tools.x>=v.main.right-2,name+" tools must dock at right without covering the playfield");
   assert.ok(v.main.width>=v.root.width*.68,name+" right rail leaves main board wide enough");
  }
  const header=await page.locator("#topbar").evaluate(el=>{
   const r=q=>{const a=q.getBoundingClientRect();return{x:a.x,right:a.right,y:a.y,bottom:a.bottom,width:a.width,center:a.y+a.height/2};};
   return{timer:r(el.querySelector("#hostGameTimer")),notice:r(el.querySelector("#gameNotice")),
    actions:[...el.querySelectorAll("#startButton,#pauseButton,#newGameButton")].map(r),
    iconCount:el.querySelectorAll("#startButton svg,#pauseButton svg,#newGameButton svg").length,
    visible:getComputedStyle(el.querySelector("#gameActions")).display!=="none"};
  });
  assert.ok(header.visible&&header.iconCount===3,name+" all three SVG game buttons must be in the parent topbar");
  assert.ok(header.timer.right<=header.notice.x+5,name+" timer left / message center layout: "+JSON.stringify(header));
  assert.ok(header.notice.width>=65,name+" central notification space should be readable");
  assert.ok(Math.max(...header.actions.map(x=>x.center))-Math.min(...header.actions.map(x=>x.center))<=2,name+" SVG controls vertically aligned");
  assert.ok(v.surface.height>=v.main.height*(v.battleship?.60:.70),name+" primary surface uses available height: "+JSON.stringify(v));
  assert.ok(v.surface.y>=v.main.y-1&&v.surface.bottom<=v.main.bottom+1,name+" game content must not clip vertically");
  assert.ok(v.overflow<=v.viewport+2,name+" no horizontal scrollbar");
  const rightClick=await frame.locator("#game").evaluate(el=>{const e=new MouseEvent("contextmenu",{bubbles:true,cancelable:true});el.dispatchEvent(e);return e.defaultPrevented;});
  assert.ok(rightClick,name+" right click must be captured by game");
  const filename=name.replace(/[^\p{L}\p{N}-]+/gu,"-")+"-"+width+"x"+height+".png";
  await page.screenshot({path:path.join(artifacts,"games",filename)});
 }
 try{
  await fs.promises.mkdir(path.join(artifacts,"games"),{recursive:true});
  await page.goto(pathToFileURL(path.join(root,"index.html")).href);
  await page.locator("#homeDate").waitFor({state:"visible"});
  assert.equal(await page.locator("#totalGameCount").innerText(),"24");
  assert.equal(await page.locator(".brand-mark i").count(),4);
  const hero=await page.locator(".home-hero").evaluate(el=>{
   const rect=n=>{const r=n.getBoundingClientRect();return{left:r.left,right:r.right};};
   return{copy:rect(el.querySelector(".hero-copy")),art:rect(el.querySelector(".home-art")),artDisplay:getComputedStyle(el.querySelector(".home-art")).display};
  });
  if(hero.artDisplay!=="none")assert.ok(hero.copy.right<=hero.art.left+3,"Home banner copy must not overlap decorative art");
  await page.screenshot({path:path.join(artifacts,"home-1440x1000.png")});
  let noticeChecked=false;
  await library();
  assert.equal(await page.locator(".game-card").count(),24);
  const cards=await page.locator(".game-card").first().evaluate(el=>el.getBoundingClientRect().height);
  assert.ok(cards<125,"library game cards must be compact, not giant blank blocks");
  await page.screenshot({path:path.join(artifacts,"library-1440x1000.png")});
  for(const size of [{width:1440,height:1000},{width:1366,height:768}]){
   await page.setViewportSize(size);
   await library();
   for(const name of names){
    await open(name);await start();await pauseResume();
    if(await page.locator("#modeControl button,#difficultyControl button").count())assert.equal(await page.locator("#gameControls").isVisible(),true,"parent mode/difficulty controls must be visible");
    await viewCheck(name,size.width,size.height);
    if(!noticeChecked){
    await frame.locator("#game").evaluate(()=>window.GameBridge.report("顶部通知位置回归测试"));
    await page.locator("#gameNotice.visible").waitFor({timeout:1500});
    const r=await page.locator("#gameNotice").evaluate(el=>{const x=el.getBoundingClientRect(),t=document.querySelector("#topbar").getBoundingClientRect();return{top:x.top,bottom:x.bottom,barTop:t.top,barBottom:t.bottom,message:el.textContent};});
    assert.ok(r.top>=r.barTop-1&&r.bottom<=r.barBottom+1,"game notices must appear only in top titlebar");
    assert.match(r.message,/顶部通知位置回归测试/);
    assert.equal(await page.locator("#toast").evaluate(el=>el.classList.contains("show")),false,"no bottom toast while a game is open");
    noticeChecked=true;
   }
   await page.locator("#newGameButton").click();
    await page.waitForFunction(()=>document.querySelector("#pauseButton").getAttribute("aria-label")==="暂停");
   }
  }
  await page.setViewportSize({width:1440,height:1000});
  await open("扫雷");await start();
  const mine=frame.locator(".mine-classic");
  async function fitMine(){
   const f=await mine.evaluate(el=>{
    const rect=node=>{const r=node.getBoundingClientRect();return{top:r.top,bottom:r.bottom,width:r.width,right:r.right,height:r.height};};
    return {board:rect(el),grid:rect(el.querySelector("#board")),footer:rect(el.querySelector(".mine-bottom-panel")),area:rect(el.closest(".game-main-board"))};
   });
   assert.ok(f.footer.top>=f.grid.bottom-1,"Minesweeper bottom panel must be BELOW the grid");
   assert.ok(f.footer.bottom<=f.area.bottom+1,"Minesweeper timer/face/counter must be visible, not clipped");
   assert.ok(f.board.width<=f.area.width+1,"Minesweeper must fit available width");
  }
  await page.waitForTimeout(130);await fitMine();
  assert.equal(await frame.locator(".mine-cell").count(),256);
  await page.locator('#difficultyControl button[data-difficulty="hard"]').click();
  await page.waitForTimeout(130);assert.equal(await frame.locator(".mine-cell").count(),480);await fitMine();
  await page.locator('#difficultyControl button[data-difficulty="easy"]').click();
  await page.waitForTimeout(130);assert.equal(await frame.locator(".mine-cell").count(),81);await fitMine();
  await frame.locator(".mine-cell").nth(8).click({button:"right"});
  assert.ok((await frame.locator(".mine-cell").nth(8).getAttribute("class")).includes("flag"),"right click must place a flag");
  const mineFixture=await browser.newPage({viewport:{width:1000,height:800}});
  await mineFixture.goto(pathToFileURL(path.resolve(__dirname,"../app/games/minesweeper/index.html")).href+"?p111Test=1");
  await mineFixture.waitForFunction(()=>!!window.__p111MineTest);
  await mineFixture.evaluate(()=>{window.__p111MineTest.forceFlag(0);window.__p111MineTest.forceMine(1);window.__p111MineTest.forceNumber(2,8);});
  const symbols=await mineFixture.locator(".mine-cell").evaluateAll(cells=>cells.slice(0,3).map(cell=>{
   const svg=cell.querySelector("svg"),r=svg?.getBoundingClientRect(),b=cell.getBoundingClientRect();
   return{svg:!!svg,width:r?.width/b.width||0,height:r?.height/b.height||0,font:parseFloat(getComputedStyle(cell).fontSize),cell:b.width,text:cell.textContent.trim()};
  }));
  assert.ok(symbols[0].svg&&symbols[1].svg&&symbols[0].width>=.65&&symbols[0].height>=.65&&symbols[1].width>=.65&&symbols[1].height>=.65,"Minesweeper flag and mine SVGs must occupy most of each cell");
  assert.ok(symbols[2].text==="8"&&symbols[2].font>=symbols[2].cell*.65,"Minesweeper numbers must scale with cell size");
  await mineFixture.screenshot({path:path.join(artifacts,"minesweeper-symbols.png")});
  await mineFixture.close();
  await page.locator("#helpButton").click();
  await page.locator("#helpPanel").waitFor({state:"visible"});
  await page.keyboard.press("Escape");
  assert.ok(await page.locator("#helpPanel").isVisible(),"Escape must not close help");
  const before=await page.locator("#helpPanel").boundingBox();
  await page.mouse.move(before.x+80,before.y+22);
  await page.mouse.down();await page.mouse.move(before.x+125,before.y+58,{steps:5});await page.mouse.up();
  const after=await page.locator("#helpPanel").boundingBox();
  assert.ok(Math.abs(after.x-before.x)>10||Math.abs(after.y-before.y)>10,"Help must be draggable");
  await page.locator("#helpClose").click();
  assert.ok(!(await page.locator("#helpPanel").isVisible()),"Help X should close the floating help");
  await open("俄罗斯方块");await start();
  const tetris=frame.locator("#canvas");
  const preview=frame.locator("#nextCanvas");
  assert.equal(await preview.count(),1,"Tetris must show a separate next-piece canvas");
  assert.equal(await frame.locator(".tetris-inboard-sidebar #score").count(),1,"Score must be embedded in the game, not the external tools rail");
  const inset=await frame.locator(".tetris-inboard-sidebar").evaluate(el=>{
   const r=el.getBoundingClientRect(),board=el.parentElement.querySelector("#canvas").getBoundingClientRect();
   const stage=el.closest(".game-main-board").getBoundingClientRect();
   return{rightOfBoard:r.left>=board.right-1,insideStage:r.right<=stage.right+1,top:r.top,bottom:r.bottom,boardTop:board.top,boardBottom:board.bottom};
  });
  assert.ok(inset.rightOfBoard&&inset.insideStage,"NEXT and score sidebar must sit directly to the right within the play stage: "+JSON.stringify(inset));
  assert.ok(inset.top>=inset.boardTop-4&&inset.bottom<=inset.boardBottom+4,"Score and preview must align vertically with the Tetris board");
  assert.ok((await preview.getAttribute("data-kind"))!==null,"Next piece preview must be initialized");
  const tsize=await tetris.evaluate(el=>{
   const a=el.getBoundingClientRect(),b=el.closest(".game-main-board").getBoundingClientRect();
   return{height:a.height,available:b.height,top:a.top,bottom:a.bottom,stageBottom:b.bottom};
  });
  assert.ok(tsize.height>=tsize.available*.88&&tsize.bottom<=tsize.stageBottom+1,"Tetris must fill available HEIGHT");
  await frame.locator("body").evaluate(()=>{window.__oldRandom=Math.random;Math.random=()=>.5;});
  const round=Number(await tetris.getAttribute("data-round-serial")||0);
  await page.locator("#newGameButton").click();
  for(let i=0;i<40;i++){
   const n=Number(await tetris.getAttribute("data-round-serial")||0);
   if(n>round)break;
   await page.waitForTimeout(25);
  }
  assert.ok(Number(await tetris.getAttribute("data-round-serial"))>round);
  const queued=await preview.getAttribute("data-kind");
  await tetris.press("Space");
  assert.equal(await tetris.getAttribute("data-piece-kind"),queued,"Shown NEXT tetromino must become the following active piece after lock");
  for(let i=0;i<2;i++)await tetris.press("Space");
  assert.equal(Number(await frame.locator("#score").innerText()),96,"Three hard-dropped O pieces form a six-row stack");
  for(let i=0;i<20;i++){
   if(await tetris.getAttribute("data-piece-can-fall")==="false")break;
   await tetris.press("ArrowDown");
  }
  const ts=await tetris.evaluate(el=>({...el.dataset}));
  assert.equal(ts.pieceCanFall,"false","Tetris piece must stop on the stack");
  assert.equal(Number(ts.pieceRenderFraction),0,"Tetris must not interpolate through locked blocks");
  assert.equal(Number(ts.pieceVisualBottom),Number(ts.pieceLogicalBottom));
  await open("超级玛丽");await start();
  const mario=frame.locator("#canvas");
  const mx=Number(await mario.getAttribute("data-player-x"));
  await mario.press("ArrowRight");await page.keyboard.down("ArrowRight");await page.waitForTimeout(150);await page.keyboard.up("ArrowRight");
  assert.ok(Number(await mario.getAttribute("data-player-x"))>mx,"Mario must respond to movement");
  await open("海战棋");await start();
  await frame.locator(".enemy-sea:not(:disabled)").first().click();
  assert.equal(await frame.locator(".enemy-sea.shot-impact,.enemy-sea.shot-splash").count(),1,
   "Battleship hit or miss must mark the latest shot for a nonblocking in-board animation");
  await open("五子棋");await start();
  const goGrid=await frame.locator("#board").evaluate(el=>({
   lines:el.querySelectorAll(".gomoku-lines line").length,
   stars:el.querySelectorAll(".gomoku-lines circle").length,
   buttons:el.querySelectorAll(".gomoku-cell").length,
   shape:(()=>{const r=el.getBoundingClientRect();return r.width/r.height})()
  }));
  assert.equal(goGrid.lines,30,"Gomoku perimeter/grid lines must be exactly 15 vertical + 15 horizontal segments");
  assert.equal(goGrid.stars,9,"Gomoku has 9 precisely located star points");
  assert.equal(goGrid.buttons,225,"Gomoku has exactly 225 intersections");
  assert.ok(Math.abs(goGrid.shape-1)<.015,"Gomoku board must remain square");
  await frame.locator(".gomoku-cell").nth(112).click();
  assert.equal(await frame.locator(".stone.stone-arrived").count(),1,"Gomoku last stone must animate on landing");
  await open("中国象棋");await start();
  const xiangqiRatio=await frame.locator(".xiangqi-piece").first().evaluate(el=>{
   const r=el.getBoundingClientRect();return{width:r.width,height:r.height,round:getComputedStyle(el).borderRadius};
  });
  assert.ok(Math.abs(xiangqiRatio.width-xiangqiRatio.height)<=1.5,"Xiangqi pieces must be truly circular, not elliptical: "+JSON.stringify(xiangqiRatio));
  assert.equal(await frame.locator(".xiangqi-cell").count(),90,"Xiangqi must have exactly 90 intersections");
  await open("国际象棋");await start();
  assert.equal(await frame.locator(".chess-square").count(),64);
  await page.locator('#modeControl button[data-mode-index="1"]').click();
  await frame.locator('[data-square="e2"]').click();await frame.locator('[data-square="e4"]').click();
  assert.equal(await frame.locator("#moveList li").count(),1);
  await frame.locator("#undoButton").click();
  assert.equal(await frame.locator("#moveList li").count(),0);
  await open("中国象棋");await start();assert.equal(await frame.locator(".xiangqi-cell").count(),90);
  await open("斗地主");await start();assert.equal(await frame.locator(".playing-card").count(),17);
  await open("麻将");await start();assert.equal(await frame.locator("#hand .playing-card").count(),14);
  await open("三国杀");await start();assert.equal(await frame.locator(".playing-card").count(),6);
  const sanguoshaLayout=await frame.locator("#game").evaluate(()=>{
   const rect=s=>{const r=s.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
   const main=rect(document.querySelector(".game-main-board")),tools=rect(document.querySelector(".game-tools"));
   const players=[...document.querySelectorAll(".player-chip")].map(rect);
   return{main,tools,players};
  });
  assert.equal(sanguoshaLayout.players.length,4,"Sanguosha must show all four seats");
  assert.ok(sanguoshaLayout.tools.left>=sanguoshaLayout.main.right-1,"Sanguosha tools must not cover the battlefield");
  assert.ok(sanguoshaLayout.players.every(p=>p.left>=sanguoshaLayout.main.left-1&&p.right<=sanguoshaLayout.main.right+1),"All four Sanguosha player cards must remain visible inside the battlefield");
  assert.deepEqual(remote,[],"No remote HTTP/CDN resources are permitted in file:// mode");
  assert.deepEqual(errors,[],"No uncaught errors in host or game frames");
  console.log("P111 R19 Chromium regression passed: 24 games × two desktop viewports (48 screenshots), left timer, central notices, SVG controls, Tetris preview/score, chess and arcade lifecycle.");
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exit(1);});
