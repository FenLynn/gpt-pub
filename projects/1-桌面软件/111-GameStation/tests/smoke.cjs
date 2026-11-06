/* P111 R16: current-screen UI and 24-game actual Chromium lifecycle regression. */
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
   return {root:box(el),main:box(main),surface:box(surface),tools:tools?box(tools):null,toolsVisible:!!tools&&getComputedStyle(tools).display!=="none",
    guide:el.querySelector(".game-guide")?getComputedStyle(el.querySelector(".game-guide")).display:"none",
    hudVisible:!!el.querySelector("#gs-hud")&&getComputedStyle(el.querySelector("#gs-hud")).display!=="none",
    noticeVisible:!!el.querySelector("#gs-notice")&&getComputedStyle(el.querySelector("#gs-notice")).display!=="none",
    battleship:el.classList.contains("battleship-layout"),overflow:document.documentElement.scrollWidth,viewport:innerWidth};
  });
  assert.equal(v.guide,"none",name+" guide should not consume playfield space");
  assert.equal(v.hudVisible,false,name+" secondary iframe titlebar must be hidden");
  assert.equal(v.noticeVisible,false,name+" iframe notices must not appear on board");
  assert.ok(v.main.height>=v.root.height*.96,name+" game stage should use full iframe height: "+JSON.stringify(v));
  if(name==="五子棋"){
   const geometry=await frame.locator(".gomoku-board").evaluate(el=>{
    const r=el.getBoundingClientRect(),cells=[...el.querySelectorAll(".gomoku-cell")].map(n=>{const q=n.getBoundingClientRect();return{w:q.width,h:q.height};});
    return{width:r.width,height:r.height,lines:el.querySelectorAll(".gomoku-lines line").length,cells:cells.length,
     maxCellDelta:Math.max(...cells.map(c=>Math.abs(c.w-c.h))),border:parseFloat(getComputedStyle(el).borderTopWidth)};
   });
   assert.ok(Math.abs(geometry.width-geometry.height)<=1,"Gomoku board must remain exactly square: "+JSON.stringify(geometry));
   assert.equal(geometry.lines,30,"Gomoku must draw all 15 horizontal and 15 vertical lines");
   assert.equal(geometry.cells,225,"Gomoku must retain all 225 intersections");
   assert.ok(geometry.maxCellDelta<=1,"All 225 Gomoku intersections must remain square: "+JSON.stringify(geometry));
   assert.ok(geometry.border>=4,"Gomoku must retain a visible wood frame");
  }
  if(name==="中国象棋"){
   const geometry=await frame.locator(".xiangqi-board").evaluate(el=>{
    const r=el.getBoundingClientRect(),pieces=[...el.querySelectorAll(".xiangqi-piece")].map(p=>{const q=p.getBoundingClientRect();return{w:q.width,h:q.height};});
    return{boardRatio:r.width/r.height,pieceCount:pieces.length,maxPieceDelta:Math.max(...pieces.map(p=>Math.abs(p.w-p.h)))};
   });
   assert.ok(Math.abs(geometry.boardRatio-8/9)<=.015,"Xiangqi board must preserve its 9×10 intersection geometry: "+JSON.stringify(geometry));
   assert.equal(geometry.pieceCount,32,"Xiangqi must render all 32 starting pieces");
   assert.ok(geometry.maxPieceDelta<=.5,"All 32 Xiangqi pieces must be mathematically circular, never oval: "+JSON.stringify(geometry));
  }
  if(name==="飞行棋"){
   const dice=await frame.locator("#diceFace").evaluate(el=>({svg:el.querySelectorAll("svg.flight-dice-svg").length,pips:el.querySelectorAll(".flight-dice-pip").length,label:el.getAttribute("aria-label"),turn:el.ownerDocument.querySelector("#turnText").textContent.trim()}));
   assert.equal(dice.svg,1,"Flight Chess must use a vector dice face");
   assert.equal(dice.pips,1,"Initial Flight Chess die must show one pip");
   assert.equal(dice.label,"骰子：1点","Flight Chess die must expose its value accessibly");
   assert.equal(await frame.locator("#diceFace").getAttribute("role"),"img","Flight Chess die must expose an image role");
   assert.equal(dice.turn,"红方回合","Resume must not overwrite the active player's turn label");
  }
  if(name==="中国跳棋"){
   const geometry=await frame.locator("#board").evaluate(el=>{
    const r=el.getBoundingClientRect(),tokens=[...el.querySelectorAll(".star-token")].map(t=>{const q=t.getBoundingClientRect();return{w:q.width,h:q.height};});
    return{ratio:r.width/r.height,holes:el.querySelectorAll(".star-hole").length,tokenCount:tokens.length,
     maxTokenDelta:Math.max(...tokens.map(t=>Math.abs(t.w-t.h)))};
   });
   assert.ok(Math.abs(geometry.ratio-10/9)<=.025,"Chinese Checkers star board must retain its 10:9 geometry: "+JSON.stringify(geometry));
   assert.equal(geometry.holes,121,"Chinese Checkers must retain all 121 holes");
   assert.equal(geometry.tokenCount,20,"Chinese Checkers must render both ten-piece camps");
   assert.ok(geometry.maxTokenDelta<=.5,"All Chinese Checkers tokens must remain circular: "+JSON.stringify(geometry));
  }
  if(name==="飞行棋"||name==="西洋跳棋（8×8）"||name==="国际象棋"){
   const geometry=await frame.locator("#board").evaluate(el=>{const r=el.getBoundingClientRect();return{ratio:r.width/r.height,width:r.width,height:r.height};});
   assert.ok(Math.abs(geometry.ratio-1)<=.015,name+" board must preserve a square playing surface: "+JSON.stringify(geometry));
  }
  if(v.toolsVisible){
   assert.ok(v.tools.x>=v.main.right-2,name+" tools must dock at right without covering the playfield");
   assert.ok(v.main.width>=v.root.width*.68,name+" right rail leaves main board wide enough");
  }
  const header=await page.evaluate(()=>{
   const r=q=>{const a=q.getBoundingClientRect();return{x:a.x,right:a.right,y:a.y,bottom:a.bottom,width:a.width,centerX:a.x+a.width/2,centerY:a.y+a.height/2};};
   const bar=document.querySelector("#topbar"),timer=document.querySelector("#hostGameTimer"),notice=document.querySelector("#gameNotice");
   return{bar:r(bar),timer:r(timer),notice:r(notice),noticeParent:notice.parentElement.id,
    noticePosition:getComputedStyle(notice).position,noticeDisplay:getComputedStyle(notice).display,
    actions:[...bar.querySelectorAll("#startButton,#pauseButton,#newGameButton")].map(r),
    iconCount:bar.querySelectorAll("#startButton svg,#pauseButton svg,#newGameButton svg").length,
    visible:getComputedStyle(bar.querySelector("#gameActions")).display!=="none"};
  });
  assert.ok(header.visible&&header.iconCount===3,name+" all three SVG game buttons must be in the parent topbar");
  assert.ok(header.timer.right<header.notice.x,name+" session timer must stay in the left side of the top title bar: "+JSON.stringify(header));
  assert.equal(header.noticeParent,"topbar",name+" live status must occupy the center of the titlebar");
  assert.equal(header.noticePosition,"static",name+" titlebar notification must participate in the topbar grid");
  assert.notEqual(header.noticeDisplay,"none",name+" center notification region must remain present");
  assert.ok(Math.abs(header.notice.centerX-header.bar.centerX)<=Math.max(12,header.bar.width*.025),name+" notification region must be horizontally centered: "+JSON.stringify(header));
  assert.ok(Math.abs(header.notice.centerY-header.bar.centerY)<=2,name+" notification region must align with the titlebar: "+JSON.stringify(header));
  assert.ok(header.notice.width>=65,name+" central notification space should be readable");
  assert.ok(Math.max(...header.actions.map(x=>x.centerY))-Math.min(...header.actions.map(x=>x.centerY))<=2,name+" SVG controls vertically aligned");
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
  const now=Date.now(),d=new Date(now),today=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  const prior=new Date(now);prior.setDate(prior.getDate()-1);
  const yesterday=prior.getFullYear()+"-"+String(prior.getMonth()+1).padStart(2,"0")+"-"+String(prior.getDate()).padStart(2,"0");
  const first=new Date(now);first.setDate(first.getDate()-23);first.setHours(9,30,0,0);
  const fixture={
   stats:{
    tetris:{plays:4,wins:1,totalMs:240000,bestScore:1800,lastPlayed:today,lastPlayedAt:now-1000,days:{[today]:120000,[yesterday]:120000}},
    minesweeper:{plays:2,wins:1,totalMs:90000,bestScore:450,lastPlayed:today,lastPlayedAt:now-10000,days:{[today]:60000,[yesterday]:30000}},
    tank:{plays:1,wins:0,totalMs:45000,bestScore:0,lastPlayed:today,lastPlayedAt:now-5000,days:{[today]:45000}},
    gomoku:{plays:1,wins:0,totalMs:30000,bestScore:0,lastPlayed:yesterday,lastPlayedAt:now-100000,days:{[yesterday]:30000}}
   },
   firstStartedAt:first.getTime()
  };
  const homeUrl=pathToFileURL(path.join(root,"index.html")).href+"?p111Test=1&p111State="+encodeURIComponent(JSON.stringify(fixture));
  await page.goto(homeUrl);
  await page.locator("#homeDate").waitFor({state:"visible"});
  assert.equal(await page.locator(".brand-mark i").count(),4);
  assert.equal(await page.locator(".ranking-panel").count(),1,"Dashboard must retain its right ranking column");
  await page.locator("#heroFirstPlayed").waitFor({state:"visible"});
  assert.equal(await page.locator(".hero-metric").count(),5,"Banner must show exactly five usage metrics");
  assert.equal(await page.locator("#heroLastGame").innerText(),"俄罗斯方块","Most recent game metric must use last-play timestamp");
  assert.equal(await page.locator("#heroActiveDays").innerText(),"2 天","Usage days must count unique active dates, not game-days");
  assert.equal(await page.locator("#homeRecentList .recent-game").count(),4,"Recent strip must contain only games actually played");
  const recent=await page.locator("#homeRecentList .recent-game").evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.game,name:n.querySelector(".recent-copy strong").textContent.trim(),x:n.getBoundingClientRect().x,svg:!!n.querySelector(".game-icon-svg")})));
  assert.deepEqual(recent.map(x=>x.name),["俄罗斯方块","90 坦克","扫雷","五子棋"],"Recent games must be sorted newest-to-oldest");
  assert.ok(recent.every((x,i)=>i===0||x.x>recent[i-1].x),"Recent games must run left-to-right");
  assert.ok(recent.every(x=>x.svg),"Every recent game must use a local SVG icon, not an OS emoji glyph");
  assert.equal(await page.locator('#homeRecentList .recent-icon[data-game="tank"] .game-icon-svg').count(),1,"90 坦克 must have a dedicated vector icon");
  const recentFit=await page.locator("#homeRecentList .recent-game").evaluateAll(nodes=>nodes.map(n=>({name:n.querySelector(".recent-copy strong").textContent.trim(),textBottom:n.querySelector(".recent-copy").getBoundingClientRect().bottom,listBottom:n.parentElement.getBoundingClientRect().bottom})));
  assert.ok(recentFit.every(x=>x.textBottom<=x.listBottom+1),"Recent game labels must remain fully visible inside the strip: "+JSON.stringify(recentFit));
  assert.equal(await page.locator(".hero-kicker,.home-art,.quick-start,.featured-section").count(),0,"No decorative English kicker, duplicate category strip or featured library");
  assert.equal(await page.locator(".ranking-mark").innerText(),"前十名");
  async function homeLayoutCheck(width,height){
   await page.setViewportSize({width,height});
   // Wait for the browser's resize event / ResizeObserver animation frame to
   // apply the fixed-size desktop/compact dot preset before measuring the grid.
   await page.waitForFunction(()=>{
    const grid=document.querySelector("#heatmapGrid"),content=grid?.parentElement;
    return !!grid&&!!content&&Number.isFinite(Number(grid.dataset.availableWidth))&&
     Math.abs(Number(grid.dataset.availableWidth)-content.getBoundingClientRect().width)<=1.1;
   });
   const box=await page.locator("#homeView").evaluate(el=>{
    const rect=q=>{const r=q.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};};
    return{home:rect(el),main:rect(el.querySelector(".home-main")),hero:rect(el.querySelector(".home-hero")),
     heat:rect(el.querySelector(".activity-panel")),recent:rect(el.querySelector(".recent-panel")),ranking:rect(el.querySelector(".ranking-panel")),
     listDisplay:getComputedStyle(el.querySelector("#homeRecentList")).display,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,
     viewportHeight:window.innerHeight};
   });
   assert.ok(box.main.bottom>=box.home.bottom-22,"Main dashboard must use the full vertical area: "+JSON.stringify(box));
   assert.ok(box.ranking.bottom>=box.home.bottom-22,"Ranking must extend to the bottom edge: "+JSON.stringify(box));
   assert.ok(box.home.bottom>=box.viewportHeight-22,"Home view must reach the viewport bottom: "+JSON.stringify(box));
   assert.ok(box.heat.width>=box.main.width*.98,"Heatmap must occupy the full left-column width: "+JSON.stringify(box));
   assert.ok(box.recent.top>=box.heat.bottom-1&&box.recent.top-box.heat.bottom<=16,"Recent strip must sit directly below the heatmap without a large blank gap: "+JSON.stringify(box));
   assert.ok(box.heat.height>=box.main.height*.42,"Heatmap panel must absorb the available middle height: "+JSON.stringify(box));
   assert.ok(box.recent.bottom>=box.main.bottom-4,"Recent strip must sit at the bottom of the main column: "+JSON.stringify(box));
   assert.equal(box.listDisplay,"flex","Recent games must be a horizontal icon row");
   const visual=await page.evaluate(()=>{
    const grid=document.querySelector("#heatmapGrid"),content=grid.parentElement,layout=grid.closest(".heatmap-layout");
    const cell=grid.querySelector(".heatmap-cell:not(.empty)"),r=cell.getBoundingClientRect(),g=grid.getBoundingClientRect(),c=content.getBoundingClientRect();
    const metric=getComputedStyle(document.querySelector(".hero-metric")),recent=getComputedStyle(document.querySelector(".recent-game"));
    const compact=window.innerWidth<=1100,expectedCell=compact?9:11,expectedGap=compact?2:3;
    return{dot:{width:r.width,height:r.height,autoColumn:getComputedStyle(grid).gridAutoColumns,gridWidth:g.width,contentWidth:c.width,gridLeft:g.left,contentLeft:c.left},
     metric:{border:[metric.borderTopWidth,metric.borderRightWidth,metric.borderBottomWidth,metric.borderLeftWidth].join("/"),background:metric.backgroundColor},
     recent:{border:[recent.borderTopWidth,recent.borderRightWidth,recent.borderBottomWidth,recent.borderLeftWidth].join("/"),background:recent.backgroundColor},
     weekdayRow:parseFloat(getComputedStyle(layout.querySelector(".heatmap-weekdays")).gridTemplateRows.split(" ")[0]),
     measuredContentWidth:Number(grid.dataset.availableWidth),computedCellSize:Number(grid.dataset.cellSize),expectedCell,expectedGap};
   });
   assert.ok(Math.abs(visual.dot.width-visual.dot.height)<.5&&Math.abs(visual.dot.width-visual.expectedCell)<.5,"Heatmap must preserve the original compact square dots (11px desktop / 9px compact): "+JSON.stringify(visual));
   assert.ok(Math.abs(parseFloat(visual.dot.autoColumn)-visual.dot.width)<.5,"Heatmap implicit columns must match the square dot size: "+JSON.stringify(visual));
   assert.ok(Math.abs(visual.weekdayRow-visual.dot.height)<.5,"Weekday labels must align with the heatmap row pitch: "+JSON.stringify(visual));
   assert.ok(visual.measuredContentWidth>=visual.dot.contentWidth*.95,"Heatmap sizing must use the rendered content width, not a stale clientWidth: "+JSON.stringify(visual));
   assert.ok(Math.abs(visual.computedCellSize-visual.dot.width)<.5,"The computed heatmap cell size must match the rendered dot size: "+JSON.stringify(visual));
   const expectedGridWidth=53*visual.expectedCell+52*visual.expectedGap;
   assert.ok(Math.abs(visual.dot.gridWidth-expectedGridWidth)<1,"53-week heatmap must retain the original compact density: "+JSON.stringify(visual));
   assert.ok(Math.abs((visual.dot.gridLeft+visual.dot.gridWidth/2)-(visual.dot.contentLeft+visual.dot.contentWidth/2))<2,"The small dot matrix must be centered inside the full-width activity panel: "+JSON.stringify(visual));
   assert.equal(visual.metric.border,"0px/0px/0px/0px","Banner metrics must not be individual bordered cards: "+JSON.stringify(visual));
   assert.equal(visual.metric.background,"rgba(0, 0, 0, 0)","Banner metrics must not have individual tile backgrounds: "+JSON.stringify(visual));
   assert.equal(visual.recent.border,"0px/0px/0px/0px","Recent games must not be miniature bordered cards: "+JSON.stringify(visual));
   assert.equal(visual.recent.background,"rgba(0, 0, 0, 0)","Recent games must be an unboxed icon strip: "+JSON.stringify(visual));
   assert.ok(box.scrollHeight<=box.clientHeight+2,"Home must not leave content below the viewport");
  }
  await homeLayoutCheck(1752,860);
  await page.screenshot({path:path.join(artifacts,"home-1752x860.png")});
  await homeLayoutCheck(1366,768);
  await homeLayoutCheck(1440,1000);
  await page.screenshot({path:path.join(artifacts,"home-1440x1000.png")});
  let noticeChecked=false;
  await library();
  assert.equal(await page.locator(".game-card").count(),24);
  assert.equal(await page.locator(".game-card .game-icon-svg").count(),24,"All 24 library games must have a local SVG pictogram");
  assert.equal(await page.locator(".game-card .game-icon-svg").first().evaluate(el=>el.namespaceURI),"http://www.w3.org/2000/svg","Inline SVG must retain the SVG DOM namespace without a remote URL literal");
  const iconColors=await page.locator('.game-card-icon[data-game="gomoku"],.game-card-icon[data-game="tank"]').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).color));
  assert.notEqual(iconColors[0],iconColors[1],"Board and arcade icons must use distinct category colors");
  assert.equal(await page.locator('.game-card .game-card-icon[data-game="tank"] .game-icon-svg').count(),1,"The 90 tank library icon must not depend on emoji font support");
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
    const r=await page.locator("#gameNotice").evaluate(el=>{const x=el.getBoundingClientRect(),b=document.querySelector("#topbar").getBoundingClientRect();return{top:x.top,bottom:x.bottom,centerX:x.left+x.width/2,centerY:x.top+x.height/2,barTop:b.top,barBottom:b.bottom,barCenterX:b.left+b.width/2,message:el.textContent,parent:el.parentElement.id};});
    assert.equal(r.parent,"topbar","live status must be rendered in the topbar center");
    assert.ok(r.top>=r.barTop-1&&r.bottom<=r.barBottom+1,"game notices must stay inside the titlebar, never below the game");
    assert.ok(Math.abs(r.centerX-r.barCenterX)<=Math.max(12,(r.barBottom-r.barTop)*.5+8),"live notice must be horizontally centered in the titlebar: "+JSON.stringify(r));
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
  assert.ok(Math.abs(xiangqiRatio.width-xiangqiRatio.height)<=.5,"Xiangqi pieces must be mathematically square before border-radius, not elliptical: "+JSON.stringify(xiangqiRatio));
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
  // Xiangqi cannon rules: exactly one screen permits capture; zero/two screens and friendly targets do not.
  const cannonPage=await browser.newPage({viewport:{width:1100,height:850}});
  cannonPage.on("pageerror",err=>errors.push("Xiangqi rules: "+err.message));
  await cannonPage.goto(pathToFileURL(path.resolve(root,"games/xiangqi/index.html")).href+"?p111Test=1");
  await cannonPage.waitForFunction(()=>typeof window.__p111XiangqiTest?.loadPosition==="function");
  const cannonLoad=(pieces,side="red")=>cannonPage.evaluate(([p,s])=>window.__p111XiangqiTest.loadPosition(p,s),[pieces,side]);
  const cannonMoves=()=>cannonPage.evaluate(()=>window.__p111XiangqiTest.legal("red"));
  const cannonBase=[[4,0,"black","将"],[4,9,"red","帅"],[4,6,"red","兵"]];
  await cannonLoad([...cannonBase,[0,7,"red","炮"],[0,5,"red","兵"],[0,2,"black","车"]]);
  assert.equal((await cannonMoves()).some(m=>m.fx===0&&m.fy===7&&m.tx===0&&m.ty===2),true,"one cannon screen permits capture");
  await cannonPage.locator('.xiangqi-cell[data-x="0"][data-y="7"]').click();
  await cannonPage.locator('.xiangqi-cell[data-x="0"][data-y="2"]').click();
  assert.match(await cannonPage.locator('.xiangqi-cell[data-x="0"][data-y="2"]').getAttribute("aria-label"),/红炮/,"cannon must actually capture through one screen");
  await cannonLoad([...cannonBase,[0,7,"red","炮"],[0,2,"black","车"]]);
  assert.equal((await cannonMoves()).some(m=>m.fx===0&&m.fy===7&&m.tx===0&&m.ty===2),false,"cannon cannot capture without a screen");
  await cannonLoad([...cannonBase,[0,7,"red","炮"],[0,5,"red","兵"],[0,3,"black","卒"],[0,2,"black","车"]]);
  const boundedCannon=await cannonMoves();
  assert.equal(boundedCannon.some(m=>m.fx===0&&m.fy===7&&m.tx===0&&m.ty===3),true,"cannon captures the first enemy beyond one screen");
  assert.equal(boundedCannon.some(m=>m.fx===0&&m.fy===7&&m.tx===0&&m.ty===2),false,"cannon cannot jump over the first occupied target");
  await cannonLoad([...cannonBase,[0,7,"red","炮"],[0,5,"red","兵"],[0,2,"red","车"]]);
  assert.equal((await cannonMoves()).some(m=>m.fx===0&&m.fy===7&&m.tx===0&&m.ty===2),false,"cannon cannot capture a friendly piece");
  await cannonPage.close();
  assert.deepEqual(remote,[],"No remote HTTP/CDN resources are permitted in file:// mode");
  assert.deepEqual(errors,[],"No uncaught errors in host or game frames");
  console.log("P111 R19 Chromium regression passed: 24 games × two desktop viewports (48 screenshots), left timer, central notices, SVG controls, Tetris preview/score, chess and arcade lifecycle.");
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exit(1);});
