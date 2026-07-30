/**
 * 斩魄刀注册表 — 稳定 id 为主键，name 为显示名。
 * 所有引用走 id，改名只动 nameMappings.ts 的 SKILL_NAME_MAP + ZANPAKUTO_REMAP。
 */
export interface ZanpakutoDef {
  id: string;
  name: string;
  element: '火' | '风' | '水' | '土';
  growth: Record<string, number>;
  forge?: boolean;
}

/** 全部36把，已换原创名 */
export const ZANPAKUTO_LIST: ZanpakutoDef[] = [
  /* ── 火系9 ── */
  { id:'zp01', name:'焚天', element:'火', growth:{ HP:0.8, MP:1.1, ATK:1.6, DEF:0.6, MATK:1.2, MDEF:0.6, SPD:0.9 } },
  { id:'zp02', name:'燎华', element:'火', growth:{ HP:0.8, MP:1.3, ATK:1.0, DEF:0.7, MATK:1.6, MDEF:0.8, SPD:0.8 } },
  { id:'zp03', name:'赤霞', element:'火', growth:{ HP:1.0, MP:1.2, ATK:1.2, DEF:1.0, MATK:1.3, MDEF:0.9, SPD:0.9 } },
  { id:'zp04', name:'烈阳', element:'火', growth:{ HP:0.9, MP:1.0, ATK:1.8, DEF:0.5, MATK:0.8, MDEF:0.5, SPD:1.0 } },
  { id:'zp05', name:'闪焰', element:'火', growth:{ HP:0.7, MP:0.9, ATK:1.5, DEF:0.5, MATK:0.8, MDEF:0.5, SPD:1.7 } },
  { id:'zp06', name:'蚀火', element:'火', growth:{ HP:0.9, MP:1.3, ATK:1.0, DEF:0.7, MATK:1.5, MDEF:0.9, SPD:0.9, statusAcc:0.10 } },
  { id:'zp07', name:'爆煌', element:'火', growth:{ HP:1.1, MP:1.0, ATK:1.4, DEF:0.9, MATK:1.0, MDEF:0.9, SPD:0.8 } },
  { id:'zp08', name:'蛇炎', element:'火', growth:{ HP:0.7, MP:0.9, ATK:1.6, DEF:0.6, MATK:0.9, MDEF:0.6, SPD:1.2 } },
  { id:'zp09', name:'烬恒', element:'火', growth:{ HP:2.0, MP:1.6, ATK:1.8, DEF:1.8, MATK:1.8, MDEF:1.8, SPD:1.6 }, forge:true },
  /* ── 风系9 ── */
  { id:'zp10', name:'裂风', element:'风', growth:{ HP:1.0, MP:0.9, ATK:1.6, DEF:0.7, MATK:0.7, MDEF:0.7, SPD:1.3 } },
  { id:'zp11', name:'万华', element:'风', growth:{ HP:0.9, MP:0.9, ATK:1.3, DEF:0.7, MATK:0.9, MDEF:0.7, SPD:1.5 } },
  { id:'zp12', name:'疾穿', element:'风', growth:{ HP:0.8, MP:0.8, ATK:1.7, DEF:0.5, MATK:0.6, MDEF:0.5, SPD:1.9 } },
  { id:'zp13', name:'游影', element:'风', growth:{ HP:1.0, MP:1.2, ATK:1.2, DEF:0.8, MATK:1.3, MDEF:0.8, SPD:1.1 } },
  { id:'zp14', name:'缠藤', element:'风', growth:{ HP:0.9, MP:1.3, ATK:1.1, DEF:0.7, MATK:1.4, MDEF:0.8, SPD:1.2, statusAcc:0.10 } },
  { id:'zp15', name:'逆乱', element:'风', growth:{ HP:0.8, MP:1.2, ATK:1.0, DEF:0.7, MATK:1.5, MDEF:0.9, SPD:1.3, statusAcc:0.15 } },
  { id:'zp16', name:'断岚', element:'风', growth:{ HP:1.0, MP:0.9, ATK:1.5, DEF:0.8, MATK:0.8, MDEF:0.7, SPD:1.1 } },
  { id:'zp17', name:'迅蜻', element:'风', growth:{ HP:0.9, MP:1.0, ATK:1.3, DEF:0.8, MATK:1.0, MDEF:0.8, SPD:1.4 } },
  { id:'zp18', name:'疾空', element:'风', growth:{ HP:1.9, MP:1.5, ATK:1.9, DEF:1.7, MATK:1.7, MDEF:1.7, SPD:1.7 }, forge:true },
  /* ── 水系9 ── */
  { id:'zp19', name:'沧渊', element:'水', growth:{ HP:1.0, MP:1.3, ATK:1.0, DEF:0.8, MATK:1.5, MDEF:1.0, SPD:0.8, statusAcc:0.15 } },
  { id:'zp20', name:'霜华', element:'水', growth:{ HP:1.0, MP:1.2, ATK:1.2, DEF:0.7, MATK:1.5, MDEF:0.9, SPD:1.0, statusAcc:0.10 } },
  { id:'zp21', name:'幻溟', element:'水', growth:{ HP:0.9, MP:1.5, ATK:0.8, DEF:0.7, MATK:1.7, MDEF:1.0, SPD:1.0, statusAcc:0.10 } },
  { id:'zp22', name:'双漪', element:'水', growth:{ HP:1.1, MP:1.2, ATK:0.8, DEF:1.0, MATK:1.2, MDEF:1.6, SPD:0.7 } },
  { id:'zp23', name:'湛愈', element:'水', growth:{ HP:1.3, MP:1.5, ATK:0.7, DEF:0.9, MATK:1.4, MDEF:1.3, SPD:0.8 } },
  { id:'zp24', name:'潋光', element:'水', growth:{ HP:0.9, MP:1.4, ATK:0.9, DEF:0.7, MATK:1.6, MDEF:1.0, SPD:0.9 } },
  { id:'zp25', name:'漩流', element:'水', growth:{ HP:1.0, MP:1.1, ATK:1.3, DEF:0.8, MATK:1.2, MDEF:0.9, SPD:1.0 } },
  { id:'zp26', name:'澪光', element:'水', growth:{ HP:1.2, MP:1.4, ATK:0.7, DEF:0.9, MATK:1.3, MDEF:1.2, SPD:0.8 } },
  { id:'zp27', name:'寂渊', element:'水', growth:{ HP:2.0, MP:1.6, ATK:1.8, DEF:1.8, MATK:1.8, MDEF:1.8, SPD:1.6 }, forge:true },
  /* ── 土系9 ── */
  { id:'zp28', name:'镇岳', element:'土', growth:{ HP:1.4, MP:0.9, ATK:1.2, DEF:1.4, MATK:0.8, MDEF:1.2, SPD:0.7, statusAcc:0.10 } },
  { id:'zp29', name:'牙棘', element:'土', growth:{ HP:1.2, MP:0.9, ATK:1.5, DEF:1.0, MATK:0.8, MDEF:0.9, SPD:1.1 } },
  { id:'zp30', name:'碎岩', element:'土', growth:{ HP:1.2, MP:0.8, ATK:1.6, DEF:1.1, MATK:0.7, MDEF:1.0, SPD:0.8 } },
  { id:'zp31', name:'尘灰', element:'土', growth:{ HP:1.0, MP:1.1, ATK:1.1, DEF:0.9, MATK:1.2, MDEF:1.0, SPD:1.1 } },
  { id:'zp32', name:'沉钧', element:'土', growth:{ HP:1.3, MP:0.9, ATK:0.9, DEF:1.5, MATK:0.7, MDEF:1.4, SPD:0.6 } },
  { id:'zp33', name:'地震', element:'土', growth:{ HP:1.1, MP:0.9, ATK:1.2, DEF:1.2, MATK:0.8, MDEF:1.2, SPD:0.9 } },
  { id:'zp34', name:'重锤', element:'土', growth:{ HP:1.5, MP:0.8, ATK:0.8, DEF:1.6, MATK:0.6, MDEF:1.5, SPD:0.5 } },
  { id:'zp35', name:'崩岩', element:'土', growth:{ HP:1.1, MP:0.9, ATK:1.5, DEF:1.0, MATK:0.7, MDEF:0.9, SPD:0.9 } },
  { id:'zp36', name:'不动', element:'土', growth:{ HP:2.1, MP:1.5, ATK:1.8, DEF:2.0, MATK:1.7, MDEF:2.0, SPD:1.5 }, forge:true },
];

export const ZANPAKUTO_BY_ID: Record<string, ZanpakutoDef> = Object.fromEntries(ZANPAKUTO_LIST.map(z => [z.id, z]));

/** id→元素（承接原 ZANPAKUTO_ELEMENT） */
export const ZANPAKUTO_ELEMENT: Record<string, string> = Object.fromEntries(ZANPAKUTO_LIST.map(z => [z.id, z.element]));

/** 按元素获取刀id列表 */
export function getZanpakutoIdsByElement(element: string): string[] {
  return ZANPAKUTO_LIST.filter(z => z.element === element).map(z => z.id);
}

export function zanpakutoName(id: string): string { return ZANPAKUTO_BY_ID[id]?.name ?? id; }
export function zanpakutoElement(id: string): string { return ZANPAKUTO_ELEMENT[id] ?? ''; }
export function zanpakutoGrowth(id: string): Record<string, number> { return ZANPAKUTO_BY_ID[id]?.growth ?? {}; }
