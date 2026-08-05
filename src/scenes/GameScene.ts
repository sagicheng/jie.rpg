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
import { fitBody as _fitBody, createEnemies as _createEnemies, createMap as _createMap, createNPCs as _createNPCs, createGatheringPts as _createGatheringPts, updateMiniMap as _updateMiniMap } from './systems/GameScene.map';
import { _create } from './systems/GameScene.create';
import { checkNPCProximity as _checkNPCProximity, onInteractKey as _onInteractKey, tryGather as _tryGather, checkDungeonPortal as _checkDungeonPortal, startDialogue as _startDialogue, checkZoneExit as _checkZoneExit, transitionToZone as _transitionToZone } from './systems/GameScene.interact';

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
  private teamInfoText!: Phaser.GameObjects.Text;
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

  create(): void { _create(this); }
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
    // 队伍信息 HUD（持久 Text + setVisible，参照称号 titleTag 模式）
    if (this.teamId && this.teamMembers.length > 0) {
      const leader = this.teamMembers.find((m: any) => m.sid === this.teamLeaderSid);
      const info = `\u961f\u4f0d (${this.teamMembers.length}/4)  ${leader ? '\u2605 ' + leader.name : ''}`;
      this.teamInfoText.setText(info).setVisible(true);
    } else {
      this.teamInfoText.setVisible(false);
    }
    this.syncPlayerTags();
    this.sendMoveThrottled();
    // 联机：每帧拉取服务端状态并平滑插值远程玩家（含名字）
    this.syncRemotePlayers();
    this.remotePlayers.forEach(rp => {
      const dx = rp.tx - rp.sprite.x, dy = rp.ty - rp.sprite.y;
      rp.sprite.x = Phaser.Math.Linear(rp.sprite.x, rp.tx, 0.25);
      rp.sprite.y = Phaser.Math.Linear(rp.sprite.y, rp.ty, 0.25);
      // 接近目标时吸附到整数像素，消除亚像素抖动（名字标签用 Math.round 时的跳动）
      if (Math.abs(rp.tx - rp.sprite.x) < 0.5 && Math.abs(rp.ty - rp.sprite.y) < 0.5) {
        rp.sprite.x = rp.tx; rp.sprite.y = rp.ty;
      }
      // 远程玩家行走动画：按「目标-当前」向量选朝向与翻转（与本地玩家同逻辑）
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        const facing = Math.abs(dx) > Math.abs(dy) ? 'side' : (dy > 0 ? 'down' : 'up');
        rp.sprite.anims.play('walk_' + facing + '_' + rp.gender, true);
        rp.sprite.setFlipX(Math.abs(dx) > Math.abs(dy) && dx > 0);
      } else if (rp.sprite.anims.isPlaying) {
        // 仅在「移动→静止」瞬间复位一次，避免每帧重复 setTexture 造成抽搐
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
  // ═══ 交互方法 — 委托到 GameScene.interact.ts ═══
  private checkNPCProximity(): void { _checkNPCProximity(this); }
  private onInteractKey(): void { _onInteractKey(this); }
  private tryGather(idx: number): void { _tryGather(this, idx); }
  private checkDungeonPortal(): void { _checkDungeonPortal(this); }
  private startDialogue(npc: NPCData): void { _startDialogue(this, npc); }
  private checkZoneExit(): void { _checkZoneExit(this); }
  private transitionToZone(tz: number, tx: number, ty: number): void { _transitionToZone(this, tz, tx, ty); }

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

  private createMap(): void { _createMap(this); }

  private createNPCs(): void { _createNPCs(this); }

  private createEnemies(): void { _createEnemies(this); }
  private createGatheringPoints(): void { _createGatheringPts(this); }

  private updateMiniMap(): void { _updateMiniMap(this); }
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
