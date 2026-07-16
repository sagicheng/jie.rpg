/**
 * PVP 竞技场 — 服务端权威纯逻辑（无副作用，便于单测）
 * ───────────────────────────────────────────────────────────
 * 所有时间判定以服务器本地时区为准（禁用客户端时钟，防作弊 / 跨时区）。
 * 段位 / 积分 / 赛季 / 周次全部集中在此，客户端仅作展示。
 */
import { STAT_PER_POINT, ZANPAKUTO_GROWTH } from '../src/config';
import { computeSetBonuses } from '../src/systems/SetSystem';
import { weekStr } from '../src/systems/QuestData';
import type { EquipSlot } from '../src/systems/Inventory';
import type { PlayerWorld } from './world';

// ——— 常量（集中管理，便于调整）———
/** 开放时间：每周五 18:00–24:00（服务端权威）。 */
export const ARENA_OPEN_DAY = 5;          // getDay()：0=周日 … 5=周五
export const ARENA_OPEN_START_HOUR = 18;
export const ARENA_OPEN_END_HOUR = 24;    // 24 即 0 点前（不含 24:00）
/** 初始积分。 */
export const ARENA_INITIAL_POINTS = 1000;
/** 每个角色每周固定匹配次数。 */
export const ARENA_WEEKLY_CAP = 20;
/** 匹配超时：凑不齐真人则取消（绝不 AI 替代）。 */
export const ARENA_MATCH_TIMEOUT_MS = 60_000;
/** 单场匹配成功但玩家未进房的宽限（PvpRoom 内判定）。 */
export const ARENA_JOIN_GRACE_MS = 15_000;
/** 胜利 / 失败 积分变动。 */
export const ARENA_WIN_DELTA = 25;
export const ARENA_LOSS_DELTA = -25;

/** 段位表（按 minPoints 升序；init 1000 落在青铜）。 */
export interface ArenaTier { id: string; name: string; min: number; }

/** 竞技场对战模式（1v1 / 4v4，均不允许组队）。 */
export type ArenaMode = '1v1' | '4v4';
export const ARENA_TIERS: ArenaTier[] = [
  { id: 'bronze',   name: '青铜', min: 0 },
  { id: 'silver',   name: '白银', min: 1200 },
  { id: 'gold',     name: '黄金', min: 1400 },
  { id: 'platinum', name: '白金', min: 1600 },
  { id: 'diamond',  name: '钻石', min: 1800 },
  { id: 'king',     name: '王者', min: 2000 },
];

/** 段位序号（越高越强），用于比较。 */
export function tierRank(id: string): number {
  const i = ARENA_TIERS.findIndex((t) => t.id === id);
  return i < 0 ? 0 : i;
}
export function tierOf(points: number): ArenaTier {
  let t = ARENA_TIERS[0];
  for (const x of ARENA_TIERS) if (points >= x.min) t = x;
  return t;
}
export function tierName(id: string): string {
  return ARENA_TIERS.find((t) => t.id === id)?.name || ARENA_TIERS[0].name;
}

/** 赛季：每 2 个月一赛季（双月制，全局单调递增）。 */
export function currentSeason(now: Date = new Date()): number {
  return Math.floor((now.getFullYear() * 12 + now.getMonth()) / 2);
}

/** 竞技场是否开放（服务端权威）。 */
export function isArenaOpen(now: Date = new Date()): boolean {
  // 开发期开关：ARENA_DEV_OPEN=1 时无视开放时段，便于任意时间做端到端烟测。
  // 生产环境不设置该变量，行为完全不变。
  if (process.env.ARENA_DEV_OPEN === '1') return true;
  const day = now.getDay();
  const hour = now.getHours();
  return day === ARENA_OPEN_DAY && hour >= ARENA_OPEN_START_HOUR && hour < ARENA_OPEN_END_HOUR;
}

