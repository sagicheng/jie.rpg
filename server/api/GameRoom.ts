/**
 * 共享地图房间：玩家移动同步 + 聊天 + 权威世界状态 + 多人组队。
 *
 * Stage D：Token 验证 + DB 持久化。
 * Stage D+：多人组队——邀请/接受/踢人/解散 + 全队共享战斗 + 同进副本。
 */

import { Room, Client } from '@colyseus/core';
import { GameRoomState, GamePlayer, MonsterState } from '../core/schema';
import { world, type OpResult } from '../core/world';
import { findAccountByToken, getCharacter, getMemberGuild, saveCharacterWorld, addGuildExp, addMemberContribution, getFriends, listAuctions, myAuctions, getFavorites, addFavorite, removeFavorite, isFavorited, getHistory } from '../core/db';
import { guildShopBuy } from '../modules/feature/guildShop';
import { createAuction, buyAuction, cancelAuction } from '../modules/feature/auction';
import { enqueueArena, dequeueArena, queueSize } from '../modules/feature/arenaService';
import { isArenaOpen, ARENA_WEEKLY_CAP } from '../modules/feature/arena';
import { zoneName } from '../core/zoneNames';

const COLORS = ['#ff6b6b', '#4ecdc4', '#ffd93d', '#a78bfa', '#ff9f43', '#54a0ff'];
const TEAM_MAX = 4;

// ——— 队伍数据结构（模块级，同一 GameRoom 内共享）———

interface TeamMember {
  sid: string;
  name: string;
}
interface Team {
  id: string;
  leaderSid: string;
  members: Map<string, TeamMember>; // sid → member
  invites: Map<string, { fromName: string; expiresAt: number }>; // targetSid → invite
}
const teams = new Map<string, Team>();          // teamId → Team
const playerTeam = new Map<string, string>();   // playerSid → teamId

/** sessionId → characterId 映射 */
const sessionCharMap = new Map<string, number>();

/**
 * 公会在线成员注册表（模块级，跨 GameRoom 实例共享）。
 * guildId → (sessionId → { client, charId, name }) ，用于公会聊天跨房间广播。
 */
const onlineGuild = new Map<number, Map<string, { client: Client; charId: number; name: string }>>();

function registerGuildOnline(client: Client, charId: number, name: string): void {
  const gid = getMemberGuild(charId);
  if (gid === null) return;
  let set = onlineGuild.get(gid);
  if (!set) { set = new Map(); onlineGuild.set(gid, set); }
  set.set(client.sessionId, { client, charId, name });
}

function unregisterGuildOnline(client: Client): void {
  onlineGuild.forEach((set) => set.delete(client.sessionId));
}

/**
 * 全量在线客户端注册表（模块级，跨 GameRoom 实例共享）。
 * sessionId → { client, charId, name }，用于组队/私聊/活动跨房间投递。
 */
const onlineClients = new Map<string, { client: Client; charId: number; name: string; location: string }>();

function registerOnline(client: Client, charId: number, name: string, location = ''): void {
  onlineClients.set(client.sessionId, { client, charId, name, location });
}
function unregisterOnline(client: Client): void {
  onlineClients.delete(client.sessionId);
}

/** 向指定 charId 的所有在线会话定向推送消息（跨房间，仿公会聊天）。 */
export function sendToCharId(charId: number, msgType: string, data: any): boolean {
  let sent = false;
  onlineClients.forEach((rec) => {
    if (rec.charId === charId) { rec.client.send(msgType, data); sent = true; }
  });
  return sent;
}

/** 给某角色加金币：在线→通过其 GameRoom 实例 worldSync 到账；离线→直接改 DB world_data（安全，无内存副本）。用于拍卖行卖家成交结算。 */
function addGoldToChar(charId: number, amt: number): void {
  let targetSid: string | undefined;
  onlineClients.forEach((rec) => { if (rec.charId === charId) targetSid = rec.client.sessionId; });
  if (targetSid !== undefined) {
    const pw = world.get(targetSid);
    if (pw) {
      world.addGold(pw, amt);
      onlineClients.get(targetSid)?.client.send('worldSync', pw);
    }
    return;
  }
  try {
    const c = getCharacter(charId);
    if (c) { const w: any = JSON.parse(c.world_data); w.gold = (w.gold || 0) + amt; saveCharacterWorld(charId, JSON.stringify(w)); }
  } catch {}
}

/** 取某 charId 的当前在线地图场景名（不在线返回 null）。 */
export function getOnlineLocation(charId: number): string | null {
  for (const rec of onlineClients.values()) {
    if (rec.charId === charId) return rec.location || '';
  }
  return null;
}

/** 好友上下线通知：向该玩家的所有在线好友推送 friendNotify。 */
function notifyFriendsOnline(charId: number, online: boolean): void {
  const whoName = getCharacter(charId)?.name || '';
  for (const f of getFriends(charId)) {
    sendToCharId(f.charId, 'friendNotify', { type: online ? 'online' : 'offline', charId, name: whoName });
  }
}

