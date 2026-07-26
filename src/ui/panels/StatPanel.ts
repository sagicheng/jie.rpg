/**
 * 属性面板 — 角色属性 / 加点 的打开与渲染
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


import { openMall } from './Shop';
import { addEnhanceGlow } from './EnhancePanel';
import { openArenaPanel } from './ArenaPanel';

export function toggleStatPanel(scene: GameScene): void { if (scene.statPanel) { closeStatPanel(scene); return; } renderStatPanel(scene); }

export function closeStatPanel(scene: GameScene): void {
  if (scene.statPanel) {
    const h = (scene as any)._statPanelUpdate;
    if (h) { scene.scene.get('UIScene').events.off('updateStats', h); (scene as any)._statPanelUpdate = null; }
    // 清理立绘动效：解绑 pointermove + 停止 tween，避免泄漏
    const pm = (scene as any)._statPanelPointerMove;
    if (pm) { scene.input.off('pointermove', pm); (scene as any)._statPanelPointerMove = null; }
    const tw = (scene as any)._statPanelTweens;
    if (Array.isArray(tw)) tw.forEach((t: Phaser.Tweens.Tween) => t.stop());
    (scene as any)._statPanelTweens = null;
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
    p.add(scene.add.text(lx + 16, hdrY + 32, `金币: ${GameState.gold}    斩魄刀: ${GameState.zanpakuto || '无'}`, { fontSize: '12px', color: '#8899bb', padding: { y: 1 } }));
    // 当前元素共鸣图标（独立美术，替代原程序化占位）
    const elIconKey = GameState.element ? `icon_${GameState.element}` : null;
    if (elIconKey && scene.textures.exists(elIconKey)) {
      const ei = scene.add.image(lx + colW - 26, hdrY + 29, elIconKey).setOrigin(0.5).setDisplaySize(44, 44);
      p.add(ei);
    }

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

    // ═══ Right column: 斩魄刀立绘(左半) + 装备格(右半) ═══
    const spTweens: Phaser.Tweens.Tween[] = ((scene as any)._statPanelTweens = []);
    const portraitW = 260;                 // 竖向立绘框宽度（窄长条）
    const bandY = hdrY + 32, bandH = 460;  // 竖向高度
    const frameX = rx, frameY = bandY, frameW = portraitW, frameH = bandH;
    const gridX = rx + portraitW + 12;
    p.add(scene.add.text(rx, hdrY, '装备栏', { fontSize: '18px', color: '#aaccdd', fontStyle: 'bold', padding: { y: 3 } }));
    p.add(scene.add.text(rx + 80, hdrY + 4, '（立绘左 · 装备格右）', { fontSize: '11px', color: '#556688', padding: { y: 1 } }));

    // ── 立绘框（竖向悬挂式：纯斩魄刀立绘，不带任何元素属性）──
    const frameBg = scene.add.graphics();
    frameBg.fillStyle(0x0d0d1d, 0.7); frameBg.fillRoundedRect(frameX, frameY, frameW, frameH, 10);
    frameBg.lineStyle(1.5, 0xe8d5a3, 0.5); frameBg.strokeRoundedRect(frameX, frameY, frameW, frameH, 10); p.add(frameBg);

    // 视差外层 / 呼吸内层（嵌套容器，互不干扰）
    const parallaxBox = scene.add.container(frameX + frameW / 2, frameY + frameH / 2); p.add(parallaxBox);
    const illoBox = scene.add.container(0, 0); parallaxBox.add(illoBox);

    const zkName = GameState.zanpakuto;
    const isBankai = GameState.hasBankai, isShikai = GameState.hasShikai;
    let artKey: string | null = null;
    if (zkName) {
      if (isBankai && scene.textures.exists(`zan_${zkName}_bankai`)) artKey = `zan_${zkName}_bankai`;
      else if (scene.textures.exists(`zan_${zkName}_shikai`)) artKey = `zan_${zkName}_shikai`;
    }
    let illoImg: Phaser.GameObjects.Image | null = null;
    if (artKey) {
      illoImg = scene.add.image(0, 0, artKey).setOrigin(0.5);
      const src = scene.textures.get(artKey).getSourceImage() as { width: number; height: number };
      // 竖向框：以高度为主适配，保留刀竖直悬挂（刀柄在上、刀身在下的原始比例）
      const sc = Math.min((frameW - 24) / src.width, (frameH - 36) / src.height, 1.4);
      illoImg.setScale(sc);
      illoBox.add(illoImg);
    } else {
      // 无立绘：中立占位文字（不显示元素图标，避免元素属性混入立绘区）
      illoBox.add(scene.add.text(0, 0, zkName ? (isShikai ? '始解立绘待导入' : '立绘待导入') : '— 未觉醒 —',
        { fontSize: '13px', color: '#6677aa', align: 'center', padding: { y: 2 } }).setOrigin(0.5));
    }

    // 铭牌（仅刀名 + 始解/卍解状态，不含元素）
    p.add(scene.add.text(frameX + frameW / 2, frameY + frameH - 14,
      zkName ? `${zkName}  始解${isShikai ? '✓' : '✗'} 卍解${isBankai ? '✓' : '✗'}`
             : '尚无斩魄刀',
      { fontSize: '12px', color: '#8899bb', padding: { y: 1 } }).setOrigin(0.5));

    // ── 动效（T1 呼吸 + T4 视差 + T5 状态联动；已移除元素底光 T2'）──
    const amp = !zkName ? 0 : isBankai ? 9 : isShikai ? 7 : 4;
    const dur = isBankai ? 3000 : isShikai ? 3400 : 4500;
    if (illoBox && amp > 0) {
      spTweens.push(scene.tweens.add({ targets: illoBox, y: -amp, duration: dur, yoyo: true, repeat: -1, ease: 'Sine.inOut' }));
      spTweens.push(scene.tweens.add({ targets: illoBox, scaleY: 1.03, duration: dur * 0.9, yoyo: true, repeat: -1, ease: 'Sine.inOut' }));
    }
    if (isBankai && illoImg) {
      spTweens.push(scene.tweens.add({ targets: illoImg, angle: 1.2, duration: 6000, yoyo: true, repeat: -1, ease: 'Sine.inOut' }));
    }
    // T4 鼠标视差
    const cxS = frameX + frameW / 2, cyS = frameY + frameH / 2;
    const onPointerMove = (pointer: Phaser.Input.Pointer) => {
      if (!parallaxBox.active) return;
      const dx = (pointer.x - cxS) / (GAME_WIDTH / 2), dy = (pointer.y - cyS) / (GAME_HEIGHT / 2);
      const ax = isBankai ? 16 : 12, ay = isBankai ? 10 : 7;
      scene.tweens.killTweensOf(parallaxBox);
      scene.tweens.add({ targets: parallaxBox, x: cxS + dx * ax, y: cyS + dy * ay, duration: 300, ease: 'Sine.out' });
    };
    scene.input.on('pointermove', onPointerMove);
    (scene as any)._statPanelPointerMove = onPointerMove;

    // ── 装备格（立绘右侧，3×3 小格）──
    const eq = Inventory.equipment;
    const sn: Record<string, string> = { weapon: '斩魄刀', head: '头部', body: '身体', bracer: '手甲', boots: '战靴', belt: '腰带', ring: '戒指', necklace: '项链', charm: '护符', pendant: '挂饰' };
    const eqs: EquipSlot[] = ['head', 'body', 'bracer', 'boots', 'belt', 'ring', 'necklace', 'charm', 'pendant'];
    const gCols = 3, gGap = 8, gCellW = (colW - portraitW - 12 - gGap * (gCols - 1)) / gCols, gCellH = 82;
    const QC: Record<string, string> = { white: '#cccccc', green: '#44cc44', blue: '#4488ff', purple: '#cc44cc', gold: '#ffaa00' };
    eqs.forEach((s, i) => {
      const c = i % gCols, r = Math.floor(i / gCols);
      const sx = gridX + c * (gCellW + gGap), sy = bandY + r * (gCellH + gGap);
      const it = eq[s];
      const q = it?.quality || 'white';
      const qCol = parseInt((QC[q] || '#cccccc').replace('#', ''), 16);
      const er = scene.add.graphics(); er.fillStyle(0x0d0d1d, 0.6); er.fillRoundedRect(sx, sy, gCellW, gCellH, 6);
      er.lineStyle(it ? 2 : 1, it ? qCol : 0x334466, it ? 0.95 : 0.4); er.strokeRoundedRect(sx, sy, gCellW, gCellH, 6); p.add(er);
      if (it) addEnhanceGlow(scene, p, er, sx, sy, gCellW, gCellH, it, 6);
      const slotKey = `slot_${s}`;
      const ic = Math.min(gCellW, gCellH) - 30;
      const iconY = sy + 30;
      if (scene.textures.exists(slotKey)) {
        p.add(scene.add.image(sx + gCellW / 2, iconY, slotKey).setOrigin(0.5).setDisplaySize(ic, ic).setAlpha(it ? 1 : 0.5));
      }
      // 左上角：槽位名小标签（不占用主视觉区）
      p.add(scene.add.text(sx + 6, sy + 5, sn[s], { fontSize: '9px', color: '#556688', padding: { y: 1 } }));

      // 下层居中：装备名（含强化等级，按品质染色）
      const nmY = sy + gCellH - 13;
      if (it) {
        const lvTxt = (it.enhanceLevel || 0) > 0 ? ` +${it.enhanceLevel}` : '';
        const nm = scene.add.text(sx + gCellW / 2, nmY, `${it.name}${lvTxt}`,
          { fontSize: '10px', color: QC[q] || '#cccccc', fontStyle: 'bold', align: 'center', padding: { y: 1 } }).setOrigin(0.5, 0.5);
        if (nm.width > gCellW - 8) nm.setText(it.name.slice(0, 5) + '…' + lvTxt);
        p.add(nm);
      } else {
        p.add(scene.add.text(sx + gCellW / 2, nmY, '空', { fontSize: '10px', color: '#334455' }).setOrigin(0.5, 0.5));
      }
    });

    // ═══ 战斗属性摘要（紧贴装备格下方，仅右侧区域） ═══
    const gridBottom = bandY + 3 * (gCellH + gGap);   // 3行装备格底部
    const sumY = gridBottom + 10;
    const sumW = colW - portraitW - 12;                 // 仅装备格区域宽
    if (sumY + 132 < oy + oh) {
      const sumBg = scene.add.graphics(); sumBg.fillStyle(0x1a1a36, 0.5); sumBg.fillRoundedRect(gridX, sumY, sumW, 132, 6); sumBg.lineStyle(1, 0x334466, 0.3); sumBg.strokeRoundedRect(gridX, sumY, sumW, 132, 6); p.add(sumBg);
      p.add(scene.add.text(gridX + 16, sumY + 8, '战斗属性', { fontSize: '13px', color: '#aaccdd', fontStyle: 'bold', padding: { y: 1 } }));
      const ds = [
        `生命: ${GameState.maxHp}`, `法力: ${GameState.maxMp}`,
        `物攻: ${GameState.atk}`, `物防: ${GameState.def}`,
        `魔攻: ${GameState.matk}`, `魔防: ${GameState.mdef}`,
        `速度: ${GameState.spd}`, `暴击: ${(GameState as any).critRate || 0}%`,
        `异常命中: ${Math.round(GameState.statusAcc * 100)}%`,
      ];
      ds.forEach((line, i) => {
        const c2 = i % 2, r2 = Math.floor(i / 2);
        p.add(scene.add.text(gridX + 16 + c2 * (sumW / 2 - 10), sumY + 32 + r2 * 22, line, { fontSize: '12px', color: '#8899bb', padding: { y: 1 } }));
      });
    }
    // 底部预留区域留给以后扩展内容

    // Footer
    const fy = oy + oh - 28; const ft = scene.add.graphics(); ft.fillStyle(0x1a1a36, 0.8); ft.fillRoundedRect(ox + 4, fy, ow - 8, 24, { tl: 0, tr: 0, bl: 10, br: 10 }); p.add(ft);
    p.add(scene.add.text(GAME_WIDTH / 2, fy + 12, 'C键 开关  |  ESC 关闭  |  属性点已分配后如需洗点，请到商城购买「洗点符」使用  |  卸下装备请开背包(B)', { fontSize: '11px', color: '#556688', padding: { y: 2 } }).setOrigin(0.5));
  }

