/**
 * 装备强化 / 属性精炼 / 装备分解 系统
 * DNF式精炼三件套
 */
import { Item, EquipSlot, Inventory } from './Inventory';
import { GameState } from './GameState';

// ═══════════════════════════════════════════
// 品质常量
// ═══════════════════════════════════════════

const QUALITY_MULT: Record<string, number> = { white: 1.0, green: 1.3, blue: 1.6, purple: 2.0, gold: 2.5 };
const QUALITY_CN: Record<string, string> = { white: '白', green: '绿', blue: '蓝', purple: '紫', gold: '金' };
const QUALITY_COLOR: Record<string, string> = { white: '#cccccc', green: '#44cc44', blue: '#4488ff', purple: '#cc44cc', gold: '#ffaa00' };

// ═══════════════════════════════════════════
// 强化系统 (Enhancement +1 ~ +10)
// ═══════════════════════════════════════════

/** 强化成功率表 (+0→+1 ~ +9→+10) */
const ENHANCE_RATES: number[] = [
  1.00, // +0→+1
  1.00, // +1→+2
  1.00, // +2→+3
  1.00, // +3→+4
  1.00, // +4→+5
  0.85, // +5→+6
  0.70, // +6→+7
  0.55, // +7→+8
  0.42, // +8→+9
  0.30, // +9→+10
];

/** 获取强化成功率 */
export function getEnhanceRate(currentLevel: number): number {
  if (currentLevel < 0 || currentLevel >= 10) return 0;
  return ENHANCE_RATES[currentLevel];
}

/** 获取强化消耗（金币 + 灵晶碎片） */
export function getEnhanceCost(currentLevel: number, quality: string): { gold: number; crystals: number } {
  const qMult = QUALITY_MULT[quality] || 1.0;
  const base = 200 + currentLevel * 150;
  return {
    gold: Math.round(base * qMult),
    crystals: 1 + Math.floor(currentLevel / 3),
  };
}

/** 获取强化属性倍率 — 每级+5% */
export function getEnhanceMult(item: Item): number {
  const lv = item.enhanceLevel || 0;
  return 1 + lv * 0.05;
}

/** 强化结果 */
export interface EnhanceResult {
  success: boolean;
  destroyed: boolean;
  newLevel: number;
  message: string;
}

/** 执行强化 */
export function doEnhance(item: Item): EnhanceResult {
  const currentLevel = item.enhanceLevel || 0;
  if (currentLevel >= 10) {
    return { success: false, destroyed: false, newLevel: currentLevel, message: '已达强化上限 +10' };
  }

  const cost = getEnhanceCost(currentLevel, item.quality || 'white');
  if (GameState.gold < cost.gold) {
    return { success: false, destroyed: false, newLevel: currentLevel, message: '金币不足' };
  }

  // 检查灵晶碎片
  const crystals = Inventory.items.find(i => i.id === 'mat_灵晶碎片' || i.name === '灵晶碎片');
  const crystalCount = crystals ? crystals.quantity : 0;
  if (crystalCount < cost.crystals) {
    return { success: false, destroyed: false, newLevel: currentLevel, message: `灵晶碎片不足 (需要${cost.crystals})` };
  }

  // 扣除消耗
  GameState.gold -= cost.gold;
  if (crystals) {
    crystals.quantity -= cost.crystals;
    if (crystals.quantity <= 0) {
      Inventory.items = Inventory.items.filter(i => i !== crystals);
    }
  }

  // 判定
  const rate = ENHANCE_RATES[currentLevel];
  const roll = Math.random();

  if (roll < rate) {
    // 成功
    item.enhanceLevel = currentLevel + 1;
    return {
      success: true,
      destroyed: false,
      newLevel: currentLevel + 1,
      message: `强化成功！+${currentLevel + 1}`,
    };
  }

  // 失败惩罚
  if (currentLevel === 9) {
    // +9→+10 失败 → 碎裂
    return {
      success: false,
      destroyed: true,
      newLevel: 0,
      message: `强化失败！装备碎裂...`,
    };
  } else if (currentLevel === 8) {
    // +8→+9 失败 → 降2级
    item.enhanceLevel = currentLevel - 2;
    return {
      success: false,
      destroyed: false,
      newLevel: currentLevel - 2,
      message: `强化失败！等级降至 +${currentLevel - 2}`,
    };
  } else if (currentLevel === 7) {
    // +7→+8 失败 → 降1级
    item.enhanceLevel = currentLevel - 1;
    return {
      success: false,
      destroyed: false,
      newLevel: currentLevel - 1,
      message: `强化失败！等级降至 +${currentLevel - 1}`,
    };
  } else {
    // +1~+7 失败 → 不变
    return {
      success: false,
      destroyed: false,
      newLevel: currentLevel,
      message: '强化失败！等级不变',
    };
  }
}

// ═══════════════════════════════════════════
// 属性精炼系统 (Refinement)
// ═══════════════════════════════════════════

/** 品质对应精炼词条数上限 */
const REFINE_SLOTS: Record<string, number> = {
  white: 1, green: 1, blue: 2, purple: 2, gold: 3,
};

