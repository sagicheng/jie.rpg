/**
 * BattleScene UI子系统（victory/defeat界面）
 */
import { GameState } from '../../managers/GameState';
import { GAME_WIDTH } from '../../config/config';
import { Inventory } from '../../managers/Inventory';
import { QUALITY_COLOR, QUALITY_CN } from '../../core/constants';
import { generateLoot } from '../../managers/BattleData';
import { NAMED_ENEMIES, generateNamedLoot } from '../../managers/BestiaryData';
import { panel } from '../../ui/BattleSkin';
import { BattleFx } from '../../managers/BattleFx';

export function victory(scene: any): void {
  scene.clearTurnTimer();
  scene.phase = 'victory';
  scene.clearCommands();
  scene.clearSubMenu();
  let totalExp = 0, totalGold = 0;
  const allLoot: any[] = [];
  scene.enemies.forEach((e: any) => {
    totalExp += e.expReward;
    totalGold += e.goldReward;
    const namedDef = NAMED_ENEMIES[e.name];
    if (namedDef && namedDef.drops) {
      allLoot.push(...generateNamedLoot(e.name, namedDef.drops));
    } else {
      const loot = generateLoot(e.type, e.zone);
      allLoot.push(...loot);
    }
  });
  scene.enemies.forEach((e: any) => GameState.recordKill(e.name));
  const newTitles = GameState.drainTitleNotifications();
  GameState.gold += totalGold;
  const levelUp = GameState.gainExp(totalExp);
  scene.playerHp = GameState.hp;
  scene.playerMp = GameState.mp;
  allLoot.forEach((item: any) => {
    Inventory.addItem({ id: item.id, name: item.name, type: item.type, desc: item.desc, quantity: item.quantity, slot: item.slot, stats: item.stats, quality: item.quality, set: item.set });
  });
  const panelH = 280 + allLoot.length * 30 + (newTitles.length ? 28 + newTitles.length * 22 : 0);
  const container = scene.add.container(0, 0).setDepth(100);
  const pnl = panel(scene, GAME_WIDTH / 2 - 180, 220, 360, panelH, 100);
  container.add(pnl);
  container.add(scene.add.text(GAME_WIDTH / 2, 248, '\u80dc \u5229', { fontSize: '24px', color: '#c9a96e', fontStyle: 'bold', padding: { y: 2 } }).setOrigin(0.5));
  container.add(scene.add.text(GAME_WIDTH / 2, 285, `\u7ecf\u9a8c +${totalExp}  |  \u91d1\u5e01 +${totalGold}`, { fontSize: '15px', color: '#ddd', padding: { y: 2 } }).setOrigin(0.5));
  if (levelUp) {
    container.add(scene.add.text(GAME_WIDTH / 2, 310, `\u7b49\u7ea7\u63d0\u5347\uff01Lv.${GameState.level}`, { fontSize: '18px', color: '#44ff44', fontStyle: 'bold', padding: { y: 2 } }).setOrigin(0.5));
  }
  if (allLoot.length > 0) {
    const looTitleY = levelUp ? 340 : 315;
    container.add(scene.add.text(GAME_WIDTH / 2, looTitleY, '\u2500 \u6218\u5229\u54c1 \u2500', { fontSize: '14px', color: '#c9a96e', padding: { y: 2 } }).setOrigin(0.5));
    allLoot.forEach((item: any, i: number) => {
      const iy = (levelUp ? 365 : 340) + i * 30;
      let color = '#88cc88', label = item.name;
      if (item.quality) { color = QUALITY_COLOR[item.quality] || '#cccccc'; label = `[${QUALITY_CN[item.quality]}] ${item.name}`; }
      else if (item.type === 'material') color = '#aaaacc';
      container.add(scene.add.text(GAME_WIDTH / 2, iy, label, { fontSize: '14px', color, padding: { y: 2 } }).setOrigin(0.5));
    });
  }
  if (newTitles.length > 0) {
    const lootEndY = allLoot.length > 0 ? (levelUp ? 365 : 340) + allLoot.length * 30 : (levelUp ? 340 : 315);
    const ttY = lootEndY + 8;
    container.add(scene.add.text(GAME_WIDTH / 2, ttY, '\u2500 \u89e3\u9501\u79f0\u53f7 \u2500', { fontSize: '14px', color: '#ffcc44', padding: { y: 2 } }).setOrigin(0.5));
    newTitles.forEach((nm: string, i: number) => {
      container.add(scene.add.text(GAME_WIDTH / 2, ttY + 22 + i * 22, `\ud83c\udfc5 ${nm}`, { fontSize: '13px', color: '#ffdd66', fontStyle: 'bold', padding: { y: 2 } }).setOrigin(0.5));
    });
  }
  const confirmY = 220 + panelH - 35;
  const confirmText = scene.add.text(GAME_WIDTH / 2, confirmY, '[ \u70b9\u51fb\u7ee7\u7eed ]', { fontSize: '14px', color: '#c9a96e', padding: { y: 2 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
  confirmText.on('pointerdown', () => {
    GameState.hp = scene.playerHp;
    GameState.mp = scene.playerMp;
    scene.enemies.forEach((enemy: any) => GameState.updateQuestProgress('kill', enemy.name, 1));
    if (scene.enemyRefs.length > 0) { scene.notifyGameScene('victory', 0); }
    scene.scene.stop(); scene.scene.resume('GameScene');
    scene.scene.get('UIScene').events.emit('updateStats');
  });
  container.add(confirmText);
  container.setAlpha(0);
  scene.tweens.add({ targets: container, alpha: 1, duration: 400 });
}

export function defeat(scene: any): void {
  scene.clearTurnTimer();
  scene.phase = 'defeat';
  scene.clearCommands();
  scene.logText.setText('\u6218\u6597\u4e0d\u80fd...');
  if (scene.playerSprite) BattleFx.playDie(scene, scene.playerSprite.x, scene.playerSprite.y);
  const container = scene.add.container(0, 0).setDepth(100);
  const pnl = panel(scene, GAME_WIDTH / 2 - 140, 300, 280, 180, 100);
  container.add(pnl);
  container.add(scene.add.text(GAME_WIDTH / 2, 340, '\u6218\u6597\u4e0d\u80fd', { fontSize: '24px', color: '#cc4444', fontStyle: 'bold', padding: { y: 2 } }).setOrigin(0.5));
  const retryBtn = scene.add.text(GAME_WIDTH / 2, 400, '[ \u91cd\u65b0\u6311\u6218 ]', { fontSize: '16px', color: '#c9a96e', padding: { y: 2 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
  retryBtn.on('pointerdown', () => {
    scene.enemies.forEach((e: any) => { e.hp = e.maxHp; });
    scene.scene.restart({ template: scene.templateEnemy, enemyRef: scene.enemyRefs[0], zone: GameState.zone });
  });
  container.add(retryBtn);
  const fleeBtn = scene.add.text(GAME_WIDTH / 2, 440, '[ \u8fd4\u56de\u636e\u70b9 ]', { fontSize: '14px', color: '#887766', padding: { y: 2 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
  fleeBtn.on('pointerdown', () => {
    GameState.hp = GameState.maxHp; GameState.mp = GameState.maxMp;
    scene.notifyGameScene('defeat', 0);
    scene.scene.stop(); scene.scene.resume('GameScene');
    scene.scene.get('UIScene').events.emit('updateStats');
  });
  container.add(fleeBtn);
  container.setAlpha(0);
  scene.tweens.add({ targets: container, alpha: 1, duration: 400 });
}
