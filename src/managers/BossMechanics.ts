// ═══════════════════════════════════════════════════════════════════
// Boss 战机制引擎（独立文件，便于维护）
//   - 机制原语：regen / summon / buffSelf / debuffPlayer / shield / phase
//   - 开局随从 retinue（Boss 自带，4~7 只，参照飘流幻境）
//   - 死亡增援 reinforcement（随从阵亡后补波，封顶 maxWaves）
//   - 多人难度缩放 partySize（当前单人=1，4 人组队自动上调）
// 行为配置按 BOSS 名索引（均为简体中文，与 Zones.ts 节点一致），改名字/机制只动本文件。
// ═══════════════════════════════════════════════════════════════════

import type { EnemyData, EnemyType } from './BattleData';
import { createEnemyData } from './BattleData';
import { GameState } from './GameState';
import type { BattleScene } from '../scenes/BattleScene';

// ── 难度参数（集中可调；当前单人 partySize=1，4 人组队自动上调） ──
const BOSS_HP_MULT = 0.35;       // 每多 1 名队员，Boss 血量 +35%
const BOSS_DMG_MULT = 0.12;      // 每多 1 名队员，Boss 伤害 +12%

export type MechanicKind = 'regen' | 'summon' | 'buffSelf' | 'debuffPlayer' | 'shield' | 'phase';

export interface BossMechanic {
  kind: MechanicKind;
  threshold?: number;   // 触发血量比例(0~1)：regen/summon/phase 用
  pct?: number;         // 回复/护盾比例：regen/shield 用
  stat?: 'atk' | 'def' | 'matk' | 'mdef' | 'spd' | 'maxHp';
  value?: number;       // 强化数值 / phase 属性倍率增量
  every?: number;       // 触发回合间隔：buffSelf/debuffPlayer 用
  status?: string;      // 异常类型：debuffPlayer 用
  rate?: number;        // 异常命中率(0~1)
  turns?: number;       // 异常持续回合
  enemies?: string[];   // 召唤的敌人名：summon 用
  element?: string;     // 召唤/增援元素
  enrage?: boolean;     // phase 狂暴：攻速暴涨
  immune?: boolean;     // phase 异常免疫
}

export interface RetinueEntry {
  name: string;
  type: '杂妖' | '恶妖' | '妖将';
  element: string;
}

export interface ReinforcementConfig {
  maxWaves: number;   // 最多增援波数（封顶，防无限刷）
  perWave: number;    // 每波数量
  intervalMs: number; // 阵亡后延迟补波
  type: '杂妖' | '恶妖' | '妖将';
  element: string;
}

export interface BossConfig {
  name: string;
  zone: number;
  retinue?: RetinueEntry[];
  reinforcement?: ReinforcementConfig;
  mechanics: BossMechanic[];
}

