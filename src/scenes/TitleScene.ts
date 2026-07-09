import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
import { SaveManager } from '../systems/SaveManager';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super({ key: 'TitleScene' });
  }

  create(): void {
    const w = GAME_WIDTH;
    const h = GAME_HEIGHT;

    // 背景渐变
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x0a0a1e, 0x0a0a1e, 0x1a0a2e, 0x1a0a2e, 1);
    bg.fillRect(0, 0, w, h);

    // 浮动灵子粒子效果
    for (let i = 0; i < 30; i++) {
      const px = Phaser.Math.Between(0, w);
      const py = Phaser.Math.Between(0, h);
      const size = Phaser.Math.Between(1, 3);
      const particle = this.add.circle(px, py, size, 0xc9a96e, 0.3 + Math.random() * 0.4);
      this.tweens.add({
        targets: particle,
        y: py - Phaser.Math.Between(30, 100),
        alpha: 0,
        duration: Phaser.Math.Between(2000, 5000),
        repeat: -1,
        delay: Phaser.Math.Between(0, 3000),
        onRepeat: () => {
          particle.x = Phaser.Math.Between(0, w);
          particle.y = Phaser.Math.Between(h * 0.5, h);
          particle.alpha = 0.3 + Math.random() * 0.4;
        },
      });
    }

    // 标题 "解"
    const title = this.add.text(w / 2, h * 0.28, '解', {
      fontSize: '96px',
      color: '#c9a96e',
      fontFamily: 'serif',
      fontStyle: 'bold',
      padding: { y: 4 },
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: title,
      alpha: 1,
      y: h * 0.25,
      duration: 1500,
      ease: 'Power2',
    });

    // 副标题
    const subtitle = this.add.text(w / 2, h * 0.40, '── 斩断命运的锁链 ──', {
      fontSize: '18px',
      color: '#887755',
      fontFamily: 'serif',
      padding: { y: 2 },
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: subtitle,
      alpha: 1,
      duration: 1000,
      delay: 800,
    });

    // 菜单按钮
    const hasSave = SaveManager.hasSave();
    const menuItems = [
      { text: '新 游 戏', scene: 'CreateCharacterScene', data: {} },
      { text: '继  续', scene: 'GameScene', data: { newGame: false }, disabled: !hasSave },
      { text: '设  置', scene: null },
      { text: '退  出', scene: null },
    ];

    const btnW = 180;
    const btnH = 40;
    const startY = h * 0.55;
    const gap = 52;

    menuItems.forEach((item, i) => {
      const y = startY + i * gap;
      const btn = this.add.graphics();

      // 按钮背景
      btn.fillStyle(0x2a2a3e, 0.8);
      btn.fillRoundedRect(w / 2 - btnW / 2, y, btnW, btnH, 6);
      btn.lineStyle(1, 0xc9a96e, 0.5);
      btn.strokeRoundedRect(w / 2 - btnW / 2, y, btnW, btnH, 6);

      const label = this.add.text(w / 2, y + btnH / 2, item.text, {
        fontSize: '20px',
        color: (item as any).disabled ? '#555' : '#d4c5a0',
        fontFamily: 'serif',
        padding: { y: 2 },
      }).setOrigin(0.5);

      // 交互区域
      const zone = this.add.zone(w / 2, y + btnH / 2, btnW, btnH)
        .setInteractive({ useHandCursor: true });

      zone.on('pointerover', () => {
        btn.clear();
        btn.fillStyle(0x3a3a5e, 1);
        btn.fillRoundedRect(w / 2 - btnW / 2, y, btnW, btnH, 6);
        btn.lineStyle(2, 0xc9a96e, 1);
        btn.strokeRoundedRect(w / 2 - btnW / 2, y, btnW, btnH, 6);
        label.setColor('#ffe8b0');
      });

      zone.on('pointerout', () => {
        btn.clear();
        btn.fillStyle(0x2a2a3e, 0.8);
        btn.fillRoundedRect(w / 2 - btnW / 2, y, btnW, btnH, 6);
        btn.lineStyle(1, 0xc9a96e, 0.5);
        btn.strokeRoundedRect(w / 2 - btnW / 2, y, btnW, btnH, 6);
        label.setColor('#d4c5a0');
      });

      zone.on('pointerdown', () => {
        if ((item as any).disabled) return;
        if (item.scene) {
          this.cameras.main.fadeOut(500, 0, 0, 0);
          this.time.delayedCall(500, () => {
            this.scene.start(item.scene, item.data);
          });
        }
      });
    });

    // 版本号
    this.add.text(w - 10, h - 10, 'v0.1.0', {
      fontSize: '12px',
      color: '#554433',
      padding: { y: 2 },
    }).setOrigin(1, 1);

    // 淡入
    this.cameras.main.fadeIn(800, 0, 0, 0);
  }
}
