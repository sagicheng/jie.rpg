/**
 * GameScene 战斗入口/结束回调子系统
 */
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../../config/config';
import { GameState } from '../../managers/GameState';
import { EnemyData, generateLoot } from '../../managers/BattleData';
import { Inventory } from '../../managers/Inventory';
import { NAMED_ENEMIES } from '../../managers/BestiaryData';

export function onEnemyOverlap(scene: any, _player: any, enemySprite: any): void {
  const en = scene.enemies.find((e: any) => e.sprite === enemySprite);
  if (!en || en.dead) return;
  scene.enterBattle(en);
}

export function checkEnemyCollision(scene: any): void {
  if (scene.battleCooldown > 0) return;
  const en = scene.enemies.find((e: any) => {
    if (!e.sprite || !e.sprite.active || e.dead) return false;
    if (scene.gameRoom && !scene.isMonsterAvailable(e.id)) return false;
    const dx = scene.player.x - e.sprite.x, dy = scene.player.y - e.sprite.y;
    return Math.sqrt(dx * dx + dy * dy) < 50;
  });
  if (en) scene.enterBattle(en);
}

export function enterBattle(scene: any, en?: any): void {
  if (!en || en.dead) return;
  if (!en.sprite.visible) return;
  if (scene.battleCooldown > 0 || scene.isInDialogue) return;
  if (en.data?.hp <= 0) return;
  if (scene.gameRoom && !scene.isMonsterAvailable(en.id)) return;
  try {
    if (scene.gameRoom) { scene.gameRoom.send('enterBattle', { id: en.id }); scene.setBattling(true); }
    scene.battleCooldown = 180;
    scene.scene.pause();
    if (scene.gameRoom) {
      scene.scene.launch('MultiBattleScene', { mode: 'map', enemyData: en.data, enemyParty: scene.buildEncounterParty(en.data), monsterId: en.id, playerName: GameState.playerName || '\u52c7\u8005', loadout: scene.buildBattleLoadout(), ownerSessionId: scene.mySessionId });
    } else {
      scene.scene.launch('BattleScene', { template: en.data, enemyRef: en, zone: GameState.zone });
    }
  } catch (err: any) {
    console.error('[enterBattle] \u5f02\u5e38\uff08\u602a\u7269=' + (en.data?.name ?? '?') + '\uff09\uff1a', err);
    if (scene.scene.isPaused()) scene.scene.resume();
    if (scene.gameRoom) scene.setBattling(false);
  }
}

export function isMonsterAvailable(scene: any, id: string): boolean {
  if (!scene.gameRoom?.state?.monsters) return true;
  const m = scene.gameRoom.state.monsters.get(id);
  return !m || m.alive || (m.respawnAt && Date.now() >= m.respawnAt);
}

