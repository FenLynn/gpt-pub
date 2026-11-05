const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);

const games = [
  "五子棋","中国象棋","国际象棋","黑白棋","四子棋","海战棋","国际跳棋",
  "扫雷","2048","记忆翻牌","数独","推箱子",
  "俄罗斯方块","贪吃蛇","Pong","魂斗罗（原创模式）","超级玛丽","90 坦克",
  "经典纸牌","斗地主","麻将","三国杀"
];

(async () => {
  const root = path.resolve(__dirname, "../app");
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_BIN,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--allow-file-access-from-files"]
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const remoteRequests = [], pageErrors = [], browserConsole = [];
  let currentGame = "host";
  page.on("console", message => browserConsole.push(message.type()+": "+message.text()));
  page.on("requestfailed", request => browserConsole.push("requestfailed: "+request.url()+" "+request.failure()?.errorText));
  page.on("request", request => { if (/^https?:/i.test(request.url())) remoteRequests.push(request.url()); });
  page.on("pageerror", error => pageErrors.push(currentGame+": "+error.message));

  async function openLibrary() {
    if (!(await page.locator("#libraryView").isVisible())) {
      await page.locator('[data-category="all"]').click();
    }
  }

  async function openGame(name) {
    if (await page.locator("#workspaceView").isVisible()) {
      const mobileMenu = page.locator("#mobileMenu");
      const menuOpen = await page.locator("#appShell").evaluate(el => el.classList.contains("menu-open"));
      if (await mobileMenu.isVisible() && !menuOpen) await mobileMenu.click();
      await page.locator('[data-category="all"]').click();
      currentGame = "host";
    } else {
      await openLibrary();
    }
    currentGame = name;
    await page.locator(".game-card").filter({ hasText: name }).click();
    try {
      await page.frameLocator("#gameFrame").locator("#game").waitFor({ state: "visible", timeout: 10000 });
      await page.locator("#startButton").waitFor({ state: "visible" });
      await page.locator("#startButton").waitFor({ state: "attached" });
      await page.waitForFunction(() => !document.querySelector("#startButton").disabled);
      await page.locator("#gameFrame").evaluate(frame => frame.focus());
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => !document.querySelector("#pauseButton").disabled);
      await page.keyboard.press("Enter");
      assert.equal(await page.locator("#pauseButton").getAttribute("aria-label"), "暂停", "Enter should start or resume, never toggle a running game into pause");
      await page.waitForFunction(() => document.activeElement?.id === "gameFrame");
      const frameLayout = await page.frameLocator("#gameFrame").locator("#game").evaluate(root => {
        const main = root.querySelector(".game-main-board");
        const rect = (main || root).getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      assert.ok(frameLayout.width > 200 && frameLayout.height > 250, name + " should receive a usable game area");
      const zones=await page.frameLocator("#gameFrame").locator("#game").evaluate(root=>{
        const guide=root.querySelector(".game-guide"),tools=root.querySelector(".game-tools"),main=root.querySelector(".game-main-board");
        const rr=root.getBoundingClientRect(),tr=tools?.getBoundingClientRect(),mr=main?.getBoundingClientRect();
        const ts=tools?getComputedStyle(tools):null,ms=main?getComputedStyle(main):null;
        return {guide:guide?getComputedStyle(guide).display:"absent",tools:ts?.display||"absent",toolsVisibility:ts?.visibility||"absent",toolsOpacity:ts?.opacity||"0",toolsText:tools?.innerText?.slice(0,90)||"",main:mr?.width||0,mainLeft:mr?.left||0,mainTop:mr?.top||0,mainBottom:mr?.bottom||0,mainRight:mr?.right||0,toolsX:tr?.x||0,toolsTop:tr?.top||0,toolsBottom:tr?.bottom||0,toolsWidth:tr?.width||0,toolsRight:tr?.right||0,rootLeft:rr.left,rootTop:rr.top,rootBottom:rr.bottom,rootRight:rr.right,columns:getComputedStyle(root).gridTemplateColumns,rootDisplay:getComputedStyle(root).display,scroll:document.documentElement.scrollHeight,scrollWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth,viewportHeight:innerHeight};
      });
      assert.notEqual(zones.tools,"none",name+" right-side game actions must remain visible");
      assert.ok(zones.toolsWidth>150&&zones.toolsRight<=zones.rootRight+2&&zones.toolsVisibility==="visible"&&Number(zones.toolsOpacity)>.1,name+" right rail must be visible, occupy real width and remain inside the game root; "+JSON.stringify(zones));
      if(page.viewportSize().width>700){
        assert.ok(zones.mainRight<=zones.toolsX+2,name+" main board must not overlap the right rail; "+JSON.stringify(zones));
        assert.ok(zones.mainTop>=zones.rootTop-1&&zones.mainBottom<=zones.rootBottom+2,name+" main board must remain vertically inside the game workspace; "+JSON.stringify(zones));
        assert.ok(zones.toolsTop>=zones.rootTop-1&&zones.toolsBottom<=zones.rootBottom+2,name+" right controls must remain vertically inside the game workspace; "+JSON.stringify(zones));
        assert.ok(zones.scrollWidth<=zones.viewportWidth+2,name+" must not introduce desktop horizontal page overflow; "+JSON.stringify(zones));
      }
      if(name==="经典纸牌")console.log("SOLITAIRE_LAYOUT "+JSON.stringify(zones));
      if(zones.guide!=="absent"&&page.viewportSize().width>700)assert.notEqual(zones.guide,"none",name+" left-side keyboard and rule guide must remain visible on desktop");
      assert.ok(zones.main>250,name+" central board must retain priority workspace width");
      await page.waitForFunction(() => {
        const el=document.querySelector("#stageLoading");
        return !el || (el.classList.contains("done") && Number(getComputedStyle(el).opacity)<0.05);
      });
      await page.evaluate(()=>{
        const toast=document.querySelector("#toast"),loading=document.querySelector("#stageLoading");
        if(toast){toast.classList.remove("show");toast.style.visibility="hidden";}
        if(loading)loading.style.visibility="hidden";
      });
      await fs.promises.mkdir(path.resolve(__dirname,"../p111-smoke-artifacts/games"),{recursive:true});
      const viewport=page.viewportSize();
      const screenshotName=name.replace(/[^\p{L}\p{N}-]+/gu,"-")+"-"+viewport.width+"x"+viewport.height;
      await page.screenshot({path:path.resolve(__dirname,"../p111-smoke-artifacts/games/"+screenshotName+".png")});
      await page.evaluate(()=>{
        const toast=document.querySelector("#toast"),loading=document.querySelector("#stageLoading");
        if(toast)toast.style.visibility="";
        if(loading)loading.style.visibility="";
      });
      await page.keyboard.press("p");
      await page.waitForFunction(() => document.querySelector("#pauseButton")?.getAttribute("aria-label") === "继续");
      assert.equal(await page.locator("#startButton").getAttribute("aria-label"), "结束", "pause must not change the start/end action");
      assert.equal(await page.locator("#pauseButton .action-label").innerText(), "继续", "pause control should expose its current action");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector("#pauseButton")?.getAttribute("aria-label") === "暂停");
      await page.waitForTimeout(80);
    } catch (error) {
      console.error("Failed game:", name);
      console.error("iframe src:", await page.locator("#gameFrame").getAttribute("src"));
      console.error("frame URLs:", page.frames().map(frame => frame.url()));
      console.error("iframe body:", await page.frameLocator("#gameFrame").locator("body").innerText().catch(e => String(e)));
      console.error("browser console:", browserConsole);
      throw error;
    }
  }

  try {
    await page.goto(pathToFileURL(path.join(root, "index.html")).href);
    await page.locator("#homeDate").waitFor({ state: "visible" });
    const chromeLayout = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      return {
        brandHeight: rect(".brand").height,
        topbarHeight: rect("#topbar").height,
        sidebarColor: getComputedStyle(document.querySelector(".sidebar")).backgroundColor,
        topbarColor: getComputedStyle(document.querySelector("#topbar")).backgroundColor,
        workspaceColor: getComputedStyle(document.querySelector("#workspaceView")).backgroundColor,
        logoSquares: document.querySelectorAll(".brand-mark i").length,
        favicon: document.querySelector('link[rel="icon"]')?.getAttribute("href") || ""
      };
    });
    assert.equal(chromeLayout.logoSquares, 4, "four-square brand mark should be retained");
    assert.equal(chromeLayout.brandHeight, chromeLayout.topbarHeight, "brand rail and topbar should have equal height");
    assert.equal(chromeLayout.sidebarColor, chromeLayout.topbarColor, "left navigation and topbar should share a color");
    assert.notEqual(chromeLayout.workspaceColor, chromeLayout.topbarColor, "game workspace should have a separate surface color");
    assert.ok(chromeLayout.favicon.startsWith("data:image/svg+xml"), "four-square favicon should be local and offline");
    assert.match(await page.locator("#homeDate").innerText(), /^\d{1,2}月\d{1,2}日 · 星期[一二三四五六日]$/, "home date and weekday should share the same line");
    assert.match(await page.locator("#homeTime").innerText(), /^\d{2}:\d{2}$/, "home clock should show local hours and minutes");
    assert.ok(await page.locator(".home-hero").isVisible(), "home should show the redesigned hero");
    assert.ok(await page.locator(".quick-start").isVisible(), "home should show the quick-start categories");
    const homeActivityHeight=await page.locator(".activity-panel").evaluate(el=>el.getBoundingClientRect().height);
    assert.ok(homeActivityHeight<=300, "home activity heatmap should be a compact dashboard card, not a full-height empty panel");
    assert.equal(await page.locator("#totalGameCount").innerText(), "22");
    assert.equal(await page.locator("[data-home-category]").count(), 4, "home quick-start should expose all four game categories");
    assert.ok(await page.locator(".recent-panel").isVisible(), "home should show recent games beside the activity heatmap");
    assert.equal(await page.locator(".recent-game").count(), 4, "home should show four recent or recommended games");
    assert.equal(await page.locator(".featured-game").count(), 8, "home should expose the eight curated classic games");
    assert.ok(await page.locator("#rankingEmpty").isVisible(), "empty ranking should show a useful empty state instead of a blank panel");
    assert.equal(await page.locator(".heatmap-cell[data-date]").count(), 365, "activity grid must contain 365 real calendar days");
    assert.ok((await page.locator(".heatmap-cell").count()) <= 371, "weekday alignment may add at most six leading placeholders");
    await fs.promises.mkdir(path.resolve(__dirname,"../p111-smoke-artifacts"),{recursive:true});
    await page.screenshot({path:path.resolve(__dirname,"../p111-smoke-artifacts/home-1440x1000.png")});
    await page.locator('[data-ranking="time"]').click();
    assert.ok(await page.locator('[data-ranking="time"]').getAttribute("aria-selected") === "true");
    await page.locator('[data-ranking="plays"]').click();
    await page.locator('[data-category="all"]').click();
    assert.equal(await page.locator(".game-card").count(), 22, "all 22 planned games must appear in the library");

    for (const name of games) await openGame(name);

    await openGame("2048");
    const g2048 = page.frameLocator("#gameFrame");
    assert.equal(await g2048.locator(".tile").count(), 16);
    assert.equal(await g2048.locator(".number-tile[data-value='2'],.number-tile[data-value='4']").count(),2,"2048 should start with two styled number tiles");
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(1150);
    assert.equal(await page.locator("#startButton").getAttribute("aria-label"), "结束", "start action should become end after the game starts");
    assert.equal(await page.locator("#pauseButton").getAttribute("aria-label"), "暂停");
    assert.equal(await page.locator("#newGameButton").getAttribute("aria-label"), "下一局");
    const toolbarOrder = await page.locator("#gameActions").evaluate(el=>Array.from(el.children).map(node=>node.id||"elapsed"));
    assert.deepEqual(toolbarOrder.slice(0,4), ["elapsed","startButton","pauseButton","newGameButton"], "toolbar actions should keep time/start/pause/next order");
    await page.locator("#pauseButton").click();
    assert.equal(await page.locator("#pauseButton").getAttribute("aria-label"), "继续");
    const pausedAt = await page.locator("#gameElapsed").innerText();
    await page.waitForTimeout(1350);
    assert.equal(await page.locator("#gameElapsed").innerText(), pausedAt, "paused time must not be counted");
    await page.locator("#pauseButton").click();
    assert.equal(await page.locator("#pauseButton").getAttribute("aria-label"), "暂停");
    await page.waitForTimeout(2200);
    assert.notEqual(await page.locator("#gameElapsed").innerText(), pausedAt, "the game clock must resume after unpausing");
    await page.locator("#startButton").click();
    assert.equal(await page.locator("#startButton").getAttribute("aria-label"), "结束");
    assert.equal(await page.locator("#startButton").isDisabled(), true, "end action should lock after the round ends");
    await page.locator("#newGameButton").click();
    assert.equal(await page.locator("#startButton").getAttribute("aria-label"), "结束", "next round should reset and immediately start a playable new round");
    assert.equal(await page.locator("#pauseButton").getAttribute("aria-label"), "暂停", "next round should not remain paused");

    await openGame("记忆翻牌");
    const memory = page.frameLocator("#gameFrame");
    assert.equal(await memory.locator(".game-cell").count(), 16);
    assert.equal(await memory.locator(".memory-card.face-down").count(),16,"memory cards should have blue card backs");
    await memory.locator(".game-cell").nth(0).click();
    await memory.locator(".game-cell").nth(1).click();
    assert.equal(await memory.locator("#moves").innerText(), "1");

    await openGame("黑白棋");
    const reversi = page.frameLocator("#gameFrame");
    assert.equal(await reversi.locator(".reversi-square").count(),64,"Reversi must render an 8×8 grid");
    assert.equal(await reversi.locator(".reversi-disc").count(),4,"Reversi should start with four round discs");
    const reversiPiece=await reversi.locator(".reversi-disc").first().evaluate(el=>({disc:el.getBoundingClientRect().width,cell:el.parentElement.getBoundingClientRect().width}));
    assert.ok(reversiPiece.disc>20&&reversiPiece.disc<reversiPiece.cell*.92,"Reversi disc must sit INSIDE the tile, not color the entire square");

    await openGame("国际跳棋");
    const checkers = page.frameLocator("#gameFrame");
    assert.equal(await checkers.locator(".checkers-square").count(),64,"Checkers must render an 8×8 board");
    assert.equal(await checkers.locator(".checkers-disc").count(),24,"Checkers should start with 24 distinct round pieces");
    const checkersPiece=await checkers.locator(".checkers-disc").first().evaluate(el=>({disc:el.getBoundingClientRect().width,cell:el.parentElement.getBoundingClientRect().width}));
    assert.ok(checkersPiece.disc>20&&checkersPiece.disc<checkersPiece.cell*.92,"Checkers pieces must not be colored board squares");

    await openGame("四子棋");
    const connect4 = page.frameLocator("#gameFrame");
    assert.equal(await connect4.locator(".connect4-disc").count(),42,"Connect Four must render all 42 recessed wells");
    await connect4.locator(".game-cell").first().click();
    assert.equal(await connect4.locator("#red").innerText(), "1");
    await page.locator("#modeControl button[data-mode-index='1']").click();
    await connect4.locator(".game-cell").nth(0).click();
    assert.equal(await connect4.locator("#status").textContent(), "黄方回合", "local Connect Four must announce the human yellow player, not AI");
    await connect4.locator(".game-cell").nth(1).click();
    assert.equal(await connect4.locator("#yellow").innerText(), "1", "local Connect Four yellow player must be able to move");
    await page.locator("#modeControl button[data-mode-index='0']").click();

    await openGame("海战棋");
    const battleship = page.frameLocator("#gameFrame");
    assert.equal(await battleship.locator("#enemy .game-cell").count(), 100);
    assert.equal(await battleship.locator("#own .sea-cell").count(),100,"player naval grid must contain 100 styled cells");
    assert.ok(await battleship.locator("#own .sea-cell.ship").count()>0,"visible fleet must use its own steel hull palette");
    await battleship.locator("#enemy .game-cell").first().click();

    await openGame("数独");
    const sudoku = page.frameLocator("#gameFrame");
    assert.equal(await sudoku.locator(".game-cell").count(), 81);

    await openGame("推箱子");
    const sokoban = page.frameLocator("#gameFrame");
    assert.equal(await sokoban.locator(".game-cell").count(), 63);

    await openGame("Pong");
    const pong = page.frameLocator("#gameFrame");
    assert.ok(await pong.locator("canvas").isVisible());
    assert.ok(await pong.locator("canvas").isVisible());
    await page.locator("#pauseButton").click();
    const pongPausedAt = await page.locator("#gameElapsed").innerText();
    await page.waitForTimeout(1200);
    assert.equal(await page.locator("#gameElapsed").innerText(), pongPausedAt, "paused game time must stop");
    await page.locator("#pauseButton").click();
    assert.equal(await page.locator("#pauseButton").getAttribute("aria-label"), "暂停");

    await openGame("魂斗罗（原创模式）");
    const contra = page.frameLocator("#gameFrame");
    assert.ok(await contra.locator("canvas").isVisible());

    await openGame("国际象棋");
    const chess = page.frameLocator("#gameFrame");
    assert.equal(await chess.locator(".chess-square").count(), 64, "Chess must render all 64 squares");
    assert.equal(await chess.locator(".chess-piece").count(), 32, "Chess must start with 32 pieces");
    const chessVisual=await chess.locator(".chess-piece").first().evaluate(el=>({fontSize:parseFloat(getComputedStyle(el).fontSize),axis:getComputedStyle(document.querySelector(".chess-axis-y")).display}));
    assert.ok(chessVisual.fontSize>=50&&chessVisual.axis!=="none","Chess pieces and rank coordinates must be readable at desktop size");
    await chess.locator('[data-square="e2"]').click();
    await chess.locator('[data-square="e5"]').click();
    assert.equal(await chess.locator("#moveList li").count(), 0, "Chess must reject an illegal pawn move");
    await chess.locator('[data-square="e2"]').click();
    await chess.locator('[data-square="e4"]').click();
    await page.waitForTimeout(600);
    assert.equal(await chess.locator("#moveList li").count(), 1, "Chess should record a human move and AI reply");
    await chess.locator("#undoButton").click();
    assert.equal(await chess.locator("#moveList li").count(), 0, "Chess undo should restore the opening position");

    await openGame("超级玛丽");
    const mario = page.frameLocator("#gameFrame");
    assert.ok(await mario.locator("#canvas").isVisible(), "Mario platformer canvas should be visible");
    const marioX = Number(await mario.locator("#canvas").getAttribute("data-player-x"));
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(260);
    await page.keyboard.up("ArrowRight");
    assert.ok(Number(await mario.locator("#canvas").getAttribute("data-player-x")) > marioX, "Mario should respond to desktop directional input");

    await openGame("90 坦克");
    const tank = page.frameLocator("#gameFrame");
    assert.ok(await tank.locator("#canvas").isVisible(), "90 Tank battlefield should be visible");
    const tankX = Number(await tank.locator("#canvas").getAttribute("data-player-x"));
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(180);
    await page.keyboard.up("ArrowLeft");
    assert.ok(Number(await tank.locator("#canvas").getAttribute("data-player-x")) < tankX, "Tank should move on the desktop keyboard");
    await page.keyboard.press("Space");


    await openGame("五子棋");
    const gomoku = page.frameLocator("#gameFrame");
    assert.equal(await gomoku.locator(".gomoku-cell").count(), 225);
    assert.equal(await gomoku.locator(".gomoku-axis-x span").count(), 15, "wooden Gomoku board should show A–O coordinates");
    assert.equal(await gomoku.locator(".gomoku-axis-y span").count(), 15, "wooden Gomoku board should show 1–15 coordinates");
    assert.equal(await page.locator("#modeControl button").count(), 2);
    assert.equal(await page.locator("#modeControl button[aria-pressed='true']").innerText(), "人机对战");
    await page.locator("#modeControl button[data-mode-index='1']").click();
    assert.equal(await page.locator("#modeControl button[aria-pressed='true']").innerText(), "本机双人");
    await page.locator("#modeControl button[data-mode-index='0']").click();
    assert.equal(await page.locator("#startButton").getAttribute("aria-label"), "结束", "mode switch should start a new playable round");
    assert.ok(await page.locator("#gameFrame").isVisible(), "Gomoku game iframe must be visible in the host workspace");
    const gomokuBoardBox = await gomoku.locator(".gomoku-board").evaluate(el => {
      const r=el.getBoundingClientRect();return {width:r.width,height:r.height};
    });
    assert.ok(gomokuBoardBox.width>200 && Math.abs(gomokuBoardBox.width-gomokuBoardBox.height)<1, "Gomoku board must remain square while filling the available area");
    const gomokuCellGeometry = await gomoku.locator(".gomoku-cell").nth(112).evaluate(el=>{
      const r=el.getBoundingClientRect(),style=getComputedStyle(el);
      return {connected:el.isConnected,width:r.width,height:r.height,display:style.display,visibility:style.visibility};
    });
    assert.ok(gomokuCellGeometry.connected && gomokuCellGeometry.width>10 && gomokuCellGeometry.height>10
      && gomokuCellGeometry.display!=="none" && gomokuCellGeometry.visibility==="visible",
      "Gomoku intersections must have visible, nonzero geometry inside the visible iframe");
    await gomoku.locator(".gomoku-cell").nth(112).click();
    await page.waitForTimeout(450);
    assert.ok(await gomoku.locator(".stone").count() >= 2, "gomoku human and AI should both place a stone");
    assert.ok(await gomoku.locator(".numbered-stone").count()>=2,"Gomoku reference stones should show their move numbers");
    assert.equal(await gomoku.locator(".latest-stone").count(),1,"Gomoku should mark exactly one last move");
    await page.locator("#newGameButton").click();
    await page.waitForTimeout(100);
    assert.equal(await gomoku.locator(".stone").count(), 0, "host next-round command should reset the module");
    await page.locator("#modeControl button[data-mode-index='1']").click();
    await page.waitForTimeout(100);
    await gomoku.locator(".gomoku-cell").nth(112).click();
    await gomoku.locator(".gomoku-cell").nth(113).click();
    assert.equal(await gomoku.locator(".stone.black").count(), 1, "local Gomoku black player should place a stone");
    assert.equal(await gomoku.locator(".stone.white").count(), 1, "local Gomoku white player must be able to take a turn");
    await gomoku.locator("#undoButton").click();
    assert.equal(await gomoku.locator(".stone.white").count(), 0, "local Gomoku undo should remove only the most recent white stone");
    await gomoku.locator(".gomoku-cell").nth(114).click();
    assert.equal(await gomoku.locator(".stone.white").count(), 1, "after undo, Gomoku must restore the white player's turn");
    await page.locator("#modeControl button[data-mode-index='0']").click();

    await openGame("扫雷");
    const mines = page.frameLocator("#gameFrame");
    assert.equal(await mines.locator(".mine-cell").count(), 256, "default Minesweeper level should be 16×16");
    assert.equal(await mines.locator("#counter").innerText(), "040", "classic mine counter should use three digits");
    const mineCounterStyle=await mines.locator("#counter").evaluate(el=>getComputedStyle(el).color);
    assert.equal(mineCounterStyle,"rgb(245, 250, 255)","Windows 7 Minesweeper counter should use light digits on the blue LCD display");
    const minesLayout=await mines.locator(".mine-classic").evaluate(el=>{
      const grid=el.querySelector("#board").getBoundingClientRect(),footer=el.querySelector(".mine-bottom-panel").getBoundingClientRect();
      return {gridBottom:grid.bottom,footerTop:footer.top,footerBottom:footer.bottom,frameBottom:el.getBoundingClientRect().bottom};
    });
    assert.ok(minesLayout.footerTop>=minesLayout.gridBottom-1 && minesLayout.footerBottom<=minesLayout.frameBottom+2,"Minesweeper reference-style counters and restart control belong BELOW the board");
    const mineTileStyle = await mines.locator(".mine-cell").first().evaluate(el => ({
      backgroundImage: getComputedStyle(el).backgroundImage,
      cellSize: getComputedStyle(el).width,
      boardSize: el.parentElement.getBoundingClientRect().width,
      areaSize: el.closest(".game-main-board").getBoundingClientRect().width
    }));
    assert.match(mineTileStyle.backgroundImage, /linear-gradient/, "Minesweeper should use the Windows 7 blue beveled tile treatment");
    assert.ok(parseFloat(mineTileStyle.cellSize) >= 18, "desktop Minesweeper cells should expand to use the available area");
    await page.locator("#difficultyControl button[data-difficulty='hard']").click();
    const hardMineFit = await mines.locator(".mine-classic").evaluate(el => ({
      board: el.getBoundingClientRect(), area: el.closest(".game-main-board").getBoundingClientRect()
    }));
    assert.ok(hardMineFit.board.width <= hardMineFit.area.width + 2, "hard Minesweeper should fit the available desktop width without a horizontal scrollbar");
    await page.locator("#difficultyControl button[data-difficulty='normal']").click();
    await page.waitForTimeout(150);
    await mines.locator("body").evaluate(() => {
      let n=0;
      window.__p111MineRandomCalls=0;
      window.Math.random=()=>{const index=n++%40;window.__p111MineRandomCalls++;return (index+0.1)/256;};
    });
    await page.locator("#newGameButton").click();
    let mineRandomCalls=0;
    for(let attempt=0;attempt<30;attempt++){
      mineRandomCalls=await mines.locator("body").evaluate(() => window.__p111MineRandomCalls);
      if(mineRandomCalls>=40)break;
      await page.waitForTimeout(40);
    }
    console.log("MINES_RANDOM_CALLS "+mineRandomCalls);
    assert.ok(mineRandomCalls >= 40, "Minesweeper deterministic seed should be used when rebuilding the board");
    assert.equal(await page.locator("#pauseButton").getAttribute("aria-label"), "暂停", "seeded new Minesweeper round should already be running");
    await mines.locator(".mine-cell").nth(56).click();
    assert.equal(await mines.locator(".mine-cell").nth(56).getAttribute("data-n"), "1", "deterministic cell should show one adjacent mine");
    await mines.locator(".mine-cell").nth(39).click({button:"right"});
    assert.ok((await mines.locator(".mine-cell").nth(39).getAttribute("class")).includes("flag"));
    const openedBeforeChord = await mines.locator(".mine-cell.open").count();
    await mines.locator(".mine-cell").nth(56).click({button:"middle"});
    await page.waitForTimeout(100);
    assert.ok(await mines.locator(".mine-cell.open").count() > openedBeforeChord, "middle-click should chord-open adjacent cells when flags match");
    await page.locator("#difficultyControl button[data-difficulty='easy']").click();
    await page.waitForTimeout(150);
    assert.equal(await mines.locator(".mine-cell").count(), 81, "easy Minesweeper level should be 9×9");
    assert.equal(await mines.locator("#level").innerText(), "初级");

    await openGame("中国象棋");
    const xiangqi = page.frameLocator("#gameFrame");
    const xiangqiFit = await xiangqi.locator(".xiangqi-board").evaluate(el => {
      const board=el.getBoundingClientRect(),area=el.closest(".game-main-board").getBoundingClientRect();
      return {board:{width:board.width,height:board.height},area:{width:area.width,height:area.height}};
    });
    assert.ok(xiangqiFit.board.width > xiangqiFit.area.width*.75 && xiangqiFit.board.height > xiangqiFit.area.height*.75, "Xiangqi board should expand to use the center workspace");
    assert.equal(await xiangqi.locator(".xiangqi-cell").count(), 90);
    assert.equal(await xiangqi.locator("#turnText").innerText(), "轮到红方走");
    const intersectionCell = xiangqi.locator(".xiangqi-cell").nth(81);
    const pieceBox = await intersectionCell.locator(".xiangqi-piece").boundingBox();
    const cellBox = await intersectionCell.boundingBox();
    assert.ok(Math.abs((pieceBox.x+pieceBox.width/2)-(cellBox.x+cellBox.width/2))<1, "Xiangqi pieces should sit on board intersections");
    assert.ok(Math.abs((pieceBox.y+pieceBox.height/2)-(cellBox.y+cellBox.height/2))<1, "Xiangqi pieces should sit on board intersections");
    await xiangqi.locator(".xiangqi-cell").nth(54).click();
    await xiangqi.locator(".xiangqi-cell").nth(45).click();
    await page.waitForTimeout(100);
    assert.equal(await xiangqi.locator("#turnText").innerText(), "黑方正在思考", "right rail should announce the side to move");
    await page.waitForTimeout(550);
    assert.equal(await xiangqi.locator("#turnText").innerText(), "轮到红方走", "turn indicator should update after the AI move");
    assert.equal(await xiangqi.locator("#moveList li").count(),2,"Xiangqi right-side move record should contain the player's move and AI reply");
    await page.locator("#modeControl button[data-mode-index='1']").click();
    await page.waitForTimeout(100);
    await xiangqi.locator(".xiangqi-cell").nth(82).click();
    await xiangqi.locator(".xiangqi-cell").nth(75).click();
    assert.equal(await xiangqi.locator(".xiangqi-cell").nth(82).locator(".xiangqi-piece").innerText(), "马", "Xiangqi horse cannot jump over its occupied leg");
    await xiangqi.locator(".xiangqi-cell").nth(54).click();
    await xiangqi.locator(".xiangqi-cell").nth(45).click();
    assert.equal(await xiangqi.locator("#turnText").innerText(), "轮到黑方走", "local Xiangqi should pass control to black");
    await xiangqi.locator(".xiangqi-cell").nth(27).click();
    await xiangqi.locator(".xiangqi-cell").nth(36).click();
    assert.equal(await xiangqi.locator("#turnText").innerText(), "轮到红方走", "local Xiangqi should pass control back to red");
    assert.equal(await xiangqi.locator("#moveList li").count(),2,"Xiangqi local dual-player moves should appear in the right-side record");
    await xiangqi.locator("#undoButton").click();
    assert.equal(await xiangqi.locator("#turnText").innerText(), "轮到黑方走", "Xiangqi undo should restore the previous mover");
    assert.equal(await xiangqi.locator("#moveList li").count(),1,"Xiangqi undo should also roll back the move record");
    assert.equal(await xiangqi.locator(".xiangqi-cell").nth(27).locator(".xiangqi-piece").innerText(), "卒", "Xiangqi undo must restore the captured board state");
    await page.locator("#modeControl button[data-mode-index='0']").click();

    await openGame("经典纸牌");
    const solitaire = page.frameLocator("#gameFrame");
    assert.equal(await solitaire.locator("#board .card").count(), 52);
    const solitaireStockY=await solitaire.locator("#ph-stock").evaluate(el=>el.getBoundingClientRect().top-el.closest(".solitaire-table").getBoundingClientRect().top);
    assert.ok(solitaireStockY>=0&&solitaireStockY<145,"Klondike stock must stay near the TOP of the felt table");
    const solitaireCardWidth=await solitaire.locator("#board .card").first().evaluate(el=>el.getBoundingClientRect().width);
    assert.ok(solitaireCardWidth>=65&&solitaireCardWidth<=90,"Klondike cards should retain classic desktop proportions rather than expand across the whole table");
    await solitaire.locator("#board .card[style*='z-index: 33']").click({force:true});
    await page.waitForTimeout(150);
    assert.equal(await solitaire.locator("#board .card").count(), 52);

    await openGame("俄罗斯方块");
    const tetris = page.frameLocator("#gameFrame");
    assert.equal(await tetris.locator(".key-instruction").count(), 6, "Tetris should show separate gameplay and shared-control shortcuts on the left");
    assert.ok(await tetris.locator(".game-guide").isVisible(), "Tetris keyboard guide should be visible in the left rail");
    assert.ok(await tetris.locator("#score").isVisible());
    assert.equal(await tetris.locator("#canvas").getAttribute("data-ghost-visible"),"false","classic Tetris must not draw a confusing second phantom piece at the floor");
    const frameA = await tetris.locator("#canvas").evaluate(canvas=>canvas.toDataURL());
    await page.waitForTimeout(90);
    const frameB = await tetris.locator("#canvas").evaluate(canvas=>canvas.toDataURL());
    assert.notEqual(frameA,frameB,"Tetris falling piece should render between grid steps");
    await page.keyboard.press("ArrowUp");
    // Force a falling piece to the last legal row without hard-dropping.
    // The old animation added a fractional row even when the floor blocked
    // the next step, painting the piece below the board and snapping it up.
    let grounded=false;
    for(let i=0;i<20;i++){
      const position=await tetris.locator("#canvas").evaluate(el=>el.dataset.pieceCanFall);
      if(position==="false"){grounded=true;break;}
      await page.keyboard.press("ArrowDown");
    }
    assert.ok(grounded,"Tetris soft drop must reach the last legal board row");
    const floorSamples=[];
    for(let i=0;i<6;i++){
      floorSamples.push(await tetris.locator("#canvas").evaluate(el=>({
        canFall:el.dataset.pieceCanFall,
        visualBottom:Number(el.dataset.pieceVisualBottom),
        logicalBottom:Number(el.dataset.pieceLogicalBottom),
        fraction:Number(el.dataset.pieceRenderFraction)
      })));
      await page.waitForTimeout(25);
    }
    for(const sample of floorSamples){
      assert.ok(sample.visualBottom<20,"Tetris visual blocks must stay above the bottom board boundary");
      if(sample.canFall==="false"){
        assert.equal(sample.fraction,0,"Tetris must stop interpolating at the floor or when blocked by locked blocks");
        assert.equal(sample.visualBottom,sample.logicalBottom,"Grounded Tetris pieces may not sink then snap upward");
      }
    }
    await page.keyboard.press("Space");
    await page.waitForTimeout(80);
    const tetrisTop = await tetris.locator("#canvas").getAttribute("data-piece-top");
    assert.ok(tetrisTop === "" || Number(tetrisTop) >= 0, "Tetris active cells must never enter a negative row");

    await openGame("贪吃蛇");
    const snake = page.frameLocator("#gameFrame");
    const snakeCanvas = snake.locator("#canvas");
    const snakeYBefore = Number(await snakeCanvas.getAttribute("data-head-y"));
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(160);
    const snakeYAfter = Number(await snakeCanvas.getAttribute("data-head-y"));
    assert.ok(snakeYAfter > snakeYBefore, "Snake should respond to the shared iframe keyboard focus without an extra canvas click");
    const snakeXBefore = Number(await snakeCanvas.getAttribute("data-head-x"));
    await page.keyboard.press("a");
    await page.waitForTimeout(140);
    const snakeXAfter = Number(await snakeCanvas.getAttribute("data-head-x"));
    assert.ok(snakeXAfter < snakeXBefore, "Snake should accept WASD as well as arrow keys");

    await openGame("斗地主");
    const ddz = page.frameLocator("#gameFrame");
    assert.equal(await ddz.locator(".playing-card").count(), 17, "Dou Dizhu must deal 17 cards to the human seat");
    assert.ok(await ddz.locator("#bidControls").count() === 1);
    assert.ok(await ddz.locator("#phaseLabel").innerText() === "叫地主" || await ddz.locator("#phaseLabel").innerText() === "出牌");

    await openGame("麻将");
    const mahjong = page.frameLocator("#gameFrame");
    assert.equal(await mahjong.locator("#hand .playing-card").count(), 14, "dealer should start with 14 Mahjong tiles");
    const mahjongCompass=await mahjong.locator(".mahjong-area").evaluate(el=>getComputedStyle(el,"::after").content);
    assert.ok(mahjongCompass.includes("北"),"Mahjong table should show the central seat-wind compass");
    await mahjong.locator("#hand .playing-card").last().click();
    assert.equal(await mahjong.locator("#hand .playing-card").count(), 13, "discarding should reduce the concealed hand to 13 tiles");

    await openGame("三国杀");
    const sanguosha = page.frameLocator("#gameFrame");
    assert.equal(await sanguosha.locator(".playing-card").count(), 6, "Xiao Qiao should start with four cards plus two for the first turn");
    const sanguoshaLayout=await sanguosha.locator(".card-table-main").evaluate(el=>({display:getComputedStyle(el).display,logRow:getComputedStyle(el.querySelector(".game-log-panel")).gridRowStart,handRow:getComputedStyle(el.querySelector(".card-hand")).gridRowStart}));
    assert.equal(sanguoshaLayout.display,"grid","San Guo Sha should use a dedicated battlefield layout");
    assert.equal(sanguoshaLayout.logRow,"2","San Guo Sha battle log should occupy the central play area");
    assert.equal(sanguoshaLayout.handRow,"3","San Guo Sha hand cards should remain at the bottom of the table");
    await sanguosha.locator("#endTurn").click();
    await page.waitForTimeout(150);

    await page.locator('[data-category="all"]').click();
    // This project is being validated as a desktop web application; mobile layout is intentionally out of scope.

    await page.setViewportSize({ width: 1366, height: 768 });
    await openGame("扫雷");
    const mine1366 = await page.frameLocator("#gameFrame").locator(".mine-classic").evaluate(el => ({
      board: el.getBoundingClientRect(), area: el.closest(".game-main-board").getBoundingClientRect(),
      cellSize: Number(el.querySelector("#board").dataset.cellSize)
    }));
    assert.ok(mine1366.board.width <= mine1366.area.width + 2 && mine1366.cellSize >= 30, "1366×768 Minesweeper should use the available area without clipping");
    await openGame("俄罗斯方块");
    const tetris1366 = await page.frameLocator("#gameFrame").locator("#canvas").evaluate(el => {
      const board=el.getBoundingClientRect(),area=el.closest(".game-main-board").getBoundingClientRect();
      return {board:{left:board.left,top:board.top,right:board.right,bottom:board.bottom,width:board.width,height:board.height},area:{left:area.left,top:area.top,right:area.right,bottom:area.bottom}};
    });
    assert.ok(tetris1366.board.height > 500 && tetris1366.board.top >= tetris1366.area.top - 1 && tetris1366.board.bottom <= tetris1366.area.bottom + 1, "1366×768 Tetris should use the available vertical space without clipping");
    await openGame("五子棋");
    const gomoku1366 = await page.frameLocator("#gameFrame").locator(".gomoku-board").boundingBox();
    assert.ok(gomoku1366 && Math.abs(gomoku1366.width-gomoku1366.height)<1 && gomoku1366.width > 500, "1366×768 Gomoku should remain square and fill the center area");

    // Full second-resolution pass: every game must retain its board, left
    // guide (where applicable), right controls, and non-overlapping rails.
    // openGame() also records one real-browser screenshot per game at 1366×768.
    for (const name of games) await openGame(name);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator("#settingsButton").click();
    assert.ok(await page.locator("#settingsBackdrop").isVisible());
    await page.locator("#uiScale").selectOption("1.08");
    await page.locator("#settingsDone").click();

    await page.locator("#helpButton").click();
    assert.ok(await page.locator("#helpPanel").isVisible());
    await page.locator(".help-chapter button").nth(1).click();
    await page.locator("#helpClose").click();

    assert.deepEqual(remoteRequests, [], "the offline app must not make remote network requests");
    assert.deepEqual(pageErrors, [], "the host and game frames must not throw browser errors");
    await fs.promises.mkdir(path.resolve(__dirname, "../p111-smoke-artifacts"), { recursive: true }).catch(() => {});
    await page.screenshot({ path: path.resolve(__dirname, "../p111-smoke-artifacts/library.png"), fullPage: true });
    console.log("P111 desktop browser smoke passed: 22 games, desktop shell, classic game skins, chess rules, platformer/tank controls, unified host controls and zero remote requests.");
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
