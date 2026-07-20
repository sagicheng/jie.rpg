import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../core/config';
import { AuthClient } from '../systems/social/AuthClient';

/**
 * 建角场景：输入角色名 + 选择元素共鸣。
 *
 * 设计风格与 TitleScene/官网同款：cyan/crimson 渐变、玻璃态、胶囊按钮。
 */

const C = {
  cyan: 0x1FD9C5,
  crimson: 0xFF4D6E,
  strokeCyan: 0x4DD9C5,
  elFire: 0xFF4D6E,
  elWind: 0x1FD9C5,
  elWater: 0x4D9AFF,
  elEarth: 0xCC9944,
};

const ELEMENTS: Array<{ key: string; name: string; desc: string; color: number }> = [
  { key: '火', name: '火', desc: '强攻型\nATK +10%', color: C.elFire },
  { key: '风', name: '风', desc: '敏捷型\nSPD +10%', color: C.elWind },
  { key: '水', name: '水', desc: '均衡型\nHP+5% MP+5%', color: C.elWater },
  { key: '土', name: '土', desc: '防御型\nDEF +10%', color: C.elEarth },
];

export class CreateCharacterScene extends Phaser.Scene {
  private authToken = '';
  private playerName = '';
  private domEls: HTMLElement[] = [];

  constructor() {
    super({ key: 'CreateCharacterScene' });
  }

  create(data?: { authToken?: string }): void {
    this.domEls.forEach(e => { try { e.remove(); } catch (_) {} });
    this.domEls = [];
    this.authToken = data?.authToken || '';
    this.drawBackground();

    // 标题
    this.add.text(GAME_WIDTH / 2, 80, '建 立 角 色', {
      fontFamily: '"ZCOOL QingKe HuangYou", serif',
      fontSize: '52px', color: '#FFFFFF',
    }).setOrigin(0.5).setAlpha(0);
    this.add.text(GAME_WIDTH / 2, 145, '输入你的名字 · 选择元素共鸣', {
      fontFamily: '"Noto Sans SC", sans-serif',
      fontSize: '16px', color: '#AEB4CC',
    }).setOrigin(0.5).setAlpha(0);

    this.showNamingInput();
    this.cameras.main.fadeIn(600, 14, 16, 32);
  }

  // ════════════════════════════════════════════════
  //  背景（与 TitleScene 同款）
  // ════════════════════════════════════════════════

