/**
 * 命名输入面板 — 角色 / 武器 名称输入
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


import { showElementSelection } from './ElementSelection';

export function showNamingInput(scene: GameScene): void {
    scene.namingPanelActive = true;
    const panel = scene.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60).setDepth(400).setScrollFactor(0);
    const bg = scene.add.graphics();
    bg.fillStyle(0x121222, 0.98); bg.fillRoundedRect(-300, -100, 600, 200, 12);
    bg.lineStyle(2, 0x4a5a8a, 0.6); bg.strokeRoundedRect(-300, -100, 600, 200, 12);
    panel.add(bg);
    panel.add(scene.add.text(0, -70, '输入你的名字', { fontSize: '20px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));

    // 使用原生HTML input支持中文输入
    const inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.maxLength = 12;
    inputEl.style.cssText = 'position:absolute;width:360px;height:36px;font-size:18px;color:#ffffff;background:#0a0a1e;border:1px solid #446688;border-radius:4px;text-align:center;outline:none;z-index:9999;';
    const canvas = scene.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / GAME_WIDTH;
    const scaleY = rect.height / GAME_HEIGHT;
    inputEl.style.left = (rect.left + rect.width / 2 - 180 * scaleX) + 'px';
    inputEl.style.top = (rect.top + (GAME_HEIGHT / 2 - 80) * scaleY) + 'px';
    inputEl.style.width = (360 * scaleX) + 'px';
    inputEl.style.height = (36 * scaleY) + 'px';
    document.body.appendChild(inputEl);
    inputEl.focus();

    panel.add(scene.add.text(0, 12, '（输入名字后点击确认）', { fontSize: '11px', color: '#667788', padding: { y: 1 } }).setOrigin(0.5));

    const cleanup = () => {
      if (inputEl.parentNode) inputEl.parentNode.removeChild(inputEl);
      scene.namingPanelActive = false;
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
      scene.time.delayedCall(300, () => {
        scene.isInDialogue = true;
        scene.dialogueBox.show({
          speaker: '浦原喜助',
          text: `${name}……好名字。你的灵魂中寄宿着一种元素之力——火、风、水、土。选择你的元素共鸣吧。`
        }, () => { scene.isInDialogue = false; showElementSelection(scene); });
      });
    };

    const confirm = scene.add.text(0, 50, '[ 确认 ]', {
      fontSize: '16px', color: '#88cc88', fontStyle: 'bold', padding: { x: 24, y: 8 },
      backgroundColor: '#11221188',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    confirm.on('pointerover', () => { confirm.setColor('#aaffaa'); confirm.setBackgroundColor('#224422aa'); });
    confirm.on('pointerout', () => { confirm.setColor('#88cc88'); confirm.setBackgroundColor('#11221188'); });
    confirm.on('pointerdown', () => doConfirm());
    panel.add(confirm);
  }

