/**
 * BattleScene 战斗计算子系统
 */
import { BattleFx } from '../../managers/BattleFx';
import { PLAYER_X, PLAYER_Y } from '../BattleScene';

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
