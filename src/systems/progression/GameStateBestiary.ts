/**
 * GameState 妖魔图鉴模块
 */
import { getBestiaryTierReached, BESTIARY_TIERS, BESTIARY_TITLES, NAMED_ENEMIES, TitleDef } from './BestiaryData';
import { Constructor } from '../../core/types';

export function GameStateBestiaryMixin<TBase extends Constructor>(Base: TBase) {
  return class GameStateBestiary extends Base {
    bestiaryEncountered: string[] = [];
    bestiaryKilled: Record<string, number> = {};
    bestiaryTierClaimed: number[] = [];

    //  称号系统
    /** 已解锁称号id列表 */
    unlockedTitles: string[] = [];
    /** 当前装备的称号id（null=无） */
    activeTitle: string | null = null;
    /** 待播报的新解锁称号（战斗胜利时结算） */
    pendingTitleNotifications: string[] = [];

    resetBestiary(): void {
      this.bestiaryEncountered = [];
      this.bestiaryKilled = {};
      this.bestiaryTierClaimed = [];
      this.unlockedTitles = [];
      this.activeTitle = null;
      this.pendingTitleNotifications = [];
    }

    recordEncounter(enemyName: string): void {
      if (!this.bestiaryEncountered.includes(enemyName)) {
        this.bestiaryEncountered.push(enemyName);
      }
    }

    recordKill(enemyName: string): void {
      this.recordEncounter(enemyName);
      this.bestiaryKilled[enemyName] = (this.bestiaryKilled[enemyName] || 0) + 1;
      this.evaluateTitleUnlocks();
    }

    claimBestiaryTierReward(tierId: number): boolean {
      if (this.bestiaryTierClaimed.includes(tierId)) return false;
      const reached = getBestiaryTierReached(this.bestiaryKilled);
      if (reached < tierId) return false;

      this.bestiaryTierClaimed.push(tierId);
      const tier = BESTIARY_TIERS.find(t => t.id === tierId);
      if (!tier) return false;

      if (tier.reward.statPoints) (this as any).statPoints += tier.reward.statPoints;
      if (tier.reward.gold) (this as any).gold += tier.reward.gold;
      if (tier.reward.exp) (this as any).gainExp(tier.reward.exp);
      return true;
    }

    //  称号系统

    /** 收集种类数 = 已遭遇妖魔种类数 */
    getTitleCollectedCount(): number {
      return this.bestiaryEncountered.length;
    }

    /** 是否击败了全部妖将 */
    private getAllGeneralsKilled(): boolean {
      const generals = Object.values(NAMED_ENEMIES).filter(e => e.type === '妖将');
      return generals.length > 0 && generals.every(e => (this.bestiaryKilled[e.name] || 0) > 0);
    }

    /** 是否全收集（击败了全部具名妖魔） */
    private isFullCollection(): boolean {
      const names = Object.keys(NAMED_ENEMIES);
      return names.length > 0 && names.every(n => (this.bestiaryKilled[n] || 0) > 0);
    }

    /** 判断单个称号是否已达成解锁条件 */
    private isTitleUnlocked(def: TitleDef): boolean {
      if (def.manualOnly) return false; // 仅能由特定途径手动解锁（如行会商店）
      if (def.requireFull) return this.isFullCollection();
      if (def.requireAllGenerals) {
        return this.getTitleCollectedCount() >= def.requiredCollected && this.getAllGeneralsKilled();
      }
      return this.getTitleCollectedCount() >= def.requiredCollected;
    }

    /** 评估并解锁达成条件的称号，返回新解锁的称号名（用于播报） */
    evaluateTitleUnlocks(): string[] {
      const newly: string[] = [];
      for (const def of BESTIARY_TITLES) {
        if (!this.unlockedTitles.includes(def.id) && this.isTitleUnlocked(def)) {
          this.unlockedTitles.push(def.id);
          newly.push(def.name);
        }
      }
      if (newly.length) this.pendingTitleNotifications.push(...newly);
      return newly;
    }

    /** 装备/切换称号（点击已装备的称号则卸下） */
    setActiveTitle(id: string | null): void {
      if (id !== null && !this.unlockedTitles.includes(id)) return;
      this.activeTitle = (this.activeTitle === id) ? null : id;
      (this as any).recalcStats();
    }

    /** 当前装备称号定义 */
    getActiveTitleDef(): TitleDef | null {
      if (!this.activeTitle) return null;
      return BESTIARY_TITLES.find(t => t.id === this.activeTitle) || null;
    }

    /** 当前装备称号的全属性加成（百分比） */
    getActiveTitleAllStatsPct(): number {
      return this.getActiveTitleDef()?.allStatsPct || 0;
    }

    /** 当前装备称号对指定敌人类型的伤害乘算（无加成返回1.0） */
    getTitleDamageMult(enemyType: string): number {
      const t = this.getActiveTitleDef();
      if (!t || !t.enemyTypeDamage) return 1.0;
      return t.enemyTypeDamage.type === enemyType ? t.enemyTypeDamage.mult : 1.0;
    }

    /** 取称号在UI上的状态（解锁与否 + 进度文本） */
    getTitleStatus(def: TitleDef): { unlocked: boolean; progress: string } {
      if (def.manualOnly) {
        // 手动解锁型：不显示图鉴收集进度，避免误导
        const owned = this.unlockedTitles.includes(def.id);
        return { unlocked: owned, progress: owned ? (this.activeTitle === def.id ? '已装备' : '已解锁') : '公会商店兑换' };
      }
      if (this.unlockedTitles.includes(def.id)) {
        return { unlocked: true, progress: this.activeTitle === def.id ? '已装备' : '已解锁' };
      }
      const collected = this.getTitleCollectedCount();
      const total = Object.keys(NAMED_ENEMIES).length;
      const killed = Object.keys(this.bestiaryKilled).length;
      if (def.requireFull) {
        return { unlocked: false, progress: `全收集 ${killed}/${total}` };
      }
      if (def.requireAllGenerals) {
        const generals = Object.values(NAMED_ENEMIES).filter(e => e.type === '妖将');
        const generalsKilled = generals.filter(e => (this.bestiaryKilled[e.name] || 0) > 0).length;
        return { unlocked: false, progress: `收集 ${collected}/${def.requiredCollected} · 妖将 ${generalsKilled}/${generals.length}` };
      }
      return { unlocked: false, progress: `收集 ${collected}/${def.requiredCollected}` };
    }

    /** 取出并清空待播报的新解锁称号 */
    drainTitleNotifications(): string[] {
      const out = [...this.pendingTitleNotifications];
      this.pendingTitleNotifications = [];
      return out;
    }
  };
}
