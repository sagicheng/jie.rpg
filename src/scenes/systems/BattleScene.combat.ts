/**
 * BattleScene 战斗计算子系统
 */
import { BattleFx } from '../../managers/BattleFx';
import { GameState } from '../../managers/GameState';
import { PLAYER_X, PLAYER_Y } from '../BattleScene';
import { applyStatusToEnemy } from '../../managers/StatusSystem';
import { enemyDisplayName } from '../../config/entityNames';
import { getSkillTargetType } from '../../managers/Skills';

declare function calcStatusHitRate(rate: number, subtype: string, name: string, res: number): number;

export function lungeAt(scene: any, tx: number, ty: number, onHit: () => void): void {
  if (!scene.playerSprite) { onHit(); return; }
  BattleFx.lunge(scene, scene.playerSprite, PLAYER_X, PLAYER_Y, tx, ty, onHit);
}

export function getBuffMods(scene: any): { atk: number; def: number; matk: number; mdef: number; spd: number } {
  let atk = 1, def = 1, matk = 1, mdef = 1, spd = 1;
  for (const b of scene.tempBuffs) {
    switch (b.stat) {
      case 'atk':  atk += b.value; break;
      case 'def':   def += b.value; break;
      case 'matk': matk += b.value; break;
      case 'mdef': mdef += b.value; break;
      case 'spd':  spd += b.value; break;
    }
  }
  return { atk, def, matk, mdef, spd };
}

export function getCritBonus(scene: any): number {
  let c = 0;
  for (const b of scene.tempBuffs) if (b.stat === 'crit') c += b.value;
  return c;
}

export function getEffectivePlayerDef(scene: any): number {
  return Math.round(scene.playerDef * getBuffMods(scene).def);
}

export function getEffectivePlayerMdef(scene: any): number {
  return Math.round(scene.playerMdef * getBuffMods(scene).mdef);
}

export function applyControlToEnemy(scene: any, idx: number, se: { subtype: string; turns: number; rate: number }): void {
  const enemy = scene.enemies[idx];
  if (enemy.hp <= 0) return;
  const finalRate = calcStatusHitRate(se.rate, se.subtype, enemy.name, enemy.statusRes);
  if (Math.random() < finalRate) {
    applySkillStatus(scene, se.subtype, se.turns, idx);
    const effectNames: Record<string, string> = {
      seal: '\u5c01\u5370', slow: '\u51cf\u901f', bind: '\u7981\u9522', freeze: '\u51bb\u7ed3', stun: '\u7729\u6655', poison: '\u4e2d\u6bd2',
      burn: '\u707c\u70e7', parasite: '\u5bc4\u751f', taunt: '\u5632\u8bbd', fear: '\u6050\u60e7', atkDown: '\u653b\u964d', defDown: '\u9632\u964d', matkDown: '\u964d\u7075\u538b',
    };
    scene.logText.setText(`${enemyDisplayName(enemy.name)} ${effectNames[se.subtype] || se.subtype} ${se.turns} \u56de\u5408\uff01`);
  } else {
    scene.logText.setText(`${enemyDisplayName(enemy.name)} \u62b5\u6297\u4e86\u63a7\u5236...`);
  }
}

export function applySkillStatus(scene: any, subtype: string, turns: number, idx: number = scene.selectedEnemyIndex): void {
  const ks = scene.enemyStatuses[idx];
  if (!scene.bossImmuneTo(idx)) applyStatusToEnemy(ks, subtype, turns, scene.enemies[idx].maxHp);
}

export function playerDefend(scene: any): void {
  scene.clearTurnTimer();
  scene.phase = 'executing';
  scene.clearCommands();
  scene.isDefending = true;
  scene.logText.setText('\u9632\u5fa1\uff01\u53d7\u5230\u7684\u4f24\u5bb3\u51cf\u5c1180%\u3002');
  scene.time.delayedCall(1000, () => scene.startEnemyPhase());
}

export function escapeBattle(scene: any): void {
  scene.clearTurnTimer();
  scene.phase = 'executing';
  scene.clearCommands(); scene.clearSubMenu();
  const alive = scene.getAliveEnemyIndices();
  const avgEnemySpd = alive.length
    ? alive.reduce((s: number, i: number) => s + scene.enemies[i].spd, 0) / alive.length
    : 0;
  let escapeRate = 0.5 + (scene.playerSpd - avgEnemySpd) * 0.03;
  escapeRate = Math.max(0.1, Math.min(0.95, escapeRate));
  if (Math.random() < escapeRate) {
    scene.logText.setText('\u6210\u529f\u9003\u8131\uff01');
    scene.time.delayedCall(900, () => {
      GameState.hp = scene.playerHp;
      GameState.mp = scene.playerMp;
      scene.notifyGameScene('escape', 0);
      scene.scene.stop(); scene.scene.resume('GameScene');
      scene.scene.get('UIScene').events.emit('updateStats');
    });
  } else {
    scene.logText.setText('\u9003\u8dd1\u5931\u8d25\uff01\u654c\u4eba\u5305\u56f4\u4e86\u4e0a\u6765\uff01');
    scene.time.delayedCall(1000, () => scene.startEnemyPhase());
  }
}

export function castPlayerSkill(scene: any, sk: any): void {
  const tt = getSkillTargetType(sk);
  if (tt === 'enemy') {
    scene.startTargetSelect('skill', sk);
  } else {
    scene.executePlayerSkill(sk);
  }
}
