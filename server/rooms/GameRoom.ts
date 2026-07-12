/**
 * 共享地图房间：玩家移动同步 + 聊天 + 权威世界状态。
 *
 * Stage D：接入 Token 验证 + DB 持久化。
 * - onJoin 必须带 token + characterId，验证通过后才进房。
 * - 角色数据从 DB 加载到 WorldService 内存。
 * - onLeave 世界状态写回 DB，不清空（断线不丢进度）。
 */

import { Room, Client } from '@colyseus/core';
import { GameRoomState, GamePlayer, ChatMessage, MonsterState } from '../schema';
import { world, type OpResult } from '../world';
import { findAccountByToken, getCharacter, saveCharacterWorld } from '../db';

const COLORS = ['#ff6b6b', '#4ecdc4', '#ffd93d', '#a78bfa', '#ff9f43', '#54a0ff'];

/** sessionId → characterId 映射，留到 onLeave 时知道要保存哪个角色。 */
const sessionCharMap = new Map<string, number>();

export class GameRoom extends Room<GameRoomState> {
  onCreate() {
    this.setState(new GameRoomState());

    this.onMessage('move', (client, data: { x?: number; y?: number }) => {
      const p = this.state.players.get(client.sessionId);
      if (p && typeof data.x === 'number' && typeof data.y === 'number') {
        p.x = data.x;
        p.y = data.y;
      }
    });

    this.onMessage('chat', (client, data: { text?: string }) => {
      const p = this.state.players.get(client.sessionId);
      const msg = new ChatMessage();
      msg.name = p?.name ?? '匿名';
      msg.text = String(data.text ?? '').slice(0, 200);
      msg.t = Date.now();
      this.state.messages.push(msg);
      if (this.state.messages.length > 50) this.state.messages.shift();
    });

    this.onMessage('setTitle', (client, data: { title?: string }) => {
      const p = this.state.players.get(client.sessionId);
      if (p) p.title = String(data.title ?? '').slice(0, 16);
    });

    this.onMessage('setBattling', (client, data: { v?: boolean }) => {
      const p = this.state.players.get(client.sessionId);
      if (p) p.battling = !!data.v;
    });

    this.onMessage('enterBattle', (client, data: { id?: string }) => this.lockMonster(client, data));
    this.onMessage('killMonster', (client, data: { id?: string; respawnMs?: number }) => this.killMonster(client, data));
    this.onMessage('unlockMonster', (client, data: { id?: string }) => this.unlockMonster(client, data));

    this.clock.setInterval(() => this.tickRespawn(), 1000);

    this.onMessage('intent', (client, data: any) => {
      const sid = client.sessionId;
      const pw = world.get(sid);
      let res: OpResult = { ok: false, msg: '未知操作' };
      switch (data?.op) {
        case 'gather': res = world.gather(pw, Number(data.zone) | 0, Number(data.nodeIdx) | 0, Number(data.x) | 0, Number(data.y) | 0); break;
        case 'addLoot': world.grantLoot(pw, Array.isArray(data.drops) ? data.drops : []); res = { ok: true, msg: 'loot' }; break;
        case 'buy': res = world.buy(pw, String(data.itemId || '')); break;
        case 'equip': res = world.equip(pw, String(data.itemId || '')); break;
        case 'unequip': res = world.unequip(pw, String(data.slot || '') as any); break;
        case 'questProgress': world.updateQuest(pw, String(data.type || ''), String(data.target || ''), Number(data.amount) || 1); res = { ok: true, msg: 'progress' }; break;
        case 'claimQuest': res = world.claimQuest(pw, String(data.questId || '')); break;
        case 'craft': res = world.craft(pw, String(data.recipeName || '')); break;
        case 'enhance': res = world.enhance(pw, String(data.itemId || '')); break;
        case 'refine': res = world.refine(pw, String(data.itemId || '')); break;
        case 'decompose': res = world.decompose(pw, String(data.itemId || '')); break;
        case 'refineReset': res = world.refineReset(pw, String(data.itemId || '')); break;
      }
      client.send('intentResult', res);
      client.send('worldSync', pw);
    });

    // 每秒把各玩家权威世界状态同步给其本人
    this.clock.setInterval(() => {
      this.state.players.forEach((_p: any, sid: string) => {
        const c = this.clients.find((x: Client) => x.sessionId === sid);
        if (c) c.send('worldSync', world.get(sid));
      });
    }, 1000);

    // 每 30 秒自动保存所有在线玩家世界到 DB
    this.clock.setInterval(() => this.saveAllOnline(), 30000);
  }

