/**
 * 状态效果系统 — 12种完整状态效果
 * 用于 BattleScene 中的玩家和敌人状态管理
 */

export type StatusType =
  | 'burn' | 'freeze' | 'poison' | 'parasite'
  | 'slow' | 'stun' | 'bind' | 'taunt'
  | 'fear' | 'atkDown' | 'defDown' | 'matkDown';

/** 状态效果定义 */
export const STATUS_INFO: Record<StatusType, {
  name: string;
  icon: string;
  maxTurns: number;
  blocksAction: boolean;
  dotPct: number;       // 每回合损失HP% (0=无)
  mpDrainPct: number;   // 每回合损失MP% (0=无)
  statMod: number;      // 属性修正倍率 (1.0=无)
}> = {
  burn:     { name: '灼烧', icon: '🔥', maxTurns: 3, blocksAction: false, dotPct: 0.05, mpDrainPct: 0,    statMod: 1.0 },
  freeze:   { name: '冻结', icon: '❄️', maxTurns: 2, blocksAction: true,  dotPct: 0,    mpDrainPct: 0,    statMod: 1.0 },
  poison:   { name: '中毒', icon: '☠️', maxTurns: 5, blocksAction: false, dotPct: 0.03, mpDrainPct: 0.03, statMod: 1.0 },
  parasite: { name: '寄生', icon: '🦠', maxTurns: 4, blocksAction: false, dotPct: 0.05, mpDrainPct: 0,    statMod: 1.0 },
  slow:     { name: '减速', icon: '🐌', maxTurns: 3, blocksAction: false, dotPct: 0,    mpDrainPct: 0,    statMod: 0.7 },
  stun:     { name: '眩晕', icon: '💫', maxTurns: 2, blocksAction: true,  dotPct: 0,    mpDrainPct: 0,    statMod: 1.0 },
  bind:     { name: '禁锢', icon: '⛓️', maxTurns: 2, blocksAction: true,  dotPct: 0,    mpDrainPct: 0,    statMod: 1.0 },
  taunt:    { name: '嘲讽', icon: '😤', maxTurns: 2, blocksAction: false, dotPct: 0,    mpDrainPct: 0,    statMod: 1.0 },
  fear:     { name: '恐惧', icon: '👁️', maxTurns: 2, blocksAction: false, dotPct: 0,    mpDrainPct: 0,    statMod: 1.0 },
  atkDown:  { name: '攻降', icon: '⬇️', maxTurns: 3, blocksAction: false, dotPct: 0,    mpDrainPct: 0,    statMod: 0.75 },
  defDown:  { name: '防降', icon: '🛡️', maxTurns: 3, blocksAction: false, dotPct: 0,    mpDrainPct: 0,    statMod: 0.75 },
  matkDown: { name: '降灵压', icon: '🌀', maxTurns: 3, blocksAction: false, dotPct: 0,    mpDrainPct: 0,    statMod: 0.85 },
};

// ═══════════════════════════════════════════
// 敌人状态接口
// ═══════════════════════════════════════════

export interface EnemyStatus {
  burn: number;
  freeze: number;
  poison: number;
  poisonDmg: number;    // 每回合毒伤害值
  parasite: number;
  slow: number;
  stun: number;
  bind: number;
  taunt: number;
  fear: number;
  atkDown: number;
  defDown: number;
  matkDown: number;
  // 鬼道系统遗留字段（兼容）
  sealed: number;
  slowed: number;       // 旧字段，等同slow
  bound: number;        // 旧字段，等同bind
  frozen: number;       // 旧字段，等同freeze
}

/** 创建空白敌人状态 */
export function createEnemyStatus(): EnemyStatus {
  return {
    burn: 0, freeze: 0, poison: 0, poisonDmg: 0, parasite: 0,
    slow: 0, stun: 0, bind: 0, taunt: 0, fear: 0,
    atkDown: 0, defDown: 0, matkDown: 0,
    sealed: 0, slowed: 0, bound: 0, frozen: 0,
  };
}

// ═══════════════════════════════════════════
// 玩家状态接口
// ═══════════════════════════════════════════

export interface PlayerStatus {
  burn: number;
  freeze: number;
  poison: number;
  poisonDmg: number;
  parasite: number;
  slow: number;
  stun: number;
  bind: number;
  taunt: number;
  tauntSourceIdx: number;   // 嘲讽来源敌人索引 (-1=无)
  fear: number;
  atkDown: number;
  defDown: number;
  matkDown: number;
  // 鬼道遗留
  playerShield: number;
  playerShieldTurns: number;
  regenAmount: number;
  regenTurns: number;
}

