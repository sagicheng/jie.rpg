/**
 * PVP 竞技场端到端烟测（真机 E2E 替代脚本）。
 *
 * 覆盖全链路：注册/建角色 → 进 game 房 → arenaQueue(1v1) → 收 arenaMatch
 * → 进 pvp 房 → 自动普攻打到结算 → 校验 arenaResult（胜 +25 / 负 -25）。
 *
 * 与真实联机完全一致：起一个真正的 Colyseus 权威服（2568 端口，独立临时库），
 * 用两个 colyseus.js 客户端走生产代码路径，服务端权威结算。
 *
 * 运行：npx tsx scripts/test-arena-e2e.ts
 *
 * 说明：
 *  - 不污染真实 data.db（服务端 cwd 指向临时目录）。
 *  - 依赖 ARENA_DEV_OPEN=1 开发期开关，使竞技场无视「仅周五」时段，任意时间可测。
 *    生产不设置该变量，行为不变。
 */
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, type Room } from 'colyseus.js';

const GAME_DIR = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.resolve(GAME_DIR, 'dist-server/server/index.js');
const TEST_PORT = 2568;
const BASE = `http://localhost:${TEST_PORT}`;
const WS = `ws://localhost:${TEST_PORT}`;
const GRACE_MS = 120_000; // 整场超时

// ——— 工具 ———
function log(msg: string): void { console.log(`[E2E] ${msg}`); }
function fail(msg: string): never { console.error(`[E2E] ✗ ${msg}`); throw new Error(msg); }

/** 等待房间某条消息（带超时）。 */
function waitMsg<T = any>(room: Room, name: string, ms = 15_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待消息 ${name} 超时(${ms}ms)`)), ms);
    const handler = (m: T) => { clearTimeout(timer); resolve(m); };
    room.onMessage(name, handler);
  });
}

/** 等服务端启动日志。 */
function waitServerReady(proc: any, ms = 30_000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('服务端启动超时')), ms);
    let buf = '';
    const onData = (d: Buffer) => {
      buf += d.toString();
      process.stdout.write(d);
      if (buf.includes('已启动')) { clearTimeout(timer); resolve(); }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', (d: Buffer) => process.stderr.write(d));
    proc.on('exit', (code: number) => { if (code !== 0 && !buf.includes('已启动')) reject(new Error(`服务端异常退出 code=${code}`)); });
  });
}

async function api(post: string, body: any): Promise<any> {
  const res = await fetch(`${BASE}${post}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json() as any;
  if (!json.ok) throw new Error(`${post} 失败: ${json.msg || JSON.stringify(json)}`);
  return json;
}

interface Fighter {
  client: Client;
  gameRoom: Room;
  pvpRoom: Room;
  token: string;
  charId: number;
  team: string;
  result?: { won: boolean; pointsDelta: number; points: number; tier: string; promoted: boolean };
}

