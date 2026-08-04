/**
 * BattleScene 变身系统（卍解/虚化/狱解）
 */
import { GameState } from '../../managers/GameState';
import { GAME_WIDTH, GAME_HEIGHT } from '../../config/config';
import { ensureFormPortrait, battlePortraitKey, ensureBattlePortrait, fitPortrait, BattleForm } from '../../core/portraitLoader';

export function activateBankai(scene: any): void {
  if (scene.bankaiUsed || scene.bankaiActive) return;
  scene.clearTurnTimer();
  scene.phase = 'executing';
  scene.clearCommands(); scene.clearSubMenu();
  scene.bankaiActive = true; scene.bankaiTurnsLeft = 5; scene.bankaiUsed = true;
  scene.playerAtk = Math.round(scene.playerAtk * 1.3);
  scene.playerDef = Math.round(scene.playerDef * 1.3);
  scene.playerMatk = Math.round(scene.playerMatk * 1.3);
  scene.playerMdef = Math.round(scene.playerMdef * 1.3);
  scene.playerSpd = Math.round(scene.playerSpd * 1.3);
  scene.logText.setText('卍 解！全属性大幅提升（5回合）！');
  scene.showFormPortrait('bankai');
  scene.refreshPlayerFormSprite();
  scene.cameras.main.flash(600, 0, 100, 200);
  scene.cameras.main.shake(300, 0.01);
  scene.time.delayedCall(1500, () => scene.startEnemyPhase());
}

export function activateHollow(scene: any): void {
  if (scene.hollowUsed || scene.hollowActive) return;
  scene.clearTurnTimer();
  scene.phase = 'executing';
  scene.clearCommands(); scene.clearSubMenu();
  scene.hollowActive = true; scene.hollowTurnsLeft = 4; scene.hollowUsed = true;
  GameState.statusRes += 0.30;
  scene.playerMaxMp = Math.round(scene.playerMaxMp * 1.5);
  scene.playerMp = scene.playerMaxMp;
  scene.logText.setText('虚 化！异常抗性+30% · MP上限激增！');
  scene.showFormPortrait('hollow');
  scene.refreshPlayerFormSprite();
  scene.cameras.main.flash(400, 200, 50, 50);
  scene.time.delayedCall(1500, () => scene.startEnemyPhase());
}

export function activateHell(scene: any): void {
  if (scene.hellUsed || scene.hellActive) return;
  scene.clearTurnTimer();
  scene.phase = 'executing';
  scene.clearCommands(); scene.clearSubMenu();
  scene.hellActive = true; scene.hellTurnsLeft = 3; scene.hellUsed = true;
  scene.logText.setText('狱 解！业火焚身——伤害倍增！');
  scene.showFormPortrait('hell');
  scene.refreshPlayerFormSprite();
  scene.cameras.main.flash(500, 180, 0, 0);
  scene.cameras.main.shake(400, 0.015);
  scene.time.delayedCall(1500, () => scene.startEnemyPhase());
}

export function showFormPortrait(scene: any, which: 'hollow' | 'hell' | 'bankai'): void {
  ensureFormPortrait(scene, which, (key: string) => {
    if (!scene.scene.isActive()) return;
    const cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
    const haloColor = which === 'hollow' ? 0xff3355 : which === 'hell' ? 0xff2200 : 0x66ccff;
    const halo = scene.add.graphics().setScrollFactor(0).setDepth(199).setAlpha(0);
    halo.fillStyle(haloColor, 0.18);
    halo.fillCircle(cx, cy, 380);
    halo.fillStyle(haloColor, 0.12);
    halo.fillCircle(cx, cy, 270);
    const img = scene.add.image(cx, cy, key).setScrollFactor(0).setDepth(200).setOrigin(0.5).setAlpha(0);
    const finalScale = 900 / img.height;
    img.setScale(finalScale * 0.85);
    scene.tweens.add({ targets: img, alpha: 1, scaleX: finalScale, scaleY: finalScale, duration: 350, ease: 'Back.Out' });
    scene.tweens.add({ targets: halo, alpha: 1, duration: 350 });
    scene.time.delayedCall(1150, () => {
      scene.tweens.add({ targets: [img, halo], alpha: 0, duration: 300, onComplete: () => { img.destroy(); halo.destroy(); } });
    });
  });
}

export function refreshPlayerFormSprite(scene: any): void {
  if (!scene.playerSprite || !scene.scene.isActive()) return;
  const g = GameState.gender as 'male' | 'female';
  const form: BattleForm = scene.hellActive ? 'hell' : scene.hollowActive ? 'hollow' : scene.bankaiActive ? 'bankai' : 'base';
  const key = battlePortraitKey(g, form);
  const apply = (k: string) => { if (scene.playerSprite) { scene.playerSprite.setTexture(k); fitPortrait(scene.playerSprite, 120, 180); } };
  if (scene.textures.exists(key)) {
    apply(key);
  } else {
    apply(g);
    ensureBattlePortrait(scene, key, () => {
      if (!scene.playerSprite || !scene.scene.isActive()) return;
      const cur: BattleForm = scene.hellActive ? 'hell' : scene.hollowActive ? 'hollow' : scene.bankaiActive ? 'bankai' : 'base';
      if (cur === form) apply(key);
    });
  }
}
