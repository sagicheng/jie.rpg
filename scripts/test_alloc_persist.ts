/**
 * 属性点分配 持久化 + 不可退回 诊断测试（真机）。
 * 1) 分配 1 点 ATK → 校验 worldSync 返回 allocatedATK+1、statPoints-1
 * 2) 断线重连 → 校验 allocatedATK 与 statPoints 从 DB 还原（持久化）
 * 新角色 1 级 0 点无法分配，故先用 better-sqlite3 给测试角色注入 statPoints=10。
 * 运行：npm run dev:server 已起，另开终端 npx tsx scripts/test_alloc_persist.ts
 */
import { Client } from 'colyseus.js';
import Database from 'better-sqlite3';
import path from 'path';

const ENDPOINT = 'ws://localhost:2567';
const REST = 'http://localhost:2567/api';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = () => Math.random().toString(36).slice(2, 8);
setTimeout(() => { console.error('\n!!! HARD TIMEOUT 30s — aborted'); process.exit(3); }, 30000);

let failed = false;
function assert(c: boolean, m: string) {
  if (!c) { console.error('  FAIL:', m); failed = true; } else console.log('  ok  :', m);
}
async function api(p: string, body: any): Promise<any> {
  const res = await fetch(REST + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = (await res.json()) as any;
  if (!j.ok) throw new Error(`${p} failed: ${j.msg || res.status}`);
  return j;
}
async function makeAccount(suffix: string) {
  const account = `reg_${suffix}`;
  const r = await api('/register', { username: account, password: 'pw123456', security: 'sp123456' });
  const token = r.token;
  const els = ['火', '水', '木', '雷', '土', '虚'];
  const el = els[Math.floor(Math.random() * els.length)];
  const c = await api('/character/create', { token, name: `角_${suffix}`, element: el });
  return { token, characterId: c.character.id };
}

async function main() {
  const client = new Client(ENDPOINT);
  const acc = await makeAccount('AL_' + rnd());

  // 注入初始属性点（新角色 0 点无法分配）
  const db = new Database(path.resolve(process.cwd(), 'data.db'));
  db.prepare('UPDATE characters SET world_data = ? WHERE id = ?')
    .run(JSON.stringify({ level: 1, statPoints: 10 }), acc.characterId);
  db.close();

  const g: any = await client.joinOrCreate('game', { token: acc.token, characterId: acc.characterId });
  await wait(400);
  let last: any = null;
  g.onMessage('worldSync', (pw: any) => { last = pw; });
  g.send('intent', { op: 'ping' });
  await wait(300);
  const baseAlloc = last.allocatedATK || 0;
  const baseSP = last.statPoints || 0;
  console.log(`baseline: allocatedATK=${baseAlloc} statPoints=${baseSP}`);
  assert(baseSP === 10, `初始 statPoints=10 (实际 ${baseSP})`);

  // 分配 1 点 ATK
  g.send('intent', { op: 'allocateStat', attr: 'ATK' });
  await wait(400);
  const afterAlloc = last.allocatedATK || 0;
  const afterSP = last.statPoints || 0;
  assert(afterAlloc === baseAlloc + 1, `allocatedATK ${baseAlloc}→${afterAlloc} (+1)`);
  assert(afterSP === baseSP - 1, `statPoints ${baseSP}→${afterSP} (-1)`);

  // 不可退回：服务端应拒绝分配超过剩余点数（这里再分配 10 次，剩余 9，第10次应被拒）
  for (let i = 0; i < 10; i++) g.send('intent', { op: 'allocateStat', attr: 'ATK' });
  await wait(500);
  assert((last.allocatedATK || 0) === afterAlloc + 9, `连续分配不超过剩余点数：allocatedATK=${last.allocatedATK} (期望 ${afterAlloc + 9})`);
  assert((last.statPoints || 0) === 0, `statPoints 耗尽=0 (实际 ${last.statPoints})`);

  // 持久化：断线重连，校验 DB 还原
  await g.leave();
  await wait(500);
  const g2: any = await client.joinOrCreate('game', { token: acc.token, characterId: acc.characterId });
  await wait(400);
  let last2: any = null;
  g2.onMessage('worldSync', (pw: any) => { last2 = pw; });
  g2.send('intent', { op: 'ping' });
  await wait(300);
  assert((last2.allocatedATK || 0) === afterAlloc + 9, `重连后 allocatedATK 持久化 = ${last2.allocatedATK} (期望 ${afterAlloc + 9})`);
  assert((last2.statPoints || 0) === 0, `重连后 statPoints 持久化 = ${last2.statPoints} (期望 0)`);

  await g2.leave();
  console.log(failed ? '\n=== ALLOC PERSIST TEST FAILED ===' : '\n=== ALLOC PERSIST TEST PASSED ===');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('ERROR', e); process.exit(2); });
