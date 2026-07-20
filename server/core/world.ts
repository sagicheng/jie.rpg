/**
 * 联机权威世界状态（服务端内存单一真相源）
 * ----------------------------------------------------------------
 * 每位玩家一份 PlayerWorld：背包 / 装备 / 金币 / 等级经验 / 任务进度 /
 * 图鉴击杀 / 采集点状态。客户端不发"我获得了X"，只发"意图(intent)"，
 * 由本模块校验并改写权威状态，再通过 worldSync 广播给该客户端。
 *
 * 这样即使玩家断开连接（gameRoom 丢失），也无法再采集 / 拾取 / 买卖 /
 * 制造 / 强化 / 领奖——一切内容操作都必须经服务端。本地内存被改写也
 * 无效，因为下一次 worldSync 会用服务端真相覆盖客户端缓存。
 *
 * 注意：本模块刻意不直接 import GameState / Inventory 客户端单例，只
 * import 纯数据模块（Zones / materials / QuestData / BattleData）与类型，
 * 保持服务端独立、可被 tsc -p tsconfig.server.json 干净编译。
 */
import { ZONE_CONFIGS } from '../../src/config/zones';
import { NODE_TO_MATERIAL, matId } from '../../src/config/materials';
import { MAIN_QUESTS, SIDE_QUESTS, DAILY_QUESTS, WEEKLY_QUESTS, DAILY_CAP, WEEKLY_CAP, todayStr, weekStr } from '../../src/managers/QuestData';
import { expForLevel } from '../../src/managers/BattleData';
import { makeSetId } from '../../src/managers/SetSystem';
import { POINTS_PER_LEVEL } from '../../src/config/config';
import type { EquipSlot } from '../../src/managers/Inventory';
import { KIDO_NODES, TIER_LOCK, ALL_KIDO_NODES } from '../../src/managers/Kido';
import { getBestiaryTierReached, BESTIARY_TIERS, BESTIARY_TITLES, NAMED_ENEMIES } from '../../src/managers/BestiaryData';
import { saveCharacterWorld } from './db';
import { newArenaState, ensureArena as arenaEnsure, applyResult as arenaApply, tierName, isArenaOpen, ARENA_WEEKLY_CAP, seasonRewardFor, type ArenaState, type ArenaResult } from '../modules/feature/arena';

const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1080;
const GATHER_RESPAWN_MS = 30000;
/** 副本每周可参加次数（全部副本共享）。 */
const DUNGEON_WEEKLY_CAP = 3;

// ——— 强化 / 精炼 / 分解 纯逻辑（镜像自 src/systems/EnhanceSystem，去全局耦合）———
const ENHANCE_RATES: number[] = [1, 1, 1, 1, 1, 0.85, 0.70, 0.55, 0.42, 0.30];
const QUALITY_MULT: Record<string, number> = { white: 1.0, green: 1.15, blue: 1.35, purple: 1.6, gold: 2.0 };
const REFINE_SLOTS: Record<string, number> = { white: 1, green: 1, blue: 2, purple: 2, gold: 3 };
const REFINE_STAT_POOL: Array<{ key: string; weight: number }> = [
  { key: 'atk', weight: 20 }, { key: 'def', weight: 20 }, { key: 'matk', weight: 20 },
  { key: 'mdef', weight: 20 }, { key: 'hp', weight: 15 }, { key: 'mp', weight: 15 }, { key: 'spd', weight: 10 },
];
const REFINE_MAT_MAP: Record<string, string> = {
  white: '铁矿石', green: '铁矿石', blue: '银矿石', purple: '妖将核心', gold: '传说材料碎片',
};
const DECOMP_MATERIALS: Record<string, Array<{ name: string; qty: number }>> = {
  white: [{ name: '铁矿石', qty: 1 }], green: [{ name: '铁矿石', qty: 1 }, { name: '银矿石', qty: 1 }],
  blue: [{ name: '银矿石', qty: 1 }, { name: '妖将核心', qty: 1 }],
  purple: [{ name: '妖将核心', qty: 1 }, { name: '灵晶碎片', qty: 1 }],
  gold: [{ name: '灵晶碎片', qty: 1 }, { name: '传说材料碎片', qty: 1 }],
};
const DECOMP_GOLD_BASE: Record<string, number> = { white: 30, green: 60, blue: 100, purple: 200, gold: 400 };
const CRAFT_RECIPES: Record<string, { cost: Record<string, number>; result: WorldItem }> = {
  '铁剑': { cost: { '铁矿石': 3, '灵木枝': 1 }, result: { id: '铁剑', name: '铁剑', type: 'equipment', desc: '手工制造', quantity: 1, slot: 'weapon' as EquipSlot, stats: { atk: 5 }, quality: 'green', zone: 1 } },
  '铁甲': { cost: { '铁矿石': 5, '麻布片': 2 }, result: { id: '铁甲', name: '铁甲', type: 'equipment', desc: '手工制造', quantity: 1, slot: 'body' as EquipSlot, stats: { def: 8, hp: 10 }, quality: 'green', zone: 1 } },
  '铁手甲': { cost: { '铁矿石': 2, '灵木枝': 1 }, result: { id: '铁手甲', name: '铁手甲', type: 'equipment', desc: '手工制造', quantity: 1, slot: 'bracer' as EquipSlot, stats: { atk: 3, def: 3 }, quality: 'green', zone: 1 } },
};

export interface WorldItem {
  id: string; name: string; type: string; desc: string; quantity: number;
  slot?: EquipSlot; stats?: Partial<Record<string, number>>; quality?: string;
  set?: string; // 套装标识 `${zone}_${quality}`
  /** 制造装备所属区域（用于合成后打套装标；商店装备的 zone 由 ZONE_CONFIGS.tier 推导，不存此字段）。 */
  zone?: number;
  enhanceLevel?: number; refineStats?: Array<{ key: string; value: number }>;
}

/**
 * 副本进行中的活动副本（联机权威，断连不丢；用于周次计次的"续打免计费"判定）。
 * stage 一并持久化：房间因 autoDispose 销毁后，重连仍可续到原阶（而非从第1阶重来）。
 */
export interface ActiveDungeon {
  dungeonId: number;
  /** 当前所处阶（1~3）。逐阶领奖推进；持久化以支撑"最后一人掉线也能续打"。 */
  stage: number;
}

export interface PlayerWorld {
  inventory: WorldItem[];
  equipment: Record<EquipSlot, WorldItem | null>;
  gold: number; level: number; exp: number; statPoints: number;
  allocatedHP: number; allocatedMP: number; allocatedATK: number; allocatedDEF: number; allocatedMATK: number; allocatedMDEF: number; allocatedSPD: number;
  quests: Record<string, number>;
  completedQuests: string[];
  bestiary: Record<string, number>;
  gatherNodes: Record<string, { consumed: boolean; respawnAt: number }>;
  dailyClaimed: { date: string; ids: string[] };
  weeklyClaimed: { week: string; ids: string[] };
  /** 副本周共享进入次数（全部副本共享 3 次/周，按"进入"计）。 */
  dungeonWeekly: { week: string; count: number };
  /** 当前活动副本（null=本周无进行中的副本）。用于"续打同副本不重复计次"。 */
  dungeon: ActiveDungeon | null;
  // 六大力量体系解锁（始解/卍解/虚化/完现术/圣文字/狱解）
  unlocks: string[];
  // 始解所选斩魄刀真名（与 unlocks 中的 'shikai' 配套；始解/卍解技能表均以此查表，必须持久化）
  zanpakuto: string;
  // 鬼道（服务端权威 + 持久化，与背包/金币同等重要）
  kidoSchool: string | null;
  kidoNodes: Record<string, number>;
  kidoEquipped: string[];
  kidoPoints: number;
  // 图鉴层级奖励已领 + 称号（服务端权威 + 持久化）
  bestiaryTierClaimed: number[];
  unlockedTitles: string[];
  activeTitle: string | null;
  // PVP 竞技场（服务端权威 + 持久化）
  arena: ArenaState;
  // 灵宠（服务端权威 + 持久化；落库随 worldSync，重连不丢）
  pets: Pet[];
}

export type PetElement = 'fire' | 'wind' | 'water' | 'earth';
export type PetQuality = 'normal' | 'fine' | 'choice' | 'rare' | 'legend';

