/* MIT-licensed Dou Dizhu engine adapted from justa-cai/doudizhu.
 * Upstream commit: 360b5708219561abfe66e68578d37ead848f0845. Full license and modifications: app/games/doudizhu/vendor/NOTICE.md
 * ES-module exports/imports and Worker wrapper removed for local file:// use.
 */
(function(global){"use strict";
/**
 * rules.js - 裁判层 + 规则内核（主线程与 AI Worker 共用的唯一事实来源）
 *
 * 斗地主和五子棋最大的不同：**合法出牌生成本身就是 AI 的一部分**。
 * 如果主线程（校验玩家出的牌）和 AI（生成候选）各写一套牌型判定，
 * 迟早出现「玩家这么出合法、AI 不这么想」的诡异 bug。所以这个文件被
 * 主线程的 app.js 与 ai/engine.js 同时 import——规则只有一处实现。
 *
 * ── 卡牌表示 ──────────────────────────────────────────────────────────
 *
 *   卡牌 id：0..51 为四种花色的 3..2（rank = id >> 2，suit = id & 3），
 *            52 = 小王，53 = 大王。
 *   点数下标 0..14：3 4 5 6 7 8 9 10 J Q K A 2 小王 大王。
 *   顺子/连对/飞机的有效区间是 0..11（3 到 A），2 与双王不能进顺。
 *   花色只影响显示，不影响任何规则判定。
 *
 *   规则层内部用手牌计数 Int8Array(15)（counts[r] = 该点数几张）运算，
 *   界面层用 card id 数组（要画花色）。两者互转是纯函数。
 *
 * ── 出口一览 ──────────────────────────────────────────────────────────
 *
 *   卡牌：rankOf / suitOf / cardLabel / countsOf / TOTAL_OF_RANK
 *   牌型：TYPE / TYPE_NAMES / classify / beats / isBombLike
 *   生成：generateMoves(hand, lastPlay, opts)
 *   手数：minHands(counts, budget)
 *   状态：createGame / deal / nextBid / startPlay / play / pass / aiContext
 *
 * @license MIT
 */

// ── 常量 ─────────────────────────────────────────────────────────────

const RANK_COUNT = 15;
const DECK_SIZE = 54;

/** 点数的显示名（下标即点数） */
const RANK_NAMES = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '小王', '大王'];

/** 每个点数的总张数（双王各 1 张，其余各 4 张） */
const TOTAL_OF_RANK = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 1];

/** 花色符号，下标 = suit */
const SUITS = ['♠', '♥', '♣', '♦'];

/** 顺子/连对/飞机允许的最高点数（A = 11） */
const MAX_CHAIN_RANK = 11;

// ── 卡牌工具 ─────────────────────────────────────────────────────────

/** 卡牌 id → 点数下标（0..14） */
function rankOf(card) {
  if (card < 52) return card >> 2;
  return card === 52 ? 13 : 14;
}

/** 卡牌 id → 花色下标（0..3）；双王返回 -1 */
function suitOf(card) {
  return card < 52 ? (card & 3) : -1;
}

/** 是否是大小王 */
function isJoker(card) {
  return card >= 52;
}

/** 卡牌 id → 显示文本（"K" / "小王"） */
function cardLabel(card) {
  return RANK_NAMES[rankOf(card)];
}

/** 手牌（card id 数组）→ 点数计数 Int8Array(15) */
function countsOf(cards) {
  const cnt = new Int8Array(RANK_COUNT);
  for (let i = 0; i < cards.length; i++) cnt[rankOf(cards[i])]++;
  return cnt;
}

/** 点数计数 → 一个紧凑显示标签，如 "K×3 7"（面板用） */
function countsLabel(counts) {
  const parts = [];
  for (let r = RANK_COUNT - 1; r >= 0; r--) {
    if (!counts[r]) continue;
    parts.push(counts[r] > 1 ? RANK_NAMES[r] + '×' + counts[r] : RANK_NAMES[r]);
  }
  return parts.length ? parts.join(' ') : '—';
}

/** 手牌排序：点数降序（大牌在前），同点数同花色相邻 */
function sortHand(hand) {
  return hand.slice().sort((a, b) => {
    const d = rankOf(b) - rankOf(a);
    return d !== 0 ? d : a - b;
  });
}

// ── 牌型 ─────────────────────────────────────────────────────────────

const TYPE = {
  SOLO: 'solo',
  PAIR: 'pair',
  TRIO: 'trio',
  TRIO_SOLO: 'trio_solo',
  TRIO_PAIR: 'trio_pair',
  STRAIGHT: 'straight',
  PAIR_STRAIGHT: 'pair_straight',
  PLANE: 'plane',
  PLANE_SOLO: 'plane_solo',
  PLANE_PAIR: 'plane_pair',
  FOUR_SOLO: 'four_solo',
  FOUR_PAIR: 'four_pair',
  BOMB: 'bomb',
  ROCKET: 'rocket'
};

const TYPE_NAMES = {
  [TYPE.SOLO]: '单张',
  [TYPE.PAIR]: '对子',
  [TYPE.TRIO]: '三张',
  [TYPE.TRIO_SOLO]: '三带一',
  [TYPE.TRIO_PAIR]: '三带二',
  [TYPE.STRAIGHT]: '顺子',
  [TYPE.PAIR_STRAIGHT]: '连对',
  [TYPE.PLANE]: '飞机',
  [TYPE.PLANE_SOLO]: '飞机带单',
  [TYPE.PLANE_PAIR]: '飞机带对',
  [TYPE.FOUR_SOLO]: '四带二',
  [TYPE.FOUR_PAIR]: '四带两对',
  [TYPE.BOMB]: '炸弹',
  [TYPE.ROCKET]: '火箭'
};

function mk(type, rank, len) {
  return { type: type, rank: rank, len: len };
}

function isConsecutive(ranks) {
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] !== ranks[i - 1] + 1) return false;
  }
  return true;
}

/**
 * 识别一组牌的牌型。
 *
 * @param {number[]} cards card id 数组
 * @returns {{type:string, rank:number, len:number}|null}
 *          rank = 比较用的主点数，len = 长度（顺子的张数 / 飞机的组数 / 其余为 1）
 *          非法组合返回 null
 */
function classify(cards) {
  const n = cards.length;
  if (n === 0) return null;

  const cnt = new Int8Array(RANK_COUNT);
  let maxRank = -1;
  for (let i = 0; i < n; i++) {
    const r = rankOf(cards[i]);
    cnt[r]++;
    if (r > maxRank) maxRank = r;
  }

  // byCount[k] = 恰好有 k 张的点数列表（升序）
  const byCount = [[], [], [], [], []];
  for (let r = 0; r < RANK_COUNT; r++) {
    if (cnt[r]) byCount[cnt[r]].push(r);
  }

  // 火箭
  if (n === 2 && cnt[13] === 1 && cnt[14] === 1) return mk(TYPE.ROCKET, 14, 1);
  // 炸弹
  if (n === 4 && byCount[4].length === 1) return mk(TYPE.BOMB, byCount[4][0], 1);

  // 单 / 对 / 三
  if (n === 1) return mk(TYPE.SOLO, maxRank, 1);
  if (n === 2 && byCount[2].length === 1) return mk(TYPE.PAIR, byCount[2][0], 1);
  if (n === 3 && byCount[3].length === 1) return mk(TYPE.TRIO, byCount[3][0], 1);

  // 顺子（≥5 张连续单牌，且点数不超过 A）
  if (n >= 5 && byCount[1].length === n && maxRank <= MAX_CHAIN_RANK && isConsecutive(byCount[1])) {
    return mk(TYPE.STRAIGHT, maxRank, n);
  }
  // 连对（≥3 组连续对子）
  if (n >= 6 && n % 2 === 0 && byCount[2].length * 2 === n &&
      maxRank <= MAX_CHAIN_RANK && isConsecutive(byCount[2])) {
    return mk(TYPE.PAIR_STRAIGHT, maxRank, byCount[2].length);
  }

  // 三带一 / 三带二
  if (n === 4 && byCount[3].length === 1 && byCount[1].length === 1) {
    return mk(TYPE.TRIO_SOLO, byCount[3][0], 1);
  }
  if (n === 5 && byCount[3].length === 1 && byCount[2].length === 1) {
    return mk(TYPE.TRIO_PAIR, byCount[3][0], 1);
  }

  // 飞机系（三顺，可带单或带对）
  if (byCount[3].length >= 2) {
    const trios = byCount[3];
    let lo = 0;
    while (lo < trios.length) {
      let hi = lo;
      while (hi + 1 < trios.length && trios[hi + 1] === trios[hi] + 1) hi++;
      const run = trios.slice(lo, hi + 1);
      if (run.length >= 2 && run[run.length - 1] <= MAX_CHAIN_RANK) {
        const res = classifyPlane(cnt, n, run);
        if (res) return res;
      }
      lo = hi + 1;
    }
  }

  // 四带二（四张 + 2 张单牌，这 2 张也可以是一对）
  if (n === 6 && byCount[4].length === 1) {
    // 副牌不能是双王（王炸不作四带二的翅膀）
    if (!(cnt[13] === 1 && cnt[14] === 1)) return mk(TYPE.FOUR_SOLO, byCount[4][0], 1);
  }
  // 四带两对
  if (n === 8 && byCount[4].length === 1 && byCount[2].length === 2) {
    return mk(TYPE.FOUR_PAIR, byCount[4][0], 1);
  }

  return null;
}

