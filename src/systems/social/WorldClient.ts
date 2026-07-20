/**
 * 联机权威世界状态 · 客户端桥接
 * ----------------------------------------------------------------
 * 客户端不发「我获得了 X」，只发「意图(intent)」，由服务端校验并改写权威状态，
 * 再通过 worldSync 把完整 PlayerWorld 下发，本模块负责把其 reconcile 进本地
 * Inventory / GameState 缓存（背包/装备/金币/等级/经验/图鉴/已完成任务）。
 *
 * 断连（gameRoom 丢失）时所有「内容操作意图」一律被拒并提示，杜绝本地内存被改写
 * 后仍能继续采集/买卖/制造/强化/领奖——下次 worldSync 以服务端真相覆盖，本地无效。
 */
import { Inventory } from '../items/Inventory';
import { GameState } from '../progression/GameState';
import { Kido } from '../combat/Kido';

/** 服务端 PlayerWorld 的客户端镜像类型（与 server/world.ts 保持一致，独立声明避免把服务端代码打进客户端包）。 */
export interface WorldItem {
  id: string; name: string; type: string; desc: string; quantity: number;
  slot?: string; stats?: Record<string, number>; quality?: string;
  set?: string; // 套装标识 `${zone}_${quality}`
  enhanceLevel?: number; refineStats?: Array<{ key: string; value: number }>;
}
/** 灵宠客户端镜像类型（与服务端 world.ts 的 Pet 保持一致）。 */
export interface Pet {
  id: string; speciesId: string; name: string;
  level: number; exp: number;
  element: string; quality: string;
  hp: number; maxHp: number;
  atk: number; def: number; matk: number; mdef: number; spd: number;
  attrStr: number; attrVit: number; attrAgi: number; attrInt: number;
  attrPoints: number;
  skills: string[];
  loyalty: number; active: boolean;
}
export const PET_SLOT_CAP_CLIENT = 6;
export interface PlayerWorld {
  inventory: WorldItem[];
  equipment: Record<string, WorldItem | null>;
  gold: number; level: number; exp: number; statPoints: number;
  allocatedHP: number; allocatedMP: number; allocatedATK: number; allocatedDEF: number; allocatedMATK: number; allocatedMDEF: number; allocatedSPD: number;
  quests: Record<string, number>;
  completedQuests: string[];
  bestiary: Record<string, number>;
  gatherNodes: Record<string, { consumed: boolean; respawnAt: number }>;
  dailyClaimed?: { date: string; ids: string[] };
  weeklyClaimed?: { week: string; ids: string[] };
  dungeonWeekly?: { week: string; count: number };
  dungeon?: { dungeonId: number; stage: number } | null;
  unlocks?: string[];
  zanpakuto?: string;
  kidoSchool?: string | null;
  kidoNodes?: Record<string, number>;
  kidoEquipped?: string[];
  kidoPoints?: number;
  bestiaryTierClaimed?: number[];
  unlockedTitles?: string[];
  activeTitle?: string | null;
  arena?: {
    season: number; points: number; tier: string; seasonBestTier: string;
    bestTierEver: string; weeklyUsed: number; week: string;
    history: Array<{ season: number; tier: string; points: number }>;
  } | null;
  pets: Pet[];
}

/** 副本进度客户端镜像（供地图传送阵提示使用）。 */
export let dungeonProgress: { dungeonId: number; stage: number } | null = null;
export let dungeonWeekly: { week: string; count: number } = { week: '', count: 0 };
export const DUNGEON_WEEKLY_CAP = 3;

/** PVP 竞技场状态客户端镜像（供 C 面板 / 竞技场面板展示，来自 worldSync 的 pw.arena）。 */
export let arena: any = null;
export const ARENA_WEEKLY_CAP_CLIENT = 20;
export const ARENA_TIERS_CLIENT: { id: string; name: string }[] = [
  { id: 'bronze', name: '青铜' }, { id: 'silver', name: '白银' }, { id: 'gold', name: '黄金' },
  { id: 'platinum', name: '白金' }, { id: 'diamond', name: '钻石' }, { id: 'king', name: '王者' },
];
export function tierNameById(id: string): string {
  return ARENA_TIERS_CLIENT.find((t) => t.id === id)?.name || '青铜';
}

let activeRoom: any = null;
let disconnectNotifier: ((msg: string) => void) | null = null;

