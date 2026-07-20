/**
 * 开发测试：服务端每日 / 周常任务发放与重复领取校验（Node 端，无需浏览器）
 */

import { WorldService } from '../server/core/world';
import { rollDailyPool, rollWeeklyPool } from '../src/managers/QuestData';

const svc = new WorldService();
const pw = svc.get('sid1');

let failed = false;
function assert(c: boolean, m: string) { if (!c) { console.error('FAIL:', m); failed = true; } else console.log('ok  :', m); }

const dpool = rollDailyPool();
const wpool = rollWeeklyPool();
const dq = dpool[0];
const wq = wpool[0];

// 日常重复领取应被拒
const r1 = svc.claimQuest(pw, dq);
assert(r1.ok, `daily first claim ok (${r1.msg})`);
const r2 = svc.claimQuest(pw, dq);
assert(!r2.ok && r2.msg === '今日已完成', `daily second claim rejected (${r2.msg})`);

// 周常重复领取应被拒
const w1 = svc.claimQuest(pw, wq);
assert(w1.ok, `weekly first claim ok (${w1.msg})`);
const w2 = svc.claimQuest(pw, wq);
assert(!w2.ok && w2.msg === '本周已完成', `weekly second claim rejected (${w2.msg})`);

// 主线重复领取应被拒（走 completedQuests）
const m1 = svc.claimQuest(pw, 'ch1_hollow_threat');
assert(m1.ok, `main claim ok (${m1.msg})`);
const m2 = svc.claimQuest(pw, 'ch1_hollow_threat');
assert(!m2.ok && m2.msg === '已完成', `main second claim rejected (${m2.msg})`);

// 未知任务
const u = svc.claimQuest(pw, 'no_such_quest');
assert(!u.ok && u.msg === '未知任务', 'unknown quest rejected');

// 当日全部池可领取（池3 < 上限5）——用全新 world 避免与上面已领的 dq 冲突
const svc2 = new WorldService();
const pw2 = svc2.get('sid2');
let okCount = 0;
for (const id of dpool) { if (svc2.claimQuest(pw2, id).ok) okCount++; }
assert(okCount === dpool.length, `all ${dpool.length} daily claimable same day (got ${okCount})`);

console.log(failed ? '\n=== SERVER TESTS FAILED ===' : '\n=== SERVER TESTS PASSED ===');
process.exit(failed ? 1 : 0);
