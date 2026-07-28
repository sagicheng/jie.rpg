/**
 * BattleSkin —— 战斗 UI 切图皮肤加载器（CC0 扁平风，tools/gen_skin.py 生成）
 *
 * 用途：把 BattleScene / MultiBattleScene / PvpBattleScene 里用 graphics 程序化绘制的
 *       血条 / 指令按钮 / 卡牌框 / 状态标签底 / 面板 替换为切图级图片，统一视觉。
 *
 * 资源：纹理 key 在 src/config/assetManifest.ts 中以 ui_ 前缀声明，BootScene 统一预载。
 * 替换：若要换成 Kenney / Cocos 成品皮肤，直接同名覆盖 public/assets/ui/skin/*.png 即可，
 *       本模块与三个战斗场景无需改动。
 */
import Phaser from 'phaser';

// 阵营色（与 ui_card_* 描边一致，便于复用）
export const SKIN = {
  barFrame: 'ui_bar_frame',
  barFill: 'ui_bar_fill',
  btnNormal: 'ui_btn_normal',
  btnHover: 'ui_btn_hover',
  btnDown: 'ui_btn_down',
  cardAlly: 'ui_card_ally',
  cardEnemy: 'ui_card_enemy',
  cardPet: 'ui_card_pet',
  tagBg: 'ui_tag_bg',
  panel: 'ui_panel',
};

/** HP 数值按百分比分档上色（沿用原 graphics 的红黄绿逻辑） */
export function hpColor(ratio: number): number {
  if (ratio > 0.5) return 0x36c46a;
  if (ratio > 0.25) return 0xe7c14b;
  return 0xe0556b;
}

/**
 * 血条 / 灵压条：外框（九宫格）+ 填充（九宫格，按比率缩放并 tint 上色）。
 * 支持加入任意 Container（frame/fill 为 public，调用方自行 container.add）。
 */
export class SkinBar {
  scene: Phaser.Scene;
  frame: Phaser.GameObjects.NineSlice;
  fill: Phaser.GameObjects.NineSlice;
  pad = 3;
  innerW: number;
  innerH: number;
  baseX: number;
  baseY: number;

  constructor(scene: Phaser.Scene, opts: {
    x: number; y: number; w: number; h: number; depth?: number;
    fillKey?: string; frameKey?: string; pad?: number;
  }) {
    this.scene = scene;
    this.pad = opts.pad ?? 3;
    this.baseX = opts.x;
    this.baseY = opts.y;
    this.innerW = opts.w - this.pad * 2;
    this.innerH = opts.h - this.pad * 2;
    const depth = opts.depth ?? 10;
    this.frame = scene.add.nineslice(
      opts.x, opts.y, opts.frameKey ?? SKIN.barFrame, undefined,
      opts.w, opts.h, 10, 10, 10, 10,
    ).setOrigin(0, 0).setDepth(depth);
    this.fill = scene.add.nineslice(
      opts.x + this.pad, opts.y + this.pad, opts.fillKey ?? SKIN.barFill, undefined,
      this.innerW, this.innerH, 6, 6, 6, 6,
    ).setOrigin(0, 0).setDepth(depth + 1);
  }

  /** ratio 0..1；color 可选（不传则保持白_fill 原色或上次 tint） */
  setRatio(ratio: number, color?: number): void {
    const r = Phaser.Math.Clamp(ratio, 0, 1);
    if (r <= 0.001) {
      this.fill.setVisible(false);
      return;
    }
    this.fill.setVisible(true);
    this.fill.setSize(Math.max(2, this.innerW * r), this.innerH);
    if (color !== undefined) this.fill.setTint(color);
  }

  setPosition(x: number, y: number): void {
    this.baseX = x; this.baseY = y;
    this.frame.setPosition(x, y);
    this.fill.setPosition(x + this.pad, y + this.pad);
  }

  setVisible(b: boolean): void {
    this.frame.setVisible(b);
    this.fill.setVisible(b);
  }

  setDepth(d: number): void {
    this.frame.setDepth(d);
    this.fill.setDepth(d + 1);
  }

  destroy(): void {
    this.frame.destroy();
    this.fill.destroy();
  }
}

