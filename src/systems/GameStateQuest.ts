/**
 * GameState 任务系统模块
 */
import { QuestDef, MAIN_QUESTS } from './QuestData';

type Constructor<T = {}> = new (...args: any[]) => T;

export function GameStateQuestMixin<TBase extends Constructor>(Base: TBase) {
  return class GameStateQuest extends Base {
    activeQuest: string | null = null;
    questObjProgress: Record<string, number> = {};
    questCompleted: string[] = [];
    questReadyToComplete = false;
    collectProgress: Record<string, number> = {};
    killProgress: Record<string, number> = {};

    resetQuest(): void {
      this.activeQuest = null;
      this.questObjProgress = {};
      this.questCompleted = [];
      this.questReadyToComplete = false;
      this.collectProgress = {};
      this.killProgress = {};
    }

    acceptQuest(quest: QuestDef): void {
      this.activeQuest = quest.id;
      this.questObjProgress = {};
      for (const obj of quest.objectives) {
        this.questObjProgress[obj.target] = 0;
      }
      this.questReadyToComplete = false;
    }

    checkQuestComplete(quest: QuestDef): boolean {
      for (const obj of quest.objectives) {
        const prog = this.questObjProgress[obj.target] || 0;
        if (prog < obj.count) return false;
      }
      return true;
    }

    updateQuestProgress(type: string, target: string, amount: number = 1): void {
      if (!this.activeQuest) return;

      if (type === 'kill') {
        this.killProgress[target] = (this.killProgress[target] || 0) + amount;
        if (target !== 'any') {
          this.killProgress['any'] = (this.killProgress['any'] || 0) + amount;
        }
      }
      if (type === 'collect') {
        this.collectProgress[target] = (this.collectProgress[target] || 0) + amount;
      }

      const questDef = this.getActiveQuestDef();
      if (!questDef) return;

      let matched = false;
      for (const obj of questDef.objectives) {
        if (obj.type === type && (obj.target === target || obj.target === 'any')) {
          this.questObjProgress[target] = (this.questObjProgress[target] || 0) + amount;
          matched = true;
        }
      }
      if (type === 'kill' && target !== 'any') {
        const anyObj = questDef.objectives.find(o => o.target === 'any');
        if (anyObj) {
          this.questObjProgress['any'] = (this.questObjProgress['any'] || 0) + amount;
          matched = true;
        }
      }

      if (matched) {
        this.questReadyToComplete = this.checkQuestComplete(questDef);
      }
    }

    completeQuest(questId: string): void {
      if (!this.questCompleted.includes(questId)) {
        this.questCompleted.push(questId);
      }
      this.activeQuest = null;
      this.questObjProgress = {};
      this.questReadyToComplete = false;
    }

    getActiveQuestDef(): QuestDef | null {
      if (!this.activeQuest) return null;
      return MAIN_QUESTS[this.activeQuest] || null;
    }

    get completedCount(): number {
      return this.questCompleted.length;
    }

    getQuestTrackText(): string {
      if (this.questReadyToComplete && this.activeQuest === 'village_threat') {
        return '任务完成！回去找守卫队长交任务。';
      }
      const questDef = this.getActiveQuestDef();
      if (!questDef) return '';

      const parts: string[] = [];
      for (const obj of questDef.objectives) {
        const prog = this.questObjProgress[obj.target] || 0;
        parts.push(`${obj.desc} ${prog}/${obj.count}`);
      }
      return `★ ${questDef.name}: ${parts.join(' | ')}`;
    }
  };
}
