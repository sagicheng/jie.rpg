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
 * 战斗立绘形态。
 *  base   → male / female            （基础形态，BootScene 预载）
 *  bankai → player_male / player_female（卍解）
 *  hollow → char_hollow_*             （虚化，懒加载）
 *  hell   → char_hell_*               （狱解，懒加载）
 */
export type BattleForm = 'base' | 'bankai' | 'hollow' | 'hell';

/** 形态 + 性别 → 立绘纹理 key（单一事实来源，战斗场景全部走这里）。 */
export function battlePortraitKey(gender: 'male' | 'female', form: BattleForm = 'base'): string {
  switch (form) {
    case 'bankai': return `player_${gender}`;
    case 'hollow': return `char_hollow_${gender}`;
    case 'hell':   return `char_hell_${gender}`;
    default:       return gender;              // 基础形态：female / male
  }
}

/** 同一 key 的并发懒加载去重：key → 等待回调队列 */
const pendingPortraits: Map<string, ((key: string) => void)[]> = new Map();

/**
 * 立绘按需加载（纹理已存在则同步回调）。
 * char_* 形态立绘不进启动预载（见 BootScene），首次释放时才拉取。
 */
export function ensureBattlePortrait(
  scene: Phaser.Scene,
  key: string,
  onReady?: (key: string) => void,
): void {
  if (!key) return;
  if (scene.textures.exists(key)) { onReady?.(key); return; }

  // 同一张图的重复请求合流，避免 Loader 重复入队报 duplicate key
  const waiting = pendingPortraits.get(key);
  if (waiting) { if (onReady) waiting.push(onReady); return; }
  pendingPortraits.set(key, onReady ? [onReady] : []);

  const loader = scene.load as Phaser.Loader.LoaderPlugin;
  loader.image(key, `assets/characters/${key}.png`);

  const fire = () => {
    const cbs = pendingPortraits.get(key) || [];
    pendingPortraits.delete(key);
    for (const cb of cbs) cb(key);
  };
  if (loader.isLoading()) {
    loader.once('complete', () => { loader.once('complete', fire); loader.start(); });
  } else {
    loader.once('complete', fire);
    loader.start();
  }
}

/**
 * 力量形态立绘（卍解/虚化/狱解）懒加载：仅加载「当前性别」那一张。
 * 保留旧签名供全屏演出调用。
 */
export function ensureFormPortrait(
  scene: Phaser.Scene,
  which: 'hollow' | 'hell' | 'bankai',
  onReady?: (key: string) => void,
): void {
  ensureBattlePortrait(scene, battlePortraitKey(GameState.gender, which), onReady);
}

/**
 * 立绘等比适配到指定框内（不拉伸变形）。
 * 各形态原图长宽比不同（445×917 vs 1024×1820），统一按高度贴合、宽度不超框。
 */
export function fitPortrait(
  img: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite,
  maxW: number,
  maxH: number,
): void {
  const src = img.frame ? { w: img.frame.width, h: img.frame.height } : { w: img.width, h: img.height };
  if (!src.w || !src.h) return;
  const s = Math.min(maxW / src.w, maxH / src.h);
  img.setDisplaySize(src.w * s, src.h * s);
}
