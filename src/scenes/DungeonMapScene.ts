/**
 * 副本独立地图场景（阶段③「镜像地图方案」重构）。
 *
 * 设计要点：
 *  - 副本 = 一张独立地图场景（与 GameScene 平级），不再用 overlay 嵌套 DungeonScene，
 *    彻底规避 overlay 套 overlay 的渲染层级 bug（phase=combat 但画面不可见）。
 *  - 每层（1小怪 / 2精英 / 3BOSS）是同一张地图的不同「阶段」：进入显示该层明雷怪，
 *    清完 → 中央出现领奖 NPC → 按 F 领奖 → 出现下一阶传送阵 → 碰传送阵切换地图视觉与怪。
 *  - 进度权威在服务端 DungeonRoom（stage/phase），本场景监听 stateChange 刷新；战斗胜利后
 *    BattleRoom 自动调 DungeonRegistry.onStageCleared 推进 stage，并下发副本阶奖励。
 *  - 断连恢复：DungeonRoom 进度存 WorldService，重连（再次进本副本）续打。
 *  - 多人：连同一 dungeonId 房间的玩家共享 stage（一人通关全层推进），各自客户端渲染。
 *
 * 复用：明雷遇敌 / 进入战斗 / 奖励回写全部走现有 MultiBattleScene + BattleRoom 同源链路。
 */
import Phaser from 'phaser';
import { getClient } from '../net/Net';
import { ZONE_CONFIGS } from '../systems/Zones';
import { GameState } from '../systems/GameState';
import { Inventory } from '../systems/Inventory';
import { buildDungeonParty, buildClientBattleLoadout, getDungeonStageVisual } from '../systems/dungeon';
import { EnemyData } from '../systems/BattleData';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';

interface DungeonEnemy {
  sprite: Phaser.GameObjects.Sprite;
  data: EnemyData;
  label: Phaser.GameObjects.Text;
  id: string;
}

interface RewardInfo { exp: number; gold: number; loot: string[]; leveled: boolean }

export class DungeonMapScene extends Phaser.Scene {
  private dungeonId = 1;
  private fromZone = 1;
  private localStage = 1;        // 当前显示的地图层（跟随服务端 stage）
  private clearedPending = false; // 有刚打完待领奖的层
  private rewardTaken = false;
  private clearHandled = false;   // phase=clear 是否已处理（返回传送阵）
  private lastReward: RewardInfo | null = null;
  private dungeonRoom: any = null;
  private dungeonRoomId = ''; // 缓存 roomId，避免 enterBattle 早于连接完成时传空

  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: any;
  private ctrlKey!: Phaser.Input.Keyboard.Key;
  private enemies: DungeonEnemy[] = [];
  private rewardNPC: { sprite: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text } | null = null;
  private portal: { x: number; y: number; type: 'next' | 'exit'; gfx: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text } | null = null;
  private battleCooldown = 0;
  private isTransitioning = false;
  private pendingNearby: '' | 'reward' | 'portal' = '';

