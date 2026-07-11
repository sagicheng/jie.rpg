/**
 * 副本场景（阶段③独立副本系统）。
 *  - 连接独立的 dungeon 权威房间（每副本一个实例，多人可同场）。
 *  - 显示当前阶进度（1小怪 / 2精英 / 3BOSS），点「挑战本阶」开打（复用 BattleRoom 权威结算）。
 *  - 战斗胜利后由 BattleRoom 通知 DungeonRoom 推进阶进度；本场景监听状态刷新。
 *  - 断连恢复：进度存服务端 WorldService，重连（再次进本副本）续打，不重复计周次。
 *
 *  交互方式：主用按钮 UI（pointerdown），与 MultiBattleScene 一致。
 *  键盘 F/ESC 作为备用（overlay 场景下可能收不到键盘事件）。
 */
import Phaser from 'phaser';
import { getClient } from '../net/Net';
import { ZONE_CONFIGS } from '../systems/Zones';
import { GameState } from '../systems/GameState';
import { buildDungeonParty, buildClientBattleLoadout } from '../systems/dungeon';

export class DungeonScene extends Phaser.Scene {
  private dungeonId = 1;
  private room: any = null;
  private stage = 1;
  private phase: string = 'lobby';
  private synced = false; // dungeon 房连接完成前禁止开打
  private stageText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;

  // 按钮引用（pointerdown 驱动，与 MultiBattleScene 一致）
  private btnChallenge!: Phaser.GameObjects.Container;
  private btnExit!: Phaser.GameObjects.Container;

  constructor() {
    super({ key: 'DungeonScene' });
  }

  init(data: { dungeonId?: number }): void {
    this.dungeonId = data?.dungeonId || GameState.zone;
    this.room = null;
    this.stage = 1;
    this.phase = 'lobby';
    this.synced = false; // 必须随连接状态重置
  }

