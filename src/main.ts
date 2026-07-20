/**
 * 客户端入口
 * 创建 Phaser.Game 实例、注册所有场景、启动游戏引导。
 */

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './config/config';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { GameScene } from './scenes/GameScene';
import { CreateCharacterScene } from './scenes/CreateCharacterScene';
import { BattleScene } from './scenes/BattleScene';
import { MultiBattleScene } from './scenes/MultiBattleScene';
import { PvpBattleScene } from './scenes/PvpBattleScene';
import { DungeonMapScene } from './scenes/DungeonMapScene';
import { UIScene } from './scenes/UIScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#1a1a2e',
  parent: 'game-container',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: [BootScene, TitleScene, CreateCharacterScene, GameScene, BattleScene, DungeonMapScene, MultiBattleScene, PvpBattleScene, UIScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  render: {
    pixelArt: false,
    antialias: true,
    roundPixels: false,
  },
  // 游戏完全不用音频，禁用 Web Audio 系统，避免浏览器自动播放策略在
  // scene.launch 异步 create() 中创建 AudioContext 被挂起 → 真实 Chrome 下
  // 抛错中断渲染循环导致画面冻结（表现为"卡死" + AudioContext 警告）。
  audio: {
    disableWebAudio: true,
  },
};

const game = new Phaser.Game(config);



// 联机：切除"窗口失焦/隐藏即暂停渲染"的监听，让后台窗口也持续重绘。
// 否则 Alt+Tab 切到另一个浏览器窗口时，本窗口 loop.inFocus=false、step() 直接 return，
// 远程玩家坐标虽然还在更新，但画布不刷新，肉眼看不到实时同步移动。
game.events.off(Phaser.Core.Events.BLUR, (game as any).onBlur, game);
game.events.off(Phaser.Core.Events.HIDDEN, (game as any).onHidden, game);

