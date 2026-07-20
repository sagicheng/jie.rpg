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



export function openShop(scene: GameScene, _s: any[]): void {
    const shopWasOpen = !!scene.shopPanel;
    if (scene.shopPanel) { scene.shopPanel.destroy(true); scene.shopPanel = null; }
    scene.isInDialogue = false;
    if (!shopWasOpen) scene.pauseForMenu(); // 仅首次开商店暂停物理；重渲染(购买后)不再累加 menuPauseDepth，否则关店后物理卡死无法移动
    const shopItems = _s;
    const cam = scene.cameras.main; const panel = scene.add.container(Math.round(cam.scrollX) + GAME_WIDTH / 2, Math.round(cam.scrollY) + GAME_HEIGHT / 2 - 30).setDepth(310);
    const bg = scene.add.graphics(); bg.fillStyle(0x1a1a2e, 0.97); bg.fillRoundedRect(-400, -260, 800, 520, 12); bg.lineStyle(2, 0xc9a96e, 0.7); bg.strokeRoundedRect(-400, -260, 800, 520, 12); panel.add(bg);
    panel.add(scene.add.text(0, -230, '商店', { fontSize: '22px', color: '#c9a96e', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));
    panel.add(scene.add.text(0, -200, `金币: ${GameState.gold}`, { fontSize: '14px', color: '#ffcc44', padding: { y: 2 } }).setOrigin(0.5));
    shopItems.forEach((item, i) => {
      const row = Math.floor(i / 2), col = i % 2, sx = -370 + col * 380, sy = -160 + row * 64;
      const card = scene.add.graphics(); card.fillStyle(0x111122, 0.6); card.fillRoundedRect(sx, sy, 360, 56, 6); card.lineStyle(1, 0x334466, 0.5); card.strokeRoundedRect(sx, sy, 360, 56, 6); panel.add(card);
      panel.add(scene.add.text(sx + 12, sy + 6, item.name, { fontSize: '13px', color: '#ddddff', fontStyle: 'bold', padding: { y: 2 } }));
      const st = typeof item.stats === 'object' ? Object.entries(item.stats as Record<string, number>).map(([k, v]) => `${k}+${v}`).join(' ') : '';
      panel.add(scene.add.text(sx + 12, sy + 30, st || item.desc || '', { fontSize: '10px', color: '#8888aa', padding: { y: 1 } }));
      panel.add(scene.add.text(sx + 260, sy + 18, `${item.price} 金币`, { fontSize: '12px', color: '#ffcc44', padding: { y: 2 } }));
      const canBuy = GameState.gold >= item.price;
      const buyBtn = scene.add.text(sx + 300, sy + 8, '[购买]', { fontSize: '12px', color: canBuy ? '#44cc44' : '#666666', fontStyle: 'bold', padding: { x: 6, y: 4 } }).setInteractive({ useHandCursor: true });
      if (canBuy) { buyBtn.on('pointerover', () => buyBtn.setColor('#88ff88')); buyBtn.on('pointerout', () => buyBtn.setColor('#44cc44')); buyBtn.on('pointerdown', () => {
        scene.isInDialogue = false;
        if (scene.gameRoom) {
          // 联机：购买走服务端权威（购买后直接装备），金币由 worldSync 更新
          if (!requestBuy(item.id)) return;
          openShop(scene, shopItems); // 重渲染（金币显示随 worldSync 刷新）
        } else {
          if (GameState.gold < item.price) return;
          GameState.gold -= item.price;
          const boughtItem = { id: item.id, name: item.name, type: 'equipment' as any, desc: item.desc || '', quantity: 1, slot: item.slot, stats: item.stats, quality: item.quality || 'white' };
          Inventory.equip(boughtItem);
          GameState.recalcStats();
          scene.scene.get('UIScene').events.emit('updateStats');
          openShop(scene, shopItems);
        }
        const bn = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 80, '购买了 ' + item.name, { fontSize: '16px', color: '#ffcc44', fontStyle: 'bold', backgroundColor: '#332200cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400);
        scene.tweens.add({ targets: bn, alpha: 0, y: GAME_HEIGHT / 2 - 110, duration: 2500, onComplete: () => bn.destroy() });
      }); }
      panel.add(buyBtn);
    });
    const cb3 = scene.add.text(370, -240, '✕', { fontSize: '22px', color: '#ff6666', padding: { x: 8, y: 4 } }).setOrigin(0.5).setInteractive({ useHandCursor: true }); cb3.on('pointerover', () => cb3.setColor('#ffaaaa')); cb3.on('pointerout', () => cb3.setColor('#ff6666')); cb3.on('pointerdown', () => { panel.destroy(true); scene.shopPanel = null; scene.resumeFromMenu(); }); panel.add(cb3);
    scene.shopPanel = panel;
  }

export function openMall(scene: GameScene): void {
  const wasOpen = !!scene.mallPanel;
  if (scene.mallPanel) { scene.mallPanel.destroy(true); scene.mallPanel = null; }
  if (!wasOpen) scene.pauseForMenu();
  const cam = scene.cameras.main;
  const panel = scene.add.container(Math.round(cam.scrollX) + GAME_WIDTH / 2, Math.round(cam.scrollY) + GAME_HEIGHT / 2 - 30).setDepth(310);
  const bg = scene.add.graphics(); bg.fillStyle(0x1a1a2e, 0.97); bg.fillRoundedRect(-400, -260, 800, 520, 12); bg.lineStyle(2, 0xc9a96e, 0.7); bg.strokeRoundedRect(-400, -260, 800, 520, 12); panel.add(bg);
  panel.add(scene.add.text(0, -230, '商城', { fontSize: '22px', color: '#c9a96e', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));
  panel.add(scene.add.text(0, -200, `金币: ${GameState.gold}`, { fontSize: '14px', color: '#ffcc44', padding: { y: 2 } }).setOrigin(0.5));
  const items = [{ id: 'respec_charm', name: '洗点符', desc: '使用后退还全部已分配属性点，可重新分配', price: (GameState.level || 1) * 200 }];
  items.forEach((item) => {
    const sx = -370, sy = -160;
    const card = scene.add.graphics(); card.fillStyle(0x111122, 0.6); card.fillRoundedRect(sx, sy, 360, 56, 6); card.lineStyle(1, 0x334466, 0.5); card.strokeRoundedRect(sx, sy, 360, 56, 6); panel.add(card);
    panel.add(scene.add.text(sx + 12, sy + 6, item.name, { fontSize: '13px', color: '#ddddff', fontStyle: 'bold', padding: { y: 2 } }));
    panel.add(scene.add.text(sx + 12, sy + 30, item.desc, { fontSize: '10px', color: '#8888aa', padding: { y: 1 } }));
    panel.add(scene.add.text(sx + 260, sy + 18, `${item.price} 金币`, { fontSize: '12px', color: '#ffcc44', padding: { y: 2 } }));
    const canBuy = GameState.gold >= item.price;
    const buyBtn = scene.add.text(sx + 300, sy + 8, '[购买]', { fontSize: '12px', color: canBuy ? '#44cc44' : '#666666', fontStyle: 'bold', padding: { x: 6, y: 4 } }).setInteractive({ useHandCursor: true });
    if (canBuy) {
      buyBtn.on('pointerover', () => buyBtn.setColor('#88ff88'));
      buyBtn.on('pointerout', () => buyBtn.setColor('#44cc44'));
      buyBtn.on('pointerdown', () => {
        scene.isInDialogue = false;
        if (isOnline()) {
          if (!requestMallBuy(item.id)) return;
          openMall(scene); // 重渲染（金币随 worldSync 刷新）
        } else {
          scene.showWorldNotif('需联网后到商城购买', false);
          return;
        }
        const bn = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 80, '购买了 ' + item.name, { fontSize: '16px', color: '#ffcc44', fontStyle: 'bold', backgroundColor: '#332200cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400);
        scene.tweens.add({ targets: bn, alpha: 0, y: GAME_HEIGHT / 2 - 110, duration: 2500, onComplete: () => bn.destroy() });
      });
    }
    panel.add(buyBtn);
  });
  const cb = scene.add.text(370, -240, '✕', { fontSize: '22px', color: '#ff6666', padding: { x: 8, y: 4 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
  cb.on('pointerover', () => cb.setColor('#ffaaaa')); cb.on('pointerout', () => cb.setColor('#ff6666'));
  cb.on('pointerdown', () => { panel.destroy(true); scene.mallPanel = null; scene.resumeFromMenu(); });
  panel.add(cb);
  scene.mallPanel = panel;
}