/** 四元素（火/风/水/土）：标签 + 主题色（与《飘流幻境》一致）。 */
export const PET_ELEMENTS: Record<PetElement, { label: string; color: number; icon: string }> = {
  fire:  { label: '火', color: 0xff6633, icon: '🔥' },
  wind:  { label: '风', color: 0x66ccff, icon: '🌪' },
  water: { label: '水', color: 0x33ccaa, icon: '💧' },
  earth: { label: '土', color: 0xcc8844, icon: '⛰' },
};

/** 宠物品质（5 档）：倍率影响成长与每级属性点。 */
export const PET_QUALITIES: Record<PetQuality, { label: string; color: number; mult: number; attrPerLevel: number; weight: number }> = {
  normal: { label: '普通', color: 0xaaaaaa, mult: 1.00, attrPerLevel: 2, weight: 50 },
  fine:   { label: '优秀', color: 0x88cc66, mult: 1.12, attrPerLevel: 3, weight: 28 },
  choice: { label: '精良', color: 0x66aaff, mult: 1.25, attrPerLevel: 4, weight: 14 },
  rare:   { label: '稀有', color: 0xcc66ff, mult: 1.42, attrPerLevel: 5, weight: 6 },
  legend: { label: '传说', color: 0xffcc33, mult: 1.65, attrPerLevel: 6, weight: 2 },
};

/** 灵宠技能注册表（id → 名称/描述/元素/战斗参数）。
 *  v1.1 战斗协同：宠物技能实现为可主动释放的伤害技（按元素用宠物 atk/matk 结算，消耗宠MP）。
 *  power 为伤害系数，damageType 决定物理/魔法结算，mp 为宠MP消耗。 */
export const PET_SKILLS: Record<string, { name: string; desc: string; element?: PetElement; power: number; damageType: 'physical' | 'magical'; mp: number }> = {
  flame_breath: { name: '烈焰吐息', desc: '喷吐烈焰灼烧敌人。', element: 'fire',  power: 1.4, damageType: 'magical',  mp: 10 },
  rock_bulwark: { name: '岩石壁垒', desc: '以岩石砸击敌人。', element: 'earth', power: 1.2, damageType: 'physical', mp: 10 },
  gale_edge:    { name: '疾风之刃', desc: '疾风般的利爪连斩。', element: 'wind',  power: 1.3, damageType: 'physical', mp: 10 },
  tide_veil:    { name: '碧水纱', desc: '碧水冲击敌人。', element: 'water', power: 1.3, damageType: 'magical',  mp: 10 },
  shadow_fang:  { name: '暗影撕咬', desc: '暗影撕咬造成重创。', element: 'wind',  power: 1.5, damageType: 'physical', mp: 12 },
  quake_smash:  { name: '撼地重击', desc: '撼地一击重创敌人。', element: 'earth', power: 1.4, damageType: 'physical', mp: 12 },
  spirit_grace: { name: '灵兔祝福', desc: '灵力冲击敌人。', element: 'water', power: 1.2, damageType: 'magical',  mp: 10 },
  auspice:      { name: '祥瑞', desc: '祥瑞之光重创敌人。', element: 'fire',  power: 1.6, damageType: 'magical',  mp: 15 },
};

export interface Pet {
  id: string;
  speciesId: string;
  name: string;
  level: number;
  exp: number;
  element: PetElement;
  quality: PetQuality;
  hp: number; maxHp: number;
  atk: number; def: number; matk: number; mdef: number; spd: number;
  attrStr: number; attrVit: number; attrAgi: number; attrInt: number; // 已分配属性点
  attrPoints: number;        // 未分配
  skills: string[];          // 技能 id
  loyalty: number;
  active: boolean;
}

/** 灵宠物种定义（服务端权威；客户端仅镜像展示用字段）。 */
export interface PetSpecies {
  id: string; name: string; icon: string; color: number; desc: string;
  element: PetElement;
  base: { hp: number; atk: number; def: number; matk: number; mdef: number; spd: number };
  growth: { hp: number; atk: number; def: number; matk: number; mdef: number; spd: number };
  obtainZone: number;
  skillIds: string[];        // 先天技能
}

export const PET_SLOT_CAP = 6;

export const PET_SPECIES: Record<string, PetSpecies> = {
  fox_fire: { id: 'fox_fire', name: '赤焰狐', icon: '🦊', color: 0xff6633, desc: '火属性灵狐，魔攻与速度见长。', element: 'fire', obtainZone: 2,
    base: { hp: 120, atk: 18, def: 12, matk: 28, mdef: 16, spd: 22 }, growth: { hp: 14, atk: 2, def: 1.5, matk: 3, mdef: 2, spd: 2.5 },
    skillIds: ['flame_breath'] },
  tortoise_rock: { id: 'tortoise_rock', name: '玄岩龟', icon: '🐢', color: 0x889977, desc: '土属性灵龟，血厚防高。', element: 'earth', obtainZone: 3,
    base: { hp: 260, atk: 14, def: 30, matk: 8, mdef: 22, spd: 8 }, growth: { hp: 28, atk: 1.5, def: 3, matk: 1, mdef: 2.5, spd: 0.8 },
    skillIds: ['rock_bulwark'] },
  hawk_wind: { id: 'hawk_wind', name: '青翼鹰', icon: '🦅', color: 0x66ccff, desc: '风属性灵鹰，速度与物攻突出。', element: 'wind', obtainZone: 4,
    base: { hp: 130, atk: 26, def: 12, matk: 14, mdef: 14, spd: 34 }, growth: { hp: 14, atk: 3, def: 1, matk: 1.5, mdef: 1.5, spd: 3 },
    skillIds: ['gale_edge'] },
  serpent_water: { id: 'serpent_water', name: '碧水蟒', icon: '🐍', color: 0x33ccaa, desc: '水属性灵蟒，魔攻与血量兼备。', element: 'water', obtainZone: 5,
    base: { hp: 200, atk: 16, def: 16, matk: 26, mdef: 20, spd: 16 }, growth: { hp: 22, atk: 1.5, def: 1.5, matk: 3, mdef: 2, spd: 1.5 },
    skillIds: ['tide_veil'] },
  wolf_shadow: { id: 'wolf_shadow', name: '暗影狼', icon: '🐺', color: 0x9966cc, desc: '风属性灵狼（暗），物攻与速度凶猛。', element: 'wind', obtainZone: 6,
    base: { hp: 160, atk: 30, def: 16, matk: 12, mdef: 14, spd: 26 }, growth: { hp: 18, atk: 3, def: 1.5, matk: 1.2, mdef: 1.5, spd: 2.5 },
    skillIds: ['shadow_fang'] },
  bear_earth: { id: 'bear_earth', name: '撼地熊', icon: '🐻', color: 0xcc8844, desc: '土属性灵熊，血防物攻全面。', element: 'earth', obtainZone: 7,
    base: { hp: 300, atk: 28, def: 26, matk: 6, mdef: 14, spd: 10 }, growth: { hp: 32, atk: 3, def: 3, matk: 0.8, mdef: 1.5, spd: 1 },
    skillIds: ['quake_smash'] },
  rabbit_spirit: { id: 'rabbit_spirit', name: '灵兔', icon: '🐇', color: 0xff99cc, desc: '水属性灵兔，魔防与速度灵巧。', element: 'water', obtainZone: 8,
    base: { hp: 110, atk: 12, def: 10, matk: 22, mdef: 24, spd: 28 }, growth: { hp: 12, atk: 1, def: 1, matk: 2.5, mdef: 2.5, spd: 2.5 },
    skillIds: ['spirit_grace'] },
  dragonet: { id: 'dragonet', name: '幼麟', icon: '🐉', color: 0xffcc33, desc: '稀有麒麟幼兽，六维均衡且成长极高。', element: 'fire', obtainZone: 9,
    base: { hp: 220, atk: 24, def: 22, matk: 24, mdef: 22, spd: 24 }, growth: { hp: 24, atk: 2.5, def: 2.5, matk: 2.5, mdef: 2.5, spd: 2.5 },
    skillIds: ['auspice'] },
};

/** 灵宠升到下一级所需经验。 */
export function petExpForLevel(level: number): number {
  return 80 * level;
}

