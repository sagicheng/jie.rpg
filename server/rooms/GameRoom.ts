/**
 * 共享地图房间：玩家移动同步 + 聊天。
 * 证明多客户端状态同步（Colyseus 自动 diff 广播）。
 */
import { Room, Client } from '@colyseus/core';
import { GameRoomState, GamePlayer, ChatMessage, MonsterState } from '../schema';

const COLORS = ['#ff6b6b', '#4ecdc4', '#ffd93d', '#a78bfa', '#ff9f43', '#54a0ff'];

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

    // 战斗中状态：进入/退出战斗时由客户端上报，用于远端名牌显示「战斗中」标签（便于组队系统识别谁在忙）
    this.onMessage('setBattling', (client, data: { v?: boolean }) => {
      const p = this.state.players.get(client.sessionId);
      if (p) p.battling = !!data.v;
    });

    // —— 共享怪物状态机（锁定 / 击杀 / 复原 / 刷新）——
    this.onMessage('enterBattle', (client, data: { id?: string }) => this.lockMonster(client, data));
    this.onMessage('killMonster', (client, data: { id?: string; respawnMs?: number }) => this.killMonster(client, data));
    this.onMessage('unlockMonster', (client, data: { id?: string }) => this.unlockMonster(client, data));

    // 每秒检查死亡怪物的刷新时间（从战斗结束计时）
    this.clock.setInterval(() => this.tickRespawn(), 1000);
  }

  /** 取/建怪物状态（懒创建，仅在被锁/被杀时出现于 map）。 */
  private getMonster(id: string): MonsterState {
    let m = this.state.monsters.get(id);
    if (!m) { m = new MonsterState(); m.id = id; m.state = 'available'; this.state.monsters.set(id, m); }
    return m;
  }

  /** 进入战斗：把怪锁定为 busy（对其余玩家消失）。已被锁/已死则忽略（防抢怪）。 */
  private lockMonster(client: Client, data: { id?: string }): void {
    if (!data || typeof data.id !== 'string') return;
    const id = data.id.slice(0, 64);
    if (!id) return;
    const m = this.getMonster(id);
    if (m.state === 'available') { m.state = 'busy'; m.owner = client.sessionId; m.respawnAt = 0; }
  }

  /** 击杀：标记 dead 并按客户端上报的刷新时长计时（从战斗结束起）。他人战斗中不可误杀。 */
  private killMonster(client: Client, data: { id?: string; respawnMs?: number }): void {
    if (!data || typeof data.id !== 'string') return;
    const id = data.id.slice(0, 64);
    if (!id) return;
    const m = this.getMonster(id);
    if (m.state === 'busy' && m.owner !== client.sessionId) return; // 别人正打着，不误杀
    m.state = 'dead';
    m.owner = '';
    m.respawnAt = Date.now() + (Number(data.respawnMs) || 30000);
  }

  /** 失败复原：仅释放自己锁定的怪（立即 available），防误复活他人已杀的怪。 */
  private unlockMonster(client: Client, data: { id?: string }): void {
    if (!data || typeof data.id !== 'string') return;
    const id = data.id.slice(0, 64);
    if (!id) return;
    const m = this.state.monsters.get(id);
    if (m && m.state === 'busy' && m.owner === client.sessionId) {
      m.state = 'available'; m.owner = ''; m.respawnAt = 0;
    }
  }

  /** 死亡怪物到点刷新为 available（按 respawnAt）。 */
  private tickRespawn(): void {
    const now = Date.now();
    this.state.monsters.forEach((m) => {
      if (m.state === 'dead' && m.respawnAt > 0 && now >= m.respawnAt) {
        m.state = 'available'; m.respawnAt = 0;
      }
    });
  }

  onJoin(client: Client, options: { name?: string; title?: string }) {
    const p = new GamePlayer();
    p.sessionId = client.sessionId;
    // 基础名（客户端未传则给中性默认）；同房间重名自动追加 #2/#3，保证联机中每个名字唯一可区分。
    const base = String(options?.name ?? '玩家').slice(0, 14) || '玩家';
    let name = base;
    let n = 2;
    const taken = new Set(Array.from(this.state.players.values()).map((q: any) => q.name));
    while (taken.has(name)) { name = `${base}#${n++}`; }
    p.name = name.slice(0, 16);
    p.title = String(options?.title ?? '').slice(0, 16);
    p.color = COLORS[Math.floor(Math.random() * COLORS.length)];
    p.x = 400 + Math.random() * 200;
    p.y = 300 + Math.random() * 100;
    this.state.players.set(client.sessionId, p);
    this.broadcast('system', `${p.name} 进入了地图`);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    // 断线释放自己锁定的怪（防卡死）：失败离开=怪物立即复原
    this.state.monsters.forEach((m) => {
      if (m.state === 'busy' && m.owner === client.sessionId) {
        m.state = 'available'; m.owner = ''; m.respawnAt = 0;
      }
    });
  }
}
