import Phaser from 'phaser';
import { matId, NODE_TO_MATERIAL } from '../data/materials';
import { GAME_WIDTH, GAME_HEIGHT, ZONE_NAMES } from '../config';
import { DialogueBox, DialogueLine } from '../ui/DialogueBox';
import { GameState } from '../systems/GameState';
import { EnemyData, createEnemyData, expForLevel, generateLoot } from '../systems/BattleData';
import { getEnemyData, NAMED_ENEMIES } from '../systems/BestiaryData';
import { Inventory } from '../systems/Inventory';
import { SaveManager } from '../systems/SaveManager';
import { ZONE_CONFIGS, getDungeonPortal } from '../systems/Zones';
import { MAIN_QUESTS, MAIN_QUEST_ORDER, SIDE_QUESTS } from '../systems/QuestData';
import { Kido, KIDO_NODES, KidoSchool } from '../systems/Kido';
import { getAvailableSkills, ZANPAKUTO_ELEMENT } from '../systems/Skills';
import { BOSS_CONFIG } from '../systems/BossMechanics';
import { openShop, toggleInventory, closeInventory, toggleStatPanel, closeStatPanel, renderInventoryPanel, renderStatPanel, showKidoPanel, closeKidoPanel, toggleEnhancePanel, closeEnhancePanel, toggleQuestLog, toggleBestiaryPanel, closeBestiaryPanel, renderQuestBoardPanel, showNamingInput, showShikaiSelection, closeTitlePanel, toggleTitlePanel } from '../ui/panels';
import { getClient } from '../net/Net';
import { applyWorldSync, setActiveRoom, setDisconnectNotifier, requestGather, requestBuy, requestEquip, requestUnequip, requestCraft, requestEnhance, requestRefine, requestDecompose, requestRefineReset, requestClaimQuest, dungeonProgress, dungeonWeekly, DUNGEON_WEEKLY_CAP } from '../systems/WorldClient';

interface NPCData {
  sprite: Phaser.Physics.Arcade.Sprite;
  name: string;
  role: string;
  dialogue: DialogueLine[];
  nameTag: Phaser.GameObjects.Text;
  x: number;
  y: number;
  shop?: Array<{ name: string; price: number; id: string; slot: string; stats: Record<string, number>; desc: string }>;
}

export class GameScene extends Phaser.Scene {
  // Core
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  /** 是否已进入副本（防止重复进入）。 */
  private inDungeon = false;
  /** 是否站在副本传送阵附近（F 键进入）。 */
  private nearbyDungeon = false;
  /** 当前区域副本传送阵世界坐标（渲染 + 小地图 +  proximity 用）。 */
  private dungeonPortalPos: { x: number; y: number } | null = null;
  private ctrlKey!: Phaser.Input.Keyboard.Key;
  public dialogueBox!: DialogueBox;
  public isInDialogue = false;
  private canInteract = false;
  private currentNPC: NPCData | null = null;
  private moveTarget: { x: number; y: number } | null = null;
  private battleCooldown = 0;
  private menuPauseDepth = 0;

  // ——— 联机（共享地图房间）———
  /** 联机 game 房间连接（panels.ts 等 UI 模块据其判读走服务端权威或本地逻辑）。 */
  public gameRoom: any = null;
  private mySessionId = '';
  private remotePlayers: Map<string, { sprite: Phaser.GameObjects.Sprite; tag: Phaser.GameObjects.Text; tx: number; ty: number; name: string; title: string }> = new Map();
  private lastSent = { x: -9999, y: -9999, t: 0 };
  private netHint!: Phaser.GameObjects.Text;
  /** 权威战斗结束后的奖励报告，等场景 RESUME 时弹出（避免被战斗场景遮挡）。 */
  private pendingBattleReport: { exp: number; gold: number; loot: string[]; leveled: boolean; defeat: boolean; fled?: boolean } | null = null;

  // HUD
  private zoneText!: Phaser.GameObjects.Text;
  private coordText!: Phaser.GameObjects.Text;
  private promptText!: Phaser.GameObjects.Text;
  private miniMap!: Phaser.GameObjects.Graphics;

  // Worlds
  private npcList: NPCData[] = [];
  private enemies: Array<{ sprite: Phaser.Physics.Arcade.Sprite; data: EnemyData; label: Phaser.GameObjects.Text; id: string; dead?: boolean; respawnTimer?: Phaser.Time.TimerEvent }> = [];
  private gatherPoints: Array<{ sprite: Phaser.Physics.Arcade.Sprite; type: string; label: Phaser.GameObjects.Text }> = [];