  create(): void {
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(0, 0, w, h, 0x140d22).setOrigin(0).setDepth(0);
    const g = this.add.graphics().setDepth(1);
    g.fillStyle(0x2a1840, 0.5); g.fillRect(0, 0, w, h);
    g.lineStyle(2, 0xaa66ff, 0.35); g.strokeRect(20, 20, w - 40, h - 40);

    this.add.text(w / 2, 60, `副本 ${this.dungeonId} · ${ZONE_CONFIGS[this.dungeonId]?.name || ''}`, {
      fontSize: '30px', color: '#d9b3ff', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(10);

    this.stageText = this.add.text(w / 2, 140, '', { fontSize: '24px', color: '#ffe8b0', fontStyle: 'bold' }).setOrigin(0.5).setDepth(10);
    this.infoText = this.add.text(w / 2, 210, '', {
      fontSize: '15px', color: '#bbaadd', align: 'center', wordWrap: { width: w - 240 }, lineSpacing: 6,
    }).setOrigin(0.5).setDepth(10);

    // ── 按钮容器（居中偏下，与 MultiBattleScene 风格一致）──
    const btnY = h - 100;
    const btnW = 200, btnH = 48;

    // 「挑战本阶」按钮（紫色主题）
    this.btnChallenge = this.makeBtn(w / 2 - 120, btnY, btnW, btnH, '⚔ 挑战本阶', 0x7c3aed, () => this.startStageBattle());

    // 「退出副本」按钮
    this.btnExit = this.makeBtn(w / 2 + 120, btnY, btnW, btnH, '✕ 退出副本', 0x555570, () => this.leave());

    // 键盘备用（overlay 场景下不一定触发，但留着无害）
    this.input.keyboard!.on('keydown-F', () => this.onBattleKey());
    this.input.keyboard!.on('keydown-ESC', () => this.leave());

    this.connect();
    this.refresh(); // 初始显示「连接中…」

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.room) { this.room.leave(); this.room = null; }
      const gs = this.scene.get('GameScene') as any;
      if (gs && typeof gs.exitDungeon === 'function') gs.exitDungeon();
    });
  }

  /** 创建一个带背景 + 文字的点击按钮。 */
  private makeBtn(x: number, y: number, w: number, h: number, label: string, color: number, cb: () => void): Phaser.GameObjects.Container {
    const c = this.add.container(x, y).setDepth(20);
    const bg = this.add.rectangle(0, 0, w, h, color, 0.85)
      .setStrokeStyle(2, 0xffffff, 0.2);
    const txt = this.add.text(0, 0, label, {
      fontSize: '18px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5);
    c.add([bg, txt]);
    const hit = this.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', cb);
    hit.on('pointerover', () => bg.setFillStyle(color, 1));
    hit.on('pointerout', () => bg.setFillStyle(color, 0.85));
    c.add(hit);
    return c;
  }

  private connect(): void {
    getClient().joinOrCreate('dungeon', {
      dungeonId: this.dungeonId,
      gameSid: (this.scene.get('GameScene') as any)?.mySessionId || '',
      name: GameState.playerName || '勇者',
    }).then((room: any) => {
      this.room = room;
      this.synced = true;
      room.onStateChange((s: any) => this.onState(s));
      room.onMessage('dungeonError', (m: any) => this.onError(m?.msg || '无法进入副本'));
      this.onState(room.state);
    }).catch((e: any) => {
      console.error('[dungeon] 连接失败', e);
      this.showNotif('无法连接副本服务器');
      this.time.delayedCall(900, () => this.leave());
    });
  }

  private onState(s: any): void {
    if (!s) return;
    this.stage = s.stage || 1;
    this.phase = s.phase || 'lobby';
    this.refresh();
  }

  /** 刷新界面文字 + 按钮 可见性。 */
  private refresh(): void {
    const clear = this.phase === 'clear';

    if (clear) {
      this.stageText.setText('★ 副本已完成 ★');
      this.infoText.setText('你已通关全部 3 阶，奖励已发放。\n点下方按钮返回地图。');
      this.btnChallenge.setVisible(false);
      this.btnExit.setVisible(true);
      // 更新退出按钮文案
      (this.btnExit.list[1] as Phaser.GameObjects.Text)?.setText('✕ 返回地图');
      return;
    }

    if (!this.synced) {
      this.stageText.setText('副本连接中…');
      this.infoText.setText('正在与副本服务器同步，请稍候。');
      this.btnChallenge.setVisible(false);
      this.btnExit.setVisible(true);
      return;
    }

    const labels = ['', '第 1 阶 · 清剿小怪', '第 2 阶 · 击破精英', '第 3 阶 · 讨伐 BOSS'];
    const desc = [
      '',
      '击败本区域的小怪群，领取第 1 次奖励。',
      '击败精英怪，领取第 2 次奖励。',
      '击败区域 BOSS（含随从），领取第 3 次奖励（副本通关）。',
    ];
    this.stageText.setText(`当前进度：${labels[this.stage]}`);
    this.infoText.setText(`${desc[this.stage]}\n\n点「挑战本阶」开始第 ${this.stage} 阶战斗`);
    this.btnChallenge.setVisible(true);
    this.btnExit.setVisible(true);
    // 重置退出按钮文案
    (this.btnExit.list[1] as Phaser.GameObjects.Text)?.setText('✕ 退出副本');
  }

  private onError(msg: string): void {
    this.showNotif(msg);
    this.time.delayedCall(1000, () => this.leave());
  }

  /** F 键备用的开打入口。 */
  private onBattleKey(): void {
    if (this.phase === 'clear' || !this.synced) return;
    this.startStageBattle();
  }

  private startStageBattle(): void {
    if (!this.room || !this.room.roomId) { this.showNotif('副本同步中，请稍候…'); return; }
    const enemyParty = buildDungeonParty(this.dungeonId, this.stage);
    this.scene.launch('MultiBattleScene', {
      playerName: GameState.playerName || '勇者',
      loadout: buildClientBattleLoadout(),
      enemyParty,
      dungeonId: this.dungeonId,
      dungeonStage: this.stage,
      dungeonRoomId: this.room?.roomId || '',
      returnScene: 'DungeonScene',
    });
    this.scene.pause();
  }

  /** 由 MultiBattleScene 在战斗结束时回调（victory/defeat/fled）。 */
  public onMultiBattleEnd(phase: string): void {
    if (phase === 'victory') {
      this.refresh();
      if (this.phase === 'clear') this.showNotif('副本通关！奖励已发放');
    } else if (phase === 'defeat') {
      this.showNotif('战斗失败，可再次挑战本阶');
    }
  }

  private leave(): void {
    const gs = this.scene.get('GameScene') as any;
    if (gs && typeof gs.exitDungeon === 'function') gs.exitDungeon();
    this.scene.stop();
  }

  private showNotif(msg: string): void {
    const n = this.add.text(this.scale.width / 2, this.scale.height / 2, msg, {
      fontSize: '18px', color: '#ffcc66', backgroundColor: '#221a33cc', padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setDepth(50);
    this.tweens.add({ targets: n, alpha: 0, duration: 1800, onComplete: () => n.destroy() });
  }
}
