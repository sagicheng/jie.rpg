import type { GameScene } from '../../scenes/GameScene';

import Phaser from 'phaser';

import { GAME_WIDTH, GAME_HEIGHT, ZANPAKUTO_GROWTH } from '../../core/config';

import { GameState } from '../../systems/progression/GameState';

import { GuildClient } from '../../systems/social/GuildClient';

import { FriendClient } from '../../systems/social/FriendClient';

import { GUILD_SKILLS, guildSkillCost } from '../../systems/social/GuildSkills';

import { SaveManager } from '../../core/SaveManager';

import { NAMED_ENEMIES, BESTIARY_TIERS, getBestiaryTierReached, getBestiaryTierProgress, BESTIARY_TITLES } from '../../systems/progression/BestiaryData';

import { expForLevel } from '../../systems/combat/BattleData';

import { Inventory, EquipSlot, Item } from '../../systems/items/Inventory';

import { listSetProgress, setShortName } from '../../systems/items/SetSystem';

import { PET_SPECIES_CLIENT, petIcon, petColor, computePetAura, petElementInfo, petQualityInfo, petSkillNames } from '../../systems/pet/PetSystem';

import { applyConsumable, getConsumableEffect } from '../../systems/items/ConsumableSystem';

import { createPlayerStatus } from '../../systems/combat/StatusSystem';

import { MAIN_QUESTS, MAIN_QUEST_ORDER, SIDE_QUESTS, getQuestDef, rollDailyPool, rollWeeklyPool, DAILY_CAP, WEEKLY_CAP } from '../../systems/quest/QuestData';

import { SHIKAI_SKILLS, ZANPAKUTO_ELEMENT } from '../../systems/combat/Skills';

import { Kido, KIDO_NODES, KidoSchool, TIER_LOCK } from '../../systems/combat/Kido';

import {
  getEnhanceRate, getEnhanceCost, doEnhance,
  getRefineMaxSlots, getRefineCost, doRefine, doRefineReset, getRefineDisplay,
  getDecompReturn, doDecompose,
  getEnhanceLabel, getEnhanceGlow,
} from '../../systems/items/EnhanceSystem';

import {
  requestBuy, requestEquip, requestUnequip, requestCraft, requestEnhance, requestRefine, requestDecompose, requestRefineReset, requestClaimQuest, requestAllocateStat, requestMallBuy, requestRespec,
  requestUnlock, requestSetZanpakuto, requestKidoSetSchool, requestKidoAllocate, requestClaimBestiaryTier, requestSetTitle, isOnline,
  requestArenaQueue, requestArenaCancel, requestArenaStatus, arena, tierNameById, ARENA_WEEKLY_CAP_CLIENT,
  requestGuildShopBuy,
  requestAuctionList, requestAuctionMine, requestAuctionFavList, requestAuctionHistory,
  requestAuctionFav, requestAuctionCreate, requestAuctionBuy, requestAuctionCancel,
  requestPetSetActive, requestPetRelease, requestPetRecall, requestPetSetAttr, requestUsePetEgg,
} from '../../systems/social/WorldClient';

import { GUILD_SHOP_ITEMS } from '../../systems/social/GuildShop';



export function toggleQuestLog(scene: GameScene): void {
    if (scene.questLogPanel) { scene.questLogPanel.destroy(true); scene.questLogPanel = null; scene.resumeFromMenu(); return; }
    scene.pauseForMenu(); renderQuestLogPanel(scene);
  }

