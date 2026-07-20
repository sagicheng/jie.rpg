/**
 * 行会商店（公会 v2 个人消费闭环）
 * ─────────────────────────────────────────────
 * 个人贡献（guild_members.contribution）此前只有"进"没有"出"，是死数据。
 * 行会商店让它有了消费出口：成员用个人贡献兑换公会专属物资。
 *
 * 与 learn-skill 的区别：
 *   - learn-skill 消耗【公会贡献池】（guilds.contribution，共享资源）→ 走 REST
 *   - 商店发放【背包物品/称号】（属于 PlayerWorld，在 GameRoom 内存世界里）→ 走 intent
 *     这样能避免"REST 改了 DB、玩家在 GameRoom 的内存世界是旧副本，离开时把发放覆盖掉"的脏写。
 *
 * 目录为纯数据，客户端 src/systems/GuildShop.ts 同步镜像一份供 UI 渲染。
 */
import type { PlayerWorld, WorldItem, OpResult } from '../../core/world';
import { world } from '../../core/world';
import { getMemberGuild, getMemberContribution, addMemberContribution } from '../../core/db';

export interface GuildShopItemDef {
  /** 商品 id（商店内部标识） */
  id: string;
  /** 展示名 */
  name: string;
  /** 描述 */
  desc: string;
  /** 价格（个人贡献） */
  price: number;
  /** item=发放背包物品；title=解锁公会专属称号 */
  kind: 'item' | 'title';
  /** kind=item 时发放的物品（WorldItem，quantity 即数量） */
  item?: WorldItem;
  /** kind=title 时对应的 TitleDef.id（须在 BESTIARY_TITLES 中存在且 manualOnly） */
  titleId?: string;
}

/**
 * 行会商店商品目录。
 * 材料 id 必须用 mat_<材料名>（与游戏内采集/精炼一致），否则背包会出现同名双栈、
 * 且 enhance/refine 按 name 查找时仍可正常消耗（countMaterial 按 name 聚合）。
 */
