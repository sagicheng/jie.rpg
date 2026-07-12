/**
 * 六大力量体系解锁 + 鬼道 + 图鉴奖励 + 称号 持久化诊断测试（真机）。
 * 验证 multiplayer 下这些原本只在客户端内存、可被篡改/刷新即丢的状态，
 * 现在由服务端权威 + DB 持久化，断线重连后从 DB 还原。
 *
 * 1) 进房读取 baseline（含注入的 kidoPoints/unlockedTitles/bestiaryTierClaimed）
 * 2) 发 intent：unlock(shikai) / kidoSetSchool(hado) / kidoAllocate(hado_t1_01) / kidoEquip(hado_t1_01) / setTitle(测试称号)
 * 3) 校验 worldSync 反映服务端权威结果
 * 4) 断线重连 → 校验全部从 DB 还原（持久化）
 *
 * 运行：npm run dev:server 已起，另开终端 npx tsx scripts/test_persist_unlocks_kido_bestiary.ts
 * 注：图鉴分层奖励 claim 成功路径依赖 NAMED_ENEMIES 数据填充（当前为 {}，既有的数据事项），
 *     故本测试通过注入 bestiaryTierClaimed=[1] 验证该字段本身的 DB 持久化往返。
 */
import { Client } from 'colyseus.js';
import Database from 'better-sqlite3';
import path from 'path';

const ENDPOINT = 'ws://localhost:2567';
const REST = 'http://localhost:2567/api';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = () => Math.random().toString(36).slice(2, 8);
setTimeout(() => { console.error('\n!!! HARD TIMEOUT 40s — aborted'); process.exit(3); }, 40000);

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
  const acc = await makeAccount('UK_' + rnd());

  // 注入初始状态：kidoPoints 池、已解锁称号、已领图鉴层级（验证字段持久化往返）
  const db = new Database(path.resolve(process.cwd(), 'data.db'));
  db.prepare('UPDATE characters SET world_data = ? WHERE id = ?')
    .run(JSON.stringify({ level: 1, statPoints: 0, kidoPoints: 5, unlockedTitles: ['测试称号'], bestiaryTierClaimed: [1] }), acc.characterId);
  db.close();

  const g: any = await client.joinOrCreate('game', { token: acc.token, characterId: acc.characterId });
  await wait(400);
  let last: any = null;
  let lastResult: any = null;
  g.onMessage('worldSync', (pw: any) => { last = pw; });
  g.onMessage('intentResult', (r: any) => { lastResult = r; });
  g.send('intent', { op: 'ping' });
  await wait(300);

  console.log('--- baseline ---');
  assert((last.kidoPoints || 0) === 5, `kidoPoints 注入=5 (实际 ${last.kidoPoints})`);
  assert(Array.isArray(last.unlocks) && last.unlocks.length === 0, `unlocks 初始为空`);
  assert(last.kidoSchool === null || last.kidoSchool === undefined, `kidoSchool 初始为 null`);
  assert((last.bestiaryTierClaimed || []).includes(1), `bestiaryTierClaimed 注入含[1] (实际 ${JSON.stringify(last.bestiaryTierClaimed)})`);
  assert((last.unlockedTitles || []).includes('测试称号'), `unlockedTitles 注入含[测试称号]`);

  // 1) 解锁 始解
  g.send('intent', { op: 'unlock', key: 'shikai' });
  await wait(350);
  assert((last.unlocks || []).includes('shikai'), `unlock shikai → unlocks 含 'shikai' (实际 ${JSON.stringify(last.unlocks)})`);

  // 2) 鬼道设系别
  g.send('intent', { op: 'kidoSetSchool', school: 'hado' });
  await wait(300);
  assert(last.kidoSchool === 'hado', `kidoSetSchool hado → kidoSchool='hado' (实际 ${last.kidoSchool})`);

  // 3) 鬼道加点（T1 无层级锁，kidoPoints=5 足够）
  g.send('intent', { op: 'kidoAllocate', nodeId: 'hado_t1_01' });
  await wait(350);
  assert((last.kidoNodes && last.kidoNodes['hado_t1_01'] === 1), `kidoAllocate hado_t1_01 → kidoNodes[hado_t1_01]=1 (实际 ${JSON.stringify(last.kidoNodes)})`);
  assert((last.kidoPoints || 0) === 5, `kidoPoints 池不变=5 (实际 ${last.kidoPoints})`);

  // 4) 鬼道装备主动技
  g.send('intent', { op: 'kidoEquip', nodeId: 'hado_t1_01' });
  await wait(300);
  assert((last.kidoEquipped || []).includes('hado_t1_01'), `kidoEquip hado_t1_01 → kidoEquipped 含之 (实际 ${JSON.stringify(last.kidoEquipped)})`);

  // 5) 装备称号
  g.send('intent', { op: 'setTitle', id: '测试称号' });
  await wait(300);
  assert(last.activeTitle === '测试称号', `setTitle 测试称号 → activeTitle='测试称号' (实际 ${last.activeTitle})`);

  // 持久化：断线重连
  await g.leave();
  await wait(500);
  const g2: any = await client.joinOrCreate('game', { token: acc.token, characterId: acc.characterId });
  await wait(400);
  let last2: any = null;
  g2.onMessage('worldSync', (pw: any) => { last2 = pw; });
  g2.send('intent', { op: 'ping' });
  await wait(300);

  console.log('--- 重连后（应全部从 DB 还原）---');
  assert((last2.unlocks || []).includes('shikai'), `重连 unlocks 持久化含 'shikai' (实际 ${JSON.stringify(last2.unlocks)})`);
  assert(last2.kidoSchool === 'hado', `重连 kidoSchool 持久化='hado' (实际 ${last2.kidoSchool})`);
  assert((last2.kidoNodes && last2.kidoNodes['hado_t1_01'] === 1), `重连 kidoNodes 持久化 hado_t1_01=1 (实际 ${JSON.stringify(last2.kidoNodes)})`);
  assert((last2.kidoEquipped || []).includes('hado_t1_01'), `重连 kidoEquipped 持久化含 hado_t1_01 (实际 ${JSON.stringify(last2.kidoEquipped)})`);
  assert((last2.kidoPoints || 0) === 5, `重连 kidoPoints 持久化=5 (实际 ${last2.kidoPoints})`);
  assert(last2.activeTitle === '测试称号', `重连 activeTitle 持久化='测试称号' (实际 ${last2.activeTitle})`);
  assert((last2.bestiaryTierClaimed || []).includes(1), `重连 bestiaryTierClaimed 持久化含[1]`);
  assert((last2.unlockedTitles || []).includes('测试称号'), `重连 unlockedTitles 持久化含[测试称号]`);

  await g2.leave();
  console.log(failed ? '\n=== UNLOCKS/KIDO/BESTIARY PERSIST TEST FAILED ===' : '\n=== UNLOCKS/KIDO/BESTIARY PERSIST TEST PASSED ===');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('ERROR', e); process.exit(2); });