/** 飞机的子判定：run 是一段连续的三张点数，尝试「不带 / 带单 / 带对」 */
function classifyPlane(cnt, n, run) {
  const m = run.length;
  const rest = n - 3 * m;
  if (rest === 0) return mk(TYPE.PLANE, run[m - 1], m);

  // 剩余牌分布（把飞机本体各扣掉 3 张）
  const restCnt = new Int8Array(RANK_COUNT);
  let restTotal = 0;
  for (let r = 0; r < RANK_COUNT; r++) {
    const c = cnt[r] - (run.indexOf(r) >= 0 ? 3 : 0);
    if (c > 0) { restCnt[r] = c; restTotal += c; }
  }
  if (restTotal !== rest) return null;

  // 带单：m 张翅膀（可含一对拆成两张单），但不能出现三张/四张同点
  if (rest === m) {
    let ok = true;
    for (let r = 0; r < RANK_COUNT; r++) {
      if (restCnt[r] > 2) { ok = false; break; }
    }
    if (ok) return mk(TYPE.PLANE_SOLO, run[m - 1], m);
  }
  // 带对：m 个对子
  if (rest === 2 * m) {
    let ok = true;
    for (let r = 0; r < RANK_COUNT; r++) {
      if (restCnt[r] !== 0 && restCnt[r] !== 2) { ok = false; break; }
    }
    if (ok) return mk(TYPE.PLANE_PAIR, run[m - 1], m);
  }
  return null;
}

/** a 能否压过 b（b 为当前场上待压的牌型） */
function beats(a, b) {
  if (!a || !b) return false;
  if (b.type === TYPE.ROCKET) return false;            // 火箭无敌
  if (a.type === TYPE.ROCKET) return true;
  if (a.type === TYPE.BOMB) {
    if (b.type === TYPE.BOMB) return a.rank > b.rank;  // 炸比炸
    return true;                                       // 炸压一切非炸
  }
  if (b.type === TYPE.BOMB) return false;
  if (a.type !== b.type || a.len !== b.len) return false;
  return a.rank > b.rank;
}

/** 是否炸弹或火箭 */
function isBombLike(m) {
  return !!m && (m.type === TYPE.BOMB || m.type === TYPE.ROCKET);
}

// ── 合法出牌生成（AI 的候选来源 / 玩家的提示）────────────────────────

function idsByRank(hand) {
  const ids = [];
  for (let r = 0; r < RANK_COUNT; r++) ids.push([]);
  for (let i = 0; i < hand.length; i++) ids[rankOf(hand[i])].push(hand[i]);
  return ids;
}

/**
 * 从点数计数中挑翅膀。
 *
 * 优先挑「恰好是一整组」的牌（avail[r] === unit，说明这一组没有别的用途，
 * 拆它不心疼），其次按点数从小到大。variant 用于生成不同的备选（跳过前
 * variant 个候选），给 AI 一点选择余地。
 */
function wingRanks(avail, excludeSet, k, unit, variant) {
  const cands = [];
  for (let r = 0; r < RANK_COUNT; r++) {
    if (excludeSet.has(r)) continue;
    if (avail[r] < unit) continue;
    cands.push(r);
  }
  cands.sort((a, b) => {
    const sa = avail[a] === unit ? 0 : 1;
    const sb = avail[b] === unit ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return a - b;
  });
  if (cands.length - variant < k) return null;
  return cands.slice(variant, variant + k);
}

function cardsFor(ids, ranks, unit) {
  const out = [];
  for (let i = 0; i < ranks.length; i++) {
    const pool = ids[ranks[i]];
    for (let j = 0; j < unit; j++) out.push(pool[j]);
  }
  return out;
}

/**
 * 生成当前手牌的所有合法出牌。
 *
 * @param {number[]} hand 手牌（card id 数组）
 * @param {Object|null} lastPlay 当前待压牌型（{type,rank,len}）或 null
 * @param {Object} [opts]
 *        wingChoices - 每个带牌主牌型额外生成几种翅膀搭配（默认 1）
 *        maxMoves    - 候选硬上限（默认 240，防极端手牌下爆炸）
 * @returns {Array<{cards:number[], counts:Int8Array, type:string, rank:number, len:number}>}
 */
function generateMoves(hand, lastPlay, opts) {
  opts = opts || {};
  const wingChoices = Math.max(1, opts.wingChoices || 1);
  const maxMoves = opts.maxMoves || 240;

  const avail = countsOf(hand);
  const ids = idsByRank(hand);
  const out = [];
  const seen = new Set();

  function push(cards) {
    if (out.length >= maxMoves) return;
    const c = classify(cards);
    if (!c) return;
    if (lastPlay && !beats(c, lastPlay)) return;
    const key = cards.slice().sort((a, b) => a - b).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ cards: cards, counts: countsOf(cards), type: c.type, rank: c.rank, len: c.len });
  }

  // 1) 火箭
  if (avail[13] >= 1 && avail[14] >= 1) push([ids[13][0], ids[14][0]]);

  // 2) 炸弹
  for (let r = 0; r < RANK_COUNT; r++) {
    if (avail[r] === 4) push(ids[r].slice(0, 4));
  }

  // 3) 单 / 对 / 三
  for (let r = 0; r < RANK_COUNT; r++) {
    if (avail[r] >= 1) push([ids[r][0]]);
    if (avail[r] >= 2) push([ids[r][0], ids[r][1]]);
    if (avail[r] >= 3) push([ids[r][0], ids[r][1], ids[r][2]]);
  }

  // 4) 三带一 / 三带二
  for (let t = 0; t < RANK_COUNT; t++) {
    if (avail[t] < 3) continue;
    const body = [ids[t][0], ids[t][1], ids[t][2]];
    const excl = new Set([t]);
    for (let v = 0; v < wingChoices; v++) {
      const w1 = wingRanks(avail, excl, 1, 1, v);
      if (w1) push(body.concat(cardsFor(ids, w1, 1)));
      const w2 = wingRanks(avail, excl, 1, 2, v);
      if (w2) push(body.concat(cardsFor(ids, w2, 2)));
    }
  }

  // 5) 顺子（≥5 张连续单牌）
  for (let s = 0; s <= MAX_CHAIN_RANK - 4; s++) {
    let run = 0;
    while (s + run <= MAX_CHAIN_RANK && avail[s + run] >= 1) run++;
    const ranks = [];
    for (let r = s; r < s + run; r++) ranks.push(r);
    for (let L = 5; L <= run; L++) push(cardsFor(ids, ranks.slice(0, L), 1));
  }

  // 6) 连对（≥3 组连续对子）
  for (let s = 0; s <= MAX_CHAIN_RANK - 2; s++) {
    let run = 0;
    while (s + run <= MAX_CHAIN_RANK && avail[s + run] >= 2) run++;
    const ranks = [];
    for (let r = s; r < s + run; r++) ranks.push(r);
    for (let L = 3; L <= run; L++) push(cardsFor(ids, ranks.slice(0, L), 2));
  }

  // 7) 飞机（≥2 组连续三张，可带单 / 带对）
  for (let s = 0; s <= MAX_CHAIN_RANK - 1; s++) {
    let run = 0;
    while (s + run <= MAX_CHAIN_RANK && avail[s + run] >= 3) run++;
    if (run < 2) continue;
    const ranks = [];
    for (let r = s; r < s + run; r++) ranks.push(r);
    for (let L = 2; L <= run; L++) {
      const bodyRanks = ranks.slice(0, L);
      const body = cardsFor(ids, bodyRanks, 3);
      push(body);                                        // 飞机不带
      const excl = new Set(bodyRanks);
      // 带单
      const spareCnt = avail.slice();
      for (let i = 0; i < bodyRanks.length; i++) spareCnt[bodyRanks[i]] -= 3;
      for (let v = 0; v < wingChoices; v++) {
        const w1 = wingRanks(spareCnt, excl, L, 1, v);
        if (w1) push(body.concat(cardsFor(ids, w1, 1)));
        const w2 = wingRanks(spareCnt, excl, L, 2, v);
        if (w2) push(body.concat(cardsFor(ids, w2, 2)));
      }
    }
  }

  // 8) 四带二（四张 + 2 张单牌，这 2 张也可以是一对）
  for (let q = 0; q < RANK_COUNT; q++) {
    if (avail[q] !== 4) continue;
    const body = ids[q].slice(0, 4);
    const excl = new Set([q]);
    const w = wingRanks(avail, excl, 2, 1, 0);
    if (w) push(body.concat(cardsFor(ids, w, 1)));
    // 四带两对
    const w2 = wingRanks(avail, excl, 2, 2, 0);
    if (w2) push(body.concat(cardsFor(ids, w2, 2)));
  }

  return out;
}

