/**
 * WorldService 装备/强化/精炼/分解/制造子系统
 */
import { makeSetId } from '../../../src/managers/SetSystem';
import type { EquipSlot } from '../../../src/managers/Inventory';

const ENHANCE_RATES: number[] = [1, 1, 1, 1, 1, 0.85, 0.70, 0.55, 0.42, 0.30];
const QUALITY_MULT: Record<string, number> = { white: 1.0, green: 1.15, blue: 1.35, purple: 1.6, gold: 2.0 };
const REFINE_SLOTS: Record<string, number> = { white: 1, green: 1, blue: 2, purple: 2, gold: 3 };
const REFINE_STAT_POOL: Array<{ key: string; weight: number }> = [
  { key: 'atk', weight: 20 }, { key: 'def', weight: 20 }, { key: 'matk', weight: 20 },
  { key: 'mdef', weight: 20 }, { key: 'hp', weight: 15 }, { key: 'mp', weight: 15 }, { key: 'spd', weight: 10 },
];
const REFINE_MAT_MAP: Record<string, string> = { white: '\u94c1\u77ff\u77f3', green: '\u94c1\u77ff\u77f3', blue: '\u94f6\u77ff\u77f3', purple: '\u5996\u5c06\u6838\u5fc3', gold: '\u4f20\u8bf4\u6750\u6599\u788e\u7247' };
const DECOMP_MATERIALS: Record<string, Array<{ name: string; qty: number }>> = {
  white: [{ name: '\u94c1\u77ff\u77f3', qty: 1 }], green: [{ name: '\u94c1\u77ff\u77f3', qty: 1 }, { name: '\u94f6\u77ff\u77f3', qty: 1 }],
  blue: [{ name: '\u94f6\u77ff\u77f3', qty: 1 }, { name: '\u5996\u5c06\u6838\u5fc3', qty: 1 }],
  purple: [{ name: '\u5996\u5c06\u6838\u5fc3', qty: 1 }, { name: '\u4f20\u8bf4\u6750\u6599\u788e\u7247', qty: 1 }],
  gold: [{ name: '\u4f20\u8bf4\u6750\u6599\u788e\u7247', qty: 1 }],
};
const DECOMP_GOLD_BASE: Record<string, number> = { white: 50, green: 150, blue: 400, purple: 1000, gold: 3000 };
const CRAFT_RECIPES: Record<string, { name: string; materials: Record<string, number>; slot: string; stats: Record<string, number> }> = {
  iron_sword: { name: '\u94c1\u5251', materials: { '\u94c1\u77ff\u77f3': 3, '\u7075\u6728\u679d': 1 }, slot: 'weapon', stats: { atk: 25 } },
  iron_armor: { name: '\u94c1\u7532', materials: { '\u94c1\u77ff\u77f3': 5, '\u9ebb\u5e03\u7247': 2 }, slot: 'body', stats: { def: 20, hp: 30 } },
  iron_gauntlet: { name: '\u94c1\u624b\u7532', materials: { '\u94c1\u77ff\u77f3': 2, '\u7075\u6728\u679d': 1 }, slot: 'bracer', stats: { atk: 12, def: 8 } },
};

// Placeholder - implementations will be filled by reading from git
export function equip(scene: any, pw: any, itemId: string): any { return scene.equip(pw, itemId); }
export function unequip(scene: any, pw: any, slot: any): any { return scene.unequip(pw, slot); }
export function craft(scene: any, pw: any, recipeName: string, zone?: number): any { return scene.craft(pw, recipeName, zone); }
export function enhance(scene: any, pw: any, itemId: string): any { return scene.enhance(pw, itemId); }
export function refine(scene: any, pw: any, itemId: string): any { return scene.refine(pw, itemId); }
export function decompose(scene: any, pw: any, itemId: string): any { return scene.decompose(pw, itemId); }
export function refineReset(scene: any, pw: any, itemId: string): any { return scene.refineReset(pw, itemId); }