/** 精炼可出现的属性池 */
const REFINE_STAT_POOL: Array<{ key: string; name: string; weight: number }> = [
  { key: 'atk', name: '攻击', weight: 20 },
  { key: 'def', name: '防御', weight: 20 },
  { key: 'matk', name: '魔攻', weight: 20 },
  { key: 'mdef', name: '魔防', weight: 20 },
  { key: 'hp', name: '生命', weight: 15 },
  { key: 'mp', name: '灵力', weight: 15 },
  { key: 'spd', name: '速度', weight: 10 },
];

/** 获取精炼词条数上限 */
export function getRefineMaxSlots(quality: string): number {
  return REFINE_SLOTS[quality] || 1;
}

/** 获取精炼消耗 */
export function getRefineCost(item: Item): { gold: number; materials: Record<string, number> } {
  const q = item.quality || 'white';
  const qMult = QUALITY_MULT[q] || 1.0;
  const slot = (item.refineStats?.length || 0) + 1;

  const materialMap: Record<string, string> = {
    white: '铁矿石', green: '铁矿石', blue: '银矿石', purple: '妖将核心', gold: '传说材料碎片',
  };
  const mat = materialMap[q] || '铁矿石';
  const matQty = Math.round(slot * 2 * qMult);

  return {
    gold: Math.round((150 + slot * 100) * qMult),
    materials: { [mat]: matQty },
  };
}

/** 随机一个精炼词条 */
function rollRefineStat(quality: string): { key: string; value: number } {
  const qMult = QUALITY_MULT[quality] || 1.0;
  const totalWeight = REFINE_STAT_POOL.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * totalWeight;
  let picked = REFINE_STAT_POOL[0];
  for (const entry of REFINE_STAT_POOL) {
    r -= entry.weight;
    if (r <= 0) { picked = entry; break; }
  }

  // 数值：基础 2~6 点，乘品质倍率
  const base = 2 + Math.floor(Math.random() * 5);
  const value = Math.max(1, Math.round(base * qMult * 0.8));
  return { key: picked.key, value };
}

/** 精炼结果 */
export interface RefineResult {
  success: boolean;
  message: string;
  newStat?: { key: string; value: number };
}

/** 执行精炼（新增一条词条） */
export function doRefine(item: Item): RefineResult {
  const quality = item.quality || 'white';
  const maxSlots = getRefineMaxSlots(quality);
  const currentSlots = item.refineStats?.length || 0;

  if (currentSlots >= maxSlots) {
    return { success: false, message: `词条已满 (${maxSlots}条)` };
  }

  const cost = getRefineCost(item);
  if (GameState.gold < cost.gold) {
    return { success: false, message: '金币不足' };
  }

  // 检查材料
  for (const [matName, qty] of Object.entries(cost.materials)) {
    const has = Inventory.items.filter(i => i.name === matName).reduce((s, i) => s + i.quantity, 0);
    if (has < qty) {
      return { success: false, message: `${matName}不足 (${has}/${qty})` };
    }
  }

  // 扣除
  GameState.gold -= cost.gold;
  for (const [matName, qty] of Object.entries(cost.materials)) {
    let remaining = qty;
    for (const it of Inventory.items) {
      if (it.name === matName && remaining > 0) {
        const take = Math.min(it.quantity, remaining);
        it.quantity -= take;
        remaining -= take;
      }
    }
  }
  // 清理空材料
  Inventory.items = Inventory.items.filter(i => i.quantity > 0 || i.type !== 'material');

  // 随机词条
  const stat = rollRefineStat(quality);
  if (!item.refineStats) item.refineStats = [];
  item.refineStats.push(stat);

  const statName = REFINE_STAT_POOL.find(s => s.key === stat.key)?.name || stat.key;
  return {
    success: true,
    message: `精炼成功！获得 ${statName}+${stat.value}`,
    newStat: stat,
  };
}

/** 重铸精炼（清除所有词条，可重新精炼） */
export function doRefineReset(item: Item): { success: boolean; message: string } {
  if (!item.refineStats || item.refineStats.length === 0) {
    return { success: false, message: '暂无精炼词条' };
  }

  const cost = 500;
  if (GameState.gold < cost) {
    return { success: false, message: `金币不足 (需要${cost})` };
  }

  GameState.gold -= cost;
  item.refineStats = [];
  return { success: true, message: '重铸完成，词条已清除' };
}

// ═══════════════════════════════════════════
// 装备分解系统 (Decomposition)
// ═══════════════════════════════════════════

/** 品质对应返还材料表 — 返还量必须小于强化/精炼消耗量 */
const DECOMP_MATERIALS: Record<string, Array<{ name: string; qty: number }>> = {
  white:  [{ name: '铁矿石', qty: 1 }],
  green:  [{ name: '铁矿石', qty: 1 }, { name: '银矿石', qty: 1 }],
  blue:   [{ name: '银矿石', qty: 1 }, { name: '妖将核心', qty: 1 }],
  purple: [{ name: '妖将核心', qty: 1 }, { name: '灵晶碎片', qty: 1 }],
  gold:   [{ name: '灵晶碎片', qty: 1 }, { name: '传说材料碎片', qty: 1 }],
};