// ── 手数（最少几手出完）───────────────────────────────────────────────

const DEFAULT_HAND_BUDGET = 20000;

/**
 * 「剩余 {单张, 对子, 三张, 炸弹} 四元组」的精确最小手数（记忆化）。
 *
 * 只处理 单/对/三/炸 以及它们的带牌形式（三带一/二、四带二/两对）。
 * 顺子/连对/飞机不在这里处理——那是外层 DFS 的职责（要按点数位置枚举）。
 */
const dpRestMemo = new Map();

function dpRest(c1, c2, c3, c4) {
  if (c1 < 0 || c2 < 0 || c3 < 0 || c4 < 0) return Infinity;
  if (c1 === 0 && c2 === 0 && c3 === 0 && c4 === 0) return 0;
  const key = ((c1 * 64 + c2) * 64 + c3) * 64 + c4;
  const hit = dpRestMemo.get(key);
  if (hit !== undefined) return hit;

  let best = Infinity;
  // 基本出法
  if (c1 > 0) best = Math.min(best, 1 + dpRest(c1 - 1, c2, c3, c4));
  if (c2 > 0) best = Math.min(best, 1 + dpRest(c1, c2 - 1, c3, c4));
  if (c3 > 0) best = Math.min(best, 1 + dpRest(c1, c2, c3 - 1, c4));
  if (c4 > 0) best = Math.min(best, 1 + dpRest(c1, c2, c3, c4 - 1));
  // 带牌
  if (c3 > 0 && c1 > 0) best = Math.min(best, 1 + dpRest(c1 - 1, c2, c3 - 1, c4));
  if (c3 > 0 && c2 > 0) best = Math.min(best, 1 + dpRest(c1, c2 - 1, c3 - 1, c4));
  if (c4 > 0 && c1 >= 2) best = Math.min(best, 1 + dpRest(c1 - 2, c2, c3, c4 - 1));
  if (c4 > 0 && c2 >= 2) best = Math.min(best, 1 + dpRest(c1, c2 - 2, c3, c4 - 1));
  // 拆牌（不额外耗手数，只是把大组降级，覆盖「四张拆成三带一」等）
  if (c4 > 0) best = Math.min(best, dpRest(c1 + 1, c2, c3 + 1, c4 - 1));   // 4 → 3+1
  if (c4 > 0) best = Math.min(best, dpRest(c1, c2 + 2, c3, c4 - 1));       // 4 → 2+2
  if (c3 > 0) best = Math.min(best, dpRest(c1 + 1, c2 + 1, c3 - 1, c4));   // 3 → 2+1
  if (c3 > 0) best = Math.min(best, dpRest(c1 + 3, c2, c3 - 1, c4));       // 3 → 1+1+1
  if (c2 > 0) best = Math.min(best, dpRest(c1 + 2, c2 - 1, c3, c4));       // 2 → 1+1

  if (best === Infinity) best = 0;
  dpRestMemo.set(key, best);
  return best;
}

/** 不含顺子的最小手数（含双王的火箭/单张处理） */
function restHands(w) {
  let c1 = 0, c2 = 0, c3 = 0, c4 = 0;
  for (let r = 0; r < 13; r++) {
    const c = w[r];
    if (c === 1) c1++;
    else if (c === 2) c2++;
    else if (c === 3) c3++;
    else if (c === 4) c4++;
  }
  const j = (w[13] ? 1 : 0) + (w[14] ? 1 : 0);
  if (j === 2) {
    // 双王：当火箭一手，或拆成两张单牌（可作三带翅膀）
    return Math.min(1 + dpRest(c1, c2, c3, c4), dpRest(c1 + 2, c2, c3, c4));
  }
  return dpRest(c1 + j, c2, c3, c4);
}

/**
 * 最少需要几手才能出完（斗地主 AI 的核心评估量）。
 *
 * 做法（NOIP2015 斗地主的标准思路）：
 *   1. 外层 DFS 枚举「拆出哪些顺子/连对/飞机」，每拆出一组算一手；
 *   2. 对剩下的牌用 restHands（{单,对,三,炸} 四元组的精确 DP）求手数；
 *   3. 取所有拆法的下界。
 *
 * 飞机的翅膀取「当前最小可用牌」而不穷举翅膀组合——这是一处刻意的启发式，
 * 换来的是单步决策始终毫秒级；对 17 张手牌而言误差极小。
 *
 * 节点预算（默认 20000）耗尽时退化为 restHands 上界，绝不让 Worker 卡死。
 *
 * @param {Int8Array|number[]} counts 点数计数（15 项）
 * @param {number} [budget] 节点预算
 * @returns {number} 最少手数
 */
function minHands(counts, budget) {
  const LIMIT = budget || DEFAULT_HAND_BUDGET;
  const w = Int8Array.from(counts);
  const memo = new Map();
  let nodes = 0;

  function rec() {
    let empty = true;
    for (let r = 0; r < RANK_COUNT; r++) {
      if (w[r]) { empty = false; break; }
    }
    if (empty) return 0;

    const key = w.join(',');
    const hit = memo.get(key);
    if (hit !== undefined) return hit;

    nodes++;
    let best = restHands(w);          // 基线：不拆顺子

    if (nodes <= LIMIT) {
      // 单顺
      for (let s = 0; s <= MAX_CHAIN_RANK - 4; s++) {
        let run = 0;
        while (s + run <= MAX_CHAIN_RANK && w[s + run] >= 1) run++;
        for (let L = 5; L <= run; L++) {
          for (let i = 0; i < L; i++) w[s + i]--;
          const sub = 1 + rec();
          for (let i = 0; i < L; i++) w[s + i]++;
          if (sub < best) best = sub;
          if (nodes > LIMIT) break;
        }
        if (nodes > LIMIT) break;
      }
    }
    if (nodes <= LIMIT) {
      // 连对
      for (let s = 0; s <= MAX_CHAIN_RANK - 2; s++) {
        let run = 0;
        while (s + run <= MAX_CHAIN_RANK && w[s + run] >= 2) run++;
        for (let L = 3; L <= run; L++) {
          for (let i = 0; i < L; i++) w[s + i] -= 2;
          const sub = 1 + rec();
          for (let i = 0; i < L; i++) w[s + i] += 2;
          if (sub < best) best = sub;
          if (nodes > LIMIT) break;
        }
        if (nodes > LIMIT) break;
      }
    }
    if (nodes <= LIMIT) {
      // 飞机（本体 + 一对最小可用翅膀）
      for (let s = 0; s <= MAX_CHAIN_RANK - 1; s++) {
        let run = 0;
        while (s + run <= MAX_CHAIN_RANK && w[s + run] >= 3) run++;
        if (run < 2) continue;
        for (let L = 2; L <= run; L++) {
          const bodyRanks = [];
          for (let i = 0; i < L; i++) bodyRanks.push(s + i);
          // 不带翅膀
          for (let i = 0; i < L; i++) w[s + i] -= 3;
          let sub = 1 + rec();
          for (let i = 0; i < L; i++) w[s + i] += 3;
          if (sub < best) best = sub;
          // 带单 / 带对：翅膀取最小的 L 张（组）
          for (const unit of [1, 2]) {
            const wings = pickSmallestWings(w, bodyRanks, L, unit);
            if (!wings) continue;
            applyWings(w, wings, -1);
            for (let i = 0; i < L; i++) w[s + i] -= 3;
            const sub2 = 1 + rec();
            for (let i = 0; i < L; i++) w[s + i] += 3;
            applyWings(w, wings, 1);
            if (sub2 < best) best = sub2;
          }
          if (nodes > LIMIT) break;
        }
        if (nodes > LIMIT) break;
      }
    }

    memo.set(key, best);
    return best;
  }

  return rec();
}