async function main(): Promise<void> {
  // 1) 编译服务端（与 npm run dev:server 同路径，确保最新）
  log('编译服务端 (tsc -p tsconfig.server.json) …');
  execSync('npx tsc -p tsconfig.server.json', { cwd: GAME_DIR, stdio: 'inherit' });
  if (!existsSync(SERVER_ENTRY)) fail('编译后未找到服务端入口 dist-server/server/index.js');

  // 2) 临时目录起服（独立 data.db，不污染真实库）
  const tmp = mkdtempSync(path.join(tmpdir(), 'jie-arena-e2e-'));
  log(`临时库目录：${tmp}`);
  const serverProc = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: tmp,
    env: { ...process.env, PORT: String(TEST_PORT), ARENA_DEV_OPEN: '1' },
  });

  let cleanup = () => {
    try { serverProc.kill('SIGKILL'); } catch {}
    // sqlite WAL 文件可能在进程退出瞬间仍被锁，重试几次避免残留临时库
    for (let i = 0; i < 5; i++) {
      try { rmSync(tmp, { recursive: true, force: true }); break; } catch { try { rmSync(tmp, { recursive: true, force: true }); } catch {} }
    }
  };
  const overall = setTimeout(() => { cleanup(); fail('整场烟测超时'); }, GRACE_MS);

  try {
    await waitServerReady(serverProc);

    // 3) 注册两账号 + 建角色
    const mk = async (user: string) => {
      const reg = await api('/api/register', { username: user, password: 'test1234', security: 'sec1234' });
      const token = reg.token as string;
      const ch = await api('/api/character/create', { token, name: user, element: 'fire' });
      return { token, charId: ch.character.id as number };
    };
    const a = await mk('e2e_alfa');
    const b = await mk('e2e_bravo');
    log(`账号就绪：alfa(charId=${a.charId}) / bravo(charId=${b.charId})`);

    // 4) 进 game 房
    const mkClient = () => new Client(WS);
    const ca = mkClient(); const cb = mkClient();
    const gameA = await ca.joinOrCreate('game', { token: a.token, characterId: a.charId });
    const gameB = await cb.joinOrCreate('game', { token: b.token, characterId: b.charId });
    // 压制游戏房 worldSync 噪声（本烟测只关注 PVP 链路）
    gameA.onMessage('worldSync', () => {});
    gameB.onMessage('worldSync', () => {});
    log('两客户端已进入 game 房');

    // 5) arenaQueue(1v1)
    gameA.send('intent', { op: 'arenaQueue', token: a.token, mode: '1v1' });
    gameB.send('intent', { op: 'arenaQueue', token: b.token, mode: '1v1' });

    // 6) 收 arenaMatch（两客户端各自）
    const [ma, mb] = await Promise.all([
      waitMsg<any>(gameA, 'arenaMatch', 15_000),
      waitMsg<any>(gameB, 'arenaMatch', 15_000),
    ]);
    if (!ma.roomId || !mb.roomId) fail('未收到 arenaMatch(roomId)');
    if (ma.mode !== '1v1') fail(`arenaMatch.mode 期望 1v1，实际 ${ma.mode}`);
    log(`撮合成功 → pvp roomId=${ma.roomId}, A队=${ma.team} / B队=${mb.team}`);

    // 7) 进 pvp 房（用 game 房会话 id 作为 sid 透传）
    const fa: Fighter = { client: ca, gameRoom: gameA, pvpRoom: null as any, token: a.token, charId: a.charId, team: ma.team };
    const fb: Fighter = { client: cb, gameRoom: gameB, pvpRoom: null as any, token: b.token, charId: b.charId, team: mb.team };
    fa.pvpRoom = await ca.joinById(ma.roomId, { sid: gameA.sessionId, token: a.token, charId: a.charId, team: ma.team, name: 'e2e_alfa' });
    fb.pvpRoom = await cb.joinById(mb.roomId, { sid: gameB.sessionId, token: b.token, charId: b.charId, team: mb.team, name: 'e2e_bravo' });
    log('两客户端已进入 pvp 房，等待战斗开始…');

    // 8) 驱动战斗：每个 command 阶段自动普攻敌方
    const sentRound = new WeakMap<Room, number>();
    const drive = (f: Fighter) => {
      f.pvpRoom.onStateChange(() => {
        const s: any = f.pvpRoom.state;
        if (s.phase !== 'combat' || s.roundPhase !== 'command') return;
        if (sentRound.get(f.pvpRoom) === s.round) return;
        sentRound.set(f.pvpRoom, s.round);
        let enemy: string | undefined;
        s.players.forEach((p: any, sid: string) => { if (p.team !== f.team && p.alive && !enemy) enemy = sid; });
        if (enemy) f.pvpRoom.send('action', { type: 'attack', targetId: enemy });
      });
      f.pvpRoom.onMessage('arenaResult', (r: any) => { f.result = r; log(`收到 arenaResult: ${JSON.stringify(r)}`); });
    };
    drive(fa); drive(fb);

    // 9) 等双方 arenaResult
    const results = await Promise.all([
      new Promise<any>((res) => { const t = setInterval(() => { if (fa.result) { clearInterval(t); res(fa.result); } }, 200); }),
      new Promise<any>((res) => { const t = setInterval(() => { if (fb.result) { clearInterval(t); res(fb.result); } }, 200); }),
    ]);
    const [ra, rb] = results;

    // 10) 断言
    let okCount = 0; const checks: string[] = [];
    const assert = (name: string, cond: boolean) => { checks.push(`${cond ? '✓' : '✗'} ${name}`); if (cond) okCount++; };

    assert('双方均收到 arenaResult', !!ra && !!rb);
    const winners = [ra, rb].filter((r) => r.won).length;
    assert('恰有一方获胜', winners === 1);
    assert('胜方 +25', [ra, rb].some((r) => r.won && r.pointsDelta === 25));
    assert('负方 -25', [ra, rb].some((r) => !r.won && r.pointsDelta === -25));
    assert('胜方积分 1025', [ra, rb].some((r) => r.won && r.points === 1025));
    assert('负方积分 975', [ra, rb].some((r) => !r.won && r.points === 975));
    const tiers = [ra.tier, rb.tier];
    assert('段位合法(bronze/silver)', tiers.every((t) => ['bronze', 'silver'].includes(t)));

    console.log('\n— 校验 —');
    checks.forEach((c) => console.log(`  ${c}`));
    const total = checks.length;
    if (okCount !== total) fail(`端到端校验未全部通过 (${okCount}/${total})`);
    log(`✅ PVP 端到端烟测全部通过 (${okCount}/${total})`);
  } finally {
    clearTimeout(overall);
    cleanup();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
