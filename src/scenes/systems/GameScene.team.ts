/**
 * GameScene 组队子系统
 * 每个导出函数对应原 GameScene 中的一个组队相关方法。
 */
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../../config/config';
import { GameState } from '../../managers/GameState';
import { dungeonProgress, dungeonWeekly, DUNGEON_WEEKLY_CAP } from '../../api/WorldClient';
import { setArenaMatching, closeArenaPanel } from '../../ui/panels';

// ===== 邀请管理 =====

export function addPendingInvite(scene: any, data: { fromName: string; fromSid: string; teamId: string }): void {
  if (scene.pendingInvites.some((i: any) => i.fromSid === data.fromSid && i.teamId === data.teamId)) return;
  scene.pendingInvites.push(data);
}

export function removePendingInvite(scene: any, teamId: string, fromSid: string): void {
  scene.pendingInvites = scene.pendingInvites.filter((i: any) => !(i.teamId === teamId && i.fromSid === fromSid));
}

// ===== 面板开关 =====

export function toggleTeamPanel(scene: any): void {
  if (scene.teamPanelFull) closeTeamPanel(scene);
  else openTeamPanel(scene);
}

export function closeTeamPanel(scene: any): void {
  try {
    if (scene.teamPanelFull) { scene.teamPanelFull.destroy(true); scene.teamPanelFull = null; }
  } catch { scene.teamPanelFull = null; }
}

export function showInvitePrompt(scene: any, data: { fromName: string; fromSid: string; teamId: string }): void {
  addPendingInvite(scene, data);
  openTeamPanel(scene);
}

// ===== 副本确认面板 =====

export function teamPanelButton(scene: any, c: any, x: number, y: number, bw: number, bh: number, label: string, fill: number, textColor: string, cb: () => void): void {
  const g = scene.add.graphics();
  g.fillStyle(fill, 0.9); g.fillRoundedRect(x - bw / 2, y - bh / 2, bw, bh, 6);
  g.lineStyle(1, 0xc9a96e, 0.5); g.strokeRoundedRect(x - bw / 2, y - bh / 2, bw, bh, 6);
  const t = scene.add.text(x, y, label, { fontSize: '13px', color: textColor, fontStyle: 'bold' }).setOrigin(0.5);
  const z = scene.add.zone(x, y, bw, bh).setInteractive({ useHandCursor: true });
  z.on('pointerover', () => { g.clear(); g.fillStyle(fill, 1); g.fillRoundedRect(x - bw / 2, y - bh / 2, bw, bh, 6); });
  z.on('pointerout', () => { g.clear(); g.fillStyle(fill, 0.9); g.fillRoundedRect(x - bw / 2, y - bh / 2, bw, bh, 6); t.setColor(textColor); });
  z.on('pointerdown', cb);
  c.add([g, t, z]);
}

