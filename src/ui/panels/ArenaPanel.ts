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



export let arenaStatusCache: any = null;
  /** 当前选择的匹配模式。 */
export let arenaSelectedMode: '1v1' | '4v4' = '1v1';
  /** 是否正在匹配中。 */
export let arenaMatching = false;

  export function setArenaStatus(s: any): void { arenaStatusCache = s; }
  export function isArenaMatching(): boolean { return arenaMatching; }
  export function setArenaMatching(v: boolean): void { arenaMatching = v; }

export function showArenaPanel(scene: GameScene): void {
    requestArenaStatus();      // 进面板拉一次权威状态
    renderArenaPanel(scene);   // 渲染（renderArenaPanel 内部不再自动请求，避免死循环）
  }
  export function openArenaPanel(scene: GameScene): void { showArenaPanel(scene); }
  export function toggleArenaPanel(scene: GameScene): void { if (scene.arenaPanel) { closeArenaPanel(scene); return; } showArenaPanel(scene); }
  export function closeArenaPanel(scene: GameScene): void {
    if (scene.arenaPanel) { scene.arenaPanel.destroy(true); scene.arenaPanel = null; scene.resumeFromMenu(); }
  }

  export function renderArenaPanel(scene: GameScene): void {
    closeArenaPanel(scene);
    scene.pauseForMenu();
    const cam = scene.cameras.main;
    const p = scene.add.container(Math.round(cam.scrollX), Math.round(cam.scrollY)).setDepth(300); scene.arenaPanel = p;

    // ── 全屏面板（与 C 属性面板 / B 背包面板同尺寸风格）──
    const ov = scene.add.graphics(); ov.fillStyle(0x000000, 0.78); ov.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT); ov.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains); p.add(ov);
    const ox = 30, oy = 20, ow = GAME_WIDTH - 60, oh = GAME_HEIGHT - 40;
    const mb = scene.add.graphics(); mb.fillStyle(0x121222, 0.98); mb.fillRoundedRect(ox, oy, ow, oh, 12); mb.lineStyle(2, 0x6a4a8a, 0.6); mb.strokeRoundedRect(ox, oy, ow, oh, 12); p.add(mb);

    // 标题栏（与 C/B 统一：th=54）
    const th = 54; const tb = scene.add.graphics(); tb.fillStyle(0x1a1a36, 1); tb.fillRoundedRect(ox + 4, oy + 4, ow - 8, th, { tl: 10, tr: 10, bl: 0, br: 0 }); p.add(tb);
    p.add(scene.add.text(GAME_WIDTH / 2, oy + th / 2, '⚔  竞 技 场  ⚔', { fontSize: '22px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));
    p.add(scene.add.text(ox + ow - 40, oy + th / 2, '✕', { fontSize: '22px', color: '#cc6666', padding: { x: 8, y: 4 } }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerover', function (this: any) { this.setColor('#ff8888'); }).on('pointerout', function (this: any) { this.setColor('#cc6666'); })
      .on('pointerdown', () => { arenaMatching = false; closeArenaPanel(scene); }));

    // 数据
    const s = arenaStatusCache || (arena as any) || {};
    const open = !!s.open;
    const tName = s.tierName || (s.tier ? tierNameById(s.tier) : '—');
    const lx = ox + 30; // 内容左基准（与 C 面板 lx 一致）

    // ═══ 状态信息区（独立背景框，与 C 面板 infoBg 同风格）═══
    const hdrY = oy + th + 16;
    const infoH = 140;
    const infoBg = scene.add.graphics(); infoBg.fillStyle(0x1a1a36, 0.6); infoBg.fillRoundedRect(lx, hdrY, ow - 60, infoH, 8); infoBg.lineStyle(1, 0x334466, 0.4); infoBg.strokeRoundedRect(lx, hdrY, ow - 60, infoH, 8); p.add(infoBg);
    p.add(scene.add.text(lx + 16, hdrY + 12, `${open ? '● 开放中（每周五 18:00 – 24:00）' : '○ 未开放（每周五 18:00 – 24:00）'}`, { fontSize: '17px', color: open ? '#66cc88' : '#aa6666', fontStyle: 'bold', padding: { y: 3 } }));
    p.add(scene.add.text(lx + 16, hdrY + 44, `当前段位: ${tName}      积分: ${s.points ?? 0}`, { fontSize: '16px', color: '#ccbbff', padding: { y: 2 } }));
    p.add(scene.add.text(lx + 16, hdrY + 76, `本周匹配次数: ${s.weeklyUsed ?? 0} / ${s.weeklyCap ?? ARENA_WEEKLY_CAP_CLIENT}   （剩余 ${s.weeklyLeft ?? 0} 次）`, { fontSize: '15px', color: '#ccbbff', padding: { y: 2 } }));
    const histName = s.bestTierEverName || (s.bestTierEver ? tierNameById(s.bestTierEver) : '—');
    p.add(scene.add.text(lx + 16, hdrY + 108, `历史最高段位: ${histName}${s.season ? `  （第 ${s.season} 赛季）` : ''}`, { fontSize: '15px', color: '#9fd0ff', padding: { y: 2 } }));

    // ═══ 对战模式选择 ═══
    const modeY = hdrY + infoH + 22;
    p.add(scene.add.text(lx, modeY, '对战模式（不可组队，随机匹配在线玩家）', { fontSize: '15px', color: '#aaccdd', fontStyle: 'bold', padding: { y: 2 } }));
    const modes: { id: '1v1' | '4v4'; label: string }[] = [{ id: '1v1', label: '1V1 决斗' }, { id: '4v4', label: '4V4 团战' }];
    const mBtnW = 280, mBtnH = 52, mGap = 30;
    const mStartX = lx;
    const modeBtns: Record<string, { bg: Phaser.GameObjects.Graphics; refresh: () => void }> = {};
    modes.forEach((m, i) => {
      const bx = mStartX + i * (mBtnW + mGap), by = modeY + 34;
      const bg = scene.add.graphics();
      const draw = (sel: boolean) => {
        bg.clear();
        bg.fillStyle(sel ? 0x4a2a6a : 0x2a2a3e, 0.95);
        bg.fillRoundedRect(bx, by, mBtnW, mBtnH, 10);
        bg.lineStyle(2, sel ? 0xc9a0ff : 0x445566, 0.8);
        bg.strokeRoundedRect(bx, by, mBtnW, mBtnH, 10);
      };
      draw(arenaSelectedMode === m.id);
      const txt = scene.add.text(bx + mBtnW / 2, by + mBtnH / 2, m.label, { fontSize: '18px', color: '#eeddff', fontStyle: 'bold', padding: { y: 4 } }).setOrigin(0.5);
      const z = scene.add.zone(bx, by, mBtnW, mBtnH).setOrigin(0, 0).setInteractive({ useHandCursor: true });
      z.on('pointerdown', () => {
        if (arenaMatching) return;
        arenaSelectedMode = m.id;
        modes.forEach((mm) => modeBtns[mm.id].refresh());
      });
      p.add(bg); p.add(txt); p.add(z);
      modeBtns[m.id] = { bg, refresh: () => draw(arenaSelectedMode === m.id) };
    });

    // ═══ 匹配/取消 按钮 ═══
    const actY = modeY + 120;
    const actW = ow - 100, actH = 56;
    const actBg = scene.add.graphics();
    const actTxt = scene.add.text(GAME_WIDTH / 2, actY + actH / 2, '', { fontSize: '20px', color: '#ffffff', fontStyle: 'bold', padding: { y: 4 } }).setOrigin(0.5);
    const drawAct = (label: string, color: number) => {
      actBg.clear();
      actBg.fillStyle(color, 0.95);
      actBg.fillRoundedRect(lx, actY, actW, actH, 10);
      actBg.lineStyle(2, 0xffffff, 0.5);
      actBg.strokeRoundedRect(lx, actY, actW, actH, 10);
      actTxt.setText(label);
    };
    const refreshAct = () => {
      if (!open) { drawAct('未开放（每周五 18:00 后再来）', 0x553333); actZone.disableInteractive(); }
      else if (arenaMatching) { drawAct('取消匹配', 0xaa4444); actZone.setInteractive({ useHandCursor: true }); }
      else if ((s.weeklyUsed ?? 0) >= (s.weeklyCap ?? ARENA_WEEKLY_CAP_CLIENT)) { drawAct('本周次数已用完', 0x553333); actZone.disableInteractive(); }
      else { drawAct(`开始匹配（${arenaSelectedMode === '4v4' ? '4V4 团战' : '1V1 决斗'}）`, 0x2e7d32); actZone.setInteractive({ useHandCursor: true }); }
    };
    const actZone = scene.add.zone(lx, actY, actW, actH).setOrigin(0, 0);
    let waitTxt: Phaser.GameObjects.Text | null = null;
    actZone.on('pointerdown', () => {
      if (!open || (s.weeklyUsed ?? 0) >= (s.weeklyCap ?? ARENA_WEEKLY_CAP_CLIENT)) return;
      if (arenaMatching) {
        requestArenaCancel();
        arenaMatching = false;
        if (waitTxt) { waitTxt.destroy(); waitTxt = null; }
        refreshAct();
      } else {
        requestArenaQueue(arenaSelectedMode, (scene as any).authToken || '');
        arenaMatching = true;
        if (waitTxt) waitTxt.destroy();
        waitTxt = scene.add.text(GAME_WIDTH / 2, actY + actH + 20, '匹配中… 凑齐真人即开战 · 60 秒未凑齐自动取消 · 绝不 AI 替代', { fontSize: '14px', color: '#ffcc66', padding: { y: 3 } }).setOrigin(0.5);
        p.add(waitTxt);
        refreshAct();
      }
    });
    p.add(actBg); p.add(actTxt); p.add(actZone);
    refreshAct();

    // ═══ 规则说明（独立区块，带背景框）═══
    const ruleY = actY + actH + 52;
    const ruleH = 130;
    const rb = scene.add.graphics(); rb.fillStyle(0x101020, 0.5); rb.fillRoundedRect(lx, ruleY, ow - 60, ruleH, 8); rb.lineStyle(1, 0x334466, 0.4); rb.strokeRoundedRect(lx, ruleY, ow - 60, ruleH, 8); p.add(rb);
    p.add(scene.add.text(lx + 16, ruleY + 10, '竞技规则', { fontSize: '14px', color: '#aaccdd', fontStyle: 'bold', padding: { y: 2 } }));
    const rules = [
      '· 真人 vs 真人，不支持 AI 替代',
      '· 胜利 +25  /  失败 −25（积分归零为地板，不再继续降低）',
      '· 断线方判负；每 2 个月为一个赛季，跨赛季有奖励发放',
      '· 段位：青铜 → 白银 → 黄金 → 白金 → 钻石 → 王者',
    ];
    rules.forEach((r, i) => p.add(scene.add.text(lx + 16, ruleY + 34 + i * 24, r, { fontSize: '13px', color: '#8899bb', padding: { y: 2 } })));

    // 底部提示栏（与 B 面板一致）
    const fy = oy + oh - 28; const ft = scene.add.graphics(); ft.fillStyle(0x1a1a36, 0.8); ft.fillRoundedRect(ox + 4, fy, ow - 8, 24, { tl: 0, tr: 0, bl: 10, br: 10 }); p.add(ft);
    p.add(scene.add.text(GAME_WIDTH / 2, fy + 12, 'ESC 关闭', { fontSize: '11px', color: '#556688', padding: { y: 2 } }).setOrigin(0.5));
  }

  // ═══════════════════════════════════════════
  // 公会面板（J 键）— 非实时管理走 REST，实时聊天走 game 房
  // ═══════════════════════════════════════════