// ── 21 个区域 Boss 配置（名字与 Zones.ts 节点一致，均为简体中文） ──
export const BOSS_CONFIG: Record<string, BossConfig> = {
  // 1 浦原商店街
  '葛兰德·费舍尔': {
    name: '葛兰德·费舍尔', zone: 1,
    retinue: [
      { name: '虚·触手', type: '恶妖', element: '无' },
      { name: '虚·牙', type: '恶妖', element: '无' },
      { name: '虚·影爪', type: '恶妖', element: '无' },
      { name: '虚·噬', type: '杂妖', element: '无' },
    ],
    reinforcement: { maxWaves: 2, perWave: 2, intervalMs: 1500, type: '恶妖', element: '无' },
    mechanics: [
      { kind: 'summon', threshold: 0.6, enemies: ['虚·触手'], element: '无' },
    ],
  },
  // 2 空座高校
  '酸蚀虚': {
    name: '酸蚀虚', zone: 2,
    retinue: [
      { name: '虚·酸', type: '恶妖', element: '火' },
      { name: '虚·蚀', type: '恶妖', element: '火' },
      { name: '虚·毒液', type: '杂妖', element: '火' },
      { name: '虚·腐蚀', type: '恶妖', element: '火' },
    ],
    reinforcement: { maxWaves: 2, perWave: 2, intervalMs: 1500, type: '恶妖', element: '火' },
    mechanics: [
      { kind: 'regen', threshold: 0.4, pct: 0.15 },
    ],
  },
  // 3 河川敷
  '梅塔史塔西亚': {
    name: '梅塔史塔西亚', zone: 3,
    retinue: [
      { name: '虚·寄生', type: '恶妖', element: '水' },
      { name: '虚·缠', type: '恶妖', element: '水' },
      { name: '虚·缚', type: '杂妖', element: '水' },
      { name: '虚·融', type: '恶妖', element: '水' },
    ],
    reinforcement: { maxWaves: 2, perWave: 2, intervalMs: 1500, type: '恶妖', element: '水' },
    mechanics: [
      { kind: 'debuffPlayer', every: 3, status: 'atkDown', rate: 0.6, turns: 2 },
    ],
  },
  // 4 润林安
  '萧隆·库方': {
    name: '萧隆·库方', zone: 4,
    retinue: [
      { name: '虚·刃', type: '恶妖', element: '风' },
      { name: '虚·风牙', type: '恶妖', element: '风' },
      { name: '虚·斩', type: '杂妖', element: '风' },
      { name: '虚·旋', type: '恶妖', element: '风' },
      { name: '虚·裂', type: '恶妖', element: '风' },
    ],
    reinforcement: { maxWaves: 2, perWave: 2, intervalMs: 1600, type: '恶妖', element: '风' },
    mechanics: [
      { kind: 'buffSelf', every: 3, stat: 'atk', value: 18 },
      { kind: 'summon', threshold: 0.5, enemies: ['虚·刃'], element: '风' },
    ],
  },
  // 5 戌吊
  '多尔多尼': {
    name: '多尔多尼', zone: 5,
    retinue: [
      { name: '虚·岩', type: '恶妖', element: '土' },
      { name: '虚·拳', type: '恶妖', element: '土' },
      { name: '虚·盾', type: '杂妖', element: '土' },
      { name: '虚·崩', type: '恶妖', element: '土' },
      { name: '虚·岳', type: '恶妖', element: '土' },
    ],
    reinforcement: { maxWaves: 2, perWave: 2, intervalMs: 1600, type: '恶妖', element: '土' },
    mechanics: [
      { kind: 'shield', pct: 0.30 },
    ],
  },
  // 6 草鹿
  '琪露诺': {
    name: '琪露诺', zone: 6,
    retinue: [
      { name: '虚·翼', type: '恶妖', element: '雷' },
      { name: '虚·雷羽', type: '恶妖', element: '雷' },
      { name: '虚·电', type: '杂妖', element: '雷' },
      { name: '虚·鸣', type: '恶妖', element: '雷' },
      { name: '虚·闪', type: '恶妖', element: '雷' },
    ],
    reinforcement: { maxWaves: 3, perWave: 2, intervalMs: 1700, type: '恶妖', element: '雷' },
    mechanics: [
      { kind: 'phase', threshold: 0.4, enrage: true },
    ],
  },
  // 7 一番队舍（原创）
  '虚·噬魂(原创)': {
    name: '虚·噬魂(原创)', zone: 7,
    retinue: [
      { name: '虚·怨', type: '恶妖', element: '无' },
      { name: '虚·魂', type: '恶妖', element: '无' },
      { name: '虚·噬', type: '恶妖', element: '无' },
      { name: '虚·煞', type: '杂妖', element: '无' },
      { name: '虚·魇', type: '恶妖', element: '无' },
    ],
    reinforcement: { maxWaves: 3, perWave: 2, intervalMs: 1700, type: '恶妖', element: '无' },
    mechanics: [
      { kind: 'summon', threshold: 0.5, enemies: ['虚·怨', '虚·魂'], element: '无' },
      { kind: 'regen', threshold: 0.3, pct: 0.15 },
    ],
  },
  // 8 技術開発局
  '涅茧利': {
    name: '涅茧利', zone: 8,
    retinue: [
      { name: '义骸卫士', type: '妖将', element: '毒' },
      { name: '毒蝶', type: '恶妖', element: '毒' },
      { name: '虚·蛊', type: '恶妖', element: '毒' },
      { name: '虚·毒针', type: '恶妖', element: '毒' },
      { name: '虚·腐毒', type: '杂妖', element: '毒' },
      { name: '虚·毒雾', type: '恶妖', element: '毒' },
    ],
    reinforcement: { maxWaves: 3, perWave: 2, intervalMs: 1700, type: '恶妖', element: '毒' },
    mechanics: [
      { kind: 'debuffPlayer', every: 2, status: 'poison', rate: 0.7, turns: 3 },
      { kind: 'summon', threshold: 0.5, enemies: ['毒蝶'], element: '毒' },
    ],
  },
  // 9 真央霊術院（原创）
  '虚·学鬼(原创)': {
    name: '虚·学鬼(原创)', zone: 9,
    retinue: [
      { name: '虚·书', type: '恶妖', element: '火' },
      { name: '虚·卷', type: '恶妖', element: '火' },
      { name: '虚·墨', type: '杂妖', element: '火' },
      { name: '虚·笔', type: '恶妖', element: '火' },
      { name: '虚·典', type: '恶妖', element: '火' },
      { name: '虚·文', type: '恶妖', element: '火' },
    ],
    reinforcement: { maxWaves: 3, perWave: 2, intervalMs: 1700, type: '恶妖', element: '火' },
    mechanics: [
      { kind: 'buffSelf', every: 2, stat: 'atk', value: 16 },
    ],
  },
  // 10 白砂原
  '葛力姆乔': {
    name: '葛力姆乔', zone: 10,
    retinue: [
      { name: '破面·从属', type: '妖将', element: '无' },
      { name: '虚·砂', type: '恶妖', element: '无' },
      { name: '虚·爪', type: '恶妖', element: '无' },
      { name: '虚·狂', type: '杂妖', element: '无' },
      { name: '虚·岚', type: '恶妖', element: '无' },
      { name: '虚·牙', type: '恶妖', element: '无' },
    ],
    reinforcement: { maxWaves: 3, perWave: 2, intervalMs: 1800, type: '恶妖', element: '无' },
    mechanics: [
      { kind: 'phase', threshold: 0.5, enrage: true, immune: true },
    ],
  },
  // 11 黒腔深部
  '乌尔奇奥拉': {
    name: '乌尔奇奥拉', zone: 11,
    retinue: [
      { name: '破面·从属', type: '妖将', element: '无' },
      { name: '虚·暗', type: '恶妖', element: '无' },
      { name: '虚·空', type: '恶妖', element: '无' },
      { name: '虚·寂', type: '杂妖', element: '无' },
      { name: '虚·渊', type: '恶妖', element: '无' },
      { name: '虚·灭', type: '恶妖', element: '无' },
    ],
    reinforcement: { maxWaves: 3, perWave: 2, intervalMs: 1800, type: '恶妖', element: '无' },
    mechanics: [
      { kind: 'regen', threshold: 0.3, pct: 0.20 },
      { kind: 'phase', threshold: 0.4, enrage: true },
    ],
  },
  // 12 虚夜宫
  '诺伊特拉': {
    name: '诺伊特拉', zone: 12,
    retinue: [
      { name: '破面·从属', type: '妖将', element: '无' },
      { name: '虚·枪', type: '恶妖', element: '无' },
      { name: '虚·镰', type: '恶妖', element: '无' },
      { name: '虚·棘', type: '杂妖', element: '无' },
      { name: '虚·锋', type: '恶妖', element: '无' },
      { name: '虚·刺', type: '恶妖', element: '无' },
    ],
    reinforcement: { maxWaves: 4, perWave: 2, intervalMs: 1800, type: '恶妖', element: '无' },
    mechanics: [
      { kind: 'buffSelf', every: 2, stat: 'atk', value: 22 },
      { kind: 'phase', threshold: 0.4, enrage: true },
    ],
  },
  // 13 戦迹
  '扎艾尔阿波罗': {
    name: '扎艾尔阿波罗', zone: 13,
    retinue: [
      { name: '破面·从属', type: '妖将', element: '毒' },
      { name: '虚·蛊', type: '恶妖', element: '毒' },
      { name: '虚·虫', type: '恶妖', element: '毒' },
      { name: '虚·卵', type: '杂妖', element: '毒' },
      { name: '虚·丝', type: '恶妖', element: '毒' },
      { name: '虚·囊', type: '恶妖', element: '毒' },
      { name: '虚·蛀', type: '恶妖', element: '毒' },
    ],
    reinforcement: { maxWaves: 4, perWave: 2, intervalMs: 1800, type: '恶妖', element: '毒' },
    mechanics: [
      { kind: 'debuffPlayer', every: 2, status: 'bind', rate: 0.7, turns: 2 },
      { kind: 'summon', threshold: 0.5, enemies: ['虚·蛊'], element: '毒' },
    ],
  },
  // 14 XCUTION基地
  '银城空吾': {
    name: '银城空吾', zone: 14,
    retinue: [
      { name: '完现术者', type: '妖将', element: '无' },
      { name: '虚·闇', type: '恶妖', element: '无' },
      { name: '虚·黑羽', type: '恶妖', element: '无' },
      { name: '虚·夺', type: '杂妖', element: '无' },
      { name: '虚·吞', type: '恶妖', element: '无' },
      { name: '虚·裂空', type: '恶妖', element: '无' },
      { name: '虚·影刃', type: '恶妖', element: '无' },
    ],
    reinforcement: { maxWaves: 3, perWave: 2, intervalMs: 1800, type: '恶妖', element: '无' },
    mechanics: [
      { kind: 'phase', threshold: 0.5, enrage: true },
      { kind: 'buffSelf', every: 3, stat: 'atk', value: 18 },
    ],
  },
  // 15 完現術総本山
  '月岛秀九郎': {
    name: '月岛秀九郎', zone: 15,
    retinue: [
      { name: '完现术者', type: '妖将', element: '无' },
      { name: '虚·书', type: '恶妖', element: '无' },
      { name: '虚·页', type: '恶妖', element: '无' },
      { name: '虚·墨', type: '杂妖', element: '无' },
      { name: '虚·痕', type: '恶妖', element: '无' },
      { name: '虚·割', type: '恶妖', element: '无' },
      { name: '虚·印', type: '恶妖', element: '无' },
    ],
    reinforcement: { maxWaves: 3, perWave: 2, intervalMs: 1800, type: '恶妖', element: '无' },
    mechanics: [
      { kind: 'debuffPlayer', every: 3, status: 'atkDown', rate: 0.7, turns: 3 },
      { kind: 'summon', threshold: 0.5, enemies: ['虚·书'], element: '无' },
    ],
  },
  // 16 影の領域
  '村正': {
    name: '村正', zone: 16,
    retinue: [
      { name: '刀魄', type: '妖将', element: '无' },
      { name: '虚·影', type: '恶妖', element: '无' },
      { name: '虚·刃魂', type: '恶妖', element: '无' },
      { name: '虚·剑', type: '杂妖', element: '无' },
      { name: '虚·锋', type: '恶妖', element: '无' },
      { name: '虚·断', type: '恶妖', element: '无' },
      { name: '虚·淬', type: '恶妖', element: '无' },
    ],
    reinforcement: { maxWaves: 4, perWave: 2, intervalMs: 1900, type: '恶妖', element: '无' },
    mechanics: [
      { kind: 'summon', threshold: 0.6, enemies: ['虚·影', '刀魄'], element: '无' },
      { kind: 'regen', threshold: 0.3, pct: 0.15 },
    ],
  },
  // 17 星十字宮
  '巴兹比': {
    name: '巴兹比', zone: 17,
    retinue: [
      { name: '圣兵', type: '妖将', element: '火' },
      { name: '虚·炎', type: '恶妖', element: '火' },
      { name: '虚·燃', type: '恶妖', element: '火' },
      { name: '虚·炽', type: '杂妖', element: '火' },
      { name: '虚·焰', type: '恶妖', element: '火' },
      { name: '虚·灼', type: '恶妖', element: '火' },
      { name: '虚·焚', type: '恶妖', element: '火' },
    ],
    reinforcement: { maxWaves: 4, perWave: 2, intervalMs: 1900, type: '恶妖', element: '火' },
    mechanics: [
      { kind: 'phase', threshold: 0.5, enrage: true, immune: true },
      { kind: 'buffSelf', every: 2, stat: 'atk', value: 24 },
    ],
  },
  // 18 銀架城
  '哈斯沃德': {
    name: '哈斯沃德', zone: 18,
    retinue: [
      { name: '圣兵', type: '妖将', element: '无' },
      { name: '虚·光', type: '恶妖', element: '无' },
      { name: '虚·辉', type: '恶妖', element: '无' },
      { name: '虚·镜灵', type: '杂妖', element: '无' },
      { name: '虚·衡', type: '恶妖', element: '无' },
      { name: '虚·裁', type: '恶妖', element: '无' },
      { name: '虚·圣', type: '恶妖', element: '无' },
    ],
    reinforcement: { maxWaves: 4, perWave: 2, intervalMs: 1900, type: '恶妖', element: '无' },
    mechanics: [
      { kind: 'shield', pct: 0.35 },
      { kind: 'debuffPlayer', every: 2, status: 'matkDown', rate: 0.7, turns: 3 },
    ],
  },
  // 19 咎人の門（剧场版）
  '黑刀': {
    name: '黑刀', zone: 19,
    retinue: [
      { name: '狱卒', type: '妖将', element: '无' },
      { name: '虚·狱', type: '恶妖', element: '无' },
      { name: '虚·锁', type: '恶妖', element: '无' },
      { name: '虚·刑', type: '杂妖', element: '无' },
      { name: '虚·刃', type: '恶妖', element: '无' },
      { name: '虚·枷', type: '恶妖', element: '无' },
      { name: '虚·罚', type: '恶妖', element: '无' },
    ],
    reinforcement: { maxWaves: 4, perWave: 2, intervalMs: 1900, type: '恶妖', element: '无' },
    mechanics: [
      { kind: 'phase', threshold: 0.5, enrage: true },
      { kind: 'summon', threshold: 0.4, enemies: ['虚·狱'], element: '无' },
    ],
  },
  // 20 無間（剧场版）
  '朱莲': {
    name: '朱莲', zone: 20,
    retinue: [
      { name: '炎鬼', type: '妖将', element: '火' },
      { name: '虚·焰', type: '恶妖', element: '火' },
      { name: '虚·火', type: '恶妖', element: '火' },
      { name: '虚·焚', type: '杂妖', element: '火' },
      { name: '虚·灼', type: '恶妖', element: '火' },
      { name: '虚·燎', type: '恶妖', element: '火' },
      { name: '虚·炽', type: '恶妖', element: '火' },
    ],
    reinforcement: { maxWaves: 4, perWave: 2, intervalMs: 1900, type: '恶妖', element: '火' },
    mechanics: [
      { kind: 'buffSelf', every: 2, stat: 'atk', value: 22 },
      { kind: 'debuffPlayer', every: 3, status: 'burn', rate: 0.7, turns: 3 },
    ],
  },
  // 21 終焉之淵（最终）
  '蓝染惣右介': {
    name: '蓝染惣右介', zone: 21,
    retinue: [
      { name: '虚圈使徒', type: '妖将', element: '无' },
      { name: '虚·镜', type: '恶妖', element: '无' },
      { name: '虚·幻', type: '恶妖', element: '无' },
      { name: '虚·惑', type: '杂妖', element: '无' },
      { name: '虚·镜影', type: '恶妖', element: '无' },
      { name: '虚·崩玉', type: '恶妖', element: '无' },
      { name: '虚·神', type: '恶妖', element: '无' },
    ],
    reinforcement: { maxWaves: 5, perWave: 2, intervalMs: 2000, type: '恶妖', element: '无' },
    mechanics: [
      { kind: 'regen', threshold: 0.4, pct: 0.20 },
      { kind: 'phase', threshold: 0.5, enrage: true, immune: true },
      { kind: 'summon', threshold: 0.4, enemies: ['虚·镜'], element: '无' },
    ],
  },
};