/**
 * 指令按钮：九宫格背景（normal/hover/down 三态）+ 居中文字 + 交互。
 * 取代原 graphics 画框 + text + zone 的三段式。
 */
export class SkinButton {
  scene: Phaser.Scene;
  root: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.NineSlice;
  label: Phaser.GameObjects.Text;
  w: number;
  h: number;
  enabled = true;
  highlighted = false;
  private onClick?: () => void;

  constructor(scene: Phaser.Scene, opts: {
    x: number; y: number; label: string; w: number; h: number; depth?: number;
    onClick?: () => void; fontSize?: number;
  }) {
    this.scene = scene;
    this.w = opts.w; this.h = opts.h;
    this.onClick = opts.onClick;
    const depth = opts.depth ?? 50;
    this.root = scene.add.container(opts.x, opts.y).setDepth(depth);
    this.bg = scene.add.nineslice(0, 0, SKIN.btnNormal, undefined, opts.w, opts.h, 16, 16, 16, 16)
      .setOrigin(0.5, 0.5);
    this.label = scene.add.text(0, 0, opts.label, {
      fontFamily: 'sans-serif', fontSize: `${opts.fontSize ?? 22}px`, color: '#e8eef6',
      fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5, 0.5);
    this.root.add([this.bg, this.label]);
    this.bg.setInteractive({ useHandCursor: true });
    this.bg.on('pointerover', () => { if (this.enabled) this.applyState(SKIN.btnHover); });
    this.bg.on('pointerout', () => { if (this.enabled) this.applyState(SKIN.btnNormal); });
    this.bg.on('pointerdown', () => {
      if (!this.enabled) return;
      this.applyState(SKIN.btnDown);
      this.onClick?.();
    });
    this.bg.on('pointerup', () => { if (this.enabled) this.applyState(SKIN.btnHover); });
  }

  private applyState(key: string): void {
    this.bg.setTexture(key);
  }

  setLabel(t: string): void { this.label.setText(t); }
  setOnClick(cb: () => void): void { this.onClick = cb; }

  setEnabled(b: boolean): void {
    this.enabled = b;
    this.label.setAlpha(b ? 1 : 0.4);
    this.bg.setAlpha(b ? 1 : 0.5);
    if (b) this.applyState(this.highlighted ? SKIN.btnHover : SKIN.btnNormal);
    else this.applyState(SKIN.btnNormal);
  }

  setHighlight(b: boolean): void {
    this.highlighted = b;
    if (this.enabled) this.applyState(b ? SKIN.btnHover : SKIN.btnNormal);
  }

  setVisible(b: boolean): void { this.root.setVisible(b); }
  setPosition(x: number, y: number): void { this.root.setPosition(x, y); }
  get x(): number { return this.root.x; }
  get y(): number { return this.root.y; }
  setSize(w: number, h: number): void {
    this.w = w; this.h = h;
    this.bg.setSize(w, h);
  }

  destroy(): void { this.root.destroy(); }
}

/** 卡牌框图片（固定 380x96，按阵营取纹理） */
export function cardFrame(
  scene: Phaser.Scene, side: 'ally' | 'enemy' | 'pet', x = 0, y = 0,
): Phaser.GameObjects.Image {
  const key = side === 'ally' ? SKIN.cardAlly : side === 'enemy' ? SKIN.cardEnemy : SKIN.cardPet;
  return scene.add.image(x, y, key).setOrigin(0, 0).setDisplaySize(380, 96);
}

/** 状态标签底（小圆角方块，承载 buff/debuff 图标） */
export function tagBg(scene: Phaser.Scene, x: number, y: number, size = 30): Phaser.GameObjects.Image {
  return scene.add.image(x, y, SKIN.tagBg).setOrigin(0.5, 0.5).setDisplaySize(size, size);
}

/** 面板（子菜单背景，九宫格可缩放） */
export function panel(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number, depth = 60,
): Phaser.GameObjects.NineSlice {
  return scene.add.nineslice(x, y, SKIN.panel, undefined, w, h, 18, 18, 18, 18)
    .setOrigin(0, 0).setDepth(depth);
}
