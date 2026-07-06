/**
 * 技能特殊机制系统 — 实现技能描述中提到但未落地的特殊效果
 * 涵盖：多段攻击 / 吸血 / 标记引爆 / 反伤 / 自身buff / 敌人debuff / 条件增伤 / HP消耗 / 无视防御 / MP吸取
 */

import { EnemyStatus, PlayerStatus } from './StatusSystem';

/** 技能特殊机制类型 */
export type SkillMechanicType =
  | 'multiHit'
  | 'lifesteal'
  | 'mark'
  | 'markDetonate'
  | 'reflect'
  | 'buffSelf'
  | 'debuffEnemy'
  | 'conditionalDamage'
  | 'hpCost'
  | 'ignoreDef'
  | 'mpSteal'
  | 'shield'
  | 'regen'
  | 'aoeHeal'
  | 'cleanse'
  | 'speedScaling';

export interface SkillMechanic {
  type: SkillMechanicType;
  hits?: number;            // multiHit
  lifestealPct?: number;    // lifesteal: 回复造成伤害的百分比
  markTurns?: number;       // mark: 标记持续回合
  markMult?: number;        // markDetonate: 标记目标伤害倍率
  reflectPct?: number;      // reflect: 反伤比例
  reflectTurns?: number;    // reflect: 持续回合
  buffStat?: string;         // buffSelf
  buffValue?: number;
  buffTurns?: number;
  debuffType?: string;     // debuffEnemy (atkDown/defDown/slow/fear/taunt/accDown)
  debuffValue?: number;     // debuffEnemy (百分比降幅)
  debuffTurns?: number;
  condition?: string;       // conditionalDamage: 目标需有的状态 (poison/freeze/stun/defDown)
  dmgMult?: number;         // conditionalDamage: 满足条件时伤害倍率
  hpCostPct?: number;       // hpCost: 消耗当前HP百分比
  hpCostDmgMult?: number;   // hpCost: 消耗HP后伤害倍率
  mpStealPct?: number;      // mpSteal: 吸取敌方MP百分比
  shieldPct?: number;       // shield: 护盾值 (基于def的倍率)
  shieldTurns?: number;
  regenPct?: number;        // regen: 每回合回复HP百分比 (基于matk)
  regenTurns?: number;
  healPct?: number;         // aoeHeal: 全队回复 (基于matk)
  cleanse?: boolean;         // cleanSe: 净化异常状态
  spdScalePct?: number;     // speedScaling: 目标速度每低10%伤害+x%
}

/** 战斗中标记系统 */
export interface MarkState {
  active: boolean;
  turns: number;
  // 标记引爆时附加伤害倍率
  detonateMult: number;
}

// ═══════════════════════════════════════════
// 技能特殊机制注册表 — 按技能名索引
// ═══════════════════════════════════════════