  // ─── 怪物状态机 ───

  private getMonster(id: string): MonsterState {
    let m = this.state.monsters.get(id);
    if (!m) { m = new MonsterState(); m.id = id; m.state = 'available'; this.state.monsters.set(id, m); }
    return m;
  }

  private lockMonster(client: Client, data: { id?: string }): void {
    if (!data || typeof data.id !== 'string') return;
    const id = data.id.slice(0, 64);
    if (!id) return;
    const m = this.getMonster(id);
    if (m.state === 'available') { m.state = 'busy'; m.owner = client.sessionId; m.respawnAt = 0; }
  }

  private killMonster(client: Client, data: { id?: string; respawnMs?: number }): void {
    if (!data || typeof data.id !== 'string') return;
    const id = data.id.slice(0, 64);
    if (!id) return;
    const m = this.getMonster(id);
    if (m.state === 'busy' && m.owner !== client.sessionId) return;
    m.state = 'dead';
    m.owner = '';
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

  // ─── 进房 / 离房（DB 持久化）───

  onJoin(client: Client, options: { token?: string; characterId?: number; title?: string }) {
    // Stage D：必须带 token + characterId
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

    // 从 DB 加载世界数据，导入 WorldService
    let pw: any;
    try {
      const data = JSON.parse(ch.world_data);
      if (data && typeof data === 'object' && data.level) {
        pw = world.loadFromJSON(client.sessionId, data);
      } else {
        pw = world.get(client.sessionId); // 新角色，种子
      }
    } catch {
      pw = world.get(client.sessionId); // JSON 损坏，种子新世界
    }

    sessionCharMap.set(client.sessionId, charId);

    // 建造 Colyseus 玩家对象
    const p = new GamePlayer();
    p.sessionId = client.sessionId;
    p.name = ch.name;
    p.title = String(options?.title ?? '').slice(0, 16);
    p.color = COLORS[Math.floor(Math.random() * COLORS.length)];
    p.x = 400 + Math.random() * 200;
    p.y = 300 + Math.random() * 100;
    this.state.players.set(client.sessionId, p);

    client.send('worldSync', pw);
    this.broadcast('system', `${p.name} 进入了地图`);
  }

  onLeave(client: Client) {
    // 保存世界状态到 DB
    const charId = sessionCharMap.get(client.sessionId);
    if (charId !== undefined) {
      const pw = world.get(client.sessionId);
      if (pw.level > 0) {
        try {
          saveCharacterWorld(charId, JSON.stringify(pw));
        } catch { /* 保存失败不阻断 */ }
      }
      sessionCharMap.delete(client.sessionId);
    }
    // 不清空 world——保留内存副本，下次重连时可恢复（WorldService 的 Map 仍是健在的）
    // 但 30s 定时保存已写 DB，即使进程重启也不丢。

    this.state.players.delete(client.sessionId);
    this.state.monsters.forEach((m) => {
      if (m.state === 'busy' && m.owner === client.sessionId) {
        m.state = 'available'; m.owner = ''; m.respawnAt = 0;
      }
    });
  }

  // ─── 定时保存 ───

  private saveAllOnline(): void {
    sessionCharMap.forEach((charId, sid) => {
      try {
        const pw = world.get(sid);
        if (pw.level > 0) saveCharacterWorld(charId, JSON.stringify(pw));
      } catch { /* skip */ }
    });
  }
}