// ── 运行时状态（挂在 BattleScene 上，不进存档） ──
interface BossRuntime {
  config: BossConfig;
  shield: number;
  shieldMax: number;
  vulnerable: boolean;
  immune: boolean;
  regenUsed: boolean;
  summonUsed: Record<number, boolean>;
  turnCount: number;
  phaseUsed: boolean;
  wavesUsed: number;
}

export function getBossConfig(name: string): BossConfig | undefined {
  return BOSS_CONFIG[name];
}

/** 战斗开始：缩放难度、开护盾、放随从 */
export function setupBoss(scene: BattleScene, boss: EnemyData): void {
  const cfg = BOSS_CONFIG[boss.name];
  if (!cfg) { (scene as any)._bossRt = undefined; return; }

  const party = Math.max(1, (GameState as any).partySize || 1);
  const hpMult = 1 + BOSS_HP_MULT * (party - 1);
  const dmgMult = 1 + BOSS_DMG_MULT * (party - 1);
  boss.maxHp = Math.round(boss.maxHp * hpMult);
  boss.hp = boss.maxHp;
  boss.atk = Math.round(boss.atk * dmgMult);
  boss.matk = Math.round(boss.matk * dmgMult);

  const rt: BossRuntime = {
    config: cfg, shield: 0, shieldMax: 0, vulnerable: false, immune: false,
    regenUsed: false, summonUsed: {}, turnCount: 0, phaseUsed: false, wavesUsed: 0,
  };
  const shieldMech = cfg.mechanics.find(m => m.kind === 'shield');
  if (shieldMech?.pct) { rt.shield = Math.round(boss.maxHp * shieldMech.pct); rt.shieldMax = rt.shield; }

  (scene as any)._bossRt = rt;

  if (cfg.retinue) {
    cfg.retinue.forEach(r => scene.spawnAdd(createEnemyData(r.name, r.type as EnemyType, r.element, cfg.zone)));
  }
  scene.log(`【Boss】${boss.name} 降临！随从 ${cfg.retinue?.length || 0} 只`);
}