/** 为飞机挑最小的 L 个翅膀（unit=1 取单张，unit=2 取对子）；返回 {ranks, unit} 或 null */
function pickSmallestWings(w, bodyRanks, L, unit) {
  const excl = new Set(bodyRanks);
  const cands = [];
  for (let r = 0; r < RANK_COUNT; r++) {
    if (excl.has(r) || w[r] < unit) continue;
    cands.push(r);
  }
  cands.sort((a, b) => a - b);
  if (cands.length < L) return null;
  return { ranks: cands.slice(0, L), unit: unit };
}

/** 按 unit 增/减翅膀牌张（delta = +1 恢复 / -1 扣除） */
function applyWings(w, wings, delta) {
  for (let i = 0; i < wings.ranks.length; i++) w[wings.ranks[i]] += delta * wings.unit;
}

// ── 对局状态机 ───────────────────────────────────────────────────────

const SEATS = [0, 1, 2];
const SEAT_NAMES = ['你', '右家', '左家'];

/** 座位 s 的下一个座位（斗地主固定 0→1→2→0） */
function nextSeat(s) {
  return (s + 1) % 3;
}

/** createGame 的默认随机源（可注入固定种子做校准复现） */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createGame(seed) {
  const rng = (seed === undefined || seed === null) ? Math.random : mulberry32(seed);
  return {
    rng: rng,
    hands: [[], [], []],
    bottom: [],
    bids: [null, null, null],   // null = 未表态；0 = 不叫；1/2/3 = 叫分
    bidTurn: 0,
    highestBid: 0,
    highestSeat: -1,
    landlord: -1,
    phase: 'idle',              // idle | bidding | playing | over
    turn: 0,
    lastPlay: null,             // { seat, cards, type, rank, len }
    passCount: 0,
    played: [],                 // 已出过的所有 card id（公开信息，记牌器用）
    playedCounts: new Int8Array(RANK_COUNT),
    playCount: [0, 0, 0],       // 各家出牌次数（春天判定）
    multiplier: 1,
    bombCount: 0,
    over: false,
    landlordWin: false,
    log: []
  };
}

