/**
 * 联机服务入口（Colyseus + Node）。
 * 运行：npm run dev:server  （tsc 编译 + node 运行）
 * 监听：ws://localhost:2567
 *
 * 注：新版 ws(≥8.x) 强制「port / server / noServer 三选一」。
 * 0.15 的 WebSocketTransport 传 { port } 会自动建 server 又把 port 一起
 * 喂给 ws 导致冲突，故这里自建 http.Server 仅以 { server } 选项传入，
 * 端口由 gameServer.listen(PORT) 绑定到该 server。
 */
import http from 'http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom';
import { BattleRoom } from './rooms/BattleRoom';

const PORT = Number(process.env.PORT) || 2567;

const httpServer = http.createServer();
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define('game', GameRoom);
gameServer.define('battle', BattleRoom);

gameServer.listen(PORT).then(() => {
  console.log(`[联机] Colyseus 权威游戏服已启动：ws://localhost:${PORT}`);
  console.log('[联机] 已注册房间：game(共享地图) / battle(权威战斗·组队打怪)');
});
