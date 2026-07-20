/**
 * 妖魔图鉴 — 具名敌人数据系统
 * 按区域落地，每个敌人有专属属性/弱点/抗性/技能/掉落
 * 设计参考：07-妖魔图鉴.md
 */

import { matId } from '../../data/materials';
import { Item } from '../items/Inventory';
import { EnemyData, EnemyType, createEnemyData } from '../combat/BattleData';
import { ZONE1_ENEMIES, ZONE2_ENEMIES, ZONE3_ENEMIES, ZONE4_ENEMIES,
  ZONE5_ENEMIES, ZONE6_ENEMIES, ZONE7_ENEMIES, ZONE8_ENEMIES,
  ZONE9_ENEMIES, ZONE10_11_ENEMIES, ZONE12_13_ENEMIES,
  NAMED_EQUIPS, NAMED_MATERIALS, BESTIARY_TIERS } from '../../data/bestiary';
export { BESTIARY_TIERS };

//  数据结构

/** 异常状态抗性表 (0~1, 1=免疫) */
export interface StatusResist {
  灼烧?: number; 冻结?: number; 中毒?: number; 寄生?: number;
  减速?: number; 眩晕?: number; 禁锢?: number; 嘲讽?: number;
  恐惧?: number; 攻降?: number; 防降?: number; 降灵压?: number;
}

/** 具名敌人定义 */
export interface NamedEnemyDef {
  /** 敌人名称（唯一键） */
  name: string;
  /** 类型 */
  type: EnemyType;
  /** 元素属性 */
  element: string;
  /** 弱点元素（被克制，受击×1.5） */
  weakness?: string;
  /** 抗性元素（受击×0.5） */
  resist?: string;
  /** 异常状态抗性 */
  statusResist: StatusResist;
  /** 专属技能（覆盖默认模板技能） */
  skills?: { name: string; power: number; desc: string; damageType: 'physical' | 'magical'; statusEffect?: { subtype: string; rate: number; turns: number } }[];
  /** 专属掉落（覆盖默认模板掉落） */
  drops?: { item: string; rate: number; quality?: 'white' | 'green' | 'blue' | 'purple' | 'gold' }[];
  /** 先遣队笔记/背景描述 */
  lore?: string;
  /** 属性倍率修正（可选，覆盖默认type倍率） */
  statMult?: Partial<Record<'HP' | 'ATK' | 'DEF' | 'MATK' | 'MDEF' | 'SPD', number>>;
  /** 经验/金币奖励倍率修正 */
  rewardMult?: { exp?: number; gold?: number };
}

//  注册表

/** 所有具名敌人注册表（按名称索引） */
export const NAMED_ENEMIES: Record<string, NamedEnemyDef> = {};

function register(zoneEnemies: NamedEnemyDef[]): void {
  for (const e of zoneEnemies) {
    NAMED_ENEMIES[e.name] = e;
  }
}

register(ZONE1_ENEMIES);
register(ZONE2_ENEMIES);
register(ZONE3_ENEMIES);
register(ZONE4_ENEMIES);
register(ZONE5_ENEMIES);
register(ZONE6_ENEMIES);
register(ZONE7_ENEMIES);
register(ZONE8_ENEMIES);
register(ZONE9_ENEMIES);
register(ZONE10_11_ENEMIES);
register(ZONE12_13_ENEMIES);

//  图鉴层级系统

/** 图鉴层级定义 */
export interface BestiaryTier {
  id: number;
  name: string;
  requiredKills: number;  // 每种敌人需要击杀的次数
  color: string;
  reward: {
    statPoints?: number;
    gold?: number;
    exp?: number;
    desc: string;
  };
}

/** 图鉴层级表（从低到高） */

/**
 * 获取当前图鉴最高已达成层级（所有敌人都达到requiredKills）
 * @returns 层级id，0表示未达成任何层级
 */
export function getBestiaryTierReached(killedMap: Record<string, number>): number {
  const allNames = Object.keys(NAMED_ENEMIES);
  if (allNames.length === 0) return 0;

  // 各层级达成所需「击杀达标种类占比」阈值（击杀次数 ≥ 该层 requiredKills 的种类数 / 总种类数）
  // 旧逻辑要求『全部种类都达成』，门槛过高（后期区域 Boss 前期遇不到，Tier1 永远卡 0，领奖按钮全灰）。
  // 改为按比例达成：前期击杀约 15% 种类即可领初级奖励，逐步递进至全收集。
  const RATIO: Record<number, number> = { 1: 0.15, 2: 0.4, 3: 0.7, 4: 1.0 };

  let reached = 0;
  for (const tier of BESTIARY_TIERS) {
    const metCount = allNames.filter(name => (killedMap[name] || 0) >= tier.requiredKills).length;
    const ratio = metCount / allNames.length;
    const need = RATIO[tier.id] ?? 1.0;
    if (ratio >= need) reached = tier.id;
    else break;
  }
  return reached;
}

