/**
 * 对话 / 剧情文本框组件
 * 渲染 NPC 对话、任务对白与可选项（choices），支持逐字打字效果。
 */

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/config';

export interface DialogueLine {
  speaker: string;
  text: string;
  choices?: { text: string; callback: () => void }[];
}

export class DialogueBox {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Graphics;
  private nameText: Phaser.GameObjects.Text;
  private contentText: Phaser.GameObjects.Text;
  private continueHint: Phaser.GameObjects.Text;
  private choiceButtons: Phaser.GameObjects.Container[] = [];
  private isTyping = false;
  private fullText = '';
  private currentChar = 0;
  private onComplete: (() => void) | null = null;

  private readonly boxW = 700;
  private readonly boxH = 190;
  private readonly paddingX = 24;
  private readonly textStartY = 48;
  private readonly maxCharsPerLine = 42; // 15px中文字 ≈15px宽, 650/15≈43

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.container = scene.add.container(
      Math.round(scene.cameras.main.scrollX), Math.round(scene.cameras.main.scrollY)
    ).setDepth(200).setVisible(false);

    const bx = (GAME_WIDTH - this.boxW) / 2;
    const by = GAME_HEIGHT - this.boxH - 24;

    this.bg = scene.add.graphics();
    this.bg.fillStyle(0x1a1a2e, 0.96);
    this.bg.fillRoundedRect(bx, by, this.boxW, this.boxH, 12);
    this.bg.lineStyle(2, 0xc9a96e, 0.7);
    this.bg.strokeRoundedRect(bx, by, this.boxW, this.boxH, 12);
    this.container.add(this.bg);

    this.nameText = scene.add.text(bx + this.paddingX, by + 10, '', {
      fontSize: '16px',
      color: '#c9a96e',
      fontFamily: 'serif',
      fontStyle: 'bold',
    });
    this.container.add(this.nameText);

    this.contentText = scene.add.text(bx + this.paddingX, by + this.textStartY, '', {
      fontSize: '15px',
      color: '#e8ddc8',
      fontFamily: 'serif',
      lineSpacing: 8,
    });
    this.container.add(this.contentText);

    this.continueHint = scene.add.text(bx + this.boxW - 40, by + this.boxH - 18, '▼', {
      fontSize: '14px',
      color: '#c9a96e',
    }).setOrigin(1, 0.5).setVisible(false);
    this.container.add(this.continueHint);

    scene.input.on('pointerdown', () => {
      if (this.isTyping) {
        this.isTyping = false;
        this.contentText.setText(this.fullText);
        this.continueHint.setVisible(true);
        return;
      }
      if (this.container.visible) {
        this.hide();
        if (this.onComplete) {
          const cb = this.onComplete;
          this.onComplete = null;
          cb();
        }
      }
    });
  }

  /** 中文字符串手动换行 */
  private wrapText(text: string): string {
    let result = '';
    let lineLen = 0;
    for (const ch of text) {
      result += ch;
      lineLen++;
      if (ch === '\n') {
        lineLen = 0;
      } else if (lineLen >= this.maxCharsPerLine) {
        result += '\n';
        lineLen = 0;
      }
    }
    return result;
  }

  show(line: DialogueLine, onComplete?: () => void): void {
    this.clearChoices();
    this.onComplete = onComplete || null;

    // 更新到当前摄像机位置
    this.container.setPosition(
      Math.round(this.scene.cameras.main.scrollX), Math.round(this.scene.cameras.main.scrollY)
    );

    this.nameText.setText(line.speaker);
    this.fullText = this.wrapText(line.text);
    this.currentChar = 0;
    this.contentText.setText('');
    this.continueHint.setVisible(false);
    this.container.setVisible(true);

    this.isTyping = true;
    const totalChars = this.fullText.length;
    this.scene.time.addEvent({
      delay: 35,
      repeat: totalChars - 1,
      callback: () => {
        this.currentChar++;
        this.contentText.setText(this.fullText.slice(0, this.currentChar));
        if (this.currentChar >= totalChars) {
          this.isTyping = false;
          this.continueHint.setVisible(true);
          if (line.choices && line.choices.length > 0) {
            this.showChoices(line.choices);
          }
        }
      },
    });
  }

  private showChoices(choices: { text: string; callback: () => void }[]): void {
    const startY = GAME_HEIGHT - 190;
    const cam = this.scene.cameras.main;
    choices.forEach((choice, i) => {
      const y = startY - i * 42;
      const btn = this.scene.add.container(GAME_WIDTH / 2 + cam.scrollX, y + cam.scrollY);

      const bg = this.scene.add.graphics();
      bg.fillStyle(0x2a2a3e, 0.9);
      bg.fillRoundedRect(-150, -18, 300, 36, 8);
      bg.lineStyle(1, 0xc9a96e, 0.5);
      bg.strokeRoundedRect(-150, -18, 300, 36, 8);
      btn.add(bg);

      const txt = this.scene.add.text(0, 0, '> ' + choice.text, {
        fontSize: '15px',
        color: '#d4c5a0',
      }).setOrigin(0.5);
      btn.add(txt);

      const zone = this.scene.add.zone(0, 0, 300, 36)
        .setInteractive({ useHandCursor: true });

      zone.on('pointerover', () => {
        bg.clear();
        bg.fillStyle(0x3a3a5e, 1);
        bg.fillRoundedRect(-150, -18, 300, 36, 8);
        bg.lineStyle(2, 0xc9a96e, 1);
        bg.strokeRoundedRect(-150, -18, 300, 36, 8);
        txt.setColor('#ffe8b0');
      });

      zone.on('pointerout', () => {
        bg.clear();
        bg.fillStyle(0x2a2a3e, 0.9);
        bg.fillRoundedRect(-150, -18, 300, 36, 8);
        bg.lineStyle(1, 0xc9a96e, 0.5);
        bg.strokeRoundedRect(-150, -18, 300, 36, 8);
        txt.setColor('#d4c5a0');
      });

      zone.on('pointerdown', () => {
        this.clearChoices();
        this.hide();
        choice.callback();
      });

      btn.add(zone);
      btn.setDepth(201);
      this.choiceButtons.push(btn);
    });
  }

  private clearChoices(): void {
    this.choiceButtons.forEach(b => b.destroy());
    this.choiceButtons = [];
  }

  private hide(): void {
    this.container.setVisible(false);
    this.clearChoices();
  }

  get visible(): boolean {
    return this.container.visible;
  }

  destroy(): void {
    this.clearChoices();
    this.container.destroy();
  }
}
