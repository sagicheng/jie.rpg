import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
import { GameState } from '../systems/GameState';
import { expForLevel } from '../systems/BattleData';
import { MAIN_QUESTS, MAIN_QUEST_ORDER, SIDE_QUESTS } from '../systems/QuestData';

export class UIScene extends Phaser.Scene {
  private hpBar!: Phaser.GameObjects.Graphics;
  private mpBar!: Phaser.GameObjects.Graphics;
  private expBar!: Phaser.GameObjects.Graphics;
  private hpText!: Phaser.GameObjects.Text;
  private mpText!: Phaser.GameObjects.Text;
  private goldText!: Phaser.GameObjects.Text;
  private lvText!: Phaser.GameObjects.Text;
  private questPanel: Phaser.GameObjects.Container | null = null;
  private questPanelOpen = false;
  private questText!: Phaser.GameObjects.Text;
  private questTrackerHidden = false;

  constructor() {
    super({ key: 'UIScene' });
  }

  create(): void {
    // HP条背景
    const barBg = this.add.graphics();
    barBg.fillStyle(0x222222, 0.8);
    barBg.fillRoundedRect(GAME_WIDTH - 260, GAME_HEIGHT - 70, 250, 54, 6);

    this.hpBar = this.add.graphics().setDepth(101);
    this.mpBar = this.add.graphics().setDepth(101);
    this.expBar = this.add.graphics().setDepth(101);

    // HP条文字中心 = bx + bw/2 = (GAME_WIDTH-250) + 230/2 = GAME_WIDTH - 135
    this.hpText = this.add.text(GAME_WIDTH - 135, GAME_HEIGHT - 58, '', {
      fontSize: '13px', color: '#ffffff', fontFamily: 'monospace', padding: { y: 2 },
    }).setOrigin(0.5).setDepth(102);

    this.mpText = this.add.text(GAME_WIDTH - 135, GAME_HEIGHT - 42, '', {
      fontSize: '11px', color: '#aaaaff', fontFamily: 'monospace', padding: { y: 2 },
    }).setOrigin(0.5).setDepth(102);

    this.lvText = this.add.text(GAME_WIDTH - 252, GAME_HEIGHT - 68, '', {
      fontSize: '10px', color: '#ffdd88', padding: { y: 2 },
    }).setDepth(102);

    this.goldText = this.add.text(GAME_WIDTH - 252, GAME_HEIGHT - 20, '', {
      fontSize: '12px', color: '#ffdd88', padding: { y: 2 },
    }).setDepth(102);

    // 任务追踪（移至界面左侧中间位置）
    const questText = this.add.text(16, GAME_HEIGHT / 2 - 120, '', {
      fontSize: '12px', color: '#ffcc44',
      backgroundColor: '#1a1a2ecc',
      padding: { x: 8, y: 6 },
    }).setDepth(102);
    this.questText = questText;

    // L键：由GameScene处理任务面板，UIScene不重复
    // this.input.keyboard!.addKey('L').on('down', () => {
    //   if (this.questPanelOpen) { this.closeQuestPanel(); } else { this.openQuestPanel(); }
    // });

    this.events.on('updateStats', () => {
      const trackText = GameState.getQuestTrackText();
      if (trackText) {
        this.questText.setText(trackText);
        this.questText.setVisible(!this.questTrackerHidden && true);
      } else {
        this.questText.setVisible(false);
      }
      this.refresh();
    });

    this.input.keyboard!.addKey('ESC').on('down', () => {
      if (this.questPanelOpen) {
        this.closeQuestPanel();
      }
    });

    // 监听状态更新
    this.events.on('updateStats', () => this.refresh());

    this.refresh();
  }

  private questTab: 'main' | 'side' = 'main';

  private openQuestPanel(): void {
    if (this.questPanel) this.questPanel.destroy();
    this.questPanelOpen = true;

    const container = this.add.container(0, 0).setDepth(200);
    this.questPanel = container;

    // 遮罩
    const overlay = this.add.graphics();
    overlay.fillStyle(0x000000, 0.5);
    overlay.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    overlay.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains);
    overlay.on('pointerdown', () => this.closeQuestPanel());
    container.add(overlay);

    // 面板 — 近全屏
    const pw = 760, ph = GAME_HEIGHT - 60;
    const px = (GAME_WIDTH - pw) / 2, py = 30;
    const panel = this.add.graphics();
    panel.fillStyle(0x1a1a2e, 0.97);
    panel.fillRoundedRect(px, py, pw, ph, 12);
    panel.lineStyle(2, 0xc9a96e, 0.7);
    panel.strokeRoundedRect(px, py, pw, ph, 12);
    container.add(panel);

    // 标题行
    container.add(this.add.text(GAME_WIDTH / 2, py + 18, '任务日志', {
      fontSize: '22px', color: '#c9a96e', fontFamily: 'serif', fontStyle: 'bold', padding: { y: 2 },
    }).setOrigin(0.5));

