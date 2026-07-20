/**
 * PVP 竞技场 — 匹配队列（进程内单例）
 * ───────────────────────────────────────────────────────────
 * - 两种模式：1v1（攒 2 人）、4v4（攒 8 人，随机分两队，不允许组队）。
 * - 按积分撮合相近真人；凑不齐则 60s 超时取消，绝不 AI 替代。
 * - 撮合成功后用 matchMaker 创建独立 PvpRoom，并把 arenaMatch(roomId/模式/队伍/token)
 *   直接发给各客户端（GameRoom 持有 client 引用）。
 */
import { matchMaker } from '@colyseus/core';
import type { Client } from '@colyseus/core';
import { ARENA_MATCH_TIMEOUT_MS, type ArenaMode } from './arena';

interface QueuedPlayer {
  sid: string;            // GameRoom sessionId（PvpRoom 据此查权威世界）
  client: Client;         // 用于下发 arenaMatch / arenaQueueTimeout
  mode: ArenaMode;
  points: number;         // 当前积分（撮合用）
  charId: number;
  token: string;          // 进 PvpRoom 鉴权用
  enqueuedAt: number;
}

const queues: Record<ArenaMode, QueuedPlayer[]> = { '1v1': [], '4v4': [] };
let ticking = false;

function sendTo(q: QueuedPlayer, msg: string, data: any): void {
  try { q.client.send(msg, data); } catch { /* client 可能已断，下个 tick 会清理 */ }
}

/** 入队（先去重，避免重复入队）。 */
export function enqueueArena(q: QueuedPlayer): void {
  dequeueArena(q.sid);
  queues[q.mode].push(q);
}

/** 出队（断线 / 取消 / 超时 / 已撮合）。 */
export function dequeueArena(sid: string): void {
  queues['1v1'] = queues['1v1'].filter((q) => q.sid !== sid);
  queues['4v4'] = queues['4v4'].filter((q) => q.sid !== sid);
}

/** 当前某模式排队人数（供 UI 展示）。 */
export function queueSize(mode: ArenaMode): number {
  return queues[mode].length;
}

/** 撮合 + 超时检查（由 index.ts 每秒驱动，或 GameRoom 时钟驱动）。 */
export function tickArena(): void {
  matchMode('1v1', 2);
  matchMode('4v4', 8);

  const now = Date.now();
  for (const mode of ['1v1', '4v4'] as ArenaMode[]) {
    const kept: QueuedPlayer[] = [];
    for (const q of queues[mode]) {
      if (now - q.enqueuedAt >= ARENA_MATCH_TIMEOUT_MS) {
        sendTo(q, 'arenaQueueTimeout', {});
      } else {
        kept.push(q);
      }
    }
    queues[mode] = kept;
  }
}

function matchMode(mode: ArenaMode, size: number): void {
  let q = queues[mode];
  while (q.length >= size) {
    const picks = pickClosest(q, size);
    const pickSids = new Set(picks.map((p) => p.sid));
    q = q.filter((p) => !pickSids.has(p.sid));
    formMatch(mode, picks);
  }
  queues[mode] = q;
}

/** 取 size 个积分最接近的真人（1v1 取最近一对；4v4 取连续 8 人分两队）。 */
function pickClosest(q: QueuedPlayer[], size: number): QueuedPlayer[] {
  if (size === 2) {
    let bi = 0, bj = 1, bd = Infinity;
    for (let i = 0; i < q.length; i++) {
      for (let j = i + 1; j < q.length; j++) {
        const d = Math.abs(q[i].points - q[j].points);
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
    }
    return [q[bi], q[bj]];
  }
  // 4v4：按积分排序后取连续 8 人（积分相近）
  return [...q].sort((a, b) => a.points - b.points).slice(0, size);
}

function formMatch(mode: ArenaMode, players: QueuedPlayer[]): void {
  let teams: string[];
  if (mode === '1v1') {
    teams = ['A', 'B'];
  } else {
    // 随机打乱后前 4 为 A 队、后 4 为 B 队（不允许组队，纯随机分配）
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    teams = shuffled.map((_, i) => (i < 4 ? 'A' : 'B'));
  }

  const roomPlayers = players.map((p, i) => ({ sid: p.sid, team: teams[i], charId: p.charId, token: p.token }));

  matchMaker.createRoom('pvp', { mode, players: roomPlayers })
    .then((room) => {
      players.forEach((p, i) => {
        sendTo(p, 'arenaMatch', { roomId: room.roomId, mode, team: teams[i], token: p.token });
      });
    })
    .catch((err) => {
      console.error('[arena] 创建 PvpRoom 失败：', err);
      // 创建失败：让这些玩家回到队列重试（避免静默吞掉）
      players.forEach((p) => enqueueArena(p));
    });
}

/** 启动每秒撮合（仅首次调用有效）。 */
export function startArenaTicker(): void {
  if (ticking) return;
  ticking = true;
  setInterval(() => {
    try { tickArena(); } catch (e) { console.error('[arena] tick error', e); }
  }, 1000);
}
