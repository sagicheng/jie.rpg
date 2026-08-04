/**
 * 主游戏场景（大世界）
 * 玩家移动、NPC 交互、地图怪物、聊天频道、任务 / 商店 / 面板 HUD 编排，
 * 以及联机 worldSync 同步与断线处理。游戏核心场景。
 */

import Phaser from 'phaser';
import { matId, NODE_TO_MATERIAL } from '../config/materials';
import { GAME_WIDTH, GAME_HEIGHT, ZONE_NAMES } from '../config/config';
import { npcDisplayName, enemyDisplayName } from '../config/entityNames';
import { DialogueBox, DialogueLine } from '../ui/DialogueBox';
import { GameState } from '../managers/GameState';
import { EnemyData, createEnemyData, expForLevel, generateLoot } from '../managers/BattleData';
import { getEnemyData, NAMED_ENEMIES } from '../managers/BestiaryData';
import { Inventory } from '../managers/Inventory';
import { SaveManager } from '../core/SaveManager';
import { ZONE_CONFIGS, getDungeonPortal } from '../config/zones';
import { monsterPortraitKey, ensureMonsterPortrait, bossPortraitKey, ensureBossPortrait } from '../core/portraitLoader';
import { makeSetId } from '../managers/SetSystem';
import { MAIN_QUESTS, MAIN_QUEST_ORDER, SIDE_QUESTS } from '../managers/QuestData';
import { Kido, KIDO_NODES, KidoSchool } from '../managers/Kido';
import { getAvailableSkills, ZANPAKUTO_ELEMENT } from '../managers/Skills';
import { BOSS_CONFIG } from '../managers/BossMechanics';
import { CONSUMABLES_BY_NAME } from '../managers/ConsumableSystem';
import { openShop, openMall, toggleInventory, closeInventory, toggleStatPanel, closeStatPanel, renderInventoryPanel, renderStatPanel, showKidoPanel, closeKidoPanel, toggleEnhancePanel, closeEnhancePanel, toggleQuestLog, toggleBestiaryPanel, closeBestiaryPanel, renderQuestBoardPanel, showNamingInput, showShikaiSelection, closeTitlePanel, toggleTitlePanel, openArenaPanel, closeArenaPanel, renderArenaPanel, setArenaStatus, setArenaMatching, renderGuildPanel, renderFriendPanel, renderAuctionPanel, openAuctionPanel, closeAuctionPanel, toggleAuctionPanel, refreshAuctionPanel, openPetPanel, closePetPanel } from '../ui/panels';
import { GuildClient } from '../api/GuildClient';
import { CharacterClient } from '../api/CharacterClient';
import { applyGuildStatBonus } from '../api/GuildSkills';
import { getClient } from '../core/Net';
import { CHAT_COLORS, CHAT_PREFIX, sendChat as _sendChat, sendGuildChat as _sendGuildChat, onChat as _onChat, appendChatLine as _appendChatLine, renderChatLines as _renderChatLines, createChatHud as _createChatHud, relayoutChatDom as _relayoutChatDom, switchChatChannel as _switchChatChannel, renderChatTabs as _renderChatTabs, spawnChatInput as _spawnChatInput, spawnWhisperTargetInput as _spawnWhisperTargetInput, refreshWhisperInputVis as _refreshWhisperInputVis, focusChatInput as _focusChatInput } from './systems/GameScene.chat';
import { applyWorldSync, setActiveRoom, setDisconnectNotifier, requestGather, requestBuy, requestEquip, requestUnequip, requestCraft, requestEnhance, requestRefine, requestDecompose, requestRefineReset, requestClaimQuest, requestUnlock, isOnline, dungeonProgress, dungeonWeekly, DUNGEON_WEEKLY_CAP } from '../api/WorldClient';
import { petElementInfo, petQualityInfo } from '../managers/PetSystem';
import { addPendingInvite as _addPendingInvite, removePendingInvite as _removePendingInvite, toggleTeamPanel as _toggleTeamPanel, closeTeamPanel as _closeTeamPanel, showInvitePrompt as _showInvitePrompt, showDungeonConfirm as _showDungeonConfirm, closeDungeonConfirm as _closeDungeonConfirm, renderTeamPanel as _renderTeamPanel, hideTeamPanel as _hideTeamPanel, launchTeamBattle as _launchTeamBattle, enterPvpBattle as _enterPvpBattle, routeTeamDungeonBattle as _routeTeamDungeonBattle, routeTeamBattleEnd as _routeTeamBattleEnd, routeTeamDungeonStage as _routeTeamDungeonStage, routeTeamExitDungeon as _routeTeamExitDungeon, stopTeamBattle as _stopTeamBattle, invitePlayer as _invitePlayer, makeRemotePlayersInteractable as _makeRemotePlayersInteractable, openTeamPanel as _openTeamPanel, teamPanelButton as _teamPanelButton } from './systems/GameScene.team';
import { syncRemotePlayers as _syncRemotePlayers, clearRemotePlayers as _clearRemotePlayers, setBattling as _setBattling, sendMoveThrottled as _sendMoveThrottled, connectGameRoom as _connectGameRoom } from './systems/GameScene.multiplayer';
import { onEnemyOverlap as _onEnemyOverlap, checkEnemyCollision as _checkEnemyCollision, enterBattle as _enterBattle, isMonsterAvailable as _isMonsterAvailable, onBattleEnd as _onBattleEnd, onMultiBattleEnd as _onMultiBattleEnd, flushBattleReport as _flushBattleReport, monsterRespawnMs as _monsterRespawnMs, removeMonster as _removeMonster, restoreMonster as _restoreMonster } from './systems/GameScene.battle';
import { fitBody as _fitBody, createEnemies as _createEnemies } from './systems/GameScene.map';