/** 属性点 → 各维加成权重（每点）。 */
const PET_ATTR_WEIGHT = {
  str: { atk: 3 },
  vit: { hp: 12, def: 1 },
  agi: { spd: 2 },
  int: { matk: 2, mdef: 1 },
};

/** 按物种/等级/品质/已分配属性点计算灵宠属性快照。 */
export function computePetStats(
  sp: PetSpecies, level: number, quality: PetQuality,
  attrs: { str: number; vit: number; agi: number; int: number },
): { hp: number; atk: number; def: number; matk: number; mdef: number; spd: number } {
  const q = (PET_QUALITIES[quality] || PET_QUALITIES.normal).mult;
  const f = (b: number, g: number, a: number) => Math.round((b + g * (level - 1) + a) * q);
  return {
    hp: f(sp.base.hp, sp.growth.hp, attrs.vit * PET_ATTR_WEIGHT.vit.hp),
    atk: f(sp.base.atk, sp.growth.atk, attrs.str * PET_ATTR_WEIGHT.str.atk),
    def: f(sp.base.def, sp.growth.def, attrs.vit * PET_ATTR_WEIGHT.vit.def),
    matk: f(sp.base.matk, sp.growth.matk, attrs.int * PET_ATTR_WEIGHT.int.matk),
    mdef: f(sp.base.mdef, sp.growth.mdef, attrs.int * PET_ATTR_WEIGHT.int.mdef),
    spd: f(sp.base.spd, sp.growth.spd, attrs.agi * PET_ATTR_WEIGHT.agi.spd),
  };
}

/** 随机品质（按权重，区域越高传说概率略升）。 */
export function rollPetQuality(zone = 1): PetQuality {
  const boost = Math.min(0.4, Math.max(0, (zone - 1) * 0.03));
  const entries = (Object.keys(PET_QUALITIES) as PetQuality[]).map(q => {
    let w = PET_QUALITIES[q].weight;
    if (q === 'rare' || q === 'legend') w = Math.round(w * (1 + boost * (q === 'legend' ? 2 : 1)));
    return { q, w };
  });
  const total = entries.reduce((s, e) => s + e.w, 0);
  let r = Math.random() * total;
  for (const e of entries) { r -= e.w; if (r <= 0) return e.q; }
  return 'normal';
}

function genPetId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export interface OpResult { ok: boolean; msg: string; data?: any; type?: string; }

const ALL_QUESTS = { ...MAIN_QUESTS, ...SIDE_QUESTS, ...DAILY_QUESTS, ...WEEKLY_QUESTS };

function seedWorld(): PlayerWorld {
  return {
    inventory: [
      { id: 'stop_blood_grass', name: '止血草', type: 'consumable', desc: '回复50HP', quantity: 5 },
      { id: 'medicine_pill_s', name: '伤药(小)', type: 'consumable', desc: '回复150HP', quantity: 3 },
      { id: 'spirit_water_s', name: '灵力水(小)', type: 'consumable', desc: '回复30MP', quantity: 3 },
      { id: 'antidote', name: '解毒药', type: 'consumable', desc: '解除中毒·寄生·灼烧', quantity: 2 },
    ],
    equipment: { head: null, body: null, bracer: null, boots: null, belt: null, ring: null, necklace: null, charm: null, pendant: null },
    gold: 200, level: 1, exp: 0, statPoints: 0, allocatedHP: 0, allocatedMP: 0, allocatedATK: 0, allocatedDEF: 0, allocatedMATK: 0, allocatedMDEF: 0, allocatedSPD: 0,
    quests: {}, completedQuests: [], bestiary: {}, gatherNodes: {},
    dailyClaimed: { date: '', ids: [] }, weeklyClaimed: { week: '', ids: [] },
    dungeonWeekly: { week: '', count: 0 }, dungeon: null,
    unlocks: [], zanpakuto: '', kidoSchool: null, kidoNodes: {}, kidoEquipped: [], kidoPoints: 0,
    bestiaryTierClaimed: [], unlockedTitles: [], activeTitle: null,
    arena: newArenaState(),
    pets: [],
  };
}

export class WorldService {
  private worlds = new Map<string, PlayerWorld>();
  /** gameSid → charId 映射，供副本房间在关键节点主动落库（不依赖 GameRoom.onLeave 时机）。 */
  private charIds = new Map<string, number>();

  /** 取（或首次创建并种子）某玩家的权威世界。 */
  get(sid: string): PlayerWorld {
    let w = this.worlds.get(sid);
    if (!w) { w = seedWorld(); this.worlds.set(sid, w); }
    return w;
  }

  /** 从 DB JSON 恢复世界状态（用于现有角色进房）。 */
  loadFromJSON(sid: string, data: Partial<PlayerWorld>): PlayerWorld {
    const w = seedWorld();
    // 覆盖种子值
    if (data.inventory) w.inventory = data.inventory;
    if (data.equipment) w.equipment = data.equipment;
    if (typeof data.gold === 'number') w.gold = data.gold;
    if (typeof data.level === 'number') w.level = data.level;
    if (typeof data.exp === 'number') w.exp = data.exp;
    if (typeof data.statPoints === 'number') w.statPoints = data.statPoints;
    if (typeof data.allocatedHP === 'number') w.allocatedHP = data.allocatedHP;
    if (typeof data.allocatedMP === 'number') w.allocatedMP = data.allocatedMP;
    if (typeof data.allocatedATK === 'number') w.allocatedATK = data.allocatedATK;
    if (typeof data.allocatedDEF === 'number') w.allocatedDEF = data.allocatedDEF;
    if (typeof data.allocatedMATK === 'number') w.allocatedMATK = data.allocatedMATK;
    if (typeof data.allocatedMDEF === 'number') w.allocatedMDEF = data.allocatedMDEF;
    if (typeof data.allocatedSPD === 'number') w.allocatedSPD = data.allocatedSPD;
    if (data.quests) w.quests = data.quests;
    if (data.completedQuests) w.completedQuests = data.completedQuests;
    if (data.bestiary) w.bestiary = data.bestiary;
    if (data.gatherNodes) w.gatherNodes = data.gatherNodes;
    if (data.dailyClaimed) w.dailyClaimed = data.dailyClaimed;
    if (data.weeklyClaimed) w.weeklyClaimed = data.weeklyClaimed;
    if (data.dungeonWeekly) w.dungeonWeekly = data.dungeonWeekly;
    if (data.dungeon !== undefined) w.dungeon = data.dungeon;
    if (Array.isArray(data.unlocks)) w.unlocks = data.unlocks;
    if (Array.isArray(data.pets)) w.pets = data.pets as Pet[];
    if (typeof data.zanpakuto === 'string') w.zanpakuto = data.zanpakuto;
    if (typeof data.kidoSchool === 'string' || data.kidoSchool === null) w.kidoSchool = data.kidoSchool;
    if (data.kidoNodes) w.kidoNodes = data.kidoNodes;
    if (Array.isArray(data.kidoEquipped)) w.kidoEquipped = data.kidoEquipped;
    if (typeof data.kidoPoints === 'number') w.kidoPoints = data.kidoPoints;
    if (Array.isArray(data.bestiaryTierClaimed)) w.bestiaryTierClaimed = data.bestiaryTierClaimed;
    if (Array.isArray(data.unlockedTitles)) w.unlockedTitles = data.unlockedTitles;
    if (typeof data.activeTitle === 'string' || data.activeTitle === null) w.activeTitle = data.activeTitle;
    if (data.arena && typeof data.arena === 'object') w.arena = data.arena as ArenaState;
    else w.arena = newArenaState();
    this.worlds.set(sid, w);
    return w;
  }

  /** 分配属性点（服务端权威）。校验剩余点数，写入已分配字段并扣减 statPoints。attr in {HP,MP,ATK,DEF,MATK,MDEF,SPD}。 */
  allocateStat(pw: PlayerWorld, attr: string): OpResult {
    const MAP: Record<string, 'allocatedHP' | 'allocatedMP' | 'allocatedATK' | 'allocatedDEF' | 'allocatedMATK' | 'allocatedMDEF' | 'allocatedSPD'> = {
      HP: 'allocatedHP', MP: 'allocatedMP', ATK: 'allocatedATK', DEF: 'allocatedDEF',
      MATK: 'allocatedMATK', MDEF: 'allocatedMDEF', SPD: 'allocatedSPD',
    };
    const field = MAP[attr];
    if (!field) return { ok: false, msg: 'invalid attr' };
    if (pw.statPoints <= 0) return { ok: false, msg: 'no stat points' };
    (pw as any)[field] = ((pw as any)[field] || 0) + 1;
    pw.statPoints -= 1;
    return { ok: true, msg: 'ok' };
  }