/** 由 GameScene 在连接/断开 game 房间时调用。 */
export function setActiveRoom(room: any | null): void { activeRoom = room; }
export function setDisconnectNotifier(fn: (msg: string) => void): void { disconnectNotifier = fn; }

function sendIntent(op: string, data: Record<string, any>): boolean {
  if (!activeRoom) { disconnectNotifier?.('已断开连接，无法操作'); return false; }
  activeRoom.send('intent', { op, ...data });
  return true;
}

// ——— 内容操作意图（联机时发送；断连被拒）———
export function requestGather(zone: number, nodeIdx: number, x: number, y: number): boolean {
  return sendIntent('gather', { zone, nodeIdx, x, y });
}
export function requestBuy(itemId: string): boolean {
  return sendIntent('buy', { itemId });
}
export function requestEquip(itemId: string): boolean {
  return sendIntent('equip', { itemId });
}
export function requestUnequip(slot: string): boolean {
  return sendIntent('unequip', { slot });
}
export function requestCraft(recipeName: string, zone?: number): boolean {
  return sendIntent('craft', { recipeName, zone });
}
export function requestEnhance(itemId: string): boolean {
  return sendIntent('enhance', { itemId });
}
export function requestRefine(itemId: string): boolean {
  return sendIntent('refine', { itemId });
}
export function requestDecompose(itemId: string): boolean {
  return sendIntent('decompose', { itemId });
}
export function requestRefineReset(itemId: string): boolean {
  return sendIntent('refineReset', { itemId });
}

/** 分配属性点（联机时发送；服务端权威记账 + 持久化）。断连被拒。 */
export function requestAllocateStat(attr: string): boolean {
  return sendIntent('allocateStat', { attr });
}
/** 商城购买（联机权威）。当前仅洗点符。断连被拒。 */
export function requestMallBuy(itemId: string): boolean {
  return sendIntent('mallBuy', { itemId });
}
/** 洗点（联机权威）：消耗背包洗点符，退还全部已分配属性点。断连被拒。 */
export function requestRespec(): boolean {
  return sendIntent('respec', {});
}
/** Dev 作弊键(Ctrl+E)：联机下向服务端申请发放「同区域同品质」测试套装（服务端权威发放并 worldSync 下发）。 */
export function requestDevGrantSet(zone: number, quality: string): boolean {
  return sendIntent('devGrantSet', { zone, quality });
}
/** 行会商店购买（联机权威）：用个人贡献兑换公会专属物资，服务端扣贡献并发放物品/称号。断连被拒。 */
export function requestGuildShopBuy(itemId: string): boolean {
  return sendIntent('guildBuy', { itemId });
}

// ——— 拍卖行（一口价）———
export function requestAuctionList(filter: any): boolean { return sendIntent('auctionList', { filter }); }
export function requestAuctionMine(): boolean { return sendIntent('auctionMine', {}); }
export function requestAuctionFavList(): boolean { return sendIntent('auctionFavList', {}); }
export function requestAuctionHistory(): boolean { return sendIntent('auctionHistory', {}); }
export function requestAuctionFav(auctionId: number, on: boolean): boolean { return sendIntent('auctionFav', { auctionId, on }); }
export function requestAuctionCreate(itemId: string, qty: number, price: number): boolean { return sendIntent('auctionCreate', { itemId, qty, price }); }
export function requestAuctionBuy(auctionId: number): boolean { return sendIntent('auctionBuy', { auctionId }); }
export function requestAuctionCancel(auctionId: number): boolean { return sendIntent('auctionCancel', { auctionId }); }
// ——— 灵宠系统 ———
export function requestPetSetActive(petId: string): boolean { return sendIntent('petSetActive', { petId }); }
export function requestPetRelease(petId: string): boolean { return sendIntent('petRelease', { petId }); }
export function requestPetGrantDev(speciesId?: string): boolean { return sendIntent('petGrantDev', { speciesId: speciesId || null }); }
/** 开启灵宠蛋（服务端权威：随机物种 + 按蛋 zone 定品质，消耗一枚蛋）。 */
export function requestUsePetEgg(itemId: string): boolean { return sendIntent('usePetEgg', { itemId }); }
export function requestPetRecall(petId: string): boolean { return sendIntent('petRecall', { petId }); }
export function requestPetSetAttr(petId: string, attr: string, delta: number): boolean { return sendIntent('petSetAttr', { petId, attr, delta }); }
export function requestClaimQuest(questId: string): boolean {
  return sendIntent('claimQuest', { questId });
}

