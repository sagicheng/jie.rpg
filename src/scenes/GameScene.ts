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
import { makeSetId } from '../systems/SetSystem';
import { MAIN_QUESTS, MAIN_QUEST_ORDER, SIDE_QUESTS } from '../systems/QuestData';
import { Kido, KIDO_NODES, KidoSchool } from '../systems/Kido';
import { getAvailableSkills, ZANPAKUTO_ELEMENT } from '../systems/Skills';
import { BOSS_CONFIG } from '../systems/BossMechanics';
import { openShop, openMall, toggleInventory, closeInventory, toggleStatPanel, closeStatPanel, renderInventoryPanel, renderStatPanel, showKidoPanel, closeKidoPanel, toggleEnhancePanel, closeEnhancePanel, toggleQuestLog, toggleBestiaryPanel, closeBestiaryPanel, renderQuestBoardPanel, showNamingInput, showShikaiSelection, closeTitlePanel, toggleTitlePanel, openArenaPanel, closeArenaPanel, renderArenaPanel, setArenaStatus, setArenaMatching, renderGuildPanel, renderFriendPanel, renderAuctionPanel, openAuctionPanel, closeAuctionPanel, toggleAuctionPanel, refreshAuctionPanel, openPetPanel, closePetPanel } from '../ui/panels';
import { GuildClient } from '../systems/GuildClient';
import { applyGuildStatBonus } from '../systems/GuildSkills';
import { getClient } from '../net/Net';

