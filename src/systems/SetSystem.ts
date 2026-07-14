/**
 * 套装系统 — 《解》联机版
 *
 * 设计基线（经策划确认）：
 * - 套装归属 = 区域 + 品质，生成装备时打标 `set = "${zone}_${quality}"`，零装备库重写。
 * - 防具（head/body/bracer/boots/belt）与饰品（ring/necklace/charm/pendant）各自独立计件、独立激活。
 * - 加成表「攻防双维对称」：纯物攻 / 纯魔攻 / 混合 build 穿满套都均衡受益。
 * - 5 件套专属技能本期只做「% 类」（全属性），行为类（灼烧/护盾/击杀回血/遇敌率等）留二期。
 *
 * 计算仅在客户端 recalcStats 调用（与服务端现有装备加成一致，无新增作弊面；
 * 联机时 set 字段随 WorldItem 序列化同步，服务端为唯一真相源）。
 */
import type { Equipment, EquipSlot, Item } from './Inventory';

/** 套装加成（百分比小数，0.08 = +8%） */
export interface SetBonus {
  hp?: number;
  mp?: number;
  atk?: number;
  def?: number;
  matk?: number;
  mdef?: number;
  spd?: number;
}

/** 防具槽位 */
export const ARMOR_SLOTS: EquipSlot[] = ['head', 'body', 'bracer', 'boots', 'belt'];
/** 饰品槽位 */
export const JEWELRY_SLOTS: EquipSlot[] = ['ring', 'necklace', 'charm', 'pendant'];

/**
 * 防具套装加成（按件数累积激活）。
 * 2pc 资源(HP) ↔ 3pc 双防(DEF&MDEF) ↔ 4pc 堆防+HP ↔ 5pc 全属性专属。
 */
export const ARMOR_SET_BONUSES: Record<number, SetBonus> = {
  2: { hp: 0.05 },
  3: { def: 0.08, mdef: 0.08 },
  4: { hp: 0.08, def: 0.06, mdef: 0.06 },
  5: { atk: 0.10, def: 0.10, matk: 0.10, mdef: 0.10, spd: 0.10 }, // 5pc %类专属：全属性 +10%
};

/**
 * 饰品套装加成（按件数累积激活）。
 * 2pc 资源(MP) ↔ 3pc 双攻(ATK&MATK) ↔ 4pc MP+速度。
 */
export const JEWELRY_SET_BONUSES: Record<number, SetBonus> = {
  2: { mp: 0.05 },
  3: { atk: 0.08, matk: 0.08 },
  4: { mp: 0.08, spd: 0.08 },
};

/** 生成套装标识 */
export function makeSetId(zone: number, quality: string): string {
  return `${zone}_${quality}`;
}

const QUALITY_CN: Record<string, string> = {
  white: '白', green: '绿', blue: '蓝', purple: '紫', gold: '金',
};

/** 套装展示名：第X区·Y套装 */
export function setName(setId: string): string {
  const [z, q] = setId.split('_');
  const zone = Number(z) || 0;
  const qcn = QUALITY_CN[q] || q || '';
  return `第${zone}区·${qcn}套装`;
}

/** 套装紧凑短名：第X区·Y（UI 逐件标注用，不带"套装"后缀） */
export function setShortName(setId: string): string {
  const [z, q] = setId.split('_');
  const zone = Number(z) || 0;
  const qcn = QUALITY_CN[q] || q || '';
  return `第${zone}区·${qcn}`;
}

function addBonus(into: SetBonus, from?: SetBonus): void {
  if (!from) return;
  for (const k of Object.keys(from) as (keyof SetBonus)[]) {
    (into as any)[k] = ((into as any)[k] || 0) + ((from as any)[k] || 0);
  }
}

/**
 * 累积加成：把「件数 ≤ count」的所有档位加成全部叠加。
 * 例：穿 4 件 = 2pc + 3pc + 4pc 三档之和（设计注释「按件数累积激活」）。
 */
function accumulate(count: number, table: Record<number, SetBonus>): SetBonus {
  const out: SetBonus = {};
  for (const t of [2, 3, 4, 5]) {
    if (count >= t && table[t]) addBonus(out, table[t]);
  }
  return out;
}

/** 单套装进度（供 UI 展示） */
export interface SetProgress {
  setId: string;
  name: string;
  armorCount: number;
  armorTotal: number;
  jewelCount: number;
  jewelTotal: number;
  /** 当前已激活的加成（按最大已达档位） */
  active: SetBonus;
}

/** 聚合所有已穿戴装备的套装加成（百分比小数） */
export function computeSetBonuses(equipment: Equipment): SetBonus {
  const counts: Record<string, { armor: number; jewel: number }> = {};
  const slots = [...ARMOR_SLOTS, ...JEWELRY_SLOTS];
  for (const slot of slots) {
    const item: Item | null = (equipment as any)[slot];
    if (item && item.set) {
      const c = counts[item.set] || { armor: 0, jewel: 0 };
      if (ARMOR_SLOTS.includes(slot)) c.armor++;
      else c.jewel++;
      counts[item.set] = c;
    }
  }

  const total: SetBonus = {};
  for (const setId of Object.keys(counts)) {
    const c = counts[setId];
    addBonus(total, accumulate(c.armor, ARMOR_SET_BONUSES));
    addBonus(total, accumulate(c.jewel, JEWELRY_SET_BONUSES));
  }
  return total;
}

/** 列出每个套装的穿搭进度（供 UI 展示，仅含已穿戴 >=1 件的套装） */
export function listSetProgress(equipment: Equipment): SetProgress[] {
  const counts: Record<string, { armor: number; jewel: number }> = {};
  const slots = [...ARMOR_SLOTS, ...JEWELRY_SLOTS];
  for (const slot of slots) {
    const item: Item | null = (equipment as any)[slot];
    if (item && item.set) {
      const c = counts[item.set] || { armor: 0, jewel: 0 };
      if (ARMOR_SLOTS.includes(slot)) c.armor++;
      else c.jewel++;
      counts[item.set] = c;
    }
  }

  const out: SetProgress[] = [];
  for (const setId of Object.keys(counts)) {
    const c = counts[setId];
    const active: SetBonus = {};
    addBonus(active, accumulate(c.armor, ARMOR_SET_BONUSES));
    addBonus(active, accumulate(c.jewel, JEWELRY_SET_BONUSES));
    out.push({
      setId,
      name: setName(setId),
      armorCount: c.armor,
      armorTotal: ARMOR_SLOTS.length,
      jewelCount: c.jewel,
      jewelTotal: JEWELRY_SLOTS.length,
      active,
    });
  }
  return out;
}