/** 是否处于联机（已连接 game 房间）。用于「联机发意图 / 单机本地改」分支判断。 */
export function isOnline(): boolean { return !!activeRoom; }

/** 解锁六大力量体系（始解/卍解/虚化…）。始解时一并传入所选斩魄刀真名，由服务端随解锁持久化。 */
export function requestUnlock(key: string, zanpakuto?: string): boolean { return sendIntent('unlock', { key, zanpakuto }); }
/** 设置/修正所选斩魄刀真名（持久化）。用于始解首解落库及旧档迁移补存。 */
export function requestSetZanpakuto(zanpakuto: string): boolean { return sendIntent('setZanpakuto', { zanpakuto }); }
/** 设置鬼道主修系别。 */
export function requestKidoSetSchool(school: string): boolean { return sendIntent('kidoSetSchool', { school }); }
/** 鬼道节点加点。 */
export function requestKidoAllocate(nodeId: string): boolean { return sendIntent('kidoAllocate', { nodeId }); }
/** 装备/卸下鬼道主动技能。 */
export function requestKidoEquip(nodeId: string): boolean { return sendIntent('kidoEquip', { nodeId }); }
/** 图鉴层级奖励领取。 */
export function requestClaimBestiaryTier(tierId: number): boolean { return sendIntent('claimBestiaryTier', { tierId }); }
/** 装备/卸下称号。 */
export function requestSetTitle(id: string | null): boolean { return sendIntent('setTitle', { id }); }

// ——— PVP 竞技场匹配（联机权威）———
/** 进入竞技场匹配队列。mode in {'1v1','4v4'}；token 用于 PvpRoom 鉴权。断连被拒。 */
export function requestArenaQueue(mode: string, token: string): boolean {
  return sendIntent('arenaQueue', { mode, token });
}
/** 取消竞技场匹配。 */
export function requestArenaCancel(): boolean { return sendIntent('arenaCancel', {}); }
/** 请求竞技场状态（服务端回 arenaStatus 消息）。 */
export function requestArenaStatus(): boolean { return sendIntent('arenaStatus', {}); }

function mapItem(w: WorldItem): any {
  return {
    id: w.id, name: w.name, type: w.type, desc: w.desc, quantity: w.quantity,
    slot: w.slot, stats: w.stats, quality: w.quality, set: w.set,
    enhanceLevel: w.enhanceLevel, refineStats: w.refineStats,
  };
}

/**
 * 把服务端权威 PlayerWorld 全量 reconcile 进本地缓存。
 * 不动活动任务进度（客户端 UI 自行跟踪），仅同步背包/装备/金币/等级/经验/图鉴/已完成任务。
 */
