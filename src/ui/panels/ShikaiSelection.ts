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



export function showShikaiSelection(scene: GameScene): void {
    // \u4eceZANPAKUTO_ELEMENT\u8bfb\u53d6\u5f53\u524d\u5143\u7d20\u7684\u5168\u90e89\u628a\u65a9\u9b44\u5200
    const el = GameState.element || '\u706b';
    const zanList = Object.entries(ZANPAKUTO_ELEMENT)
      .filter(([_, e]) => e === el)
      .map(([name]) => name);

    scene.isInDialogue = true;
    const cam = scene.cameras.main;
    const panel = scene.add.container(Math.round(cam.scrollX) + GAME_WIDTH / 2, Math.round(cam.scrollY) + GAME_HEIGHT / 2).setDepth(400);
    const bg = scene.add.graphics();
    bg.fillStyle(0x121222, 0.98); bg.fillRoundedRect(-560, -340, 1120, 680, 14);
    bg.lineStyle(2, 0x4a5a8a, 0.6); bg.strokeRoundedRect(-560, -340, 1120, 680, 14);
    panel.add(bg);

    // \u6807\u9898\u680f
    const tb = scene.add.graphics(); tb.fillStyle(0x1a1a36, 1);
    tb.fillRoundedRect(-556, -336, 1112, 50, { tl: 10, tr: 10, bl: 0, br: 0 }); panel.add(tb);
    const elNames: Record<string, string> = { '\u706b': '\u706b\u7cfb', '\u98ce': '\u98ce\u7cfb', '\u6c34': '\u6c34\u7cfb', '\u571f': '\u571f\u7cfb' };
    panel.add(scene.add.text(0, -311, '\u25c6  ' + (elNames[el] || el) + '\u59cb\u89e3\u65a9\u9b44\u5200\u9009\u62e9  \u25c6', {
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
      const card = scene.add.graphics();
      card.fillStyle(0x0d0d1d, 0.8); card.fillRoundedRect(zx, zy, cardW, cardH, 8);
      card.lineStyle(1, elColor, 0.3); card.strokeRoundedRect(zx, zy, cardW, cardH, 8);
      panel.add(card);

      // \u540d\u79f0
      panel.add(scene.add.text(zx + 12, zy + 8, zan, {
        fontSize: '16px', color: '#ffe8b0', fontStyle: 'bold', padding: { y: 2 } }));

      // \u6210\u957f\u7387\u63cf\u8ff0
      const growth = ZANPAKUTO_GROWTH[zan] || {};
      const topStats = Object.entries(growth)
        .filter(([k]) => k !== 'statusAcc')
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .slice(0, 3)
        .map(([k, v]) => `${k} ${v}`);
      panel.add(scene.add.text(zx + 12, zy + 32, topStats.join('  |  '), {
        fontSize: '10px', color: '#8899bb', padding: { y: 1 } }));

      // \u6280\u80fd\u4fe1\u606f
      const skills = SHIKAI_SKILLS[zan];
      if (skills && skills.length > 0) {
        const sInfo = skills.slice(0, 2).map(s => `\u2726 ${s.name} [\u5a01${s.power}]`).join('\n');
        panel.add(scene.add.text(zx + 12, zy + 52, sInfo, {
          fontSize: '10px', color: '#ddaabb', padding: { y: 1 } }));
        if (skills[0].desc) {
          panel.add(scene.add.text(zx + 12, zy + 92, skills[0].desc, {
            fontSize: '9px', color: '#778899', wordWrap: { width: cardW - 24 }, padding: { y: 1 } }));
        }
      }

      // \u72b6\u6001\u63a7\u5236\u6807\u8bb0
      if (growth.statusAcc) {
        panel.add(scene.add.text(zx + cardW - 60, zy + 8, '\u63a7\u5236', {
          fontSize: '9px', color: '#cc88ff', fontStyle: 'bold',
          backgroundColor: '#22114488', padding: { x: 4, y: 1 } }));
      }

      // \u9009\u62e9\u6309\u94ae
      const sel = scene.add.text(zx + cardW / 2, zy + cardH - 22, '[ \u9009\u62e9\u6b64\u5200 ]', {
        fontSize: '13px', color: '#ffcc44', fontStyle: 'bold',
        backgroundColor: '#33220088', padding: { x: 16, y: 5 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      sel.on('pointerover', () => { sel.setColor('#ffff88'); sel.setBackgroundColor('#443300aa'); });
      sel.on('pointerout', () => { sel.setColor('#ffcc44'); sel.setBackgroundColor('#33220088'); });
      sel.on('pointerdown', () => {
        GameState.zanpakuto = zan; if (isOnline()) { requestUnlock('shikai', zan); requestSetZanpakuto(zan); } else GameState.addUnlock('shikai');
        GameState.recalcStats();
        panel.destroy(true);
        scene.time.delayedCall(300, () => {
          scene.isInDialogue = true;
          scene.dialogueBox.show({
            speaker: '\u6d66\u539f\u559c\u52a9',
            text: `${zan}\u2026\u2026\u5b83\u4e0a\u9762\u6709\u5148\u9063\u961f\u7684\u5370\u8bb0\u3002\u4f60\u5df2\u7ecf\u89e6\u6478\u5230\u59cb\u89e3\u7684\u95e8\u69db\u4e86\u3002\u53bb\u6d66\u539f\u5546\u5e97\u8857\u5427\uff0c\u90a3\u91cc\u6709\u4f60\u9700\u8981\u7684\u88c5\u5907\u3002`
          }, () => {
            scene.isInDialogue = false;
            scene.scene.get('UIScene').events.emit('updateStats');
            SaveManager.save();
            scene.tryAutoStartNextQuest();
          });
        });
      });
      panel.add(sel);
    });

    // \u5173\u95ed\u6309\u94ae
    panel.add(scene.add.text(530, -316, '\u2715', {
      fontSize: '22px', color: '#cc6666', padding: { x: 8, y: 4 } }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', function (this: any) { this.setColor('#ff8888'); })
      .on('pointerout', function (this: any) { this.setColor('#cc6666'); })
      .on('pointerdown', () => { panel.destroy(true); scene.isInDialogue = false; }));

    // \u5e95\u90e8\u63d0\u793a
    panel.add(scene.add.text(0, 320, '\u70b9\u51fb\u9009\u62e9\u4f60\u7684\u59cb\u89e3\u65a9\u9b44\u5200\uff0c\u9009\u5b9a\u540e\u4e0d\u53ef\u66f4\u6539', {
      fontSize: '11px', color: '#556688', padding: { y: 2 } }).setOrigin(0.5));
  }

