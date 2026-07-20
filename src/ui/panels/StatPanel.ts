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


import { openMall } from './Shop';
import { addEnhanceGlow } from './EnhancePanel';
import { openArenaPanel } from './ArenaPanel';

export function toggleStatPanel(scene: GameScene): void { if (scene.statPanel) { closeStatPanel(scene); return; } renderStatPanel(scene); }

export function closeStatPanel(scene: GameScene): void {
  if (scene.statPanel) {
    const h = (scene as any)._statPanelUpdate;
    if (h) { scene.scene.get('UIScene').events.off('updateStats', h); (scene as any)._statPanelUpdate = null; }
    scene.statPanel.destroy(true); scene.statPanel = null; scene.resumeFromMenu();
  }
}

export function renderStatPanel(scene: GameScene): void {
    scene.pauseForMenu(); const cam = scene.cameras.main;
    const p = scene.add.container(Math.round(cam.scrollX), Math.round(cam.scrollY)).setDepth(300); scene.statPanel = p;
    const ov = scene.add.graphics(); ov.fillStyle(0x000000, 0.78); ov.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT); ov.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains); p.add(ov);
    const ox = 30, oy = 20, ow = GAME_WIDTH - 60, oh = GAME_HEIGHT - 40;
    const mb = scene.add.graphics(); mb.fillStyle(0x121222, 0.98); mb.fillRoundedRect(ox, oy, ow, oh, 12); mb.lineStyle(2, 0x4a5a8a, 0.6); mb.strokeRoundedRect(ox, oy, ow, oh, 12); p.add(mb);

    // Title bar
    const th = 54; const tb = scene.add.graphics(); tb.fillStyle(0x1a1a36, 1); tb.fillRoundedRect(ox + 4, oy + 4, ow - 8, th, { tl: 10, tr: 10, bl: 0, br: 0 }); p.add(tb);
    p.add(scene.add.text(GAME_WIDTH / 2, oy + th / 2, '◆  属 性 面 板  ◆', { fontSize: '22px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));
    p.add(scene.add.text(ox + ow - 40, oy + th / 2, '✕', { fontSize: '22px', color: '#cc6666', padding: { x: 8, y: 4 } }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerover', function (this: any) { this.setColor('#ff8888'); }).on('pointerout', function (this: any) { this.setColor('#cc6666'); }).on('pointerdown', () => closeStatPanel(scene)));
    // 商城入口（购买洗点符等）：先关属性面板再开商城，避免菜单嵌套
    p.add(scene.add.text(ox + ow - 200, oy + th / 2, '商城', { fontSize: '15px', color: '#ffcc88', fontStyle: 'bold', padding: { x: 8, y: 4 }, backgroundColor: '#33220088' }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerover', function (this: any) { this.setColor('#ffe0a0'); this.setBackgroundColor('#553300aa'); })
      .on('pointerout', function (this: any) { this.setColor('#ffcc88'); this.setBackgroundColor('#33220088'); })
      .on('pointerdown', () => { closeStatPanel(scene); openMall(scene); }));

    // Two-column layout with generous spacing
    const colW = (ow - 100) / 2;
    const lx = ox + 30;          // left column x
    const rx = lx + colW + 40;   // right column x
    const hdrY = oy + th + 14;   // content start y

    // ═══ Left column: Info block ═══
    // Player info banner
    const infoBg = scene.add.graphics(); infoBg.fillStyle(0x1a1a36, 0.6); infoBg.fillRoundedRect(lx, hdrY, colW, 58, 6); infoBg.lineStyle(1, 0x334466, 0.4); infoBg.strokeRoundedRect(lx, hdrY, colW, 58, 6); p.add(infoBg);
    p.add(scene.add.text(lx + 16, hdrY + 8, `${GameState.playerName}   Lv.${GameState.level}`, { fontSize: '16px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 2 } }));
    p.add(scene.add.text(lx + 16, hdrY + 32, `金币: ${GameState.gold}    元素: ${GameState.element || '无'}    斩魄刀: ${GameState.zanpakuto || '无'}`, { fontSize: '12px', color: '#8899bb', padding: { y: 1 } }));

    // Six power system unlock status
    const unlockY = hdrY + 72;
    const unlockBg = scene.add.graphics(); unlockBg.fillStyle(0x0d0d1d, 0.7); unlockBg.fillRoundedRect(lx, unlockY, colW, 40, 6); unlockBg.lineStyle(1, 0x334466, 0.3); unlockBg.strokeRoundedRect(lx, unlockY, colW, 40, 6); p.add(unlockBg);
    p.add(scene.add.text(lx + 16, unlockY + 6, '力量体系', { fontSize: '11px', color: '#556688', padding: { y: 1 } }));
    const powers = [
      { n: '始解', on: GameState.hasShikai }, { n: '卍解', on: GameState.hasBankai }, { n: '虚化', on: GameState.hasHollow },
      { n: '完现', on: GameState.hasFullbring }, { n: '圣文', on: GameState.hasSchrift }, { n: '狱解', on: GameState.hasHell },
    ];
    const pwSpacing = (colW - 32) / 6;
    powers.forEach((pw, i) => {
      const px = lx + 16 + i * pwSpacing + pwSpacing / 2;
      p.add(scene.add.text(px, unlockY + 26, `${pw.n}${pw.on ? '✓' : '✗'}`, {
        fontSize: '12px', color: pw.on ? '#44cc88' : '#445566', fontStyle: 'bold', padding: { y: 1 }
      }).setOrigin(0.5));
    });

    // ═══ Stat points + EXP block ═══
    const spY = unlockY + 54;
    const allocatedTotal = () => (GameState.allocatedHP + GameState.allocatedMP + GameState.allocatedATK + GameState.allocatedDEF + GameState.allocatedMATK + GameState.allocatedMDEF + GameState.allocatedSPD);
    const expNeed = () => expForLevel(GameState.level + 1);
    const expPct = () => { const n = expNeed(); return n > 0 ? Math.floor((GameState.exp / n) * 100) : 0; };

    // 剩余属性点 banner (prominent)
    const spBg = scene.add.graphics(); spBg.fillStyle(0x2a1a0a, 0.8); spBg.fillRoundedRect(lx, spY, colW, 36, 6); spBg.lineStyle(1, 0x665533, 0.5); spBg.strokeRoundedRect(lx, spY, colW, 36, 6); p.add(spBg);
    let spText: Phaser.GameObjects.Text;
    spText = scene.add.text(lx + 20, spY + 7, `剩余属性点: ${GameState.statPoints}`, {
      fontSize: '19px', color: GameState.statPoints > 0 ? '#ffcc44' : '#667788', fontStyle: 'bold', padding: { y: 2 }
    });
    p.add(spText);
    p.add(scene.add.text(lx + colW - 20, spY + 10, 'HP+15 / MP+5 / 其他+1', {
      fontSize: '11px', color: '#556688', padding: { y: 1 }
    }).setOrigin(1, 0));

    // 已分配点数 小行
    const allocLineY = spY + 42;
    let allocTotalText: Phaser.GameObjects.Text;
    allocTotalText = scene.add.text(lx + 20, allocLineY, `已分配点数: ${allocatedTotal()}`, { fontSize: '13px', color: '#88ccff', padding: { y: 1 } });
    p.add(allocTotalText);

    // 经验 banner
    const expY = spY + 66;
    const expBg = scene.add.graphics(); expBg.fillStyle(0x0d1d2a, 0.8); expBg.fillRoundedRect(lx, expY, colW, 40, 6); expBg.lineStyle(1, 0x335566, 0.5); expBg.strokeRoundedRect(lx, expY, colW, 40, 6); p.add(expBg);
    let expCurText: Phaser.GameObjects.Text;
    let expPctText: Phaser.GameObjects.Text;
    expCurText = scene.add.text(lx + 20, expY + 5, `当前经验: ${GameState.exp} / 升级所需: ${expNeed()}`, { fontSize: '13px', color: '#88ccff', padding: { y: 1 } });
    p.add(expCurText);
    expPctText = scene.add.text(lx + 20, expY + 22, `当前经验百分比: ${expPct()}%`, { fontSize: '13px', color: '#88ccff', padding: { y: 1 } });
    p.add(expPctText);

    // ═══ Left column: Attributes ═══
    const attrs = [
      { l: 'HP', k: 'maxHp', a: 'allocatedHP', per: 15 }, { l: 'MP', k: 'maxMp', a: 'allocatedMP', per: 5 },
      { l: 'ATK', k: 'atk', a: 'allocatedATK', per: 1 }, { l: 'DEF', k: 'def', a: 'allocatedDEF', per: 1 },
      { l: 'MATK', k: 'matk', a: 'allocatedMATK', per: 1 }, { l: 'MDEF', k: 'mdef', a: 'allocatedMDEF', per: 1 },
      { l: 'SPD', k: 'spd', a: 'allocatedSPD', per: 1 },
    ];
    const atY = spY + 112;
    const rowH = 50;
    const valTexts: Phaser.GameObjects.Text[] = [];
    const allocTexts: Phaser.GameObjects.Text[] = [];
    const addBtns: Phaser.GameObjects.Text[] = [];
    const refreshDisplay = () => {
      spText.setText(`剩余属性点: ${GameState.statPoints}`);
      spText.setColor(GameState.statPoints > 0 ? '#ffcc44' : '#667788');
      allocTotalText.setText(`已分配点数: ${allocatedTotal()}`);
      expCurText.setText(`当前经验: ${GameState.exp} / 升级所需: ${expNeed()}`);
      expPctText.setText(`当前经验百分比: ${expPct()}%`);
      attrs.forEach((at, i) => {
        const av = (GameState as any)[at.k] as number;
        const al = (GameState as any)[at.a] as number;
        valTexts[i].setText(`${av}`);
        allocTexts[i].setText(`(加点${al} × ${at.per} = +${al * at.per})`);
        addBtns[i].setColor(GameState.statPoints > 0 ? '#44cc44' : '#335533');
      });
    };

    // 面板打开期间监听 worldSync 触发的 updateStats，实时刷新点数/经验
    const onStatUpdate = () => refreshDisplay();
    (scene as any)._statPanelUpdate = onStatUpdate;
    scene.scene.get('UIScene').events.on('updateStats', onStatUpdate);

    attrs.forEach((at, i) => {
      const ay = atY + i * rowH;
      const av = (GameState as any)[at.k] as number; const al = (GameState as any)[at.a] as number;
      const ar = scene.add.graphics(); ar.fillStyle(0x0d0d1d, 0.7); ar.fillRoundedRect(lx, ay, colW, 46, 6); ar.lineStyle(1, 0x334466, 0.3); ar.strokeRoundedRect(lx, ay, colW, 46, 6); p.add(ar);
      // Label
      p.add(scene.add.text(lx + 18, ay + 14, at.l, { fontSize: '16px', color: '#ffe8b0', fontStyle: 'bold', padding: { y: 2 } }));
      // Value
      const vt = scene.add.text(lx + 90, ay + 12, `${av}`, { fontSize: '20px', color: '#88ccff', fontStyle: 'bold', padding: { y: 2 } });
      p.add(vt); valTexts.push(vt);
      // Allocation detail
      const at2 = scene.add.text(lx + 160, ay + 16, `(加点${al} × ${at.per} = +${al * at.per})`, { fontSize: '12px', color: '#6677aa', padding: { y: 1 } });
      p.add(at2); allocTexts.push(at2);
      // + button
      const ap = scene.add.text(lx + colW - 110, ay + 8, '＋', { fontSize: '24px', color: GameState.statPoints > 0 ? '#44cc44' : '#335533', fontStyle: 'bold', padding: { x: 12, y: 6 } }).setInteractive({ useHandCursor: true });
      ap.on('pointerover', () => { if (GameState.statPoints > 0) ap.setColor('#88ff88'); });
      ap.on('pointerout', () => { ap.setColor(GameState.statPoints > 0 ? '#44cc44' : '#335533'); });
      ap.on('pointerdown', () => {
        if (GameState.statPoints > 0) {
          (GameState as any)[at.a]++; GameState.statPoints--; GameState.recalcStats(); refreshDisplay();
          scene.scene.get('UIScene').events.emit('updateStats');
          requestAllocateStat(at.l); // 服务端权威记账 + 持久化（乐观更新已先行）
        }
      });
      p.add(ap); addBtns.push(ap);
    });

    // ═══ Left column: PVP 竞技场（跨赛季最高段位 + 历史）═══
    const arenaY = atY + attrs.length * rowH + 16;
    if (arenaY + 150 < oy + oh) {
      const ab = scene.add.graphics(); ab.fillStyle(0x16122a, 0.7); ab.fillRoundedRect(lx, arenaY, colW, 150, 6);
      ab.lineStyle(1, 0x554488, 0.4); ab.strokeRoundedRect(lx, arenaY, colW, 150, 6); p.add(ab);
      p.add(scene.add.text(lx + 16, arenaY + 8, '⚔ PVP 竞技场', { fontSize: '13px', color: '#c9a0ff', fontStyle: 'bold', padding: { y: 1 } }));
      const a = (arena as any) || {};
      const tName = a.tier ? tierNameById(a.tier) : '—';
      const btName = a.bestTierEver ? tierNameById(a.bestTierEver) : '—';
      p.add(scene.add.text(lx + 16, arenaY + 30, `当前段位: ${tName}    积分: ${a.points ?? 0}`, { fontSize: '12px', color: '#ccbbff', padding: { y: 1 } }));
      p.add(scene.add.text(lx + 16, arenaY + 50, `本周匹配: ${a.weeklyUsed ?? 0} / ${ARENA_WEEKLY_CAP_CLIENT}`, { fontSize: '12px', color: '#ccbbff', padding: { y: 1 } }));
      p.add(scene.add.text(lx + 16, arenaY + 70, `历史最高段位: ${btName}`, { fontSize: '12px', color: '#ffcc88', padding: { y: 1 } }));
      const hist: any[] = Array.isArray(a.history) ? a.history : [];
      const histStr = hist.length
        ? hist.slice(-3).reverse().map((h: any) => `S${h.season}:${tierNameById(h.tier)}`).join('   ')
        : '— 暂无 —';
      p.add(scene.add.text(lx + 16, arenaY + 90, `过往赛季: ${histStr}`, { fontSize: '11px', color: '#9988bb', wordWrap: { width: colW - 32 }, padding: { y: 1 } }));
      p.add(scene.add.text(lx + 16, arenaY + 124, '（点「竞技场」按钮进入匹配）', { fontSize: '10px', color: '#6677aa', padding: { y: 1 } }));
      // 竞技场入口按钮
      const abtn = scene.add.text(lx + colW - 14, arenaY + 8, '竞技场', { fontSize: '13px', color: '#e0c8ff', fontStyle: 'bold', padding: { x: 10, y: 4 }, backgroundColor: '#33225588' }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
      abtn.on('pointerover', () => abtn.setColor('#ffffff')); abtn.on('pointerout', () => abtn.setColor('#e0c8ff'));
      abtn.on('pointerdown', () => { closeStatPanel(scene); openArenaPanel(scene); });
      p.add(abtn);
    }

    // ═══ Right column: Equipment grid ═══
    p.add(scene.add.text(rx, hdrY, '装备栏', { fontSize: '18px', color: '#aaccdd', fontStyle: 'bold', padding: { y: 3 } }));
    p.add(scene.add.text(rx + 80, hdrY + 4, '（查看用·卸下请开背包 B）', { fontSize: '11px', color: '#556688', padding: { y: 1 } }));
    const eq = Inventory.equipment;
    const sn: Record<string, string> = { weapon: '斩魄刀', head: '头部', body: '身体', bracer: '手甲', boots: '战靴', belt: '腰带', ring: '戒指', necklace: '项链', charm: '护符', pendant: '挂饰' };
    const eqs: EquipSlot[] = ['head', 'body', 'bracer', 'boots', 'belt', 'ring', 'necklace', 'charm', 'pendant'];
    const eqY = hdrY + 36;
    const eqColW = (colW - 10) / 2;
    const eqRowH = 76;
    // 斩魄刀（固定头部，独立于装备槽渲染）
    {
      const zkW = 2 * eqColW + 10, zkH = 66;
      const zer = scene.add.graphics(); zer.fillStyle(0x0d0d1d, 0.6); zer.fillRoundedRect(rx, eqY, zkW, zkH, 6);
      zer.lineStyle(1, 0x334466, 0.4); zer.strokeRoundedRect(rx, eqY, zkW, zkH, 6); p.add(zer);
      p.add(scene.add.text(rx + 10, eqY + 6, '斩魄刀', { fontSize: '11px', color: '#667799', fontStyle: 'bold', padding: { y: 1 } }));
      const zk = GameState.zanpakuto;
      if (zk) {
        p.add(scene.add.text(rx + 10, eqY + 24, zk, { fontSize: '13px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 1 } }));
        p.add(scene.add.text(rx + 10, eqY + 46, `元素: ${GameState.element || '无'}  (始解${GameState.hasShikai ? '✓' : '✗'})`, { fontSize: '10px', color: '#8899bb', padding: { y: 1 } }));
      } else {
        p.add(scene.add.text(rx + 10, eqY + 28, '— 未觉醒 —', { fontSize: '13px', color: '#334455', padding: { y: 1 } }));
      }
    }
    eqs.forEach((s, i) => {
      const c2 = i % 2, r2 = Math.floor(i / 2);
      const sx = rx + c2 * (eqColW + 10), sy = eqY + eqRowH + r2 * eqRowH;
      const er = scene.add.graphics(); er.fillStyle(0x0d0d1d, 0.6); er.fillRoundedRect(sx, sy, eqColW, 66, 6);
      er.lineStyle(1, 0x334466, 0.4); er.strokeRoundedRect(sx, sy, eqColW, 66, 6); p.add(er);
      if (eq[s]) addEnhanceGlow(scene, p, er, sx, sy, eqColW, 66, eq[s]!, 6);
      // Slot name label
      p.add(scene.add.text(sx + 10, sy + 6, sn[s], { fontSize: '11px', color: '#667799', fontStyle: 'bold', padding: { y: 1 } }));
      const it = eq[s];
      if (it) {
        const elv = it.enhanceLevel || 0; const lvTxt = elv > 0 ? ` +${elv}` : '';
        const qc: Record<string, string> = { white: '#cccccc', green: '#44cc44', blue: '#4488ff', purple: '#cc44cc', gold: '#ffaa00' };
        const q = it.quality || 'white';
        const itemTxt = scene.add.text(sx + 10, sy + 24, `${it.name}${lvTxt}`, {
          fontSize: '13px', color: qc[q] || '#cccccc', fontStyle: 'bold', padding: { y: 1 }
        });
        // Truncate long names
        if (itemTxt.width > eqColW - 20) { itemTxt.setText(it.name.slice(0, 8) + '…' + lvTxt); }
        p.add(itemTxt);
        const sts = Object.entries(it.stats as Record<string, number>).map(([k, v]) => `${k}+${v}`).join('  ');
        p.add(scene.add.text(sx + 10, sy + 46, sts, { fontSize: '10px', color: '#8899bb', padding: { y: 1 } }));
        const refineStr = getRefineDisplay(it);
        if (refineStr) p.add(scene.add.text(sx + 10, sy + 58, `精炼: ${refineStr}`, { fontSize: '9px', color: '#F5A623', padding: { y: 1 } }));
        // 属性面板(C)仅查看装备，不允许点击卸下（卸下请在背包(B)面板操作）
      } else {
        p.add(scene.add.text(sx + 10, sy + 28, '— 空 —', { fontSize: '13px', color: '#334455', padding: { y: 1 } }));
      }
    });

    // ═══ Right column: Derived combat stats summary (below equipment) ═══
    const sumY = eqY + 6 * eqRowH + 8;
    if (sumY + 142 < oy + oh) {
      const sumBg = scene.add.graphics(); sumBg.fillStyle(0x1a1a36, 0.5); sumBg.fillRoundedRect(rx, sumY, colW, 132, 6); sumBg.lineStyle(1, 0x334466, 0.3); sumBg.strokeRoundedRect(rx, sumY, colW, 132, 6); p.add(sumBg);
      p.add(scene.add.text(rx + 16, sumY + 8, '战斗属性', { fontSize: '13px', color: '#aaccdd', fontStyle: 'bold', padding: { y: 1 } }));
      const ds = [
        `生命: ${GameState.maxHp}`, `法力: ${GameState.maxMp}`,
        `物攻: ${GameState.atk}`, `物防: ${GameState.def}`,
        `魔攻: ${GameState.matk}`, `魔防: ${GameState.mdef}`,
        `速度: ${GameState.spd}`, `暴击: ${(GameState as any).critRate || 0}%`,
        `异常命中: ${Math.round(GameState.statusAcc * 100)}%`,
      ];
      ds.forEach((line, i) => {
        const c2 = i % 2, r2 = Math.floor(i / 2);
        p.add(scene.add.text(rx + 16 + c2 * (colW / 2 - 10), sumY + 32 + r2 * 22, line, { fontSize: '12px', color: '#8899bb', padding: { y: 1 } }));
      });
    }

    // Footer
    const fy = oy + oh - 28; const ft = scene.add.graphics(); ft.fillStyle(0x1a1a36, 0.8); ft.fillRoundedRect(ox + 4, fy, ow - 8, 24, { tl: 0, tr: 0, bl: 10, br: 10 }); p.add(ft);
    p.add(scene.add.text(GAME_WIDTH / 2, fy + 12, 'C键 开关  |  ESC 关闭  |  属性点已分配后如需洗点，请到商城购买「洗点符」使用  |  卸下装备请开背包(B)', { fontSize: '11px', color: '#556688', padding: { y: 2 } }).setOrigin(0.5));
  }