  private drawBackground(): void {
    const w = GAME_WIDTH, h = GAME_HEIGHT;
    const cx = w / 2, cy = h * 0.5;
    const steps = 32;
    const maxR = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const cR = Math.round(33 + (14 - 33) * t);
      const cG = Math.round(43 + (16 - 43) * t);
      const cB = Math.round(76 + (32 - 76) * t);
      this.add.graphics().fillStyle((cR << 16) | (cG << 8) | cB, 1).fillCircle(cx, cy, maxR * t);
    }
    // 灵子
    for (let i = 0; i < 40; i++) {
      const px = Phaser.Math.Between(0, w);
      const py = Phaser.Math.Between(0, h);
      const p = this.add.circle(px, py, Phaser.Math.Between(1, 3), C.cyan, 0.15 + Math.random() * 0.4);
      this.tweens.add({
        targets: p, y: py - Phaser.Math.Between(40, 140), alpha: 0,
        duration: Phaser.Math.Between(3000, 6000), repeat: -1,
        delay: Phaser.Math.Between(0, 4000),
        onRepeat: () => {
          p.x = Phaser.Math.Between(0, w);
          p.y = Phaser.Math.Between(h * 0.4, h);
          p.alpha = 0.15 + Math.random() * 0.4;
        },
      });
    }
  }

  // ════════════════════════════════════════════════
  //  名字输入
  // ════════════════════════════════════════════════

  private showNamingInput(): void {
    const fx = GAME_WIDTH / 2, fy = GAME_HEIGHT * 0.40;
    const fw = 420, fh = 54;

    // 标签
    this.add.text(fx - fw / 2, fy - fh / 2 - 28, '角色名', {
      fontFamily: '"Noto Sans SC", sans-serif',
      fontSize: '14px', fontStyle: '600', color: '#AEB4CC',
    });

    // 输入框（毛玻璃）
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / GAME_WIDTH;
    const scaleY = rect.height / GAME_HEIGHT;
    const inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.maxLength = 12;
    inputEl.placeholder = '1-12 字符';
    inputEl.style.cssText = `
      position:absolute;font-family:'Noto Sans SC',sans-serif;
      font-size:18px;color:#FFFFFF;font-weight:500;
      background:rgba(20,22,42,0.7);border:1.5px solid rgba(77,217,197,0.4);
      border-radius:12px;outline:none;text-align:center;padding:0 16px;
      backdrop-filter:blur(8px);
      transition:border-color .2s, box-shadow .2s;z-index:9999;
    `;
    inputEl.style.width = (fw * scaleX) + 'px';
    inputEl.style.height = (fh * scaleY) + 'px';
    inputEl.style.left = (rect.left + (fx - fw / 2) * scaleX) + 'px';
    inputEl.style.top = (rect.top + (fy - fh / 2) * scaleY) + 'px';
    document.body.appendChild(inputEl);
    this.domEls.push(inputEl);
    // 阻断事件穿透到 Phaser 画布
    const blockEvt = (e: Event) => { e.stopPropagation(); e.stopImmediatePropagation(); };
    inputEl.addEventListener('mousedown', blockEvt);
    inputEl.addEventListener('pointerdown', blockEvt);
    inputEl.focus();
    inputEl.addEventListener('focus', () => {
      inputEl.style.borderColor = '#1FD9C5';
      inputEl.style.boxShadow = '0 0 0 3px rgba(31,217,197,0.18)';
    });
    inputEl.addEventListener('blur', () => {
      inputEl.style.borderColor = 'rgba(77,217,197,0.4)';
      inputEl.style.boxShadow = 'none';
    });

    // 错误提示
    const errText = this.add.text(fx + fw / 2, fy + fh / 2 + 6, '', {
      fontFamily: '"Noto Sans SC", sans-serif',
      fontSize: '12px', color: '#FF4D6E',
    }).setOrigin(1, 0).setVisible(false);

    // 确认按钮（cyan 主色）
    const btnY = fy + fh / 2 + 70;
    this.drawButton(fx, btnY, '选择元素', true, () => {
      const name = inputEl.value.trim();
      if (!name) {
        errText.setText('请输入角色名').setVisible(true);
        inputEl.style.borderColor = '#FF4D6E';
        return;
      }
      inputEl.parentNode?.removeChild(inputEl);
      this.children.removeAll(true);
      this.drawBackground();
      this.playerName = name;
      this.showElementSelection();
    });
  }

  // ════════════════════════════════════════════════
  //  元素选择（4 个高质感卡片）
  // ════════════════════════════════════════════════

  private showElementSelection(): void {
    // 顶部：已输入名字 + 提示
    this.add.text(GAME_WIDTH / 2, 100, `「${this.playerName}」`, {
      fontFamily: '"ZCOOL QingKe HuangYou", serif',
      fontSize: '38px', color: '#1FD9C5',
    }).setOrigin(0.5);
    this.add.text(GAME_WIDTH / 2, 150, '选择你的元素共鸣', {
      fontFamily: '"Noto Sans SC", sans-serif',
      fontSize: '18px', color: '#AEB4CC',
    }).setOrigin(0.5);

    // 4 张元素卡片
    const cardW = 180, cardH = 240, gap = 30;
    const totalW = cardW * 4 + gap * 3;
    const startX = (GAME_WIDTH - totalW) / 2 + cardW / 2;
    const cardY = GAME_HEIGHT * 0.46;

    ELEMENTS.forEach((el, i) => {
      const x = startX + i * (cardW + gap);
      this.drawElementCard(x, cardY, cardW, cardH, el);
    });

    // 状态文字
    const statusText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT * 0.78, '', {
      fontFamily: '"Noto Sans SC", sans-serif',
      fontSize: '14px', color: '#FF4D6E',
    }).setOrigin(0.5);

    // 4 张卡片的点击处理（通过在卡片构造时挂回调，简化：在这里也保存一个 handler 引用）
    ELEMENTS.forEach((el, i) => {
      const x = startX + i * (cardW + gap);
      this.elementClickHandler(x, cardY, cardW, cardH, el, statusText);
    });
  }

  private drawElementCard(x: number, y: number, w: number, h: number, el: typeof ELEMENTS[number]): void {
    const container = this.add.container(x, y);

    // 阴影
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.3);
    shadow.fillRoundedRect(-w / 2 + 4, -h / 2 + 8, w, h, 16);

    // 卡片背景
    const bg = this.add.graphics();
    bg.fillStyle(0x14162A, 0.85);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 16);
    bg.lineStyle(1, el.color, 0.4);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 16);

    // 顶部色块（元素色横条）
    const topBar = this.add.graphics();
    topBar.fillStyle(el.color, 0.3);
    topBar.fillRoundedRect(-w / 2, -h / 2, w, 60, { tl: 16, tr: 16, bl: 0, br: 0 });

    // 元素大字符
    const elText = this.add.text(0, -h / 2 + 30, el.name, {
      fontFamily: '"ZCOOL QingKe HuangYou", serif',
      fontSize: '64px',
    }).setOrigin(0.5);
    elText.setStyle({ color: this.hex(el.color) });

    // 描述（多行）
    const descText = this.add.text(0, h / 4 + 5, el.desc, {
      fontFamily: '"Noto Sans SC", sans-serif',
      fontSize: '14px', color: '#DFE3F0', align: 'center', lineSpacing: 6,
    }).setOrigin(0.5);

    container.add([shadow, bg, topBar, elText, descText]);
    this._elementContainers.push({ container, bg, elText, descText, el });
  }

  private _elementContainers: Array<{
    container: Phaser.GameObjects.Container;
    bg: Phaser.GameObjects.Graphics;
    elText: Phaser.GameObjects.Text;
    descText: Phaser.GameObjects.Text;
    el: typeof ELEMENTS[number];
  }> = [];

  private elementClickHandler(
    x: number, y: number, w: number, h: number, el: typeof ELEMENTS[number],
    statusText: Phaser.GameObjects.Text,
  ): void {
    const idx = ELEMENTS.findIndex(e => e.key === el.key);
    const card = this._elementContainers[idx];
    if (!card) return;

    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true });

    zone.on('pointerover', () => {
      this.tweens.add({ targets: card.container, y: y - 6, duration: 200, ease: 'Power2' });
      card.bg.clear();
      card.bg.fillStyle(0x14162A, 0.95);
      card.bg.fillRoundedRect(-w / 2, -h / 2, w, h, 16);
      card.bg.lineStyle(2, el.color, 1);
      card.bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 16);
      card.elText.setScale(1.1);
    });
    zone.on('pointerout', () => {
      this.tweens.add({ targets: card.container, y: y, duration: 200, ease: 'Power2' });
      card.bg.clear();
      card.bg.fillStyle(0x14162A, 0.85);
      card.bg.fillRoundedRect(-w / 2, -h / 2, w, h, 16);
      card.bg.lineStyle(1, el.color, 0.4);
      card.bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 16);
      card.elText.setScale(1);
    });
    zone.on('pointerdown', async () => {
      statusText.setColor('#1FD9C5').setText('创建角色中…');
      const res = await AuthClient.createCharacter(this.authToken, this.playerName, el.key);
      if (!res.ok) {
        statusText.setColor('#FF4D6E').setText(res.msg || '创建失败');
        return;
      }
      this.cameras.main.fadeOut(500, 14, 16, 32);
      this.time.delayedCall(500, () => {
        this.scene.start('GameScene', {
          newGame: true,
          authToken: this.authToken,
          characterId: res.character.id,
          characterName: this.playerName,
          characterElement: el.key,
        });
      });
    });
  }

  // ════════════════════════════════════════════════
  //  工具
  // ════════════════════════════════════════════════

  private drawButton(x: number, y: number, label: string, primary: boolean, onClick: () => void): void {
    const w = 240, h = 54;
    const container = this.add.container(x, y);
    const bg = this.add.graphics();
    if (primary) {
      bg.fillStyle(C.cyan, 1);
    } else {
      bg.fillStyle(0x14162A, 0.6);
      bg.lineStyle(1, C.strokeCyan, 0.8);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    }
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    const text = this.add.text(0, 0, label, {
      fontFamily: '"Noto Sans SC", sans-serif',
      fontSize: '18px', fontStyle: '700',
      color: primary ? '#0E1020' : '#1FD9C5',
    }).setOrigin(0.5);
    container.add([bg, text]);

    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => {
      this.tweens.add({ targets: container, y: y - 2, duration: 150, ease: 'Power2' });
      bg.clear();
      if (primary) {
        bg.fillStyle(C.cyan, 1); bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
        bg.lineStyle(2, 0xFFFFFF, 0.4);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
      } else {
        bg.fillStyle(C.cyan, 0.15); bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
        bg.lineStyle(2, C.cyan, 1);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
        text.setColor('#FFFFFF');
      }
    });
    zone.on('pointerout', () => {
      this.tweens.add({ targets: container, y: y, duration: 150, ease: 'Power2' });
      bg.clear();
      if (primary) {
        bg.fillStyle(C.cyan, 1); bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
        text.setColor('#0E1020');
      } else {
        bg.fillStyle(0x14162A, 0.6); bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
        bg.lineStyle(1, C.strokeCyan, 0.8);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
        text.setColor('#1FD9C5');
      }
    });
    zone.on('pointerdown', () => { onClick(); });
  }

  private hex(n: number): string {
    return '#' + n.toString(16).padStart(6, '0').toUpperCase();
  }
}
