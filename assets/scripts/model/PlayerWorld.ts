/**
 * 客户端权威数据模型 + 属性派生（L0 地基）。
 *
 * 字段严格镜像服务端 server/core/world.ts 的 PlayerWorld 接口——
 * worldSync 每秒强推的就是这份全量 JSON。Cocos 端只消费、不篡改
 * （下一次 worldSync 会用服务端真相覆盖本地缓存，详见 world.ts 注释）。
 *
 * deriveStats() 精确镜像 Phaser 端 GameStateStats.recalcStats 的主干公式，
 * 保证面板数值与战斗结算一致。少数高级百分比叠加项（称号全属性/套装/灵宠光环）
 * 在 L0 暂置 0 并在注释标注，待对应系统接入时补齐——不影响绝大多数早期数值。
 */

export type EquipSlot =
  | 'head' | 'body' | 'bracer' | 'boots' | 'belt'
  | 'ring' | 'necklace' | 'charm' | 'pendant';

export interface WorldItem {
  id: string;
  name: string;
  type: string;
  desc: string;
  quantity: number;
  slot?: EquipSlot;
  stats?: Record<string, number>;
  quality?: string;
  set?: string;
  zone?: number;
  enhanceLevel?: number;
  refineStats?: Array<{ key: string; value: number }>;
}

export interface Pet {
  id: string;
  speciesId: string;
  name: string;
  level: number;
  exp: number;
  element: string;
  quality: string;
  hp: number; maxHp: number;
  atk: number; def: number; matk: number; mdef: number; spd: number;
  attrStr: number; attrVit: number; attrAgi: number; attrInt: number;
  attrPoints: number;
  skills: string[];
  loyalty: number;
  active: boolean;
}

export interface PlayerWorld {
  inventory: WorldItem[];
  equipment: Record<EquipSlot, WorldItem | null>;
  gold: number;
  level: number;
  exp: number;
  statPoints: number;
  allocatedHP: number; allocatedMP: number; allocatedATK: number;
  allocatedDEF: number; allocatedMATK: number; allocatedMDEF: number; allocatedSPD: number;
  quests: Record<string, number>;
  completedQuests: string[];
  bestiary: Record<string, number>;
  gatherNodes: Record<string, { consumed: boolean; respawnAt: number }>;
  dailyClaimed: { date: string; ids: string[] };
  weeklyClaimed: { week: string; ids: string[] };
  dungeonWeekly: { week: string; count: number };
  dungeon: { dungeonId: number; stage: number } | null;
  unlocks: string[];
  zanpakuto: string;
  kidoSchool: string | null;
  kidoNodes: Record<string, number>;
  kidoEquipped: string[];
  kidoPoints: number;
  bestiaryTierClaimed: number[];
  unlockedTitles: string[];
  activeTitle: string | null;
  arena: any;
  pets: Pet[];
}

// ——— 属性换算常量（与服务端 config.ts 完全一致）———
export const STAT_PER_POINT: Record<string, number> = {
  HP: 15, MP: 5, ATK: 1, DEF: 1, MATK: 1, MDEF: 1, SPD: 1,
};
export const POINTS_PER_LEVEL = 6;

/** 防具槽位（影响 body 加成倍率） */
export const ARMOR_SLOTS: EquipSlot[] = ['head', 'body', 'bracer', 'boots', 'belt'];
/** 饰品槽位（影响 jewel 加成倍率） */
export const JEWELRY_SLOTS: EquipSlot[] = ['ring', 'necklace', 'charm', 'pendant'];

/** 经验曲线（1→70，与服务端 BattleData.expForLevel 一致）。用于显示"距下一级还需 exp"。 */
export function expForLevel(lv: number): number {
  if (lv <= 10) return 100 + (lv - 1) * 50;
  if (lv <= 20) return 550 + (lv - 11) * 80;
  if (lv <= 30) return 1350 + (lv - 21) * 120;
  if (lv <= 40) return 2550 + (lv - 31) * 180;
  if (lv <= 50) return 4350 + (lv - 41) * 260;
  if (lv <= 60) return 6950 + (lv - 51) * 380;
  return 10750 + (lv - 61) * 550;
}

/** 强化属性倍率：每级 +5%（与服务端 core/constants.enhanceMult 一致）。 */
export function getEnhanceMult(item: WorldItem | null | undefined): number {
  const lv = item?.enhanceLevel || 0;
  return 1 + lv * 0.05;
}

/** 装备有效属性 = 基础 stats × 强化倍率 + 精炼词条（与服务端 EnhanceSystem.getEffectiveStats 一致）。 */
export function getEffectiveStats(item: WorldItem | null | undefined): Record<string, number> {
  if (!item || !item.stats) return {};
  const mult = getEnhanceMult(item);
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(item.stats)) {
    result[k] = Math.round((v || 0) * mult);
  }
  if (item.refineStats) {
    for (const rs of item.refineStats) {
      result[rs.key] = (result[rs.key] || 0) + rs.value;
    }
  }
  return result;
}

