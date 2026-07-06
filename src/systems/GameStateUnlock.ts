/**
 * GameState 解锁系统模块 — 始解/卍解/完现术/圣文字 + 鬼道桥接
 */
import { Kido, KidoSchool } from './Kido';

type Constructor<T = {}> = new (...args: any[]) => T;

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

    get hasShikai(): boolean {
      return this.unlocks.includes('shikai');
    }

    get hasBankai(): boolean {
      return this.unlocks.includes('bankai');
    }

    get hasFullbring(): boolean {
      return this.unlocks.includes('fullbring');
    }

    get hasSchrift(): boolean {
      return this.unlocks.includes('schrift');
    }

    // 鬼道桥接（保持向后兼容）
    get kidoSchool(): KidoSchool | null { return Kido.school; }
    set kidoSchool(s: KidoSchool | null) { Kido.school = s; }
    get equippedKido(): string[] { return Kido.equipped; }
  };
}