/** 计算分解返还 — 返还总量严格小于强化总消耗 */
export function getDecompReturn(item: Item): { materials: Array<{ name: string; qty: number }>; gold: number } {
  const quality = item.quality || 'white';
  const baseMats = DECOMP_MATERIALS[quality] || DECOMP_MATERIALS.white;

  // 强化等级返还加成 — 最高返还强化总消耗的40%
  const enhanceLv = item.enhanceLevel || 0;
  // 强化总消耗灵晶碎片 = sum(1 + floor(lv/3)) for lv=0..enhanceLv-1
  let totalCrystalsSpent = 0;
  for (let lv = 0; lv < enhanceLv; lv++) {
    totalCrystalsSpent += 1 + Math.floor(lv / 3);
  }
  // 返还灵晶碎片 = 总消耗的40%（向下取整），至少0
  const crystalReturn = Math.floor(totalCrystalsSpent * 0.4);

  // 精炼词条加成 — 每条返还1个对应材料，但不超过消耗的50%
  const refineBonus = Math.min(item.refineStats?.length || 0, 1);

  const materials = baseMats.map(m => {
    let qty = m.qty;
    // 灵晶碎片使用40%返还规则
    if (m.name === '灵晶碎片') {
      qty = crystalReturn;
    }
    return { name: m.name, qty: Math.max(qty, 0) };
  });

  // 如果有精炼词条，额外返还1个材料（但不超过基础返还）
  if (refineBonus > 0 && materials.length > 0) {
    materials[0].qty += refineBonus;
  }

  // 过滤掉数量为0的
  const filteredMaterials = materials.filter(m => m.qty > 0);

  // 金币返还 = 品质基数 + 强化等级 * 30（远小于强化消耗）
  const goldBase: Record<string, number> = { white: 30, green: 60, blue: 100, purple: 200, gold: 400 };
  const gold = (goldBase[quality] || 30) + enhanceLv * 30;

  return { materials: filteredMaterials, gold };
}

/** 执行分解 */
export function doDecompose(item: Item): { success: boolean; message: string; materials: Array<{ name: string; qty: number }>; gold: number } {
  const result = getDecompReturn(item);

  // 返还材料
  for (const mat of result.materials) {
    const existing = Inventory.items.find(i => i.name === mat.name && i.type === 'material');
    if (existing) {
      existing.quantity += mat.qty;
    } else {
      Inventory.items.push({
        id: `mat_${mat.name}`,
        name: mat.name,
        type: 'material',
        desc: '分解所得',
        quantity: mat.qty,
      });
    }
  }

  // 返还金币
  GameState.gold += result.gold;

  // 从背包移除
  Inventory.items = Inventory.items.filter(i => i !== item);

  const matStr = result.materials.map(m => `${m.name}×${m.qty}`).join(', ');
  return {
    success: true,
    message: `分解完成！获得 ${matStr}，金币 +${result.gold}`,
    materials: result.materials,
    gold: result.gold,
  };
}

// ═══════════════════════════════════════════
// 获取装备实际属性（含强化倍率 + 精炼词条）
// ═══════════════════════════════════════════

export function getEffectiveStats(item: Item): Record<string, number> {
  if (!item.stats) return {};
  const mult = getEnhanceMult(item);
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(item.stats)) {
    result[k] = Math.round((v || 0) * mult);
  }
  // 加上精炼词条
  if (item.refineStats) {
    for (const rs of item.refineStats) {
      result[rs.key] = (result[rs.key] || 0) + rs.value;
    }
  }
  return result;
}

// ═══════════════════════════════════════════
// 格式化辅助
// ═══════════════════════════════════════════

/** 获取强化等级显示文本 */
export function getEnhanceLabel(item: Item): string {
  const lv = item.enhanceLevel || 0;
  return lv > 0 ? `+${lv}` : '';
}

/** 获取装备光效等级 — +9橙光 / +10金光 */
export function getEnhanceGlow(item: Item): { color: number; intensity: number } | null {
  const lv = item.enhanceLevel || 0;
  if (lv >= 10) return { color: 0xffd700, intensity: 1.0 };  // 金光
  if (lv >= 9) return { color: 0xff8800, intensity: 0.8 };   // 橙光
  return null;
}

/** 获取精炼词条显示文本 */
export function getRefineDisplay(item: Item): string {
  if (!item.refineStats || item.refineStats.length === 0) return '';
  const statNames: Record<string, string> = { atk: '攻', def: '防', matk: '魔攻', mdef: '魔防', hp: '命', mp: '灵', spd: '速' };
  return item.refineStats.map(rs => `${statNames[rs.key] || rs.key}+${rs.value}`).join(' ');
}

/** 获取装备完整描述（含强化/精炼） */
export function getItemFullDesc(item: Item): string {
  const parts: string[] = [item.desc || ''];
  const enhLabel = getEnhanceLabel(item);
  if (enhLabel) parts.push(`强化${enhLabel}`);
  const refDisplay = getRefineDisplay(item);
  if (refDisplay) parts.push(`[${refDisplay}]`);
  return parts.filter(p => p).join(' ');
}
