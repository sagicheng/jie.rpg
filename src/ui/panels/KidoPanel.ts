/**
 * 鬼道面板 — 鬼道节点 / 流派加点与释放 的打开与渲染
 */

import type { GameScene } from '../../scenes/GameScene';

import Phaser from 'phaser';

import { GAME_WIDTH, GAME_HEIGHT, ZANPAKUTO_GROWTH } from '../../config/config';

import { GameState } from '../../managers/GameState';

import { GuildClient } from '../../api/GuildClient';

import { FriendClient } from '../../api/FriendClient';

import { GUILD_SKILLS, guildSkillCost } from '../../api/GuildSkills';

import { SaveManager } from '../../core/SaveManager';

import { NAMED_ENEMIES, BESTIARY_TIERS, getBestiaryTierReached, getBestiaryTierProgress, BESTIARY_TITLES } from '../../managers/BestiaryData';

import { expForLevel } from '../../managers/BattleData';

import { Inventory, EquipSlot, Item } from '../../managers/Inventory';

import { listSetProgress, setShortName } from '../../managers/SetSystem';

import { PET_SPECIES_CLIENT, petIcon, petColor, computePetAura, petElementInfo, petQualityInfo, petSkillNames } from '../../managers/PetSystem';

import { applyConsumable, getConsumableEffect } from '../../managers/ConsumableSystem';

import { createPlayerStatus } from '../../managers/StatusSystem';

import { MAIN_QUESTS, MAIN_QUEST_ORDER, SIDE_QUESTS, getQuestDef, rollDailyPool, rollWeeklyPool, DAILY_CAP, WEEKLY_CAP } from '../../managers/QuestData';

import { SHIKAI_SKILLS, ZANPAKUTO_ELEMENT } from '../../managers/Skills';

import { Kido, KIDO_NODES, KidoSchool, TIER_LOCK } from '../../managers/Kido';

import {
  getEnhanceRate, getEnhanceCost, doEnhance,
  getRefineMaxSlots, getRefineCost, doRefine, doRefineReset, getRefineDisplay,
  getDecompReturn, doDecompose,
  getEnhanceLabel, getEnhanceGlow,
} from '../../managers/EnhanceSystem';

import {
  requestBuy, requestEquip, requestUnequip, requestCraft, requestEnhance, requestRefine, requestDecompose, requestRefineReset, requestClaimQuest, requestAllocateStat, requestMallBuy, requestRespec,
  requestUnlock, requestSetZanpakuto, requestKidoSetSchool, requestKidoAllocate, requestClaimBestiaryTier, requestSetTitle, isOnline,
  requestArenaQueue, requestArenaCancel, requestArenaStatus, arena, tierNameById, ARENA_WEEKLY_CAP_CLIENT,
  requestGuildShopBuy,
  requestAuctionList, requestAuctionMine, requestAuctionFavList, requestAuctionHistory,
  requestAuctionFav, requestAuctionCreate, requestAuctionBuy, requestAuctionCancel,
  requestPetSetActive, requestPetRelease, requestPetRecall, requestPetSetAttr, requestUsePetEgg,
} from '../../api/WorldClient';

import { GUILD_SHOP_ITEMS } from '../../api/GuildShop';



