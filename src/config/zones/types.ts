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

export interface ZoneConfig {
  id: number;
  name: string;
  groundColor: number;
  /** 区域背景图（Phaser 纹理 key）。存在时铺满整个地图，替代纯色底；缺省用 groundColor。 */
  backgroundImage?: string;
  /** 背景图铺法：'tile'=平铺重复（默认，适合小尺寸可循环纹理）；'cover'=拉伸铺满整张地图不重复（适合你画好的一整张场景大图）。 */
  backgroundMode?: 'tile' | 'cover';
  npcs: ZoneNPC[];
  enemies: ZoneEnemy[];
  gathering: ZoneGather[];
  exits: Array<{ edge: 'east'|'west'|'north'|'south'|'northwest'|'northeast'|'southwest'|'southeast'; x: number; y: number; targetZone: number; targetX: number; targetY: number }>;
  /** 副本传送阵坐标（每区域一个入口；可选，缺省用统一默认位置）。 */
  dungeonPortal?: { x: number; y: number };
}

// ── 商店物品生成辅助 ──