  private zoneText!: Phaser.GameObjects.Text;
  private promptText!: Phaser.GameObjects.Text;
  private coordText!: Phaser.GameObjects.Text;
  private miniMap!: Phaser.GameObjects.Graphics;
  private stageText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'DungeonMapScene' });
  }

  init(data: { dungeonId?: number; fromZone?: number }): void {
    this.dungeonId = data?.dungeonId || 1;
    this.fromZone = data?.fromZone || GameState.zone;
    this.localStage = 1;
    this.clearedPending = false;
    this.rewardTaken = false;
    this.clearHandled = false;
    this.lastReward = null;
    this.enemies = [];
    this.rewardNPC = null;
    this.portal = null;
    this.dungeonRoom = null;
    this.dungeonRoomId = '';
    this.battleCooldown = 0;
    this.isTransitioning = false;
    this.pendingNearby = '';
  }

  create(): void {
    this.createMap();
    this.physics.world.setBounds(0, 0, GAME_WIDTH * 3, GAME_HEIGHT * 2);

    this.player = this.physics.add.sprite(GAME_WIDTH * 1.5, GAME_HEIGHT * 1.0, 'player')
      .setDepth(10).setCollideWorldBounds(true);
    this.player.body!.setSize(24, 32);
    this.player.body!.setOffset(4, 0);

    this.cameras.main.setBounds(0, 0, GAME_WIDTH * 3, GAME_HEIGHT * 2);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);

    this.createEnemies();
    this.createUI();
    this.setupInput();
    this.connectDungeonRoom();

    this.cameras.main.fadeIn(500, 0, 0, 0);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.dungeonRoom) { this.dungeonRoom.leave(); this.dungeonRoom = null; }
    });
  }

  // ═══ 地图绘制（复用 GameScene 程序化画法，配色来自副本层视觉）═══
  private createMap(): void {
    const vis = getDungeonStageVisual(this.dungeonId, this.localStage);
    const mapW = GAME_WIDTH * 3, mapH = GAME_HEIGHT * 2;
    const g = this.add.graphics().setDepth(0);
    g.fillStyle(vis.groundColor, 1);
    g.fillRect(0, 0, mapW, mapH);
    g.fillStyle(vis.roadColor, 1);
    g.fillRect(0, mapH * 0.45, mapW, 60);
    g.fillRect(mapW * 0.48, 0, 60, mapH);
    for (const dec of vis.decorations) {
      const dx = dec.x * mapW, dy = dec.y * mapH;
      if (dec.type === 'house') {
        g.fillStyle(0x665544, 1);
        g.fillRect(dx - (dec.w || 100) / 2, dy - 40, dec.w || 100, dec.h || 80);
        g.fillStyle(0x554433, 1);
        g.fillRect(dx - (dec.w || 100) / 4, dy - 40, (dec.w || 100) / 2, 50);
      } else if (dec.type === 'pond') {
        g.fillStyle(0x335577, 0.7);
        g.fillEllipse(dx, dy, dec.w || 100, dec.h || 70);
      }
    }
    g.fillStyle(vis.treeColor, 1);
    for (let i = 0; i < 40; i++) {
      const tx = Phaser.Math.Between(50, mapW - 50), ty = Phaser.Math.Between(50, mapH - 50);
      g.fillCircle(tx, ty, 16);
      g.fillStyle(0x553311, 1);
      g.fillRect(tx - 2, ty + 12, 4, 16);
      g.fillStyle(vis.treeColor, 1);
    }
  }

  // ═══ 明雷怪（散点分布，碰任意一只即打整组）═══
  private createEnemies(): void {
    const party = buildDungeonParty(this.dungeonId, this.localStage);
    const occupied: { x: number; y: number }[] = [];
    party.forEach((data, idx) => {
      let ex = Phaser.Math.Between(200, GAME_WIDTH * 3 - 200);
      let ey = Phaser.Math.Between(150, GAME_HEIGHT * 2 - 150);
      for (const o of occupied) {
        const dx = ex - o.x, dy = ey - o.y;
        if (Math.sqrt(dx * dx + dy * dy) < 80) {
          ex += Phaser.Math.Between(60, 120) * (Math.random() > 0.5 ? 1 : -1);
          ey += Phaser.Math.Between(60, 100) * (Math.random() > 0.5 ? 1 : -1);
          break;
        }
      }
      occupied.push({ x: ex, y: ey });
      const isBoss = data.type === '妖将' || data.type === '妖王';
      const sprite = this.physics.add.sprite(ex, ey, isBoss ? 'enemy_boss' : 'enemy').setDepth(5);
      if (isBoss) {
        sprite.setScale(1.6).setTint(0xffcc44);
        this.tweens.add({ targets: sprite, scaleX: 1.65, scaleY: 1.55, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      } else {
        // 普通怪原地不动（与全游「明雷」一致）：之前加了位置游走 tween，玩家走过去时怪会闪躲，
        // 导致碰撞判定最近距离常 >31px 擦肩而过、不进战斗。改为原地轻微呼吸动画保留生命感。
        this.tweens.add({ targets: sprite, scaleX: 1.05, scaleY: 0.97, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
      const label = this.add.text(ex, ey - sprite.height / 2 - 10, isBoss ? `【BOSS】${data.name}` : data.name, {
        fontSize: '11px', color: isBoss ? '#ffcc44' : data.type === '恶妖' ? '#ff8866' : '#aaaabb',
        fontStyle: isBoss ? 'bold' : 'normal', backgroundColor: '#00000088', padding: { x: 4, y: 2 },
      }).setOrigin(0.5).setDepth(6);
      this.enemies.push({ sprite, data, label, id: `${this.dungeonId}:${this.localStage}:${idx}` });
    });
  }

  // ═══ UI（精简版：区域标题/HUD/小地图/交互提示）═══
  private createUI(): void {
    this.zoneText = this.add.text(16, 12, '', {
      fontSize: '14px', color: '#ffe8b0', fontStyle: 'bold',
      backgroundColor: '#000000aa', padding: { x: 8, y: 2 },
    }).setScrollFactor(0).setDepth(100);
    this.stageText = this.add.text(16, 34, '', {
      fontSize: '12px', color: '#d9b3ff', backgroundColor: '#1a1a2ecc', padding: { x: 8, y: 2 },
    }).setScrollFactor(0).setDepth(100);
    this.coordText = this.add.text(16, 56, 'X:0 Y:0', {
      fontSize: '11px', color: '#88aacc', backgroundColor: '#1a1a2ecc', padding: { x: 8, y: 2 },
    }).setScrollFactor(0).setDepth(100);
    this.promptText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 60, '', {
      fontSize: '14px', color: '#ffe8b0', fontStyle: 'bold',
      backgroundColor: '#1a1a2ecc', padding: { x: 8, y: 2 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100);
    this.miniMap = this.add.graphics().setScrollFactor(0).setDepth(100);
    this.updateStageHUD();
  }

  private updateStageHUD(): void {
    const vis = getDungeonStageVisual(this.dungeonId, this.localStage);
    this.zoneText.setText(vis.title);
    this.stageText.setText(vis.subtitle || `第 ${this.localStage} 阶`);
  }

  // ═══ 输入 ═══
  private setupInput(): void {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = {
      W: this.input.keyboard!.addKey('W'), A: this.input.keyboard!.addKey('A'),
      S: this.input.keyboard!.addKey('S'), D: this.input.keyboard!.addKey('D'),
      SHIFT: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
    };
    this.ctrlKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL);
    this.input.keyboard!.on('keydown-F', this.onInteractKey, this);
    this.input.keyboard!.on('keydown-ESC', () => {
      // 副本内 ESC 直接返回原地图（不弹存档，副本进度已存服务端）
      this.exitToGame();
    });
    // 鼠标点击移动
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isTransitioning) return;
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.moveTarget = { x: wp.x, y: wp.y };
    });
  }

  private moveTarget: { x: number; y: number } | null = null;

  // ═══ Update Loop ═══
  update(): void {
    this.enemies.forEach(e => { e.label.setPosition(e.sprite.x, e.sprite.y - e.sprite.height / 2 - 10); });
    if (this.isTransitioning) { this.player.setVelocity(0, 0); return; }
    const speed = this.ctrlKey.isDown ? 500 : 160;
    let vx = 0, vy = 0;
    if (this.moveTarget) {
      const dx = this.moveTarget.x - this.player.x, dy = this.moveTarget.y - this.player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 8) { this.moveTarget = null; }
      else { vx = (dx / dist) * speed; vy = (dy / dist) * speed; }
    } else {
      if (this.cursors.left.isDown || this.keys.A.isDown) vx = -1;
      else if (this.cursors.right.isDown || this.keys.D.isDown) vx = 1;
      if (this.cursors.up.isDown || this.keys.W.isDown) vy = -1;
      else if (this.cursors.down.isDown || this.keys.S.isDown) vy = 1;
      if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }
      vx *= speed; vy *= speed;
    }
    this.player.setVelocity(vx, vy);
    if (vx < 0) this.player.setFlipX(true); else if (vx > 0) this.player.setFlipX(false);

    this.checkEnemyCollision();
    this.updateProximity();
    this.updateMiniMap();

    GameState.x = this.player.x; GameState.y = this.player.y;
    if (this.battleCooldown > 0) this.battleCooldown--;
    this.coordText.setText(`X:${Math.round(this.player.x)}  Y:${Math.round(this.player.y)}`);
  }

  private lastCollDiag = 0;
  private checkEnemyCollision(): void {
    if (this.battleCooldown > 0 || this.isTransitioning) return;
    let nearest = Infinity;
    for (const en of this.enemies) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, en.sprite.x, en.sprite.y);
      if (d < nearest) nearest = d;
      if (d < 40) {
        console.log(`[DUNGEON-COLLISION] 命中! dist=${Math.round(d)} -> enterBattle()`);
        this.enterBattle();
        return;
      }
    }
    const now = this.time.now;
    if (now - this.lastCollDiag > 1500) {
      console.log(`[DUNGEON-COLLISION] 未命中: nearest=${Math.round(nearest)} enemies=${this.enemies.length} roomId=${this.dungeonRoomId || '空(战斗时实时补)'}`);
      this.lastCollDiag = now;
    }
  }

  private enterBattle(): void {
    console.log(`[DUNGEON-BATTLE] enterBattle() roomId=${this.dungeonRoomId} stage=${this.localStage} enemies=${this.enemies.length}`);
    this.battleCooldown = 180;
    this.scene.pause();
    this.scene.launch('MultiBattleScene', {
      playerName: GameState.playerName || '勇者',
      loadout: buildClientBattleLoadout(),
      enemyParty: buildDungeonParty(this.dungeonId, this.localStage),
      dungeonId: this.dungeonId,
      dungeonStage: this.localStage,
      dungeonRoomId: this.dungeonRoomId,
      returnScene: 'DungeonMapScene',
    });
  }

  // ═══ 交互（F 键）═══
  private onInteractKey(): void {
    if (this.isTransitioning) return;
    if (this.pendingNearby === 'reward') { this.claimReward(); return; }
    if (this.pendingNearby === 'portal') {
      if (this.portal!.type === 'exit') this.exitToGame();
      else this.transitionToStage(this.localStage + 1);
      return;
    }
  }

  private updateProximity(): void {
    this.pendingNearby = '';
    if (this.rewardNPC) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.rewardNPC.sprite.x, this.rewardNPC.sprite.y);
      if (d < 50) {
        this.pendingNearby = 'reward';
        this.promptText.setText('按 F 领取奖励').setVisible(true);
        return;
      }
    }
    if (this.portal) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.portal.x, this.portal.y);
      if (d < 60) {
        this.pendingNearby = 'portal';
        this.promptText.setText(this.portal.type === 'exit' ? '按 F 返回原地图' : '按 F 前往下一阶').setVisible(true);
        return;
      }
    }
    this.promptText.setVisible(false);
  }

  // ═══ 领奖 / 传送阵 / 层切换 ═══
  private claimReward(): void {
    if (this.rewardTaken) return;
    this.rewardTaken = true;
    const r = this.lastReward;
    let msg = `第 ${this.localStage} 阶通关！`;
    if (r) msg += `\n金币+${r.gold}  经验+${r.exp}` + (r.loot.length ? `\n获得：${r.loot.join('、')}` : '');
    this.showNotif(msg);
    if (this.rewardNPC) { this.rewardNPC.sprite.destroy(); this.rewardNPC.label.destroy(); this.rewardNPC = null; }
    this.spawnPortal(this.localStage >= 3 ? 'exit' : 'next');
  }

  private spawnRewardNPC(): void {
    const nx = GAME_WIDTH * 1.5, ny = GAME_HEIGHT * 1.0;
    const sprite = this.physics.add.sprite(nx, ny, 'npc').setImmovable(true).setDepth(5);
    sprite.setTint(0xffcc66);
    const label = this.add.text(nx, ny - 30, '✦ 领奖', {
      fontSize: '13px', color: '#ffdd88', backgroundColor: '#00000088', padding: { x: 4, y: 2 },
    }).setOrigin(0.5).setDepth(6);
    this.tweens.add({ targets: sprite, scaleY: 1.05, duration: 1000, yoyo: true, repeat: -1 });
    this.rewardNPC = { sprite, label };
  }

  private spawnPortal(type: 'next' | 'exit'): void {
    const px = GAME_WIDTH * 2.7, py = GAME_HEIGHT * 1.0;
    const gfx = this.add.graphics().setDepth(3);
    const color = type === 'exit' ? 0xaa66ff : 0x44aaff;
    gfx.fillStyle(color, 0.15); gfx.fillCircle(px, py, 35);
    gfx.fillStyle(color, 0.32); gfx.fillCircle(px, py, 22);
    gfx.lineStyle(2, color, 0.9); gfx.strokeCircle(px, py, 32);
    this.tweens.add({ targets: gfx, alpha: 0.35, duration: 1100, yoyo: true, repeat: -1 });
    const label = this.add.text(px, py - 46, type === 'exit' ? '✕ 返回原地图' : '▶ 下一阶', {
      fontSize: '12px', color: type === 'exit' ? '#d9b3ff' : '#88ddff', fontStyle: 'bold',
      backgroundColor: '#221133cc', padding: { x: 5, y: 2 },
    }).setOrigin(0.5).setDepth(6);
    this.tweens.add({ targets: label, y: py - 52, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.portal = { x: px, y: py, type, gfx, label };
  }

  private transitionToStage(stage: number): void {
    if (this.isTransitioning) return;
    this.isTransitioning = true;
    this.enemies.forEach(e => { e.sprite.destroy(); e.label.destroy(); });
    this.enemies = [];
    if (this.portal) { this.portal.gfx.destroy(); this.portal.label.destroy(); this.portal = null; }
    this.cameras.main.fadeOut(400, 0, 0, 0);
    // 用 delayedCall 而非 camerafadeoutcomplete 事件（DungeonMapScene 相机事件偶发不触发，导致切换卡死）
    this.time.delayedCall(450, () => {
      this.localStage = stage;
      this.clearedPending = false;
      this.rewardTaken = false;
      this.createMap();
      this.createEnemies();
      this.player.setPosition(GAME_WIDTH * 1.5, GAME_HEIGHT * 1.0);
      this.updateStageHUD();
      this.cameras.main.fadeIn(400, 0, 0, 0);
      this.isTransitioning = false;
    });
  }

  private exitToGame(): void {
    if (this.isTransitioning) return;
    GameState.zone = this.fromZone;
    this.scene.start('GameScene', { zone: this.fromZone });
  }

  // ═══ DungeonRoom 状态同步（权威 stage/phase 驱动地图刷新）═══
  private connectDungeonRoom(): void {
    const gameSid = (this.scene.get('GameScene') as any)?.mySessionId || GameState.playerName || '勇者';
    getClient().joinOrCreate('dungeon', {
      dungeonId: this.dungeonId,
      gameSid,
      name: GameState.playerName || '勇者',
    }).then((room: any) => {
      this.dungeonRoom = room;
      this.dungeonRoomId = room.roomId;
      console.log(`[DUNGEON-CONN] 副本房已连接 roomId=${room.roomId} dungeonId=${this.dungeonId}`);
      room.onStateChange((s: any) => this.onDungeonStateChange(s));
      room.onMessage('dungeonError', (m: any) => this.showNotif(m?.msg || '无法进入副本'));
      this.onDungeonStateChange(room.state);
    }).catch((e: any) => {
      console.error('[DUNGEON-CONN] 连接失败', e);
      this.showNotif('无法连接副本服务器');
    });
  }

  private onDungeonStateChange(s: any): void {
    if (!s) return;
    const serverStage = s.stage || 1;
    const phase = s.phase || 'lobby';
    this.updateStageHUD();

    if (phase === 'clear') {
      // 第 3 阶（最终）通关：localStage 此时应为 3，原地发最终奖励。
      if (!this.clearHandled) {
        this.clearHandled = true;
        this.handleStageCleared(this.localStage);
      }
      return;
    }

    // 普通层通关：服务端把 stage 推进到「已通关层 + 1」（见 DungeonRoom.onStageCleared）。
    // 关键：localStage 表示"当前显示/刚通关的层"，绝不可直接覆盖成 serverStage，
    // 否则打完第 2 阶会被误判为第 3 阶、传送阵错发 exit，导致跳过 BOSS 第 3 阶。
    const clearedStage = serverStage - 1;
    if (clearedStage >= 1 && clearedStage === this.localStage && !this.clearedPending) {
      this.clearedPending = true;
      this.rewardTaken = false;
      this.handleStageCleared(this.localStage);
    }
  }

  /** 某层刚通关：移除该层所有怪，中央生成领奖 NPC。clearedStage 仅用于文案。 */
  private handleStageCleared(clearedStage: number): void {
    this.enemies.forEach(e => { e.sprite.destroy(); e.label.destroy(); });
    this.enemies = [];
    if (this.rewardNPC) { this.rewardNPC.sprite.destroy(); this.rewardNPC.label.destroy(); this.rewardNPC = null; }
    this.spawnRewardNPC();
    this.showNotif(`第 ${clearedStage} 阶已通关！前往中央领取奖励`);
  }

  // ═══ 战斗结束回调（MultiBattleScene 胜利后回写奖励到本地 GameState）═══
  onMultiBattleEnd(result: string, _monsterId: string, _enemyData: any, reward?: RewardInfo): void {
    if (result === 'victory' && reward) {
      GameState.gold += reward.gold;
      GameState.gainExp(reward.exp);
      for (const name of reward.loot) {
        Inventory.addItem({ id: name, name, type: 'consumable', desc: '副本奖励', quantity: 1 });
      }
      this.lastReward = reward;
    }
  }

  // ═══ 小地图（简化：玩家点 + 副本传送阵点）═══
  private updateMiniMap(): void {
    const g = this.miniMap;
    g.clear();
    const mw = 120, mh = 80, ox = GAME_WIDTH - mw - 16, oy = GAME_HEIGHT - mh - 16;
    g.fillStyle(0x000000, 0.5); g.fillRect(ox, oy, mw, mh);
    g.lineStyle(1, 0x666688, 0.8); g.strokeRect(ox, oy, mw, mh);
    const sx = mw / (GAME_WIDTH * 3), sy = mh / (GAME_HEIGHT * 2);
    g.fillStyle(0x44aaff, 1);
    g.fillCircle(ox + this.player.x * sx, oy + this.player.y * sy, 3);
    if (this.portal) {
      g.fillStyle(this.portal.type === 'exit' ? 0xaa66ff : 0x44aaff, 1);
      g.fillCircle(ox + this.portal.x * sx, oy + this.portal.y * sy, 3);
    }
  }

  private showNotif(msg: string): void {
    const n = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, msg, {
      fontSize: '18px', color: '#ffe8b0', fontStyle: 'bold',
      backgroundColor: '#112211cc', padding: { x: 16, y: 10 }, align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(300);
    this.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 70, duration: 2000, delay: 600, onComplete: () => n.destroy() });
  }
}