export function applyWorldSync(scene: any, pw: PlayerWorld): void {
  // 背包 / 装备（全量覆盖——服务端是唯一真相源）
  Inventory.items = pw.inventory.map(mapItem);
  const eq: any = {};
  for (const slot of Object.keys(pw.equipment)) {
    eq[slot] = pw.equipment[slot] ? mapItem(pw.equipment[slot]!) : null;
  }
  Inventory.equipment = eq;

  // 金币 / 等级 / 经验 / 剩余属性点（服务端权威）
  // pw.statPoints 已是「升级发放 - 手动分配」后的剩余值，并随 DB 持久化。
  // 直接以服务端真相覆盖本地——否则重连时 GameState 从 level 1 重新计算升级差额，
  // 会把剩余点数误算成「总获取点数」。升级时服务端 world.gainExp 已把点数计入
  // pw.statPoints，客户端 GameState.gainExp 仅作即时反馈，最终以本处服务端值收口。
  GameState.gold = pw.gold;
  GameState.level = pw.level;
  GameState.exp = pw.exp;
  GameState.statPoints = pw.statPoints || 0;

  // 已分配属性点（服务端权威 + 持久化）：以服务端真相覆盖本地，使分配在重连后保留，且因服务端不可减而天然不可退回。
  GameState.allocatedHP = pw.allocatedHP || 0;
  GameState.allocatedMP = pw.allocatedMP || 0;
  GameState.allocatedATK = pw.allocatedATK || 0;
  GameState.allocatedDEF = pw.allocatedDEF || 0;
  GameState.allocatedMATK = pw.allocatedMATK || 0;
  GameState.allocatedMDEF = pw.allocatedMDEF || 0;
  GameState.allocatedSPD = pw.allocatedSPD || 0;

  // 图鉴击杀（服务端权威）
  GameState.bestiaryKilled = { ...pw.bestiary };

  // 六大力量体系解锁（服务端权威）—— 联机下 combat 读取 GameState.unlocks 判断能否始解/卍解/虚化
  GameState.unlocks = Array.isArray(pw.unlocks) ? [...pw.unlocks] : [];
  // 所选斩魄刀真名（服务端权威 + 持久化）—— 始解/卍解技能表以此查表；仅当服务端有明确值时覆盖，
  // 旧档无此字段(undefined)则保留本地值，交由 GameScene 旧档迁移逻辑引导重选补存。
  if (pw.zanpakuto !== undefined) GameState.zanpakuto = pw.zanpakuto;
  // 鬼道（服务端权威 + 持久化）—— 覆盖 Kido 单例，recalcStats 据此算被动加成
  if (pw.kidoSchool !== undefined) Kido.school = pw.kidoSchool as any;
  if (pw.kidoNodes) Kido.nodes = { ...pw.kidoNodes };
  if (pw.kidoEquipped) Kido.equipped = [...pw.kidoEquipped];
  if (typeof pw.kidoPoints === 'number') Kido.totalPoints = pw.kidoPoints;
  // 图鉴层级奖励已领 + 称号（服务端权威 + 持久化）
  GameState.bestiaryTierClaimed = Array.isArray(pw.bestiaryTierClaimed) ? [...pw.bestiaryTierClaimed] : [];
  GameState.unlockedTitles = Array.isArray(pw.unlockedTitles) ? [...pw.unlockedTitles] : [];
  GameState.activeTitle = pw.activeTitle === undefined ? GameState.activeTitle : pw.activeTitle;

  // 灵宠（服务端权威 + 持久化）：覆盖本地，使出战/属性随 worldSync 实时更新
  GameState.pets = Array.isArray(pw.pets) ? pw.pets : [];

  // 已完成任务（服务端权威；与本地活动任务进度合并，避免本地标记丢失）
  const merged = new Set<string>([...GameState.questCompleted, ...pw.completedQuests]);
  GameState.questCompleted = Array.from(merged);

  // 重新计算属性并刷新 UI
  GameState.recalcStats();
  GameState.evaluateTitleUnlocks();

  // 采集点重生之服务端状态可视化（隐藏已采节点，待服务端刷新时间到再显示）
  if (scene && Array.isArray(scene.gatherPoints)) {
    const zone = GameState.zone;
    scene.gatherPoints.forEach((gp: any, idx: number) => {
      const node = pw.gatherNodes[`${zone}:${idx}`];
      const consumed = !!(node && node.consumed && Date.now() < node.respawnAt);
      if (gp.sprite) gp.sprite.setVisible(!consumed);
      if (gp.label) gp.label.setVisible(!consumed);
    });
  }

  // 称号解锁播报
  const newTitles = GameState.drainTitleNotifications();
  if (newTitles.length && scene && typeof scene.showTitleUnlockNotif === 'function') {
    scene.showTitleUnlockNotif(newTitles);
  }

  // 刷新打开中的面板（实时同步金币/背包/装备）
  if (scene && typeof scene.refreshOpenPanels === 'function') scene.refreshOpenPanels();

  // 每日 / 周常 按本地日期刷新（联机下以服务端 worldSync 到达为基准）
  GameState.ensureDailyRefresh();
  GameState.ensureWeeklyRefresh();

  // 副本进度镜像（地图传送阵提示用）
  dungeonProgress = pw.dungeon ? { dungeonId: pw.dungeon.dungeonId, stage: pw.dungeon.stage ?? 1 } : null;
  dungeonWeekly = pw.dungeonWeekly ? { week: pw.dungeonWeekly.week, count: pw.dungeonWeekly.count } : { week: '', count: 0 };

  // PVP 竞技场状态镜像（C 面板 / 竞技场面板展示）
  arena = pw.arena ? { ...pw.arena } : null;

  // 通知 UIScene 更新数值栏
  if (scene && scene.scene) scene.scene.get('UIScene').events.emit('updateStats');
}
