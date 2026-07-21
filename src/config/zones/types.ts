// 区域配置数据类型 — Bleach 原著世界观 21 区域
export interface ZoneNPC {
  x: number; y: number;
  name: string;
  role: 'merchant' | 'return_point' | 'quest' | 'lore' | 'craft' | 'side_quest' | 'enhance' | 'quest_board';
  dialogue: Array<{
    speaker: string;
    text: string;
    choices?: Array<{ text: string; callback: string }>;
  }>;
  shop?: Array<{ name: string; price: number; id: string; slot: string; stats: Record<string, number>; desc: string; quality?: string; set?: string }>;
}

export interface ZoneEnemy {
  name: string;
  type: '杂妖' | '恶妖' | '妖将' | '妖王';
  element: string;
  x: number; y: number;
  isBoss?: boolean;
}

export interface ZoneGather {
  x: number; y: number;
  type: '矿脉' | '药草' | '灵木' | '灵脉';
}

/** 拼接装饰：把一张图片摆到地图某坐标，多张拼起来组成场景（飘流幻境式）。坐标用 0..1 归一化（×地图宽高）。 */
export interface ZoneProp {
  /** 已加载的纹理 key（在 assetManifest 注册）。 */
  image: string;
  /** 世界坐标（归一化 0..1，createMap 内 ×地图宽高）。 */
  x: number;
  y: number;
  scale?: number;
  depth?: number;
  alpha?: number;
  originX?: number;
  originY?: number;
}

export interface ZoneConfig {
  id: number;
  name: string;
  groundColor: number;
  roadColor: number;
  treeColor: number;
  /** 区域背景图（Phaser 纹理 key）。存在时铺满整个地图，替代纯色底；缺省用 groundColor。 */
  backgroundImage?: string;
  /** 背景图铺法：'tile'=平铺重复（默认，适合小尺寸可循环纹理）；'cover'=拉伸铺满整张地图不重复（适合你画好的一整张场景大图）。 */
  backgroundMode?: 'tile' | 'cover';
  /** 拼接装饰：在不同坐标放置不同图片，组成场景（飘流幻境式：一大底 + 四处摆物件）。 */
  props?: ZoneProp[];
  decorations: Array<{ type: string; x: number; y: number; w?: number; h?: number; key?: string; scale?: number }>;
  npcs: ZoneNPC[];
  enemies: ZoneEnemy[];
  gathering: ZoneGather[];
  exits: Array<{ edge: 'east'|'west'|'north'|'south'|'northwest'|'northeast'|'southwest'|'southeast'; x: number; y: number; targetZone: number; targetX: number; targetY: number }>;
  /** 副本传送阵坐标（每区域一个入口；可选，缺省用统一默认位置）。 */
  dungeonPortal?: { x: number; y: number };
}

// ── 商店物品生成辅助 ──
