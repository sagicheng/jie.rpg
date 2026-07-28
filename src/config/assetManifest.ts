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
  { key: 'player_male', path: 'assets/characters/player_male.png' },
  { key: 'player_female', path: 'assets/characters/player_female.png' },
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

  // 元素共鸣图标 (4种) — 火/风/水/土，透明背景，由独立美术产出替换原程序化占位
  { key: 'icon_火', path: 'assets/icons/icon_火.png' },
  { key: 'icon_风', path: 'assets/icons/icon_风.png' },
  { key: 'icon_水', path: 'assets/icons/icon_水.png' },
  { key: 'icon_土', path: 'assets/icons/icon_土.png' },

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


  // 采集点 (world) — 64x64, 透明背景, 由「场景装饰与采集点」表生成
  { key: 'gather_矿脉', path: 'assets/world/gather_矿脉.png' }, // 矿脉
  { key: 'gather_药草', path: 'assets/world/gather_药草.png' }, // 药草
  { key: 'gather_灵木', path: 'assets/world/gather_灵木.png' }, // 灵木
  { key: 'gather_灵脉', path: 'assets/world/gather_灵脉.png' }, // 灵脉

  // 副本传送阵入口 (world) — 128x128, 透明背景, 由「场景装饰与采集点」表生成
  { key: 'dungeon_portal_1', path: 'assets/world/dungeon_portal_1.png' },

  // 鬼道 TAB 图标 (3系) — 大型圆形徽章，由独立美术产出
  { key: 'kido_tab_hado',   path: 'assets/kido/tabs/tab_hado.png' },    // 破道TAB
  { key: 'kido_tab_bakudo', path: 'assets/kido/tabs/tab_bakudo.png' },   // 缚道TAB
  { key: 'kido_tab_kaido',  path: 'assets/kido/tabs/tab_kaido.png' },    // 回道TAB

  // 鬼道节点图标 — 每系20个，按节点树顺序(T1C0→T5C3)映射 node_01~node_20
  // 破道 (hado) — 20节点
  ...Array.from({length: 20}, (_, i) => ({ key: `kido_hado_node_${String(i+1).padStart(2,'0')}`, path: `assets/kido/hado/node_${String(i+1).padStart(2,'0')}.png` })),
  // 缚道 (bakudo) — 20节点
  ...Array.from({length: 20}, (_, i) => ({ key: `kido_bakudo_node_${String(i+1).padStart(2,'0')}`, path: `assets/kido/bakudo/node_${String(i+1).padStart(2,'0')}.png` })),
  // 回道 (kaido) — 20节点
  ...Array.from({length: 20}, (_, i) => ({ key: `kido_kaido_node_${String(i+1).padStart(2,'0')}`, path: `assets/kido/kaido/node_${String(i+1).padStart(2,'0')}.png` })),

  // 斩魄刀立绘 (36把 × 始解/卍解 = 72张) — 由 E:/My2ddemo/美术 导入；key 对齐 StatPanel 的 zan_${刀名}_shikai / zan_${刀名}_bankai
  { key: 'zan_流刃若火_shikai', path: 'assets/zanpakuto/zan_流刃若火_shikai.png' },
  { key: 'zan_流刃若火_bankai', path: 'assets/zanpakuto/zan_流刃若火_bankai.png' },
  { key: 'zan_飞梅_shikai', path: 'assets/zanpakuto/zan_飞梅_shikai.png' },
  { key: 'zan_飞梅_bankai', path: 'assets/zanpakuto/zan_飞梅_bankai.png' },
  { key: 'zan_红姬_shikai', path: 'assets/zanpakuto/zan_红姬_shikai.png' },
  { key: 'zan_红姬_bankai', path: 'assets/zanpakuto/zan_红姬_bankai.png' },
  { key: 'zan_剡月_shikai', path: 'assets/zanpakuto/zan_剡月_shikai.png' },
  { key: 'zan_剡月_bankai', path: 'assets/zanpakuto/zan_剡月_bankai.png' },
  { key: 'zan_雀蜂_shikai', path: 'assets/zanpakuto/zan_雀蜂_shikai.png' },
  { key: 'zan_雀蜂_bankai', path: 'assets/zanpakuto/zan_雀蜂_bankai.png' },
  { key: 'zan_疋杀地蔵_shikai', path: 'assets/zanpakuto/zan_疋杀地蔵_shikai.png' },
  { key: 'zan_疋杀地蔵_bankai', path: 'assets/zanpakuto/zan_疋杀地蔵_bankai.png' },
  { key: 'zan_天狗丸_shikai', path: 'assets/zanpakuto/zan_天狗丸_shikai.png' },
  { key: 'zan_天狗丸_bankai', path: 'assets/zanpakuto/zan_天狗丸_bankai.png' },
  { key: 'zan_馘大蛇_shikai', path: 'assets/zanpakuto/zan_馘大蛇_shikai.png' },
  { key: 'zan_馘大蛇_bankai', path: 'assets/zanpakuto/zan_馘大蛇_bankai.png' },
  { key: 'zan_严灵丸_shikai', path: 'assets/zanpakuto/zan_严灵丸_shikai.png' },
  { key: 'zan_严灵丸_bankai', path: 'assets/zanpakuto/zan_严灵丸_bankai.png' },
  { key: 'zan_斩月_shikai', path: 'assets/zanpakuto/zan_斩月_shikai.png' },
  { key: 'zan_斩月_bankai', path: 'assets/zanpakuto/zan_斩月_bankai.png' },
  { key: 'zan_千本樱_shikai', path: 'assets/zanpakuto/zan_千本樱_shikai.png' },
  { key: 'zan_千本樱_bankai', path: 'assets/zanpakuto/zan_千本樱_bankai.png' },
  { key: 'zan_神枪_shikai', path: 'assets/zanpakuto/zan_神枪_shikai.png' },
  { key: 'zan_神枪_bankai', path: 'assets/zanpakuto/zan_神枪_bankai.png' },
  { key: 'zan_花天狂骨_shikai', path: 'assets/zanpakuto/zan_花天狂骨_shikai.png' },
  { key: 'zan_花天狂骨_bankai', path: 'assets/zanpakuto/zan_花天狂骨_bankai.png' },
  { key: 'zan_藤孔雀_shikai', path: 'assets/zanpakuto/zan_藤孔雀_shikai.png' },
  { key: 'zan_藤孔雀_bankai', path: 'assets/zanpakuto/zan_藤孔雀_bankai.png' },
  { key: 'zan_逆抚_shikai', path: 'assets/zanpakuto/zan_逆抚_shikai.png' },
  { key: 'zan_逆抚_bankai', path: 'assets/zanpakuto/zan_逆抚_bankai.png' },
  { key: 'zan_断地风_shikai', path: 'assets/zanpakuto/zan_断地风_shikai.png' },
  { key: 'zan_断地风_bankai', path: 'assets/zanpakuto/zan_断地风_bankai.png' },
  { key: 'zan_铁浆蜻蛉_shikai', path: 'assets/zanpakuto/zan_铁浆蜻蛉_shikai.png' },
  { key: 'zan_铁浆蜻蛉_bankai', path: 'assets/zanpakuto/zan_铁浆蜻蛉_bankai.png' },
  { key: 'zan_风死_shikai', path: 'assets/zanpakuto/zan_风死_shikai.png' },
  { key: 'zan_风死_bankai', path: 'assets/zanpakuto/zan_风死_bankai.png' },
  { key: 'zan_冰轮丸_shikai', path: 'assets/zanpakuto/zan_冰轮丸_shikai.png' },
  { key: 'zan_冰轮丸_bankai', path: 'assets/zanpakuto/zan_冰轮丸_bankai.png' },
  { key: 'zan_袖白雪_shikai', path: 'assets/zanpakuto/zan_袖白雪_shikai.png' },
  { key: 'zan_袖白雪_bankai', path: 'assets/zanpakuto/zan_袖白雪_bankai.png' },
  { key: 'zan_镜花水月_shikai', path: 'assets/zanpakuto/zan_镜花水月_shikai.png' },
  { key: 'zan_镜花水月_bankai', path: 'assets/zanpakuto/zan_镜花水月_bankai.png' },
  { key: 'zan_双鱼理_shikai', path: 'assets/zanpakuto/zan_双鱼理_shikai.png' },
  { key: 'zan_双鱼理_bankai', path: 'assets/zanpakuto/zan_双鱼理_bankai.png' },
  { key: 'zan_肉雫唼_shikai', path: 'assets/zanpakuto/zan_肉雫唼_shikai.png' },
  { key: 'zan_肉雫唼_bankai', path: 'assets/zanpakuto/zan_肉雫唼_bankai.png' },
  { key: 'zan_金沙罗_shikai', path: 'assets/zanpakuto/zan_金沙罗_shikai.png' },
  { key: 'zan_金沙罗_bankai', path: 'assets/zanpakuto/zan_金沙罗_bankai.png' },
  { key: 'zan_捩花_shikai', path: 'assets/zanpakuto/zan_捩花_shikai.png' },
  { key: 'zan_捩花_bankai', path: 'assets/zanpakuto/zan_捩花_bankai.png' },
  { key: 'zan_瓠丸_shikai', path: 'assets/zanpakuto/zan_瓠丸_shikai.png' },
  { key: 'zan_瓠丸_bankai', path: 'assets/zanpakuto/zan_瓠丸_bankai.png' },
  { key: 'zan_清虫_shikai', path: 'assets/zanpakuto/zan_清虫_shikai.png' },
  { key: 'zan_清虫_bankai', path: 'assets/zanpakuto/zan_清虫_bankai.png' },
  { key: 'zan_天谴_shikai', path: 'assets/zanpakuto/zan_天谴_shikai.png' },
  { key: 'zan_天谴_bankai', path: 'assets/zanpakuto/zan_天谴_bankai.png' },
  { key: 'zan_蛇尾丸_shikai', path: 'assets/zanpakuto/zan_蛇尾丸_shikai.png' },
  { key: 'zan_蛇尾丸_bankai', path: 'assets/zanpakuto/zan_蛇尾丸_bankai.png' },
  { key: 'zan_鬼灯丸_shikai', path: 'assets/zanpakuto/zan_鬼灯丸_shikai.png' },
  { key: 'zan_鬼灯丸_bankai', path: 'assets/zanpakuto/zan_鬼灯丸_bankai.png' },
  { key: 'zan_灰猫_shikai', path: 'assets/zanpakuto/zan_灰猫_shikai.png' },
  { key: 'zan_灰猫_bankai', path: 'assets/zanpakuto/zan_灰猫_bankai.png' },
  { key: 'zan_侘助_shikai', path: 'assets/zanpakuto/zan_侘助_shikai.png' },
  { key: 'zan_侘助_bankai', path: 'assets/zanpakuto/zan_侘助_bankai.png' },
  { key: 'zan_土鯰_shikai', path: 'assets/zanpakuto/zan_土鯰_shikai.png' },
  { key: 'zan_土鯰_bankai', path: 'assets/zanpakuto/zan_土鯰_bankai.png' },
  { key: 'zan_五形头_shikai', path: 'assets/zanpakuto/zan_五形头_shikai.png' },
  { key: 'zan_五形头_bankai', path: 'assets/zanpakuto/zan_五形头_bankai.png' },
  { key: 'zan_裂岩_shikai', path: 'assets/zanpakuto/zan_裂岩_shikai.png' },
  { key: 'zan_裂岩_bankai', path: 'assets/zanpakuto/zan_裂岩_bankai.png' },
  { key: 'zan_崩山_shikai', path: 'assets/zanpakuto/zan_崩山_shikai.png' },
  { key: 'zan_崩山_bankai', path: 'assets/zanpakuto/zan_崩山_bankai.png' },

  // 立绘粒子贴图 (4种, 下雪式飘落物体) — 透明背景、自带色彩 PNG，由美术产出替换原程序化占位
  // 火=火星余烬 / 风=落叶 / 水=雪花 / 土=尘砾；与刀之元素表现一致。key 对齐 StatPanel 的 elTex。
  { key: 'fx_fire',  path: 'assets/particles/fx_fire.png' },
  { key: 'fx_wind',  path: 'assets/particles/fx_wind.png' },
  { key: 'fx_water', path: 'assets/particles/fx_water.png' },
  { key: 'fx_earth', path: 'assets/particles/fx_earth.png' },

  // 力量形态立绘 (虚化/狱解 × 男女 = 4张) — 战斗释放瞬间按需懒加载，不进启动预载
  { key: 'char_hollow_male', path: 'assets/characters/char_hollow_male.png' },
  { key: 'char_hollow_female', path: 'assets/characters/char_hollow_female.png' },
  { key: 'char_hell_male', path: 'assets/characters/char_hell_male.png' },
  { key: 'char_hell_female', path: 'assets/characters/char_hell_female.png' },

  // 战斗 UI 皮肤（切图级，CC0 扁平风，tools/gen_skin.py 生成，可同名覆盖为 Kenney/Cocos 成品）
  { key: 'ui_bar_frame', path: 'assets/ui/skin/ui_bar_frame.png' },
  { key: 'ui_bar_fill',  path: 'assets/ui/skin/ui_bar_fill.png' },
  { key: 'ui_btn_normal', path: 'assets/ui/skin/ui_btn_normal.png' },
  { key: 'ui_btn_hover',  path: 'assets/ui/skin/ui_btn_hover.png' },
  { key: 'ui_btn_down',   path: 'assets/ui/skin/ui_btn_down.png' },
  { key: 'ui_card_ally',  path: 'assets/ui/skin/ui_card_ally.png' },
  { key: 'ui_card_enemy', path: 'assets/ui/skin/ui_card_enemy.png' },
  { key: 'ui_card_pet',   path: 'assets/ui/skin/ui_card_pet.png' },
  { key: 'ui_tag_bg',     path: 'assets/ui/skin/ui_tag_bg.png' },
  { key: 'ui_panel',      path: 'assets/ui/skin/ui_panel.png' },
];