export const SKILL_MECHANICS: Record<string, SkillMechanic[]> = {
  // ── 火系 ──
  '焚城': [
    { type: 'debuffEnemy', debuffType: 'burn', debuffTurns: 3 },
  ],
  '火种': [
    { type: 'mark', markTurns: 2, markMult: 1.5 },
  ],
  '飞梅': [
    { type: 'markDetonate', markMult: 1.8 },
  ],
  '血霞之盾': [
    { type: 'buffSelf', buffStat: 'def', buffValue: 0.50, buffTurns: 3 },
    { type: 'reflect', reflectPct: 0.30, reflectTurns: 3 },
  ],
  '黑牙': [
    { type: 'hpCost', hpCostPct: 0.20, hpCostDmgMult: 2.0 },
  ],
  '二击必杀': [
    { type: 'mark', markTurns: 3, markMult: 5.0 },
  ],
  '雀蜂迅雷': [
    { type: 'buffSelf', buffStat: 'crit', buffValue: 0.20, buffTurns: 1 },
  ],
  '地蔵针': [
    { type: 'conditionalDamage', condition: 'poison', dmgMult: 2.0 },
  ],
  '天狗烈风': [
    { type: 'debuffEnemy', debuffType: 'atkDown', debuffValue: 0.15, debuffTurns: 3 },
  ],
  '蛇咬': [
    { type: 'debuffEnemy', debuffType: 'burn', debuffTurns: 3 },
  ],

  // ── 风系 ──
  '天冲': [
    { type: 'buffSelf', buffStat: 'spd', buffValue: 0.20, buffTurns: 3 },
  ],
  '千景': [
    { type: 'multiHit', hits: 5 },
    { type: 'debuffEnemy', debuffType: 'defDown', debuffValue: 0.20, debuffTurns: 3 },
  ],
  '吭景': [
    { type: 'ignoreDef' },
  ],
  '神枪连突': [
    { type: 'multiHit', hits: 4 },
  ],
  '孔雀开屏': [
    { type: 'mpSteal', mpStealPct: 0.15 },
  ],
  '崭鬼': [
    { type: 'speedScaling', spdScalePct: 0.05 },
  ],
  '断风': [
    { type: 'buffSelf', buffStat: 'crit', buffValue: 0.15, buffTurns: 1 },
  ],
  '地裂风': [
    { type: 'debuffEnemy', debuffType: 'slow', debuffValue: 0.15, debuffTurns: 3 },
  ],
  '蜻蛉切': [
    { type: 'buffSelf', buffStat: 'crit', buffValue: 0.20, buffTurns: 1 },
    { type: 'debuffEnemy', debuffType: 'defDown', debuffValue: 0.15, debuffTurns: 2 },
  ],
  '铁浆蜻蛉·万贯': [
    { type: 'multiHit', hits: 3 },
    { type: 'debuffEnemy', debuffType: 'defDown', debuffValue: 0.25, debuffTurns: 3 },
  ],

  // ── 水系 ──
  '白涟': [
    { type: 'conditionalDamage', condition: 'freeze', dmgMult: 3.0 },
  ],
  '白刀': [
    { type: 'conditionalDamage', condition: 'freeze', dmgMult: 1.5 },
    { type: 'ignoreDef' },
  ],
  '吸收': [
    { type: 'shield', shieldPct: 2.0, shieldTurns: 1 },
  ],
  '反転': [
    { type: 'buffSelf', buffStat: 'mdef', buffValue: 0.30, buffTurns: 3 },
  ],
  '愈': [
    { type: 'aoeHeal', healPct: 2.0 },
  ],
  '雫': [
    { type: 'aoeHeal', healPct: 1.2 },
    { type: 'cleanse', cleanse: true },
  ],
  '愈之光': [
    { type: 'aoeHeal', healPct: 1.5 },
  ],
  '瓠丸闪光': [
    { type: 'buffSelf', buffStat: 'atk', buffValue: 0.10, buffTurns: 3 },
  ],
  '缚之歌': [
    { type: 'debuffEnemy', debuffType: 'stun', debuffTurns: 2 },
  ],
  '潮旋': [
    { type: 'debuffEnemy', debuffType: 'slow', debuffValue: 0.20, debuffTurns: 3 },
  ],

  // ── 土系 ──
  '明王': [
    { type: 'debuffEnemy', debuffType: 'slow', debuffValue: 0.20, debuffTurns: 3 },
  ],
  '狒牙绝咬': [
    { type: 'debuffEnemy', debuffType: 'burn', debuffTurns: 3 },
  ],
  '三节裂甲': [
    { type: 'debuffEnemy', debuffType: 'defDown', debuffValue: 0.25, debuffTurns: 3 },
  ],
  '龙纹鬼灯': [
    { type: 'conditionalDamage', condition: 'defDown', dmgMult: 1.5 },
  ],
  '灰化': [
    { type: 'debuffEnemy', debuffType: 'accDown', debuffValue: 0.20, debuffTurns: 3 },
  ],
  '猫袭': [
    { type: 'debuffEnemy', debuffType: 'burn', debuffTurns: 3 },
  ],
  '重压': [
    { type: 'debuffEnemy', debuffType: 'slow', debuffValue: 0.30, debuffTurns: 3 },
  ],
  '侘助百贯': [
    { type: 'speedScaling', spdScalePct: 0.10 },
  ],
  '土流壁': [
    { type: 'buffSelf', buffStat: 'def', buffValue: 0.30, buffTurns: 3 },
  ],
  '地鸣震': [
    { type: 'debuffEnemy', debuffType: 'stun', debuffTurns: 1 },
  ],

  // ── 卍解 ──
  '残火太刀·西': [
    { type: 'debuffEnemy', debuffType: 'burn', debuffTurns: 5 },
  ],
  '飞梅·百花缭乱': [
    { type: 'markDetonate', markMult: 2.0 },
  ],
  '千本樱·歼景': [
    { type: 'multiHit', hits: 7 },
  ],
  '千本樱·景严': [
    { type: 'multiHit', hits: 10 },
  ],
  '神枪·连杀': [
    { type: 'multiHit', hits: 5 },
  ],
  '大红莲冰轮丸': [
    { type: 'debuffEnemy', debuffType: 'freeze', debuffTurns: 2 },
  ],
  '白霞罚': [
    { type: 'debuffEnemy', debuffType: 'freeze', debuffTurns: 1 },
  ],
  '黑绳天谴明王': [
    { type: 'debuffEnemy', debuffType: 'stun', debuffTurns: 2 },
  ],
  '金沙罗·舞踏连刃': [
    { type: 'multiHit', hits: 4 },
    { type: 'debuffEnemy', debuffType: 'stun', debuffTurns: 2 },
  ],
  '土鯰·大地震': [
    { type: 'debuffEnemy', debuffType: 'slow', debuffValue: 0.30, debuffTurns: 3 },
  ],
  '肉雫唼·皆尽': [
    { type: 'aoeHeal', healPct: 5.0 },
    { type: 'cleanse', cleanse: true },
  ],
  '瓠丸·神愈': [
    { type: 'aoeHeal', healPct: 3.0 },
  ],
  '瓠丸·光愈': [
    { type: 'aoeHeal', healPct: 2.0 },
    { type: 'cleanse', cleanse: true },
  ],
  '肉雫唼·大愈': [
    { type: 'aoeHeal', healPct: 3.5 },
  ],

  // ── 虚化/狱解 ──
  '虚闪': [
    { type: 'lifesteal', lifestealPct: 0.10 },
  ],
  '王虚闪': [
    { type: 'lifesteal', lifestealPct: 0.15 },
  ],
  '狱炎': [
    { type: 'debuffEnemy', debuffType: 'burn', debuffTurns: 5 },
    { type: 'lifesteal', lifestealPct: 0.20 },
  ],
};

