/**
 * 阶段③ 独立副本系统 —— 服务端逻辑单元测试
 * 验证 WorldService.enterDungeon / completeDungeon 的周共享 3 次计次规则：
 *  - 进入新副本计 1 次，remaining = 3 - count
 *  - 续打同副本免费（不计次，data.resumed=true）
 *  - 满 3 次后拒绝新进入（已有活动副本进度保留）
 *  - 通关清除活动副本，但本周次数不退回
 *  - 跨周（weekStr 不同）自动重置次数
 * 运行：npx tsx scripts/test_dungeon.ts
 */
import { WorldService } from '../server/world';
import { weekStr } from '../src/systems/QuestData';

const svc = new WorldService();
const pw = svc.get('test-dungeon-sid');

let failed = false;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); failed = true; }
  else console.log('ok  :', msg);
}
const rem = (r: any) => (r.data ? r.data.remaining : undefined);

// 1) 初始状态
assert(pw.dungeon === null, 'initial dungeon is null');
assert(pw.dungeonWeekly.count === 0, 'initial weekly count = 0');

// 2) 进入副本1 → 计 1 次，remaining 2
const r1 = svc.enterDungeon(pw, 1);
assert(r1.ok === true, 'enter dungeon 1 ok');
assert(pw.dungeonWeekly.count === 1, 'count = 1 after first enter');
assert(rem(r1) === 2, 'remaining = 2 after first enter');
assert(pw.dungeon?.dungeonId === 1, 'active dungeon = 1');

// 3) 续打同副本1 → 免费，不计次
const r2 = svc.enterDungeon(pw, 1);
assert(r2.ok === true, 're-enter dungeon 1 ok');
assert(r2.data?.resumed === true, 're-enter flagged resumed=true');
assert(pw.dungeonWeekly.count === 1, 'count unchanged on resume (still 1)');

// 4) 切到副本2 → 计 2 次，remaining 1
const r3 = svc.enterDungeon(pw, 2);
assert(r3.ok === true, 'enter dungeon 2 ok');
assert(pw.dungeonWeekly.count === 2, 'count = 2 after switching to dungeon 2');
assert(pw.dungeon?.dungeonId === 2, 'active dungeon switched to 2');
assert(rem(r3) === 1, 'remaining = 1');

// 5) 进入副本3 → 计 3 次，满
const r4 = svc.enterDungeon(pw, 3);
assert(r4.ok === true, 'enter dungeon 3 ok');
assert(pw.dungeonWeekly.count === 3, 'count = 3 (cap reached)');
assert(rem(r4) === 0, 'remaining = 0');

// 6) 满后进入副本4 → 拒绝，保留活动副本与次数
const r5 = svc.enterDungeon(pw, 4);
assert(r5.ok === false, 'enter dungeon 4 rejected at cap');
assert(pw.dungeonWeekly.count === 3, 'count unchanged after rejection');
assert(pw.dungeon?.dungeonId === 3, 'active dungeon still 3 after rejected enter');

// 7) 通关副本3 → 清除活动副本；周次仍满
svc.completeDungeon(pw, 3);
assert(pw.dungeon === null, 'dungeon cleared after completeDungeon(3)');
assert(pw.dungeonWeekly.count === 3, 'weekly count preserved after complete (no refund)');

// 8) 通关后仍满 → 无法进入新副本
const r6 = svc.enterDungeon(pw, 1);
assert(r6.ok === false, 'cannot enter new dungeon after cap even if cleared');

// 9) 周次隔离：模拟旧周已用满，跨周自动重置
pw.dungeonWeekly = { week: '2000-01-01', count: 3 };
const r7 = svc.enterDungeon(pw, 1);
assert(r7.ok === true, 'new-week auto-resets cap');
assert(pw.dungeonWeekly.week === weekStr(), 'week updated to current week');
assert(pw.dungeonWeekly.count === 1, 'count reset to 1 in new week');

console.log(failed ? '\n=== SOME DUNGEON TESTS FAILED ===' : '\n=== ALL DUNGEON TESTS PASSED ===');
process.exit(failed ? 1 : 0);