/** Phaser physics.add.overlap 回调参数的联合类型，与 ArcadePhysicsCallback 对齐。
 *  历史上写成 GameObject 会在 strictFunctionTypes 下因逆变不兼容报 TS2345
 *  （GameObject 不是 Body/StaticBody/Tile 的超类型）。 */
type ArcadeOverlapTarget = Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody | Phaser.Tilemaps.Tile;

interface NPCData {
  sprite: Phaser.Physics.Arcade.Sprite;
  id: string;
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
  private remotePlayers: Map<string, { sprite: Phaser.GameObjects.Sprite; tag: Phaser.GameObjects.Text; tx: number; ty: number; name: string; title: string; gender: string }> = new Map();
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
  private chatWhisperTargetEl: HTMLInputElement | null = null;
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
  private enemyGroup: Phaser.Physics.Arcade.Group | null = null;
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

  init(data?: { newGame?: boolean; name?: string; element?: string; authToken?: string; characterId?: number; characterName?: string; characterElement?: string; characterGender?: string; gender?: string }): void {
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
      const chGender = data.characterGender || data.gender || '';
      if (chName) {
        GameState.playerName = chName;
        if (chElement) GameState.element = chElement;
        if (chGender) GameState.gender = chGender === 'female' ? 'female' : 'male';
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
      const chGender = data?.characterGender || data?.gender || '';
      if (chName) {
        GameState.playerName = chName;
        if (chElement) GameState.element = chElement;
        if (chGender) GameState.gender = chGender === 'female' ? 'female' : 'male';
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

  preload(): void {
    // 主角色行走精灵表（down/side/up × 男女），每向 8 帧，80×120
    for (const f of ['down', 'side', 'up']) {
      for (const g of ['male', 'female']) {
        const key = `walk_${f}_${g}`;
        if (!this.textures.exists(key)) {
          this.load.spritesheet(key, `assets/characters/walk_${f}_${g}.png`, { frameWidth: 80, frameHeight: 120 });
        }
      }
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

    this.player = this.physics.add.sprite(GameState.x, GameState.y, 'walk_down_' + GameState.gender)
      .setDepth(10).setCollideWorldBounds(true);
    // 显示尺寸固定 40x60；碰撞体按"当前纹理实际尺寸"比例自适应（换透明底 PNG 尺寸变了也不错位）
    this.player.setDisplaySize(40, 60);
    this.fitBody(this.player, 0.7, 0.9, 0.15, 0.04);

    // 行走动画（两种性别各一套，精灵表 walk_${facing}_${gender}，每向 8 帧，80×120）
    const mkWalk = (key: string, tex: string) => {
      if (!this.anims.exists(key)) {
        this.anims.create({ key, frames: this.anims.generateFrameNumbers(tex, { start: 0, end: 7 }), frameRate: 10, repeat: -1 });
      }
    };
    for (const g of ['male', 'female'] as const) {
      mkWalk(`walk_down_${g}`, `walk_down_${g}`);
      mkWalk(`walk_side_${g}`, `walk_side_${g}`);
      mkWalk(`walk_up_${g}`,   `walk_up_${g}`);
    }

    // 怪物分组：用物理重叠检测替代中心点距离判定，接触即触发战斗（更稳、更符合直觉）
    this.enemyGroup = this.physics.add.group();
    this.physics.add.overlap(this.player, this.enemyGroup, this.onEnemyOverlap, undefined, this);

    // 玩家头顶：角色名 + 称号（跟随人物移动）。用 displayHeight 而不是 height，避免 512x768 纹理导致标签飞到头顶上方 300+ 像素
    const ph = this.player.displayHeight / 2;
    this.nameTag = this.add.text(this.player.x, this.player.y - ph - 22, this.playerDisplayName(), {
      fontSize: '12px', color: '#bfe8ff', fontStyle: 'bold',
      backgroundColor: '#00000066', padding: { x: 4, y: 1 },
    }).setOrigin(0.5, 1).setDepth(11);
    this.titleTag = this.add.text(this.player.x, this.player.y - ph - 8, '', {
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

    // 开发调试：全局暴露 GameState（绕过 Vite 多 chunk 双实例）
    (window as any).__gs = GameState;

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

    // 单独 G 键：开关独立组队面板
    this.input.keyboard!.addKey('G').on('down', () => {
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
      if (this.dungeonConfirmOpen || this.teamPanelFull || this.questLogPanel) return;
      if (this.inventoryPanel || this.statPanel || this.kidoPanel || this.enhancePanel || this.bestiaryPanel || this.guildPanel || this.friendPanel || this.auctionPanel) return;
      this.togglePetPanel(); // 面板开着时第二次按 U 由 togglePetPanel 内部关闭（不要在此提前 return）
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
    // 怪物名字：像素对齐，并用 displayHeight 锚定视觉头顶，避免 512x512 纹理把标签甩到头顶上方
    this.enemies.forEach(e => {
      e.label.setPosition(Math.round(e.sprite.x), Math.round(e.sprite.y - e.sprite.displayHeight / 2 - 10));
    });
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

    // 主角色行走动画：按移动向量选朝向（down/side/up），侧身左右用 flipX
    if (vx !== 0 || vy !== 0) {
      const facing = Math.abs(vx) > Math.abs(vy) ? 'side' : (vy > 0 ? 'down' : 'up');
      this.player.anims.play('walk_' + facing + '_' + GameState.gender, true);
      this.player.setFlipX(Math.abs(vx) > Math.abs(vy) && vx > 0);
    } else {
      this.player.anims.stop();
      this.player.setTexture('walk_down_' + GameState.gender).setFrame(0);
    }

    // 组队非队长：服务端权威位置覆盖本地物理，视觉上紧跟队长
    if (isTeamNonLeader && this.gameRoom) {
      const meState = this.gameRoom.state?.players?.get(this.mySessionId);
      if (meState) {
        this.player.setPosition(meState.x, meState.y);
        this.player.setVelocity(0, 0);
      }
    }
    this.checkNPCProximity(); this.checkZoneExit(); this.checkDungeonPortal();
    this.updateMiniMap();
    // 物理重叠是主要战斗触发，但为防偶发漏检，保留一帧一次的距离兜底
    this.checkEnemyCollision();
    GameState.x = this.player.x; GameState.y = this.player.y;
    if (this.battleCooldown > 0) this.battleCooldown--;
    this.coordText.setText(`X:${Math.round(this.player.x)}  Y:${Math.round(this.player.y)}`);
    this.syncPlayerTags();
    this.sendMoveThrottled();
    // 联机：每帧拉取服务端状态并平滑插值远程玩家（含名字）
    this.syncRemotePlayers();
    this.remotePlayers.forEach(rp => {
      const dx = rp.tx - rp.sprite.x, dy = rp.ty - rp.sprite.y;
      rp.sprite.x = Phaser.Math.Linear(rp.sprite.x, rp.tx, 0.2);
      rp.sprite.y = Phaser.Math.Linear(rp.sprite.y, rp.ty, 0.2);
      // 远程玩家行走动画：按「目标-当前」向量选朝向与翻转（与本地玩家同逻辑）
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        const facing = Math.abs(dx) > Math.abs(dy) ? 'side' : (dy > 0 ? 'down' : 'up');
        rp.sprite.anims.play('walk_' + facing + '_' + rp.gender, true);
        rp.sprite.setFlipX(Math.abs(dx) > Math.abs(dy) && dx > 0);
      } else {
        rp.sprite.anims.stop();
        rp.sprite.setTexture('walk_down_' + rp.gender).setFrame(0);
      }
      rp.tag.setPosition(Math.round(rp.sprite.x), Math.round(rp.sprite.y - rp.sprite.displayHeight / 2 - 10));
    });
    // 联机：每帧按服务端怪物状态机同步显示（防重入战斗）
    this.pruneSharedMonsters();
  }

  /** 玩家头顶：角色名 + 称号，跟随移动，文本变化时才重绘 */
  private playerDisplayName(): string {
    return GameState.playerName + (GameState.gender === 'female' ? '♀' : '♂');
  }

  private syncPlayerTags(): void {
    const ph = this.player.displayHeight / 2;
    if (this.nameTag) {
      const dn = this.playerDisplayName();
      if (this.nameTag.text !== dn) this.nameTag.setText(dn);
      this.nameTag.setPosition(Math.round(this.player.x), Math.round(this.player.y - ph - 22));
    }
    if (this.titleTag) {
      const tn = GameState.getActiveTitleDef()?.name ?? '';
      if (this.titleTag.text !== tn) {
        this.titleTag.setText(tn);
        this.titleTag.setVisible(tn.length > 0);
      }
      this.titleTag.setPosition(Math.round(this.player.x), Math.round(this.player.y - ph - 8));
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
    if (this.chatWhisperTargetEl) this.chatWhisperTargetEl.style.display = (v && this.chatChannel === 'whisper') ? 'block' : 'none';
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
    // 止血草等同时是消耗品的采集产物，按 consumable 入库（避免出现在材料类）
    // 判定：若 CONSUMABLES 里有同名物品，则用 consumable 类型 + 原 consumable.id（保持库存合并）
    const conEntry = CONSUMABLES_BY_NAME[matName];
    Inventory.addItem({
      id: conEntry ? conEntry.id : matId(matName),
      name: matName,
      type: conEntry ? 'consumable' : 'material',
      desc: conEntry ? conEntry.desc : '野外采集获得',
      quantity: 1,
    });
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
    GameState.updateQuestProgress('talk', npc.id, 1);
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
      this.gatherPoints.forEach(gp => { gp.sprite.destroy(); gp.label.destroy(); }); this.gatherPoints = [];
      const stale = this.children.list.filter((c2: any) =>
        (c2.type === 'Graphics' && [0,1,3,4].includes(c2.depth||-1)) ||
        (c2.type === 'Text' && [4,6].includes(c2.depth||-1)) ||
        (c2.type === 'TileSprite' && [0,1].includes(c2.depth||-1))
      );
      stale.forEach((c2: any) => c2.destroy());
      this.createMap(); this.createNPCs(); this.createEnemies(); this.createGatheringPoints();
      this.zoneText.setText(`${ZONE_NAMES[GameState.zone]}`);
      this.player.setPosition(tx, ty); this.isInDialogue = false; this.cameras.main.fadeIn(400,0,0,0); SaveManager.save();
      const b = this.add.text(GAME_WIDTH/2, GAME_HEIGHT/2-40, ZONE_NAMES[tz], {fontSize:'28px',color:'#ffe8b0',fontStyle:'bold',backgroundColor:'#000000aa',padding:{x:24,y:12}}).setOrigin(0.5).setScrollFactor(0).setDepth(250).setAlpha(0);
      this.tweens.add({targets:b,alpha:1,duration:500,onComplete:()=>{this.tweens.add({targets:b,alpha:0,duration:1200,delay:1000,onComplete:()=>b.destroy()});}});
    });
  }

  // ═══ Enemies ═══
  /** 玩家与怪物物理体重叠时触发战斗（比中心点距离判定更稳，贴合"走上去就打"的直觉）。 */

  // ═══ 战斗方法 — 委托到 GameScene.battle.ts ═══
  private onEnemyOverlap(_player: ArcadeOverlapTarget, enemySprite: ArcadeOverlapTarget): void { _onEnemyOverlap(this, _player, enemySprite); }
  private checkEnemyCollision(): void { _checkEnemyCollision(this); }
  private enterBattle(en?: any): void { _enterBattle(this, en); }
  private isMonsterAvailable(id: string): boolean { return _isMonsterAvailable(this, id); }
  onBattleEnd(result: string, er: any): void { _onBattleEnd(this, result, er); }
  onMultiBattleEnd(result: string, monsterId: string, enemyData: any, reward?: any): void { _onMultiBattleEnd(this, result, monsterId, enemyData, reward); }
  private flushBattleReport(): void { _flushBattleReport(this); }
  private monsterRespawnMs(er: { data: EnemyData }): number { return _monsterRespawnMs(this, er); }
  private removeMonster(en: any): void { _removeMonster(this, en); }
  private restoreMonster(en: any): void { _restoreMonster(this, en); }

  private fitMonsterSprite(sprite: Phaser.GameObjects.Sprite, targetW: number): void {
    const h = sprite.height, w = sprite.width;
    if (!h || !w) return;
    const scale = targetW / w;
    sprite.setDisplaySize(targetW, h * scale);
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

  /**
   * 让物理碰撞体按"显示尺寸"的比例自适应，不依赖纹理原始分辨率。
   * 换不同尺寸的透明底 PNG 时，碰撞体始终贴合视觉，不会错位或缩成一点。
   */
  private fitBody(sprite: Phaser.Physics.Arcade.Sprite, wFrac: number, hFrac: number, offXFrac?: number, offYFrac?: number): void { _fitBody(this, sprite, wFrac, hFrac, offXFrac, offYFrac); }

  private createMap(): void {
    const cfg = ZONE_CONFIGS[GameState.zone] || ZONE_CONFIGS[1];
    const mapW = GAME_WIDTH * 3, mapH = GAME_HEIGHT * 2;
    const g = this.add.graphics().setDepth(0);

    // 1) 区域背景图（飘流幻境式：一张大地图/可拼接背景铺底）
    if (cfg.backgroundImage && this.textures.exists(cfg.backgroundImage)) {
      if (cfg.backgroundMode === 'cover') {
        // 单张大图拉伸铺满整张地图（不重复）—— 适合你画好的一整张场景大图
        this.add.image(mapW / 2, mapH / 2, cfg.backgroundImage)
          .setOrigin(0.5).setDisplaySize(mapW, mapH).setDepth(0);
      } else {
        // 默认平铺重复（适合小尺寸可循环纹理）
        this.add.tileSprite(mapW / 2, mapH / 2, mapW, mapH, cfg.backgroundImage).setDepth(0);
      }
    } else {
      // 无背景图时：底色 + 中性噪点 tile
      g.fillStyle(cfg.groundColor, 1);
      g.fillRect(0, 0, mapW, mapH);
      if (this.textures.exists('tile_ground')) {
        const ground = this.add.tileSprite(mapW / 2, mapH / 2, mapW, mapH, 'tile_ground').setDepth(0);
        ground.setTint(cfg.groundColor);
        ground.setAlpha(0.35);
      }
    }

    // 2)～4) 原代码占位美术已移除：灰色道路(tile_road/roadColor)、拼接装饰(cfg.props/deco_rock)、
    //     建筑池塘(cfg.decorations/deco_house_a·b·deco_pond)、全局树木(deco_tree) 全部不再渲染。
    //     场景现在只铺 backgroundImage（21 张真实区域地图），不叠加任何程序化占位。

    // 5) Zone exit portals
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

    // 6) 副本传送阵（每区域一个入口，进入独立副本实例）
    const dp = getDungeonPortal(GameState.zone);
    const dx = dp.x * mapW, dy = dp.y * mapH;
    this.dungeonPortalPos = { x: dx, y: dy };
    if (this.textures.exists('dungeon_portal_1')) {
      const portal = this.add.image(dx, dy, 'dungeon_portal_1').setDepth(3);
      portal.setDisplaySize(96, 96);
      this.tweens.add({ targets: portal, alpha: 0.65, duration: 1100, yoyo: true, repeat: -1 });
    } else {
      // 缺图时回退紫圈占位
      const portal = this.add.graphics();
      portal.fillStyle(0xaa66ff, 0.15); portal.fillCircle(dx, dy, 38);
      portal.fillStyle(0xaa66ff, 0.32); portal.fillCircle(dx, dy, 24);
      portal.lineStyle(2, 0xcc99ff, 0.9); portal.strokeCircle(dx, dy, 32);
      portal.setDepth(3);
      this.tweens.add({ targets: portal, alpha: 0.35, duration: 1100, yoyo: true, repeat: -1 });
    }
    const tag = this.add.text(dx, dy - 46, '\u25C6 副本' + GameState.zone, { fontSize: '12px', color: '#d9b3ff', fontStyle: 'bold', backgroundColor: '#221133cc', padding: { x: 5, y: 2 } }).setOrigin(0.5).setDepth(6);
    this.tweens.add({ targets: tag, y: dy - 52, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  private createNPCs(): void {
    const cfg = ZONE_CONFIGS[GameState.zone] || ZONE_CONFIGS[1];
    for (const c of cfg.npcs) {
      const nx = c.x * GAME_WIDTH * 3, ny = c.y * GAME_HEIGHT * 2;
      const npcTexture = this.textures.exists(c.id) ? c.id : 'npc';
      const npc = this.physics.add.sprite(nx, ny, npcTexture).setImmovable(true).setDepth(5).setDisplaySize(40, 60);
      const tag = this.add.text(nx, ny - 30, npcDisplayName(c.id), {
        fontSize: '11px',
        color: c.role === 'merchant' ? '#ffdd88' : c.role === 'return_point' ? '#88ccff' : c.role === 'craft' ? '#aa88ff' : c.role === 'enhance' ? '#ff8844' : c.role === 'quest_board' ? '#ffcc66' : '#ffe8b0',
        backgroundColor: '#00000088', padding: { x: 4, y: 2 },
      }).setOrigin(0.5).setDepth(6);

      const dialogueLines: DialogueLine[] = c.dialogue.map((d, i) => {
        // speaker 一律取自中枢（zone 数据里的 d.speaker 已废弃）：
        // NPC 自称在对话框标题、头顶名牌、交互提示三处保持同一真相，改名只动 entityNames.ts。
        const line: DialogueLine = { speaker: npcDisplayName(c.id), text: d.text };
        if (d.choices && i === 0) {
          line.choices = d.choices.map(ch => ({
            text: ch.text,
            callback: () => {
              if (ch.callback === 'openShop') this.openShopPanel(c.shop || []);
              else if (ch.callback === 'acceptQuest') this.acceptQuestFromNPC(c);
              else if (ch.callback === 'completeQuest') this.completeQuestFromNPC(c);
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
        if (!quest || quest.acceptFrom !== c.id) continue;
        if (GameState.questCompleted.includes(questId)) continue;
        if (GameState.isQuestActive(questId)) continue;
        if (quest.prerequisite && !GameState.questCompleted.includes(quest.prerequisite)) continue;
        questChoices.push({ text: `接受任务：${quest.name}`, callback: () => this.acceptQuestFromNPC(c) });
        break;
      }
      // 检查是否有可完成的任务（本NPC completeAt 且已就绪）
      const readyId = GameState.activeQuests.find(id => {
        const q = GameState.getQuestDef(id);
        return !!q && q.completeAt === c.id && GameState.isQuestReady(id);
      });
      if (readyId) {
        const q = GameState.getQuestDef(readyId)!;
        questChoices.push({ text: `完成任务：${q.name}`, callback: () => this.completeQuestFromNPC(c) });
      } else {
        // 任务进行中，在对话文本中显示进度
        const activeId = GameState.activeQuests.find(id => {
          const q = GameState.getQuestDef(id);
          return !!q && q.completeAt === c.id;
        });
        if (activeId && dialogueLines.length > 0) {
          dialogueLines[0].text += `\n\n任务进度：${GameState.getQuestTrackFor(activeId)}`;
        }
      }
      // 检查支线任务
      for (const sq of Object.values(SIDE_QUESTS)) {
        if (sq.acceptFrom !== c.id) continue;
        if (GameState.questCompleted.includes(sq.id)) continue;
        if (GameState.isQuestActive(sq.id)) continue;
        if (sq.prerequisite && !GameState.questCompleted.includes(sq.prerequisite)) continue;
        questChoices.push({ text: `接受支线：${sq.name}`, callback: () => this.acceptQuestFromNPC(c) });
        break;
      }
      // 如果有任务选项，添加到第一行对话
      if (questChoices.length > 0 && dialogueLines.length > 0) {
        if (!dialogueLines[0].choices) dialogueLines[0].choices = [];
        dialogueLines[0].choices!.push(...questChoices);
        dialogueLines[0].choices!.push({ text: '离开', callback: () => { this.isInDialogue = false; } });
      }

      this.npcList.push({ sprite: npc, id: c.id, name: npcDisplayName(c.id), role: c.role, dialogue: dialogueLines, nameTag: tag, x: nx, y: ny, shop: c.shop });
    }
  }

  private createEnemies(): void { _createEnemies(this); }
  private createGatheringPoints(): void {
    this.gatherPoints = [];
    const cfg = ZONE_CONFIGS[GameState.zone] || ZONE_CONFIGS[1];
    for (const pt of cfg.gathering) {
      const gx = pt.x * GAME_WIDTH * 3, gy = pt.y * GAME_HEIGHT * 2;
      const key = `gather_${pt.type}`;
      if (!this.textures.exists(key)) { console.warn('[gather] missing texture ' + key + ', skipped'); continue; }
      const sprite = this.physics.add.sprite(gx, gy, key).setDepth(2);
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
  private acceptQuestFromNPC(npc: { id: string; name?: string; role: string }): void {
    for (const questId of MAIN_QUEST_ORDER) {
      const quest = MAIN_QUESTS[questId];
      if (!quest || quest.acceptFrom !== npc.id) continue;
      if (GameState.questCompleted.includes(questId)) { this.isInDialogue = false; return; }
      if (GameState.isQuestActive(questId)) { this.isInDialogue = false; return; }
      if (quest.prerequisite && !GameState.questCompleted.includes(quest.prerequisite)) { this.isInDialogue = false; return; }
      GameState.acceptQuest(quest);
      this.dialogueBox.show({ speaker: npcDisplayName(npc.id), text: `已接取任务：${quest.name}\n${quest.desc}` }, () => { this.isInDialogue = false; });
      return;
    }
    // 检查支线
    for (const quest of Object.values(SIDE_QUESTS)) {
      if (quest.acceptFrom !== npc.id) continue;
      if (GameState.questCompleted.includes(quest.id)) { this.isInDialogue = false; return; }
      if (GameState.isQuestActive(quest.id)) { this.isInDialogue = false; return; }
      if (quest.prerequisite && !GameState.questCompleted.includes(quest.prerequisite)) { this.isInDialogue = false; return; }
      GameState.acceptQuest(quest);
      this.dialogueBox.show({ speaker: npcDisplayName(npc.id), text: `已接取支线：${quest.name}\n${quest.desc}` }, () => { this.isInDialogue = false; });
      return;
    }
    this.isInDialogue = false;
  }

  /** 通过NPC对话选项完成任务 */
  private completeQuestFromNPC(npc: { id: string; name?: string; role: string }): void {
    // 找本NPC处已就绪的活动任务
    const readyId = GameState.activeQuests.find(id => {
      const q = GameState.getQuestDef(id);
      return !!q && q.completeAt === npc.id && GameState.isQuestReady(id);
    });
    if (!readyId) {
      const activeId = GameState.activeQuests.find(id => {
        const q = GameState.getQuestDef(id);
        return !!q && q.completeAt === npc.id;
      });
      if (activeId) {
        this.dialogueBox.show({ speaker: npcDisplayName(npc.id), text: `任务还未完成。\n${GameState.getQuestTrackFor(activeId)}` }, () => { this.isInDialogue = false; });
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
      this.dialogueBox.show({ speaker: npcDisplayName(npc.id), text: `任务完成：${q.name}\n奖励将稍后到账` }, () => { this.isInDialogue = false; this.tryAutoStartNextQuest(); });
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
      this.dialogueBox.show({ speaker: npcDisplayName(npc.id), text: msg + '\n\n你的斩魄刀已经觉醒了！选择它的真名吧。' }, () => { this.isInDialogue = false; showShikaiSelection(this); });
    } else {
      this.dialogueBox.show({ speaker: npcDisplayName(npc.id), text: msg }, () => { this.isInDialogue = false; this.tryAutoStartNextQuest(); });
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
  

  

  


  

  

  


  


  


  

  public enhanceTab: number = 0;
  


  


  // ═══ Quest Log ═══
  public questLogPanel: Phaser.GameObjects.Container | null = null;

  


  


  // ═══ Bestiary ═══

  // ════════════════ 联机：共享地图房间 ════════════════
  private connectGameRoom(): void { _connectGameRoom(this); }
  private onIntentResult(res: any): void {
    if (!res) return;
    // 静默服务端无意义的填充确认（'ok'）：切鬼道tab、加节点等操作已有面板/UI 实时反馈，无需弹「OK」刷屏
    if (res.ok && (res.msg === 'ok' || res.msg === 'OK' || res.msg === 'Ok' || res.msg === 'OK.')) return;
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
    if (this.statPanel) { closeStatPanel(this, false); renderStatPanel(this); }
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
  private syncRemotePlayers(): void { _syncRemotePlayers(this); }

  private clearRemotePlayers(): void { _clearRemotePlayers(this); }

  /** 联机：上报自己是否处于战斗中（供远端名牌显示「战斗中」标签）。 */
  private setBattling(v: boolean): void { _setBattling(this, v); }

  /** 节流上报移动（~10Hz，仅在确实移动时发）。 */
  private sendMoveThrottled(): void { _sendMoveThrottled(this); }

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
      skills: getAvailableSkills(GameState.zpId, GameState.element, GameState.hasShikai, GameState.hasBankai, false, false, false).map((s) => s.name),
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
  // 组队方法 — 委托到 GameScene.team.ts
  // ═══════════════════════════════════

  private addPendingInvite(data: { fromName: string; fromSid: string; teamId: string }): void { _addPendingInvite(this, data); }
  private removePendingInvite(teamId: string, fromSid: string): void { _removePendingInvite(this, teamId, fromSid); }
  private toggleTeamPanel(): void { _toggleTeamPanel(this); }
  private closeTeamPanel(): void { _closeTeamPanel(this); }
  private openTeamPanel(): void { _openTeamPanel(this); }
  private showInvitePrompt(data: { fromName: string; fromSid: string; teamId: string }): void { _showInvitePrompt(this, data); }
  private showDungeonConfirm(zone: number): void { _showDungeonConfirm(this, zone); }
  private closeDungeonConfirm(): void { _closeDungeonConfirm(this); }
  private renderTeamPanel(): void { _renderTeamPanel(this); }
  private hideTeamPanel(): void { _hideTeamPanel(this); }
  private launchTeamBattle(monsterId: string): void { _launchTeamBattle(this, monsterId); }
  private enterPvpBattle(data: { roomId: string; mode: string; team: string; token: string }): void { _enterPvpBattle(this, data); }
  private routeTeamDungeonBattle(data: { dungeonId?: number; stage?: number }): void { _routeTeamDungeonBattle(this, data); }
  private routeTeamBattleEnd(): void { _routeTeamBattleEnd(this); }
  private routeTeamDungeonStage(stage: number): void { _routeTeamDungeonStage(this, stage); }
  private routeTeamExitDungeon(): void { _routeTeamExitDungeon(this); }
  private stopTeamBattle(): void { _stopTeamBattle(this); }
  private invitePlayer(targetSid: string): void { _invitePlayer(this, targetSid); }
  private teamPanelButton(c: Phaser.GameObjects.Container, x: number, y: number, bw: number, bh: number, label: string, fill: number, textColor: string, cb: () => void): void { _teamPanelButton(this, c, x, y, bw, bh, label, fill, textColor, cb); }
  private makeRemotePlayersInteractable(): void { _makeRemotePlayersInteractable(this); }

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
    if (name && this.chatWhisperTargetEl) this.chatWhisperTargetEl.value = name;
    this.focusChatInput();
    if (name) this.appendChatLine('system', '系统', 0, `正在私聊 ${name}（角色ID ${charId}），直接输入内容发送`);
  }

  /** 按角色名模糊搜索解析私聊目标，返回 charId（0 表示失败 / 需手动用 /w<ID>）。 */
  private async resolveWhisperTarget(name: string): Promise<number> {
    if (!this.authToken || !this.characterId) {
      this.appendChatLine('system', '系统', 0, '未登录，无法搜索角色');
      return 0;
    }
    try {
      const res: any = await CharacterClient.search(this.authToken, this.characterId, name);
      if (!res || !res.ok) { this.appendChatLine('system', '系统', 0, `搜索失败：${res?.msg || '未知错误'}`); return 0; }
      const list: Array<{ charId: number; name: string }> = res.results || [];
      if (list.length === 0) { this.appendChatLine('system', '系统', 0, `未找到角色：${name}`); return 0; }
      if (list.length === 1) {
        const t = list[0];
        if (this.chatWhisperTargetEl) this.chatWhisperTargetEl.value = t.name;
        this.whisperTargetCharId = t.charId;
        return t.charId;
      }
      this.appendChatLine('system', '系统', 0, `找到 ${list.length} 个匹配，请改用 /w<ID> 私聊：`);
      list.slice(0, 10).forEach((t) => this.appendChatLine('system', '系统', 0, `  ${t.name}（ID ${t.charId}）`));
      return 0;
    } catch (e: any) {
      this.appendChatLine('system', '系统', 0, `搜索异常：${e?.message || e}`);
      return 0;
    }
  }
  /** 统一聊天接收：追加到本地日志 + 按频道路由渲染（公会面板聊天区 + 全局 HUD）。 */
  public onChat(msg: { channel: string; fromName: string; fromCharId: number; text: string; ts: number }): void { _onChat(this, msg); }

  private appendChatLine(channel: string, fromName: string, fromCharId: number, text: string): void { _appendChatLine(this, channel, fromName, fromCharId, text); }

  private renderChatLines(): void { _renderChatLines(this); }

  public sendChat(channel: string, text: string, targetCharId = 0): void { _sendChat(this, channel, text, targetCharId); }
  public sendGuildChat(text: string): void { _sendGuildChat(this, text); }

  // ——— 全局聊天 HUD（底部常驻，统一多频道 + 频道标签栏）———
  private createChatHud(): void { _createChatHud(this); }

  /** 频道标签 DOM 引用（用于高亮刷新，DOM 实现免疫相机滚动命中偏移）。 */
  private chatTabEls: HTMLElement[] = [];
  private chatTabBar: HTMLElement | null = null;
  /** scale 'resize' 事件是否已挂接（只挂一次，避免重复监听）。 */
  private chatResizeHooked = false;

  private relayoutChatDom(): void { _relayoutChatDom(this); }

  private switchChatChannel(channelId: string): void { _switchChatChannel(this, channelId); }

  private renderChatTabs(): void { _renderChatTabs(this); }

  private spawnChatInput(): HTMLInputElement { return _spawnChatInput(this); }

  private spawnWhisperTargetInput(): HTMLInputElement { return _spawnWhisperTargetInput(this); }

  private refreshWhisperInputVis(): void { _refreshWhisperInputVis(this); }

  private focusChatInput(): void { _focusChatInput(this); }

  private async submitChat(raw: string): Promise<void> {
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
      else { this.appendChatLine('system', '系统', 0, '私聊请点击"私聊"标签并在右侧输入框填写对方角色名'); return; }
    }
    if (!text) return;
    if (channel === 'guild' && !GameState.guildId) { this.appendChatLine('system', '系统', 0, '你不在公会'); return; }
    if (channel === 'team' && !this.teamId) { this.appendChatLine('system', '系统', 0, '你不在队伍'); return; }
    // whisper：无 /w<ID> 前缀时，从"角色名输入框"解析目标（发完不清空该输入框）
    if (channel === 'whisper' && !targetCharId && this.chatWhisperTargetEl) {
      const nm = this.chatWhisperTargetEl.value.trim();
      if (nm) {
        const cid = await this.resolveWhisperTarget(nm);
        if (!cid) return;
        targetCharId = cid;
      }
    }
    if (channel === 'whisper' && !targetCharId && this.whisperTargetCharId) targetCharId = this.whisperTargetCharId;
    if (channel === 'whisper' && !targetCharId) { this.appendChatLine('system', '系统', 0, '请先填写私聊对象角色名'); return; }
    // 斜杠前缀切换了频道时，同步刷新标签 UI
    if (channel !== this.chatChannel) this.switchChatChannel(channel);
    this.sendChat(channel, text, targetCharId);
  }
}