/** 获取技能的特殊机制列表 */
export function getSkillMechanics(skillName: string): SkillMechanic[] {
  return SKILL_MECHANICS[skillName] || [];
}

// ═══════════════════════════════════════════
// 机制应用辅助
// ═══════════════════════════════════════════

/** 检查条件增伤是否触发 */
export function checkCondition(
  enemyStatus: EnemyStatus,
  condition: string,
): boolean {
  switch (condition) {
    case 'poison':  return enemyStatus.poison > 0;
    case 'freeze':  return enemyStatus.freeze > 0 || enemyStatus.frozen > 0;
    case 'stun':    return enemyStatus.stun > 0;
    case 'burn':    return enemyStatus.burn > 0;
    case 'defDown': return enemyStatus.defDown > 0;
    case 'bind':    return enemyStatus.bind > 0 || enemyStatus.bound > 0;
    default:        return false;
  }
}

/** 计算条件增伤后的伤害倍率 */
export function applyConditionalDamage(
  mechanics: SkillMechanic[],
  enemyStatus: EnemyStatus,
): number {
  let mult = 1.0;
  for (const m of mechanics) {
    if (m.type === 'conditionalDamage' && m.condition && m.dmgMult) {
      if (checkCondition(enemyStatus, m.condition)) {
        mult *= m.dmgMult;
      }
    }
  }
  return mult;
}

/** 检查是否有无视防御 */
export function hasIgnoreDef(mechanics: SkillMechanic[]): boolean {
  return mechanics.some(m => m.type === 'ignoreDef');
}

/** 检查是否有HP消耗 */
export function getHpCost(mechanics: SkillMechanic[], currentHp: number): { cost: number; dmgMult: number } | null {
  const hpCost = mechanics.find(m => m.type === 'hpCost');
  if (!hpCost || !hpCost.hpCostPct) return null;
  return {
    cost: Math.round(currentHp * hpCost.hpCostPct),
    dmgMult: hpCost.hpCostDmgMult || 1.0,
  };
}

/** 获取多段攻击次数 (默认1次) */
export function getMultiHitCount(mechanics: SkillMechanic[]): number {
  const multi = mechanics.find(m => m.type === 'multiHit');
  return multi?.hits || 1;
}

/** 获取吸血比例 */
export function getLifestealPct(mechanics: SkillMechanic[]): number {
  const ls = mechanics.find(m => m.type === 'lifesteal');
  return ls?.lifestealPct || 0;
}

/** 获取MP吸取比例 */
export function getMpStealPct(mechanics: SkillMechanic[]): number {
  const ms = mechanics.find(m => m.type === 'mpSteal');
  return ms?.mpStealPct || 0;
}

