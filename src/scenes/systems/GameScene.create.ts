/**
 * GameScene create() 方法
 */
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, ZONE_NAMES } from '../../config/config';
import { GameState } from '../../managers/GameState';
import { Inventory } from '../../managers/Inventory';
import { SaveManager } from '../../core/SaveManager';
import { ZONE_CONFIGS } from '../../config/zones';
import { Kido, KIDO_NODES } from '../../managers/Kido';
import { getClient } from '../../core/Net';
import { applyWorldSync, setActiveRoom, setDisconnectNotifier } from '../../api/WorldClient';
import { openShop, openMall, toggleInventory, closeInventory, toggleStatPanel, closeStatPanel, renderInventoryPanel, renderStatPanel, showKidoPanel, closeKidoPanel, toggleEnhancePanel, closeEnhancePanel, toggleQuestLog, toggleBestiaryPanel, closeBestiaryPanel, renderQuestBoardPanel, showNamingInput, showShikaiSelection, openArenaPanel, closeArenaPanel, renderArenaPanel, setArenaStatus, setArenaMatching, renderGuildPanel, renderFriendPanel, renderAuctionPanel, openAuctionPanel, closeAuctionPanel, toggleAuctionPanel, refreshAuctionPanel, openPetPanel, closePetPanel, toggleTitlePanel, closeTitlePanel } from '../../ui/panels';
import { DialogueBox } from '../../ui/DialogueBox';
import { GuildClient } from '../../api/GuildClient';