export function onBattleEnd(scene: any, result: string, er: any): void {
  scene.input.keyboard!.resetKeys(); scene.physics.resume(); scene.menuPauseDepth = 0; scene.setGameUIVisible(true);
  if (result === 'defeat') {
    scene.player.x = 400; scene.player.y = 500;
    GameState.hp = GameState.maxHp; GameState.mp = GameState.maxMp;
    if (scene.gameRoom) scene.gameRoom.send('unlockMonster', { id: er.id });
    return;
  }
  const a = Phaser.Math.Angle.Between(er.sprite.x, er.sprite.y, scene.player.x, scene.player.y);
  scene.player.x += Math.cos(a) * 80; scene.player.y += Math.sin(a) * 80;
  if (result === 'victory') {
    const ed: EnemyData = er.data;
    const ib = ed.type === '\u5996\u5c06' || ed.type === '\u5996\u738b';
    const expGain = ed.expReward || 0;
    const goldGain = ed.goldReward || 0;
    const leveled = GameState.gainExp(expGain);
    GameState.gold += goldGain;
    GameState.recordKill(ed.name);
    GameState.updateQuestProgress('kill', ed.name);
    const loot = generateLoot(ed.type, GameState.zone);
    const lootNames: string[] = [];
    for (const drop of loot) { Inventory.addItem(drop as any); lootNames.push(drop.name); }
    let msg = '\u7ecf\u9a8c+' + expGain + '  \u91d1\u5e01+' + goldGain;
    if (lootNames.length > 0) msg += '\n\u6389\u843d: ' + lootNames.join(', ');
    if (leveled) msg += '\n\u2605 \u5347\u7ea7\uff01Lv.' + GameState.level;
    const notif = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 80, msg, {
      fontSize: '16px', color: '#88ff88', fontStyle: 'bold',
      backgroundColor: '#112211cc', padding: { x: 20, y: 10 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(300);
    scene.tweens.add({ targets: notif, alpha: 0, y: GAME_HEIGHT / 2 - 120, duration: 2500, onComplete: () => notif.destroy() });
    scene.scene.get('UIScene').events.emit('updateStats');
    removeMonster(scene, er);
    if (scene.gameRoom) {
      scene.gameRoom.send('killMonster', { id: er.id, respawnMs: monsterRespawnMs(scene, er) });
    } else {
      if (er.respawnTimer) er.respawnTimer.destroy();
      const d = ib ? 7200000 : ed.type === '\u6076\u5996' ? 300000 : 30000;
      er.respawnTimer = scene.time.delayedCall(d, () => restoreMonster(scene, er));
    }
  }
}

export function onMultiBattleEnd(scene: any, result: string, monsterId: string, enemyData: any, reward?: { exp: number; gold: number; loot: string[]; leveled: boolean }): void {
  if (result === 'defeat' || result === 'fled') {
    scene.player.x = 400; scene.player.y = 500;
    GameState.hp = GameState.maxHp; GameState.mp = GameState.maxMp;
    if (scene.gameRoom) scene.gameRoom.send('unlockMonster', { id: monsterId });
    scene.pendingBattleReport = { exp: 0, gold: 0, loot: [], leveled: false, defeat: result === 'defeat', fled: result === 'fled' };
    return;
  }
  if (result === 'victory') {
    const en = scene.enemies.find((e: any) => e.id === monsterId);
    if (enemyData && enemyData.name) {
      const ib = enemyData.type === '\u5996\u5c06' || enemyData.type === '\u5996\u738b';
      if (!reward) {
        const expGain = enemyData.expReward || 0;
        const goldGain = enemyData.goldReward || 0;
        const leveled = GameState.gainExp(expGain);
        GameState.gold += goldGain;
        GameState.recordKill(enemyData.name);
        GameState.updateQuestProgress('kill', enemyData.name);
        const loot = generateLoot(enemyData.type, GameState.zone);
        const lootNames: string[] = [];
        for (const drop of loot) { Inventory.addItem(drop as any); lootNames.push(drop.name); }
        let msg = '\u7ecf\u9a8c+' + expGain + '  \u91d1\u5e01+' + goldGain;
        if (lootNames.length > 0) msg += '\n\u6389\u843d: ' + lootNames.join(', ');
        if (leveled) msg += '\n\u2605 \u5347\u7ea7\uff01Lv.' + GameState.level;
        reward = { exp: expGain, gold: goldGain, loot: lootNames, leveled };
      }
      scene.pendingBattleReport = { exp: reward.exp, gold: reward.gold, loot: reward.loot, leveled: reward.leveled, defeat: false, fled: false };
      if (en && scene.gameRoom) {
        scene.gameRoom.send('killMonster', { id: monsterId, respawnMs: monsterRespawnMs(scene, { data: enemyData }) });
      }
    }
  }
  scene.battleCooldown = 60;
  if (scene.gameRoom) scene.setBattling(false);
}

export function monsterRespawnMs(scene: any, er: any): number {
  const name = (er.data as any)?.name || '';
  const isBoss = name.includes('\u5927\u865a') || name.includes('\u4e9a\u4e18\u5361\u65af');
  if (isBoss) return 2 * 60 * 60 * 1000;
  const isNamed = NAMED_ENEMIES[name];
  if (isNamed) return 5 * 60 * 1000;
  return 30000;
}

export function removeMonster(scene: any, en: any): void {
  if (!en || en.dead) return;
  en.dead = true;
  if (en.respawnTimer) { en.respawnTimer.remove(); en.respawnTimer = undefined; }
  if (en.sprite) { en.sprite.setVisible(false); en.sprite.body?.enable && (en.sprite.body.enable = false); }
  if (en.label) en.label.setVisible(false);
}

export function restoreMonster(scene: any, en: any): void {
  if (!en || !en.dead) return;
  en.dead = false;
  if (en.sprite) { en.sprite.setVisible(true); en.sprite.body?.enable && (en.sprite.body.enable = true); }
  if (en.label) en.label.setVisible(true);
}

export function flushBattleReport(scene: any): void {
  if (!scene.pendingBattleReport) return;
  const r = scene.pendingBattleReport;
  scene.pendingBattleReport = null;
  if (r.defeat) { scene.showWorldNotif('\u6218\u6597\u5931\u8d25', false); return; }
  if (r.fled) return;
  const parts: string[] = [];
  if (r.exp) parts.push('\u7ecf\u9a8c+' + r.exp);
  if (r.gold) parts.push('\u91d1\u5e01+' + r.gold);
  if (r.loot.length) parts.push('\u83b7\u5f97: ' + r.loot.join(', '));
  if (r.leveled) parts.push('\u5347\u7ea7\uff01');
  if (parts.length) scene.showWorldNotif(parts.join(' | '), true);
}
