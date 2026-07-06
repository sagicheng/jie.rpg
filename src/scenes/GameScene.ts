import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, ZONE_NAMES, ZANPAKUTO_GROWTH } from '../config';
import { DialogueBox, DialogueLine } from '../ui/DialogueBox';
import { GameState } from '../systems/GameState';
import { createEnemyData, EnemyData, expForLevel, generateLoot } from '../systems/BattleData';
import { getEnemyData, NAMED_ENEMIES, BESTIARY_TIERS, getBestiaryTierReached, getBestiaryTierProgress } from '../systems/BestiaryData';
import { Inventory, EQUIP_TEMPLATES, Item } from '../systems/Inventory';
import { applyConsumable, getConsumableEffect } from '../systems/ConsumableSystem';
import { createPlayerStatus } from '../systems/StatusSystem';
import { SaveManager } from '../systems/SaveManager';
import { ZONE_CONFIGS, ZoneConfig } from '../systems/Zones';
import { MAIN_QUESTS, MAIN_QUEST_ORDER, SIDE_QUESTS, QuestDef } from '../systems/QuestData';
import { SHIKAI_SKILLS, SkillData, ZANPAKUTO_ELEMENT } from '../systems/Skills';
import { Kido, KIDO_NODES, KidoSchool, TIER_LOCK, getKidoColor, getKidoFullName, calcKidoPoints } from '../systems/Kido';
import {
  getEnhanceRate, getEnhanceCost, doEnhance,
  getRefineMaxSlots, getRefineCost, doRefine, doRefineReset,
  getDecompReturn, doDecompose,
  getEnhanceLabel, getRefineDisplay,
} from '../systems/EnhanceSystem';

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
  private static STAT_NAMES: Record<string, string> = {
    hp: 'HP', mp: 'MP', atk: 'ATK', def: 'DEF', matk: 'MATK', mdef: 'MDEF', spd: 'SPD',
  };

  // Core
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private ctrlKey!: Phaser.Input.Keyboard.Key;
  private dialogueBox!: DialogueBox;
  private isInDialogue = false;
  private canInteract = false;
  private currentNPC: NPCData | null = null;
  private moveTarget: { x: number; y: number } | null = null;
  private battleCooldown = 0;
  private menuPauseDepth = 0;

  // HUD
  private zoneText!: Phaser.GameObjects.Text;
  private coordText!: Phaser.GameObjects.Text;
  private promptText!: Phaser.GameObjects.Text;
  private miniMap!: Phaser.GameObjects.Graphics;

  // Worlds
  private npcList: NPCData[] = [];
  private enemies: Array<{ sprite: Phaser.Physics.Arcade.Sprite; data: EnemyData; label: Phaser.GameObjects.Text; respawnTimer?: Phaser.Time.TimerEvent }> = [];
  private enemySprites: Phaser.Physics.Arcade.Sprite[] = [];
  private gatherPoints: Array<{ sprite: Phaser.Physics.Arcade.Sprite; type: string; label: Phaser.GameObjects.Text }> = [];

  // Panels
  private statPanel: Phaser.GameObjects.Container | null = null;
  private inventoryPanel: Phaser.GameObjects.Container | null = null;
  private kidoPanel: Phaser.GameObjects.Container | null = null;
  private kidoTooltip: Phaser.GameObjects.Container | null = null;
  private enhancePanel: Phaser.GameObjects.Container | null = null;
  private bestiaryPanel: Phaser.GameObjects.Container | null = null;
  private bestiaryDetailContainer: Phaser.GameObjects.Container | null = null;
  private namingPanelActive = false;

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data?: { newGame?: boolean }): void {
    if (data?.newGame) {
      GameState.reset();
      GameState.x = 400;
      GameState.y = 500;
      GameState.zone = 1;
      GameState.newGame = true;
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
    this.enemySprites = [];
    this.gatherPoints = [];
    this.moveTarget = null;
    this.isInDialogue = false;
    this.canInteract = false;
    this.currentNPC = null;

    this.createMap();
    this.dialogueBox = new DialogueBox(this);
    this.physics.world.setBounds(0, 0, GAME_WIDTH * 3, GAME_HEIGHT * 2);

    this.player = this.physics.add.sprite(GameState.x, GameState.y, 'player')
      .setDepth(10).setCollideWorldBounds(true);
    this.player.body!.setSize(24, 32);
    this.player.body!.setOffset(4, 0);

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
    this.interactKey = this.input.keyboard!.addKey('F');
    this.input.keyboard!.addKey('B').on('down', () => { if (!this.isInDialogue && !this.statPanel) this.toggleInventory(); });
    this.input.keyboard!.addKey('C').on('down', () => { if (!this.isInDialogue && !this.inventoryPanel) this.toggleStatPanel(); });
    this.input.keyboard!.addKey('K').on('down', () => {
      if (!this.isInDialogue && !this.inventoryPanel && !this.statPanel) this.showKidoPanel();
    });
    this.input.keyboard!.addKey('N').on('down', () => {
      if (!this.isInDialogue && !this.inventoryPanel && !this.statPanel && !this.kidoPanel && !this.enhancePanel)
        this.toggleBestiaryPanel();
    });
    this.input.keyboard!.addKey('L').on('down', () => {
      if (!this.isInDialogue && !this.inventoryPanel && !this.statPanel && !this.kidoPanel && !this.enhancePanel && !this.bestiaryPanel)
        this.toggleQuestLog();
    });
    this.input.keyboard!.addKey('ESC').on('down', () => {
      if (this.inventoryPanel) { this.closeInventory(); return; }
      if (this.statPanel) { this.closeStatPanel(); return; }
      if (this.kidoPanel) { this.closeKidoPanel(); return; }
      if (this.enhancePanel) { this.closeEnhancePanel(); return; }
      if (this.bestiaryPanel) { this.closeBestiaryPanel(); return; }
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
      if (this.isInDialogue || this.statPanel || this.inventoryPanel || this.kidoPanel || this.enhancePanel || this.bestiaryPanel || this.questLogPanel || this.namingPanelActive) return;
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.moveTarget = { x: wp.x, y: wp.y };
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

    this.zoneText = this.add.text(16, 12, `${GameState.playerName} · ${ZONE_NAMES[GameState.zone]}`, {
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
    this.scene.launch('UIScene');

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
    this.checkNPCProximity(); this.checkGatherProximity(); this.checkZoneExit();
    this.checkInteract(); this.updateMiniMap(); this.checkEnemyCollision();
    GameState.x = this.player.x; GameState.y = this.player.y;
    if (this.battleCooldown > 0) this.battleCooldown--;
    this.coordText.setText(`X:${Math.round(this.player.x)}  Y:${Math.round(this.player.y)}`);
  }

  private pauseForMenu(): void { this.menuPauseDepth++; if (this.menuPauseDepth === 1) this.physics.pause(); }
  private resumeFromMenu(): void { this.menuPauseDepth = Math.max(0, this.menuPauseDepth - 1); if (this.menuPauseDepth === 0) this.physics.resume(); }

  // ═══ NPC ═══
  private checkNPCProximity(): void {
    this.canInteract = false; this.currentNPC = null; let closestDist = Infinity;
    for (const npc of this.npcList) { const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, npc.sprite.x, npc.sprite.y); if (dist < 50 && dist < closestDist) { closestDist = dist; this.currentNPC = npc; this.canInteract = true; } }
    if (this.canInteract && this.currentNPC) { this.promptText.setText(`按 F 与 ${this.currentNPC.name} 对话`); this.promptText.setPosition(this.currentNPC.sprite.x, this.currentNPC.sprite.y - 50); this.promptText.setVisible(true); }
    else { this.promptText.setVisible(false); }
  }
  private checkInteract(): void { if (Phaser.Input.Keyboard.JustDown(this.interactKey) && this.canInteract && this.currentNPC) this.startDialogue(this.currentNPC); }
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
    for (const exit of cfg.exits) { const ex = exit.x * GAME_WIDTH * 3, ey = exit.y * GAME_HEIGHT * 2; const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, ex, ey); if (dist < 60) { this.promptText.setText(`按 F 前往 ${ZONE_NAMES[exit.targetZone]}`); this.promptText.setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60); this.promptText.setVisible(true); if (Phaser.Input.Keyboard.JustDown(this.interactKey)) this.transitionToZone(exit.targetZone, exit.targetX * GAME_WIDTH * 3, exit.targetY * GAME_HEIGHT * 2); return; } }
    if (!this.canInteract) this.promptText.setVisible(false);
  }
  private transitionToZone(tz: number, tx: number, ty: number): void {
    this.isInDialogue = true; GameState.zone = tz; GameState.x = tx; GameState.y = ty; this.battleCooldown = 60;
    if (!GameState.discoveredZones.includes(tz)) GameState.discoveredZones.push(tz);
    GameState.updateQuestProgress('reach', ZONE_NAMES[tz] || '', 1);
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.enemies.forEach(e => { e.sprite.destroy(); e.label.destroy(); }); this.enemies = []; this.enemySprites = [];
      this.npcList.forEach(n => { n.sprite.destroy(); n.nameTag.destroy(); }); this.npcList = [];
      this.children.each((c2: any) => { if (c2.type === 'Graphics' && [0,3,4].includes(c2.depth||-1)) c2.destroy(); if (c2.type === 'Text' && [4,6].includes(c2.depth||-1)) c2.destroy(); });
      this.createMap(); this.createNPCs(); this.createEnemies(); this.createGatheringPoints();
      this.zoneText.setText(`${GameState.playerName} · ${ZONE_NAMES[GameState.zone]}`);
      this.player.setPosition(tx, ty); this.isInDialogue = false; this.cameras.main.fadeIn(400,0,0,0); SaveManager.save();
      const b = this.add.text(GAME_WIDTH/2, GAME_HEIGHT/2-40, ZONE_NAMES[tz], {fontSize:'28px',color:'#ffe8b0',fontStyle:'bold',backgroundColor:'#000000aa',padding:{x:24,y:12}}).setOrigin(0.5).setScrollFactor(0).setDepth(250).setAlpha(0);
      this.tweens.add({targets:b,alpha:1,duration:500,onComplete:()=>{this.tweens.add({targets:b,alpha:0,duration:1200,delay:1000,onComplete:()=>b.destroy()});}});
    });
  }

  // ═══ Enemies ═══
  private checkEnemyCollision(): void { if (this.battleCooldown > 0 || this.isInDialogue) return; for (const en of this.enemies) { if (en.data.hp<=0) continue; if (Phaser.Math.Distance.Between(this.player.x,this.player.y,en.sprite.x,en.sprite.y)<50){this.battleCooldown=180;this.scene.pause();this.scene.launch('BattleScene',{template:en.data,enemyRef:en,zone:GameState.zone});return;} } }
  onBattleEnd(result: string, er: any): void {
    this.input.keyboard!.resetKeys(); this.physics.resume(); this.menuPauseDepth = 0;
    if (result === 'defeat') { this.player.x=400;this.player.y=500;GameState.hp=GameState.maxHp;GameState.mp=GameState.maxMp;return; }
    const a=Phaser.Math.Angle.Between(er.sprite.x,er.sprite.y,this.player.x,this.player.y);this.player.x+=Math.cos(a)*80;this.player.y+=Math.sin(a)*80;
    if (result === 'victory') {
      const ib=er.data.type==='妖将'||er.data.type==='妖王';
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

      er.data.hp=0;er.sprite.setVisible(false);er.sprite.setActive(false).setPosition(-9999,-9999);er.label.setVisible(false);
      if (er.respawnTimer) er.respawnTimer.destroy();
      const d=ib?7200000:er.data.type==='恶妖'?300000:30000;
      er.respawnTimer=this.time.delayedCall(d,()=>{er.data.hp=er.data.maxHp;er.sprite.setVisible(true);er.sprite.setActive(true).setPosition(er.sprite.x,er.sprite.y);er.label.setVisible(true);if(ib){this.tweens.add({targets:er.sprite,scaleX:1.65,scaleY:1.55,duration:1500,yoyo:true,repeat:-1,ease:'Sine.easeInOut'});}});
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
  }

  private createNPCs(): void {
    const cfg = ZONE_CONFIGS[GameState.zone] || ZONE_CONFIGS[1];
    for (const c of cfg.npcs) {
      const nx = c.x * GAME_WIDTH * 3, ny = c.y * GAME_HEIGHT * 2;
      const npc = this.physics.add.sprite(nx, ny, 'npc').setImmovable(true).setDepth(5);
      const tag = this.add.text(nx, ny - 30, c.name, {
        fontSize: '11px',
        color: c.role === 'merchant' ? '#ffdd88' : c.role === 'return_point' ? '#88ccff' : c.role === 'craft' ? '#aa88ff' : c.role === 'enhance' ? '#ff8844' : '#ffe8b0',
        backgroundColor: '#00000088', padding: { x: 4, y: 2 },
      }).setOrigin(0.5).setDepth(6);
      this.tweens.add({ targets: npc, scaleY: 1.03, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

      const dialogueLines: DialogueLine[] = c.dialogue.map((d, i) => {
        const line: DialogueLine = { speaker: d.speaker, text: d.text };
        if (d.choices && i === 0) {
          line.choices = d.choices.map(ch => ({
            text: ch.text,
            callback: () => {
              if (ch.callback === 'openShop') this.openShop(c.shop || []);
              else if (ch.callback === 'showBlacksmithLore') this.showBlacksmithLore();
              else if (ch.callback === 'acceptQuest') this.acceptQuestFromNPC(c.name);
              else if (ch.callback === 'completeQuest') this.completeQuestFromNPC(c.name);
              else if (ch.callback === 'closeDialogue') this.isInDialogue = false;
              else if (ch.callback === 'openReturn') this.openReturn();
              else if (ch.callback === 'openCraft') this.openCraft();
              else if (ch.callback === 'openEnhance') { this.isInDialogue = false; this.toggleEnhancePanel(); }
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
        if (GameState.activeQuest === questId) continue;
        if (quest.prerequisite && !GameState.questCompleted.includes(quest.prerequisite)) continue;
        questChoices.push({ text: `接受任务：${quest.name}`, callback: () => this.acceptQuestFromNPC(c.name) });
        break;
      }
      // 检查是否有可完成的任务
      if (GameState.activeQuest) {
        const activeDef = GameState.getActiveQuestDef();
        if (activeDef && activeDef.completeAt === c.name) {
          if (GameState.questReadyToComplete) {
            questChoices.push({ text: `完成任务：${activeDef.name}`, callback: () => this.completeQuestFromNPC(c.name) });
          } else {
            // 任务进行中，在对话文本中显示进度
            if (dialogueLines.length > 0) {
              dialogueLines[0].text += `\n\n任务进度：${GameState.getQuestTrackText()}`;
            }
          }
        }
      }
      // 检查支线任务
      for (const sq of Object.values(SIDE_QUESTS)) {
        if (sq.acceptFrom !== c.name) continue;
        if (GameState.questCompleted.includes(sq.id)) continue;
        if (GameState.activeQuest === sq.id) continue;
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
    for (const e of cfg.enemies) {
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
      this.enemies.push({ sprite, data, label });
      this.enemySprites.push(sprite);
    }
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

  private checkGatherProximity(): void {
    if (this.isInDialogue) return;
    for (const pt of this.gatherPoints) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, pt.sprite.x, pt.sprite.y);
      if (dist < 55 && Phaser.Input.Keyboard.JustDown(this.interactKey)) {
        this.isInDialogue = true;
        const matNames: Record<string, string> = { '\u77ff\u8109': '\u94c1\u77ff\u77f3', '\u836f\u8349': '\u6b62\u8840\u8349', '\u7075\u6728': '\u7075\u6728\u679d', '\u7075\u8109': '\u7075\u529b\u6c34' };
        const matName = matNames[pt.type] || pt.type;
        GameState.updateQuestProgress('collect', pt.type, 1);
        Inventory.addItem({ id: `mat_${pt.type}`, name: matName, type: 'material', desc: '\u91ce\u5916\u91c7\u96c6\u83b7\u5f97', quantity: 1 });
        pt.sprite.setVisible(false); pt.label.setVisible(false);
        this.time.delayedCall(30000, () => { pt.sprite.setVisible(true); pt.label.setVisible(true); });
        const notif = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 80, `\u83b7\u5f97\uff1a${matName}`, { fontSize: '18px', color: '#88ff88', fontStyle: 'bold', backgroundColor: '#112211cc', padding: { x: 16, y: 8 } }).setOrigin(0.5).setScrollFactor(0).setDepth(300);
        this.tweens.add({ targets: notif, alpha: 0, y: GAME_HEIGHT / 2 - 100, duration: 1500, onComplete: () => notif.destroy() });
        this.time.delayedCall(300, () => { this.isInDialogue = false; });
        return;
      }
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
    }
    this.miniMap.fillStyle(0x44aaff, 1);
    this.miniMap.fillCircle(mmX + this.player.x * sx, mmY + this.player.y * sy, 3);
    this.npcList.forEach(npc => {
      const ndx = mmX + npc.x * sx, ndy = mmY + npc.y * sy;
      const color = npc.role === 'merchant' ? 0xffdd44 : npc.role === 'return_point' ? 0x88ccff : npc.role === 'craft' ? 0xaa88ff : npc.role === 'enhance' ? 0xff8844 : 0x44cc44;
      this.miniMap.fillStyle(color, 0.8); this.miniMap.fillCircle(ndx, ndy, 2);
    });
  }
  private acceptQuest(): void { this.isInDialogue = false; this.tryAutoStartNextQuest(); }

  /** 通过NPC对话选项接取任务 */
  private acceptQuestFromNPC(npcName: string): void {
    for (const questId of MAIN_QUEST_ORDER) {
      const quest = MAIN_QUESTS[questId];
      if (!quest || quest.acceptFrom !== npcName) continue;
      if (GameState.questCompleted.includes(questId)) { this.isInDialogue = false; return; }
      if (GameState.activeQuest === questId) { this.isInDialogue = false; return; }
      if (quest.prerequisite && !GameState.questCompleted.includes(quest.prerequisite)) { this.isInDialogue = false; return; }
      GameState.acceptQuest(quest);
      this.dialogueBox.show({ speaker: npcName, text: `已接取任务：${quest.name}\n${quest.desc}` }, () => { this.isInDialogue = false; });
      return;
    }
    // 检查支线
    for (const quest of Object.values(SIDE_QUESTS)) {
      if (quest.acceptFrom !== npcName) continue;
      if (GameState.questCompleted.includes(quest.id)) { this.isInDialogue = false; return; }
      if (GameState.activeQuest === quest.id) { this.isInDialogue = false; return; }
      if (quest.prerequisite && !GameState.questCompleted.includes(quest.prerequisite)) { this.isInDialogue = false; return; }
      GameState.acceptQuest(quest);
      this.dialogueBox.show({ speaker: npcName, text: `已接取支线：${quest.name}\n${quest.desc}` }, () => { this.isInDialogue = false; });
      return;
    }
    this.isInDialogue = false;
  }

  /** 通过NPC对话选项完成任务 */
  private completeQuestFromNPC(npcName: string): void {
    if (!GameState.activeQuest) { this.isInDialogue = false; return; }
    const q = GameState.getActiveQuestDef();
    if (!q || q.completeAt !== npcName) { this.isInDialogue = false; return; }
    if (!GameState.questReadyToComplete) {
      this.dialogueBox.show({ speaker: npcName, text: `任务还未完成。\n${GameState.getQuestTrackText()}` }, () => { this.isInDialogue = false; });
      return;
    }
    GameState.completeQuest(q.id);
    let msg = `任务完成：${q.name}`;
    if (q.rewards.gold) { GameState.gold += q.rewards.gold; msg += `\n金币+${q.rewards.gold}`; }
    if (q.rewards.exp) { const lv = GameState.gainExp(q.rewards.exp); msg += `\n经验+${q.rewards.exp}`; if (lv) msg += `\n★升级！Lv.${GameState.level}`; }
    if (q.rewards.items) { for (const it of q.rewards.items) { Inventory.addItem({ id: it.id, name: it.name, type: 'consumable' as any, desc: '', quantity: it.count }); msg += `\n${it.name}×${it.count}`; } }
    if (q.rewards.unlock) { GameState.addUnlock(q.rewards.unlock); msg += `\n解锁：${q.rewards.unlock}`; }
    this.scene.get('UIScene').events.emit('updateStats');
    if (q.id === 'shikai_trial' && !GameState.hasShikai) {
      this.dialogueBox.show({ speaker: npcName, text: msg + '\n\n你的斩魄刀已经觉醒了！选择它的真名吧。' }, () => { this.isInDialogue = false; this.showShikaiSelection(); });
    } else {
      this.dialogueBox.show({ speaker: npcName, text: msg }, () => { this.isInDialogue = false; this.tryAutoStartNextQuest(); });
    }
  }

  private startIntroDialogue(): void {
    this.isInDialogue = true;
    this.dialogueBox.show({ speaker: '???', text: '你能看见我吗？那就说明你拥有死神的力量。告诉我，你的名字。' }, () => {
      this.isInDialogue = false; this.showNamingInput();
    });
  }

  private showNamingInput(): void {
    this.namingPanelActive = true;
    const panel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60).setDepth(400);
    const bg = this.add.graphics();
    bg.fillStyle(0x121222, 0.98); bg.fillRoundedRect(-300, -100, 600, 200, 12);
    bg.lineStyle(2, 0x4a5a8a, 0.6); bg.strokeRoundedRect(-300, -100, 600, 200, 12);
    panel.add(bg);
    panel.add(this.add.text(0, -70, '输入你的名字', { fontSize: '20px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));

    // 使用原生HTML input支持中文输入
    const inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.maxLength = 12;
    inputEl.style.cssText = 'position:absolute;width:360px;height:36px;font-size:18px;color:#ffffff;background:#0a0a1e;border:1px solid #446688;border-radius:4px;text-align:center;outline:none;z-index:9999;';
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / GAME_WIDTH;
    const scaleY = rect.height / GAME_HEIGHT;
    inputEl.style.left = (rect.left + rect.width / 2 - 180 * scaleX) + 'px';
    inputEl.style.top = (rect.top + (GAME_HEIGHT / 2 - 80) * scaleY) + 'px';
    inputEl.style.width = (360 * scaleX) + 'px';
    inputEl.style.height = (36 * scaleY) + 'px';
    document.body.appendChild(inputEl);
    inputEl.focus();

    panel.add(this.add.text(0, 12, '（输入名字后点击确认）', { fontSize: '11px', color: '#667788', padding: { y: 1 } }).setOrigin(0.5));

    const cleanup = () => {
      if (inputEl.parentNode) inputEl.parentNode.removeChild(inputEl);
      this.namingPanelActive = false;
    };

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doConfirm(); }
    });

    const doConfirm = () => {
      const name = inputEl.value.trim() || '隐世';
      cleanup();
      GameState.playerName = name;
      GameState.hasCreated = true;
      panel.destroy(true);
      this.time.delayedCall(300, () => {
        this.isInDialogue = true;
        this.dialogueBox.show({
          speaker: '浦原喜助',
          text: `${name}……好名字。你的灵魂中寄宿着一种元素之力——火、风、水、土。选择你的元素共鸣吧。`
        }, () => { this.isInDialogue = false; this.showElementSelection(); });
      });
    };

    const confirm = this.add.text(0, 50, '[ 确认 ]', {
      fontSize: '16px', color: '#88cc88', fontStyle: 'bold', padding: { x: 24, y: 8 },
      backgroundColor: '#11221188',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    confirm.on('pointerover', () => { confirm.setColor('#aaffaa'); confirm.setBackgroundColor('#224422aa'); });
    confirm.on('pointerout', () => { confirm.setColor('#88cc88'); confirm.setBackgroundColor('#11221188'); });
    confirm.on('pointerdown', () => doConfirm());
    panel.add(confirm);
  }

  private showElementSelection(): void {
    this.isInDialogue = true;
    const elements = ['\u706b', '\u98ce', '\u6c34', '\u571f'];
    const colors: Record<string, string> = { '\u706b': '#ff6644', '\u98ce': '#44cc88', '\u6c34': '#4488ff', '\u571f': '#cc9944' };
    const desc: Record<string, string> = { '\u706b': '\u5f3a\u653b\u578b\uff0cATK+10%', '\u98ce': '\u654f\u6377\u578b\uff0cSPD+10%', '\u6c34': '\u5747\u8861\u578b\uff0cHP+5% MP+5%', '\u571f': '\u9632\u5fa1\u578b\uff0cDEF+10%' };
    const panel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 30).setDepth(400);
    const bg = this.add.graphics();
    bg.fillStyle(0x1a1a2e, 0.95); bg.fillRoundedRect(-250, -100, 500, 200, 10);
    bg.lineStyle(2, 0xc9a96e, 0.7); bg.strokeRoundedRect(-250, -100, 500, 200, 10);
    panel.add(bg);
    panel.add(this.add.text(0, -70, '选择你的元素共鸣', { fontSize: '20px', color: '#ffe8b0', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));
    elements.forEach((el, i) => {
      const ex = -180 + i * 120;
      const card = this.add.graphics();
      card.fillStyle(parseInt(colors[el].replace('#', ''), 16), 0.2); card.fillRoundedRect(ex - 45, -25, 90, 80, 6);
      card.lineStyle(2, parseInt(colors[el].replace('#', ''), 16), 0.6); card.strokeRoundedRect(ex - 45, -25, 90, 80, 6);
      panel.add(card);
      panel.add(this.add.text(ex, -15, el, { fontSize: '22px', color: colors[el], fontStyle: 'bold', padding: { y: 2 } }).setOrigin(0.5));
      panel.add(this.add.text(ex, 10, desc[el], { fontSize: '9px', color: '#aaaacc', wordWrap: { width: 80 }, padding: { y: 1 } }).setOrigin(0.5));
      card.setInteractive(new Phaser.Geom.Rectangle(ex - 45, -25, 90, 80), Phaser.Geom.Rectangle.Contains);
      card.on('pointerover', () => { card.clear(); card.fillStyle(parseInt(colors[el].replace('#', ''), 16), 0.4); card.fillRoundedRect(ex - 45, -25, 90, 80, 6); card.lineStyle(2, parseInt(colors[el].replace('#', ''), 16), 0.9); card.strokeRoundedRect(ex - 45, -25, 90, 80, 6); });
      card.on('pointerout', () => { card.clear(); card.fillStyle(parseInt(colors[el].replace('#', ''), 16), 0.2); card.fillRoundedRect(ex - 45, -25, 90, 80, 6); card.lineStyle(2, parseInt(colors[el].replace('#', ''), 16), 0.6); card.strokeRoundedRect(ex - 45, -25, 90, 80, 6); });
      card.on('pointerdown', () => {
        GameState.element = el;
        GameState.recalcStats();
        panel.destroy(true);
        this.time.delayedCall(300, () => {
          this.isInDialogue = true;
          this.dialogueBox.show({
            speaker: '浦原喜助',
            text: `${el}元素……你的灵魂中寄宿着这种力量。现在去探索空座町吧，和镇上的人聊聊，可能会有需要你帮助的人。`
          }, () => {
            this.isInDialogue = false;
            this.scene.get('UIScene').events.emit('updateStats');
            SaveManager.save();
            this.tryAutoStartNextQuest();
          });
        });
      });
    });
  }

  private showShikaiSelection(): void {
    // \u4eceZANPAKUTO_ELEMENT\u8bfb\u53d6\u5f53\u524d\u5143\u7d20\u7684\u5168\u90e89\u628a\u65a9\u9b44\u5200
    const el = GameState.element || '\u706b';
    const zanList = Object.entries(ZANPAKUTO_ELEMENT)
      .filter(([_, e]) => e === el)
      .map(([name]) => name);

    this.isInDialogue = true;
    const panel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(400);
    const bg = this.add.graphics();
    bg.fillStyle(0x121222, 0.98); bg.fillRoundedRect(-560, -340, 1120, 680, 14);
    bg.lineStyle(2, 0x4a5a8a, 0.6); bg.strokeRoundedRect(-560, -340, 1120, 680, 14);
    panel.add(bg);

    // \u6807\u9898\u680f
    const tb = this.add.graphics(); tb.fillStyle(0x1a1a36, 1);
    tb.fillRoundedRect(-556, -336, 1112, 50, { tl: 10, tr: 10, bl: 0, br: 0 }); panel.add(tb);
    const elNames: Record<string, string> = { '\u706b': '\u706b\u7cfb', '\u98ce': '\u98ce\u7cfb', '\u6c34': '\u6c34\u7cfb', '\u571f': '\u571f\u7cfb' };
    panel.add(this.add.text(0, -311, '\u25c6  ' + (elNames[el] || el) + '\u59cb\u89e3\u65a9\u9b44\u5200\u9009\u62e9  \u25c6', {
      fontSize: '20px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));

    const elColors: Record<string, number> = { '\u706b': 0xff6644, '\u98ce': 0x44cc88, '\u6c34': 0x4488ff, '\u571f': 0xcc9944 };
    const elColor = elColors[el] || 0x888888;

    // 3\u00d73\u7f51\u683c\u5c55\u793a9\u628a\u65a9\u9b44\u5200
    const cols = 3, cardW = 340, cardH = 170, gapX = 16, gapY = 14;
    const startX = -(cols * cardW + (cols - 1) * gapX) / 2;
    const startY = -270;

    zanList.forEach((zan, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const zx = startX + col * (cardW + gapX);
      const zy = startY + row * (cardH + gapY);

      // \u5361\u7247\u80cc\u666f
      const card = this.add.graphics();
      card.fillStyle(0x0d0d1d, 0.8); card.fillRoundedRect(zx, zy, cardW, cardH, 8);
      card.lineStyle(1, elColor, 0.3); card.strokeRoundedRect(zx, zy, cardW, cardH, 8);
      panel.add(card);

      // \u540d\u79f0
      panel.add(this.add.text(zx + 12, zy + 8, zan, {
        fontSize: '16px', color: '#ffe8b0', fontStyle: 'bold', padding: { y: 2 } }));

      // \u6210\u957f\u7387\u63cf\u8ff0
      const growth = ZANPAKUTO_GROWTH[zan] || {};
      const topStats = Object.entries(growth)
        .filter(([k]) => k !== 'statusAcc')
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .slice(0, 3)
        .map(([k, v]) => `${k} ${v}`);
      panel.add(this.add.text(zx + 12, zy + 32, topStats.join('  |  '), {
        fontSize: '10px', color: '#8899bb', padding: { y: 1 } }));

      // \u6280\u80fd\u4fe1\u606f
      const skills = SHIKAI_SKILLS[zan];
      if (skills && skills.length > 0) {
        const sInfo = skills.slice(0, 2).map(s => `\u2726 ${s.name} [\u5a01${s.power}]`).join('\n');
        panel.add(this.add.text(zx + 12, zy + 52, sInfo, {
          fontSize: '10px', color: '#ddaabb', padding: { y: 1 } }));
        if (skills[0].desc) {
          panel.add(this.add.text(zx + 12, zy + 92, skills[0].desc, {
            fontSize: '9px', color: '#778899', wordWrap: { width: cardW - 24 }, padding: { y: 1 } }));
        }
      }

      // \u72b6\u6001\u63a7\u5236\u6807\u8bb0
      if (growth.statusAcc) {
        panel.add(this.add.text(zx + cardW - 60, zy + 8, '\u63a7\u5236', {
          fontSize: '9px', color: '#cc88ff', fontStyle: 'bold',
          backgroundColor: '#22114488', padding: { x: 4, y: 1 } }));
      }

      // \u9009\u62e9\u6309\u94ae
      const sel = this.add.text(zx + cardW / 2, zy + cardH - 22, '[ \u9009\u62e9\u6b64\u5200 ]', {
        fontSize: '13px', color: '#ffcc44', fontStyle: 'bold',
        backgroundColor: '#33220088', padding: { x: 16, y: 5 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      sel.on('pointerover', () => { sel.setColor('#ffff88'); sel.setBackgroundColor('#443300aa'); });
      sel.on('pointerout', () => { sel.setColor('#ffcc44'); sel.setBackgroundColor('#33220088'); });
      sel.on('pointerdown', () => {
        GameState.zanpakuto = zan; GameState.addUnlock('shikai');
        GameState.recalcStats();
        panel.destroy(true);
        this.time.delayedCall(300, () => {
          this.isInDialogue = true;
          this.dialogueBox.show({
            speaker: '\u6d66\u539f\u559c\u52a9',
            text: `${zan}\u2026\u2026\u5b83\u4e0a\u9762\u6709\u5148\u9063\u961f\u7684\u5370\u8bb0\u3002\u4f60\u5df2\u7ecf\u89e6\u6478\u5230\u59cb\u89e3\u7684\u95e8\u69db\u4e86\u3002\u53bb\u6d66\u539f\u5546\u5e97\u8857\u5427\uff0c\u90a3\u91cc\u6709\u4f60\u9700\u8981\u7684\u88c5\u5907\u3002`
          }, () => {
            this.isInDialogue = false;
            this.scene.get('UIScene').events.emit('updateStats');
            SaveManager.save();
            this.tryAutoStartNextQuest();
          });
        });
      });
      panel.add(sel);
    });

    // \u5173\u95ed\u6309\u94ae
    panel.add(this.add.text(530, -316, '\u2715', {
      fontSize: '22px', color: '#cc6666', padding: { x: 8, y: 4 } }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', function (this: any) { this.setColor('#ff8888'); })
      .on('pointerout', function (this: any) { this.setColor('#cc6666'); })
      .on('pointerdown', () => { panel.destroy(true); this.isInDialogue = false; }));

    // \u5e95\u90e8\u63d0\u793a
    panel.add(this.add.text(0, 320, '\u70b9\u51fb\u9009\u62e9\u4f60\u7684\u59cb\u89e3\u65a9\u9b44\u5200\uff0c\u9009\u5b9a\u540e\u4e0d\u53ef\u66f4\u6539', {
      fontSize: '11px', color: '#556688', padding: { y: 2 } }).setOrigin(0.5));
  }

  private handleQuestNPC(npc: NPCData): boolean {
    // 检查是否可以完成当前任务
    if (GameState.activeQuest) {
      const activeDef = GameState.getActiveQuestDef();
      if (activeDef && activeDef.completeAt === npc.name) {
        if (GameState.questReadyToComplete) {
          // 完成任务
          GameState.completeQuest(activeDef.id);
          // 发奖励
          let rewardMsg = `任务完成：${activeDef.name}`;
          if (activeDef.rewards.gold) { GameState.gold += activeDef.rewards.gold; rewardMsg += `\n金币+${activeDef.rewards.gold}`; }
          if (activeDef.rewards.exp) { const lv = GameState.gainExp(activeDef.rewards.exp); rewardMsg += `\n经验+${activeDef.rewards.exp}`; if (lv) rewardMsg += `\n★升级！Lv.${GameState.level}`; }
          if (activeDef.rewards.items) { for (const it of activeDef.rewards.items) { Inventory.addItem({ id: it.id, name: it.name, type: 'consumable' as any, desc: '', quantity: it.count }); rewardMsg += `\n${it.name}×${it.count}`; } }
          if (activeDef.rewards.unlock) { GameState.addUnlock(activeDef.rewards.unlock); rewardMsg += `\n解锁：${activeDef.rewards.unlock}`; }
          this.scene.get('UIScene').events.emit('updateStats');
          // 始解试炼完成 → 触发始解选择
          if (activeDef.id === 'shikai_trial' && !GameState.hasShikai) {
            this.dialogueBox.show({ speaker: npc.name, text: rewardMsg + '\n\n你的斩魄刀已经觉醒了！选择它的真名吧。' }, () => {
              this.isInDialogue = false;
              this.showShikaiSelection();
            });
          } else {
            this.dialogueBox.show({ speaker: npc.name, text: rewardMsg }, () => {
              this.isInDialogue = false;
              this.tryAutoStartNextQuest();
            });
          }
          return true;
        } else {
          // 任务未完成
          const track = GameState.getQuestTrackText();
          this.dialogueBox.show({ speaker: npc.name, text: `任务还未完成。\n${track}` }, () => { this.isInDialogue = false; });
          return true;
        }
      }
    }

    // 检查是否可以接取新任务
    for (const questId of MAIN_QUEST_ORDER) {
      const quest = MAIN_QUESTS[questId];
      if (!quest) continue;
      if (quest.acceptFrom !== npc.name) continue;
      if (GameState.questCompleted.includes(questId)) continue;
      if (GameState.activeQuest === questId) continue;
      // 检查前置任务
      if (quest.prerequisite && !GameState.questCompleted.includes(quest.prerequisite)) continue;
      // 接取任务
      GameState.acceptQuest(quest);
      this.dialogueBox.show({ speaker: npc.name, text: `${quest.name}\n${quest.desc}\n\n已接取任务。` }, () => { this.isInDialogue = false; });
      return true;
    }

    return false;
  }

  private tryAutoStartNextQuest(): void {
    if (GameState.activeQuest) return; // 已有活跃任务
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
  private openShop(_s: any[]): void {
    this.isInDialogue = false; this.pauseForMenu();
    const shopItems = _s;
    const cam = this.cameras.main; const panel = this.add.container(Math.round(cam.scrollX) + GAME_WIDTH / 2, Math.round(cam.scrollY) + GAME_HEIGHT / 2 - 30).setDepth(310);
    const bg = this.add.graphics(); bg.fillStyle(0x1a1a2e, 0.97); bg.fillRoundedRect(-400, -260, 800, 520, 12); bg.lineStyle(2, 0xc9a96e, 0.7); bg.strokeRoundedRect(-400, -260, 800, 520, 12); panel.add(bg);
    panel.add(this.add.text(0, -230, '商店', { fontSize: '22px', color: '#c9a96e', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));
    panel.add(this.add.text(0, -200, `金币: ${GameState.gold}`, { fontSize: '14px', color: '#ffcc44', padding: { y: 2 } }).setOrigin(0.5));
    shopItems.forEach((item, i) => {
      const row = Math.floor(i / 2), col = i % 2, sx = -370 + col * 380, sy = -160 + row * 64;
      const card = this.add.graphics(); card.fillStyle(0x111122, 0.6); card.fillRoundedRect(sx, sy, 360, 56, 6); card.lineStyle(1, 0x334466, 0.5); card.strokeRoundedRect(sx, sy, 360, 56, 6); panel.add(card);
      panel.add(this.add.text(sx + 12, sy + 6, item.name, { fontSize: '13px', color: '#ddddff', fontStyle: 'bold', padding: { y: 2 } }));
      const st = typeof item.stats === 'object' ? Object.entries(item.stats as Record<string, number>).map(([k, v]) => `${k}+${v}`).join(' ') : '';
      panel.add(this.add.text(sx + 12, sy + 30, st || item.desc || '', { fontSize: '10px', color: '#8888aa', padding: { y: 1 } }));
      panel.add(this.add.text(sx + 260, sy + 18, `${item.price} 金币`, { fontSize: '12px', color: '#ffcc44', padding: { y: 2 } }));
      const canBuy = GameState.gold >= item.price;
      const buyBtn = this.add.text(sx + 300, sy + 8, '[购买]', { fontSize: '12px', color: canBuy ? '#44cc44' : '#666666', fontStyle: 'bold', padding: { x: 6, y: 4 } }).setInteractive({ useHandCursor: true });
      if (canBuy) { buyBtn.on('pointerover', () => buyBtn.setColor('#88ff88')); buyBtn.on('pointerout', () => buyBtn.setColor('#44cc44')); buyBtn.on('pointerdown', () => { GameState.gold -= item.price; const boughtItem = { id: item.id, name: item.name, type: 'equipment' as any, desc: item.desc || '', quantity: 1, slot: item.slot, stats: item.stats, quality: item.quality || 'white' }; Inventory.addItem(boughtItem); Inventory.equip(boughtItem); GameState.recalcStats(); this.closeInventory(); this.isInDialogue = false; this.resumeFromMenu(); this.scene.get('UIScene').events.emit('updateStats'); const bn = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 80, '购买了 ' + item.name + '  剩余金币: ' + GameState.gold, { fontSize: '16px', color: '#ffcc44', fontStyle: 'bold', backgroundColor: '#332200cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400); this.tweens.add({ targets: bn, alpha: 0, y: GAME_HEIGHT / 2 - 110, duration: 2500, onComplete: () => bn.destroy() }); }); }
      panel.add(buyBtn);
    });
    const cb3 = this.add.text(370, -240, '✕', { fontSize: '22px', color: '#ff6666', padding: { x: 8, y: 4 } }).setOrigin(0.5).setInteractive({ useHandCursor: true }); cb3.on('pointerover', () => cb3.setColor('#ffaaaa')); cb3.on('pointerout', () => cb3.setColor('#ff6666')); cb3.on('pointerdown', () => { panel.destroy(true); this.resumeFromMenu(); }); panel.add(cb3);
  }
  private openReturn(): void { this.isInDialogue = false; this.pauseForMenu(); const cam = this.cameras.main; const panel = this.add.container(Math.round(cam.scrollX) + GAME_WIDTH / 2, Math.round(cam.scrollY) + GAME_HEIGHT / 2).setDepth(310); const bg = this.add.graphics(); bg.fillStyle(0x1a1a2e, 0.97); bg.fillRoundedRect(-300, -150, 600, 300, 12); bg.lineStyle(2, 0xc9a96e, 0.7); bg.strokeRoundedRect(-300, -150, 600, 300, 12); panel.add(bg); panel.add(this.add.text(0, -110, '传送', { fontSize: '22px', color: '#c9a96e', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5)); GameState.discoveredZones.forEach((z, i2) => { const rz = ZONE_NAMES[z] || '???'; const btn = this.add.text(-200 + (i2 % 3) * 200, -60 + Math.floor(i2 / 3) * 50, rz, { fontSize: '14px', color: '#88ccff', padding: { x: 12, y: 6 }, backgroundColor: '#11224488' }).setInteractive({ useHandCursor: true }); btn.on('pointerover', () => btn.setColor('#aaddff')); btn.on('pointerout', () => btn.setColor('#88ccff')); btn.on('pointerdown', () => { panel.destroy(true); this.resumeFromMenu(); GameState.zone = z; this.isInDialogue = false; this.scene.restart({ newGame: false }); }); panel.add(btn); }); const cl4 = this.add.text(280, -130, '✕', { fontSize: '22px', color: '#ff6666', padding: { x: 8, y: 4 } }).setOrigin(0.5).setInteractive({ useHandCursor: true }); cl4.on('pointerover', () => cl4.setColor('#ffaaaa')); cl4.on('pointerout', () => cl4.setColor('#ff6666')); cl4.on('pointerdown', () => { panel.destroy(true); this.resumeFromMenu(); }); panel.add(cl4); }
  private openCraft(): void { this.isInDialogue = false; this.pauseForMenu(); const cam = this.cameras.main; const panel = this.add.container(Math.round(cam.scrollX) + GAME_WIDTH / 2, Math.round(cam.scrollY) + GAME_HEIGHT / 2).setDepth(310); const bg = this.add.graphics(); bg.fillStyle(0x1a1a2e, 0.97); bg.fillRoundedRect(-350, -200, 700, 400, 12); bg.lineStyle(2, 0xc9a96e, 0.7); bg.strokeRoundedRect(-350, -200, 700, 400, 12); panel.add(bg); panel.add(this.add.text(0, -160, '制造', { fontSize: '22px', color: '#c9a96e', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5)); panel.add(this.add.text(0, -120, '收集材料来制造装备', { fontSize: '14px', color: '#888899', padding: { y: 2 } }).setOrigin(0.5)); const recipes = [{ name: '铁剑', cost: { '\u77ff\u8109': 3, '\u7075\u6728\u679d': 1 } }, { name: '铁甲', cost: { '\u77ff\u8109': 5, '\u9ebb\u5e03\u7247': 2 } }, { name: '铁手甲', cost: { '\u77ff\u8109': 2, '\u7075\u6728\u679d': 1 } }]; recipes.forEach((r, i2) => { const ry = -70 + i2 * 60; panel.add(this.add.text(-300, ry, r.name, { fontSize: '16px', color: '#ddddff', fontStyle: 'bold', padding: { y: 2 } })); const costs = Object.entries(r.cost).map(([k, v]) => { const owned = Inventory.items.find(i2 => i2.id === k)?.quantity || 0; return `${k}: ${owned}/${v}`; }).join('  '); panel.add(this.add.text(-100, ry + 4, costs, { fontSize: '11px', color: '#8888aa', padding: { y: 1 } })); const canCraft = Object.entries(r.cost).every(([k, v]) => (Inventory.items.find(i2 => i2.id === k)?.quantity || 0) >= v); const btn2 = this.add.text(200, ry - 2, '[制造]', { fontSize: '14px', color: canCraft ? '#44cc44' : '#666666', fontStyle: 'bold', padding: { x: 10, y: 6 }, backgroundColor: canCraft ? '#11221188' : '#11111188' }).setInteractive({ useHandCursor: true }); if (canCraft) { btn2.on('pointerover', () => btn2.setColor('#88ff88')); btn2.on('pointerout', () => btn2.setColor('#44cc44')); btn2.on('pointerdown', () => { Object.entries(r.cost).forEach(([k, v]) => { const it = Inventory.items.find(i2 => i2.id === k); if (it) it.quantity = Math.max(0, (it.quantity || 0) - v); }); Inventory.addItem({ id: r.name, name: r.name, type: 'equipment', desc: '手工制造', quantity: 1, slot: 'weapon' as any, stats: { atk: 5 }, quality: 'green' }); panel.destroy(true); this.resumeFromMenu(); this.scene.get('UIScene').events.emit('updateStats'); }); } panel.add(btn2); }); const cl5 = this.add.text(330, -180, '✕', { fontSize: '22px', color: '#ff6666', padding: { x: 8, y: 4 } }).setOrigin(0.5).setInteractive({ useHandCursor: true }); cl5.on('pointerover', () => cl5.setColor('#ffaaaa')); cl5.on('pointerout', () => cl5.setColor('#ff6666')); cl5.on('pointerdown', () => { panel.destroy(true); this.resumeFromMenu(); }); panel.add(cl5); }
  private showBlacksmithLore(): void { this.isInDialogue = false; }
  private toggleInventory(): void { if (this.inventoryPanel) { this.closeInventory(); return; } this.renderInventoryPanel(); }
  private closeInventory(): void { if (this.inventoryPanel) { this.inventoryPanel.destroy(true); this.inventoryPanel = null; this.resumeFromMenu(); } }

  private renderInventoryPanel(): void {
    this.pauseForMenu(); const cam = this.cameras.main;
    const p = this.add.container(Math.round(cam.scrollX), Math.round(cam.scrollY)).setDepth(300); this.inventoryPanel = p;
    const ov = this.add.graphics(); ov.fillStyle(0, 0.78); ov.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT); ov.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains); p.add(ov);
    const ox = 30, oy = 20, ow = GAME_WIDTH - 60, oh = GAME_HEIGHT - 40;
    const mb = this.add.graphics(); mb.fillStyle(0x121222, 0.98); mb.fillRoundedRect(ox, oy, ow, oh, 12); mb.lineStyle(2, 0x4a5a8a, 0.6); mb.strokeRoundedRect(ox, oy, ow, oh, 12); p.add(mb);
    const th = 54; const tb = this.add.graphics(); tb.fillStyle(0x1a1a36, 1); tb.fillRoundedRect(ox + 4, oy + 4, ow - 8, th, { tl: 10, tr: 10, bl: 0, br: 0 }); p.add(tb);
    p.add(this.add.text(GAME_WIDTH / 2, oy + th / 2, '◆  背 包  ◆', { fontSize: '22px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));
    p.add(this.add.text(ox + ow - 40, oy + th / 2, '✕', { fontSize: '22px', color: '#cc6666', padding: { x: 8, y: 4 } }).setOrigin(0.5).setInteractive({ useHandCursor: true }).on('pointerover', function (this: any) { this.setColor('#ff8888'); }).on('pointerout', function (this: any) { this.setColor('#cc6666'); }).on('pointerdown', () => this.closeInventory()));
    p.add(this.add.text(ox + 20, oy + th + 16, `金币: ${GameState.gold}`, { fontSize: '16px', color: '#ffcc44', fontStyle: 'bold', padding: { y: 2 } }));

    // Equipment grid (2 rows x 5 cols)
    const eqY = oy + th + 48; const eW = 180, eH = 64, eGap = 10;
    const eq = Inventory.equipment; const sn: Record<string, string> = { weapon: '武器', head: '头部', body: '身体', bracer: '手甲', boots: '战靴', belt: '腰带', ring: '戒指', necklace: '项链', charm: '护符', pendant: '挂饰' };
    const eqs = ['weapon', 'head', 'body', 'bracer', 'boots', 'belt', 'ring', 'necklace', 'charm', 'pendant'];
    const qc: Record<string, string> = { white: '#aaaaaa', green: '#44cc44', blue: '#4488ff', purple: '#cc44cc', gold: '#ffaa00' };
    eqs.forEach((s, i) => {
      const c2 = i % 5, r2 = Math.floor(i / 5); const sx = ox + 20 + c2 * (eW + eGap), sy = eqY + r2 * (eH + eGap);
      const er = this.add.graphics(); er.fillStyle(0x0d0d1d, 0.7); er.fillRoundedRect(sx, sy, eW, eH, 6); er.lineStyle(1, 0x334466, 0.4); er.strokeRoundedRect(sx, sy, eW, eH, 6); p.add(er);
      p.add(this.add.text(sx + 8, sy + 4, sn[s], { fontSize: '10px', color: '#556688', padding: { y: 1 } }));
      const it = (eq as any)[s];
      if (it) {
        const elv = (it as any).enhanceLevel || 0; const q = (it as any).quality || 'white'; const lvTxt = elv > 0 ? ` +${elv}` : '';
        p.add(this.add.text(sx + 8, sy + 20, `${it.name}${lvTxt}`, { fontSize: '13px', color: qc[q] || '#cccccc', fontStyle: 'bold', padding: { y: 1 } }));
        const sts = Object.entries(it.stats as Record<string, number>).map(([k, v]) => `${k}+${v}`).join(' ');
        p.add(this.add.text(sx + 8, sy + 40, sts, { fontSize: '9px', color: '#7788aa', padding: { y: 1 } }));
        // 点击卸下装备
        const slotZone = this.add.zone(sx, sy, eW, eH).setOrigin(0, 0).setInteractive({ useHandCursor: true });
        slotZone.on('pointerdown', () => {
          Inventory.unequip(s as any);
          GameState.recalcStats();
          this.closeInventory(); this.renderInventoryPanel();
          this.scene.get('UIScene').events.emit('updateStats');
        });
        p.add(slotZone);
      } else { p.add(this.add.text(sx + 8, sy + 24, '空', { fontSize: '12px', color: '#334455', padding: { y: 1 } })); }
    });

    // 背包装备（可穿戴）
    const equipItems = Inventory.items.filter(it => it.type === 'equipment');
    if (equipItems.length > 0) {
      const eiY = eqY + 2 * (eH + eGap) + 16;
      p.add(this.add.text(ox + 20, eiY, '装备（点击穿戴）', { fontSize: '14px', color: '#88aacc', fontStyle: 'bold', padding: { y: 2 } }));
      const ec = 6, ecardW = (ow - 50) / ec - 8;
      equipItems.forEach((item, i) => {
        const col = i % ec, row = Math.floor(i / ec); const ex = ox + 20 + col * (ecardW + 8), ey = eiY + 28 + row * 56;
        const q = (item as any).quality || 'white';
        const cd2 = this.add.graphics(); cd2.fillStyle(0x0a0a1a, 0.7); cd2.fillRoundedRect(ex, ey, ecardW, 48, 5); cd2.lineStyle(1, parseInt((qc[q] || '#666666').replace('#', ''), 16), 0.4); cd2.strokeRoundedRect(ex, ey, ecardW, 48, 5); p.add(cd2);
        const elv = (item as any).enhanceLevel || 0; const lvTxt = elv > 0 ? ` +${elv}` : '';
        p.add(this.add.text(ex + 6, ey + 4, `${item.name}${lvTxt}`, { fontSize: '11px', color: qc[q] || '#cccccc', fontStyle: 'bold', padding: { y: 1 } }));
        const sts = item.stats ? Object.entries(item.stats as Record<string, number>).map(([k, v]) => `${k}+${v}`).join(' ') : '';
        p.add(this.add.text(ex + 6, ey + 24, sts, { fontSize: '9px', color: '#7788aa', padding: { y: 1 } }));
        const ez = this.add.zone(ex, ey, ecardW, 48).setOrigin(0, 0).setInteractive({ useHandCursor: true });
        ez.on('pointerover', () => { cd2.clear(); cd2.fillStyle(0x1a2a3a, 0.8); cd2.fillRoundedRect(ex, ey, ecardW, 48, 5); cd2.lineStyle(1, parseInt((qc[q] || '#666666').replace('#', ''), 16), 0.6); cd2.strokeRoundedRect(ex, ey, ecardW, 48, 5); });
        ez.on('pointerout', () => { cd2.clear(); cd2.fillStyle(0x0a0a1a, 0.7); cd2.fillRoundedRect(ex, ey, ecardW, 48, 5); cd2.lineStyle(1, parseInt((qc[q] || '#666666').replace('#', ''), 16), 0.4); cd2.strokeRoundedRect(ex, ey, ecardW, 48, 5); });
        ez.on('pointerdown', () => {
          Inventory.equip(item);
          GameState.recalcStats();
          this.closeInventory(); this.renderInventoryPanel();
          this.scene.get('UIScene').events.emit('updateStats');
        });
        p.add(ez);
      });
    }

    // Consumables
    const consY = eqY + 2 * (eH + eGap) + 16 + (equipItems.length > 0 ? (Math.ceil(equipItems.length / 6) * 56 + 28) : 0);
    p.add(this.add.text(ox + 20, consY, '消耗品', { fontSize: '15px', color: '#88aacc', fontStyle: 'bold', padding: { y: 2 } }));
    const cons = Inventory.items.filter(it => it.type === 'consumable' && it.quantity > 0);
    const cc = 8, cW = (ow - 50) / cc - 8;
    cons.forEach((item, i) => {
      const col = i % cc, row = Math.floor(i / cc); const cx = ox + 20 + col * (cW + 8), cy = consY + 30 + row * 68;
      const cd = this.add.graphics(); cd.fillStyle(0x0a1a0a, 0.7); cd.fillRoundedRect(cx, cy, cW, 58, 5); cd.lineStyle(1, 0x225522, 0.5); cd.strokeRoundedRect(cx, cy, cW, 58, 5); p.add(cd);
      p.add(this.add.text(cx + 6, cy + 4, item.name, { fontSize: '11px', color: '#88cc88', fontStyle: 'bold', padding: { y: 1 } }));
      p.add(this.add.text(cx + 6, cy + 22, item.desc || '', { fontSize: '9px', color: '#558855', padding: { y: 1 } }));
      p.add(this.add.text(cx + cW - 25, cy + 4, `×${item.quantity}`, { fontSize: '11px', color: '#88cc88', fontStyle: 'bold', padding: { y: 1 } }));
      const ub = this.add.text(cx + cW / 2, cy + 38, '[使用]', { fontSize: '10px', color: '#44cc44', fontStyle: 'bold', padding: { x: 4, y: 2 }, backgroundColor: '#11221188' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      ub.on('pointerover', () => { ub.setColor('#88ff88'); ub.setBackgroundColor('#224422aa'); }); ub.on('pointerout', () => { ub.setColor('#44cc44'); ub.setBackgroundColor('#11221188'); });
      ub.on('pointerdown', () => {
        const ef = getConsumableEffect(item.id);
        if (ef) {
          const ctx2 = { hp: GameState.hp, maxHp: GameState.maxHp, mp: GameState.mp, maxMp: GameState.maxMp, playerStatus: createPlayerStatus(), isDead: false };
          const result = applyConsumable(ef, ctx2);
          GameState.hp = result.hp; GameState.mp = result.mp;
          item.quantity--;
          if (item.quantity <= 0) { const ri = Inventory.items.findIndex(ri2 => ri2.id === item.id); if (ri >= 0) Inventory.items.splice(ri, 1); }
          this.closeInventory(); this.renderInventoryPanel();
          this.scene.get('UIScene').events.emit('updateStats');
          // 显示使用结果
          const n = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 80, result.message, { fontSize: '16px', color: '#88ff88', fontStyle: 'bold', backgroundColor: '#112211cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400);
          this.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 110, duration: 1500, onComplete: () => n.destroy() });
        }
      });
      p.add(ub);
    });

    // Materials
    const matY = consY + 30 + Math.ceil(cons.length / cc) * 68 + 14;
    p.add(this.add.text(ox + 20, matY, '材料', { fontSize: '15px', color: '#88aacc', fontStyle: 'bold', padding: { y: 2 } }));
    const mats = Inventory.items.filter(it => it.type === 'material' && it.quantity > 0);
    mats.forEach((item, i) => { const col = i % 6, row = Math.floor(i / 6); const mx = ox + 20 + col * 280, my = matY + 30 + row * 24; p.add(this.add.text(mx, my, `${item.name} ×${item.quantity}`, { fontSize: '11px', color: '#aaaacc', padding: { y: 2 } })); });

    const fy = oy + oh - 28; const ft = this.add.graphics(); ft.fillStyle(0x1a1a36, 0.8); ft.fillRoundedRect(ox + 4, fy, ow - 8, 24, { tl: 0, tr: 0, bl: 10, br: 10 }); p.add(ft);
    p.add(this.add.text(GAME_WIDTH / 2, fy + 12, 'B键 开关  |  ESC 关闭', { fontSize: '11px', color: '#556688', padding: { y: 2 } }).setOrigin(0.5));
  }
  private toggleStatPanel(): void { if (this.statPanel) { this.closeStatPanel(); return; } this.renderStatPanel(); }
  private closeStatPanel(): void { if (this.statPanel) { this.statPanel.destroy(true); this.statPanel = null; this.resumeFromMenu(); } }

  private renderStatPanel(): void {
    this.pauseForMenu(); const cam = this.cameras.main;
    const p = this.add.container(Math.round(cam.scrollX), Math.round(cam.scrollY)).setDepth(300); this.statPanel = p;
    const ov = this.add.graphics(); ov.fillStyle(0x000000, 0.78); ov.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT); ov.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains); p.add(ov);
    const ox = 30, oy = 20, ow = GAME_WIDTH - 60, oh = GAME_HEIGHT - 40;
    const mb = this.add.graphics(); mb.fillStyle(0x121222, 0.98); mb.fillRoundedRect(ox, oy, ow, oh, 12); mb.lineStyle(2, 0x4a5a8a, 0.6); mb.strokeRoundedRect(ox, oy, ow, oh, 12); p.add(mb);

    // Title bar
    const th = 54; const tb = this.add.graphics(); tb.fillStyle(0x1a1a36, 1); tb.fillRoundedRect(ox + 4, oy + 4, ow - 8, th, { tl: 10, tr: 10, bl: 0, br: 0 }); p.add(tb);
    p.add(this.add.text(GAME_WIDTH / 2, oy + th / 2, '◆  属 性 面 板  ◆', { fontSize: '22px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));
    p.add(this.add.text(ox + ow - 40, oy + th / 2, '✕', { fontSize: '22px', color: '#cc6666', padding: { x: 8, y: 4 } }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerover', function (this: any) { this.setColor('#ff8888'); }).on('pointerout', function (this: any) { this.setColor('#cc6666'); }).on('pointerdown', () => this.closeStatPanel()));

    const sp = GameState.statPoints;
    const colW = (ow - 80) / 2, lx = ox + 24, rx = lx + colW + 30;

    // ═══ Left: Info + Stats ═══
    p.add(this.add.text(lx, oy + th + 20, `玩家: ${GameState.playerName}   Lv.${GameState.level}   金币: ${GameState.gold}`, { fontSize: '14px', color: '#aabbdd', padding: { y: 2 } }));
    p.add(this.add.text(lx, oy + th + 46, `元素: ${GameState.element || '无'}   斩魄刀: ${GameState.zanpakuto || '无'}   始解: ${GameState.hasShikai ? '✓' : '✗'}`, { fontSize: '12px', color: '#8899aa', padding: { y: 2 } }));
    p.add(this.add.text(lx, oy + th + 72, `剩余属性点: ${sp}`, { fontSize: '18px', color: sp > 0 ? '#ffcc44' : '#667788', fontStyle: 'bold', padding: { y: 2 } }));

    const attrs = [
      { l: 'HP', k: 'maxHp', a: 'allocatedHP', per: 15 }, { l: 'MP', k: 'maxMp', a: 'allocatedMP', per: 5 },
      { l: 'ATK', k: 'atk', a: 'allocatedATK', per: 1 }, { l: 'DEF', k: 'def', a: 'allocatedDEF', per: 1 },
      { l: 'MATK', k: 'matk', a: 'allocatedMATK', per: 1 }, { l: 'MDEF', k: 'mdef', a: 'allocatedMDEF', per: 1 },
      { l: 'SPD', k: 'spd', a: 'allocatedSPD', per: 1 },
    ];
    const atY = oy + th + 100;
    const valTexts: Phaser.GameObjects.Text[] = [];
    const allocTexts: Phaser.GameObjects.Text[] = [];
    const addBtns: Phaser.GameObjects.Text[] = [];
    const subBtns: Phaser.GameObjects.Text[] = [];
    let spText: Phaser.GameObjects.Text;
    const refreshDisplay = () => {
      spText.setText(`剩余属性点: ${GameState.statPoints}`);
      spText.setColor(GameState.statPoints > 0 ? '#ffcc44' : '#667788');
      attrs.forEach((at, i) => {
        const av = (GameState as any)[at.k] as number;
        const al = (GameState as any)[at.a] as number;
        valTexts[i].setText(`${av}`);
        allocTexts[i].setText(`(加点${al} × ${at.per} = +${al * at.per})`);
        addBtns[i].setColor(GameState.statPoints > 0 ? '#44cc44' : '#335533');
        subBtns[i].setColor(al > 0 ? '#cc4444' : '#553333');
      });
    };
    spText = this.add.text(lx, oy + th + 72, `剩余属性点: ${sp}`, { fontSize: '18px', color: sp > 0 ? '#ffcc44' : '#667788', fontStyle: 'bold', padding: { y: 2 }, backgroundColor: '#121222' });
    p.add(spText);

    attrs.forEach((at, i) => {
      const ay = atY + i * 48;
      const av = (GameState as any)[at.k] as number; const al = (GameState as any)[at.a] as number;
      const ar = this.add.graphics(); ar.fillStyle(0x0d0d1d, 0.7); ar.fillRoundedRect(lx, ay, colW - 10, 40, 6); ar.lineStyle(1, 0x334466, 0.3); ar.strokeRoundedRect(lx, ay, colW - 10, 40, 6); p.add(ar);
      p.add(this.add.text(lx + 16, ay + 10, at.l, { fontSize: '15px', color: '#ffe8b0', fontStyle: 'bold', padding: { y: 2 } }));
      const vt = this.add.text(lx + 80, ay + 10, `${av}`, { fontSize: '18px', color: '#88ccff', fontStyle: 'bold', padding: { y: 2 } });
      p.add(vt); valTexts.push(vt);
      const at2 = this.add.text(lx + 140, ay + 12, `(加点${al} × ${at.per} = +${al * at.per})`, { fontSize: '11px', color: '#6677aa', padding: { y: 1 } });
      p.add(at2); allocTexts.push(at2);

      const ap = this.add.text(lx + colW - 120, ay + 6, '+', { fontSize: '22px', color: GameState.statPoints > 0 ? '#44cc44' : '#335533', fontStyle: 'bold', padding: { x: 10, y: 4 } }).setInteractive({ useHandCursor: true });
      ap.on('pointerover', () => { if (GameState.statPoints > 0) ap.setColor('#88ff88'); });
      ap.on('pointerout', () => { ap.setColor(GameState.statPoints > 0 ? '#44cc44' : '#335533'); });
      ap.on('pointerdown', () => {
        if (GameState.statPoints > 0) { (GameState as any)[at.a]++; GameState.statPoints--; GameState.recalcStats(); refreshDisplay(); this.scene.get('UIScene').events.emit('updateStats'); }
      });
      p.add(ap); addBtns.push(ap);
      const sp2 = this.add.text(lx + colW - 80, ay + 6, '-', { fontSize: '22px', color: al > 0 ? '#cc4444' : '#553333', fontStyle: 'bold', padding: { x: 10, y: 4 } }).setInteractive({ useHandCursor: true });
      sp2.on('pointerover', () => { if ((GameState as any)[at.a] > 0) sp2.setColor('#ff8888'); });
      sp2.on('pointerout', () => { sp2.setColor((GameState as any)[at.a] > 0 ? '#cc4444' : '#553333'); });
      sp2.on('pointerdown', () => {
        if ((GameState as any)[at.a] > 0) { (GameState as any)[at.a]--; GameState.statPoints++; GameState.recalcStats(); refreshDisplay(); this.scene.get('UIScene').events.emit('updateStats'); }
      });
      p.add(sp2); subBtns.push(sp2);
    });

    // ═══ Right: Equipment ═══
    p.add(this.add.text(rx, oy + th + 20, '装备栏', { fontSize: '16px', color: '#aaccdd', fontStyle: 'bold', padding: { y: 3 } }));
    const eq = Inventory.equipment; const sn: Record<string, string> = { weapon: '武器', head: '头部', body: '身体', bracer: '手甲', boots: '战靴', belt: '腰带', ring: '戒指', necklace: '项链', charm: '护符', pendant: '挂饰' };
    const eqs = ['weapon', 'head', 'body', 'bracer', 'boots', 'belt', 'ring', 'necklace', 'charm', 'pendant'];
    const eqY = oy + th + 52;
    eqs.forEach((s, i) => {
      const c2 = i % 2, r2 = Math.floor(i / 2); const sx = rx + c2 * (colW / 2 + 4), sy = eqY + r2 * 68;
      const er = this.add.graphics(); er.fillStyle(0x0d0d1d, 0.6); er.fillRoundedRect(sx, sy, colW / 2 - 4, 58, 5);
      er.lineStyle(1, 0x334466, 0.4); er.strokeRoundedRect(sx, sy, colW / 2 - 4, 58, 5); p.add(er);
      p.add(this.add.text(sx + 8, sy + 4, sn[s], { fontSize: '10px', color: '#556688', padding: { y: 1 } }));
      const it = (eq as any)[s];
      if (it) {
        const elv = (it as any).enhanceLevel || 0; const lvTxt = elv > 0 ? ` +${elv}` : '';
        const qc: Record<string, string> = { white: '#cccccc', green: '#44cc44', blue: '#4488ff', purple: '#cc44cc', gold: '#ffaa00' };
        const q = (it as any).quality || 'white';
        p.add(this.add.text(sx + 8, sy + 20, `${it.name}${lvTxt}`, { fontSize: '12px', color: qc[q] || '#cccccc', fontStyle: 'bold', padding: { y: 1 } }));
        const sts = Object.entries(it.stats as Record<string, number>).map(([k, v]) => `${k}+${v}`).join(' ');
        p.add(this.add.text(sx + 8, sy + 38, sts, { fontSize: '9px', color: '#7788aa', padding: { y: 1 } }));
      } else { p.add(this.add.text(sx + 8, sy + 24, '空', { fontSize: '12px', color: '#334455', padding: { y: 1 } })); }
    });

    // Footer
    const fy = oy + oh - 28; const ft = this.add.graphics(); ft.fillStyle(0x1a1a36, 0.8); ft.fillRoundedRect(ox + 4, fy, ow - 8, 24, { tl: 0, tr: 0, bl: 10, br: 10 }); p.add(ft);
    p.add(this.add.text(GAME_WIDTH / 2, fy + 12, 'C键 开关  |  ESC 关闭', { fontSize: '11px', color: '#556688', padding: { y: 2 } }).setOrigin(0.5));
  }

  private showKidoPanel(): void {
    if (this.kidoPanel) { this.closeKidoPanel(); return; }
    this.pauseForMenu(); const cam = this.cameras.main;
    const p = this.add.container(Math.round(cam.scrollX), Math.round(cam.scrollY)).setDepth(300); this.kidoPanel = p;
    const ov = this.add.graphics(); ov.fillStyle(0, 0.78); ov.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    ov.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains); p.add(ov);
    const ox = 30, oy = 20, ow = GAME_WIDTH - 60, oh = GAME_HEIGHT - 40;
    const mb = this.add.graphics(); mb.fillStyle(0x121222, 0.98); mb.fillRoundedRect(ox, oy, ow, oh, 12);
    mb.lineStyle(2, 0x4a5a8a, 0.6); mb.strokeRoundedRect(ox, oy, ow, oh, 12); p.add(mb);
    const th = 54; const tb = this.add.graphics(); tb.fillStyle(0x1a1a36, 1);
    tb.fillRoundedRect(ox + 4, oy + 4, ow - 8, th, { tl: 10, tr: 10, bl: 0, br: 0 }); p.add(tb);
    p.add(this.add.text(GAME_WIDTH / 2, oy + th / 2, '\u25c6  \u9b3c \u9053 \u5929 \u8d4b  \u25c6', {
      fontSize: '22px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));
    p.add(this.add.text(ox + ow - 40, oy + th / 2, '\u2715', {
      fontSize: '22px', color: '#cc6666', padding: { x: 8, y: 4 } }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', function (this: any) { this.setColor('#ff8888'); })
      .on('pointerout', function (this: any) { this.setColor('#cc6666'); })
      .on('pointerdown', () => this.closeKidoPanel()));

    const schools: { id: KidoSchool; name: string; color: string }[] = [
      { id: 'hado', name: '\u7834\u9053', color: '#ff6644' },
      { id: 'bakudo', name: '\u7e1b\u9053', color: '#4488ff' },
      { id: 'kaido', name: '\u56de\u9053', color: '#44cc66' },
    ];

    // 使用Kido.school作为当前tab（持久化）
    if (!Kido.school) Kido.school = 'hado';
    const activeTab: KidoSchool = Kido.school;
    const avail = Kido.availablePoints();
    const totalSpent = Kido.pointsSpent();
    p.add(this.add.text(GAME_WIDTH / 2, oy + th + 16, `\u53ef\u7528\u9b3c\u9053\u70b9: ${avail}  |  \u5df2\u6295\u5165: ${totalSpent}  |  \u5f53\u524d: ${schools.find(s => s.id === activeTab)?.name || ''}`, {
      fontSize: '14px', color: '#ffcc44', fontStyle: 'bold', padding: { y: 2 }, backgroundColor: '#121222' }).setOrigin(0.5));

    // Tab buttons
    const tabY = oy + th + 44;
    schools.forEach((s, i) => {
      const isA = s.id === activeTab; const tx = ox + 30 + i * 140;
      const tb2 = this.add.graphics();
      tb2.fillStyle(isA ? 0x2a1a0a : 0x111122, 0.8); tb2.fillRoundedRect(tx, tabY, 130, 34, 6);
      tb2.lineStyle(1, isA ? parseInt(s.color.replace('#', ''), 16) : 0x334466, isA ? 0.8 : 0.4);
      tb2.strokeRoundedRect(tx, tabY, 130, 34, 6); p.add(tb2);
      const t = this.add.text(tx + 65, tabY + 17, s.name, {
        fontSize: '15px', color: isA ? s.color : '#555566', fontStyle: 'bold', padding: { y: 2 }
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      t.on('pointerover', () => { if (!isA) t.setColor('#888899'); });
      t.on('pointerout', () => { if (!isA) t.setColor('#555566'); });
      t.on('pointerdown', () => {
        if (s.id !== activeTab) { Kido.school = s.id; this.closeKidoPanel(); this.showKidoPanel(); }
      });
      p.add(t);
    });

    // Get nodes for active school, grouped by tier
    const sch = Object.values(KIDO_NODES).filter(n => n.school === activeTab);
    const tiers = [1, 2, 3, 4, 5];
    const colStr = activeTab === 'hado' ? '#ff6644' : activeTab === 'bakudo' ? '#4488ff' : '#44cc66';
    const colNum = parseInt(colStr.replace('#', ''), 16);

    // Layout: 5 rows (one per tier), nodes spread horizontally within each row
    const nodeAreaY = tabY + 50;
    const nodeAreaH = oh - (nodeAreaY - oy) - 50;
    const rowH = nodeAreaH / 5;
    const nR = 26;

    tiers.forEach((tier, tierIdx) => {
      const tierNodes = sch.filter(n => n.tier === tier).sort((a, b) => (a.column || 0) - (b.column || 0));
      if (tierNodes.length === 0) return;
      const rowY = nodeAreaY + tierIdx * rowH + rowH / 2;

      // Tier label
      const tierLock = TIER_LOCK[tier] || 0;
      const inSchool = Kido.pointsInSchool(activeTab);
      const tierUnlocked = inSchool >= tierLock;
      p.add(this.add.text(ox + 20, rowY - 10, `T${tier} (${tierLock}\u70b9)`, {
        fontSize: '10px', color: tierUnlocked ? '#667788' : '#444455', padding: { y: 1 }
      }));

      // Nodes in this tier
      const nodeSpacing = (ow - 120) / Math.max(tierNodes.length, 1);
      tierNodes.forEach((n, ni) => {
        const nx = ox + 80 + nodeSpacing * (ni + 0.5);
        const ny = rowY;
        const nodePts = Kido.getPoints(n.id) || 0;
        const unlocked = tierUnlocked;
        const active = nodePts > 0;
        const canAdd = Kido.canAddPoint(n.id);
        const isMaxed = nodePts >= n.maxPoints;

        // Connection line to parent (previous tier, same column)
        if (tierIdx > 0) {
          const parentTier = tier - 1;
          const parentNodes = sch.filter(nn => nn.tier === parentTier);
          // Find closest parent by column
          const parent = parentNodes.reduce((best, nn) => {
            const dist = Math.abs((nn.column || 0) - (n.column || 0));
            return dist < Math.abs((best?.column || 0) - (n.column || 0)) ? nn : best;
          }, parentNodes[0]);
          if (parent) {
            const parentIdx = parentNodes.indexOf(parent);
            const parentSpacing = (ow - 120) / Math.max(parentNodes.length, 1);
            const py = nodeAreaY + (tierIdx - 1) * rowH + rowH / 2;
            const parentPts = Kido.getPoints(parent.id) || 0;
            const lg = this.add.graphics();
            lg.lineStyle(parentPts > 0 ? 3 : 1, parentPts > 0 ? colNum : 0x334466, parentPts > 0 ? 0.7 : 0.3);
            lg.beginPath(); lg.moveTo(nx, ny - nR - 2); lg.lineTo(nx, py + nR + 2); lg.strokePath();
            p.add(lg);
          }
        }

        // Node glow
        const og = this.add.graphics();
        og.fillStyle(colNum, active ? 0.15 : 0.03); og.fillCircle(nx, ny, nR + 8); p.add(og);

        // Node circle
        const nc = this.add.graphics();
        nc.fillStyle(active ? colNum : unlocked ? 0x1a1a3e : 0x080812, active ? 0.95 : 0.6);
        nc.fillCircle(nx, ny, nR);
        nc.lineStyle(active ? 3 : 1, active ? colNum : unlocked ? 0x445566 : 0x334455, active ? 1 : 0.5);
        nc.strokeCircle(nx, ny, nR); p.add(nc);

        // Points display
        const ptStr = nodePts > 0 ? `${nodePts}/${n.maxPoints}` : n.passive ? 'P' : '';
        p.add(this.add.text(nx, ny - 2, ptStr, {
          fontSize: '11px', color: unlocked ? '#ffffff' : '#334455', fontStyle: 'bold', padding: { y: 1 }
        }).setOrigin(0.5));

        // Name
        p.add(this.add.text(nx, ny + nR + 6, n.name, {
          fontSize: '11px', color: unlocked ? '#ccccdd' : '#445566', padding: { y: 1 }
        }).setOrigin(0.5));

        // Interactive zone
        const z = this.add.zone(nx, ny, nR * 3, nR * 3 + 24).setInteractive({ useHandCursor: true });
        z.on('pointerover', () => {
          if (this.kidoTooltip) this.kidoTooltip.destroy();
          this.kidoTooltip = this.add.container(Math.min(nx + 30, GAME_WIDTH - 240), ny - 10).setDepth(320);
          const tt = this.add.graphics(); tt.fillStyle(0x0a0a1a, 0.95); tt.fillRoundedRect(0, 0, 220, 80, 6);
          tt.lineStyle(1, colNum, 0.6); tt.strokeRoundedRect(0, 0, 220, 80, 6); this.kidoTooltip.add(tt);
          this.kidoTooltip.add(this.add.text(8, 6, n.name, { fontSize: '12px', color: '#ffe8b0', fontStyle: 'bold', padding: { y: 1 } }));
          this.kidoTooltip.add(this.add.text(8, 24, n.desc, { fontSize: '9px', color: '#aaaacc', wordWrap: { width: 204 }, padding: { y: 1 } }));
          let status = '';
          let statusColor = '#666688';
          if (isMaxed) { status = '\u5df2\u6ee1\u7ea7'; statusColor = '#ffcc44'; }
          else if (canAdd) { status = `[\u70b9\u51fb\u52a0\u70b9] \u5269\u4f59${avail}\u70b9`; statusColor = '#88cc88'; }
          else if (!unlocked) { status = `\u9700\u8be5\u7cfb${tierLock}\u70b9\u89e3\u9501`; statusColor = '#cc6644'; }
          else if (avail <= 0) { status = '\u9b3c\u9053\u70b9\u4e0d\u8db3'; statusColor = '#cc6644'; }
          this.kidoTooltip.add(this.add.text(8, 56, status, { fontSize: '10px', color: statusColor, padding: { y: 1 } }));
        });
        z.on('pointerout', () => { if (this.kidoTooltip) { this.kidoTooltip.destroy(); this.kidoTooltip = null; } });
        z.on('pointerdown', () => {
          if (canAdd) {
            Kido.addPoint(n.id);
            GameState.recalcStats();
            this.closeKidoPanel(); this.showKidoPanel();
            this.scene.get('UIScene').events.emit('updateStats');
          }
        });
        p.add(z);
      });
    });

    const fy = oy + oh - 28; const ft = this.add.graphics();
    ft.fillStyle(0x1a1a36, 0.8); ft.fillRoundedRect(ox + 4, fy, ow - 8, 24, { tl: 0, tr: 0, bl: 10, br: 10 }); p.add(ft);
    p.add(this.add.text(GAME_WIDTH / 2, fy + 12, 'K\u952e \u5f00\u5173  |  ESC \u5173\u95ed  |  \u60ac\u505c\u67e5\u770b  |  \u70b9\u51fb\u52a0\u70b9  |  \u5207\u6362\u6807\u7b7e\u4fdd\u5b58\u5f53\u524d\u7cfb\u522b', {
      fontSize: '11px', color: '#556688', padding: { y: 2 } }).setOrigin(0.5));
  }

  private closeKidoPanel(): void { this.kidoPanel?.destroy(true); this.kidoPanel = null; if (this.kidoTooltip) { this.kidoTooltip.destroy(); this.kidoTooltip = null; } this.resumeFromMenu(); }
  private enhanceTab: number = 0;
  private toggleEnhancePanel(): void {
    if (this.enhancePanel) { this.closeEnhancePanel(); return; }
    this.pauseForMenu(); const cam = this.cameras.main;
    const p = this.add.container(Math.round(cam.scrollX), Math.round(cam.scrollY)).setDepth(300); this.enhancePanel = p;
    const ov = this.add.graphics(); ov.fillStyle(0, 0.78); ov.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    ov.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains); p.add(ov);
    const ox = 30, oy = 20, ow = GAME_WIDTH - 60, oh = GAME_HEIGHT - 40;
    const mb = this.add.graphics(); mb.fillStyle(0x121222, 0.98); mb.fillRoundedRect(ox, oy, ow, oh, 12);
    mb.lineStyle(2, 0x4a5a8a, 0.6); mb.strokeRoundedRect(ox, oy, ow, oh, 12); p.add(mb);
    const th = 54; const tb = this.add.graphics(); tb.fillStyle(0x1a1a36, 1);
    tb.fillRoundedRect(ox + 4, oy + 4, ow - 8, th, { tl: 10, tr: 10, bl: 0, br: 0 }); p.add(tb);
    p.add(this.add.text(GAME_WIDTH / 2, oy + th / 2, '◆  强 化 工 坊  ◆', {
      fontSize: '22px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));
    p.add(this.add.text(ox + ow - 40, oy + th / 2, '✕', {
      fontSize: '22px', color: '#cc6666', padding: { x: 8, y: 4 } }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', function (this: any) { this.setColor('#ff8888'); })
      .on('pointerout', function (this: any) { this.setColor('#cc6666'); })
      .on('pointerdown', () => this.closeEnhancePanel()));

    // Tabs
    const tabs = ['强化', '精炼', '分解'];
    const tabColors = ['#ff8844', '#4488ff', '#88cc44'];
    let activeTab = this.enhanceTab;
    const tabY = oy + th + 10;
    const renderTabs = () => {
      tabs.forEach((t, i) => {
        const tx = ox + 30 + i * 130;
        const isA = i === activeTab;
        const tbg = this.add.graphics();
        tbg.fillStyle(isA ? 0x2a1a0a : 0x111122, 0.8); tbg.fillRoundedRect(tx, tabY, 120, 32, 6);
        tbg.lineStyle(1, isA ? parseInt(tabColors[i].replace('#', ''), 16) : 0x334466, isA ? 0.8 : 0.4);
        tbg.strokeRoundedRect(tx, tabY, 120, 32, 6); p.add(tbg);
        const tt = this.add.text(tx + 60, tabY + 16, t, {
          fontSize: '14px', color: isA ? tabColors[i] : '#555566', fontStyle: 'bold', padding: { y: 2 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        tt.on('pointerdown', () => { if (i !== activeTab) { this.enhanceTab = i; this.closeEnhancePanel(); this.toggleEnhancePanel(); } });
        p.add(tt);
      });
    };
    renderTabs();

    // Equipment list
    const eq = Inventory.equipment;
    const eqSlots = ['weapon', 'head', 'body', 'bracer', 'boots', 'belt', 'ring', 'necklace', 'charm', 'pendant'];
    const sn: Record<string, string> = { weapon: '武器', head: '头部', body: '身体', bracer: '手甲', boots: '战靴', belt: '腰带', ring: '戒指', necklace: '项链', charm: '护符', pendant: '挂饰' };
    const listY = tabY + 44;
    eqSlots.forEach((s, i) => {
      const col = i % 2, row = Math.floor(i / 2); const sx = ox + 30 + col * 520, sy = listY + row * 72;
      const item = (eq as any)[s];
      const er = this.add.graphics(); er.fillStyle(0x0d0d1d, 0.7); er.fillRoundedRect(sx, sy, 500, 62, 6);
      er.lineStyle(1, 0x334466, 0.4); er.strokeRoundedRect(sx, sy, 500, 62, 6); p.add(er);
      p.add(this.add.text(sx + 10, sy + 4, sn[s] || s, { fontSize: '10px', color: '#556688', padding: { y: 1 } }));
      if (item) {
        const elv = (item as any).enhanceLevel || 0; const enhLabel = getEnhanceLabel(item);
        const qc: Record<string, string> = { white: '#aaaaaa', green: '#44cc44', blue: '#4488ff', purple: '#cc44cc', gold: '#ffaa00' };
        const q = (item as any).quality || 'white';
        p.add(this.add.text(sx + 10, sy + 20, `${enhLabel} ${item.name}`, { fontSize: '13px', color: qc[q] || '#cccccc', fontStyle: 'bold', padding: { y: 1 } }));
        const stats = Object.entries(item.stats as Record<string, number>).map(([k, v]) => `${k}+${v}`).join('  ');
        p.add(this.add.text(sx + 10, sy + 40, stats, { fontSize: '9px', color: '#7788aa', padding: { y: 1 } }));

        if (activeTab === 0) {
          // 强化
          if (elv < 10) {
            const cost = getEnhanceCost(elv + 1, (item as any).quality || 'white'); const rate = getEnhanceRate(elv + 1);
            p.add(this.add.text(sx + 300, sy + 8, `${cost.gold}金币 | ${Math.round(rate * 100)}%`, { fontSize: '10px', color: '#888899', padding: { y: 1 } }));
            const btn = this.add.text(sx + 420, sy + 4, '[ 强化 ]', { fontSize: '16px', color: '#ff8844', fontStyle: 'bold', padding: { x: 16, y: 8 }, backgroundColor: '#33220088' }).setInteractive({ useHandCursor: true });
            btn.on('pointerover', () => btn.setColor('#ffaa66'));
            btn.on('pointerout', () => btn.setColor('#ff8844'));
            btn.on('pointerdown', () => {
              const result = doEnhance(item);
              GameState.recalcStats(); this.closeEnhancePanel(); this.toggleEnhancePanel();
              this.scene.get('UIScene').events.emit('updateStats');
              const n = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, result.message, { fontSize: '16px', color: result.success ? '#88ff88' : '#ff6666', fontStyle: 'bold', backgroundColor: '#112211cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400);
              this.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => n.destroy() });
            });
            p.add(btn);
          } else { p.add(this.add.text(sx + 380, sy + 20, '已满级', { fontSize: '14px', color: '#ffcc44', fontStyle: 'bold', padding: { y: 2 } })); }
        } else if (activeTab === 1) {
          // 精炼
          const maxSlots = getRefineMaxSlots((item as any).quality || 'white');
          const curSlots = (item as any).refineStats?.length || 0;
          const refineCost = getRefineCost(item);
          if (curSlots < maxSlots) {
            p.add(this.add.text(sx + 300, sy + 8, `${refineCost.gold}金币 | ${curSlots}/${maxSlots}槽`, { fontSize: '10px', color: '#888899', padding: { y: 1 } }));
            const btn = this.add.text(sx + 420, sy + 4, '[ 精炼 ]', { fontSize: '16px', color: '#4488ff', fontStyle: 'bold', padding: { x: 16, y: 8 }, backgroundColor: '#11224488' }).setInteractive({ useHandCursor: true });
            btn.on('pointerover', () => btn.setColor('#66aaff'));
            btn.on('pointerout', () => btn.setColor('#4488ff'));
            btn.on('pointerdown', () => {
              const result = doRefine(item);
              GameState.recalcStats(); this.closeEnhancePanel(); this.toggleEnhancePanel();
              this.scene.get('UIScene').events.emit('updateStats');
              const n = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, result.message, { fontSize: '16px', color: result.success ? '#88ccff' : '#ff6666', fontStyle: 'bold', backgroundColor: '#111122cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400);
              this.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => n.destroy() });
            });
            p.add(btn);
          } else {
            p.add(this.add.text(sx + 300, sy + 8, `${curSlots}/${maxSlots}槽已满`, { fontSize: '10px', color: '#888899', padding: { y: 1 } }));
            const btn = this.add.text(sx + 420, sy + 4, '[ 重置 ]', { fontSize: '16px', color: '#cc8844', fontStyle: 'bold', padding: { x: 16, y: 8 }, backgroundColor: '#33220088' }).setInteractive({ useHandCursor: true });
            btn.on('pointerdown', () => { doRefineReset(item); GameState.recalcStats(); this.closeEnhancePanel(); this.toggleEnhancePanel(); this.scene.get('UIScene').events.emit('updateStats'); });
            p.add(btn);
          }
        } else {
          // 分解
          const decompReturn = getDecompReturn(item);
          const matStr = decompReturn.materials.map(m => `${m.name}×${m.qty}`).join(', ');
          p.add(this.add.text(sx + 300, sy + 8, `${decompReturn.gold}金币 | ${matStr}`, { fontSize: '9px', color: '#888899', padding: { y: 1 } }));
          const btn = this.add.text(sx + 420, sy + 4, '[ 分解 ]', { fontSize: '16px', color: '#88cc44', fontStyle: 'bold', padding: { x: 16, y: 8 }, backgroundColor: '#11221188' }).setInteractive({ useHandCursor: true });
          btn.on('pointerover', () => btn.setColor('#aaffaa'));
          btn.on('pointerout', () => btn.setColor('#88cc44'));
          btn.on('pointerdown', () => {
            const result = doDecompose(item);
            GameState.recalcStats(); this.closeEnhancePanel(); this.toggleEnhancePanel();
            this.scene.get('UIScene').events.emit('updateStats');
            const n = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, result.message, { fontSize: '16px', color: '#88cc44', fontStyle: 'bold', backgroundColor: '#112211cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400);
            this.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => n.destroy() });
          });
          p.add(btn);
        }
      } else { p.add(this.add.text(sx + 10, sy + 24, '未装备', { fontSize: '13px', color: '#334455', padding: { y: 1 } })); }
    });

    // 背包装备列表（可强化/精炼/分解）
    const bagItems = Inventory.items.filter(it => it.type === 'equipment');
    if (bagItems.length > 0) {
      const bagY = listY + 5 * 72 + 10;
      p.add(this.add.text(ox + 30, bagY, '背包装备', { fontSize: '14px', color: '#88aacc', fontStyle: 'bold', padding: { y: 2 } }));
      const qc2: Record<string, string> = { white: '#aaaaaa', green: '#44cc44', blue: '#4488ff', purple: '#cc44cc', gold: '#ffaa00' };
      bagItems.forEach((item, bi) => {
        const col = bi % 2, row = Math.floor(bi / 2); const sx = ox + 30 + col * 520, sy = bagY + 28 + row * 68;
        const er2 = this.add.graphics(); er2.fillStyle(0x0d0d1d, 0.7); er2.fillRoundedRect(sx, sy, 500, 58, 6);
        er2.lineStyle(1, 0x334466, 0.4); er2.strokeRoundedRect(sx, sy, 500, 58, 6); p.add(er2);
        const elv = (item as any).enhanceLevel || 0; const q = (item as any).quality || 'white';
        p.add(this.add.text(sx + 10, sy + 4, `${item.name}${elv > 0 ? ' +' + elv : ''}`, { fontSize: '12px', color: qc2[q] || '#cccccc', fontStyle: 'bold', padding: { y: 1 } }));
        const stats = item.stats ? Object.entries(item.stats as Record<string, number>).map(([k, v]) => `${k}+${v}`).join(' ') : '';
        p.add(this.add.text(sx + 10, sy + 24, stats, { fontSize: '9px', color: '#7788aa', padding: { y: 1 } }));

        if (this.enhanceTab === 0 && elv < 10) {
          const cost = getEnhanceCost(elv + 1, q); const rate = getEnhanceRate(elv + 1);
          p.add(this.add.text(sx + 280, sy + 6, `${cost.gold}金 ${Math.round(rate * 100)}%`, { fontSize: '9px', color: '#888899', padding: { y: 1 } }));
          const btn = this.add.text(sx + 400, sy + 4, '[ 强化 ]', { fontSize: '14px', color: '#ff8844', fontStyle: 'bold', padding: { x: 12, y: 6 }, backgroundColor: '#33220088' }).setInteractive({ useHandCursor: true });
          btn.on('pointerdown', () => { const result = doEnhance(item); GameState.recalcStats(); this.closeEnhancePanel(); this.toggleEnhancePanel(); this.scene.get('UIScene').events.emit('updateStats'); const n = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, result.message, { fontSize: '16px', color: result.success ? '#88ff88' : '#ff6666', fontStyle: 'bold', backgroundColor: '#112211cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400); this.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => n.destroy() }); });
          p.add(btn);
        } else if (this.enhanceTab === 1) {
          const maxSlots = getRefineMaxSlots(q); const curSlots = (item as any).refineStats?.length || 0;
          if (curSlots < maxSlots) {
            const rc = getRefineCost(item);
            p.add(this.add.text(sx + 280, sy + 6, `${rc.gold}金 ${curSlots}/${maxSlots}槽`, { fontSize: '9px', color: '#888899', padding: { y: 1 } }));
            const btn = this.add.text(sx + 400, sy + 4, '[ 精炼 ]', { fontSize: '14px', color: '#4488ff', fontStyle: 'bold', padding: { x: 12, y: 6 }, backgroundColor: '#11224488' }).setInteractive({ useHandCursor: true });
            btn.on('pointerdown', () => { const result = doRefine(item); GameState.recalcStats(); this.closeEnhancePanel(); this.toggleEnhancePanel(); this.scene.get('UIScene').events.emit('updateStats'); const n = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, result.message, { fontSize: '16px', color: result.success ? '#88ccff' : '#ff6666', fontStyle: 'bold', backgroundColor: '#111122cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400); this.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => n.destroy() }); });
            p.add(btn);
          } else {
            p.add(this.add.text(sx + 350, sy + 8, `${curSlots}/${maxSlots}满`, { fontSize: '10px', color: '#888899', padding: { y: 1 } }));
            const btn = this.add.text(sx + 420, sy + 4, '[ 重置 ]', { fontSize: '14px', color: '#cc8844', fontStyle: 'bold', padding: { x: 12, y: 6 }, backgroundColor: '#33220088' }).setInteractive({ useHandCursor: true });
            btn.on('pointerdown', () => { doRefineReset(item); GameState.recalcStats(); this.closeEnhancePanel(); this.toggleEnhancePanel(); this.scene.get('UIScene').events.emit('updateStats'); });
            p.add(btn);
          }
        } else if (this.enhanceTab === 2) {
          const dr = getDecompReturn(item);
          p.add(this.add.text(sx + 280, sy + 6, `${dr.gold}金 ${dr.materials.map(m => m.name + '×' + m.qty).join(',')}`, { fontSize: '8px', color: '#888899', padding: { y: 1 } }));
          const btn = this.add.text(sx + 400, sy + 4, '[ 分解 ]', { fontSize: '14px', color: '#88cc44', fontStyle: 'bold', padding: { x: 12, y: 6 }, backgroundColor: '#11221188' }).setInteractive({ useHandCursor: true });
          btn.on('pointerdown', () => { const result = doDecompose(item); GameState.recalcStats(); this.closeEnhancePanel(); this.toggleEnhancePanel(); this.scene.get('UIScene').events.emit('updateStats'); const n = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, result.message, { fontSize: '16px', color: '#88cc44', fontStyle: 'bold', backgroundColor: '#112211cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400); this.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => n.destroy() }); });
          p.add(btn);
        }
      });
    }

    const fy = oy + oh - 28; const ft = this.add.graphics();
    ft.fillStyle(0x1a1a36, 0.8); ft.fillRoundedRect(ox + 4, fy, ow - 8, 24, { tl: 0, tr: 0, bl: 10, br: 10 }); p.add(ft);
    p.add(this.add.text(GAME_WIDTH / 2, fy + 12, 'ESC 关闭  |  切换标签选择功能', {
      fontSize: '11px', color: '#556688', padding: { y: 2 } }).setOrigin(0.5));
  }

  private closeEnhancePanel(): void { this.enhancePanel?.destroy(true); this.enhancePanel = null; this.resumeFromMenu(); }

  // ═══ Quest Log ═══
  private questLogPanel: Phaser.GameObjects.Container | null = null;

  private toggleQuestLog(): void {
    if (this.questLogPanel) { this.questLogPanel.destroy(true); this.questLogPanel = null; this.resumeFromMenu(); return; }
    this.pauseForMenu(); this.renderQuestLogPanel();
  }

  private renderQuestLogPanel(): void {
    const cam = this.cameras.main;
    const p = this.add.container(Math.round(cam.scrollX), Math.round(cam.scrollY)).setDepth(300);
    this.questLogPanel = p;
    const ov = this.add.graphics(); ov.fillStyle(0, 0.78); ov.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    ov.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains); p.add(ov);
    const ox = 30, oy = 20, ow = GAME_WIDTH - 60, oh = GAME_HEIGHT - 40;
    const mb = this.add.graphics(); mb.fillStyle(0x121222, 0.98); mb.fillRoundedRect(ox, oy, ow, oh, 12);
    mb.lineStyle(2, 0x4a5a8a, 0.6); mb.strokeRoundedRect(ox, oy, ow, oh, 12); p.add(mb);
    const th = 54; const tb = this.add.graphics(); tb.fillStyle(0x1a1a36, 1);
    tb.fillRoundedRect(ox + 4, oy + 4, ow - 8, th, { tl: 10, tr: 10, bl: 0, br: 0 }); p.add(tb);
    p.add(this.add.text(GAME_WIDTH / 2, oy + th / 2, '\u25c6  \u4efb \u52a1 \u65e5 \u5fd7  \u25c6', {
      fontSize: '22px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));
    p.add(this.add.text(ox + ow - 40, oy + th / 2, '\u2715', {
      fontSize: '22px', color: '#cc6666', padding: { x: 8, y: 4 } }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', function (this: any) { this.setColor('#ff8888'); })
      .on('pointerout', function (this: any) { this.setColor('#cc6666'); })
      .on('pointerdown', () => this.toggleQuestLog()));

    // 当前任务
    let cy = oy + th + 20;
    p.add(this.add.text(ox + 30, cy, '\u5f53\u524d\u4efb\u52a1', { fontSize: '16px', color: '#88aacc', fontStyle: 'bold', padding: { y: 3 } }));
    cy += 30;
    if (GameState.activeQuest) {
      const q = GameState.getActiveQuestDef();
      if (q) {
        p.add(this.add.text(ox + 30, cy, `\u2605 ${q.name}`, { fontSize: '15px', color: '#ffe8b0', fontStyle: 'bold', padding: { y: 2 } }));
        cy += 24;
        p.add(this.add.text(ox + 30, cy, q.desc, { fontSize: '12px', color: '#aaaacc', padding: { y: 1 } }));
        cy += 22;
        for (const obj of q.objectives) {
          const prog = GameState.questObjProgress[obj.target] || 0;
          const done = prog >= obj.count;
          p.add(this.add.text(ox + 50, cy, `${done ? '\u2713' : '\u25cb'} ${obj.desc} ${prog}/${obj.count}`, {
            fontSize: '12px', color: done ? '#88cc88' : '#ccccdd', padding: { y: 1 } }));
          cy += 20;
        }
        cy += 10;
        // 奖励预览
        let rewardStr = '\u5956\u52b1: ';
        if (q.rewards.gold) rewardStr += `${q.rewards.gold}\u91d1\u5e01 `;
        if (q.rewards.exp) rewardStr += `${q.rewards.exp}\u7ecf\u9a8c `;
        if (q.rewards.items) rewardStr += q.rewards.items.map(it => `${it.name}\u00d7${it.count}`).join(' ');
        if (q.rewards.unlock) rewardStr += `\u89e3\u9501:${q.rewards.unlock}`;
        p.add(this.add.text(ox + 30, cy, rewardStr, { fontSize: '11px', color: '#ffcc44', padding: { y: 1 } }));
        cy += 24;
      }
    } else {
      p.add(this.add.text(ox + 30, cy, '\u65e0\u6d3b\u8dc3\u4efb\u52a1\uff0c\u53bb\u627eNPC\u5bf9\u8bdd\u63a5\u53d6\u4efb\u52a1\u5427\u3002', { fontSize: '13px', color: '#667788', padding: { y: 2 } }));
      cy += 24;
    }

    // 分割线
    cy += 10;
    const sep = this.add.graphics(); sep.lineStyle(1, 0x334466, 0.4); sep.lineBetween(ox + 30, cy, ox + ow - 30, cy); p.add(sep);
    cy += 16;

    // 主线任务列表（全部）
    p.add(this.add.text(ox + 30, cy, '主线任务', { fontSize: '16px', color: '#88aacc', fontStyle: 'bold', padding: { y: 3 } }));
    cy += 28;
    const colW2 = (ow - 60) / 2;
    let mainIdx = 0;
    for (const questId of MAIN_QUEST_ORDER) {
      const quest = MAIN_QUESTS[questId];
      if (!quest) continue;
      const isCompleted = GameState.questCompleted.includes(questId);
      const isActive = GameState.activeQuest === questId;
      const isAvailable = !isCompleted && !isActive && (!quest.prerequisite || GameState.questCompleted.includes(quest.prerequisite));
      const isLocked = !isCompleted && !isActive && !isAvailable;
      const col = mainIdx % 2, row = Math.floor(mainIdx / 2);
      const mx = ox + 30 + col * colW2, my = cy + row * 22;
      let icon = '\u25cb', color = '#556677';
      if (isCompleted) { icon = '\u2713'; color = '#558855'; }
      else if (isActive) { icon = '\u2605'; color = '#ffe8b0'; }
      else if (isAvailable) { icon = '\u25cb'; color = '#aabbcc'; }
      else { icon = '\u25a6'; color = '#445566'; } // 锁定
      const chLabel = quest.chapter === 0 ? '\u5e8f\u7ae0' : `\u7b2c${quest.chapter}\u7ae0`;
      p.add(this.add.text(mx, my, `${icon} [${chLabel}] ${quest.name}`, { fontSize: '12px', color, fontStyle: isActive ? 'bold' : 'normal', padding: { y: 1 } }));
      mainIdx++;
    }
    cy += Math.ceil(mainIdx / 2) * 22 + 16;

    // 分割线2
    const sep2 = this.add.graphics(); sep2.lineStyle(1, 0x334466, 0.4); sep2.lineBetween(ox + 30, cy, ox + ow - 30, cy); p.add(sep2);
    cy += 16;

    // 支线任务
    p.add(this.add.text(ox + 30, cy, '支线任务', { fontSize: '16px', color: '#88aacc', fontStyle: 'bold', padding: { y: 3 } }));
    cy += 28;
    const sideQuests = Object.values(SIDE_QUESTS);
    sideQuests.forEach((sq, i) => {
      const isCompleted = GameState.questCompleted.includes(sq.id);
      const isActive = GameState.activeQuest === sq.id;
      const isAvailable = !isCompleted && !isActive && (!sq.prerequisite || GameState.questCompleted.includes(sq.prerequisite));
      const col = i % 2, row = Math.floor(i / 2);
      const sx2 = ox + 30 + col * colW2, sy2 = cy + row * 22;
      let icon = '\u25cb', color = '#556677';
      if (isCompleted) { icon = '\u2713'; color = '#558855'; }
      else if (isActive) { icon = '\u2605'; color = '#ffe8b0'; }
      else if (isAvailable) { icon = '\u25cb'; color = '#aabbcc'; }
      else { icon = '\u25a6'; color = '#445566'; }
      p.add(this.add.text(sx2, sy2, `${icon} ${sq.name} (${sq.acceptFrom})`, { fontSize: '12px', color, fontStyle: isActive ? 'bold' : 'normal', padding: { y: 1 } }));
    });

    const fy = oy + oh - 28; const ft = this.add.graphics();
    ft.fillStyle(0x1a1a36, 0.8); ft.fillRoundedRect(ox + 4, fy, ow - 8, 24, { tl: 0, tr: 0, bl: 10, br: 10 }); p.add(ft);
    p.add(this.add.text(GAME_WIDTH / 2, fy + 12, 'L\u952e \u5f00\u5173  |  ESC \u5173\u95ed  |  \u2605\u8fdb\u884c\u4e2d  \u2713\u5b8c\u6210  \u25cb\u53ef\u63a5\u53d6  \u25a6\u9501\u5b9a', {
      fontSize: '11px', color: '#556688', padding: { y: 2 } }).setOrigin(0.5));
  }

  // ═══ Bestiary ═══
  private toggleBestiaryPanel(): void { if (this.bestiaryPanel) { this.closeBestiaryPanel(); return; } this.pauseForMenu(); this.renderBestiaryPanel(); }
  private closeBestiaryPanel(): void { if (this.bestiaryPanel) { this.bestiaryPanel.destroy(true); this.bestiaryPanel = null; this.resumeFromMenu(); } }
  private renderBestiaryPanel(): void {
    const cam=this.cameras.main;const c=this.add.container(Math.round(cam.scrollX),Math.round(cam.scrollY)).setDepth(300);this.bestiaryPanel=c;
    const ov=this.add.graphics();ov.fillStyle(0,0.78);ov.fillRect(0,0,GAME_WIDTH,GAME_HEIGHT);ov.setInteractive(new Phaser.Geom.Rectangle(0,0,GAME_WIDTH,GAME_HEIGHT),Phaser.Geom.Rectangle.Contains);c.add(ov);
    const ox=30,oy=20,ow=GAME_WIDTH-60,oh=GAME_HEIGHT-40;
    const bg=this.add.graphics();bg.fillStyle(0x121222,0.98);bg.fillRoundedRect(ox,oy,ow,oh,12);bg.lineStyle(2,0x4a5a8a,0.6);bg.strokeRoundedRect(ox,oy,ow,oh,12);c.add(bg);
    const th=54;const tb=this.add.graphics();tb.fillStyle(0x1a1a36,1);tb.fillRoundedRect(ox+4,oy+4,ow-8,th,{tl:10,tr:10,bl:0,br:0});c.add(tb);
    c.add(this.add.text(GAME_WIDTH/2,oy+th/2,'◆  妖 魔 图 鉴  ◆',{fontSize:'22px',color:'#e8d5a3',fontStyle:'bold',padding:{y:3}}).setOrigin(0.5));
    c.add(this.add.text(ox+ow-40,oy+th/2,'✕',{fontSize:'22px',color:'#cc6666',padding:{x:8,y:4}}).setOrigin(0.5).setInteractive({useHandCursor:true}).on('pointerover',function(this:any){this.setColor('#ff8888');}).on('pointerout',function(this:any){this.setColor('#cc6666');}).on('pointerdown',()=>this.closeBestiaryPanel()));
    const ty=oy+th+16;const cw=(ow-60)/4;const rd=getBestiaryTierReached(GameState.bestiaryKilled);const tn=Object.keys(NAMED_ENEMIES).length;
    BESTIARY_TIERS.forEach((tr,ti)=>{const cx=ox+14+ti*(cw+12);const ir=rd>=tr.id;const ic=GameState.bestiaryTierClaimed.includes(tr.id);const pg=getBestiaryTierProgress(tr.id,GameState.bestiaryKilled);const pt=pg.total>0?pg.completed/pg.total:0;const cc=ir?parseInt(tr.color.replace('#',''),16):0x222244;const cb=this.add.graphics();cb.fillStyle(cc,ir?0.18:0.12);cb.fillRoundedRect(cx,ty,cw,100,8);cb.lineStyle(1,cc,ir?0.6:0.25);cb.strokeRoundedRect(cx,ty,cw,100,8);c.add(cb);const ic2=ir?parseInt(tr.color.replace('#',''),16):0x444466;const ico=this.add.graphics();ico.fillStyle(ic2,ir?1:0.5);ico.fillCircle(cx+20,ty+20,6);ico.lineStyle(2,ic2,0.7);ico.strokeCircle(cx+20,ty+20,9);c.add(ico);c.add(this.add.text(cx+34,ty+11,tr.name,{fontSize:'14px',color:ir?tr.color:'#666688',fontStyle:'bold',padding:{y:2}}));c.add(this.add.text(cx+34,ty+32,`全部×${tr.requiredKills}`,{fontSize:'10px',color:'#555577',padding:{y:1}}));const by2=ty+52,bw=cw-28;c.add(this.add.rectangle(cx+14+bw/2,by2,bw,6,0x111122,0.9));if(pt>0){const fw=Math.max(2,bw*pt);c.add(this.add.rectangle(cx+14+fw/2,by2,fw,5,ir?parseInt(tr.color.replace('#',''),16):0x334466,1));}const bty=ty+68;if(ic){c.add(this.add.text(cx+cw/2,bty,'✔ 已领取',{fontSize:'12px',color:'#558855',fontStyle:'bold',padding:{y:1}}).setOrigin(0.5));}else if(ir){const bt=this.add.text(cx+cw/2,bty,'[ 领取奖励 ]',{fontSize:'12px',color:'#ffcc44',fontStyle:'bold',backgroundColor:'#33220088',padding:{x:10,y:4}}).setOrigin(0.5).setInteractive({useHandCursor:true});bt.on('pointerover',()=>{bt.setColor('#ffff88');bt.setBackgroundColor('#443300aa');});bt.on('pointerout',()=>{bt.setColor('#ffcc44');bt.setBackgroundColor('#33220088');});bt.on('pointerdown',()=>{if(GameState.claimBestiaryTierReward(tr.id)){this.closeBestiaryPanel();this.renderBestiaryPanel();}});c.add(bt);}else{c.add(this.add.text(cx+cw/2,bty,`${Math.round(pt*100)}% · ${pg.completed}/${pg.total}`,{fontSize:'10px',color:'#556688',padding:{y:1}}).setOrigin(0.5));c.add(this.add.text(cx+cw/2,bty+16,tr.reward.desc,{fontSize:'9px',color:'#444466',padding:{y:1},wordWrap:{width:cw-10}}).setOrigin(0.5));}});
    const sy2=ty+130;const sp=this.add.graphics();sp.lineStyle(1,0x3a4a6a,0.5);sp.lineBetween(ox+14,sy2,ox+ow-14,sy2);c.add(sp);
    const bodyY=sy2+14,bh=oh-(sy2-oy)-36,lw=380,dw2=ow-lw-40,lx=ox+14,dx2=lx+lw+16;
    const lb=this.add.graphics();lb.fillStyle(0x0e0e22,0.7);lb.fillRoundedRect(lx,bodyY,lw,bh,6);lb.lineStyle(1,0x334466,0.4);lb.strokeRoundedRect(lx,bodyY,lw,bh,6);c.add(lb);
    const enc=GameState.bestiaryEncountered;c.add(this.add.text(lx+12,bodyY+10,`已遭遇 ${enc.length} / ${tn}`,{fontSize:'12px',color:'#8899cc',fontStyle:'bold',padding:{y:2}}));
    const an=Object.entries(NAMED_ENEMIES);const ih=26,mv=Math.floor((bh-40)/ih);const lc=this.add.container(lx,bodyY+34);c.add(lc);
    an.forEach(([nm,df],i)=>{if(i>=mv)return;const ry=i*ih;const en=GameState.bestiaryEncountered.includes(nm);const kl=GameState.bestiaryKilled[nm]||0;const ib2=df.type==='妖将'||df.type==='妖王';const rw=this.add.container(0,ry);const rb=this.add.rectangle(2,0,lw-6,ih-2,en?0x152525:0x121222,0.8);rb.setOrigin(0,0);rw.add(rb);if(ib2)rw.add(this.add.text(8,3,'👑',{fontSize:'11px',padding:{y:1}}));const nc2=en?(ib2?'#ffcc44':df.type==='恶妖'?'#ff8866':'#bbbbdd'):'#444466';rw.add(this.add.text(ib2?24:10,4,en?nm:'???',{fontSize:'12px',color:nc2,fontStyle:en&&ib2?'bold':'normal',padding:{y:1}}));if(en&&df.element&&df.element!=='无'){const ec2:Record<string,string>={火:'#ff6644',水:'#4488ff',风:'#44cc88',土:'#cc9944',暗:'#8844cc',光:'#ffdd44'};rw.add(this.add.text(lw-110,4,df.element,{fontSize:'10px',color:ec2[df.element]||'#888888',padding:{y:1}}));}if(kl>0)rw.add(this.add.text(lw-55,4,`×${kl}`,{fontSize:'11px',color:'#668866',fontStyle:'bold',padding:{y:1}}));rb.setInteractive({useHandCursor:true});rb.on('pointerover',()=>rb.setFillStyle(0x1a2a3a,1));rb.on('pointerout',()=>rb.setFillStyle(en?0x152525:0x121222,0.8));rb.on('pointerdown',()=>{this.showBestiaryDetail(dx2,bodyY,dw2,bh,nm,df,en,kl,c);});lc.add(rw);});
    const rb2=this.add.graphics();rb2.fillStyle(0x0e0e22,0.7);rb2.fillRoundedRect(dx2,bodyY,dw2,bh,6);rb2.lineStyle(1,0x334466,0.4);rb2.strokeRoundedRect(dx2,bodyY,dw2,bh,6);c.add(rb2);
    c.add(this.add.text(dx2+dw2/2,bodyY+bh/2-20,'← 点击左侧敌人',{fontSize:'16px',color:'#334466',padding:{y:2}}).setOrigin(0.5));
    c.add(this.add.text(dx2+dw2/2,bodyY+bh/2+10,'查看详细信息',{fontSize:'14px',color:'#223355',padding:{y:2}}).setOrigin(0.5));
    const fy2=bodyY+bh+6;const ft=this.add.graphics();ft.fillStyle(0x1a1a36,0.8);ft.fillRoundedRect(ox+4,fy2,ow-8,24,{tl:0,tr:0,bl:10,br:10});c.add(ft);
    c.add(this.add.text(GAME_WIDTH/2,fy2+12,'N键 开关  |  ESC 关闭  |  点击敌人查看详情',{fontSize:'11px',color:'#556688',padding:{y:2}}).setOrigin(0.5));
  }
  private showBestiaryDetail(x:number,y:number,w:number,h:number,nm:string,df:any,en:boolean,kl:number,pa:Phaser.GameObjects.Container):void{
    if(this.bestiaryDetailContainer)this.bestiaryDetailContainer.destroy(true);this.bestiaryDetailContainer=this.add.container(x,y);pa.add(this.bestiaryDetailContainer);const dc=this.bestiaryDetailContainer,pad=14;
    if(!en){dc.add(this.add.text(w/2,h/2-30,'？',{fontSize:'48px',color:'#334466',fontStyle:'bold',padding:{y:4}}).setOrigin(0.5));dc.add(this.add.text(w/2,h/2+30,'尚未遭遇',{fontSize:'16px',color:'#445566',padding:{y:2}}).setOrigin(0.5));dc.add(this.add.text(w/2,h/2+56,'击败后解锁详细信息',{fontSize:'12px',color:'#334455',padding:{y:2}}).setOrigin(0.5));return;}
    const ib=df.type==='妖将'||df.type==='妖王';const nc=ib?'#ffcc44':df.type==='恶妖'?'#ff8866':'#ddddff';dc.add(this.add.text(pad,pad,nm,{fontSize:'22px',color:nc,fontStyle:'bold',padding:{y:3}}));
    const tc:Record<string,string>={杂妖:'#6688aa',恶妖:'#cc6644',妖将:'#cc8844',妖王:'#cc4444'};dc.add(this.add.text(pad,pad+32,df.type,{fontSize:'11px',color:tc[df.type]||'#666688',fontStyle:'bold',backgroundColor:'#00000066',padding:{x:8,y:3}}));
    dc.add(this.add.text(w-pad-80,pad+4,`击杀 ×${kl}`,{fontSize:'13px',color:'#8899cc',fontStyle:'bold',padding:{y:2}}));
    let cy=pad+68;const lh=22;const ec:Record<string,string>={火:'#ff6644',水:'#4488ff',风:'#44cc88',土:'#cc9944',暗:'#8844cc',光:'#ffdd44',无:'#888899'};
    [{l:'元素',v:df.element,c:ec[df.element]||'#888899'},{l:'弱点',v:df.weakness||'无',c:df.weakness?'#ff8866':'#666688'},{l:'抗性',v:df.resist||'无',c:df.resist?'#6688cc':'#666688'}].forEach(p=>{dc.add(this.add.text(pad+8,cy,`${p.l}：`,{fontSize:'12px',color:'#7788aa',padding:{y:1}}));dc.add(this.add.text(pad+60,cy,p.v,{fontSize:'12px',color:p.c,fontStyle:'bold',padding:{y:1}}));cy+=lh;});
    cy+=6;const h1=this.add.graphics();h1.lineStyle(1,0x2a3a4a,0.4);h1.lineBetween(pad,cy,w-pad,cy);dc.add(h1);cy+=12;
    const sn:Record<string,string>={灼烧:'灼烧',冻结:'冻结',中毒:'中毒',寄生:'寄生',减速:'减速',眩晕:'眩晕',束缚:'束缚',嘲讽:'嘲讽',恐惧:'恐惧',攻降:'攻降',防降:'防降',灵消:'灵消'};
    const es=Object.entries(df.statusResist||{});if(es.length===0){dc.add(this.add.text(pad+8,cy,'无特殊抗性',{fontSize:'11px',color:'#556688',padding:{y:2}}));cy+=lh;}
    else{es.forEach(([k,v]:any,i:number)=>{const col=i%2;const sx=pad+8+col*(w/2-8);const pct=Math.round(v*100);const sc=pct>=80?'#ff5555':pct>=40?'#ffaa44':'#66cc66';dc.add(this.add.text(sx,cy+Math.floor(i/2)*lh,`${sn[k]||k} ${pct}%`,{fontSize:'11px',color:sc,padding:{y:2}}));});cy+=Math.ceil(es.length/2)*lh;}
    cy+=6;const h2=this.add.graphics();h2.lineStyle(1,0x2a3a4a,0.4);h2.lineBetween(pad,cy,w-pad,cy);dc.add(h2);cy+=12;
    if(df.skills?.length){df.skills.forEach((s:any)=>{const dt=s.damageType==='magical'?'魔':'物';dc.add(this.add.text(pad+8,cy,`✦ ${s.name} [${dt}×${s.power}]`,{fontSize:'12px',color:'#ddbbee',fontStyle:'bold',padding:{y:1}}));cy+=lh;if(s.desc){dc.add(this.add.text(pad+16,cy,s.desc,{fontSize:'10px',color:'#7788aa',wordWrap:{width:w-pad*2-16},padding:{y:1}}));cy+=18;}});cy+=4;const h3=this.add.graphics();h3.lineStyle(1,0x2a3a4a,0.4);h3.lineBetween(pad,cy,w-pad,cy);dc.add(h3);cy+=12;}
    if(df.drops?.length){df.drops.forEach((d:any)=>{dc.add(this.add.text(pad+8,cy,`◆ ${d.item}`,{fontSize:'12px',color:'#88cc88',padding:{y:1}}));dc.add(this.add.text(w-pad-50,cy,`${Math.round(d.rate*100)}%`,{fontSize:'11px',color:'#669966',padding:{y:1}}));cy+=lh;});cy+=4;const h4=this.add.graphics();h4.lineStyle(1,0x2a3a4a,0.4);h4.lineBetween(pad,cy,w-pad,cy);dc.add(h4);cy+=12;}
    if(kl>=3&&df.lore){dc.add(this.add.text(pad,cy,'背景笔记',{fontSize:'13px',color:'#8899cc',fontStyle:'bold',padding:{y:2}}));cy+=lh+4;dc.add(this.add.text(pad+8,cy,df.lore,{fontSize:'11px',color:'#ccbb88',wordWrap:{width:w-pad*2-8},padding:{y:2}}));}
    else if(kl>0&&kl<3){dc.add(this.add.text(pad,cy,`再击败 ${3-kl} 次解锁背景笔记`,{fontSize:'11px',color:'#556688',padding:{y:2}}));}
  }
}