/** Boss 每次行动时触发机制；返回 true 表示占用本回合（已播放动画/延时） */
export function runBossMechanics(scene: BattleScene, enemy: EnemyData, index: number): boolean {
  const rt = (scene as any)._bossRt as BossRuntime | undefined;
  if (!rt || rt.config.name !== enemy.name) return false;
  rt.turnCount++;
  let consumed = false;

  rt.config.mechanics.forEach((m, mi) => {
    const ratio = enemy.hp / enemy.maxHp;

    if (m.kind === 'regen' && !rt.regenUsed && m.threshold && ratio <= m.threshold) {
      const heal = Math.round(enemy.maxHp * (m.pct || 0.2));
      enemy.hp = Math.min(enemy.maxHp, enemy.hp + heal);
      rt.regenUsed = true; consumed = true;
      scene.log(`⚠ ${enemy.name} 发动【再生】！回复 ${heal} HP`);
      scene.flashEnemy(index);
    }

    if (m.kind === 'summon' && !rt.summonUsed[mi] && m.threshold && ratio <= m.threshold && m.enemies) {
      m.enemies.forEach(nm => scene.spawnAdd(createEnemyData(nm, '恶妖', m.element || '无', rt.config.zone)));
      rt.summonUsed[mi] = true; consumed = true;
      scene.log(`⚠ ${enemy.name} 召唤了眷属！`);
    }

    if (m.kind === 'buffSelf' && m.every && m.stat && m.value !== undefined && rt.turnCount % m.every === 0) {
      (enemy as any)[m.stat] = ((enemy as any)[m.stat] || 0) + m.value;
      scene.log(`${enemy.name} 强化了自身 ${m.stat}！`);
    }

    if (m.kind === 'debuffPlayer' && m.every && m.status && rt.turnCount % m.every === 0) {
      scene.applyPlayerStatus(m.status, m.rate || 0.5, m.turns || 2);
      scene.log(`${enemy.name} 对你施加了【${m.status}】`);
    }

    if (m.kind === 'phase' && !rt.phaseUsed && m.threshold && ratio <= m.threshold) {
      rt.phaseUsed = true; consumed = true;
      if (m.enrage) { enemy.atk = Math.round(enemy.atk * 1.5); enemy.spd = Math.round(enemy.spd * 1.4); scene.log(`⚠ ${enemy.name} 进入【狂暴】！攻速暴涨`); }
      if (m.stat && m.value) { (enemy as any)[m.stat] = Math.round((enemy as any)[m.stat] * (1 + m.value)); }
      if (m.immune) { rt.immune = true; scene.log(`⚠ ${enemy.name} 获得【异常免疫】`); }
      scene.flashEnemy(index);
    }
  });

  return consumed;
}

/** 随从阵亡时触发死亡增援（参考飘流幻境） */
export function onBossAddDeath(scene: BattleScene): void {
  const rt = (scene as any)._bossRt as BossRuntime | undefined;
  if (!rt || !rt.config.reinforcement) return;
  const boss = scene.getBossEnemy();
  if (!boss || boss.hp <= 0) return;
  if (rt.wavesUsed >= rt.config.reinforcement.maxWaves) return;
  rt.wavesUsed++;
  const cfg = rt.config.reinforcement;
  scene.time.delayedCall(cfg.intervalMs, () => {
    const b = scene.getBossEnemy();
    if (!b || b.hp <= 0) return;
    for (let i = 0; i < cfg.perWave; i++) {
      scene.spawnAdd(createEnemyData(`${b.name}的增援`, cfg.type as EnemyType, cfg.element, rt.config.zone));
    }
    scene.log(`⚠ ${b.name} 的增援到来！(${rt.wavesUsed}/${cfg.maxWaves})`);
  });
}
