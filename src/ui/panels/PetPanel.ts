/**
 * 灵宠面板 — 灵宠查看 / 出战 / 养成 的打开与渲染
 *
 * 改造（兄弟 2026-08-01 反馈）：
 *  1. 列表加滚动条（>4 张时启用 mask + 滚轮 + 滚动条 thumb）
 *  2. 卡框线按品质统一（普通=灰/优秀=绿/精良=蓝/稀有=紫/传说=金；出战=紫）
 *  3. 属性点行每只都显示（即便全 0 也有「剩余 0」提示，按钮按 attrPoints>0 才出）
 *  4. 元素加成：computePetAura 按 pet.element 给不同方向的属性光环
 *  5. 战斗形态一次性：MultiBattleScene 加 *UsedThisBattle 守卫
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



export const PET_PW = 1200, PET_PH = 860;

/** 滚动位置跨重建保留（worldSync 触发 refreshOpenPanels 全毁重建时不再回弹到顶）。 */
let lastPetScrollY = 0;

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

/**
 * 灵宠面板布局常量（兄弟 2026-08-01 反馈：列表长需滚动，卡高统一 150 以容下属性行）。
 * - CARD_H = 150：含「头部+经验+属性+技能+属性分配」五行（约 30px × 5）
 * - CARD_GAP = 12：卡间距
 * - listTopY/listBotY：滚动视口（标题栏下 → aura 文本上）
 */
