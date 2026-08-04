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
  die: { scale: 1.6, depth: 45, blend: Phaser.BlendModes.NORMAL },
};

/**
 * 全局演出速度倍率。>1 更慢更清晰，<1 更快。调演出节奏改这一处即可。
 */
const FX_SPEED = 1.0;

/**
 * 各类型目标播放时长（ms，循环类为单圈时长）。
 *
 * 采用「时长驱动」而非固定帧率：帧率 = 帧数 / 时长，
 * 这样 6 帧和 12 帧的爆炸演出时间一致，美术改帧数无需回来调参。
 */
const DURATION: Record<FxKind, number> = {
  cast: 850, projectile: 400, impact: 550, buff: 1000, crit: 600, die: 900,
};

/** 帧率合理区间：过低发卡顿，过高看不清。 */
const FPS_MIN = 10;
const FPS_MAX = 20;

/** 播完后停在末帧淡出的时长（ms），0 表示立即销毁。给爆炸/暴击/死亡留残留。 */
const TAIL: Record<FxKind, number> = {
  cast: 0, projectile: 0, impact: 220, buff: 0, crit: 260, die: 500,
};

/** 飞弹从起点到落点的飞行时长（ms）。 */
const PROJECTILE_FLIGHT = 460;

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

  /** 按目标时长反推帧率，并夹到合理区间，避免过卡或一闪而过。 */
  private static frameRateOf(kind: FxKind, frameCount: number): number {
    const seconds = (DURATION[kind] * FX_SPEED) / 1000;
    const fps = frameCount / seconds;
    return Phaser.Math.Clamp(Math.round(fps), FPS_MIN, FPS_MAX);
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
        frameRate: BattleFx.frameRateOf(kind, e.frameCount),
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
    const s = scene.add
      .sprite(x, y, key)
      .setOrigin(0.5)
      .setDepth(d.depth)
      .setBlendMode(d.blend)
      .setScale(d.scale);
    BattleFx.bindShutdown(scene, s);
    return s;
  }

  /** 场景关闭时清掉残留特效，并在特效自然销毁时摘掉监听，避免监听器堆积。 */
  private static bindShutdown(scene: Phaser.Scene, s: Phaser.GameObjects.Sprite): void {
    const kill = () => s.destroy();
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, kill);
    s.once(Phaser.GameObjects.Events.DESTROY, () => {
      // 场景销毁流程中 events 可能已被拆除，取消监听前先判空
      scene.events?.off(Phaser.Scenes.Events.SHUTDOWN, kill);
    });
  }

  /**
   * 播放一次性 clip（cast/impact/crit/die）。
   * 播完后按 TAIL 停留在末帧淡出再销毁，让爆炸/死亡有残留、看得清。
   * onDone 在动画本体播完时立即触发（不等淡出），便于串联后续演出。
   */
  static play(scene: Phaser.Scene, key: string, x: number, y: number, onDone?: () => void): void {
    const kind = kindOf(key);
    if (!kind || !BattleFx.ready(scene, key)) return;
    const s = BattleFx.makeSprite(scene, key, x, y, kind);
    s.play(key);
    s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      const tail = TAIL[kind] * FX_SPEED;
      if (tail > 0) {
        scene.tweens.add({
          targets: s, alpha: 0, duration: tail, ease: 'Quad.Out',
          onComplete: () => s.destroy(),
        });
      } else {
        s.destroy();
      }
      onDone?.();
    });
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

  /**
   * 死亡特效。delay 用于对齐弹道落点——否则目标会在飞弹还没飞到时就先炸开。
   */
  static playDie(scene: Phaser.Scene, x: number, y: number, delay = 0): void {
    if (delay > 0) scene.time.delayedCall(delay, () => BattleFx.play(scene, 'fx_die', x, y));
    else BattleFx.play(scene, 'fx_die', x, y);
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
      duration: PROJECTILE_FLIGHT * FX_SPEED,
      ease: 'Sine.InOut',
      onComplete: () => {
        s.destroy();
        BattleFx.playImpact(scene, group, tx, ty, onArrive);
      },
    });
  }

  /**
   * 技能命中完整序列：飞弹 + 落点爆炸（+暴击叠 fx_crit）。
   * cast 蓄力由调用方在技能开始处单独 playCast；
   * opts.delay 用于让起手咏唱先演完再出弹道，避免三段特效挤在同一帧。
   */
  static playSkillHit(
    scene: Phaser.Scene, group: string,
    fx: number, fy: number, tx: number, ty: number,
    opts?: { crit?: boolean; delay?: number },
  ): void {
    const fire = () => BattleFx.playProjectile(scene, group, fx, fy, tx, ty, () => {
      if (opts?.crit) BattleFx.playCrit(scene, tx, ty);
    });
    const delay = (opts?.delay ?? 0) * FX_SPEED;
    if (delay > 0) scene.time.delayedCall(delay, fire);
    else fire();
  }

  /** 起手咏唱到弹道发射的间隔（ms），供场景排演出节奏时引用。 */
  static get castLead(): number {
    return Math.round(DURATION.cast * 0.45 * FX_SPEED);
  }

  /** 弹道飞行时长（ms）。已完成咏唱的场景（如鬼道）用它对齐落点时刻。 */
  static get projectileFlight(): number {
    return Math.round(PROJECTILE_FLIGHT * FX_SPEED);
  }

  /** 从技能起手到弹道落点的时刻（ms），死亡/受击演出对齐用。 */
  static get skillImpactAt(): number {
    return BattleFx.castLead + BattleFx.projectileFlight;
  }

  /**
   * 一次技能演出（咏唱→弹道→爆炸主体）的时长（ms），供回合节奏对齐。
   * 不含末帧残留淡出——残留允许与下一段演出重叠，不必为它拖慢回合。
   */
  static get skillHitDuration(): number {
    return Math.round(BattleFx.castLead + (PROJECTILE_FLIGHT + DURATION.impact) * FX_SPEED);
  }
}
