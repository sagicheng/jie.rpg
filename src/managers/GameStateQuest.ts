/**
 * GameState 任务系统模块（多任务队列）
 * ----------------------------------------------------------------
 * 主线 / 支线 / 日常 / 周常 并存于 activeQuests，进度按 questId 独立跟踪。
 * 日常/周常 按本地日期自动刷新（ensureDailyRefresh / ensureWeeklyRefresh），
 * 跨天清空进行中与「今日已领」，避免重复领奖。
 */
import { QuestDef, ALL_QUESTS, DAILY_QUESTS, WEEKLY_QUESTS, todayStr, weekStr, DAILY_CAP, WEEKLY_CAP } from './QuestData';
import { Constructor } from '../core/types';

export function GameStateQuestMixin<TBase extends Constructor>(Base: TBase) {
  return class GameStateQuest extends Base {
    activeQuests: string[] = [];
    questProgress: Record<string, Record<string, number>> = {};
    questCompleted: string[] = [];
    dailyState: { date: string; taken: string[]; completed: string[] } = { date: '', taken: [], completed: [] };
    weeklyState: { week: string; taken: string[]; completed: string[] } = { week: '', taken: [], completed: [] };

    resetQuest(): void {
      this.activeQuests = [];
      this.questProgress = {};
      this.questCompleted = [];
      this.dailyState = { date: '', taken: [], completed: [] };
      this.weeklyState = { week: '', taken: [], completed: [] };
    }

    isQuestActive(id: string): boolean {
      return this.activeQuests.includes(id);
    }

    getQuestDef(id: string): QuestDef | null {
      return ALL_QUESTS[id] || null;
    }

    /** 接取任务（可并存多个），仅初始化该任务自身进度。 */
    acceptQuest(quest: QuestDef): void {
      if (this.activeQuests.includes(quest.id)) return;
      this.activeQuests.push(quest.id);
      if (!this.questProgress[quest.id]) {
        const init: Record<string, number> = {};
        for (const obj of quest.objectives) init[obj.target] = 0;
        this.questProgress[quest.id] = init;
      }
    }

    /** 按 id 接取（任务板用），并记录 taken 用于面板显示。 */
    acceptQuestById(id: string): void {
      const q = this.getQuestDef(id);
      if (!q) return;
      if (q.type === 'daily' && !this.dailyState.taken.includes(id)) this.dailyState.taken.push(id);
      if (q.type === 'weekly' && !this.weeklyState.taken.includes(id)) this.weeklyState.taken.push(id);
      this.acceptQuest(q);
    }

    /** 该任务目标是否全部达成。 */
    isQuestReady(id: string): boolean {
      const q = this.getQuestDef(id);
      if (!q) return false;
      const prog = this.questProgress[id] || {};
      for (const obj of q.objectives) {
        if ((prog[obj.target] || 0) < obj.count) return false;
      }
      return true;
    }

    /**
     * 进度更新：遍历所有活跃任务，匹配 type + (target | 'any') 的目标累加。
     * 修正旧逻辑「any 目标双计数」的 bug——每个目标仅 +amount 一次。
     */
    updateQuestProgress(type: string, target: string, amount: number = 1): void {
      for (const id of this.activeQuests) {
        const q = this.getQuestDef(id);
        if (!q) continue;
        const prog = this.questProgress[id] || (this.questProgress[id] = {});
        for (const obj of q.objectives) {
          if (obj.type !== type) continue;
          if (obj.target === target || obj.target === 'any') {
            prog[obj.target] = (prog[obj.target] || 0) + amount;
          }
        }
      }
    }

    /** 完成（移除活跃 + 按类型归档到已完成/每日完成/每周完成）。 */
    completeActiveQuest(id: string): void {
      const q = this.getQuestDef(id);
      this.activeQuests = this.activeQuests.filter(x => x !== id);
      delete this.questProgress[id];
      if (!q) return;
      if (q.type === 'daily') {
        if (!this.dailyState.completed.includes(id)) this.dailyState.completed.push(id);
      } else if (q.type === 'weekly') {
        if (!this.weeklyState.completed.includes(id)) this.weeklyState.completed.push(id);
      } else {
        if (!this.questCompleted.includes(id)) this.questCompleted.push(id);
      }
    }

    /** 单个任务追踪文本。 */
    getQuestTrackFor(id: string): string {
      const q = this.getQuestDef(id);
      if (!q) return '';
      const prog = this.questProgress[id] || {};
      const parts = q.objectives.map(o => `${o.desc} ${Math.min(prog[o.target] || 0, o.count)}/${o.count}`);
      return `★ ${q.name}: ${parts.join(' | ')}`;
    }

    /** 全部活跃任务追踪文本（HUD 用）。 */
    getQuestTrackText(): string {
      if (this.activeQuests.length === 0) return '无活跃任务';
      return this.activeQuests.map(id => this.getQuestTrackFor(id)).join('\n');
    }

    /** 是否有任意活跃主线（用于自动接取链判定）。 */
    hasActiveMainQuest(): boolean {
      return this.activeQuests.some(id => {
        const q = this.getQuestDef(id);
        return !!q && q.type === 'main';
      });
    }

    // ——— 每日 / 周常 刷新（按本地日期）———
    ensureDailyRefresh(): void {
      const today = todayStr();
      if (this.dailyState.date === today) return;
      const ids = Object.keys(DAILY_QUESTS);
      this.activeQuests = this.activeQuests.filter(x => !ids.includes(x));
      for (const id of ids) delete this.questProgress[id];
      this.dailyState = { date: today, taken: [], completed: [] };
    }

    ensureWeeklyRefresh(): void {
      const week = weekStr();
      if (this.weeklyState.week === week) return;
      const ids = Object.keys(WEEKLY_QUESTS);
      this.activeQuests = this.activeQuests.filter(x => !ids.includes(x));
      for (const id of ids) delete this.questProgress[id];
      this.weeklyState = { week, taken: [], completed: [] };
    }

    canTakeDaily(id: string): boolean {
      if (this.dailyState.completed.includes(id)) return false;
      return this.dailyState.completed.length < DAILY_CAP;
    }

    canTakeWeekly(id: string): boolean {
      if (this.weeklyState.completed.includes(id)) return false;
      return this.weeklyState.completed.length < WEEKLY_CAP;
    }

    get completedCount(): number {
      return this.questCompleted.length;
    }
  };
}
