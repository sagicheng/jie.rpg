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
import Database from 'better-sqlite3';

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

    // ── C. 公会 v2 成长系统（等级/经验/贡献/技能）──
    // 在 G2 公会（bravo 会长 / alfa 成员）上验证
    const cInfo0 = await api('/api/guild/info', { token: bravo.token, charId: bravo.charId });
    assert('v2 info 含等级字段', cInfo0.guild.level === 1);
    assert('v2 info 经验初始0', cInfo0.guild.exp === 0);
    assert('v2 info 贡献池初始0', cInfo0.guild.contribution === 0);
    assert('v2 info 技能初始空', Object.keys(cInfo0.guild.skills || {}).length === 0);
    assert('v2 info 含我的贡献字段', 'myContribution' in cInfo0);

    // 成员(alfa) 学技能应被拒（权限不足）
    const learnByMember = await apiRaw('/api/guild/learn-skill', { token: alfa.token, charId: alfa.charId, skillId: 'atk' });
    assert('v2 成员学技能被拒', learnByMember.ok === false);

    // 会长学技能但贡献不足应被拒
    const learnNoContrib = await apiRaw('/api/guild/learn-skill', { token: bravo.token, charId: bravo.charId, skillId: 'atk' });
    assert('v2 贡献不足学技能被拒', learnNoContrib.ok === false && /贡献/.test(learnNoContrib.msg || ''));

    // 直连临时库给公会注入贡献池，再学技能应成功
    const sdb = new Database(path.join(tmp, 'data.db'));
    sdb.prepare('UPDATE guilds SET contribution = contribution + ? WHERE id = ?').run(500, G2);
    sdb.close();

    const learnOk = await api('/api/guild/learn-skill', { token: bravo.token, charId: bravo.charId, skillId: 'atk' });
    assert('v2 学技能成功 atk=1', learnOk.ok === true && learnOk.level === 1 && learnOk.contribution === 450);
    const cInfo1 = await api('/api/guild/info', { token: bravo.token, charId: bravo.charId });
    assert('v2 技能 atk 等级=1', (cInfo1.guild.skills?.atk || 0) === 1);
    assert('v2 贡献池扣减=450', cInfo1.guild.contribution === 450);

    // 再学一次 atk（cost=50+50*1=100）→ contribution=350, atk=2
    const learnOk2 = await api('/api/guild/learn-skill', { token: bravo.token, charId: bravo.charId, skillId: 'atk' });
    assert('v2 学技能 atk=2', learnOk2.ok === true && learnOk2.level === 2 && learnOk2.contribution === 350);

    // 未知技能应被拒
    const learnBad = await apiRaw('/api/guild/learn-skill', { token: bravo.token, charId: bravo.charId, skillId: 'nope' });
    assert('v2 未知技能被拒', learnBad.ok === false);

    // ── D. 行会商店（个人贡献消费闭环，扩充目录）──
    // 直连临时库给 alfa 注入个人贡献 1000（与公会贡献池无关，独立字段）
    const sdb2 = new Database(path.join(tmp, 'data.db'));
    sdb2.prepare('UPDATE guild_members SET contribution = contribution + ? WHERE char_id = ?').run(1000, alfa.charId);
    sdb2.close();

    // 重新进 game 房（alfa 成员 / bravo 会长）走生产意图路径
    const ca2 = new Client(WS), cb2 = new Client(WS);
    const ga2 = await ca2.joinOrCreate('game', { token: alfa.token, characterId: alfa.charId });
    const gb2 = await cb2.joinOrCreate('game', { token: bravo.token, characterId: bravo.charId });
    ga2.onMessage('worldSync', () => {}); gb2.onMessage('worldSync', () => {});
    await new Promise((r) => setTimeout(r, 400));
    log('商店段：alfa/bravo 重新进 game 房');

    // 发送一次购买意图并等待 intentResult 回执
    // 注：colyseus.js 的 Room 类型无 off() 声明，故不手动解绑；每个 sendBuy 顺序 await，
    // 同一时刻仅一个 promise 在等待，历史 handler 的 resolve 已执行（重复 resolve 被忽略），无副作用。
    const sendBuy = (room: Room, itemId: string): Promise<any> =>
      new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), 8000);
        const handler = (r: any) => { clearTimeout(t); resolve(r); };
        room.onMessage('intentResult', handler);
        room.send('intent', { op: 'guildBuy', itemId });
      });

    // 未知商品被拒
    const d0 = await sendBuy(ga2, 'nope');
    assert('商店 未知商品被拒', !!d0 && d0.ok === false);

    // 购买伤药丸(小) ×5（price 20，真实 id medicine_pill_s）→ 1000-20=980，背包得 medicine_pill_s×5
    const d1 = await sendBuy(ga2, 'potion_s_5');
    assert('商店 购买药水成功', !!d1 && d1.ok === true && d1.data.contribution === 980);
    {
      const sdb3 = new Database(path.join(tmp, 'data.db'));
      const mc = sdb3.prepare('SELECT contribution FROM guild_members WHERE char_id = ?').get(alfa.charId) as any;
      assert('商店 个人贡献扣至980', mc.contribution === 980);
      const wj = sdb3.prepare('SELECT world_data FROM characters WHERE id = ?').get(alfa.charId) as any;
      const wd = JSON.parse(wj.world_data);
      const potion = (wd.inventory || []).find((i: any) => i.id === 'medicine_pill_s');
      assert('商店 背包获得真实伤药丸(小)×5', !!potion && potion.quantity >= 5);
      sdb3.close();
    }

    // 购买称号同心（price 200）→ 980-200=780，unlockedTitles 含 guild_tongxin
    const d2 = await sendBuy(ga2, 'title_tongxin');
    assert('商店 购买称号同心成功', !!d2 && d2.ok === true && d2.data.contribution === 780);
    {
      const sdb4 = new Database(path.join(tmp, 'data.db'));
      const wj = sdb4.prepare('SELECT world_data FROM characters WHERE id = ?').get(alfa.charId) as any;
      const wd = JSON.parse(wj.world_data);
      assert('商店 称号解锁 guild_tongxin', (wd.unlockedTitles || []).includes('guild_tongxin'));
      sdb4.close();
    }

    // 重复购买已拥有称号应被拒（防重复扣贡献）
    const d3 = await sendBuy(ga2, 'title_tongxin');
    assert('商店 重复购买称号被拒', !!d3 && d3.ok === false);

    // 购买妖将核心 ×1（price 120）→ 780-120=660
    const d4 = await sendBuy(ga2, 'core_1');
    assert('商店 购买妖将核心成功', !!d4 && d4.ok === true && d4.data.contribution === 660);

    // 购买进阶称号同袍（price 500）→ 660-500=160，unlockedTitles 含 guild_tongpao
    const d5 = await sendBuy(ga2, 'title_tongpao');
    assert('商店 购买称号同袍成功', !!d5 && d5.ok === true && d5.data.contribution === 160);
    {
      const sdb5 = new Database(path.join(tmp, 'data.db'));
      const wj = sdb5.prepare('SELECT world_data FROM characters WHERE id = ?').get(alfa.charId) as any;
      const wd = JSON.parse(wj.world_data);
      assert('商店 称号解锁 guild_tongpao', (wd.unlockedTitles || []).includes('guild_tongpao'));
      sdb5.close();
    }

    // 购买灵晶碎片 ×3（price 80）→ 160-80=80，再购灵晶碎片（80）→ 0
    const d6 = await sendBuy(ga2, 'crystal_3');
    assert('商店 购买灵晶碎片成功', !!d6 && d6.ok === true && d6.data.contribution === 80);
    const d7 = await sendBuy(ga2, 'crystal_3');
    assert('商店 再购灵晶碎片成功', !!d7 && d7.ok === true && d7.data.contribution === 0);

    // 余额不足以再买力量药剂（price 90）→ 被拒
    const d8 = await sendBuy(ga2, 'atk_elixir_2');
    assert('商店 余额不足被拒', !!d8 && d8.ok === false && /个人贡献不足/.test(d8.msg || ''));

    ga2.leave(); gb2.leave();

    // ── E. 副本通关 → 公会经验/贡献来源 ──
    // bravo 仍会长于 G2（公会存在），重新进 game 房以加载世界 + 注册 charId（供副本 getCharId 命中）
    const cb3 = new Client(WS);
    const gb3 = await cb3.joinOrCreate('game', { token: bravo.token, characterId: bravo.charId });
    gb3.onMessage('worldSync', () => {});
    await new Promise((r) => setTimeout(r, 400));

    // 副本前：捕获公会经验 + bravo 个人贡献
    const sdbE0 = new Database(path.join(tmp, 'data.db'));
    const gBefore = (sdbE0.prepare('SELECT exp FROM guilds WHERE id = ?').get(G2) as any).exp as number;
    const mcBefore = (sdbE0.prepare('SELECT contribution FROM guild_members WHERE char_id = ?').get(bravo.charId) as any).contribution as number;
    sdbE0.close();

    // bravo 进副本（带 gameSid = 游戏房 sessionId，使 world.get / getCharId 命中其已加载世界）
    const dRoom = await cb3.joinOrCreate('dungeon', { dungeonId: 1, gameSid: gb3.sessionId, name: 'g_e2e_bravo', color: '#ffffff' });
    await new Promise((r) => setTimeout(r, 300));

    // 依次通关 1→2→3（claimStage 须与房间当前 stage 对齐；stage=3 触发 clear 分支发公会增益）
    for (const st of [1, 2, 3]) {
      dRoom.send('claimStage', { stage: st });
      await new Promise((r) => setTimeout(r, 180));
    }
    await new Promise((r) => setTimeout(r, 300));

    // 副本后：公会经验 + 个人贡献均应增加
    const sdbE1 = new Database(path.join(tmp, 'data.db'));
    const gAfter = (sdbE1.prepare('SELECT exp FROM guilds WHERE id = ?').get(G2) as any).exp as number;
    const mcAfter = (sdbE1.prepare('SELECT contribution FROM guild_members WHERE char_id = ?').get(bravo.charId) as any).contribution as number;
    sdbE1.close();

    assert('副本通关 公会经验增加', gAfter > gBefore);
    assert('副本通关 个人贡献增加', mcAfter > mcBefore);
    assert('副本通关 公会增益=个人增益(同 gain)', (gAfter - gBefore) === (mcAfter - mcBefore));
    gb3.leave();

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
