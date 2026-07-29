/**
 * 斩魄刀立绘懒加载器
 *
 * 背景：72 张立绘（36 把刀 × 始解/卍解）总计 ~13MB，若全在 BootScene 预载会严重拖慢
 * 启动加载页。但任意时刻玩家只需要「当前所选那把刀」的 2 张图，因此改为按需懒加载：
 * 仅在立绘区要显示时才加载，且只加载当前刀的 shikai/bankai 两张。
 *
 * 用法：在 StatPanel 渲染立绘前、或在玩家选定斩魄刀时调用 ensureZanpakutoPortraits，
 * 纹理就绪后通过 onReady 回调继续渲染。
 */
import Phaser from 'phaser';
import { GameState } from '../managers/GameState';

export function ensureZanpakutoPortraits(
  scene: Phaser.Scene,
  name: string,
  onReady?: () => void,
): void {
  if (!name) { onReady?.(); return; }

  const keys = [`zan_${name}_shikai`, `zan_${name}_bankai`];
  const need = keys.filter((k) => !scene.textures.exists(k));
  if (need.length === 0) { onReady?.(); return; }

  const loader = scene.load as Phaser.Loader.LoaderPlugin;
  for (const k of need) loader.image(k, `assets/zanpakuto/${k}.png`);

  const fire = () => onReady?.();
  // 罕见情况：恰有其它加载进行中，等其结束后再启动本次加载，避免重入报错
  if (loader.isLoading()) {
    loader.once('complete', () => { loader.once('complete', fire); loader.start(); });
  } else {
    loader.once('complete', fire);
    loader.start();
  }
}

/**
 * 力量形态立绘（虚化/狱解）懒加载：仅加载「当前性别」那一张。
 * key 对齐 assets/characters/char_${which}_${gender}.png。
 * 与斩魄刀立绘同理，按需触发、不进启动预载。
 */
export function ensureFormPortrait(
  scene: Phaser.Scene,
  which: 'hollow' | 'hell' | 'bankai',
  onReady?: (key: string) => void,
): void {
  const key = which === 'bankai'
    ? `player_${GameState.gender}`            // 卍解：复用主角色静态立绘（placeholder），正式美术到位后改回 char_bankai_*
    : `char_${which}_${GameState.gender}`;
  if (scene.textures.exists(key)) { onReady?.(key); return; }

  const loader = scene.load as Phaser.Loader.LoaderPlugin;
  loader.image(key, `assets/characters/${key}.png`);

  const fire = () => onReady?.(key);
  if (loader.isLoading()) {
    loader.once('complete', () => { loader.once('complete', fire); loader.start(); });
  } else {
    loader.once('complete', fire);
    loader.start();
  }
}