/** 创建空白玩家状态 */
export function createPlayerStatus(): PlayerStatus {
  return {
    burn: 0, freeze: 0, poison: 0, poisonDmg: 0, parasite: 0,
    slow: 0, stun: 0, bind: 0, taunt: 0, tauntSourceIdx: -1, fear: 0,
    atkDown: 0, defDown: 0, matkDown: 0,
    playerShield: 0, playerShieldTurns: 0,
    regenAmount: 0, regenTurns: 0,
  };
}

// ═══════════════════════════════════════════
// 状态判定辅助
// ═══════════════════════════════════════════

/** 敌人是否被阻止行动 */
export function isEnemyBlocked(ks: EnemyStatus): boolean {
  return ks.freeze > 0 || ks.frozen > 0 || ks.stun > 0 || ks.bound > 0 || ks.sealed > 0;
}

/** 敌人是否无法使用物理攻击 */
export function isEnemyPhysicallyBound(ks: EnemyStatus): boolean {
  return ks.bind > 0;
}

/** 敌人是否跳过行动（恐惧） */
export function doesEnemySkipFromFear(ks: EnemyStatus): boolean {
  return ks.fear > 0 && Math.random() < 0.30;
}

/** 获取敌人ATK修正 */
export function getEnemyAtkMod(ks: EnemyStatus): number {
  let mod = 1.0;
  if (ks.atkDown > 0) mod *= 0.75;
  if (ks.slowed > 0) mod *= 0.7;   // 旧版slow也影响伤害
  return mod;
}

/** 获取敌人DEF修正 */
export function getEnemyDefMod(ks: EnemyStatus): number {
  return ks.defDown > 0 ? 0.75 : 1.0;
}

/** 获取敌人SPD修正 */
export function getEnemySpdMod(ks: EnemyStatus): number {
  return ks.slow > 0 ? 0.7 : 1.0;
}

/** 获取敌人MATK修正 (降灵压-15%) */
export function getEnemyMatkMod(ks: EnemyStatus): number {
  return ks.matkDown > 0 ? 0.85 : 1.0;
}

// ═══════════════════════════════════════════
// 玩家属性修正 (玩家被上异常时)
// ═══════════════════════════════════════════

/** 获取玩家ATK修正 (攻降-25%) */
export function getPlayerAtkMod(ps: PlayerStatus): number {
  return ps.atkDown > 0 ? 0.75 : 1.0;
}

/** 获取玩家DEF修正 (防降-25%) */
export function getPlayerDefMod(ps: PlayerStatus): number {
  return ps.defDown > 0 ? 0.75 : 1.0;
}

/** 获取玩家MATK修正 (降灵压-15%) */
export function getPlayerMatkMod(ps: PlayerStatus): number {
  return ps.matkDown > 0 ? 0.85 : 1.0;
}

/** 获取玩家SPD修正 (减速-30%) */
export function getPlayerSpdMod(ps: PlayerStatus): number {
  return ps.slow > 0 ? 0.7 : 1.0;
}

/** 玩家是否被阻止行动 (冻结/眩晕/禁锢) */
export function isPlayerBlocked(ps: PlayerStatus): boolean {
  return ps.freeze > 0 || ps.stun > 0 || ps.bind > 0;
}

/** 玩家是否因恐惧跳过行动 (50%) */
export function doesPlayerSkipFromFear(ps: PlayerStatus): boolean {
  return ps.fear > 0 && Math.random() < 0.50;
}

// ═══════════════════════════════════════════
// 施加状态到敌人
// ═══════════════════════════════════════════

export function applyStatusToEnemy(
  ks: EnemyStatus,
  subtype: string,
  turns: number,
  maxHp?: number,
): string {
  switch (subtype) {
    case 'burn':
      ks.burn = Math.max(ks.burn, turns);
      return `灼烧 ${turns}回合`;
    case 'freeze':
      ks.freeze = Math.max(ks.freeze, turns);
      ks.frozen = Math.max(ks.frozen, turns); // 兼容旧字段
      return `冻结 ${turns}回合`;
    case 'poison':
      ks.poison = Math.max(ks.poison, turns);
      ks.poisonDmg = maxHp ? Math.round(maxHp * 0.05) : 10;
      return `中毒 ${turns}回合`;
    case 'parasite':
      ks.parasite = Math.max(ks.parasite, turns);
      return `寄生 ${turns}回合`;
    case 'slow':
      ks.slow = Math.max(ks.slow, turns);
      ks.slowed = Math.max(ks.slowed, turns);
      return `减速 ${turns}回合`;
    case 'stun':
      ks.stun = Math.max(ks.stun, turns);
      return `眩晕 ${turns}回合`;
    case 'bind':
      ks.bind = Math.max(ks.bind, turns);
      ks.bound = Math.max(ks.bound, turns);
      return `禁锢 ${turns}回合`;
    case 'seal':
      ks.sealed = Math.max(ks.sealed, turns);
      return `封印 ${turns}回合`;
    case 'taunt':
      ks.taunt = Math.max(ks.taunt, turns);
      return `嘲讽 ${turns}回合`;
    case 'fear':
      ks.fear = Math.max(ks.fear, turns);
      return `恐惧 ${turns}回合`;
    case 'atkDown':
      ks.atkDown = Math.max(ks.atkDown, turns);
      return `攻击降低 ${turns}回合`;
    case 'defDown':
      ks.defDown = Math.max(ks.defDown, turns);
      return `防御降低 ${turns}回合`;
    case 'matkDown':
      ks.matkDown = Math.max(ks.matkDown, turns);
      return `降灵压 ${turns}回合`;
    default:
      return '';
  }
}

