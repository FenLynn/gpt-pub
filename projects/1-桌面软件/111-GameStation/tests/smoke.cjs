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
      await page.locator("#startButton").click();
      await page.waitForTimeout(100);
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
    assert.match(await page.locator("#homeWeekday").innerText(), /^星期[一二三四五六日]$/);
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
    await page.locator("#pauseButton").click();
    const pausedAt = await page.locator("#gameElapsed").innerText();
    await page.waitForTimeout(1350);
    assert.equal(await page.locator("#gameElapsed").innerText(), pausedAt, "paused time must not be counted");
    await page.locator("#startButton").click();
    await page.waitForTimeout(1350);
    assert.notEqual(await page.locator("#gameElapsed").innerText(), pausedAt, "the game clock must resume after unpausing");

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
    await page.locator("#pauseButton").click();
    const pongPausedAt = await page.locator("#gameElapsed").innerText();
    await page.waitForTimeout(1200);
    assert.equal(await page.locator("#gameElapsed").innerText(), pongPausedAt, "paused game time must stop");
    await page.locator("#startButton").click();

    await openGame("魂斗罗（原创模式）");
    const contra = page.frameLocator("#gameFrame");
    assert.ok(await contra.locator("canvas").isVisible());

    await openGame("五子棋");
    const gomoku = page.frameLocator("#gameFrame");
    assert.equal(await gomoku.locator(".gomoku-cell").count(), 225);
    await gomoku.locator(".gomoku-cell").nth(112).click();
    await page.waitForTimeout(450);
    assert.ok(await gomoku.locator(".stone").count() >= 2, "gomoku human and AI should both place a stone");
    await page.locator("#newGameButton").click();
    await page.waitForTimeout(100);
    assert.equal(await gomoku.locator(".stone").count(), 0, "host new-game command should reset the module");

    await openGame("扫雷");
    const mines = page.frameLocator("#gameFrame");
    assert.equal(await mines.locator(".mine-cell").count(), 256, "default Minesweeper level should be 16×16");
    await page.locator("#difficultyPrev").click();
    await page.waitForTimeout(100);
    assert.equal(await mines.locator(".mine-cell").count(), 81, "easy Minesweeper level should be 9×9");
    await page.locator("#startButton").click();
    await mines.locator(".mine-cell").first().click();
    assert.ok(await mines.locator(".mine-cell.open").count() >= 1);

    await openGame("中国象棋");
    const xiangqi = page.frameLocator("#gameFrame");
    assert.equal(await xiangqi.locator(".xiangqi-cell").count(), 90);
    await xiangqi.locator(".xiangqi-cell").first().click();
    await xiangqi.locator(".xiangqi-cell").nth(9).click();

    await openGame("经典纸牌");
    const solitaire = page.frameLocator("#gameFrame");
    assert.equal(await solitaire.locator("#board .card").count(), 52);
    await solitaire.locator(".stock-empty").click();
    await page.waitForTimeout(150);
    assert.equal(await solitaire.locator("#board .card").count(), 52);

    await openGame("俄罗斯方块");
    const tetris = page.frameLocator("#gameFrame");
    await tetris.locator("canvas").click();
    await page.keyboard.press("ArrowLeft");

    await openGame("贪吃蛇");
    const snake = page.frameLocator("#gameFrame");
    await snake.locator("canvas").click();
    await page.keyboard.press("ArrowDown");

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
