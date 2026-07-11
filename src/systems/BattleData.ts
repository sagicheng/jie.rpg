import { matId } from '../data/materials';
import { QUALITY_MULT } from '../constants';
import { ZONE_PL } from '../config';
import { Item, EquipSlot } from './Inventory';

/** 敌人类型 */
export type EnemyType = '杂妖' | '恶妖' | '妖将' | '妖王';

/** 品质 */
export type Quality = 'white' | 'green' | 'blue' | 'purple' | 'gold';

/** 敌人属性倍率（乘以区域PL） */
const ENEMY_STAT_MULT: Record<EnemyType, { HP: number; ATK: number; DEF: number; MATK: number; MDEF: number; SPD: number; statusRes: number }> = {
  杂妖: { HP: 5, ATK: 0.8, DEF: 0.3, MATK: 0.5, MDEF: 0.2, SPD: 0.4, statusRes: 0.00 },
  恶妖: { HP: 10, ATK: 1.2, DEF: 0.5, MATK: 0.8, MDEF: 0.4, SPD: 0.6, statusRes: 0.05 },
  妖将: { HP: 25, ATK: 1.8, DEF: 0.8, MATK: 1.2, MDEF: 0.7, SPD: 0.7, statusRes: 0.15 },
  妖王: { HP: 60, ATK: 3.0, DEF: 1.2, MATK: 1.8, MDEF: 1.0, SPD: 0.9, statusRes: 0.30 },
};

/** 品质倍率 */

export interface EnemyData {
  name: string;
  type: EnemyType;
  element: string;
  zone: number;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  matk: number;
  mdef: number;
  spd: number;
  statusRes: number;
  skills: { name: string; power: number; desc: string; damageType: 'physical' | 'magical'; statusEffect?: { subtype: string; rate: number; turns: number } }[];
  expReward: number;
  goldReward: number;
  drops: { item: string; rate: number }[];
}

/** 小怪微调难度（仅杂妖/恶妖，Boss 不受影响） */
const NORMAL_DIFF = 1.12;

/** 按区域PL生成敌人数据 */
export function createEnemyData(name: string, type: EnemyType, element: string, zone: number): EnemyData {
  const pl = ZONE_PL[zone] || 10;
  const m = ENEMY_STAT_MULT[type];
  const nm = (type === '杂妖' || type === '恶妖') ? NORMAL_DIFF : 1;

  const expRates: Record<EnemyType, number> = { 杂妖: 1, 恶妖: 3, 妖将: 10, 妖王: 30 };
  const goldRates: Record<EnemyType, number> = { 杂妖: 1, 恶妖: 2, 妖将: 8, 妖王: 20 };

  return {
    name, type, element, zone,
    hp: Math.round(pl * m.HP * nm),
    maxHp: Math.round(pl * m.HP * nm),
    atk: Math.round(pl * m.ATK * nm),
    def: Math.round(pl * m.DEF),
    matk: Math.round(pl * m.MATK),
    mdef: Math.round(pl * m.MDEF),
    spd: Math.round(pl * m.SPD),
    statusRes: m.statusRes,
    skills: type === '杂妖' ? [{ name: '撞击', power: 1.0, desc: '普通攻击', damageType: 'physical' }]
           : type === '恶妖' ? [
               { name: '猛击', power: 1.3, desc: '强力一击', damageType: 'physical' },
               { name: '妖气弹', power: 1.1, desc: '魔力弹攻击·带毒', damageType: 'magical', statusEffect: { subtype: 'poison', rate: 0.25, turns: 3 } },
             ]
           : type === '妖将' ? [
               { name: '绝杀', power: 2.0, desc: '致命一击·降攻', damageType: 'physical', statusEffect: { subtype: 'atkDown', rate: 0.30, turns: 3 } },
               { name: '威压', power: 1.5, desc: '全体魔力攻击·震慑', damageType: 'magical', statusEffect: { subtype: 'fear', rate: 0.35, turns: 2 } },
             ]
           : [ // 妖王
               { name: '绝杀', power: 2.0, desc: '致命一击·震慑', damageType: 'physical', statusEffect: { subtype: 'stun', rate: 0.25, turns: 1 } },
               { name: '威压', power: 1.5, desc: '灵压威压·降灵压', damageType: 'magical', statusEffect: { subtype: 'matkDown', rate: 0.40, turns: 3 } },
             ],
    expReward: Math.round(pl * 3 * expRates[type]),
    goldReward: Math.round(pl * 2 * goldRates[type]),
    drops: type === '杂妖' ? [{ item: '铁矿石', rate: 0.3 }, { item: '止血草', rate: 0.2 }]
         : type === '恶妖' ? [{ item: '银矿石', rate: 0.3 }, { item: '硬皮', rate: 0.25 }]
         : [{ item: '妖将核心', rate: 0.5 }, { item: '灵晶碎片', rate: 0.3 }],
  };
}

