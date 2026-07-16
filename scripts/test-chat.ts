/**
 * 统一聊天系统端到端烟测（真机 E2E）。
 *
 * 覆盖频道：
 *  A. world  —— 房间内广播（同房间收到）
 *  B. team   —— 组队频道（仅队友收到，跨房间由 onlineClients 投递）
 *  C. whisper—— 私聊（仅目标收 + 发送者回显）
 *  D. event  —— 服务端专属全服广播（仅 devChat 触发；客户端伪 event 被拒）
 *
 * 与真实联机一致：起独立临时库权威服（随机空闲端口 + CHAT_DEV=1），多 colyseus.js 客户端走生产代码路径。
 * 运行：npx tsx scripts/test-chat.ts  （不污染真实 data.db）
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from 'colyseus.js';

const GAME_DIR = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.resolve(GAME_DIR, 'dist-server/server/index.js');
let TEST_PORT = 2568;
let WS = `ws://localhost:${TEST_PORT}`;
const GRACE_MS = 120_000;

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

function log(msg: string): void { console.log(`[CHAT-E2E] ${msg}`); }
function fail(msg: string): never { console.error(`[CHAT-E2E] ✗ ${msg}`); throw new Error(msg); }

async function main(): Promise<void> {
  TEST_PORT = await getFreePort();
  WS = `ws://localhost:${TEST_PORT}`;
  log(`使用端口 ${TEST_PORT}`);

  log('编译服务端 (tsc -p tsconfig.server.json) …');
  require('child_process').execSync('npx tsc -p tsconfig.server.json', { cwd: GAME_DIR, stdio: 'inherit' });
  if (!require('node:fs').existsSync(SERVER_ENTRY)) fail('编译后未找到服务端入口 dist-server/server/index.js');

  const tmp = mkdtempSync(path.join(tmpdir(), 'jie-chat-e2e-'));
  log(`临时库目录：${tmp}`);
  // CHAT_DEV=1 允许 devChat 触发服务端专属频道（活动）
  const serverProc = spawn(process.execPath, [SERVER_ENTRY], { cwd: tmp, env: { ...process.env, PORT: String(TEST_PORT), CHAT_DEV: '1' } });

  let cleanup = () => {
    try { serverProc.kill('SIGKILL'); } catch {}
    for (let i = 0; i < 5; i++) { try { rmSync(tmp, { recursive: true, force: true }); break; } catch { try { rmSync(tmp, { recursive: true, force: true }); } catch {} } }
  };
  const overall = setTimeout(() => { cleanup(); fail('整场烟测超时'); }, GRACE_MS);

  const checks: string[] = [];
  const assert = (name: string, cond: boolean) => { checks.push(`${cond ? '✓' : '✗'} ${name}`); };

  try {
    // 等服务端启动日志
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('服务端启动超时')), 30000);
      let buf = '';
      const onData = (d: Buffer) => {
        buf += d.toString(); process.stdout.write(d);
        if (buf.includes('已启动')) { clearTimeout(timer); resolve(); }
      };
      serverProc.stdout.on('data', onData);
      serverProc.stderr.on('data', (d: Buffer) => process.stderr.write(d));
      serverProc.on('exit', (code: number) => { if (code !== 0 && !buf.includes('已启动')) reject(new Error(`服务端异常退出 code=${code}`)); });
    });

    const mk = async (user: string) => {
      const reg: any = await (await fetch(`http://localhost:${TEST_PORT}/api/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: 'test1234', security: 'sec1234' }),
      })).json();
      const ch: any = await (await fetch(`http://localhost:${TEST_PORT}/api/character/create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: reg.token, name: user, element: 'fire' }),
      })).json();
      return { token: reg.token as string, charId: ch.character.id as number };
    };
    const alfa = await mk('c_e2e_alfa');
    const bravo = await mk('c_e2e_bravo');
    const charlie = await mk('c_e2e_char');

    // 三客户端进同一 game 房
    const ca = new Client(WS), cb = new Client(WS), cc = new Client(WS);
    const ga = await ca.joinOrCreate('game', { token: alfa.token, characterId: alfa.charId });
    const gb = await cb.joinOrCreate('game', { token: bravo.token, characterId: bravo.charId });
    const gc = await cc.joinOrCreate('game', { token: charlie.token, characterId: charlie.charId });
    ga.onMessage('worldSync', () => {}); gb.onMessage('worldSync', () => {}); gc.onMessage('worldSync', () => {});
    await new Promise((r) => setTimeout(r, 400));
    log('三客户端已进 game 房');

    // ── A. world（房间内广播）──
    let bravoWorld: any = null;
    gb.onMessage('chat', (m: any) => { if (m.channel === 'world') bravoWorld = m; });
    ga.send('chat', { channel: 'world', text: '世界你好' });
    await new Promise((r) => setTimeout(r, 600));
    assert('world：同房间 bravo 收到', !!bravoWorld && bravoWorld.text === '世界你好');

    // ── B. team（组队频道）──
    // alfa 邀请 bravo
    let teamId = '';
    gb.onMessage('inviteReceived', (m: any) => { teamId = m.teamId; });
    ga.send('invite', { targetSid: gb.sessionId });
    await new Promise((r) => setTimeout(r, 300));
    gb.send('respondInvite', { teamId, accept: true });
    await new Promise((r) => setTimeout(r, 400));

    let bravoTeam: any = null, charlieTeam = false;
    gb.onMessage('chat', (m: any) => { if (m.channel === 'team') bravoTeam = m; });
    gc.onMessage('chat', (m: any) => { if (m.channel === 'team') charlieTeam = true; });
    ga.send('chat', { channel: 'team', text: '队友集合' });
    await new Promise((r) => setTimeout(r, 600));
    assert('team：队友 bravo 收到', !!bravoTeam && bravoTeam.text === '队友集合');
    assert('team：非队友 charlie 未收到', charlieTeam === false);

    // ── C. whisper（私聊）──
    let bravoWhisper: any = null, charlieWhisper = false, alfaEchoW: any = null;
    gb.onMessage('chat', (m: any) => { if (m.channel === 'whisper') bravoWhisper = m; });
    gc.onMessage('chat', (m: any) => { if (m.channel === 'whisper') charlieWhisper = true; });
    ga.onMessage('chat', (m: any) => { if (m.channel === 'whisper') alfaEchoW = m; });
    ga.send('chat', { channel: 'whisper', targetCharId: bravo.charId, text: '私聊内容' });
    await new Promise((r) => setTimeout(r, 600));
    assert('whisper：目标 bravo 收到', !!bravoWhisper && bravoWhisper.text === '私聊内容' && bravoWhisper.targetCharId === bravo.charId);
    assert('whisper：发送者 alfa 回显', !!alfaEchoW && alfaEchoW.text === '私聊内容');
    assert('whisper：非目标 charlie 未收到', charlieWhisper === false);

    // ── D. event（服务端专属全服广播，仅 devChat 触发）──
    let alfaEvent: any = null, bravoEvent: any = null, charlieEvent: any = null;
    ga.onMessage('chat', (m: any) => { if (m.channel === 'event') alfaEvent = m; });
    gb.onMessage('chat', (m: any) => { if (m.channel === 'event') bravoEvent = m; });
    gc.onMessage('chat', (m: any) => { if (m.channel === 'event') charlieEvent = m; });
    ga.send('devChat', { channel: 'event', text: '全服活动公告' });
    await new Promise((r) => setTimeout(r, 600));
    assert('event：全服在线均收到（alfa/bravo/charlie）', !!alfaEvent && !!bravoEvent && !!charlieEvent && charlieEvent.text === '全服活动公告');

    // 客户端伪造 event 必须被拒（经普通 chat 发 event 不应广播）
    let leaked = false;
    ga.onMessage('chat', (m: any) => { if (m.channel === 'event' && m.text === '伪造活动') leaked = true; });
    gc.send('chat', { channel: 'event', text: '伪造活动' });
    await new Promise((r) => setTimeout(r, 500));
    assert('event：客户端伪造 event 被拒（不广播）', leaked === false);

    ga.leave(); gb.leave(); gc.leave();

    console.log('\n— 校验 —');
    checks.forEach((c) => console.log(`  ${c}`));
    const total = checks.length;
    const okCount = checks.filter((c) => c.startsWith('✓')).length;
    if (okCount !== total) fail(`聊天端到端校验未全部通过 (${okCount}/${total})`);
    log(`✅ 统一聊天系统烟测全部通过 (${okCount}/${total})`);
  } finally {
    clearTimeout(overall);
    cleanup();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
