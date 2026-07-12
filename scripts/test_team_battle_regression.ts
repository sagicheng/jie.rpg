/**
 * 组队战斗回归测试（真机：起服务端 + 双客户端走 REST 注册/建角）。
 *
 * 覆盖用户第④点「组队战斗还有没有隐藏 BUG」回归发现的 2 个隐藏 bug 的修复路径：
 *   Bug A（副本战斗奖励丢失）：DungeonMapScene 未把 ownerSessionId 传进 battle 房，
 *         导致 BattleRoom 把 exp/金币写进 battle 房间幽灵世界，玩家本体世界不变。
 *         → 验证：副本胜利后，本体世界 worldSync 的 exp/gold 精确增加 baseExp/baseGold。
 *   Bug B（副本升级提示永远 false）：BattleRoom.checkVictory 副本分支用
 *         world.gainExp(pw,0) > 0 判定 → 恒 false（且传了 0 经验）。
 *         → 验证：副本胜利发的 battleReward.exp === baseExp（非 0），且 leveled 与真实升级一致。
 *   另覆盖①独立组队面板依赖的底层广播：队长 teamEnterDungeon → 队员收到 enterTeamDungeon。
 *
 * 运行：先 npm run dev:server，另开终端 npx tsx scripts/test_team_battle_regression.ts
 */
import { Client } from 'colyseus.js';

