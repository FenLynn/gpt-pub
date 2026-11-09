/* P111 R16: current-screen UI and 24-game actual Chromium lifecycle regression. */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {execFileSync}=require("node:child_process");
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
 const resignGames=new Set(["五子棋","黑白棋","四子棋","国际象棋","西洋跳棋（8×8）","中国跳棋","飞行棋","海战棋"]);
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
  assert.equal(await page.locator("#gamePauseOverlay").isVisible(),false,"Pause icon must not cover an active game");
  await page.locator("#pauseButton").click();
  await page.waitForFunction(()=>document.querySelector("#pauseButton").getAttribute("aria-label")==="继续");
  await page.locator("#gamePauseOverlay").waitFor({state:"visible"});
  const geometry=await page.locator("#gamePauseResume").evaluate(el=>{
   const icon=el.querySelector("svg"),r=el.closest(".game-pause-content").getBoundingClientRect(),
    stage=document.querySelector("#gameStage").getBoundingClientRect();
   const title=el.closest(".game-pause-content").querySelector(".game-pause-title");
   const style=getComputedStyle(el.closest(".game-pause-content"));
   return{icon:!!icon,clockIcon:!!title.querySelector("svg"),title:title.textContent,buttonText:el.textContent.trim(),
    titleBottom:title.getBoundingClientRect().bottom,buttonTop:el.getBoundingClientRect().top,
    cardWidth:r.width,cardHeight:r.height,cardBackground:style.backgroundColor,
    cardAlpha:(()=>{const m=style.backgroundColor.match(/rgba?\(([^)]+)\)/),v=m?.[1].split(",")||[];return v.length===4?Number(v[3]):1;})(),
    centerDx:Math.abs((r.left+r.right-stage.left-stage.right)/2),
    centerDy:Math.abs((r.top+r.bottom-stage.top-stage.bottom)/2)};
  });
  assert.ok(geometry.icon&&geometry.clockIcon&&geometry.title==="已暂停"&&geometry.buttonText==="继续"
    &&geometry.buttonTop-geometry.titleBottom>=20&&geometry.cardWidth>=250&&geometry.cardWidth<=340
    &&geometry.cardWidth>geometry.cardHeight&&geometry.cardBackground.startsWith("rgba(")
    &&geometry.cardAlpha>=.48&&geometry.cardAlpha<=.52
    &&geometry.centerDx<2&&geometry.centerDy<2,
   "All games need centered title-above-resume pause UI: "+JSON.stringify(geometry));
  if(game==="中国象棋")await page.screenshot({path:path.join(artifacts,"xiangqi-paused.png")});
  await page.locator("#gamePauseResume").click();
  await page.waitForFunction(()=>document.querySelector("#pauseButton").getAttribute("aria-label")==="暂停");
  assert.equal(await page.locator("#gamePauseOverlay").isVisible(),false,"Resuming must remove the pause glyph");
  await page.locator("#gameFrame").focus();
  await page.keyboard.press("Enter");
  await page.locator("#gamePauseOverlay").waitFor({state:"visible"});
  await page.keyboard.press("Enter");
  await page.locator("#gamePauseOverlay").waitFor({state:"hidden"});
 }
 async function viewCheck(name,width,height){
  const v=await frame.locator("#game").evaluate(el=>{
   const box=x=>{const r=x.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
   const main=el.querySelector(".game-main-board"),tools=el.querySelector(".game-tools");
   const surface=el.querySelector(".arcade-canvas")||el.querySelector("canvas")||el.querySelector(".gomoku-board")||
    el.querySelector(".xiangqi-board")||el.querySelector(".chess-frame")||
     (el.classList.contains("battleship-layout")?el.querySelector("#enemy"):null)||el.querySelector(".fleet-board .game-grid")||
    el.querySelector(".mine-classic")||el.querySelector(".solitaire-table")||el.querySelector(".card-table-main")||el.querySelector("#board");
   const primary=el.classList.contains("battleship-layout")?el.querySelector(".fleet-boards"):surface;
   return {root:box(el),main:box(main),surface:box(surface),primary:box(primary),tools:tools?box(tools):null,toolsVisible:!!tools&&getComputedStyle(tools).display!=="none",
    guide:el.querySelector(".game-guide")?getComputedStyle(el.querySelector(".game-guide")).display:"none",
    hudVisible:!!el.querySelector("#gs-hud")&&getComputedStyle(el.querySelector("#gs-hud")).display!=="none",
    noticeVisible:!!el.querySelector("#gs-notice")&&getComputedStyle(el.querySelector("#gs-notice")).display!=="none",
    battleship:el.classList.contains("battleship-layout"),overflow:document.documentElement.scrollWidth,viewport:innerWidth};
  });
  const centerOffset=Math.abs((v.primary.x+v.primary.width/2)-(v.root.x+v.root.width/2));
  assert.ok(centerOffset<=2.5,name+" primary playing window must center horizontally in the lower game area: "+JSON.stringify({centerOffset,view:{width,height},geometry:v}));
  assert.equal(v.guide,"none",name+" guide should not consume playfield space");
  assert.equal(v.hudVisible,false,name+" secondary iframe titlebar must be hidden");
  assert.equal(v.noticeVisible,false,name+" iframe notices must not appear on board");
  assert.ok(v.main.height>=v.root.height*.96,name+" game stage should use full iframe height: "+JSON.stringify(v));
  if(["五子棋","中国象棋","国际象棋","黑白棋","四子棋","海战棋","西洋跳棋（8×8）","中国跳棋","飞行棋"].includes(name)){
   const timing=await frame.locator("#gs-turn-clock").evaluate(el=>{
    const r=el.getBoundingClientRect();
    return{visible:getComputedStyle(el).display!=="none",width:r.width,
     count:Number(el.ownerDocument.querySelector("#game").dataset.turnClockCount),
     side:el.querySelector("#gs-turn-side").textContent};
   });
   assert.ok(timing.visible&&timing.width>=110,"Board game must display its per-turn clock: "+name+" "+JSON.stringify(timing));
   assert.equal(timing.count,0,"New board game must start with no recorded moves: "+name);
  }
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
    const files=await frame.locator(".xiangqi-file-label").allTextContents();
    assert.equal(files.length,18,"Xiangqi must mark 9 columns for each perspective");
    assert.deepEqual(files.slice(0,4),["1","九","2","八"],"Xiangqi black/red route numbers must use opposite perspectives");
    const river=await frame.locator(".xiangqi-river-label").first().evaluate(el=>({y:el.getAttribute("y"),baseline:el.getAttribute("dominant-baseline")}));
    assert.equal(river.y,"450","River label must be centered vertically");
    assert.equal(river.baseline,"middle","River label must use middle baseline");
    assert.equal(await frame.locator("#turnText").count(),0,"Xiangqi must not duplicate host LED in the right rail");
    assert.equal(await frame.locator("#xiangqiResult[hidden]").count(),1,"Xiangqi result must begin hidden");
  }
  if(name==="飞行棋"){
   const firstPaint=await frame.locator("#game").evaluate(root=>({
    preloadedWorkspace:document.querySelectorAll("head #gameWorkspaceStyles").length,
    preloadedFlightStyle:!!document.querySelector('head link[href^="./flight.css"]'),
    layoutClass:root.classList.contains("gs-tools-open"),
    measured:root.dataset.boardMeasured==="true",
    visibility:getComputedStyle(root).visibility,
    guide:getComputedStyle(root.querySelector(".game-guide")).display
   }));
   assert.ok(firstPaint.preloadedWorkspace===1&&firstPaint.preloadedFlightStyle&&firstPaint.layoutClass&&
    firstPaint.measured&&firstPaint.visibility==="visible"&&firstPaint.guide==="none",
    "Flight Chess needs final head-loaded styles and board sizing before first visible frame: "+JSON.stringify(firstPaint));
   const dice=await frame.locator("#diceFace").evaluate(el=>({svg:el.querySelectorAll("svg.flight-dice-svg").length,pips:el.querySelectorAll(".flight-dice-side[data-face=\"1\"] .flight-dice-pip").length,label:el.getAttribute("aria-label"),turn:el.ownerDocument.querySelector("#turnText").textContent.trim()}));
   assert.equal(dice.svg,6,"Flight Chess must render six separately painted vector cube faces");
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
   assert.ok(Math.abs(geometry.ratio-1)<=.015,"Chinese Checkers circular board must use a square SVG viewport: "+JSON.stringify(geometry));
   assert.equal(geometry.holes,121,"Chinese Checkers must retain all 121 holes");
   assert.equal(geometry.tokenCount,20,"Chinese Checkers must render both ten-piece camps");
   assert.ok(geometry.maxTokenDelta<=.5,"All Chinese Checkers tokens must remain circular: "+JSON.stringify(geometry));
  }
    if(name==="飞行棋"){
    const geometry=await frame.locator("#game").evaluate(root=>{
     const box=q=>{const r=root.querySelector(q).getBoundingClientRect();return{width:r.width,height:r.height,left:r.left,top:r.top,bottom:r.bottom}};
     const stage=box(".flight-stage"),svg=box("svg.flight-board"),record=box(".reversi-record-rail"),right=box(".game-tools");
     const first=root.querySelector('[data-pawn="0-0"]');
     return{stage,svg,record,right,helpCount:root.querySelectorAll("#flightMoveHelp").length,history:root.querySelector("#reversiMoveList")!==null,
       singleBoard:root.querySelectorAll("svg.flight-board").length===1&&!root.querySelector(".flight-center"),
       centeredPawn:Math.abs(Number(first.dataset.centerX)-Number(first.dataset.slotX))<.1&&Math.abs(Number(first.dataset.centerY)-Number(first.dataset.slotY))<.1};
    });
    assert.ok(geometry.singleBoard&&geometry.history&&geometry.centeredPawn,
     "Flight Chess needs a single board with centered solitary planes: "+JSON.stringify(geometry));
    assert.ok(Math.abs(geometry.record.height-geometry.svg.height*.9)<3&&Math.abs(geometry.right.height-geometry.svg.height*.9)<3&&Math.abs(geometry.record.top-(geometry.svg.top+geometry.svg.height*.05))<4&&geometry.helpCount===1,
     "Flight Chess rails should align around board: "+JSON.stringify(geometry));
   }
  if(name==="飞行棋"||name==="西洋跳棋（8×8）"||name==="国际象棋"){
   const geometry=await frame.locator("#board").evaluate(el=>{const r=el.getBoundingClientRect();return{ratio:r.width/r.height,width:r.width,height:r.height};});
   assert.ok(Math.abs(geometry.ratio-1)<=.015,name+" board must preserve a square playing surface: "+JSON.stringify(geometry));
  }
  const pageActions=await frame.locator(".game-tools > button.game-btn").evaluateAll(buttons=>buttons.map(b=>{
   const r=b.getBoundingClientRect();return{id:b.id,width:r.width,height:r.height,
    icon:!!b.querySelector("svg"),label:b.textContent.trim()};
  }));
  for(const action of pageActions){
   assert.ok(action.width>=75&&action.height>=42,name+" in-page action button must be readable: "+JSON.stringify(action));
   assert.ok(action.label.length>0,name+" in-page action must retain its label");
   if(["undoButton","undo","flip","flipButton","resignButton","reset","next","hint","check"].includes(action.id))
    assert.equal(action.icon,true,name+" in-page action needs the same SVG treatment as Gomoku: "+action.id);
  }
  if(v.toolsVisible){
   assert.ok(v.tools.x>=v.main.right-2,name+" tools must dock at right without covering the playfield");
   const classicBoards=new Set(["黑白棋","四子棋","海战棋","西洋跳棋（8×8）","中国跳棋","飞行棋","国际象棋"]);
   if(classicBoards.has(name)){
    const proximity=v.tools.x-v.primary.right;
    assert.ok(proximity>=-2&&proximity<=48,
     name+" right controls must dock next to the centered physical board, not the screen edge: "+JSON.stringify({proximity,view:{width,height},geometry:v}));
    const rail=await frame.locator(".game-tools").evaluate(el=>({
     border:getComputedStyle(el).borderLeftWidth,background:getComputedStyle(el).backgroundColor,
     status:el.querySelector(":scope > .game-status,:scope > .turn-indicator")?
      getComputedStyle(el.querySelector(":scope > .game-status,:scope > .turn-indicator")).display:"none",
     clock:!!el.querySelector(".gs-turn-clock"),
     buttons:[...el.querySelectorAll(":scope > button.game-btn")].map(b=>({
      id:b.id,icon:!!b.querySelector("svg"),height:b.getBoundingClientRect().height
     }))
    }));
    assert.equal(rail.border,"0px",name+" right tools must not be inside a giant outer box");
    assert.equal(rail.status,"none",name+" status belongs exclusively in the top LED");
    assert.ok(rail.clock,name+" per-turn clock must appear on the right");
    assert.ok(rail.buttons.every(b=>b.icon&&b.height>=32),
     name+" right action buttons need the shared icon and sufficient touch area: "+JSON.stringify(rail));
   }
   if(name==="黑白棋"||name==="四子棋"){
    const detail=await frame.locator("#game").evaluate(root=>{
     const left=root.querySelector(".reversi-record-rail"),right=root.querySelector(".game-tools"),
      board=root.querySelector("#board"),clock=root.querySelector("#gs-turn-clock"),
      tip=right.querySelector(".gs-board-tip"),stats=right.querySelector(".reversi-side-score"),
      btn=right.querySelector("#undoButton"),list=left.querySelector("#reversiMoveList");
     const rect=x=>x.getBoundingClientRect(),l=rect(left),b=rect(board),r=rect(right),
      action=rect(btn),score=rect(stats),hint=rect(tip),clockRect=rect(clock);
     const rows=[...stats.querySelectorAll(".reversi-count-row")].map(row=>{
      const ico=rect(row.querySelector(".reversi-count-disc"));
      return{side:row.dataset.side,label:row.querySelector(".reversi-count-name").textContent,
       iconWidth:ico.width,iconHeight:ico.height,background:getComputedStyle(row).backgroundColor,
       top:rect(row).top,bottom:rect(row).bottom};
     });
     return{leftWidth:l.width,leftHeight:l.height,boardHeight:b.height,gap:b.left-l.right,
      clockParent:clock.parentElement.className,clockHistory:getComputedStyle(clock.querySelector(".gs-turn-clock-history")).display,
      hasColumns:!!left.querySelector(".reversi-record-columns"),listOverflowX:getComputedStyle(list).overflowX,
      listScrollbar:getComputedStyle(list).scrollbarWidth,
      rightCenter:Math.abs((clockRect.top+hint.bottom-r.top-r.bottom)/2),
      hintLast:hint.top>score.bottom,rowGap:rows[1].top-rows[0].bottom,
      turn:root.dataset.turnSide,rows};
    });
    assert.ok(detail.leftWidth>=(name==="黑白棋"?250:150)&&Math.abs(detail.leftHeight-detail.boardHeight)<=2.5,
     "Reversi history must be wide and exactly board-height: "+JSON.stringify(detail));
    assert.ok(detail.gap>=-2&&detail.gap<=48&&detail.hasColumns,
     "Reversi history must be adjacent to the centered board with column headings: "+JSON.stringify(detail));
    assert.equal(detail.clockParent,"game-tools","Reversi turn clock should be on the right");
    assert.equal(detail.clockHistory,"none","Reversi move list should exist only on the left");
    assert.ok(detail.rightCenter<=12,"Reversi right-side tools should be centered vertically: "+JSON.stringify(detail));
    assert.ok(detail.hintLast&&detail.rowGap>=6,"Reversi counters must stack with hint at the end");
    assert.deepEqual(detail.rows.map(r=>r.label),
     name==="黑白棋"?["黑色棋子","白色棋子"]:["红色棋子","黄色棋子"]);
    assert.ok(detail.rows.every(r=>r.iconWidth>=25&&Math.abs(r.iconWidth-r.iconHeight)<=1),
     "Reversi counter icons must be large circles: "+JSON.stringify(detail.rows));
    assert.equal(detail.turn,name==="黑白棋"?"black":"red","First player's side must be highlighted");
    assert.notEqual(detail.rows[0].background,detail.rows[1].background,
     "Current player must be distinctly highlighted: "+JSON.stringify(detail.rows));
    assert.equal(detail.listOverflowX,"hidden");
    assert.equal(detail.listScrollbar,"none");
   }
   if(["四子棋","海战棋","西洋跳棋（8×8）","中国跳棋"].includes(name)){
    const detail=await frame.locator("#game").evaluate((root,kind)=>{
     const board=root.querySelector(kind==="海战棋"?"#enemy":"#board"),
      record=root.querySelector(".reversi-record-rail"),
      right=root.querySelector(".game-tools"),
      timer=right.querySelector("#gs-turn-clock"),
      scores=right.querySelector(".reversi-side-score"),hint=right.querySelector(".gs-board-tip"),
      list=record.querySelector("#reversiMoveList");
     const box=e=>e.getBoundingClientRect(),b=box(board),left=box(record),r=box(right),
      top=box(timer),bottom=box(hint);
     return{board:{width:b.width,height:b.height,center:b.left+b.width/2},
      main:box(root.querySelector(".game-main-board")).height,
      physicalHeight:kind==="中国跳棋"?b.height*812/900:b.height,
      physicalTop:kind==="中国跳棋"?b.top+(b.height-b.height*812/900)/2:b.top,
      physicalBottom:kind==="中国跳棋"?b.bottom-(b.height-b.height*812/900)/2:b.bottom,
      primaryCenter:kind==="海战棋"?box(root.querySelector(".fleet-boards")).left+box(root.querySelector(".fleet-boards")).width/2:b.left+b.width/2,
      ownBoardInStage:kind==="海战棋"?root.querySelector(".fleet-boards").contains(root.querySelector("#own")):null,
      ownCenter:kind==="海战棋"?box(root.querySelector("#own")).left+box(root.querySelector("#own")).width/2:null,
      rightHeight:r.height,
      stageTexture:getComputedStyle(root.querySelector(".game-main-board")).backgroundImage,
      left:{width:left.width,height:left.height,top:left.top,bottom:left.bottom,gap:b.left-left.right},
      center:box(root).left+box(root).width/2,
      rowLabels:[...scores.querySelectorAll(".reversi-count-name")].map(x=>x.textContent.trim()),
      rowCount:scores.querySelectorAll(".reversi-count-row").length,
      currentSide:root.dataset.turnSide||"",
      verticalGap:Math.abs((top.top+bottom.bottom-r.top-r.bottom)/2),
      listOverflow:getComputedStyle(list).overflowX,
      hasOwnPreview:kind==="海战棋"?record.contains(root.querySelector("#own")):null,
      ownSquare:kind==="海战棋"?box(root.querySelector("#own")).width:null};
    },name);
    const wantedRatio=name==="四子棋"?7/6:1;
    const minHeightShare=name==="海战棋"?.35:name==="四子棋"?.74:name==="中国跳棋"?.72:.80;
    assert.ok(Math.abs(detail.board.width/detail.board.height-wantedRatio)<.03,
     name+" must retain actual board aspect ratio: "+JSON.stringify(detail));
    assert.ok(detail.board.height>=detail.main*minHeightShare,
     name+" must prioritize the available height instead of a shallow board: "+JSON.stringify(detail));
    assert.ok(Math.abs(detail.primaryCenter-detail.center)<=2.5,
     name+" physical playing board must remain centered horizontally: "+JSON.stringify(detail));
    assert.ok(detail.left.width>=150&&Math.abs(detail.left.height-detail.physicalHeight)<=3,
     name+" full-height left history must align with actual board: "+JSON.stringify(detail));
    assert.ok(Math.abs(detail.rightHeight-detail.physicalHeight)<=3,
     name+" right tools must match physical board height: "+JSON.stringify(detail));
    assert.ok(["海战棋","中国跳棋","西洋跳棋（8×8）"].includes(name)?detail.stageTexture==="none":detail.stageTexture.includes("radial-gradient")&&!detail.stageTexture.includes("repeating-"),
     name+" stage must not contain an unnecessary central colored frame: "+JSON.stringify(detail));
    assert.ok(detail.rowCount===2&&detail.verticalGap<=15,
     name+" two stacked stats and right-side timer must center vertically: "+JSON.stringify(detail));
    assert.equal(detail.listOverflow,"hidden",name+" move history must never horizontally scroll");
    if(name==="海战棋"){
     assert.ok(detail.ownBoardInStage&&!detail.hasOwnPreview&&detail.ownSquare>=130&&Math.abs(detail.ownSquare-detail.board.width)<=2,
       "Battleship two full-sized seas must sit in the main stage: "+JSON.stringify(detail));
      assert.ok(detail.ownCenter<detail.center&&detail.board.center>detail.center&&Math.abs((detail.ownCenter+detail.board.center)/2-detail.center)<3,
       "Battleship sea centers must symmetrically flank the stage: "+JSON.stringify(detail));
     assert.deepEqual(detail.rowLabels,["命中次数","攻击次数"]);
      assert.ok(Math.abs(detail.left.top-detail.physicalTop)<=3&&Math.abs(detail.left.bottom-detail.physicalBottom)<=3,"Sea history must match grid edges: "+JSON.stringify(detail));
    }else if(name==="西洋跳棋（8×8）"){
     assert.deepEqual(detail.rowLabels,["红方棋子","黑方棋子"]);
     assert.equal(detail.currentSide,"red");
    }else if(name==="中国跳棋"){
     assert.deepEqual(detail.rowLabels,["1号玩家入营","2号玩家入营"]);
     assert.equal(detail.currentSide,"red");
    }
   }
   if(name==="国际象棋"){
    const info=await frame.locator("#game").evaluate(root=>{
     const rect=x=>{const r=root.querySelector(x).getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:r.height,left:r.left,right:r.right};};
     return{board:rect(".chess-frame"),history:rect(".chess-notation-rail"),tools:rect(".game-tools"),
      image:getComputedStyle(root.querySelector(".game-main-board")).backgroundImage,
      left:root.querySelector(".chess-notation-rail #moveList")!==null,
      right:root.querySelector(".game-tools #moveList")!==null};
    });
    assert.ok(info.left&&!info.right,"Chess notation belongs only on the left");
    assert.ok(Math.abs(info.history.height-info.board.height)<=3&&Math.abs(info.tools.height-info.board.height)<=3,
     "Chess history and right controls equal actual board height: "+JSON.stringify(info));
    assert.ok(info.history.right<=info.board.left+2&&info.board.right<=info.tools.left+2,
     "Chess must have left history, center board and right controls: "+JSON.stringify(info));
    assert.equal(info.image,"none","Chess stage must have no middle texture");
   }
   if(name==="五子棋"){
    assert.ok(v.tools.x-v.surface.right<=38,"Gomoku action rail must sit immediately next to the board: "+JSON.stringify(v));
    assert.ok(v.main.width>=v.root.width*.46,"Gomoku board must retain enough playfield width: "+JSON.stringify(v));
   }else if(name==="中国象棋"){
    const geometry=await frame.locator("#game").evaluate(el=>{
     const r=s=>{const q=el.querySelector(s).getBoundingClientRect();return{left:q.left,right:q.right,top:q.top,bottom:q.bottom,width:q.width,height:q.height};};
     const piece=el.querySelector(".xiangqi-piece");
     return{left:r(".xiangqi-record-rail"),main:r(".game-main-board"),right:r(".game-tools"),
      board:r(".xiangqi-board"),scrollBox:r(".xiangqi-record-scroll"),
      glyphFont:parseFloat(getComputedStyle(piece).fontSize),pieceWidth:piece.getBoundingClientRect().width,
      styles:[...document.querySelectorAll("head link[rel=stylesheet]")].map(x=>x.getAttribute("href")),
      background:getComputedStyle(el.querySelector(".xiangqi-board")).backgroundImage};
    });
    assert.ok(geometry.left.right<=geometry.main.left+2&&geometry.main.right<=geometry.right.left+2,
     "Xiangqi must position notation left and actions right, without overlap: "+JSON.stringify(geometry));
    assert.ok(geometry.main.width>=(geometry.right.right-geometry.left.left)*.50,
     "Xiangqi board track must dominate its compact three-column group: "+JSON.stringify(geometry));
    assert.ok(geometry.left.width>=280,"Xiangqi notation column should be roughly doubled in width: "+JSON.stringify(geometry));
    assert.ok(Math.abs(geometry.left.height-geometry.board.height)<=1.5,
     "Xiangqi record rail must precisely match the board height: "+JSON.stringify(geometry));
    const leftGap=geometry.board.left-geometry.left.right,rightGap=geometry.right.left-geometry.board.right;
    assert.ok(leftGap>=4&&leftGap<=28&&rightGap>=4&&rightGap<=28,
     "Xiangqi notation and buttons must stay close to the actual board: "+JSON.stringify({leftGap,rightGap,geometry}));
    assert.ok(geometry.glyphFont>=geometry.pieceWidth*.62&&geometry.glyphFont<=geometry.pieceWidth*.9,
     "Xiangqi glyphs must be large and proportional to their circular pieces: "+JSON.stringify(geometry));
    assert.ok(geometry.styles.includes("../shared/workspace.css")&&geometry.styles.includes("./xiangqi.css"),
     "Xiangqi dedicated stylesheet must be loaded in HEAD, preventing a legacy layout flash");
    const scroll=await frame.locator("#moveList").evaluate(list=>{
     const beforeWidth=list.getBoundingClientRect().width;
     const dummy=document.createElement("li");dummy.textContent="测试棋谱滚动定位";
     const clones=Array.from({length:50},()=>dummy.cloneNode(true));
     clones.forEach(el=>list.appendChild(el));
     const overflowing=list.scrollHeight>list.clientHeight;
     list.scrollTop=list.scrollHeight;list.scrollLeft=999;
     const afterWidth=list.getBoundingClientRect().width;
     const hiddenScrollbar=getComputedStyle(list).scrollbarWidth==="none";
     clones.forEach(el=>el.remove());
     return{overflowing,beforeWidth,afterWidth,scrollLeft:list.scrollLeft,hiddenScrollbar};
    });
    assert.ok(scroll.overflowing&&scroll.hiddenScrollbar&&Math.abs(scroll.beforeWidth-scroll.afterWidth)<.1&&scroll.scrollLeft===0,
     "Xiangqi notation scrollbar must overlay without horizontal shifting: "+JSON.stringify(scroll));
    assert.ok(!geometry.background.includes("repeating-linear-gradient"),
     "Xiangqi wood board must not contain horizontal stripe gradients");
   }else {
    const feasible=(name==="黑白棋"||name==="四子棋")
    ?Math.min(v.root.height-30,v.root.width-2*(await frame.locator(".reversi-record-rail").evaluate(el=>el.getBoundingClientRect().width))-38)
    :Math.min(v.root.height-30,v.root.width-400);
    assert.ok(v.main.width>=feasible*.96&&v.main.width<=v.root.width,
     name+" board must retain maximum usable playfield width inside centered symmetric side tracks: "+JSON.stringify({feasible,geometry:v}));
   }
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
  if(width>=901){
   const title=await page.locator("#breadcrumbCategory").evaluate(el=>{
    const text=el.getBoundingClientRect(),notice=document.querySelector("#gameNotice").getBoundingClientRect();
    return{label:el.textContent,available:el.clientWidth,required:el.scrollWidth,
     actualRight:text.right,noticeLeft:notice.left,tooltip:el.title};
   });
   assert.equal(title.tooltip,name,name+" game title must provide a full-name fallback");
   assert.ok(title.required<=title.available+2&&title.actualRight<=title.noticeLeft+2,
    name+" game title must fit the left header without truncation or overlapping LED: "+JSON.stringify(title));
  }
  const stop=await page.locator("#startButton.end-action svg rect").evaluate(el=>({
   fill:getComputedStyle(el).fill,stroke:getComputedStyle(el).stroke
  }));
  assert.notEqual(stop.fill,"none",name+" stop icon must be a solid square");
  assert.equal(stop.stroke,"none",name+" stop icon must not be outline-only");
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
      speakerWidth:speaker.getBoundingClientRect().width,rays:speaker.querySelectorAll(".speaker-pulse-rays path").length,
      pulseName:getComputedStyle(speaker.querySelector(".speaker-pulse-rays")).animationName,
      pulseCount:getComputedStyle(speaker.querySelector(".speaker-pulse-rays")).animationIterationCount,
      screenWidth:window.getBoundingClientRect().width,textColor:text.color,textFont:parseFloat(text.fontSize),
      screenPaddingTop:parseFloat(screen.paddingTop),screenBackground:screen.backgroundColor,
      modeBorder:getComputedStyle(document.querySelector("#modeControl")).borderTopWidth,
      difficultyBorder:getComputedStyle(document.querySelector("#difficultyControl")).borderTopWidth};
   });
   assert.ok(led.speakerRight<led.screenLeft&&led.screenWidth>=(width<=1390?165:180),"Gomoku speaker belongs outside a long LED screen: "+JSON.stringify(led));
   assert.ok(led.speakerWidth>=38&&led.rays===3&&led.pulseName==="gs-notice-pulse"&&led.pulseCount==="2",
    "LED speaker must be large and flash three rays exactly twice for an incoming message: "+JSON.stringify(led));
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
  }else assert.ok(header.notice.width>=(width<=1390?195:214)&&header.notice.width<=285,name+" all game headers must share the Gomoku LED dimensions: "+JSON.stringify(header));
  assert.ok(Math.abs(header.notice.centerY-header.bar.centerY)<=2,name+" notification region must align with the titlebar: "+JSON.stringify(header));
  const crumb=await page.evaluate(()=>({name:document.querySelector("#breadcrumbCategory").textContent.trim(),
   gameSeparator:!document.querySelector("#crumbGameSep").classList.contains("hidden"),
   gameName:!document.querySelector("#breadcrumbGame").classList.contains("hidden")}));
  assert.equal(crumb.name,name,name+" titlebar breadcrumb must identify the active game");
  assert.equal(crumb.gameSeparator,false,name+" titlebar must not show an empty second breadcrumb separator");
  assert.equal(crumb.gameName,false,name+" active game name must not be squeezed out by duplicate breadcrumb text");
  assert.equal(await page.locator("#railToggleButton").count(),0,name+" obsolete fold button must be removed");
  assert.ok(Math.max(...header.actions.map(x=>x.centerY))-Math.min(...header.actions.map(x=>x.centerY))<=2,name+" SVG controls vertically aligned");
  const availableHeight=name==="中国象棋"
   ?Math.min(v.main.height,Math.max(0,(v.main.width-14)*9/8))
   :name==="黑白棋"?Math.min(v.main.height,Math.max(0,v.main.width-18))
   :name==="四子棋"?Math.min(v.main.height,Math.max(0,(v.main.width-18)*6/7))
   :v.battleship?Math.min(v.main.height-58,Math.max(0,(v.main.width-52)/2))
   :v.main.height*.70;
  assert.ok(v.surface.height>=(v.battleship?Math.min(v.main.height*.45,availableHeight)*.90:Math.min(v.main.height*.70,availableHeight)-1),
   name+" primary surface must maximize height within the symmetric side-gutter geometry: "+JSON.stringify({availableHeight,geometry:v}));
  assert.ok(v.surface.y>=v.main.y-1&&v.surface.bottom<=v.main.bottom+1,name+" game content must not clip vertically: "+JSON.stringify(v));
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
    icon:!!n.querySelector(".game-vector-icon"),hasTankSvg:!!n.querySelector(".game-tank-icon")})));
  assert.deepEqual(recent.map(x=>x.name),["俄罗斯方块","90 坦克","扫雷","中国象棋","黑白棋","四子棋","海战棋","中国跳棋","飞行棋"],"Recent games must show the nine newest games in order");
  assert.ok(recent.every((x,i)=>i%3===0||x.x>recent[i-1].x),"Recent games must run left-to-right within each row");
  assert.ok(recent.every(x=>x.icon&&(x.id==="tank"?x.hasTankSvg:!x.hasTankSvg)),"All recent games must use local SVG artwork, with the sourced tank vector retained");
  assert.equal(await page.locator('#homeRecentList .recent-icon[data-game="tank"] .game-tank-icon').count(),1,"90 Tank must use the sourced top-view tank vector");
  const recentFit=await page.locator("#homeRecentList .recent-game").evaluateAll(nodes=>nodes.map(n=>({name:n.querySelector(".recent-copy strong").textContent.trim(),textBottom:n.querySelector(".recent-copy").getBoundingClientRect().bottom,listBottom:n.parentElement.getBoundingClientRect().bottom})));
  assert.ok(recentFit.every(x=>x.textBottom<=x.listBottom+1),"Recent tab labels must remain fully visible inside the list: "+JSON.stringify(recentFit));
  assert.equal(await page.locator(".recent-tab").count(),2,"Recent games must offer recent/popular tabs");
  assert.equal(await page.locator("#homeGamePoster").count(),1,"Right-hand rotating game poster must exist");
  const posterDesign=await page.locator("#homeGamePoster").evaluate(poster=>{
   const rect=el=>el.getBoundingClientRect(),art=rect(poster.querySelector(".poster-art")),intro=rect(poster.querySelector(".poster-copy")),
    tip=rect(poster.querySelector(".poster-tips")),play=rect(poster.querySelector("#homePosterPlay")),
    count=rect(poster.querySelector("#homePosterCount")),dots=rect(poster.querySelector(".poster-dots")),
    outer=rect(poster),list=rect(poster.closest(".recent-panel").querySelector(".recent-list"));
   return{art,intro,tip,play,count,dots,outer,list,
    tipFont:parseFloat(getComputedStyle(poster.querySelector(".poster-tips p")).fontSize),
    introFont:parseFloat(getComputedStyle(poster.querySelector(".poster-copy p")).fontSize),
    titleFont:parseFloat(getComputedStyle(poster.querySelector(".poster-copy h3")).fontSize),
    tipText:poster.querySelector("#homePosterTip").textContent,
    playArrow:poster.querySelector("#homePosterPlay svg")};
  });
  assert.ok(Math.abs(posterDesign.outer.height-posterDesign.list.height)<3&&Math.abs(posterDesign.outer.top-posterDesign.list.top)<3,"Poster height and top edge must align with the three-row game grid: "+JSON.stringify(posterDesign));
  assert.ok(posterDesign.art.left-posterDesign.outer.left<70&&posterDesign.art.top-posterDesign.outer.top<90&&posterDesign.art.height/posterDesign.outer.height>=.38,"Poster icon must be upper left and occupy about half the card height: "+JSON.stringify(posterDesign));
  assert.ok(posterDesign.intro.left-posterDesign.art.right>=18&&posterDesign.intro.top<posterDesign.outer.top+posterDesign.outer.height*.5,"Game information must sit to the right with clear spacing: "+JSON.stringify(posterDesign));
  assert.ok(posterDesign.tip.left>=posterDesign.intro.left-2&&posterDesign.tip.top>=posterDesign.intro.bottom&&posterDesign.tip.top-posterDesign.intro.bottom<=26,"Tips divider must sit just below the game description: "+JSON.stringify(posterDesign));
  assert.ok(posterDesign.play.top>=posterDesign.art.bottom-1&&Math.abs((posterDesign.play.left+posterDesign.play.right)/2-(posterDesign.art.left+posterDesign.art.right)/2)<12&&!posterDesign.playArrow,"Play button must align under the icon and have no arrow: "+JSON.stringify(posterDesign));
  assert.ok(Math.abs(posterDesign.count.left-posterDesign.dots.left)<2&&posterDesign.count.bottom<=posterDesign.dots.top+1&&posterDesign.dots.bottom>posterDesign.outer.bottom-16,"Poster number must be above the dots at the lower left: "+JSON.stringify(posterDesign));
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
  assert.equal(await page.locator(".ranking-trophy svg").count(),1,"Leaderboard must show a bundled SVG trophy");
  assert.equal(await page.locator(".ranking-heading p").count(),0,"Remove the redundant local-record subtitle");
  const medalFills=await page.locator("#rankingList .ranking-medal svg circle").evaluateAll(nodes=>nodes.map(node=>node.getAttribute("fill")));
  assert.deepEqual(medalFills,["#f3cf69","#d5dce1","#d5a078"],"Top three ranks must use gold, silver and bronze SVG medals");
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
   assert.ok(visual.recentIconWidth>=56&&visual.recentIconWidth<=70,"Three-by-three recent game icons must be large and remain uncut: "+JSON.stringify(visual));
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
  await page.setViewportSize({width:1024,height:768});
  const compactPoster=await page.locator("#homeGamePoster").evaluate(p=>{
   const box=q=>q.getBoundingClientRect(),art=box(p.querySelector(".poster-art")),
    intro=box(p.querySelector(".poster-copy")),play=box(p.querySelector("#homePosterPlay"));
   return{art,intro,play,font:parseFloat(getComputedStyle(p.querySelector(".poster-art")).fontSize),
    centerDelta:Math.abs((art.left+art.right)/2-(play.left+play.right)/2)};
  });
  assert.ok(compactPoster.font<=52&&compactPoster.intro.left-compactPoster.art.right>=10,
   "Compact poster icon must be reduced and kept clear of the copy: "+JSON.stringify(compactPoster));
  assert.ok(compactPoster.centerDelta<2,"Compact poster play button must remain centered under the icon: "+JSON.stringify(compactPoster));
  assert.ok(compactPoster.play.top-compactPoster.art.bottom>=6,
   "Home enter-game button must sit slightly lower than the icon: "+JSON.stringify(compactPoster));
  await page.setViewportSize({width:1024,height:620});
  const posterNode=page.locator("#homeGamePoster");
  await posterNode.evaluate(el=>{
   const clone=el.cloneNode(true);clone.id="homeGamePosterTest";clone.classList.remove("arriving");
   for(const [k,v] of Object.entries({position:"fixed",left:"0px",top:"0px",width:"635px",height:"387px",zIndex:"9999"}))
    clone.style.setProperty(k.replace(/[A-Z]/g,m=>"-"+m.toLowerCase()),v,"important");
   el.parentElement.appendChild(clone);
  });
  const mediumPoster=await page.locator("#homeGamePosterTest").evaluate(p=>{
   const box=q=>q.getBoundingClientRect(),art=box(p.querySelector(".poster-art")),
    intro=box(p.querySelector(".poster-copy")),play=box(p.querySelector("#homePosterPlay"));
   return{outer:box(p),art,intro,play,font:parseFloat(getComputedStyle(p.querySelector(".poster-art")).fontSize),
    centerDelta:Math.abs((art.left+art.right)/2-(play.left+play.right)/2)};
  });
  assert.ok(mediumPoster.outer.width===635&&mediumPoster.outer.height===387&&mediumPoster.font>=155&&mediumPoster.font<=170&&mediumPoster.intro.left-mediumPoster.art.right>=40,
   "Medium landscape poster must use a smaller icon with a clear text column: "+JSON.stringify(mediumPoster));
  assert.ok(mediumPoster.centerDelta<2,"Medium poster play button must stay centered under the icon: "+JSON.stringify(mediumPoster));
  assert.ok(mediumPoster.play.top-mediumPoster.art.bottom>=8,
   "Medium poster enter-game button needs extra breathing room: "+JSON.stringify(mediumPoster));
  await page.locator("#homeGamePosterTest").screenshot({path:path.join(artifacts,"poster-medium-landscape.png")});
  await page.locator("#homeGamePosterTest").evaluate(el=>el.remove());
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

  // Local-data backup round-trip: normalize unknown IDs and invalid counters,
  // then restore a valid payload without touching the source repository.
  const backupContext=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
  const backupPage=await backupContext.newPage();
  const backupSeed={
   stats:{
    tetris:{plays:2,wins:5,totalMs:123456,bestScore:99,lastPlayed:today,lastPlayedAt:now,days:{[today]:90000000}},
    unknown:{plays:99,wins:99,totalMs:999999,bestScore:999,lastPlayed:today,lastPlayedAt:now,days:{}}
   },
   favorites:["tetris","mahjong","unknown"],
   settings:{scale:"1.08"},
   firstStartedAt:first.getTime()
  };
  await backupPage.addInitScript(seed=>{
   localStorage.setItem("gamestation.stats",JSON.stringify(seed.stats));
   localStorage.setItem("gamestation.favorites",JSON.stringify(seed.favorites));
   localStorage.setItem("gamestation.settings",JSON.stringify(seed.settings));
   localStorage.setItem("gamestation.firstStartedAt",JSON.stringify(seed.firstStartedAt));
  },backupSeed);
  await backupPage.goto(pathToFileURL(path.join(root,"index.html")).href);
  await backupPage.locator("#settingsButton").click();
  const backupDownloadPromise=backupPage.waitForEvent("download");
  await backupPage.locator("#exportData").click();
  const backupDownload=await backupDownloadPromise;
  const exported=JSON.parse(await fs.promises.readFile(await backupDownload.path(),"utf8"));
  assert.equal(exported.app,"GameStation","Backup must identify its application");
  assert.equal(exported.schemaVersion,2,"Backup must use the current schema version");
  assert.ok(Object.hasOwn(exported.stats,"tetris")&&!Object.hasOwn(exported.stats,"unknown"),"Backup must omit unknown game IDs while retaining known zero-play records");
  assert.equal(exported.stats.tetris.wins,2,"Backup must clamp wins to the number of plays");
  assert.equal(exported.stats.tetris.days[today],86400000,"Backup must clamp a daily duration to one day");
  assert.deepEqual(exported.favorites,["tetris","mahjong"],"Backup must retain only known unique favorites");
  assert.equal(exported.settings.scale,"1.08","Backup must preserve the selected interface scale");
  assert.equal(exported.firstStartedAt,first.getTime(),"Backup must preserve the first-play timestamp");
  const restored={
   app:"GameStation",schemaVersion:2,firstStartedAt:first.getTime()-86400000,
   stats:{snake:{plays:7,wins:3,totalMs:777000,bestScore:321,lastPlayed:today,lastPlayedAt:now,days:{[today]:60000}}},
   favorites:["snake","chess","not-a-game"],settings:{scale:"1.16"}
  };
  backupPage.on("dialog",dialog=>dialog.accept());
  await backupPage.locator("#importFile").setInputFiles({
   name:"gamestation-restore.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(restored))
  });
  await backupPage.waitForFunction(()=>{
   const stats=JSON.parse(localStorage.getItem("gamestation.stats")||"{}");
   const favorites=JSON.parse(localStorage.getItem("gamestation.favorites")||"[]");
   const settings=JSON.parse(localStorage.getItem("gamestation.settings")||"{}");
   return stats.snake?.plays===7&&favorites.includes("snake")&&settings.scale==="1.16";
  });
  assert.deepEqual(await backupPage.evaluate(()=>JSON.parse(localStorage.getItem("gamestation.favorites")||"[]")),["snake","chess"],
   "Import must discard unknown favorites");
  assert.equal(await backupPage.evaluate(()=>JSON.parse(localStorage.getItem("gamestation.firstStartedAt"))),first.getTime()-86400000,
   "Import must restore the original first-play timestamp");
  const beforeInvalidImport=await backupPage.evaluate(()=>({
   stats:localStorage.getItem("gamestation.stats"),favorites:localStorage.getItem("gamestation.favorites"),
   settings:localStorage.getItem("gamestation.settings"),first:localStorage.getItem("gamestation.firstStartedAt")
  }));
  await backupPage.locator("#importFile").setInputFiles({
   name:"invalid.json",mimeType:"application/json",buffer:Buffer.from("{not-json")
  });
  await backupPage.waitForFunction(()=>document.querySelector("#toast")?.textContent.includes("无效")&&
   document.querySelector("#toast")?.classList.contains("show"));
  const afterInvalidImport=await backupPage.evaluate(()=>({
   stats:localStorage.getItem("gamestation.stats"),favorites:localStorage.getItem("gamestation.favorites"),
   settings:localStorage.getItem("gamestation.settings"),first:localStorage.getItem("gamestation.firstStartedAt")
  }));
  assert.deepEqual(afterInvalidImport,beforeInvalidImport,"Invalid JSON must not mutate existing local data");
  await backupContext.close();
  console.log("P111 local-data backup export/import regression passed.");

  let noticeChecked=false;
  await library();
  assert.equal(await page.locator(".game-card").count(),24);
  assert.equal(await page.locator("#homeView .ranking-trophy svg").count(),1,"Leaderboard trophy must be a bundled SVG, not an OS emoji");
  assert.equal(await page.locator(".game-card .game-vector-icon").count(),24,"All 24 game icons must use bundled vector artwork");
  const iconAudit=await page.locator(".game-card-icon").evaluateAll(nodes=>nodes.map(node=>{
    const svg=node.querySelector(".game-vector-icon");
    return{id:node.dataset.game,svgGame:svg?.dataset.game,style:svg?.dataset.iconStyle,viewBox:svg?.getAttribute("viewBox"),
      shapeCount:svg?.querySelectorAll("path,rect,circle,ellipse,polygon,line,polyline").length||0,
      ids:[...(svg?.querySelectorAll("[id]")||[])].map(el=>el.id),
      unresolved:svg?.outerHTML.includes("__ID__")||false,
      pieces:[...(svg?.querySelectorAll("[data-piece]")||[])].map(el=>el.getAttribute("data-piece"))};
  }));
  assert.equal(new Set(iconAudit.map(icon=>icon.id)).size,24,"Every game must retain its own distinct icon identity");
  assert.ok(iconAudit.every(icon=>icon.svgGame===icon.id&&icon.style==="soft-cute"&&icon.shapeCount>=2&&!icon.unresolved),"All 24 icons must render as complete soft-cute SVG artwork");
  const iconIds=iconAudit.flatMap(icon=>icon.ids);
  assert.ok(iconIds.length>=300&&new Set(iconIds).size===iconIds.length,"SVG gradient IDs must be unique across every rendered icon instance");
  assert.equal(iconAudit.filter(icon=>icon.viewBox==="0 0 64 64").length,23,"All standard icons must use a consistent 64×64 viewBox");
  assert.equal(iconAudit.find(icon=>icon.id==="tank").viewBox,"0 0 512 512","The attributed tank source must retain its original viewBox");
  assert.ok(iconAudit.find(icon=>icon.id==="gomoku").pieces.includes("black")&&iconAudit.find(icon=>icon.id==="gomoku").pieces.includes("white"),"Gomoku must visibly distinguish its black and white stones");
  assert.ok(iconAudit.find(icon=>icon.id==="checkers").pieces.includes("red")&&iconAudit.find(icon=>icon.id==="checkers").pieces.includes("dark"),"Western Checkers must visibly distinguish its red and dark pieces");
  assert.equal(await page.locator(".game-card .game-icon-glyph").count(),0,"Game icons must not depend on OS emoji fonts");
  assert.equal(await page.locator(".game-card .game-icon-svg").count(),0,"The old unsourced game logo SVGs must not be used");
  const tankVector=await page.locator('.game-card-icon[data-game="tank"] .game-tank-icon').evaluate(svg=>({
    ns:svg.namespaceURI,viewBox:svg.getAttribute("viewBox"),path:!!svg.querySelector("path"),
    pathLength:svg.querySelector("path")?.getAttribute("d")?.length||0,
    width:svg.getBoundingClientRect().width,height:svg.getBoundingClientRect().height
  }));
  assert.equal(tankVector.ns,"http://www.w3.org/2000/svg","The sourced 90 Tank icon must be crisp native SVG");
  assert.equal(tankVector.viewBox,"0 0 512 512");
  assert.ok(tankVector.path&&tankVector.pathLength>900&&tankVector.width>24&&tankVector.height>24,"90 Tank must render the detailed armored tank vehicle, not a tank-top clothing icon");
  assert.equal(await page.locator('.game-card-icon[data-game="minesweeper"] .game-vector-icon').count(),1,"Minesweeper must use a bundled bomb SVG");
  assert.equal(await page.locator('.game-card-icon[data-game="tank"] .game-tank-icon').count(),1,"90 Tank must use its sourced tank SVG");
  assert.equal(await page.locator('.game-card-icon[data-game="mahjong"] .game-vector-icon').count(),1,"Mahjong must use a bundled tile SVG");
  const iconCategories=await page.locator('.game-card-icon[data-game="gomoku"],.game-card-icon[data-game="tank"]').evaluateAll(nodes=>nodes.map(n=>n.dataset.category));
  assert.deepEqual(iconCategories,["board","arcade"],"Bundled SVG icons must retain their board/arcade category metadata");
  assert.equal(await page.locator('.game-card .game-card-icon[data-game="tank"] .game-tank-icon').count(),1,"The 90 tank library icon must show the non-rasterized vector");
  const cards=await page.locator(".game-card").first().evaluate(el=>el.getBoundingClientRect().height);
  assert.ok(cards<125,"library game cards must be compact, not giant blank blocks");
  await page.screenshot({path:path.join(artifacts,"library-1440x1000.png")});
  for(const size of [{width:1440,height:1000},{width:1366,height:768}]){
   await page.setViewportSize(size);
   await library();
   for(const name of names){
    await open(name);await start();await pauseResume();
    if(resignGames.has(name)){
     await frame.locator("#resignButton:enabled").waitFor({state:"visible",timeout:3500});
     const action=await frame.locator("#resignButton").evaluate(el=>({
      afterUndo:el.previousElementSibling?.id==="undoButton",hasUndo:!!el.parentElement.querySelector("#undoButton"),beforeScores:el.nextElementSibling?.classList.contains("side-score"),
      text:el.textContent.trim(),icon:!!el.querySelector("svg"),disabled:el.disabled
     }));
     assert.ok((action.hasUndo?action.afterUndo:action.beforeScores)&&action.text==="认输"&&action.icon&&!action.disabled,
      name+" resignation must appear immediately after undo, enabled in active play: "+JSON.stringify(action));
    }
    if(name==="西洋跳棋（8×8）"||name==="中国跳棋"){
     const preload=await frame.locator("#game").evaluate(root=>({
      head:!!document.querySelector("head #gameWorkspaceStyles"),
      measured:root.dataset.boardMeasured==="true",
      columns:root.classList.contains("gs-tools-open"),
      guide:getComputedStyle(root.querySelector(".game-guide")).display
     }));
     assert.ok(preload.head&&preload.measured&&preload.columns&&preload.guide==="none",
      name+" must preload three-column CSS without a legacy left-guide flash: "+JSON.stringify(preload));
    }

    const controls=await page.evaluate(()=>{
      const bar=document.querySelector("#topbar").getBoundingClientRect();
      const modes=[...document.querySelectorAll("#modeControl button")],levels=[...document.querySelectorAll("#difficultyControl button")];
      const selectors=[...modes,...levels];
      const inside=b=>{const r=b.getBoundingClientRect(),s=getComputedStyle(b);return r.width>=28&&r.height>=24&&r.left>=bar.left-1&&r.right<=bar.right+1&&r.top>=bar.top-1&&r.bottom<=bar.bottom+1&&s.visibility==="visible"&&s.display!=="none";};
      const actions=[...document.querySelectorAll("#startButton,#pauseButton,#newGameButton,#helpButton")];
      return{modes:modes.length,levels:levels.length,selectedModes:modes.filter(b=>b.getAttribute("aria-pressed")==="true").length,
       selectedLevels:levels.filter(b=>b.getAttribute("aria-pressed")==="true").length,
       selectorsVisible:selectors.every(inside),actionsVisible:actions.every(inside)};
     });
     const dualModes=new Set(["五子棋","中国象棋","国际象棋","黑白棋","四子棋","西洋跳棋（8×8）","中国跳棋","飞行棋"]);
     assert.equal(controls.modes,dualModes.has(name)?2:0,name+" mode choices must match implemented gameplay");
      if(name==="海战棋"){
       const mode=await page.locator("#modeControl").evaluate(el=>({
        hidden:el.hidden,rects:el.getClientRects().length,display:getComputedStyle(el).display,
        count:el.querySelectorAll("button").length
       }));
       assert.ok(mode.hidden&&mode.rects===0&&mode.display==="none"&&mode.count===0,
        "Battleship AI-only mode must not display a placeholder: "+JSON.stringify(mode));
      }
     assert.equal(controls.levels,["2048","推箱子"].includes(name)?0:name==="经典纸牌"?2:3,name+" difficulty choices must match implemented gameplay");
     assert.equal(controls.selectedModes,controls.modes?1:0,name+" exactly one mode must be selected");
     assert.equal(controls.selectedLevels,controls.levels?1:0,name+" exactly one difficulty must be selected");
     assert.ok(controls.selectorsVisible&&controls.actionsVisible,name+" every header switch and action must remain visible within the viewport: "+JSON.stringify(controls));
     if(controls.modes){
      await page.locator('#modeControl button[data-mode-index="1"]').click();
      assert.equal(await page.locator('#modeControl button[aria-pressed="true"]').getAttribute("data-mode-index"),"1",name+" mode switching must work");
      const duel=await page.locator("#difficultyControl").evaluate(el=>({
       disabled:el.getAttribute("aria-disabled"),opacity:parseFloat(getComputedStyle(el).opacity),
       buttons:[...el.querySelectorAll("button")].every(x=>x.disabled),
       selected:el.querySelector('[aria-pressed="true"]')?.dataset.difficulty
      }));
      assert.ok(duel.disabled==="true"&&duel.buttons&&duel.opacity<=.55,
       name+" two-player mode must visibly disable AI difficulty: "+JSON.stringify(duel));
      await page.locator('#difficultyControl button[data-difficulty="hard"]').evaluate(el=>el.click());
      assert.equal(await page.locator('#difficultyControl button[aria-pressed="true"]').getAttribute("data-difficulty"),duel.selected,
       name+" a disabled difficulty button must not change the selected level");
      await page.locator('#modeControl button[data-mode-index="0"]').click();
      assert.equal(await page.locator("#difficultyControl").getAttribute("aria-disabled"),"false",
       name+" switching back to AI must re-enable difficulty");
      assert.equal(await page.locator("#difficultyControl button:not([disabled])").count(),3);
     }
     if(controls.levels){
      await page.locator('#difficultyControl button[data-difficulty="easy"]').click();
      assert.equal(await page.locator('#difficultyControl button[aria-pressed="true"]').getAttribute("data-difficulty"),"easy",name+" difficulty switching must work");
      await page.locator('#difficultyControl button[data-difficulty="normal"]').click();
     }
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
   if(size.width===1440){
    await page.locator("#startButton").click();
    await page.locator("#gameResultOverlay").waitFor({state:"visible"});
    const summary=await page.locator("#gameResultOverlay").evaluate(el=>({
     status:el.querySelector(".game-result-kicker").textContent,
     title:el.querySelector("#gameResultTitle").textContent,
     actions:[...el.querySelectorAll(".game-result-actions button")].map(x=>x.textContent),
     points:getComputedStyle(el.querySelector("#gameResultScore")).display!=="none"
    }));
    const hasPoints=new Set(["2048","记忆翻牌","俄罗斯方块","贪吃蛇","Pong","魂斗罗（原创模式）","超级玛丽","90 坦克","斗地主","麻将","三国杀"]);
    assert.equal(summary.status,"已结束",name+" manual ending should say 已结束");
    assert.deepEqual(summary.actions,["再来一局","离开"],name+" must offer restart and exit");
    assert.equal(summary.points,hasPoints.has(name),name+" show score only for games with genuine points");
    assert.ok((await page.locator("#gameNoticeText").innerText()).includes("已结束"),name+" LED should announce termination");
    if(name==="五子棋")await page.screenshot({path:path.join(artifacts,"gomoku-manual-ended.png")});
    await page.locator("#gameResultReplay").click();
    await page.locator("#gameResultOverlay").waitFor({state:"hidden"});
    await page.waitForFunction(()=>document.querySelector("#pauseButton").getAttribute("aria-label")==="暂停");
    await page.locator("#startButton").click();
    await page.locator("#gameResultOverlay").waitFor({state:"visible"});
    await page.locator("#gameResultLeave").click();
    await page.locator("#libraryView").waitFor({state:"visible"});
    await page.locator('[data-category="all"]').click();
   }else{
    await page.locator("#newGameButton").click();
    await page.waitForFunction(()=>document.querySelector("#pauseButton").getAttribute("aria-label")==="暂停");
   }
   }
  }
  await page.setViewportSize({width:1440,height:1000});
  // A natural GAME_OVER for a point-scoring game must show its final points.
  await open("俄罗斯方块");await start();
  await frame.locator("#game").evaluate(()=>window.GameBridge.send("GAME_OVER",{message:"测试结算",score:1234,win:false}));
  await page.locator("#gameResultOverlay").waitFor({state:"visible"});
  assert.equal(await page.locator("#gameResultScoreValue").innerText(),"1234");
  await page.locator("#newGameButton").click();
  await page.locator("#gameResultOverlay").waitFor({state:"hidden"});
  await page.waitForFunction(()=>document.querySelector("#gameFrame")?.contentDocument?.getElementById("score")?.textContent==="0");
  assert.equal(await frame.locator("#score").innerText(),"0","Next after scoring must reset the real in-game score");
  await open("扫雷");
  assert.equal(await page.locator("#modeControl").isVisible(),false,"Minesweeper must not show an empty battle-mode label");
  assert.equal(await page.locator("#difficultyControl").isVisible(),true,"Minesweeper must retain its difficulty selector");
  await start();
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
  assert.equal(await mineFixture.locator("#reset svg").count(),1,"Minesweeper reset face must be a local SVG");
  assert.equal(await mineFixture.locator("#reset").getAttribute("data-face"),"normal","Minesweeper reset face must initialize deterministically");
  assert.equal(await mineFixture.locator("#reset").textContent(),"","Minesweeper must not render an OS emoji glyph");
  assert.equal(await mineFixture.locator(".mine-flag-medallion svg").count(),1,"Minesweeper flag medallion must be SVG");
  assert.equal(await mineFixture.locator(".mine-time-medallion svg").count(),1,"Minesweeper clock medallion must be SVG");
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
  const hotkeyHelp=await page.locator("#helpContent .help-chapter").first().evaluate(section=>({
   header:section.querySelector("button")?.textContent||"",text:section.querySelector("p")?.textContent||"",
   open:!section.querySelector("p")?.hidden
  }));
  assert.ok(hotkeyHelp.header.includes("快捷键")&&hotkeyHelp.text.includes("Enter")&&hotkeyHelp.text.includes("暂停")
    &&hotkeyHelp.text.includes("继续")&&hotkeyHelp.open,
    "Enter pause/resume must always be the first expanded help entry: "+JSON.stringify(hotkeyHelp));
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
  assert.ok(Number((await frame.locator("#reversiHistoryCount").innerText()).match(/\d+/)?.[0])>=1,
   "Battleship attacks must record time in the left full-height history");
  assert.equal(await frame.locator(".fleet-boards #own").count(),1,
    "Own fleet must remain beside enemy sea at full size");
  const seaFrame=await frame.locator("#game").evaluate(root=>{
   const own=root.querySelector("#own"),enemy=root.querySelector("#enemy"),record=root.querySelector(".reversi-record-rail");
   return{frame:getComputedStyle(enemy).borderWidth,stage:getComputedStyle(root.querySelector(".game-main-board")).backgroundImage,
    a:own.getBoundingClientRect().right,b:enemy.getBoundingClientRect().left,
    history:record.getBoundingClientRect().height,historyTop:record.getBoundingClientRect().top,
    squareHeight:enemy.getBoundingClientRect().height,squareTop:enemy.getBoundingClientRect().top,
    title:root.querySelector(".fleet-board .fleet-title").getBoundingClientRect().top,
    bottom:own.getBoundingClientRect().bottom};
  });
  assert.equal(seaFrame.frame,"0px","Battleship removes redundant blue grid outline");
  assert.equal(seaFrame.stage,"none","Battleship removes colored middle-stage box");
  assert.ok(Math.abs(seaFrame.history-seaFrame.squareHeight)<3&&Math.abs(seaFrame.historyTop-seaFrame.squareTop)<3,"Sea history must match 10×10 grid not title: "+JSON.stringify(seaFrame));
  assert.ok(seaFrame.b>seaFrame.a,"Sea boards must remain separate around the central axis");
  await page.screenshot({path:path.join(artifacts,"battleship-height-first-enemy.png")});
  // Western checkers: a real legal move changes side highlight and timed history.
  await open("西洋跳棋（8×8）");await start();
  await page.locator('#modeControl button[data-mode-index="1"]').click();
  await frame.locator(".checkers-square:has(.checkers-disc.red)").first().click();
  assert.ok(await frame.locator(".checkers-square.valid").count()>0,
   "Western Checkers must expose legal targets after selecting a red piece");
  await frame.locator(".checkers-square.valid").first().click();
  assert.equal(await frame.locator("#reversiMoveList li").count(),1,
   "Western Checkers must record one timed move");
  assert.equal(await frame.locator("#game").getAttribute("data-turn-side"),"black",
   "Western Checkers current side should highlight black after red moves");
  await frame.locator("#undoButton").click();
  assert.equal(await frame.locator("#reversiMoveList li").count(),0,
   "Western Checkers undo must rewind move history");
  assert.equal(await frame.locator("#game").getAttribute("data-turn-side"),"red");
  await page.screenshot({path:path.join(artifacts,"western-checkers-height-first.png")});
  // Chinese checkers: genuine token travel updates history, active camp and undo.
  await open("中国跳棋");await start();
  await page.locator('#modeControl button[data-mode-index="1"]').click();
  const redStars=await frame.locator(".star-token[data-player='0']").evaluateAll(nodes=>nodes.map(n=>n.dataset.position));
  let starSelected=false;
  for(const spot of redStars){
   await frame.locator('.star-hole[data-spot="'+spot+'"]').click();
   if(await frame.locator(".star-hole.target").count()>0){starSelected=true;break;}
  }
  assert.ok(starSelected,"Chinese Checkers must offer an actual playable move from the opening camp");
  await frame.locator(".star-hole.target").first().click();
  assert.equal(await frame.locator("#reversiMoveList li").count(),1,
   "Chinese Checkers move must enter the left history");
  assert.equal(await frame.locator("#game").getAttribute("data-turn-side"),"yellow");
  assert.equal(await frame.locator(".star-seat-marker").count(),2,"Two-player star must show only two numbered seats");
  assert.equal(await frame.locator(".star-seat-marker.is-current").getAttribute("data-position"),"2","Second player marker must flash without rotating the board");
  await frame.locator("#undoButton").click();
  assert.equal(await frame.locator("#reversiMoveList li").count(),0);
  assert.equal(await frame.locator("#game").getAttribute("data-turn-side"),"red");
  await page.screenshot({path:path.join(artifacts,"chinese-checkers-height-first.png")});
  // Reversi: demonstrate actual legal moves and undo, not merely an attractive board.
  await open("黑白棋");await start();
  await page.locator('#modeControl button[data-mode-index="1"]').click();
  await page.waitForFunction(()=>document.querySelector("#gameFrame")?.contentDocument?.querySelectorAll(".reversi-square.legal").length===4);
  assert.equal(await frame.locator(".reversi-square.legal").count(),4,
   "Black must have exactly four legal moves at the standard Othello opening");
  assert.equal(await frame.locator("#undoButton").isDisabled(),true,
   "Reversi undo must be disabled before the first move");
  assert.equal(await frame.locator(".gs-board-tip").isVisible(),true,"Reversi must explain the highlighted legal moves");
  await frame.locator(".reversi-square.legal").first().click();
  await page.waitForFunction(()=>document.querySelector("#gameFrame")?.contentDocument?.getElementById("black")?.textContent==="4");
  assert.equal(await frame.locator("#white").innerText(),"1","Legal black placement must flip one white disc");
   const activeAfterMove=await frame.locator("#game").evaluate(root=>({
    turn:root.dataset.turnSide,
    backgrounds:[...root.querySelectorAll(".reversi-count-row")].map(row=>getComputedStyle(row).backgroundColor)
   }));
   assert.equal(activeAfterMove.turn,"white","Two-player Reversi should alternate to the white side");
   assert.notEqual(activeAfterMove.backgrounds[0],activeAfterMove.backgrounds[1],
    "White side must become the highlighted counter");
  assert.equal(await frame.locator("#undoButton").isEnabled(),true,"Undo must enable after a move");
   assert.equal(await frame.locator("#reversiHistoryCount").innerText(),"1 步");
   assert.equal(await frame.locator("#reversiMoveList li").count(),1);
   assert.ok((await frame.locator("#reversiMoveList li").first().innerText()).includes("黑色棋子"));
  await frame.locator("#undoButton").click();
  await page.waitForFunction(()=>document.querySelector("#gameFrame")?.contentDocument?.getElementById("black")?.textContent==="2");
  assert.equal(await frame.locator("#white").innerText(),"2","Undo must restore standard four-disc opening");
  assert.equal(await frame.locator("#undoButton").isDisabled(),true,"Undo must disable when the history is empty");
   assert.equal(await frame.locator("#reversiHistoryCount").innerText(),"0 步");
   assert.equal(await frame.locator("#reversiMoveList li").count(),0);
  await page.screenshot({path:path.join(artifacts,"reversi-refined-playing.png")});

  // Connect Four: use actual player actions and the same Xiangqi/Reversi side rails.
  await open("四子棋");await start();
  await page.locator('#modeControl button[data-mode-index="1"]').click();
  assert.equal(await frame.locator("#reversiHistoryCount").innerText(),"0 步");
  await frame.locator(".connect4-slot").first().click();
  await page.waitForFunction(()=>document.querySelector("#gameFrame")?.contentDocument?.getElementById("red")?.textContent==="1");
  assert.equal(await frame.locator("#yellow").innerText(),"0");
  assert.equal(await frame.locator("#reversiHistoryCount").innerText(),"1 步");
  assert.equal(await frame.locator("#reversiMoveList li").count(),1);
  const fourTurn=await frame.locator("#game").evaluate(el=>({
   turn:el.dataset.turnSide,backgrounds:[...el.querySelectorAll(".reversi-count-row")].map(e=>getComputedStyle(e).backgroundColor)
  }));
  assert.equal(fourTurn.turn,"yellow","Red drop must hand the turn and highlight to yellow");
  assert.notEqual(fourTurn.backgrounds[0],fourTurn.backgrounds[1],"Current Connect Four side must be highlighted");
  await frame.locator("#undoButton").click();
  await page.waitForFunction(()=>document.querySelector("#gameFrame")?.contentDocument?.getElementById("red")?.textContent==="0");
  assert.equal(await frame.locator("#reversiMoveList li").count(),0,"Connect Four undo must remove timed history entry");
  assert.equal(await frame.locator("#reversiHistoryCount").innerText(),"0 步");
  assert.equal(await frame.locator("#game").getAttribute("data-turn-side"),"red");
  await page.screenshot({path:path.join(artifacts,"connect4-workspace-and-stacked-counters.png")});

  // Genuine Connect Four end packets: AI uses win/loss, local duel names winner.
  await page.locator('#modeControl button[data-mode-index="0"]').click();
  await frame.locator("#game").evaluate(()=>window.GameBridge.send("GAME_OVER",
   {message:"红方获胜",winner:"红方",draw:false,win:true}));
  await page.locator("#gameResultOverlay").waitFor({state:"visible"});
  assert.equal(await page.locator("#gameResultTitle").innerText(),"获胜");
  assert.ok(!(await page.locator("#gameResultMessage").innerText()).includes("红方"));
  await page.locator("#newGameButton").click();
  await page.locator("#gameResultOverlay").waitFor({state:"hidden"});
  await frame.locator("#game").evaluate(()=>window.GameBridge.send("GAME_OVER",
   {message:"黄方获胜",winner:"黄方",draw:false,win:false}));
  await page.locator("#gameResultOverlay").waitFor({state:"visible"});
  assert.equal(await page.locator("#gameResultTitle").innerText(),"失败");
  assert.ok(!(await page.locator("#gameResultMessage").innerText()).includes("黄方"));
  await page.locator('#modeControl button[data-mode-index="1"]').click();
  await page.locator("#gameResultOverlay").waitFor({state:"hidden"});
  await frame.locator("#game").evaluate(()=>window.GameBridge.send("GAME_OVER",
   {message:"红方获胜",winner:"红方",draw:false,win:true}));
  await page.locator("#gameResultOverlay").waitFor({state:"visible"});
  assert.equal(await page.locator("#gameResultTitle").innerText(),"红方获胜");
  await page.locator("#newGameButton").click();
  await page.locator("#gameResultOverlay").waitFor({state:"hidden"});
  await frame.locator("#game").evaluate(()=>window.GameBridge.send("GAME_OVER",
   {message:"黄方获胜",winner:"黄方",draw:false,win:false}));
  await page.locator("#gameResultOverlay").waitFor({state:"visible"});
  assert.equal(await page.locator("#gameResultTitle").innerText(),"黄方获胜");
  await page.locator("#newGameButton").click();
  await page.locator("#gameResultOverlay").waitFor({state:"hidden"});
  await frame.locator("#game").evaluate(()=>window.GameBridge.send("GAME_OVER",
   {message:"平局",winner:null,draw:true,win:false}));
  await page.locator("#gameResultOverlay").waitFor({state:"visible"});
  assert.equal(await page.locator("#gameResultTitle").innerText(),"平局");
  await page.locator("#newGameButton").click();
  await page.locator("#gameResultOverlay").waitFor({state:"hidden"});
  // Natural win, not an injected packet: red makes four vertically in column 1.
  for(const col of [0,1,0,1,0,1,0]){
   await frame.locator('.connect4-slot[data-column="'+col+'"]').first().click();
  }
  await page.locator("#gameResultOverlay").waitFor({state:"visible",timeout:4000});
  assert.equal(await page.locator("#gameResultTitle").innerText(),"红方获胜",
   "A real four-in-a-column local duel must announce the side that connected four");
  assert.equal(await frame.locator("#reversiHistoryCount").innerText(),"7 步");
  await page.locator("#newGameButton").click();
  await page.locator("#gameResultOverlay").waitFor({state:"hidden"});
  // At the requested wide desktop proportions, the Four-in-a-Row board must
  // actually fill most of the available height, not merely appear centered.
  await page.setViewportSize({width:1671,height:892});
  await open("四子棋");await start();
  await page.waitForTimeout(100);
  const tallFour=await frame.locator("#board").evaluate(board=>{
   const b=board.getBoundingClientRect(),root=board.closest(".game-root").getBoundingClientRect();
   return{boardHeight:b.height,stageHeight:root.height,ratio:b.height/root.height};
  });
  assert.ok(tallFour.ratio>=.90,
   "Wide desktop Connect Four must prioritize height just like Xiangqi: "+JSON.stringify(tallFour));
  await page.screenshot({path:path.join(artifacts,"connect4-height-first-1671x892.png")});
  await page.setViewportSize({width:1440,height:1000});
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
  await page.locator("#newGameButton").click();
  await frame.locator(".stone").first().waitFor({state:"detached",timeout:4000});
  assert.equal(await frame.locator(".stone").count(),0,"Top-right next round must actually clear Gomoku stones");
  await frame.locator(".gomoku-cell").nth(112).click();
  assert.equal(await frame.locator(".stone").count(),1,"Gomoku must accept moves after clicking next round");
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
  await frame.locator('#game').evaluate(()=>window.__p111GomokuTest.forceFinish(1));
  await frame.locator("#gomokuResult:not([hidden])").waitFor({timeout:4000});
  await page.locator("#newGameButton").click();
  await frame.locator("#gomokuResult").waitFor({state:"hidden",timeout:4000});
  assert.equal(await frame.locator(".stone").count(),0,"Next after a win must dismiss Gomoku result and clear stones");
  await frame.locator(".gomoku-cell").nth(112).click();
  assert.equal(await frame.locator(".stone").count(),1,"Next after a win must remain playable");
  await frame.locator('#game').evaluate(()=>window.__p111GomokuTest.forceFinish(-1));
  await frame.locator("#gomokuResult:not([hidden])").waitFor({timeout:4000});
  assert.equal(await frame.locator("#gomokuResult").getAttribute("data-result"),"loss");
  await page.screenshot({path:path.join(artifacts,"gomoku-loss-1440x1000.png")});
  await frame.locator("#gomokuLeave").click();
  await page.locator("#libraryView").waitFor({state:"visible"});
  await open("中国象棋");await start();
  await frame.locator('.xiangqi-cell[data-x="0"][data-y="6"]').click();
  await frame.locator('.xiangqi-cell[data-x="0"][data-y="5"]').click();
  const realXiangqiClock=await frame.locator("#game").evaluate(el=>({
   count:Number(el.dataset.turnClockCount),side:el.dataset.turnClockSide,
   last:window.GameTurnClock?.snapshot().records[0]?.label
  }));
  assert.ok(realXiangqiClock.count>=1&&realXiangqiClock.last?.includes("兵"),
   "A real Xiangqi pawn move must record its notation and elapsed time: "+JSON.stringify(realXiangqiClock));
  const inlineTiming=await frame.locator("#moveList li").first().evaluate(row=>{
   const index=row.querySelector(".xiangqi-move-index"),rect=index.getBoundingClientRect(),
    next=row.querySelector(".xiangqi-move-side").getBoundingClientRect();
   const range=document.createRange();range.selectNodeContents(index);
   const rects=[...range.getClientRects()].map(x=>({left:x.left,right:x.right,top:x.top,bottom:x.bottom}));
   const measure=text=>{const before=index.textContent;index.textContent=text;
    range.selectNodeContents(index);
    const rs=[...range.getClientRects()].map(x=>({left:x.left,right:x.right,top:x.top,bottom:x.bottom}));
    const width=index.scrollWidth;index.textContent=before;
    return{rects:rs,scrollWidth:width};
   };
   return{index:index.textContent,tooltip:index.title,rects,rectLeft:rect.left,rectRight:rect.right,
    nextLeft:next.left,whiteSpace:getComputedStyle(index).whiteSpace,
    long:measure("1.（123:45.6/987:65.4s）"),
    rightLog:getComputedStyle(document.querySelector(".gs-turn-clock-history")).display};
  });
  assert.match(inlineTiming.index,/^1\.（\d+[.:]\d+(?:\/\d+[.:]\d+)?s）$/,
   "Xiangqi needs an inline elapsed-time bracket after the round number: "+JSON.stringify(inlineTiming));
  assert.match(inlineTiming.tooltip,/红方/);
  assert.equal(inlineTiming.rightLog,"none");
  assert.equal(inlineTiming.whiteSpace,"nowrap","Turn labels must never wrap digit by digit");
  assert.equal(inlineTiming.rects.length,1,"The entire actual turn label must occupy one line");
  assert.ok(inlineTiming.rects[0].right<=inlineTiming.rectRight+1&&inlineTiming.rectRight<=inlineTiming.nextLeft+.6,
   "Actual Xiangqi turn label must fit within its own first column: "+JSON.stringify(inlineTiming));
  assert.equal(inlineTiming.long.rects.length,1,"Long turn times must not split into several vertical lines");
  const xiangqiRatio=await frame.locator(".xiangqi-piece").first().evaluate(el=>{
   const r=el.getBoundingClientRect();return{width:r.width,height:r.height,round:getComputedStyle(el).borderRadius};
  });
  assert.ok(Math.abs(xiangqiRatio.width-xiangqiRatio.height)<=.5,"Xiangqi pieces must be mathematically square before border-radius, not elliptical: "+JSON.stringify(xiangqiRatio));
  assert.equal(await frame.locator(".xiangqi-cell").count(),90,"Xiangqi must have exactly 90 intersections");
  await open("国际象棋");await start();
  await frame.locator(".chess-square").first().waitFor({state:"attached",timeout:10000});
  assert.equal(await frame.locator(".chess-square").count(),64);
  await page.locator('#modeControl button[data-mode-index="1"]').click();
  await frame.locator('[data-square="e2"]').click();await frame.locator('[data-square="e4"]').click();
  assert.equal(await frame.locator("#moveList li").count(),1);
  await frame.locator("#undoButton").click();
  assert.equal(await frame.locator("#moveList li").count(),0);
  await frame.locator("#game").evaluate(()=>window.GameBridge.send("GAME_OVER",{message:"白方将死获胜",win:true}));
  await page.locator("#gameResultOverlay").waitFor({state:"visible"});
  assert.equal(await page.locator("#gameResultTitle").innerText(),"白方获胜",
   "Local chess checkmate must identify the winning side rather than show generic end");
  await page.locator("#newGameButton").click();
  await page.locator("#gameResultOverlay").waitFor({state:"hidden"});
  await open("飞行棋");await start();
  // Flight right-side panels must be packed together with no blank gap; dice
  // and clock remain fixed while available aircraft options appear below stats.
  const flightLayout=()=>frame.locator("#game").evaluate(root=>{
   const rect=q=>{const r=root.querySelector(q).getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:r.height};};
   return{right:rect(":scope > .game-tools"),dice:rect(".flight-play-controls"),
    help:rect("#flightMoveHelp"),options:rect(".flight-move-panel"),scores:rect(".reversi-side-score")};
  });
  const beforeOptions=await flightLayout();
  assert.ok(beforeOptions.right.height>0&&beforeOptions.help.top<beforeOptions.dice.top,
   "Flight right rail must render fixed help above its dice: "+JSON.stringify(beforeOptions));
  await frame.locator("#game").evaluate(()=>{
   // Force a real six at the crypto source for this layout acceptance test.
   const cryptoObj=window.crypto,real=cryptoObj.getRandomValues.bind(cryptoObj);
   let calls=0;
   Object.defineProperty(cryptoObj,"getRandomValues",{configurable:true,value:array=>{
    if(calls++===0){array[0]=5;return array;}
    return real(array);
   }});
  });
  await frame.locator("#rollButton").click();
  await frame.locator("#flightMoveOptions button").first().waitFor({state:"visible",timeout:6000});
  const afterOptions=await flightLayout();
  assert.ok(afterOptions.options.top-afterOptions.scores.bottom>=-2&&afterOptions.options.top-afterOptions.scores.bottom<24,
   "Aircraft options must follow the score cards directly, not float at the bottom: "+JSON.stringify(afterOptions));
  assert.ok(afterOptions.options.bottom<=afterOptions.right.bottom+5,
   "Packed right rail must not overflow the actual board height: "+JSON.stringify(afterOptions));
  assert.ok(Math.abs(afterOptions.dice.top-beforeOptions.dice.top)<3,
   "Dice panel must never shift when selectable airplane count changes: "+JSON.stringify({beforeOptions,afterOptions}));

  await page.locator('#modeControl button[data-mode-index="1"]').click();
  await frame.locator("#game").evaluate(()=>window.GameBridge.send("GAME_OVER",{message:"蓝方获胜",win:false}));
  await page.locator("#gameResultOverlay").waitFor({state:"visible"});
  assert.equal(await page.locator("#gameResultTitle").innerText(),"蓝方获胜",
   "Local flight chess settlement must recognize the blue side");
  await page.locator("#newGameButton").click();
  await page.locator("#gameResultOverlay").waitFor({state:"hidden"});
  await open("中国象棋");await start();assert.equal(await frame.locator(".xiangqi-cell").count(),90);
   await frame.locator("#resignButton").click();
   await frame.locator("#xiangqiResult:not([hidden])").waitFor({timeout:4000});
   assert.equal(await frame.locator("#xiangqiResultTitle").innerText(),"失败",
    "AI mode resigning as red must show a loss result, not a neutral message");
   await page.waitForFunction(()=>document.querySelector("#startButton")?.disabled===true);
   await frame.locator("#xiangqiReplay").click();
   await frame.locator("#xiangqiResult").waitFor({state:"hidden",timeout:4000});
   assert.equal(await frame.locator(".xiangqi-piece").count(),32,
    "Replay must create all 32 starting Xiangqi pieces");
    const resetClock=await frame.locator("#game").evaluate(el=>({count:Number(el.dataset.turnClockCount),side:el.dataset.turnClockSide}));
    assert.equal(resetClock.count,0,"Replaying Xiangqi must clear recorded operation times");
    assert.equal(resetClock.side,"红方","Xiangqi timer must begin with red side");
   assert.equal(await frame.locator("#moveCount").innerText(),"0 步",
    "Replay must reset notation");
    await page.locator("#startButton").click();
    await page.locator("#gameResultOverlay").waitFor({state:"visible",timeout:4000});
    assert.equal(await page.locator("#gameResultTitle").innerText(),"本局结束",
     "Manual Xiangqi end must use the host's unified ending card, without misreporting victory");
    assert.equal(await frame.locator("#xiangqiResult").isVisible(),false,
     "Manual end must not duplicate the native Xiangqi win/loss card");
    await page.locator("#gameResultReplay").click();
    await page.locator("#gameResultOverlay").waitFor({state:"hidden",timeout:4000});
    await page.waitForFunction(()=>document.querySelector("#gameFrame")?.contentDocument?.querySelectorAll(".xiangqi-piece").length===32);
    assert.equal(await frame.locator(".xiangqi-piece").count(),32);
   await frame.locator("#resignButton").click();
   await frame.locator("#xiangqiResult:not([hidden])").waitFor({timeout:4000});
   await frame.locator("#xiangqiLeave").click();
   await page.locator("#libraryView").waitFor({state:"visible",timeout:4000});
    await page.locator('[data-category="all"]').click();
   
  // Test actual host termination, not just the existence of resign buttons.
  for(const title of resignGames){
   await open(title);await start();
   await frame.locator("#resignButton:enabled").waitFor({state:"visible",timeout:3500});
   await frame.locator("#resignButton").click();
   await page.locator("#startButton:disabled").waitFor({state:"visible",timeout:4000});
   const outcome=await page.locator("#gameNotice").innerText();
   assert.match(outcome,/认输/,title+" must report a real resignation result");
   if(title==="五子棋"){
    await frame.locator("#gomokuResult:not([hidden])").waitFor({state:"visible",timeout:4000});
    assert.equal(await frame.locator("#gomokuResult").getAttribute("data-result"),"loss",
     "AI Gomoku resignation must show its native defeat animation");
   }
   if(title==="国际象棋")
    assert.match(await frame.locator("#turnText").innerText(),/黑方获胜/);
  }
  await open("斗地主");await start();assert.equal(await frame.locator(".playing-card").count(),17);
  await frame.locator("#game").evaluate(()=>window.GameBridge.send("GAME_OVER",
   {message:"积分结算测试",score:-90,win:false}));
  await page.locator("#gameResultOverlay").waitFor({state:"visible"});
  assert.equal(await page.locator("#gameResultScoreLabel").innerText(),"本局结算");
  assert.equal(await page.locator("#gameResultScoreValue").innerText(),"-90",
   "Doudizhu settlement must preserve negative losses rather than show zero points");
  await page.locator("#newGameButton").click();
  await page.locator("#gameResultOverlay").waitFor({state:"hidden"});
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
  // Fullscreen keeps only the current game surface, plus a small exit
  // control inside its upper-right edge. Normal and Esc exit restore chrome.
  await open("飞行棋");await start();
  await page.locator("#fullscreenButton").click();
  const entered=await page.evaluate(()=>({
   shell:document.querySelector("#appShell").className,
   workspace:document.querySelector("#workspaceView").className,
   exitExists:!!document.querySelector("#exitFullscreenButton"),
   exitHidden:document.querySelector("#exitFullscreenButton")?.hidden,
   gameSrc:document.querySelector("#gameFrame").src,native:!!document.fullscreenElement
  }));
  assert.match(entered.shell,/game-only-fullscreen/,
   "Game-only fullscreen must be active immediately: "+JSON.stringify({entered,errors:errors.slice(-3)}));
  const full=await page.evaluate(()=>{
   const rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return{left:r.left,top:r.top,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
   return{sidebar:getComputedStyle(document.querySelector("#sidebar")).display,
    topbar:getComputedStyle(document.querySelector("#topbar")).display,
    exit:getComputedStyle(document.querySelector("#exitFullscreenButton")).display,
    stage:rect("#gameStage"),exitRect:rect("#exitFullscreenButton"),viewport:[innerWidth,innerHeight]};
  });
  assert.equal(full.sidebar,"none","Game-only fullscreen must hide navigation");
  assert.equal(full.topbar,"none","Game-only fullscreen must hide the top game bar");
  assert.notEqual(full.exit,"none","Fullscreen must show one in-stage exit control");
  assert.ok(full.stage.width>=full.viewport[0]-2&&full.stage.height>=full.viewport[1]-2&&
   Math.abs(full.stage.left)<=2&&Math.abs(full.stage.top)<=2,
   "Only the game must fill the fullscreen viewport: "+JSON.stringify(full));
  assert.ok(full.exitRect.right<=full.viewport[0]-8&&full.exitRect.top<=28,
   "Game-only exit control must be in the upper-right corner");
  await page.locator("#exitFullscreenButton").click();
  await page.waitForFunction(()=>!document.querySelector("#appShell").classList.contains("game-only-fullscreen"));
  assert.equal(await page.locator("#exitFullscreenButton").isVisible(),false);
  assert.equal(await page.locator("#sidebar").isVisible(),true);
  assert.equal(await page.locator("#topbar").isVisible(),true);
  await page.locator("#fullscreenButton").click();
  await page.waitForFunction(()=>document.querySelector("#appShell").classList.contains("game-only-fullscreen"));
  await page.keyboard.press("Escape");
  await page.waitForFunction(()=>!document.querySelector("#appShell").classList.contains("game-only-fullscreen"));
  assert.equal(await page.locator("#topbar").isVisible(),true);
  assert.equal(await page.locator("#sidebar").isVisible(),true);
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
})().then(()=>{
 console.log("Running deterministic game-rule regression fixtures...");
 execFileSync(process.execPath,[path.join(__dirname,"rules.cjs")],{env:process.env,stdio:"inherit"});
}).catch(err=>{console.error(err);process.exit(1);});