/** 发牌（每人 17 张 + 3 张底牌），并把叫分状态复位 */
function deal(game) {
  const deck = [];
  for (let i = 0; i < DECK_SIZE; i++) deck.push(i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(game.rng() * (i + 1));
    const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
  for (let s = 0; s < 3; s++) {
    game.hands[s] = sortHand(deck.slice(s * 17, s * 17 + 17));
  }
  game.bottom = deck.slice(51, 54);
  game.bids = [null, null, null];
  game.highestBid = 0;
  game.highestSeat = -1;
  game.landlord = -1;
  game.bidTurn = Math.floor(game.rng() * 3);
  game.lastPlay = null;
  game.passCount = 0;
  game.played = [];
  game.playedCounts = new Int8Array(RANK_COUNT);
  game.playCount = [0, 0, 0];
  game.multiplier = 1;
  game.bombCount = 0;
  game.over = false;
  game.landlordWin = false;
  game.log = [];
  game.phase = 'bidding';
  return game;
}

/**
 * 叫分。score ∈ {0,1,2,3}，0 = 不叫。
 * 必须高于当前最高分（除非不叫）。叫满 3 分立即结束叫分。
 *
 * @returns {{legal:boolean, reason?:string, done:boolean, redeal:boolean}}
 */
function nextBid(game, seat, score) {
  if (game.phase !== 'bidding') return { legal: false, reason: '当前不是叫分阶段', done: false, redeal: false };
  if (seat !== game.bidTurn) return { legal: false, reason: '还没轮到你叫分', done: false, redeal: false };
  if (score !== 0 && (score < 1 || score > 3)) return { legal: false, reason: '叫分只能是 1/2/3 或不叫', done: false, redeal: false };
  if (score !== 0 && score <= game.highestBid) return { legal: false, reason: `必须高于当前最高分 ${game.highestBid || '无'}`, done: false, redeal: false };

  game.bids[seat] = score;
  if (score > game.highestBid) {
    game.highestBid = score;
    game.highestSeat = seat;
  }
  game.log.push({ kind: 'bid', seat: seat, score: score });

  const allBid = game.bids.every((b) => b !== null);
  if (score === 3 || allBid) {
    if (game.highestSeat < 0) {
      // 三家都不叫 → 流局重发
      deal(game);
      return { legal: true, done: false, redeal: true };
    }
    game.landlord = game.highestSeat;
    return { legal: true, done: true, redeal: false };
  }
  game.bidTurn = nextSeat(seat);
  return { legal: true, done: false, redeal: false };
}

/** 定地主：发底牌、地主首出 */
function startPlay(game) {
  if (game.landlord < 0) return false;
  game.hands[game.landlord] = sortHand(game.hands[game.landlord].concat(game.bottom));
  game.phase = 'playing';
  game.turn = game.landlord;
  game.lastPlay = null;
  game.passCount = 0;
  game.multiplier = game.highestBid > 0 ? game.highestBid : 1;
  return true;
}

/**
 * 出牌。
 * @returns {{legal:boolean, reason?:string, over?:boolean}}
 */
function play(game, seat, cards) {
  if (game.phase !== 'playing') return { legal: false, reason: '当前不是出牌阶段' };
  if (game.over) return { legal: false, reason: '对局已结束' };
  if (seat !== game.turn) return { legal: false, reason: '还没轮到你出牌' };
  if (!cards || cards.length === 0) return { legal: false, reason: '请选择要出的牌' };

  // 手牌包含校验
  const have = countsOf(game.hands[seat]);
  const give = countsOf(cards);
  for (let r = 0; r < RANK_COUNT; r++) {
    if (give[r] > have[r]) return { legal: false, reason: '你没有这么多' + RANK_NAMES[r] };
  }
  const c = classify(cards);
  if (!c) return { legal: false, reason: '不构成合法牌型' };
  if (game.lastPlay && !beats(c, game.lastPlay)) {
    return { legal: false, reason: '压不过上家的' + (TYPE_NAMES[game.lastPlay.type] || '牌') };
  }

  // 落地
  const remove = new Map();
  for (let i = 0; i < cards.length; i++) {
    const r = rankOf(cards[i]);
    remove.set(r, (remove.get(r) || 0) + 1);
  }
  const next = [];
  const used = new Map();
  const orig = game.hands[seat];
  for (let i = 0; i < orig.length; i++) {
    const r = rankOf(orig[i]);
    const need = remove.get(r) || 0;
    const got = used.get(r) || 0;
    if (got < need) { used.set(r, got + 1); continue; }
    next.push(orig[i]);
  }
  game.hands[seat] = next;

  for (let i = 0; i < cards.length; i++) {
    game.played.push(cards[i]);
    game.playedCounts[rankOf(cards[i])]++;
  }
  game.playCount[seat]++;

  if (isBombLike(c)) {
    game.bombCount++;
    game.multiplier *= 2;
  }

  game.lastPlay = { seat: seat, cards: cards.slice(), type: c.type, rank: c.rank, len: c.len };
  game.passCount = 0;
  game.log.push({ kind: 'play', seat: seat, cards: cards.slice(), type: c.type });

  if (next.length === 0) {
    finish(game, seat);
    return { legal: true, over: true };
  }
  game.turn = nextSeat(seat);
  return { legal: true, over: false };
}

/** 过牌（领出时不能过） */
function pass(game, seat) {
  if (game.phase !== 'playing') return { legal: false, reason: '当前不是出牌阶段' };
  if (game.over) return { legal: false, reason: '对局已结束' };
  if (seat !== game.turn) return { legal: false, reason: '还没轮到你' };
  if (!game.lastPlay) return { legal: false, reason: '你是领出方，必须出牌' };

  const leader = game.lastPlay.seat;
  game.passCount++;
  game.log.push({ kind: 'pass', seat: seat });

  if (game.passCount >= 2) {
    game.lastPlay = null;
    game.passCount = 0;
    game.turn = leader;          // 连过两家 → 最后出牌者重新领出
  } else {
    game.turn = nextSeat(seat);
  }
  return { legal: true };
}

/** 结算 */
function finish(game, seat) {
  game.over = true;
  game.phase = 'over';
  game.landlordWin = seat === game.landlord;

  // 春天 / 反春天
  const farmers = SEATS.filter((s) => s !== game.landlord);
  if (game.landlordWin) {
    if (farmers.every((s) => game.playCount[s] === 0)) game.multiplier *= 2;
  } else {
    if (game.playCount[game.landlord] <= 1) game.multiplier *= 2;
  }
  game.winSeat = seat;
}

/** 当前行棋方是否处于「必须出牌、不能过」的领出状态 */
function mustLead(game) {
  return game.phase === 'playing' && !game.over && !game.lastPlay;
}

/** 给 AI 的公开上下文（不含任何隐藏手牌） */
function aiContext(game, seat) {
  return {
    seat: seat,
    landlord: game.landlord,
    handSizes: [game.hands[0].length, game.hands[1].length, game.hands[2].length],
    playedCounts: Array.from(game.playedCounts),
    passCount: game.passCount,
    multiplier: game.multiplier
  };
}

/** 结算得分（地主 ±2×倍数，农民 ∓1×倍数） */
function settle(game) {
  const base = game.multiplier;
  const out = [0, 0, 0];
  for (const s of SEATS) {
    if (s === game.landlord) out[s] = game.landlordWin ? base * 2 : -base * 2;
    else out[s] = game.landlordWin ? -base : base;
  }
  return out;
}



global.DDZRules={RANK_COUNT,DECK_SIZE,RANK_NAMES,TOTAL_OF_RANK,SUITS,rankOf,suitOf,isJoker,cardLabel,countsOf,countsLabel,sortHand,TYPE,TYPE_NAMES,classify,beats,isBombLike,generateMoves,minHands,SEATS,SEAT_NAMES,nextSeat,createGame,deal,nextBid,startPlay,play,pass,mustLead,aiContext,settle,mulberry32};
})(window);
(function(global){"use strict";
/**
 * difficulty.js - 难度档位的单一事实来源
 *
 * 这个文件只描述「什么档位用什么参数」，以及「拿到引擎候选后怎么挑一手」。
 * 它不碰 DOM、不碰 Worker 消息，只 export 一个 Difficulty 对象。
 * 主线程（UI 显示、根节点采样）与 ai/engine.js（认知开关）import 同一份定义，
 * 杜绝「同一条难度规则散落在多个文件」。
 *
 * ── 与 04.Gomoku 的差异 ───────────────────────────────────────────────
 *
 * 五子棋的难度旋钮是「搜索深度 + 候选宽度 + 根节点采样」；斗地主是**不完全信息
 * 博弈**，没有能精确求解的浅层搜索（对手手牌看不见），所以本作的难度旋钮是
 * 「认知能力 + 根节点采样」：
 *
 *   1) 认知弱化（"看不看得懂局面"）：
 *      wingChoices - 每个带牌主牌型枚举几种翅膀搭配（低档只想到一种出法）
 *      remember    - 是否记牌（由已出牌反推对手可能持有的大牌）
 *      teamwork    - 农民之间是否懂得不互相压牌
 *      endgame     - 残局求解（一手走完 / 对手剩一张时的防守）
 *
 *   2) 根节点采样（"看懂了会不会走歪"）：
 *      temperature - softmax 温度（候选分单位，1 手 = HAND_UNIT 分）
 *      blunder     - 触发「从更宽的池子里随机挑一手」的概率
 *
 * ── 不可弱化的硬底线（防"看起来像 bug"）──────────────────────────────
 *
 * 不论什么档位，引擎根节点始终执行：
 *   ① 能一手走完 → 必走（"能赢不赢"不叫菜，叫坏了）；
 *   ② 领出时不能过（规则约束，不是难度问题）。
 * 这两条在 ai/engine.js 里实现，采样层永远碰不到它们。
 *
 * 此外采样带**损失上限**：候选分差超过档位上限时强制回引擎首选，
 * 避免"放着顺子不拆、去拆一张 2"这种不像弱、像坏的出牌。
 *
 * ── 分数刻度 ─────────────────────────────────────────────────────────
 *
 * 引擎的候选分以「手数」为主轴：HAND_UNIT = 1000 分 = 少一手牌。
 * 一发牌（17 张）的典型手数是 5~9 手，所以候选分常见区间是 -9000 ~ -1000，
 * 温度与损失上限都按这个量级调。
 *
 * ── 校准记录 ─────────────────────────────────────────────────────────
 *
 * 2026-09-12，Node 直接 import rules.js + ai/engine.js 驱动机机对战
 * （每组 300 局，地主座位 0/1/2 轮转，强制指定地主以隔离叫分运气）：
 *
 *   L2 vs L1 : 高当地主胜率 55%  vs 低当地主胜率 32%  → +23pt
 *   L3 vs L2 : 54% vs 37%  → +17pt
 *   L4 vs L3 : 45% vs 37%  →  +8pt
 *   L5 vs L4 : 47% vs 43%  →  +5pt
 *   L6 vs L5 : 44% vs 44%  →   0pt
 *   L6 vs L1 : 74% vs 21%  → +54pt
 *
 * 结论：L1→L5 梯度单调无倒挂；L6 与 L5 棋力接近——第六档唯一多出来的是
 * wingChoices 3（带牌主牌型多枚举几种翅膀搭配），实测收益落在噪声里。
 * 这一档的定位是「不加遮掩的引擎全力」，而不是「比大师强一个档次」，
 * 所以如实保留，不人为造出差距。
 *
 * 单步决策耗时（Node 22，真实 17 张手牌）：中位 <1ms，未见超过 3ms；
 * 400 局机机对战总耗时约 9 秒（含全部规则与 AI 计算）。
 *
 * @license MIT
 */

const HAND_UNIT = 1000;       // 1 手 = 1000 候选分

/** 采样时允许的最大分差（候选分单位） */
const LOSS_CAP = { 1: 1400, 2: 800, 3: 350, 4: 140, 5: 40, 6: 0 };

/** 失误模式下允许的最大分差（比正常采样更宽，但仍有底） */
const BLUNDER_CAP = 2600;

/** 必胜分阈值：分值达到这个量级说明引擎已判定「这一手直接走完」 */
const WIN_BASE = 90000;

/**
 * 六档难度。
 *
 * 字段说明：
 *   label       - 显示名，UI 难度按钮文案直接读它，不要另外硬编码
 *   wingChoices - 每个带牌主牌型枚举几种翅膀搭配
 *   remember    - 是否记牌（反推对手可能持有的大牌）
 *   teamwork    - 农民之间是否懂得不互相压牌
 *   endgame     - 是否启用残局求解
 *   temperature - softmax 温度（候选分）；0 表示永远取引擎首选
 *   blunder     - 在更宽候选池里随机挑一手的概率（0~1）
 *   desc        - 档位描述（难度选择菜单展示）
 */
const LEVELS = [
  { level: 1, label: '入门', wingChoices: 1, remember: false, teamwork: false, endgame: false, temperature: 800, blunder: 0.35,
    desc: '只想到最基本的出法，不太会拆牌，经常把手牌拆散。' },
  { level: 2, label: '初级', wingChoices: 1, remember: false, teamwork: false, endgame: false, temperature: 400, blunder: 0.15,
    desc: '会按最少手数出牌，但不记牌、不懂配合，容易漏掉机会。' },
  { level: 3, label: '中级', wingChoices: 2, remember: false, teamwork: true,  endgame: false, temperature: 150, blunder: 0.03,
    desc: '农民之间知道让牌，出法也更多样，偶尔失手。' },
  { level: 4, label: '高级', wingChoices: 2, remember: true,  teamwork: true,  endgame: false, temperature: 40,  blunder: 0,
    desc: '会记牌，能判断自己出的牌压不压得住，收放有度。' },
  { level: 5, label: '大师', wingChoices: 2, remember: true,  teamwork: true,  endgame: true,  temperature: 0,   blunder: 0,
    desc: '残局不失误：能一手走完必走，对手剩一张时不乱送。' },
  { level: 6, label: '宗师', wingChoices: 3, remember: true,  teamwork: true,  endgame: true,  temperature: 0,   blunder: 0,
    desc: '引擎全力：更多出法枚举 + 完整记牌与残局求解。' }
];

const DEFAULT_LEVEL = 3;

/** 允许「档位号」或「档位定义对象」两种入参 */
function resolveDef(levelOrDef) {
  if (levelOrDef && typeof levelOrDef === 'object') return levelOrDef;
  return getLevel(levelOrDef);
}

/** 按档位号取定义；越界回落到默认档位 */
function getLevel(level) {
  for (let i = 0; i < LEVELS.length; i++) {
    if (LEVELS[i].level === level) return LEVELS[i];
  }
  return getLevel(DEFAULT_LEVEL);
}

/** 候选是否是「已判定直接走完」的一手 */
function isWinning(candidate) {
  return typeof candidate.score === 'number' && candidate.score >= WIN_BASE;
}

/**
 * 按 softmax 权重在候选间采样。
 *
 *   w_i = exp(-(best - s_i) / temperature)
 *
 * temperature 越大越容易选中次优（越弱）；temperature <= 0 或只有一个候选时
 * 退化为取最优（同分随机打破平局）。
 */
function pickByTemperature(candidates, temperature) {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  let best = -Infinity;
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i].score > best) best = candidates[i].score;
  }

  if (!(temperature > 0)) {
    const sameBest = [];
    for (let j = 0; j < candidates.length; j++) {
      if (candidates[j].score === best) sameBest.push(candidates[j]);
    }
    return sameBest[Math.floor(Math.random() * sameBest.length)];
  }

  let total = 0;
  const weights = new Array(candidates.length);
  for (let k = 0; k < candidates.length; k++) {
    let w = Math.exp(-(best - candidates[k].score) / temperature);
    if (!(w > 0)) w = 1e-9;   // 分差过大时 exp 下溢，给极小下限保证人人有机会
    weights[k] = w;
    total += w;
  }
  let roll = Math.random() * total;
  for (let m = 0; m < candidates.length; m++) {
    roll -= weights[m];
    if (roll <= 0) return candidates[m];
  }
  return candidates[candidates.length - 1];
}