export function renderQuestLogPanel(scene: GameScene): void {
    const cam = scene.cameras.main;
    const p = scene.add.container(Math.round(cam.scrollX), Math.round(cam.scrollY)).setDepth(300);
    scene.questLogPanel = p;
    const ov = scene.add.graphics(); ov.fillStyle(0, 0.78); ov.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    ov.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains); p.add(ov);
    const ox = 30, oy = 20, ow = GAME_WIDTH - 60, oh = GAME_HEIGHT - 40;
    const mb = scene.add.graphics(); mb.fillStyle(0x121222, 0.98); mb.fillRoundedRect(ox, oy, ow, oh, 12);
    mb.lineStyle(2, 0x4a5a8a, 0.6); mb.strokeRoundedRect(ox, oy, ow, oh, 12); p.add(mb);
    const th = 54; const tb = scene.add.graphics(); tb.fillStyle(0x1a1a36, 1);
    tb.fillRoundedRect(ox + 4, oy + 4, ow - 8, th, { tl: 10, tr: 10, bl: 0, br: 0 }); p.add(tb);
    p.add(scene.add.text(GAME_WIDTH / 2, oy + th / 2, '\u25c6  \u4efb \u52a1 \u65e5 \u5fd7  \u25c6', {
      fontSize: '22px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));
    p.add(scene.add.text(ox + ow - 40, oy + th / 2, '\u2715', {
      fontSize: '22px', color: '#cc6666', padding: { x: 8, y: 4 } }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', function (this: any) { this.setColor('#ff8888'); })
      .on('pointerout', function (this: any) { this.setColor('#cc6666'); })
      .on('pointerdown', () => toggleQuestLog(scene)));

    // 当前任务（多任务队列）
    let cy = oy + th + 20;
    p.add(scene.add.text(ox + 30, cy, '\u5f53\u524d\u4efb\u52a1', { fontSize: '16px', color: '#88aacc', fontStyle: 'bold', padding: { y: 3 } }));
    cy += 30;
    if (GameState.activeQuests.length === 0) {
      p.add(scene.add.text(ox + 30, cy, '\u65e0\u6d3b\u8dc3\u4efb\u52a1\uff0c\u53bb\u627eNPC\u5bf9\u8bdd\u6216\u4efb\u52a1\u677f\u63a5\u53d6\u4efb\u52a1\u5427\u3002', { fontSize: '13px', color: '#667788', padding: { y: 2 } }));
      cy += 24;
    } else {
      for (const aid of GameState.activeQuests) {
        const q = getQuestDef(aid);
        if (!q) continue;
        const ready = GameState.isQuestReady(aid);
        p.add(scene.add.text(ox + 30, cy, `${ready ? '\u2713' : '\u2605'} ${q.name}`, { fontSize: '15px', color: ready ? '#88cc88' : '#ffe8b0', fontStyle: 'bold', padding: { y: 2 } }));
        cy += 22;
        const prog = GameState.questProgress[aid] || {};
        for (const obj of q.objectives) {
          const pv = prog[obj.target] || 0;
          const done = pv >= obj.count;
          p.add(scene.add.text(ox + 50, cy, `${done ? '\u2713' : '\u25cb'} ${obj.desc} ${Math.min(pv, obj.count)}/${obj.count}`, {
            fontSize: '12px', color: done ? '#88cc88' : '#ccccdd', padding: { y: 1 } }));
          cy += 19;
        }
        cy += 4;
        let rewardStr = '\u5956\u52b1: ';
        if (q.rewards.gold) rewardStr += `${q.rewards.gold}\u91d1\u5e01 `;
        if (q.rewards.exp) rewardStr += `${q.rewards.exp}\u7ecf\u9a8c `;
        if (q.rewards.items) rewardStr += q.rewards.items.map(it => `${it.name}\u00d7${it.count}`).join(' ');
        if (q.rewards.unlock) rewardStr += `\u89e3\u9501:${q.rewards.unlock}`;
        p.add(scene.add.text(ox + 30, cy, rewardStr, { fontSize: '11px', color: '#ffcc44', padding: { y: 1 } }));
        cy += 22;
      }
    }

    // 分割线
    cy += 10;
    const sep = scene.add.graphics(); sep.lineStyle(1, 0x334466, 0.4); sep.lineBetween(ox + 30, cy, ox + ow - 30, cy); p.add(sep);
    cy += 16;

    // 主线任务列表（全部）
    p.add(scene.add.text(ox + 30, cy, '主线任务', { fontSize: '16px', color: '#88aacc', fontStyle: 'bold', padding: { y: 3 } }));
    cy += 28;
    const colW2 = (ow - 60) / 2;
    let mainIdx = 0;
    for (const questId of MAIN_QUEST_ORDER) {
      const quest = MAIN_QUESTS[questId];
      if (!quest) continue;
      const isCompleted = GameState.questCompleted.includes(questId);
      const isActive = GameState.isQuestActive(questId);
      const isAvailable = !isCompleted && !isActive && (!quest.prerequisite || GameState.questCompleted.includes(quest.prerequisite));
      const col = mainIdx % 2, row = Math.floor(mainIdx / 2);
      const mx = ox + 30 + col * colW2, my = cy + row * 22;
      let icon = '\u25cb', color = '#556677';
      if (isCompleted) { icon = '\u2713'; color = '#558855'; }
      else if (isActive) { icon = '\u2605'; color = '#ffe8b0'; }
      else if (isAvailable) { icon = '\u25cb'; color = '#aabbcc'; }
      else { icon = '\u25a6'; color = '#445566'; } // 锁定
      const chLabel = quest.chapter === 0 ? '\u5e8f\u7ae0' : `\u7b2c${quest.chapter}\u7ae0`;
      p.add(scene.add.text(mx, my, `${icon} [${chLabel}] ${quest.name}`, { fontSize: '12px', color, fontStyle: isActive ? 'bold' : 'normal', padding: { y: 1 } }));
      mainIdx++;
    }
    cy += Math.ceil(mainIdx / 2) * 22 + 16;

    // 分割线2
    const sep2 = scene.add.graphics(); sep2.lineStyle(1, 0x334466, 0.4); sep2.lineBetween(ox + 30, cy, ox + ow - 30, cy); p.add(sep2);
    cy += 16;

    // 支线任务
    p.add(scene.add.text(ox + 30, cy, '支线任务', { fontSize: '16px', color: '#88aacc', fontStyle: 'bold', padding: { y: 3 } }));
    cy += 28;
    const sideQuests = Object.values(SIDE_QUESTS);
    sideQuests.forEach((sq, i) => {
      const isCompleted = GameState.questCompleted.includes(sq.id);
      const isActive = GameState.isQuestActive(sq.id);
      const isAvailable = !isCompleted && !isActive && (!sq.prerequisite || GameState.questCompleted.includes(sq.prerequisite));
      const col = i % 2, row = Math.floor(i / 2);
      const sx2 = ox + 30 + col * colW2, sy2 = cy + row * 22;
      let icon = '\u25cb', color = '#556677';
      if (isCompleted) { icon = '\u2713'; color = '#558855'; }
      else if (isActive) { icon = '\u2605'; color = '#ffe8b0'; }
      else if (isAvailable) { icon = '\u25cb'; color = '#aabbcc'; }
      else { icon = '\u25a6'; color = '#445566'; }
      p.add(scene.add.text(sx2, sy2, `${icon} ${sq.name} (${sq.acceptFrom})`, { fontSize: '12px', color, fontStyle: isActive ? 'bold' : 'normal', padding: { y: 1 } }));
    });

    const fy = oy + oh - 28; const ft = scene.add.graphics();
    ft.fillStyle(0x1a1a36, 0.8); ft.fillRoundedRect(ox + 4, fy, ow - 8, 24, { tl: 0, tr: 0, bl: 10, br: 10 }); p.add(ft);
    p.add(scene.add.text(GAME_WIDTH / 2, fy + 12, 'L\u952e \u5f00\u5173  |  ESC \u5173\u95ed  |  \u2605\u8fdb\u884c\u4e2d  \u2713\u5b8c\u6210  \u25cb\u53ef\u63a5\u53d6  \u25a6\u9501\u5b9a', {
      fontSize: '11px', color: '#556688', padding: { y: 2 } }).setOrigin(0.5));
  }

// ═══ 任务板（每日 / 周常）═══