/**
 * 获取指定层级的进度信息
 * @returns { completed, total, minKills, maxKills }
 */
export function getBestiaryTierProgress(tierId: number, killedMap: Record<string, number>): {
  completed: number; total: number; minKills: number; maxKills: number;
} {
  const tier = BESTIARY_TIERS.find(t => t.id === tierId);
  if (!tier) return { completed: 0, total: 0, minKills: 0, maxKills: 0 };

  const allNames = Object.keys(NAMED_ENEMIES);
  let completed = 0;
  let minKills = Infinity;
  let maxKills = 0;

  for (const name of allNames) {
    const kills = killedMap[name] || 0;
    if (kills >= tier.requiredKills) completed++;
    minKills = Math.min(minKills, kills);
    maxKills = Math.max(maxKills, kills);
  }

  return {
    completed,
    total: allNames.length,
    minKills: minKills === Infinity ? 0 : minKills,
    maxKills,
  };
}

//  查询接口

/** 元素克制倍率 */
export function getElementMultiplier(attackElement: string, targetElement: string, weakness?: string, resist?: string): number {
  if (weakness && attackElement === weakness) return 1.5;
  if (resist && attackElement === resist) return 0.5;
  if (attackElement === targetElement && attackElement !== '无') return 0.75; // 同属性衰减
  return 1.0;
}

/** 获取异常状态命中率（0~1） */
export function getStatusHitRate(statusName: string, enemyName: string): number {
  const def = NAMED_ENEMIES[enemyName];
  if (!def) return 1.0;
  const resist = def.statusResist[statusName as keyof StatusResist];
  return resist !== undefined ? (1 - resist) : 1.0;
}

/**
 * 生成具名敌人战斗数据
 * 优先匹配NAMED_ENEMIES，无则fallback到createEnemyData
 */
export function getEnemyData(name: string, type: EnemyType, element: string, zone: number): EnemyData {
  const named = NAMED_ENEMIES[name];

  if (!named) {
    return createEnemyData(name, type, element, zone);
  }

  // 用具名数据生成
  const base = createEnemyData(name, named.type, named.element, zone);

  // 应用属性倍率修正
  if (named.statMult) {
    const sm = named.statMult;
    if (sm.HP) { base.hp = Math.round(base.hp * sm.HP); base.maxHp = base.hp; }
    if (sm.ATK) base.atk = Math.round(base.atk * sm.ATK);
    if (sm.DEF) base.def = Math.round(base.def * sm.DEF);
    if (sm.MATK) base.matk = Math.round(base.matk * sm.MATK);
    if (sm.MDEF) base.mdef = Math.round(base.mdef * sm.MDEF);
    if (sm.SPD) base.spd = Math.round(base.spd * sm.SPD);
  }

  // 应用专属技能
  if (named.skills) base.skills = named.skills;

  // 应用专属掉落
  if (named.drops) base.drops = named.drops.map(d => ({ item: d.item, rate: d.rate }));

  // 应用奖励倍率
  if (named.rewardMult) {
    if (named.rewardMult.exp) base.expReward = Math.round(base.expReward * named.rewardMult.exp);
    if (named.rewardMult.gold) base.goldReward = Math.round(base.goldReward * named.rewardMult.gold);
  }

  return base;
}

/** 获取敌人图鉴信息（笔记等） */
export function getEnemyLore(name: string): string | undefined {
  return NAMED_ENEMIES[name]?.lore;
}

/** 获取敌人弱点/抗性信息 */
export function getEnemyElementInfo(name: string): { weakness?: string; resist?: string; element: string } {
  const def = NAMED_ENEMIES[name];
  return {
    element: def?.element ?? '无',
    weakness: def?.weakness,
    resist: def?.resist,
  };
}

//  专属掉落物品定义

/** 专属装备掉落定义 */
export interface NamedEquipDrop {
  name: string;
  slot: 'head' | 'body' | 'bracer' | 'boots' | 'belt' | 'ring' | 'necklace' | 'charm' | 'pendant';
  quality: 'white' | 'green' | 'blue' | 'purple' | 'gold';
  stats: Partial<Record<string, number>>;
  desc: string;
}