// ——— 队伍辅助函数 ———

function genTeamId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function broadcastTeam(room: Room<GameRoomState>, teamId: string): void {
  const team = teams.get(teamId);
  if (!team) return;
  const members: Array<{ sid: string; name: string }> = [];
  team.members.forEach((m) => members.push({ sid: m.sid, name: m.name }));
  const payload = { id: team.id, leaderSid: team.leaderSid, members };
  team.members.forEach((_, sid) => {
    const c = room.clients.find((x: Client) => x.sessionId === sid);
    if (c) c.send('teamUpdate', payload);
  });
}

function removeFromTeam(room: Room<GameRoomState>, sid: string): void {
  const teamId = playerTeam.get(sid);
  if (!teamId) return;
  const team = teams.get(teamId);
  if (!team) { playerTeam.delete(sid); return; }

  team.members.delete(sid);
  playerTeam.delete(sid);
  // 清除 Colyseus 状态上的 teamId
  const p = room.state.players.get(sid);
  if (p) p.teamId = '';

  if (team.members.size === 0) {
    // 空队：解散
    teams.delete(teamId);
    return;
  }

  // 队长离开 → 转移给第一个成员
  if (team.leaderSid === sid) {
    const first = team.members.keys().next().value as string;
    team.leaderSid = first;
  }

  // 清除该玩家收到的所有待处理邀请
  team.invites.delete(sid);
  broadcastTeam(room, teamId);
}

// 清理过期邀请（3分钟超时）
function pruneExpiredInvites(team: Team): void {
  const now = Date.now();
  team.invites.forEach((inv, sid) => {
    if (now > inv.expiresAt) team.invites.delete(sid);
  });
}

// ══════════════════════════════════════════════════════════════

export class GameRoom extends Room<GameRoomState> {
  onCreate() {
    this.setState(new GameRoomState());

    // ─── 基础消息 ───

    this.onMessage('move', (client, data: { x?: number; y?: number }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || typeof data.x !== 'number' || typeof data.y !== 'number') return;

      // 组队：非队长跟随队长，防止跨场景作弊
      const teamId = playerTeam.get(client.sessionId);
      if (teamId) {
        const team = teams.get(teamId);
        if (team && team.leaderSid !== client.sessionId) {
          const leader = this.state.players.get(team.leaderSid);
          if (leader) {
            // 固定编队位置：按 sessionId hash 选稳定偏移，不与 syncTeamPositions 冲突
            const offsets = [[0, 40], [-40, 30], [40, 30], [0, 60]];
            const idx = this.teamMemberIndex(team, client.sessionId);
            const [ox, oy] = offsets[(idx - 1) % offsets.length];
            p.x = leader.x + ox;
            p.y = leader.y + oy;
            return;
          }
        }
      }

      p.x = data.x; p.y = data.y;
    });

    // 统一聊天：单入口，按 channel 分流（world/system 房间内；guild/team/whisper/event 跨房间或定向）
    this.onMessage('chat', (client, data: { channel?: string; text?: string; targetCharId?: number }) => {
      const channel = typeof data?.channel === 'string' ? data.channel : 'world';
      // 服务端专属频道：客户端不得伪造
      if (channel === 'event' || channel === 'system') return;
      const charId = sessionCharMap.get(client.sessionId);
      if (charId === undefined) return;
      const text = typeof data?.text === 'string' ? data.text.trim().slice(0, 200) : '';
      if (!text) return;
      const name = getCharacter(charId)?.name || '匿名';
      const ts = Date.now();
      const payload = { channel, fromName: name, fromCharId: charId, text, ts };

      if (channel === 'world') {
        this.clients.forEach((c) => c.send('chat', payload));
        return;
      }
      if (channel === 'guild') {
        const gid = getMemberGuild(charId);
        if (gid === null) return;
        const set = onlineGuild.get(gid);
        if (set) set.forEach(({ client: c }) => c.send('chat', payload));
        return;
      }
      if (channel === 'team') {
        const teamId = playerTeam.get(client.sessionId);
        if (!teamId) return;
        const team = teams.get(teamId);
        if (!team) return;
        team.members.forEach((_, sid) => {
          const rec = onlineClients.get(sid);
          if (rec) rec.client.send('chat', payload);
        });
        return;
      }
      if (channel === 'whisper') {
        const target = typeof data?.targetCharId === 'number' ? data.targetCharId : 0;
        if (!target || target === charId) return;
        // 定向发给目标（跨房间）
        onlineClients.forEach((rec) => {
          if (rec.charId === target) rec.client.send('chat', { ...payload, channel: 'whisper', targetCharId: target });
        });
        // 回显给发送者
        client.send('chat', { ...payload, channel: 'whisper', targetCharId: target });
        return;
      }
    });

