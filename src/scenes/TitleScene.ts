import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../core/config';
import { AuthClient } from '../systems/social/AuthClient';

/**
 * 标题/认证界面——注册 / 登录 / 角色选择。
 *
 * 视觉规范（沿用官网 E:/My2ddemo/index.html）：
 *   --bg-dark:  #0E1020  星空背景
 *   --cyan:     #1FD9C5  主色
 *   --crimson:  #FF4D6E  强调
 *   --text-light: #DFE3F0
 *   字体：ZCOOL QingKe HuangYou（大标题） + Noto Sans SC（正文）
 *
 * Stage D：所有账号/角色数据走 REST API。
 */

// ── 配色常量（同步官网） ──
const C = {
  bgDark: 0x0E1020,
  bgPanel: 0x14162A,
  cyan: 0x1FD9C5,
  cyanDeep: 0x0E9C8F,
  crimson: 0xFF4D6E,
  white: 0xFFFFFF,
  textLight: 0xDFE3F0,
  textMute: 0x9AA0BC,
  textBody: 0xAEB4CC,
  stroke: 0x2B2F45,
  strokeCyan: 0x4DD9C5,
};

/** 注入字体（与官网同款） */
function injectFonts(): void {
  if (document.getElementById('jie-fonts')) return;
  const link = document.createElement('link');
  link.id = 'jie-fonts';
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&family=ZCOOL+QingKe+HuangYou&display=swap';
  document.head.appendChild(link);
}

export class TitleScene extends Phaser.Scene {
  private authToken = '';
  private accountId = 0;
  /** 当前场景创建的所有 DOM 元素（输入框等），切界面时统一清理 */
  private domEls: HTMLElement[] = [];

  constructor() {
    super({ key: 'TitleScene' });
  }

  create(): void {
    this.cleanAllDom();
    this.authToken = '';
    this.accountId = 0;
    injectFonts();

    this.drawBackground();

    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT * 0.20, '解', {
      fontFamily: '"ZCOOL QingKe HuangYou", serif',
      fontSize: '180px',
      color: '#1FD9C5',
    }).setOrigin(0.5).setAlpha(0).setScale(0.6);

