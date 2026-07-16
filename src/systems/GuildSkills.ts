/**
 * 公会技能客户端镜像（v2）——与 server/guildSkills.ts 以 skill_id 对应。
 * 用于 J 面板 UI 展示 + 战斗属性被动加成计算。数值与 server 保持一致。
 */

export type GuildSkillStat = 'atk' | 'def' | 'matk' | 'mdef';

export interface GuildSkillDef {
  id: string;
  name: string;
  desc: string;
  stat: GuildSkillStat;
  perLevel: number;   // 每级加成百分比（2 = +2%/级）
  maxLevel: number;
  costBase: number;
  costStep: number;
}

export const GUILD_SKILLS: GuildSkillDef[] = [
  { id: 'atk',  name: '攻击强化', desc: '全体成员攻击 +2%/级', stat: 'atk',  perLevel: 2, maxLevel: 10, costBase: 50, costStep: 50 },
  { id: 'def',  name: '防御强化', desc: '全体成员防御 +2%/级', stat: 'def',  perLevel: 2, maxLevel: 10, costBase: 50, costStep: 50 },
  { id: 'matk', name: '魔攻强化', desc: '全体成员魔攻 +2%/级', stat: 'matk', perLevel: 2, maxLevel: 10, costBase: 50, costStep: 50 },
  { id: 'mdef', name: '魔防强化', desc: '全体成员魔防 +2%/级', stat: 'mdef', perLevel: 2, maxLevel: 10, costBase: 50, costStep: 50 },
];

export function getGuildSkillDef(id: string): GuildSkillDef | undefined {
  return GUILD_SKILLS.find((s) => s.id === id);
}

/** 从 currentLevel 升到 currentLevel+1 的消耗（公会贡献池）。与 server/guildSkills.ts 保持一致。 */
export function guildSkillCost(def: GuildSkillDef, currentLevel: number): number {
  return def.costBase + def.costStep * currentLevel;
}

/** 公会技能被动加成（小数形式，0.02 = +2%）。叠加所有已学技能等级。 */
export function guildStatBonus(skills: Record<string, number>): { atk: number; def: number; matk: number; mdef: number; spd: number } {
  const out = { atk: 0, def: 0, matk: 0, mdef: 0, spd: 0 };
  for (const def of GUILD_SKILLS) {
    const lv = skills[def.id] || 0;
    if (lv > 0) out[def.stat] += (def.perLevel * lv) / 100;
  }
  return out;
}

/** 把公会技能加成应用到一组战斗属性（atk/def/matk/mdef 乘加成，其余字段原样返回）。 */
export function applyGuildStatBonus(
  stats: { atk: number; def: number; matk: number; mdef: number; [k: string]: any },
  skills: Record<string, number>,
): typeof stats {
  const b = guildStatBonus(skills);
  return {
    ...stats,
    atk: Math.round(stats.atk * (1 + b.atk)),
    def: Math.round(stats.def * (1 + b.def)),
    matk: Math.round(stats.matk * (1 + b.matk)),
    mdef: Math.round(stats.mdef * (1 + b.mdef)),
  };
}
