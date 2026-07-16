/**
 * 好友系统端到端烟测（真机 E2E 替代脚本）。
 *
 * 覆盖：
 *  A. REST 全链路：按角色名申请 → 对方申请列表 → 接受 → 双向互为好友 → 列表含在线态 → 移除
 *  B. 实时 friendNotify（跨房间定向推送，客户端无法伪造）：
 *     - 申请实时推送（target 在线即收 'request'）
 *     - 接受实时推送（申请人在线收 'accepted'）
 *     - 上下线提醒（好友进/离 game 房收 'online'/'offline'）
 *
 * 与真实联机完全一致：起一个真正的 Colyseus 权威服（随机空闲端口，独立临时库），
 * 用 colyseus.js 客户端走生产代码路径。
 *
 * 运行：npx tsx scripts/test-friend.ts
 *  - 不污染真实 data.db（服务端 cwd 指向临时目录）。
 */
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from 'colyseus.js';

const GAME_DIR = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.resolve(GAME_DIR, 'dist-server/server/index.js');
let TEST_PORT = 2568;
let BASE = `http://localhost:${TEST_PORT}`;
let WS = `ws://localhost:${TEST_PORT}`;
const GRACE_MS = 120_000;

/** 取一个当前空闲端口，避免与遗留服务端撞端口。 */
function getFreePort(): Promise<number> {
  const net = require('node:net');
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, () => {
      const p = (srv.address() as any).port;
      srv.close(() => resolve(p));
    });
  });
}

function log(msg: string): void { console.log(`[FRIEND-E2E] ${msg}`); }
function fail(msg: string): never { console.error(`[FRIEND-E2E] ✗ ${msg}`); throw new Error(msg); }
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