export function showDungeonConfirm(scene: any, zone: number): void {
  if (scene.dungeonConfirmOpen) return;
  scene.dungeonConfirmOpen = true;
  const w = GAME_WIDTH, h = GAME_HEIGHT;
  const cam = scene.cameras.main;
  const c = scene.add.container(cam.scrollX, cam.scrollY).setDepth(500);
  const followCam = (): void => c.setPosition(cam.scrollX, cam.scrollY);
  cam.on('update', followCam);
  c.once(Phaser.GameObjects.Events.DESTROY, () => cam.off('update', followCam));
  scene.dungeonConfirmPanel = c;
  const dim = scene.add.graphics();
  dim.fillStyle(0x000000, 0.55); dim.fillRect(0, 0, w, h);
  c.add(dim);
  const active = dungeonProgress && dungeonProgress.dungeonId === zone;
  const pw = 360, ph = active ? 224 : 190;
  const px = (w - pw) / 2, py = (h - ph) / 2;
  const panel = scene.add.graphics();
  panel.fillStyle(0x16162a, 0.97); panel.fillRoundedRect(px, py, pw, ph, 14);
  panel.lineStyle(2, 0xaa66ff, 0.8); panel.strokeRoundedRect(px, py, pw, ph, 14);
  c.add(panel);
  if (active) {
    c.add(scene.add.text(px + pw / 2, py + 36, `\u7ee7\u7eed\u526f\u672c ${zone}`, { fontSize: '22px', color: '#e8d8ff', fontStyle: 'bold' }).setOrigin(0.5));
    c.add(scene.add.text(px + pw / 2, py + 72, `\u5f53\u524d\u8fdb\u5ea6\uff1a\u7b2c ${dungeonProgress!.stage} \u9636 / \u5171 3 \u9636`, { fontSize: '14px', color: '#9ad8ff' }).setOrigin(0.5));
    c.add(scene.add.text(px + pw / 2, py + 96, '\u4e2d\u65ad\u8fdb\u5ea6\u5df2\u4fdd\u5b58\uff0c\u91cd\u8fde\u8fdb\u5165\u5c06\u4ece\u8be5\u9636\u7ee7\u7eed', { fontSize: '12px', color: '#bbaadd' }).setOrigin(0.5));
    teamPanelButton(scene, c, px + pw / 2 - 95, py + 148, 175, 46, '\u91cd\u8fde\u8fdb\u5165', 0x3a2a4a, '#cdaaff', () => {
      closeDungeonConfirm(scene); scene.enterDungeon(zone);
    });
    teamPanelButton(scene, c, px + pw / 2 + 95, py + 148, 175, 46, '\u653e\u5f03\u8fdb\u5ea6', 0x4a2a2a, '#ffb0b0', () => {
      closeDungeonConfirm(scene);
      scene.gameRoom?.send('intent', { op: 'abandonDungeon', dungeonId: zone });
    });
    teamPanelButton(scene, c, px + pw / 2, py + 192, 150, 36, '\u6682\u4e0d\u8fdb\u5165', 0x2a2a2a, '#cccccc', () => {
      closeDungeonConfirm(scene);
    });
  } else {
    c.add(scene.add.text(px + pw / 2, py + 42, `\u8fdb\u5165\u526f\u672c ${zone}\uff1f`, { fontSize: '22px', color: '#e8d8ff', fontStyle: 'bold' }).setOrigin(0.5));
    const remaining = Math.max(0, DUNGEON_WEEKLY_CAP - dungeonWeekly.count);
    c.add(scene.add.text(px + pw / 2, py + 78, `\u672c\u5468\u5269\u4f59 ${remaining} \u6b21`, { fontSize: '13px', color: '#bbaadd' }).setOrigin(0.5));
    teamPanelButton(scene, c, px + pw / 2 - 90, py + 138, 150, 44, '\u8fdb\u5165\u526f\u672c', 0x2a1a3a, '#cdaaff', () => {
      closeDungeonConfirm(scene); scene.enterDungeon(zone);
    });
    teamPanelButton(scene, c, px + pw / 2 + 90, py + 138, 150, 44, '\u6682\u4e0d\u8fdb\u5165', 0x2a2a2a, '#cccccc', () => {
      closeDungeonConfirm(scene);
    });
  }
}

export function closeDungeonConfirm(scene: any): void {
  if (scene.dungeonConfirmPanel) { scene.dungeonConfirmPanel.destroy(true); scene.dungeonConfirmPanel = null; }
  scene.dungeonConfirmOpen = false;
}

// ===== 队伍 HUD =====
// 左上角队伍信息已改为 GameScene.teamInfoText（持久 Text + setVisible 模式，参照称号 titleTag），
// 在 GameScene.update() 每帧根据 teamId 刷新显隐，不再使用 Container create/destroy，彻底避免残留。
// renderTeamPanel 现在仅负责：如有邀请则提示 + 如面板开着则刷新 teamPanelFull。

export function renderTeamPanel(scene: any): void {
  // 安全清理旧 Container（如果有遗留）
  hideTeamPanel(scene);
  if (!scene.teamId) return;
  const hasInvites = scene.pendingInvites.length > 0;
  // 有邀请时自动打开完整面板处理（原有逻辑保留）
  if (hasInvites && !scene.teamPanelFull) {
    openTeamPanel(scene);
  }
  // 面板开着则实时刷新成员列表
  if (scene.teamPanelFull) {
    openTeamPanel(scene); // openTeamPanel 内部会先 destroy 旧的再重建
  }
}

export function hideTeamPanel(scene: any): void {
  try {
    if (scene.teamPanel) { scene.teamPanel.destroy(true); scene.teamPanel = null; }
  } catch { scene.teamPanel = null; }
}

// ===== 战斗路由 =====

export function launchTeamBattle(scene: any, monsterId: string): void {
  if (!scene.gameRoom) return;
  scene.battleCooldown = 120;
  scene.setBattling(true);
  const loadout = scene.buildBattleLoadout();
  scene.scene.launch('MultiBattleScene', {
    playerName: GameState.playerName || '\u52c7\u8005',
    loadout,
    monsterId,
    ownerSessionId: scene.mySessionId,
    isTeamPull: true,
  });
  scene.scene.pause();
}

