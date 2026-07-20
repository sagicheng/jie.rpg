/**
 * GameState 解锁系统模块 — 六大力量体系：始解/卍解/虚化/完现术/圣文字/狱解
 */
import { Constructor } from '../core/types';

export function GameStateUnlockMixin<TBase extends Constructor>(Base: TBase) {
  return class GameStateUnlock extends Base {
    unlocks: string[] = [];

    resetUnlock(): void {
      this.unlocks = [];
    }

    addUnlock(key: string): void {
      if (!this.unlocks.includes(key)) {
        this.unlocks.push(key);
      }
    }

    hasUnlock(key: string): boolean {
      return this.unlocks.includes(key);
    }

    // ═══ 六大力量体系 ═══
    get hasShikai(): boolean { return this.unlocks.includes('shikai'); }
    get hasBankai(): boolean { return this.unlocks.includes('bankai'); }
    get hasHollow(): boolean { return this.unlocks.includes('hollow'); }
    get hasFullbring(): boolean { return this.unlocks.includes('fullbring'); }
    get hasSchrift(): boolean { return this.unlocks.includes('schrift'); }
    get hasHell(): boolean { return this.unlocks.includes('hell'); }
  };
}
