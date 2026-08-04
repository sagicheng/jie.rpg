import Phaser from 'phaser';
import { BATTLE_FX_MANIFEST, BattleFxEntry } from '../generated/battleFxManifest';

/**
 * 战斗序列帧特效管理器。
 *
 * 设计要点：
 * - 所有 clip 的「帧宽/高/帧数」都从 src/generated/battleFxManifest.ts（由
 *   scripts/genBattleFxManifest.mjs 扫描美术资源自动生成）读取，不写死，
 *   因此美术改帧数或新增资源后重新生成清单即可，无需改这里。
 * - 战斗场景只需在 preload 调 preload()、create 调 createAnims()，
 *   然后在对应时机调 play* 系列方法即可，本文件对战斗逻辑零侵入。
 * - clip 键 = battlefx 子目录名（如 "fx_fire_impact"），program 里以此引用。
 */

type FxKind = 'cast' | 'projectile' | 'impact' | 'buff' | 'crit' | 'die';

interface FxDisplay {
  scale: number;
  depth: number;
  blend: Phaser.BlendModes;
}

/** 各类型演出参数：缩放 / 层级 / 混合模式。能量类用 ADD 发光，死亡用普通混合。 */
const DISPLAY: Record<FxKind, FxDisplay> = {
  cast: { scale: 1.0, depth: 40, blend: Phaser.BlendModes.ADD },
  projectile: { scale: 1.0, depth: 41, blend: Phaser.BlendModes.ADD },
  impact: { scale: 1.25, depth: 42, blend: Phaser.BlendModes.ADD },
  buff: { scale: 1.0, depth: 40, blend: Phaser.BlendModes.ADD },
  crit: { scale: 2.2, depth: 60, blend: Phaser.BlendModes.ADD },
  die: { scale: 1.2, depth: 45, blend: Phaser.BlendModes.NORMAL },
};

/** 各类型帧率（来自需求文档；帧数仍按美术资源） */
const FPS: Record<FxKind, number> = {
  cast: 30, projectile: 30, impact: 30, buff: 24, crit: 30, die: 30,
};

/** 各类型是否循环 */
const LOOP: Record<FxKind, boolean> = {
  cast: false, projectile: true, impact: false, buff: true, crit: false, die: false,
};

/** 玩家元素（中）→ 美术分组（英）。 */
const ELEMENT_TO_GROUP: Record<string, string> = {
  '火': 'fire', '风': 'wind', '水': 'water', '土': 'earth',
};

/** 无元素 / 未知元素时的通用分组（破道 = 通用灵力特效）。 */
const DEFAULT_GROUP = 'hado';

/**
 * 分组缺对应美术时的回落分组。
 * 回道（kaido）只产出了 cast / buff，若有伤害型回道技能则回落破道的爆炸。
 */
const GROUP_FALLBACK: Record<string, string> = { kaido: DEFAULT_GROUP };

function kindOf(key: string): FxKind | null {
  if (key === 'fx_crit') return 'crit';
  if (key === 'fx_die') return 'die';
  if (key.endsWith('_cast')) return 'cast';
  if (key.endsWith('_projectile')) return 'projectile';
  if (key.endsWith('_impact')) return 'impact';
  if (key.endsWith('_buff')) return 'buff';
  return null;
}

export class BattleFx {
  /** 玩家元素 → 美术分组键（fire/wind/water/earth）；无元素回落 DEFAULT_GROUP。 */
  static groupFromElement(el?: string | null): string {
    return (el && ELEMENT_TO_GROUP[el]) || DEFAULT_GROUP;
  }

  /**
   * 一次性提示清单中无法识别类型的 clip。
   * 子目录名须以 _cast / _projectile / _impact / _buff 结尾，或为 fx_crit / fx_die，
   * 否则不会生成动画。美术新增目录命名不规范时可在控制台第一时间发现。
   */
  private static warned = false;
  private static warnUnknownClips(): void {
    if (BattleFx.warned) return;
    BattleFx.warned = true;
    const unknown = BATTLE_FX_MANIFEST.filter((e) => !kindOf(e.key));
    if (unknown.length === 0) return;
    console.warn(
      '[BattleFx] 以下 clip 目录名无法识别类型，不会生成动画：\n' +
      unknown.map((e) => `  ${e.key}`).join('\n'),
    );
  }

  /** preload 阶段加载全部 battlefx 精灵表。重复进入战斗时纹理已存在则跳过。 */
  static preload(scene: Phaser.Scene): void {
    BattleFx.warnUnknownClips();
    for (const e of BATTLE_FX_MANIFEST) {
      if (!scene.textures.exists(e.key)) {
        scene.load.spritesheet(e.key, e.url, {
          frameWidth: e.frameWidth,
          frameHeight: e.frameHeight,
        });
      }
    }
  }

