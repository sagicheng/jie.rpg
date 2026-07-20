// 区域配置数据 — Bleach 原著世界观 21 区域完整版（按区域拆分，详见 ./zones）
import type { ZoneConfig } from './types';
import { zone01 } from './zone_01_urahara';
import { zone02 } from './zone_02_karakura_high';
import { zone03 } from './zone_03_riverbank';
import { zone04 } from './zone_04_runlin_an';
import { zone05 } from './zone_05_xudiao';
import { zone06 } from './zone_06_caolu';
import { zone07 } from './zone_07_first_division';
import { zone08 } from './zone_08_tech_bureau';
import { zone09 } from './zone_09_shinou_academy';
import { zone10 } from './zone_10_white_sand';
import { zone11 } from './zone_11_hueco_deep';
import { zone12 } from './zone_12_las_noches';
import { zone13 } from './zone_13_battle_ruins';
import { zone14 } from './zone_14_xcution_base';
import { zone15 } from './zone_15_fullbring_hq';
import { zone16 } from './zone_16_shadow_realm';
import { zone17 } from './zone_17_wandenreich';
import { zone18 } from './zone_18_silbern';
import { zone19 } from './zone_19_sinner_gate';
import { zone20 } from './zone_20_mugen';
import { zone21 } from './zone_21_abyss_end';

export const ZONE_CONFIGS: Record<number, ZoneConfig> = {
  1: zone01,
  2: zone02,
  3: zone03,
  4: zone04,
  5: zone05,
  6: zone06,
  7: zone07,
  8: zone08,
  9: zone09,
  10: zone10,
  11: zone11,
  12: zone12,
  13: zone13,
  14: zone14,
  15: zone15,
  16: zone16,
  17: zone17,
  18: zone18,
  19: zone19,
  20: zone20,
  21: zone21,
};

export function getDungeonPortal(zone: number): { x: number; y: number } {
  const cfg = ZONE_CONFIGS[zone];
  if (cfg && cfg.dungeonPortal) return cfg.dungeonPortal;
  return { x: 0.1, y: 0.12 };
}

// 向后兼容：原 src/config/Zones.ts 导出的类型
export type { ZoneConfig, ZoneNPC, ZoneEnemy, ZoneGather } from './types';
