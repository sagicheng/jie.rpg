/**
 * 背包面板 — 物品展示 / 装备 / 使用 的打开与渲染
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


import { addEnhanceGlow } from './EnhancePanel';

export function toggleInventory(scene: GameScene): void { if (scene.inventoryPanel) { closeInventory(scene); return; } renderInventoryPanel(scene); }

export function closeInventory(scene: GameScene): void { if (scene.inventoryPanel) { scene.inventoryPanel.destroy(true); scene.inventoryPanel = null; scene.resumeFromMenu(); } }

export function renderInventoryPanel(scene: GameScene): void {
    scene.pauseForMenu(); const cam = scene.cameras.main;
    const p = scene.add.container(Math.round(cam.scrollX), Math.round(cam.scrollY)).setDepth(300); scene.inventoryPanel = p;
    const ov = scene.add.graphics(); ov.fillStyle(0, 0.78); ov.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT); ov.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains); p.add(ov);
    const ox = 30, oy = 20, ow = GAME_WIDTH - 60, oh = GAME_HEIGHT - 40;
    const mb = scene.add.graphics(); mb.fillStyle(0x121222, 0.98); mb.fillRoundedRect(ox, oy, ow, oh, 12); mb.lineStyle(2, 0x4a5a8a, 0.6); mb.strokeRoundedRect(ox, oy, ow, oh, 12); p.add(mb);
    const th = 54; const tb = scene.add.graphics(); tb.fillStyle(0x1a1a36, 1); tb.fillRoundedRect(ox + 4, oy + 4, ow - 8, th, { tl: 10, tr: 10, bl: 0, br: 0 }); p.add(tb);
    p.add(scene.add.text(GAME_WIDTH / 2, oy + th / 2, '◆  背 包  ◆', { fontSize: '22px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));
    p.add(scene.add.text(ox + ow - 40, oy + th / 2, '✕', { fontSize: '22px', color: '#cc6666', padding: { x: 8, y: 4 } }).setOrigin(0.5).setInteractive({ useHandCursor: true }).on('pointerover', function (this: any) { this.setColor('#ff8888'); }).on('pointerout', function (this: any) { this.setColor('#cc6666'); }).on('pointerdown', () => closeInventory(scene)));
    p.add(scene.add.text(ox + 20, oy + th + 16, `金币: ${GameState.gold}`, { fontSize: '16px', color: '#ffcc44', fontStyle: 'bold', padding: { y: 2 } }));

    // Equipment grid (2 rows x 5 cols)
    const eqY = oy + th + 48; const eW = 180, eH = 64, eGap = 10;
    const eq = Inventory.equipment; const sn: Record<string, string> = { weapon: '武器', head: '头部', body: '身体', bracer: '手甲', boots: '战靴', belt: '腰带', ring: '戒指', necklace: '项链', charm: '护符', pendant: '挂饰' };
    const eqs: EquipSlot[] = ['head', 'body', 'bracer', 'boots', 'belt', 'ring', 'necklace', 'charm', 'pendant'];
    const qc: Record<string, string> = { white: '#aaaaaa', green: '#44cc44', blue: '#4488ff', purple: '#cc44cc', gold: '#ffaa00' };
    eqs.forEach((s, i) => {
      const c2 = i % 5, r2 = Math.floor(i / 5); const sx = ox + 20 + c2 * (eW + eGap), sy = eqY + r2 * (eH + eGap);
      const er = scene.add.graphics(); er.fillStyle(0x0d0d1d, 0.7); er.fillRoundedRect(sx, sy, eW, eH, 6); er.lineStyle(1, 0x334466, 0.4); er.strokeRoundedRect(sx, sy, eW, eH, 6); p.add(er);
      if (eq[s]) addEnhanceGlow(scene, p, er, sx, sy, eW, eH, eq[s]!, 6);
      p.add(scene.add.text(sx + 8, sy + 4, sn[s], { fontSize: '10px', color: '#556688', padding: { y: 1 } }));
      const it = eq[s];
      if (it) {
        const elv = it.enhanceLevel || 0; const q = it.quality || 'white'; const lvTxt = elv > 0 ? ` +${elv}` : '';
        const setTag = it.set ? ` ⚑${setShortName(it.set)}` : '';
        p.add(scene.add.text(sx + 8, sy + 20, `${it.name}${lvTxt}${setTag}`, { fontSize: '13px', color: qc[q] || '#cccccc', fontStyle: 'bold', padding: { y: 1 } }));
        const sts = Object.entries(it.stats as Record<string, number>).map(([k, v]) => `${k}+${v}`).join(' ');
        p.add(scene.add.text(sx + 8, sy + 40, sts, { fontSize: '9px', color: '#7788aa', padding: { y: 1 } }));
        const eqRef = getRefineDisplay(it);
        if (eqRef) p.add(scene.add.text(sx + 8, sy + 51, eqRef, { fontSize: '8px', color: '#F5A623', padding: { y: 1 } }));
        // 点击卸下装备
        const slotZone = scene.add.zone(sx, sy, eW, eH).setOrigin(0, 0).setInteractive({ useHandCursor: true });
        slotZone.on('pointerdown', () => {
          if (scene.gameRoom) {
            if (!requestUnequip(s)) return;
            closeInventory(scene); renderInventoryPanel(scene);
            scene.scene.get('UIScene').events.emit('updateStats');
          } else {
            Inventory.unequip(s);
            GameState.recalcStats();
            closeInventory(scene); renderInventoryPanel(scene);
            scene.scene.get('UIScene').events.emit('updateStats');
          }
        });
        p.add(slotZone);
      } else { p.add(scene.add.text(sx + 8, sy + 24, '空', { fontSize: '12px', color: '#334455', padding: { y: 1 } })); }
    });

    // 背包装备（可穿戴）
    const equipItems = Inventory.items.filter(it => it.type === 'equipment');
    if (equipItems.length > 0) {
      const eiY = eqY + 2 * (eH + eGap) + 16;
      p.add(scene.add.text(ox + 20, eiY, '装备（点击穿戴）', { fontSize: '14px', color: '#88aacc', fontStyle: 'bold', padding: { y: 2 } }));
      const ec = 6, ecardW = (ow - 50) / ec - 8;
      equipItems.forEach((item, i) => {
        const col = i % ec, row = Math.floor(i / ec); const ex = ox + 20 + col * (ecardW + 8), ey = eiY + 28 + row * 56;
        const q = item.quality || 'white';
        const cd2 = scene.add.graphics(); cd2.fillStyle(0x0a0a1a, 0.7); cd2.fillRoundedRect(ex, ey, ecardW, 48, 5); cd2.lineStyle(1, parseInt((qc[q] || '#666666').replace('#', ''), 16), 0.4); cd2.strokeRoundedRect(ex, ey, ecardW, 48, 5); p.add(cd2);
        addEnhanceGlow(scene, p, cd2, ex, ey, ecardW, 48, item, 5);
        const elv = item.enhanceLevel || 0; const lvTxt = elv > 0 ? ` +${elv}` : '';
        p.add(scene.add.text(ex + 6, ey + 4, `${item.name}${lvTxt}`, { fontSize: '11px', color: qc[q] || '#cccccc', fontStyle: 'bold', padding: { y: 1 } }));
        const sts = item.stats ? Object.entries(item.stats as Record<string, number>).map(([k, v]) => `${k}+${v}`).join(' ') : '';
        p.add(scene.add.text(ex + 6, ey + 24, sts, { fontSize: '9px', color: '#7788aa', padding: { y: 1 } }));
        const bagRef = getRefineDisplay(item);
        if (bagRef) p.add(scene.add.text(ex + 6, ey + 36, bagRef, { fontSize: '8px', color: '#F5A623', padding: { y: 1 } }));
        const ez = scene.add.zone(ex, ey, ecardW, 48).setOrigin(0, 0).setInteractive({ useHandCursor: true });
        ez.on('pointerover', () => { cd2.clear(); cd2.fillStyle(0x1a2a3a, 0.8); cd2.fillRoundedRect(ex, ey, ecardW, 48, 5); cd2.lineStyle(1, parseInt((qc[q] || '#666666').replace('#', ''), 16), 0.6); cd2.strokeRoundedRect(ex, ey, ecardW, 48, 5); });
        ez.on('pointerout', () => { cd2.clear(); cd2.fillStyle(0x0a0a1a, 0.7); cd2.fillRoundedRect(ex, ey, ecardW, 48, 5); cd2.lineStyle(1, parseInt((qc[q] || '#666666').replace('#', ''), 16), 0.4); cd2.strokeRoundedRect(ex, ey, ecardW, 48, 5); });
        ez.on('pointerdown', () => {
          if (scene.gameRoom) {
            // 联机：穿戴走服务端权威，worldSync 刷新背包/装备面板（断连被拒时 WorldClient 已提示）
            if (!requestEquip(item.id)) return;
            closeInventory(scene); renderInventoryPanel(scene);
          } else {
            Inventory.equip(item);
            GameState.recalcStats();
            closeInventory(scene); renderInventoryPanel(scene);
            scene.scene.get('UIScene').events.emit('updateStats');
          }
        });
        p.add(ez);
      });
    }

    // Consumables
    const consY = eqY + 2 * (eH + eGap) + 16 + (equipItems.length > 0 ? (Math.ceil(equipItems.length / 6) * 56 + 28) : 0);
    p.add(scene.add.text(ox + 20, consY, '消耗品', { fontSize: '15px', color: '#88aacc', fontStyle: 'bold', padding: { y: 2 } }));
    const cons = Inventory.items.filter(it => it.type === 'consumable' && it.quantity > 0);
    const cc = 8, cW = (ow - 50) / cc - 8;
    cons.forEach((item, i) => {
      const col = i % cc, row = Math.floor(i / cc); const cx = ox + 20 + col * (cW + 8), cy = consY + 30 + row * 68;
      const cd = scene.add.graphics(); cd.fillStyle(0x0a1a0a, 0.7); cd.fillRoundedRect(cx, cy, cW, 58, 5); cd.lineStyle(1, 0x225522, 0.5); cd.strokeRoundedRect(cx, cy, cW, 58, 5); p.add(cd);
      p.add(scene.add.text(cx + 6, cy + 4, item.name, { fontSize: '11px', color: '#88cc88', fontStyle: 'bold', padding: { y: 1 } }));
      p.add(scene.add.text(cx + 6, cy + 22, item.desc || '', { fontSize: '9px', color: '#558855', padding: { y: 1 } }));
      p.add(scene.add.text(cx + cW - 25, cy + 4, `×${item.quantity}`, { fontSize: '11px', color: '#88cc88', fontStyle: 'bold', padding: { y: 1 } }));
      const ub = scene.add.text(cx + cW / 2, cy + 38, '[使用]', { fontSize: '10px', color: '#44cc44', fontStyle: 'bold', padding: { x: 4, y: 2 }, backgroundColor: '#11221188' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      ub.on('pointerover', () => { ub.setColor('#88ff88'); ub.setBackgroundColor('#224422aa'); }); ub.on('pointerout', () => { ub.setColor('#44cc44'); ub.setBackgroundColor('#11221188'); });
      ub.on('pointerdown', () => {
        if (item.id === 'respec_charm') {
          if (isOnline()) {
            requestRespec(); // 服务端权威退还属性点，worldSync 刷新背包/属性
          } else {
            const sum = GameState.allocatedHP + GameState.allocatedMP + GameState.allocatedATK + GameState.allocatedDEF + GameState.allocatedMATK + GameState.allocatedMDEF + GameState.allocatedSPD;
            GameState.allocatedHP = GameState.allocatedMP = GameState.allocatedATK = GameState.allocatedDEF = GameState.allocatedMATK = GameState.allocatedMDEF = GameState.allocatedSPD = 0;
            GameState.statPoints += sum;
            item.quantity--; if (item.quantity <= 0) { const ri = Inventory.items.findIndex(x => x.id === item.id); if (ri >= 0) Inventory.items.splice(ri, 1); }
            GameState.recalcStats();
            scene.scene.get('UIScene').events.emit('updateStats');
            closeInventory(scene); renderInventoryPanel(scene);
            scene.showWorldNotif(`洗点成功，已退还 ${sum} 点属性`, true);
          }
          return;
        }
        const ef = getConsumableEffect(item.id);
        if (ef) {
          const ctx2 = { hp: GameState.hp, maxHp: GameState.maxHp, mp: GameState.mp, maxMp: GameState.maxMp, playerStatus: createPlayerStatus(), isDead: false };
          const result = applyConsumable(ef, ctx2);
          GameState.hp = result.hp; GameState.mp = result.mp;
          item.quantity--;
          if (item.quantity <= 0) { const ri = Inventory.items.findIndex(ri2 => ri2.id === item.id); if (ri >= 0) Inventory.items.splice(ri, 1); }
          closeInventory(scene); renderInventoryPanel(scene);
          scene.scene.get('UIScene').events.emit('updateStats');
          // 显示使用结果
          const n = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 80, result.message, { fontSize: '16px', color: '#88ff88', fontStyle: 'bold', backgroundColor: '#112211cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400);
          scene.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 110, duration: 1500, onComplete: () => n.destroy() });
        }
      });
      p.add(ub);
    });

    // Materials
    const matY = consY + 30 + Math.ceil(cons.length / cc) * 68 + 14;
    p.add(scene.add.text(ox + 20, matY, '材料', { fontSize: '15px', color: '#88aacc', fontStyle: 'bold', padding: { y: 2 } }));
    const mats = Inventory.items.filter(it => it.type === 'material' && it.quantity > 0);
    mats.forEach((item, i) => { const col = i % 6, row = Math.floor(i / 6); const mx = ox + 20 + col * 280, my = matY + 30 + row * 24; p.add(scene.add.text(mx, my, `${item.name} ×${item.quantity}`, { fontSize: '11px', color: '#aaaacc', padding: { y: 2 } })); });
    const matEndY = matY + 30 + Math.ceil(mats.length / 6) * 24;

    // 灵宠蛋（双击开启 → 随机孵化一只灵宠；元素/技能/品质全部随机，品质按掉落区域）
    const eggY = matEndY + 14;
    p.add(scene.add.text(ox + 20, eggY, '灵宠蛋（双击开启）', { fontSize: '15px', color: '#ffaa66', fontStyle: 'bold', padding: { y: 2 } }));
    const eggs = Inventory.items.filter(it => it.type === 'pet_egg' && it.quantity > 0);
    const eggC = 8, eggW = (ow - 50) / eggC - 8;
    eggs.forEach((item, i) => {
      const col = i % eggC, row = Math.floor(i / eggC); const ex = ox + 20 + col * (eggW + 8), ey = eggY + 30 + row * 68;
      const cd = scene.add.graphics(); cd.fillStyle(0x1a1208, 0.8); cd.fillRoundedRect(ex, ey, eggW, 58, 5); cd.lineStyle(1, 0xaa6622, 0.6); cd.strokeRoundedRect(ex, ey, eggW, 58, 5); p.add(cd);
      p.add(scene.add.text(ex + 6, ey + 4, item.name, { fontSize: '11px', color: '#ffcc88', fontStyle: 'bold', padding: { y: 1 } }));
      p.add(scene.add.text(ex + 6, ey + 22, item.desc || '双击开启', { fontSize: '9px', color: '#cc9966', padding: { y: 1 } }));
      p.add(scene.add.text(ex + eggW - 25, ey + 4, `×${item.quantity}`, { fontSize: '11px', color: '#ffcc88', fontStyle: 'bold', padding: { y: 1 } }));
      const ez = scene.add.zone(ex, ey, eggW, 58).setOrigin(0, 0).setInteractive({ useHandCursor: true });
      ez.on('pointerover', () => { cd.clear(); cd.fillStyle(0x2a2010, 0.9); cd.fillRoundedRect(ex, ey, eggW, 58, 5); cd.lineStyle(1, 0xcc8833, 0.8); cd.strokeRoundedRect(ex, ey, eggW, 58, 5); });
      ez.on('pointerout', () => { cd.clear(); cd.fillStyle(0x1a1208, 0.8); cd.fillRoundedRect(ex, ey, eggW, 58, 5); cd.lineStyle(1, 0xaa6622, 0.6); cd.strokeRoundedRect(ex, ey, eggW, 58, 5); });
      ez.on('pointerdown', () => {
        const now = Date.now();
        if (now - ((item as any)._lastEggClick || 0) < 350) {
          // 双击：开启灵宠蛋（服务端权威，worldSync 刷新背包 / intentResult 显示孵化结果）
          if (!isOnline()) { scene.showWorldNotif('灵宠蛋需联网开启', false); return; }
          requestUsePetEgg(item.id);
        }
        (item as any)._lastEggClick = now;
      });
      p.add(ez);
    });
    const eggEndY = eggY + 30 + Math.ceil(eggs.length / eggC) * 68;

    // 套装进度汇总（联机下 equipment 由 worldSync 重建并带 set 字段）
    const setProgress = listSetProgress(Inventory.equipment);
    const setBlockY = eggEndY + 14;
    p.add(scene.add.text(ox + 20, setBlockY, '套装进度', { fontSize: '15px', color: '#c9a96e', fontStyle: 'bold', padding: { y: 2 } }));
    if (setProgress.length === 0) {
      p.add(scene.add.text(ox + 20, setBlockY + 26, '（未穿戴任何套装装备；同区域同品质装备凑齐件数可激活加成）', { fontSize: '11px', color: '#556688', padding: { y: 1 } }));
    } else {
      setProgress.forEach((s, i) => {
        const y = setBlockY + 26 + i * 20;
        const bonusStr = Object.entries(s.active).map(([k, v]) => `${k.toUpperCase()}+${Math.round((v as number) * 100)}%`).join(' ');
        p.add(scene.add.text(ox + 20, y, `${s.name}  防具 ${s.armorCount}/${s.armorTotal} · 饰品 ${s.jewelCount}/${s.jewelTotal}`, { fontSize: '11px', color: '#88ccff', padding: { y: 1 } }));
        if (bonusStr) p.add(scene.add.text(ox + 300, y, `已激活: ${bonusStr}`, { fontSize: '11px', color: '#ffcc66', padding: { y: 1 } }));
      });
    }

    const fy = oy + oh - 28; const ft = scene.add.graphics(); ft.fillStyle(0x1a1a36, 0.8); ft.fillRoundedRect(ox + 4, fy, ow - 8, 24, { tl: 0, tr: 0, bl: 10, br: 10 }); p.add(ft);
    p.add(scene.add.text(GAME_WIDTH / 2, fy + 12, 'B键 开关  |  ESC 关闭', { fontSize: '11px', color: '#556688', padding: { y: 2 } }).setOrigin(0.5));
  }