  /** 重新评估称号解锁（服务端权威）。基于 pw.bestiary（击杀）作为已收集集合。返回新解锁称号名。 */
  private evaluateTitles(pw: PlayerWorld): string[] {
    const newly: string[] = [];
    const collected = Object.keys(pw.bestiary).length;
    const generals = Object.values(NAMED_ENEMIES).filter(e => e.type === '妖将');
    const generalsKilled = generals.filter(e => (pw.bestiary[e.name] || 0) > 0).length;
    for (const def of BESTIARY_TITLES) {
      if (pw.unlockedTitles.includes((def as any).id)) continue;
      let unlocked = false;
      if ((def as any).requireFull) {
        const names = Object.keys(NAMED_ENEMIES);
        unlocked = names.length > 0 && names.every(n => (pw.bestiary[n] || 0) > 0);
      } else if ((def as any).requireAllGenerals) {
        unlocked = collected >= ((def as any).requiredCollected || 0) && generalsKilled === generals.length;
      } else {
        unlocked = collected >= ((def as any).requiredCollected || 0);
      }
      if (unlocked) { pw.unlockedTitles.push((def as any).id); newly.push((def as any).name); }
    }
    return newly;
  }

  /** 解锁六大力量体系之一（始解/卍解/虚化…）。zanpakuto 仅在始解时传入，随解锁一并持久化「所选斩魄刀真名」。 */
  addUnlock(pw: PlayerWorld, key: string, zanpakuto?: string): OpResult {
    if (pw.unlocks.includes(key)) return { ok: false, msg: 'already' };
    pw.unlocks.push(key);
    if (key === 'shikai' && zanpakuto) pw.zanpakuto = zanpakuto;
    return { ok: true, msg: 'ok' };
  }

  /** 设置/修正所选斩魄刀真名（持久化）。用于始解首次解锁落库，以及旧档已解锁但未存刀名时的迁移补存。 */
  setZanpakuto(pw: PlayerWorld, zanpakuto: string): OpResult {
    pw.zanpakuto = zanpakuto || '';
    return { ok: true, msg: 'ok' };
  }

  /** 设置鬼道主修系别（即面板当前查看系别，可切换）。 */
  kidoSetSchool(pw: PlayerWorld, school: string): OpResult {
    pw.kidoSchool = school;
    return { ok: true, msg: 'ok' };
  }

  /** 鬼道节点加点（服务端权威 + 持久化）。校验可用点数与层级锁。 */
  kidoAllocate(pw: PlayerWorld, nodeId: string): OpResult {
    const node = KIDO_NODES[nodeId];
    if (!node) return { ok: false, msg: 'unknown node' };
    const spent = Object.values(pw.kidoNodes).reduce((a, b) => a + b, 0);
    const avail = (pw.kidoPoints || 0) - spent;
    if (avail <= 0) return { ok: false, msg: 'no kido points' };
    if ((pw.kidoNodes[nodeId] || 0) >= node.maxPoints) return { ok: false, msg: 'maxed' };
    const inSchool = ALL_KIDO_NODES
      .filter(n => n.school === node.school)
      .reduce((s, n) => s + (pw.kidoNodes[n.id] || 0), 0);
    if (inSchool < (TIER_LOCK[node.tier] || 0)) return { ok: false, msg: 'tier locked' };
    pw.kidoNodes[nodeId] = (pw.kidoNodes[nodeId] || 0) + 1;
    return { ok: true, msg: 'ok' };
  }

  /** 装备/卸下鬼道主动技能（最多4个，服务端权威）。 */
  kidoEquip(pw: PlayerWorld, nodeId: string): OpResult {
    const node = KIDO_NODES[nodeId];
    if (!node || (pw.kidoNodes[nodeId] || 0) <= 0 || node.passive) return { ok: false, msg: 'not learned' };
    if (pw.kidoEquipped.includes(nodeId)) {
      pw.kidoEquipped = pw.kidoEquipped.filter(id => id !== nodeId);
    } else {
      if (pw.kidoEquipped.length >= 4) pw.kidoEquipped.pop();
      pw.kidoEquipped.push(nodeId);
    }
    return { ok: true, msg: 'ok' };
  }

  /** 图鉴层级奖励领取（服务端权威 + 持久化）。防重复领取 + 即时发奖。 */
  claimBestiaryTier(pw: PlayerWorld, tierId: number): OpResult {
    if (pw.bestiaryTierClaimed.includes(tierId)) return { ok: false, msg: 'already claimed' };
    const reached = getBestiaryTierReached(pw.bestiary);
    if (reached < tierId) return { ok: false, msg: 'not reached' };
    const tier = BESTIARY_TIERS.find(t => t.id === tierId);
    if (!tier) return { ok: false, msg: 'unknown tier' };
    pw.bestiaryTierClaimed.push(tierId);
    if (tier.reward.statPoints) pw.statPoints += tier.reward.statPoints;
    if (tier.reward.gold) pw.gold += tier.reward.gold;
    if (tier.reward.exp) pw.exp += tier.reward.exp;
    this.evaluateTitles(pw);
    return { ok: true, msg: 'ok' };
  }

  /** 装备/卸下称号（服务端权威 + 持久化）。 */
  setTitle(pw: PlayerWorld, id: string | null): OpResult {
    if (id !== null && !pw.unlockedTitles.includes(id)) return { ok: false, msg: 'not unlocked' };
    pw.activeTitle = (pw.activeTitle === id) ? null : id;
    return { ok: true, msg: 'ok' };
  }

  // ───────────────── PVP 竞技场（服务端权威 + 持久化） ─────────────────
  /** 确保 arena 字段存在并做赛季/周次重置；若跨越赛季边界，发放刚结束赛季的结算奖励。 */
  ensureArena(pw: PlayerWorld): { seasonEndedTier?: string } {
    const r = arenaEnsure(pw, new Date());
    if (r.seasonEndedTier) this.grantArenaSeasonReward(pw, r.seasonEndedTier);
    return r;
  }

  /** 竞技场状态（供客户端面板展示）。 */
  arenaStatus(pw: PlayerWorld): any {
    this.ensureArena(pw);
    const a = pw.arena;
    return {
      open: isArenaOpen(),
      season: a.season,
      points: a.points,
      tier: a.tier,
      tierName: tierName(a.tier),
      seasonBestTier: a.seasonBestTier,
      bestTierEver: a.bestTierEver,
      bestTierEverName: tierName(a.bestTierEver),
      weeklyUsed: a.weeklyUsed,
      weeklyCap: ARENA_WEEKLY_CAP,
      weeklyLeft: Math.max(0, ARENA_WEEKLY_CAP - a.weeklyUsed),
      history: a.history,
    };
  }

  /** 记录一场 PVP 结果（胜/负），更新积分/段位/赛季最佳/历史最佳。 */
  arenaRecordResult(pw: PlayerWorld, won: boolean): ArenaResult {
    return arenaApply(pw, won);
  }

  /** 发放赛季结算奖励（按赛季最高段位）。 */
  grantArenaSeasonReward(pw: PlayerWorld, tierId: string): void {
    const r = seasonRewardFor(tierId);
    pw.gold += r.gold;
    const titleId = `arena_${tierId}`;
    if (!pw.unlockedTitles.includes(titleId)) pw.unlockedTitles.push(titleId);
  }

  remove(sid: string): void { this.worlds.delete(sid); }

  /** 登记 gameSid→charId，供 persistBySid 落库。GameRoom.onJoin 时调用。 */
  registerCharId(sid: string, charId: number): void {
    this.charIds.set(sid, charId);
  }

  /** 反查 gameSid→charId（副本房间等无 sessionCharMap 的场景取角色 ID 用）。 */
  getCharId(sid: string): number | undefined {
    return this.charIds.get(sid);
  }