const ENDPOINT = 'ws://localhost:2567';
const REST = 'http://localhost:2567/api';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = () => Math.random().toString(36).slice(2, 8);

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
  const a = await makeAccount('A_' + rnd());
  const b = await makeAccount('B_' + rnd());

  // ════════════ Part 1：组队跟随进副本广播 ════════════
  console.log('\n[1] 组队跟随进副本 (teamEnterDungeon 广播)');
  const roomA: any = await clientA.joinOrCreate('game', { token: a.token, characterId: a.characterId });
  const roomB: any = await clientB.joinOrCreate('game', { token: b.token, characterId: b.characterId });
  await wait(300);

  let teamId = '';
  let gotInvite = false;
  roomB.onMessage('inviteReceived', (d: any) => { gotInvite = true; teamId = d.teamId; });
  let teamUpdated = false;
  let bInTeam = false;
  roomA.onMessage('teamUpdate', (d: any) => { if (d.members.some((m: any) => m.sid === roomB.sessionId)) teamUpdated = true; });
  roomB.onMessage('teamUpdate', (d: any) => { if (d.members.some((m: any) => m.sid === roomB.sessionId)) bInTeam = true; });

  roomA.send('invite', { targetSid: roomB.sessionId });
  await wait(300);
  assert(gotInvite, '队员 B 收到 inviteReceived');
  assert(teamId.length > 0, 'inviteReceived 携带 teamId');

  roomB.send('respondInvite', { teamId, accept: true });
  await wait(300);
  assert(teamUpdated, 'A 收到 teamUpdate 且含 B');
  assert(bInTeam, 'B 在队伍成员列表中');

  let gotEnter = false;
  let enterDungeonId = 0;
  roomB.onMessage('enterTeamDungeon', (d: any) => { gotEnter = true; enterDungeonId = d.dungeonId; });
  roomA.send('teamEnterDungeon', { dungeonId: 1 });
  await wait(300);
  assert(gotEnter, '队员 B 收到 enterTeamDungeon 广播（组队跟随进副本）');
  assert(enterDungeonId === 1, '广播 dungeonId === 1');

  await roomA.leave();
  await roomB.leave();
  await wait(200);

  // ════════════ Part 2a：副本战斗奖励写回本体（小怪，无升级，精确 exp）— Bug A ════════════
  console.log('\n[2a] 副本战斗奖励写回本体世界（小怪，不升级）— Bug A 回归');
  const gA: any = await clientA.joinOrCreate('game', { token: a.token, characterId: a.characterId });
  let sync: any = null;
  gA.onMessage('worldSync', (pw: any) => { sync = pw; });
  await wait(500);
  const startExp = sync.exp, startGold = sync.gold, startLevel = sync.level;
  assert(typeof startExp === 'number' && typeof startGold === 'number', `进房即 worldSync(exp=${startExp}, gold=${startGold}, lv=${startLevel})`);

  const smallEnemy = [{
    name: '回归小妖', type: '杂妖', element: '火', zone: 1,
    hp: 60, maxHp: 60, atk: 5, def: 2, matk: 3, mdef: 2, spd: 1, statusRes: 0,
    skills: [{ name: '撞击', power: 1, desc: '', damageType: 'physical' }],
    expReward: 10, goldReward: 10, drops: [],
  }];

  const batA: any = await clientA.joinOrCreate('battle', {
    name: '勇者', enemyParty: smallEnemy, monsterId: '', loadout: { skills: [], kidos: [], items: [] },
    dungeonId: 1, dungeonStage: 1, ownerSessionId: gA.sessionId,
  });
  await wait(300);
  let rewardA: any = null;
  batA.onMessage('battleReward', (r: any) => { rewardA = r; });

  // 指令阶段直接提交攻击（真实客户端是"指令阶段点按钮发 action"，
  // 不依赖 currentTurn===sessionId——currentTurn 在指令阶段显示的是上一回合最后行动者）。
  const dlA = Date.now() + 45000;
  while (batA.state.phase === 'combat' && Date.now() < dlA) {
    if (batA.state.roundPhase === 'command') {
      const e = [...batA.state.enemies.values()].find((x: any) => x.alive) as any;
      if (e) batA.send('action', { type: 'attack', targetId: e.id });
    }
    await wait(60);
  }
  await wait(400);
  assert(batA.state.phase === 'victory', '副本战斗(小妖)打到胜利');
  assert(!!rewardA, '收到 battleReward 消息');
  const baseExpA = Math.round(10 * 0.5);  // 5
  const baseGoldA = Math.round(10 * 0.5); // 5
  if (rewardA) {
    assert(rewardA.exp === baseExpA, `副本奖励 exp === ${baseExpA}（Bug B 修复前为 0）`);
    assert(rewardA.gold === baseGoldA, `副本奖励 gold === ${baseGoldA}`);
    assert(rewardA.leveled === false, '小妖不升级 → leveled === false（Bug B 修正）');
  }
  await batA.leave();

  // 触发 game 房 worldSync 刷新，验证奖励落到本体世界（Bug A）
  await wait(200);
  gA.send('intent', { op: 'gather', zone: 1, nodeIdx: 0, x: 100, y: 100 });
  await wait(500);
  const endExpA = sync.exp, endGoldA = sync.gold, endLevelA = sync.level;
  assert(endGoldA === startGold + baseGoldA, `本体世界 gold 精确 +${baseGoldA}（${startGold}→${endGoldA}）[Bug A：修复前写幽灵世界→不变]`);
  assert(endExpA === startExp + baseExpA, `本体世界 exp 精确 +${baseExpA}（${startExp}→${endExpA}）[Bug A]`);
  assert(endLevelA === startLevel, '小妖战后等级未变');
  await gA.leave();

  // ════════════ Part 2b：副本战斗升级判定（大怪，必升级）— Bug B ════════════
  console.log('\n[2b] 副本战斗升级判定（大怪，必升级）— Bug B 回归');
  const gB: any = await clientB.joinOrCreate('game', { token: b.token, characterId: b.characterId });
  let syncB: any = null;
  gB.onMessage('worldSync', (pw: any) => { syncB = pw; });
  await wait(500);
  const startLevelB = syncB.level, startExpB = syncB.exp;

  const bigEnemy = [{
    name: '回归BOSS', type: '妖将', element: '火', zone: 1,
    hp: 60, maxHp: 60, atk: 5, def: 2, matk: 3, mdef: 2, spd: 1, statusRes: 0,
    skills: [{ name: '撞击', power: 1, desc: '', damageType: 'physical' }],
    expReward: 100000, goldReward: 100000, drops: [],
  }];

  const batB: any = await clientB.joinOrCreate('battle', {
    name: '勇者', enemyParty: bigEnemy, monsterId: '', loadout: { skills: [], kidos: [], items: [] },
    dungeonId: 1, dungeonStage: 1, ownerSessionId: gB.sessionId,
  });
  await wait(300);
  let rewardB: any = null;
  batB.onMessage('battleReward', (r: any) => { rewardB = r; });

  const dlB = Date.now() + 45000;
  while (batB.state.phase === 'combat' && Date.now() < dlB) {
    if (batB.state.roundPhase === 'command') {
      const e = [...batB.state.enemies.values()].find((x: any) => x.alive) as any;
      if (e) batB.send('action', { type: 'attack', targetId: e.id });
    }
    await wait(60);
  }
  await wait(400);
  assert(batB.state.phase === 'victory', '副本战斗(BOSS)打到胜利');
  assert(!!rewardB, '收到 battleReward 消息');
  if (rewardB) {
    assert(rewardB.exp === Math.round(100000 * 0.5), `副本奖励 exp === ${Math.round(100000 * 0.5)}（大量经验已发放，非 0）`);
    assert(rewardB.leveled === true, '大经验 → leveled === true（Bug B 修正：原恒 false）');
  }
  await batB.leave();

  await wait(200);
  gB.send('intent', { op: 'gather', zone: 1, nodeIdx: 0, x: 100, y: 100 });
  await wait(500);
  const endLevelB = syncB.level;
  assert(endLevelB > startLevelB, `大经验战后等级提升（${startLevelB}→${endLevelB}）`);
  if (rewardB) assert(rewardB.leveled === (endLevelB > startLevelB), 'leveled 标记与真实升级一致 [Bug B]');
  await gB.leave();

  console.log(failed ? '\n=== TEAM BATTLE REGRESSION FAILED ❌ ===' : '\n=== TEAM BATTLE REGRESSION PASSED ✅ ===');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('REGRESSION ERROR:', e);
  process.exit(2);
});
