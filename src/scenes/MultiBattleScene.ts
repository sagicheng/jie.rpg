/**
 * 联机权威战斗场景（Stage C 切片）。
 * 设计要点（贴合 12-联机化总体方案.md）：
 *  - 本场景"只当渲染器"：不发任何战斗数学，只发意图（action），状态全部来自 battle 房间。
 *  - 服务端（server/rooms/BattleRoom.ts）跑回合循环、伤害结算、掉落、胜负——天然防作弊、多端一致。
 *  - 动画/表现由"收到服务端状态变更"驱动（这里用 onStateChange 全量重绘，切片够用；后续可细化到逐条日志插值）。
 *  - 单机 BattleScene 完全不动，两个入口互不干扰。
 *
 * 触发：GameScene 按 V 进入（两个窗口都按 V → 同房间组队打怪）。
 */
import Phaser from 'phaser';
import { getClient } from '../net/Net';

interface Card {
  root: Phaser.GameObjects.Container;
  name: Phaser.GameObjects.Text;
  hpBar: Phaser.GameObjects.Graphics;
  hpText: Phaser.GameObjects.Text;
}

interface Button {
  container: Phaser.GameObjects.Container;
  setEnable: (b: boolean) => void;
}

export class MultiBattleScene extends Phaser.Scene {
  private room: any = null;
  private mySessionId = '';
  private playerName = '勇者';

  private playerCards: Map<string, Card> = new Map();
  private enemyCards: Map<string, Card> = new Map();
  private logText!: Phaser.GameObjects.Text;
  private turnText!: Phaser.GameObjects.Text;
  private attackBtn!: Button;
  private skillBtn!: Button;
  private resultPanel: Phaser.GameObjects.Container | null = null;

  constructor() {
    super({ key: 'MultiBattleScene' });
  }

  init(data: { playerName?: string }): void {
    this.playerName = data?.playerName || '玩家';
    // 重置（场景复用同一实例时避免脏状态）
    this.room = null;
    this.mySessionId = '';
    this.playerCards.clear();
    this.enemyCards.clear();
    this.resultPanel = null;
  }

