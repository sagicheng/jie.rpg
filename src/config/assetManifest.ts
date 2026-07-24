/**
 * 美术资源清单（单一事实来源）
 *
 * AI 生成的 2D 卡通风格素材，按 key 接入 Phaser 预加载管线（见 BootScene）。
 * 路径相对 public/ 根目录（Vite 静态服务，构建时原样拷贝到 dist/）。
 *
 * 重要：贴图分辨率与场景内 setDisplaySize / 物理碰撞体数值绑定。
 * 若更换图片或改变生成分辨率，需同步调整对应精灵的显示尺寸与 body。
 */

export interface AssetImage {
  /** Phaser 纹理 key，与场景中 this.add.sprite(x, y, key) 对应 */
  key: string;
  /** public/ 下的相对路径 */
  path: string;
}

export const ASSET_IMAGES: AssetImage[] = [
  { key: 'player', path: 'assets/characters/player.png' },
  { key: 'enemy', path: 'assets/monsters/enemy.png' },
  { key: 'bg_battle', path: 'assets/backgrounds/bg_battle.png' },
  { key: 'bg_town', path: 'assets/backgrounds/bg_town.png' },

  // 区域背景图（21 区，1920×1080 横向，由 AI 生成的手绘蜂窝纹理场景底图）
  { key: 'bg_zone_01', path: 'assets/backgrounds/bg_zone_01.png' },
  { key: 'bg_zone_02', path: 'assets/backgrounds/bg_zone_02.png' },
  { key: 'bg_zone_03', path: 'assets/backgrounds/bg_zone_03.png' },
  { key: 'bg_zone_04', path: 'assets/backgrounds/bg_zone_04.png' },
  { key: 'bg_zone_05', path: 'assets/backgrounds/bg_zone_05.png' },
  { key: 'bg_zone_06', path: 'assets/backgrounds/bg_zone_06.png' },
  { key: 'bg_zone_07', path: 'assets/backgrounds/bg_zone_07.png' },
  { key: 'bg_zone_08', path: 'assets/backgrounds/bg_zone_08.png' },
  { key: 'bg_zone_09', path: 'assets/backgrounds/bg_zone_09.png' },
  { key: 'bg_zone_10', path: 'assets/backgrounds/bg_zone_10.png' },
  { key: 'bg_zone_11', path: 'assets/backgrounds/bg_zone_11.png' },
  { key: 'bg_zone_12', path: 'assets/backgrounds/bg_zone_12.png' },
  { key: 'bg_zone_13', path: 'assets/backgrounds/bg_zone_13.png' },
  { key: 'bg_zone_14', path: 'assets/backgrounds/bg_zone_14.png' },
  { key: 'bg_zone_15', path: 'assets/backgrounds/bg_zone_15.png' },
  { key: 'bg_zone_16', path: 'assets/backgrounds/bg_zone_16.png' },
  { key: 'bg_zone_17', path: 'assets/backgrounds/bg_zone_17.png' },
  { key: 'bg_zone_18', path: 'assets/backgrounds/bg_zone_18.png' },
  { key: 'bg_zone_19', path: 'assets/backgrounds/bg_zone_19.png' },
  { key: 'bg_zone_20', path: 'assets/backgrounds/bg_zone_20.png' },
  { key: 'bg_zone_21', path: 'assets/backgrounds/bg_zone_21.png' },

  // 状态效果图标 (13种 BUFF/debuff) — 64x64, 透明背景, 圆角边框已含
  { key: 'icon_burn',     path: 'assets/icons/icon_burn.png' },     // 灼烧
  { key: 'icon_freeze',   path: 'assets/icons/icon_freeze.png' },   // 冻结
  { key: 'icon_poison',   path: 'assets/icons/icon_poison.png' },   // 中毒
  { key: 'icon_parasite', path: 'assets/icons/icon_parasite.png' }, // 寄生
  { key: 'icon_slow',     path: 'assets/icons/icon_slow.png' },     // 减速
  { key: 'icon_stun',     path: 'assets/icons/icon_stun.png' },     // 眩晕
  { key: 'icon_bind',     path: 'assets/icons/icon_bind.png' },     // 禁锢
  { key: 'icon_taunt',    path: 'assets/icons/icon_taunt.png' },    // 嘲讽
  { key: 'icon_fear',     path: 'assets/icons/icon_fear.png' },     // 恐惧
  { key: 'icon_atkDown',  path: 'assets/icons/icon_atkDown.png' },  // 攻降
  { key: 'icon_defDown',  path: 'assets/icons/icon_defDown.png' },  // 防降
  { key: 'icon_matkDown', path: 'assets/icons/icon_matkDown.png' }, // 降灵压
  { key: 'icon_seal',     path: 'assets/icons/icon_seal.png' },     // 封印

  // 材料图标 (23种) — 64x64, 透明背景, 由「材料图标」两张表提取
  { key: 'mat_完现结晶', path: 'assets/materials/mat_完现结晶.png' }, // 完现结晶
  { key: 'mat_灵银碎片', path: 'assets/materials/mat_灵银碎片.png' }, // 灵银碎片
  { key: 'mat_圣文字刻印', path: 'assets/materials/mat_圣文字刻印.png' }, // 圣文字刻印
  { key: 'mat_罪业碎片', path: 'assets/materials/mat_罪业碎片.png' }, // 罪业碎片
  { key: 'mat_地狱火种', path: 'assets/materials/mat_地狱火种.png' }, // 地狱火种
  { key: 'mat_混沌核心', path: 'assets/materials/mat_混沌核心.png' }, // 混沌核心
  { key: 'mat_终焉之核', path: 'assets/materials/mat_终焉之核.png' }, // 终焉之核
  { key: 'mat_怨念结晶', path: 'assets/materials/mat_怨念结晶.png' }, // 怨念结晶
  { key: 'mat_地狱王冠', path: 'assets/materials/mat_地狱王冠.png' }, // 地狱王冠
  { key: 'mat_传说材料碎片', path: 'assets/materials/mat_传说材料碎片.png' }, // 传说材料碎片
  { key: 'mat_灵力水', path: 'assets/materials/mat_灵力水.png' }, // 灵力水
  { key: 'mat_铁矿石', path: 'assets/materials/mat_铁矿石.png' }, // 铁矿石
  { key: 'mat_银矿石', path: 'assets/materials/mat_银矿石.png' }, // 银矿石
  { key: 'mat_麻布片', path: 'assets/materials/mat_麻布片.png' }, // 麻布片
  { key: 'mat_灵木枝', path: 'assets/materials/mat_灵木枝.png' }, // 灵木枝
  { key: 'mat_硬皮', path: 'assets/materials/mat_硬皮.png' }, // 硬皮
  { key: 'mat_虚夜碎片', path: 'assets/materials/mat_虚夜碎片.png' }, // 虚夜碎片
  { key: 'mat_毒腺', path: 'assets/materials/mat_毒腺.png' }, // 毒腺
  { key: 'mat_浅打碎片', path: 'assets/materials/mat_浅打碎片.png' }, // 浅打碎片
  { key: 'mat_鬼道卷轴', path: 'assets/materials/mat_鬼道卷轴.png' }, // 鬼道卷轴
  { key: 'mat_破面面具', path: 'assets/materials/mat_破面面具.png' }, // 破面面具
  { key: 'mat_妖将核心', path: 'assets/materials/mat_妖将核心.png' }, // 妖将核心
  { key: 'mat_灵晶碎片', path: 'assets/materials/mat_灵晶碎片.png' }, // 灵晶碎片

  // 消耗品图标 (24种) — 64x64, 透明背景, 由「药品图标」两张表提取
  { key: 'item_止血草', path: 'assets/consumables/item_止血草.png' },
  { key: 'item_伤药丸(小)', path: 'assets/consumables/item_伤药丸(小).png' },
  { key: 'item_伤药丸(中)', path: 'assets/consumables/item_伤药丸(中).png' },
  { key: 'item_伤药丸(大)', path: 'assets/consumables/item_伤药丸(大).png' },
  { key: 'item_伤药丸(特)', path: 'assets/consumables/item_伤药丸(特).png' },
  { key: 'item_灵力水(小)', path: 'assets/consumables/item_灵力水(小).png' },
  { key: 'item_灵力水(中)', path: 'assets/consumables/item_灵力水(中).png' },
  { key: 'item_灵力水(大)', path: 'assets/consumables/item_灵力水(大).png' },
  { key: 'item_回复丹', path: 'assets/consumables/item_回复丹.png' },
  { key: 'item_全回复丹', path: 'assets/consumables/item_全回复丹.png' },
  { key: 'item_解毒药', path: 'assets/consumables/item_解毒药.png' },
  { key: 'item_解缚符', path: 'assets/consumables/item_解缚符.png' },
  { key: 'item_净化符', path: 'assets/consumables/item_净化符.png' },
  { key: 'item_还魂符', path: 'assets/consumables/item_还魂符.png' },
  { key: 'item_真·还魂符', path: 'assets/consumables/item_真·还魂符.png' },
  { key: 'item_力量药剂', path: 'assets/consumables/item_力量药剂.png' },
  { key: 'item_护壁药剂', path: 'assets/consumables/item_护壁药剂.png' },
  { key: 'item_迅捷药剂', path: 'assets/consumables/item_迅捷药剂.png' },
  { key: 'item_灵击药剂', path: 'assets/consumables/item_灵击药剂.png' },
  { key: 'item_回复药(商店)', path: 'assets/consumables/item_回复药(商店).png' },
  { key: 'item_强效回复药(商店)', path: 'assets/consumables/item_强效回复药(商店).png' },
  { key: 'item_高级回复药(商店)', path: 'assets/consumables/item_高级回复药(商店).png' },
  { key: 'item_终极回复药(商店)', path: 'assets/consumables/item_终极回复药(商店).png' },
  { key: 'item_灵水(商店)', path: 'assets/consumables/item_灵水(商店).png' },

  // 装备槽位图标 (9种) — 64x64, 透明背景, 灰色圆角底+部位符号, 由「装备槽位与边框」提取
  { key: 'slot_head',     path: 'assets/equip_slots/slot_head.png' },     // 头盔
  { key: 'slot_body',     path: 'assets/equip_slots/slot_body.png' },     // 胸甲
  { key: 'slot_bracer',   path: 'assets/equip_slots/slot_bracer.png' },   // 手甲
  { key: 'slot_boots',    path: 'assets/equip_slots/slot_boots.png' },    // 战靴
  { key: 'slot_belt',     path: 'assets/equip_slots/slot_belt.png' },     // 腰带
  { key: 'slot_ring',     path: 'assets/equip_slots/slot_ring.png' },     // 戒指
  { key: 'slot_necklace', path: 'assets/equip_slots/slot_necklace.png' }, // 项链
  { key: 'slot_charm',    path: 'assets/equip_slots/slot_charm.png' },    // 护符
  { key: 'slot_pendant',  path: 'assets/equip_slots/slot_pendant.png' },  // 挂饰

  // 装备品质边框 (5种) — 64x64, 透明背景, 由「装备槽位与边框」提取
  { key: 'border_white',  path: 'assets/equip_borders/border_white.png' },  // 白
  { key: 'border_green',  path: 'assets/equip_borders/border_green.png' },  // 绿
  { key: 'border_blue',   path: 'assets/equip_borders/border_blue.png' },   // 蓝
  { key: 'border_purple', path: 'assets/equip_borders/border_purple.png' }, // 紫
  { key: 'border_gold',   path: 'assets/equip_borders/border_gold.png' },   // 金


  // 采集点 (world) — 64x64, 透明背景, 由「场景装饰与采集点」表生成
  { key: 'gather_矿脉', path: 'assets/world/gather_矿脉.png' }, // 矿脉
  { key: 'gather_药草', path: 'assets/world/gather_药草.png' }, // 药草
  { key: 'gather_灵木', path: 'assets/world/gather_灵木.png' }, // 灵木
  { key: 'gather_灵脉', path: 'assets/world/gather_灵脉.png' }, // 灵脉

  // 副本传送阵入口 (world) — 128x128, 透明背景, 由「场景装饰与采集点」表生成
  { key: 'dungeon_portal_1', path: 'assets/world/dungeon_portal_1.png' },
];