export const GUILD_SHOP_ITEMS: GuildShopItemDef[] = [
  // ───────── 消耗品 · HP ─────────
  {
    id: 'potion_s_5',
    name: '伤药丸(小) ×5',
    desc: '战斗中回复 150 HP ×5，日常续航',
    price: 20,
    kind: 'item',
    item: { id: 'medicine_pill_s', name: '伤药丸(小)', type: 'consumable', desc: '回复150HP', quantity: 5 },
  },
  {
    id: 'potion_l_3',
    name: '伤药丸(大) ×3',
    desc: '战斗中回复 1000 HP ×3，硬扛 Boss',
    price: 80,
    kind: 'item',
    item: { id: 'medicine_pill_l', name: '伤药丸(大)', type: 'consumable', desc: '回复1000HP', quantity: 3 },
  },
  {
    id: 'recovery_5',
    name: '回复丹 ×5',
    desc: '回复 300 HP + 50 MP ×5，攻防兼备',
    price: 60,
    kind: 'item',
    item: { id: 'recovery_pill', name: '回复丹', type: 'consumable', desc: '回复300HP+50MP', quantity: 5 },
  },
  {
    id: 'full_heal_1',
    name: '全回复丹 ×1',
    desc: '完全回复 HP 与 MP，绝境翻盘',
    price: 200,
    kind: 'item',
    item: { id: 'full_recovery_pill', name: '全回复丹', type: 'consumable', desc: '完全回复HP和MP', quantity: 1 },
  },
  // ───────── 消耗品 · MP ─────────
  {
    id: 'spirit_l_3',
    name: '灵力水(大) ×3',
    desc: '回复 200 MP ×3，鬼道续航',
    price: 50,
    kind: 'item',
    item: { id: 'spirit_water_l', name: '灵力水(大)', type: 'consumable', desc: '回复200MP', quantity: 3 },
  },
  // ───────── 材料（强化 / 精炼） ─────────
  {
    id: 'crystal_3',
    name: '灵晶碎片 ×3',
    desc: '装备强化（强化）必备材料',
    price: 80,
    kind: 'item',
    item: { id: 'mat_灵晶碎片', name: '灵晶碎片', type: 'material', desc: '强化消耗', quantity: 3 },
  },
  {
    id: 'silver_3',
    name: '银矿石 ×3',
    desc: '绿色装备精炼必备材料',
    price: 60,
    kind: 'item',
    item: { id: 'mat_银矿石', name: '银矿石', type: 'material', desc: '精炼消耗', quantity: 3 },
  },
  {
    id: 'core_1',
    name: '妖将核心 ×1',
    desc: '紫色装备精炼必备材料',
    price: 120,
    kind: 'item',
    item: { id: 'mat_妖将核心', name: '妖将核心', type: 'material', desc: '精炼消耗', quantity: 1 },
  },
  {
    id: 'legend_1',
    name: '传说材料碎片 ×1',
    desc: '金色装备精炼必备材料',
    price: 200,
    kind: 'item',
    item: { id: 'mat_传说材料碎片', name: '传说材料碎片', type: 'material', desc: '精炼消耗', quantity: 1 },
  },
  // ───────── 状态解除 / 复活 ─────────
  {
    id: 'purify_3',
    name: '净化符 ×3',
    desc: '解除全部异常状态 ×3（中毒/束缚/眩晕/封印）',
    price: 70,
    kind: 'item',
    item: { id: 'purify_talisman', name: '净化符', type: 'consumable', desc: '解除全部异常状态', quantity: 3 },
  },
  {
    id: 'revive_full_1',
    name: '真·还魂符 ×1',
    desc: '战斗不能时以 100% HP 复活 ×1',
    price: 150,
    kind: 'item',
    item: { id: 'soul_revive_full', name: '真·还魂符', type: 'consumable', desc: '以100%HP复活', quantity: 1 },
  },
  // ───────── 临时增益 ─────────
  {
    id: 'atk_elixir_2',
    name: '力量药剂 ×2',
    desc: '攻击 +20%（3 回合）×2，爆发输出',
    price: 90,
    kind: 'item',
    item: { id: 'atk_elixir', name: '力量药剂', type: 'consumable', desc: '攻击力+20%(3回合)', quantity: 2 },
  },
  {
    id: 'matk_elixir_2',
    name: '灵击药剂 ×2',
    desc: '魔攻 +20%（3 回合）×2，鬼道爆发',
    price: 90,
    kind: 'item',
    item: { id: 'matk_elixir', name: '灵击药剂', type: 'consumable', desc: '魔攻+20%(3回合)', quantity: 2 },
  },
  // ───────── 公会专属称号 ─────────
  {
    id: 'title_tongxin',
    name: '公会称号「同心」',
    desc: '全属性 +3%，仅公会商店兑换，彰显羁绊',
    price: 200,
    kind: 'title',
    titleId: 'guild_tongxin',
  },
  {
    id: 'title_tongpao',
    name: '公会称号「同袍」',
    desc: '全属性 +5%，进阶公会称号，战友同心',
    price: 500,
    kind: 'title',
    titleId: 'guild_tongpao',
  },
];

/**
 * 行会商店购买（服务端权威）。
 * @param pw      当前玩家内存世界（GameRoom 内，落库统一由调用方处理）
 * @param charId  角色 id（用于查公会归属 + 扣个人贡献）
 * @param itemId  商品 id
 */
export function guildShopBuy(pw: PlayerWorld, charId: number, itemId: string): OpResult {
  const def = GUILD_SHOP_ITEMS.find((i) => i.id === itemId);
  if (!def) return { ok: false, msg: '商品不存在' };

  // 必须在公会内才能购买
  if (getMemberGuild(charId) === null) return { ok: false, msg: '你不在任何公会' };

  // 个人贡献余额校验
  const contrib = getMemberContribution(charId);
  if (contrib < def.price) {
    return { ok: false, msg: `个人贡献不足（需 ${def.price}，现有 ${contrib}）` };
  }

  // 称号不可重复购买（避免重复扣贡献却无收益）
  if (def.kind === 'title' && def.titleId && pw.unlockedTitles.includes(def.titleId)) {
    return { ok: false, msg: '已拥有该称号' };
  }

  // 扣个人贡献（addMemberContribution 内部解析公会，传负即扣，下限 0）
  addMemberContribution(charId, -def.price);

  // 发放
  if (def.kind === 'title') {
    if (def.titleId) {
      if (!pw.unlockedTitles.includes(def.titleId)) pw.unlockedTitles.push(def.titleId);
      // 若当前未装备称号，自动装备公会称号（更直观的"到手即用"）
      if (!pw.activeTitle) pw.activeTitle = def.titleId;
    }
  } else if (def.item) {
    world.grantItem(pw, def.item);
  }

  const remain = getMemberContribution(charId);
  return {
    ok: true,
    msg: `购买成功：${def.name}`,
    data: { itemId, name: def.name, contribution: remain },
  };
}
