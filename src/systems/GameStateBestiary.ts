/**
 * GameState 妖魔图鉴模块
 */
import { getBestiaryTierReached, BESTIARY_TIERS } from './BestiaryData';
import { Constructor } from '../types';

export function GameStateBestiaryMixin<TBase extends Constructor>(Base: TBase) {
  return class GameStateBestiary extends Base {
    bestiaryEncountered: string[] = [];
    bestiaryKilled: Record<string, number> = {};
    bestiaryTierClaimed: number[] = [];

    resetBestiary(): void {
      this.bestiaryEncountered = [];
      this.bestiaryKilled = {};
      this.bestiaryTierClaimed = [];
    }

    recordEncounter(enemyName: string): void {
      if (!this.bestiaryEncountered.includes(enemyName)) {
        this.bestiaryEncountered.push(enemyName);
      }
    }

    recordKill(enemyName: string): void {
      this.recordEncounter(enemyName);
      this.bestiaryKilled[enemyName] = (this.bestiaryKilled[enemyName] || 0) + 1;
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
  };
}
