import { GameStateQuestMixin } from '../src/managers/GameStateQuest';
import { rollDailyPool, rollWeeklyPool, todayStr, weekStr, getQuestDef, DAILY_QUESTS, WEEKLY_QUESTS } from '../src/managers/QuestData';

class Base {}
const GS = GameStateQuestMixin(Base);
const g: any = new GS();
g.ensureDailyRefresh(); // 模拟游戏启动刷新（设置 dailyState.date = today）

let failed = false;
function assert(cond: boolean, msg: string) { if (!cond) { console.error('FAIL:', msg); failed = true; } else console.log('ok  :', msg); }

// 1) 确定性日期池
const d1 = rollDailyPool();
const d2 = rollDailyPool();
assert(d1.length === 3, 'daily pool size = 3');
assert(JSON.stringify(d1) === JSON.stringify(d2), 'daily pool deterministic (same day)');
assert(d1.every((id: string) => !!DAILY_QUESTS[id]), 'daily pool ids valid');
const w1 = rollWeeklyPool();
assert(w1.length === 3, 'weekly pool size = 3');
assert(w1.every((id: string) => !!WEEKLY_QUESTS[id]), 'weekly pool ids valid');
assert(todayStr().length === 10 && weekStr().length === 10, 'date strings YYYY-MM-DD');

// 2) 多任务并存
const dq = getQuestDef(d1[0])!;
const mq = getQuestDef('ch1_hollow_threat')!;
g.acceptQuest(dq);
g.acceptQuest(mq);
assert(g.activeQuests.length === 2, 'two active quests coexist');

// 3) 进度按目标独立累加，互不干扰
const obj0 = dq.objectives[0];
g.updateQuestProgress(obj0.type, obj0.target, obj0.count);
assert(g.isQuestReady(d1[0]), 'daily ready after meeting its objective');
assert(!g.isQuestReady('ch1_hollow_threat'), 'main quest unaffected by daily progress');

// 4) 完成日常 → 归档到 dailyState.completed，移出活跃
g.completeActiveQuest(d1[0]);
assert(!g.isQuestActive(d1[0]), 'daily removed from active');
assert(g.dailyState.completed.includes(d1[0]), 'daily marked completed today');

// 5) 同日刷新保留；跨天清空（含进度与已领）
g.ensureDailyRefresh();
assert(g.dailyState.completed.includes(d1[0]), 'same-day refresh keeps completed');
assert(g.isQuestActive('ch1_hollow_threat'), 'main quest survives daily refresh');
g.dailyState.date = '2000-01-01';
g.ensureDailyRefresh();
assert(!g.dailyState.completed.includes(d1[0]), 'new-day refresh clears completed');
assert(g.dailyState.date === todayStr(), 'dailyState.date reset to today');

// 6) 修正旧 bug：kill 'any' 目标单倍累加（不双计）
g.acceptQuest(getQuestDef('shikai_trial')!);
g.updateQuestProgress('kill', '低级虚', 1);
assert(g.questProgress['shikai_trial']['any'] === 1, "kill 'any' single increment (no double count)");
g.completeActiveQuest('shikai_trial');

// 7) weekly 归档路径
const wq = getQuestDef(w1[0])!;
g.acceptQuestById(w1[0]);
assert(g.weeklyState.taken.includes(w1[0]), 'weekly taken recorded');
for (const o of wq.objectives) g.updateQuestProgress(o.type, o.target, o.count);
assert(g.isQuestReady(w1[0]), 'weekly ready after objectives met');
g.completeActiveQuest(w1[0]);
assert(g.weeklyState.completed.includes(w1[0]), 'weekly marked completed this week');

console.log(failed ? '\n=== SOME TESTS FAILED ===' : '\n=== ALL TESTS PASSED ===');
process.exit(failed ? 1 : 0);
