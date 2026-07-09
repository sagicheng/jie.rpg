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
  const battleA = await clientA.joinOrCreate('battle', { name: '甲' });

  const drive = (room: any) => (s: any) => {
    if (s.phase !== 'combat') return;
    if (s.currentTurn !== room.sessionId) return;
    let target: string | undefined;
    s.enemies.forEach((e: any) => { if (e.alive && !target) target = e.id; });
    if (target) room.send('action', { type: 'attack', targetId: target });
  };
  // 先注册 A 的驱动，确保能捕获"第2人加入→自动开局"那一刻的 combat 状态变更
  battleA.onStateChange(drive(battleA));

  const battleB = await clientB.joinOrCreate('battle', { name: '乙' });
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

  const mapOk = moved && chatted;
  const battleOk = phase === 'victory';
  const monsterOk = lockOk && noMisKill && restoreOk && killOk && respawnOk;
  const battlingOk = battlingOn && battlingOff;
  const allOk = mapOk && battleOk && monsterOk && battlingOk;
  console.log(`\n==== 联机切片验证 ${allOk ? 'PASS ✅' : 'FAIL ❌'} ====`);
  console.log(`  地图同步: ${mapOk ? 'OK' : 'BAD'} | 权威战斗(组队打怪): ${battleOk ? 'OK' : 'BAD'} | 怪物锁定/复原/刷新: ${monsterOk ? 'OK' : 'BAD'} | 战斗中标记: ${battlingOk ? 'OK' : 'BAD'}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('SMOKE ERROR:', e);
  process.exit(2);
});
