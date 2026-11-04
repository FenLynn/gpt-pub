const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);

const games = [
  "五子棋","中国象棋","黑白棋","四子棋","海战棋","国际跳棋",
  "扫雷","2048","记忆翻牌","数独","推箱子",
  "俄罗斯方块","贪吃蛇","Pong","魂斗罗",
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
  const remoteRequests = [];
  const pageErrors = [];
  let currentGame = "host";
  const browserConsole = [];
  page.on("console", message => browserConsole.push(message.type()+": "+message.text()));
  page.on("requestfailed", request => browserConsole.push("requestfailed: "+request.url()+" "+request.failure()?.errorText));
  page.on("request", request => { if (/^https?:/i.test(request.url())) remoteRequests.push(request.url()); });
  page.on("pageerror", error => pageErrors.push(currentGame+": "+error.message));

  async function openGame(name) {
    if (await page.locator("#workspaceView").isVisible()) { await page.locator("#backToLibrary").click(); currentGame = "host"; }
    currentGame = name;
    await page.locator(".game-card").filter({ hasText: name }).click();
    try {
      await page.locator("#stageLoading").waitFor({ state: "hidden", timeout: 10000 });
      await page.frameLocator("#gameFrame").locator("#game").waitFor({ state: "visible", timeout: 3000 });
    } catch (error) {
      console.error("Failed game:", name);
      console.error("iframe src:", await page.locator("#gameFrame").getAttribute("src"));
      console.error("frame URLs:", page.frames().map(frame => frame.url()));
      console.error("iframe body:", await page.frameLocator("#gameFrame").locator("body").innerText().catch(e => String(e)));
      console.error("browser console:", browserConsole);
      throw error;
    }
    await page.waitForTimeout(80);
  }

  try {
    await page.goto(pathToFileURL(path.join(root, "index.html")).href);
    await page.locator(".game-card").first().waitFor();
    assert.equal(await page.locator(".game-card").count(), 19, "all 19 planned games must appear in the library");

    for (const name of games) await openGame(name);

    await openGame("2048");
    const g2048 = page.frameLocator("#gameFrame");
    assert.equal(await g2048.locator(".tile").count(), 16);
    await page.keyboard.press("ArrowLeft");

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
    await pong.locator("#start").click();
    await pong.locator("#pause").click();

    await openGame("魂斗罗");
    const contra = page.frameLocator("#gameFrame");
    await contra.locator("#start").click();
    await contra.locator("#pause").click();

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
    assert.equal(await mines.locator(".mine-cell").count(), 81);
    await mines.locator(".mine-cell").first().click();
    assert.ok(await mines.locator(".mine-cell.open").count() >= 1);

    await openGame("中国象棋");
    const xiangqi = page.frameLocator("#gameFrame");
    assert.equal(await xiangqi.locator(".xiangqi-cell").count(), 90);
    await xiangqi.locator(".xiangqi-cell").first().click();
    await xiangqi.locator(".xiangqi-cell").nth(9).click();

    await openGame("经典纸牌");
    const solitaire = page.frameLocator("#gameFrame");
    await solitaire.locator("#stock").click();
    assert.equal(await solitaire.locator("#waste .card").count(), 1);

    await openGame("俄罗斯方块");
    const tetris = page.frameLocator("#gameFrame");
    await tetris.locator("#start").click();
    await tetris.locator("canvas").click();
    await page.keyboard.press("ArrowLeft");

    await openGame("贪吃蛇");
    const snake = page.frameLocator("#gameFrame");
    await snake.locator("#start").click();
    await snake.locator("canvas").click();
    await page.keyboard.press("ArrowDown");

    await openGame("斗地主");
    const ddz = page.frameLocator("#gameFrame");
    assert.equal(await ddz.locator(".playing-card").count(), 20);

    await openGame("麻将");
    const mahjong = page.frameLocator("#gameFrame");
    await mahjong.locator("#draw").click();
    assert.equal(await mahjong.locator(".playing-card").count(), 14);

    await openGame("三国杀");
    const sanguosha = page.frameLocator("#gameFrame");
    assert.equal(await sanguosha.locator(".playing-card").count(), 4);
    await sanguosha.locator("#endTurn").click();

    await page.locator("#backToLibrary").click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.locator(".game-card").first().isVisible(), "mobile library should remain visible");
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(width <= 410, "mobile layout should not overflow horizontally");
    await page.locator("#mobileMenu").click();
    assert.ok(await page.locator("#appShell").evaluate(el => el.classList.contains("menu-open")));
    await page.locator("#mobileMenu").click();

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator("#feedbackOpen").click();
    await page.locator("#feedbackText").fill("CI 自动化体验反馈测试");
    assert.ok(await page.locator("#feedbackCopy").isEnabled());
    await page.locator("#feedbackClose").click();

    assert.deepEqual(remoteRequests, [], "the offline app must not make remote network requests");
    assert.deepEqual(pageErrors, [], "the host and game frames must not throw browser errors");
    await fs.promises.mkdir(path.resolve(__dirname, "../p111-smoke-artifacts"), { recursive: true }).catch(() => {});
    await page.screenshot({ path: path.resolve(__dirname, "../p111-smoke-artifacts/library.png"), fullPage: true });
    console.log("P111 browser smoke passed: redesigned library, all 19 modules, core interactions, responsive layout, zero remote requests.");
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
