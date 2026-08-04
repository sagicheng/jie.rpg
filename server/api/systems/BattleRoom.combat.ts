/**
 * BattleRoom 战斗计算子系统
 * 属性修正/状态施加/DoT/执行结算
 */
import { CombatPlayer, CombatEnemy, CombatStatus } from '../../core/schema';
import { STATUS_INFO } from '../../../src/managers/StatusSystem';
import { calcDamage, calcMagicDamage } from '../../../src/managers/BattleData';
import type { EnemyData } from '../../../src/managers/BattleData';
import { PET_SKILLS } from '../../core/world';

  export function effAtk(scene: any, c: CombatPlayer | CombatEnemy, ...args: any[]): number {
    const s = c.status;
    let m = 1.0;
    if (s.atkDown > 0) m *= 0.75;
    if (s.slow > 0) m *= 0.7;
    return Math.round(c.atk * m);
  }
  /** 属性修正后魔法攻击力（降灵压×0.85） */
  export function effMatk(scene: any, c: CombatPlayer | CombatEnemy, ...args: any[]): number {
    return Math.round(c.matk * (c.status.matkDown > 0 ? 0.85 : 1.0));
  }
  /** 属性修正后防御（防降×0.75，防御与魔防同受影响） */
  export function effDef(scene: any, c: CombatPlayer | CombatEnemy, ...args: any[]): number {
    return Math.round(c.def * (c.status.defDown > 0 ? 0.75 : 1.0));
  }
  export function effMdef(scene: any, c: CombatPlayer | CombatEnemy, ...args: any[]): number {
    return Math.round(c.mdef * (c.status.defDown > 0 ? 0.75 : 1.0));
  }

  /** 是否被控制（冻结/眩晕/禁锢/封印）→ 跳过本回合行动 */
  export function isBlocked(scene: any, c: CombatPlayer | CombatEnemy, ...args: any[]): boolean {
    const s = c.status;
    return s.freeze > 0 || s.stun > 0 || s.bind > 0 || s.sealed > 0;
  }

  /** 施加异常状态到敌人（按 subtype 写入 schema.status，取较大剩余回合） */
  export function applyStatusToEnemy(scene: any, e: CombatEnemy, subtype: string, turns: number, maxHp: number, ...args: any[]): void {
    const s = e.status;
    switch (subtype) {
      case 'burn': s.burn = Math.max(s.burn, turns); break;
      case 'freeze': s.freeze = Math.max(s.freeze, turns); break;
      case 'poison': s.poison = Math.max(s.poison, turns); s.poisonDmg = Math.max(s.poisonDmg, Math.round(maxHp * 0.05)); break;
      case 'parasite': s.parasite = Math.max(s.parasite, turns); break;
      case 'slow': s.slow = Math.max(s.slow, turns); break;
      case 'stun': s.stun = Math.max(s.stun, turns); break;
      case 'bind': s.bind = Math.max(s.bind, turns); break;
      case 'seal': s.sealed = Math.max(s.sealed, turns); break;
      case 'taunt': s.taunt = Math.max(s.taunt, turns); break;
      case 'fear': s.fear = Math.max(s.fear, turns); break;
      case 'atkDown': s.atkDown = Math.max(s.atkDown, turns); break;
      case 'defDown': s.defDown = Math.max(s.defDown, turns); break;
      case 'matkDown': s.matkDown = Math.max(s.matkDown, turns); break;
    }
  }
  /** 施加异常状态到玩家（玩家中毒按 maxHp*dotPct 结算，无需缓存固定值） */
  export function applyStatusToPlayer(scene: any, p: CombatPlayer, subtype: string, turns: number, ...args: any[]): void {
    const s = p.status;
    switch (subtype) {
      case 'burn': s.burn = Math.max(s.burn, turns); break;
      case 'freeze': s.freeze = Math.max(s.freeze, turns); break;
      case 'poison': s.poison = Math.max(s.poison, turns); break;
      case 'parasite': s.parasite = Math.max(s.parasite, turns); break;
      case 'slow': s.slow = Math.max(s.slow, turns); break;
      case 'stun': s.stun = Math.max(s.stun, turns); break;
      case 'bind': s.bind = Math.max(s.bind, turns); break;
      case 'seal': s.sealed = Math.max(s.sealed, turns); break;
      case 'taunt': s.taunt = Math.max(s.taunt, turns); break;
      case 'fear': s.fear = Math.max(s.fear, turns); break;
      case 'atkDown': s.atkDown = Math.max(s.atkDown, turns); break;
      case 'defDown': s.defDown = Math.max(s.defDown, turns); break;
      case 'matkDown': s.matkDown = Math.max(s.matkDown, turns); break;
    }
  }

  /** 按 rate 概率施加状态到敌人（用于技能/鬼道/敌人攻击） */
  export function rollApplyStatusToEnemy(scene: any, e: CombatEnemy, se: { subtype: string; turns: number; rate: number }, maxHp: number, ...args: any[]): void {
    if (Math.random() >= (se.rate ?? 1)) {
      console.log(`[BattleRoom.status] 敌人 ${e.name} ${se.subtype} 未命中 (rate=${se.rate})`);
      return;
    }
    scene.applyStatusToEnemy(e, se.subtype, se.turns, maxHp);
    const info = STATUS_INFO[se.subtype as keyof typeof STATUS_INFO];
    const name = info?.name ?? (se.subtype === 'seal' ? '封印' : se.subtype);
    console.log(`[BattleRoom.status] 敌人 ${e.name} +${name} ${se.turns}回合 (rate=${se.rate})`);
    scene.logMsg('system', `${e.name} 陷入${name}(${se.turns}回合)`);
  }
  /** 按 rate 概率施加状态到玩家 */
  export function rollApplyStatusToPlayer(scene: any, p: CombatPlayer, se: { subtype: string; turns: number; rate: number }, ...args: any[]): void {
    if (Math.random() >= (se.rate ?? 1)) {
      console.log(`[BattleRoom.status] 玩家 ${p.name} ${se.subtype} 未命中 (rate=${se.rate})`);
      return;
    }
    scene.applyStatusToPlayer(p, se.subtype, se.turns);
    const info = STATUS_INFO[se.subtype as keyof typeof STATUS_INFO];
    const name = info?.name ?? (se.subtype === 'seal' ? '封印' : se.subtype);
    console.log(`[BattleRoom.status] 玩家 ${p.name} +${name} ${se.turns}回合 (rate=${se.rate})`);
    scene.logMsg('system', `${p.name} 陷入${name}(${se.turns}回合)`);
  }

  /** 每回合结束：对所有存活战斗员结算 DoT 并衰减状态（OnBuffTriggered / OnBuffExpired）。先结算，再判胜负。 */
  export function tickStatuses(, ...args: any[]): void {
    scene.state.players.forEach((p) => {
      if (!p.alive) return;
      const dot = scene.computeDot(p, true);
      if (dot > 0) {
        p.hp = Math.max(0, p.hp - dot);
        scene.logMsg('system', `${p.name} 持续伤害 -${dot}`);
        if (p.hp <= 0) { p.alive = false; scene.logMsg('system', `${p.name} 倒下了！`); }
      }
      scene.decrementStatus(p.status);
    });
    scene.state.enemies.forEach((e) => {
      if (!e.alive) return;
      const dot = scene.computeDot(e, false);
      if (dot > 0) {
        e.hp = Math.max(0, e.hp - dot);
        scene.logMsg('system', `${e.name} 持续伤害 -${dot}`);
        if (e.hp <= 0) { e.alive = false; scene.logMsg('system', `${e.name} 被击败！`); }
      }
      scene.decrementStatus(e.status);
    });
  }

  /** 计算本回合 DoT 总伤害 */
  export function computeDot(scene: any, c: CombatPlayer | CombatEnemy, isPlayer: boolean, ...args: any[]): number {
    const s = c.status;
    let dot = 0;
    const maxHp = c.maxHp;
    if (s.burn > 0) dot += Math.max(1, Math.round(maxHp * 0.05));
    if (s.poison > 0) dot += isPlayer ? Math.max(1, Math.round(maxHp * 0.03)) : s.poisonDmg;
    if (s.parasite > 0) dot += Math.max(1, Math.round(maxHp * 0.05));
    return dot;
  }

  /** 每回合结束：衰减形态持续回合（卍解5回合/虚化4回合/狱解3回合，到期自动结束并回滚增益）。 */
  export function tickForms(, ...args: any[]): void {
    scene.state.players.forEach((p) => {
      if (!p.alive) return;
      if (p.bankaiActive) {
        p.bankaiTurnsLeft--;
        if (p.bankaiTurnsLeft <= 0) {
          p.bankaiActive = false;
          const base = scene.bankaiBase.get(p.sessionId);
          if (base) {
            p.atk = base.atk; p.def = base.def; p.matk = base.matk; p.mdef = base.mdef; p.spd = base.spd;
            scene.bankaiBase.delete(p.sessionId);
          }
          scene.logMsg('system', `${p.name} 卍解结束`);
        }
      }
      if (p.hollowActive) {
        p.hollowTurnsLeft--;
        if (p.hollowTurnsLeft <= 0) { p.hollowActive = false; scene.logMsg('system', `${p.name} 虚化结束`); }
      }
      if (p.hellActive) {
        p.hellTurnsLeft--;
        if (p.hellTurnsLeft <= 0) { p.hellActive = false; scene.logMsg('system', `${p.name} 狱解结束`); }
      }
    });
  }

  /** 衰减所有状态 1 回合（到期归零，回滚） */
  export function decrementStatus(scene: any, s: CombatStatus, ...args: any[]): void {
    if (s.burn > 0) s.burn--;
    if (s.freeze > 0) s.freeze--;
    if (s.poison > 0) { s.poison--; if (s.poison <= 0) s.poisonDmg = 0; }
    if (s.parasite > 0) s.parasite--;
    if (s.slow > 0) s.slow--;
    if (s.stun > 0) s.stun--;
    if (s.bind > 0) s.bind--;
    if (s.taunt > 0) s.taunt--;
    if (s.fear > 0) s.fear--;
    if (s.atkDown > 0) s.atkDown--;
    if (s.defDown > 0) s.defDown--;
    if (s.matkDown > 0) s.matkDown--;
    if (s.sealed > 0) s.sealed--;
  }
