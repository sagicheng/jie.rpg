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



export const PET_PW = 1200, PET_PH = 860;

export function closePetPanel(scene: GameScene): void {
  if (scene.petPanel) { scene.petPanel.destroy(true); scene.petPanel = null; }
  scene.resumeFromMenu();
}

export function refreshPetPanel(scene: GameScene): void {
  if (scene.petPanel) { closePetPanel(scene); openPetPanel(scene); }
}

export function openPetPanel(scene: GameScene): void {
  closePetPanel(scene);
  scene.pauseForMenu();
  scene.petPanel = renderPetPanel(scene);
}

export function renderPetPanel(scene: GameScene): Phaser.GameObjects.Container {
  const cam = scene.cameras.main;
  const c = scene.add.container(Math.round(cam.scrollX), Math.round(cam.scrollY)).setDepth(500);
  scene.petPanel = c;

  const PW = PET_PW, PH = PET_PH;
  const ox = 40, oy = 30, ow = PW - 80, oh = PH - 60;

  const ov = scene.add.graphics(); ov.fillStyle(0x000000, 0.78); ov.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT); ov.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains); c.add(ov);
  const mb = scene.add.graphics(); mb.fillStyle(0x121224, 0.98); mb.fillRoundedRect(ox, oy, ow, oh, 12); mb.lineStyle(2, 0x6a5acd, 0.6); mb.strokeRoundedRect(ox, oy, ow, oh, 12); c.add(mb);

  const th = 50;
  const tb = scene.add.graphics(); tb.fillStyle(0x1a1a36, 1); tb.fillRoundedRect(ox + 4, oy + 4, ow - 8, th, { tl: 10, tr: 10, bl: 0, br: 0 }); c.add(tb);
  c.add(scene.add.text(ox + 24, oy + th / 2, '🐾 灵 宠', { fontSize: '22px', color: '#c9b6ff', fontStyle: 'bold', padding: { x: 4, y: 4 } }).setOrigin(0, 0.5));
  c.add(scene.add.text(ox + ow - 40, oy + th / 2, '✕', { fontSize: '22px', color: '#cc6666', padding: { x: 8, y: 4 } }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    .on('pointerover', function (this: any) { this.setColor('#ff8888'); }).on('pointerout', function (this: any) { this.setColor('#cc6666'); })
    .on('pointerdown', () => closePetPanel(scene)));

  const pets: any[] = (GameState as any).pets || [];
  const listY = oy + th + 16;
  const cw = ow - 40;
  const cx0 = ox + 20;

  if (pets.length === 0) {
    c.add(scene.add.text(ox + ow / 2, oy + oh / 2 - 16, '暂无灵宠', { fontSize: '20px', color: '#aaaaaa', padding: { x: 4, y: 4 } }).setOrigin(0.5));
    c.add(scene.add.text(ox + ow / 2, oy + oh / 2 + 18, '击败妖兽有机会收服，或按 Ctrl+Y 让开发快捷键发放一只', { fontSize: '14px', color: '#888888', padding: { x: 4, y: 4 } }).setOrigin(0.5));
    return c;
  }

  // 小徽章绘制助手
  const drawBadge = (x: number, y: number, text: string, color: number): void => {
    const w = text.length * 13 + 18;
    const g = scene.add.graphics(); g.fillStyle(color, 0.9); g.fillRoundedRect(x, y, w, 22, 6); c.add(g);
    c.add(scene.add.text(x + w / 2, y + 11, text, { fontSize: '12px', color: '#0c0c18', fontStyle: 'bold' }).setOrigin(0.5));
  };

  pets.forEach((pet: any, i: number) => {
    const hasAttrs = (pet.attrPoints > 0) || pet.attrStr || pet.attrVit || pet.attrAgi || pet.attrInt;
    const cardH = hasAttrs ? 150 : 120;
    const cardY = listY + i * (cardH + 12);
    const isActive = !!pet.active;
    const card = scene.add.graphics();
    card.fillStyle(isActive ? 0x1c2540 : 0x171728, 0.98);
    card.fillRoundedRect(cx0, cardY, cw, cardH, 10);
    card.lineStyle(2, isActive ? 0x7c6cff : petColor(pet.speciesId), isActive ? 0.9 : 0.5);
    card.strokeRoundedRect(cx0, cardY, cw, cardH, 10);
    c.add(card);

    const ix = cx0 + 18, iy = cardY + cardH / 2;
    const tile = scene.add.graphics(); tile.fillStyle(petColor(pet.speciesId), 0.22); tile.fillRoundedRect(ix, iy - 32, 64, 64, 10); tile.lineStyle(2, petColor(pet.speciesId), 0.8); tile.strokeRoundedRect(ix, iy - 32, 64, 64, 10); c.add(tile);
    c.add(scene.add.text(ix + 32, iy, petIcon(pet.speciesId), { fontSize: '34px' }).setOrigin(0.5));

    const tx = ix + 86;
    // 头部：名称 + 等级
    c.add(scene.add.text(tx, cardY + 18, `${pet.name}`, { fontSize: '18px', color: '#ffffff', fontStyle: 'bold', padding: { x: 4, y: 2 } }).setOrigin(0, 0.5));
    c.add(scene.add.text(tx + 4, cardY + 42, `Lv.${pet.level}`, { fontSize: '14px', color: '#ffd27a', padding: { x: 4, y: 2 } }).setOrigin(0, 0.5));
    // 元素 / 品质 徽章
    const el = petElementInfo(pet.element);
    drawBadge(tx + 70, cardY + 32, `${el.icon}${el.label}`, el.color);
    const q = petQualityInfo(pet.quality);
    drawBadge(tx + 168, cardY + 32, q.label, q.color);
    if (isActive) drawBadge(tx + 250, cardY + 32, '出战', 0x2a6e4a);

    // 经验条
    const need = 80 * pet.level;
    const ratio = Math.min(1, (pet.exp || 0) / need);
    const barX = tx, barY = cardY + 60, barW = 240, barH = 8;
    const bg = scene.add.graphics(); bg.fillStyle(0x000000, 0.5); bg.fillRoundedRect(barX, barY, barW, barH, 4); c.add(bg);
    const fg = scene.add.graphics(); fg.fillStyle(0x66ccff, 1); fg.fillRoundedRect(barX, barY, Math.max(2, barW * ratio), barH, 4); c.add(fg);
    c.add(scene.add.text(barX + barW + 8, barY + barH / 2, `EXP ${pet.exp || 0}/${need}`, { fontSize: '11px', color: '#9fb8d8', padding: { x: 2, y: 1 } }).setOrigin(0, 0.5));

    // 属性行
    c.add(scene.add.text(tx, cardY + 84, `HP ${pet.maxHp}  ATK ${pet.atk}  DEF ${pet.def}  MATK ${pet.matk}  MDEF ${pet.mdef}  SPD ${pet.spd}`, { fontSize: '13px', color: '#cfd6e6', padding: { x: 2, y: 1 } }).setOrigin(0, 0.5));
    // 技能行
    c.add(scene.add.text(tx, cardY + 106, `技能：${petSkillNames(pet)}`, { fontSize: '12px', color: '#b89cff', padding: { x: 2, y: 1 } }).setOrigin(0, 0.5));

    // 属性点分配行
    if (hasAttrs) {
      const ay = cardY + cardH - 22;
      c.add(scene.add.text(tx, ay, '属性', { fontSize: '13px', color: '#9fb8d8', padding: { x: 2, y: 1 } }).setOrigin(0, 0.5));
      const attrsDef: Array<[string, string, number]> = [
        ['str', '力', pet.attrStr], ['vit', '体', pet.attrVit], ['agi', '敏', pet.attrAgi], ['int', '灵', pet.attrInt],
      ];
      let ax = tx + 52;
      attrsDef.forEach(([ak, al, av]) => {
        c.add(scene.add.text(ax, ay, `${al}${av}`, { fontSize: '13px', color: '#cfd6e6' }).setOrigin(0, 0.5));
        if (pet.attrPoints > 0) {
          const minus = scene.add.text(ax + 34, ay, '-', { fontSize: '18px', color: '#ff9999' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
          minus.on('pointerdown', () => { requestPetSetAttr(pet.id, ak, -1); refreshPetPanel(scene); });
          const plus = scene.add.text(ax + 60, ay, '+', { fontSize: '18px', color: '#99ff99' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
          plus.on('pointerdown', () => { requestPetSetAttr(pet.id, ak, 1); refreshPetPanel(scene); });
          c.add(minus); c.add(plus);
        }
        ax += pet.attrPoints > 0 ? 110 : 56;
      });
      if (pet.attrPoints > 0) c.add(scene.add.text(ax + 8, ay, `剩余 ${pet.attrPoints}`, { fontSize: '13px', color: '#ffd27a', padding: { x: 2, y: 1 } }).setOrigin(0, 0.5));
    }

    // 右侧按钮
    const btnX = cx0 + cw - 170;
    const btnY = cardY + cardH / 2;
    const toggle = scene.add.text(btnX, btnY - 16, isActive ? '收回' : '出战', {
      fontSize: '15px', color: isActive ? '#ffd27a' : '#cfeedd', fontStyle: 'bold', padding: { x: 14, y: 6 }, backgroundColor: isActive ? '#553a00aa' : '#113311aa',
    }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    toggle.on('pointerdown', () => { if (isActive) requestPetRecall(pet.id); else requestPetSetActive(pet.id); refreshPetPanel(scene); });
    c.add(toggle);

    const rel = scene.add.text(btnX, btnY + 24, '放生', {
      fontSize: '15px', color: '#ff9999', fontStyle: 'bold', padding: { x: 14, y: 6 }, backgroundColor: '#441111aa',
    }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    rel.on('pointerdown', () => { requestPetRelease(pet.id); refreshPetPanel(scene); });
    c.add(rel);
  });

  const active = pets.find((p: any) => p.active);
  if (active) {
    const aura = computePetAura(active);
    if (aura) {
      const ay = oy + oh - 26;
      c.add(scene.add.text(ox + ow / 2, ay, `出战光环 →  HP+${aura.hp}  ATK+${aura.atk}  DEF+${aura.def}  MATK+${aura.matk}  MDEF+${aura.mdef}  SPD+${aura.spd}`, { fontSize: '14px', color: '#9fe6c0', fontStyle: 'bold', padding: { x: 4, y: 2 } }).setOrigin(0.5));
    }
  }

  return c;
}
