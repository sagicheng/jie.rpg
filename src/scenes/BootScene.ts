/**
 * 启动 / 预加载场景
 * 游戏首个场景：显示资源加载进度条，加载完成后进入 TitleScene。
 */

import Phaser from 'phaser';
import { ASSET_IMAGES } from '../config/assetManifest';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;

    // 加载进度条
    const barW = 320, barH = 20;
    const barX = (w - barW) / 2, barY = h / 2;

    const bg = this.add.graphics();
    bg.fillStyle(0x333333, 1);
    bg.fillRect(barX, barY, barW, barH);

    const fill = this.add.graphics();

    const text = this.add.text(w / 2, barY - 30, '正在觉醒斩魄刀...', {
      fontSize: '16px',
      color: '#c9a96e',
      fontFamily: 'serif',
      padding: { y: 2 },
    }).setOrigin(0.5);

    this.load.on('progress', (v: number) => {
      fill.clear();
      fill.fillStyle(0xc9a96e, 1);
      fill.fillRect(barX + 2, barY + 2, (barW - 4) * v, barH - 4);
    });

    this.load.on('complete', () => {
      text.setText('觉醒完成');
    });

    // 加载 AI 生成的真实美术（清单见 src/config/assetManifest.ts）
    // 已生成的 key 会覆盖下方同名程序化占位贴图
    for (const a of ASSET_IMAGES) {
      // 斩魄刀立绘（zan_*）共 72 张 ~13MB，改为「按需懒加载」：
      // 仅在实际显示立绘时才加载当前刀的 2 张，避免启动一次性预载拖慢加载页
      // 力量形态立绘（char_*，虚化/狱解×男女）同样按需懒加载，跳过启动预载
      if (a.key.startsWith('zan_') || a.key.startsWith('char_')) continue;
      this.load.image(a.key, a.path);
    }

    // 生成程序化图形资源（真实美术未覆盖的 key 仍用占位）
    this.createPlaceholderAssets();
  }

  private createPlaceholderAssets(): void {
    const g = this.make.graphics({ x: 0, y: 0 } as any);

    // 已用真实美术的 key 不再生成程序化占位
    const REAL_KEYS = new Set(ASSET_IMAGES.map(a => a.key));

    // 玩家角色 (32x48) — 按性别生成程序化占位（真实美术已覆盖时跳过）
    for (const gk of ['player_male', 'player_female']) {
      if (!REAL_KEYS.has(gk)) {
        g.clear();
        g.fillStyle(gk === 'player_male' ? 0x4a90d9 : 0xd94a9a, 1);
        g.fillRoundedRect(0, 0, 32, 48, 4);
        g.fillStyle(0xffcc88, 1);
        g.fillRoundedRect(8, 4, 16, 16, 4);
        g.generateTexture(gk, 32, 48);
        g.clear();
      }
    }

    // NPC (32x48)
    g.fillStyle(0x88aa66, 1);
    g.fillRoundedRect(0, 0, 32, 48, 4);
    g.fillStyle(0xffcc88, 1);
    g.fillRoundedRect(8, 4, 16, 16, 4);
    g.generateTexture('npc', 32, 48);
    g.clear();

    // 妖魔·杂 (32x48)
    g.fillStyle(0xcc4444, 1);
    g.fillRoundedRect(0, 0, 32, 48, 4);
    g.fillStyle(0x331111, 1);
    g.fillRoundedRect(6, 2, 20, 20, 4);
    g.generateTexture('enemy_small', 32, 48);
    g.clear();

    // 妖魔·恶 (48x64)
    g.fillStyle(0x993333, 1);
    g.fillRoundedRect(0, 0, 48, 64, 4);
    g.fillStyle(0x441111, 1);
    g.fillRoundedRect(8, 4, 32, 28, 4);
    g.generateTexture('enemy_elite', 48, 64);
    g.clear();

    // Boss (64x80)
    g.fillStyle(0x661111, 1);
    g.fillRoundedRect(0, 0, 64, 80, 6);
    g.fillStyle(0x220000, 1);
    g.fillRoundedRect(10, 6, 44, 36, 4);
    g.generateTexture('enemy_boss', 64, 80);
    g.clear();

    // 地形tile (32x32)
    const tiles: [number, string][] = [
      [0x558844, 'tile_grass'],
      [0x445533, 'tile_grass_dark'],
      [0x776655, 'tile_path'],
      [0x555566, 'tile_wall'],
      [0x4488aa, 'tile_water'],
    ];
    for (const [color, key] of tiles) {
      g.fillStyle(color, 1);
      g.fillRect(0, 0, 32, 32);
      g.lineStyle(1, color, 0.3);
      g.strokeRect(0, 0, 32, 32);
      g.generateTexture(key, 32, 32);
      g.clear();
    }

    // 中性地面纹理 (64x64)，带细微噪点，可按区域 groundColor tint 使用
    g.fillStyle(0x888888, 1);
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 40; i++) {
      const gx = Phaser.Math.Between(0, 63), gy = Phaser.Math.Between(0, 63);
      const size = Phaser.Math.Between(1, 3);
      const alpha = Phaser.Math.FloatBetween(0.08, 0.18);
      g.fillStyle(0xffffff, alpha);
      g.fillRect(gx, gy, size, size);
      g.fillStyle(0x000000, alpha * 0.7);
      g.fillRect(gx + 1, gy + 1, size, size);
    }
    g.generateTexture('tile_ground', 64, 64);
    g.clear();

    // 注：采集点(gather_*) 现已由 assetManifest 加载真实美术，
    // 不再在此生成程序化占位，避免覆盖真图。
    // 注：元素共鸣图标(icon_火/风/水/土) 已由 assetManifest 加载独立美术，
    // 原 28x28 程序化占位已移除，不在此生成。

    // 注：立绘粒子贴图(fx_fire/wind/water/earth) 已由美术手绘彩色透明 PNG 提供，
    // 通过 assetManifest.ts 注册、BootScene.preload 加载（见上方 ASSET_IMAGES 循环），此处不再程序化生成。

    g.destroy();
  }

  create(): void {
    this.scene.start('TitleScene');
  }
}
