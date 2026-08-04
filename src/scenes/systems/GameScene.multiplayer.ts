/**
 * GameScene 联机子系统
 */
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../../config/config';
import { GameState } from '../../managers/GameState';

export function onIntentResult(scene: any, res: any): void {
  if (!res) return;
  if (res.ok && (res.msg === 'ok' || res.msg === 'OK' || res.msg === 'Ok' || res.msg === 'OK.')) return;
  scene.showWorldNotif(res.msg || (res.ok ? '\u64cd\u4f5c\u6210\u529f' : '\u64cd\u4f5c\u5931\u8d25'), !!res.ok);
}

export function showWorldNotif(scene: any, msg: string, ok: boolean): void {
  const n = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, msg, {
    fontSize: '16px', color: ok ? '#aaffaa' : '#ff8888', fontStyle: 'bold',
    backgroundColor: ok ? '#112211cc' : '#221111cc', padding: { x: 14, y: 6 },
  }).setOrigin(0.5).setScrollFactor(0).setDepth(1000);
  scene.tweens?.add({ targets: n, alpha: 0, y: 480, duration: 2000, delay: 1000, onComplete: () => n.destroy() });
}

export function showTitleUnlockNotif(scene: any, titles: string[]): void {
  titles.forEach((t, i) => {
    scene.time?.delayedCall(i * 600, () => {
      scene.showWorldNotif(`\u83b7\u5f97\u79f0\u53f7\u3010${t}\u3011\uff01`, true);
    });
  });
}

export function refreshOpenPanels(scene: any): void {
  const { renderStatPanel, renderInventoryPanel, renderQuestBoardPanel, renderArenaPanel } = require('../../ui/panels');
  if (scene.statPanel) renderStatPanel(scene);
  if (scene.inventoryPanel) renderInventoryPanel(scene);
  if (scene.shopPanel) scene.openShopPanel(scene.lastShopItems);
  if (scene.guildPanel) { const { renderGuildPanel } = require('../../ui/panels'); renderGuildPanel(scene, false); }
  if (scene.friendPanel) { const { renderFriendPanel } = require('../../ui/panels'); scene.friendPanel = renderFriendPanel(scene); }
  if (scene.arenaPanel) renderArenaPanel(scene);
}

export function openShopPanel(scene: any, shop: any[]): void {
  scene.lastShopItems = shop;
  const { renderQuestBoardPanel } = require('../../ui/panels');
  if (scene.shopPanel) { scene.shopPanel.destroy(true); scene.shopPanel = null; }
  scene.shopPanel = renderQuestBoardPanel(scene, shop);
}

export function broadcastTitle(scene: any): void {
  if (scene.gameRoom) {
    scene.gameRoom.send('setTitle', { title: GameState.getActiveTitleDef()?.name ?? '' });
  }
}

export function syncRemotePlayers(scene: any): void {
  if (!scene.gameRoom) return;
  const state = scene.gameRoom.state;
  if (!state || !state.players) return;
  const players = state.players as Map<string, any>;
  players.forEach((p: any, sid: string) => {
    if (sid === scene.mySessionId) return;
    let rp = scene.remotePlayers.get(sid);
    if (!rp) {
      const sprite = scene.add.sprite(p.x, p.y, 'walk_down_' + (p.gender || GameState.gender)).setDepth(8).setAlpha(0.9).setDisplaySize(40, 60);
      sprite.setTint(Phaser.Display.Color.HexStringToColor(p.color || '#ffffff').color);
      const tag = scene.add.text(p.x, p.y - sprite.displayHeight / 2 - 10, '', {
        fontSize: '13px', color: '#ffffff', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 3,
        backgroundColor: '#00000066', padding: { x: 5, y: 2 },
        align: 'center',
      }).setOrigin(0.5, 1).setDepth(50);
      rp = { sprite, tag, tx: p.x, ty: p.y, name: '', title: '', gender: p.gender || GameState.gender };
      scene.remotePlayers.set(sid, rp);
    }
    rp.tx = p.x; rp.ty = p.y;
    rp.name = p.name || '\u73a9\u5bb6';
    rp.title = p.title || '';
    const battling = p.battling ? '\uff08\u6218\u6597\u4e2d\uff09' : '';
    const txt = rp.title ? `\u3010${rp.title}\u3011\n${rp.name}${battling}` : `${rp.name}${battling}`;
    if (rp.tag.text !== txt) rp.tag.setText(txt);
  });
  for (const [sid, rp] of scene.remotePlayers) {
    if (!players.has(sid)) { rp.sprite.destroy(); rp.tag.destroy(); scene.remotePlayers.delete(sid); }
  }
  scene.makeRemotePlayersInteractable();
}

export function clearRemotePlayers(scene: any): void {
  scene.remotePlayers.forEach((rp: any) => { rp.sprite.destroy(); rp.tag.destroy(); });
  scene.remotePlayers.clear();
}

export function setBattling(scene: any, v: boolean): void {
  if (scene.gameRoom) scene.gameRoom.send('setBattling', { v });
}

export function sendMoveThrottled(scene: any): void {
  if (!scene.gameRoom) return;
  const now = scene.time.now;
  const dx = scene.player.x - scene.lastSent.x;
  const dy = scene.player.y - scene.lastSent.y;
  if (now - scene.lastSent.t >= 100 && dx * dx + dy * dy > 4) {
    scene.gameRoom.send('move', { x: Math.round(scene.player.x), y: Math.round(scene.player.y) });
    scene.lastSent = { x: scene.player.x, y: scene.player.y, t: now };
  }
}