    // 测试专用：仅 CHAT_DEV=1 时接受，用于触发服务端专属频道（活动/系统）广播
    this.onMessage('devChat', (client, data: { channel?: string; text?: string }) => {
      if (process.env.CHAT_DEV !== '1') return;
      const channel = data?.channel;
      if (channel !== 'event' && channel !== 'system') return;
      const text = String(data?.text ?? '').slice(0, 200);
      if (!text) return;
      const payload = { channel, fromName: channel === 'event' ? '活动' : '系统', fromCharId: 0, text, ts: Date.now() };
      if (channel === 'event') {
        onlineClients.forEach((rec) => rec.client.send('chat', payload));
      } else {
        this.clients.forEach((c) => c.send('chat', payload));
      }
    });

    this.onMessage('setTitle', (client, data: { title?: string }) => {
      const p = this.state.players.get(client.sessionId);
      if (p) p.title = String(data.title ?? '').slice(0, 16);
    });

    this.onMessage('setBattling', (client, data: { v?: boolean }) => {
      const p = this.state.players.get(client.sessionId);
      if (p) p.battling = !!data.v;
    });

    // ─── 怪物状态机 ───

    this.onMessage('enterBattle', (client, data: { id?: string }) => this.lockMonster(client, data));
    this.onMessage('killMonster', (client, data: { id?: string; respawnMs?: number }) => this.killMonster(client, data));
    this.onMessage('unlockMonster', (client, data: { id?: string }) => this.unlockMonster(client, data));
    // 副本内开战广播：任一队员撞怪开战 → 通知全队进入同一 battle room 共斗（排除发起者自身）
    this.onMessage('dungeonEnterBattle', (client, data: { dungeonId?: number; stage?: number }) => {
      const teamId = playerTeam.get(client.sessionId);
      if (!teamId) return;
      const team = teams.get(teamId);
      if (!team) return;
      const dungeonId = Number(data?.dungeonId) || 1;
      const stage = Number(data?.stage) || 1;
      team.members.forEach((_m: any, msid: string) => {
        if (msid === client.sessionId) return;
        const c = this.clients.find((x: Client) => x.sessionId === msid);
        if (c) c.send('enterTeamDungeonBattle', { dungeonId, stage });
      });
    });

    // 战斗返回广播：队长主动返回地图/副本 → 通知全队一起退出战斗场景（排除发起者自身）
    // 与 dungeonEnterBattle 对称，由客户端按 inDungeon 决定 resume 到副本还是地图场景
    this.onMessage('teamExitBattle', (client) => {
      const teamId = playerTeam.get(client.sessionId);
      if (!teamId) return;
      const team = teams.get(teamId);
      if (!team) return;
      team.members.forEach((_m: any, msid: string) => {
        if (msid === client.sessionId) return;
        const c = this.clients.find((x: Client) => x.sessionId === msid);
        if (c) c.send('teamExitBattleEnd');
      });
    });

    // 副本阶段推进广播：队长进入下一阶镜像地图 → 通知队员同步重建地图（排除发起者自身）
    this.onMessage('teamDungeonStage', (client, data: { stage?: number }) => {
      const teamId = playerTeam.get(client.sessionId);
      if (!teamId) return;
      const team = teams.get(teamId);
      if (!team) return;
      const stage = Number(data?.stage) || 1;
      team.members.forEach((_m: any, msid: string) => {
        if (msid === client.sessionId) return;
        const c = this.clients.find((x: Client) => x.sessionId === msid);
        if (c) c.send('teamDungeonStage', { stage });
      });
    });

    // 副本退出广播：队长返回主世界 → 通知队员同步退出副本地图（排除发起者自身）
    this.onMessage('teamExitDungeon', (client) => {
      const teamId = playerTeam.get(client.sessionId);
      if (!teamId) return;
      const team = teams.get(teamId);
      if (!team) return;
      team.members.forEach((_m: any, msid: string) => {
        if (msid === client.sessionId) return;
        const c = this.clients.find((x: Client) => x.sessionId === msid);
        if (c) c.send('teamExitDungeon');
      });
    });

    this.clock.setInterval(() => this.tickRespawn(), 1000);

    // ─── 权威世界操作意图 ───

