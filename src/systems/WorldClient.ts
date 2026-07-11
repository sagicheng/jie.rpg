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
import { Inventory } from './Inventory';
import { GameState } from './GameState';

/** 服务端 PlayerWorld 的客户端镜像类型（与 server/world.ts 保持一致，独立声明避免把服务端代码打进客户端包）。 */
export interface WorldItem {
  id: string; name: string; type: string; desc: string; quantity: number;
  slot?: string; stats?: Record<string, number>; quality?: string;
  enhanceLevel?: number; refineStats?: Array<{ key: string; value: number }>;
}
export interface PlayerWorld {
  inventory: WorldItem[];
  equipment: Record<string, WorldItem | null>;
  gold: number; level: number; exp: number;
  quests: Record<string, number>;
  completedQuests: string[];
  bestiary: Record<string, number>;
  gatherNodes: Record<string, { consumed: boolean; respawnAt: number }>;
  dailyClaimed?: { date: string; ids: string[] };
  weeklyClaimed?: { week: string; ids: string[] };
  dungeonWeekly?: { week: string; count: number };
  dungeon?: { dungeonId: number } | null;
}

/** 副本进度客户端镜像（供地图传送阵提示使用）。 */
export let dungeonProgress: { dungeonId: number } | null = null;
export let dungeonWeekly: { week: string; count: number } = { week: '', count: 0 };
export const DUNGEON_WEEKLY_CAP = 3;

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
export function requestCraft(recipeName: string): boolean {
  return sendIntent('craft', { recipeName });
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
export function requestClaimQuest(questId: string): boolean {
  return sendIntent('claimQuest', { questId });
}

function mapItem(w: WorldItem): any {
  return {
    id: w.id, name: w.name, type: w.type, desc: w.desc, quantity: w.quantity,
    slot: w.slot, stats: w.stats, quality: w.quality,
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

  // 金币 / 等级 / 经验
  GameState.gold = pw.gold;
  GameState.level = pw.level;
  GameState.exp = pw.exp;

  // 图鉴击杀（服务端权威）
  GameState.bestiaryKilled = { ...pw.bestiary };

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
  dungeonProgress = pw.dungeon ? { dungeonId: pw.dungeon.dungeonId } : null;
  dungeonWeekly = pw.dungeonWeekly ? { week: pw.dungeonWeekly.week, count: pw.dungeonWeekly.count } : { week: '', count: 0 };

  // 通知 UIScene 更新数值栏
  if (scene && scene.scene) scene.scene.get('UIScene').events.emit('updateStats');
}
