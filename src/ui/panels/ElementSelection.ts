/**
 * 元素共鸣选择面板 — 始解 / 卍解 属性倾向选择
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



export function showElementSelection(scene: GameScene): void {
    scene.isInDialogue = true;
    const elements = ['\u706b', '\u98ce', '\u6c34', '\u571f'];
    const colors: Record<string, string> = { '\u706b': '#ff6644', '\u98ce': '#44cc88', '\u6c34': '#4488ff', '\u571f': '#cc9944' };
    const desc: Record<string, string> = { '\u706b': '\u5f3a\u653b\u578b\uff0cATK+10%', '\u98ce': '\u654f\u6377\u578b\uff0cSPD+10%', '\u6c34': '\u5747\u8861\u578b\uff0cHP+5% MP+5%', '\u571f': '\u9632\u5fa1\u578b\uff0cDEF+10%' };
    const panel = scene.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 30).setDepth(400).setScrollFactor(0);
    const bg = scene.add.graphics();
    bg.fillStyle(0x1a1a2e, 0.95); bg.fillRoundedRect(-250, -100, 500, 200, 10);
    bg.lineStyle(2, 0xc9a96e, 0.7); bg.strokeRoundedRect(-250, -100, 500, 200, 10);
    panel.add(bg);
    panel.add(scene.add.text(0, -70, '选择你的元素共鸣', { fontSize: '20px', color: '#ffe8b0', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));
    elements.forEach((el, i) => {
      const ex = -180 + i * 120;
      const card = scene.add.graphics();
      card.fillStyle(parseInt(colors[el].replace('#', ''), 16), 0.2); card.fillRoundedRect(ex - 45, -25, 90, 80, 6);
      card.lineStyle(2, parseInt(colors[el].replace('#', ''), 16), 0.6); card.strokeRoundedRect(ex - 45, -25, 90, 80, 6);
      panel.add(card);
      panel.add(scene.add.text(ex, -15, el, { fontSize: '22px', color: colors[el], fontStyle: 'bold', padding: { y: 2 } }).setOrigin(0.5));
      panel.add(scene.add.text(ex, 10, desc[el], { fontSize: '9px', color: '#aaaacc', wordWrap: { width: 80 }, padding: { y: 1 } }).setOrigin(0.5));
      card.setInteractive(new Phaser.Geom.Rectangle(ex - 45, -25, 90, 80), Phaser.Geom.Rectangle.Contains);
      card.on('pointerover', () => { card.clear(); card.fillStyle(parseInt(colors[el].replace('#', ''), 16), 0.4); card.fillRoundedRect(ex - 45, -25, 90, 80, 6); card.lineStyle(2, parseInt(colors[el].replace('#', ''), 16), 0.9); card.strokeRoundedRect(ex - 45, -25, 90, 80, 6); });
      card.on('pointerout', () => { card.clear(); card.fillStyle(parseInt(colors[el].replace('#', ''), 16), 0.2); card.fillRoundedRect(ex - 45, -25, 90, 80, 6); card.lineStyle(2, parseInt(colors[el].replace('#', ''), 16), 0.6); card.strokeRoundedRect(ex - 45, -25, 90, 80, 6); });
      card.on('pointerdown', () => {
        GameState.element = el;
        GameState.recalcStats();
        panel.destroy(true);
        scene.time.delayedCall(300, () => {
          scene.isInDialogue = true;
          scene.dialogueBox.show({
            speaker: '浦原喜助',
            text: `${el}元素……你的灵魂中寄宿着这种力量。现在去探索空座町吧，和镇上的人聊聊，可能会有需要你帮助的人。`
          }, () => {
            scene.isInDialogue = false;
            scene.scene.get('UIScene').events.emit('updateStats');
            SaveManager.save();
            scene.tryAutoStartNextQuest();
          });
        });
      });
    });
  }

