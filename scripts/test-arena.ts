/**
 * PVP 竞技场核心逻辑单测（纯函数，无副作用）。
 * 运行：npx tsx scripts/test-arena.ts
 */
import assert from 'node:assert';
import {
  isArenaOpen, currentSeason, newArenaState, ensureArena, applyResult,
  tierOf, tierName, seasonRewardFor, ARENA_INITIAL_POINTS, ARENA_WIN_DELTA, ARENA_LOSS_DELTA,
} from '../server/features/arena';
import type { PlayerWorld } from '../server/core/world';

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

/** 构造某个星期几、某个小时的本地时间（day: 0=周日 … 5=周五）。 */
function atDayHour(day: number, hour: number): Date {
  const d = new Date(2026, 0, 1, hour, 0, 0); // 基准日
  const cur = d.getDay();
  let diff = (day - cur) % 7; if (diff < 0) diff += 7;
  d.setDate(d.getDate() + diff);
  d.setHours(hour, 0, 0, 0);
  return d;
}
function mkPw(now?: Date): PlayerWorld {
  return { arena: newArenaState(now) } as unknown as PlayerWorld;
}

console.log('— isArenaOpen（每周五 18:00-24:00）—');
ok('周五 18:00 开放', isArenaOpen(atDayHour(5, 18)) === true);
ok('周五 23:00 开放', isArenaOpen(atDayHour(5, 23)) === true);
ok('周五 17:00 不开放', isArenaOpen(atDayHour(5, 17)) === false);
ok('周五 00:00 不开放', isArenaOpen(atDayHour(5, 0)) === false);
ok('周一 19:00 不开放', isArenaOpen(atDayHour(1, 19)) === false);
ok('周日 20:00 不开放', isArenaOpen(atDayHour(0, 20)) === false);

console.log('— currentSeason（每 2 个月一赛季，单调递增）—');
{
  const jan = currentSeason(new Date(2026, 0, 1));
  const feb = currentSeason(new Date(2026, 1, 1));
  const mar = currentSeason(new Date(2026, 2, 1));
  ok('1月与2月同赛季', jan === feb);
  ok('3月进入下一赛季', mar === jan + 1);
}

console.log('— newArenaState（初始积分 1000 / 青铜）—');
{
  const a = newArenaState(atDayHour(5, 18));
  ok('初始积分为 1000', a.points === ARENA_INITIAL_POINTS);
  ok('初始段位青铜', a.tier === 'bronze');
  ok('初始周次次数 0', a.weeklyUsed === 0);
}

console.log('— 段位边界 —');
ok('999 → 青铜', tierOf(999).id === 'bronze');
ok('1200 → 白银', tierOf(1200).id === 'silver');
ok('1400 → 黄金', tierOf(1400).id === 'gold');
ok('1600 → 白金', tierOf(1600).id === 'platinum');
ok('1800 → 钻石', tierOf(1800).id === 'diamond');
ok('2000 → 王者', tierOf(2000).id === 'king');
ok('2500 → 王者(封顶)', tierOf(2500).id === 'king');
ok('tierName(bronze)=青铜', tierName('bronze') === '青铜');
ok('tierName(king)=王者', tierName('king') === '王者');

console.log('— applyResult（±25，0 地板）—');
{
  // 胜利：1000 → 1025
  const pw = mkPw(); pw.arena.points = 1000;
  const r1 = applyResult(pw, true);
  ok('胜利 +25', r1.delta === ARENA_WIN_DELTA && pw.arena.points === 1025);
  // 失败：1025 → 1000
  const r2 = applyResult(pw, false);
  ok('失败 -25', r2.delta === ARENA_LOSS_DELTA && pw.arena.points === 1000);
  // 0 地板：0 再失败仍为 0
  const pw0 = mkPw(); pw0.arena.points = 0;
  const r3 = applyResult(pw0, false);
  ok('0 地板不继续降', r3.delta === 0 && pw0.arena.points === 0);
  // 升段：1190 胜 → 1215 → 白银，promoted
  const pw2 = mkPw(); pw2.arena.points = 1190; pw2.arena.tier = 'bronze';
  const r4 = applyResult(pw2, true);
  ok('跨段升段', r4.tier === 'silver' && r4.promoted === true && pw2.arena.points === 1215);
  // 历史最高段位记录
  ok('bestTierEver 更新', pw2.arena.bestTierEver === 'silver');
}

console.log('— ensureArena（赛季 / 周次重置）—');
{
  // 赛季重置：arena 处于 1 月赛季，now 跳到 3 月赛季
  const jan = new Date(2026, 0, 1);
  const mar = new Date(2026, 2, 1);
  const pw = mkPw(jan);
  pw.arena.season = currentSeason(jan);
  pw.arena.points = 1600; pw.arena.tier = 'platinum'; pw.arena.seasonBestTier = 'platinum';
  const res = ensureArena(pw, mar);
  ok('赛季已推进', pw.arena.season === currentSeason(mar));
  ok('积分重置 1000', pw.arena.points === ARENA_INITIAL_POINTS);
  ok('段位重置青铜', pw.arena.tier === 'bronze');
  ok('周次次数重置 0', pw.arena.weeklyUsed === 0);
  ok('归档刚结束赛季(白金)', res.seasonEndedTier === 'platinum');
  ok('历史记录 +1', Array.isArray(pw.arena.history) && pw.arena.history.length === 1);
  ok('历史记录段位正确', pw.arena.history[0].tier === 'platinum');
}
{
  // 周次重置（同赛季，周串不同）
  const now = atDayHour(5, 18);
  const pw = mkPw(now);
  pw.arena.week = 'old-week';
  pw.arena.weeklyUsed = 7;
  ensureArena(pw, now);
  ok('周次串更新', pw.arena.week !== 'old-week');
  ok('周次次数重置 0', pw.arena.weeklyUsed === 0);
}

console.log('— seasonRewardFor（按最高段位发奖）—');
ok('青铜 500/青铜斗士', seasonRewardFor('bronze').gold === 500 && seasonRewardFor('bronze').title === '青铜斗士');
ok('王者 50000/王者斗士', seasonRewardFor('king').gold === 50000 && seasonRewardFor('king').title === '王者斗士');
ok('未知段位回退青铜', seasonRewardFor('???').gold === 500);

console.log('');
console.log(`结果：通过 ${passed} / 失败 ${failed}`);
if (failed > 0) process.exit(1);
