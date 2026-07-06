/**
 * GameState 核心模块 — 基础数据、坐标、等级、金币、重置
 */
import { Inventory } from './Inventory';
import { Kido } from './Kido';

type Constructor<T = {}> = new (...args: any[]) => T;

export function GameStateCoreMixin<TBase extends Constructor>(Base: TBase) {
  return class GameStateCore extends Base {
    playerName = '隐世';
    playerGender: 'male' | 'female' = 'male';
    zone = 1;
    discoveredZones: number[] = [1];
    level = 1;
    exp = 0;
    statPoints = 0;
    hasCreated = false;
    newGame = false;
    gold = 0;
    x = 400;
    y = 500;

    /** 重置核心数据 */
    resetCore(): void {
      this.playerName = '';
      this.level = 1; this.exp = 0; this.statPoints = 0;
      this.gold = 0; this.x = 400; this.y = 500; this.zone = 1;
      this.hasCreated = false; this.newGame = true;
      this.discoveredZones = [1];
      Inventory.reset();
      Kido.reset();
    }
  };
}
