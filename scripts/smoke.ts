/**
 * 联机切片冒烟验证（Node 端，无需浏览器）。
 * 模拟两个玩家：
 *   1) 共享地图房间：A 移动 → B 能否实时看到；B 聊天 → A 能否收到
 *   2) 权威战斗房间：组队打怪，轮到自己就发攻击意图，打到胜利
 * 跑法：先 npm run dev:server，另开终端 npm run smoke
 */
import { Client } from 'colyseus.js';

const ENDPOINT = 'ws://localhost:2567';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const clientA = new Client(ENDPOINT);
  const clientB = new Client(ENDPOINT);

  // ——— 1) 共享地图：移动同步 + 聊天 ———
  const roomA = await clientA.joinOrCreate('game', { name: '甲' });
  const roomB = await clientB.joinOrCreate('game', { name: '乙' });
  await wait(300);

  await roomA.send('move', { x: 123, y: 456 });
  await roomB.send('chat', { text: '组队吗' });
  await wait(300);

  const aInB = (roomB.state as any).players.get(roomA.sessionId);
  const moved = !!aInB && aInB.x === 123 && aInB.y === 456;

  const msgs = [...(roomA.state as any).messages.values()] as any[];
  const chatted = msgs.some((m) => m.text === '组队吗');

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
  const roomC = await clientA.joinOrCreate('game', { name: '甲' });
  const roomD = await clientB.joinOrCreate('game', { name: '乙' }); // 同一 game 房间
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
  const roomE = await clientA.joinOrCreate('game', { name: '丙' });
  const roomF = await clientB.joinOrCreate('game', { name: '丁' });
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
  const roomG = await clientA.joinOrCreate('game', { name: '戊' });
  const roomH = await clientB.joinOrCreate('game', { name: '己' });
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
  const roomI = await clientA.joinOrCreate('game', { name: '庚' });
  const roomJ = await clientB.joinOrCreate('game', { name: '辛' });
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
  const roomK = await clientA.joinOrCreate('game', { name: '壬' });
  const roomL = await clientB.joinOrCreate('game', { name: '癸' });
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

  const mapOk = moved && chatted;
  const battleOk = phase === 'victory';
  const monsterOk = lockOk && noMisKill && restoreOk && killOk && respawnOk;
  const battlingOk = battlingOn && battlingOff;
  const mapBattleOk = combatOk && mapVictoryOk && mapKillSyncOk;
  const isoOk = isolated && aCombat && bCombat && aSolo && bSolo;
  const allOk = mapOk && battleOk && monsterOk && battlingOk && mapBattleOk && isoOk && settleOk;
  console.log(`\n==== 联机切片验证 ${allOk ? 'PASS ✅' : 'FAIL ❌'} ====`);
  console.log(`  地图同步: ${mapOk ? 'OK' : 'BAD'} | 权威战斗(组队打怪): ${battleOk ? 'OK' : 'BAD'} | 怪物锁定/复原/刷新: ${monsterOk ? 'OK' : 'BAD'} | 战斗中标记: ${battlingOk ? 'OK' : 'BAD'} | 地图怪权威战斗: ${mapBattleOk ? 'OK' : 'BAD'} | 地图怪隔离: ${isoOk ? 'OK' : 'BAD'} | 权威结算真实性: ${settleOk ? 'OK' : 'BAD'}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('SMOKE ERROR:', e);
  process.exit(2);
});