async function apiRaw(post: string, body: any): Promise<any> {
  const res = await fetch(`${BASE}${post}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json() as any;
}
async function api(post: string, body: any): Promise<any> {
  const j = await apiRaw(post, body);
  if (!j.ok) throw new Error(`${post} 失败: ${j.msg || JSON.stringify(j)}`);
  return j;
}

async function main(): Promise<void> {
  TEST_PORT = await getFreePort();
  BASE = `http://localhost:${TEST_PORT}`;
  WS = `ws://localhost:${TEST_PORT}`;
  log(`使用端口 ${TEST_PORT}`);

  log('编译服务端 (tsc -p tsconfig.server.json) …');
  execSync('npx tsc -p tsconfig.server.json', { cwd: GAME_DIR, stdio: 'inherit' });
  if (!require('node:fs').existsSync(SERVER_ENTRY)) fail('编译后未找到服务端入口 dist-server/server/index.js');

  const tmp = mkdtempSync(path.join(tmpdir(), 'jie-friend-e2e-'));
  log(`临时库目录：${tmp}`);
  const serverProc = spawn(process.execPath, [SERVER_ENTRY], { cwd: tmp, env: { ...process.env, PORT: String(TEST_PORT) } });

  let cleanup = () => {
    try { serverProc.kill('SIGKILL'); } catch {}
    for (let i = 0; i < 5; i++) { try { rmSync(tmp, { recursive: true, force: true }); break; } catch { try { rmSync(tmp, { recursive: true, force: true }); } catch {} } }
  };
  const overall = setTimeout(() => { cleanup(); fail('整场烟测超时'); }, GRACE_MS);

  const checks: string[] = [];
  const assert = (name: string, cond: boolean) => { checks.push(`${cond ? '✓' : '✗'} ${name}`); };

  try {
    await waitServerReady(serverProc);

    // 注册三账号 + 建角色
    const mk = async (user: string) => {
      const reg = await api('/api/register', { username: user, password: 'test1234', security: 'sec1234' });
      const ch = await api('/api/character/create', { token: reg.token, name: user, element: 'fire' });
      return { token: reg.token as string, charId: ch.character.id as number };
    };
    const alfa = await mk('f_e2e_alfa');
    const bravo = await mk('f_e2e_bravo');
    const charlie = await mk('f_e2e_char');
    log(`账号就绪：alfa(${alfa.charId}) / bravo(${bravo.charId}) / charlie(${charlie.charId})`);

    // ── A. REST 全链路 ──
    const add = await api('/api/friend/add', { token: alfa.token, charId: alfa.charId, targetName: 'f_e2e_bravo' });
    assert('按角色名申请成功', add.ok === true && add.targetName === 'f_e2e_bravo' && add.targetId === bravo.charId);

    const reqs = await api('/api/friend/requests', { token: bravo.token, charId: bravo.charId });
    assert('对方收到 1 条申请', Array.isArray(reqs.requests) && reqs.requests.length === 1 && reqs.requests[0].name === 'f_e2e_alfa' && reqs.requests[0].charId === alfa.charId);

    // 不能加自己 / 加不存在角色 / 重复申请
    const selfAdd = await apiRaw('/api/friend/add', { token: alfa.token, charId: alfa.charId, targetName: 'f_e2e_alfa' });
    assert('不能添加自己', selfAdd.ok === false);
    const noName = await apiRaw('/api/friend/add', { token: alfa.token, charId: alfa.charId, targetName: '不存在的人_xyz' });
    assert('不存在角色被拒', noName.ok === false);

    await api('/api/friend/accept', { token: bravo.token, charId: bravo.charId, requesterId: alfa.charId });

    const alfaList = await api('/api/friend/list', { token: alfa.token, charId: alfa.charId });
    const bf = alfaList.friends.find((f: any) => f.charId === bravo.charId);
    assert('alfa 列表含 bravo（双向）', !!bf && bf.name === 'f_e2e_bravo' && bf.online === false);

    const bravoList = await api('/api/friend/list', { token: bravo.token, charId: bravo.charId });
    const af = bravoList.friends.find((f: any) => f.charId === alfa.charId);
    assert('bravo 列表含 alfa（双向）', !!af && af.name === 'f_e2e_alfa');

    // ── B. 实时 friendNotify ──
    // alfa 先进 game 房（在线），bravo/charlie 尚未进
    const ca = new Client(WS);
    const ga = await ca.joinOrCreate('game', { token: alfa.token, characterId: alfa.charId });
    ga.onMessage('worldSync', () => {});
    const alfaNotifs: any[] = [];
    ga.onMessage('friendNotify', (m: any) => alfaNotifs.push(m));
    await wait(400);
    log('alfa 已进 game 房（在线）');

    // charlie 申请加 alfa（charlie 未进 game，但 alfa 在线）→ alfa 收 'request'
    await api('/api/friend/add', { token: charlie.token, charId: charlie.charId, targetName: 'f_e2e_alfa' });
    await wait(200);
    assert('实时：alfa 收到 charlie 的好友申请(request)', alfaNotifs.some((m) => m.type === 'request' && m.fromCharId === charlie.charId && m.fromName === 'f_e2e_char'));

    // bravo 进 game 房（与 alfa 已是好友）→ alfa 收 'online'
    const cb = new Client(WS);
    const gb = await cb.joinOrCreate('game', { token: bravo.token, characterId: bravo.charId });
    gb.onMessage('worldSync', () => {});
    const bravoNotifs: any[] = [];
    gb.onMessage('friendNotify', (m: any) => bravoNotifs.push(m));
    await wait(400);
    log('bravo 已进 game 房（与 alfa 互友）');
    assert('实时：alfa 收到 bravo 上线(oneline)通知', alfaNotifs.some((m) => m.type === 'online' && m.charId === bravo.charId && m.name === 'f_e2e_bravo'));

    // charlie 进 game 房（已申请 alfa，待审，尚未互友）→ 暂无 online 给 alfa
    const cc = new Client(WS);
    const gc = await cc.joinOrCreate('game', { token: charlie.token, characterId: charlie.charId });
    gc.onMessage('worldSync', () => {});
    const charlieNotifs: any[] = [];
    gc.onMessage('friendNotify', (m: any) => charlieNotifs.push(m));
    await wait(400);
    log('charlie 已进 game 房（向 alfa 待审）');

    // alfa 接受 charlie（charlie 在线）→ charlie 收 'accepted'
    await api('/api/friend/accept', { token: alfa.token, charId: alfa.charId, requesterId: charlie.charId });
    await wait(200);
    assert('实时：charlie 收到 alfa 接受(accepted)通知', charlieNotifs.some((m) => m.type === 'accepted' && m.charId === alfa.charId && m.name === 'f_e2e_alfa'));

    // 验证列表中在线态（bravo、charlie 均已进 game）
    const alfaList2 = await api('/api/friend/list', { token: alfa.token, charId: alfa.charId });
    const bf2 = alfaList2.friends.find((f: any) => f.charId === bravo.charId);
    const cf2 = alfaList2.friends.find((f: any) => f.charId === charlie.charId);
    assert('列表中 bravo 在线且带地图名', !!bf2 && bf2.online === true && typeof bf2.location === 'string' && bf2.location.length > 0);
    assert('列表中 charlie 在线', !!cf2 && cf2.online === true);

    // 下线通知：bravo 离开 → alfa 收 'offline'
    gb.leave();
    await wait(350);
    assert('实时：alfa 收到 bravo 下线(offline)通知', alfaNotifs.some((m) => m.type === 'offline' && m.charId === bravo.charId));
    // charlie 离开 → alfa 收 'offline'
    gc.leave();
    await wait(350);
    assert('实时：alfa 收到 charlie 下线(offline)通知', alfaNotifs.some((m) => m.type === 'offline' && m.charId === charlie.charId));
    ga.leave();

    // ── C. 移除好友（REST 闭环）──
    await api('/api/friend/remove', { token: alfa.token, charId: alfa.charId, friendId: bravo.charId });
    const alfaList3 = await api('/api/friend/list', { token: alfa.token, charId: alfa.charId });
    assert('移除后 alfa 列表不再含 bravo（单向移除生效）', !alfaList3.friends.some((f: any) => f.charId === bravo.charId));
    const bravoList2 = await api('/api/friend/list', { token: bravo.token, charId: bravo.charId });
    assert('移除后 bravo 好友列表清空（双向删除）', bravoList2.friends.length === 0);

    // 汇总
    console.log('\n— 校验 —');
    checks.forEach((c) => console.log(`  ${c}`));
    const total = checks.length;
    const okCount = checks.filter((c) => c.startsWith('✓')).length;
    if (okCount !== total) fail(`好友端到端校验未全部通过 (${okCount}/${total})`);
    log(`✅ 好友端到端烟测全部通过 (${okCount}/${total})`);
  } finally {
    clearTimeout(overall);
    cleanup();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
