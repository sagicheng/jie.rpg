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

  const mapOk = moved && chatted;
  const battleOk = phase === 'victory';
  console.log(`\n==== 联机切片验证 ${mapOk && battleOk ? 'PASS ✅' : 'FAIL ❌'} ====`);
  console.log(`  地图同步: ${mapOk ? 'OK' : 'BAD'} | 权威战斗(组队打怪): ${battleOk ? 'OK' : 'BAD'}`);
  process.exit(mapOk && battleOk ? 0 : 1);
}

main().catch((e) => {
  console.error('SMOKE ERROR:', e);
  process.exit(2);
});
