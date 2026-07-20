/**
 * GameState — 全局游戏状态（单例）
 *
 * 架构：Mixin 模式组合 5 个子模块
 *   GameStateCore     — 基础数据（名称/坐标/区域/等级/金币）
 *   GameStateStats    — 战斗属性（HP/MP/ATK/DEF/加点/recalcStats/gainExp）
 *   GameStateQuest    — 任务系统（接取/进度/完成/追踪）
 *   GameStateBestiary — 妖魔图鉴（遭遇/击杀/层级奖励）
 *   GameStateUnlock   — 解锁标记（始解/卍解/完现术/圣文字/鬼道桥接）
 */
import { GameStateCoreMixin } from './GameStateCore';
import { GameStateStatsMixin } from './GameStateStats';
import { GameStateQuestMixin } from './GameStateQuest';
import { GameStateBestiaryMixin } from './GameStateBestiary';
import { GameStateUnlockMixin } from './GameStateUnlock';

class GameStateBase {}

const GameStateMixed = GameStateUnlockMixin(
  GameStateBestiaryMixin(
    GameStateQuestMixin(
      GameStateStatsMixin(
        GameStateCoreMixin(GameStateBase)
      )
    )
  )
);

class GameStateManager extends GameStateMixed {
  private static instance: GameStateManager;

  static get(): GameStateManager {
    if (!this.instance) this.instance = new GameStateManager();
    return this.instance;
  }

  /** 完全重置（调用所有子模块的 reset） */
  reset(): void {
    const self = this as GameStateManager & {
      resetCore(): void; resetStats(): void; resetQuest(): void;
      resetBestiary(): void; resetUnlock(): void;
    };
    self.resetCore();
    self.resetStats();
    self.resetQuest();
    self.resetBestiary();
    self.resetUnlock();
  }
}

export const GameState = GameStateManager.get();
