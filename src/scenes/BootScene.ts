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
      this.load.image(a.key, a.path);
    }

    // 生成程序化图形资源（真实美术未覆盖的 key 仍用占位）
    this.createPlaceholderAssets();
  }

  private createPlaceholderAssets(): void {
    const g = this.make.graphics({ x: 0, y: 0 } as any);

    // 已用真实美术的 key 不再生成程序化占位
    const REAL_KEYS = new Set(ASSET_IMAGES.map(a => a.key));

    // 玩家角色 (32x48)
    if (!REAL_KEYS.has('player')) {
      g.clear();
      g.fillStyle(0x4a90d9, 1);
      g.fillRoundedRect(0, 0, 32, 48, 4);
      g.fillStyle(0xffcc88, 1);
      g.fillRoundedRect(8, 4, 16, 16, 4);
      g.generateTexture('player', 32, 48);
      g.clear();
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

    // 元素图标 (28x28)
    // 火 - 火焰
    g.fillStyle(0xcc2200, 0.6);
    g.fillRect(0, 0, 28, 28);
    g.fillStyle(0xff2200, 1);
    g.fillTriangle(14, 1, 1, 26, 10, 26);
    g.fillStyle(0xff6622, 1);
    g.fillTriangle(14, 6, 4, 26, 19, 26);
    g.fillStyle(0xffaa44, 1);
    g.fillTriangle(14, 14, 8, 26, 27, 26);
    g.generateTexture('icon_fire', 28, 28);
    g.clear();

    // 风 - 旋风纹
    g.fillStyle(0x004400, 0.6);
    g.fillRect(0, 0, 28, 28);
    g.lineStyle(2, 0x22cc44, 1);
    g.beginPath(); g.arc(13, 13, 10, -2.5, 4.5, false); g.strokePath();
    g.lineStyle(2, 0x44ee66, 1);
    g.beginPath(); g.arc(13, 13, 7, -2.0, 3.5, false); g.strokePath();
    g.lineStyle(1.5, 0x88ffaa, 0.7);
    g.beginPath(); g.moveTo(13, 3); g.lineTo(15, 9); g.moveTo(23, 13); g.lineTo(17, 15); g.strokePath();
    g.generateTexture('icon_wind', 28, 28);
    g.clear();

    // 水 - 水滴
    g.fillStyle(0x000044, 0.6);
    g.fillRect(0, 0, 28, 28);
    g.fillStyle(0x0066cc, 1);
    g.fillTriangle(14, 1, 1, 20, 14, 27);
    g.fillTriangle(14, 1, 27, 20, 14, 27);
    g.fillStyle(0x2288ee, 1);
    g.fillTriangle(14, 6, 5, 20, 14, 27);
    g.fillTriangle(14, 6, 23, 20, 14, 27);
    g.fillStyle(0x66bbff, 0.5);
    g.fillCircle(12, 16, 4);
    g.generateTexture('icon_water', 28, 28);
    g.clear();

    // 土 - 山岩
    g.fillStyle(0x443300, 0.6);
    g.fillRect(0, 0, 28, 28);
    g.fillStyle(0x886622, 1);
    g.fillTriangle(14, 2, 1, 26, 9, 26);
    g.fillStyle(0xbb9944, 1);
    g.fillTriangle(11, 12, 27, 2, 27, 26);
    g.fillStyle(0xddbb66, 0.6);
    g.fillTriangle(14, 10, 6, 24, 18, 24);
    g.lineStyle(1, 0x665522, 0.4);
    g.lineBetween(10, 26, 14, 12); g.lineBetween(14, 12, 24, 10);
    g.generateTexture('icon_earth', 28, 28);
    g.clear();

    g.destroy();
  }

  create(): void {
    this.scene.start('TitleScene');
  }
}
