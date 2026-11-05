/* P111 R16: current-screen UI and 22-game actual Chromium lifecycle regression. */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {pathToFileURL}=require("node:url");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const names=[
"五子棋","中国象棋","国际象棋","黑白棋","四子棋","海战棋","国际跳棋",
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
  await frame.locator("#gs-hud").waitFor({state:"visible",timeout:10000});
  await frame.locator("#gs-start:not([disabled])").waitFor({state:"visible",timeout:10000});
  await page.waitForTimeout(55);
  return frame;
 }
 async function start(){
  await page.locator("#gameFrame").evaluate(el=>el.focus());
  await page.keyboard.press("Enter");
  await frame.locator("#gs-start").getByText("结束").waitFor({timeout:4000});
  await frame.locator("#gs-pause").getByText("暂停").waitFor({timeout:4000});
 }
 async function pauseResume(){
  await page.locator("#gameFrame").evaluate(el=>el.focus());
  await page.keyboard.press("Enter");
  await frame.locator("#gs-pause").getByText("继续").waitFor({timeout:4000});
  await page.keyboard.press("Enter");
  await frame.locator("#gs-pause").getByText("暂停").waitFor({timeout:4000});
 }
 async function viewCheck(name,width,height){
  const v=await frame.locator("#game").evaluate(el=>{
   const box=x=>{const r=x.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
   const main=el.querySelector(".game-main-board"),guide=el.querySelector(".game-guide"),tools=el.querySelector(".game-tools"),hud=el.querySelector("#gs-hud");
   return {root:box(el),main:box(main),hud:box(hud),guide:guide?getComputedStyle(guide).display:"none",
    tools:tools?getComputedStyle(tools).display:"none",columns:getComputedStyle(el).gridTemplateColumns,
    viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth};
  });
  assert.equal(v.guide,"none",name+" legacy guide must be hidden");
  assert.equal(v.tools,"none",name+" legacy right tools must be hidden by default");
  assert.ok(v.main.width>=v.root.width*.97,name+" main board must use almost full iframe width: "+JSON.stringify(v));
  assert.ok(v.main.height>=v.root.height-58,name+" game stage must use available height: "+JSON.stringify(v));
  assert.ok(v.hud.width>=v.root.width*.97,name+" controls should live inside the iframe");
  assert.ok(v.main.bottom<=v.root.bottom+1,name+" stage bottom must stay visible");
  assert.ok(v.overflow<=v.viewport.width+2,name+" must not scroll horizontally");
  const captured=await frame.locator("#game").evaluate(el=>{
   const e=new MouseEvent("contextmenu",{bubbles:true,cancelable:true});
   el.dispatchEvent(e);return e.defaultPrevented;
  });
  assert.ok(captured,name+" must prevent the browser context menu in the game area");
  const filename=name.replace(/[^\p{L}\p{N}-]+/gu,"-")+"-"+width+"x"+height+".png";
  await page.screenshot({path:path.join(artifacts,"games",filename)});
 }
 try{
  await fs.promises.mkdir(path.join(artifacts,"games"),{recursive:true});
  await page.goto(pathToFileURL(path.join(root,"index.html")).href);
  await page.locator("#homeDate").waitFor({state:"visible"});
  assert.equal(await page.locator("#totalGameCount").innerText(),"22");
  assert.equal(await page.locator(".brand-mark i").count(),4);
  await page.screenshot({path:path.join(artifacts,"home-1440x1000.png")});
  await library();
  assert.equal(await page.locator(".game-card").count(),22);
  const cards=await page.locator(".game-card").first().evaluate(el=>el.getBoundingClientRect().height);
  assert.ok(cards<125,"library game cards must be compact, not giant blank blocks");
  await page.screenshot({path:path.join(artifacts,"library-1440x1000.png")});
  for(const size of [{width:1440,height:1000},{width:1366,height:768}]){
   await page.setViewportSize(size);
   await library();
   for(const name of names){
    await open(name);await start();await pauseResume();
    await viewCheck(name,size.width,size.height);
    await frame.locator("#gs-next").click();
    await frame.locator("#gs-pause").getByText("暂停").waitFor({timeout:4000});
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
  await frame.locator("#gs-difficulty").selectOption("hard");
  await page.waitForTimeout(130);assert.equal(await frame.locator(".mine-cell").count(),480);await fitMine();
  await frame.locator("#gs-difficulty").selectOption("easy");
  await page.waitForTimeout(130);assert.equal(await frame.locator(".mine-cell").count(),81);await fitMine();
  await frame.locator(".mine-cell").nth(8).click({button:"right"});
  assert.ok((await frame.locator(".mine-cell").nth(8).getAttribute("class")).includes("flag"),"right click must place a flag");
  await frame.locator("#gs-help").click();
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
  const tsize=await tetris.evaluate(el=>{
   const a=el.getBoundingClientRect(),b=el.closest(".game-main-board").getBoundingClientRect();
   return{height:a.height,available:b.height,top:a.top,bottom:a.bottom,stageBottom:b.bottom};
  });
  assert.ok(tsize.height>=tsize.available*.88&&tsize.bottom<=tsize.stageBottom+1,"Tetris must fill available HEIGHT");
  await frame.locator("body").evaluate(()=>{window.__oldRandom=Math.random;Math.random=()=>.5;});
  const round=Number(await tetris.getAttribute("data-round-serial")||0);
  await frame.locator("#gs-next").click();
  for(let i=0;i<40;i++){
   const n=Number(await tetris.getAttribute("data-round-serial")||0);
   if(n>round)break;
   await page.waitForTimeout(25);
  }
  assert.ok(Number(await tetris.getAttribute("data-round-serial"))>round);
  for(let i=0;i<3;i++)await tetris.press("Space");
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
  await open("国际象棋");await start();
  assert.equal(await frame.locator(".chess-square").count(),64);
  await frame.locator("#gs-mode").selectOption("1");
  await frame.locator('[data-square="e2"]').click();await frame.locator('[data-square="e4"]').click();
  assert.equal(await frame.locator("#moveList li").count(),1);
  await frame.locator("#gs-tools").click();await frame.locator("#undoButton").click();
  assert.equal(await frame.locator("#moveList li").count(),0);
  await open("中国象棋");await start();assert.equal(await frame.locator(".xiangqi-cell").count(),90);
  await open("斗地主");await start();assert.equal(await frame.locator(".playing-card").count(),17);
  await open("麻将");await start();assert.equal(await frame.locator("#hand .playing-card").count(),14);
  await open("三国杀");await start();assert.equal(await frame.locator(".playing-card").count(),6);
  assert.deepEqual(remote,[],"No remote HTTP/CDN resources are permitted in file:// mode");
  assert.deepEqual(errors,[],"No uncaught errors in host or game frames");
  console.log("P111 R16 Chromium regression passed: 22 games × two desktop viewports, no rails, local HUD, Enter toggle, contextmenu, Minesweeper footer, Tetris, Mario, chess/card basics.");
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exit(1);});