const CARD_H = 150;
const CARD_GAP = 12;

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
  const cx0 = ox + 20;
  const cw = ow - 40;

  // 列表视口（兄弟 2026-08-01 反馈：列表长需滚动 → 限定 mask 区）
  const listTopY = oy + th + 16;        // 96
  const auraY = oy + oh - 26;           // 770
  const listBotY = auraY - 12;          // 758
  const listH = listBotY - listTopY;    // 662
  // 滚动条放列表右侧，缩进 4
  const sbW = 8;
  const sbX = cx0 + cw - sbW - 4;
  const sbY = listTopY + 4;
  const sbH = listH - 8;

  if (pets.length === 0) {
    c.add(scene.add.text(ox + ow / 2, oy + oh / 2 - 16, '暂无灵宠', { fontSize: '20px', color: '#aaaaaa', padding: { x: 4, y: 4 } }).setOrigin(0.5));
    c.add(scene.add.text(ox + ow / 2, oy + oh / 2 + 18, '击败妖兽有机会收服', { fontSize: '14px', color: '#888888', padding: { x: 4, y: 4 } }).setOrigin(0.5));
    return c;
  }

  // 滚动状态
  const totalH = pets.length * CARD_H + Math.max(0, pets.length - 1) * CARD_GAP;
  const scrollable = totalH > listH;
  const maxScroll = Math.max(0, totalH - listH);
  let scrollY = lastPetScrollY;

  // 列表容器：所有卡片挂在它下面，整体 setY 偏移做滚动
  const listContainer = scene.add.container(0, 0);
  c.add(listContainer);

  // clip mask
  let maskG: Phaser.GameObjects.Graphics | null = null;
  if (scrollable) {
    maskG = scene.make.graphics({});
    maskG.fillStyle(0xffffff);
    maskG.fillRect(cx0, listTopY, cw, listH);
    listContainer.setMask(maskG.createGeometryMask());
  }

  // 徽章助手（target 改为接收容器，便于统一挂到 listContainer 走 mask）
  const drawBadge = (target: Phaser.GameObjects.Container, x: number, y: number, text: string, color: number): void => {
    const w = text.length * 13 + 18;
    const g = scene.add.graphics(); g.fillStyle(color, 0.9); g.fillRoundedRect(x, y, w, 22, 6); target.add(g);
    target.add(scene.add.text(x + w / 2, y + 11, text, { fontSize: '12px', color: '#0c0c18', fontStyle: 'bold' }).setOrigin(0.5));
  };

  // 渲染每张卡
  pets.forEach((pet: any, i: number) => {
    const cardY = i * (CARD_H + CARD_GAP);  // 相对 listContainer 起点（绝对 y 由 listContainer.y 决定）
    const isActive = !!pet.active;
    const cardC = scene.add.container(0, cardY);

    // ── 改造 2：卡框线按品质统一（普通=灰/优秀=绿/精良=蓝/稀有=紫/传说=金；出战=紫） ──
    const qInfo = petQualityInfo(pet.quality);
    const borderColor = isActive ? 0x7c6cff : qInfo.color;
    const borderAlpha = isActive ? 0.9 : 0.7;

    const card = scene.add.graphics();
    card.fillStyle(isActive ? 0x1c2540 : 0x171728, 0.98);
    card.fillRoundedRect(cx0, 0, cw, CARD_H, 10);
    card.lineStyle(2, borderColor, borderAlpha);
    card.strokeRoundedRect(cx0, 0, cw, CARD_H, 10);
    cardC.add(card);

    // 物种图标瓦片（仍按物种色，区分物种；与品质框线互不冲突）
    const ix = cx0 + 18, iy = CARD_H / 2;
    const tile = scene.add.graphics(); tile.fillStyle(petColor(pet.speciesId), 0.22); tile.fillRoundedRect(ix, iy - 32, 64, 64, 10); tile.lineStyle(2, petColor(pet.speciesId), 0.8); tile.strokeRoundedRect(ix, iy - 32, 64, 64, 10); cardC.add(tile);
    cardC.add(scene.add.text(ix + 32, iy, petIcon(pet.speciesId), { fontSize: '34px' }).setOrigin(0.5));

    // 头部：名称 + 等级
    const tx = ix + 86;
    cardC.add(scene.add.text(tx, 18, `${pet.name}`, { fontSize: '18px', color: '#ffffff', fontStyle: 'bold', padding: { x: 4, y: 2 } }).setOrigin(0, 0.5));
    cardC.add(scene.add.text(tx + 4, 42, `Lv.${pet.level}`, { fontSize: '14px', color: '#ffd27a', padding: { x: 4, y: 2 } }).setOrigin(0, 0.5));
    const el = petElementInfo(pet.element);
    drawBadge(cardC, tx + 70, 32, `${el.icon}${el.label}`, el.color);
    drawBadge(cardC, tx + 168, 32, qInfo.label, qInfo.color);
    if (isActive) drawBadge(cardC, tx + 250, 32, '出战', 0x2a6e4a);

    // 经验条
    const need = 80 * pet.level;
    const ratio = Math.min(1, (pet.exp || 0) / need);
    const barX = tx, barY = 60, barW = 240, barH = 8;
    const bg = scene.add.graphics(); bg.fillStyle(0x000000, 0.5); bg.fillRoundedRect(barX, barY, barW, barH, 4); cardC.add(bg);
    const fg = scene.add.graphics(); fg.fillStyle(0x66ccff, 1); fg.fillRoundedRect(barX, barY, Math.max(2, barW * ratio), barH, 4); cardC.add(fg);
    cardC.add(scene.add.text(barX + barW + 8, barY + barH / 2, `EXP ${pet.exp || 0}/${need}`, { fontSize: '11px', color: '#9fb8d8', padding: { x: 2, y: 1 } }).setOrigin(0, 0.5));

    // 战斗属性行
    cardC.add(scene.add.text(tx, 84, `HP ${pet.maxHp}  ATK ${pet.atk}  DEF ${pet.def}  MATK ${pet.matk}  MDEF ${pet.mdef}  SPD ${pet.spd}`, { fontSize: '13px', color: '#cfd6e6', padding: { x: 2, y: 1 } }).setOrigin(0, 0.5));
    // 技能行
    cardC.add(scene.add.text(tx, 106, `技能：${petSkillNames(pet)}`, { fontSize: '12px', color: '#b89cff', padding: { x: 2, y: 1 } }).setOrigin(0, 0.5));

    // ── 改造 3：属性点分配行统一显示（即便全 0 也保留「剩余 0」提示，按钮按 attrPoints>0 才出） ──
    const ay = CARD_H - 22;
    cardC.add(scene.add.text(tx, ay, '属性', { fontSize: '13px', color: '#9fb8d8', padding: { x: 2, y: 1 } }).setOrigin(0, 0.5));
    const attrsDef: Array<[string, string, number]> = [
      ['str', '力', pet.attrStr || 0], ['vit', '体', pet.attrVit || 0], ['agi', '敏', pet.attrAgi || 0], ['int', '灵', pet.attrInt || 0],
    ];
    let ax = tx + 52;
    attrsDef.forEach(([ak, al, av]) => {
      cardC.add(scene.add.text(ax, ay, `${al}${av}`, { fontSize: '13px', color: '#cfd6e6' }).setOrigin(0, 0.5));
      if (pet.attrPoints > 0) {
        const minus = scene.add.text(ax + 34, ay, '-', { fontSize: '18px', color: '#ff9999' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        minus.on('pointerdown', () => { requestPetSetAttr(pet.id, ak, -1); refreshPetPanel(scene); });
        const plus = scene.add.text(ax + 60, ay, '+', { fontSize: '18px', color: '#99ff99' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        plus.on('pointerdown', () => { requestPetSetAttr(pet.id, ak, 1); refreshPetPanel(scene); });
        cardC.add(minus); cardC.add(plus);
      }
      ax += pet.attrPoints > 0 ? 110 : 56;
    });
    const remainTxt = `剩余 ${pet.attrPoints || 0}`;
    const remainColor = pet.attrPoints > 0 ? '#ffd27a' : '#666666';
    cardC.add(scene.add.text(ax + 8, ay, remainTxt, { fontSize: '13px', color: remainColor, padding: { x: 2, y: 1 } }).setOrigin(0, 0.5));

    // 右侧按钮（出战/收回、放生）
    const btnX = cx0 + cw - 170;
    const btnY = CARD_H / 2;
    const toggle = scene.add.text(btnX, btnY - 16, isActive ? '收回' : '出战', {
      fontSize: '15px', color: isActive ? '#ffd27a' : '#cfeedd', fontStyle: 'bold', padding: { x: 14, y: 6 }, backgroundColor: isActive ? '#553a00aa' : '#113311aa',
    }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    toggle.on('pointerdown', () => { if (isActive) requestPetRecall(pet.id); else requestPetSetActive(pet.id); refreshPetPanel(scene); });
    cardC.add(toggle);

    const rel = scene.add.text(btnX, btnY + 24, '放生', {
      fontSize: '15px', color: '#ff9999', fontStyle: 'bold', padding: { x: 14, y: 6 }, backgroundColor: '#441111aa',
    }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    rel.on('pointerdown', () => { requestPetRelease(pet.id); refreshPetPanel(scene); });
    cardC.add(rel);

    listContainer.add(cardC);
  });

  // 滚动条
  const scrollBar = scene.add.graphics();
  c.add(scrollBar);
  const updateScroll = (): void => {
    // 非滚动时强制 scrollY=0，避免 Clamp 越界把 listContainer 推走
    if (scrollable) scrollY = Phaser.Math.Clamp(scrollY, listH - totalH, 0);
    else scrollY = 0;
    lastPetScrollY = scrollY; // 跨重建保留（worldSync 频繁重建不回弹）
    listContainer.y = listTopY + scrollY;
    scrollBar.clear();
    if (scrollable) {
      const thumbH = Math.max(24, listH * listH / totalH);
      const progress = (listH - totalH) !== 0 ? scrollY / (listH - totalH) : 0;
      const ty = sbY + progress * (sbH - thumbH);
      // 轨道
      scrollBar.fillStyle(0x000000, 0.35);
      scrollBar.fillRoundedRect(sbX, sbY, sbW, sbH, 4);
      // 手柄
      scrollBar.fillStyle(0x99aacc, 0.85);
      scrollBar.fillRoundedRect(sbX, ty, sbW, thumbH, 4);
    }
  };
  updateScroll();

  // 滚轮监听（仅滚动时挂；销毁面板时统一解绑）
  if (scrollable) {
    const onWheel = (pointer: any, _o: any, _dx: number, dy: number): void => {
      const wx = pointer.worldX, wy = pointer.worldY;
      // 列表区世界坐标：c 起点 + 局部 listTopY
      if (wx < c.x + cx0 || wx > c.x + cx0 + cw || wy < c.y + listTopY || wy > c.y + listBotY) return;
      scrollY -= dy * 0.5;
      updateScroll();
    };
    scene.input.on('wheel', onWheel);

    // 滚动条拖拽（thumb 可点击跳转）
    const dragStartY = { val: 0, scroll: 0, active: false };
    scrollBar.setInteractive(new Phaser.Geom.Rectangle(sbX - 4, sbY, sbW + 8, sbH), Phaser.Geom.Rectangle.Contains);
    scrollBar.on('pointerdown', (p: any) => {
      dragStartY.val = p.worldY;
      dragStartY.scroll = scrollY;
      dragStartY.active = true;
    });
    const onMove = (p: any): void => {
      if (!dragStartY.active) return;
      const thumbH = Math.max(24, listH * listH / totalH);
      const trackRange = sbH - thumbH;
      if (trackRange <= 0) return;
      const deltaY = p.worldY - dragStartY.val;
      const scrollDelta = (listH - totalH) * (deltaY / trackRange);
      scrollY = dragStartY.scroll + scrollDelta;
      updateScroll();
    };
    const onUp = (): void => { dragStartY.active = false; };
    scene.input.on('pointermove', onMove);
    scene.input.on('pointerup', onUp);

    listContainer.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.input.off('wheel', onWheel);
      scene.input.off('pointermove', onMove);
      scene.input.off('pointerup', onUp);
      if (maskG) maskG.destroy();
    });
  }

  // 出战光环（按元素给不同方向加成 — 改造 4 在 PetSystem.computePetAura 实现）
  const active = pets.find((p: any) => p.active);
  if (active) {
    const aura = computePetAura(active);
    if (aura) {
      c.add(scene.add.text(ox + ow / 2, auraY, `出战光环 →  HP+${aura.hp}  ATK+${aura.atk}  DEF+${aura.def}  MATK+${aura.matk}  MDEF+${aura.mdef}  SPD+${aura.spd}`, { fontSize: '14px', color: '#9fe6c0', fontStyle: 'bold', padding: { x: 4, y: 2 } }).setOrigin(0.5));
    }
  }

  return c;
}
