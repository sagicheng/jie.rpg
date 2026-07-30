/**
 * 属性面板 — 角色属性 / 加点 的打开与渲染
 */

import type { GameScene } from '../../scenes/GameScene';

import Phaser from 'phaser';

import { GAME_WIDTH, GAME_HEIGHT } from '../../config/config';

import { zanpakutoName } from '../../config/zanpakuto';

import { GameState } from '../../managers/GameState';

import { GuildClient } from '../../api/GuildClient';

import { FriendClient } from '../../api/FriendClient';

import { GUILD_SKILLS, guildSkillCost } from '../../api/GuildSkills';

import { SaveManager } from '../../core/SaveManager';
import { ensureZanpakutoPortraits } from '../../core/portraitLoader';

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

export function closeStatPanel(scene: GameScene, permanent: boolean = true): void {
  if (scene.statPanel) {
    const h = (scene as any)._statPanelUpdate;
    if (h) { scene.scene.get('UIScene').events.off('updateStats', h); (scene as any)._statPanelUpdate = null; }
    // 清理立绘动效：解绑 pointermove + 停止 tween，避免泄漏
    const pm = (scene as any)._statPanelPointerMove;
    if (pm) { scene.input.off('pointermove', pm); (scene as any)._statPanelPointerMove = null; }
    const tw = (scene as any)._statPanelTweens;
    if (Array.isArray(tw)) tw.forEach((t: Phaser.Tweens.Tween) => t.stop());
    (scene as any)._statPanelTweens = null;
    // 注销立绘水中悬浮的逐帧更新，避免泄漏
    const fl = (scene as any)._statPanelFloat;
    if (fl) { scene.events.off('update', fl); (scene as any)._statPanelFloat = null; }
    // 立绘粒子发射器：仅「真正关闭面板」(permanent) 时才销毁；
    // worldSync 刷新重建面板 (permanent=false) 时复用，否则正在飘落的粒子会被擦掉、从头重来（表现为「掉 1 秒就消失」）。
    if (permanent) {
      const em = (scene as any)._statPanelEmitter;
      if (em) { em.stop(); em.destroy(); (scene as any)._statPanelEmitter = null; }
    }
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
    const gSym = GameState.gender === 'female' ? '♀' : '♂';
    p.add(scene.add.text(lx + 16, hdrY + 8, `${GameState.playerName}  ${gSym}  Lv.${GameState.level}`, { fontSize: '16px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 2 } }));
    p.add(scene.add.text(lx + 16, hdrY + 32, `金币: ${GameState.gold}    斩魄刀: ${GameState.zpId ? zanpakutoName(GameState.zpId) : '无'}`, { fontSize: '12px', color: '#8899bb', padding: { y: 1 } }));
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

    // 立绘粒子层（「下雪」式循环：框顶生成 → 向下飘落 → 底部淡出消失）
    // 不同元素降不同物体（火=火星/风=落叶/水=雪花/土=尘砾），与刀之元素表现一致；贴图为美术手绘彩色透明 PNG（fx_*.png），按元素选图、已去除 tint 染色。
    // 定位用「世界坐标 = 相机滚动 + 框屏幕中心」(等价第一版 p.add 容器局部坐标，已验证可正确显示)；
    // 贴图不透明实心确保清晰可见。关键：发射器脱离面板重建周期——worldSync 刷新时复用(prevEmitter)，不再每秒销毁重来。
    const elTex: Record<string, string> = { '火': 'fx_fire', '风': 'fx_wind', '水': 'fx_water', '土': 'fx_earth' };
    const texKey = elTex[GameState.element || '火'] || 'fx_fire';
    const fcx = frameX + frameW / 2, fcy = frameY + frameH / 2;   // 立绘框屏幕中心（scrollFactor=0 下世界=屏幕）
    // 下落节拍：按「框高 / 期望周期」反推匀速，保证粒子从容从顶飘到底再消失（不再中途一闪即逝）
    const fallSec = 17;                                  // 一整轮「顶→底→消失」周期(秒)，已大幅加长、雪感缓慢
    const vFall = frameH / fallSec;                      // 平均下落速度 px/s（框高460≈27px/s）
    // ⚠️ 定位用「世界坐标 = 相机滚动 + 框屏幕中心」，不依赖 scrollFactor(0)：
    // 实测粒子确实继承 emitter 的 scrollFactor，但为彻底排除「相机滚动把世界坐标粒子推出屏幕外」这一变量，
    // 这里直接把发射器放在世界坐标的框中心（= cam.scroll + 屏中心），确保任何滚动下都落在立绘框内可见。
    const showParticles = !!GameState.hasShikai;   // 仅「已激活始解」才在立绘区放粒子特效
    const prevEmitter = (scene as any)._statPanelEmitter as Phaser.GameObjects.Particles.ParticleEmitter | undefined;
    if (showParticles) {
      if (prevEmitter && prevEmitter.scene) {
        // 面板因 worldSync 刷新重建时：复用旧发射器（仅重新定位），绝不销毁 → 在飘粒子不会被「擦掉」再从头来
        prevEmitter.setPosition(cam.scrollX + fcx, cam.scrollY + fcy);
        prevEmitter.emitting = true;
        (scene as any)._statPanelEmitter = prevEmitter;
      } else {
        const portraitEmitter = scene.add.particles(
        cam.scrollX + fcx,
        cam.scrollY + fcy,
        texKey,
        {
          x: { min: -frameW / 2 + 20, max: frameW / 2 - 20 },   // 水平铺满立绘框
          y: { min: -frameH / 2 + 10, max: -frameH / 2 + 40 },  // 在框顶部薄带生成，从此往下落
          speedY: { min: vFall * 1.2, max: vFall * 1.9 },      // 缓慢匀速下落（略带差异自然飘落）
          speedX: { min: -10, max: 10 },                        // 轻微横向随风飘移
          lifespan: (fallSec / 0.8) * 1000,                     // ≈最长寿命，确保粒子从容从顶飘到底再消失
          scale: { start: 0.2, end: 0.1 },          // 源图 64×64，缩到约 32px 显示（框高460约占1/14，雪感精致）
          alpha: { start: 0.6, end: 0.0 },                       // 更淡：降低整体不透明度，颜色更柔和（比 0.95 淡一档）
          rotate: { start: 0, end: 360 },          // 翻滚，更像真实飘落物体
          quantity: 2,                             // 每批 1 颗（数量更少，更克制）
          frequency: 1800,                         // 约每 1.3s 一批（密度更低），配合长寿命形成稀疏雪幕
          blendMode: 'NORMAL',
          emitting: true,
        }
      );
      portraitEmitter.setDepth(320);
      (scene as any)._statPanelEmitter = portraitEmitter;
      }
    } else {
      // 未激活始解：立绘区不放粒子特效，清掉可能残留的发射器（避免关面板前一直飘）
      if (prevEmitter && prevEmitter.scene) { prevEmitter.stop(); prevEmitter.destroy(); }
      (scene as any)._statPanelEmitter = null;
    }

    // 视差外层 / 呼吸内层（嵌套容器，互不干扰）
    const parallaxBox = scene.add.container(frameX + frameW / 2, frameY + frameH / 2); p.add(parallaxBox);
    const illoBox = scene.add.container(0, 0); parallaxBox.add(illoBox);

    const zkName = GameState.zpId;
    const isBankai = GameState.hasBankai, isShikai = GameState.hasShikai;

    // 目标纹理 key（按始解/卍解状态选择；不再依赖是否已预载，缺失则异步懒加载）
    const desiredKey: string | null = zkName
      ? (isBankai ? `zan_${zkName}_bankai` : `zan_${zkName}_shikai`)
      : null;

    // 渲染立绘内容：纹理就绪则显示图片，否则显示占位并触发懒加载后重绘
    const renderPortrait = () => {
      (illoBox as any).list.forEach((c: any) => scene.tweens.killTweensOf(c));
      illoBox.removeAll(true);
      if (desiredKey && scene.textures.exists(desiredKey)) {
        const img = scene.add.image(0, 0, desiredKey).setOrigin(0.5);
        const src = scene.textures.get(desiredKey).getSourceImage() as { width: number; height: number };
        // 竖向框：以高度为主适配，保留刀竖直悬挂（刀柄在上、刀身在下的原始比例）
        const sc = Math.min((frameW - 24) / src.width, (frameH - 36) / src.height, 1.4);
        img.setScale(sc);
        illoBox.add(img);
        if (isBankai) {
          spTweens.push(scene.tweens.add({ targets: img, angle: 1.2, duration: 6000, yoyo: true, repeat: -1, ease: 'Sine.inOut' }));
        }
      } else {
        // 无立绘：中立占位文字（不显示元素图标，避免元素属性混入立绘区）
        illoBox.add(scene.add.text(0, 0, zkName ? (isShikai ? '始解立绘载入中…' : '立绘载入中…') : '— 未觉醒 —',
          { fontSize: '13px', color: '#6677aa', align: 'center', padding: { y: 2 } }).setOrigin(0.5));
      }
    };
    renderPortrait();
    if (desiredKey && !scene.textures.exists(desiredKey)) {
      ensureZanpakutoPortraits(scene, zkName!, () => {
        if (scene.statPanel !== p) return; // 面板已关闭或已重开，放弃本次重绘
        renderPortrait();
      });
    }

    // 铭牌（仅刀名 + 始解/卍解状态，不含元素）
    p.add(scene.add.text(frameX + frameW / 2, frameY + frameH - 14,
      zkName ? `${zanpakutoName(zkName)}  始解${isShikai ? '✓' : '✗'} 卍解${isBankai ? '✓' : '✗'}`
             : '尚无斩魄刀',
      { fontSize: '12px', color: '#8899bb', padding: { y: 1 } }).setOrigin(0.5));

    // ── 动效：水中悬浮（真·连续正弦浮动，无左右位移，柔和缓慢）──
    // 关键：用「绝对游戏时间」驱动相位，而非累积 ft —— 避免面板被 worldSync 刷新重建 illoBox 时
    // ft 归零导致立绘瞬移/跳变；相位锁定全局时钟，重建后从同一相位续上，丝滑无缝。
    // 注册前先注销旧处理器，杜绝重复注册打架。
    if (illoBox && zkName) {
      const prevFl = (scene as any)._statPanelFloat;
      if (prevFl) { scene.events.off('update', prevFl); (scene as any)._statPanelFloat = null; }
      const floatPeriod = isBankai ? 9000 : 11000;   // 完整「上浮 + 下潜」一个周期(ms)
      const floatAmp = isBankai ? 25 : 20;           // 上下浮动幅度（卍解25 / 始解20）
      const onFloat = (time: number) => {
        if (!illoBox.active) return;
        // 连续正弦：底部/顶部均平滑折返（该处速度为0），无机械转折、无水平位移
        illoBox.y = -Math.sin((time / floatPeriod) * Math.PI * 2) * floatAmp;
      };
      scene.events.on('update', onFloat);
      (scene as any)._statPanelFloat = onFloat;
    }

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

