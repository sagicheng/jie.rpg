/**
 * 公会系统端到端烟测（真机 E2E 替代脚本）。
 *
 * 覆盖：
 *  A. REST 管理全链路：创建 → 申请 → 审批 → 设职位 → 转让 → 踢人权限 → 退出 → 解散
 *  B. 实时公会聊天（跨房间广播）：同公会在线成员收得到；非成员收不到；发送者自身也能收到
 *
 * 与真实联机完全一致：起一个真正的 Colyseus 权威服（2568 端口，独立临时库），
 * 用 colyseus.js 客户端走生产代码路径。
 *
 * 运行：npx tsx scripts/test-guild.ts
 *  - 不污染真实 data.db（服务端 cwd 指向临时目录）。
 */
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, type Room } from 'colyseus.js';

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

function log(msg: string): void { console.log(`[GUILD-E2E] ${msg}`); }
function fail(msg: string): never { console.error(`[GUILD-E2E] ✗ ${msg}`); throw new Error(msg); }

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
  // 随机空闲端口，规避遗留服务端占用 2568 导致的撞端口
  TEST_PORT = await getFreePort();
  BASE = `http://localhost:${TEST_PORT}`;
  WS = `ws://localhost:${TEST_PORT}`;
  log(`使用端口 ${TEST_PORT}`);

  log('编译服务端 (tsc -p tsconfig.server.json) …');
  execSync('npx tsc -p tsconfig.server.json', { cwd: GAME_DIR, stdio: 'inherit' });
  if (!require('node:fs').existsSync(SERVER_ENTRY)) fail('编译后未找到服务端入口 dist-server/server/index.js');

  const tmp = mkdtempSync(path.join(tmpdir(), 'jie-guild-e2e-'));
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
    const alfa = await mk('g_e2e_alfa');
    const bravo = await mk('g_e2e_bravo');
    const charlie = await mk('g_e2e_char');
    log(`账号就绪：alfa(${alfa.charId}) / bravo(${bravo.charId}) / charlie(${charlie.charId})`);

    // ── A. REST 管理链路 ──
    const create = await api('/api/guild/create', { token: alfa.token, charId: alfa.charId, name: '测试公会', notice: '欢迎' });
    assert('创建公会成功', !!create.guildId);
    const G = create.guildId as number;

    const ai0 = await api('/api/guild/info', { token: alfa.token, charId: alfa.charId });
    assert('创建者信息 inGuild', ai0.inGuild === true);
    assert('创建者职位=会长', ai0.myRank === 'leader');
    assert('初始成员数=1', ai0.guild.memberCount === 1);

    const bi0 = await api('/api/guild/info', { token: bravo.token, charId: bravo.charId });
    assert('未加入者 inGuild=false', bi0.inGuild === false);

    await api('/api/guild/apply', { token: bravo.token, charId: bravo.charId, guildId: G, message: '求收' });
    const ai1 = await api('/api/guild/info', { token: alfa.token, charId: alfa.charId });
    assert('会长可见 1 条待审', (ai1.applications || []).length === 1 && ai1.applications[0].name === 'g_e2e_bravo');

    await api('/api/guild/handle-apply', { token: alfa.token, charId: alfa.charId, applicationId: ai1.applications[0].id, accept: true });
    const ai2 = await api('/api/guild/info', { token: alfa.token, charId: alfa.charId });
    assert('审批后待审清空', (ai2.applications || []).length === 0);
    assert('审批后成员数=2', ai2.guild.memberCount === 2);
    const bi1 = await api('/api/guild/info', { token: bravo.token, charId: bravo.charId });
    assert('申请人入会 myRank=member', bi1.inGuild === true && bi1.myRank === 'member');

    // 成员主动退出（bravo 仍 member）
    await api('/api/guild/leave', { token: bravo.token, charId: bravo.charId });
    const bi1b = await api('/api/guild/info', { token: bravo.token, charId: bravo.charId });
    assert('成员退出后 inGuild=false', bi1b.inGuild === false);
    const ai2b = await api('/api/guild/info', { token: alfa.token, charId: alfa.charId });
    assert('成员退出后剩余=1', ai2b.guild.memberCount === 1);

    // bravo 重新申请并入会，继续测权限
    await api('/api/guild/apply', { token: bravo.token, charId: bravo.charId, guildId: G });
    const ai2c = await api('/api/guild/info', { token: alfa.token, charId: alfa.charId });
    await api('/api/guild/handle-apply', { token: alfa.token, charId: alfa.charId, applicationId: ai2c.applications[0].id, accept: true });

    // 会长设 bravo 为长老
    await api('/api/guild/set-rank', { token: alfa.token, charId: alfa.charId, targetCharId: bravo.charId, rank: 'elder' });
    const ai3 = await api('/api/guild/info', { token: alfa.token, charId: alfa.charId });
    const bravoMember = ai3.guild.members.find((m: any) => m.charId === bravo.charId);
    assert('设职成功 bravo=长老', bravoMember && bravoMember.rank === 'elder');

    // 长老不可踢会长（权限不足）
    const kickByElder = await apiRaw('/api/guild/kick', { token: bravo.token, charId: bravo.charId, targetCharId: alfa.charId });
    assert('长老踢会长被拒', kickByElder.ok === false);

    // 会长转让给 bravo
    await api('/api/guild/transfer', { token: alfa.token, charId: alfa.charId, targetCharId: bravo.charId });
    const bi2 = await api('/api/guild/info', { token: bravo.token, charId: bravo.charId });
    const ai4 = await api('/api/guild/info', { token: alfa.token, charId: alfa.charId });
    assert('转让后 bravo=会长', bi2.myRank === 'leader');
    assert('转让后 alfa=成员', ai4.myRank === 'member');

    // 会长(bravo) 踢成员(alfa)
    await api('/api/guild/kick', { token: bravo.token, charId: bravo.charId, targetCharId: alfa.charId });
    const bi3 = await api('/api/guild/info', { token: bravo.token, charId: bravo.charId });
    assert('踢人后成员数=1', bi3.guild.memberCount === 1);

    // bravo 解散
    await api('/api/guild/disband', { token: bravo.token, charId: bravo.charId });
    const bi4 = await api('/api/guild/info', { token: bravo.token, charId: bravo.charId });
    assert('解散后 inGuild=false', bi4.inGuild === false);

    // ── B. 实时公会聊天（跨房间）──
    // 重新建一个公会：bravo 会长，alfa 成员
    const g2 = await api('/api/guild/create', { token: bravo.token, charId: bravo.charId, name: '聊天会' });
    const G2 = g2.guildId as number;
    await api('/api/guild/apply', { token: alfa.token, charId: alfa.charId, guildId: G2 });
    const binfo = await api('/api/guild/info', { token: bravo.token, charId: bravo.charId });
    await api('/api/guild/handle-apply', { token: bravo.token, charId: bravo.charId, applicationId: binfo.applications[0].id, accept: true });

    // 三客户端进 game 房
    const ca = new Client(WS), cb = new Client(WS), cc = new Client(WS);
    const ga = await ca.joinOrCreate('game', { token: alfa.token, characterId: alfa.charId });
    const gb = await cb.joinOrCreate('game', { token: bravo.token, characterId: bravo.charId });
    const gc = await cc.joinOrCreate('game', { token: charlie.token, characterId: charlie.charId });
    ga.onMessage('worldSync', () => {}); gb.onMessage('worldSync', () => {}); gc.onMessage('worldSync', () => {});
    // 等待服务端 onJoin 完成公会注册
    await new Promise((r) => setTimeout(r, 400));
    log('三客户端已进 game 房（alfa/bravo 同公会，charlie 非成员）');

    // charlie 不应收到公会聊天
    let charlieGot = false;
    gc.onMessage('chat', (m: any) => { if (m.channel === 'guild') charlieGot = true; });

    // alfa 收 bravo 的聊天（统一 chat 通道，channel='guild'）
    const alfaGot: any = await new Promise<any>((resolve) => {
      const timer = setTimeout(() => resolve(null), 8000);
      ga.onMessage('chat', (m: any) => { if (m.channel === 'guild') { clearTimeout(timer); resolve(m); } });
      gb.send('chat', { channel: 'guild', text: '公会大家好' });
    });
    assert('同公会 alfa 收到聊天', !!alfaGot && alfaGot.text === '公会大家好' && alfaGot.fromName === 'g_e2e_bravo');
    assert('非成员 charlie 未收到', charlieGot === false);

    // 发送者自身也收到（回显）：用 alfa 客户端发+收，避免与上方 bravo 同客户端时序竞态
    const alfaEcho: any = await new Promise<any>((resolve) => {
      const timer = setTimeout(() => resolve(null), 8000);
      ga.onMessage('chat', (m: any) => { if (m.channel === 'guild') { clearTimeout(timer); resolve(m); } });
      ga.send('chat', { channel: 'guild', text: '我是成员' });
    });
    assert('发送者自身回显收到', !!alfaEcho && alfaEcho.text === '我是成员' && alfaEcho.fromCharId === alfa.charId);

    ga.leave(); gb.leave(); gc.leave();

    // 汇总
    console.log('\n— 校验 —');
    checks.forEach((c) => console.log(`  ${c}`));
    const total = checks.length;
    const okCount = checks.filter((c) => c.startsWith('✓')).length;
    if (okCount !== total) fail(`公会端到端校验未全部通过 (${okCount}/${total})`);
    log(`✅ 公会端到端烟测全部通过 (${okCount}/${total})`);
  } finally {
    clearTimeout(overall);
    cleanup();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
