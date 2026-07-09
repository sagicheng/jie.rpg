import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
import { GameState } from '../systems/GameState';
import { SaveManager } from '../systems/SaveManager';

/**
 * 建角场景：进地图之前完成角色创建（输入名字 + 选择元素共鸣）。
 * 自包含，不依赖 GameScene 的专有字段。确认后把建角结果经 scene.start 传给 GameScene，
 * 由其 reset() 之后恢复，避免被新游戏重置清空。
 */
export class CreateCharacterScene extends Phaser.Scene {
  constructor() {
    super({ key: 'CreateCharacterScene' });
  }

  create(): void {
    // 新游戏：清空旧进度（playerName 置空表示尚未建角）
    GameState.resetCore();

    const bg = this.add.graphics();
    bg.fillGradientStyle(0x0a0a1e, 0x0a0a1e, 0x1a0a2e, 0x1a0a2e, 1);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    this.add.text(GAME_WIDTH / 2, 90, '建 立 角 色', {
      fontSize: '40px', color: '#c9a96e', fontStyle: 'bold', fontFamily: 'serif',
    }).setOrigin(0.5);
    this.add.text(GAME_WIDTH / 2, 140, '输入你的名字，选择元素共鸣', {
      fontSize: '16px', color: '#887755',
    }).setOrigin(0.5);

    this.showNamingInput();
    this.cameras.main.fadeIn(500, 0, 0, 0);
  }

  /** 输入角色名（强制非空） */
  private showNamingInput(): void {
    const inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.maxLength = 12;
    inputEl.placeholder = '输入角色名';
    inputEl.style.cssText = 'position:absolute;width:360px;height:36px;font-size:18px;color:#ffffff;background:#0a0a1e;border:1px solid #446688;border-radius:4px;text-align:center;outline:none;z-index:9999;';
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / GAME_WIDTH;
    const scaleY = rect.height / GAME_HEIGHT;
    inputEl.style.left = (rect.left + rect.width / 2 - 180 * scaleX) + 'px';
    inputEl.style.top = (rect.top + (GAME_HEIGHT / 2 - 80) * scaleY) + 'px';
    inputEl.style.width = (360 * scaleX) + 'px';
    inputEl.style.height = (36 * scaleY) + 'px';
    document.body.appendChild(inputEl);
    inputEl.focus();

    const hint = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 44, '', {
      fontSize: '12px', color: '#cc6666',
    }).setOrigin(0.5);

    const confirm = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 10, '[ 确认 ]', {
      fontSize: '16px', color: '#88cc88', fontStyle: 'bold',
      backgroundColor: '#11221188', padding: { x: 24, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    confirm.on('pointerover', () => confirm.setColor('#aaffaa'));
    confirm.on('pointerout', () => confirm.setColor('#88cc88'));

    const doConfirm = () => {
      const name = inputEl.value.trim();
      if (!name) { hint.setText('请输入角色名'); return; }
      if (inputEl.parentNode) inputEl.parentNode.removeChild(inputEl);
      hint.destroy(); confirm.destroy();
      GameState.playerName = name;
      GameState.hasCreated = true;
      this.showElementSelection();
    };
    confirm.on('pointerdown', doConfirm);
    inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doConfirm(); } });
  }

  /** 选择元素共鸣（火/风/水/土），选完存档并进地图 */
  private showElementSelection(): void {
    const elements = ['火', '风', '水', '土'];
    const colors: Record<string, string> = { '火': '#ff6644', '风': '#44cc88', '水': '#4488ff', '土': '#cc9944' };
    const desc: Record<string, string> = { '火': '强攻型，ATK+10%', '风': '敏捷型，SPD+10%', '水': '均衡型，HP+5% MP+5%', '土': '防御型，DEF+10%' };

    const panel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 20).setDepth(400).setScrollFactor(0);
    const bg = this.add.graphics();
    bg.fillStyle(0x1a1a2e, 0.96); bg.fillRoundedRect(-250, -90, 500, 180, 10);
    bg.lineStyle(2, 0xc9a96e, 0.7); bg.strokeRoundedRect(-250, -90, 500, 180, 10);
    panel.add(bg);
    panel.add(this.add.text(0, -60, '选择你的元素共鸣', {
      fontSize: '20px', color: '#ffe8b0', fontStyle: 'bold',
    }).setOrigin(0.5));

    elements.forEach((el, i) => {
      const ex = -180 + i * 120;
      const card = this.add.graphics();
      card.fillStyle(parseInt(colors[el].replace('#', ''), 16), 0.2); card.fillRoundedRect(ex - 45, -25, 90, 80, 6);
      card.lineStyle(2, parseInt(colors[el].replace('#', ''), 16), 0.6); card.strokeRoundedRect(ex - 45, -25, 90, 80, 6);
      panel.add(card);
      panel.add(this.add.text(ex, -15, el, { fontSize: '22px', color: colors[el], fontStyle: 'bold' }).setOrigin(0.5));
      panel.add(this.add.text(ex, 10, desc[el], {
        fontSize: '9px', color: '#aaaacc', wordWrap: { width: 80 },
      }).setOrigin(0.5));
      card.setInteractive(new Phaser.Geom.Rectangle(ex - 45, -25, 90, 80), Phaser.Geom.Rectangle.Contains);
      card.on('pointerover', () => { card.clear(); card.fillStyle(parseInt(colors[el].replace('#', ''), 16), 0.4); card.fillRoundedRect(ex - 45, -25, 90, 80, 6); card.lineStyle(2, parseInt(colors[el].replace('#', ''), 16), 0.9); card.strokeRoundedRect(ex - 45, -25, 90, 80, 6); });
      card.on('pointerout', () => { card.clear(); card.fillStyle(parseInt(colors[el].replace('#', ''), 16), 0.2); card.fillRoundedRect(ex - 45, -25, 90, 80, 6); card.lineStyle(2, parseInt(colors[el].replace('#', ''), 16), 0.6); card.strokeRoundedRect(ex - 45, -25, 90, 80, 6); });
      card.on('pointerdown', () => {
        GameState.element = el;
        GameState.recalcStats();
        SaveManager.save();
        this.scene.start('GameScene', { newGame: true, name: GameState.playerName, element: el });
      });
    });
  }
}