  /** 主动持久化某玩家的权威世界到 DB（副本推进/完成等关键节点调用，
   *  避免依赖断连时 onLeave 的保存时机——真机重连走"新会话从 DB 重载"，
   *  若仅内存推进不落库，重连会读到旧 dungeon.stage 而回落第 1 阶）。 */
  persistBySid(sid: string): void {
    const cid = this.charIds.get(sid);
    const pw = this.worlds.get(sid);
    if (cid === undefined || !pw) return;
    try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {}
  }

  // ───────────────── 背包 ─────────────────
  private findItem(pw: PlayerWorld, id: string): WorldItem | undefined {
    return pw.inventory.find(i => i.id === id);
  }
  private countMaterial(pw: PlayerWorld, name: string): number {
    return pw.inventory.filter(i => i.name === name && i.type === 'material').reduce((s, i) => s + (i.quantity || 0), 0);
  }
  private takeMaterial(pw: PlayerWorld, name: string, qty: number): boolean {
    if (this.countMaterial(pw, name) < qty) return false;
    let remaining = qty;
    for (const it of pw.inventory) {
      if (it.name === name && it.type === 'material' && remaining > 0) {
        const take = Math.min(it.quantity, remaining);
        it.quantity -= take; remaining -= take;
      }
    }
    pw.inventory = pw.inventory.filter(i => i.quantity > 0);
    return true;
  }

  /** 获得物品（合并非装备同类，装备各自独立入包）。 */
  grantItem(pw: PlayerWorld, item: WorldItem): void {
    if (item.type !== 'equipment') {
      const ex = pw.inventory.find(i => i.id === item.id && i.type !== 'equipment');
      if (ex) { ex.quantity += (item.quantity || 1); return; }
    }
    pw.inventory.push({ ...item, quantity: item.quantity || 1 });
  }

  /** 从背包移除指定物品及数量（上架冻结/消耗用）。数量不足或不存在返回 false。 */
  removeItem(pw: PlayerWorld, itemId: string, qty: number): boolean {
    const item = pw.inventory.find(i => i.id === itemId);
    if (!item || (item.quantity || 0) < qty) return false;
    if ((item.quantity || 0) > qty) item.quantity -= qty;
    else pw.inventory = pw.inventory.filter(i => i !== item);
    return true;
  }

  /** 战利品（来自 BattleRoom 权威结算）。 */
  grantLoot(pw: PlayerWorld, drops: WorldItem[]): void {
    for (const d of drops) this.grantItem(pw, d);
  }

  // ───────────────── 金币 / 等级 / 图鉴 ─────────────────
  spendGold(pw: PlayerWorld, amt: number): boolean {
    if (pw.gold < amt) return false;
    pw.gold -= amt; return true;
  }
  addGold(pw: PlayerWorld, amt: number): void { pw.gold += amt; }
  recordKill(pw: PlayerWorld, name: string): void { pw.bestiary[name] = (pw.bestiary[name] || 0) + 1; this.evaluateTitles(pw); }

  /** 加经验并升级（与客户端 expForLevel 曲线一致）。 */
  gainExp(pw: PlayerWorld, amount: number): number {
    pw.exp += amount;
    let leveled = 0;
    while (pw.exp >= expForLevel(pw.level + 1)) {
      pw.exp -= expForLevel(pw.level + 1);
      pw.level += 1; leveled += 1;
      pw.statPoints += POINTS_PER_LEVEL;
      pw.kidoPoints += 1;
    }
    return leveled;
  }

  // ───────────────── 任务 ─────────────────
  updateQuest(pw: PlayerWorld, type: string, target: string, amount: number): void {
    const key = `${type}:${target}`;
    pw.quests[key] = (pw.quests[key] || 0) + amount;
  }
  claimQuest(pw: PlayerWorld, questId: string): OpResult {
    const q = ALL_QUESTS[questId];
    if (!q) return { ok: false, msg: '未知任务' };
    // 日常：按日期字符串判定（非 completedQuests，因可重复）
    if (q.type === 'daily') {
      const t = todayStr();
      if (pw.dailyClaimed.date !== t) pw.dailyClaimed = { date: t, ids: [] };
      if (pw.dailyClaimed.ids.includes(questId)) return { ok: false, msg: '今日已完成' };
      if (pw.dailyClaimed.ids.length >= DAILY_CAP) return { ok: false, msg: '今日完成上限' };
      const r = q.rewards || {};
      if (r.gold) this.addGold(pw, r.gold);
      if (r.exp) this.gainExp(pw, r.exp);
      if (r.items) for (const it of r.items) this.grantItem(pw, { id: it.id, name: it.name, type: 'consumable', desc: '', quantity: it.count });
      if (r.unlock) this.addUnlock(pw, r.unlock);
      pw.dailyClaimed.ids.push(questId);
      return { ok: true, msg: `领取奖励：${r.gold ? '金币+' + r.gold + ' ' : ''}${r.exp ? '经验+' + r.exp : ''}`, type: q.type, data: r };
    }
    // 周常：按本周字符串判定
    if (q.type === 'weekly') {
      const w = weekStr();
      if (pw.weeklyClaimed.week !== w) pw.weeklyClaimed = { week: w, ids: [] };
      if (pw.weeklyClaimed.ids.includes(questId)) return { ok: false, msg: '本周已完成' };
      if (pw.weeklyClaimed.ids.length >= WEEKLY_CAP) return { ok: false, msg: '本周完成上限' };
      const r = q.rewards || {};
      if (r.gold) this.addGold(pw, r.gold);
      if (r.exp) this.gainExp(pw, r.exp);
      if (r.items) for (const it of r.items) this.grantItem(pw, { id: it.id, name: it.name, type: 'consumable', desc: '', quantity: it.count });
      if (r.unlock) this.addUnlock(pw, r.unlock);
      pw.weeklyClaimed.ids.push(questId);
      return { ok: true, msg: `领取奖励：${r.gold ? '金币+' + r.gold + ' ' : ''}${r.exp ? '经验+' + r.exp : ''}`, type: q.type, data: r };
    }
    // 主线 / 支线
    if (pw.completedQuests.includes(questId)) return { ok: false, msg: '已完成' };
    const r = q.rewards || {};
    if (r.gold) this.addGold(pw, r.gold);
    if (r.exp) this.gainExp(pw, r.exp);
    if (r.items) for (const it of r.items) this.grantItem(pw, { id: it.id, name: it.name, type: 'consumable', desc: '', quantity: it.count });
    if (r.unlock) this.addUnlock(pw, r.unlock);
    pw.completedQuests.push(questId);
    return { ok: true, msg: `领取奖励：${r.gold ? '金币+' + r.gold + ' ' : ''}${r.exp ? '经验+' + r.exp : ''}`, type: q.type, data: r };
  }

  // ───────────────── 副本（独立实例·周共享3次） ─────────────────
  /**
   * 进入副本：按日历周 + 上限判定（全部副本共享 3 次/周，按"进入"计次）。
   * - 若已有同副本活动进度 → 视为续打，免费（不计次）。
   * - 否则若本周次数已用完 → 拒绝。
   * - 否则计 1 次并设为活动副本。
   * 例：进2次副本1 + 1次副本2 = 3 次（满）。
   */
  enterDungeon(pw: PlayerWorld, dungeonId: number): OpResult {
    const w = weekStr();
    if (pw.dungeonWeekly.week !== w) pw.dungeonWeekly = { week: w, count: 0 };
    // 续打同副本：免费
    if (pw.dungeon && pw.dungeon.dungeonId === dungeonId) {
      return { ok: true, msg: '继续副本', data: { resumed: true, remaining: DUNGEON_WEEKLY_CAP - pw.dungeonWeekly.count } };
    }
    // 新进入：计次
    if (pw.dungeonWeekly.count >= DUNGEON_WEEKLY_CAP) {
      return { ok: false, msg: '本周副本次数已用完（共享3次）' };
    }
    pw.dungeonWeekly.count += 1;
    pw.dungeon = { dungeonId, stage: 1 };
    return { ok: true, msg: '进入副本', data: { resumed: false, remaining: DUNGEON_WEEKLY_CAP - pw.dungeonWeekly.count } };
  }

  /** 副本全部 3 阶通关：清除活动副本（下次进入重新计次）。 */
  completeDungeon(pw: PlayerWorld, dungeonId: number): void {
    if (pw.dungeon && pw.dungeon.dungeonId === dungeonId) pw.dungeon = null;
  }

