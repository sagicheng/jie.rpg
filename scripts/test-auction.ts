/**
 * 拍卖行系统端到端烟测（真机 E2E 替代脚本）。
 *
 * 覆盖（一口价 + 收藏/历史持久化 DB）：
 *  A. 上架：冻结背包物品 → auctions 表；worldSync 扣库存
 *  B. 浏览市场 / 我的挂单：列表经 auctionData 下发
 *  C. 购买：扣买家金币 + 发物品；卖家金币经 addGoldToChar 结算（在线 worldSync）
 *  D. 撤单：物品退回背包
 *  E. 收藏增删：auction_favorites 落库，收藏列表带 favorited 标记
 *  F. 历史记录：sold/bought 双向落 auction_history
 *  G. 边界：买自己挂单 / 金币不足 / 挂单不存在 / 无效物品 / 数量超额 / 价格无效
 *
 * 与真实联机完全一致：起真正的 Colyseus 权威服（随机空闲端口，独立临时库），
 * 用 colyseus.js 客户端走生产代码路径（intent → GameRoom → auction.ts → db.ts）。
 *
 * 运行：npx tsx scripts/test-auction.ts   （或 npm run test:auction:e2e）
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

function log(msg: string): void { console.log(`[AUCTION-E2E] ${msg}`); }
function fail(msg: string): never { console.error(`[AUCTION-E2E] ✗ ${msg}`); throw new Error(msg); }
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function waitServerReady(proc: any, ms = 30_000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('服务端启动超时')), ms);
    const onData = (d: Buffer) => {
      const s = d.toString();
      process.stdout.write(d);
      if (s.includes('已启动')) { clearTimeout(timer); resolve(); }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', (d: Buffer) => process.stderr.write(d));
    proc.on('exit', (code: number) => { if (code !== 0 && !process.stdout.toString().includes('已启动')) reject(new Error(`服务端异常退出 code=${code}`)); });
  });
}

async function apiRaw(post: string, body: any): Promise<any> {
  const res = await fetch(`${BASE}${post}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json() as any;
}
async function api(post: string, body: any): Promise<any> {
  const j = await apiRaw(post, body);
  if (!j.ok) throw new Error(`${post} 失败: ${j.msg || JSON.stringify(j)}`);
  return j;
}

interface Player { client: Client; room: any; intentResults: any[]; auctionDatas: any[]; world: any; }

function makePlayer(client: Client, room: any): Player {
  const p: Player = { client, room, intentResults: [], auctionDatas: [], world: null };
  room.onMessage('intentResult', (m: any) => p.intentResults.push(m));
  room.onMessage('auctionData', (m: any) => p.auctionDatas.push(m));
  room.onMessage('worldSync', (m: any) => { p.world = m; });
  return p;
}

async function intent(p: Player, op: string, data: any = {}, ms = 6000): Promise<any> {
  p.intentResults = [];
  p.room.send('intent', { op, ...data });
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (p.intentResults.length) return p.intentResults[p.intentResults.length - 1]; await wait(40); }
  throw new Error(`intentResult 超时: ${op}`);
}
async function auctionReq(p: Player, op: string, data: any = {}, ms = 6000): Promise<any> {
  p.auctionDatas = [];
  p.room.send('intent', { op, ...data });
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (p.auctionDatas.length) return p.auctionDatas[p.auctionDatas.length - 1]; await wait(40); }
  throw new Error(`auctionData 超时: ${op}`);
}
async function waitWorld(p: Player, pred: (w: any) => boolean, ms = 6000): Promise<any> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (p.world && pred(p.world)) return p.world; await wait(40); }
  throw new Error('worldSync 等待条件超时');
}
const invQty = (w: any, id: string): number => (w.inventory.find((i: any) => i.id === id)?.quantity) ?? 0;

async function main(): Promise<void> {
  TEST_PORT = await getFreePort();
  BASE = `http://localhost:${TEST_PORT}`;
  WS = `ws://localhost:${TEST_PORT}`;
  log(`使用端口 ${TEST_PORT}`);

  log('编译服务端 (tsc -p tsconfig.server.json) …');
  execSync('npx tsc -p tsconfig.server.json', { cwd: GAME_DIR, stdio: 'inherit' });
  if (!require('node:fs').existsSync(SERVER_ENTRY)) fail('编译后未找到服务端入口 dist-server/server/index.js');

  const tmp = mkdtempSync(path.join(tmpdir(), 'jie-auction-e2e-'));
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

    const mk = async (user: string) => {
      const reg = await api('/api/register', { username: user, password: 'test1234', security: 'sec1234' });
      const ch = await api('/api/character/create', { token: reg.token, name: user, element: 'fire' });
      return { token: reg.token as string, charId: ch.character.id as number, name: user };
    };
    const seller = await mk('a_e2e_seller');
    const buyer = await mk('a_e2e_buyer');
    log(`账号就绪：seller(${seller.charId}) / buyer(${buyer.charId})`);

    const ca = new Client(WS);
    const ga = await ca.joinOrCreate('game', { token: seller.token, characterId: seller.charId });
    const cb = new Client(WS);
    const gb = await cb.joinOrCreate('game', { token: buyer.token, characterId: buyer.charId });
    const S = makePlayer(ca, ga);
    const B = makePlayer(cb, gb);
    await wait(500);
    log('seller / buyer 均已进 game 房');

    // 初始世界（种子：止血草×5，金币200）
    const s0 = await waitWorld(S, (w) => w.gold === 200 && invQty(w, 'stop_blood_grass') === 5);
    const b0 = await waitWorld(B, (w) => w.gold === 200 && invQty(w, 'stop_blood_grass') === 5);
    assert('seller 初始：金币200 + 止血草×5', s0.gold === 200 && invQty(s0, 'stop_blood_grass') === 5);
    assert('buyer 初始：金币200 + 止血草×5', b0.gold === 200 && invQty(b0, 'stop_blood_grass') === 5);

    // ── A. 上架 ──
    const cr = await intent(S, 'auctionCreate', { itemId: 'stop_blood_grass', qty: 2, price: 100 });
    assert('上架成功(intentResult.ok)', cr.ok === true);
    const sAfterCreate = await waitWorld(S, (w) => invQty(w, 'stop_blood_grass') === 3);
    assert('上架冻结库存：止血草 5→3', invQty(sAfterCreate, 'stop_blood_grass') === 3);

    const mine = await auctionReq(S, 'auctionMine', {});
    assert('我的挂单：1 条', mine.tab === 'mine' && Array.isArray(mine.auctions) && mine.auctions.length === 1);
    const a1 = mine.auctions[0];
    assert('挂单字段正确（物品/单价/数量/卖家）', a1.item_name === '止血草' && a1.price === 100 && a1.quantity === 2 && a1.seller_name === 'a_e2e_seller' && a1.favorited === false);
    const a1id = a1.id;

    // ── B. 浏览市场（买家视角）──
    const mkt = await auctionReq(B, 'auctionList', {});
    assert('市场列表：含该挂单', mkt.tab === 'market' && mkt.auctions.length === 1 && mkt.auctions[0].id === a1id && mkt.auctions[0].favorited === false);

    // ── C. 购买（一口价）──
    const buyRes = await intent(B, 'auctionBuy', { auctionId: a1id });
    assert('购买成功(intentResult.ok)', buyRes.ok === true);
    const bAfterBuy = await waitWorld(B, (w) => w.gold === 100 && invQty(w, 'stop_blood_grass') === 7);
    assert('买家：金币 200→100', bAfterBuy.gold === 100);
    assert('买家：止血草 5→7（到货 2）', invQty(bAfterBuy, 'stop_blood_grass') === 7);
    const sAfterBuy = await waitWorld(S, (w) => w.gold === 295);
    assert('卖家：金币 200→295（100×0.95 手续费后到账）', sAfterBuy.gold === 295);

    const mineAfter = await auctionReq(S, 'auctionMine', {});
    assert('成交后「我的挂单」清空', mineAfter.auctions.length === 0);
    const mktAfter = await auctionReq(B, 'auctionList', {});
    assert('成交后市场列表清空', mktAfter.auctions.length === 0);

    // ── F. 历史（双向）──
    const sHist = await auctionReq(S, 'auctionHistory', {});
    const soldRow = sHist.history.find((h: any) => h.kind === 'sold' && h.item_name === '止血草' && h.price === 100);
    assert('卖家历史：sold 记录', !!soldRow);
    const bHist = await auctionReq(B, 'auctionHistory', {});
    const boughtRow = bHist.history.find((h: any) => h.kind === 'bought' && h.item_name === '止血草' && h.price === 100);
    assert('买家历史：bought 记录', !!boughtRow);

    // ── D. 撤单 ──
    await intent(S, 'auctionCreate', { itemId: 'stop_blood_grass', qty: 1, price: 50 });
    const mine2 = await auctionReq(S, 'auctionMine', {});
    assert('再上架 1 条（撤单用）', mine2.auctions.length === 1);
    const a2id = mine2.auctions[0].id;
    const sBeforeCancel = await waitWorld(S, (w) => invQty(w, 'stop_blood_grass') === 2);
    assert('上架 1 件后库存 3→2', invQty(sBeforeCancel, 'stop_blood_grass') === 2);
    const cancelRes = await intent(S, 'auctionCancel', { auctionId: a2id });
    assert('撤单成功', cancelRes.ok === true);
    const sAfterCancel = await waitWorld(S, (w) => invQty(w, 'stop_blood_grass') === 3);
    assert('撤单退回：止血草 2→3', invQty(sAfterCancel, 'stop_blood_grass') === 3);

    // ── E. 收藏增删 ──
    await intent(S, 'auctionCreate', { itemId: 'stop_blood_grass', qty: 1, price: 30 });
    const mine3 = await auctionReq(S, 'auctionMine', {});
    const a3id = mine3.auctions[0].id;
    const favOn = await intent(B, 'auctionFav', { auctionId: a3id, on: true });
    assert('收藏成功', favOn.ok === true);
    const favList = await auctionReq(B, 'auctionFavList', {});
    assert('收藏列表：1 条且 favorited=true', favList.auctions.length === 1 && favList.auctions[0].favorited === true && favList.auctions[0].id === a3id);
    const favOff = await intent(B, 'auctionFav', { auctionId: a3id, on: false });
    assert('取消收藏成功', favOff.ok === true);
    const favList2 = await auctionReq(B, 'auctionFavList', {});
    assert('取消收藏后列表清空', favList2.auctions.length === 0);

    // ── G. 边界 ──
    // 买自己挂单
    const selfBuy = await intent(S, 'auctionBuy', { auctionId: a3id });
    assert('边界：不能购买自己的挂单', selfBuy.ok === false);
    // 挂单不存在
    const noAuc = await intent(B, 'auctionBuy', { auctionId: 999999 });
    assert('边界：购买不存在挂单被拒', noAuc.ok === false);
    // 金币不足（买家当前金币 100）
    await intent(S, 'auctionCreate', { itemId: 'stop_blood_grass', qty: 1, price: 999999 });
    const mine4 = await auctionReq(S, 'auctionMine', {});
    const a4id = mine4.auctions[0].id;
    const poor = await intent(B, 'auctionBuy', { auctionId: a4id });
    assert('边界：金币不足被拒', poor.ok === false && /金币不足/.test(poor.msg || ''));
    // 无效物品
    const badItem = await intent(S, 'auctionCreate', { itemId: 'no_such_item', qty: 1, price: 10 });
    assert('边界：背包无此物品被拒', badItem.ok === false);
    // 数量超额
    const overQty = await intent(S, 'auctionCreate', { itemId: 'stop_blood_grass', qty: 999, price: 10 });
    assert('边界：数量超过背包被拒', overQty.ok === false);
    // 价格无效
    const badPrice = await intent(S, 'auctionCreate', { itemId: 'stop_blood_grass', qty: 1, price: 0 });
    assert('边界：价格无效被拒', badPrice.ok === false);
    // 重复清理：撤掉 a3 / a4，避免遗留
    await intent(S, 'auctionCancel', { auctionId: a3id });
    await intent(S, 'auctionCancel', { auctionId: a4id });

    ga.leave(); gb.leave();
    await wait(300);

    console.log('\n— 校验 —');
    checks.forEach((c) => console.log(`  ${c}`));
    const total = checks.length;
    const okCount = checks.filter((c) => c.startsWith('✓')).length;
    if (okCount !== total) fail(`拍卖行端到端校验未全部通过 (${okCount}/${total})`);
    log(`✅ 拍卖行端到端烟测全部通过 (${okCount}/${total})`);
  } finally {
    clearTimeout(overall);
    cleanup();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