  /** create 阶段创建全部 battlefx 动画（帧数取自清单）。幂等。 */
  static createAnims(scene: Phaser.Scene): void {
    for (const e of BATTLE_FX_MANIFEST) {
      const kind = kindOf(e.key);
      if (!kind) continue;
      if (scene.anims.exists(e.key)) continue;
      scene.anims.create({
        key: e.key,
        frames: scene.anims.generateFrameNumbers(e.key, { start: 0, end: e.frameCount - 1 }),
        frameRate: FPS[kind],
        repeat: LOOP[kind] ? -1 : 0,
      });
    }
  }

  /** 兜底：若纹理/动画缺失（如 Boot 未预载），保证不抛错。 */
  private static ready(scene: Phaser.Scene, key: string): boolean {
    return scene.textures.exists(key) && scene.anims.exists(key);
  }

  /** 取该分组下可用的 clip key；无专属美术时按 GROUP_FALLBACK 回落，仍无则返回 null。 */
  private static resolveKey(scene: Phaser.Scene, group: string, suffix: string): string | null {
    for (const g of [group, GROUP_FALLBACK[group]]) {
      if (!g) continue;
      const key = `fx_${g}_${suffix}`;
      if (BattleFx.ready(scene, key)) return key;
    }
    return null;
  }

  private static makeSprite(
    scene: Phaser.Scene, key: string, x: number, y: number, kind: FxKind,
  ): Phaser.GameObjects.Sprite {
    const d = DISPLAY[kind];
    return scene.add
      .sprite(x, y, key)
      .setOrigin(0.5)
      .setDepth(d.depth)
      .setBlendMode(d.blend)
      .setScale(d.scale);
  }

  /** 播放一次性 clip（cast/impact/crit/die）。播完自动销毁。 */
  static play(scene: Phaser.Scene, key: string, x: number, y: number, onDone?: () => void): void {
    const kind = kindOf(key);
    if (!kind || !BattleFx.ready(scene, key)) return;
    const s = BattleFx.makeSprite(scene, key, x, y, kind);
    s.play(key);
    s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      s.destroy();
      onDone?.();
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => s.destroy());
  }

  // ── 语义化封装 ──

  static playCast(scene: Phaser.Scene, group: string, x: number, y: number): void {
    const key = BattleFx.resolveKey(scene, group, 'cast');
    if (key) BattleFx.play(scene, key, x, y);
  }

  /** 落点爆炸。无对应美术时不放特效，但仍回调 onDone，避免后续演出被吞。 */
  static playImpact(scene: Phaser.Scene, group: string, x: number, y: number, onDone?: () => void): void {
    const key = BattleFx.resolveKey(scene, group, 'impact');
    if (!key) {
      onDone?.();
      return;
    }
    BattleFx.play(scene, key, x, y, onDone);
  }

  static playDie(scene: Phaser.Scene, x: number, y: number): void {
    BattleFx.play(scene, 'fx_die', x, y);
  }

  static playCrit(scene: Phaser.Scene, x: number, y: number): void {
    BattleFx.play(scene, 'fx_crit', x, y);
  }

  /**
   * 回道光罩（循环），持续 duration 毫秒后自动销毁（避免常驻）。
   */
  static playBuff(scene: Phaser.Scene, x: number, y: number, duration = 1400): void {
    const key = 'fx_kaido_buff';
    if (!BattleFx.ready(scene, key)) return;
    const s = BattleFx.makeSprite(scene, key, x, y, 'buff');
    s.play(key);
    scene.time.delayedCall(duration, () => s.destroy());
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => s.destroy());
  }

  /**
   * 飞弹：从 (fx,fy) 飞向 (tx,ty)，落点播放 impact（再叠 crit）。
   * 若 projectile 资源缺失则直接播 impact。
   */
  static playProjectile(
    scene: Phaser.Scene, group: string, fx: number, fy: number, tx: number, ty: number,
    onArrive?: () => void,
  ): void {
    const pKey = BattleFx.resolveKey(scene, group, 'projectile');
    if (!pKey) {
      BattleFx.playImpact(scene, group, tx, ty, onArrive);
      return;
    }
    const s = BattleFx.makeSprite(scene, pKey, fx, fy, 'projectile');
    s.setRotation(Phaser.Math.Angle.Between(fx, fy, tx, ty));
    scene.tweens.add({
      targets: s,
      x: tx,
      y: ty,
      duration: 220,
      ease: 'Quad.In',
      onComplete: () => {
        s.destroy();
        BattleFx.playImpact(scene, group, tx, ty, onArrive);
      },
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => s.destroy());
  }

  /**
   * 技能命中完整序列：飞弹 + 落点爆炸（+暴击叠 fx_crit）。
   * cast 蓄力由调用方在技能开始处单独 playCast。
   */
  static playSkillHit(
    scene: Phaser.Scene, group: string,
    fx: number, fy: number, tx: number, ty: number,
    opts?: { crit?: boolean },
  ): void {
    BattleFx.playProjectile(scene, group, fx, fy, tx, ty, () => {
      if (opts?.crit) BattleFx.playCrit(scene, tx, ty);
    });
  }
}
