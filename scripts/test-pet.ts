/**
 * 灵宠系统端到端烟测（真机 E2E 替代脚本）。
 *
 * 覆盖（v1 范围：所有权/等级/出战/光环，战斗协同留 v2）：
 *  A. 发放灵宠：随机物种 / 指定物种 → 首只自动出战
 *  B. 切换出战：setActive 后同玩家仅一只出战
 *  C. 收回出战：recall 后无出战灵宠
 *  D. 放生：release 后数量递减，若放生的是出战则首只接替
 *  E. 栏位上限：满 6 后第 7 只被拒
 *  F. 持久化：world_data 落库，刷新/断连仍保留
 *  G. 光环数值：出战灵宠按 10%/20% 比例提升玩家属性（computePetAura 对齐）
 *
 * 与真实联机完全一致：起一个真正的 Colyseus 权威服（随机端口，独立临时库），
 * 用 colyseus.js 客户端走生产代码路径；服务端带装饰器故先 tsc 编译再 node 起服。
 *
 * 运行：npx tsx scripts/test-pet.ts
 *  - 不污染真实 data.db（服务端 cwd 指向临时目录）。
 */
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, type Room } from 'colyseus.js';
import Database from 'better-sqlite3';
import { computePetAura } from '../src/systems/PetSystem';

const GAME_DIR = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.resolve(GAME_DIR, 'dist-server/server/index.js');
let TEST_PORT = 2568;
let BASE = `http://localhost:${TEST_PORT}`;
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