export interface ArenaState {
  season: number;
  points: number;
  tier: string;            // 当前段位 id
  seasonBestTier: string;  // 本赛季达到的最高段位（结算奖励用）
  bestTierEver: string;    // 历史最高段位（跨赛季展示）
  weeklyUsed: number;      // 本周已匹配次数
  week: string;            // 周次串（重置键）
  history: Array<{ season: number; tier: string; points: number }>; // 过往赛季（C 面板展示）
}

export function newArenaState(now: Date = new Date()): ArenaState {
  return {
    season: currentSeason(now),
    points: ARENA_INITIAL_POINTS,
    tier: 'bronze',
    seasonBestTier: 'bronze',
    bestTierEver: 'bronze',
    weeklyUsed: 0,
    week: weekStr(now),
    history: [],
  };
}

/**
 * 确保 arena 字段存在并做赛季 / 周次重置。
 * 返回 { seasonEndedTier }：若本调用跨越了赛季边界，返回刚结束赛季的 bestTier（供发奖励）；否则 undefined。
 */
export function ensureArena(pw: PlayerWorld, now: Date = new Date()): { seasonEndedTier?: string } {
  if (!pw.arena) pw.arena = newArenaState(now);
  let seasonEndedTier: string | undefined;

  const curSeason = currentSeason(now);
  if (pw.arena.season !== curSeason) {
    // 赛季重置：先归档刚结束赛季
    seasonEndedTier = pw.arena.seasonBestTier;
    pw.arena.history.push({ season: pw.arena.season, tier: pw.arena.seasonBestTier, points: pw.arena.points });
    // 最多保留 12 个历史赛季
    if (pw.arena.history.length > 12) pw.arena.history = pw.arena.history.slice(-12);
    pw.arena.season = curSeason;
    pw.arena.points = ARENA_INITIAL_POINTS;
    pw.arena.tier = 'bronze';
    pw.arena.seasonBestTier = 'bronze';
    pw.arena.weeklyUsed = 0;
    pw.arena.week = weekStr(now);
  }

  // 周次重置（仅当未跨赛季时也处理；跨赛季已清）
  const wk = weekStr(now);
  if (pw.arena.week !== wk) {
    pw.arena.week = wk;
    pw.arena.weeklyUsed = 0;
  }
  return { seasonEndedTier };
}

export interface ArenaResult {
  delta: number;       // 实际积分变动（0 地板）
  points: number;      // 结算后积分
  tier: string;        // 结算后段位 id
  promoted: boolean;   // 是否升段
}

/** 应用一场结果（win=true 胜，false 负），更新积分 / 段位 / 赛季最佳 / 历史最佳。 */
export function applyResult(pw: PlayerWorld, won: boolean): ArenaResult {
  const before = pw.arena.points;
  const delta = won ? ARENA_WIN_DELTA : ARENA_LOSS_DELTA;
  const after = Math.max(0, before + delta); // 0 地板，不继续降
  pw.arena.points = after;

  const newTier = tierOf(after).id;
  const promoted = tierRank(newTier) > tierRank(pw.arena.tier);
  pw.arena.tier = newTier;

  if (tierRank(newTier) > tierRank(pw.arena.seasonBestTier)) pw.arena.seasonBestTier = newTier;
  if (tierRank(newTier) > tierRank(pw.arena.bestTierEver)) pw.arena.bestTierEver = newTier;

  return { delta: after - before, points: after, tier: newTier, promoted };
}

// ——— 赛季奖励（按本赛季最高段位发放）———
export interface ArenaSeasonReward { gold: number; title: string; }
export const ARENA_SEASON_REWARDS: Record<string, ArenaSeasonReward> = {
  bronze:   { gold: 500,   title: '青铜斗士' },
  silver:   { gold: 1500,  title: '白银斗士' },
  gold:     { gold: 4000,  title: '黄金斗士' },
  platinum: { gold: 9000,  title: '白金斗士' },
  diamond:  { gold: 20000, title: '钻石斗士' },
  king:     { gold: 50000, title: '王者斗士' },
};
export function seasonRewardFor(tierId: string): ArenaSeasonReward {
  return ARENA_SEASON_REWARDS[tierId] || ARENA_SEASON_REWARDS.bronze;
}