  // Panels
  public statPanel: Phaser.GameObjects.Container | null = null;
  public inventoryPanel: Phaser.GameObjects.Container | null = null;
  public kidoPanel: Phaser.GameObjects.Container | null = null;
  public kidoTooltip: Phaser.GameObjects.Container | null = null;
  public enhancePanel: Phaser.GameObjects.Container | null = null;
  public bestiaryPanel: Phaser.GameObjects.Container | null = null;
  public titlePanel: Phaser.GameObjects.Container | null = null;
  private titleTag: Phaser.GameObjects.Text | null = null;
  private nameTag: Phaser.GameObjects.Text | null = null;
  public bestiaryDetailContainer: Phaser.GameObjects.Container | null = null;
  public shopPanel: Phaser.GameObjects.Container | null = null;
  private lastShopItems: any[] = [];
  public namingPanelActive = false;

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data?: { newGame?: boolean; name?: string; element?: string }): void {
    if (data?.newGame) {
      GameState.reset();
      GameState.x = 400;
      GameState.y = 500;
      GameState.zone = 1;
      GameState.newGame = true;
      // 恢复建角信息（来自 CreateCharacterScene，reset() 已清空 playerName/element/hasCreated）
      if (data.name) {
        GameState.playerName = data.name;
        if (data.element) GameState.element = data.element;
        GameState.hasCreated = true;
      }
      Inventory.addItem({ id: 'stop_blood_grass', name: '止血草', type: 'consumable', desc: '回复50HP', quantity: 5 });
      Inventory.addItem({ id: 'medicine_pill_s', name: '伤药(小)', type: 'consumable', desc: '回复150HP', quantity: 3 });
      Inventory.addItem({ id: 'spirit_water_s', name: '灵力水(小)', type: 'consumable', desc: '回复30MP', quantity: 3 });
      Inventory.addItem({ id: 'antidote', name: '解毒药', type: 'consumable', desc: '解除中毒·寄生·灼烧', quantity: 2 });
    } else if (data?.newGame === false) {
      const loaded = SaveManager.load();
      if (!loaded.success) {
        GameState.reset();
        GameState.x = 400;
        GameState.y = 500;
        GameState.zone = 1;
        return;
      }
      GameState.newGame = false;
      Kido.reset();
      if (loaded.kidoSchool) Kido.school = loaded.kidoSchool as KidoSchool;
      if (loaded.kidoNodes) Kido.nodes = { ...loaded.kidoNodes };
      if (loaded.kidoEquipped && Array.isArray(loaded.kidoEquipped))
        Kido.equipped = loaded.kidoEquipped.filter(id => KIDO_NODES[id]);
    }
  }

  create(): void {
    this.npcList = [];
    this.enemies = [];
    this.gatherPoints = [];
    this.moveTarget = null;
    this.isInDialogue = false;
    this.canInteract = false;
    this.currentNPC = null;
    // 副本返回时 GameScene 是 scene.start 重启（复用同一实例，不重跑构造期字段初始化），
    // inDungeon/nearbyDungeon 会残留上次 true → 二次进入副本被 checkDungeonPortal 的 !inDungeon 守卫永久挡掉。
    // 这里显式复位，确保每次重建都能再次进入副本。
    this.inDungeon = false;
    this.nearbyDungeon = false;

    this.createMap();
    this.dialogueBox = new DialogueBox(this);
    this.physics.world.setBounds(0, 0, GAME_WIDTH * 3, GAME_HEIGHT * 2);

    this.player = this.physics.add.sprite(GameState.x, GameState.y, 'player')
      .setDepth(10).setCollideWorldBounds(true);
    this.player.body!.setSize(24, 32);
    this.player.body!.setOffset(4, 0);

    // 玩家头顶：角色名 + 称号（跟随人物移动）
    this.nameTag = this.add.text(this.player.x, this.player.y - this.player.height / 2 - 22, GameState.playerName, {
      fontSize: '12px', color: '#bfe8ff', fontStyle: 'bold',
      backgroundColor: '#00000066', padding: { x: 4, y: 1 },
    }).setOrigin(0.5, 1).setDepth(11);
    this.titleTag = this.add.text(this.player.x, this.player.y - this.player.height / 2 - 8, '', {
      fontSize: '11px', color: '#ffd9a0', fontStyle: 'bold',
      backgroundColor: '#00000066', padding: { x: 4, y: 1 },
    }).setOrigin(0.5, 1).setDepth(11);
    this.syncPlayerTags();
    // 每日/周常按本地日期刷新（确保 dailyState.weeklyState 日期在任意交互前就位）
    GameState.ensureDailyRefresh();
    GameState.ensureWeeklyRefresh();
    this.connectGameRoom();

    // 相机跟随玩家
    this.cameras.main.setBounds(0, 0, GAME_WIDTH * 3, GAME_HEIGHT * 2);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);

    this.createNPCs();
    this.createEnemies();
    this.createGatheringPoints();

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = {
      W: this.input.keyboard!.addKey('W'), A: this.input.keyboard!.addKey('A'),
      S: this.input.keyboard!.addKey('S'), D: this.input.keyboard!.addKey('D'),
      SHIFT: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
    };
    // 离散动作键 F 用事件驱动（keydown-F），与 B/C 一致；避免 JustDown 在快速点按时被
    // keyup 同帧清零导致「按了像没按」的吞键问题
    this.input.keyboard!.on('keydown-F', this.onInteractKey, this);
    this.input.keyboard!.addKey('B').on('down', () => { if (!this.isInDialogue && !this.statPanel) toggleInventory(this); });
    this.input.keyboard!.addKey('C').on('down', () => { if (!this.isInDialogue && !this.inventoryPanel) toggleStatPanel(this); });
    this.input.keyboard!.addKey('K').on('down', () => {
      if (!this.isInDialogue && !this.inventoryPanel && !this.statPanel) showKidoPanel(this);
    });
    this.input.keyboard!.addKey('N').on('down', () => {
      if (!this.isInDialogue && !this.inventoryPanel && !this.statPanel && !this.kidoPanel && !this.enhancePanel)
        toggleBestiaryPanel(this);
    });
    this.input.keyboard!.addKey('L').on('down', () => {
      if (!this.isInDialogue && !this.inventoryPanel && !this.statPanel && !this.kidoPanel && !this.enhancePanel && !this.bestiaryPanel)
        toggleQuestLog(this);
    });
    this.input.keyboard!.addKey('T').on('down', () => {
      if (!this.isInDialogue && !this.inventoryPanel && !this.statPanel && !this.kidoPanel && !this.enhancePanel && !this.bestiaryPanel)
        toggleTitlePanel(this);
    });
    this.input.keyboard!.addKey('ESC').on('down', () => {
      if (this.inventoryPanel) { closeInventory(this); return; }
      if (this.statPanel) { closeStatPanel(this); return; }
      if (this.kidoPanel) { closeKidoPanel(this); return; }
      if (this.enhancePanel) { closeEnhancePanel(this); return; }
      if (this.titlePanel) { closeTitlePanel(this); return; }
      if (this.bestiaryPanel) { closeBestiaryPanel(this); return; }
      if (this.questLogPanel) { this.questLogPanel.destroy(true); this.questLogPanel = null; this.resumeFromMenu(); return; }
      if (this.isInDialogue) return;
      SaveManager.save();
      const notif = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, '已存档', {
        fontSize: '24px', color: '#88ff88', fontStyle: 'bold',
        backgroundColor: '#112211cc', padding: { x: 20, y: 12 },
      }).setOrigin(0.5).setScrollFactor(0).setDepth(300);
      this.tweens.add({
        targets: notif, alpha: 0, y: GAME_HEIGHT / 2 - 30,
        duration: 1200, delay: 400, onComplete: () => notif.destroy(),
      });
    });

    // 鼠标点击移动
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isInDialogue || this.statPanel || this.inventoryPanel || this.kidoPanel || this.enhancePanel || this.bestiaryPanel || this.questLogPanel || this.namingPanelActive || this.shopPanel) return;
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.moveTarget = { x: wp.x, y: wp.y };
    });

    // 联机：进入组队战斗房间（两个窗口都按 V 即同房间组队打怪）
    this.input.keyboard!.addKey('V').on('down', () => {
      if (this.isInDialogue || this.statPanel || this.inventoryPanel || this.kidoPanel || this.enhancePanel || this.bestiaryPanel || this.questLogPanel) return;
      this.launchMultiBattle();
    });

    // 战斗结束（scene resume）时清除「战斗中」标记，并弹出权威战斗奖励报告（避免被战斗场景遮挡）
    this.events.on(Phaser.Scenes.Events.RESUME, () => {
      this.setBattling(false);
      this.flushBattleReport();
      // 从副本返回：清除副本标记并相机淡入（enterDungeon 暂停前已淡出到黑，恢复时须淡回）
      if (this.inDungeon) {
        this.inDungeon = false;
        this.nearbyDungeon = false;
        this.promptText.setVisible(false);
        this.cameras.main.fadeIn(400, 0, 0, 0);
      }
    });

    // Dev cheats
    const ctrl = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL);
    this.ctrlKey = ctrl;
    const showDevNotif = (msg: string, color = '#88ff88') => {
      const n = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, msg, {
        fontSize: '18px', color, fontStyle: 'bold',
        backgroundColor: '#112211cc', padding: { x: 16, y: 8 },
      }).setOrigin(0.5).setScrollFactor(0).setDepth(300);
      this.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 80, duration: 1500, onComplete: () => n.destroy() });
    };
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A).on('down', () => {
      if (ctrl.isDown) {
        GameState.allocatedATK += 50; GameState.allocatedMATK += 50;
        GameState.recalcStats(); GameState.hp = GameState.maxHp; GameState.mp = GameState.maxMp;
        showDevNotif(`ATK+50 MATK+50 (ATK:${GameState.atk} MATK:${GameState.matk})`, '#ff6644');
        this.scene.get('UIScene').events.emit('updateStats');
      }
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S).on('down', () => {
      if (ctrl.isDown) { GameState.statPoints += 10; this.scene.get('UIScene').events.emit('updateStats'); showDevNotif('属性点+10', '#44ccff'); }
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D).on('down', () => {
      if (ctrl.isDown) { GameState.gold += 10000; showDevNotif('金币+10000', '#ffcc44'); }
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F).on('down', () => {
      if (ctrl.isDown) { GameState.hp = GameState.maxHp; GameState.mp = GameState.maxMp; showDevNotif('HP/MP全满', '#88ff88'); }
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.G).on('down', () => {
      if (ctrl.isDown) { GameState.exp += expForLevel(GameState.level + 1); GameState.checkLevelUp(); showDevNotif('经验+1级', '#ccaaff'); this.scene.get('UIScene').events.emit('updateStats'); }
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.H).on('down', () => {
      if (ctrl.isDown) {
        for (const name of Object.keys(NAMED_ENEMIES)) { 
          for (let i = 0; i < 100; i++) GameState.recordKill(name); 
        }
        showDevNotif('全图鉴解锁(击杀x100)', '#ffcc44');
      }
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.J).on('down', () => {
      if (ctrl.isDown) { GameState.recordKill('大虚·亚丘卡斯'); showDevNotif('Boss击杀+1', '#ff4444'); }
    });
    // 测试辅助：Ctrl+Z 触发完整始解选刀流程（与正式 shikai_trial 任务一致）
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Z).on('down', () => {
      if (ctrl.isDown) {
        if (GameState.hasShikai) showDevNotif('始解已解锁（再选刀可更换真名）', '#ffcc44');
        showShikaiSelection(this);
      }
    });

    this.zoneText = this.add.text(16, 12, `${ZONE_NAMES[GameState.zone]}`, {
      fontSize: '14px', color: '#ffe8b0', fontStyle: 'bold',
      backgroundColor: '#000000aa', padding: { x: 8, y: 2 },
    }).setScrollFactor(0).setDepth(100);
    this.coordText = this.add.text(16, 34, 'X:0 Y:0', {
      fontSize: '11px', color: '#88aacc',
      backgroundColor: '#1a1a2ecc', padding: { x: 8, y: 2 },
    }).setScrollFactor(0).setDepth(100);
    this.promptText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 60, '', {
      fontSize: '14px', color: '#ffe8b0', fontStyle: 'bold',
      backgroundColor: '#1a1a2ecc', padding: { x: 8, y: 2 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100);
    this.miniMap = this.add.graphics().setScrollFactor(0).setDepth(100);
    this.netHint = this.add.text(16, GAME_HEIGHT - 24, 'V：进入联机组队战', {
      fontSize: '12px', color: '#6688aa', backgroundColor: '#1a1a2eaa', padding: { x: 6, y: 2 },
    }).setScrollFactor(0).setDepth(100);
    this.scene.launch('UIScene');

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.gameRoom) { this.gameRoom.leave(); this.gameRoom = null; }
      setActiveRoom(null);
      this.clearRemotePlayers();
    });

    this.time.delayedCall(100, () => {
      this.scene.get('UIScene').events.emit('updateStats');
    });

    if (!GameState.hasCreated && GameState.newGame) {
      this.time.delayedCall(500, () => this.startIntroDialogue());
    }

    this.cameras.main.fadeIn(500, 0, 0, 0);

    // Zone entry banner
    const zoneName = ZONE_NAMES[GameState.zone] || '???';
    const zoneBanner = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, zoneName, {
      fontSize: '28px', color: '#ffe8b0', fontStyle: 'bold',
      backgroundColor: '#000000aa', padding: { x: 24, y: 12 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(250).setAlpha(0);
    this.tweens.add({
      targets: zoneBanner, alpha: 1, duration: 500,
      onComplete: () => {
        this.tweens.add({
          targets: zoneBanner, alpha: 0, duration: 1500, delay: 1000,
          onComplete: () => zoneBanner.destroy(),
        });
      },
    });
  }

  // ════════════════ Update Loop ════════════════

  update(): void {
    this.enemies.forEach(e => { e.label.setPosition(e.sprite.x, e.sprite.y - e.sprite.height / 2 - 10); });
    if (this.isInDialogue) { this.player.setVelocity(0, 0); return; }
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
    this.checkNPCProximity(); this.checkZoneExit(); this.checkDungeonPortal();
    this.updateMiniMap(); this.checkEnemyCollision();
    GameState.x = this.player.x; GameState.y = this.player.y;
    if (this.battleCooldown > 0) this.battleCooldown--;
    this.coordText.setText(`X:${Math.round(this.player.x)}  Y:${Math.round(this.player.y)}`);
    this.syncPlayerTags();
    this.sendMoveThrottled();
    // 联机：每帧拉取服务端状态并平滑插值远程玩家（含名字）
    this.syncRemotePlayers();
    this.remotePlayers.forEach(rp => {
      rp.sprite.x = Phaser.Math.Linear(rp.sprite.x, rp.tx, 0.2);
      rp.sprite.y = Phaser.Math.Linear(rp.sprite.y, rp.ty, 0.2);
      rp.tag.setPosition(rp.sprite.x, rp.sprite.y - 46);
    });
    // 联机：每帧按服务端怪物状态机同步显示（防重入战斗）
    this.pruneSharedMonsters();
  }

  /** 玩家头顶：角色名 + 称号，跟随移动，文本变化时才重绘 */
  private syncPlayerTags(): void {
    const ph = this.player.height / 2;
    if (this.nameTag) {
      if (this.nameTag.text !== GameState.playerName) this.nameTag.setText(GameState.playerName);
      this.nameTag.setPosition(this.player.x, this.player.y - ph - 22);
    }
    if (this.titleTag) {
      const tn = GameState.getActiveTitleDef()?.name ?? '';
      if (this.titleTag.text !== tn) {
        this.titleTag.setText(tn);
        this.titleTag.setVisible(tn.length > 0);
      }
      this.titleTag.setPosition(this.player.x, this.player.y - ph - 8);
    }
  }

  public pauseForMenu(): void { this.menuPauseDepth++; if (this.menuPauseDepth === 1) this.physics.pause(); }
  public resumeFromMenu(): void { this.menuPauseDepth = Math.max(0, this.menuPauseDepth - 1); if (this.menuPauseDepth === 0) this.physics.resume(); }

  // ═══ NPC ═══
  private checkNPCProximity(): void {
    this.canInteract = false; this.currentNPC = null; let closestDist = Infinity;
    for (const npc of this.npcList) { const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, npc.sprite.x, npc.sprite.y); if (dist < 50 && dist < closestDist) { closestDist = dist; this.currentNPC = npc; this.canInteract = true; } }
    if (this.canInteract && this.currentNPC) { this.promptText.setText(`按 F 与 ${this.currentNPC.name} 对话`); this.promptText.setPosition(this.currentNPC.sprite.x, this.currentNPC.sprite.y - 50); this.promptText.setVisible(true); }
    else { this.promptText.setVisible(false); }
  }
  /** F 键统一处理（事件驱动，keydown 即触发，不受 keyup 时机影响）。按优先级：NPC > 副本传送阵 > 采集点 > 区域出口。 */
  private onInteractKey(): void {
    if (this.isInDialogue) return;
    // NPC 对话优先
    if (this.canInteract && this.currentNPC) { this.startDialogue(this.currentNPC); return; }
    // 副本传送阵：F 进入
    if (this.nearbyDungeon && !this.inDungeon) { this.enterDungeon(GameState.zone); return; }
    // 采集点
    for (let i = 0; i < this.gatherPoints.length; i++) {
      const pt = this.gatherPoints[i];
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, pt.sprite.x, pt.sprite.y);
      if (dist < 55) { this.tryGather(i); return; }
    }
    // 区域出口（站在副本传送阵上时 F 留给副本进入，上面已处理）
    const cfg = ZONE_CONFIGS[GameState.zone];
    if (cfg) {
      if (this.dungeonPortalPos) {
        const dpDist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.dungeonPortalPos.x, this.dungeonPortalPos.y);
        if (dpDist < 60) return;
      }
      for (const exit of cfg.exits) {
        const ex = exit.x * GAME_WIDTH * 3, ey = exit.y * GAME_HEIGHT * 2;
        if (Phaser.Math.Distance.Between(this.player.x, this.player.y, ex, ey) < 60) {
          this.transitionToZone(exit.targetZone, exit.targetX * GAME_WIDTH * 3, exit.targetY * GAME_HEIGHT * 2);
          return;
        }
      }
    }
  }

  /** 采集动作（从 onInteractKey 调用，原 checkGatherProximity 的 F-触发逻辑提取）。 */
  private tryGather(idx: number): void {
    if (this.isInDialogue) return;
    const pt = this.gatherPoints[idx];
    // 客户端活动任务进度（UI 用，两种模式都更新）
    GameState.updateQuestProgress('collect', pt.type, 1);
    if (this.gameRoom) {
      // 联机：采集走服务端权威，背包/节点隐藏由 worldSync 下发，反馈由 intentResult
      if (!requestGather(GameState.zone, idx, Math.round(this.player.x), Math.round(this.player.y))) return;
      this.isInDialogue = true;
      this.time.delayedCall(300, () => { this.isInDialogue = false; });
      return;
    }
    // 单机：本地采集
    this.isInDialogue = true;
    const matName = NODE_TO_MATERIAL[pt.type] || pt.type;
    Inventory.addItem({ id: matId(matName), name: matName, type: 'material', desc: '野外采集获得', quantity: 1 });
    pt.sprite.setVisible(false); pt.label.setVisible(false);
    this.time.delayedCall(30000, () => { pt.sprite.setVisible(true); pt.label.setVisible(true); });
    const notif = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 80, `获得：${matName}`, { fontSize: '18px', color: '#88ff88', fontStyle: 'bold', backgroundColor: '#112211cc', padding: { x: 16, y: 8 } }).setOrigin(0.5).setScrollFactor(0).setDepth(300);
    this.tweens.add({ targets: notif, alpha: 0, y: GAME_HEIGHT / 2 - 100, duration: 1500, onComplete: () => notif.destroy() });
    this.time.delayedCall(300, () => { this.isInDialogue = false; });
  }

  /** 副本传送阵 proximity：站在传送阵附近时显示进入提示。 */
  private checkDungeonPortal(): void {
    if (!this.dungeonPortalPos) { this.nearbyDungeon = false; return; }
    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.dungeonPortalPos.x, this.dungeonPortalPos.y);
    if (dist < 60 && !this.inDungeon) {
      this.nearbyDungeon = true;
      const remaining = Math.max(0, DUNGEON_WEEKLY_CAP - dungeonWeekly.count);
      const active = dungeonProgress && dungeonProgress.dungeonId === GameState.zone;
      this.promptText.setText(active ? `按 F 继续副本${GameState.zone}` : `按 F 进入副本${GameState.zone}（本周剩余 ${remaining} 次）`);
      this.promptText.setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60);
      this.promptText.setVisible(true);
    } else {
      this.nearbyDungeon = false;
    }
  }
  private startDialogue(npc: NPCData): void {
    this.isInDialogue = true; this.player.setVelocity(0, 0); this.promptText.setVisible(false);
    GameState.updateQuestProgress('talk', npc.name, 1);
    // 不再拦截quest NPC，让对话自然流动，选项触发接取/完成
    let lineIndex = 0;
    const showNext = () => { if (lineIndex < npc.dialogue.length) { const line = npc.dialogue[lineIndex]; lineIndex++; this.dialogueBox.show(line, lineIndex < npc.dialogue.length ? showNext : () => { this.isInDialogue = false; }); } };
    showNext();
  }

  // ═══ Zone ═══
  private checkZoneExit(): void {
    const cfg = ZONE_CONFIGS[GameState.zone]; if (!cfg) return;
    // 站在副本传送阵上时把 F 让给副本进入逻辑，避免传送阵与区域出口位置重叠时互相抢键
    if (this.dungeonPortalPos) {
      const dpDist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.dungeonPortalPos.x, this.dungeonPortalPos.y);
      if (dpDist < 60) return;
    }
    for (const exit of cfg.exits) { const ex = exit.x * GAME_WIDTH * 3, ey = exit.y * GAME_HEIGHT * 2; const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, ex, ey); if (dist < 60) { this.promptText.setText(`按 F 前往 ${ZONE_NAMES[exit.targetZone]}`); this.promptText.setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60); this.promptText.setVisible(true); return; } }
    if (!this.canInteract) this.promptText.setVisible(false);
  }
  private transitionToZone(tz: number, tx: number, ty: number): void {
    this.isInDialogue = true; GameState.zone = tz; GameState.x = tx; GameState.y = ty; this.battleCooldown = 60;
    if (!GameState.discoveredZones.includes(tz)) GameState.discoveredZones.push(tz);
    GameState.updateQuestProgress('reach', ZONE_NAMES[tz] || '', 1);
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.enemies.forEach(e => { e.sprite.destroy(); e.label.destroy(); }); this.enemies = [];
      this.npcList.forEach(n => { n.sprite.destroy(); n.nameTag.destroy(); }); this.npcList = [];
      const stale = this.children.list.filter((c2: any) => (c2.type === 'Graphics' && [0,3,4].includes(c2.depth||-1)) || (c2.type === 'Text' && [4,6].includes(c2.depth||-1)));
      stale.forEach((c2: any) => c2.destroy());
      this.createMap(); this.createNPCs(); this.createEnemies(); this.createGatheringPoints();
      this.zoneText.setText(`${ZONE_NAMES[GameState.zone]}`);
      this.player.setPosition(tx, ty); this.isInDialogue = false; this.cameras.main.fadeIn(400,0,0,0); SaveManager.save();
      const b = this.add.text(GAME_WIDTH/2, GAME_HEIGHT/2-40, ZONE_NAMES[tz], {fontSize:'28px',color:'#ffe8b0',fontStyle:'bold',backgroundColor:'#000000aa',padding:{x:24,y:12}}).setOrigin(0.5).setScrollFactor(0).setDepth(250).setAlpha(0);
      this.tweens.add({targets:b,alpha:1,duration:500,onComplete:()=>{this.tweens.add({targets:b,alpha:0,duration:1200,delay:1000,onComplete:()=>b.destroy()});}});
    });
  }

  // ═══ Enemies ═══
  private checkEnemyCollision(): void {
    if (this.battleCooldown > 0 || this.isInDialogue) return;
    for (const en of this.enemies) {
      if (en.dead) continue;
      if (en.data.hp <= 0) continue;
      // 联机：怪物被他人锁定/已死→跳过（不可抢怪、不可打已死的）
      if (this.gameRoom && !this.isMonsterAvailable(en.id)) continue;
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, en.sprite.x, en.sprite.y) < 31) {
        // 联机：进入战斗即锁定该怪，对其余玩家消失（防抢怪/卡刷新时间）
        if (this.gameRoom) { this.gameRoom.send('enterBattle', { id: en.id }); this.setBattling(true); }
        this.battleCooldown = 180;
        this.scene.pause();
        if (this.gameRoom) {
          // 联机：进权威战斗房间（单人独占该怪，根除双杀双掉落）；真实怪数据传给服务端结算
          this.scene.launch('MultiBattleScene', { mode: 'map', enemyData: en.data, enemyParty: this.buildEncounterParty(en.data), monsterId: en.id, playerName: GameState.playerName || '勇者', loadout: this.buildBattleLoadout() });
        } else {
          // 离线兜底：本地战斗
          this.scene.launch('BattleScene', { template: en.data, enemyRef: en, zone: GameState.zone });
        }
        return;
      }
    }
  }

  /** 联机：怪物在服务端是否可打（无记录=默认可用）。 */
  private isMonsterAvailable(id: string): boolean {
    const m = this.gameRoom?.state?.monsters?.get(id);
    return !m || m.state === 'available';
  }
  onBattleEnd(result: string, er: any): void {
    this.input.keyboard!.resetKeys(); this.physics.resume(); this.menuPauseDepth = 0;
    if (result === 'defeat') {
      this.player.x = 400; this.player.y = 500;
      GameState.hp = GameState.maxHp; GameState.mp = GameState.maxMp;
      // 联机：失败=怪物立即复原（对所有人可见），玩家回城
      if (this.gameRoom) this.gameRoom.send('unlockMonster', { id: er.id });
      return;
    }
    const a = Phaser.Math.Angle.Between(er.sprite.x, er.sprite.y, this.player.x, this.player.y);
    this.player.x += Math.cos(a) * 80; this.player.y += Math.sin(a) * 80;
    if (result === 'victory') {
      const ib = er.data.type === '妖将' || er.data.type === '妖王';
      // 战斗奖励
      const expGain = er.data.expReward || 0;
      const goldGain = er.data.goldReward || 0;
      const leveled = GameState.gainExp(expGain);
      GameState.gold += goldGain;
      // 图鉴记录
      GameState.recordKill(er.data.name);
      // 任务进度
      GameState.updateQuestProgress('kill', er.data.name);
      // 掉落
      const loot = generateLoot(er.data.type, GameState.zone);
      const lootNames: string[] = [];
      for (const drop of loot) { Inventory.addItem(drop as any); lootNames.push(drop.name); }
      // 显示战斗结果通知
      let msg = `经验+${expGain}  金币+${goldGain}`;
      if (lootNames.length > 0) msg += `\n掉落: ${lootNames.join(', ')}`;
      if (leveled) msg += `\n★ 升级！Lv.${GameState.level}`;
      const notif = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 80, msg, {
        fontSize: '16px', color: '#88ff88', fontStyle: 'bold',
        backgroundColor: '#112211cc', padding: { x: 20, y: 10 },
      }).setOrigin(0.5).setScrollFactor(0).setDepth(300);
      this.tweens.add({ targets: notif, alpha: 0, y: GAME_HEIGHT / 2 - 120, duration: 2500, onComplete: () => notif.destroy() });
      this.scene.get('UIScene').events.emit('updateStats');

      // 隐藏怪物（联机/单机通用），复活由服务端(联机)或本地计时(单机)驱动
      this.removeMonster(er);
      if (this.gameRoom) {
        // 联机：通知服务端本怪物被击杀，按刷新时长从战斗结束计时后重新出现（共享怪物·玩家间争夺）
        this.gameRoom.send('killMonster', { id: er.id, respawnMs: this.monsterRespawnMs(er) });
      } else {
        // 单机：本地重生
        if (er.respawnTimer) er.respawnTimer.destroy();
        const d = ib ? 7200000 : er.data.type === '恶妖' ? 300000 : 30000;
        er.respawnTimer = this.time.delayedCall(d, () => this.restoreMonster(er));
      }
    }
  }

  /** 联机权威战斗（地图怪）结束桥接：MultiBattleScene 在 victory/defeat 时调用，复用单机奖励逻辑并回写怪物状态机。 */
  /**
   * 联机权威战斗（地图怪）结束桥接：MultiBattleScene 在 victory/defeat 时调用。
   * 奖励来自服务端权威世界（gold/exp/loot/bestiary 由 BattleRoom 写入，经 worldSync 到账），
   * reward 仅用于战斗报告显示；本地不再重复发放，杜绝与服务端双写。
   */
  onMultiBattleEnd(result: string, monsterId: string, enemyData: any, reward?: { exp: number; gold: number; loot: string[]; leveled: boolean }): void {
    if (result === 'defeat' || result === 'fled') {
      // 失败/逃脱：回城 + 怪物立即复原（对所有人可见）
      this.player.x = 400; this.player.y = 500;
      GameState.hp = GameState.maxHp; GameState.mp = GameState.maxMp;
      if (this.gameRoom) this.gameRoom.send('unlockMonster', { id: monsterId });
      this.pendingBattleReport = { exp: 0, gold: 0, loot: [], leveled: false, defeat: result === 'defeat', fled: result === 'fled' };
      return;
    }
    if (result === 'victory') {
      const en = this.enemies.find(e => e.id === monsterId);
      const data: EnemyData = enemyData;
      const ib = data.type === '妖将' || data.type === '妖王';
      // 任务进度（客户端活动任务 UI 跟踪，不影响服务端权威）
      GameState.updateQuestProgress('kill', data.name);
      if (en) this.removeMonster(en);
      if (this.gameRoom) {
        // 联机：通知服务端本怪物被击杀，按刷新时长从战斗结束计时后重新出现（共享怪物·玩家间争夺）
        this.gameRoom.send('killMonster', { id: monsterId, respawnMs: this.monsterRespawnMs({ data }) });
      } else if (en) {
        if (en.respawnTimer) en.respawnTimer.destroy();
        const d = ib ? 7200000 : data.type === '恶妖' ? 300000 : 30000;
        en.respawnTimer = this.time.delayedCall(d, () => this.restoreMonster(en));
      }
      // 奖励数据来自服务端下发（gold/exp/loot/bestiary 已由 worldSync 写入 GameState）
      const expGain = reward?.exp ?? 0;
      const goldGain = reward?.gold ?? 0;
      const lootNames = reward?.loot ?? [];
      const leveled = reward?.leveled ?? false;
      this.pendingBattleReport = { exp: expGain, gold: goldGain, loot: lootNames, leveled, defeat: false };
      this.scene.get('UIScene').events.emit('updateStats');
    }
  }

  /** 场景 RESUME 时弹出权威战斗奖励报告（此时战斗场景已关闭，通知可见）。 */
  private flushBattleReport(): void {
    const r = this.pendingBattleReport;
    if (!r) return;
    this.pendingBattleReport = null;
    if (r.defeat) {
      const n = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, '战斗失败，已返回', {
        fontSize: '16px', color: '#ff8866', fontStyle: 'bold', backgroundColor: '#221111cc', padding: { x: 16, y: 8 },
      }).setOrigin(0.5).setScrollFactor(0).setDepth(300);
      this.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => n.destroy() });
      return;
    }
    if (r.fled) {
      const n = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, '成功逃脱，已返回', {
        fontSize: '16px', color: '#ffdd66', fontStyle: 'bold', backgroundColor: '#222211cc', padding: { x: 16, y: 8 },
      }).setOrigin(0.5).setScrollFactor(0).setDepth(300);
      this.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => n.destroy() });
      return;
    }
    let msg = `经验+${r.exp}  金币+${r.gold}`;
    if (r.loot.length > 0) msg += `\n掉落: ${r.loot.join(', ')}`;
    if (r.leveled) msg += `\n★ 升级！Lv.${GameState.level}`;
    const n = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 80, msg, {
      fontSize: '16px', color: '#88ff88', fontStyle: 'bold', backgroundColor: '#112211cc', padding: { x: 20, y: 10 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(300);
    this.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 120, duration: 2500, onComplete: () => n.destroy() });
  }

  /** 怪物刷新时长（ms）：Boss 2h / 恶妖 5min / 其余 30s。 */
  private monsterRespawnMs(er: { data: EnemyData }): number {
    const isBoss = er.data.type === '妖将' || er.data.type === '妖王';
    return isBoss ? 7200000 : er.data.type === '恶妖' ? 300000 : 30000;
  }

  /** 隐藏一只地图怪物（不再碰撞），幂等。保持原位与 idle 动画，便于刷新时原位恢复。 */
  private removeMonster(en: { sprite: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text; dead?: boolean; respawnTimer?: Phaser.Time.TimerEvent }): void {
    if (en.dead) return;
    en.dead = true;
    en.sprite.setVisible(false);
    en.label.setVisible(false);
    if (en.respawnTimer) { en.respawnTimer.destroy(); en.respawnTimer = undefined; }
  }

  /** 恢复一只被隐藏的地图怪物（刷新/复原），幂等。重置 HP 并重新显示。 */
  private restoreMonster(en: { sprite: Phaser.GameObjects.Sprite; data: EnemyData; label: Phaser.GameObjects.Text; dead?: boolean }): void {
    if (!en.dead) return;
    en.dead = false;
    en.data.hp = en.data.maxHp;
    en.sprite.setVisible(true);
    en.label.setVisible(true);
  }

  /** 每帧按服务端怪物状态机同步本地显示：busy/dead→隐藏；available 且本地已隐藏→恢复。 */
  private pruneSharedMonsters(): void {
    if (!this.gameRoom) return;
    const ms = this.gameRoom.state.monsters;
    if (!ms) return;
    for (const en of this.enemies) {
      const m = ms.get(en.id);
      if (!m || m.state === 'available') {
        if (en.dead) this.restoreMonster(en);
      } else if (!en.dead) {
        this.removeMonster(en);
      }
    }
  }

  // ════════════════ Map / World ════════════════

  private createMap(): void {
    const cfg = ZONE_CONFIGS[GameState.zone] || ZONE_CONFIGS[1];
    const mapW = GAME_WIDTH * 3, mapH = GAME_HEIGHT * 2;
    const g = this.add.graphics().setDepth(0);
    g.fillStyle(cfg.groundColor, 1);
    g.fillRect(0, 0, mapW, mapH);

    // Roads
    g.fillStyle(cfg.roadColor, 1);
    g.fillRect(0, mapH * 0.45, mapW, 60);
    g.fillRect(mapW * 0.48, 0, 60, mapH);

    // Decorations
    for (const dec of cfg.decorations) {
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

    // Trees
    g.fillStyle(cfg.treeColor, 1);
    for (let i = 0; i < 40; i++) {
      const tx = Phaser.Math.Between(50, mapW - 50), ty = Phaser.Math.Between(50, mapH - 50);
      g.fillCircle(tx, ty, 16);
      g.fillStyle(0x553311, 1);
      g.fillRect(tx - 2, ty + 12, 4, 16);
      g.fillStyle(cfg.treeColor, 1);
    }

    // Zone exit portals
    for (const exit of cfg.exits) {
      const ex = exit.x * mapW, ey = exit.y * mapH;
      const arrowMap: Record<string, string> = { east: '\u2192', west: '\u2190', north: '\u2191', south: '\u2193', northwest: '\u2196', northeast: '\u2197', southwest: '\u2199', southeast: '\u2198' };
      const portal = this.add.graphics();
      portal.fillStyle(0x44aaff, 0.15); portal.fillCircle(ex, ey, 35);
      portal.fillStyle(0x44aaff, 0.30); portal.fillCircle(ex, ey, 22);
      portal.lineStyle(2, 0x88ddff, 0.8); portal.strokeCircle(ex, ey, 30);
      portal.setDepth(3);
      this.tweens.add({ targets: portal, alpha: 0.35, duration: 1200, yoyo: true, repeat: -1 });
      const arrow = this.add.text(ex, ey, arrowMap[exit.edge] || '\u2192', { fontSize: '22px', color: '#88ddff', fontStyle: 'bold', padding: { x: 4, y: 2 } }).setOrigin(0.5).setDepth(4);
      this.tweens.add({ targets: arrow, alpha: 0.4, duration: 1000, yoyo: true, repeat: -1 });
    }

    // 副本传送阵（每区域一个入口，进入独立副本实例）
    const dp = getDungeonPortal(GameState.zone);
    const dx = dp.x * mapW, dy = dp.y * mapH;
    this.dungeonPortalPos = { x: dx, y: dy };
    const portal = this.add.graphics();
    portal.fillStyle(0xaa66ff, 0.15); portal.fillCircle(dx, dy, 38);
    portal.fillStyle(0xaa66ff, 0.32); portal.fillCircle(dx, dy, 24);
    portal.lineStyle(2, 0xcc99ff, 0.9); portal.strokeCircle(dx, dy, 32);
    portal.setDepth(3);
    this.tweens.add({ targets: portal, alpha: 0.35, duration: 1100, yoyo: true, repeat: -1 });
    const tag = this.add.text(dx, dy - 46, '\u25C6 副本' + GameState.zone, { fontSize: '12px', color: '#d9b3ff', fontStyle: 'bold', backgroundColor: '#221133cc', padding: { x: 5, y: 2 } }).setOrigin(0.5).setDepth(6);
    this.tweens.add({ targets: tag, y: dy - 52, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  private createNPCs(): void {
    const cfg = ZONE_CONFIGS[GameState.zone] || ZONE_CONFIGS[1];
    for (const c of cfg.npcs) {
      const nx = c.x * GAME_WIDTH * 3, ny = c.y * GAME_HEIGHT * 2;
      const npc = this.physics.add.sprite(nx, ny, 'npc').setImmovable(true).setDepth(5);
      const tag = this.add.text(nx, ny - 30, c.name, {
        fontSize: '11px',
        color: c.role === 'merchant' ? '#ffdd88' : c.role === 'return_point' ? '#88ccff' : c.role === 'craft' ? '#aa88ff' : c.role === 'enhance' ? '#ff8844' : c.role === 'quest_board' ? '#ffcc66' : '#ffe8b0',
        backgroundColor: '#00000088', padding: { x: 4, y: 2 },
      }).setOrigin(0.5).setDepth(6);
      this.tweens.add({ targets: npc, scaleY: 1.03, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

      const dialogueLines: DialogueLine[] = c.dialogue.map((d, i) => {
        const line: DialogueLine = { speaker: d.speaker, text: d.text };
        if (d.choices && i === 0) {
          line.choices = d.choices.map(ch => ({
            text: ch.text,
            callback: () => {
              if (ch.callback === 'openShop') this.openShopPanel(c.shop || []);
              else if (ch.callback === 'acceptQuest') this.acceptQuestFromNPC(c.name);
              else if (ch.callback === 'completeQuest') this.completeQuestFromNPC(c.name);
              else if (ch.callback === 'closeDialogue') this.isInDialogue = false;
              else if (ch.callback === 'openReturn') this.openReturn();
              else if (ch.callback === 'openCraft') this.openCraft();
              else if (ch.callback === 'openQuestBoard') { this.isInDialogue = false; renderQuestBoardPanel(this); }
              else if (ch.callback === 'openEnhance') { this.isInDialogue = false; toggleEnhancePanel(this); }
              else { this.isInDialogue = false; }
            },
          }));
        }
        return line;
      });

      // 动态添加任务选项
      const questChoices: Array<{ text: string; callback: () => void }> = [];
      // 检查是否有可接取的主线任务
      for (const questId of MAIN_QUEST_ORDER) {
        const quest = MAIN_QUESTS[questId];
        if (!quest || quest.acceptFrom !== c.name) continue;
        if (GameState.questCompleted.includes(questId)) continue;
        if (GameState.isQuestActive(questId)) continue;
        if (quest.prerequisite && !GameState.questCompleted.includes(quest.prerequisite)) continue;
        questChoices.push({ text: `接受任务：${quest.name}`, callback: () => this.acceptQuestFromNPC(c.name) });
        break;
      }
      // 检查是否有可完成的任务（本NPC completeAt 且已就绪）
      const readyId = GameState.activeQuests.find(id => {
        const q = GameState.getQuestDef(id);
        return !!q && q.completeAt === c.name && GameState.isQuestReady(id);
      });
      if (readyId) {
        const q = GameState.getQuestDef(readyId)!;
        questChoices.push({ text: `完成任务：${q.name}`, callback: () => this.completeQuestFromNPC(c.name) });
      } else {
        // 任务进行中，在对话文本中显示进度
        const activeId = GameState.activeQuests.find(id => {
          const q = GameState.getQuestDef(id);
          return !!q && q.completeAt === c.name;
        });
        if (activeId && dialogueLines.length > 0) {
          dialogueLines[0].text += `\n\n任务进度：${GameState.getQuestTrackFor(activeId)}`;
        }
      }
      // 检查支线任务
      for (const sq of Object.values(SIDE_QUESTS)) {
        if (sq.acceptFrom !== c.name) continue;
        if (GameState.questCompleted.includes(sq.id)) continue;
        if (GameState.isQuestActive(sq.id)) continue;
        if (sq.prerequisite && !GameState.questCompleted.includes(sq.prerequisite)) continue;
        questChoices.push({ text: `接受支线：${sq.name}`, callback: () => this.acceptQuestFromNPC(c.name) });
        break;
      }
      // 如果有任务选项，添加到第一行对话
      if (questChoices.length > 0 && dialogueLines.length > 0) {
        if (!dialogueLines[0].choices) dialogueLines[0].choices = [];
        dialogueLines[0].choices!.push(...questChoices);
        dialogueLines[0].choices!.push({ text: '离开', callback: () => { this.isInDialogue = false; } });
      }

      this.npcList.push({ sprite: npc, name: c.name, role: c.role, dialogue: dialogueLines, nameTag: tag, x: nx, y: ny, shop: c.shop });
    }
  }

  private createEnemies(): void {
    const cfg = ZONE_CONFIGS[GameState.zone] || ZONE_CONFIGS[1];
    const occupied: { x: number; y: number }[] = this.npcList.map(n => ({ x: n.x, y: n.y }));
    cfg.enemies.forEach((e, idx) => {
      const normX = Math.min(0.95, Math.max(0.05, e.x > 1.0 ? e.x / 3.0 : e.x));
      const normY = Math.min(0.95, Math.max(0.05, e.y > 1.0 ? e.y / 2.0 : e.y));
      let ex = normX * GAME_WIDTH * 3, ey = normY * GAME_HEIGHT * 2;
      for (const o of occupied) { const dx = ex - o.x, dy = ey - o.y; if (Math.sqrt(dx * dx + dy * dy) < 80) { ex += Phaser.Math.Between(60, 120) * (Math.random() > 0.5 ? 1 : -1); ey += Phaser.Math.Between(60, 100) * (Math.random() > 0.5 ? 1 : -1); break; } }
      occupied.push({ x: ex, y: ey });
      const data = getEnemyData(e.name, e.type, e.element, GameState.zone);
      const isBoss = e.isBoss === true || e.type === '\u5996\u5c06' || e.type === '\u5996\u738b';
      const sprite = this.physics.add.sprite(ex, ey, isBoss ? 'enemy_boss' : 'enemy').setDepth(5);
      if (isBoss) { sprite.setScale(1.6).setTint(0xffcc44); this.tweens.add({ targets: sprite, scaleX: 1.65, scaleY: 1.55, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }); }
      else { const mapW = GAME_WIDTH * 3, mapH = GAME_HEIGHT * 2; const px2 = Phaser.Math.Clamp(ex + Phaser.Math.Between(-60, 60), 30, mapW - 30); const py2 = Phaser.Math.Clamp(ey + Phaser.Math.Between(-50, 50), 30, mapH - 30); this.tweens.add({ targets: sprite, x: px2, y: py2, duration: Phaser.Math.Between(2000, 4000), yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }); }
      const label = this.add.text(ex, ey - sprite.height / 2 - 10, isBoss ? '\u3010BOSS\u3011' + e.name : e.name, { fontSize: '11px', color: isBoss ? '#ffcc44' : e.type === '\u6076\u5996' ? '#ff8866' : '#aaaabb', fontStyle: isBoss ? 'bold' : 'normal', backgroundColor: '#00000088', padding: { x: 4, y: 2 } }).setOrigin(0.5).setDepth(6);
      const id = `${GameState.zone}:${idx}`;
      this.enemies.push({ sprite, data, label, id });
    });
  }

  private createGatheringPoints(): void {
    this.gatherPoints = [];
    const cfg = ZONE_CONFIGS[GameState.zone] || ZONE_CONFIGS[1];
    for (const pt of cfg.gathering) {
      const gx = pt.x * GAME_WIDTH * 3, gy = pt.y * GAME_HEIGHT * 2;
      const colors: Record<string, number> = { '\u77ff\u8109': 0x886644, '\u836f\u8349': 0x44aa44, '\u7075\u6728': 0x668844, '\u7075\u8109': 0x8844cc };
      const sprite = this.physics.add.sprite(gx, gy, 'gather').setDepth(2);
      sprite.setTint(colors[pt.type] || 0x88aa88);
      const label = this.add.text(gx, gy - 20, pt.type, { fontSize: '10px', color: '#aaddaa', backgroundColor: '#00000066', padding: { x: 3, y: 1 } }).setOrigin(0.5).setDepth(3);
      this.tweens.add({ targets: sprite, alpha: 0.6, duration: 1500, yoyo: true, repeat: -1 });
      this.gatherPoints.push({ sprite, type: pt.type, label });
    }
  }

  private updateMiniMap(): void {
    this.miniMap.clear();
    const mmX = GAME_WIDTH - 180, mmY = 8, mmW = 170, mmH = 110;
    this.miniMap.fillStyle(0x111122, 0.7);
    this.miniMap.fillRoundedRect(mmX, mmY, mmW, mmH, 4);
    this.miniMap.lineStyle(1, 0x444466, 1);
    this.miniMap.strokeRoundedRect(mmX, mmY, mmW, mmH, 4);
    const sx = mmW / (GAME_WIDTH * 3), sy = mmH / (GAME_HEIGHT * 2);
    const cfg = ZONE_CONFIGS[GameState.zone];
    if (cfg) {
      for (const exit of cfg.exits) {
        const dotX = mmX + exit.x * mmW, dotY = mmY + exit.y * mmH;
        const flash = Math.sin(this.time.now / 300) * 0.3 + 0.7;
        this.miniMap.fillStyle(0x44aaff, flash * 0.3); this.miniMap.fillCircle(dotX, dotY, 6);
        this.miniMap.fillStyle(0x88ddff, flash); this.miniMap.fillCircle(dotX, dotY, 3);
        this.miniMap.lineStyle(1, 0xffffff, 0.8); this.miniMap.strokeCircle(dotX, dotY, 4);
      }
      // 副本传送阵光标（紫色菱形，便于在右上角小地图定位）
      const dp = getDungeonPortal(GameState.zone);
      const ddx = mmX + dp.x * mmW, ddy = mmY + dp.y * mmH;
      const dflash = Math.sin(this.time.now / 250) * 0.3 + 0.7;
      this.miniMap.fillStyle(0xaa66ff, dflash * 0.4); this.miniMap.fillCircle(ddx, ddy, 7);
      this.miniMap.fillStyle(0xcc99ff, dflash); this.miniMap.fillCircle(ddx, ddy, 3.5);
      this.miniMap.lineStyle(1, 0xffffff, 0.8); this.miniMap.strokeCircle(ddx, ddy, 5);
    }
    this.miniMap.fillStyle(0x44aaff, 1);
    this.miniMap.fillCircle(mmX + this.player.x * sx, mmY + this.player.y * sy, 3);
    this.npcList.forEach(npc => {
      const ndx = mmX + npc.x * sx, ndy = mmY + npc.y * sy;
      const color = npc.role === 'merchant' ? 0xffdd44 : npc.role === 'return_point' ? 0x88ccff : npc.role === 'craft' ? 0xaa88ff : npc.role === 'enhance' ? 0xff8844 : npc.role === 'quest_board' ? 0xffcc44 : 0x44cc44;
      this.miniMap.fillStyle(color, 0.8); this.miniMap.fillCircle(ndx, ndy, 2);
    });
  }
  /** 通过NPC对话选项接取任务 */
  private acceptQuestFromNPC(npcName: string): void {
    for (const questId of MAIN_QUEST_ORDER) {
      const quest = MAIN_QUESTS[questId];
      if (!quest || quest.acceptFrom !== npcName) continue;
      if (GameState.questCompleted.includes(questId)) { this.isInDialogue = false; return; }
      if (GameState.isQuestActive(questId)) { this.isInDialogue = false; return; }
      if (quest.prerequisite && !GameState.questCompleted.includes(quest.prerequisite)) { this.isInDialogue = false; return; }
      GameState.acceptQuest(quest);
      this.dialogueBox.show({ speaker: npcName, text: `已接取任务：${quest.name}\n${quest.desc}` }, () => { this.isInDialogue = false; });
      return;
    }
    // 检查支线
    for (const quest of Object.values(SIDE_QUESTS)) {
      if (quest.acceptFrom !== npcName) continue;
      if (GameState.questCompleted.includes(quest.id)) { this.isInDialogue = false; return; }
      if (GameState.isQuestActive(quest.id)) { this.isInDialogue = false; return; }
      if (quest.prerequisite && !GameState.questCompleted.includes(quest.prerequisite)) { this.isInDialogue = false; return; }
      GameState.acceptQuest(quest);
      this.dialogueBox.show({ speaker: npcName, text: `已接取支线：${quest.name}\n${quest.desc}` }, () => { this.isInDialogue = false; });
      return;
    }
    this.isInDialogue = false;
  }

  /** 通过NPC对话选项完成任务 */
  private completeQuestFromNPC(npcName: string): void {
    // 找本NPC处已就绪的活动任务
    const readyId = GameState.activeQuests.find(id => {
      const q = GameState.getQuestDef(id);
      return !!q && q.completeAt === npcName && GameState.isQuestReady(id);
    });
    if (!readyId) {
      const activeId = GameState.activeQuests.find(id => {
        const q = GameState.getQuestDef(id);
        return !!q && q.completeAt === npcName;
      });
      if (activeId) {
        this.dialogueBox.show({ speaker: npcName, text: `任务还未完成。\n${GameState.getQuestTrackFor(activeId)}` }, () => { this.isInDialogue = false; });
      } else {
        this.isInDialogue = false;
      }
      return;
    }
    const q = GameState.getQuestDef(readyId)!;
    GameState.completeActiveQuest(readyId);
    if (this.gameRoom) {
      // 联机：奖励由服务端权威发放（worldSync 到账），反馈由 intentResult 显示
      requestClaimQuest(q.id);
      this.dialogueBox.show({ speaker: npcName, text: `任务完成：${q.name}\n奖励将稍后到账` }, () => { this.isInDialogue = false; this.tryAutoStartNextQuest(); });
      return;
    }
    // 单机：本地发放奖励
    let msg = `任务完成：${q.name}`;
    if (q.rewards.gold) { GameState.gold += q.rewards.gold; msg += `\n金币+${q.rewards.gold}`; }
    if (q.rewards.exp) { const lv = GameState.gainExp(q.rewards.exp); msg += `\n经验+${q.rewards.exp}`; if (lv) msg += `\n★升级！Lv.${GameState.level}`; }
    if (q.rewards.items) { for (const it of q.rewards.items) { Inventory.addItem({ id: it.id, name: it.name, type: 'consumable' as any, desc: '', quantity: it.count }); msg += `\n${it.name}×${it.count}`; } }
    if (q.rewards.unlock) { GameState.addUnlock(q.rewards.unlock); msg += `\n解锁：${q.rewards.unlock}`; }
    this.scene.get('UIScene').events.emit('updateStats');
    if (q.id === 'shikai_trial' && !GameState.hasShikai) {
      this.dialogueBox.show({ speaker: npcName, text: msg + '\n\n你的斩魄刀已经觉醒了！选择它的真名吧。' }, () => { this.isInDialogue = false; showShikaiSelection(this); });
    } else {
      this.dialogueBox.show({ speaker: npcName, text: msg }, () => { this.isInDialogue = false; this.tryAutoStartNextQuest(); });
    }
  }

  private startIntroDialogue(): void {
    this.isInDialogue = true;
    this.dialogueBox.show({ speaker: '???', text: '你能看见我吗？那就说明你拥有死神的力量。告诉我，你的名字。' }, () => {
      this.isInDialogue = false; showNamingInput(this);
    });
  }

  


  


  


  public tryAutoStartNextQuest(): void {
    if (GameState.hasActiveMainQuest()) return; // 已有活跃主线（日常/周常不影响自动接取链）
    for (const questId of MAIN_QUEST_ORDER) {
      if (GameState.questCompleted.includes(questId)) continue;
      const quest = MAIN_QUESTS[questId];
      if (!quest) continue;
      if (quest.prerequisite && !GameState.questCompleted.includes(quest.prerequisite)) continue;
      // 自动接取（不需要NPC对话的任务）
      if (!quest.acceptFrom) {
        GameState.acceptQuest(quest);
      }
      break;
    }
  }
  

  private openReturn(): void { this.isInDialogue = false; this.pauseForMenu(); const cam = this.cameras.main; const panel = this.add.container(Math.round(cam.scrollX) + GAME_WIDTH / 2, Math.round(cam.scrollY) + GAME_HEIGHT / 2).setDepth(310); const bg = this.add.graphics(); bg.fillStyle(0x1a1a2e, 0.97); bg.fillRoundedRect(-300, -150, 600, 300, 12); bg.lineStyle(2, 0xc9a96e, 0.7); bg.strokeRoundedRect(-300, -150, 600, 300, 12); panel.add(bg); panel.add(this.add.text(0, -110, '传送', { fontSize: '22px', color: '#c9a96e', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5)); GameState.discoveredZones.forEach((z, i2) => { const rz = ZONE_NAMES[z] || '???'; const btn = this.add.text(-200 + (i2 % 3) * 200, -60 + Math.floor(i2 / 3) * 50, rz, { fontSize: '14px', color: '#88ccff', padding: { x: 12, y: 6 }, backgroundColor: '#11224488' }).setInteractive({ useHandCursor: true }); btn.on('pointerover', () => btn.setColor('#aaddff')); btn.on('pointerout', () => btn.setColor('#88ccff')); btn.on('pointerdown', () => { panel.destroy(true); this.resumeFromMenu(); const tcfg = ZONE_CONFIGS[z] || ZONE_CONFIGS[1]; const rp = tcfg.npcs.find((n: any) => n.role === 'return_point'); const tx = (rp ? rp.x : 0.5) * GAME_WIDTH * 3; const ty = (rp ? rp.y : 0.5) * GAME_HEIGHT * 2; this.transitionToZone(z, tx, ty); }); panel.add(btn); }); const cl4 = this.add.text(280, -130, '✕', { fontSize: '22px', color: '#ff6666', padding: { x: 8, y: 4 } }).setOrigin(0.5).setInteractive({ useHandCursor: true }); cl4.on('pointerover', () => cl4.setColor('#ffaaaa')); cl4.on('pointerout', () => cl4.setColor('#ff6666')); cl4.on('pointerdown', () => { panel.destroy(true); this.resumeFromMenu(); }); panel.add(cl4); }
  private openCraft(): void { this.isInDialogue = false; this.pauseForMenu(); const cam = this.cameras.main; const panel = this.add.container(Math.round(cam.scrollX) + GAME_WIDTH / 2, Math.round(cam.scrollY) + GAME_HEIGHT / 2).setDepth(310); const bg = this.add.graphics(); bg.fillStyle(0x1a1a2e, 0.97); bg.fillRoundedRect(-350, -200, 700, 400, 12); bg.lineStyle(2, 0xc9a96e, 0.7); bg.strokeRoundedRect(-350, -200, 700, 400, 12); panel.add(bg); panel.add(this.add.text(0, -160, '制造', { fontSize: '22px', color: '#c9a96e', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5)); panel.add(this.add.text(0, -120, '收集材料来制造装备', { fontSize: '14px', color: '#888899', padding: { y: 2 } }).setOrigin(0.5)); const recipes = [{ name: '铁剑', cost: { '\u94c1\u77ff\u77f3': 3, '\u7075\u6728\u679d': 1 } }, { name: '铁甲', cost: { '\u94c1\u77ff\u77f3': 5, '\u9ebb\u5e03\u7247': 2 } }, { name: '铁手甲', cost: { '\u94c1\u77ff\u77f3': 2, '\u7075\u6728\u679d': 1 } }]; recipes.forEach((r, i2) => { const ry = -70 + i2 * 60; panel.add(this.add.text(-300, ry, r.name, { fontSize: '16px', color: '#ddddff', fontStyle: 'bold', padding: { y: 2 } })); const costs = Object.entries(r.cost).map(([k, v]) => { const owned = Inventory.items.find(i2 => i2.name === k)?.quantity || 0; return `${k}: ${owned}/${v}`; }).join('  '); panel.add(this.add.text(-100, ry + 4, costs, { fontSize: '11px', color: '#8888aa', padding: { y: 1 } })); const canCraft = Object.entries(r.cost).every(([k, v]) => (Inventory.items.find(i2 => i2.name === k)?.quantity || 0) >= v); const btn2 = this.add.text(200, ry - 2, '[制造]', { fontSize: '14px', color: canCraft ? '#44cc44' : '#666666', fontStyle: 'bold', padding: { x: 10, y: 6 }, backgroundColor: canCraft ? '#11221188' : '#11111188' }).setInteractive({ useHandCursor: true }); if (canCraft) { btn2.on('pointerover', () => btn2.setColor('#88ff88')); btn2.on('pointerout', () => btn2.setColor('#44cc44')); btn2.on('pointerdown', () => {
  if (this.gameRoom) {
    // 联机：制造走服务端权威（扣材料/产装备），成功由 worldSync 刷新背包，结果由 intentResult 提示
    if (!requestCraft(r.name)) return;
    GameState.updateQuestProgress('craft', r.name, 1);
    panel.destroy(true); this.openCraft(); return;
  }
  Object.entries(r.cost).forEach(([k, v]) => { const it = Inventory.items.find(i2 => i2.name === k); if (it) it.quantity = Math.max(0, (it.quantity || 0) - v); });
  Inventory.addItem({ id: r.name, name: r.name, type: 'equipment', desc: '手工制造', quantity: 1, slot: 'weapon' as any, stats: { atk: 5 }, quality: 'green' });
  GameState.updateQuestProgress('craft', r.name, 1);
  panel.destroy(true); this.resumeFromMenu(); this.scene.get('UIScene').events.emit('updateStats');
  const cn = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, `制造成功：${r.name}`, { fontSize: '16px', color: '#88ff88', fontStyle: 'bold', backgroundColor: '#112211cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400);
  this.tweens.add({ targets: cn, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => cn.destroy() });
}); } panel.add(btn2); }); const cl5 = this.add.text(330, -180, '✕', { fontSize: '22px', color: '#ff6666', padding: { x: 8, y: 4 } }).setOrigin(0.5).setInteractive({ useHandCursor: true }); cl5.on('pointerover', () => cl5.setColor('#ffaaaa')); cl5.on('pointerout', () => cl5.setColor('#ff6666')); cl5.on('pointerdown', () => { panel.destroy(true); this.resumeFromMenu(); }); panel.add(cl5); }
  // TODO(待实现): 铁匠剧情 — 设计文档规划未实现，此为对话回调入口桩，保留以防入口丢失
  

  

  


  

  

  


  


  


  

  public enhanceTab: number = 0;
  


  


  // ═══ Quest Log ═══
  public questLogPanel: Phaser.GameObjects.Container | null = null;

  


  


  // ═══ Bestiary ═══

  // ════════════════ 联机：共享地图房间 ════════════════
  private connectGameRoom(): void {
    if (this.gameRoom) return;
    setDisconnectNotifier((msg: string) => this.showWorldNotif(msg, false));
    getClient().joinOrCreate('game', {
      name: GameState.playerName || '玩家',
      title: GameState.getActiveTitleDef()?.name ?? '',
    })
      .then((room: any) => {
        this.gameRoom = room;
        this.mySessionId = room.sessionId;
        setActiveRoom(room);
        // 进房即上报一次当前坐标，让其他客户端立刻看到自己
        room.send('move', { x: Math.round(this.player.x), y: Math.round(this.player.y) });
        room.onStateChange(() => this.syncRemotePlayers());
        // 权威世界状态同步：服务端单一真相源，全量 reconcile 进本地缓存
        room.onMessage('worldSync', (pw: any) => applyWorldSync(this, pw));
        // 意图回执：即时反馈（获得/购买/强化结果等）
        room.onMessage('intentResult', (res: any) => this.onIntentResult(res));
        // 共享怪物隐藏/恢复由每帧 pruneSharedMonsters 依据服务端状态机同步，无需 onAdd 钩子。
        room.onLeave(() => { this.clearRemotePlayers(); setActiveRoom(null); });
        // 服务端 broadcast('system', ...) 的系统提示（进入地图等），客户端暂无需特殊处理，注册空处理器消除告警。
        room.onMessage('system', () => {});
        room.onError((code: number, msg: string) => console.warn('[game] 房间错误', code, msg));
      })
      .catch((e: any) => console.warn('[game] 联机房间连接失败，单机模式继续', e));
  }

  /** 意图回执提示（服务端权威操作结果）。 */
  private onIntentResult(res: any): void {
    if (!res) return;
    this.showWorldNotif(res.msg || (res.ok ? '操作成功' : '操作失败'), !!res.ok);
  }

  /** 通用世界提示（断连封锁/意图结果）。 */
  public showWorldNotif(msg: string, ok: boolean): void {
    const n = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, msg, {
      fontSize: '16px', color: ok ? '#88ff88' : '#ff6666', fontStyle: 'bold',
      backgroundColor: '#112211cc', padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(400);
    this.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => n.destroy() });
  }

  /** 称号解锁播报（worldSync 后 evaluateTitleUnlocks 触发）。 */
  public showTitleUnlockNotif(titles: string[]): void {
    const n = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 100, '解锁称号：' + titles.join('、'), {
      fontSize: '16px', color: '#ffd9a0', fontStyle: 'bold',
      backgroundColor: '#221a11cc', padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(400);
    this.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 130, duration: 2500, onComplete: () => n.destroy() });
  }

  /** 刷新当前打开的面板（worldSync 实时同步背包/金币/装备）。 */
  public refreshOpenPanels(): void {
    if (this.inventoryPanel) { closeInventory(this); renderInventoryPanel(this); }
    if (this.statPanel) { closeStatPanel(this); renderStatPanel(this); }
    if (this.enhancePanel) { closeEnhancePanel(this); toggleEnhancePanel(this); }
    if (this.shopPanel && this.lastShopItems) { openShop(this, this.lastShopItems); }
  }

  /** 打开商店并记录数据，便于 worldSync 后自动重渲染。 */
  public openShopPanel(shop: any[]): void {
    this.lastShopItems = shop;
    openShop(this, shop);
  }

  /** 装备/卸下称号时，把最新称号广播给同房间的其他玩家（实时同步）。 */
  broadcastTitle(): void {
    if (this.gameRoom) {
      this.gameRoom.send('setTitle', { title: GameState.getActiveTitleDef()?.name ?? '' });
    }
  }

  /** 按服务端状态维护其他玩家（跳过自己）。名字+称号每帧刷新，位置由 update() 平滑插值。 */
  private syncRemotePlayers(): void {
    if (!this.gameRoom) return;
    const state = this.gameRoom.state;
    if (!state || !state.players) return;
    const players = state.players as Map<string, any>;
    players.forEach((p: any, sid: string) => {
      if (sid === this.mySessionId) return;
      let rp = this.remotePlayers.get(sid);
      if (!rp) {
        const sprite = this.add.sprite(p.x, p.y, 'player').setDepth(8).setAlpha(0.9);
        sprite.setTint(Phaser.Display.Color.HexStringToColor(p.color || '#ffffff').color);
        const tag = this.add.text(p.x, p.y - 46, '', {
          fontSize: '13px', color: '#ffffff', fontStyle: 'bold',
          stroke: '#000000', strokeThickness: 3,
          backgroundColor: '#00000066', padding: { x: 5, y: 2 },
          align: 'center',
        }).setOrigin(0.5, 1).setDepth(50);
        rp = { sprite, tag, tx: p.x, ty: p.y, name: '', title: '' };
        this.remotePlayers.set(sid, rp);
      }
      rp.tx = p.x; rp.ty = p.y;                 // 目标坐标（避免每帧硬跳）
      rp.name = p.name || '玩家';
      rp.title = p.title || '';
      const battling = p.battling ? '（战斗中）' : '';
      // 称号 + 名字；双行显示，称号为空则只显示名字。战斗中追加「（战斗中）」标签，便于玩家间识别状态（组队前置）
      const txt = rp.title ? `【${rp.title}】\n${rp.name}${battling}` : `${rp.name}${battling}`;
      if (rp.tag.text !== txt) rp.tag.setText(txt);
    });
    for (const [sid, rp] of this.remotePlayers) {
      if (!players.has(sid)) { rp.sprite.destroy(); rp.tag.destroy(); this.remotePlayers.delete(sid); }
    }
  }

  private clearRemotePlayers(): void {
    this.remotePlayers.forEach((rp) => { rp.sprite.destroy(); rp.tag.destroy(); });
    this.remotePlayers.clear();
  }

  /** 联机：上报自己是否处于战斗中（供远端名牌显示「战斗中」标签）。 */
  private setBattling(v: boolean): void {
    if (this.gameRoom) this.gameRoom.send('setBattling', { v });
  }

  /** 节流上报移动（~10Hz，仅在确实移动时发）。 */
  private sendMoveThrottled(): void {
    if (!this.gameRoom) return;
    const now = this.time.now;
    const dx = this.player.x - this.lastSent.x;
    const dy = this.player.y - this.lastSent.y;
    if (now - this.lastSent.t >= 100 && dx * dx + dy * dy > 4) {
      this.gameRoom.send('move', { x: Math.round(this.player.x), y: Math.round(this.player.y) });
      this.lastSent = { x: this.player.x, y: this.player.y, t: now };
    }
  }

  /** 进入联机权威战斗（暂停当前地图，启动 MultiBattleScene）。 */
  private launchMultiBattle(): void {
    this.battleCooldown = 120;
    if (this.gameRoom) this.setBattling(true);
    // V键组队：无指定怪，用当前区域虚怪组成小队（与单机 randomEnemyCount 同款）
    const dummy: EnemyData = createEnemyData('虚', '杂妖', '火', GameState.zone);
    this.scene.launch('MultiBattleScene', { playerName: GameState.playerName || '勇者', loadout: this.buildBattleLoadout(), enemyParty: this.buildEncounterParty(dummy) });
    this.scene.pause();
  }

  /** 进入副本：停止当前地图，切换到独立副本地图场景（镜像地图方案，无 overlay 嵌套）。 */
  private enterDungeon(zone: number): void {
    this.inDungeon = true;
    this.promptText.setVisible(false);
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      // 关键修复（bug1/bug2 根因）：暂停而非停止 GameScene，保留联机连接与 sessionId 稳定，
      // 服务端权威世界（金币/经验/背包/等级）不被清空，副本奖励与升级才会同步回主场景。
      // 若用 scene.stop 会触发 SHUTDOWN → gameRoom.leave() → 服务端 world.remove(sessionId)
      // 清空玩家整个权威世界，出副本后奖励/等级全部丢失。
      this.scene.pause('GameScene');
      this.scene.start('DungeonMapScene', { dungeonId: zone, fromZone: zone });
    });
  }

  /** 兼容保留（DungeonMapScene 通过 scene.start('GameScene') 直接返回，不经此方法）。 */
  public exitDungeon(): void {
    this.inDungeon = false;
    this.nearbyDungeon = false;
  }

  /** 组装联机权威战斗的可用技能/鬼道/道具清单，传给战斗房间做权威校验。 */
  private buildBattleLoadout() {
    return {
      skills: getAvailableSkills(GameState.zanpakuto, GameState.element, GameState.hasShikai, GameState.hasBankai, false, false, false).map((s) => s.name),
      kidos: Kido.getActiveLearned(),
      items: Inventory.items.filter((i) => i.type === 'consumable'),
      // 玩家真实战斗属性（recalcStats 结果），用于服务端权威结算，根除硬编码 BASE_PLAYER 导致的数值崩坏
      playerStats: {
        hp: GameState.hp, maxHp: GameState.maxHp,
        mp: GameState.mp, maxMp: GameState.maxMp,
        atk: GameState.atk, def: GameState.def,
        matk: GameState.matk, mdef: GameState.mdef,
        spd: GameState.spd,
      },
    };
  }

  /**
   * 组装本场敌人阵容（与单机 BattleScene 同款规则）：
   *  - Boss（妖将/妖王）：[Boss本体] + 配置中的随从 retinue（4~7 只）
   *  - 小怪：按区域 randomEnemyCount 生成一组（每只独立满血）
   * 仅客户端计算一次，整组传给服务端权威 spawn（服务端不重复依赖 BossMechanics）。
   */
  private buildEncounterParty(ed: EnemyData): EnemyData[] {
    const isBoss = ed.type === '妖将' || ed.type === '妖王';
    if (isBoss) {
      const boss = { ...ed };
      const cfg = BOSS_CONFIG[ed.name];
      const adds: EnemyData[] = [];
      if (cfg?.retinue) {
        for (const r of cfg.retinue) adds.push(createEnemyData(r.name, r.type, r.element, cfg.zone));
      }
      return [boss, ...adds];
    }
    // 小怪：按单机 randomEnemyCount(zone) 生成一组
    const zone = ed.zone;
    let min = 1, max = 2;
    if (zone <= 3) { min = 1; max = 2; }
    else if (zone <= 6) { min = 1; max = 4; }
    else if (zone <= 9) { min = 2; max = 6; }
    else if (zone <= 12) { min = 3; max = 7; }
    else if (zone <= 15) { min = 4; max = 8; }
    else if (zone <= 18) { min = 5; max = 8; }
    else { min = 6; max = 8; }
    const n = min + Math.floor(Math.random() * (max - min + 1));
    const party: EnemyData[] = [];
    for (let i = 0; i < n; i++) party.push({ ...ed, hp: ed.maxHp, maxHp: ed.maxHp });
    return party;
  }
  

  

  

  

}