/** 获取速度缩放 */
export function getSpeedScaling(mechanics: SkillMechanic[], enemySpd: number, playerSpd: number): number {
  const ss = mechanics.find(m => m.type === 'speedScaling');
  if (!ss || !ss.spdScalePct) return 1.0;
  const spdDiff = Math.max(0, playerSpd - enemySpd);
  const bonus = Math.floor(spdDiff / (playerSpd * 0.1)) * ss.spdScalePct;
  return 1.0 + Math.min(bonus, 0.50); // 上限+50%
}

/** 应用debuff到敌人 */
export function applyDebuffFromMechanics(
  mechanics: SkillMechanic[],
  enemyStatus: EnemyStatus,
  enemyStatusRes: number,
): string[] {
  const applied: string[] = [];
  for (const m of mechanics) {
    if (m.type !== 'debuffEnemy' || !m.debuffType) continue;
    // 抗性检定
    const baseRate = m.debuffType === 'stun' ? 0.40 : m.debuffType === 'burn' ? 0.50 : 0.60;
    const finalRate = Math.max(0.05, baseRate - enemyStatusRes);
    if (Math.random() > finalRate) continue;

    const turns = m.debuffTurns || 3;
    switch (m.debuffType) {
      case 'atkDown': enemyStatus.atkDown = Math.max(enemyStatus.atkDown, turns); applied.push('攻击降低'); break;
      case 'defDown': enemyStatus.defDown = Math.max(enemyStatus.defDown, turns); applied.push('防御降低'); break;
      case 'slow':   enemyStatus.slow = Math.max(enemyStatus.slow, turns); enemyStatus.slowed = Math.max(enemyStatus.slowed, turns); applied.push('减速'); break;
      case 'burn':    enemyStatus.burn = Math.max(enemyStatus.burn, turns); applied.push('灼烧'); break;
      case 'fear':    enemyStatus.fear = Math.max(enemyStatus.fear, turns); applied.push('恐惧'); break;
      case 'stun':    enemyStatus.stun = Math.max(enemyStatus.stun, turns); applied.push('眩晕'); break;
      case 'taunt':   enemyStatus.taunt = Math.max(enemyStatus.taunt, turns); applied.push('嘲讽'); break;
      case 'matkDown': enemyStatus.matkDown = Math.max(enemyStatus.matkDown, turns); applied.push('降灵压'); break;
      case 'accDown': enemyStatus.atkDown = Math.max(enemyStatus.atkDown, turns); applied.push('命中降低'); break;
    }
  }
  return applied;
}

/** 应用自身buff */
export interface BuffResult {
  stat: string;
  value: number;
  turns: number;
}
export function getBuffsFromMechanics(mechanics: SkillMechanic[]): BuffResult[] {
  const buffs: BuffResult[] = [];
  for (const m of mechanics) {
    if (m.type === 'buffSelf' && m.buffStat && m.buffValue) {
      buffs.push({ stat: m.buffStat, value: m.buffValue, turns: m.buffTurns || 3 });
    }
  }
  return buffs;
}

/** 获取护盾值 */
export function getShieldFromMechanics(mechanics: SkillMechanic[], playerDef: number): { amount: number; turns: number } | null {
  const sh = mechanics.find(m => m.type === 'shield');
  if (!sh || !sh.shieldPct) return null;
  return {
    amount: Math.round(playerDef * sh.shieldPct),
    turns: sh.shieldTurns || 2,
  };
}

/** 检查是否为净化技能 */
export function isCleanseSkill(mechanics: SkillMechanic[]): boolean {
  return mechanics.some(m => m.type === 'cleanse');
}

/** 获取全队治疗量 (基于matk) */
export function getAoEHealAmount(mechanics: SkillMechanic[], playerMatk: number): number {
  const heal = mechanics.find(m => m.type === 'aoeHeal');
  if (!heal || !heal.healPct) return 0;
  return Math.round(playerMatk * heal.healPct);
}

/** 获取反伤信息 */
export function getReflectInfo(mechanics: SkillMechanic[]): { pct: number; turns: number } | null {
  const r = mechanics.find(m => m.type === 'reflect');
  if (!r) return null;
  return { pct: r.reflectPct || 0.20, turns: r.reflectTurns || 3 };
}

/** 获取标记信息 */
export function getMarkInfo(mechanics: SkillMechanic[]): { turns: number; detonateMult: number } | null {
  const m = mechanics.find(x => x.type === 'mark');
  if (!m) return null;
  return { turns: m.markTurns || 3, detonateMult: m.markMult || 2.0 };
}

/** 检查是否有标记引爆 */
export function getMarkDetonateMult(mechanics: SkillMechanic[]): number {
  const d = mechanics.find(m => m.type === 'markDetonate');
  return d?.markMult || 0;
}