export function _create(scene: any): void {
    scene.npcList = [];
    scene.enemies = [];
    scene.gatherPoints = [];
    scene.moveTarget = null;
    scene.isInDialogue = false;
    scene.canInteract = false;
    scene.currentNPC = null;
    // 副本返回时 GameScene 是 scene.start 重启（复用同一实例，不重跑构造期字段初始化），
    // inDungeon/nearbyDungeon 会残留上次 true → 二次进入副本被 checkDungeonPortal 的 !inDungeon 守卫永久挡掉。
    // 这里显式复位，确保每次重建都能再次进入副本。
    scene.inDungeon = false;
    scene.nearbyDungeon = false;

    scene.createMap();
    scene.dialogueBox = new DialogueBox(scene);
    scene.physics.world.setBounds(0, 0, GAME_WIDTH * 3, GAME_HEIGHT * 2);

    scene.player = scene.physics.add.sprite(GameState.x, GameState.y, 'walk_down_' + GameState.gender)
      .setDepth(10).setCollideWorldBounds(true);
    // 显示尺寸固定 40x60；碰撞体按"当前纹理实际尺寸"比例自适应（换透明底 PNG 尺寸变了也不错位）
    scene.player.setDisplaySize(40, 60);
    scene.fitBody(scene.player, 0.7, 0.9, 0.15, 0.04);

    // 行走动画（两种性别各一套，精灵表 walk_${facing}_${gender}，每向 8 帧，80×120）
    const mkWalk = (key: string, tex: string) => {
      if (!scene.anims.exists(key)) {
        scene.anims.create({ key, frames: scene.anims.generateFrameNumbers(tex, { start: 0, end: 7 }), frameRate: 10, repeat: -1 });
      }
    };
    for (const g of ['male', 'female'] as const) {
      mkWalk(`walk_down_${g}`, `walk_down_${g}`);
      mkWalk(`walk_side_${g}`, `walk_side_${g}`);
      mkWalk(`walk_up_${g}`,   `walk_up_${g}`);
    }

    // 怪物分组：用物理重叠检测替代中心点距离判定，接触即触发战斗（更稳、更符合直觉）
    scene.enemyGroup = scene.physics.add.group();
    scene.physics.add.overlap(scene.player, scene.enemyGroup, scene.onEnemyOverlap, undefined, scene);

    // 玩家头顶：角色名 + 称号（跟随人物移动）。用 displayHeight 而不是 height，避免 512x768 纹理导致标签飞到头顶上方 300+ 像素
    const ph = scene.player.displayHeight / 2;
    scene.nameTag = scene.add.text(scene.player.x, scene.player.y - ph - 22, scene.playerDisplayName(), {
      fontSize: '12px', color: '#bfe8ff', fontStyle: 'bold',
      backgroundColor: '#00000066', padding: { x: 4, y: 1 },
    }).setOrigin(0.5, 1).setDepth(11);
    scene.titleTag = scene.add.text(scene.player.x, scene.player.y - ph - 8, '', {
      fontSize: '11px', color: '#ffd9a0', fontStyle: 'bold',
      backgroundColor: '#00000066', padding: { x: 4, y: 1 },
    }).setOrigin(0.5, 1).setDepth(11);
    scene.syncPlayerTags();
    // 每日/周常按本地日期刷新（确保 dailyState.weeklyState 日期在任意交互前就位）
    GameState.ensureDailyRefresh();
    GameState.ensureWeeklyRefresh();
    scene.connectGameRoom();

    // 相机跟随玩家
    scene.cameras.main.setBounds(0, 0, GAME_WIDTH * 3, GAME_HEIGHT * 2);
    scene.cameras.main.startFollow(scene.player, true, 0.08, 0.08);

    scene.createNPCs();
    scene.createEnemies();
    scene.createGatheringPoints();

    scene.cursors = scene.input.keyboard!.createCursorKeys();
    scene.ctrlKey = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL);
    scene.keys = {
      W: scene.input.keyboard!.addKey('W'), A: scene.input.keyboard!.addKey('A'),
      S: scene.input.keyboard!.addKey('S'), D: scene.input.keyboard!.addKey('D'),
      SHIFT: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
    };
    // 离散动作键 F 用事件驱动（keydown-F），与 B/C 一致；避免 JustDown 在快速点按时被
    // keyup 同帧清零导致「按了像没按」的吞键问题
    scene.input.keyboard!.on('keydown-F', scene.onInteractKey, scene);
    scene.input.keyboard!.addKey('B').on('down', () => { if (!scene.isInDialogue && !scene.statPanel) toggleInventory(scene); });
    scene.input.keyboard!.addKey('C').on('down', () => { if (!scene.isInDialogue && !scene.inventoryPanel) toggleStatPanel(scene); });
    scene.input.keyboard!.addKey('K').on('down', () => {
      if (!scene.isInDialogue && !scene.inventoryPanel && !scene.statPanel) showKidoPanel(scene);
    });
    scene.input.keyboard!.addKey('N').on('down', () => {
      if (!scene.isInDialogue && !scene.inventoryPanel && !scene.statPanel && !scene.kidoPanel && !scene.enhancePanel)
        toggleBestiaryPanel(scene);
    });
    scene.input.keyboard!.addKey('L').on('down', () => {
      if (!scene.isInDialogue && !scene.inventoryPanel && !scene.statPanel && !scene.kidoPanel && !scene.enhancePanel && !scene.bestiaryPanel)
        toggleQuestLog(scene);
    });
    scene.input.keyboard!.addKey('T').on('down', () => {
      if (!scene.isInDialogue && !scene.inventoryPanel && !scene.statPanel && !scene.kidoPanel && !scene.enhancePanel && !scene.bestiaryPanel)
        toggleTitlePanel(scene);
    });
    scene.input.keyboard!.addKey('ESC').on('down', () => {
      if (scene.teamPanelFull) { scene.closeTeamPanel(); return; }
      if (scene.dungeonConfirmOpen) { scene.closeDungeonConfirm(); return; }
      if (scene.inventoryPanel) { closeInventory(scene); return; }
      if (scene.statPanel) { closeStatPanel(scene); return; }
      if (scene.kidoPanel) { closeKidoPanel(scene); return; }
      if (scene.enhancePanel) { closeEnhancePanel(scene); return; }
      if (scene.titlePanel) { closeTitlePanel(scene); return; }
      if (scene.bestiaryPanel) { closeBestiaryPanel(scene); return; }
      if (scene.questLogPanel) { scene.questLogPanel.destroy(true); scene.questLogPanel = null; scene.resumeFromMenu(); return; }
      if (scene.auctionPanel) { closeAuctionPanel(scene); return; }
      if (scene.petPanel) { closePetPanel(scene); return; }
      if (scene.isInDialogue) return;
      SaveManager.save();
      const notif = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, '已存档', {
        fontSize: '24px', color: '#88ff88', fontStyle: 'bold',
        backgroundColor: '#112211cc', padding: { x: 20, y: 12 },
      }).setOrigin(0.5).setScrollFactor(0).setDepth(300);
      scene.tweens.add({
        targets: notif, alpha: 0, y: GAME_HEIGHT / 2 - 30,
        duration: 1200, delay: 400, onComplete: () => notif.destroy(),
      });
    });

    // 鼠标点击移动（组队非队长禁止）
    scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (scene.isInDialogue || scene.statPanel || scene.inventoryPanel || scene.kidoPanel || scene.enhancePanel || scene.bestiaryPanel || scene.questLogPanel || scene.namingPanelActive || scene.shopPanel || scene.mallPanel || scene.guildPanel || scene.friendPanel || scene.auctionPanel) return;
      if (scene.teamPanelFull || scene.dungeonConfirmOpen) return; // 模态界面打开时不移动
      if (scene.teamId && scene.teamLeaderSid !== scene.mySessionId) return; // 非队长不移
      const wp = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
      scene.moveTarget = { x: wp.x, y: wp.y };
    });

    // 联机：进入组队战斗房间（两个窗口都按 V 即同房间组队打怪）
    scene.input.keyboard!.addKey('V').on('down', () => {
      if (scene.isInDialogue || scene.statPanel || scene.inventoryPanel || scene.kidoPanel || scene.enhancePanel || scene.bestiaryPanel || scene.questLogPanel) return;
      scene.launchMultiBattle();
    });

    // 开发调试：全局暴露 GameState（绕过 Vite 多 chunk 双实例）
    (window as any).__gs = GameState;

    // 战斗结束（scene resume）时清除「战斗中」标记，并弹出权威战斗奖励报告（避免被战斗场景遮挡）
    scene.events.on(Phaser.Scenes.Events.RESUME, () => {
      scene.setBattling(false);
      scene.flushBattleReport();
      // 从副本返回：清除副本标记并相机淡入（enterDungeon 暂停前已淡出到黑，恢复时须淡回）
      if (scene.inDungeon) {
        scene.inDungeon = false;
        scene.nearbyDungeon = false;
        scene.promptText.setVisible(false);
        scene.cameras.main.fadeIn(400, 0, 0, 0);
      }
    });

    // 单独 G 键：开关独立组队面板
    scene.input.keyboard!.addKey('G').on('down', () => {
      if (scene.isInDialogue || scene.inDungeon || scene.scene.isActive('MultiBattleScene') || scene.scene.isActive('DungeonMapScene')) return;
      if (scene.dungeonConfirmOpen) return; // 确认框优先
      scene.toggleTeamPanel();
    });

    // J 键：开关公会面板
    scene.input.keyboard!.addKey('J').on('down', () => {
      if (scene.ctrlKey.isDown) return;
      if (scene.isInDialogue || scene.inDungeon || scene.scene.isActive('MultiBattleScene') || scene.scene.isActive('DungeonMapScene')) return;
      if (scene.dungeonConfirmOpen || scene.teamPanelFull || scene.questLogPanel || scene.petPanel) return;
      if (scene.inventoryPanel || scene.statPanel) return;
      scene.toggleGuildPanel();
    });

    // O 键：开关好友面板（K 已让给鬼道技能界面，避免冲突）
    scene.input.keyboard!.addKey('O').on('down', () => {
      if (scene.ctrlKey.isDown) return;
      if (scene.isInDialogue || scene.inDungeon || scene.scene.isActive('MultiBattleScene') || scene.scene.isActive('DungeonMapScene')) return;
      if (scene.dungeonConfirmOpen || scene.teamPanelFull || scene.questLogPanel || scene.petPanel) return;
      if (scene.inventoryPanel || scene.statPanel) return;
      scene.toggleFriendPanel();
    });

    // P 键：开关拍卖行面板（一口价交易 + 收藏/历史）
    scene.input.keyboard!.addKey('P').on('down', () => {
      if (scene.ctrlKey.isDown) return;
      if (scene.isInDialogue || scene.inDungeon || scene.scene.isActive('MultiBattleScene') || scene.scene.isActive('DungeonMapScene')) return;
      if (scene.dungeonConfirmOpen || scene.teamPanelFull || scene.questLogPanel || scene.petPanel) return;
      if (scene.inventoryPanel || scene.statPanel || scene.kidoPanel || scene.enhancePanel || scene.bestiaryPanel || scene.guildPanel || scene.friendPanel || scene.petPanel) return;
      scene.toggleAuctionPanel();
    });

    // U 键：开关灵宠面板
    scene.input.keyboard!.addKey('U').on('down', () => {
      if (scene.ctrlKey.isDown) return;
      if (scene.isInDialogue || scene.inDungeon || scene.scene.isActive('MultiBattleScene') || scene.scene.isActive('DungeonMapScene')) return;
      if (scene.dungeonConfirmOpen || scene.teamPanelFull || scene.questLogPanel) return;
      if (scene.inventoryPanel || scene.statPanel || scene.kidoPanel || scene.enhancePanel || scene.bestiaryPanel || scene.guildPanel || scene.friendPanel || scene.auctionPanel) return;
      scene.togglePetPanel(); // 面板开着时第二次按 U 由 togglePetPanel 内部关闭（不要在此提前 return）
    });

    // Enter 键：聚焦全局聊天输入框（模态/战斗/副本中不抢占）
    scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER).on('down', () => {
      if (scene.isInDialogue || scene.inDungeon || scene.scene.isActive('MultiBattleScene') || scene.scene.isActive('DungeonMapScene')) return;
      if (scene.dungeonConfirmOpen || scene.teamPanelFull || scene.questLogPanel || scene.guildPanel || scene.inventoryPanel || scene.statPanel) return;
      if (!scene.chatInputFocused) scene.focusChatInput();
    });

    // 全局聊天 HUD（底部常驻）
    scene.createChatHud();

    scene.zoneText = scene.add.text(16, 12, `${ZONE_NAMES[GameState.zone]}`, {
      fontSize: '14px', color: '#ffe8b0', fontStyle: 'bold',
      backgroundColor: '#000000aa', padding: { x: 8, y: 2 },
    }).setScrollFactor(0).setDepth(100);
    scene.coordText = scene.add.text(16, 34, 'X:0 Y:0', {
      fontSize: '11px', color: '#88aacc',
      backgroundColor: '#1a1a2ecc', padding: { x: 8, y: 2 },
    }).setScrollFactor(0).setDepth(100);
    // 队伍信息（持久 Text + setVisible 控制显隐，参照称号 titleTag 模式，避免 Container destroy 竞态残留）
    scene.teamInfoText = scene.add.text(16, 54, '', {
      fontSize: '12px', color: '#ffffff',
      backgroundColor: '#1a1a2ecc', padding: { x: 8, y: 2 },
    }).setScrollFactor(0).setDepth(100).setVisible(false).setInteractive({ useHandCursor: true });
    scene.teamInfoText.on('pointerdown', () => {
      if (scene.teamId) { const _toggle = (scene as any).openTeamPanel || (scene as any).toggleTeamPanel; if (_toggle) _toggle(scene); }
    });
    scene.promptText = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 60, '', {
      fontSize: '14px', color: '#ffe8b0', fontStyle: 'bold',
      backgroundColor: '#1a1a2ecc', padding: { x: 8, y: 2 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100);
    scene.miniMap = scene.add.graphics().setScrollFactor(0).setDepth(100);
    scene.netHint = scene.add.text(16, GAME_HEIGHT - 24, 'V：进入联机组队战', {
      fontSize: '12px', color: '#6688aa', backgroundColor: '#1a1a2eaa', padding: { x: 6, y: 2 },
    }).setScrollFactor(0).setDepth(100);
    scene.scene.launch('UIScene');

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (scene.gameRoom) { scene.gameRoom.leave(); scene.gameRoom = null; }
      setActiveRoom(null);
      scene.clearRemotePlayers();
    });

    scene.time.delayedCall(100, () => {
      scene.scene.get('UIScene').events.emit('updateStats');
    });

    if (!GameState.hasCreated && GameState.newGame) {
      scene.time.delayedCall(500, () => scene.startIntroDialogue());
    }

    scene.cameras.main.fadeIn(500, 0, 0, 0);

    // Zone entry banner
    const zoneName = ZONE_NAMES[GameState.zone] || '???';
    const zoneBanner = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, zoneName, {
      fontSize: '28px', color: '#ffe8b0', fontStyle: 'bold',
      backgroundColor: '#000000aa', padding: { x: 24, y: 12 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(250).setAlpha(0);
    scene.tweens.add({
      targets: zoneBanner, alpha: 1, duration: 500,
      onComplete: () => {
        scene.tweens.add({
          targets: zoneBanner, alpha: 0, duration: 1500, delay: 1000,
          onComplete: () => zoneBanner.destroy(),
        });
      },
    });
  }

  // ════════════════ Update Loop ════════════════

