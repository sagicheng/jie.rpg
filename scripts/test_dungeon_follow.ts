/**
 * 副本组队跟随 诊断测试（真机）。
 * 验证两件事，定位用户反馈的「不跟随队长 / 看不到对方」根因：
 *   1) 同 dungeonId 的 joinOrCreate('dungeon') 是否落到【同一个房间实例】（filterBy 合并）。
 *   2) 队长 claimStage 推进 stage 后，队员的 dungeonRoom.state.stage 是否自动同步（跟随）。
 *   3) dungeonRoom.state.players 是否同时含双方（决定副本内能否渲染远端队友）。
 * 运行：先 npm run dev:server，另开终端 npx tsx scripts/test_dungeon_follow.ts
 */
import { Client } from 'colyseus.js';

const ENDPOINT = 'ws://localhost:2567';
const REST = 'http://localhost:2567/api';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = () => Math.random().toString(36).slice(2, 8);
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('TIMEOUT: ' + label)), ms))]);
}
// 全局硬超时：防止某处 await 永久挂起导致测试卡死（必须先退出拿结果）
setTimeout(() => { console.error('\n!!! HARD TIMEOUT 45s — test aborted (likely a hung await)'); process.exit(3); }, 45000);

let failed = false;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('  FAIL:', msg); failed = true; }
  else console.log('  ok  :', msg);
}

async function api(path: string, body: any): Promise<any> {
  const res = await fetch(REST + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await res.json()) as any;
  if (!j.ok) throw new Error(`${path} failed: ${j.msg || res.status}`);
  return j;
}

async function makeAccount(suffix: string) {
  const account = `reg_${suffix}`;
  const r = await api('/register', { username: account, password: 'pw123456', security: 'sp123456' });
  const token = r.token;
  const elements = ['火', '水', '木', '雷', '土', '虚'];
  const el = elements[Math.floor(Math.random() * elements.length)];
  const c = await api('/character/create', { token, name: `角_${suffix}`, element: el });
  return { token, characterId: c.character.id };
}

