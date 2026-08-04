/**
 * WorldService 任务+副本子系统
 */
import { MAIN_QUESTS, SIDE_QUESTS, DAILY_QUESTS, WEEKLY_QUESTS, DAILY_CAP, WEEKLY_CAP, todayStr, weekStr } from '../../../src/managers/QuestData';

const ALL_QUESTS = { ...MAIN_QUESTS, ...SIDE_QUESTS, ...DAILY_QUESTS, ...WEEKLY_QUESTS };
const DUNGEON_WEEKLY_CAP = 3;

export function updateQuest(scene: any, pw: any, type: string, target: string, amount: number): void {
  const key = `${type}:${target}`;
  pw.quests[key] = (pw.quests[key] || 0) + amount;
}

export function claimQuest(scene: any, pw: any, questId: string): any {
  const q = (ALL_QUESTS as any)[questId];
  if (!q) return { ok: false, msg: '\u672a\u77e5\u4efb\u52a1' };
  if (q.type === 'daily') {
    const t = todayStr();
    if (pw.dailyClaimed.date !== t) pw.dailyClaimed = { date: t, ids: [] };
    if (pw.dailyClaimed.ids.includes(questId)) return { ok: false, msg: '\u4eca\u65e5\u5df2\u5b8c\u6210' };
    if (pw.dailyClaimed.ids.length >= DAILY_CAP) return { ok: false, msg: '\u4eca\u65e5\u5b8c\u6210\u4e0a\u9650' };
    const r = q.rewards || {};
    if (r.gold) scene.addGold(pw, r.gold);
    if (r.exp) scene.gainExp(pw, r.exp);
    if (r.items) for (const it of r.items) scene.grantItem(pw, { id: it.id, name: it.name, type: 'consumable', desc: '', quantity: it.count });
    if (r.unlock) scene.addUnlock(pw, r.unlock);
    pw.dailyClaimed.ids.push(questId);
    return { ok: true, msg: `\u9886\u53d6\u5956\u52b1\uff1a${r.gold ? '\u91d1\u5e01+' + r.gold + ' ' : ''}${r.exp ? '\u7ecf\u9a8c+' + r.exp : ''}`, type: q.type, data: r };
  }
  if (q.type === 'weekly') {
    const w = weekStr();
    if (pw.weeklyClaimed.week !== w) pw.weeklyClaimed = { week: w, ids: [] };
    if (pw.weeklyClaimed.ids.includes(questId)) return { ok: false, msg: '\u672c\u5468\u5df2\u5b8c\u6210' };
    if (pw.weeklyClaimed.ids.length >= WEEKLY_CAP) return { ok: false, msg: '\u672c\u5468\u5b8c\u6210\u4e0a\u9650' };
    const r = q.rewards || {};
    if (r.gold) scene.addGold(pw, r.gold);
    if (r.exp) scene.gainExp(pw, r.exp);
    if (r.items) for (const it of r.items) scene.grantItem(pw, { id: it.id, name: it.name, type: 'consumable', desc: '', quantity: it.count });
    if (r.unlock) scene.addUnlock(pw, r.unlock);
    pw.weeklyClaimed.ids.push(questId);
    return { ok: true, msg: `\u9886\u53d6\u5956\u52b1\uff1a${r.gold ? '\u91d1\u5e01+' + r.gold + ' ' : ''}${r.exp ? '\u7ecf\u9a8c+' + r.exp : ''}`, type: q.type, data: r };
  }
  if (pw.completedQuests.includes(questId)) return { ok: false, msg: '\u5df2\u5b8c\u6210' };
  const r = q.rewards || {};
  if (r.gold) scene.addGold(pw, r.gold);
  if (r.exp) scene.gainExp(pw, r.exp);
  if (r.items) for (const it of r.items) scene.grantItem(pw, { id: it.id, name: it.name, type: 'consumable', desc: '', quantity: it.count });
  if (r.unlock) scene.addUnlock(pw, r.unlock);
  pw.completedQuests.push(questId);
  return { ok: true, msg: `\u9886\u53d6\u5956\u52b1\uff1a${r.gold ? '\u91d1\u5e01+' + r.gold + ' ' : ''}${r.exp ? '\u7ecf\u9a8c+' + r.exp : ''}`, type: q.type, data: r };
}

export function enterDungeon(scene: any, pw: any, dungeonId: number): any {
  scene.refreshDungeonWeekly(pw);
  if (pw.dungeon && pw.dungeon.dungeonId === dungeonId) {
    return { ok: true, msg: '\u7ee7\u7eed\u526f\u672c', data: { resumed: true, remaining: DUNGEON_WEEKLY_CAP - pw.dungeonWeekly.count } };
  }
  if (pw.dungeonWeekly.count >= DUNGEON_WEEKLY_CAP) {
    return { ok: false, msg: '\u672c\u5468\u526f\u672c\u6b21\u6570\u5df2\u7528\u5b8c\uff08\u5171\u4eab3\u6b21\uff09' };
  }
  pw.dungeonWeekly.count += 1;
  pw.dungeon = { dungeonId, stage: 1 };
  return { ok: true, msg: '\u8fdb\u5165\u526f\u672c', data: { resumed: false, remaining: DUNGEON_WEEKLY_CAP - pw.dungeonWeekly.count } };
}

export function completeDungeon(scene: any, pw: any, dungeonId: number): void {
  if (pw.dungeon && pw.dungeon.dungeonId === dungeonId) pw.dungeon = null;
}
