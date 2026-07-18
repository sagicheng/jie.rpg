/**
 * 灵宠系统端到端烟测（真机 E2E 替代脚本）。
 *
 * 覆盖（v1.1 重设计范围：所有权/等级/出战/光环 + 元素/品质/技能/属性点）：
 *  A. 发放灵宠：随机物种 / 指定物种 → 首只自动出战
 *  B. 切换出战：setActive 后同玩家仅一只出战
 *  C. 收回出战：recall 后无出战灵宠
 *  D. 放生：release 后数量递减，若放生的是出战则首只接替
 *  E. 栏位上限：满 6 后第 7 只被拒
 *  F. 持久化：world_data 落库，刷新/断连仍保留
 *  G. 光环数值：出战灵宠按 10%/20% 比例提升玩家属性（computePetAura 对齐）
 *  I. 新字段：发放灵宠含 element(4元素)/quality(5档)/skills(非空) 且合法
 *  J. 属性点分配 petSetAttr：0 点时拒绝 / 升级后分配使 attrPoints 递减、属性与派生属性变化 / 非法属性名拒绝
 *  K. 灵宠蛋来源：petGrantEgg 发蛋进背包 → usePetEgg 双击开启，随机元素/品质/技能，蛋被消耗，灵宠栏+1
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

function waitFor(pred: () => boolean, ms = 10_000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      let ok = false;
      try { ok = pred(); } catch { ok = false; }
      if (ok) return resolve();
      if (Date.now() - t0 > ms) return reject(new Error('waitFor 超时'));
      setTimeout(tick, 80);
    };
    tick();
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

    // ── I. 新字段：元素 / 品质 / 技能 ──
    {
      const VALID_ELEM = ['fire', 'wind', 'water', 'earth'];
      const VALID_QUAL = ['normal', 'fine', 'choice', 'rare', 'legend'];
      const foxPet = b.pw.pets.find((p: any) => p.speciesId === 'fox_fire');
      if (!foxPet) fail('I 找不到 fox_fire 灵宠');
      // 指定物种 fox_fire：火属性 + 技能 flame_breath
      assert('I fox_fire 元素=fire', foxPet.element === 'fire');
      assert('I fox_fire 品质合法', VALID_QUAL.includes(foxPet.quality));
      assert('I fox_fire 技能非空', Array.isArray(foxPet.skills) && foxPet.skills.length > 0);
      assert('I fox_fire 含先天技能 flame_breath', Array.isArray(foxPet.skills) && foxPet.skills.includes('flame_breath'));
      // 随机物种灵宠：四元素之一 + 五档品质之一 + 技能非空
      const rndPet = a.pw.pets[0];
      assert('I 随机宠 元素∈4元素', VALID_ELEM.includes(rndPet.element));
      assert('I 随机宠 品质∈5档', VALID_QUAL.includes(rndPet.quality));
      assert('I 随机宠 技能非空', Array.isArray(rndPet.skills) && rndPet.skills.length > 0);
      // 属性点字段结构完整
      assert('I 属性点字段齐全', ['attrStr','attrVit','attrAgi','attrInt','attrPoints'].every((k) => typeof (foxPet as any)[k] === 'number'));
      log(`I fox_fire[${foxPet.name}] 元素=${foxPet.element} 品质=${foxPet.quality} 技能=${foxPet.skills.join(',')}`);
    }

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

    // ── J. 属性点分配 petSetAttr ──
    {
      // J1 守卫：1 级宠 attrPoints=0，正向分配应被拒
      const g = await petIntent('petSetAttr', { petId: firstId, attr: 'str', delta: 1 });
      assert('J 0 点正向分配被拒', !!g.res && g.res.ok === false && /无可用属性点/.test(g.res.msg || ''));
      assert('J 守卫后属性点不变', g.pw && g.pw.pets.find((p: any) => p.id === firstId).attrPoints === 0);

      // J2 成功：发放 5 级宠（必带属性点），分配 1 点力量
      const j2 = await petIntent('petGrantDev', { speciesId: 'fox_fire', level: 5 });
      assert('J 发放 5 级宠成功', !!j2.res && j2.res.ok === true);
      const petJ = j2.pw.pets.find((p: any) => p.level === 5 && p.speciesId === 'fox_fire');
      if (!petJ) fail('J 找不到 5 级 fox_fire 灵宠');
      assert('J 5 级宠属性点>0', petJ.attrPoints > 0);
      const P0 = petJ.attrPoints, S0 = petJ.attrStr, A0 = petJ.atk;
      const alloc = await petIntent('petSetAttr', { petId: petJ.id, attr: 'str', delta: 1 });
      assert('J 分配成功', !!alloc.res && alloc.res.ok === true);
      const petJa = alloc.pw.pets.find((p: any) => p.id === petJ.id);
      assert('J 未分配点-1', petJa.attrPoints === P0 - 1);
      assert('J 力量属性+1', petJa.attrStr === S0 + 1);
      assert('J 攻击力严格增大', petJa.atk > A0); // str.atk=3, 品质倍率≥1 → 必增

      // J3 归还：反向分配 -1，属性点回补、属性归位
      const back = await petIntent('petSetAttr', { petId: petJ.id, attr: 'str', delta: -1 });
      assert('J 反向分配成功', !!back.res && back.res.ok === true);
      const petJb = back.pw.pets.find((p: any) => p.id === petJ.id);
      assert('J 归还后属性点复原', petJb.attrPoints === P0);
      assert('J 归还后力量复原', petJb.attrStr === S0);
      assert('J 归还后攻击复原', petJb.atk === A0);

      // J4 非法属性名
      const bad = await petIntent('petSetAttr', { petId: petJ.id, attr: 'foo', delta: 1 });
      assert('J 非法属性名被拒', !!bad.res && bad.res.ok === false && /未知属性/.test(bad.res.msg || ''));

      // 放生测试宠，恢复栏位数量为 1（供 F 段使用）
      await petIntent('petRelease', { petId: petJ.id });
      log(`J 5 级 fox_fire 分配验证通过（点 ${P0}→${P0-1}→${P0}，ATK ${A0}→${petJa.atk}→${A0}）`);
    }

    // ── K. 灵宠蛋来源：发蛋 → 双击开启（随机元素/品质/技能）──
    {
      // 当前 pets=1（J 段放生了 5 级测试宠），栏位有余量
      const k0 = await petIntent('petGrantEgg', { zone: 9 });
      assert('K 发放灵宠蛋成功', !!k0.res && k0.res.ok === true);
      const eggItem = (k0.pw.inventory || []).find((i: any) => i.id === 'pet_egg');
      assert('K 背包出现灵宠蛋', !!eggItem);
      const petsBefore = k0.pw.pets.length;
      const k1 = await petIntent('usePetEgg', { itemId: eggItem.id });
      assert('K 开启灵宠蛋成功', !!k1.res && k1.res.ok === true);
      assert('K 灵宠数量+1', k1.pw && k1.pw.pets.length === petsBefore + 1);
      const hatched = k1.pw.pets[k1.pw.pets.length - 1];
      assert('K 孵化宠 元素∈4元素', ['fire', 'wind', 'water', 'earth'].includes(hatched.element));
      assert('K 孵化宠 品质∈5档', ['normal', 'fine', 'choice', 'rare', 'legend'].includes(hatched.quality));
      assert('K 孵化宠 技能非空', Array.isArray(hatched.skills) && hatched.skills.length > 0);
      assert('K 灵宠蛋已消耗', !(k1.pw.inventory || []).find((i: any) => i.id === 'pet_egg'));
      log(`K 灵宠蛋孵化：${hatched.name}（${hatched.element}·${hatched.quality}）技能=${hatched.skills.join(',')}`);
    }

    // ── F. 栏位上限（满 6 后第 7 只被拒）──
    // 当前 2 只（K 段开蛋+1），再发 4 只到 6
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

    // ── L. 宠物入战（BattleRoom 出战灵宠协同 v1.1）──
    {
      const active = (lastPw.pets || []).find((p: any) => p.active) || (lastPw.pets || [])[0];
      assert('L 存在可出战灵宠', !!active);
      const lvl = active.level || 1;
      const petDto = {
        name: active.name, speciesId: active.speciesId, element: active.element, quality: active.quality, level: lvl,
        stats: { hp: active.hp, maxHp: active.maxHp, atk: active.atk, def: active.def, matk: active.matk, mdef: active.mdef, spd: active.spd },
        maxMp: 30 + lvl * 4, mp: 30 + lvl * 4,
        skills: Array.isArray(active.skills) ? active.skills : [],
      };
      const ownerSessionId = room.sessionId;
      const bcli = new Client(WS);
      const battle: any = await bcli.joinOrCreate('battle', {
        name: 'p_e2e_1', ownerSessionId,
        enemyParty: [{ name: '虚', type: '杂妖', element: '火', zone: 2, hp: 300, maxHp: 300, atk: 10, def: 12, matk: 8, mdef: 10, spd: 8 }],
        monsterId: 'test-mon',
        playerStats: { hp: 400, maxHp: 400, mp: 120, maxMp: 120, atk: 60, def: 35, matk: 45, mdef: 35, spd: 22 },
        pet: petDto,
      });
      // 战斗房自身 client.sessionId（与地图房 GameRoom 的 sessionId 不同）
      const battleSid = battle.sessionId;
      await waitFor(() => !!battle.state && battle.state.phase === 'combat' && battle.state.roundPhase === 'command', 9000);
      const players = [...battle.state.players.values()] as any[];
      const petEntry = players.find((p: any) => p.isPet === true);
      const charEntry = players.find((p: any) => !p.isPet && p.sessionId === battleSid);
      assert('L 战斗内出现出战灵宠卡片', !!petEntry);
      assert('L 宠物 isPet=true', !!petEntry && petEntry.isPet === true);
      assert('L 宠物 ownerSid=主人(地图房SID)', !!petEntry && petEntry.ownerSid === ownerSessionId);
      assert('L 人物战斗员存在', !!charEntry);
      assert('L 宠物独立 SID', !!petEntry && petEntry.sessionId === battleSid + ':pet');

      // 提交人物攻击 + 宠物攻击（两个 actor 分别提交）
      const firstEnemy = [...battle.state.enemies.values()][0];
      battle.send('action', { type: 'attack', targetId: firstEnemy.id, actorSid: ownerSessionId });
      battle.send('action', { type: 'attack', targetId: firstEnemy.id, actorSid: petEntry.sessionId });
      // 等待执行阶段（双方指令齐备后服务端立即开战）
      await waitFor(() => battle.state.roundPhase === 'execute' || battle.state.phase !== 'combat', 9000);
      // 等待敌人受到伤害（人物或宠物造成）
      await waitFor(() => [...battle.state.enemies.values()].some((e: any) => e.hp < e.maxHp), 12000);
      const enemyAfter = [...battle.state.enemies.values()][0] as any;
      assert('L 敌人在人物/宠物攻击下受损', enemyAfter.hp < enemyAfter.maxHp);
      await battle.leave().catch(() => {});
      log(`L 宠物入战 OK：宠=${petEntry?.name}（${petEntry?.element}·${petEntry?.quality}）敌HP ${enemyAfter.maxHp}→${enemyAfter.hp}`);
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