    // 标题渐变（cyan → crimson），通过 tween 模拟
    const titleText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT * 0.20, '解', {
      fontFamily: '"ZCOOL QingKe HuangYou", serif',
      fontSize: '180px',
    }).setOrigin(0.5).setAlpha(0);
    titleText.setStyle({ color: '#1FD9C5' });
    this.tweens.add({
      targets: titleText, alpha: 1, scaleX: 1, scaleY: 1,
      duration: 1200, ease: 'Back.easeOut',
      onStart: () => titleText.setScale(0.6),
    });
    // 副标题
    const sub = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT * 0.32, '── 斩断命运的锁链 ──', {
      fontFamily: '"Noto Sans SC", sans-serif',
      fontSize: '22px', color: '#AEB4CC', fontStyle: '500',
    }).setOrigin(0.5).setAlpha(0);
    this.tweens.add({ targets: sub, alpha: 1, duration: 800, delay: 600 });

    // 主按钮（胶囊形，与官网 btn-pill 同款）
    this.drawButton(GAME_WIDTH / 2, GAME_HEIGHT * 0.50, '注  册', true, () => this.showRegisterForm());
    this.drawButton(GAME_WIDTH / 2, GAME_HEIGHT * 0.60, '登  录', false, () => this.showLoginForm());

    // 版本
    this.add.text(GAME_WIDTH - 24, GAME_HEIGHT - 24, 'v0.4.0  ·  Stage D', {
      fontFamily: '"Noto Sans SC", sans-serif',
      fontSize: '13px', color: '#5C6178',
    }).setOrigin(1, 1);

    this.cameras.main.fadeIn(600, 14, 16, 32);
  }

  // ════════════════════════════════════════════════
  //  背景层：径向渐变 + 浮动灵子（呼应官网星空感）
  // ════════════════════════════════════════════════

  private drawBackground(): void {
    const w = GAME_WIDTH, h = GAME_HEIGHT;
    // 径向渐变（cyan 中心 → 深空蓝边）
    const g = this.add.graphics();
    const cx = w / 2, cy = h * 0.4;
    const steps = 32;
    const maxR = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const r = maxR * t;
      // 中心略带 cyan 调，外圈深空
      const cR = Math.round(33 + (14 - 33) * t);
      const cG = Math.round(43 + (16 - 43) * t);
      const cB = Math.round(76 + (32 - 76) * t);
      g.fillStyle((cR << 16) | (cG << 8) | cB, 1);
      g.fillCircle(cx, cy, r);
    }

    // 浮动灵子（cyan 调）
    for (let i = 0; i < 50; i++) {
      const px = Phaser.Math.Between(0, w);
      const py = Phaser.Math.Between(0, h);
      const size = Phaser.Math.Between(1, 3);
      const p = this.add.circle(px, py, size, C.cyan, 0.15 + Math.random() * 0.4);
      this.tweens.add({
        targets: p,
        y: py - Phaser.Math.Between(40, 140),
        alpha: 0,
        duration: Phaser.Math.Between(3000, 6000),
        repeat: -1,
        delay: Phaser.Math.Between(0, 4000),
        onRepeat: () => {
          p.x = Phaser.Math.Between(0, w);
          p.y = Phaser.Math.Between(h * 0.4, h);
          p.alpha = 0.15 + Math.random() * 0.4;
        },
      });
    }
  }

  /** 毛玻璃面板（高 480，宽 600，标题区 + 内容区） */
  private drawPanel(x: number, y: number, w: number, h: number, title: string): Phaser.GameObjects.Container {
    const panel = this.add.container(x, y);

    // 阴影层（黑色 30% 偏移）
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.35);
    shadow.fillRoundedRect(-w / 2 + 6, -h / 2 + 12, w, h, 20);

    // 主面板：半透明深色 + cyan 描边
    const bg = this.add.graphics();
    bg.fillStyle(0x14162A, 0.88);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 20);
    bg.lineStyle(1, C.strokeCyan, 0.5);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 20);

    // 顶部光带（cyan 微渐变）
    const topGlow = this.add.graphics();
    topGlow.fillGradientStyle(C.cyan, C.cyan, 0x14162A, 0x14162A, 0.25);
    topGlow.fillRoundedRect(-w / 2, -h / 2, w, 80, { tl: 20, tr: 20, bl: 0, br: 0 });

    // 标题
    const titleText = this.add.text(0, -h / 2 + 40, title, {
      fontFamily: '"ZCOOL QingKe HuangYou", serif',
      fontSize: '38px', color: '#FFFFFF',
    }).setOrigin(0.5);

    panel.add([shadow, bg, topGlow, titleText]);
    return panel;
  }

  // ════════════════════════════════════════════════
  //  按钮（官网 btn-pill 胶囊形）
  // ════════════════════════════════════════════════

  /**
   * 胶囊按钮（带发光 + hover 上浮）。
   * @param primary true=cyan 主色（实心）；false=半透明描边
   */
  private drawButton(
    x: number, y: number, label: string,
    primary: boolean, onClick: () => void,
  ): void {
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

    // 交互区
    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true });

    zone.on('pointerover', () => {
      this.tweens.add({ targets: container, y: y - 2, duration: 150, ease: 'Power2' });
      bg.clear();
      if (primary) {
        bg.fillStyle(C.cyan, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
        // 发光（外描边 + 阴影）
        bg.lineStyle(2, 0xFFFFFF, 0.4);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
      } else {
        bg.fillStyle(C.cyan, 0.15);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
        bg.lineStyle(2, C.cyan, 1);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
        text.setColor('#FFFFFF');
      }
    });
    zone.on('pointerout', () => {
      this.tweens.add({ targets: container, y: y, duration: 150, ease: 'Power2' });
      bg.clear();
      if (primary) {
        bg.fillStyle(C.cyan, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
        text.setColor('#0E1020');
      } else {
        bg.fillStyle(0x14162A, 0.6);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
        bg.lineStyle(1, C.strokeCyan, 0.8);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
        text.setColor('#1FD9C5');
      }
    });
    zone.on('pointerdown', () => {
      onClick();
    });
  }

  // ════════════════════════════════════════════════
  //  表单输入（毛玻璃输入框，cyan focus 指示条）
  // ════════════════════════════════════════════════

  /**
   * 创建单个毛玻璃输入框（带 label）。
   * @returns { el, getValue, setError, clearError }
   */
  private createField(
    x: number, y: number, w: number, h: number,
    label: string, placeholder: string, type: 'text' | 'password',
  ): {
    el: HTMLInputElement;
    getValue: () => string;
    setError: (msg: string) => void;
    clearError: () => void;
  } {
    // label
    this.add.text(x - w / 2 + 4, y - h / 2 - 26, label, {
      fontFamily: '"Noto Sans SC", sans-serif',
      fontSize: '14px', fontStyle: '600', color: '#AEB4CC',
    });

    // 容器背景（毛玻璃）
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / GAME_WIDTH;
    const scaleY = rect.height / GAME_HEIGHT;

    const el = document.createElement('input');
    el.type = type;
    el.maxLength = 32;
    el.placeholder = placeholder;
    el.style.cssText = `
      position:absolute;
      font-family:'Noto Sans SC',sans-serif;
      font-size:16px;color:#FFFFFF;font-weight:500;
      background:rgba(20,22,42,0.7);
      border:1.5px solid rgba(77,217,197,0.4);
      border-radius:10px;outline:none;text-align:left;
      padding:0 16px;
      backdrop-filter:blur(8px);
      transition:border-color .2s, box-shadow .2s;
      z-index:9999;
    `;
    el.style.width = (w * scaleX) + 'px';
    el.style.height = (h * scaleY) + 'px';
    el.style.left = (rect.left + (x - w / 2) * scaleX) + 'px';
    el.style.top = (rect.top + (y - h / 2) * scaleY) + 'px';
    document.body.appendChild(el);
    // 追踪，切界面时统一清理（防 DOM 残留与 Phaser 按钮穿透）
    this.domEls.push(el);

    // 阻断事件穿透到 Phaser 画布（点 DOM input 不能触发 canvas 下的按钮 zone）
    const blockEvent = (e: Event) => { e.stopPropagation(); e.stopImmediatePropagation(); };
    el.addEventListener('mousedown', blockEvent);
    el.addEventListener('pointerdown', blockEvent);

    // focus 效果
    el.addEventListener('focus', () => {
      el.style.borderColor = '#1FD9C5';
      el.style.boxShadow = '0 0 0 3px rgba(31,217,197,0.18)';
    });
    el.addEventListener('blur', () => {
      el.style.borderColor = 'rgba(77,217,197,0.4)';
      el.style.boxShadow = 'none';
    });

    // 错误提示 text（初始隐藏）
    const errText = this.add.text(x + w / 2, y + h / 2 + 6, '', {
      fontFamily: '"Noto Sans SC", sans-serif',
      fontSize: '12px', color: '#FF4D6E',
    }).setOrigin(1, 0).setVisible(false);

    return {
      el,
      getValue: () => el.value.trim(),
      setError: (msg: string) => {
        errText.setText(msg).setVisible(true);
        el.style.borderColor = '#FF4D6E';
        el.style.boxShadow = '0 0 0 3px rgba(255,77,110,0.18)';
      },
      clearError: () => {
        errText.setVisible(false);
        el.style.borderColor = 'rgba(77,217,197,0.4)';
        el.style.boxShadow = 'none';
      },
    };
  }

  // ════════════════════════════════════════════════
  //  注册表单
  // ════════════════════════════════════════════════

  private showRegisterForm(): void {
    this.clearMenu();
    this.drawBackground();

    const w = 540, h = 520;
    this.drawPanel(GAME_WIDTH / 2, GAME_HEIGHT * 0.5, w, h, '注 册');

    const fx = GAME_WIDTH / 2;
    const fw = 360, fh = 50;
    const startY = GAME_HEIGHT * 0.5 - 100;
    const gap = 90;

    const fUser = this.createField(fx, startY, fw, fh, '账 号', '2-20 字符，唯一标识', 'text');
    const fPass = this.createField(fx, startY + gap, fw, fh, '密 码', '4-32 字符', 'password');
    const fSec  = this.createField(fx, startY + gap * 2, fw, fh, '安全密码', '修改密码时使用', 'password');

    const fields = [fUser, fPass, fSec];
    fUser.el.focus();

    // 按钮组
    const btnY = startY + gap * 2 + 100;
    this.drawButton(fx - 130, btnY, '注  册', true, async () => {
      fields.forEach(f => f.clearError());
      const username = fUser.getValue();
      const password = fPass.getValue();
      const security = fSec.getValue();
      if (!username) { fUser.setError('请输入账号'); return; }
      if (!password) { fPass.setError('请输入密码'); return; }
      if (!security) { fSec.setError('请输入安全密码'); return; }

      const res = await AuthClient.register(username, password, security);
      if (!res.ok) {
        // 根据错误定位字段
        if (res.msg?.includes('账号')) fUser.setError(res.msg);
        else if (res.msg?.includes('密码')) fPass.setError(res.msg);
        else fSec.setError(res.msg || '注册失败');
        return;
      }

      this.authToken = res.token;
      this.accountId = res.accountId;
      fields.forEach(f => f.el.remove());
      this.clearMenu();
      this.goCreateCharacter();
    });

    this.drawButton(fx + 130, btnY, '返  回', false, () => {
      fields.forEach(f => f.el.remove());
      this.clearMenu();
      this.create();
    });
  }

  // ════════════════════════════════════════════════
  //  登录表单
  // ════════════════════════════════════════════════

  private showLoginForm(): void {
    this.clearMenu();
    this.drawBackground();

    const w = 540, h = 420;
    this.drawPanel(GAME_WIDTH / 2, GAME_HEIGHT * 0.5, w, h, '登 录');

    const fx = GAME_WIDTH / 2;
    const fw = 360, fh = 50;
    const startY = GAME_HEIGHT * 0.5 - 40;
    const gap = 90;

    const fUser = this.createField(fx, startY, fw, fh, '账 号', '请输入账号', 'text');
    const fPass = this.createField(fx, startY + gap, fw, fh, '密 码', '请输入密码', 'password');

    fUser.el.focus();

    const btnY = startY + gap + 130;
    this.drawButton(fx - 130, btnY, '登  录', true, async () => {
      fUser.clearError(); fPass.clearError();
      const username = fUser.getValue();
      const password = fPass.getValue();
      if (!username) { fUser.setError('请输入账号'); return; }
      if (!password) { fPass.setError('请输入密码'); return; }

      const res = await AuthClient.login(username, password);
      if (!res.ok) {
        fPass.setError(res.msg || '登录失败');
        return;
      }

      this.authToken = res.token;
      this.accountId = res.accountId;
      fUser.el.remove(); fPass.el.remove();
      this.clearMenu();
      this.showCharacterSelect();
    });

    this.drawButton(fx + 130, btnY, '返  回', false, () => {
      fUser.el.remove(); fPass.el.remove();
      this.clearMenu();
      this.create();
    });
  }

  // ════════════════════════════════════════════════
  //  角色选择（带状态显示的卡片列）
  // ════════════════════════════════════════════════

  private async showCharacterSelect(): Promise<void> {
    this.clearMenu();
    this.drawBackground();

    const pw = 640, ph = 560;
    this.drawPanel(GAME_WIDTH / 2, GAME_HEIGHT * 0.5, pw, ph, '选择角色');

    const res = await AuthClient.getCharacters(this.authToken);
    const list: Array<{ id: number; name: string; element: string }> = res.ok ? (res.characters || []) : [];

    const fx = GAME_WIDTH / 2;
    const cardW = 440, cardH = 50, gap = 10;
    const startY = GAME_HEIGHT * 0.5 - ph / 2 + 100;

    if (list.length === 0) {
      this.add.text(fx, startY + 20, '暂无角色\n点击下方"创建新角色"开始冒险', {
        fontFamily: '"Noto Sans SC", sans-serif',
        fontSize: '15px', color: '#7E849E', align: 'center',
      }).setOrigin(0.5);
    }

    list.forEach((ch, i) => {
      this.drawCharacterCard(fx, startY + i * (cardH + gap), cardW, cardH, ch);
    });

    const btnY = startY + Math.max(list.length, 1) * (cardH + gap) + 30;
    this.drawButton(fx - 130, btnY, '创建新角色', true, () => {
      this.clearMenu();
      this.goCreateCharacter();
    });
    this.drawButton(fx + 130, btnY, '返  回', false, () => {
      this.authToken = '';
      this.clearMenu();
      this.create();
    });
  }

  private drawCharacterCard(x: number, y: number, w: number, h: number, ch: { id: number; name: string; element: string }): void {
    const container = this.add.container(x, y);

    const bg = this.add.graphics();
    bg.fillStyle(0x1E2138, 0.7);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    bg.lineStyle(1, C.strokeCyan, 0.4);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);

    // 元素色块
    const elColors: Record<string, number> = { '火': 0xFF4D6E, '风': 0x1FD9C5, '水': 0x4D9AFF, '土': 0xCC9944, 'fire': 0xFF4D6E, 'wind': 0x1FD9C5, 'water': 0x4D9AFF, 'earth': 0xCC9944 };
    const elColor = elColors[ch.element] || C.cyan;
    const elDot = this.add.graphics();
    elDot.fillStyle(elColor, 1);
    elDot.fillCircle(-w / 2 + 24, 0, 8);
    elDot.lineStyle(2, elColor, 0.4);
    elDot.strokeCircle(-w / 2 + 24, 0, 12);

    // 角色名
    const name = this.add.text(-w / 2 + 50, 0, ch.name, {
      fontFamily: '"Noto Sans SC", sans-serif',
      fontSize: '18px', fontStyle: '700', color: '#FFFFFF',
    }).setOrigin(0, 0.5);

    // 元素标签
    const elTag = this.add.text(w / 2 - 30, 0, ch.element, {
      fontFamily: '"Noto Sans SC", sans-serif',
      fontSize: '13px', fontStyle: '500', color: '#AEB4CC',
    }).setOrigin(1, 0.5);

    container.add([bg, elDot, name, elTag]);

    // hover 效果 + 进入
    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(0x1E2138, 0.95);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
      bg.lineStyle(2, C.cyan, 0.9);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
      elDot.lineStyle(2, elColor, 0.8);
      elDot.strokeCircle(-w / 2 + 24, 0, 14);
      name.setColor('#1FD9C5');
    });
    zone.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(0x1E2138, 0.7);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
      bg.lineStyle(1, C.strokeCyan, 0.4);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
      elDot.lineStyle(2, elColor, 0.4);
      elDot.strokeCircle(-w / 2 + 24, 0, 12);
      name.setColor('#FFFFFF');
    });
    zone.on('pointerdown', () => {
      this.clearMenu();
      this.enterGame(ch.id, ch.name, ch.element);
    });
  }

  // ════════════════════════════════════════════════
  //  跳转
  // ════════════════════════════════════════════════

  private goCreateCharacter(): void {
    this.cameras.main.fadeOut(500, 14, 16, 32);
    this.time.delayedCall(500, () => {
      this.scene.start('CreateCharacterScene', {
        authToken: this.authToken,
        accountId: this.accountId,
      });
    });
  }

  private enterGame(charId: number, name: string, element: string): void {
    this.cameras.main.fadeOut(500, 14, 16, 32);
    this.time.delayedCall(500, () => {
      this.scene.start('GameScene', {
        newGame: false,
        authToken: this.authToken,
        characterId: charId,
        characterName: name,
        characterElement: element,
      });
    });
  }

  private clearMenu(): void {
    this.children.removeAll(true);
    this.cleanAllDom();
  }

  /** 清理该场景创建的所有 DOM 元素（输入框等），防止与下一表单叠层 */
  private cleanAllDom(): void {
    for (const el of this.domEls) {
      try { el.remove(); } catch (_) { /* already gone */ }
    }
    this.domEls = [];
  }
}
