/**
 * 联机服务入口（Colyseus + Express + Node）。
 * 运行：npm run dev:server  （tsc 编译 + node 运行）
 * 监听：ws://localhost:2567 + Express REST 同端口
 *
 * 注：新版 ws(≥8.x) 强制「port / server / noServer 三选一」。
 * 0.15 的 WebSocketTransport 传 { port } 会自动建 server 又把 port 一起
 * 喂给 ws 导致冲突，故这里自建 http.Server 仅以 { server } 选项传入，
 * 端口由 gameServer.listen(PORT) 绑定到该 server。
 */
import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom';
import { BattleRoom } from './rooms/BattleRoom';
import { DungeonRoom } from './rooms/DungeonRoom';
import { PvpRoom } from './rooms/PvpRoom';
import { startArenaTicker } from './arenaService';
import authRoutes from './auth';
import guildRoutes from './guild';
import friendRoutes from './friends';

const PORT = Number(process.env.PORT) || 2567;

// Express（注册/登录/角色管理 REST API，复用 httpServer 共享端口）
const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', authRoutes);
app.use('/api/guild', guildRoutes);
app.use('/api/friend', friendRoutes);

// Colyseus（WebSocket 实时通信）
const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define('game', GameRoom);
// battle 房按 monsterId 隔离：A 撞怪1 / B 撞怪2 各自独立房；V键组队 monsterId='' 仍同房
gameServer.define('battle', BattleRoom).filterBy(['monsterId']);
// dungeon 房按 dungeonId 隔离：每副本一个独立实例，多人同场；续打复用同实例
gameServer.define('dungeon', DungeonRoom).filterBy(['dungeonId']);
// pvp 房：独立匹配房间（由 arenaService 动态创建），玩家 vs 玩家
gameServer.define('pvp', PvpRoom);
// 启动竞技场匹配撮合（每秒一次；凑不齐 60s 超时取消，绝不 AI 替代）
startArenaTicker();

gameServer.listen(PORT).then(() => {
  console.log(`[联机] Colyseus 权威游戏服已启动：ws://localhost:${PORT}`);
  console.log(`[联机] REST API：http://localhost:${PORT}/api`);
  console.log('[联机] 已注册房间：game(共享地图) / battle(权威战斗) / dungeon(副本) / pvp(竞技场)');
});
