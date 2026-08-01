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

// ═══ 全局错误可视化（避免"异常打断渲染循环 → 静默卡死"难以排查）═══
// 背景：main.ts 上方已禁用 WebAudio 以防 AudioContext 卡死；但任何运行期异常
// （如 Boss 碰撞进入战斗时抛错）都会中断 Phaser 的 requestAnimationFrame 循环，
// 表现为"游戏直接卡死、任何操作无响应"。此处把未捕获异常/Promise rejection
// 直接渲染到屏幕上，便于真机第一时间看到堆栈（而不是对着黑屏猜）。
function showFatalOverlay(title: string, detail?: string): void {
  let el = document.getElementById('fatal-error-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fatal-error-overlay';
    el.style.cssText = 'position:fixed;left:0;top:0;right:0;z-index:2147483647;max-height:55vh;overflow:auto;background:rgba(24,0,0,0.94);color:#ff9a9a;font:12px/1.5 Consolas,Menlo,monospace;padding:14px 18px;white-space:pre-wrap;border-bottom:2px solid #ff4d4d;box-shadow:0 4px 18px rgba(0,0,0,0.6);';
    document.body.appendChild(el);
  }
  el.textContent = `⚠ ${title}${detail ? '\n\n' + detail : ''}\n\n[按 F5 刷新重试 · 请把这段报错发给开发]`;
}
(window as any).__fatal = showFatalOverlay;
window.addEventListener('error', (e: ErrorEvent) => {
  const err = (e as any).error ?? e;
  showFatalOverlay('运行期异常（渲染循环已中断）: ' + ((e as any).message || String(err)), (err as any)?.stack);
  console.error('[FATAL]', (e as any).error ?? e);
});
window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
  const r = (e as any).reason;
  showFatalOverlay('未处理的 Promise 拒绝: ' + (r?.message ?? String(r)), r?.stack);
  console.error('[FATAL] unhandledrejection', r);
});



// 联机：切除"窗口失焦/隐藏即暂停渲染"的监听，让后台窗口也持续重绘。
// 否则 Alt+Tab 切到另一个浏览器窗口时，本窗口 loop.inFocus=false、step() 直接 return，
// 远程玩家坐标虽然还在更新，但画布不刷新，肉眼看不到实时同步移动。
game.events.off(Phaser.Core.Events.BLUR, (game as any).onBlur, game);
game.events.off(Phaser.Core.Events.HIDDEN, (game as any).onHidden, game);

