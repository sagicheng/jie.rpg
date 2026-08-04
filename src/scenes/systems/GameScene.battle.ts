/**
 * GameScene 战斗入口/结束回调子系统
 */
import { GameState } from '../../managers/GameState';
import { EnemyData, createEnemyData, generateLoot } from '../../managers/BattleData';
import { Inventory } from '../../managers/Inventory';
import { NAMED_ENEMIES } from '../../managers/BestiaryData';
import { expForLevel } from '../../managers/BattleData';
import { isOnline } from '../../api/WorldClient';
import { getEnemyData } from '../../managers/BestiaryData';

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
  if (scene.inDungeon) return;
  if (scene.isInDialogue) return;
  if (scene.battleCooldown > 0) return;
  if (scene.gameRoom && !scene.isMonsterAvailable(en.id)) return;
  scene.battleCooldown = 60;
  scene.pauseForMenu();
  if (scene.gameRoom) { scene.gameRoom.send('enterBattle', { id: en.id }); scene.setBattling(true); }
  try {
    if (scene.gameRoom) {
      scene.scene.launch('MultiBattleScene', { mode: 'map', enemyData: en.data, enemyParty: scene.buildEncounterParty(en.data), monsterId: en.id, playerName: GameState.playerName || '\u52c7\u8005', loadout: scene.buildBattleLoadout(), ownerSessionId: scene.mySessionId });
    } else {
      scene.scene.launch('BattleScene', { template: en.data, enemyRef: en, zone: GameState.zone });
    }
    scene.scene.pause();
  } catch (err: any) {
    console.error('[enterBattle] \u5f02\u5e38\uff08\u602a\u7269=' + (en.data?.name ?? '?') + '\uff09\uff1a', err);
    scene.battleCooldown = 0;
    scene.resumeFromMenu();
    if (scene.gameRoom) scene.setBattling(false);
  }
}

export function isMonsterAvailable(scene: any, id: string): boolean {
  if (!scene.gameRoom?.state?.monsters) return true;
  const m = scene.gameRoom.state.monsters.get(id);
  return !m || m.alive || (m.respawnAt && Date.now() >= m.respawnAt);
}

export function onBattleEnd(scene: any, result: string, er: any): void {
  scene.battleCooldown = 60;
  if (scene.gameRoom) scene.setBattling(false);
  if (result === 'victory') {
    const ed: EnemyData = er?.data || er;
    const rewards = ed.expReward && ed.goldReward ? { exp: ed.expReward, gold: ed.goldReward, loot: generateLoot(ed.type, ed.zone).map((i: any) => i.name) } : null;
    if (rewards) {
      GameState.gold += rewards.gold;
      const levelUp = GameState.gainExp(rewards.exp);
      rewards.loot.forEach((name: string) => Inventory.addItem({ id: name, name, type: 'consumable', desc: '', quantity: 1 }));
      if (levelUp) scene.scene.get('UIScene').events.emit('updateStats');
    }
    GameState.recordKill(ed.name);
    const titles = GameState.drainTitleNotifications();
    titles.forEach((t: string, i: number) => scene.time.delayedCall(i * 500, () => scene.showWorldNotif('\u83b7\u5f97\u79f0\u53f7\u3010' + t + '\u3011\uff01', true)));
    scene.removeMonster(er);
    if (scene.gameRoom) {
      scene.gameRoom.send('killMonster', { id: er.id, respawnMs: monsterRespawnMs(scene, { data: ed }) });
    } else {
      const d = monsterRespawnMs(scene, { data: ed });
      er.dead = true;
      er.respawnTimer = scene.time.delayedCall(d, () => restoreMonster(scene, er));
    }
  }
}

export function onMultiBattleEnd(scene: any, result: string, monsterId: string, enemyData: any, reward?: any): void {
  if (result === 'victory' && reward) {
    GameState.gold += reward.gold;
    const lv = GameState.gainExp(reward.exp);
    if (reward.loot) reward.loot.forEach((name: string) => Inventory.addItem({ id: name, name, type: 'consumable', desc: '', quantity: 1 }));
    if (lv) scene.scene.get('UIScene').events.emit('updateStats');
    if (enemyData?.name) GameState.recordKill(enemyData.name);
    const en = scene.enemies.find((e: any) => e.id === monsterId);
    if (en && scene.gameRoom) scene.gameRoom.send('killMonster', { id: monsterId, respawnMs: monsterRespawnMs(scene, { data: enemyData }) });
  } else if (result === 'defeat') {
    const en = scene.enemies.find((e: any) => e.id === monsterId);
    if (en && scene.gameRoom) scene.gameRoom.send('unlockMonster', { id: monsterId });
  }
  scene.battleCooldown = 60;
  if (scene.gameRoom) scene.setBattling(false);
}

export function monsterRespawnMs(scene: any, er: { data: EnemyData }): number {
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