    this.onMessage('intent', (client, data: any) => {
      const pw = world.get(client.sessionId);
      let res: OpResult = { ok: false, msg: '未知操作' };
      switch (data?.op) {
        case 'gather': res = world.gather(pw, Number(data.zone) | 0, Number(data.nodeIdx) | 0, Number(data.x) | 0, Number(data.y) | 0); break;
        case 'addLoot': world.grantLoot(pw, Array.isArray(data.drops) ? data.drops : []); res = { ok: true, msg: 'loot' }; break;
        case 'buy': res = world.buy(pw, String(data.itemId || '')); break;
        case 'equip': res = world.equip(pw, String(data.itemId || '')); break;
        case 'unequip': res = world.unequip(pw, String(data.slot || '') as any); break;
        case 'questProgress': world.updateQuest(pw, String(data.type || ''), String(data.target || ''), Number(data.amount) || 1); res = { ok: true, msg: 'progress' }; break;
        case 'claimQuest': {
          res = world.claimQuest(pw, String(data.questId || ''));
          // 公会 v2 经验/贡献来源：日常/周常领奖给公会加经验 + 个人贡献（主线/支线仅一次，不计）
          if (res.ok && (res.type === 'daily' || res.type === 'weekly')) {
            const cid = sessionCharMap.get(client.sessionId);
            if (cid !== undefined) {
              const gid = getMemberGuild(cid);
              if (gid !== null) {
                const gain = Math.round((res.data?.exp || 0) * 0.5) || 50;
                addGuildExp(gid, gain);
                addMemberContribution(cid, gain);
              }
            }
          }
          break;
        }
        case 'craft': res = world.craft(pw, String(data.recipeName || ''), data.zone !== undefined ? Number(data.zone) : undefined); break;
        case 'enhance': res = world.enhance(pw, String(data.itemId || '')); break;
        case 'refine': res = world.refine(pw, String(data.itemId || '')); break;
        case 'decompose': res = world.decompose(pw, String(data.itemId || '')); break;
        case 'refineReset': res = world.refineReset(pw, String(data.itemId || '')); break;
        case 'allocateStat':
          res = world.allocateStat(pw, String(data.attr || ''));
          if (res.ok) {
            const cid = sessionCharMap.get(client.sessionId);
            if (cid !== undefined) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} }
          }
          break;
        case 'unlock':
          res = world.addUnlock(pw, String(data.key || ''), data.zanpakuto ? String(data.zanpakuto) : undefined);
          if (res.ok) { const cid = sessionCharMap.get(client.sessionId); if (cid !== undefined) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} } }
          break;
        case 'setZanpakuto':
          res = world.setZanpakuto(pw, String(data.zanpakuto || ''));
          if (res.ok) { const cid = sessionCharMap.get(client.sessionId); if (cid !== undefined) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} } }
          break;
        case 'kidoSetSchool':
          res = world.kidoSetSchool(pw, String(data.school || ''));
          if (res.ok) { const cid = sessionCharMap.get(client.sessionId); if (cid !== undefined) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} } }
          break;
        case 'kidoAllocate':
          res = world.kidoAllocate(pw, String(data.nodeId || ''));
          if (res.ok) { const cid = sessionCharMap.get(client.sessionId); if (cid !== undefined) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} } }
          break;
        case 'kidoEquip':
          res = world.kidoEquip(pw, String(data.nodeId || ''));
          if (res.ok) { const cid = sessionCharMap.get(client.sessionId); if (cid !== undefined) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} } }
          break;
        case 'claimBestiaryTier':
          res = world.claimBestiaryTier(pw, Number(data.tierId) || 0);
          if (res.ok) { const cid = sessionCharMap.get(client.sessionId); if (cid !== undefined) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} } }
          break;
        case 'setTitle':
          res = world.setTitle(pw, (data.id === undefined || data.id === null) ? null : String(data.id));
          if (res.ok) { const cid = sessionCharMap.get(client.sessionId); if (cid !== undefined) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} } }
          break;
        case 'abandonDungeon':
          // 放弃进行中的副本进度（清 pw.dungeon，不计费；与 completeDungeon 同源）。
          // 仅当活动副本匹配时才清，避免误清他人/其他副本。
          world.completeDungeon(pw, Number(data.dungeonId) || 0);
          res = { ok: true, msg: '已放弃副本进度' };
          if (res.ok) { const cid = sessionCharMap.get(client.sessionId); if (cid !== undefined) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} } }
          break;
        case 'mallBuy':
          res = world.mallBuy(pw, String(data.itemId || ''));
          if (res.ok) { const cid = sessionCharMap.get(client.sessionId); if (cid !== undefined) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} } }
          break;
        case 'respec':
          res = world.respec(pw);
          if (res.ok) { const cid = sessionCharMap.get(client.sessionId); if (cid !== undefined) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} } }
          break;
        // ——— PVP 竞技场匹配 ———
        case 'arenaQueue': {
          const token = String(data.token || '');
          const charId = sessionCharMap.get(client.sessionId);
          if (!token || charId === undefined) { res = { ok: false, msg: '未登录' }; break; }
          const mode = data.mode === '4v4' ? '4v4' : '1v1';
          world.ensureArena(pw);
          if (!isArenaOpen()) { res = { ok: false, msg: '竞技场仅在每周五 18:00-24:00 开放' }; break; }
          if (pw.arena.weeklyUsed >= ARENA_WEEKLY_CAP) { res = { ok: false, msg: `本周匹配次数已用完（${ARENA_WEEKLY_CAP}次）` }; break; }
          enqueueArena({ sid: client.sessionId, client, mode, points: pw.arena.points, charId, token, enqueuedAt: Date.now() });
          res = { ok: true, msg: `已进入${mode === '4v4' ? '4v4' : '1v1'}匹配队列`, data: { mode, queueSize: queueSize(mode) } };
          break;
        }
        case 'arenaCancel':
          dequeueArena(client.sessionId);
          res = { ok: true, msg: '已取消匹配' };
          break;
        case 'arenaStatus':
          // 纯状态查询：直接推 arenaStatus 消息；不发 intentResult 回执
          // （否则客户端中央会反复弹 "ok"，且会触发面板重渲染→再请求→死循环）
          client.send('arenaStatus', world.arenaStatus(pw));
          return;
        case 'devGrantSet':
          // Dev 作弊键(Ctrl+E)：发放同区域同品质测试套装（联机权威，落库以免重连丢失）
          res = world.grantSetTestGear(pw, Number(data.zone) || 1, String(data.quality || 'blue'));
          if (res.ok) { const cid = sessionCharMap.get(client.sessionId); if (cid !== undefined) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} } }
          break;
        // ——— 行会商店购买（个人贡献消费闭环） ———
        case 'guildBuy': {
          const cid = sessionCharMap.get(client.sessionId);
          if (cid === undefined) { res = { ok: false, msg: '未登录' }; break; }
          res = guildShopBuy(pw, cid, String(data.itemId || ''));
          if (res.ok) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} }
          break;
        }
        // ——— 拍卖行（一口价）———
        case 'auctionList': {
          const cid = sessionCharMap.get(client.sessionId);
          if (cid === undefined) { res = { ok: false, msg: '未登录' }; break; }
          const list = listAuctions(data.filter || {});
          const favSet = new Set(getFavorites(cid));
          client.send('auctionData', { tab: 'market', auctions: list.map((a: any) => ({ ...a, favorited: favSet.has(a.id) })) });
          return; // 列表非 pw，不走 worldSync
        }
        case 'auctionMine': {
          const cid = sessionCharMap.get(client.sessionId);
          if (cid === undefined) { res = { ok: false, msg: '未登录' }; break; }
          const list = myAuctions(cid);
          client.send('auctionData', { tab: 'mine', auctions: list.map((a: any) => ({ ...a, favorited: isFavorited(cid, a.id) })) });
          return;
        }
        case 'auctionFavList': {
          const cid = sessionCharMap.get(client.sessionId);
          if (cid === undefined) { res = { ok: false, msg: '未登录' }; break; }
          const ids = getFavorites(cid);
          const list = listAuctions({}).filter((a: any) => ids.includes(a.id));
          client.send('auctionData', { tab: 'fav', auctions: list.map((a: any) => ({ ...a, favorited: true })) });
          return;
        }
        case 'auctionHistory': {
          const cid = sessionCharMap.get(client.sessionId);
          if (cid === undefined) { res = { ok: false, msg: '未登录' }; break; }
          client.send('auctionData', { tab: 'history', history: getHistory(cid) });
          return;
        }
        case 'auctionFav': {
          const cid = sessionCharMap.get(client.sessionId);
          if (cid === undefined) { res = { ok: false, msg: '未登录' }; break; }
          const id = Number(data.auctionId);
          if (data.on) addFavorite(cid, id); else removeFavorite(cid, id);
          res = { ok: true, msg: data.on ? '已收藏' : '已取消收藏' };
          break;
        }
        case 'auctionCreate': {
          const cid = sessionCharMap.get(client.sessionId);
          if (cid === undefined) { res = { ok: false, msg: '未登录' }; break; }
          res = createAuction(pw, cid, String(data.itemId || ''), Number(data.qty) || 1, Number(data.price) || 0);
          if (res.ok) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} }
          break;
        }
        case 'auctionBuy': {
          const cid = sessionCharMap.get(client.sessionId);
          if (cid === undefined) { res = { ok: false, msg: '未登录' }; break; }
          const r = buyAuction(pw, cid, Number(data.auctionId) || 0);
          if (r.ok && r.data) { addGoldToChar(r.data.sellerCharId, r.data.sellerGain); try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} }
          res = r;
          break;
        }
        case 'auctionCancel': {
          const cid = sessionCharMap.get(client.sessionId);
          if (cid === undefined) { res = { ok: false, msg: '未登录' }; break; }
          res = cancelAuction(pw, cid, Number(data.auctionId) || 0);
          if (res.ok) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} }
          break;
        }
        // ── 灵宠系统（服务端权威，变更即落库，worldSync 下发）──
        case 'petSetActive': {
          const cid = sessionCharMap.get(client.sessionId);
          if (cid === undefined) { res = { ok: false, msg: '未登录' }; break; }
          res = world.setActivePet(pw, String(data.petId || ''));
          if (res.ok) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} }
          break;
        }
        case 'petRelease': {
          const cid = sessionCharMap.get(client.sessionId);
          if (cid === undefined) { res = { ok: false, msg: '未登录' }; break; }
          res = world.releasePet(pw, String(data.petId || ''));
          if (res.ok) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} }
          break;
        }
        case 'petGrantDev': {
          const cid = sessionCharMap.get(client.sessionId);
          if (cid === undefined) { res = { ok: false, msg: '未登录' }; break; }
          res = world.grantPetTest(pw, data.speciesId ? String(data.speciesId) : undefined, data.level ? Number(data.level) : undefined);
          if (res.ok) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} }
          break;
        }
        case 'petGrantEgg': {
          const cid = sessionCharMap.get(client.sessionId);
          if (cid === undefined) { res = { ok: false, msg: '未登录' }; break; }
          res = world.grantPetEgg(pw, typeof data.zone === 'number' ? data.zone : 1);
          if (res.ok) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} }
          break;
        }
        case 'petRecall': {
          const cid = sessionCharMap.get(client.sessionId);
          if (cid === undefined) { res = { ok: false, msg: '未登录' }; break; }
          res = world.recallPet(pw, String(data.petId || ''));
          if (res.ok) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} }
          break;
        }
        case 'petSetAttr': {
          const cid = sessionCharMap.get(client.sessionId);
          if (cid === undefined) { res = { ok: false, msg: '未登录' }; break; }
          res = world.setPetAttr(pw, String(data.petId || ''), String(data.attr || '') as any, Number(data.delta) || 0);
          if (res.ok) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} }
          break;
        }
        case 'usePetEgg': {
          const cid = sessionCharMap.get(client.sessionId);
          if (cid === undefined) { res = { ok: false, msg: '未登录' }; break; }
          res = world.openPetEgg(pw, String(data.itemId || ''));
          if (res.ok) { try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {} }
          break;
        }
      }
      client.send('intentResult', res);
      client.send('worldSync', pw);
    });

    // ══════════════════════════════════════════════════
    //  队伍系统（多人组队·Stage D+）
    // ══════════════════════════════════════════════════

    // 邀请组队
    this.onMessage('invite', (client, data: { targetSid?: string }) => {
      const fromSid = client.sessionId;
      const targetSid = String(data?.targetSid ?? '').slice(0, 64);
      if (!targetSid || fromSid === targetSid) return;

      // 检查目标是否存在且在线
      const target = this.state.players.get(targetSid);
      if (!target) return;

      const from = this.state.players.get(fromSid);
      if (!from) return;

      // 目标已在队伍中？
      if (playerTeam.has(targetSid)) return;

      // 发邀请
      let teamId = playerTeam.get(fromSid);
      if (!teamId) {
        // 发起方不在队伍中 → 新建队伍
        teamId = genTeamId();
        const team: Team = {
          id: teamId, leaderSid: fromSid,
          members: new Map([[fromSid, { sid: fromSid, name: from.name }]]),
          invites: new Map(),
        };
        teams.set(teamId, team);
        playerTeam.set(fromSid, teamId);
        from.teamId = teamId;
      }

      const team = teams.get(teamId)!;
      if (team.members.size >= TEAM_MAX) {
        client.send('teamError', '队伍已满（最多4人）');
        return;
      }

      pruneExpiredInvites(team);
      team.invites.set(targetSid, {
        fromName: from.name,
        expiresAt: Date.now() + 180_000,
      });

      const tc = this.clients.find((x: Client) => x.sessionId === targetSid);
      if (tc) tc.send('inviteReceived', { fromName: from.name, fromSid, teamId });
    });

    // 接受/拒绝邀请
    this.onMessage('respondInvite', (client, data: { teamId?: string; accept?: boolean }) => {
      const sid = client.sessionId;
      const teamId = String(data?.teamId ?? '');
      const accept = !!data?.accept;
      const team = teams.get(teamId);
      if (!team) return;

      const invite = team.invites.get(sid);
      if (!invite) return;

      team.invites.delete(sid);

      if (accept) {
        if (playerTeam.has(sid)) return; // 已在他队
        if (team.members.size >= TEAM_MAX) return;
        const p = this.state.players.get(sid);
        team.members.set(sid, { sid, name: p?.name ?? '未知' });
        playerTeam.set(sid, teamId);
        if (p) p.teamId = teamId;
        broadcastTeam(this, teamId);
      }
    });

    // 退出队伍
    this.onMessage('leaveTeam', (client) => {
      const sid = client.sessionId;
      const teamId = playerTeam.get(sid);
      if (!teamId) return;
      const team = teams.get(teamId);
      if (!team) { playerTeam.delete(sid); return; }

      removeFromTeam(this, sid);
      // 如果队伍还存在（未解散），给留队的人广播
      if (teams.has(teamId)) {
        broadcastTeam(this, teamId);
      } else {
        // 解散：通知所有已离队成员
        team.members.forEach((_, msid) => {
          const c = this.clients.find((x: Client) => x.sessionId === msid);
          if (c) c.send('teamDisbanded', {});
        });
      }
    });

    // 踢人（仅队长）
    this.onMessage('kickMember', (client, data: { targetSid?: string }) => {
      const leaderSid = client.sessionId;
      const targetSid = String(data?.targetSid ?? '');
      const teamId = playerTeam.get(leaderSid);
      if (!teamId) return;
      const team = teams.get(teamId);
      if (!team || team.leaderSid !== leaderSid) return;
      if (!team.members.has(targetSid)) return;
      if (targetSid === leaderSid) return;

      removeFromTeam(this, targetSid);
      broadcastTeam(this, teamId);
      // 告诉被踢者
      const tc = this.clients.find((x: Client) => x.sessionId === targetSid);
      if (tc) tc.send('teamKicked', {});
    });

    // 解散队伍（仅队长）
    this.onMessage('disbandTeam', (client) => {
      const sid = client.sessionId;
      const teamId = playerTeam.get(sid);
      if (!teamId) return;
      const team = teams.get(teamId);
      if (!team || team.leaderSid !== sid) return;

      const allSids = Array.from(team.members.keys());
      for (const msid of allSids) removeFromTeam(this, msid);
      teams.delete(teamId);
      for (const msid of allSids) {
        const c = this.clients.find((x: Client) => x.sessionId === msid);
        if (c) c.send('teamDisbanded', {});
      }
    });

    // 队长进入副本 → 广播全队跟随进入同一副本实例（DungeonRoom 按 dungeonId 合并，天然共享进度）
    this.onMessage('teamEnterDungeon', (client, data: { dungeonId?: number }) => {
      const leaderSid = client.sessionId;
      const teamId = playerTeam.get(leaderSid);
      if (!teamId) return;
      const team = teams.get(teamId);
      // 仅队长可触发，避免队员互拉造成循环
      if (!team || team.leaderSid !== leaderSid) return;
      const dungeonId = Number(data?.dungeonId) || 1;
      team.members.forEach((_, msid) => {
        if (msid === leaderSid) return;
        const c = this.clients.find((x: Client) => x.sessionId === msid);
        if (c) c.send('enterTeamDungeon', { dungeonId });
      });
    });

    // ─── 定时 ───

    this.clock.setInterval(() => {
      this.state.players.forEach((_p: any, sid: string) => {
        const c = this.clients.find((x: Client) => x.sessionId === sid);
        if (c) c.send('worldSync', world.get(sid));
      });
    }, 1000);

    this.clock.setInterval(() => this.saveAllOnline(), 30000);

    // 队伍跟随：每 500ms 将非队长位置强推到队长身边
    this.clock.setInterval(() => this.syncTeamPositions(), 500);
  }

  // ─── 怪物状态机 ───

  private getMonster(id: string): MonsterState {
    let m = this.state.monsters.get(id);
    if (!m) { m = new MonsterState(); m.id = id; m.state = 'available'; this.state.monsters.set(id, m); }
    return m;
  }

  /** 锁定怪物——组队时广播全队进入战斗。 */
  private lockMonster(client: Client, data: { id?: string }): void {
    if (!data || typeof data.id !== 'string') return;
    const id = data.id.slice(0, 64);
    if (!id) return;
    const m = this.getMonster(id);
    if (m.state !== 'available') return;

    m.state = 'busy'; m.owner = client.sessionId; m.respawnAt = 0;

    // 组队：通知其他队员进入同一场战斗（不发给触发者，他自己已走正常流程进战）
    const teamId = playerTeam.get(client.sessionId);
    if (teamId) {
      const team = teams.get(teamId);
      if (team) {
        team.members.forEach((_, sid) => {
          if (sid === client.sessionId) return; // 跳过触发者
          const c = this.clients.find((x: Client) => x.sessionId === sid);
          if (c) c.send('enterTeamBattle', { monsterId: id });
        });
      }
    }
  }

  private killMonster(client: Client, data: { id?: string; respawnMs?: number }): void {
    if (!data || typeof data.id !== 'string') return;
    const id = data.id.slice(0, 64);
    if (!id) return;
    const m = this.getMonster(id);
    if (m.state === 'busy' && m.owner !== client.sessionId) return;
    m.state = 'dead'; m.owner = '';
    m.respawnAt = Date.now() + (Number(data.respawnMs) || 30000);
  }

  private unlockMonster(client: Client, data: { id?: string }): void {
    if (!data || typeof data.id !== 'string') return;
    const id = data.id.slice(0, 64);
    if (!id) return;
    const m = this.state.monsters.get(id);
    if (m && m.state === 'busy' && m.owner === client.sessionId) {
      m.state = 'available'; m.owner = ''; m.respawnAt = 0;
    }
  }

  private tickRespawn(): void {
    const now = Date.now();
    this.state.monsters.forEach((m) => {
      if (m.state === 'dead' && m.respawnAt > 0 && now >= m.respawnAt) {
        m.state = 'available'; m.respawnAt = 0;
      }
    });
  }

  // ─── 进房 / 离房 ───

  onJoin(client: Client, options: { token?: string; characterId?: number; title?: string }) {
    const token = options?.token;
    const charId = options?.characterId;
    if (!token || !charId) {
      client.send('authError', '缺少 token 或角色ID');
      setTimeout(() => client.leave(), 100);
      return;
    }
    const acc = findAccountByToken(token);
    if (!acc) {
      client.send('authError', '登录已过期，请重新登录');
      setTimeout(() => client.leave(), 100);
      return;
    }
    const ch = getCharacter(charId);
    if (!ch || ch.account_id !== acc.id) {
      client.send('authError', '角色不存在');
      setTimeout(() => client.leave(), 100);
      return;
    }

    let pw: any;
    try {
      const data = JSON.parse(ch.world_data);
      if (data && typeof data === 'object' && data.level) {
        pw = world.loadFromJSON(client.sessionId, data);
      } else {
        pw = world.get(client.sessionId);
      }
    } catch {
      pw = world.get(client.sessionId);
    }

    sessionCharMap.set(client.sessionId, charId);
    world.registerCharId(client.sessionId, charId);
    registerGuildOnline(client, charId, ch.name);
    registerOnline(client, charId, ch.name, zoneName(pw.zone));
    // 好友上下线通知（向在线好友推送）
    notifyFriendsOnline(charId, true);

    const p = new GamePlayer();
    p.sessionId = client.sessionId;
    p.name = ch.name;
    p.title = String(options?.title ?? '').slice(0, 16);
    p.color = COLORS[Math.floor(Math.random() * COLORS.length)];
    p.x = 400 + Math.random() * 200;
    p.y = 300 + Math.random() * 100;
    this.state.players.set(client.sessionId, p);

    client.send('worldSync', pw);
    this.broadcastChat('system', `${p.name} 进入了地图`);
  }

  onLeave(client: Client) {
    // 退出竞技场匹配队列（避免残留假在线）
    dequeueArena(client.sessionId);
    // 自动退出队伍
    removeFromTeam(this, client.sessionId);
    const teamId = playerTeam.get(client.sessionId); // 重入队?
    if (!playerTeam.has(client.sessionId)) {
      // 已成功离队——通知队伍成员
      if (teamId && teams.has(teamId)) {
        broadcastTeam(this, teamId);
      }
    }

    // 保存世界到 DB
    const charId = sessionCharMap.get(client.sessionId);
    if (charId !== undefined) {
      const pw = world.get(client.sessionId);
      if (pw.level > 0) {
        try { saveCharacterWorld(charId, JSON.stringify(pw)); } catch {}
      }
      sessionCharMap.delete(client.sessionId);
      unregisterGuildOnline(client);
      unregisterOnline(client);
      // 好友离线通知（下线后向在线好友推送）
      notifyFriendsOnline(charId, false);
    }

    this.state.players.delete(client.sessionId);
    this.state.monsters.forEach((m) => {
      if (m.state === 'busy' && m.owner === client.sessionId) {
        m.state = 'available'; m.owner = ''; m.respawnAt = 0;
      }
    });
  }

  /** 服务端推送聊天（房间内频道：system 等）。客户端不可伪造。 */
  private broadcastChat(channel: string, text: string, fromName = '系统'): void {
    const payload = { channel, fromName, fromCharId: 0, text, ts: Date.now() };
    this.clients.forEach((c) => c.send('chat', payload));
  }

  private saveAllOnline(): void {
    sessionCharMap.forEach((charId, sid) => {
      try {
        const pw = world.get(sid);
        if (pw.level > 0) saveCharacterWorld(charId, JSON.stringify(pw));
      } catch {}
    });
  }

  /** 队伍跟随：服务端主动同步非队长到队长固定后方偏移（按 sessionId 排序确保位置稳定）。 */
  private syncTeamPositions(): void {
    teams.forEach((team) => {
      const leader = this.state.players.get(team.leaderSid);
      if (!leader) return;
      // 稳定排序：按 sessionId 字典序，保证每帧偏移一致
      const sortedMembers = [...team.members.keys()].filter((sid) => sid !== team.leaderSid).sort();
      sortedMembers.forEach((sid, i) => {
        const p = this.state.players.get(sid);
        if (!p) return;
        const offsets = [[0, 40], [-40, 30], [40, 30], [0, 60]];
        const [ox, oy] = offsets[i % offsets.length];
        p.x = leader.x + ox;
        p.y = leader.y + oy;
      });
    });
  }

  /** 获取队员在队伍中的稳定序号（1-based，跳过队长）。仅由 move handler 使用。 */
  private teamMemberIndex(team: Team, sid: string): number {
    const sorted = [...team.members.keys()].filter((s) => s !== team.leaderSid).sort();
    return sorted.indexOf(sid) + 1;
  }
}