  // ───────────────── 装备 / 卸下 ─────────────────
  equip(pw: PlayerWorld, itemId: string): OpResult {
    const item = pw.inventory.find(i => i.id === itemId && i.type === 'equipment');
    if (!item || !item.slot) return { ok: false, msg: '无此装备' };
    const old = pw.equipment[item.slot];
    pw.equipment[item.slot] = item;
    pw.inventory = pw.inventory.filter(i => i !== item);
    if (old) pw.inventory.push(old);
    return { ok: true, msg: `装备 ${item.name}` };
  }
  unequip(pw: PlayerWorld, slot: EquipSlot): OpResult {
    const item = pw.equipment[slot];
    if (!item) return { ok: false, msg: '该槽位为空' };
    pw.equipment[slot] = null;
    pw.inventory.push(item);
    return { ok: true, msg: `卸下 ${item.name}` };
  }

  // ───────────────── 采集 ─────────────────
  gather(pw: PlayerWorld, zone: number, nodeIdx: number, x: number, y: number): OpResult {
    const cfg = ZONE_CONFIGS[zone];
    if (!cfg) return { ok: false, msg: '无效区域' };
    const g = cfg.gathering[nodeIdx];
    if (!g) return { ok: false, msg: '无效节点' };
    const nodeId = `${zone}:${nodeIdx}`;
    const node = pw.gatherNodes[nodeId] || { consumed: false, respawnAt: 0 };
    if (node.consumed && Date.now() < node.respawnAt) return { ok: false, msg: '节点采集中，稍后再来' };
    const nx = g.x * GAME_WIDTH * 3, ny = g.y * GAME_HEIGHT * 2;
    if (Math.hypot(x - nx, y - ny) > 90) return { ok: false, msg: '距离过远' };
    node.consumed = true; node.respawnAt = Date.now() + GATHER_RESPAWN_MS;
    pw.gatherNodes[nodeId] = node;
    const matName = NODE_TO_MATERIAL[g.type] || g.type;
    this.grantItem(pw, { id: matId(matName), name: matName, type: 'material', desc: '野外采集获得', quantity: 1 });
    return { ok: true, msg: `获得 ${matName}`, data: { nodeId, matName } };
  }

  // ───────────────── 商店购买 ─────────────────
  private shopCatalogItem(itemId: string): any | null {
    for (const cfg of Object.values(ZONE_CONFIGS)) {
      for (const npc of cfg.npcs) {
        if (!npc.shop) continue;
        const hit = npc.shop.find(s => s.id === itemId);
        if (hit) return hit;
      }
    }
    return null;
  }
  buy(pw: PlayerWorld, itemId: string): OpResult {
    const s = this.shopCatalogItem(itemId);
    if (!s) return { ok: false, msg: '无此商品' };
    if (!this.spendGold(pw, s.price)) return { ok: false, msg: '金币不足' };
    const bought: WorldItem = { id: s.id, name: s.name, type: 'equipment', desc: s.desc || '', quantity: 1, slot: s.slot as EquipSlot, stats: s.stats as Partial<Record<string, number>>, quality: s.quality || 'white', set: (s as any).set };
    // 与单机行为一致：购买后直接装备（旧装备回包）
    this.equip(pw, this.pushAndReturnId(pw, bought));
    return { ok: true, msg: `购买并装备 ${s.name}`, data: { gold: pw.gold } };
  }
  private pushAndReturnId(pw: PlayerWorld, item: WorldItem): string {
    pw.inventory.push({ ...item, quantity: 1 });
    return pw.inventory[pw.inventory.length - 1].id;
  }

  // ───────────────── 商城购买 ─────────────────
  /** 商城购买（联机权威）。当前仅上架「洗点符」，价格随等级变化（沿用 10-角色系统 §8 洗点费用 = 等级×200 金币）。 */
  mallBuy(pw: PlayerWorld, itemId: string): OpResult {
    if (itemId !== 'respec_charm') return { ok: false, msg: '商城无此商品' };
    const price = (pw.level || 1) * 200;
    if (!this.spendGold(pw, price)) return { ok: false, msg: '金币不足' };
    this.grantItem(pw, { id: 'respec_charm', name: '洗点符', type: 'consumable', desc: '使用后退还全部已分配属性点，可重新分配', quantity: 1 });
    return { ok: true, msg: `购买 洗点符（花费 ${price} 金币）` };
  }

  /** 洗点（联机权威）。消耗背包中的洗点符，退还全部已分配属性点到 statPoints。客户端不可自减，必须由服务端执行。 */
  respec(pw: PlayerWorld): OpResult {
    const sum = (pw.allocatedHP || 0) + (pw.allocatedMP || 0) + (pw.allocatedATK || 0) + (pw.allocatedDEF || 0) + (pw.allocatedMATK || 0) + (pw.allocatedMDEF || 0) + (pw.allocatedSPD || 0);
    if (sum <= 0) return { ok: false, msg: '当前没有已分配的点数' };
    const charm = pw.inventory.find(i => i.id === 'respec_charm' && i.type === 'consumable');
    if (!charm) return { ok: false, msg: '没有洗点符，请先到商城购买' };
    charm.quantity -= 1;
    if (charm.quantity <= 0) pw.inventory = pw.inventory.filter(i => i !== charm);
    pw.allocatedHP = 0; pw.allocatedMP = 0; pw.allocatedATK = 0; pw.allocatedDEF = 0; pw.allocatedMATK = 0; pw.allocatedMDEF = 0; pw.allocatedSPD = 0;
    pw.statPoints += sum;
    return { ok: true, msg: `洗点成功，已退还 ${sum} 点属性` };
  }

  // ───────────────── 制造 ─────────────────
  craft(pw: PlayerWorld, recipeName: string, zone?: number): OpResult {
    const r = CRAFT_RECIPES[recipeName];
    if (!r) return { ok: false, msg: '无此配方' };
    for (const [mat, qty] of Object.entries(r.cost)) {
      if (this.countMaterial(pw, mat) < qty) return { ok: false, msg: `${mat}不足` };
    }
    for (const [mat, qty] of Object.entries(r.cost)) this.takeMaterial(pw, mat, qty);
    // 制造装备按「区域(玩家当前所在区，缺省回退配方 zone/1) + 品质」打套装标，
    // 与同区同品质掉落/商店装备共享套装（设计确认：制造装备即归属玩家当前所在区）。
    const zoneForSet = zone ?? r.result.zone ?? 1;
    const made: WorldItem = { ...r.result, set: makeSetId(zoneForSet, r.result.quality || 'green') };
    this.grantItem(pw, made);
    return { ok: true, msg: `制造成功：${recipeName}`, data: { name: recipeName } };
  }

