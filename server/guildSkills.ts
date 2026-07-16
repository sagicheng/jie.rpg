/**
 * 公会技能定义（v2）——服务端权威元数据。
 * 影响成员战斗属性的被动加成，全体公会成员受益。
 * 客户端镜像一份（src/systems/GuildSkills.ts）用于 UI 展示与战斗加成计算，
 * 两边以 skill_id 对应。数值可调。
 */

export type GuildSkillStat = 'atk' | 'def' | 'matk' | 'mdef';

export interface GuildSkillDef {
  id: string;
  name: string;
  desc: string;
  stat: GuildSkillStat;
  perLevel: number;   // 每级加成百分比（2 = +2%/级）
  maxLevel: number;
  costBase: number;   // 升到 1 级消耗的公会贡献池
  costStep: number;   // 每多升一级递增的消耗
}

export const GUILD_SKILLS: GuildSkillDef[] = [
  { id: 'atk',  name: '攻击强化', desc: '全体成员攻击 +2%/级', stat: 'atk',  perLevel: 2, maxLevel: 10, costBase: 50, costStep: 50 },
  { id: 'def',  name: '防御强化', desc: '全体成员防御 +2%/级', stat: 'def',  perLevel: 2, maxLevel: 10, costBase: 50, costStep: 50 },
  { id: 'matk', name: '魔攻强化', desc: '全体成员魔攻 +2%/级', stat: 'matk', perLevel: 2, maxLevel: 10, costBase: 50, costStep: 50 },
  { id: 'mdef', name: '魔防强化', desc: '全体成员魔防 +2%/级', stat: 'mdef', perLevel: 2, maxLevel: 10, costBase: 50, costStep: 50 },
];

/** 从 currentLevel 升到 currentLevel+1 的消耗（公会贡献池）。 */
export function guildSkillCost(def: GuildSkillDef, currentLevel: number): number {
  return def.costBase + def.costStep * currentLevel;
}

export function getGuildSkillDef(id: string): GuildSkillDef | undefined {
  return GUILD_SKILLS.find((s) => s.id === id);
}