/** 专属装备注册表（按名字索引） */

/** 专属材料注册表 */

/**
 * 生成具名敌人的专属掉落
 * 返回null表示该敌人无专属掉落定义，应fallback到generateLoot
 */
export function generateNamedLoot(_enemyName: string, enemyDrops: { item: string; rate: number; quality?: string }[]): Item[] {
  const loot: Item[] = [];
  for (const drop of enemyDrops) {
    if (Math.random() >= drop.rate) continue;

    const equipDef = NAMED_EQUIPS[drop.item];
    if (equipDef) {
      // 装备掉落
      loot.push({
        id: `neq_${equipDef.name}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: equipDef.name,
        type: 'equipment',
        desc: equipDef.desc,
        quantity: 1,
        slot: equipDef.slot,
        stats: { ...equipDef.stats },
        quality: equipDef.quality,
      });
      continue;
    }

    const matDef = NAMED_MATERIALS[drop.item];
    if (matDef) {
      loot.push({
        id: matId(drop.item),
        name: drop.item,
        type: 'material',
        desc: matDef.desc,
        quantity: 1,
      });
      continue;
    }

    // 未注册的物品：作为普通材料处理
    loot.push({
      id: `mat_${drop.item}`,
      name: drop.item,
      type: 'material',
      desc: '材料',
      quantity: 1,
    });
  }
  return loot;
}

//  称号系统（07-妖魔图鉴 §7.3，待实现 → 已实现）

/** 称号定义 */
export interface TitleDef {
  /** 唯一id */
  id: string;
  /** 称号名 */
  name: string;
  /** 解锁条件描述（UI展示） */
  conditionDesc: string;
  /** 效果描述（UI展示） */
  effectDesc: string;
  /** 收集种类数要求（= 已遭遇妖魔种类数） */
  requiredCollected: number;
  /** 额外要求：击败全部妖将 */
  requireAllGenerals?: boolean;
  /** 额外要求：全收集（击败全部具名妖魔） */
  requireFull?: boolean;
  /** 对特定敌人类型伤害加成（乘算） */
  enemyTypeDamage?: { type: EnemyType; mult: number };
  /** 全属性加成（百分比，0.05 = +5%） */
  allStatsPct?: number;
  /** 仅能由特定途径（如行会商店）手动解锁，不随图鉴收集自动解锁 */
  manualOnly?: boolean;
}

/** 称号表（按解锁难度从低到高） */
export const BESTIARY_TITLES: TitleDef[] = [
  { id: 'recruit',        name: '新兵',         conditionDesc: '收集 5 种妖魔',            effectDesc: '无特殊效果',               requiredCollected: 5 },
  { id: 'hunter',         name: '猎妖人',       conditionDesc: '收集 15 种妖魔',           effectDesc: '对杂妖伤害 +5%',           requiredCollected: 15, enemyTypeDamage: { type: '杂妖', mult: 1.05 } },
  { id: 'general_slayer', name: '妖将杀手',     conditionDesc: '收集 25 种 + 击败全部妖将', effectDesc: '对妖将伤害 +10%',          requiredCollected: 25, requireAllGenerals: true, enemyTypeDamage: { type: '妖将', mult: 1.10 } },
  { id: 'abyss_walker',   name: '深渊行者',     conditionDesc: '收集 35 种妖魔',           effectDesc: '对妖王伤害 +10%',          requiredCollected: 35, enemyTypeDamage: { type: '妖王', mult: 1.10 } },
  { id: 'awakened',       name: '斩魄刀觉醒者', conditionDesc: '全收集（击败全部妖魔）',    effectDesc: '全属性 +5%',              requiredCollected: 0, requireFull: true, allStatsPct: 0.05 },
  // 行会商店专属称号（manualOnly：仅公会商店兑换解锁，不随图鉴自动解锁）
  { id: 'guild_tongxin',  name: '同心',         conditionDesc: '公会商店兑换',              effectDesc: '全属性 +3%',              requiredCollected: 0, manualOnly: true, allStatsPct: 0.03 },
  { id: 'guild_tongpao',  name: '同袍',         conditionDesc: '公会商店兑换（进阶）',      effectDesc: '全属性 +5%',              requiredCollected: 0, manualOnly: true, allStatsPct: 0.05 },
];