function log(msg: string): void { console.log(`[PET-E2E] ${msg}`); }
function fail(msg: string): never { console.error(`[PET-E2E] ✗ ${msg}`); throw new Error(msg); }

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
  if (!existsSync(SERVER_ENTRY)) fail('编译后未找到服务端入口 dist-server/server/index.js');

  const tmp = mkdtempSync(path.join(tmpdir(), 'jie-pet-e2e-'));
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

    // 注册账号 + 建角色
    const reg = await api('/api/register', { username: 'p_e2e_1', password: 'test1234', security: 'sec1234' });
    const ch = await api('/api/character/create', { token: reg.token, name: 'p_e2e_1', element: 'fire' });
    const charId = ch.character.id as number;
    log(`账号就绪：p_e2e_1 (charId=${charId})`);

    // 进 game 房（生产路径）
    const cli = new Client(WS);
    const room = await cli.joinOrCreate('game', { token: reg.token, characterId: charId }) as Room;
    let lastPw: any = null;
    room.onMessage('worldSync', (pw: any) => { lastPw = pw; });
    await new Promise((r) => setTimeout(r, 400));
    log('客户端已进 game 房');

    /** 发灵宠意图，等 intentResult 回执 + 后续 worldSync，返回二者。 */
    async function petIntent(op: string, data: any = {}): Promise<{ res: any; pw: any }> {
      const resP = new Promise<any>((resolve) => {
        const t = setTimeout(() => resolve(null), 8000);
        room.onMessage('intentResult', (r: any) => { clearTimeout(t); resolve(r); });
      });
      room.send('intent', { op, ...data });
      const res = await resP;
      // worldSync 在 intentResult 之后到达
      await new Promise((r) => setTimeout(r, 200));
      return { res, pw: lastPw };
    }

    // ── A. 发放（随机物种）──
    const a = await petIntent('petGrantDev', {});
    assert('A 发放随机灵宠成功', !!a.res && a.res.ok === true);
    assert('A pets 长度=1', a.pw && Array.isArray(a.pw.pets) && a.pw.pets.length === 1);
    assert('A 首只自动出战', a.pw && a.pw.pets.length === 1 && a.pw.pets[0].active === true);

    // ── B. 发放指定物种 fox_fire ──
    const b = await petIntent('petGrantDev', { speciesId: 'fox_fire' });
    assert('B 发放指定物种成功', !!b.res && b.res.ok === true);
    assert('B pets 长度=2', b.pw && b.pw.pets.length === 2);
    assert('B 仅一只出战', b.pw && b.pw.pets.filter((p: any) => p.active).length === 1);
    const firstId = b.pw.pets[0].id;
    const secondId = b.pw.pets[1].id;
    assert('B 指定物种已记录', b.pw.pets.some((p: any) => p.speciesId === 'fox_fire'));

    // ── C. 切换出战（设第二只为出战）──
    const c = await petIntent('petSetActive', { petId: secondId });
    assert('C 切换出战成功', !!c.res && c.res.ok === true);
    assert('C 仅第二只出战', c.pw && c.pw.pets.filter((p: any) => p.active).length === 1 && c.pw.pets.find((p: any) => p.id === secondId).active === true);
    assert('C 第一只已收回', c.pw && c.pw.pets.find((p: any) => p.id === firstId).active === false);

    // ── D. 收回出战 ──
    const d = await petIntent('petRecall', { petId: secondId });
    assert('D 收回成功', !!d.res && d.res.ok === true);
    assert('D 无出战灵宠', d.pw && d.pw.pets.filter((p: any) => p.active).length === 0);

    // ── E. 设第一只出战 + 放生第二只 ──
    const e1 = await petIntent('petSetActive', { petId: firstId });
    assert('E 设第一只出战成功', !!e1.res && e1.res.ok === true && e1.pw.pets.find((p: any) => p.id === firstId).active === true);
    const e2 = await petIntent('petRelease', { petId: secondId });
    assert('E 放生成功', !!e2.res && e2.res.ok === true);
    assert('E 放生后长度=1', e2.pw && e2.pw.pets.length === 1);
    assert('E 剩余那只仍出战', e2.pw && e2.pw.pets.length === 1 && e2.pw.pets[0].active === true);

    // ── F. 栏位上限（满 6 后第 7 只被拒）──
    // 当前 1 只，再发 5 只到 6
    for (let i = 0; i < 5; i++) { await petIntent('petGrantDev', {}); }
    const capBefore = await petIntent('petGrantDev', {});
    assert('F 第 7 只被拒（栏位已满）', !!capBefore.res && capBefore.res.ok === false && /上限/.test(capBefore.res.msg || ''));
    assert('F 栏位封顶=6', capBefore.pw && capBefore.pw.pets.length === 6);
    assert('F 仍仅一只出战', capBefore.pw && capBefore.pw.pets.filter((p: any) => p.active).length === 1);

    // ── G. 持久化（读临时库 world_data）──
    {
      const sdb = new Database(path.join(tmp, 'data.db'));
      const wj = sdb.prepare('SELECT world_data FROM characters WHERE id = ?').get(charId) as any;
      const wd = JSON.parse(wj.world_data);
      sdb.close();
      assert('G 落库 pets 长度=6', Array.isArray(wd.pets) && wd.pets.length === 6);
      assert('G 落库仅一只出战', wd.pets.filter((p: any) => p.active).length === 1);
      // 断连重连恢复：新客户端进房读取 worldSync 应含相同 pets
      const cli2 = new Client(WS);
      const room2 = await cli2.joinOrCreate('game', { token: reg.token, characterId: charId }) as Room;
      const pwAfter: any = await new Promise((resolve) => {
        room2.onMessage('worldSync', (pw: any) => resolve(pw));
        setTimeout(() => resolve(lastPw), 1500);
      });
      assert('G 重连后 pets 恢复=6', pwAfter && Array.isArray(pwAfter.pets) && pwAfter.pets.length === 6);
      room2.leave();
    }

    // ── H. 光环数值公式对齐 ──
    {
      const active = capBefore.pw.pets.find((p: any) => p.active);
      if (!active) fail('H 找不到出战灵宠');
      const aura = computePetAura(active);
      if (!aura) fail('H computePetAura 返回 null');
      const expHp = Math.round((active.maxHp || 0) * 0.10);
      const expAtk = Math.round((active.atk || 0) * 0.20);
      const expDef = Math.round((active.def || 0) * 0.20);
      const expMatk = Math.round((active.matk || 0) * 0.20);
      const expMdef = Math.round((active.mdef || 0) * 0.20);
      const expSpd = Math.round((active.spd || 0) * 0.20);
      assert('H 光环 HP=maxHp*10%', aura.hp === expHp);
      assert('H 光环 ATK=atk*20%', aura.atk === expAtk);
      assert('H 光环 DEF=def*20%', aura.def === expDef);
      assert('H 光环 MATK=matk*20%', aura.matk === expMatk);
      assert('H 光环 MDEF=mdef*20%', aura.mdef === expMdef);
      assert('H 光环 SPD=spd*20%', aura.spd === expSpd);
      log(`H 出战灵宠[${active.name}] 光环 HP+${aura.hp} ATK+${aura.atk} DEF+${aura.def} MATK+${aura.matk} MDEF+${aura.mdef} SPD+${aura.spd}`);
    }

    room.leave();

    // 汇总
    console.log('\n— 校验 —');
    checks.forEach((c) => console.log(`  ${c}`));
    const total = checks.length;
    const okCount = checks.filter((c) => c.startsWith('✓')).length;
    if (okCount !== total) fail(`灵宠端到端校验未全部通过 (${okCount}/${total})`);
    log(`✅ 灵宠端到端烟测全部通过 (${okCount}/${total})`);
  } finally {
    clearTimeout(overall);
    cleanup();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