export function enterPvpBattle(scene: any, data: { roomId: string; mode: string; team: string; token: string }): void {
  if (!scene.gameRoom) return;
  setArenaMatching(false);
  if (scene.arenaPanel) closeArenaPanel(scene);
  const loadout = scene.buildBattleLoadout();
  scene.scene.launch('PvpBattleScene', {
    roomId: data.roomId,
    token: data.token,
    charId: scene.characterId,
    team: data.team,
    gameSid: scene.mySessionId,
    playerName: GameState.playerName || '\u52c7\u8005',
    mode: data.mode === '4v4' ? '4v4' : '1v1',
    loadout,
  });
  scene.scene.pause();
}

export function routeTeamDungeonBattle(scene: any, data: { dungeonId?: number; stage?: number }): void {
  if (!scene.inDungeon) return;
  const dms = scene.scene.get('DungeonMapScene') as any;
  if (!dms || !dms.scene.isActive()) return;
  dms.pullIntoTeamBattle(data);
}

export function routeTeamBattleEnd(scene: any): void {
  if (scene.inDungeon) {
    const dms = scene.scene.get('DungeonMapScene') as any;
    if (dms) dms.stopTeamBattle();
  } else {
    stopTeamBattle(scene);
  }
}

export function routeTeamDungeonStage(scene: any, stage: number): void {
  if (!scene.inDungeon) return;
  const dms = scene.scene.get('DungeonMapScene') as any;
  if (dms) dms.syncToServerStage(stage);
}

export function routeTeamExitDungeon(scene: any): void {
  if (!scene.inDungeon) return;
  const dms = scene.scene.get('DungeonMapScene') as any;
  if (dms) dms.exitToGame();
}

export function stopTeamBattle(scene: any): void {
  if (scene.scene.isActive('MultiBattleScene')) scene.scene.stop('MultiBattleScene');
}

export function invitePlayer(scene: any, targetSid: string): void {
  if (scene.teamId) {
    scene.showWorldNotif('\u4f60\u5df2\u5728\u961f\u4f0d\u4e2d', false);
    return;
  }
  scene.gameRoom?.send('invite', { targetSid });
  scene.showWorldNotif('\u5df2\u53d1\u9001\u7ec4\u961f\u9080\u8bf7', true);
}

export function makeRemotePlayersInteractable(scene: any): void {
  scene.remotePlayers.forEach((rp: any, sid: string) => {
    const tag = rp.tag;
    if (tag._teamInviteSet) return;
    tag._teamInviteSet = true;
    tag.setInteractive({ useHandCursor: true });
    tag.on('pointerdown', () => {
      if (!scene.gameRoom) return;
      if (scene.teamId) { scene.showWorldNotif('\u4f60\u5df2\u5728\u961f\u4f0d\u4e2d', false); return; }
      invitePlayer(scene, sid);
    });
    tag.on('pointerover', () => tag.setColor('#ffe8b0'));
    tag.on('pointerout', () => tag.setColor('#ffffff'));
  });
}

// ===== 完整组队面板 =====

