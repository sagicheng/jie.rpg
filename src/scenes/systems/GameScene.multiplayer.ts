/**
 * GameScene 联机子系统
 */
import { GAME_WIDTH, GAME_HEIGHT } from '../../config/config';
import { GameState } from '../../managers/GameState';
import { setDisconnectNotifier, setActiveRoom, applyWorldSync } from '../../api/WorldClient';
import { getClient } from '../../core/Net';
import { showShikaiSelection, refreshAuctionPanel, setArenaMatching, setArenaStatus, renderArenaPanel } from '../../ui/panels';
import { GuildClient } from '../../api/GuildClient';

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

export function connectGameRoom(scene: any): void {
    if (scene.gameRoom) return;
    setDisconnectNotifier((msg: string) => scene.showWorldNotif(msg, false));
    getClient().joinOrCreate('game', {
      name: GameState.playerName || '玩家',
      title: GameState.getActiveTitleDef()?.name ?? '',
      token: scene.authToken,
      characterId: scene.characterId,
    })
      .then((room: any) => {
        scene.gameRoom = room;
        scene.mySessionId = room.sessionId;
        setActiveRoom(room);
        room.send('move', { x: Math.round(scene.player.x), y: Math.round(scene.player.y) });
        room.onStateChange(() => scene.syncRemotePlayers());

        // 权威世界状态同步
        room.onMessage('worldSync', (pw: any) => {
          applyWorldSync(scene, pw);
          // 旧档迁移：已始解但服务端未存斩魄刀真名 -> 引导重新选择以恢复始解/卍解技能（仅一次）
          if (!scene.shikaiReselectDone && GameState.hasShikai && !GameState.zpId) {
            scene.shikaiReselectDone = true;
            scene.time.delayedCall(500, () => showShikaiSelection(scene));
          }
        });

        // Stage D：认证失败
        room.onMessage('authError', (msg: string) => {
          scene.showWorldNotif(msg || '认证失败，返回标题画面', false);
          scene.time.delayedCall(2000, () => {
            room.leave();
            scene.scene.start('TitleScene');
          });
        });

        room.onMessage('intentResult', (res: any) => scene.onIntentResult(res));
        room.onLeave(() => { scene.clearRemotePlayers(); setActiveRoom(null); });
        // 统一聊天（多频道：world/guild/team/whisper/system/event）
        room.onMessage('chat', (m: { channel: string; fromName: string; fromCharId: number; text: string; ts: number }) => scene.onChat(m));
        // 好友实时通知（申请/接受/拒绝/移除/上下线）——定向推送，客户端无法伪造
        room.onMessage('friendNotify', (m: any) => {
          const name = (m.name || m.fromName || '好友') as string;
          const cid: number = m.charId != null ? m.charId : (m.fromCharId != null ? m.fromCharId : -1);
          switch (m.type) {
            case 'request':
              scene.showWorldNotif(`${name} 申请加你为好友`, true);
              if (scene.friendPanel) scene.refreshFriendPanel();
              break;
            case 'accepted':
              scene.showWorldNotif(`${name} 已接受你的好友申请`, true);
              if (scene.friendPanel) scene.refreshFriendPanel();
              break;
            case 'declined':
              scene.showWorldNotif(`${name} 拒绝了你的好友申请`, false);
              break;
            case 'removed':
              scene.showWorldNotif(`${name} 将你从好友列表移除了`, false);
              if (scene.friendPanel) scene.refreshFriendPanel();
              break;
            case 'online':
              if (cid >= 0) GameState.friendOnline[cid] = true;
              scene.showWorldNotif(`${name} 上线了`, true);
              if (scene.friendPanel) scene.refreshFriendPanel();
              break;
            case 'offline':
              if (cid >= 0) GameState.friendOnline[cid] = false;
              scene.showWorldNotif(`${name} 下线了`, false);
              if (scene.friendPanel) scene.refreshFriendPanel();
              break;
          }
        });

        // 拍卖行数据（列表/我的挂单/收藏/历史经 intent 请求后由服务端下发，客户端缓存并渲染/重渲染）
        room.onMessage('auctionData', (m: any) => {
          GameState.auctionData = m;
          if (scene.auctionPanel) refreshAuctionPanel(scene);
        });

        // 进房后拉取公会归属（供聊天发送/面板首屏/战斗加成）
        GuildClient.info(scene.authToken, scene.characterId).then((r: any) => {
          if (r && r.ok && r.inGuild) {
            GameState.guildId = r.guild.id; GameState.guildName = r.guild.name; GameState.guildRank = r.myRank;
            // 公会成长数据（v2）
            GameState.guildLevel = r.guild.level || 1;
            GameState.guildExp = r.guild.exp || 0;
            GameState.guildExpCap = r.guild.expCap || 0;
            GameState.guildContribution = r.guild.contribution || 0;
            GameState.guildMyContribution = r.myContribution || 0;
            GameState.guildSkills = r.guild.skills || {};
          } else {
            GameState.guildId = null; GameState.guildName = ''; GameState.guildRank = '';
            GameState.guildLevel = 1; GameState.guildExp = 0; GameState.guildExpCap = 0;
            GameState.guildContribution = 0; GameState.guildMyContribution = 0; GameState.guildSkills = {};
          }
        }).catch(() => { GameState.guildId = null; });

        // ═════ 组队消息 ————

        // 副本内队伍 HUD（DungeonMapScene.this.teamHud）与主场景 teamPanel 是两套独立容器，
        // 解散 / 被踢 / 队伍清空时必须一并清掉，否则副本场景的左上角信息框会残留。
        const clearDungeonTeamHud = (s: any): void => {
          const dms = s.scene.get('DungeonMapScene') as any;
          if (dms && typeof dms.clearTeamHud === 'function') dms.clearTeamHud();
        };

        // 收到邀请：入列（支持多人同时邀请逐条处理），并自动打开组队面板处理
        room.onMessage('inviteReceived', (data: { fromName: string; fromSid: string; teamId: string }) => {
          scene.addPendingInvite(data);
          scene.openTeamPanel();
        });

        // 队伍状态更新
        room.onMessage('teamUpdate', (data: { id: string; leaderSid: string; members: Array<{ sid: string; name: string }> }) => {
          if (!data.members || data.members.length === 0) {
            // 队伍已空（队长解散 / 最后一人离开过程中可能收到缩编消息）：彻底清理，防止左上角 HUD 残留
            scene.teamId = '';
            scene.teamMembers = [];
            scene.teamLeaderSid = '';
            scene.hideTeamPanel();
            scene.closeTeamPanel();
            clearDungeonTeamHud(scene);
            // 延迟兜底
            scene.time?.delayedCall(200, () => { scene.hideTeamPanel(); scene.closeTeamPanel(); clearDungeonTeamHud(scene); });
            return;
          }
          scene.teamId = data.id;
          scene.teamLeaderSid = data.leaderSid;
          scene.teamMembers = data.members;
          scene.renderTeamPanel();
          if (scene.teamPanelFull) scene.openTeamPanel(); // 面板开着则实时刷新
        });

        // 全队进入战斗
        room.onMessage('enterTeamBattle', (data: { monsterId: string }) => {
          scene.launchTeamBattle(data.monsterId);
        });
        // 副本内：队长开战 → 队员（DungeonMapScene）被拉进同一 battle room 共斗
        room.onMessage('enterTeamDungeonBattle', (data: { dungeonId: number; stage: number }) => {
        scene.routeTeamDungeonBattle(data);
      });
      // 队长战斗返回 → 队员（副本或地图场景）同步退出战斗场景
      room.onMessage('teamExitBattleEnd', () => {
        scene.routeTeamBattleEnd();
      });
      // 队长进入下一阶镜像地图 / 返回主世界 → 队员同步重建地图 / 退出副本
      room.onMessage('teamDungeonStage', (data: { stage: number }) => {
        scene.routeTeamDungeonStage(data.stage);
      });
      room.onMessage('teamExitDungeon', () => {
        scene.routeTeamExitDungeon();
      });

      // 队长进副本 → 队员跟随进入（仅当自身未在副本/未在战斗）
        room.onMessage('enterTeamDungeon', (data: { dungeonId: number }) => {
          if (scene.inDungeon) return;
          if (scene.scene.isActive('MultiBattleScene') || scene.scene.isActive('DungeonMapScene')) return;
          scene.enterDungeon(data.dungeonId, true);
        });

        // 被踢出
        room.onMessage('teamKicked', () => {
          scene.teamId = '';
          scene.teamMembers = [];
          scene.teamLeaderSid = '';
          scene.pendingInvites = [];
          scene.hideTeamPanel();
          scene.closeTeamPanel();
          clearDungeonTeamHud(scene);
          scene.showWorldNotif('你被移出了队伍', false);
          // 延迟兜底：覆盖「teamUpdate 重建 → kicked 清理」竞态窗口
          scene.time?.delayedCall(200, () => { scene.hideTeamPanel(); scene.closeTeamPanel(); clearDungeonTeamHud(scene); });
        });

        // 队伍解散
        room.onMessage('teamDisbanded', () => {
          scene.teamId = '';
          scene.teamMembers = [];
          scene.teamLeaderSid = '';
          scene.pendingInvites = [];
          scene.hideTeamPanel();
          scene.closeTeamPanel();
          clearDungeonTeamHud(scene);
          scene.showWorldNotif('队伍已解散', false);
          // 延迟兜底：覆盖 disband 循环中 teamUpdate 重建 HUD 的竞态窗口
          scene.time?.delayedCall(200, () => { scene.hideTeamPanel(); scene.closeTeamPanel(); clearDungeonTeamHud(scene); });
        });

        // 队伍错误提示
        room.onMessage('teamError', (msg: string) => {
          scene.showWorldNotif(msg, false);
        });

        // ═══ PVP 竞技场消息 ═══
        // 匹配成功：服务端已创建 PvpRoom 并通过 arenaService 下发房间号
        room.onMessage('arenaMatch', (data: { roomId: string; mode: string; team: string; token: string }) => {
          scene.enterPvpBattle(data);
        });
        // 匹配超时（60s 未凑齐真人）：取消并提示
        room.onMessage('arenaQueueTimeout', () => {
          setArenaMatching(false);
          scene.showWorldNotif('匹配超时：未凑齐对手，已取消（绝不 AI 替代）', false);
        });
        // 竞技场权威状态（面板展示用）
        room.onMessage('arenaStatus', (s: any) => {
          setArenaStatus(s);
          // 用缓存重渲染面板，不再调用 openArenaPanel（避免重新请求→服务端回 arenaStatus→再渲染的死循环）
          if (scene.arenaPanel) renderArenaPanel(scene);
      });
      room.onError((code: number, msg: string) => console.warn('[game] \u623f\u95f4\u9519\u8bef', code, msg));
    })
    .catch((e: any) => console.warn('[game] \u8054\u673a\u623f\u95f4\u8fde\u63a5\u5931\u8d25\uff0c\u5355\u673a\u6a21\u5f0f\u7ee7\u7eed', e));
}