  // ───────────────── 测试用：发放套装测试装备 ─────────────────
  /**
   * Dev 作弊键(Ctrl+E) 触发：发放一套「同区域 + 同品质」的测试装备（5 防具 + 4 饰品）并全部装备，
   * 便于在联机下直接验证套装加成（无需靠掉落 RNG 凑齐）。
   * 仅测试用途，经 intent 授权、服务端权威发放并 worldSync 下发；落库以免重连丢失。
   */
  grantSetTestGear(pw: PlayerWorld, zone: number, quality: string): OpResult {
    const setId = makeSetId(zone, quality);
    const armorSlots: EquipSlot[] = ['head', 'body', 'bracer', 'boots', 'belt'];
    const jewelSlots: EquipSlot[] = ['ring', 'necklace', 'charm', 'pendant'];
    const names: Record<string, string> = { head: '头盔', body: '铠甲', bracer: '护腕', boots: '靴子', belt: '腰带', ring: '戒指', necklace: '项链', charm: '护符', pendant: '挂饰' };
    const armorStats: Record<string, number> = { def: 30, hp: 30 };
    const jewelStats: Record<string, number> = { matk: 25, mp: 25 };
    const give = (slot: EquipSlot, stats: Record<string, number>) => {
      const item: WorldItem = {
        id: `devset_${setId}_${slot}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
        name: `测试·${names[slot]}`, type: 'equipment', desc: `测试套装·第${zone}区·${quality}`,
        quantity: 1, slot, stats, quality, set: setId,
      };
      this.grantItem(pw, item);
      this.equip(pw, item.id);
    };
    armorSlots.forEach(s => give(s, armorStats));
    jewelSlots.forEach(s => give(s, jewelStats));
    return { ok: true, msg: `已发放测试套装 第${zone}区·${quality}（5防具+4饰品已装备）` };
  }

  // ───────────────── 灵宠系统（服务端权威） ─────────────────
  /** 获得一只灵宠（按物种生成 Lv1 属性快照，随机品质与先天技能）。首只自动出战。 */
  createPet(pw: PlayerWorld, speciesId: string, name?: string, zoneOverride?: number): OpResult {
    const sp = PET_SPECIES[speciesId];
    if (!sp) return { ok: false, msg: '未知灵宠物种' };
    if (!Array.isArray(pw.pets)) pw.pets = [];
    if (pw.pets.length >= PET_SLOT_CAP) return { ok: false, msg: `灵宠栏已满（上限 ${PET_SLOT_CAP}）` };
    const quality = rollPetQuality(zoneOverride ?? sp.obtainZone);
    const attrs = { str: 0, vit: 0, agi: 0, int: 0 };
    const stats = computePetStats(sp, 1, quality, attrs);
    const pet: Pet = {
      id: genPetId(), speciesId, name: name || sp.name, level: 1, exp: 0,
      element: sp.element, quality,
      hp: stats.hp, maxHp: stats.hp, atk: stats.atk, def: stats.def, matk: stats.matk, mdef: stats.mdef, spd: stats.spd,
      attrStr: 0, attrVit: 0, attrAgi: 0, attrInt: 0, attrPoints: 0,
      skills: [...sp.skillIds], loyalty: 50, active: pw.pets.length === 0,
    };
    pw.pets.push(pet);
    return { ok: true, msg: `获得灵宠 ${pet.name}`, data: { pet } };
  }

  /** 设置出战灵宠（同玩家仅一只出战）。 */
  setActivePet(pw: PlayerWorld, petId: string): OpResult {
    if (!Array.isArray(pw.pets)) pw.pets = [];
    const pet = pw.pets.find(p => p.id === petId);
    if (!pet) return { ok: false, msg: '灵宠不存在' };
    pw.pets.forEach(p => { p.active = p.id === petId; });
    return { ok: true, msg: `${pet.name} 已出战` };
  }

  /** 给灵宠加经验并自动升级（重算属性快照，回满血，按品质发放属性点）。 */
  addPetExp(pw: PlayerWorld, petId: string, amount: number): OpResult {
    if (!Array.isArray(pw.pets)) pw.pets = [];
    const pet = pw.pets.find(p => p.id === petId);
    if (!pet) return { ok: false, msg: '灵宠不存在' };
    const sp = PET_SPECIES[pet.speciesId];
    if (!sp) return { ok: false, msg: '灵宠物种缺失' };
    pet.exp += Math.max(0, amount);
    let leveled = false, gainedPoints = 0;
    while (pet.level < 70 && pet.exp >= petExpForLevel(pet.level)) {
      pet.exp -= petExpForLevel(pet.level);
      pet.level++;
      leveled = true;
      gainedPoints += (PET_QUALITIES[pet.quality] || PET_QUALITIES.normal).attrPerLevel;
    }
    if (leveled) {
      pet.attrPoints += gainedPoints;
      const attrs = { str: pet.attrStr, vit: pet.attrVit, agi: pet.attrAgi, int: pet.attrInt };
      const s = computePetStats(sp, pet.level, pet.quality, attrs);
      pet.hp = pet.maxHp = s.hp; pet.atk = s.atk; pet.def = s.def; pet.matk = s.matk; pet.mdef = s.mdef; pet.spd = s.spd;
    }
    return { ok: true, msg: leveled ? `${pet.name} 升至 Lv${pet.level}` : '经验已增加', data: { leveled, level: pet.level, gainedPoints } };
  }

  /** 分配灵宠属性点（attr: str/vit/agi/int，delta: +1/-1）。 */
  setPetAttr(pw: PlayerWorld, petId: string, attr: 'str' | 'vit' | 'agi' | 'int', delta: number): OpResult {
    if (!Array.isArray(pw.pets)) pw.pets = [];
    const pet = pw.pets.find(p => p.id === petId);
    if (!pet) return { ok: false, msg: '灵宠不存在' };
    const sp = PET_SPECIES[pet.speciesId];
    if (!sp) return { ok: false, msg: '灵宠物种缺失' };
    const fields: Record<string, keyof Pet> = { str: 'attrStr', vit: 'attrVit', agi: 'attrAgi', int: 'attrInt' };
    const field = fields[attr];
    if (!field) return { ok: false, msg: '未知属性' };
    const cur = (pet as any)[field] as number;
    if (delta > 0 && pet.attrPoints <= 0) return { ok: false, msg: '无可用属性点' };
    if (delta < 0 && cur <= 0) return { ok: false, msg: '该属性点已为 0' };
    (pet as any)[field] = cur + delta;
    pet.attrPoints -= delta;
    const attrs = { str: pet.attrStr, vit: pet.attrVit, agi: pet.attrAgi, int: pet.attrInt };
    const s = computePetStats(sp, pet.level, pet.quality, attrs);
    pet.hp = pet.maxHp = s.hp; pet.atk = s.atk; pet.def = s.def; pet.matk = s.matk; pet.mdef = s.mdef; pet.spd = s.spd;
    return { ok: true, msg: `${pet.name} 属性已更新` };
  }

  /** 放生灵宠（若出战中则改由首只接替出战）。 */
  releasePet(pw: PlayerWorld, petId: string): OpResult {
    if (!Array.isArray(pw.pets)) pw.pets = [];
    const idx = pw.pets.findIndex(p => p.id === petId);
    if (idx < 0) return { ok: false, msg: '灵宠不存在' };
    const wasActive = pw.pets[idx].active;
    const name = pw.pets[idx].name;
    pw.pets.splice(idx, 1);
    if (wasActive && pw.pets.length > 0) pw.pets[0].active = true;
    return { ok: true, msg: `已放生 ${name}` };
  }

  /** 收回出战（取消出战，不删除灵宠；同玩家可无出战灵宠）。 */
  recallPet(pw: PlayerWorld, petId: string): OpResult {
    if (!Array.isArray(pw.pets)) pw.pets = [];
    const pet = pw.pets.find(p => p.id === petId);
    if (!pet) return { ok: false, msg: '灵宠不存在' };
    pet.active = false;
    return { ok: true, msg: `${pet.name} 已收回` };
  }

  /** 开启灵宠蛋：随机物种 + 按蛋携带的 zone 定品质；消耗一枚蛋；灵宠栏满则拒绝。 */
  openPetEgg(pw: PlayerWorld, itemId: string): OpResult {
    if (!Array.isArray(pw.pets)) pw.pets = [];
    const egg = pw.inventory.find(i => i.id === itemId && i.type === 'pet_egg');
    if (!egg) return { ok: false, msg: '背包里没有这枚灵宠蛋' };
    if (pw.pets.length >= PET_SLOT_CAP) return { ok: false, msg: `灵宠栏已满（上限 ${PET_SLOT_CAP}），无法开启灵宠蛋` };
    const keys = Object.keys(PET_SPECIES);
    const speciesId = keys[Math.floor(Math.random() * keys.length)];
    const res = this.createPet(pw, speciesId, undefined, egg.zone);
    if (!res.ok) return res;
    egg.quantity -= 1;
    if (egg.quantity <= 0) pw.inventory = pw.inventory.filter(i => i !== egg);
    const pet = res.data?.pet as Pet;
    const el = PET_ELEMENTS[pet.element as PetElement]?.label || pet.element;
    const q = PET_QUALITIES[pet.quality as PetQuality]?.label || pet.quality;
    return { ok: true, msg: `孵化成功！获得灵宠「${pet.name}」（${el}·${q}）`, data: { pet } };
  }

  /** Dev：直接发放一枚灵宠蛋到背包（供测试 / 调试；生产经战斗掉落）。 */
  grantPetEgg(pw: PlayerWorld, zone: number = 1): OpResult {
    this.grantItem(pw, { id: 'pet_egg', name: '灵宠蛋', type: 'pet_egg', desc: '双击开启，随机孵化一只灵宠', quantity: 1, zone });
    return { ok: true, msg: '获得灵宠蛋' };
  }

  /** 取当前出战灵宠（无则 null）。 */
  getActivePet(pw: PlayerWorld): Pet | null {
    if (!Array.isArray(pw.pets)) return null;
    return pw.pets.find(p => p.active) || null;
  }

  /** Dev 作弊键触发：发放一只灵宠（随机物种或指定）。服务端权威，落库以免重连丢失。 */
  grantPetTest(pw: PlayerWorld, speciesId?: string, level?: number): OpResult {
    const keys = Object.keys(PET_SPECIES);
    const id = speciesId && PET_SPECIES[speciesId] ? speciesId : keys[Math.floor(Math.random() * keys.length)];
    const r = this.createPet(pw, id);
    if (!r.ok || !level || level <= 1) return r;
    const pet = (r.data as any)?.pet as Pet | undefined;
    if (!pet) return r;
    // 灌经验把宠物拉到指定等级（按品质发放属性点），便于测试 petSetAttr
    let need = 0;
    for (let lv = 1; lv < level; lv++) need += petExpForLevel(lv);
    this.addPetExp(pw, pet.id, need);
    return r;
  }

  // ───────────────── 强化 / 精炼 / 分解 / 重铸 ─────────────────
  /** 按 id 在装备栏或背包中查找装备（返回所在槽位，背包内则为 item.slot）。 */
  private findItemById(pw: PlayerWorld, itemId: string): { item: WorldItem; slot: EquipSlot | null } | null {
    for (const slot of Object.keys(pw.equipment) as EquipSlot[]) {
      const it = pw.equipment[slot];
      if (it && it.id === itemId) return { item: it, slot };
    }
    const bag = pw.inventory.find(i => i.id === itemId && i.type === 'equipment');
    // 背包内装备：未装备，slot 必须置 null。切忌用 bag.slot——背包 item 的 slot 字段是装备类型名（'weapon' 等，truthy），
    // 若误当 slot 返回，decompose 会走 `pw.equipment[slot]=null` 分支清空装备栏对应槽位，而非从 inventory 移除该装备，导致分解"成功但装备仍在"。
    if (bag) return { item: bag, slot: null };
    return null;
  }
  private enhanceCost(lv: number, quality: string): { gold: number; crystals: number } {
    const q = QUALITY_MULT[quality] || 1.0;
    const base = 200 + lv * 150;
    return { gold: Math.round(base * q), crystals: 1 + Math.floor(lv / 3) };
  }
  enhance(pw: PlayerWorld, itemId: string): OpResult {
    const found = this.findItemById(pw, itemId);
    if (!found) return { ok: false, msg: '无此装备' };
    const item = found.item;
    const lv = item.enhanceLevel || 0;
    if (lv >= 10) return { ok: false, msg: '已达强化上限 +10' };
    const cost = this.enhanceCost(lv, item.quality || 'white');
    if (pw.gold < cost.gold) return { ok: false, msg: '金币不足' };
    if (this.countMaterial(pw, '灵晶碎片') < cost.crystals) return { ok: false, msg: `灵晶碎片不足 (需要${cost.crystals})` };
    this.spendGold(pw, cost.gold);
    this.takeMaterial(pw, '灵晶碎片', cost.crystals);
    const rate = ENHANCE_RATES[lv];
    const roll = Math.random();
    if (roll < rate) {
      item.enhanceLevel = lv + 1;
      return { ok: true, msg: `强化成功！+${lv + 1}`, data: { newLevel: lv + 1, destroyed: false } };
    }
    if (lv === 9) { item.enhanceLevel = 0; return { ok: false, msg: '强化失败！装备碎裂...', data: { destroyed: true } }; }
    if (lv === 8) { item.enhanceLevel = lv - 2; return { ok: false, msg: `强化失败！等级降至 +${lv - 2}`, data: { newLevel: lv - 2 } }; }
    if (lv === 7) { item.enhanceLevel = lv - 1; return { ok: false, msg: `强化失败！等级降至 +${lv - 1}`, data: { newLevel: lv - 1 } }; }
    return { ok: false, msg: '强化失败！等级不变', data: { newLevel: lv } };
  }
  refine(pw: PlayerWorld, itemId: string): OpResult {
    const found = this.findItemById(pw, itemId);
    if (!found) return { ok: false, msg: '无此装备' };
    const item = found.item;
    const q = item.quality || 'white';
    const maxSlots = REFINE_SLOTS[q] || 1;
    const cur = item.refineStats?.length || 0;
    if (cur >= maxSlots) return { ok: false, msg: `词条已满 (${maxSlots}条)` };
    const slotIdx = cur + 1;
    const mat = REFINE_MAT_MAP[q] || '铁矿石';
    const matQty = Math.round(slotIdx * 2 * (QUALITY_MULT[q] || 1.0));
    const goldCost = Math.round((150 + slotIdx * 100) * (QUALITY_MULT[q] || 1.0));
    if (pw.gold < goldCost) return { ok: false, msg: '金币不足' };
    if (this.countMaterial(pw, mat) < matQty) return { ok: false, msg: `${mat}不足 (需要${matQty})` };
    this.spendGold(pw, goldCost);
    this.takeMaterial(pw, mat, matQty);
    // 随机词条
    const totalW = REFINE_STAT_POOL.reduce((s, e) => s + e.weight, 0);
    let r = Math.random() * totalW; let picked = REFINE_STAT_POOL[0];
    for (const e of REFINE_STAT_POOL) { r -= e.weight; if (r <= 0) { picked = e; break; } }
    const base = 2 + Math.floor(Math.random() * 5);
    const value = Math.max(1, Math.round(base * (QUALITY_MULT[q] || 1.0) * 0.8));
    if (!item.refineStats) item.refineStats = [];
    item.refineStats.push({ key: picked.key, value });
    return { ok: true, msg: `精炼成功！获得 ${picked.key}+${value}`, data: { stat: { key: picked.key, value } } };
  }
  decompose(pw: PlayerWorld, itemId: string): OpResult {
    const found = this.findItemById(pw, itemId);
    if (!found) return { ok: false, msg: '无此装备' };
    const item = found.item; const slot = found.slot;
    const q = item.quality || 'white';
    const baseMats = DECOMP_MATERIALS[q] || DECOMP_MATERIALS.white;
    const enhanceLv = item.enhanceLevel || 0;
    let totalCrystals = 0; for (let l = 0; l < enhanceLv; l++) totalCrystals += 1 + Math.floor(l / 3);
    const crystalReturn = Math.floor(totalCrystals * 0.4);
    const refineBonus = Math.min(item.refineStats?.length || 0, 1);
    const mats = baseMats.map(m => {
      let qty = m.qty;
      if (m.name === '灵晶碎片') qty = crystalReturn;
      return { name: m.name, qty: Math.max(qty, 0) };
    });
    if (refineBonus > 0 && mats.length > 0) mats[0].qty += refineBonus;
    const goldReturn = (DECOMP_GOLD_BASE[q] || 30) + enhanceLv * 30;
    for (const m of mats.filter(x => x.qty > 0)) {
      const ex = pw.inventory.find(i => i.name === m.name && i.type === 'material');
      if (ex) ex.quantity += m.qty; else pw.inventory.push({ id: matId(m.name), name: m.name, type: 'material', desc: '分解所得', quantity: m.qty });
    }
    this.addGold(pw, goldReturn);
    if (slot) pw.equipment[slot] = null;
    else pw.inventory = pw.inventory.filter(i => i !== item);
    const matStr = mats.filter(x => x.qty > 0).map(m => `${m.name}×${m.qty}`).join(', ');
    return { ok: true, msg: `分解完成！获得 ${matStr}，金币 +${goldReturn}`, data: { materials: mats, gold: goldReturn } };
  }
  refineReset(pw: PlayerWorld, itemId: string): OpResult {
    const found = this.findItemById(pw, itemId);
    if (!found) return { ok: false, msg: '无此装备' };
    const item = found.item;
    if (!item.refineStats || item.refineStats.length === 0) return { ok: false, msg: '暂无精炼词条' };
    if (pw.gold < 500) return { ok: false, msg: '金币不足（需要500）' };
    pw.gold -= 500;
    item.refineStats = [];
    return { ok: true, msg: '重铸完成，词条已清除' };
  }
}

/** 进程内单一实例：所有房间的玩家权威世界状态共享于此（内存态，重启即重置；账号/持久化留待 Stage D）。 */
export const world = new WorldService();
