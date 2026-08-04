/**
 * BattleScene 状态Tick子系统
 */
import { GameState } from '../../managers/GameState';

export function tickKidoStatus(scene: any): void {
  const ps = scene.playerStatus;
  if (ps.playerShieldTurns > 0) { ps.playerShieldTurns--; if (ps.playerShieldTurns <= 0) ps.playerShield = 0; }
  if (ps.regenTurns > 0) { scene.playerHp = Math.min(scene.playerHp + ps.regenAmount, scene.playerMaxHp); ps.regenTurns--; if (ps.regenTurns <= 0) ps.regenAmount = 0; }
  if (ps.burn > 0) { const dmg = Math.round(scene.playerMaxHp * 0.05); scene.playerHp = Math.max(0, scene.playerHp - dmg); ps.burn--; }
  if (ps.poison > 0) { const dmg = ps.poisonDmg || Math.round(scene.playerMaxHp * 0.03); scene.playerHp = Math.max(0, scene.playerHp - dmg); scene.playerMp = Math.max(0, scene.playerMp - Math.round(scene.playerMaxMp * 0.03)); ps.poison--; if (ps.poison <= 0) ps.poisonDmg = 0; }
  if (ps.parasite > 0) { const dmg = Math.round(scene.playerMaxHp * 0.05); scene.playerHp = Math.max(0, scene.playerHp - dmg); ps.parasite--; }
  if (ps.matkDown > 0) ps.matkDown--;
  if (ps.freeze > 0) ps.freeze--;
  if (ps.slow > 0) ps.slow--;
  if (ps.stun > 0) ps.stun--;
  if (ps.bind > 0) ps.bind--;
  if (ps.taunt > 0) { ps.taunt--; if (ps.taunt <= 0) ps.tauntSourceIdx = -1; }
  if (ps.fear > 0) ps.fear--;
  if (ps.atkDown > 0) ps.atkDown--;
  if (ps.defDown > 0) ps.defDown--;
  scene.tempBuffs.forEach((b: any) => b.turns--);
  scene.tempBuffs = scene.tempBuffs.filter((b: any) => b.turns > 0);
  if (scene.reflectTurns > 0) { scene.reflectTurns--; if (scene.reflectTurns <= 0) scene.reflectPct = 0; }
  if (scene.absorbMagicTurns > 0) scene.absorbMagicTurns--;
  scene.marks.forEach((m: any) => { if (m.active) { m.turns--; if (m.turns <= 0) { m.active = false; m.detonateMult = 0; } } });
  scene.enemies.forEach((enemy: any, i: number) => {
    const ks = scene.enemyStatuses[i];
    if (enemy.hp <= 0) return;
    if (ks.burn > 0) enemy.hp -= Math.round(enemy.maxHp * 0.05);
    if (ks.poison > 0) enemy.hp -= ks.poisonDmg;
    if (ks.parasite > 0) enemy.hp -= Math.round(enemy.maxHp * 0.05);
    scene.checkEnemyDeath(i);
  });
  if (scene.bankaiActive && scene.bankaiTurnsLeft > 0) {
    scene.bankaiTurnsLeft--;
    if (scene.bankaiTurnsLeft <= 0) {
      scene.bankaiActive = false;
      scene.playerAtk = Math.round(GameState.atk * 0.8);
      scene.playerDef = Math.round(GameState.def * 0.8);
      scene.playerMatk = Math.round(GameState.matk * 0.8);
      scene.playerMdef = Math.round(GameState.mdef * 0.8);
      scene.playerSpd = Math.round(GameState.spd * 0.8);
      scene.logText.setText('卍解解除... 属性暂时下降');
    }
  } else if (!scene.bankaiActive && scene.bankaiUsed && scene.bankaiTurnsLeft <= 0) {
    scene.playerAtk = GameState.atk; scene.playerDef = GameState.def; scene.playerMatk = GameState.matk; scene.playerMdef = GameState.mdef; scene.playerSpd = GameState.spd;
  }
  if (scene.hollowActive && scene.hollowTurnsLeft > 0) {
    const drain = Math.round(scene.playerMaxHp * 0.05); scene.playerHp = Math.max(1, scene.playerHp - drain); scene.hollowTurnsLeft--;
    if (scene.hollowTurnsLeft <= 0) { scene.hollowActive = false; GameState.statusRes -= 0.30; scene.playerMaxMp = GameState.maxMp; scene.playerMp = Math.min(scene.playerMp, scene.playerMaxMp); scene.logText.setText('虚化解除... 状态恢复'); }
  }
  if (scene.hellActive && scene.hellTurnsLeft > 0) {
    const drain = Math.round(scene.playerMaxHp * 0.10); scene.playerHp = Math.max(1, scene.playerHp - drain); scene.hellTurnsLeft--;
    if (scene.hellTurnsLeft <= 0) { scene.hellActive = false; scene.logText.setText('狱解解除... 业火熄灭'); }
  }
  scene.refreshPlayerFormSprite();
}

export function tickEnemyStatusDuration(scene: any): void {
  scene.enemies.forEach((_enemy: any, i: number) => {
    const ks = scene.enemyStatuses[i];
    if (ks.burn > 0) ks.burn--;
    if (ks.poison > 0) { ks.poison--; if (ks.poison <= 0) ks.poisonDmg = 0; }
    if (ks.parasite > 0) ks.parasite--;
    if (ks.freeze > 0) { ks.freeze--; ks.frozen = ks.freeze; }
    if (ks.slow > 0) { ks.slow--; ks.slowed = ks.slow; }
    if (ks.stun > 0) ks.stun--;
    if (ks.bind > 0) { ks.bind--; ks.bound = ks.bind; }
    if (ks.sealed > 0) ks.sealed--;
    if (ks.taunt > 0) ks.taunt--;
    if (ks.fear > 0) ks.fear--;
    if (ks.atkDown > 0) ks.atkDown--;
    if (ks.defDown > 0) ks.defDown--;
    if (ks.matkDown > 0) ks.matkDown--;
  });
}
