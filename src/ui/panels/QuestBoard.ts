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



export function renderQuestBoardPanel(scene: GameScene): void {
  // 刷新日期状态（跨天清空进行中与今日已领）
  GameState.ensureDailyRefresh();
  GameState.ensureWeeklyRefresh();
  // 刷新时销毁旧面板，避免叠加
  if (scene.questLogPanel) { scene.questLogPanel.destroy(true); scene.questLogPanel = null; }
  const cam = scene.cameras.main;
  const p = scene.add.container(Math.round(cam.scrollX), Math.round(cam.scrollY)).setDepth(300);
  scene.questLogPanel = p;
  const ov = scene.add.graphics(); ov.fillStyle(0, 0.8); ov.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  ov.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains); p.add(ov);
  const ox = 30, oy = 20, ow = GAME_WIDTH - 60, oh = GAME_HEIGHT - 40;
  const mb = scene.add.graphics(); mb.fillStyle(0x121222, 0.98); mb.fillRoundedRect(ox, oy, ow, oh, 12);
  mb.lineStyle(2, 0x4a5a8a, 0.6); mb.strokeRoundedRect(ox, oy, ow, oh, 12); p.add(mb);
  p.add(scene.add.text(GAME_WIDTH / 2, oy + 27, '◆  任 务 板  ◆', { fontSize: '22px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));
  const closeBtn = scene.add.text(ox + ow - 40, oy + 27, '✕', { fontSize: '22px', color: '#cc6666', padding: { x: 8, y: 4 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
  closeBtn.on('pointerover', function (this: any) { this.setColor('#ff8888'); });
  closeBtn.on('pointerout', function (this: any) { this.setColor('#cc6666'); });
  closeBtn.on('pointerdown', () => { p.destroy(true); scene.questLogPanel = null; scene.resumeFromMenu(); });
  p.add(closeBtn);

  let cy = oy + 70;
  cy = renderBoardSection(scene, p, ox, ow, cy, '每日任务', rollDailyPool(), GameState.dailyState.completed, DAILY_CAP);
  cy += 10;
  cy = renderBoardSection(scene, p, ox, ow, cy, '每周任务', rollWeeklyPool(), GameState.weeklyState.completed, WEEKLY_CAP);

  const fy = oy + oh - 28; const ft = scene.add.graphics();
  ft.fillStyle(0x1a1a36, 0.8); ft.fillRoundedRect(ox + 4, fy, ow - 8, 24, { tl: 0, tr: 0, bl: 10, br: 10 }); p.add(ft);
  p.add(scene.add.text(GAME_WIDTH / 2, fy + 12, `每日上限${DAILY_CAP} · 每周上限${WEEKLY_CAP} · 进度自动累计 · ESC关闭`, { fontSize: '11px', color: '#556688', padding: { y: 2 } }).setOrigin(0.5));
}

export function renderBoardSection(scene: GameScene, p: Phaser.GameObjects.Container, ox: number, ow: number, startY: number, title: string, poolIds: string[], completedToday: string[], cap: number): number {
  let cy = startY;
  p.add(scene.add.text(ox + 30, cy, title, { fontSize: '16px', color: '#88aacc', fontStyle: 'bold', padding: { y: 3 } }));
  cy += 26;
  for (const id of poolIds) {
    const q = getQuestDef(id);
    if (!q) continue;
    const active = GameState.isQuestActive(id);
    const done = completedToday.includes(id);
    const ready = active && GameState.isQuestReady(id);
    const prog = GameState.questProgress[id] || {};
    p.add(scene.add.text(ox + 30, cy, `◆ ${q.name}`, { fontSize: '14px', color: done ? '#667788' : '#ffe8b0', fontStyle: 'bold', padding: { y: 2 } }));
    const statusText = done ? '今日已完成' : ready ? '可领取' : active ? '进行中' : (completedToday.length >= cap ? '今日已达上限' : '可接取');
    p.add(scene.add.text(ox + ow - 250, cy, statusText, { fontSize: '12px', color: ready ? '#88ff88' : done ? '#667788' : '#aaaacc', padding: { y: 2 } }));
    const objText = q.objectives.map(o => `${o.desc} ${Math.min(prog[o.target] || 0, o.count)}/${o.count}`).join('  ');
    p.add(scene.add.text(ox + 50, cy + 18, objText, { fontSize: '11px', color: '#aaaacc', padding: { y: 1 } }));
    let rewardStr = '奖励: ';
    if (q.rewards.gold) rewardStr += `${q.rewards.gold}金 `;
    if (q.rewards.exp) rewardStr += `${q.rewards.exp}经 `;
    if (q.rewards.items) rewardStr += q.rewards.items.map(it => `${it.name}×${it.count}`).join(' ');
    p.add(scene.add.text(ox + 50, cy + 34, rewardStr, { fontSize: '11px', color: '#ffcc44', padding: { y: 1 } }));
    const btnX = ox + ow - 110;
    if (ready) {
      const b = scene.add.text(btnX, cy + 8, '[领取]', { fontSize: '13px', color: '#44cc44', fontStyle: 'bold', padding: { x: 8, y: 4 }, backgroundColor: '#11221188' }).setInteractive({ useHandCursor: true });
      b.on('pointerover', () => b.setColor('#88ff88')); b.on('pointerout', () => b.setColor('#44cc44'));
      b.on('pointerdown', () => { claimBoardQuest(scene, id); });
      p.add(b);
    } else if (!done && !active && completedToday.length < cap) {
      const b = scene.add.text(btnX, cy + 8, '[接受]', { fontSize: '13px', color: '#88ccff', fontStyle: 'bold', padding: { x: 8, y: 4 }, backgroundColor: '#11223388' }).setInteractive({ useHandCursor: true });
      b.on('pointerover', () => b.setColor('#aaddff')); b.on('pointerout', () => b.setColor('#88ccff'));
      b.on('pointerdown', () => { GameState.acceptQuestById(id); renderQuestBoardPanel(scene); });
      p.add(b);
    }
    cy += 58;
  }
  return cy;
}

export function claimBoardQuest(scene: GameScene, id: string): void {
  const q = getQuestDef(id);
  if (!q || !GameState.isQuestActive(id) || !GameState.isQuestReady(id)) return;
  GameState.completeActiveQuest(id);
  if (scene.gameRoom) {
    requestClaimQuest(id);
    scene.showWorldNotif(`任务完成：${q.name}（奖励稍后到账）`, true);
  } else {
    let msg = '';
    if (q.rewards.gold) { GameState.gold += q.rewards.gold; msg += `金币+${q.rewards.gold} `; }
    if (q.rewards.exp) { const lv = GameState.gainExp(q.rewards.exp); msg += `经验+${q.rewards.exp}`; if (lv) msg += ` 升级!`; }
    if (q.rewards.items) { for (const it of q.rewards.items) { Inventory.addItem({ id: it.id, name: it.name, type: 'consumable' as any, desc: '', quantity: it.count }); msg += ` ${it.name}×${it.count}`; } }
    scene.showWorldNotif(`领取成功：${msg}`, true);
    scene.scene.get('UIScene').events.emit('updateStats');
  }
  renderQuestBoardPanel(scene);
}