// ——— 服务端权威战斗属性（镜像客户端 recalcStats，杜绝属性作弊）———
// 仅计入：基础值 + 加点 + 斩魄刀成长 + 装备(防具/首饰) + 套装加成。
// 刻意不计入：称号全属性%、鬼道被动%（两端一致故公平；后续可补）。
const BODY_SLOTS: EquipSlot[] = ['head', 'body', 'bracer', 'boots', 'belt'];
const JEWEL_SLOTS: EquipSlot[] = ['ring', 'necklace', 'charm', 'pendant'];

export interface PvpStats {
  maxHp: number; hp: number; maxMp: number; mp: number;
  atk: number; def: number; matk: number; mdef: number; spd: number;
}

export function computePvpStats(pw: PlayerWorld): PvpStats {
  const g = pw.zanpakuto ? (ZANPAKUTO_GROWTH[pw.zanpakuto] || {}) : {};
  const gt = (k: string): number => (g as any)[k] || 1.0;

  const sumStats = (slots: EquipSlot[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const slot of slots) {
      const it = pw.equipment[slot as keyof typeof pw.equipment] as any;
      if (it && it.stats) {
        for (const [k, v] of Object.entries(it.stats as Record<string, number>)) {
          out[k] = (out[k] || 0) + (v || 0);
        }
      }
    }
    return out;
  };
  const eqBody = sumStats(BODY_SLOTS);
  const eqJewel = sumStats(JEWEL_SLOTS);

  const a = pw as any;
  let maxHp = 100 + Math.round((a.allocatedHP || 0) * STAT_PER_POINT.HP * gt('HP'))
    + Math.round(eqBody.hp || 0) + Math.round(eqJewel.hp || 0);
  let maxMp = 50 + Math.round((a.allocatedMP || 0) * STAT_PER_POINT.MP * gt('MP'))
    + Math.round(eqBody.mp || 0) + Math.round(eqJewel.mp || 0);
  let atk = 10 + Math.round((a.allocatedATK || 0) * STAT_PER_POINT.ATK * gt('ATK'))
    + Math.round(eqBody.atk || 0) + Math.round(eqJewel.atk || 0);
  let def = 8 + Math.round((a.allocatedDEF || 0) * STAT_PER_POINT.DEF * gt('DEF'))
    + Math.round(eqBody.def || 0) + Math.round(eqJewel.def || 0);
  let matk = 10 + Math.round((a.allocatedMATK || 0) * STAT_PER_POINT.MATK * gt('MATK'))
    + Math.round(eqBody.matk || 0) + Math.round(eqJewel.matk || 0);
  let mdef = 8 + Math.round((a.allocatedMDEF || 0) * STAT_PER_POINT.MDEF * gt('MDEF'))
    + Math.round(eqBody.mdef || 0) + Math.round(eqJewel.mdef || 0);
  let spd = 10 + Math.round((a.allocatedSPD || 0) * STAT_PER_POINT.SPD * gt('SPD'))
    + Math.round(eqBody.spd || 0) + Math.round(eqJewel.spd || 0);

  // 套装加成（% 类，叠加在装备之后）
  const set = computeSetBonuses(pw.equipment as any);
  if (set.hp) maxHp = Math.round(maxHp * (1 + (set.hp || 0)));
  if (set.mp) maxMp = Math.round(maxMp * (1 + (set.mp || 0)));
  if (set.atk) atk = Math.round(atk * (1 + (set.atk || 0)));
  if (set.def) def = Math.round(def * (1 + (set.def || 0)));
  if (set.matk) matk = Math.round(matk * (1 + (set.matk || 0)));
  if (set.mdef) mdef = Math.round(mdef * (1 + (set.mdef || 0)));
  if (set.spd) spd = Math.round(spd * (1 + (set.spd || 0)));

  return { maxHp, hp: maxHp, maxMp, mp: maxMp, atk, def, matk, mdef, spd };
}