/** 统一聊天频道配色与前缀 */
const CHAT_COLORS: Record<string, string> = {
  all: '#cdd6e8', world: '#cdd6e8', guild: '#9fe6a0', team: '#9fc6ff', whisper: '#e6b3ff', system: '#ffd27f', event: '#ff8f8f',
};
const CHAT_PREFIX: Record<string, string> = {
  world: '[世界] ', guild: '[公会] ', team: '[队伍] ', system: '[系统] ', event: '[活动] ',
};
import { applyWorldSync, setActiveRoom, setDisconnectNotifier, requestGather, requestBuy, requestEquip, requestUnequip, requestCraft, requestEnhance, requestRefine, requestDecompose, requestRefineReset, requestClaimQuest, requestUnlock, isOnline, requestDevGrantSet, requestPetGrantDev, dungeonProgress, dungeonWeekly, DUNGEON_WEEKLY_CAP } from '../systems/WorldClient';
import { createPetLocal, petElementInfo, petQualityInfo } from '../systems/PetSystem';

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
  public authToken = '';
  public characterId = 0;
  private remotePlayers: Map<string, { sprite: Phaser.GameObjects.Sprite; tag: Phaser.GameObjects.Text; tx: number; ty: number; name: string; title: string }> = new Map();
  // 队伍状态（多人组队·Stage D+）
  private teamId = '';
  private teamMembers: Array<{ sid: string; name: string }> = [];
  private teamLeaderSid = '';
  private teamPanel: Phaser.GameObjects.Container | null = null;
  // 独立组队面板（G 键开关 / HUD 点开）：含成员操作 + 逐条处理的邀请队列
  private teamPanelFull: Phaser.GameObjects.Container | null = null;
  private pendingInvites: Array<{ fromName: string; fromSid: string; teamId: string }> = [];
  private teamPanelInviteOpen = false;
  private dungeonConfirmOpen = false;
  private dungeonConfirmPanel: Phaser.GameObjects.Container | null = null;
  // 公会面板（J 键开关）
  public guildPanel: Phaser.GameObjects.Container | null = null;
  // 好友面板（O 键开关）
  public friendPanel: Phaser.GameObjects.Container | null = null;
  // 拍卖行面板（P 键开关）
  public auctionPanel: Phaser.GameObjects.Container | null = null;
  public petPanel: Phaser.GameObjects.Container | null = null;
  // 全局聊天 HUD（底部常驻，统一多频道）
  public chatHud: Phaser.GameObjects.Container | null = null;
  public chatHudLines: Phaser.GameObjects.Container | null = null;
  public chatInputEl: HTMLInputElement | null = null;
  public chatInputFocused = false;
  public chatChannel = 'world';
  /** 当前私聊目标角色 ID（好友面板"私聊"按钮或 /w 设定，submitChat 复用）。 */
  private whisperTargetCharId = 0;
  private chatChannelText: Phaser.GameObjects.Text | null = null;
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
  public mallPanel: Phaser.GameObjects.Container | null = null;
  public arenaPanel: Phaser.GameObjects.Container | null = null;
  private lastShopItems: any[] = [];
  /** 旧档迁移：已始解但未存刀名，仅提示一次重选以恢复技能。 */
  private shikaiReselectDone = false;
  public namingPanelActive = false;

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data?: { newGame?: boolean; name?: string; element?: string; authToken?: string; characterId?: number; characterName?: string; characterElement?: string }): void {
    this.authToken = data?.authToken || '';
    this.characterId = data?.characterId || 0;

    if (data?.newGame) {
      GameState.reset();
      GameState.x = 400;
      GameState.y = 500;
      GameState.zone = 1;
      GameState.newGame = true;
      // 恢复建角信息（来自服务端返回或 TitleScene 传入）
      const chName = data.characterName || data.name || '';
      const chElement = data.characterElement || data.element || '';
      if (chName) {
        GameState.playerName = chName;
        if (chElement) GameState.element = chElement;
        GameState.hasCreated = true;
      }
      Inventory.addItem({ id: 'stop_blood_grass', name: '止血草', type: 'consumable', desc: '回复50HP', quantity: 5 });
      Inventory.addItem({ id: 'medicine_pill_s', name: '伤药(小)', type: 'consumable', desc: '回复150HP', quantity: 3 });
      Inventory.addItem({ id: 'spirit_water_s', name: '灵力水(小)', type: 'consumable', desc: '回复30MP', quantity: 3 });
      Inventory.addItem({ id: 'antidote', name: '解毒药', type: 'consumable', desc: '解除中毒·寄生·灼烧', quantity: 2 });
    } else if (this.authToken && this.characterId) {
      // Stage D：服务端加载角色，不以客户端 localStorage 为准
      GameState.reset();
      GameState.x = 400;
      GameState.y = 500;
      GameState.zone = 1;
      GameState.newGame = false;
      // 角色名/元素不在 worldSync 数据中（存在 DB characters 表），需从 TitleScene 传入
      const chName = data?.characterName || data?.name || '';
      const chElement = data?.characterElement || data?.element || '';
      if (chName) {
        GameState.playerName = chName;
        if (chElement) GameState.element = chElement;
        GameState.hasCreated = true;
      }
      // worldSync 会在连房后覆盖本地背包/金币/等级等缓存
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
      if (this.teamPanelFull) { this.closeTeamPanel(); return; }
      if (this.dungeonConfirmOpen) { this.closeDungeonConfirm(); return; }
      if (this.inventoryPanel) { closeInventory(this); return; }
      if (this.statPanel) { closeStatPanel(this); return; }
      if (this.kidoPanel) { closeKidoPanel(this); return; }
      if (this.enhancePanel) { closeEnhancePanel(this); return; }
      if (this.titlePanel) { closeTitlePanel(this); return; }
      if (this.bestiaryPanel) { closeBestiaryPanel(this); return; }
      if (this.questLogPanel) { this.questLogPanel.destroy(true); this.questLogPanel = null; this.resumeFromMenu(); return; }
      if (this.auctionPanel) { closeAuctionPanel(this); return; }
      if (this.petPanel) { closePetPanel(this); return; }
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

    // 鼠标点击移动（组队非队长禁止）
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isInDialogue || this.statPanel || this.inventoryPanel || this.kidoPanel || this.enhancePanel || this.bestiaryPanel || this.questLogPanel || this.namingPanelActive || this.shopPanel || this.mallPanel || this.guildPanel || this.friendPanel || this.auctionPanel) return;
      if (this.teamPanelFull || this.dungeonConfirmOpen) return; // 模态界面打开时不移动
      if (this.teamId && this.teamLeaderSid !== this.mySessionId) return; // 非队长不移
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
    // Dev cheats：改用 window 级 keydown 监听（不依赖画布焦点），
    // 并对 Ctrl/Meta 组合键 preventDefault，避免被浏览器默认快捷键（书签/保存/全选等）拦截。
    this.ctrlKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL);
    const showDevNotif = (msg: string, color = '#88ff88') => {
      const n = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, msg, {
        fontSize: '18px', color, fontStyle: 'bold',
        backgroundColor: '#112211cc', padding: { x: 16, y: 8 },
      }).setOrigin(0.5).setScrollFactor(0).setDepth(300);
      this.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 80, duration: 1500, onComplete: () => n.destroy() });
    };
    const onDevKey = (e: KeyboardEvent) => {
      // 正在输入框（如命名）时不触发，避免误触
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
      if (!e.ctrlKey && !e.metaKey) return;
      const k = e.key.toLowerCase();
      switch (k) {
        case 'a':
          GameState.allocatedATK += 50; GameState.allocatedMATK += 50;
          GameState.recalcStats(); GameState.hp = GameState.maxHp; GameState.mp = GameState.maxMp;
          showDevNotif(`ATK+50 MATK+50 (ATK:${GameState.atk} MATK:${GameState.matk})`, '#ff6644');
          this.scene.get('UIScene').events.emit('updateStats');
          break;
        case 's':
          GameState.statPoints += 10; this.scene.get('UIScene').events.emit('updateStats'); showDevNotif('属性点+10', '#44ccff');
          break;
        case 'd':
          GameState.gold += 10000; showDevNotif('金币+10000', '#ffcc44');
          break;
        case 'f':
          GameState.hp = GameState.maxHp; GameState.mp = GameState.maxMp; showDevNotif('HP/MP全满', '#88ff88');
          break;
        case 'g':
          GameState.exp += expForLevel(GameState.level + 1); GameState.checkLevelUp(); showDevNotif('经验+1级', '#ccaaff'); this.scene.get('UIScene').events.emit('updateStats');
          break;
        case 'h':
          for (const name of Object.keys(NAMED_ENEMIES)) { for (let i = 0; i < 100; i++) GameState.recordKill(name); }
          showDevNotif('全图鉴解锁(击杀x100)', '#ffcc44');
          break;
        case 'j':
          GameState.recordKill('大虚·亚丘卡斯'); showDevNotif('Boss击杀+1', '#ff4444');
          break;
        case 'z':
          if (GameState.hasShikai) showDevNotif('始解已解锁（再选刀可更换真名）', '#ffcc44');
          showShikaiSelection(this);
          break;
        case 'e': {
          // Dev 作弊键：发放同区域同品质测试套装，免掉落 RNG 凑齐，便于验证套装加成
          const zone = GameState.zone;
          const quality = 'blue';
          const setId = makeSetId(zone, quality);
          const armorSlots = ['head', 'body', 'bracer', 'boots', 'belt'];
          const jewelSlots = ['ring', 'necklace', 'charm', 'pendant'];
          const names: Record<string, string> = { head: '头盔', body: '铠甲', bracer: '护腕', boots: '靴子', belt: '腰带', ring: '戒指', necklace: '项链', charm: '护符', pendant: '挂饰' };
          const build = (slot: string, stats: Record<string, number>) => ({
            id: `devset_${setId}_${slot}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
            name: `测试·${names[slot] ?? slot}`, type: 'equipment' as const, desc: `测试套装·第${zone}区·${quality}`,
            quantity: 1, slot: slot as any, stats, quality, set: setId,
          });
          if (isOnline()) {
            requestDevGrantSet(zone, quality);
            showDevNotif(`已申请测试套装·第${zone}区·${quality}`, '#ff88ff');
          } else {
            [...armorSlots, ...jewelSlots].forEach((slot) => {
              const stats: Record<string, number> = armorSlots.includes(slot) ? { def: 30, hp: 30 } : { matk: 25, mp: 25 };
              const piece = build(slot, stats);
              const eq = Inventory.equipment as any;
              const old = eq[slot];
              if (old) Inventory.items.push(old);
              eq[slot] = piece;
            });
            GameState.recalcStats();
            this.scene.get('UIScene').events.emit('updateStats');
            this.refreshOpenPanels?.();
            showDevNotif(`测试套装已装备·第${zone}区·${quality}`, '#ff88ff');
          }
          break;
        }
        case 'y':
          // Dev 作弊键：发放一只随机灵宠
          if (isOnline()) {
            // 联机：服务端权威发放并 worldSync 下发 + 落库（重连不丢）
            requestPetGrantDev();
            showDevNotif('已申请发放灵宠（随机物种）', '#aaffcc');
          } else {
            // 离线/单机：本地造宠（镜像服务端 createPet，不落库），与其他 Dev 键（Ctrl+E 等）离线行为一致
            if (!Array.isArray(GameState.pets)) GameState.pets = [];
            if (GameState.pets.length >= 6) {
              showDevNotif('灵宠栏已满（上限 6）', '#ff8888');
              break;
            }
            const pet = createPetLocal(GameState.zone);
            if (!pet) { showDevNotif('灵宠栏已满（上限 6）', '#ff8888'); break; }
            if (GameState.pets.length === 0) pet.active = true; // 首只自动出战
            GameState.pets.push(pet);
            GameState.recalcStats();
            this.refreshOpenPanels?.();
            const el = petElementInfo(pet.element).label;
            const q = petQualityInfo(pet.quality).label;
            showDevNotif(`灵宠已发放（离线）：${pet.name}（${el}·${q}）`, '#aaffcc');
          }
          break;
        default:
          return; // 非调试键不拦截（Ctrl+C/V/X 等保持原行为）
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onDevKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.removeEventListener('keydown', onDevKey));
    this.events.once(Phaser.Scenes.Events.DESTROY, () => window.removeEventListener('keydown', onDevKey));

    // 单独 G 键：开关独立组队面板（与 CTRL+G dev 升级区分）
    this.input.keyboard!.addKey('G').on('down', () => {
      if (this.ctrlKey.isDown) return;
      if (this.isInDialogue || this.inDungeon || this.scene.isActive('MultiBattleScene') || this.scene.isActive('DungeonMapScene')) return;
      if (this.dungeonConfirmOpen) return; // 确认框优先
      this.toggleTeamPanel();
    });

    // J 键：开关公会面板
    this.input.keyboard!.addKey('J').on('down', () => {
      if (this.ctrlKey.isDown) return;
      if (this.isInDialogue || this.inDungeon || this.scene.isActive('MultiBattleScene') || this.scene.isActive('DungeonMapScene')) return;
      if (this.dungeonConfirmOpen || this.teamPanelFull || this.questLogPanel || this.petPanel) return;
      if (this.inventoryPanel || this.statPanel) return;
      this.toggleGuildPanel();
    });

    // O 键：开关好友面板（K 已让给鬼道技能界面，避免冲突）
    this.input.keyboard!.addKey('O').on('down', () => {
      if (this.ctrlKey.isDown) return;
      if (this.isInDialogue || this.inDungeon || this.scene.isActive('MultiBattleScene') || this.scene.isActive('DungeonMapScene')) return;
      if (this.dungeonConfirmOpen || this.teamPanelFull || this.questLogPanel || this.petPanel) return;
      if (this.inventoryPanel || this.statPanel) return;
      this.toggleFriendPanel();
    });

    // P 键：开关拍卖行面板（一口价交易 + 收藏/历史）
    this.input.keyboard!.addKey('P').on('down', () => {
      if (this.ctrlKey.isDown) return;
      if (this.isInDialogue || this.inDungeon || this.scene.isActive('MultiBattleScene') || this.scene.isActive('DungeonMapScene')) return;
      if (this.dungeonConfirmOpen || this.teamPanelFull || this.questLogPanel || this.petPanel) return;
      if (this.inventoryPanel || this.statPanel || this.kidoPanel || this.enhancePanel || this.bestiaryPanel || this.guildPanel || this.friendPanel || this.petPanel) return;
      this.toggleAuctionPanel();
    });

    // U 键：开关灵宠面板
    this.input.keyboard!.addKey('U').on('down', () => {
      if (this.ctrlKey.isDown) return;
      if (this.isInDialogue || this.inDungeon || this.scene.isActive('MultiBattleScene') || this.scene.isActive('DungeonMapScene')) return;
      if (this.dungeonConfirmOpen || this.teamPanelFull || this.questLogPanel || this.petPanel) return;
      if (this.inventoryPanel || this.statPanel || this.kidoPanel || this.enhancePanel || this.bestiaryPanel || this.guildPanel || this.friendPanel || this.auctionPanel) return;
      this.togglePetPanel();
    });

    // Enter 键：聚焦全局聊天输入框（模态/战斗/副本中不抢占）
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER).on('down', () => {
      if (this.isInDialogue || this.inDungeon || this.scene.isActive('MultiBattleScene') || this.scene.isActive('DungeonMapScene')) return;
      if (this.dungeonConfirmOpen || this.teamPanelFull || this.questLogPanel || this.guildPanel || this.inventoryPanel || this.statPanel) return;
      if (!this.chatInputFocused) this.focusChatInput();
    });

    // 全局聊天 HUD（底部常驻）
    this.createChatHud();

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
    if (this.chatInputFocused) { this.player.setVelocity(0, 0); return; }
    const speed = this.ctrlKey.isDown ? 500 : 160;
    let vx = 0, vy = 0;
    // 组队非队长：禁止本地移动，位置由服务端强制同步到队长
    const isTeamNonLeader = !!(this.teamId && this.teamLeaderSid !== this.mySessionId);

    if (this.moveTarget && !isTeamNonLeader) {
      const dx = this.moveTarget.x - this.player.x, dy = this.moveTarget.y - this.player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 8) { this.moveTarget = null; }
      else { vx = (dx / dist) * speed; vy = (dy / dist) * speed; }
    } else if (!isTeamNonLeader) {
      if (this.cursors.left.isDown || this.keys.A.isDown) vx = -1;
      else if (this.cursors.right.isDown || this.keys.D.isDown) vx = 1;
      if (this.cursors.up.isDown || this.keys.W.isDown) vy = -1;
      else if (this.cursors.down.isDown || this.keys.S.isDown) vy = 1;
      if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }
      vx *= speed; vy *= speed;
    }
    this.player.setVelocity(vx, vy);

    // 组队非队长：服务端权威位置覆盖本地物理，视觉上紧跟队长
    if (isTeamNonLeader && this.gameRoom) {
      const meState = this.gameRoom.state?.players?.get(this.mySessionId);
      if (meState) {
        this.player.setPosition(meState.x, meState.y);
        this.player.setVelocity(0, 0);
      }
    }
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

  public pauseForMenu(): void {
    this.menuPauseDepth++;
    if (this.menuPauseDepth === 1) { this.physics.pause(); this.setGameUIVisible(false); }
  }
  public resumeFromMenu(): void {
    this.menuPauseDepth = Math.max(0, this.menuPauseDepth - 1);
    if (this.menuPauseDepth === 0) { this.physics.resume(); this.setGameUIVisible(true); }
  }

  /** 开/关全屏面板时隐藏聊天 HUD 与任务追踪，避免遮挡面板内容（如 C 界面）。 */
  private setGameUIVisible(v: boolean): void {
    if (this.chatHud) this.chatHud.setVisible(v);
    if (this.chatInputEl) this.chatInputEl.style.display = v ? '' : 'none';
    if (this.chatTabBar) this.chatTabBar.style.display = v ? '' : 'none';
    const ui = this.scene.get('UIScene') as any;
    if (ui && typeof ui.setQuestTrackerVisible === 'function') ui.setQuestTrackerVisible(v);
  }

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
    if (this.dungeonConfirmOpen) return; // 确认框已开，避免重复弹
    // NPC 对话优先
    if (this.canInteract && this.currentNPC) { this.startDialogue(this.currentNPC); return; }
    // 副本传送阵：F 弹出确认界面（进入副本 / 暂不进入），不再直接进
    if (this.nearbyDungeon && !this.inDungeon) { this.showDungeonConfirm(GameState.zone); return; }
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
      this.promptText.setText(active ? `按 F 继续副本${GameState.zone}（第 ${dungeonProgress!.stage} 阶）` : `按 F 进入副本${GameState.zone}（本周剩余 ${remaining} 次）`);
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
          this.scene.launch('MultiBattleScene', { mode: 'map', enemyData: en.data, enemyParty: this.buildEncounterParty(en.data), monsterId: en.id, playerName: GameState.playerName || '勇者', loadout: this.buildBattleLoadout(), ownerSessionId: this.mySessionId });
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
    this.input.keyboard!.resetKeys(); this.physics.resume(); this.menuPauseDepth = 0; this.setGameUIVisible(true);
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
      // 队内被拉玩家（enterTeamBattle）不一定有 enemyData，安全回退
      if (enemyData && enemyData.name) {
        const ib = enemyData.type === '妖将' || enemyData.type === '妖王';
        GameState.updateQuestProgress('kill', enemyData.name);
        if (this.gameRoom) {
          this.gameRoom.send('killMonster', { id: monsterId, respawnMs: this.monsterRespawnMs({ data: enemyData }) });
        } else if (en) {
          if (en.respawnTimer) en.respawnTimer.destroy();
          const d = ib ? 7200000 : enemyData.type === '恶妖' ? 300000 : 30000;
          en.respawnTimer = this.time.delayedCall(d, () => this.restoreMonster(en));
        }
      }
      if (en) this.removeMonster(en);
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
      if (q.rewards.unlock) requestUnlock(q.rewards.unlock);
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
    if (!requestCraft(r.name, GameState.zone)) return;
    GameState.updateQuestProgress('craft', r.name, 1);
    panel.destroy(true); this.openCraft(); return;
  }
  Object.entries(r.cost).forEach(([k, v]) => { const it = Inventory.items.find(i2 => i2.name === k); if (it) it.quantity = Math.max(0, (it.quantity || 0) - v); });
  Inventory.addItem({ id: r.name, name: r.name, type: 'equipment', desc: '手工制造', quantity: 1, slot: 'weapon' as any, stats: { atk: 5 }, quality: 'green', set: makeSetId(GameState.zone, 'green') });
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
      token: this.authToken,
      characterId: this.characterId,
    })
      .then((room: any) => {
        this.gameRoom = room;
        this.mySessionId = room.sessionId;
        setActiveRoom(room);
        room.send('move', { x: Math.round(this.player.x), y: Math.round(this.player.y) });
        room.onStateChange(() => this.syncRemotePlayers());

        // 权威世界状态同步
        room.onMessage('worldSync', (pw: any) => {
          applyWorldSync(this, pw);
          // 旧档迁移：已始解但服务端未存斩魄刀真名 -> 引导重新选择以恢复始解/卍解技能（仅一次）
          if (!this.shikaiReselectDone && GameState.hasShikai && !GameState.zanpakuto) {
            this.shikaiReselectDone = true;
            this.time.delayedCall(500, () => showShikaiSelection(this));
          }
        });

        // Stage D：认证失败
        room.onMessage('authError', (msg: string) => {
          this.showWorldNotif(msg || '认证失败，返回标题画面', false);
          this.time.delayedCall(2000, () => {
            room.leave();
            this.scene.start('TitleScene');
          });
        });

        room.onMessage('intentResult', (res: any) => this.onIntentResult(res));
        room.onLeave(() => { this.clearRemotePlayers(); setActiveRoom(null); });
        // 统一聊天（多频道：world/guild/team/whisper/system/event）
        room.onMessage('chat', (m: { channel: string; fromName: string; fromCharId: number; text: string; ts: number }) => this.onChat(m));
        // 好友实时通知（申请/接受/拒绝/移除/上下线）——定向推送，客户端无法伪造
        room.onMessage('friendNotify', (m: any) => {
          const name = (m.name || m.fromName || '好友') as string;
          const cid: number = m.charId != null ? m.charId : (m.fromCharId != null ? m.fromCharId : -1);
          switch (m.type) {
            case 'request':
              this.showWorldNotif(`${name} 申请加你为好友`, true);
              if (this.friendPanel) this.refreshFriendPanel();
              break;
            case 'accepted':
              this.showWorldNotif(`${name} 已接受你的好友申请`, true);
              if (this.friendPanel) this.refreshFriendPanel();
              break;
            case 'declined':
              this.showWorldNotif(`${name} 拒绝了你的好友申请`, false);
              break;
            case 'removed':
              this.showWorldNotif(`${name} 将你从好友列表移除了`, false);
              if (this.friendPanel) this.refreshFriendPanel();
              break;
            case 'online':
              if (cid >= 0) GameState.friendOnline[cid] = true;
              this.showWorldNotif(`${name} 上线了`, true);
              if (this.friendPanel) this.refreshFriendPanel();
              break;
            case 'offline':
              if (cid >= 0) GameState.friendOnline[cid] = false;
              this.showWorldNotif(`${name} 下线了`, false);
              if (this.friendPanel) this.refreshFriendPanel();
              break;
          }
        });

        // 拍卖行数据（列表/我的挂单/收藏/历史经 intent 请求后由服务端下发，客户端缓存并渲染/重渲染）
        room.onMessage('auctionData', (m: any) => {
          GameState.auctionData = m;
          if (this.auctionPanel) refreshAuctionPanel(this);
        });

        // 进房后拉取公会归属（供聊天发送/面板首屏/战斗加成）
        GuildClient.info(this.authToken, this.characterId).then((r: any) => {
          if (r && r.ok && r.inGuild) {
            GameState.guildId = r.guild.id; GameState.guildName = r.guild.name; GameState.guildRank = r.myRank;
            // 公会成长数据（v2）
            GameState.guildLevel = r.guild.level || 1;
            GameState.guildExp = r.guild.exp || 0;
            GameState.guildExpCap = r.guild.expCap || 0;
            GameState.guildContribution = r.guild.contribution || 0;
            GameState.guildMyContribution = r.myContribution || 0;
            GameState.guildSkills = r.guild.skills || {};
          } else {
            GameState.guildId = null; GameState.guildName = ''; GameState.guildRank = '';
            GameState.guildLevel = 1; GameState.guildExp = 0; GameState.guildExpCap = 0;
            GameState.guildContribution = 0; GameState.guildMyContribution = 0; GameState.guildSkills = {};
          }
        }).catch(() => { GameState.guildId = null; });

        // ═════ 组队消息 ————

        // 收到邀请：入列（支持多人同时邀请逐条处理），并自动打开组队面板处理
        room.onMessage('inviteReceived', (data: { fromName: string; fromSid: string; teamId: string }) => {
          this.addPendingInvite(data);
          this.openTeamPanel();
        });

        // 队伍状态更新
        room.onMessage('teamUpdate', (data: { id: string; leaderSid: string; members: Array<{ sid: string; name: string }> }) => {
          this.teamId = data.id;
          this.teamLeaderSid = data.leaderSid;
          this.teamMembers = data.members;
          this.renderTeamPanel();
          if (this.teamPanelFull) this.openTeamPanel(); // 面板开着则实时刷新
        });

        // 全队进入战斗
        room.onMessage('enterTeamBattle', (data: { monsterId: string }) => {
          this.launchTeamBattle(data.monsterId);
        });
        // 副本内：队长开战 → 队员（DungeonMapScene）被拉进同一 battle room 共斗
        room.onMessage('enterTeamDungeonBattle', (data: { dungeonId: number; stage: number }) => {
        this.routeTeamDungeonBattle(data);
      });
      // 队长战斗返回 → 队员（副本或地图场景）同步退出战斗场景
      room.onMessage('teamExitBattleEnd', () => {
        this.routeTeamBattleEnd();
      });
      // 队长进入下一阶镜像地图 / 返回主世界 → 队员同步重建地图 / 退出副本
      room.onMessage('teamDungeonStage', (data: { stage: number }) => {
        this.routeTeamDungeonStage(data.stage);
      });
      room.onMessage('teamExitDungeon', () => {
        this.routeTeamExitDungeon();
      });

      // 队长进副本 → 队员跟随进入（仅当自身未在副本/未在战斗）
        room.onMessage('enterTeamDungeon', (data: { dungeonId: number }) => {
          if (this.inDungeon) return;
          if (this.scene.isActive('MultiBattleScene') || this.scene.isActive('DungeonMapScene')) return;
          this.enterDungeon(data.dungeonId, true);
        });

        // 被踢出
        room.onMessage('teamKicked', () => {
          this.teamId = '';
          this.teamMembers = [];
          this.teamLeaderSid = '';
          this.pendingInvites = [];
          this.hideTeamPanel();
          this.closeTeamPanel();
          this.showWorldNotif('你被移出了队伍', false);
        });

        // 队伍解散
        room.onMessage('teamDisbanded', () => {
          this.teamId = '';
          this.teamMembers = [];
          this.teamLeaderSid = '';
          this.pendingInvites = [];
          this.hideTeamPanel();
          this.closeTeamPanel();
          this.showWorldNotif('队伍已解散', false);
        });

        // 队伍错误提示
        room.onMessage('teamError', (msg: string) => {
          this.showWorldNotif(msg, false);
        });

        // ═══ PVP 竞技场消息 ═══
        // 匹配成功：服务端已创建 PvpRoom 并通过 arenaService 下发房间号
        room.onMessage('arenaMatch', (data: { roomId: string; mode: string; team: string; token: string }) => {
          this.enterPvpBattle(data);
        });
        // 匹配超时（60s 未凑齐真人）：取消并提示
        room.onMessage('arenaQueueTimeout', () => {
          setArenaMatching(false);
          this.showWorldNotif('匹配超时：未凑齐对手，已取消（绝不 AI 替代）', false);
        });
        // 竞技场权威状态（面板展示用）
        room.onMessage('arenaStatus', (s: any) => {
          setArenaStatus(s);
          // 用缓存重渲染面板，不再调用 openArenaPanel（避免重新请求→服务端回 arenaStatus→再渲染的死循环）
          if (this.arenaPanel) renderArenaPanel(this);
        });
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
    if (this.mallPanel) { openMall(this); }
    if (this.petPanel) { closePetPanel(this); openPetPanel(this); }
    // 好友面板不在此刷新：worldSync 联机下极频繁，每次重拉会反复闪「加载中」+ 打 REST。
    // 好友数据靠 friendNotify（上线/下线/申请/接受/拒绝/移除）实时自刷新，无需 worldSync 驱动。
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
    this.makeRemotePlayersInteractable();
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
    this.scene.launch('MultiBattleScene', { playerName: GameState.playerName || '勇者', loadout: this.buildBattleLoadout(), enemyParty: this.buildEncounterParty(dummy), ownerSessionId: this.mySessionId });
    this.scene.pause();
  }

  /** 进入副本：停止当前地图，切换到独立副本地图场景（镜像地图方案，无 overlay 嵌套）。
   *  @param fromTeam 是否由队长带队跟随进入（队员侧）：用于副本内镜像队长阶段进度。 */
  private enterDungeon(zone: number, fromTeam = false): void {
    // 客户端前置检查：本周副本次数是否已用完（防御 DungeonRoom.onJoin dungeonError 竞态丢消息）
    if (!dungeonProgress || dungeonProgress.dungeonId !== zone) {
      const remaining = Math.max(0, DUNGEON_WEEKLY_CAP - dungeonWeekly.count);
      if (remaining <= 0) {
        const notif = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, '本周副本次数已用完（共享3次）', {
          fontSize: '16px', color: '#ff8888', backgroundColor: '#221111cc', padding: { x: 12, y: 6 },
        }).setOrigin(0.5).setScrollFactor(0).setDepth(300);
        this.tweens.add({ targets: notif, alpha: 0, y: GAME_HEIGHT / 2 - 80, duration: 1800, onComplete: () => notif.destroy() });
        return;
      }
    }
    this.inDungeon = true;
    this.promptText.setVisible(false);
    // 队长（非跟随进入）进副本 → 广播全队跟随进入同一副本实例
    // 仅队长触发、仅队员收到，避免队员互拉循环；服务端 teamEnterDungeon 也已校验 leaderSid。
    if (!fromTeam && this.teamId && this.teamLeaderSid === this.mySessionId && this.teamMembers.length > 1) {
      this.gameRoom?.send('teamEnterDungeon', { dungeonId: zone });
    }
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      // 关键修复（bug1/bug2 根因）：用 launch 并行启动副本地图 + pause 自身，
      // 【绝不能】用 scene.start('DungeonMapScene') —— Phaser 的 ScenePlugin.start(key) 会先
      // queue 一个 stop 把【当前场景】(GameScene) 停掉，导致 GameScene 被 SHUTDOWN：
      //   ① cameras.main 销毁 → RESUME 复位时 this.cameras.main.fadeIn 报 undefined 卡死；
      //   ② 触发 gameRoom.leave() → 服务端 world.remove(sessionId) 清空玩家整个权威世界，
      //      副本奖励/等级全部丢失（且 GameRoom 每秒 worldSync 反向把客户端覆盖成空）。
      // 这与 launchMultiBattle 同模式：launch 并行、pause 自身，连接与权威世界始终存活，
      // 副本奖励/升级随每秒 worldSync 全量 reconcile 自动到账，出本即同步。
      this.scene.launch('DungeonMapScene', { dungeonId: zone, fromZone: zone, followEnter: fromTeam, color: this.gameRoom?.state?.players?.get(this.mySessionId)?.color || '#4ecdc4' });
      this.scene.pause();
    });
  }

  /** 兼容保留（DungeonMapScene 现通过 exitToGame → scene.resume('GameScene') 返回主场景，不经此方法）。 */
  public exitDungeon(): void {
    this.inDungeon = false;
    this.nearbyDungeon = false;
  }

  /** 组装联机权威战斗的可用技能/鬼道/道具清单，传给战斗房间做权威校验。 */
  private buildBattleLoadout() {
    // 出战灵宠：取出战中的宠，映射为战斗 DTO（属性快照 + 技能 + 宠MP），随负载下发到权威战斗房
    const allPets = (GameState.pets || []);
    const activePet = allPets.find((p: any) => p.active);
    console.log('[buildBattleLoadout] pets count=', allPets.length, 'activePet found=', !!activePet, activePet ? JSON.stringify({ name: activePet.name, hp: activePet.hp, skills: activePet.skills }) : '(none)');
    const petDto = activePet ? {
      name: activePet.name,
      speciesId: activePet.speciesId,
      element: activePet.element,
      quality: activePet.quality,
      level: activePet.level || 1,
      stats: {
        hp: activePet.hp, maxHp: activePet.maxHp,
        atk: activePet.atk, def: activePet.def,
        matk: activePet.matk, mdef: activePet.mdef, spd: activePet.spd,
      },
      // 宠MP：随等级成长的灵力池（仅用于宠物技能释放）
      maxMp: 30 + (activePet.level || 1) * 4, mp: 30 + (activePet.level || 1) * 4,
      skills: Array.isArray(activePet.skills) ? activePet.skills : [],
    } : undefined;
    return {
      skills: getAvailableSkills(GameState.zanpakuto, GameState.element, GameState.hasShikai, GameState.hasBankai, false, false, false).map((s) => s.name),
      kidos: Kido.getActiveLearned(),
      items: Inventory.items.filter((i) => i.type === 'consumable'),
      // 玩家真实战斗属性（recalcStats 结果），用于服务端权威结算，根除硬编码 BASE_PLAYER 导致的数值崩坏
      // 叠加公会技能被动加成（v2：全体成员受益）
      playerStats: applyGuildStatBonus({
        hp: GameState.hp, maxHp: GameState.maxHp,
        mp: GameState.mp, maxMp: GameState.maxMp,
        atk: GameState.atk, def: GameState.def,
        matk: GameState.matk, mdef: GameState.mdef,
        spd: GameState.spd,
      }, GameState.guildSkills),
      // 出战灵宠（v1.1 战斗协同）：undefined = 无宠
      pet: petDto,
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

  // ═══════════════════════════════════
  //  组队系统（Stage D+）
  // ═══════════════════════════════════

  // ═══════════════════════════════════
  //  组队面板（独立界面：邀请队列 / 成员操作）
  // ═══════════════════════════════════

  /** 邀请入列（支持多人同时邀请，逐条处理）。 */
  private addPendingInvite(data: { fromName: string; fromSid: string; teamId: string }): void {
    if (this.pendingInvites.some((i) => i.fromSid === data.fromSid && i.teamId === data.teamId)) return;
    this.pendingInvites.push(data);
  }
  private removePendingInvite(teamId: string, fromSid: string): void {
    this.pendingInvites = this.pendingInvites.filter((i) => !(i.teamId === teamId && i.fromSid === fromSid));
  }

  private toggleTeamPanel(): void {
    if (this.teamPanelFull) this.closeTeamPanel();
    else this.openTeamPanel();
  }
  private closeTeamPanel(): void {
    if (this.teamPanelFull) { this.teamPanelFull.destroy(true); this.teamPanelFull = null; }
  }

  // ——— 公会面板（J 键）———
  private toggleGuildPanel(): void {
    if (this.guildPanel) this.closeGuildPanel();
    else this.openGuildPanel();
  }
  public closeGuildPanel(): void {
    if (this.guildPanel) { this.guildPanel.destroy(true); this.guildPanel = null; }
    this.resumeFromMenu();
  }
  public openGuildPanel(resetTab = true): void {
    this.closeGuildPanel();
    this.pauseForMenu();
    this.guildPanel = renderGuildPanel(this, resetTab);
  }

  // ——— 好友面板（O 键）———
  private toggleFriendPanel(): void {
    if (this.friendPanel) this.closeFriendPanel();
    else this.openFriendPanel();
  }
  public closeFriendPanel(): void {
    if (this.friendPanel) { this.friendPanel.destroy(true); this.friendPanel = null; }
    this.resumeFromMenu();
  }
  public openFriendPanel(): void {
    this.closeFriendPanel();
    this.pauseForMenu();
    this.friendPanel = renderFriendPanel(this);
  }
  /** 好友面板内刷新（申请后/实时通知到达时重拉列表）。 */
  private refreshFriendPanel(): void {
    if (this.friendPanel) { this.closeFriendPanel(); this.openFriendPanel(); }
  }

  // ——— 拍卖行面板（P 键）———
  private toggleAuctionPanel(): void {
    if (this.auctionPanel) closeAuctionPanel(this);
    else openAuctionPanel(this);
  }
  public openAuctionPanel(reset = true): void {
    closeAuctionPanel(this);
    this.pauseForMenu();
    this.auctionPanel = renderAuctionPanel(this, reset);
  }
  // ——— 灵宠面板（U 键）———
  private togglePetPanel(): void {
    if (this.petPanel) closePetPanel(this);
    else openPetPanel(this);
  }
  /** 从好友面板"私聊"按钮进入：关闭面板 + 切到私聊频道 + 设定目标 + 聚焦输入框。 */
  public whisperTo(charId: number, name?: string): void {
    this.closeFriendPanel();
    this.whisperTargetCharId = charId;
    this.switchChatChannel('whisper');
    this.focusChatInput();
    if (name) this.appendChatLine('system', '系统', 0, `正在私聊 ${name}（角色ID ${charId}），直接输入内容发送`);
  }
  /** 统一聊天接收：追加到本地日志 + 按频道路由渲染（公会面板聊天区 + 全局 HUD）。 */
  public onChat(msg: { channel: string; fromName: string; fromCharId: number; text: string; ts: number }): void {
    this.appendChatLine(msg.channel, msg.fromName, msg.fromCharId, msg.text);
  }

  private appendChatLine(channel: string, fromName: string, fromCharId: number, text: string): void {
    GameState.chatLog.push({ channel, fromName, fromCharId, text, ts: Date.now() });
    if (GameState.chatLog.length > 200) GameState.chatLog.shift();
    // 全局聊天 HUD：按当前频道（或"全部"）重建可见行
    this.renderChatLines();
  }

  /** 按当前频道（或"全部"）重建聊天 HUD 可见行。 */
  private renderChatLines(): void {
    if (!this.chatHudLines) return;
    this.chatHudLines.removeAll(true);
    const ch = this.chatChannel;
    const filtered = GameState.chatLog.filter(m => ch === 'all' || m.channel === ch);
    filtered.slice(-12).forEach((m, i) => {
      const color = CHAT_COLORS[m.channel] || '#cdd6e8';
      const prefix = m.channel === 'whisper'
        ? (m.fromCharId === this.characterId ? '→[私聊] ' : '[私聊] ')
        : (CHAT_PREFIX[m.channel] || '');
      const line = this.add.text(0, i * 16, `${prefix}${m.fromName}：${m.text}`, {
        fontSize: '12px', color, wordWrap: { width: 360 }, padding: { y: 1 },
      });
      this.chatHudLines!.add(line);
    });
  }

  /** 发送统一聊天（任一频道）。 */
  public sendChat(channel: string, text: string, targetCharId = 0): void {
    const t = (text || '').trim();
    if (!t) return;
    this.gameRoom?.send('chat', { channel, text: t, targetCharId });
  }
  /** 发送公会聊天（仅同公会在线成员可见）。 */
  public sendGuildChat(text: string): void {
    this.sendChat('guild', text);
  }

  // ——— 全局聊天 HUD（底部常驻，统一多频道 + 频道标签栏）———
  private createChatHud(): void {
    if (this.chatHud) return;
    const W = this.scale.width, H = this.scale.height;
    const c = this.add.container(0, 0).setDepth(5000).setScrollFactor(0);
    this.chatHud = c;
    const boxX = 12, boxY = H - 260, boxW = 400, boxH = 200;

    // 背景框
    const bg = this.add.graphics();
    bg.fillStyle(0x0c0c18, 0.55); bg.fillRoundedRect(boxX, boxY, boxW, boxH, 8);
    bg.lineStyle(1, 0x334466, 0.5); bg.strokeRoundedRect(boxX, boxY, boxW, boxH, 8);
    c.add(bg);

    // 标题行
    c.add(this.add.text(boxX + 10, boxY + 8, '💬 聊天', { fontSize: '12px', color: '#88aacc', fontStyle: 'bold' }).setOrigin(0, 0.5));
    this.chatChannelText = this.add.text(boxX + boxW - 10, boxY + 8, '[世界]', { fontSize: '12px', color: '#aaccff' }).setOrigin(1, 0.5);
    c.add(this.chatChannelText);

    // ══ 频道标签栏（DOM 实现，免疫相机跟随导致的命中偏移）══
    const TABS: Array<{ id: string; label: string; color: string }> = [
      { id: 'all', label: '全部', color: '#cdd6e8' },
      { id: 'world', label: '世界', color: '#cdd6e8' },
      { id: 'guild', label: '公会', color: '#9fe6a0' },
      { id: 'team', label: '队伍', color: '#9fc6ff' },
      { id: 'whisper', label: '私聊', color: '#e6b3ff' },
      { id: 'system', label: '系统', color: '#ffd27f' },
    ];
    const tabStartX = boxX + 10, tabY = boxY + 28;
    const tabW = 50, tabH = 22, tabGap = 3;

    // 注入标签样式（仅一次）
    if (!document.getElementById('chat-tab-style')) {
      const st = document.createElement('style');
      st.id = 'chat-tab-style';
      st.textContent = `
        .chat-tabbar { position:absolute; display:flex; gap:3px; z-index:9998; }
        .chat-tab { font-family:sans-serif; color:#9aa; background:rgba(34,34,68,0.30); border:1px solid #334466; border-radius:4px; padding:0 5px; cursor:pointer; user-select:none; white-space:nowrap; box-sizing:border-box; }
        .chat-tab:hover { color:#fff; }
        .chat-tab.selected { color:#fff; background:#33507a; border-color:#5599cc; }
      `;
      document.head.appendChild(st);
    }
    // 标签栏 DOM 定位（随画布缩放/居中自动对齐，与输入框同源）
    const cRect = this.game.canvas.getBoundingClientRect();
    const cSx = cRect.width / W, cSy = cRect.height / H;
    const bar = document.createElement('div');
    bar.className = 'chat-tabbar';
    bar.style.left = (cRect.left + tabStartX * cSx) + 'px';
    bar.style.top = (cRect.top + tabY * cSy) + 'px';
    this.chatTabEls = [];
    TABS.forEach((tab) => {
      const el = document.createElement('div');
      el.className = 'chat-tab';
      el.textContent = tab.label;
      el.style.minWidth = (tabW * cSx) + 'px';
      el.style.height = (tabH * cSy) + 'px';
      el.style.fontSize = (11 * cSx) + 'px';
      el.style.lineHeight = (tabH * cSy) + 'px';
      el.addEventListener('pointerdown', (e: PointerEvent) => { e.stopPropagation(); this.switchChatChannel(tab.id); });
      bar.appendChild(el);
      this.chatTabEls.push(el);
    });
    document.body.appendChild(bar);
    this.chatTabBar = bar;

    // 初始渲染选中态
    this.renderChatTabs();

    // 消息区域（标签栏下方）
    this.chatHudLines = this.add.container(boxX + 8, boxY + 58);
    c.add(this.chatHudLines);

    // 输入框（常驻，不自动聚焦）
    this.chatInputEl = this.spawnChatInput();
    this.chatInputEl.addEventListener('focus', () => { this.chatInputFocused = true; if (this.input.keyboard) this.input.keyboard.enabled = false; });
    this.chatInputEl.addEventListener('blur', () => { this.chatInputFocused = false; if (this.input.keyboard) this.input.keyboard.enabled = true; });
    this.chatInputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const v = this.chatInputEl!.value; this.chatInputEl!.value = ''; this.chatInputEl!.blur();
        this.submitChat(v);
      } else if (e.key === 'Escape') {
        this.chatInputEl!.value = ''; this.chatInputEl!.blur();
      }
    });
    // 画布缩放/居中变化时重定位 DOM 元素，消除左下角偏移
    this.relayoutChatDom();
    if (!this.chatResizeHooked) {
      this.chatResizeHooked = true;
      this.scale.on('resize', () => this.relayoutChatDom());
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.chatInputEl && this.chatInputEl.parentNode) this.chatInputEl.parentNode.removeChild(this.chatInputEl);
      if (this.chatTabBar && this.chatTabBar.parentNode) this.chatTabBar.parentNode.removeChild(this.chatTabBar);
    });
  }

  /** 频道标签 DOM 引用（用于高亮刷新，DOM 实现免疫相机滚动命中偏移）。 */
  private chatTabEls: HTMLElement[] = [];
  private chatTabBar: HTMLElement | null = null;
  /** scale 'resize' 事件是否已挂接（只挂一次，避免重复监听）。 */
  private chatResizeHooked = false;

  /**
   * 重定位聊天 DOM 元素（频道标签栏 + 输入框），使其始终贴合缩放/居中后的画布。
   * 根因：FIT + CENTER_BOTH 下画布 getBoundingClientRect 随浏览器窗口大小变化，
   * 而 DOM 元素只在创建时算过一次，窗口改变后便与画布左下角错位。
   */
  private relayoutChatDom(): void {
    if (!this.chatInputEl && !this.chatTabBar) return;
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const gw = this.scale.width, gh = this.scale.height;
    const sx = rect.width / gw, sy = rect.height / gh;
    if (this.chatTabBar) {
      const tabStartX = 12 + 10, tabY = (gh - 260) + 28;
      this.chatTabBar.style.left = (rect.left + tabStartX * sx) + 'px';
      this.chatTabBar.style.top = (rect.top + tabY * sy) + 'px';
    }
    if (this.chatInputEl) {
      const w = 366, h = 30, lx = 14, ly = gh - 60;
      this.chatInputEl.style.left = (rect.left + lx * sx) + 'px';
      this.chatInputEl.style.top = (rect.top + ly * sy) + 'px';
      this.chatInputEl.style.width = (w * sx) + 'px';
      this.chatInputEl.style.height = (h * sy) + 'px';
      this.chatInputEl.style.fontSize = (15 * Math.min(sx, sy)) + 'px';
    }
  }

  /** 切换聊天频道并刷新标签 UI。 */
  private switchChatChannel(channelId: string): void {
    // 权限检查：不在公会不能切 guild，不在队伍不能切 team
    if (channelId === 'guild' && !GameState.guildId) return;
    if (channelId === 'team' && !this.teamId) return;
    this.chatChannel = channelId;
    this.renderChatTabs();
    this.renderChatLines();
  }

  /** 渲染频道标签栏的选中/未选中状态（DOM 高亮 + 标题栏频道名）。 */
  private renderChatTabs(): void {
    const IDS = ['all', 'world', 'guild', 'team', 'whisper', 'system'];
    if (this.chatTabEls) {
      this.chatTabEls.forEach((el, i) => el.classList.toggle('selected', IDS[i] === this.chatChannel));
    }
    const LABELS: Record<string, string> = { all: '[全部]', world: '[世界]', guild: '[公会]', team: '[队伍]', whisper: '[私聊]', system: '[系统]' };
    this.chatChannelText?.setText(LABELS[this.chatChannel] || this.chatChannel);
    this.chatChannelText?.setColor(CHAT_COLORS[this.chatChannel] || '#aaccff');
  }

  private spawnChatInput(): HTMLInputElement {
    const el = document.createElement('input');
    el.type = 'text'; el.maxLength = 200; el.value = '';
    el.style.cssText = 'position:absolute;font-size:15px;color:#fff;background:#0a0a1e;border:1px solid #446688;border-radius:4px;outline:none;z-index:9999;';
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const gw = this.scale.width, gh = this.scale.height;
    const sx = rect.width / gw, sy = rect.height / gh;
    const w = 366, h = 30;
    const lx = 14, ly = gh - 60;
    el.style.left = (rect.left + lx * sx) + 'px';
    el.style.top = (rect.top + ly * sy) + 'px';
    el.style.width = (w * sx) + 'px'; el.style.height = (h * sy) + 'px';
    document.body.appendChild(el);
    return el;
  }

  private focusChatInput(): void {
    this.createChatHud();
    this.chatInputEl?.focus();
  }

  private submitChat(raw: string): void {
    const v = (raw || '').trim();
    if (!v) return;
    let channel = this.chatChannel === 'all' ? 'world' : this.chatChannel;
    let targetCharId = 0;
    let text = v;
    if (v.startsWith('/g ')) { channel = 'guild'; text = v.slice(3).trim(); }
    else if (v.startsWith('/t ')) { channel = 'team'; text = v.slice(3).trim(); }
    else if (v.startsWith('/w')) {
      const m = v.match(/^\/w(\d+)\s+(.*)$/);
      if (m) { channel = 'whisper'; targetCharId = parseInt(m[1], 10); text = m[2].trim(); }
      else { this.appendChatLine('system', '系统', 0, '私聊格式：/w<角色ID> 内容'); return; }
    }
    if (!text) return;
    if (channel === 'guild' && !GameState.guildId) { this.appendChatLine('system', '系统', 0, '你不在公会'); return; }
    if (channel === 'team' && !this.teamId) { this.appendChatLine('system', '系统', 0, '你不在队伍'); return; }
    // whisper 频道：若无 /w 前缀，则复用好友面板"私聊"设定的目标 ID
    if (channel === 'whisper' && !targetCharId && this.whisperTargetCharId) targetCharId = this.whisperTargetCharId;
    if (channel === 'whisper' && !targetCharId) { this.appendChatLine('system', '系统', 0, '请指定私聊对象 ID'); return; }
    // 斜杠前缀切换了频道时，同步刷新标签 UI
    if (channel !== this.chatChannel) this.switchChatChannel(channel);
    this.sendChat(channel, text, targetCharId);
  }

  /** 组队面板内通用按钮（graphics + text + 交互 zone）。 */
  private teamPanelButton(c: Phaser.GameObjects.Container, x: number, y: number, bw: number, bh: number, label: string, fill: number, textColor: string, cb: () => void): void {
    const g = this.add.graphics();
    g.fillStyle(fill, 0.9); g.fillRoundedRect(x - bw / 2, y - bh / 2, bw, bh, 6);
    g.lineStyle(1, 0xc9a96e, 0.5); g.strokeRoundedRect(x - bw / 2, y - bh / 2, bw, bh, 6);
    const t = this.add.text(x, y, label, { fontSize: '13px', color: textColor, fontStyle: 'bold' }).setOrigin(0.5);
    const z = this.add.zone(x, y, bw, bh).setInteractive({ useHandCursor: true });
    z.on('pointerover', () => { g.clear(); g.fillStyle(fill, 1); g.fillRoundedRect(x - bw / 2, y - bh / 2, bw, bh, 6); });
    z.on('pointerout', () => { g.clear(); g.fillStyle(fill, 0.9); g.fillRoundedRect(x - bw / 2, y - bh / 2, bw, bh, 6); t.setColor(textColor); });
    z.on('pointerdown', cb);
    c.add([g, t, z]);
  }

  /** 打开/刷新独立组队面板（全屏风格，与 C 属性 / B 背包面板一致）。 */
  private openTeamPanel(): void {
    this.closeTeamPanel();
    const w = GAME_WIDTH, h = GAME_HEIGHT;
    const c = this.add.container(0, 0).setDepth(500).setScrollFactor(0);

    // 遮罩（对齐 T 界面：整屏半透明，拦截点击）
    const ov = this.add.graphics();
    ov.fillStyle(0, 0.55); ov.fillRect(0, 0, w, h);
    ov.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
    c.add(ov);

    // T 风格文字按钮助手：[ 文字 ] + backgroundColor + hover
    const TBTN = (x: number, y: number, label: string, color: string, hover: string, cb: () => void): void => {
      const t = this.add.text(x, y, `[ ${label} ]`, { fontSize: '12px', color, fontStyle: 'bold', backgroundColor: '#002233aa', padding: { x: 10, y: 5 } }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
      t.on('pointerover', () => t.setColor(hover));
      t.on('pointerout', () => t.setColor(color));
      t.on('pointerdown', cb);
      c.add(t);
    };

    const candidatesAll = (!this.inDungeon)
      ? [...this.remotePlayers.entries()].filter(([sid]) => !this.teamMembers.some((m) => m.sid === sid))
      : [];

    // 估算高度（min 470 对齐 T，封顶屏幕-40），行高 64
    const rowH = 64;
    let rows = 0;
    if (this.pendingInvites.length > 0) rows += 1 + this.pendingInvites.length;
    if (this.teamMembers.length > 0) rows += 1 + this.teamMembers.length + 1;
    rows += 2;
    if (this.teamPanelInviteOpen) rows += candidatesAll.length;
    const mw = 560;
    const mh = Math.max(470, Math.min(70 + rows * rowH + 24, h - 40));
    const mx = (w - mw) / 2, my = (h - mh) / 2;

    // 面板背景（对齐 T：0x121222 + 棕金描边 0x6a5a3a）
    const bg = this.add.graphics();
    bg.fillStyle(0x121222, 0.985); bg.fillRoundedRect(mx, my, mw, mh, 12);
    bg.lineStyle(2, 0x6a5a3a, 0.7); bg.strokeRoundedRect(mx, my, mw, mh, 12);
    c.add(bg);

    // 标题（对齐 T：居中 ◆ 标题 ◆）
    c.add(this.add.text(mx + mw / 2, my + 26, '◆  队 伍 面 板  ◆', { fontSize: '20px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));

    // 关闭按钮（对齐 T：✕ + hover 变色）
    const closeT = this.add.text(mx + mw - 30, my + 26, '✕', { fontSize: '20px', color: '#cc6666', padding: { x: 6, y: 4 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    closeT.on('pointerover', function (this: any) { this.setColor('#ff8888'); });
    closeT.on('pointerout', function (this: any) { this.setColor('#cc6666'); });
    closeT.on('pointerdown', () => this.closeTeamPanel());
    c.add(closeT);

    // 副标题说明（对齐 T）
    c.add(this.add.text(mx + mw / 2, my + 50, '组队后可一同挑战副本（竞技场不可组队）', { fontSize: '11px', color: '#6677aa', padding: { y: 2 } }).setOrigin(0.5));

    const listX = mx + 24;
    const listW = mw - 48;
    let y = my + 70;

    // 行卡片（对齐 T：圆角背景 + 青蓝描边）
    const drawRow = (ry: number, hgt: number, accent: number): void => {
      const g = this.add.graphics();
      g.fillStyle(0x152028, 0.6); g.fillRoundedRect(listX, ry, listW, hgt, 8);
      g.lineStyle(1, accent, 0.6); g.strokeRoundedRect(listX, ry, listW, hgt, 8);
      c.add(g);
    };

    // ── 待处理邀请 ──
    if (this.pendingInvites.length > 0) {
      c.add(this.add.text(listX, y, `待处理邀请 (${this.pendingInvites.length})`, { fontSize: '14px', color: '#ffd980', fontStyle: 'bold', padding: { y: 2 } }));
      y += 26;
      for (const inv of this.pendingInvites) {
        drawRow(y, rowH - 8, 0xc9a96e);
        c.add(this.add.text(listX + 14, y + (rowH - 8) / 2, `${inv.fromName} 邀请你组队`, { fontSize: '14px', color: '#ffffff', padding: { y: 2 } }).setOrigin(0, 0.5));
        TBTN(listX + listW - 150, y + (rowH - 8) / 2, '接受', '#88ee88', '#ffffff', () => {
          this.gameRoom?.send('respondInvite', { teamId: inv.teamId, accept: true });
          this.removePendingInvite(inv.teamId, inv.fromSid);
          this.openTeamPanel();
        });
        TBTN(listX + listW - 78, y + (rowH - 8) / 2, '拒绝', '#ff8888', '#ffffff', () => {
          this.gameRoom?.send('respondInvite', { teamId: inv.teamId, accept: false });
          this.removePendingInvite(inv.teamId, inv.fromSid);
          this.openTeamPanel();
        });
        y += rowH;
      }
      y += 8;
    }

    // ── 队伍成员 ──
    if (this.teamMembers.length > 0) {
      c.add(this.add.text(listX, y, `队伍成员 (${this.teamMembers.length}/4)`, { fontSize: '14px', color: '#ffd980', fontStyle: 'bold', padding: { y: 2 } }));
      y += 26;
      const amLeader = this.teamLeaderSid === this.mySessionId;
      for (const m of this.teamMembers) {
        const isLeader = m.sid === this.teamLeaderSid;
        const isMe = m.sid === this.mySessionId;
        const label = isLeader ? `★ ${m.name}（队长）` : isMe ? `▶ ${m.name}（你）` : `  ${m.name}`;
        drawRow(y, rowH - 8, isMe ? 0xc9a96e : 0x3a5a6a);
        c.add(this.add.text(listX + 14, y + (rowH - 8) / 2, label, { fontSize: '14px', color: isMe ? '#88ff88' : '#ffffff', padding: { y: 2 } }).setOrigin(0, 0.5));
        if (amLeader && !isMe) {
          TBTN(listX + listW - 78, y + (rowH - 8) / 2, '踢出', '#ff8888', '#ffffff', () => {
            this.gameRoom?.send('kickMember', { targetSid: m.sid });
            this.openTeamPanel();
          });
        } else if (isMe && !amLeader) {
          TBTN(listX + listW - 78, y + (rowH - 8) / 2, '退出', '#ffcc88', '#ffffff', () => {
            this.gameRoom?.send('leaveTeam', {});
          });
        }
        y += rowH;
      }
      y += 6;
      if (amLeader) {
        TBTN(listX, y + 16, '解散队伍', '#ff8888', '#ffffff', () => { this.gameRoom?.send('disbandTeam', {}); });
      } else {
        TBTN(listX, y + 16, '退出队伍', '#ffcc88', '#ffffff', () => { this.gameRoom?.send('leaveTeam', {}); });
      }
      y += 44;
    }

    // ── 邀请队员（始终显示） ──
    c.add(this.add.text(listX, y, '邀请队员', { fontSize: '14px', color: '#ffd980', fontStyle: 'bold', padding: { y: 2 } }));
    y += 26;
    const blockBottom = my + mh - 16;
    TBTN(listX, y + 4, this.teamPanelInviteOpen ? '▾ 收起列表' : '▸ 展开附近玩家', '#88ccff', '#ffffff', () => {
      this.teamPanelInviteOpen = !this.teamPanelInviteOpen;
      this.openTeamPanel();
    });
    y += 38;
    if (this.teamPanelInviteOpen) {
      if (candidatesAll.length === 0) {
        c.add(this.add.text(listX + 14, y, '附近没有可邀请的玩家', { fontSize: '13px', color: '#667788', padding: { y: 2 } }));
      } else {
        let shown = 0;
        for (const [sid, rp] of candidatesAll) {
          if (y + rowH > blockBottom) break;
          drawRow(y, rowH - 8, 0x3a5a6a);
          c.add(this.add.text(listX + 14, y + (rowH - 8) / 2, rp.name, { fontSize: '14px', color: '#ffffff', padding: { y: 2 } }).setOrigin(0, 0.5));
          TBTN(listX + listW - 78, y + (rowH - 8) / 2, '邀请', '#99dd99', '#ffffff', () => {
            this.gameRoom?.send('invite', { targetSid: sid });
            this.showWorldNotif('已发送组队邀请', true);
            this.teamPanelInviteOpen = false;
            this.openTeamPanel();
          });
          y += rowH; shown++;
        }
        if (shown < candidatesAll.length) {
          c.add(this.add.text(listX + 14, y, `... 还有 ${candidatesAll.length - shown} 位玩家未显示`, { fontSize: '12px', color: '#556677', padding: { y: 2 } }));
        }
      }
    }

    this.teamPanelFull = c;
  }

  private showInvitePrompt(data: { fromName: string; fromSid: string; teamId: string }): void {
    this.addPendingInvite(data);
    this.openTeamPanel();
  }
  /** 副本传送阵确认界面：有进行中副本时显示「重连进入（第N阶）」+「放弃进度」，否则「进入副本」。 */
  private showDungeonConfirm(zone: number): void {
    if (this.dungeonConfirmOpen) return;
    this.dungeonConfirmOpen = true;
    const w = GAME_WIDTH, h = GAME_HEIGHT;
    const c = this.add.container(0, 0).setDepth(500).setScrollFactor(0);
    this.dungeonConfirmPanel = c;
    const dim = this.add.graphics();
    dim.fillStyle(0x000000, 0.55); dim.fillRect(0, 0, w, h);
    c.add(dim);
    const active = dungeonProgress && dungeonProgress.dungeonId === zone;
    const pw = 360, ph = active ? 224 : 190;
    const px = (w - pw) / 2, py = (h - ph) / 2;
    const panel = this.add.graphics();
    panel.fillStyle(0x16162a, 0.97); panel.fillRoundedRect(px, py, pw, ph, 14);
    panel.lineStyle(2, 0xaa66ff, 0.8); panel.strokeRoundedRect(px, py, pw, ph, 14);
    c.add(panel);
    if (active) {
      // 进行中副本：断线重连入口（对齐老副本「继续挑战」）
      c.add(this.add.text(px + pw / 2, py + 36, `继续副本 ${zone}`, { fontSize: '22px', color: '#e8d8ff', fontStyle: 'bold' }).setOrigin(0.5));
      c.add(this.add.text(px + pw / 2, py + 72, `当前进度：第 ${dungeonProgress!.stage} 阶 / 共 3 阶`, { fontSize: '14px', color: '#9ad8ff' }).setOrigin(0.5));
      c.add(this.add.text(px + pw / 2, py + 96, '中断进度已保存，重连进入将从该阶继续', { fontSize: '12px', color: '#bbaadd' }).setOrigin(0.5));
      // 主按钮：重连进入（免费续阶，复用 enterDungeon 的续打逻辑）
      this.teamPanelButton(c, px + pw / 2 - 95, py + 148, 175, 46, `重连进入`, 0x3a2a4a, '#cdaaff', () => {
        this.closeDungeonConfirm(); this.enterDungeon(zone);
      });
      // 次按钮：放弃进度（清 pw.dungeon，不计费；对应老副本「覆盖之前挑战记录」）
      this.teamPanelButton(c, px + pw / 2 + 95, py + 148, 175, 46, '放弃进度', 0x4a2a2a, '#ffb0b0', () => {
        this.closeDungeonConfirm();
        this.gameRoom?.send('intent', { op: 'abandonDungeon', dungeonId: zone });
      });
      // 暂不进入
      this.teamPanelButton(c, px + pw / 2, py + 192, 150, 36, '暂不进入', 0x2a2a2a, '#cccccc', () => {
        this.closeDungeonConfirm();
      });
    } else {
      c.add(this.add.text(px + pw / 2, py + 42, `进入副本 ${zone}？`, { fontSize: '22px', color: '#e8d8ff', fontStyle: 'bold' }).setOrigin(0.5));
      const remaining = Math.max(0, DUNGEON_WEEKLY_CAP - dungeonWeekly.count);
      c.add(this.add.text(px + pw / 2, py + 78, `本周剩余 ${remaining} 次`, { fontSize: '13px', color: '#bbaadd' }).setOrigin(0.5));
      this.teamPanelButton(c, px + pw / 2 - 90, py + 138, 150, 44, '进入副本', 0x2a1a3a, '#cdaaff', () => {
        this.closeDungeonConfirm(); this.enterDungeon(zone);
      });
      this.teamPanelButton(c, px + pw / 2 + 90, py + 138, 150, 44, '暂不进入', 0x2a2a2a, '#cccccc', () => {
        this.closeDungeonConfirm();
      });
    }
  }
  private closeDungeonConfirm(): void {
    if (this.dungeonConfirmPanel) { this.dungeonConfirmPanel.destroy(true); this.dungeonConfirmPanel = null; }
    this.dungeonConfirmOpen = false;
  }

  /** 绘制/刷新队伍面板（左上角，半透明 HUD）。 */
  private renderTeamPanel(): void {
    this.hideTeamPanel();
    const hasTeam = this.teamMembers.length > 0;
    const hasInvites = this.pendingInvites.length > 0;
    if (!hasTeam && !hasInvites) return;

    const padX = 16, padY = 12, itemH = 28, w = 210;
    const rows = hasTeam ? this.teamMembers.length : 0;
    const extra = hasInvites ? 24 : 0;
    const h = padY * 2 + (hasTeam ? rows * itemH + 30 : 24) + extra;
    const panel = this.add.container(12, 12).setDepth(300).setScrollFactor(0);

    const bg = this.add.graphics();
    bg.fillStyle(0x1a1a2e, 0.85);
    bg.fillRoundedRect(0, 0, w, h, 10);
    bg.lineStyle(1, 0xc9a96e, 0.5);
    bg.strokeRoundedRect(0, 0, w, h, 10);

    let y = padY + 6;
    if (hasTeam) {
      const title = this.add.text(w / 2, y, `队伍 (${this.teamMembers.length}/4)  [G]`, {
        fontSize: '14px', color: '#ffe8b0', fontStyle: 'bold',
      }).setOrigin(0.5);
      panel.add(title);
      y += 24;
      this.teamMembers.forEach((m, i) => {
        const isLeader = m.sid === this.teamLeaderSid;
        const isMe = m.sid === this.mySessionId;
        const yy = y + i * itemH;
        const txt = this.add.text(padX + 4, yy + 4, isLeader ? `★ ${m.name}` : isMe ? `▶ ${m.name}` : `  ${m.name}`, {
          fontSize: '13px', color: isMe ? '#88ff88' : '#ffffff',
        }).setScrollFactor(0);
        panel.add(txt);
      });
      y += rows * itemH + 6;
    } else {
      const title = this.add.text(w / 2, y, `队伍面板  [G]`, {
        fontSize: '14px', color: '#ffe8b0', fontStyle: 'bold',
      }).setOrigin(0.5);
      panel.add(title);
      y += 24;
    }

    if (hasInvites) {
      const inv = this.add.text(padX + 4, y + 4, `● ${this.pendingInvites.length} 条组队邀请`, {
        fontSize: '13px', color: '#ffd9a0', fontStyle: 'bold',
      }).setScrollFactor(0);
      panel.add(inv);
      y += 24;
    }

    // 整块可点击打开完整面板
    const hit = this.add.zone(w / 2, h / 2, w, h).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => this.toggleTeamPanel());
    panel.add(hit);

    this.teamPanel = panel;
  }

  private hideTeamPanel(): void {
    if (this.teamPanel) { this.teamPanel.destroy(); this.teamPanel = null; }
  }

  /** 组队战斗：收到 enterTeamBattle 后自动启动战斗。 */
  private launchTeamBattle(monsterId: string): void {
    if (!this.gameRoom) return;
    this.battleCooldown = 120;
    this.setBattling(true);

    const loadout = this.buildBattleLoadout();

    // 只传 monsterId 和自身身份，不传 dummy enemyParty——
    // BattleRoom 已有首个玩家的真实 enemyParty + state.enemies，覆盖会导致数据不一致。
    this.scene.launch('MultiBattleScene', {
      playerName: GameState.playerName || '勇者',
      loadout,
      monsterId,
      ownerSessionId: this.mySessionId,
      isTeamPull: true,   // 被队友拉进来的，不发 startbattle
    });
    this.scene.pause();
  }

  /** PVP 竞技场：收到 arenaMatch 后暂停地图，启动 PvpBattleScene（携带房间号/队伍/负载）。 */
  private enterPvpBattle(data: { roomId: string; mode: string; team: string; token: string }): void {
    if (!this.gameRoom) return;
    setArenaMatching(false);
    if (this.arenaPanel) closeArenaPanel(this);
    const loadout = this.buildBattleLoadout();
    this.scene.launch('PvpBattleScene', {
      roomId: data.roomId,
      token: data.token,
      charId: this.characterId,
      team: data.team,
      gameSid: this.mySessionId,
      playerName: GameState.playerName || '勇者',
      mode: data.mode === '4v4' ? '4v4' : '1v1',
      loadout,
    });
    this.scene.pause();
  }

  /** 副本组队战斗：收到 enterTeamDungeonBattle 后，路由到活跃的 DungeonMapScene 拉队员进同一 battle room。 */
  private routeTeamDungeonBattle(data: { dungeonId?: number; stage?: number }): void {
    if (!this.inDungeon) return;
    const dms = this.scene.get('DungeonMapScene') as any;
    if (!dms || !dms.scene.isActive()) return;
    dms.pullIntoTeamBattle(data);
  }

  /** 队长战斗返回广播：按当前场景路由——副本内停队员的战斗场景，地图内停自身战斗场景。
   *  注意：副本战斗中 DungeonMapScene 处于 paused 状态（isActive()=false），
   *  故此处只能用「实例存在」守卫，不能用 isActive()，否则队员退出战斗会被跳过。 */
  private routeTeamBattleEnd(): void {
    if (this.inDungeon) {
      const dms = this.scene.get('DungeonMapScene') as any;
      if (dms) dms.stopTeamBattle();
    } else {
      this.stopTeamBattle();
    }
  }

  /** 副本阶段推进广播：队员侧同步重建镜像地图到队长所在阶（由队长 transitionToStage 触发，不用 isActive 守卫避免 paused 误判）。 */
  private routeTeamDungeonStage(stage: number): void {
    if (!this.inDungeon) return;
    const dms = this.scene.get('DungeonMapScene') as any;
    if (dms) dms.syncToServerStage(stage);
  }

  /** 副本退出广播：队员侧同步退出副本地图回主世界（由队长 exitToGame 触发）。 */
  private routeTeamExitDungeon(): void {
    if (!this.inDungeon) return;
    const dms = this.scene.get('DungeonMapScene') as any;
    if (dms) dms.exitToGame();
  }

  /** 开放世界组队战斗：队员侧收到队长返回广播后，退出战斗场景回地图（SHUTDOWN 自动 resume GameScene）。 */
  private stopTeamBattle(): void {
    if (this.scene.isActive('MultiBattleScene')) this.scene.stop('MultiBattleScene');
  }

  /** 邀请附近玩家（点击名牌触发）。 */
  private invitePlayer(targetSid: string): void {
    if (this.teamId) {
      this.showWorldNotif('你已在队伍中', false);
      return;
    }
    this.gameRoom?.send('invite', { targetSid });
    this.showWorldNotif('已发送组队邀请', true);
  }

  /** 使远程玩家名牌可点击（悬停变色，点击邀请）。 */
  private makeRemotePlayersInteractable(): void {
    this.remotePlayers.forEach((rp, sid) => {
      const tag = rp.tag;
      if ((tag as any)._teamInviteSet) return;
      (tag as any)._teamInviteSet = true;
      tag.setInteractive({ useHandCursor: true });
      tag.on('pointerdown', () => {
        if (!this.gameRoom) return;
        if (this.teamId) { this.showWorldNotif('你已在队伍中', false); return; }
        this.invitePlayer(sid);
      });
      tag.on('pointerover', () => tag.setColor('#ffe8b0'));
      tag.on('pointerout', () => tag.setColor('#ffffff'));
    });
  }
}
