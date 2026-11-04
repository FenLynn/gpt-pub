const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);

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
  page.on("request", request => {
    if (/^https?:/i.test(request.url())) remoteRequests.push(request.url());
  });
  page.on("pageerror", error => pageErrors.push(error.message));

  async function openGame(name) {
    await page.locator("#backToLibrary").click().catch(() => {});
    await page.locator(".game-card").filter({ hasText: name }).click();
    await page.locator("#stageLoading").waitFor({ state: "hidden", timeout: 8000 });
    await page.waitForTimeout(120);
  }

  try {
    await page.goto(pathToFileURL(path.join(root, "index.html")).href);
    await page.locator(".game-card").first().waitFor();
    assert.equal(await page.locator(".game-card").count(), 6, "six games should appear in the library");

    await openGame("五子棋");
    const gomoku = page.frameLocator("#gameFrame");
    assert.equal(await gomoku.locator(".gomoku-cell").count(), 225, "gomoku board should contain 225 intersections");
    await gomoku.locator(".gomoku-cell").nth(112).click();
    await page.waitForTimeout(500);
    assert.ok(await gomoku.locator(".stone").count() >= 2, "human and demo AI should both place a stone");
    await page.locator("#newGameButton").click();
    await page.waitForTimeout(100);
    assert.equal(await gomoku.locator(".stone").count(), 0, "host new-game command should reset the module");

    await openGame("扫雷");
    const mines = page.frameLocator("#gameFrame");
    assert.equal(await mines.locator(".mine-cell").count(), 81, "minesweeper board should contain 81 cells");
    await mines.locator(".mine-cell").first().click();
    assert.ok(await mines.locator(".mine-cell.open").count() >= 1, "first reveal should open a cell");
    await mines.locator(".mine-cell").nth(80).click({ button: "right" });
    assert.ok(await mines.locator(".mine-cell.flag").count() >= 1, "right click should place a flag");

    await openGame("中国象棋");
    const xiangqi = page.frameLocator("#gameFrame");
    assert.equal(await xiangqi.locator(".xiangqi-cell").count(), 90, "xiangqi board should contain 90 points");
    await xiangqi.locator(".xiangqi-cell").first().click();
    await xiangqi.locator(".xiangqi-cell").nth(9).click();
    assert.match(await xiangqi.locator("#status").innerText(), /回合|交互/);

    await openGame("经典纸牌");
    const solitaire = page.frameLocator("#gameFrame");
    await solitaire.locator("#stock").click();
    assert.ok((await solitaire.locator("#waste .card").count()) === 1, "stock should deal a card to waste");

    await openGame("俄罗斯方块");
    const tetris = page.frameLocator("#gameFrame");
    assert.equal(await tetris.locator("canvas").count(), 1, "tetris canvas should load");
    await tetris.locator("#start").click();
    await tetris.locator("canvas").click();
    await page.keyboard.press("ArrowLeft");

    await openGame("贪吃蛇");
    const snake = page.frameLocator("#gameFrame");
    assert.equal(await snake.locator("canvas").count(), 1, "snake canvas should load");
    await snake.locator("#start").click();
    await snake.locator("canvas").click();
    await page.keyboard.press("ArrowDown");

    await page.locator("#backToLibrary").click();
    await page.locator("#immersiveButton").count().catch(() => 0);
    await page.locator("#feedbackOpen").click();
    await page.locator("#feedbackText").fill("CI 自动化体验反馈测试");
    assert.ok(await page.locator("#feedbackCopy").isEnabled(), "feedback copy action should be available");
    await page.locator("#feedbackClose").click();

    assert.deepEqual(remoteRequests, [], "the offline app must not make remote network requests");
    assert.deepEqual(pageErrors, [], "the host page must not throw browser errors");
    await fs.promises.mkdir(path.resolve(__dirname, "../p111-smoke-artifacts"), { recursive: true }).catch(() => {});
    await page.screenshot({ path: path.resolve(__dirname, "../p111-smoke-artifacts/library.png"), fullPage: true });
    console.log("P111 browser smoke passed: file:// host, six modules, bridge commands, feedback UI, zero remote requests.");
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});