/**
 * 拍卖行（一口价，竞价为二期）
 * ─────────────────────────────────────────────
 * 玩家间挂单交易，补「经济流通」闭环。
 * 上架：冻结卖家背包物品 → auctions 表（item_data 存全量 WorldItem）。
 * 购买：扣买家金币(内存) + 发物品(内存) → 卖家金币由 GameRoom 的 addGoldToChar 结算
 *       （在线 worldSync / 离线改 DB，避免 DB 被在线玩家内存副本覆盖的脏写）。
 * 撤单：物品退回卖家背包(内存) + 删挂单。
 * 列表/搜索/收藏/历史走 DB 查询（db.ts 封装），不依赖玩家内存世界。
 */
import type { PlayerWorld, WorldItem, OpResult } from '../core/world';
import { world } from '../core/world';
import db, {
  getAuction, deleteAuction, insertHistory, getCharacter,
  type AuctionRow, type AuctionFilter,
} from '../core/db';

export const AUCTION_FEE_RATE = 0.05;       // 卖家成交手续费
export const AUCTION_DURATION_HOURS = 24;   // 挂单展示时效（仅 UI 剩余时间参考，不做强制下架）

export interface AuctionBuyResult extends OpResult {
  data?: { sellerCharId: number; sellerGain: number };
}

/** 上架：冻结物品到 auctions 表。 */
export function createAuction(pw: PlayerWorld, charId: number, itemId: string, qty: number, price: number): OpResult {
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, msg: '数量无效' };
  if (!Number.isInteger(price) || price <= 0) return { ok: false, msg: '价格无效' };
  const item = pw.inventory.find(i => i.id === itemId);
  if (!item) return { ok: false, msg: '背包无此物品' };
  if ((item.quantity || 0) < qty) return { ok: false, msg: '背包数量不足' };
  if (!world.removeItem(pw, itemId, qty)) return { ok: false, msg: '物品冻结失败' };
  const char = getCharacter(charId);
  if (!char) { world.grantItem(pw, { ...item, quantity: qty }); return { ok: false, msg: '角色不存在，已退回物品' }; }
  const frozen: WorldItem = { ...item, quantity: qty };
  const expires = new Date(Date.now() + AUCTION_DURATION_HOURS * 3600 * 1000).toISOString();
  db.prepare(`INSERT INTO auctions (seller_char_id, seller_name, item_name, item_data, quantity, price, category, quality, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(charId, char.name, item.name, JSON.stringify(frozen), qty, price, item.type, item.quality || null, expires);
  return { ok: true, msg: `已上架：${item.name} ×${qty} @ ${price} 金币` };
}

/** 购买（一口价）。返回卖家结算信息，由 GameRoom 调 addGoldToChar 完成卖家金币到账。 */
export function buyAuction(pw: PlayerWorld, charId: number, auctionId: number): AuctionBuyResult {
  const a = getAuction(auctionId);
  if (!a) return { ok: false, msg: '挂单不存在或已售出' };
  if (a.seller_char_id === charId) return { ok: false, msg: '不能购买自己的挂单' };
  if (pw.gold < a.price) return { ok: false, msg: `金币不足（需 ${a.price}）` };
  world.spendGold(pw, a.price);                              // 扣买家金币（内存）
  world.grantItem(pw, JSON.parse(a.item_data) as WorldItem); // 发物品给买家（内存）
  const gain = Math.round(a.price * (1 - AUCTION_FEE_RATE));
  deleteAuction(a.id);
  insertHistory({ auction_id: a.id, seller_char_id: a.seller_char_id, buyer_char_id: charId, item_name: a.item_name, price: a.price, kind: 'sold' });
  insertHistory({ auction_id: a.id, seller_char_id: a.seller_char_id, buyer_char_id: charId, item_name: a.item_name, price: a.price, kind: 'bought' });
  return { ok: true, msg: `购买成功：${a.item_name} ×${a.quantity}`, data: { sellerCharId: a.seller_char_id, sellerGain: gain } };
}

/** 撤单：物品退回卖家背包（内存）。 */
export function cancelAuction(pw: PlayerWorld, charId: number, auctionId: number): OpResult {
  const a = getAuction(auctionId);
  if (!a) return { ok: false, msg: '挂单不存在' };
  if (a.seller_char_id !== charId) return { ok: false, msg: '只能撤下自己的挂单' };
  world.grantItem(pw, JSON.parse(a.item_data) as WorldItem); // 退回背包
  deleteAuction(a.id);
  insertHistory({ auction_id: a.id, seller_char_id: charId, buyer_char_id: null, item_name: a.item_name, price: a.price, kind: 'canceled' });
  return { ok: true, msg: `已撤单：${a.item_name}` };
}

export type { AuctionRow, AuctionFilter };
