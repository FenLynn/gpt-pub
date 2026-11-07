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
   if(name==="五子棋"){
    assert.ok(v.tools.x-v.surface.right<=38,"Gomoku action rail must sit immediately next to the board: "+JSON.stringify(v));
    assert.ok(v.main.width>=v.root.width*.46,"Gomoku board must retain enough playfield width: "+JSON.stringify(v));
   }else assert.ok(v.main.width>=v.root.width*.68,name+" right rail leaves main board wide enough");
  }
  const header=await page.evaluate(()=>{
   const r=q=>{const a=q.getBoundingClientRect();return{x:a.x,right:a.right,y:a.y,bottom:a.bottom,width:a.width,centerX:a.x+a.width/2,centerY:a.y+a.height/2};};
   const bar=document.querySelector("#topbar"),timer=document.querySelector("#hostGameTimer"),notice=document.querySelector("#gameNotice");
   return{bar:r(bar),timer:r(timer),notice:r(notice),crumb:r(bar.querySelector(".breadcrumbs")),mode:r(bar.querySelector("#gameControls")),actionArea:r(bar.querySelector(".topbar-actions")),
    noticeParent:notice.parentElement.id,
    noticePosition:getComputedStyle(notice).position,noticeDisplay:getComputedStyle(notice).display,
    actions:[...bar.querySelectorAll("#startButton,#pauseButton,#newGameButton")].map(r),
    iconCount:bar.querySelectorAll("#startButton svg,#pauseButton svg,#newGameButton svg").length,
    visible:getComputedStyle(bar.querySelector("#gameActions")).display!=="none"};
  });
  assert.ok(header.visible&&header.iconCount===3,name+" all three SVG game buttons must be in the parent topbar");
  assert.ok(header.crumb.right<=header.notice.x+2,name+" LED notice must sit after the game breadcrumb");
  assert.ok(header.notice.right<=header.timer.x+2,name+" timer must sit to the right of the LED display");
  if(header.mode.width>0){
   assert.ok(header.timer.right<=header.mode.x+2,name+" mode switches must sit after the timer");
   assert.ok(header.mode.right<=header.actionArea.x+2,name+" game buttons must follow the mode and difficulty switches");
  }else assert.ok(header.timer.right<=header.actionArea.x+2,name+" action buttons must sit after the timer");
  assert.equal(header.noticeParent,"topbar",name+" live status must occupy the center of the titlebar");
  assert.equal(header.noticePosition,"static",name+" titlebar notification must participate in the topbar grid");
  assert.notEqual(header.noticeDisplay,"none",name+" center notification region must remain present");
  if(name==="五子棋"){
   assert.ok(header.notice.width>=(width<=1390?195:214)&&header.notice.width<=285,name+" Gomoku LED must remain longer while fitting the desktop header: "+JSON.stringify(header));
   const led=await page.locator("#gameNotice").evaluate(box=>{
    const speaker=box.querySelector(".game-notice-speaker"),window=box.querySelector(".game-notice-window"),
      label=box.querySelector(".game-notice-text"),screen=getComputedStyle(window),text=getComputedStyle(label);
    return{speakerRight:speaker.getBoundingClientRect().right,screenLeft:window.getBoundingClientRect().left,
      screenWidth:window.getBoundingClientRect().width,textColor:text.color,textFont:parseFloat(text.fontSize),
      screenPaddingTop:parseFloat(screen.paddingTop),screenBackground:screen.backgroundColor,
      modeBorder:getComputedStyle(document.querySelector("#modeControl")).borderTopWidth,
      difficultyBorder:getComputedStyle(document.querySelector("#difficultyControl")).borderTopWidth};
   });
   assert.ok(led.speakerRight<led.screenLeft&&led.screenWidth>=(width<=1390?165:180),"Gomoku speaker belongs outside a long LED screen: "+JSON.stringify(led));
   assert.ok(led.textColor==="rgb(255, 255, 255)"&&led.textFont>=14&&led.screenPaddingTop<=3,"Gomoku LED must have large white tightly-spaced text: "+JSON.stringify(led));
   assert.equal(led.modeBorder,"1px","Gomoku mode switches need a shared outline");
   assert.equal(led.difficultyBorder,"1px","Gomoku difficulty switches need a shared outline");
   if(width<=1390){
    const breadcrumb=await page.locator("#topbar .breadcrumbs").evaluate(el=>{
     const r=el.getBoundingClientRect(),b=document.querySelector("#topbar").getBoundingClientRect();
     return{left:r.left,barLeft:b.left,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,text:el.innerText};
    });
    assert.ok(breadcrumb.left>=breadcrumb.barLeft+3&&breadcrumb.scrollWidth<=breadcrumb.clientWidth+2,
     "Narrow desktop Gomoku breadcrumb must not be clipped: "+JSON.stringify(breadcrumb));
   }
  }else assert.ok(header.notice.width>=110&&header.notice.width<=135,name+" Other games must keep their existing LED size");
  assert.ok(Math.abs(header.notice.centerY-header.bar.centerY)<=2,name+" notification region must align with the titlebar: "+JSON.stringify(header));
  const crumb=await page.evaluate(()=>({name:document.querySelector("#breadcrumbCategory").textContent.trim(),
   gameSeparator:!document.querySelector("#crumbGameSep").classList.contains("hidden"),
   gameName:!document.querySelector("#breadcrumbGame").classList.contains("hidden")}));
  assert.equal(crumb.name,name,name+" titlebar breadcrumb must identify the active game");
  assert.equal(crumb.gameSeparator,false,name+" titlebar must not show an empty second breadcrumb separator");
  assert.equal(crumb.gameName,false,name+" active game name must not be squeezed out by duplicate breadcrumb text");
  assert.equal(await page.locator("#railToggleButton").count(),0,name+" obsolete fold button must be removed");
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
    xiangqi:{plays:1,wins:0,totalMs:40000,bestScore:420,lastPlayed:today,lastPlayedAt:now-15000,days:{}},
    reversi:{plays:1,wins:0,totalMs:38000,bestScore:380,lastPlayed:today,lastPlayedAt:now-20000,days:{}},
    connect4:{plays:1,wins:0,totalMs:36000,bestScore:360,lastPlayed:today,lastPlayedAt:now-25000,days:{}},
    battleship:{plays:1,wins:0,totalMs:34000,bestScore:340,lastPlayed:today,lastPlayedAt:now-30000,days:{}},
    "chinese-checkers":{plays:1,wins:0,totalMs:32000,bestScore:320,lastPlayed:today,lastPlayedAt:now-35000,days:{}},
    "flight-chess":{plays:1,wins:0,totalMs:30000,bestScore:300,lastPlayed:today,lastPlayedAt:now-40000,days:{}},
    checkers:{plays:1,wins:0,totalMs:28000,bestScore:280,lastPlayed:today,lastPlayedAt:now-45000,days:{}},
    chess:{plays:1,wins:0,totalMs:26000,bestScore:260,lastPlayed:today,lastPlayedAt:now-50000,days:{}},
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
  assert.deepEqual(await page.locator(".hero-metric-label").allInnerTexts(),["首次开始游戏","已使用天数","累计时间","今日时间","最近游戏"],"Recent game metric must occupy the rightmost column");
  const clockSizes=await page.evaluate(()=>({date:parseFloat(getComputedStyle(document.querySelector("#homeDate")).fontSize),time:parseFloat(getComputedStyle(document.querySelector("#homeTime")).fontSize)}));
  assert.ok(Math.abs(clockSizes.date-clockSizes.time)<=1,"Home clock must be as prominent as the date: "+JSON.stringify(clockSizes));
  assert.equal(await page.locator("#homeRecentList .recent-game").count(),9,"Recent tab must show exactly nine real played games");
  const recent=await page.locator("#homeRecentList .recent-game").evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.game,name:n.querySelector(".recent-copy strong").textContent.trim(),x:n.getBoundingClientRect().x,
    icon:n.querySelector(".game-icon-glyph")?.textContent.trim(),hasTankSvg:!!n.querySelector(".game-tank-icon")})));
  assert.deepEqual(recent.map(x=>x.name),["俄罗斯方块","90 坦克","扫雷","中国象棋","黑白棋","四子棋","海战棋","中国跳棋","飞行棋"],"Recent games must show the nine newest games in order");
  assert.ok(recent.every((x,i)=>i%3===0||x.x>recent[i-1].x),"Recent games must run left-to-right within each row");
  assert.ok(recent.every(x=>x.id==="tank"?(x.hasTankSvg&&!x.icon):(!!x.icon&&!x.hasTankSvg)),"Only 90 Tank must use a sourced tank vector; other games keep their familiar glyphs");
  assert.equal(await page.locator('#homeRecentList .recent-icon[data-game="tank"] .game-tank-icon').count(),1,"90 Tank must use the sourced top-view tank vector");
  const recentFit=await page.locator("#homeRecentList .recent-game").evaluateAll(nodes=>nodes.map(n=>({name:n.querySelector(".recent-copy strong").textContent.trim(),textBottom:n.querySelector(".recent-copy").getBoundingClientRect().bottom,listBottom:n.parentElement.getBoundingClientRect().bottom})));
  assert.ok(recentFit.every(x=>x.textBottom<=x.listBottom+1),"Recent tab labels must remain fully visible inside the list: "+JSON.stringify(recentFit));
  assert.equal(await page.locator(".recent-tab").count(),2,"Recent games must offer recent/popular tabs");
  assert.equal(await page.locator("#homeGamePoster").count(),1,"Right-hand rotating game poster must exist");
  const posterDesign=await page.locator("#homeGamePoster").evaluate(poster=>{
   const rect=el=>el.getBoundingClientRect(),art=rect(poster.querySelector(".poster-art")),intro=rect(poster.querySelector(".poster-copy")),
    tip=rect(poster.querySelector(".poster-tips")),play=rect(poster.querySelector("#homePosterPlay")),
    count=rect(poster.querySelector("#homePosterCount")),dots=rect(poster.querySelector(".poster-dots")),outer=rect(poster);
   return{art,intro,tip,play,count,dots,outer,
    tipFont:parseFloat(getComputedStyle(poster.querySelector(".poster-tips p")).fontSize),
    introFont:parseFloat(getComputedStyle(poster.querySelector(".poster-copy p")).fontSize),
    titleFont:parseFloat(getComputedStyle(poster.querySelector(".poster-copy h3")).fontSize),
    tipText:poster.querySelector("#homePosterTip").textContent};
  });
  assert.ok(posterDesign.art.left-posterDesign.outer.left<70&&posterDesign.art.top-posterDesign.outer.top<90,"Poster icon must stay upper left: "+JSON.stringify(posterDesign));
  assert.ok(posterDesign.intro.left>posterDesign.art.right+8&&posterDesign.intro.top<posterDesign.outer.top+posterDesign.outer.height*.5,"Game information must move to the upper right: "+JSON.stringify(posterDesign));
  assert.ok(posterDesign.tip.left>=posterDesign.intro.left-2&&posterDesign.tip.top>posterDesign.intro.bottom-2,"Tips must stay in the right column below the game information: "+JSON.stringify(posterDesign));
  assert.ok(posterDesign.play.top>=posterDesign.art.bottom-1&&Math.abs((posterDesign.play.left+posterDesign.play.right)/2-(posterDesign.art.left+posterDesign.art.right)/2)<12,"Play button must sit directly below and align with the icon: "+JSON.stringify(posterDesign));
  assert.ok(posterDesign.count.left-posterDesign.outer.left<80&&posterDesign.count.top>posterDesign.outer.top+posterDesign.outer.height*.7&&posterDesign.dots.top>posterDesign.outer.top+posterDesign.outer.height*.7&&posterDesign.dots.left<posterDesign.outer.left+posterDesign.outer.width*.55,"Poster number and dots must both move to the lower left: "+JSON.stringify(posterDesign));
  assert.ok(posterDesign.tipFont>=13&&posterDesign.introFont>=13&&posterDesign.titleFont>=22&&posterDesign.tipText.length>3,"Poster game information and tips must remain readable: "+JSON.stringify(posterDesign));
  assert.equal(await page.locator("#homePosterProgress,.poster-progress").count(),0,"Poster progress bar must be removed");
  const homePreviewButton=page.locator("#homeRecentList .recent-game").nth(1);
  const homePreviewGameId=await homePreviewButton.getAttribute("data-game");
  await homePreviewButton.click();
  assert.equal(await page.locator("#homeGamePoster").getAttribute("data-game"),homePreviewGameId,"Single click on a recent game must only update the poster preview");
  await page.locator("#homeRecentList .recent-game").nth(1).dblclick();
  await page.locator("#workspaceView:not(.hidden)").waitFor({state:"visible"});
  assert.equal(await page.locator("#libraryView").evaluate(el=>el.classList.contains("hidden")),true,"Double-clicking a recent game must launch it directly, not open its category");
  await page.locator("[data-view='home']").first().click();
  await page.locator("#homeDate").waitFor({state:"visible"});
  await page.locator("#homePosterPlay").click();
  await page.locator("#workspaceView:not(.hidden)").waitFor({state:"visible"});
  assert.equal(await page.locator("#libraryView").evaluate(el=>el.classList.contains("hidden")),true,"Poster play button must launch directly, not open a category");
  await page.locator("[data-view='home']").first().click();
  await page.locator("#homeDate").waitFor({state:"visible"});
  const posterBefore=await page.locator("#homeGamePoster").getAttribute("data-poster-index");
  await page.waitForFunction(old=>document.querySelector("#homeGamePoster")?.dataset.posterIndex!==old,posterBefore,{timeout:8500});
  await page.locator('[data-recent-tab="popular"]').click();
  assert.equal(await page.locator('[data-recent-tab="popular"]').getAttribute("aria-selected"),"true");
  await page.locator('[data-recent-tab="recent"]').click();
  assert.equal(await page.locator(".hero-kicker,.home-art,.quick-start,.featured-section,.hero-description,#recentSubtitle").count(),0,"No banner/recent annotation, decorative kicker or duplicate game library");
  assert.equal(await page.locator(".ranking-mark").innerText(),"前十名");
  assert.equal(await page.locator(".ranking-trophy").innerText(),"🏆","Leaderboard must show a trophy mark");
  assert.equal(await page.locator(".ranking-heading p").count(),0,"Remove the redundant local-record subtitle");
  assert.deepEqual(await page.locator("#rankingList .ranking-medal").allInnerTexts(),["🥇","🥈","🥉"],"Top three ranks must use gold, silver and bronze medals");
  assert.equal(await page.locator("#activityRange").innerText(),"近 12 个月");
  assert.ok(!(await page.locator("#activitySummary").innerText()).includes("近 12 个月"),"The activity period must not be duplicated");
  assert.deepEqual(await page.locator(".heatmap-weekdays span").allInnerTexts(),["周一","周三","周五"],"Weekday labels must be explicit");
  async function homeLayoutCheck(width,height){
   await page.setViewportSize({width,height});
   // Wait for the ResizeObserver to recalculate proportional square heatmap cells
   // after each desktop viewport change.
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
   assert.ok(box.heat.height<box.main.height*.43,"Heatmap panel should only wrap the matrix rather than absorb free height: "+JSON.stringify(box));
   assert.ok(box.recent.height>box.heat.height,"Recently played games must get more height than the compact heatmap: "+JSON.stringify(box));
   assert.ok(box.hero.height<=126,"Banner must be shorter than the previous 156px: "+JSON.stringify(box));
   assert.ok(box.recent.bottom>=box.main.bottom-4,"Recent strip must sit at the bottom of the main column: "+JSON.stringify(box));
   assert.equal(box.listDisplay,"grid","Recent games must be selectable tabs on the left");
   const visual=await page.evaluate(()=>{
    const grid=document.querySelector("#heatmapGrid"),content=grid.parentElement,layout=grid.closest(".heatmap-layout");
    const cell=grid.querySelector(".heatmap-cell:not(.empty)"),r=cell.getBoundingClientRect(),g=grid.getBoundingClientRect(),c=content.getBoundingClientRect();
    const metric=getComputedStyle(document.querySelector(".hero-metric")),recent=getComputedStyle(document.querySelector(".recent-game"));
    const measured=Math.floor(c.width),narrow=window.innerWidth<=700,expectedGap=narrow?2:(measured<850?2:3);
    const expectedCell=Math.max(1,Math.floor(Math.max(0,(c.width-(Number(grid.dataset.weeks)-1)*expectedGap)/Number(grid.dataset.weeks))*100)/100);
    return{dot:{width:r.width,height:r.height,autoColumn:getComputedStyle(grid).gridAutoColumns,gridWidth:g.width,contentWidth:c.width,gridLeft:g.left,contentLeft:c.left},
     metric:{border:[metric.borderTopWidth,metric.borderRightWidth,metric.borderBottomWidth,metric.borderLeftWidth].join("/"),background:metric.backgroundColor},
     recent:{border:[recent.borderTopWidth,recent.borderRightWidth,recent.borderBottomWidth,recent.borderLeftWidth].join("/"),background:recent.backgroundColor},
     weekdayRow:parseFloat(getComputedStyle(layout.querySelector(".heatmap-weekdays")).gridTemplateRows.split(" ")[0]),
     weekdayLabelWidth:layout.querySelector(".heatmap-weekdays").getBoundingClientRect().width,
     weekdayLabels:[...layout.querySelectorAll(".heatmap-weekdays span")].map(el=>{const r=el.getBoundingClientRect();return r.top+r.height/2;}),
     dotRows:[0,2,4].map(i=>{const r=grid.children[i].getBoundingClientRect();return r.top+r.height/2;}),
     recentIconWidth:parseFloat(getComputedStyle(document.querySelector("#homeRecentList .recent-icon")).width),
     weeks:Number(grid.dataset.weeks),measuredContentWidth:Number(grid.dataset.availableWidth),computedCellSize:Number(grid.dataset.cellSize),expectedCell,expectedGap};
   });
   assert.ok(Math.abs(visual.dot.width-visual.dot.height)<.5&&Math.abs(visual.dot.width-visual.expectedCell)<.5,"Heatmap dots must fill the panel as equal square cells: "+JSON.stringify(visual));
   assert.ok(Math.abs(parseFloat(visual.dot.autoColumn)-visual.dot.width)<.5,"Heatmap implicit columns must match the square dot size: "+JSON.stringify(visual));
   assert.ok(Math.abs(visual.weekdayRow-visual.dot.height)<.5,"Weekday labels must align with the heatmap row pitch: "+JSON.stringify(visual));
   assert.ok(visual.weekdayLabelWidth>=28,"Weekday labels must have enough width to read: "+JSON.stringify(visual));
   assert.ok(visual.weekdayLabels.every((y,i)=>Math.abs(y-visual.dotRows[i])<1.5),"Weekday labels must align with Monday, Wednesday and Friday dot rows: "+JSON.stringify(visual));
   assert.ok(visual.recentIconWidth>=40&&visual.recentIconWidth<=64,"Twelve game icons must be legible and remain uncut: "+JSON.stringify(visual));
   assert.ok(visual.measuredContentWidth>=visual.dot.contentWidth*.95,"Heatmap sizing must use the rendered content width, not a stale clientWidth: "+JSON.stringify(visual));
   assert.ok(Math.abs(visual.computedCellSize-visual.dot.width)<.5,"The computed heatmap cell size must match the rendered dot size: "+JSON.stringify(visual));
   const expectedGridWidth=visual.weeks*visual.expectedCell+(visual.weeks-1)*visual.expectedGap;
   assert.ok(Math.abs(visual.dot.gridWidth-expectedGridWidth)<1,"53-week heatmap width must match its computed square-cell geometry: "+JSON.stringify(visual));
   assert.ok(visual.dot.gridWidth<=visual.dot.contentWidth+1,"53-week matrix must not overflow its activity panel: "+JSON.stringify(visual));
   assert.ok(visual.dot.gridWidth>=visual.dot.contentWidth*.985,"All 53 weeks must occupy the panel width rather than leaving blank space: "+JSON.stringify(visual));
   assert.ok(Math.abs(visual.dot.gridLeft-visual.dot.contentLeft)<=2,"The first week must begin at the left edge of the heatmap content: "+JSON.stringify(visual));
   assert.equal(visual.metric.border,"0px/0px/0px/0px","Banner metrics must not be individual bordered cards: "+JSON.stringify(visual));
   assert.equal(visual.metric.background,"rgba(0, 0, 0, 0)","Banner metrics must not have individual tile backgrounds: "+JSON.stringify(visual));
   assert.ok(visual.recent.border==="1px/1px/1px/1px"||visual.recent.border==="0px/0px/0px/0px","Recent game tabs must use only subtle borders: "+JSON.stringify(visual));
   assert.ok(visual.recent.background,"Recent tabs must use lightweight backgrounds: "+JSON.stringify(visual));
   assert.ok(box.scrollHeight<=box.clientHeight+2,"Home must not leave content below the viewport");
  }
  await homeLayoutCheck(1752,860);
  const dot=page.locator("#heatmapGrid .heatmap-cell:not(.empty)").first();
  const dotBefore=await dot.boundingBox();await dot.hover();await page.waitForTimeout(220);
  const dotAfter=await dot.boundingBox();assert.ok(dotAfter.y<dotBefore.y-1,"Heatmap cell must lift visibly when hovered");
  await page.mouse.move(5,5);
  await page.screenshot({path:path.join(artifacts,"home-1752x860.png")});
  await homeLayoutCheck(1366,768);
  await homeLayoutCheck(1440,1000);
  await page.screenshot({path:path.join(artifacts,"home-1440x1000.png")});
  const gridEvidence=await page.locator("#homeRecentList").evaluate(list=>{
    const items=[...list.querySelectorAll(".recent-game")],first=items[0]?.querySelector(".recent-icon");
    const icon=first?.getBoundingClientRect(),panel=list.getBoundingClientRect(),style=first&&getComputedStyle(first);
    return {iconWidth:icon?.width||0,iconHeight:icon?.height||0,iconOverflow:style?.overflow,rows:items.length,panelHeight:panel.height};
  });
  assert.ok(gridEvidence.iconWidth>=64&&gridEvidence.iconWidth<=72&&gridEvidence.iconHeight>=64&&gridEvidence.iconHeight<=72&&gridEvidence.iconOverflow==="visible","Three-by-three recent game icons must be large and never clipped: "+JSON.stringify(gridEvidence));
  const fourRows=await page.locator("#homeRecentList").evaluate(list=>{
    const coords=[...list.querySelectorAll(".recent-game")].map(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y};});
    const rows=[...new Set(coords.map(p=>Math.round(p.y)))];
    return {coords,rows};
  });
  assert.ok(fourRows.coords.length===9&&fourRows.rows.length===3,"Recent games must form exactly three rows: "+JSON.stringify(fourRows));
  for(let row=0;row<3;row++){
    const group=fourRows.coords.slice(row*3,row*3+3);
    assert.ok(group.every(p=>Math.abs(p.y-group[0].y)<2),"Recent games must have three aligned columns: "+JSON.stringify(fourRows));
    assert.ok(group.every((p,i)=>i===0||p.x>group[i-1].x),"Each recent row must read left to right: "+JSON.stringify(fourRows));
  }
  let noticeChecked=false;
  await library();
  assert.equal(await page.locator(".game-card").count(),24);
  assert.equal(await page.locator(".game-card .game-icon-glyph").count(),23,"All 23 non-tank games must keep their existing pictograms");
  assert.equal(await page.locator(".game-card .game-icon-svg").count(),0,"The old unsourced game logo SVGs must not be used");
  const tankVector=await page.locator('.game-card-icon[data-game="tank"] .game-tank-icon').evaluate(svg=>({
    ns:svg.namespaceURI,viewBox:svg.getAttribute("viewBox"),path:!!svg.querySelector("path"),
    pathLength:svg.querySelector("path")?.getAttribute("d")?.length||0,
    width:svg.getBoundingClientRect().width,height:svg.getBoundingClientRect().height
  }));
  assert.equal(tankVector.ns,"http://www.w3.org/2000/svg","The sourced 90 Tank icon must be crisp native SVG");
  assert.equal(tankVector.viewBox,"0 0 512 512");
  assert.ok(tankVector.path&&tankVector.pathLength>900&&tankVector.width>24&&tankVector.height>24,"90 Tank must render the detailed armored tank vehicle, not a tank-top clothing icon");
  assert.equal(await page.locator('.game-card-icon[data-game="minesweeper"] .game-icon-glyph').innerText(),"💣","Minesweeper must use the familiar bomb pictogram");
  assert.equal(await page.locator('.game-card-icon[data-game="tank"] .game-tank-icon').count(),1,"90 Tank must use a sourced tank-top SVG");
  assert.equal(await page.locator('.game-card-icon[data-game="mahjong"] .game-icon-glyph').innerText(),"🀄","Mahjong must use the familiar mahjong tile pictogram");
  const iconCategories=await page.locator('.game-card-icon[data-game="gomoku"],.game-card-icon[data-game="tank"]').evaluateAll(nodes=>nodes.map(n=>n.dataset.category));
  assert.deepEqual(iconCategories,["board","arcade"],"System pictograms must retain their board/arcade category metadata");
  assert.equal(await page.locator('.game-card .game-card-icon[data-game="tank"] .game-tank-icon').count(),1,"The 90 tank library icon must show the non-rasterized vector");
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
    await frame.locator("#game").evaluate(()=>window.GameBridge.report("已暂停"));
    await page.locator("#gameNotice.visible").waitFor({timeout:1500});
    const r=await page.locator("#gameNotice").evaluate(el=>{const x=el.getBoundingClientRect(),b=document.querySelector("#topbar").getBoundingClientRect();return{top:x.top,bottom:x.bottom,x:x.left,right:x.right,width:x.width,centerX:x.left+x.width/2,centerY:x.top+x.height/2,barTop:b.top,barBottom:b.bottom,barCenterX:b.left+b.width/2,message:el.textContent,parent:el.parentElement.id};});
    assert.equal(r.parent,"topbar","live status must be rendered in the topbar center");
    assert.ok(r.top>=r.barTop-1&&r.bottom<=r.barBottom+1,"game notices must stay inside the titlebar, never below the game");
    assert.ok(r.width>=214&&r.width<=285,"Gomoku LED must be about twice the former width: "+JSON.stringify(r));
    assert.match(r.message,/已暂停/);
    const shortLed=await page.locator("#gameNotice").evaluate(el=>{
     const window=el.querySelector(".game-notice-window"),text=el.querySelector(".game-notice-text");
     return{marquee:el.classList.contains("marquee"),align:getComputedStyle(window).justifyContent,weight:getComputedStyle(text).fontWeight};
    });
    assert.deepEqual(shortLed,{marquee:false,align:"center",weight:"400"},"Short LED text must be regular-weight and centered: "+JSON.stringify(shortLed));
    await frame.locator("#game").evaluate(()=>window.GameBridge.report("这是一段专门用于检查顶部LED在内容较长时能够自动滚动播放的状态提示文字"));
    await page.waitForFunction(()=>document.querySelector("#gameNotice")?.classList.contains("marquee"),{timeout:1500});
    const longLed=await page.locator("#gameNotice").evaluate(el=>{
     const window=el.querySelector(".game-notice-window"),text=el.querySelector(".game-notice-text");
     return{align:getComputedStyle(window).justifyContent,weight:getComputedStyle(text).fontWeight,animation:getComputedStyle(text).animationName};
    });
    assert.equal(longLed.align,"flex-start","Long LED text must scroll from the left edge");
    assert.equal(longLed.weight,"400","Long LED text must remain regular-weight");
    assert.equal(longLed.animation,"led-scroll","Long LED text must animate horizontally: "+JSON.stringify(longLed));
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
  assert.equal(await frame.locator("#gameWorkspaceStyles").count(),1,"Gomoku shared stylesheet must be preloaded");
  assert.equal(await frame.locator(".game-guide").evaluate(el=>getComputedStyle(el).display),"none","Legacy left guide must never be visible");
  assert.equal(await frame.locator("#status").evaluate(el=>getComputedStyle(el).display),"none","Right-side paused status must be removed");
  const goStyle=await frame.locator("#board").evaluate(el=>({wood:getComputedStyle(el).backgroundImage,
   xBottom:el.querySelector(".gomoku-axis-x").getBoundingClientRect().bottom,boardBottom:el.getBoundingClientRect().bottom,
   yFont:parseFloat(getComputedStyle(el.querySelector(".gomoku-axis-y")).fontSize)}));
  assert.ok(!goStyle.wood.includes("repeating-linear-gradient"),"Gomoku wooden board must have no horizontal stripes");
  assert.ok(goStyle.xBottom<=goStyle.boardBottom+1,"Gomoku A–O labels must be inside the wooden board");
  assert.ok(goStyle.yFont>=14,"Gomoku row coordinates must be enlarged");
  await page.screenshot({path:path.join(artifacts,"gomoku-playing-1440x1000.png")});
  await frame.locator('#game').evaluate(()=>window.__p111GomokuTest.forceFinish(1));
  await frame.locator("#gomokuResult:not([hidden])").waitFor({timeout:4000});
  assert.equal(await frame.locator(".gomoku-win-overlay .gomoku-winning-line").count(),1,"Winning five must glow as a connected line");
  assert.equal(await frame.locator("#gomokuResult").getAttribute("data-result"),"win");
  await page.screenshot({path:path.join(artifacts,"gomoku-win-1440x1000.png")});
  await frame.locator("#gomokuReplay").click();
  await frame.locator("#gomokuResult").waitFor({state:"hidden",timeout:4000});
  await frame.locator('#game').evaluate(()=>window.__p111GomokuTest.forceFinish(-1));
  await frame.locator("#gomokuResult:not([hidden])").waitFor({timeout:4000});
  assert.equal(await frame.locator("#gomokuResult").getAttribute("data-result"),"loss");
  await page.screenshot({path:path.join(artifacts,"gomoku-loss-1440x1000.png")});
  await frame.locator("#gomokuLeave").click();
  await page.locator("#libraryView").waitFor({state:"visible"});
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
  await page.locator("#pauseButton").click();
  await page.waitForFunction(()=>document.querySelector("#gameNotice")?.textContent.trim()==="已暂停");
  await page.waitForFunction(()=>document.querySelector("#gameFrame")?.contentDocument?.querySelector("#tableInfo")?.textContent.trim()==="已暂停");
  assert.equal(await frame.locator("#tableInfo").innerText(),"已暂停","Sanguosha side status must reflect pause");
  await page.locator("#pauseButton").click();
  await page.waitForFunction(()=>document.querySelector("#gameNotice")?.textContent.trim()==="你的回合");
  await page.waitForFunction(()=>document.querySelector("#gameFrame")?.contentDocument?.querySelector("#tableInfo")?.textContent.trim()==="你的回合");
  assert.equal(await frame.locator("#tableInfo").innerText(),"你的回合","Sanguosha side status must reflect resume");
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
