const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);

const games = [
  "五子棋","中国象棋","黑白棋","四子棋","海战棋","国际跳棋",
  "扫雷","2048","记忆翻牌","数独","推箱子",
  "俄罗斯方块","贪吃蛇","Pong","魂斗罗（原创模式）",
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
      await page.waitForFunction(() => document.activeElement?.id === "gameFrame");
      const frameLayout = await page.frameLocator("#gameFrame").locator("#game").evaluate(root => {
        const main = root.querySelector(".game-main-board");
        const rect = (main || root).getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      assert.ok(frameLayout.width > 200 && frameLayout.height > 250, name + " should receive a usable game area");
      await fs.promises.mkdir(path.resolve(__dirname,"../p111-smoke-artifacts/games"),{recursive:true});
      const viewport=page.viewportSize();
      const screenshotName=name.replace(/[^\p{L}\p{N}-]+/gu,"-")+"-"+viewport.width+"x"+viewport.height;
      await page.screenshot({path:path.resolve(__dirname,"../p111-smoke-artifacts/games/"+screenshotName+".png")});
      await page.keyboard.press("p");
      await page.waitForFunction(() => document.querySelector("#pauseButton")?.innerText === "继续");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector("#pauseButton")?.innerText === "暂停");
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
    assert.match(await page.locator("#homeWeekday").innerText(), /^星期[一二三四五六日]$/);
    assert.ok(await page.locator(".home-hero").isVisible(), "home should show the redesigned hero");
    assert.equal(await page.locator("#totalGameCount").innerText(), "19");
    assert.equal(await page.locator("[data-home-category]").count(), 4, "home quick-start should expose all four game categories");
    assert.equal(await page.locator(".heatmap-cell").count(), 371, "one-year activity grid should contain 53×7 cells");
    await page.locator('[data-ranking="time"]').click();
    assert.ok(await page.locator('[data-ranking="time"]').getAttribute("aria-selected") === "true");
    await page.locator('[data-ranking="plays"]').click();
    await page.locator('[data-category="all"]').click();
    assert.equal(await page.locator(".game-card").count(), 19, "all 19 planned games must appear in the library");

    for (const name of games) await openGame(name);

    await openGame("2048");
    const g2048 = page.frameLocator("#gameFrame");
    assert.equal(await g2048.locator(".tile").count(), 16);
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(1150);
    assert.equal(await page.locator("#startButton").innerText(), "结束", "start action should become end after the game starts");
    assert.equal(await page.locator("#pauseButton").innerText(), "暂停");
    assert.equal(await page.locator("#newGameButton").innerText(), "下一局");
    const toolbarOrder = await page.locator("#gameActions").evaluate(el=>Array.from(el.children).map(node=>node.id||"elapsed"));
    assert.deepEqual(toolbarOrder.slice(0,4), ["elapsed","startButton","pauseButton","newGameButton"], "toolbar actions should keep time/start/pause/next order");
    await page.locator("#pauseButton").click();
    assert.equal(await page.locator("#pauseButton").innerText(), "继续");
    const pausedAt = await page.locator("#gameElapsed").innerText();
    await page.waitForTimeout(1350);
    assert.equal(await page.locator("#gameElapsed").innerText(), pausedAt, "paused time must not be counted");
    await page.locator("#pauseButton").click();
    assert.equal(await page.locator("#pauseButton").innerText(), "暂停");
    await page.waitForTimeout(2200);
    assert.notEqual(await page.locator("#gameElapsed").innerText(), pausedAt, "the game clock must resume after unpausing");
    await page.locator("#startButton").click();
    assert.equal(await page.locator("#startButton").innerText(), "结束");
    assert.equal(await page.locator("#startButton").isDisabled(), true, "end action should lock after the round ends");
    await page.locator("#newGameButton").click();
    assert.equal(await page.locator("#startButton").innerText(), "开始", "next round should reset the toolbar state");

    await openGame("记忆翻牌");
    const memory = page.frameLocator("#gameFrame");
    assert.equal(await memory.locator(".game-cell").count(), 16);
    await memory.locator(".game-cell").nth(0).click();
    await memory.locator(".game-cell").nth(1).click();
    assert.equal(await memory.locator("#moves").innerText(), "1");

    await openGame("四子棋");
    const connect4 = page.frameLocator("#gameFrame");
    await connect4.locator(".game-cell").first().click();
    assert.equal(await connect4.locator("#red").innerText(), "1");

    await openGame("海战棋");
    const battleship = page.frameLocator("#gameFrame");
    assert.equal(await battleship.locator("#enemy .game-cell").count(), 100);
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
    assert.equal(await page.locator("#pauseButton").innerText(), "暂停");

    await openGame("魂斗罗（原创模式）");
    const contra = page.frameLocator("#gameFrame");
    assert.ok(await contra.locator("canvas").isVisible());

    await openGame("五子棋");
    const gomoku = page.frameLocator("#gameFrame");
    assert.equal(await gomoku.locator(".gomoku-cell").count(), 225);
    assert.equal(await page.locator("#modeControl button").count(), 2);
    assert.equal(await page.locator("#modeControl button[aria-pressed='true']").innerText(), "人机对战");
    await page.locator("#modeControl button[data-mode-index='1']").click();
    assert.equal(await page.locator("#modeControl button[aria-pressed='true']").innerText(), "本机双人");
    await page.locator("#modeControl button[data-mode-index='0']").click();
    await page.locator("#startButton").click();
    const gomokuBoardBox = await gomoku.locator(".gomoku-board").boundingBox();
    assert.ok(gomokuBoardBox && Math.abs(gomokuBoardBox.width-gomokuBoardBox.height)<1, "Gomoku board must remain square while filling the available area");
    const gomokuCellBox = await gomoku.locator(".gomoku-cell").nth(112).boundingBox();
    if(!gomokuCellBox){
      const gomokuLayout = await gomoku.locator("#game").evaluate(root => {
        const selectors=["#game",".game-main-board",".board-wrap","#board",".gomoku-cell"];
        return selectors.map(selector=>{
          const el=root.querySelector(selector);
          if(!el)return {selector,missing:true};
          const rect=el.getBoundingClientRect(),style=getComputedStyle(el);
          return {selector,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},display:style.display,visibility:style.visibility,overflow:style.overflow,position:style.position};
        });
      });
      console.error("GOMOKU_LAYOUT "+JSON.stringify(gomokuLayout));
      await fs.promises.mkdir(path.resolve(__dirname,"../p111-smoke-artifacts"),{recursive:true});
      await page.screenshot({path:path.resolve(__dirname,"../p111-smoke-artifacts/gomoku-layout-failure.png")});
    }
    assert.ok(gomokuCellBox && gomokuCellBox.width > 0 && gomokuCellBox.height > 0, "Gomoku intersections must be visible and clickable");
    await gomoku.locator(".gomoku-cell").nth(112).click();
    await page.waitForTimeout(450);
    assert.ok(await gomoku.locator(".stone").count() >= 2, "gomoku human and AI should both place a stone");
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
    await page.locator("#startButton").click();
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
    await xiangqi.locator("#undoButton").click();
    assert.equal(await xiangqi.locator("#turnText").innerText(), "轮到黑方走", "Xiangqi undo should restore the previous mover");
    assert.equal(await xiangqi.locator(".xiangqi-cell").nth(27).locator(".xiangqi-piece").innerText(), "卒", "Xiangqi undo must restore the captured board state");
    await page.locator("#modeControl button[data-mode-index='0']").click();

    await openGame("经典纸牌");
    const solitaire = page.frameLocator("#gameFrame");
    assert.equal(await solitaire.locator("#board .card").count(), 52);
    await solitaire.locator("#board .card[style*='z-index: 33']").click({force:true});
    await page.waitForTimeout(150);
    assert.equal(await solitaire.locator("#board .card").count(), 52);

    await openGame("俄罗斯方块");
    const tetris = page.frameLocator("#gameFrame");
    assert.equal(await tetris.locator(".key-instruction").count(), 5, "Tetris should show the keyboard guide on the left");
    assert.ok(await tetris.locator("#score").isVisible());
    const frameA = await tetris.locator("#canvas").evaluate(canvas=>canvas.toDataURL());
    await page.waitForTimeout(90);
    const frameB = await tetris.locator("#canvas").evaluate(canvas=>canvas.toDataURL());
    assert.notEqual(frameA,frameB,"Tetris falling piece should render between grid steps");
    await page.keyboard.press("ArrowUp");
    for(let i=0;i<8;i++)await page.keyboard.press("ArrowDown");
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
    await mahjong.locator("#hand .playing-card").last().click();
    assert.equal(await mahjong.locator("#hand .playing-card").count(), 13, "discarding should reduce the concealed hand to 13 tiles");

    await openGame("三国杀");
    const sanguosha = page.frameLocator("#gameFrame");
    assert.equal(await sanguosha.locator(".playing-card").count(), 6, "Xiao Qiao should start with four cards plus two for the first turn");
    await sanguosha.locator("#endTurn").click();
    await page.waitForTimeout(150);

    await page.locator('[data-category="all"]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.locator(".game-card").first().isVisible(), "mobile library should remain visible");
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(width <= 410, "mobile layout should not overflow horizontally");
    await page.locator("#mobileMenu").click();
    assert.ok(await page.locator("#appShell").evaluate(el => el.classList.contains("menu-open")));
    await page.locator("#mobileMenu").click();

    await openGame("扫雷");
    const mobileMines = page.frameLocator("#gameFrame");
    const mobileToolbar = await page.evaluate(() => {
      const menu = document.querySelector("#mobileMenu").getBoundingClientRect();
      const controls = document.querySelector("#gameControls").getBoundingClientRect();
      return { menuBottom: menu.bottom, controlsTop: controls.top, controlsHeight: controls.height };
    });
    assert.ok(mobileToolbar.controlsHeight > 0 && mobileToolbar.controlsTop >= mobileToolbar.menuBottom - 2, "mobile mode controls must not cover the menu button");
    await page.locator("#difficultyControl button[data-difficulty='hard']").click();
    const mobileMineFit = await mobileMines.locator(".mine-classic").evaluate(el => ({
      board: el.getBoundingClientRect(), area: el.closest(".game-main-board").getBoundingClientRect()
    }));
    assert.ok(mobileMineFit.board.width <= mobileMineFit.area.width + 2, "mobile hard Minesweeper board should fit its available width");
    await openGame("贪吃蛇");
    const mobileSnake = page.frameLocator("#gameFrame");
    const mobileSnakeCanvas = mobileSnake.locator("#canvas");
    const mobileSnakeY = Number(await mobileSnakeCanvas.getAttribute("data-head-y"));
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(180);
    assert.ok(Number(await mobileSnakeCanvas.getAttribute("data-head-y")) > mobileSnakeY, "mobile Snake should accept directional input");
    await openGame("俄罗斯方块");
    const mobileTetrisCanvas = await page.frameLocator("#gameFrame").locator("#canvas").boundingBox();
    assert.ok(mobileTetrisCanvas && mobileTetrisCanvas.width > 100 && mobileTetrisCanvas.height > 200, "mobile Tetris canvas should remain fully visible");

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
    console.log("P111 browser smoke passed: quiet dashboard, all 19 modules, unified start/pause/new-game, help/settings, responsive layout, zero remote requests.");
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