/**
 * 从引擎给出的候选里，按档位挑一手。
 *
 * @param {Array<{cards:number[]|null, score:number}>} candidates
 *        cards === null 表示「不出」（过牌）
 * @param {number|Object} levelOrDef 档位号或档位定义对象
 * @returns {{cards:number[]|null, score:number, suboptimal:boolean}|null}
 *          suboptimal = true 表示这一手不是引擎评分最高的，UI 必须如实标注「次优」
 */
function pickMove(candidates, levelOrDef) {
  if (!candidates || candidates.length === 0) return null;
  const def = resolveDef(levelOrDef);

  const tagged = candidates.slice().sort((a, b) => b.score - a.score);
  const top = tagged[0];

  // 已判定「直接走完」：永远走它，低档也不许错过
  if (isWinning(top)) return tag(top, top);

  if (tagged.length === 1 || (def.temperature <= 0 && def.blunder <= 0)) return tag(top, top);

  // 剔除分差过大的候选
  const cap = LOSS_CAP[def.level] !== undefined ? LOSS_CAP[def.level] : 300;
  const pool = [];
  for (let i = 0; i < tagged.length; i++) {
    if (top.score - tagged[i].score > cap) continue;
    pool.push(tagged[i]);
  }
  if (pool.length <= 1) return tag(top, top);

  // 失误模式：在更宽的候选池里均匀随机取一手
  if (def.blunder > 0 && Math.random() < def.blunder) {
    const wide = [];
    for (let j = 0; j < tagged.length; j++) {
      if (top.score - tagged[j].score > BLUNDER_CAP) continue;
      wide.push(tagged[j]);
    }
    if (wide.length > 1) return tag(top, wide[Math.floor(Math.random() * wide.length)]);
  }

  return tag(top, pickByTemperature(pool, def.temperature));
}

/** 把 pickMove 选中的候选打上「是否次优」标记 */
function tag(top, chosen) {
  return {
    cards: chosen.cards,
    score: chosen.score,
    suboptimal: chosen !== top,
    candidate: chosen
  };
}

const Difficulty = {
  HAND_UNIT: HAND_UNIT,
  LEVELS: LEVELS,
  DEFAULT_LEVEL: DEFAULT_LEVEL,
  LOSS_CAP: LOSS_CAP,
  BLUNDER_CAP: BLUNDER_CAP,
  WIN_BASE: WIN_BASE,
  resolveDef: resolveDef,
  getLevel: getLevel,
  isWinning: isWinning,
  pickByTemperature: pickByTemperature,
  pickMove: pickMove
};



