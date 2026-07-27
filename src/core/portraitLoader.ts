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
