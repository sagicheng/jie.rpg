/**
 * 妖魔图鉴 — 具名敌人数据系统
 * 按区域落地，每个敌人有专属属性/弱点/抗性/技能/掉落
 * 设计参考：07-妖魔图鉴.md
 */

import { matId } from '../data/materials';
import { EnemyData, EnemyType, createEnemyData } from './BattleData';
import { ZONE1_ENEMIES, ZONE2_ENEMIES, ZONE3_ENEMIES, ZONE4_ENEMIES,
  ZONE5_ENEMIES, ZONE6_ENEMIES, ZONE7_ENEMIES, ZONE8_ENEMIES,
  ZONE9_ENEMIES, ZONE10_11_ENEMIES, ZONE12_13_ENEMIES,
  NAMED_EQUIPS, NAMED_MATERIALS, BESTIARY_TIERS } from '../data/bestiary';
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

  let reached = 0;
  for (const tier of BESTIARY_TIERS) {
    const allMet = allNames.every(name => (killedMap[name] || 0) >= tier.requiredKills);
    if (allMet) reached = tier.id;
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
export function generateNamedLoot(enemyName: string, enemyDrops: { item: string; rate: number; quality?: string }[]): Array<{
  id: string; name: string; type: string; desc: string; quantity: number;
  slot?: string; stats?: Record<string, number>; quality?: string;
}> {
  const loot: Array<any> = [];
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