  create(): void {
    const w = this.scale.width;
    const h = this.scale.height;

    this.add.rectangle(0, 0, w, h, 0x0a0a1e).setOrigin(0).setDepth(0);
    this.add.text(w / 2, 36, '联机权威战斗', { fontSize: '28px', color: '#c9a96e', fontStyle: 'bold' }).setOrigin(0.5).setDepth(10);
    this.turnText = this.add.text(w / 2, 80, '连接中…', { fontSize: '18px', color: '#ffe8b0' }).setOrigin(0.5).setDepth(10);

    this.logText = this.add.text(60, h - 360, '', {
      fontSize: '14px', color: '#cccccc', wordWrap: { width: w - 120 }, lineSpacing: 4,
    }).setDepth(10);

    this.attackBtn = this.makeButton(w / 2 - 130, h - 70, '斩击', 0x2e7d32, () => this.sendAction('attack'));
    this.skillBtn = this.makeButton(w / 2 + 130, h - 70, '鬼道', 0x283593, () => this.sendAction('skill'));

    this.connect();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.room) { this.room.leave(); this.room = null; }
      if (this.scene.isPaused('GameScene')) this.scene.resume('GameScene');
    });
  }

  // ——— 连接权威战斗房间 ———
  private connect(): void {
    getClient().joinOrCreate('battle', { name: this.playerName })
      .then((room: any) => {
        this.room = room;
        this.mySessionId = room.sessionId;
        room.onStateChange(() => this.renderState());
        room.onLeave(() => { if (!this.resultPanel) this.showResult('连接断开'); });
        // 服务端 BattleRoom.logMsg('system', ...) 的系统提示，客户端暂无需处理，注册空处理器消除告警。
        room.onMessage('system', () => {});
        this.renderState();
        // 单人自检：若 1.5s 内仍只有自己（无人组队），则主动开战，便于单窗口验证 UI
        this.time.delayedCall(1500, () => {
          if (this.room && this.room.state && this.room.state.phase === 'waiting') {
            this.room.send('startbattle');
          }
        });
      })
      .catch((e: any) => {
        console.error('[battle] 连接失败', e);
        this.showResult('无法连接战斗服务器');
      });
  }

  private sendAction(type: 'attack' | 'skill'): void {
    if (!this.room || !this.room.state) return;
    if (this.room.state.phase !== 'combat') return;
    if (this.room.state.currentTurn !== this.mySessionId) return; // 非我方回合，忽略（防加速/作弊）
    this.room.send('action', { type });
  }

  // ——— 渲染（完全由服务端状态驱动）———
  private renderState(): void {
    if (!this.room || !this.room.state) return;
    const s = this.room.state;

    const isMyTurn = s.currentTurn === this.mySessionId;
    const cur = s.players.get(s.currentTurn) || s.enemies.get(s.currentTurn);
    if (s.phase === 'combat') {
      this.turnText.setText(isMyTurn ? '★ 你的回合 — 选择行动' : `等待 ${cur?.name ?? ''} 行动…`);
      this.turnText.setColor(isMyTurn ? '#88ff88' : '#ffe8b0');
    } else {
      this.turnText.setText(`阶段：${s.phase}`);
      this.turnText.setColor('#aaaacc');
    }
    this.attackBtn.setEnable(isMyTurn);
    this.skillBtn.setEnable(isMyTurn);

    this.syncCards(this.playerCards, s.players, true);
    this.syncCards(this.enemyCards, s.enemies, false);

    const logs = (s.log as any[]) ?? [];
    this.logText.setText(logs.slice(-13).map((m: any) => `[${m.name}] ${m.text}`).join('\n'));

    if (s.phase === 'victory' || s.phase === 'defeat') {
      this.showResult(s.phase === 'victory' ? '胜 利 ！' : '战 斗 失 败');
    }
  }

  private syncCards(map: Map<string, Card>, src: Map<string, any>, isPlayer: boolean): void {
    const list = [...(src as Map<string, any>).values()];
    const baseX = isPlayer ? this.scale.width * 0.28 : this.scale.width * 0.72;
    list.forEach((c: any, i: number) => {
      const id = c.sessionId || c.id;
      const y = 170 + i * 120;
      let card = map.get(id);
      if (!card) { card = this.makeCard(baseX, y, isPlayer); map.set(id, card); }
      card.name.setText(`${c.name}${c.alive ? '' : '（倒下）'}`);
      this.drawHpBar(card, c.hp, c.maxHp);
      card.root.setAlpha(c.alive ? 1 : 0.4);
    });
    for (const [id, card] of map) {
      if (![...src.values()].some((c: any) => (c.sessionId || c.id) === id)) {
        card.root.destroy();
        map.delete(id);
      }
    }
  }

  private makeCard(x: number, y: number, isPlayer: boolean): Card {
    const w = 380, h = 96;
    const root = this.add.container(x, y).setDepth(10);
    const bg = this.add.graphics();
    bg.fillStyle(isPlayer ? 0x16261a : 0x2a1616, 0.92);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
    bg.lineStyle(2, isPlayer ? 0x44aa44 : 0xaa4444, 0.8);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
    const barY = 28;
    const name = this.add.text(-w / 2 + 16, -h / 2 + 12, '', { fontSize: '16px', color: isPlayer ? '#aaffaa' : '#ffaaaa', fontStyle: 'bold' });
    const hpBar = this.add.graphics();
    const hpText = this.add.text(-w / 2 + 16, barY + 4, '', { fontSize: '12px', color: '#dddddd' });
    root.add([bg, name, hpBar, hpText]);
    return { root, name, hpBar, hpText };
  }

  private drawHpBar(card: Card, hp: number, maxHp: number): void {
    const w = 348, x = -174, y = 28;
    const ratio = maxHp > 0 ? Phaser.Math.Clamp(hp / maxHp, 0, 1) : 0;
    card.hpBar.clear();
    card.hpBar.fillStyle(0x000000, 0.6);
    card.hpBar.fillRect(x, y, w, 14);
    card.hpBar.fillStyle(ratio > 0.3 ? 0x44dd44 : 0xdd4444, 1);
    card.hpBar.fillRect(x, y, w * ratio, 14);
    card.hpBar.lineStyle(1, 0xffffff, 0.3);
    card.hpBar.strokeRect(x, y, w, 14);
    card.hpText.setText(`HP ${Math.max(0, Math.round(hp))} / ${Math.round(maxHp)}`);
  }

  private makeButton(x: number, y: number, label: string, color: number, cb: () => void): Button {
    const w = 200, h = 56;
    const container = this.add.container(x, y).setDepth(20);
    const bg = this.add.graphics();
    const text = this.add.text(0, 0, label, { fontSize: '20px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);
    const draw = (enabled: boolean) => {
      bg.clear();
      bg.fillStyle(enabled ? color : 0x333344, 0.95);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
      bg.lineStyle(2, enabled ? 0xffffff : 0x555566, 0.6);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    };
    draw(true);
    container.add([bg, text]);
    container.setSize(w, h).setInteractive({ useHandCursor: true });
    container.on('pointerdown', () => cb());
    let enabled = true;
    return {
      container,
      setEnable: (b: boolean) => {
        if (b === enabled) return;
        enabled = b;
        draw(b);
        text.setColor(b ? '#ffffff' : '#888899');
        container.setAlpha(b ? 1 : 0.55);
      },
    };
  }

  private showResult(title: string): void {
    if (this.resultPanel) return;
    const w = this.scale.width, h = this.scale.height;
    const c = this.add.container(w / 2, h / 2).setDepth(50);
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.7);
    bg.fillRect(-w / 2, -h / 2, w, h);
    const panel = this.add.graphics();
    panel.fillStyle(0x1a1a2e, 0.98);
    panel.fillRoundedRect(-260, -170, 520, 340, 14);
    panel.lineStyle(2, 0xc9a96e, 0.8);
    panel.strokeRoundedRect(-260, -170, 520, 340, 14);
    const t = this.add.text(0, -90, title, {
      fontSize: '40px', color: title.includes('胜利') ? '#88ff88' : '#ff8866', fontStyle: 'bold',
    }).setOrigin(0.5);
    const btn = this.add.text(0, 80, '返回地图', {
      fontSize: '22px', color: '#d4c5a0', padding: { x: 24, y: 10 }, backgroundColor: '#2a2a3e',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => btn.setColor('#ffe8b0'));
    btn.on('pointerout', () => btn.setColor('#d4c5a0'));
    btn.on('pointerdown', () => {
      c.destroy(true);
      this.resultPanel = null;
      this.scene.stop();
    });
    c.add([bg, panel, t, btn]);
    this.resultPanel = c;
  }
}