// ═══════════════════════════════════════════
// 施加状态到玩家
// ═══════════════════════════════════════════

export function applyStatusToPlayer(
  ps: PlayerStatus,
  subtype: string,
  turns: number,
  sourceIdx: number = -1,
): string {
  switch (subtype) {
    case 'burn':
      ps.burn = Math.max(ps.burn, turns);
      return `灼烧 ${turns}回合`;
    case 'freeze':
      ps.freeze = Math.max(ps.freeze, turns);
      return `冻结 ${turns}回合`;
    case 'poison':
      ps.poison = Math.max(ps.poison, turns);
      return `中毒 ${turns}回合`;
    case 'parasite':
      ps.parasite = Math.max(ps.parasite, turns);
      return `寄生 ${turns}回合`;
    case 'slow':
      ps.slow = Math.max(ps.slow, turns);
      return `减速 ${turns}回合`;
    case 'stun':
      ps.stun = Math.max(ps.stun, turns);
      return `眩晕 ${turns}回合`;
    case 'bind':
      ps.bind = Math.max(ps.bind, turns);
      return `禁锢 ${turns}回合`;
    case 'taunt':
      ps.taunt = Math.max(ps.taunt, turns);
      ps.tauntSourceIdx = sourceIdx;
      return `嘲讽 ${turns}回合`;
    case 'fear':
      ps.fear = Math.max(ps.fear, turns);
      return `恐惧 ${turns}回合`;
    case 'atkDown':
      ps.atkDown = Math.max(ps.atkDown, turns);
      return `攻击降低 ${turns}回合`;
    case 'defDown':
      ps.defDown = Math.max(ps.defDown, turns);
      return `防御降低 ${turns}回合`;
    case 'matkDown':
      ps.matkDown = Math.max(ps.matkDown, turns);
      return `降灵压 ${turns}回合`;
    default:
      return '';
  }
}

// ═══════════════════════════════════════════
// 清除所有状态
// ═══════════════════════════════════════════

export function clearAllEnemyStatus(ks: EnemyStatus): void {
  ks.burn = 0; ks.freeze = 0; ks.poison = 0; ks.poisonDmg = 0; ks.parasite = 0;
  ks.slow = 0; ks.stun = 0; ks.bind = 0; ks.taunt = 0; ks.fear = 0;
  ks.atkDown = 0; ks.defDown = 0; ks.matkDown = 0;
  ks.sealed = 0; ks.slowed = 0; ks.bound = 0; ks.frozen = 0;
}

export function clearAllPlayerStatus(ps: PlayerStatus): void {
  ps.burn = 0; ps.freeze = 0; ps.poison = 0; ps.poisonDmg = 0; ps.parasite = 0;
  ps.slow = 0; ps.stun = 0; ps.bind = 0; ps.taunt = 0; ps.tauntSourceIdx = -1; ps.fear = 0;
  ps.atkDown = 0; ps.defDown = 0; ps.matkDown = 0;
}

/** 获取敌人当前激活的状态图标列表 */
export function getEnemyStatusIcons(ks: EnemyStatus): string {
  const icons: string[] = [];
  for (const [key, info] of Object.entries(STATUS_INFO)) {
    const turns = (ks as any)[key] as number;
    if (turns > 0) icons.push(info.icon);
  }
  // 旧字段兼容
  if (ks.sealed > 0 && !icons.includes('⛓️')) icons.push('🔒');
  return icons.join('');
}

/** 获取玩家当前激活的状态图标列表 */
export function getPlayerStatusIcons(ps: PlayerStatus): string {
  const icons: string[] = [];
  for (const [key, info] of Object.entries(STATUS_INFO)) {
    const turns = (ps as any)[key] as number;
    if (turns > 0) icons.push(info.icon);
  }
  return icons.join('');
}
