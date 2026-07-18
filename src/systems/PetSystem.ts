/**
 * 灵宠系统（客户端）— 《解》联机版
 *
 * 设计基线（与套装/装备一致：服务端权威 + 落 PlayerWorld，客户端仅做展示与光环加成计算）：
 * - 灵宠所有权/属性快照由服务端 PlayerWorld.pets 持有，worldSync 下发后由 WorldClient 重建 GameState.pets。
 * - 客户端只在 recalcStats 里按「出战灵宠」算一层光环（属性比例加成），不做战斗流程改写（战斗协同留 v2）。
 * - 物种展示字段（名称/图标/颜色/描述/技能名）在此镜像一份，纯展示用，不参与数值。
 */

/** 客户端灵宠物种展示表（与服务端 PET_SPECIES 字段保持一致）。 */
export const PET_SPECIES_CLIENT: Record<string, { name: string; icon: string; color: number; desc: string; skillName?: string }> = {
  fox_fire: { name: '赤焰狐', icon: '🦊', color: 0xff6633, desc: '火属性灵狐，魔攻与速度见长。', skillName: '烈焰吐息' },
  tortoise_rock: { name: '玄岩龟', icon: '🐢', color: 0x889977, desc: '土属性灵龟，血厚防高。', skillName: '岩石壁垒' },
  hawk_wind: { name: '青翼鹰', icon: '🦅', color: 0x66ccff, desc: '风属性灵鹰，速度与物攻突出。' },
  serpent_water: { name: '碧水蟒', icon: '🐍', color: 0x33ccaa, desc: '水属性灵蟒，魔攻与血量兼备。' },
  wolf_shadow: { name: '暗影狼', icon: '🐺', color: 0x9966cc, desc: '暗属性灵狼，物攻与速度凶猛。' },
  bear_earth: { name: '撼地熊', icon: '🐻', color: 0xcc8844, desc: '土属性灵熊，血防物攻全面。' },
  rabbit_spirit: { name: '灵兔', icon: '🐇', color: 0xff99cc, desc: '光属性灵兔，魔防与速度灵巧。' },
  dragonet: { name: '幼麟', icon: '🐉', color: 0xffcc33, desc: '稀有麒麟幼兽，六维均衡且成长极高。', skillName: '祥瑞' },
};

/** 灵宠光环（出战灵宠按固定比例提升玩家属性）。 */
export interface PetAura {
  hp: number; atk: number; def: number; matk: number; mdef: number; spd: number;
}

/**
 * 计算出战灵宠对玩家的属性光环。
 * 比例：HP +10% / ATK·DEF·MATK·MDEF·SPD 各 +20%（直接吃灵宠当前属性快照）。
 * 灵宠无 MP 字段，故光环不含 MP。
 */
export function computePetAura(pet: any): PetAura | null {
  if (!pet) return null;
  return {
    hp: Math.round((pet.maxHp || 0) * 0.10),
    atk: Math.round((pet.atk || 0) * 0.20),
    def: Math.round((pet.def || 0) * 0.20),
    matk: Math.round((pet.matk || 0) * 0.20),
    mdef: Math.round((pet.mdef || 0) * 0.20),
    spd: Math.round((pet.spd || 0) * 0.20),
  };
}

/** 取灵宠显示名（物种表兜底，避免未知物种显示 id）。 */
export function petDisplayName(speciesId: string): string {
  return PET_SPECIES_CLIENT[speciesId]?.name || speciesId;
}

/** 取灵宠图标（物种表兜底）。 */
export function petIcon(speciesId: string): string {
  return PET_SPECIES_CLIENT[speciesId]?.icon || '❔';
}

/** 取灵宠主题色（物种表兜底，UI 描边/方块用）。 */
export function petColor(speciesId: string): number {
  return PET_SPECIES_CLIENT[speciesId]?.color ?? 0x888888;
}