/** 汇总若干装备的有效属性之和。 */
function sumStats(items: Array<WorldItem | null | undefined>): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const it of items) {
    if (!it) continue;
    const s = getEffectiveStats(it);
    for (const [k, v] of Object.entries(s)) acc[k] = (acc[k] || 0) + v;
  }
  return acc;
}

/**
 * 鬼道被动加成。
 * L0 占位：返回全 0。精确的 KIDO_NODES 被动节点表（约 20 个 passive 节点，
 * 每个 effect:{type:'passive_stat', stat, amount}）将在 L1 鬼道系统接入时完整移植，
 * 届时遍历 pw.kidoNodes 累加 amount×points 即可——绝大多数早期玩家未点鬼道，影响为 0。
 */
export function kidoPassive(_pw: PlayerWorld): Record<string, number> {
  return { hp_pct: 0, mp_pct: 0, def_pct: 0, matk_pct: 0, mdef_pct: 0, spd_pct: 0 };
}

export interface DerivedStats {
  maxHp: number; maxMp: number;
  atk: number; def: number; matk: number; mdef: number; spd: number;
}

/**
 * 由 PlayerWorld 派生最终战斗属性。
 * 精确镜像 GameStateStats.recalcStats 主干：
 *   基础 + 已分配×STAT_PER_POINT×斩魄刀成长 + 防具有效属性 + 饰品有效属性
 *   + 完现术/圣文字 对装备部分的 +10%
 *   + 鬼道被动百分比（L0 暂 0）
 * 暂未计入：称号全属性% / 套装% / 灵宠光环（L1/L8 接入）。斩魄刀成长系数 gt 默认 1.0。
 */
export function deriveStats(pw: PlayerWorld): DerivedStats {
  const eq = pw.equipment || ({} as Record<EquipSlot, WorldItem | null>);
  const bodyItems = ARMOR_SLOTS.map((s) => eq[s]);
  const jewelItems = JEWELRY_SLOTS.map((s) => eq[s]);
  const eqBody = sumStats(bodyItems);
  const eqJewel = sumStats(jewelItems);
  const kp = kidoPassive(pw);

  // 完现术(fullbring)/圣文字(schrift) 解锁：装备部分 +10%
  const fb = pw.unlocks && pw.unlocks.includes('fullbring') ? 1.10 : 1.0;
  const sf = pw.unlocks && pw.unlocks.includes('schrift') ? 1.10 : 1.0;
  // 斩魄刀成长系数（始解后按刀名查 ZANPAKUTO_GROWTH 表，L0 默认 1.0）
  const gt = 1.0;

  const a = pw;
  const A = (k: keyof PlayerWorld) => (typeof (a as any)[k] === 'number' ? (a as any)[k] : 0);

  let maxHp = 100
    + Math.round(A('allocatedHP') * STAT_PER_POINT.HP * gt)
    + Math.round((eqBody.hp || 0) * fb) + Math.round((eqJewel.hp || 0) * sf);
  maxHp = Math.round(maxHp * (1 + (kp.hp_pct || 0)));

  let maxMp = 50
    + Math.round(A('allocatedMP') * STAT_PER_POINT.MP * gt)
    + Math.round((eqBody.mp || 0) * fb) + Math.round((eqJewel.mp || 0) * sf);
  maxMp = Math.round(maxMp * (1 + (kp.mp_pct || 0)));

  let atk = 10
    + Math.round(A('allocatedATK') * STAT_PER_POINT.ATK * gt)
    + Math.round((eqBody.atk || 0) * fb) + Math.round((eqJewel.atk || 0) * sf);

  let def = 8
    + Math.round(A('allocatedDEF') * STAT_PER_POINT.DEF * gt)
    + Math.round((eqBody.def || 0) * fb) + Math.round((eqJewel.def || 0) * sf);
  def = Math.round(def * (1 + (kp.def_pct || 0)));

  let matk = 10
    + Math.round(A('allocatedMATK') * STAT_PER_POINT.MATK * gt)
    + Math.round((eqBody.matk || 0) * fb) + Math.round((eqJewel.matk || 0) * sf);
  matk = Math.round(matk * (1 + (kp.matk_pct || 0)));

  let mdef = 8
    + Math.round(A('allocatedMDEF') * STAT_PER_POINT.MDEF * gt)
    + Math.round((eqBody.mdef || 0) * fb) + Math.round((eqJewel.mdef || 0) * sf);
  mdef = Math.round(mdef * (1 + (kp.mdef_pct || 0)));

  let spd = 10
    + Math.round(A('allocatedSPD') * STAT_PER_POINT.SPD * gt)
    + Math.round((eqBody.spd || 0) * fb) + Math.round((eqJewel.spd || 0) * sf);
  spd = Math.round(spd * (1 + (kp.spd_pct || 0)));

  return { maxHp, maxMp, atk, def, matk, mdef, spd };
}

/** 力量体系中文名（六大解锁）。 */
export const UNLOCK_LABELS: Record<string, string> = {
  shikai: '始解', bankai: '卍解', hollow: '虚化', fullbring: '完现术', schrift: '圣文字', kyokasuigetsu: '狱解',
};
