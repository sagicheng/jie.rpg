/**
 * 共享地图房间：玩家移动同步 + 聊天。
 * 证明多客户端状态同步（Colyseus 自动 diff 广播）。
 */
import { Room, Client } from '@colyseus/core';
import { GameRoomState, GamePlayer, ChatMessage } from '../schema';

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
  }

  onJoin(client: Client, options: { name?: string }) {
    const p = new GamePlayer();
    p.sessionId = client.sessionId;
    p.name = (options?.name ?? '勇者').slice(0, 16);
    p.color = COLORS[Math.floor(Math.random() * COLORS.length)];
    p.x = 400 + Math.random() * 200;
    p.y = 300 + Math.random() * 100;
    this.state.players.set(client.sessionId, p);
    this.broadcast('system', `${p.name} 进入了地图`);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
  }
}