export function showKidoPanel(scene: GameScene): void {
    if (scene.kidoPanel) { closeKidoPanel(scene); return; }
    scene.pauseForMenu(); const cam = scene.cameras.main;
    const p = scene.add.container(Math.round(cam.scrollX), Math.round(cam.scrollY)).setDepth(300); scene.kidoPanel = p;
    const ov = scene.add.graphics(); ov.fillStyle(0, 0.78); ov.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    ov.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains); p.add(ov);
    const ox = 30, oy = 20, ow = GAME_WIDTH - 60, oh = GAME_HEIGHT - 40;
    const mb = scene.add.graphics(); mb.fillStyle(0x121222, 0.98); mb.fillRoundedRect(ox, oy, ow, oh, 12);
    mb.lineStyle(2, 0x4a5a8a, 0.6); mb.strokeRoundedRect(ox, oy, ow, oh, 12); p.add(mb);
    const th = 54; const tb = scene.add.graphics(); tb.fillStyle(0x1a1a36, 1);
    tb.fillRoundedRect(ox + 4, oy + 4, ow - 8, th, { tl: 10, tr: 10, bl: 0, br: 0 }); p.add(tb);
    p.add(scene.add.text(GAME_WIDTH / 2, oy + th / 2, '\u25c6  \u9b3c \u9053 \u5929 \u8d4b  \u25c6', {
      fontSize: '22px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));
    p.add(scene.add.text(ox + ow - 40, oy + th / 2, '\u2715', {
      fontSize: '22px', color: '#cc6666', padding: { x: 8, y: 4 } }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', function (this: any) { this.setColor('#ff8888'); })
      .on('pointerout', function (this: any) { this.setColor('#cc6666'); })
      .on('pointerdown', () => closeKidoPanel(scene)));

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
    p.add(scene.add.text(GAME_WIDTH / 2, oy + th + 16, `\u53ef\u7528\u9b3c\u9053\u70b9: ${avail}  |  \u5df2\u6295\u5165: ${totalSpent}  |  \u5f53\u524d: ${schools.find(s => s.id === activeTab)?.name || ''}`, {
      fontSize: '14px', color: '#ffcc44', fontStyle: 'bold', padding: { y: 2 }, backgroundColor: '#121222' }).setOrigin(0.5));

    // Tab buttons
    const tabY = oy + th + 44;
    schools.forEach((s, i) => {
      const isA = s.id === activeTab; const tx = ox + 30 + i * 140;
      const tb2 = scene.add.graphics();
      tb2.fillStyle(isA ? 0x2a1a0a : 0x111122, 0.8); tb2.fillRoundedRect(tx, tabY, 130, 34, 6);
      tb2.lineStyle(1, isA ? parseInt(s.color.replace('#', ''), 16) : 0x334466, isA ? 0.8 : 0.4);
      tb2.strokeRoundedRect(tx, tabY, 130, 34, 6); p.add(tb2);
      const t = scene.add.text(tx + 65, tabY + 17, s.name, {
        fontSize: '15px', color: isA ? s.color : '#555566', fontStyle: 'bold', padding: { y: 2 }
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      t.on('pointerover', () => { if (!isA) t.setColor('#888899'); });
      t.on('pointerout', () => { if (!isA) t.setColor('#555566'); });
      t.on('pointerdown', () => {
        if (s.id !== activeTab) { if (isOnline()) requestKidoSetSchool(s.id); Kido.school = s.id; closeKidoPanel(scene); showKidoPanel(scene); }
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
      p.add(scene.add.text(ox + 20, rowY - 10, `T${tier} (${tierLock}\u70b9)`, {
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
            const py = nodeAreaY + (tierIdx - 1) * rowH + rowH / 2;
            const parentPts = Kido.getPoints(parent.id) || 0;
            const lg = scene.add.graphics();
            lg.lineStyle(parentPts > 0 ? 3 : 1, parentPts > 0 ? colNum : 0x334466, parentPts > 0 ? 0.7 : 0.3);
            lg.beginPath(); lg.moveTo(nx, ny - nR - 2); lg.lineTo(nx, py + nR + 2); lg.strokePath();
            p.add(lg);
          }
        }

        // Node glow
        const og = scene.add.graphics();
        og.fillStyle(colNum, active ? 0.15 : 0.03); og.fillCircle(nx, ny, nR + 8); p.add(og);

        // Node circle
        const nc = scene.add.graphics();
        nc.fillStyle(active ? colNum : unlocked ? 0x1a1a3e : 0x080812, active ? 0.95 : 0.6);
        nc.fillCircle(nx, ny, nR);
        nc.lineStyle(active ? 3 : 1, active ? colNum : unlocked ? 0x445566 : 0x334455, active ? 1 : 0.5);
        nc.strokeCircle(nx, ny, nR); p.add(nc);

        // Points display
        const ptStr = nodePts > 0 ? `${nodePts}/${n.maxPoints}` : n.passive ? 'P' : '';
        p.add(scene.add.text(nx, ny - 2, ptStr, {
          fontSize: '11px', color: unlocked ? '#ffffff' : '#334455', fontStyle: 'bold', padding: { y: 1 }
        }).setOrigin(0.5));

        // Name
        p.add(scene.add.text(nx, ny + nR + 6, n.name, {
          fontSize: '11px', color: unlocked ? '#ccccdd' : '#445566', padding: { y: 1 }
        }).setOrigin(0.5));

        // Interactive zone
        const z = scene.add.zone(nx, ny, nR * 3, nR * 3 + 24).setInteractive({ useHandCursor: true });
        z.on('pointerover', () => {
          if (scene.kidoTooltip) scene.kidoTooltip.destroy();
          scene.kidoTooltip = scene.add.container(Math.min(nx + 30, GAME_WIDTH - 240), ny - 10).setDepth(320);
          const tt = scene.add.graphics(); tt.fillStyle(0x0a0a1a, 0.95); tt.fillRoundedRect(0, 0, 220, 80, 6);
          tt.lineStyle(1, colNum, 0.6); tt.strokeRoundedRect(0, 0, 220, 80, 6); scene.kidoTooltip.add(tt);
          scene.kidoTooltip.add(scene.add.text(8, 6, n.name, { fontSize: '12px', color: '#ffe8b0', fontStyle: 'bold', padding: { y: 1 } }));
          scene.kidoTooltip.add(scene.add.text(8, 24, n.desc, { fontSize: '9px', color: '#aaaacc', wordWrap: { width: 204 }, padding: { y: 1 } }));
          let status = '';
          let statusColor = '#666688';
          if (isMaxed) { status = '\u5df2\u6ee1\u7ea7'; statusColor = '#ffcc44'; }
          else if (canAdd) { status = `[\u70b9\u51fb\u52a0\u70b9] \u5269\u4f59${avail}\u70b9`; statusColor = '#88cc88'; }
          else if (!unlocked) { status = `\u9700\u8be5\u7cfb${tierLock}\u70b9\u89e3\u9501`; statusColor = '#cc6644'; }
          else if (avail <= 0) { status = '\u9b3c\u9053\u70b9\u4e0d\u8db3'; statusColor = '#cc6644'; }
          scene.kidoTooltip.add(scene.add.text(8, 56, status, { fontSize: '10px', color: statusColor, padding: { y: 1 } }));
        });
        z.on('pointerout', () => { if (scene.kidoTooltip) { scene.kidoTooltip.destroy(); scene.kidoTooltip = null; } });
        z.on('pointerdown', () => {
          if (canAdd) {
            if (isOnline()) requestKidoAllocate(n.id); else Kido.addPoint(n.id);
            GameState.recalcStats();
            closeKidoPanel(scene); showKidoPanel(scene);
            scene.scene.get('UIScene').events.emit('updateStats');
          }
        });
        p.add(z);
      });
    });

    const fy = oy + oh - 28; const ft = scene.add.graphics();
    ft.fillStyle(0x1a1a36, 0.8); ft.fillRoundedRect(ox + 4, fy, ow - 8, 24, { tl: 0, tr: 0, bl: 10, br: 10 }); p.add(ft);
    p.add(scene.add.text(GAME_WIDTH / 2, fy + 12, 'K\u952e \u5f00\u5173  |  ESC \u5173\u95ed  |  \u60ac\u505c\u67e5\u770b  |  \u70b9\u51fb\u52a0\u70b9  |  \u5207\u6362\u6807\u7b7e\u4fdd\u5b58\u5f53\u524d\u7cfb\u522b', {
      fontSize: '11px', color: '#556688', padding: { y: 2 } }).setOrigin(0.5));
  }

export function closeKidoPanel(scene: GameScene): void { scene.kidoPanel?.destroy(true); scene.kidoPanel = null; if (scene.kidoTooltip) { scene.kidoTooltip.destroy(); scene.kidoTooltip = null; } scene.resumeFromMenu(); }
