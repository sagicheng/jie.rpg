/**
 * 行会商店商品目录（客户端镜像，供 UI 渲染）。
 * 与服务端 server/guildShop.ts 的 GUILD_SHOP_ITEMS 保持同名同价同步。
 * 仅含展示所需字段（名称/描述/价格/类型），不含发放逻辑（发放在服务端权威执行）。
 */
export interface GuildShopItemDef {
  id: string;
  name: string;
  desc: string;
  price: number;
  kind: 'item' | 'title';
}

export const GUILD_SHOP_ITEMS: GuildShopItemDef[] = [
  // ───────── 消耗品 · HP ─────────
  { id: 'potion_s_5', name: '伤药丸(小) ×5', desc: '战斗中回复 150 HP ×5，日常续航', price: 20, kind: 'item' },
  { id: 'potion_l_3', name: '伤药丸(大) ×3', desc: '战斗中回复 1000 HP ×3，硬扛 Boss', price: 80, kind: 'item' },
  { id: 'recovery_5', name: '回复丹 ×5', desc: '回复 300 HP + 50 MP ×5，攻防兼备', price: 60, kind: 'item' },
  { id: 'full_heal_1', name: '全回复丹 ×1', desc: '完全回复 HP 与 MP，绝境翻盘', price: 200, kind: 'item' },
  // ───────── 消耗品 · MP ─────────
  { id: 'spirit_l_3', name: '灵力水(大) ×3', desc: '回复 200 MP ×3，鬼道续航', price: 50, kind: 'item' },
  // ───────── 材料（强化 / 精炼） ─────────
  { id: 'crystal_3', name: '灵晶碎片 ×3', desc: '装备强化（强化）必备材料', price: 80, kind: 'item' },
  { id: 'silver_3', name: '银矿石 ×3', desc: '绿色装备精炼必备材料', price: 60, kind: 'item' },
  { id: 'core_1', name: '妖将核心 ×1', desc: '紫色装备精炼必备材料', price: 120, kind: 'item' },
  { id: 'legend_1', name: '传说材料碎片 ×1', desc: '金色装备精炼必备材料', price: 200, kind: 'item' },
  // ───────── 状态解除 / 复活 ─────────
  { id: 'purify_3', name: '净化符 ×3', desc: '解除全部异常状态 ×3', price: 70, kind: 'item' },
  { id: 'revive_full_1', name: '真·还魂符 ×1', desc: '战斗不能时以 100% HP 复活 ×1', price: 150, kind: 'item' },
  // ───────── 临时增益 ─────────
  { id: 'atk_elixir_2', name: '力量药剂 ×2', desc: '攻击 +20%（3 回合）×2', price: 90, kind: 'item' },
  { id: 'matk_elixir_2', name: '灵击药剂 ×2', desc: '魔攻 +20%（3 回合）×2', price: 90, kind: 'item' },
  // ───────── 公会专属称号 ─────────
  { id: 'title_tongxin', name: '公会称号「同心」', desc: '全属性 +3%，仅公会商店兑换', price: 200, kind: 'title' },
  { id: 'title_tongpao', name: '公会称号「同袍」', desc: '全属性 +5%，进阶公会称号', price: 500, kind: 'title' },
];