global.DDZDifficulty=Difficulty;
})(window);
(function(global){"use strict";
const {TYPE,TYPE_NAMES,RANK_COUNT,TOTAL_OF_RANK,rankOf,countsOf,countsLabel,minHands,generateMoves,isBombLike}=global.DDZRules;
const Difficulty=global.DDZDifficulty;
/**
 * engine.js - 自研斗地主 AI 本体（纯逻辑）
 *
 * 没有任何 Worker / DOM 全局依赖，因此：
 *   - 主线程的 ai/engine.worker.js 直接 import 它在 Worker 里跑；
 *   - Node 也能直接 import 它做「机机对战」难度校准（不启动浏览器）。
 *
 * ── 决策流程 ──────────────────────────────────────────────────────────
 *
 *   decide(hand, lastPlay, ctx)
 *     1. 硬规则：手里只剩一手牌（minHands === 1）且这一手能走完 → 必走
 *     2. 生成候选：rules.generateMoves（牌型枚举 + 翅膀选取都在规则层完成）
 *     3. 逐个候选打分：出牌后剩几手是主轴，出牌成本/炸弹代价/控制权是修正项
 *     4. 跟牌时再插入一个「不出」候选（含队友让牌与对手威胁的修正）
 *     5. 返回候选列表 + 本步的如实信息（手数前→后 / 是否炸弹 / 是否残局）
 *        —— 最终的「挑哪一手」交给 difficulty.pickMove 按档位采样
 *
 * ── 为什么不做搜索 ────────────────────────────────────────────────────
 *
 * 斗地主是不完全信息博弈：另外两家的手牌看不见，任何固定深度的 α-β 都会在
 * 「对手可能持有什么」上做任意假设，反而不如一个诚实的手数 DP + 记牌推断。
 * 本作把「深度」用在**认知**上（记牌 / 队友 / 残局），这是这一档难度真正
 * 该有的能力差异，也是每一步都能向玩家解释清楚的。
 *
 * ── 打分量纲（与 difficulty.js 的 HAND_UNIT 对齐）─────────────────────
 *
 *   1 手 = 1000 分。候选分主轴 -剩手数×1000；下面这些是修正项，量级都在
 *   一手以内，只用来在「手数相同」的候选之间分高低。
 *
 * @license MIT
 */

const HAND_UNIT = Difficulty.HAND_UNIT;

// ── 打分权重（量纲见文件头）────────────────────────────────────────────

const FREE_PLAY_BONUS = 400;    // 「不吃亏的一手」（出完剩手数不增加）的节奏收益
const BOMB_COST = 2500;         // 动炸弹/火箭的额外代价（约 2.5 手）
const TOP_BONUS = 400;          // 记牌推断出「这手对手压不住」的收益（拿回出牌权）
const TEAM_PASS_BONUS = 900;    // 队友领出时让牌的收益
const DANGER_PENALTY = 2200;    // 对手快走完时让牌的代价
const LEAD_SOLO_PENALTY = 1500; // 对手仅剩 1 张时领出单张的代价

// ── 工具 ─────────────────────────────────────────────────────────────

function countsEqual(a, b) {
  for (let r = 0; r < RANK_COUNT; r++) {
    if (a[r] !== b[r]) return false;
  }
  return true;
}

function subCounts(a, b) {
  const out = new Int8Array(RANK_COUNT);
  for (let r = 0; r < RANK_COUNT; r++) out[r] = a[r] - b[r];
  return out;
}

/** 出牌成本：点数越高越贵（引导「先出小牌、留住大牌」） */
function cardCost(cards) {
  let s = 0;
  for (let i = 0; i < cards.length; i++) s += rankOf(cards[i]) + 1;
  return s * 8;
}

/** 我的对手是谁（地主 vs 两个农民；农民 vs 地主，另一个农民是队友） */
function opponentsOf(seat, landlord) {
  if (seat === landlord) {
    const out = [];
    for (let s = 0; s < 3; s++) if (s !== seat) out.push(s);
    return out;
  }
  return [landlord];
}

function minOpponentSize(ctx, seat) {
  const opps = opponentsOf(seat, ctx.landlord);
  let m = Infinity;
  for (let i = 0; i < opps.length; i++) {
    const n = ctx.handSizes[opps[i]];
    if (n < m) m = n;
  }
  return m;
}

/** 由公开信息反推「对手手里还剩哪些点数、各几张」 */
function remainingForOpponents(myCounts, ctx) {
  const remain = new Int8Array(RANK_COUNT);
  for (let r = 0; r < RANK_COUNT; r++) {
    const played = ctx.playedCounts ? (ctx.playedCounts[r] || 0) : 0;
    const v = TOTAL_OF_RANK[r] - played - myCounts[r];
    remain[r] = v > 0 ? v : 0;
  }
  return remain;
}

/**
 * 记牌推断：这一手对手压得住吗？
 * 只对「单张 / 对子 / 三张 / 炸弹 / 火箭」做严格判断，其余（顺子、飞机…
 * 需要多家配合的牌型）一律保守地认为压得住。
 */
function likelyUnbeatable(move, myCounts, ctx) {
  const remain = remainingForOpponents(myCounts, ctx);
  const rocketPossible = remain[13] >= 1 && remain[14] >= 1;

  if (move.type === TYPE.ROCKET) return true;

  if (move.type === TYPE.BOMB) {
    if (rocketPossible) return false;
    for (let r = move.rank + 1; r < RANK_COUNT; r++) {
      if (remain[r] >= 4) return false;
    }
    return true;
  }

  // 非炸弹：只要有更大的同型组合或任意炸弹/火箭，就压得住
  if (rocketPossible) return false;
  for (let r = 0; r < RANK_COUNT; r++) {
    if (remain[r] >= 4) return false;
  }
  const unit = move.type === TYPE.SOLO ? 1 : move.type === TYPE.PAIR ? 2 : move.type === TYPE.TRIO ? 3 : 0;
  if (unit === 0) return false;      // 其他牌型的压制关系复杂，保守返回 false
  for (let r = move.rank + 1; r < RANK_COUNT; r++) {
    if (remain[r] >= unit) return false;
  }
  return true;
}

/** 残局修正：对手只剩一两张时的出法偏好 */
function endgameAdjust(move, myCounts, ctx, leading) {
  const oppMin = minOpponentSize(ctx, ctx.seat);
  let s = 0;
  if (leading && oppMin <= 1) {
    // 对手一张牌：他压得住就能立刻走完。领出单张很危险，优先出组合牌
    if (move.type === TYPE.SOLO) {
      s -= LEAD_SOLO_PENALTY;
      // 同一惩罚下，越大的单张越安全（对手更可能接不住）
      s += move.rank * 30;
    } else {
      s += 300;
    }
  }
  return s;
}

// ── 主入口 ───────────────────────────────────────────────────────────

/**
 * 为 seat 决定这一步怎么走。
 *
 * @param {number[]} hand 我的手牌（card id 数组）
 * @param {{seat:number,type:string,rank:number,len:number}|null} lastPlay 当前待压牌型
 * @param {Object} ctx 公开上下文
 *        { seat, landlord, handSizes:[3], playedCounts:[15], passCount, level }
 * @returns {{ candidates: Array, info: Object }}
 */
function decide(hand, lastPlay, ctx) {
  const t0 = now();
  const def = Difficulty.getLevel(ctx.level || Difficulty.DEFAULT_LEVEL);
  const myCounts = countsOf(hand);
  const handsBefore = minHands(myCounts);
  const leading = !lastPlay;

  const moves = generateMoves(hand, lastPlay, { wingChoices: def.wingChoices });

  const ctxFull = {
    seat: ctx.seat,
    landlord: ctx.landlord,
    handSizes: ctx.handSizes,
    playedCounts: ctx.playedCounts || new Array(RANK_COUNT).fill(0),
    passCount: ctx.passCount || 0
  };

  // ── 硬规则 1：手里就是一手牌 → 必走（任何档位）──
  if (handsBefore === 1 && moves.length) {
    const win = moves.find((m) => countsEqual(m.counts, myCounts));
    if (win) {
      return finish([
        { cards: win.cards, score: WIN_SCORE(), meta: meta(win, 1, true, def, ctxFull, myCounts) }
      ], { handsBefore: 1, handsAfter: 0, forced: 'win', level: def.level }, t0);
    }
  }

  // ── 候选为空：只能过（跟牌时；领出时不可能为空）──
  if (!moves.length) {
    return finish(
      [{ cards: null, score: 0, meta: { type: 'pass', typeName: '不出', handsAfter: handsBefore } }],
      { handsBefore: handsBefore, handsAfter: handsBefore, forced: 'none', level: def.level, note: '无牌可压' },
      t0
    );
  }

  // ── 逐个候选打分 ──
  const scored = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const after = subCounts(myCounts, m.counts);
    const h = minHands(after);

    let s = -h * HAND_UNIT;
    s -= cardCost(m.cards);
    if (h <= handsBefore) s += FREE_PLAY_BONUS;
    if (isBombLike(m)) s -= BOMB_COST;
    if (leading && def.remember && likelyUnbeatable(m, myCounts, ctxFull)) s += TOP_BONUS;
    if (def.endgame) s += endgameAdjust(m, myCounts, ctxFull, leading);

    scored.push({ cards: m.cards, score: s, meta: meta(m, h, false, def, ctxFull, myCounts) });
  }

  // 同 (牌型, 主点, 长度) 只留分最高的一手：翅膀的具体搭配对局面几乎无差，
  // 去掉它们能让采样池干净很多
  const bestByShape = new Map();
  for (let i = 0; i < scored.length; i++) {
    const c = scored[i];
    const key = c.meta.type + '|' + c.meta.rank + '|' + c.meta.len;
    const prev = bestByShape.get(key);
    if (!prev || c.score > prev.score) bestByShape.set(key, c);
  }
  let candidates = Array.from(bestByShape.values());

  // ── 跟牌时插入「不出」候选 ──
  if (!leading) {
    const leaderIsTeammate = def.teamwork && ctx.seat !== ctx.landlord && lastPlay.seat !== ctx.landlord;
    let ps = -handsBefore * HAND_UNIT;
    if (leaderIsTeammate) {
      ps += TEAM_PASS_BONUS;
    } else {
      const danger = minOpponentSize(ctxFull, ctx.seat);
      if (danger <= 2) ps -= DANGER_PENALTY;
      else if (danger <= 4) ps -= DANGER_PENALTY / 3;
    }
    candidates.push({
      cards: null,
      score: ps,
      meta: {
        type: 'pass', typeName: '不出', rank: -1, len: 0,
        handsAfter: handsBefore, bomb: false, endgame: false, remembered: false,
        teammatePass: !!(def.teamwork && ctx.seat !== ctx.landlord && lastPlay.seat !== ctx.landlord)
      }
    });
  }

  const info = {
    handsBefore: handsBefore,
    handsAfter: Math.min.apply(null, candidates.map((c) => c.meta.handsAfter)),
    forced: 'none',
    level: def.level,
    candidateCount: candidates.length
  };
  return finish(candidates, info, t0);
}

/** 候选的如实元信息（面板展示用，不参与采样） */
function meta(move, handsAfter, forcedWin, def, ctx, myCounts) {
  return {
    type: move.type,
    typeName: TYPE_NAMES[move.type] || move.type,
    rank: move.rank,
    len: move.len,
    handsAfter: handsAfter,
    bomb: isBombLike(move),
    endgame: !!def.endgame,
    remembered: !!(def.remember && likelyUnbeatable(move, myCounts, ctx)),
    forcedWin: !!forcedWin
  };
}

function WIN_SCORE() {
  return Difficulty.WIN_BASE + 1000;
}

function finish(candidates, info, t0) {
  info.elapsedMs = Math.max(0, Math.round(now() - t0));
  return { candidates: candidates, info: info };
}

function now() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

// ── 给侧栏用的牌面摘要 ───────────────────────────────────────────────

/** 候选牌面摘要，如 "K×3 7" */
function cardsSummary(cards) {
  if (!cards || !cards.length) return '不出';
  return countsLabel(countsOf(cards));
}



global.DDZEngine={decide,cardsSummary};
})(window);
(function(){
"use strict";
const R=window.DDZRules,D=window.DDZDifficulty,E=window.DDZEngine,handEl=document.getElementById("hand"),status=document.getElementById("tableInfo");
let game=null,selected=new Set(),paused=false,timer=null,difficulty="normal",finished=false,hintCards=[];
function level(){return difficulty==="easy"?1:difficulty==="hard"?5:3;}
function report(t){status.textContent=t;GameBridge.report(t,{score:Math.max(0,17-(game?.hands?.[0]?.length||17))});}
function label(card){const r=R.rankOf(card),s=R.suitOf(card);return R.RANK_NAMES[r]+(R.isJoker(card)?"":" "+R.SUITS[s]);}
function red(card){const s=R.suitOf(card);return !R.isJoker(card)&&(s===1||s===3);}
function render(){if(!game)return;handEl.innerHTML="";const hand=game.hands[0];hand.forEach(card=>{const b=document.createElement("button");b.type="button";b.className="playing-card"+(red(card)?" red":"")+(selected.has(card)?" selected":"")+(hintCards.includes(card)?" hint-card":"");b.textContent=label(card);b.disabled=paused||game.phase!=="playing"||game.turn!==0||game.over;b.addEventListener("click",()=>{if(selected.has(card))selected.delete(card);else selected.add(card);render();});handEl.appendChild(b);});
 document.getElementById("handCount").textContent=hand.length;document.getElementById("phaseLabel").textContent=game.phase==="bidding"?"叫地主":game.phase==="playing"?"出牌":"结束";document.getElementById("landlordLabel").textContent=game.landlord<0?"未定":game.landlord===0?"你":game.landlord===1?"右家":"左家";document.getElementById("multiplier").textContent="×"+game.multiplier;document.getElementById("lastPlay").textContent=game.lastPlay?R.SEAT_NAMES[game.lastPlay.seat]+" · "+E.cardsSummary(game.lastPlay.cards):"尚未出牌";document.getElementById("bottomCards").textContent=game.landlord===0?game.bottom.map(label).join("  "):game.landlord<0?"未揭示":"已归地主";
 document.getElementById("bidControls").classList.toggle("hidden",game.phase!=="bidding"||game.bidTurn!==0);document.getElementById("playControls").classList.toggle("hidden",game.phase!=="playing"||game.turn!==0);document.getElementById("play").disabled=!selected.size;document.getElementById("pass").disabled=!game.lastPlay||game.lastPlay.seat===0;document.getElementById("bid1").disabled=game.highestBid>=1;document.getElementById("bid2").disabled=game.highestBid>=2;document.getElementById("bid3").disabled=game.highestBid>=3;
 document.getElementById("opponents").innerHTML=[1,2].map(s=>'<span class="metric-pill">'+R.SEAT_NAMES[s]+' <strong>'+game.hands[s].length+' 张</strong>'+(game.landlord===s?' · 地主':'')+'</span>').join("");document.getElementById("scoreLine").textContent=game.bids.map((v,i)=>R.SEAT_NAMES[i]+": "+(v===null?"—":v===0?"不叫":v+"分")).join("　");}
function bidStrength(hand){const c=R.countsOf(hand),high=c[11]+c[12]*1.5+c[13]*2.2+c[14]*2.7;let bombs=0,trios=0;for(let i=0;i<13;i++){if(c[i]===4)bombs++;if(c[i]===3)trios++;}if(c[13]&&c[14])return 3;if(bombs>=2||(bombs&&high>=5))return 3;if(bombs||high>=7||trios>=2)return 2;if(high>=4||trios>=1)return 1;return 0;}
function afterAction(){render();if(game.over){finish();return;}scheduleAI();}
function finish(){if(finished)return;finished=true;const scores=R.settle(game),humanWin=game.landlord===0?game.landlordWin:!game.landlordWin,msg=humanWin?"你方获胜！":"对手获胜";report(msg+" · 倍数 ×"+game.multiplier+" · 结算 "+scores[0]);GameBridge.send("GAME_OVER",{message:msg,score:Math.max(0,scores[0]),win:humanWin});}
function stepBid(seat,value){const r=R.nextBid(game,seat,value);if(!r.legal){report(r.reason);return;}if(r.redeal){report("无人叫地主，重新发牌");render();scheduleAI();return;}if(r.done){R.startPlay(game);report("地主确定："+R.SEAT_NAMES[game.landlord]);}else report(R.SEAT_NAMES[seat]+(value?"叫 "+value+" 分":"不叫"));afterAction();}
function aiBid(){if(paused||game.phase!=="bidding"||game.bidTurn===0)return;const seat=game.bidTurn,score=bidStrength(game.hands[seat]);stepBid(seat,score>game.highestBid?score:0);}
function aiPlay(){if(paused||game.phase!=="playing"||game.turn===0)return;const seat=game.turn,ctx={...R.aiContext(game,seat),level:level()},decision=E.decide(game.hands[seat],game.lastPlay,ctx),choice=D.pickMove(decision.candidates,level());if(!choice||!choice.cards){R.pass(game,seat);report(R.SEAT_NAMES[seat]+" 不出");}else{const r=R.play(game,seat,choice.cards);if(!r.legal){report("AI 出牌校验失败："+r.reason);return;}report(R.SEAT_NAMES[seat]+" 出 "+E.cardsSummary(choice.cards)+(choice.suboptimal?" · 次优选择":""));}afterAction();}
function scheduleAI(){clearTimeout(timer);if(paused||!game||game.over)return;if(game.phase==="bidding"&&game.bidTurn!==0)timer=setTimeout(aiBid,520);else if(game.phase==="playing"&&game.turn!==0)timer=setTimeout(aiPlay,520);}
function playHuman(){if(paused||game.phase!=="playing"||game.turn!==0||!selected.size)return;const cards=[...selected],r=R.play(game,0,cards);if(!r.legal){report(r.reason);return;}selected.clear();hintCards=[];report("你出 "+E.cardsSummary(cards));afterAction();}
function passHuman(){if(paused||game.phase!=="playing"||game.turn!==0)return;const r=R.pass(game,0);if(!r.legal){report(r.reason);return;}selected.clear();report("你选择不出");afterAction();}
function hint(){if(paused||game.phase!=="playing"||game.turn!==0)return;const ctx={...R.aiContext(game,0),level:level()},decision=E.decide(game.hands[0],game.lastPlay,ctx),choice=D.pickMove(decision.candidates,level());hintCards=choice?.cards||[];selected=new Set(hintCards);render();report(choice?.cards?"提示："+E.cardsSummary(choice.cards):"建议不出");}
function newGame(){clearTimeout(timer);game=R.createGame();R.deal(game);selected.clear();hintCards=[];paused=false;finished=false;report("发牌完成 · 叫分开始");render();scheduleAI();}
document.getElementById("bid0").onclick=()=>stepBid(0,0);document.getElementById("bid1").onclick=()=>stepBid(0,1);document.getElementById("bid2").onclick=()=>stepBid(0,2);document.getElementById("bid3").onclick=()=>stepBid(0,3);document.getElementById("play").onclick=playHuman;document.getElementById("pass").onclick=passHuman;document.getElementById("hint").onclick=hint;
GameBridge.register({init(p){difficulty=p.difficulty||"normal";newGame();},newGame,pause(){paused=true;clearTimeout(timer);report("已暂停");render();},resume(){paused=false;report("继续对局");render();scheduleAI();},setDifficulty(v){difficulty=v||"normal";},dispose(){paused=true;clearTimeout(timer);}});
})();