async function main() {
  const clientA = new Client(ENDPOINT);
  const clientB = new Client(ENDPOINT);
  const a = await makeAccount('F_' + rnd());
  const b = await makeAccount('F_' + rnd());

  // 先连 game 房，把两个玩家登记进 world（world.enterDungeon 需要 pw 存在）
  const gA: any = await clientA.joinOrCreate('game', { token: a.token, characterId: a.characterId });
  const gB: any = await clientB.joinOrCreate('game', { token: b.token, characterId: b.characterId });
  await wait(400);

  // 监听 worldSync 缓存最新 gold/exp（验奖励是否落到双方本体世界）
  const A: { gold: number; exp: number } = { gold: 0, exp: 0 };
  const B: { gold: number; exp: number } = { gold: 0, exp: 0 };
  gA.onMessage('worldSync', (pw: any) => { A.gold = pw.gold; A.exp = pw.exp; });
  gB.onMessage('worldSync', (pw: any) => { B.gold = pw.gold; B.exp = pw.exp; });
  // 触发一次 intent 拿到基线 worldSync
  gA.send('intent', { op: 'ping' });
  gB.send('intent', { op: 'ping' });
  await wait(300);
  const goldA0 = A.gold, expA0 = A.exp, goldB0 = B.gold, expB0 = B.exp;
  console.log(`  info: 基线 gold A=${goldA0} B=${goldB0}  exp A=${expA0} B=${expB0}`);
  // 监听 claimStageReward（验全队发奖）
  let rewardA: any = null, rewardB: any = null;

  // ══════ 两人各自进同一 dungeonId 的副本房（模拟客户端 connectDungeonRoom）═════
  console.log('\n[1] 同 dungeonId 房间合并 (filterBy)');
  const dA: any = await clientA.joinOrCreate('dungeon', {
    dungeonId: 1, gameSid: gA.sessionId, name: 'A',
  });
  const dB: any = await clientB.joinOrCreate('dungeon', {
    dungeonId: 1, gameSid: gB.sessionId, name: 'B',
  });
  await wait(500);

  assert(!!dA.roomId && !!dB.roomId, `两边均成功进副本房 (A=${dA.roomId?.slice(0, 6)} B=${dB.roomId?.slice(0, 6)})`);
  assert(dA.roomId === dB.roomId, '同 dungeonId → 落到【同一房间实例】(合并 OK)');

  const playersA = dA.state?.players ? [...dA.state.players.values()] : [];
  const playersB = dB.state?.players ? [...dB.state.players.values()] : [];
  console.log('  info: dA.players =', playersA.map((p: any) => p.name), '| dB.players =', playersB.map((p: any) => p.name));
  assert(playersA.length >= 2 && playersB.length >= 2, 'dungeonRoom.state.players 同时含双方（远端渲染可行）');

  // ══════ 队长 claimStage 推进 stage，看队员是否跟随 + 奖励是否全队发放 ═════
  console.log('\n[2] 队长推进 stage → 队员跟随 + 全队发奖 (Bug2)');
  const stageA0 = dA.state?.stage, stageB0 = dB.state?.stage;
  assert(stageA0 === stageB0, `两人初始 stage 一致 (A=${stageA0} B=${stageB0})`);

  dA.onMessage('claimStageReward', (d: any) => { rewardA = d; });
  dB.onMessage('claimStageReward', (d: any) => { rewardB = d; });

  // 自适应初始 stage（避免上一次测试残留的副本房状态污染）
  dA.send('claimStage', { stage: stageA0 });
  await wait(600);
  // 重新拉 worldSync 确认奖励已落到双方本体世界
  gA.send('intent', { op: 'ping' });
  gB.send('intent', { op: 'ping' });
  await wait(300);

  const stageA1 = dA.state?.stage, stageB1 = dB.state?.stage;
  console.log(`  info: claimStage 后 A.stage=${stageA1} B.stage=${stageB1} | rewardA=${JSON.stringify(rewardA)} rewardB=${JSON.stringify(rewardB)}`);
  assert(stageA1 === stageA0 + 1, `队长 A 推进到 stage ${stageA0 + 1}`);
  assert(stageB1 === stageA0 + 1, `队员 B 的 stage 自动同步到 ${stageA0 + 1}（跟随 OK）`);
  // Bug2：奖励必须全队发放
  assert(!!rewardA && rewardA.gold > 0 && rewardA.exp > 0, `队长 A 收到 claimStageReward (gold=${rewardA?.gold} exp=${rewardA?.exp})`);
  assert(!!rewardB && rewardB.gold > 0, `队员 B 也收到 claimStageReward（全队发奖 ✅）(gold=${rewardB?.gold})`);
  assert(rewardB.gold === rewardA.gold && rewardB.exp === rewardA.exp, `B 与 A 奖励金额一致 (B=${rewardB.gold}/${rewardB.exp})`);
  assert(A.gold === goldA0 + rewardA.gold, `A 本体 gold ${goldA0}→${A.gold} (+${rewardA.gold})`);
  assert(B.gold === goldB0 + rewardB.gold, `B 本体 gold ${goldB0}→${B.gold} (+${rewardB.gold}) ✅`);
  assert(A.exp === expA0 + rewardA.exp, `A 本体 exp ${expA0}→${A.exp} (+${rewardA.exp})`);
  assert(B.exp === expB0 + rewardB.exp, `B 本体 exp ${expB0}→${B.exp} (+${rewardB.exp}) ✅`);

  // ══════ 位置同步（队友可见的基础）═════
  console.log('\n[3] 位置同步 (move → state.players.x/y)');
  dA.send('move', { x: 123, y: 456 });
  await wait(400);
  const pa = dB.state?.players?.get(dA.sessionId);
  assert(!!pa && pa.x === 123 && pa.y === 456, `A 上报位置后 B 的 state 中 A 坐标同步 (x=${pa?.x} y=${pa?.y})`);
  const paColor = dA.state?.players?.get(dA.sessionId)?.color;
  console.log('  info: A 自身 color =', paColor);

  // ══════ [4] 队长开战 → 队员被拉进同一 battle room 共斗（方案 B 核心）═════
  console.log('\n[4] 队长开战 → 队员拉入同一 battle room');
  // 4.0 先组队：dungeonEnterBattle 广播依赖 team 关系（team.members 遍历）
  let teamId = '';
  gB.onMessage('inviteReceived', (d: any) => {
    teamId = d.teamId;
    gB.send('respondInvite', { teamId: d.teamId, accept: true });
  });
  let gotTeam = false;
  gA.onMessage('teamUpdate', () => { gotTeam = true; });
  gA.send('invite', { targetSid: gB.sessionId });
  await wait(500);
  assert(gotTeam && !!teamId, `A 与 B 已组队 (teamId=${teamId?.slice(0, 6)})`);

  // 4.1 队长 game 房发 dungeonEnterBattle → 队员 game 房收 enterTeamDungeonBattle
  let gotPull = false;
  gB.onMessage('enterTeamDungeonBattle', (d: any) => {
    if (d.dungeonId === 1 && d.stage === 1) gotPull = true;
  });
  // 模拟 DungeonMapScene.enterBattle 末尾的广播（走 game 房，不是 dungeon 房）
  gA.send('dungeonEnterBattle', { dungeonId: 1, stage: 1 });
  await wait(400);
  assert(gotPull, '队员 B 收到 enterTeamDungeonBattle{dungeonId:1,stage:1}（开战广播 ✅）');

  // 4.2 双方 joinOrCreate 同一 battle room（monsterId=dungeon:1:1 + dungeonRoomId 同源去重）
  const battleMonsterId = `dungeon:1:1`;
  const dungeonRoomId = dA.roomId;
  let batA: any = null, batB: any = null;
  try {
    batA = await withTimeout(clientA.joinOrCreate('battle', {
      name: 'A', ownerSessionId: gA.sessionId, monsterId: battleMonsterId,
      dungeonId: 1, dungeonStage: 1, dungeonRoomId,
      enemyParty: [{ id: 'e1', name: '测试妖', hp: 10, atk: 1, def: 1, spd: 1, expReward: 10, goldReward: 6, level: 1, type: '妖', skills: [] }],
    }), 6000, 'batA join');
    await wait(300);
    batB = await withTimeout(clientB.joinOrCreate('battle', {
      name: 'B', ownerSessionId: gB.sessionId, monsterId: battleMonsterId,
      dungeonId: 1, dungeonStage: 1, dungeonRoomId,
    }), 6000, 'batB join');
    await wait(400);
    assert(batA.roomId === batB.roomId, `A 与 B 进入同一 battle room (${batA.roomId} === ${batB.roomId} ✅)`);
    assert((batA.state?.players?.size ?? 0) >= 2, `battle room 内含双方玩家 (players=${batA.state?.players?.size} ✅)`);
    console.log(`  info: 共享 battle room=${batA.roomId}, 同场玩家数=${batA.state?.players?.size}`);
  } catch (e: any) {
    assert(false, `battle room 共斗链路异常: ${e?.message || e}`);
  }
  // ══════ [5] 队长返回广播 → 队员收 teamExitBattleEnd（方案B返回同步核心）═════
  console.log('\n[5] 队长返回 → 队员收 teamExitBattleEnd 广播');
  let gotExit = false;
  gB.onMessage('teamExitBattleEnd', () => { gotExit = true; });
  gA.send('teamExitBattle'); // 队长从 game 房发起返回广播（headless 验证服务端分发）
  await wait(400);
  assert(gotExit, '队员 B 收到 teamExitBattleEnd（队长返回广播 ✅）');

  if (batA) await batA.leave().catch(() => {});
  if (batB) await batB.leave().catch(() => {});

  await dA.leave();
  await dB.leave();
  await gA.leave();
  await gB.leave();

  console.log(failed ? '\n=== DUNGEON FOLLOW DIAGNOSE FAILED ❌ ===' : '\n=== DUNGEON FOLLOW DIAGNOSE PASSED ✅ ===');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('DIAGNOSE ERROR:', e);
  process.exit(2);
});
