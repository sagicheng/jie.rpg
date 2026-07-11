/**
 * 副本场景（阶段③独立副本系统）。
 *  - 连接独立的 dungeon 权威房间（每副本一个实例，多人可同场）。
 *  - 显示当前阶进度（1小怪 / 2精英 / 3BOSS），按 F 开打当前阶（复用 BattleRoom 权威结算）。
 *  - 战斗胜利后由 BattleRoom 通知 DungeonRoom 推进阶进度；本场景监听状态刷新。
 *  - 断连恢复：进度存服务端 WorldService，重连（再次进本副本）续打，不重复计周次。
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
  private synced = false; // dungeon 房连接完成（拿到 roomId）前禁止开打，避免空 roomId 导致 stage 不推进
  private stageText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  private promptText!: Phaser.GameObjects.Text;
  private battleKey!: Phaser.Input.Keyboard.Key;
  private exitKey!: Phaser.Input.Keyboard.Key;

  constructor() {
    super({ key: 'DungeonScene' });
  }

  init(data: { dungeonId?: number }): void {
    this.dungeonId = data?.dungeonId || GameState.zone;
    this.room = null;
    this.stage = 1;
    this.phase = 'lobby';
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
    this.promptText = this.add.text(w / 2, h - 90, '', {
      fontSize: '18px', color: '#ffffff', backgroundColor: '#33284a', padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setDepth(10);

    this.battleKey = this.input.keyboard!.addKey('F');
    this.exitKey = this.input.keyboard!.addKey('ESC');

    this.connect();
    this.refresh(); // 连接完成前显示「副本连接中…」

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.room) { this.room.leave(); this.room = null; }
      const gs = this.scene.get('GameScene') as any;
      if (gs && typeof gs.exitDungeon === 'function') gs.exitDungeon();
    });
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

  private refresh(): void {
    if (this.phase === 'clear') {
      this.stageText.setText('★ 副本已完成 ★');
      this.infoText.setText('你已通关全部 3 阶，奖励已发放。\n按 ESC 返回地图。');
      this.promptText.setText('按 ESC 返回地图');
      return;
    }
    if (!this.synced) {
      this.stageText.setText('副本连接中…');
      this.infoText.setText('正在与副本服务器同步，请稍候。');
      this.promptText.setText('连接中…');
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
    this.infoText.setText(`${desc[this.stage]}\n\n按 F 开始第 ${this.stage} 阶战斗`);
    this.promptText.setText('按 F 挑战本阶 · 按 ESC 退出副本');
  }

  private onError(msg: string): void {
    this.showNotif(msg);
    this.time.delayedCall(1000, () => this.leave());
  }

  update(): void {
    if (Phaser.Input.Keyboard.JustDown(this.exitKey)) { this.leave(); return; }
    if (Phaser.Input.Keyboard.JustDown(this.battleKey) && this.phase !== 'clear') {
      this.startStageBattle();
    }
  }

  private startStageBattle(): void {
    if (!this.room || !this.room.roomId) { this.showNotif('副本同步中，请稍候…'); return; }
    const stage = this.stage;
    const enemyParty = buildDungeonParty(this.dungeonId, stage);
    this.scene.launch('MultiBattleScene', {
      playerName: GameState.playerName || '勇者',
      loadout: buildClientBattleLoadout(),
      enemyParty,
      dungeonId: this.dungeonId,
      dungeonStage: stage,
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
