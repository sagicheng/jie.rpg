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
 * 加载失败（资源缺失 404）永久记录：后续对该 key 的加载请求直接跳过，
 * 不再发网络请求、不再触发 loaderror——根除「缺图怪报复性刷屏把主线程打满 → 整页卡死」。
 */
const failedPortraits: Set<string> = new Set();

/**
 * 立绘按需加载核心（纹理已存在则同步回调）。
 * - 同一张图并发请求合流，避免 Loader 重复入队报 duplicate key
 * - 纹理【真实加载成功】才回调 onReady；缺失文件不回调（调用方保持不可见/占位）
 * - 失败 key 永久缓存，永不重试
 */
function ensurePortrait(
  scene: Phaser.Scene,
  key: string,
  path: string,
  onReady?: (key: string) => void,
): void {
  if (!key) { onReady?.(key); return; }
  if (scene.textures.exists(key)) { onReady?.(key); return; }
  if (failedPortraits.has(key)) return; // 已知缺失：直接跳过，不发请求、不报错

  const waiting = pendingPortraits.get(key);
  if (waiting) { if (onReady) waiting.push(onReady); return; }
  pendingPortraits.set(key, onReady ? [onReady] : []);

  const loader = scene.load as Phaser.Loader.LoaderPlugin;

  const onError = (file: { key?: string } | undefined) => {
    if (file && file.key === key) {
      failedPortraits.add(key);
      pendingPortraits.delete(key);
      loader.off('loaderror', onError);
    }
  };
  loader.on('loaderror', onError);

  const fire = () => {
    loader.off('loaderror', onError);
    const cbs = pendingPortraits.get(key);
    if (!cbs) return;
    pendingPortraits.delete(key);
    // 仅在纹理真实加载成功时才回调；失败则标记缓存，调用方保持隐藏/占位
    if (scene.textures.exists(key)) {
      for (const cb of cbs) { try { cb(key); } catch (e) { console.error('[portrait] onReady error', key, e); } }
    } else {
      failedPortraits.add(key);
    }
  };

  loader.image(key, path);
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
export function ensureBattlePortrait(
  scene: Phaser.Scene,
  key: string,
  onReady?: (key: string) => void,
): void {
  ensurePortrait(scene, key, `assets/characters/${key}.png`, onReady);
}

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

/**
 * 灵宠立绘纹理 key（单一事实来源，战斗卡全部走这里）。
 * 对应资源：assets/pets/<speciesId>.png
 */
export function petPortraitKey(speciesId: string): string {
  return `pet_${speciesId}`;
}

/**
 * 灵宠 PNG 按需加载（纹理已存在则同步回调）。
 * 复用上面的 pendingPortraits 并发去重 Map（key 以 pet_ 前缀区分，不会与角色/斩魄刀立绘冲突）。
 * 资源就绪后通过 onReady 回调继续渲染（战斗卡 renderState 重渲即可切真图）。
 */
export function ensurePetPortrait(
  scene: Phaser.Scene,
  speciesId: string,
  onReady?: (key: string) => void,
): void {
  const key = petPortraitKey(speciesId);
  if (!speciesId) { onReady?.(key); return; }
  ensurePortrait(scene, key, `assets/pets/${speciesId}.png`, onReady);
}

/**
 * 怪物立绘纹理 key（单一事实来源，主场景 + 战斗卡全部走这里）。
 * 对应资源：assets/monsters/<name>.png（name 与 bestiary.ts 的 name 字段一字不差）。
 */
export function monsterPortraitKey(name: string): string {
  return `mob_${name}`;
}

/**
 * 怪物 PNG 按需加载（纹理已存在则同步回调）。
 * 复用 pendingPortraits 并发去重 Map（key 以 mob_ 前缀区分，不与角色/灵宠立绘冲突）。
 * 资源就绪后通过 onReady 回调继续渲染（主场景 setTexture 切真图 / 战斗卡 renderState 重渲）。
 *
 * 注意：缺图怪（如未出图的随从 虚·触手 等）会在首次 attempt 失败后进入 failedPortraits 缓存，
 * 此后永不重试、永不回调——调用方据此保持该怪不可见且不参与碰撞。
 */
export function ensureMonsterPortrait(
  scene: Phaser.Scene,
  name: string,
  onReady?: (key: string) => void,
): void {
  const key = monsterPortraitKey(name);
  if (!name) { onReady?.(key); return; }
  ensurePortrait(scene, key, `assets/monsters/${name}.png`, onReady);
}

/**
 * 区域 Boss 立绘纹理 key（单一事实来源）。
 * 资源单独存放在 assets/monsters/boss/<name>.png，与 A 表普通怪（assets/monsters/<name>.png）区分，
 * 方便美术维护。name 与 BossMechanics.ts 的 BOSS_CONFIG 键一字不差。
 */
export function bossPortraitKey(name: string): string {
  return `boss_${name}`;
}

/**
 * 区域 Boss PNG 按需加载（纹理已存在则同步回调）。
 * 复用 pendingPortraits 并发去重 Map（key 以 boss_ 前缀区分，不与普通怪 mob_ 冲突）。
 * 资源就绪后通过 onReady 回调继续渲染。
 */
export function ensureBossPortrait(
  scene: Phaser.Scene,
  name: string,
  onReady?: (key: string) => void,
): void {
  const key = bossPortraitKey(name);
  if (!name) { onReady?.(key); return; }
  ensurePortrait(scene, key, `assets/monsters/boss/${name}.png`, onReady);
}
