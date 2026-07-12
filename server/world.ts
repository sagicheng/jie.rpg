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
import { ZONE_CONFIGS } from '../src/systems/Zones';
import { NODE_TO_MATERIAL, matId } from '../src/data/materials';
import { MAIN_QUESTS, SIDE_QUESTS, DAILY_QUESTS, WEEKLY_QUESTS, DAILY_CAP, WEEKLY_CAP, todayStr, weekStr } from '../src/systems/QuestData';
import { expForLevel } from '../src/systems/BattleData';
import { POINTS_PER_LEVEL } from '../src/config';
import type { EquipSlot } from '../src/systems/Inventory';

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
  '铁剑': { cost: { '铁矿石': 3, '灵木枝': 1 }, result: { id: '铁剑', name: '铁剑', type: 'equipment', desc: '手工制造', quantity: 1, slot: 'weapon' as EquipSlot, stats: { atk: 5 }, quality: 'green' } },
  '铁甲': { cost: { '铁矿石': 5, '麻布片': 2 }, result: { id: '铁甲', name: '铁甲', type: 'equipment', desc: '手工制造', quantity: 1, slot: 'body' as EquipSlot, stats: { def: 8, hp: 10 }, quality: 'green' } },
  '铁手甲': { cost: { '铁矿石': 2, '灵木枝': 1 }, result: { id: '铁手甲', name: '铁手甲', type: 'equipment', desc: '手工制造', quantity: 1, slot: 'bracer' as EquipSlot, stats: { atk: 3, def: 3 }, quality: 'green' } },
};

export interface WorldItem {
  id: string; name: string; type: string; desc: string; quantity: number;
  slot?: EquipSlot; stats?: Partial<Record<string, number>>; quality?: string;
  enhanceLevel?: number; refineStats?: Array<{ key: string; value: number }>;
}

/** 副本进行中的活动副本（联机权威，断连不丢；用于周次计次的"续打免计费"判定）。 */
export interface ActiveDungeon {
  dungeonId: number;
}

export interface PlayerWorld {
  inventory: WorldItem[];
  equipment: Record<EquipSlot, WorldItem | null>;
  gold: number; level: number; exp: number; statPoints: number;
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
}

export interface OpResult { ok: boolean; msg: string; data?: any; }

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
    gold: 200, level: 1, exp: 0, statPoints: 0,
    quests: {}, completedQuests: [], bestiary: {}, gatherNodes: {},
    dailyClaimed: { date: '', ids: [] }, weeklyClaimed: { week: '', ids: [] },
    dungeonWeekly: { week: '', count: 0 }, dungeon: null,
  };
}

export class WorldService {
  private worlds = new Map<string, PlayerWorld>();

  /** 取（或首次创建并种子）某玩家的权威世界。 */
  get(sid: string): PlayerWorld {
    let w = this.worlds.get(sid);
    if (!w) { w = seedWorld(); this.worlds.set(sid, w); }
    return w;
  }

  remove(sid: string): void { this.worlds.delete(sid); }

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
  recordKill(pw: PlayerWorld, name: string): void { pw.bestiary[name] = (pw.bestiary[name] || 0) + 1; }

  /** 加经验并升级（与客户端 expForLevel 曲线一致）。 */
  gainExp(pw: PlayerWorld, amount: number): number {
    pw.exp += amount;
    let leveled = 0;
    while (pw.exp >= expForLevel(pw.level + 1)) {
      pw.exp -= expForLevel(pw.level + 1);
      pw.level += 1; leveled += 1;
      pw.statPoints += POINTS_PER_LEVEL;
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
      pw.dailyClaimed.ids.push(questId);
      return { ok: true, msg: `领取奖励：${r.gold ? '金币+' + r.gold + ' ' : ''}${r.exp ? '经验+' + r.exp : ''}`, data: r };
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
      pw.weeklyClaimed.ids.push(questId);
      return { ok: true, msg: `领取奖励：${r.gold ? '金币+' + r.gold + ' ' : ''}${r.exp ? '经验+' + r.exp : ''}`, data: r };
    }
    // 主线 / 支线
    if (pw.completedQuests.includes(questId)) return { ok: false, msg: '已完成' };
    const r = q.rewards || {};
    if (r.gold) this.addGold(pw, r.gold);
    if (r.exp) this.gainExp(pw, r.exp);
    if (r.items) for (const it of r.items) this.grantItem(pw, { id: it.id, name: it.name, type: 'consumable', desc: '', quantity: it.count });
    pw.completedQuests.push(questId);
    return { ok: true, msg: `领取奖励：${r.gold ? '金币+' + r.gold + ' ' : ''}${r.exp ? '经验+' + r.exp : ''}`, data: r };
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
    pw.dungeon = { dungeonId };
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
    const bought: WorldItem = { id: s.id, name: s.name, type: 'equipment', desc: s.desc || '', quantity: 1, slot: s.slot as EquipSlot, stats: s.stats as Partial<Record<string, number>>, quality: s.quality || 'white' };
    // 与单机行为一致：购买后直接装备（旧装备回包）
    this.equip(pw, this.pushAndReturnId(pw, bought));
    return { ok: true, msg: `购买并装备 ${s.name}`, data: { gold: pw.gold } };
  }
  private pushAndReturnId(pw: PlayerWorld, item: WorldItem): string {
    pw.inventory.push({ ...item, quantity: 1 });
    return pw.inventory[pw.inventory.length - 1].id;
  }

  // ───────────────── 制造 ─────────────────
  craft(pw: PlayerWorld, recipeName: string): OpResult {
    const r = CRAFT_RECIPES[recipeName];
    if (!r) return { ok: false, msg: '无此配方' };
    for (const [mat, qty] of Object.entries(r.cost)) {
      if (this.countMaterial(pw, mat) < qty) return { ok: false, msg: `${mat}不足` };
    }
    for (const [mat, qty] of Object.entries(r.cost)) this.takeMaterial(pw, mat, qty);
    this.grantItem(pw, r.result);
    return { ok: true, msg: `制造成功：${recipeName}`, data: { name: recipeName } };
  }

  // ───────────────── 强化 / 精炼 / 分解 / 重铸 ─────────────────
  /** 按 id 在装备栏或背包中查找装备（返回所在槽位，背包内则为 item.slot）。 */
  private findItemById(pw: PlayerWorld, itemId: string): { item: WorldItem; slot: EquipSlot | null } | null {
    for (const slot of Object.keys(pw.equipment) as EquipSlot[]) {
      const it = pw.equipment[slot];
      if (it && it.id === itemId) return { item: it, slot };
    }
    const bag = pw.inventory.find(i => i.id === itemId && i.type === 'equipment');
    if (bag) return { item: bag, slot: (bag.slot as EquipSlot) || null };
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
