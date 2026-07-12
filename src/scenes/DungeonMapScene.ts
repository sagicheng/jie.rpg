/**
 * 副本独立地图场景（阶段③「镜像地图方案」重构）。
 *
 * 设计要点：
 *  - 副本 = 一张独立地图场景（与 GameScene 平级），不再用 overlay 嵌套 DungeonScene，
 *    彻底规避 overlay 套 overlay 的渲染层级 bug（phase=combat 但画面不可见）。
 *  - 共 3 张镜像地图（阶段③），各一场战斗：镜像地图1=4 普通妖 / 镜像地图2=2 精英妖将 / 镜像地图3=1 区域 BOSS。
 *    进入显示该阶段明雷怪，清完 → 中央出现领奖 NPC → 按 F 领奖 → 出现下一阶段传送阵 →
 *    碰传送阵切换镜像地图视觉与怪，第 3 阶段（BOSS）通关后传送阵变为「返回原地图」。
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
// 复用 GameScene 同一套面板系统（背包/属性/鬼道/图鉴/任务/标题），让副本内也能开 C/B 等界面。
// DungeonMapScene 实现与 GameScene 同款的「面板宿主契约」（公开字段 + pauseForMenu/resumeFromMenu），
// 调用时以 `this as any` 桥接（不改 panels.ts，零回归风险）。
import {
  toggleInventory, closeInventory,
  toggleStatPanel, closeStatPanel,
  showKidoPanel, closeKidoPanel, closeEnhancePanel,
  toggleQuestLog,
  toggleBestiaryPanel, closeBestiaryPanel,
  toggleTitlePanel, closeTitlePanel,
} from '../ui/panels';

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
  /** 是否由队长带队跟随进入：是则镜像队长阶段进度，自己不领奖/不进下一阶。 */
  private followEnter = false;
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

  // ═══ 面板宿主契约（与 GameScene 同款，使 C/B/K/N/L/T 界面在副本内可用）═══
  public statPanel: Phaser.GameObjects.Container | null = null;
  public inventoryPanel: Phaser.GameObjects.Container | null = null;
  public kidoPanel: Phaser.GameObjects.Container | null = null;
  public kidoTooltip: Phaser.GameObjects.Container | null = null;
  public enhancePanel: Phaser.GameObjects.Container | null = null;
  public bestiaryPanel: Phaser.GameObjects.Container | null = null;
  public bestiaryDetailContainer: Phaser.GameObjects.Container | null = null;
  public titlePanel: Phaser.GameObjects.Container | null = null;
  public shopPanel: Phaser.GameObjects.Container | null = null;
  public questLogPanel: Phaser.GameObjects.Container | null = null;
  public namingPanelActive = false;
  public isInDialogue = false;
  public gameRoom: any = null;
  private menuPauseDepth = 0;

  public pauseForMenu(): void { this.menuPauseDepth++; if (this.menuPauseDepth === 1) this.physics.pause(); }
  public resumeFromMenu(): void { this.menuPauseDepth = Math.max(0, this.menuPauseDepth - 1); if (this.menuPauseDepth === 0) this.physics.resume(); }

  /** 是否有任意面板/对话打开（用于 update 冻结移动 + 屏蔽碰撞/点击）。 */
  private isMenuOpen(): boolean {
    return this.isInDialogue || this.namingPanelActive ||
      !!this.statPanel || !!this.inventoryPanel || !!this.kidoPanel || !!this.enhancePanel ||
      !!this.bestiaryPanel || !!this.titlePanel || !!this.questLogPanel || !!this.shopPanel;
  }

  constructor() {
    super({ key: 'DungeonMapScene' });
  }

  init(data: { dungeonId?: number; fromZone?: number; followEnter?: boolean }): void {
    this.dungeonId = data?.dungeonId || 1;
    this.fromZone = data?.fromZone || GameState.zone;
    this.followEnter = data?.followEnter || false;
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
    // 复位面板宿主状态（防止上一次副本残留的面板/暂停标记带到新副本）
    this.statPanel = null; this.inventoryPanel = null; this.kidoPanel = null;
    this.kidoTooltip = null; this.enhancePanel = null; this.bestiaryPanel = null;
    this.bestiaryDetailContainer = null; this.titlePanel = null; this.shopPanel = null;
    this.questLogPanel = null; this.namingPanelActive = false; this.isInDialogue = false;
    this.gameRoom = null; this.menuPauseDepth = 0;
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
    // 接上联机世界房（与 GameScene 同一实例，Colyseus 房间连接不随场景停止而断开），
    // 使副本内背包的装备/强化等联网动作与原地图行为一致。
    this.gameRoom = (this.scene.get('GameScene') as any)?.gameRoom || null;
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
    // 面板键：C 属性 / B 背包 / K 鬼道 / N 图鉴 / L 任务 / T 称号——与 GameScene 同款
    this.input.keyboard!.addKey('B').on('down', () => { if (!this.isInDialogue && !this.statPanel) toggleInventory(this as any); });
    this.input.keyboard!.addKey('C').on('down', () => { if (!this.isInDialogue && !this.inventoryPanel) toggleStatPanel(this as any); });
    this.input.keyboard!.addKey('K').on('down', () => {
      if (!this.isInDialogue && !this.inventoryPanel && !this.statPanel) showKidoPanel(this as any);
    });
    this.input.keyboard!.addKey('N').on('down', () => {
      if (!this.isInDialogue && !this.inventoryPanel && !this.statPanel && !this.kidoPanel && !this.enhancePanel)
        toggleBestiaryPanel(this as any);
    });
    this.input.keyboard!.addKey('L').on('down', () => {
      if (!this.isInDialogue && !this.inventoryPanel && !this.statPanel && !this.kidoPanel && !this.enhancePanel && !this.bestiaryPanel)
        toggleQuestLog(this as any);
    });
    this.input.keyboard!.addKey('T').on('down', () => {
      if (!this.isInDialogue && !this.inventoryPanel && !this.statPanel && !this.kidoPanel && !this.enhancePanel && !this.bestiaryPanel)
        toggleTitlePanel(this as any);
    });
    this.input.keyboard!.on('keydown-ESC', () => {
      // 先关任意已开面板；无面板时 ESC 直接返回原地图（副本进度已存服务端）
      if (this.inventoryPanel) { closeInventory(this as any); return; }
      if (this.statPanel) { closeStatPanel(this as any); return; }
      if (this.kidoPanel) { closeKidoPanel(this as any); return; }
      if (this.enhancePanel) { closeEnhancePanel(this as any); return; }
      if (this.titlePanel) { closeTitlePanel(this as any); return; }
      if (this.bestiaryPanel) { closeBestiaryPanel(this as any); return; }
      if (this.questLogPanel) { this.questLogPanel.destroy(true); this.questLogPanel = null; this.resumeFromMenu(); return; }
      this.exitToGame();
    });
    // 鼠标点击移动（面板打开 / 切换中不响应）
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isTransitioning || this.isMenuOpen()) return;
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.moveTarget = { x: wp.x, y: wp.y };
    });
  }

  private moveTarget: { x: number; y: number } | null = null;

  // ═══ Update Loop ═══
  update(): void {
    this.enemies.forEach(e => { e.label.setPosition(e.sprite.x, e.sprite.y - e.sprite.height / 2 - 10); });
    if (this.isTransitioning) { this.player.setVelocity(0, 0); return; }
    if (this.isMenuOpen()) { this.player.setVelocity(0, 0); return; }
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

  private checkEnemyCollision(): void {
    if (this.battleCooldown > 0 || this.isTransitioning) return;
    if (this.enemies.length === 0) return;
    // 找到最近的一只明雷怪（非整组），仅传该只进战斗
    let nearest: { enemy: DungeonEnemy; dist: number } | null = null;
    for (const en of this.enemies) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, en.sprite.x, en.sprite.y);
      if (d < 52 && (!nearest || d < nearest.dist)) nearest = { enemy: en, dist: d };
    }
    if (nearest) this.enterBattle(nearest.enemy);
  }

  private enterBattle(enemy: DungeonEnemy): void {
    this.battleCooldown = 180;
    this.scene.pause();
    this.scene.launch('MultiBattleScene', {
      playerName: GameState.playerName || '勇者',
      loadout: buildClientBattleLoadout(),
      enemyParty: this.buildEncounterParty(),
      monsterId: enemy.id,
      dungeonId: this.dungeonId,
      dungeonStage: this.localStage,
      dungeonRoomId: this.dungeonRoomId,
      returnScene: 'DungeonMapScene',
      // 关键：副本战斗奖励必须写回玩家本体世界（GameRoom sessionId），否则落到 battle 房间孤儿世界丢失。
      // DungeonMapScene 自身不持有 mySessionId，从同源 GameScene 实例取。
      ownerSessionId: (this.scene.get('GameScene') as any)?.mySessionId || '',
    });
  }

  /** 根据阶段随机生成敌群阵容：阶段1=1~4普通 / 阶段2=3~6精英 / 阶段3=1BOSS+7随从 */
  private buildEncounterParty(): EnemyData[] {
    const templates = buildDungeonParty(this.dungeonId, this.localStage);
    // 阶段3：BOSS+随从 1+7（templates[0]=BOSS, templates[1+]=随从池，池不够时复用）
    if (this.localStage >= 3) {
      const boss = templates[0];
      const minions = templates.length > 1 ? templates.slice(1) : [boss];
      const party: EnemyData[] = [boss];
      for (let i = 0; i < 7; i++) party.push(minions[i % minions.length]);
      return party;
    }
    // 阶段2：精英 3~6 只随机
    if (this.localStage === 2) {
      const n = Phaser.Math.Between(3, 6);
      const party: EnemyData[] = [];
      for (let i = 0; i < n; i++) party.push(templates[i % templates.length]);
      return party;
    }
    // 阶段1：普通 1~4 只随机
    const n = Phaser.Math.Between(1, 4);
    const party: EnemyData[] = [];
    for (let i = 0; i < n; i++) party.push(templates[i % templates.length]);
    return party;
  }

  // ═══ 交互（F 键）═══
  private onInteractKey(): void {
    if (this.isTransitioning) return;
    // 跟随者：阶段推进由队长驱动（服务端权威），自己不领奖/不进下一阶；仅允许退出副本
    if (this.followEnter) {
      if (this.pendingNearby === 'portal' && this.portal && this.portal.type === 'exit') this.exitToGame();
      return;
    }
    // 直接检测领奖 NPC 距离（绕过 pendingNearby，防止 updateProximity 帧跳/坐标漂移导致 F 键失效）
    if (this.rewardNPC && !this.rewardTaken) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.rewardNPC.sprite.x, this.rewardNPC.sprite.y);
      if (d < 80) { this.claimReward(); return; }
    }
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
    if (!this.dungeonRoom) return;
    this.rewardTaken = true;
    this.clearedPending = true;
    this.dungeonRoom.send('claimStage', { stage: this.localStage });
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
    // 恢复被暂停的主场景（保留其联机连接与权威世界），再关闭副本场景自身。
    // 必须 resume 而非 start —— start 会重启 GameScene 并重新连房拿到新 sessionId，
    // 导致服务端权威世界被清空、副本奖励/等级丢失（bug1/bug2 根因之一）。
    this.scene.resume('GameScene');
    this.scene.stop();
  }

  // ═══ DungeonRoom 状态同步（权威 stage/phase 驱动地图刷新）═══
  private async connectDungeonRoom(): Promise<void> {
    const gameSid = (this.scene.get('GameScene') as any)?.mySessionId || GameState.playerName || '勇者';
    try {
      const room: any = await getClient().joinOrCreate('dungeon', {
        dungeonId: this.dungeonId,
        gameSid,
        name: GameState.playerName || '勇者',
      });
      this.dungeonRoom = room;
      this.dungeonRoomId = room.roomId;
      room.onStateChange((s: any) => this.onDungeonStateChange(s));
      room.onMessage('claimStageReward', (data: any) => {
        let msg = `第 ${this.localStage} 阶通关！`;
        msg += `\n金币+${data.gold}  经验+${data.exp}`;
        if (data.loot?.length) msg += `\n获得：${data.loot.join('、')}`;
        this.showNotif(msg);
        if (this.rewardNPC) { this.rewardNPC.sprite.destroy(); this.rewardNPC.label.destroy(); this.rewardNPC = null; }
        this.spawnPortal(this.localStage >= 3 ? 'exit' : 'next');
      });
      this.onDungeonStateChange(room.state);
    } catch (e: any) {
      // 包括：周次耗尽（服务器 onJoin throw Error）、网络错误等
      this.showNotif(e?.message || '无法进入副本');
      this.time.delayedCall(1200, () => this.exitToGame());
    }
  }

  private onDungeonStateChange(s: any): void {
    if (!s) return;
    this.updateStageHUD();
    // 跟随者：阶段进度由队长权威驱动，直接镜像服务端 stage（含进入时已在中途的情况）
    if (this.followEnter) this.syncToServerStage(s.stage);
    // 不在此处理阶段通关——本场景的完成检测由 onMultiBattleEnd 逐怪追踪（全部明雷击杀后
    // 调 handleStageCleared 生成领奖 NPC）。阶段推进与领奖通过 claimReward → claimStage
    // 权威驱动（DungeonRoom 服务端发奖+推进 stage）。若在此通过 serverStage/phase 变化
    // 触发 handleStageCleared，会与 onMultiBattleEnd 冲突导致「打死1只→全清→提前弹出NPC」。
  }

  /** 跟随者镜像：把本地阶段对齐到服务端（队长所在）阶段，重建地图与明雷。 */
  private syncToServerStage(stage: number): void {
    if (!stage || stage === this.localStage) return;
    if (this.isTransitioning) return;
    this.localStage = stage;
    this.enemies.forEach((e) => { e.sprite.destroy(); e.label.destroy(); });
    this.enemies = [];
    if (this.rewardNPC) { this.rewardNPC.sprite.destroy(); this.rewardNPC.label.destroy(); this.rewardNPC = null; }
    if (this.portal) { this.portal.gfx.destroy(); this.portal.label.destroy(); this.portal = null; }
    this.clearedPending = false;
    this.rewardTaken = false;
    this.createMap();
    this.createEnemies();
    this.player.setPosition(GAME_WIDTH * 1.5, GAME_HEIGHT * 1.0);
    this.updateStageHUD();
    this.showNotif(`跟随队长进入第 ${stage} 阶`);
  }

  /** 某层刚通关：移除该层所有怪，中央生成领奖 NPC。clearedStage 仅用于文案。 */
  private handleStageCleared(clearedStage: number): void {
    this.enemies.forEach(e => { e.sprite.destroy(); e.label.destroy(); });
    this.enemies = [];
    if (this.rewardNPC) { this.rewardNPC.sprite.destroy(); this.rewardNPC.label.destroy(); this.rewardNPC = null; }
    // 跟随者不自己领奖（阶段推进由队长权威驱动），跳过领奖 NPC
    if (!this.followEnter) this.spawnRewardNPC();
    this.showNotif(`第 ${clearedStage} 阶已通关！前往中央领取奖励`);
  }

  // ═══ 战斗结束回调（MultiBattleScene 胜利后触发）═══
  onMultiBattleEnd(result: string, monsterId: string, _enemyData: any, reward?: RewardInfo): void {
    if (result !== 'victory') return;
    const idx = this.enemies.findIndex(e => e.id === monsterId);
    if (idx >= 0) {
      this.enemies[idx].sprite.destroy();
      this.enemies[idx].label.destroy();
      this.enemies.splice(idx, 1);
    }
    // 注意：不再用「找不到就删 enemies[0]」的兜底——跟随者阶段镜像会整体替换 enemies，
    // 此时原 monsterId 已不在列表中，若兜底删 [0] 会误删新阶段的怪。
    if (reward) this.lastReward = reward;
    if (this.enemies.length === 0) this.handleStageCleared(this.localStage);
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