/** 装备掉落槽位池 */
const EQUIP_SLOTS: Array<{ slot: string; label: string }> = [
  { slot: 'head', label: '头盔' }, { slot: 'body', label: '铠甲' }, { slot: 'bracer', label: '护腕' },
  { slot: 'boots', label: '靴子' }, { slot: 'belt', label: '腰带' },
  { slot: 'ring', label: '戒指' }, { slot: 'necklace', label: '项链' },
  { slot: 'charm', label: '护符' }, { slot: 'pendant', label: '挂饰' },
];

/** 各区装备名称前缀 */
const ZONE_EQUIP_NAMES: Record<number, { prefix: string; baseDef: number; baseAtk: number }> = {
  1: { prefix: '布', baseDef: 6, baseAtk: 4 },
  2: { prefix: '硬皮', baseDef: 12, baseAtk: 8 },
  3: { prefix: '铜', baseDef: 20, baseAtk: 14 },
  4: { prefix: '镶钉', baseDef: 28, baseAtk: 20 },
  5: { prefix: '鳞甲', baseDef: 36, baseAtk: 26 },
  6: { prefix: '炎骨', baseDef: 48, baseAtk: 36 },
  7: { prefix: '深渊', baseDef: 60, baseAtk: 46 },
};

/** 根据区域和品质随机生成一件装备 */
export function generateEquipmentDrop(zone: number, quality: Quality): Item | null {
  const z = ZONE_EQUIP_NAMES[zone] || ZONE_EQUIP_NAMES[1];
  const eq = EQUIP_SLOTS[Math.floor(Math.random() * EQUIP_SLOTS.length)];
  const mult = QUALITY_MULT[quality];

  // 根据槽位计算属性
  const isWeapon = ['bracer'].includes(eq.slot); // 护腕≈武器位
  const isArmor = ['head', 'body'].includes(eq.slot);
  const isAccessory = ['ring', 'necklace', 'charm', 'pendant'].includes(eq.slot);

  const stats: Record<string, number> = {};
  if (isArmor) {
    stats.def = Math.round(z.baseDef * mult);
    if (eq.slot === 'body') stats.mdef = Math.round(z.baseDef * 0.3 * mult);
    if (eq.slot === 'head') stats.hp = Math.round(z.baseDef * 0.3 * mult);
  } else if (isWeapon) {
    stats.atk = Math.round(z.baseAtk * mult);
    stats.spd = Math.round(z.baseAtk * 0.3 * mult);
  } else if (isAccessory) {
    if (eq.slot === 'ring') stats.matk = Math.round(z.baseAtk * mult);
    else if (eq.slot === 'necklace') { stats.hp = Math.round(z.baseAtk * 0.4 * mult); stats.mp = Math.round(z.baseAtk * 0.3 * mult); }
    else if (eq.slot === 'charm') stats.mdef = Math.round(z.baseAtk * mult);
    else if (eq.slot === 'pendant') stats.spd = Math.round(z.baseAtk * 0.7 * mult);
  } else {
    // belt
    stats.hp = Math.round(z.baseDef * 0.4 * mult);
    stats.mp = Math.round(z.baseDef * 0.2 * mult);
  }

  const qualityCN: Record<Quality, string> = { white: '白', green: '绿', blue: '蓝', purple: '紫', gold: '金' };
  const name = `${z.prefix}${eq.label}`;

  return {
    id: `drop_${zone}_${eq.slot}_${quality}_${Date.now()}`,
    name,
    type: 'equipment',
    desc: `${qualityCN[quality]}·${eq.label}`,
    quantity: 1,
    slot: eq.slot as EquipSlot,
    stats,
    quality,
  };
}