    const sideCompleted = Object.keys(SIDE_QUESTS).filter(id => GameState.questCompleted.includes(id)).length;
    const sideTotal = Object.keys(SIDE_QUESTS).length;
    container.add(this.add.text(GAME_WIDTH / 2, py + 46, `支线完成: ${sideCompleted}/${sideTotal}`, {
      fontSize: '13px', color: '#888', padding: { y: 2 },
    }).setOrigin(0.5));

    // 标签切换
    const TAB_W = 100, TAB_H = 32;
    const tabY = py + 68;
    const tabs: { key: 'main' | 'side'; label: string }[] = [
      { key: 'main', label: '主线任务' },
      { key: 'side', label: '支线任务' },
    ];

    tabs.forEach((tab, i) => {
      const tx = GAME_WIDTH / 2 - TAB_W + i * TAB_W;
      const isActive = tab.key === this.questTab;
      const bg = this.add.graphics();
      bg.fillStyle(isActive ? 0x3a3a5e : 0x1a1a2e, 1);
      bg.fillRoundedRect(tx, tabY, TAB_W, TAB_H, 6);
      bg.lineStyle(1, isActive ? 0xc9a96e : 0x333344, 0.5);
      bg.strokeRoundedRect(tx, tabY, TAB_W, TAB_H, 6);
      container.add(bg);
      const tabTxt = this.add.text(tx + TAB_W / 2, tabY + TAB_H / 2, tab.label, {
        fontSize: '14px', color: isActive ? '#ffe8b0' : '#666', fontStyle: 'bold', padding: { y: 2 },
      }).setOrigin(0.5);
      container.add(tabTxt);
      const zone = this.add.zone(tx + TAB_W / 2, tabY + TAB_H / 2, TAB_W, TAB_H).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => { this.questTab = tab.key; this.openQuestPanel(); });
      container.add(zone);
    });

    // 分割线
    const divider = this.add.graphics();
    divider.lineStyle(1, 0xc9a96e, 0.3);
    divider.lineBetween(px + 20, tabY + TAB_H + 12, px + pw - 20, tabY + TAB_H + 12);
    container.add(divider);

    // 列表区域
    const listY = tabY + TAB_H + 28;
    const listH = py + ph - listY - 30;
    let yOffset = listY;

    if (this.questTab === 'main') {
      this.renderMainQuests(container, px, yOffset, listH);
    } else {
      this.renderSideQuests(container, px, yOffset, listH);
    }

    // 底部提示
    container.add(this.add.text(GAME_WIDTH / 2, py + ph - 18, '按 L / ESC 关闭', {
      fontSize: '12px', color: '#555', padding: { y: 2 },
    }).setOrigin(0.5));

    // 滑入动画
    container.setAlpha(0);
    container.y -= 10;
    this.tweens.add({ targets: container, alpha: 1, y: 0, duration: 200, ease: 'Power2' });
  }

  private renderMainQuests(container: Phaser.GameObjects.Container, px: number, yStart: number, maxH: number): void {
    let y = yStart;
    const lineH = 22;

    for (const questId of MAIN_QUEST_ORDER) {
      const quest = MAIN_QUESTS[questId];
      if (!quest) continue;
      if (y > yStart + maxH - 30) break;

      const isCompleted = GameState.questCompleted.includes(questId);
      const isActive = GameState.isQuestActive(questId);
      // 锁定（前置未完成或区域未到达）→ 隐藏
      const isLocked = quest.prerequisite && !GameState.questCompleted.includes(quest.prerequisite)
        || (quest.zoneRequired && !GameState.discoveredZones.includes(quest.zoneRequired));
      if (isLocked && !isCompleted && !isActive) continue;

      let icon: string, color: string;
      if (isCompleted) { icon = '✓'; color = '#448844'; }
      else if (isActive) { icon = '★'; color = '#c9a96e'; }
      else { icon = '○'; color = '#aaa'; }

      const chLabel = quest.chapter === 0 ? '序章' : `第${quest.chapter}章`;
      container.add(this.add.text(px + 30, y, `${icon} [${chLabel}] ${quest.name}`, {
        fontSize: '14px', color, fontFamily: 'serif', padding: { y: 2 },
      }));

      if (isActive) {
        y += 20;
        for (const obj of quest.objectives) {
          const prog = GameState.questProgress[questId]?.[obj.target] || 0;
          const done = prog >= obj.count ? '✓' : `${prog}/${obj.count}`;
          const pColor = prog >= obj.count ? '#448844' : '#aaaacc';
          container.add(this.add.text(px + 50, y, `  ↳ ${obj.desc} ${done}`, {
            fontSize: '11px', color: pColor, padding: { y: 2 },
          }));
          y += 16;
        }
      } else {
        y += lineH;
      }
    }
  }

  private renderSideQuests(container: Phaser.GameObjects.Container, px: number, yStart: number, maxH: number): void {
    let y = yStart;
    const lineH = 20;

    // 按区域分组
    const zones = [1, 2, 3, 4, 5, 6, 7];
    const zoneNames: Record<number, string> = { 1: '浦原商店街', 2: '空座高校', 3: '河川敷', 4: '润林安', 5: '戌吊', 6: '草鹿', 7: '一番队舍', 8: '技术开发局', 9: '真央灵术院', 10: '白砂原', 11: '黑腔深部', 12: '虚夜宫', 13: '战迹', 14: 'XCUTION基地', 15: '完现术总本山', 16: '影之领域', 17: '星十字宫', 18: '银架城', 19: '咎人之门', 20: '无间', 21: '终焉之渊' };

    for (const zoneId of zones) {
      const zoneQuests = Object.values(SIDE_QUESTS).filter(q => q.zoneRequired === zoneId);
      if (zoneQuests.length === 0) continue;
      if (y > yStart + maxH - 30) break;

      const discovered = GameState.discoveredZones.includes(zoneId);
      if (!discovered) {
        container.add(this.add.text(px + 30, y, `🔒 ${zoneNames[zoneId]} (未到达)`, {
          fontSize: '13px', color: '#444', padding: { y: 2 },
        }));
        y += lineH + 4;
        continue;
      }

      container.add(this.add.text(px + 30, y, `[${zoneNames[zoneId]}]`, {
        fontSize: '14px', color: '#c9a96e', fontStyle: 'bold', padding: { y: 2 },
      }));
      y += lineH + 2;

      for (const quest of zoneQuests) {
        if (y > yStart + maxH - 20) break;
        const isCompleted = GameState.questCompleted.includes(quest.id);
        const isActive = GameState.isQuestActive(quest.id);
        let icon: string, color: string;
        if (isCompleted) { icon = '✓'; color = '#448844'; }
        else if (isActive) { icon = '★'; color = '#ffcc44'; }
        else { icon = '○'; color = '#888'; }

        container.add(this.add.text(px + 46, y, `${icon} ${quest.name}`, {
          fontSize: '12px', color, padding: { y: 2 },
        }));
        y += lineH;
      }
      y += 6;
    }
  }

  private closeQuestPanel(): void {
    if (!this.questPanel) return;
    this.tweens.add({
      targets: this.questPanel, alpha: 0, duration: 150,
      onComplete: () => {
        if (this.questPanel) { this.questPanel.destroy(); this.questPanel = null; }
        this.questPanelOpen = false;
      },
    });
  }

  private refresh(): void {
    this.drawBars();
  }

  /** 开/关全屏面板时隐藏任务追踪，避免遮挡面板内容（由 GameScene 调用）。 */
  public setQuestTrackerVisible(v: boolean): void {
    this.questTrackerHidden = !v;
    this.questText.setVisible(v && !!GameState.getQuestTrackText());
  }

  update(): void {
    this.drawBars();
  }

  private drawBars(): void {
    const bx = GAME_WIDTH - 250;
    const by = GAME_HEIGHT - 58;
    const bw = 230;

    const hp = GameState.hp, maxHp = GameState.maxHp;
    const mp = GameState.mp, maxMp = GameState.maxMp;

    // HP
    this.hpBar.clear();
    const hpRatio = maxHp > 0 ? hp / maxHp : 1;
    const hpColor = hpRatio > 0.5 ? 0x44cc44 : hpRatio > 0.25 ? 0xcccc44 : 0xcc4444;
    this.hpBar.fillStyle(0x331111, 1);
    this.hpBar.fillRect(bx, by, bw, 12);
    this.hpBar.fillStyle(hpColor, 1);
    this.hpBar.fillRect(bx, by, bw * hpRatio, 12);
    this.hpText.setText(`HP ${hp}/${maxHp}`);

    // MP
    this.mpBar.clear();
    const mpRatio = maxMp > 0 ? mp / maxMp : 1;
    this.mpBar.fillStyle(0x111133, 1);
    this.mpBar.fillRect(bx, by + 16, bw, 8);
    this.mpBar.fillStyle(0x4444cc, 1);
    this.mpBar.fillRect(bx, by + 16, bw * mpRatio, 8);
    this.mpText.setText(`灵压 ${mp}/${maxMp}`);

    // EXP
    this.expBar.clear();
    if (GameState.level < 70) {
      const needed = expForLevel(GameState.level + 1);
      const expRatio = needed > 0 ? GameState.exp / needed : 0;
      this.expBar.fillStyle(0x111122, 1);
      this.expBar.fillRect(bx, by + 28, bw, 5);
      this.expBar.fillStyle(0x888844, 1);
      this.expBar.fillRect(bx, by + 28, bw * Math.min(expRatio, 1), 5);
    }

    this.lvText.setText(`Lv.${GameState.level}`);
    this.goldText.setText(`💰 ${GameState.gold.toLocaleString()}`);
  }
}
