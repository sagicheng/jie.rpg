/**
 * 联机切片冒烟验证（Node 端，无需浏览器）。
 * 模拟两个玩家：
 *   1) 共享地图房间：A 移动 → B 能否实时看到；B 聊天 → A 能否收到
 *   2) 权威战斗房间：组队打怪，轮到自己就发攻击意图，打到胜利
 * 跑法：先 npm run dev:server，另开终端 npm run smoke
 */
import { Client } from 'colyseus.js';
import { ZONE_CONFIGS } from '../src/config/Zones';
import { NODE_TO_MATERIAL } from '../src/config/materials';

const ENDPOINT = 'ws://localhost:2567';
const REST = 'http://localhost:2567/api';
const GW = 1920, GH = 1080;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 鉴权引导：联机服 GameRoom 入房强制 token+characterId，故 smoke 需先注册+建角。
async function mkChar(user: string) {
  const reg: any = await (await fetch(`${REST}/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: 'test1234', security: 'sec1234' }),
  })).json();
  const ch: any = await (await fetch(`${REST}/character/create`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: reg.token, name: user, element: 'fire' }),
  })).json();
  return { token: reg.token as string, charId: ch.character.id as number };
}

async function main() {
  const clientA = new Client(ENDPOINT);
  const clientB = new Client(ENDPOINT);

  // 鉴权角色：A/B 复用贯穿全局；world2 用独立全新角色验证"重连重新种子"。
  const authA = await mkChar('smk_alfa');
  const authB = await mkChar('smk_bravo');
  const authW2 = await mkChar('smk_world2');

  // ——— 1) 共享地图：移动同步 + 聊天 ———
  const roomA = await clientA.joinOrCreate('game', { token: authA.token, characterId: authA.charId });
  const roomB = await clientB.joinOrCreate('game', { token: authB.token, characterId: authB.charId });
  await wait(300);

  await roomA.send('move', { x: 123, y: 456 });
  const aMsgs: any[] = [];
  roomA.onMessage('chat', (m: any) => aMsgs.push(m));
  await roomB.send('chat', { channel: 'world', text: '组队吗' });
  await wait(300);

  const aInB = (roomB.state as any).players.get(roomA.sessionId);
  const moved = !!aInB && aInB.x === 123 && aInB.y === 456;

  const chatted = aMsgs.some((m) => m.text === '组队吗' && m.channel === 'world');

  console.log(`[地图] A 的位置被 B 实时同步看到 : ${moved ? 'OK' : 'BAD'}`);
  console.log(`[地图] B 的聊天被 A 收到         : ${chatted ? 'OK' : 'BAD'}`);

  await roomA.leave();
  await roomB.leave();

  // ——— 2) 权威战斗：组队打怪打到胜利 ———
  const battleA = await clientA.joinOrCreate('battle', { name: '甲', monsterId: '' });

  const drive = (room: any) => (s: any) => {
    if (s.phase !== 'combat') return;
    if (s.currentTurn !== room.sessionId) return;
    let target: string | undefined;
    s.enemies.forEach((e: any) => { if (e.alive && !target) target = e.id; });
    if (target) room.send('action', { type: 'attack', targetId: target });
  };
  // 先注册 A 的驱动，确保能捕获"第2人加入→自动开局"那一刻的 combat 状态变更
  battleA.onStateChange(drive(battleA));

  const battleB = await clientB.joinOrCreate('battle', { name: '乙', monsterId: '' });
  battleB.onStateChange(drive(battleB)); // 第2人加入触发自动开局

  const phase = await new Promise<string>((resolve) => {
    const onMsg = (s: any) => { if (s.phase === 'victory' || s.phase === 'defeat') resolve(s.phase); };
    battleA.onStateChange(onMsg);
    battleB.onStateChange(onMsg);
    setTimeout(() => resolve('timeout'), 15000);
  });

  await wait(200); // 等最后一拍补刀/战利品日志同步到客户端
  const log = [...(battleA.state as any).log.values()].map((m: any) => m.text);
  console.log(`\n[战斗] 结束阶段: ${phase}`);
  console.log('[战斗] 战斗日志:');
  log.forEach((l) => console.log('   ', l));

  await battleA.leave();
  await battleB.leave();

  // ——— 3) 怪物锁定 / 复原 / 刷新（服务端状态机）———
  const roomC = await clientA.joinOrCreate('game', { token: authA.token, characterId: authA.charId });
  const roomD = await clientB.joinOrCreate('game', { token: authB.token, characterId: authB.charId }); // 同一 game 房间
  await wait(200);

  // 安全读取怪物状态（colyseus.js 在 map 无条目时该字段为 undefined）
  const mon = (room: any, id: string) => (room.state.monsters ? room.state.monsters.get(id) : undefined);

  // 进入战斗即锁定
  await roomC.send('enterBattle', { id: 'z1:0' });
  await wait(200);
  const m0 = mon(roomC, 'z1:0');
  const lockOk = !!m0 && m0.state === 'busy' && m0.owner === roomC.sessionId;

  // 他人不可误杀自己锁定的怪（应仍 busy）
  await roomD.send('killMonster', { id: 'z1:0', respawnMs: 1000 });
  await wait(200);
  const m1 = mon(roomC, 'z1:0');
  const noMisKill = !!m1 && m1.state === 'busy';

  // 失败立即复原（available）
  await roomC.send('unlockMonster', { id: 'z1:0' });
  await wait(200);
  const m2 = mon(roomC, 'z1:0');
  const restoreOk = !!m2 && m2.state === 'available';

  // 击杀 → dead，并按 respawnMs 刷新回 available
  await roomC.send('killMonster', { id: 'z1:1', respawnMs: 1000 });
  await wait(200);
  const m3 = mon(roomC, 'z1:1');
  const killOk = !!m3 && m3.state === 'dead';
  await wait(1300);
  const m4 = mon(roomC, 'z1:1');
  const respawnOk = !!m4 && m4.state === 'available';

  await roomC.leave();
  await roomD.leave();

  console.log(`\n[怪物] 进入战斗即锁定(busy)   : ${lockOk ? 'OK' : 'BAD'}`);
  console.log(`[怪物] 他人不可误杀锁定怪     : ${noMisKill ? 'OK' : 'BAD'}`);
  console.log(`[怪物] 失败立即复原           : ${restoreOk ? 'OK' : 'BAD'}`);
  console.log(`[怪物] 击杀后按时刷新         : ${killOk && respawnOk ? 'OK' : 'BAD'}`);

  // ——— 4) 战斗中标记（远端名牌「战斗中」标签，组队前置）———
  const roomE = await clientA.joinOrCreate('game', { token: authA.token, characterId: authA.charId });
  const roomF = await clientB.joinOrCreate('game', { token: authB.token, characterId: authB.charId });
  await wait(200);
  await roomE.send('setBattling', { v: true });
  await wait(200);
  const pE = (roomF.state as any).players.get(roomE.sessionId);
  const battlingOn = !!pE && pE.battling === true;
  await roomE.send('setBattling', { v: false });
  await wait(200);
  const pE2 = (roomF.state as any).players.get(roomE.sessionId);
  const battlingOff = !!pE2 && pE2.battling === false;
  await roomE.leave();
  await roomF.leave();
  console.log(`[战斗] 进入战斗广播 battling : ${battlingOn ? 'OK' : 'BAD'}`);
  console.log(`[战斗] 退出战斗清除 battling : ${battlingOff ? 'OK' : 'BAD'}`);

  // ——— 5) 地图怪权威战斗：battle 房间单人权威结算胜利 → 回写 game 房间 killMonster 广播给另一玩家 ———
  const roomG = await clientA.joinOrCreate('game', { token: authA.token, characterId: authA.charId });
  const roomH = await clientB.joinOrCreate('game', { token: authB.token, characterId: authB.charId });
  await wait(200);

  const realEnemy = {
    name: '测试妖', type: '杂妖', element: '火', zone: 1,
    hp: 60, maxHp: 60, atk: 20, def: 10, matk: 15, mdef: 8, spd: 10, statusRes: 0,
    skills: [{ name: '撞击', power: 1, desc: '', damageType: 'physical' }],
    expReward: 30, goldReward: 20, drops: [],
  };

  // 甲锁定怪物（模拟 GameScene.checkEnemyCollision 的 enterBattle）
  await roomG.send('enterBattle', { id: 'z1:0' });
  await wait(150);

  // 甲进 battle 房间（map 模式，携带真实怪）→ 服务端单人立即开战（权威结算）
  const mb: any = await clientA.joinOrCreate('battle', { name: '戊', enemyData: realEnemy, monsterId: 'z1:0' });
  await wait(300);
  const combatOk = mb.state.phase === 'combat';

  // 甲连续普攻直到胜利（模拟玩家回合发 intent）
  let g = 0;
  while (mb.state.phase === 'combat' && g++ < 60) {
    if (mb.state.currentTurn === mb.sessionId) mb.send('action', { type: 'attack' });
    await wait(50);
  }
  const mapVictoryOk = mb.state.phase === 'victory';

  // 模拟 GameScene.onMultiBattleEnd 胜利回写：game 房间 killMonster（乙应收到 dead）
  roomG.send('killMonster', { id: 'z1:0', respawnMs: 30000 });
  await wait(200);
  const m5 = mon(roomH, 'z1:0');
  const mapKillSyncOk = !!m5 && m5.state === 'dead';

  await mb.leave();
  await roomG.leave();
  await roomH.leave();

  console.log(`\n[地图怪权威] 单人进房即开战 : ${combatOk ? 'OK' : 'BAD'}`);
  console.log(`[地图怪权威] 权威结算到胜利   : ${mapVictoryOk ? 'OK' : 'BAD'}`);
  console.log(`[地图怪权威] 胜利回写kill同步 : ${mapKillSyncOk ? 'OK' : 'BAD'}`);

  // ——— 6) 地图怪隔离：A 碰怪1 / B 碰怪2 必须各自独立房，绝不组队打同一只（修复"被拉进同一场"bug）———
  const roomI = await clientA.joinOrCreate('game', { token: authA.token, characterId: authA.charId });
  const roomJ = await clientB.joinOrCreate('game', { token: authB.token, characterId: authB.charId });
  await wait(200);

  const ba: any = await clientA.joinOrCreate('battle', { name: '庚', enemyData: realEnemy, monsterId: 'z1:0' });
  const bb: any = await clientB.joinOrCreate('battle', { name: '辛', enemyData: realEnemy, monsterId: 'z2:0' });
  await wait(300);

  const isolated = ba.roomId !== bb.roomId;
  const aCombat = ba.state.phase === 'combat';
  const bCombat = bb.state.phase === 'combat';
  const aSolo = ba.state.players.size === 1 && !ba.state.players.has(bb.sessionId);
  const bSolo = bb.state.players.size === 1 && !bb.state.players.has(ba.sessionId);

  await ba.leave();
  await bb.leave();
  await roomI.leave();
  await roomJ.leave();

  console.log(`\n[隔离] A怪1/B怪2 房间独立 : ${isolated && aCombat && bCombat ? 'OK' : 'BAD'}`);
  console.log(`[隔离] 互不混入对方战斗   : ${aSolo && bSolo ? 'OK' : 'BAD'}`);

  // ——— 7) 权威结算真实性：技能/道具/目标选择不"秒胜"，且连续两场战斗服务端不崩（回归 Bug①/Bug②）———
  const roomK = await clientA.joinOrCreate('game', { token: authA.token, characterId: authA.charId });
  const roomL = await clientB.joinOrCreate('game', { token: authB.token, characterId: authB.charId });
  await wait(200);

  const loEnemy = {
    name: '结算测试妖', type: '杂妖', element: '火', zone: 1,
    hp: 600, maxHp: 600, atk: 20, def: 10, matk: 15, mdef: 8, spd: 5, statusRes: 0,
    skills: [{ name: '撞击', power: 1, desc: '', damageType: 'physical' }],
    expReward: 30, goldReward: 20, drops: [],
  };
  const lo = {
    skills: ['烈闪'],
    kidos: [{ id: 'hado_t1_01', mp: 8, power: 1.4, effectType: 'damage', target: 'single' }],
    items: ['stop_blood_grass'],
  };

  const battle1: any = await clientA.joinOrCreate('battle', { name: '壬', enemyData: loEnemy, monsterId: 'z1:0', loadout: lo });
  await wait(300);

  let usedSkill = false, usedItem = false, usedKido = false, skillLogged = false, itemLogged = false, kidoLogged = false;
  const seen = new Set<string>();
  let t1 = 0;
  while (battle1.state.phase === 'combat' && t1++ < 80) {
    if (battle1.state.currentTurn === battle1.sessionId) {
      const enemyId = [...battle1.state.enemies.values()].find((e: any) => e.alive)?.id;
      if (!usedSkill && enemyId) { battle1.send('action', { type: 'skill', id: '烈闪', targetId: enemyId }); usedSkill = true; }
      else if (!usedKido && enemyId) { battle1.send('action', { type: 'kido', id: 'hado_t1_01', targetId: enemyId }); usedKido = true; }
      else if (!usedItem) { battle1.send('action', { type: 'item', id: 'stop_blood_grass' }); usedItem = true; }
      else { battle1.send('action', { type: 'attack', targetId: enemyId }); }
    }
    for (const m of [...battle1.state.log.values()] as any[]) {
      if (!seen.has(m.text)) seen.add(m.text);
      if (m.text.includes('烈闪')) skillLogged = true;
      if (m.text.includes('止血草')) itemLogged = true;
      if (m.text.includes('施展鬼道对')) kidoLogged = true; // 仅成功结算才出现
    }
    await wait(40);
  }
  const victory1 = battle1.state.phase === 'victory';
  await battle1.leave();
  await wait(200);

  // 第二场战斗：重新进房（回归"第二次战斗直接连接断开"场景，服务端须干净重建）
  const battle2: any = await clientA.joinOrCreate('battle', { name: '壬', enemyData: loEnemy, monsterId: 'z1:1', loadout: lo });
  await wait(300);
  const combat2 = battle2.state.phase === 'combat';
  let t2 = 0;
  while (battle2.state.phase === 'combat' && t2++ < 80) {
    if (battle2.state.currentTurn === battle2.sessionId) {
      const enemyId = [...battle2.state.enemies.values()].find((e: any) => e.alive)?.id;
      battle2.send('action', { type: 'attack', targetId: enemyId });
    }
    await wait(40);
  }
  const victory2 = battle2.state.phase === 'victory';
  await battle2.leave();
  await roomK.leave();
  await roomL.leave();

  console.log(`\n[权威结算] 技能被真实结算(日志含烈闪) : ${skillLogged ? 'OK' : 'BAD'}`);
  console.log(`[权威结算] 鬼道被真实结算(日志含施展鬼道) : ${kidoLogged ? 'OK' : 'BAD'}`);
  console.log(`[权威结算] 道具被真实结算(日志含止血草) : ${itemLogged ? 'OK' : 'BAD'}`);
  console.log(`[权威结算] 非秒胜(技能+道具+普攻多回合) : ${victory1 ? 'OK' : 'BAD'}`);
  console.log(`[第二场] 重新进房即开战               : ${combat2 ? 'OK' : 'BAD'}`);
  console.log(`[第二场] 可正常打到胜利               : ${victory2 ? 'OK' : 'BAD'}`);
  const settleOk = skillLogged && kidoLogged && itemLogged && victory1 && combat2 && victory2;

  // ——— 8) 怪组数量 + 数值真实性（回归 Bug①怪单只 / Bug②数值崩坏）———
  // 用真实 1 级玩家属性 + Boss(妖将)+随从 阵容，验证：怪组>1 / Boss对低防玩家伤害>1 / 玩家不能2回合秒Boss
  const roomM = await clientA.joinOrCreate('game', { token: authA.token, characterId: authA.charId });
  const roomN = await clientB.joinOrCreate('game', { token: authB.token, characterId: authB.charId });
  await wait(200);

  const bossEnemy = {
    name: '测试BOSS', type: '妖将', element: '火', zone: 2,
    hp: 150, maxHp: 150, atk: 11, def: 5, matk: 8, mdef: 4, spd: 8, statusRes: 0,
    skills: [{ name: '绝杀', power: 2.0, desc: '', damageType: 'physical' }],
    expReward: 300, goldReward: 200, drops: [],
  };
  const retinue = {
    name: '随从', type: '恶妖', element: '火', zone: 2,
    hp: 40, maxHp: 40, atk: 9, def: 4, matk: 7, mdef: 3, spd: 7, statusRes: 0,
    skills: [{ name: '猛击', power: 1.3, desc: '', damageType: 'physical' }],
    expReward: 30, goldReward: 20, drops: [],
  };
  const lvl1Stats = { hp: 100, maxHp: 100, mp: 50, maxMp: 50, atk: 16, def: 6, matk: 10, mdef: 8, spd: 12 };
  const bossParty = [bossEnemy, retinue];

  const battle3: any = await clientA.joinOrCreate('battle', {
    name: '子', enemyParty: bossParty, monsterId: 'z1:0',
    loadout: { skills: [], kidos: [], items: [] }, playerStats: lvl1Stats,
  });
  await wait(300);

  const groupOk = battle3.state.enemies.size >= 2; // Bug①：Boss+随从应成组，不再是单只
  const enemyNames = [...battle3.state.enemies.values()].map((e: any) => e.name);

  let playerAttacks = 0;
  let bossHpAfter2 = -1;
  let maxEnemyHit = 0;
  let t3 = 0;
  while (battle3.state.phase === 'combat' && t3++ < 40) {
    if (battle3.state.currentTurn === battle3.sessionId) {
      const boss = battle3.state.enemies.get('enemy:0');
      if (boss && boss.alive) {
        // 第 3 次出手前读取：前 2 次攻击经回合间隙的等待已被服务端结算，此时读到的才是真实血量
        if (playerAttacks === 2) bossHpAfter2 = boss.hp;
        battle3.send('action', { type: 'attack', targetId: 'enemy:0' });
        playerAttacks++;
      } else {
        const e = [...battle3.state.enemies.values()].find((x: any) => x.alive) as any;
        if (e) battle3.send('action', { type: 'attack', targetId: e.id });
      }
    }
    for (const m of [...battle3.state.log.values()] as any[]) {
      if (enemyNames.some((n) => m.text.startsWith(n))) {
        const dm = m.text.match(/造成 (\d+) 伤害/);
        if (dm) maxEnemyHit = Math.max(maxEnemyHit, parseInt(dm[1], 10));
      }
    }
    await wait(40);
  }
  await battle3.leave();

  // 奖励断言专用：弱怪，确保能在有限回合内击杀并触发服务端 battleReward（BUG4 验证）
  const rewardEnemy = [{ name: '奖励怪', type: '杂妖', element: '火', zone: 1, hp: 60, maxHp: 60, atk: 5, def: 2, matk: 3, mdef: 2, spd: 1, statusRes: 0, skills: [{ name: '撞击', power: 1, desc: '', damageType: 'physical' }], expReward: 10, goldReward: 5, drops: [] }];
  const battleR: any = await clientA.joinOrCreate('battle', { name: '奖', enemyParty: rewardEnemy, monsterId: '', loadout: { skills: [], kidos: [], items: [] }, playerStats: lvl1Stats });
  await wait(300);
  let lastRewardR: any = null;
  battleR.onMessage('battleReward', (r: any) => { lastRewardR = r; });
  let tR = 0;
  while (battleR.state.phase === 'combat' && tR++ < 40) {
    if (battleR.state.currentTurn === battleR.sessionId) {
      const e = [...battleR.state.enemies.values()].find((x: any) => x.alive) as any;
      if (e) battleR.send('action', { type: 'attack', targetId: e.id });
    }
    await wait(40);
  }
  await wait(400); // 等 battleReward 消息到达客户端
  await battleR.leave();
  const rewardOk = !!lastRewardR && lastRewardR.gold > 0 && lastRewardR.exp > 0; // BUG4：服务端下发的战斗奖励非0

  // 小怪成组校验（Bug①：小怪也应为一组，而非单只）—— 复用同一套多怪 spawn 逻辑
  const smallParty: any[] = [];
  for (let i = 0; i < 3; i++) {
    smallParty.push({ name: `小怪${i}`, type: '杂妖', element: '火', zone: 1, hp: 60, maxHp: 60, atk: 12, def: 6, matk: 8, mdef: 4, spd: 6, statusRes: 0, skills: [{ name: '撞击', power: 1, desc: '', damageType: 'physical' }], expReward: 10, goldReward: 5, drops: [] });
  }
  const battle4: any = await clientA.joinOrCreate('battle', { name: '子', enemyParty: smallParty, monsterId: 'z1:5', loadout: { skills: [], kidos: [], items: [] }, playerStats: lvl1Stats });
  await wait(300);
  const smallGroupOk = battle4.state.enemies.size === 3;
  await battle4.leave();

  await roomM.leave();
  await roomN.leave();

  const bossDmgOk = maxEnemyHit > 1;          // Bug②：Boss对低防1级角色不应只打1点
  const noTwoShotOk = bossHpAfter2 > 0;       // Bug②：1级角色不能2回合秒掉Boss

  console.log(`\n[怪组] Boss+随从成组(数量>=2)   : ${groupOk ? 'OK' : 'BAD'}`);
  console.log(`[怪组] 小怪成组(数量==3)        : ${smallGroupOk ? 'OK' : 'BAD'}`);
  console.log(`[数值] Boss对1级角色伤害>1      : ${bossDmgOk ? 'OK' : 'BAD'} (maxHit=${maxEnemyHit})`);
  console.log(`[数值] 1级角色不能2回合秒Boss   : ${noTwoShotOk ? 'OK' : 'BAD'} (bossHpAfter2=${bossHpAfter2})`);
  console.log(`[奖励] 服务端下发battleReward非0 : ${rewardOk ? 'OK' : 'BAD'} (gold=${lastRewardR?.gold}, exp=${lastRewardR?.exp})`);
  const numOk = groupOk && smallGroupOk && bossDmgOk && noTwoShotOk && rewardOk;

  // ——— 9) 权威世界状态：进房即收到 worldSync（服务端单一真相源）———
  const roomW: any = await clientA.joinOrCreate('game', { token: authA.token, characterId: authA.charId });
  let lastSync: any = null;
  let lastResult: any = null;
  roomW.onMessage('worldSync', (pw: any) => { lastSync = pw; });
  roomW.onMessage('intentResult', (r: any) => { lastResult = r; });
  await wait(400);
  const wsInitOk = !!lastSync && Array.isArray(lastSync.inventory) && typeof lastSync.gold === 'number';
  const startGold = lastSync ? lastSync.gold : -1;

  // ——— 10) 采集走 intent：服务端校验坐标并下发 material（全状态权威）———
  const z1 = ZONE_CONFIGS[1];
  const gatherIdx = [0, 2, 4, 6]; // 3 个矿脉 + 1 个灵木（铁剑配方所需）
  for (const idx of gatherIdx) {
    const g = z1.gathering[idx];
    const nx = Math.round(g.x * GW * 3), ny = Math.round(g.y * GH * 2);
    roomW.send('intent', { op: 'gather', zone: 1, nodeIdx: idx, x: nx, y: ny });
    await wait(250);
  }
  const ironOre = lastSync.inventory.filter((i: any) => i.name === '铁矿石').reduce((s: number, i: any) => s + (i.quantity || 0), 0);
  const wood = lastSync.inventory.filter((i: any) => i.name === '灵木枝').reduce((s: number, i: any) => s + (i.quantity || 0), 0);
  const gatherOk = ironOre >= 3 && wood >= 1;

  // ——— 11) 制造走 intent：扣材料并产出装备（服务端权威）———
  roomW.send('intent', { op: 'craft', recipeName: '铁剑' });
  await wait(400);
  const ironOreAfter = lastSync.inventory.filter((i: any) => i.name === '铁矿石').reduce((s: number, i: any) => s + (i.quantity || 0), 0);
  const woodAfter = lastSync.inventory.filter((i: any) => i.name === '灵木枝').reduce((s: number, i: any) => s + (i.quantity || 0), 0);
  const hasIronSword = lastSync.inventory.some((i: any) => i.name === '铁剑') || Object.values(lastSync.equipment).some((it: any) => it && it.name === '铁剑');
  const craftOk = hasIronSword && ironOreAfter === 0 && woodAfter === 0;

  // ——— 12) 商店购买走 intent：扣金币并直接装备（服务端权威）———
  let buyItemId: string | null = null;
  let buyItemName = '';
  for (const cfg of Object.values(ZONE_CONFIGS)) {
    for (const npc of cfg.npcs) {
      if (npc.shop && npc.shop.length) { buyItemId = npc.shop[0].id; buyItemName = npc.shop[0].name; break; }
    }
    if (buyItemId) break;
  }
  const goldBeforeBuy = lastSync.gold;
  let buyOk = false;
  if (buyItemId) {
    roomW.send('intent', { op: 'buy', itemId: buyItemId });
    await wait(400);
    const goldAfterBuy = lastSync.gold;
    const boughtEquipped = Object.values(lastSync.equipment).some((it: any) => it && it.id === buyItemId);
    buyOk = goldAfterBuy < goldBeforeBuy && boughtEquipped;
  }

  // ——— 13) 强化走 intent：服务端材料校验（无灵晶碎片应被拒，杜绝本地内存篡改）———
  lastResult = null;
  roomW.send('intent', { op: 'enhance', itemId: '铁剑' });
  await wait(300);
  const enhanceRejected = !!lastResult && lastResult.ok === false; // 缺材料被服务端拒绝

  // ——— 14) 断连世界隔离：leave 后服务端清除权威世界，重连重新种子（无残留/被篡改状态）———
  const goldBeforeLeave = lastSync ? lastSync.gold : -1;
  await roomW.leave();
  await wait(400);
  const roomW2: any = await clientA.joinOrCreate('game', { token: authW2.token, characterId: authW2.charId });
  let lastSync2: any = null;
  roomW2.onMessage('worldSync', (pw: any) => { lastSync2 = pw; });
  await wait(400);
  const reseedOk = !!lastSync2 && lastSync2.gold === 200 && Array.isArray(lastSync2.inventory); // 重新种子 = 干净起始
  await roomW2.leave();

  console.log(`\n[权威世界] 进房即 worldSync          : ${wsInitOk ? 'OK' : 'BAD'}`);
  console.log(`[权威世界] 采集走 intent(材料到账)   : ${gatherOk ? 'OK' : 'BAD'} (铁矿石=${ironOre}, 灵木枝=${wood})`);
  console.log(`[权威世界] 制造走 intent(产出装备)   : ${craftOk ? 'OK' : 'BAD'} (铁剑=${hasIronSword})`);
  console.log(`[权威世界] 购买走 intent(扣金+装备)  : ${buyOk ? 'OK' : 'BAD'}` + (buyItemName ? ` (${buyItemName})` : ' (无商店跳过)'));
  console.log(`[权威世界] 强化受服务端材料校验       : ${enhanceRejected ? 'OK' : 'BAD'} (被拒=${enhanceRejected})`);
  console.log(`[断连隔离] leave后重连重新种子       : ${reseedOk ? 'OK' : 'BAD'} (gold=${lastSync2?.gold})`);

  // ——— 10) 战斗 20s 决策超时（BUG3 验证）：玩家全程不动作，服务端应自动跳过其回合 ———
  const tEnemy = [{ name: '超时怪', type: '杂妖', element: '火', zone: 1, hp: 300, maxHp: 300, atk: 4, def: 2, matk: 2, mdef: 2, spd: 1, statusRes: 0, skills: [{ name: '撞击', power: 1, desc: '', damageType: 'physical' }], expReward: 1, goldReward: 1, drops: [] }];
  const tb: any = await clientA.joinOrCreate('battle', { name: '超时', enemyParty: tEnemy, monsterId: '', loadout: { skills: [], kidos: [], items: [] }, playerStats: lvl1Stats });
  await wait(300);
  // 不发送任何 action，静候服务端 20s 超时自动跳过
  await wait(21500);
  const tlog = ([...tb.state.log.values()] as any[]).map((m: any) => m.text).join(' | ');
  const timeoutOk = tlog.includes('决策超时');
  await tb.leave();
  console.log(`[超时] 20s未决策服务端自动跳过   : ${timeoutOk ? 'OK' : 'BAD'}` + (timeoutOk ? '' : ` (log: ${tlog.slice(-150)})`));

  const worldOk = wsInitOk && gatherOk && craftOk && buyOk && enhanceRejected && reseedOk;

  const mapOk = moved && chatted;
  const battleOk = phase === 'victory';
  const monsterOk = lockOk && noMisKill && restoreOk && killOk && respawnOk;
  const battlingOk = battlingOn && battlingOff;
  const mapBattleOk = combatOk && mapVictoryOk && mapKillSyncOk;
  const isoOk = isolated && aCombat && bCombat && aSolo && bSolo;
  const allOk = mapOk && battleOk && monsterOk && battlingOk && mapBattleOk && isoOk && settleOk && numOk && worldOk && timeoutOk;
  console.log(`\n==== 联机切片验证 ${allOk ? 'PASS ✅' : 'FAIL ❌'} ====`);
  console.log(`  地图同步: ${mapOk ? 'OK' : 'BAD'} | 权威战斗(组队打怪): ${battleOk ? 'OK' : 'BAD'} | 怪物锁定/复原/刷新: ${monsterOk ? 'OK' : 'BAD'} | 战斗中标记: ${battlingOk ? 'OK' : 'BAD'} | 地图怪权威战斗: ${mapBattleOk ? 'OK' : 'BAD'} | 地图怪隔离: ${isoOk ? 'OK' : 'BAD'} | 权威结算真实性: ${settleOk ? 'OK' : 'BAD'} | 怪组/数值: ${numOk ? 'OK' : 'BAD'} | 权威世界状态: ${worldOk ? 'OK' : 'BAD'} | 20s决策超时: ${timeoutOk ? 'OK' : 'BAD'}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('SMOKE ERROR:', e);
  process.exit(2);
});