/** 按敌人类型决定掉落品质 */
function rollQuality(type: EnemyType): Quality | null {
  const rates: Record<EnemyType, Record<Quality, number>> = {
    杂妖: { white: 0.08, green: 0, blue: 0, purple: 0, gold: 0 },
    恶妖: { white: 0.09, green: 0.05, blue: 0.02, purple: 0, gold: 0 },
    妖将: { white: 0, green: 0.12, blue: 0.08, purple: 0.03, gold: 0 },
    妖王: { white: 0, green: 0, blue: 0.15, purple: 0.08, gold: 0.03 },
  };
  const r = Math.random();
  let cumulative = 0;
  const qualities: Quality[] = ['white', 'green', 'blue', 'purple', 'gold'];
  for (const q of qualities) {
    cumulative += rates[type][q];
    if (r < cumulative) return q;
  }
  return null;
}

/** 生成敌人战利品 */
export function generateLoot(type: EnemyType, zone: number): Item[] {
  const loot: Item[] = [];

  // 装备掉落
  const quality = rollQuality(type);
  if (quality) {
    const eq = generateEquipmentDrop(zone, quality);
    if (eq) loot.push(eq);
  }

  // 材料掉落（旧逻辑保留）
  const matRates: Record<EnemyType, Array<{ name: string; rate: number }>> = {
    杂妖: [{ name: '铁矿石', rate: 0.12 }, { name: '止血草', rate: 0.08 }],
    恶妖: [{ name: '银矿石', rate: 0.12 }, { name: '硬皮', rate: 0.09 }],
    妖将: [{ name: '妖将核心', rate: 0.18 }, { name: '灵晶碎片', rate: 0.12 }],
    妖王: [{ name: '妖王精华', rate: 0.22 }, { name: '传说材料碎片', rate: 0.15 }],
  };

  for (const mat of matRates[type]) {
    if (Math.random() < mat.rate) {
      loot.push({
        id: matId(mat.name), name: mat.name, type: 'material',
        desc: '制造材料', quantity: 1,
      });
    }
  }

  return loot;
}

/** 副本某阶通关奖励（gold/exp/loot），按区域PL与阶数缩放。stage: 1=小怪 2=精英 3=BOSS。 */
export function dungeonStageReward(dungeonId: number, stage: number): { gold: number; exp: number; loot: Item[] } {
  const pl = ZONE_PL[dungeonId] || 10;
  const goldMul = [0, 8, 16, 40][stage] ?? 20;
  const expMul = [0, 12, 24, 60][stage] ?? 30;
  const gold = Math.round(pl * goldMul);
  const exp = Math.round(pl * expMul);
  // 掉落品质随阶提升（stage3=BOSS 用妖王品质）
  const type: EnemyType = stage >= 3 ? '妖王' : stage === 2 ? '妖将' : '恶妖';
  const loot = generateLoot(type, dungeonId);
  if (loot.length === 0) {
    loot.push({ id: matId('铁矿石'), name: '铁矿石', type: 'material', desc: '副本材料', quantity: 1 } as Item);
  }
  return { gold, exp, loot };
}

/** 伤害计算（04文档公式） */
export function calcDamage(atk: number, def: number, power: number, elementBonus = 1.0): { damage: number; crit: boolean } {
  let damage = atk * power - def * 0.4;
  if (damage < atk * power * 0.1) damage = atk * power * 0.1;
  damage *= elementBonus;

  // 暴击判定
  const critRate = 0.05;
  const crit = Math.random() < critRate;
  if (crit) damage *= 1.5;

  // 随机浮动 ±10%
  damage *= 0.9 + Math.random() * 0.2;
  return { damage: Math.round(damage), crit };
}

/** 鬼道伤害计算 */
export function calcMagicDamage(matk: number, mdef: number, power: number): { damage: number; crit: boolean } {
  let damage = matk * power - mdef * 0.3;
  if (damage < matk * power * 0.1) damage = matk * power * 0.1;
  const crit = Math.random() < 0.05;
  if (crit) damage *= 1.5;
  damage *= 0.9 + Math.random() * 0.2;
  return { damage: Math.round(damage), crit };
}

/** 经验曲线（1→70） */
export function expForLevel(lv: number): number {
  if (lv <= 10) return 100 + (lv - 1) * 50;
  if (lv <= 20) return 550 + (lv - 11) * 80;
  if (lv <= 30) return 1350 + (lv - 21) * 120;
  if (lv <= 40) return 2550 + (lv - 31) * 180;
  if (lv <= 50) return 4350 + (lv - 41) * 260;
  if (lv <= 60) return 6950 + (lv - 51) * 380;
  return 10750 + (lv - 61) * 550;
}