export function openTeamPanel(scene: any): void {
  closeTeamPanel(scene);
  const w = GAME_WIDTH, h = GAME_HEIGHT;
  const cam = scene.cameras.main;
  const c = scene.add.container(cam.scrollX, cam.scrollY).setDepth(500);
  const followCam = (): void => c.setPosition(cam.scrollX, cam.scrollY);
  cam.on('update', followCam);
  c.once(Phaser.GameObjects.Events.DESTROY, () => cam.off('update', followCam));

  // 退出/解散后本地立即清理：服务端仅向留队成员广播 teamUpdate/teamDisbanded，退出者收不到消息，
  // 不清理会导致左上角 HUD 残留、全屏面板不关闭。
  const cleanupAfterLeave = (msg: string): void => {
    scene.teamId = ''; scene.teamMembers = []; scene.teamLeaderSid = '';
    scene.hideTeamPanel(); scene.closeTeamPanel();
    scene.showWorldNotif(msg, true);
  };

  const ov = scene.add.graphics();
  ov.fillStyle(0, 0.55); ov.fillRect(0, 0, w, h);
  ov.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
  c.add(ov);

  const TBTN = (x: number, y: number, label: string, color: string, hover: string, cb: () => void): void => {
    const t = scene.add.text(x, y, `[ ${label} ]`, { fontSize: '12px', color, fontStyle: 'bold', backgroundColor: '#002233aa', padding: { x: 10, y: 5 } }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    t.on('pointerover', () => t.setColor(hover));
    t.on('pointerout', () => t.setColor(color));
    t.on('pointerdown', cb);
    c.add(t);
  };

  const candidatesAll = (!scene.inDungeon)
    ? [...scene.remotePlayers.entries()].filter(([sid]: [string, any]) => !scene.teamMembers.some((m: any) => m.sid === sid))
    : [];

  const rowH = 64;
  let rows = 0;
  if (scene.pendingInvites.length > 0) rows += 1 + scene.pendingInvites.length;
  if (scene.teamMembers.length > 0) rows += 1 + scene.teamMembers.length + 1;
  rows += 2;
  if (scene.teamPanelInviteOpen) rows += candidatesAll.length;
  const mw = 560;
  const mh = Math.max(470, Math.min(70 + rows * rowH + 24, h - 40));
  const mx = (w - mw) / 2, my = (h - mh) / 2;

  const bg = scene.add.graphics();
  bg.fillStyle(0x121222, 0.985); bg.fillRoundedRect(mx, my, mw, mh, 12);
  bg.lineStyle(2, 0x6a5a3a, 0.7); bg.strokeRoundedRect(mx, my, mw, mh, 12);
  c.add(bg);

  c.add(scene.add.text(mx + mw / 2, my + 26, '\u25c6  \u961f \u4f0d \u9762 \u677f  \u25c6', { fontSize: '20px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));

  const closeT = scene.add.text(mx + mw - 30, my + 26, '\u2715', { fontSize: '20px', color: '#cc6666', padding: { x: 6, y: 4 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
  closeT.on('pointerover', function (this: any) { this.setColor('#ff8888'); });
  closeT.on('pointerout', function (this: any) { this.setColor('#cc6666'); });
  closeT.on('pointerdown', () => closeTeamPanel(scene));
  c.add(closeT);

  c.add(scene.add.text(mx + mw / 2, my + 50, '\u7ec4\u961f\u540e\u53ef\u4e00\u540c\u6311\u6218\u526f\u672c\uff08\u7ade\u6280\u573a\u4e0d\u53ef\u7ec4\u961f\uff09', { fontSize: '11px', color: '#6677aa', padding: { y: 2 } }).setOrigin(0.5));

  const listX = mx + 24;
  const listW = mw - 48;
  let y = my + 70;

  const drawRow = (ry: number, hgt: number, accent: number): void => {
    const g = scene.add.graphics();
    g.fillStyle(0x152028, 0.6); g.fillRoundedRect(listX, ry, listW, hgt, 8);
    g.lineStyle(1, accent, 0.6); g.strokeRoundedRect(listX, ry, listW, hgt, 8);
    c.add(g);
  };

  if (scene.pendingInvites.length > 0) {
    c.add(scene.add.text(listX, y, `\u5f85\u5904\u7406\u9080\u8bf7 (${scene.pendingInvites.length})`, { fontSize: '14px', color: '#ffd980', fontStyle: 'bold', padding: { y: 2 } }));
    y += 26;
    for (const inv of scene.pendingInvites) {
      drawRow(y, rowH - 8, 0xc9a96e);
      c.add(scene.add.text(listX + 14, y + (rowH - 8) / 2, `${inv.fromName} \u9080\u8bf7\u4f60\u7ec4\u961f`, { fontSize: '14px', color: '#ffffff', padding: { y: 2 } }).setOrigin(0, 0.5));
      TBTN(listX + listW - 150, y + (rowH - 8) / 2, '\u63a5\u53d7', '#88ee88', '#ffffff', () => {
        scene.gameRoom?.send('respondInvite', { teamId: inv.teamId, accept: true });
        removePendingInvite(scene, inv.teamId, inv.fromSid);
        openTeamPanel(scene);
      });
      TBTN(listX + listW - 78, y + (rowH - 8) / 2, '\u62d2\u7edd', '#ff8888', '#ffffff', () => {
        scene.gameRoom?.send('respondInvite', { teamId: inv.teamId, accept: false });
        removePendingInvite(scene, inv.teamId, inv.fromSid);
        openTeamPanel(scene);
      });
      y += rowH;
    }
    y += 8;
  }

  if (scene.teamMembers.length > 0) {
    c.add(scene.add.text(listX, y, `\u961f\u4f0d\u6210\u5458 (${scene.teamMembers.length}/4)`, { fontSize: '14px', color: '#ffd980', fontStyle: 'bold', padding: { y: 2 } }));
    y += 26;
    const amLeader = scene.teamLeaderSid === scene.mySessionId;
    for (const m of scene.teamMembers) {
      const isLeader = m.sid === scene.teamLeaderSid;
      const isMe = m.sid === scene.mySessionId;
      const label = isLeader ? `\u2605 ${m.name}\uff08\u961f\u957f\uff09` : isMe ? `\u25b6 ${m.name}\uff08\u4f60\uff09` : `  ${m.name}`;
      drawRow(y, rowH - 8, isMe ? 0xc9a96e : 0x3a5a6a);
      c.add(scene.add.text(listX + 14, y + (rowH - 8) / 2, label, { fontSize: '14px', color: isMe ? '#88ff88' : '#ffffff', padding: { y: 2 } }).setOrigin(0, 0.5));
      if (amLeader && !isMe) {
        TBTN(listX + listW - 78, y + (rowH - 8) / 2, '\u8e22\u51fa', '#ff8888', '#ffffff', () => {
          scene.gameRoom?.send('kickMember', { targetSid: m.sid });
          openTeamPanel(scene);
        });
      } else if (isMe && !amLeader) {
        TBTN(listX + listW - 78, y + (rowH - 8) / 2, '\u9000\u51fa', '#ffcc88', '#ffffff', () => {
          scene.gameRoom?.send('leaveTeam', {});
          cleanupAfterLeave('\u4f60\u5df2\u9000\u51fa\u961f\u4f0d');
        });
      }
      y += rowH;
    }
    y += 6;
    if (amLeader) {
      TBTN(listX, y + 16, '\u89e3\u6563\u961f\u4f0d', '#ff8888', '#ffffff', () => { scene.gameRoom?.send('disbandTeam', {}); cleanupAfterLeave('\u961f\u4f0d\u5df2\u89e3\u6563'); });
    } else {
      TBTN(listX, y + 16, '\u9000\u51fa\u961f\u4f0d', '#ffcc88', '#ffffff', () => { scene.gameRoom?.send('leaveTeam', {}); cleanupAfterLeave('\u4f60\u5df2\u9000\u51fa\u961f\u4f0d'); });
    }
    y += 44;
  }

  c.add(scene.add.text(listX, y, '\u9080\u8bf7\u961f\u5458', { fontSize: '14px', color: '#ffd980', fontStyle: 'bold', padding: { y: 2 } }));
  y += 26;
  const blockBottom = my + mh - 16;
  TBTN(listX, y + 4, scene.teamPanelInviteOpen ? '\u25be \u6536\u8d77\u5217\u8868' : '\u25b8 \u5c55\u5f00\u9644\u8fd1\u73a9\u5bb6', '#88ccff', '#ffffff', () => {
    scene.teamPanelInviteOpen = !scene.teamPanelInviteOpen;
    openTeamPanel(scene);
  });
  y += 38;
  if (scene.teamPanelInviteOpen) {
    if (candidatesAll.length === 0) {
      c.add(scene.add.text(listX + 14, y, '\u9644\u8fd1\u6ca1\u6709\u53ef\u9080\u8bf7\u7684\u73a9\u5bb6', { fontSize: '13px', color: '#667788', padding: { y: 2 } }));
    } else {
      let shown = 0;
      for (const [sid, rp] of candidatesAll) {
        if (y + rowH > blockBottom) break;
        drawRow(y, rowH - 8, 0x3a5a6a);
        c.add(scene.add.text(listX + 14, y + (rowH - 8) / 2, rp.name, { fontSize: '14px', color: '#ffffff', padding: { y: 2 } }).setOrigin(0, 0.5));
        TBTN(listX + listW - 78, y + (rowH - 8) / 2, '\u9080\u8bf7', '#99dd99', '#ffffff', () => {
          scene.gameRoom?.send('invite', { targetSid: sid });
          scene.showWorldNotif('\u5df2\u53d1\u9001\u7ec4\u961f\u9080\u8bf7', true);
          scene.teamPanelInviteOpen = false;
          openTeamPanel(scene);
        });
        y += rowH; shown++;
      }
      if (shown < candidatesAll.length) {
        c.add(scene.add.text(listX + 14, y, `... \u8fd8\u6709 ${candidatesAll.length - shown} \u4f4d\u73a9\u5bb6\u672a\u663e\u793a`, { fontSize: '12px', color: '#556677', padding: { y: 2 } }));
      }
    }
  }

  scene.teamPanelFull = c;
}
