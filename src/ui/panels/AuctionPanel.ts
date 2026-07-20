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


import { setupScroll } from './GuildPanel';

export let auctionPanelTab: 'market' | 'mine' | 'fav' | 'history' = 'market';
export let auctionCreating = false;
export let auctionCreateItem: any = null;
export let auctionFilter = { name: '', category: null as string | null, quality: null as string | null, sort: 'price_asc' as string };
export let auctionSelectedId: number | null = null;   // 当前选中挂单 → 右栏详情
export let auctionPage = 0;                            // 网格分页（DNF 式卡片网格）
export let auctionBody: Phaser.GameObjects.Container | null = null;
export let auctionCx = 0, auctionCy = 0;
export let auctionBodyInputs: (HTMLInputElement | HTMLTextAreaElement)[] = [];
export let auctionShellInputs: { el: HTMLInputElement | HTMLTextAreaElement; lx: number; ly: number; w: number; h: number }[] = [];
export let auctionSearchOpen = false;                       // 搜索框：默认收起，点「搜索」才弹出
export let auctionToolbar: Phaser.GameObjects.Container | null = null;

  // 面板尺寸（DNF 式三栏：左筛选 / 中卡片网格 / 右详情）
export const AUCTION_PW = 1280, AUCTION_PH = 860;
export const AUCTION_PAGE_SIZE = 12;                  // 4 列 × 3 行
  // Tab 视觉区分色（浏览=蓝 / 我的挂单=暖橙 / 收藏=紫粉 / 历史=灰青）
export const A_TAB_ACCENT: Record<string, { bg: number; border: number; text: string; glow: string }> = {
    market:  { bg: 0x223355, border: 0x5588cc, text: '#a8c8ff', glow: 'rgba(85,136,204,0.18)' },
    mine:    { bg: 0x332e20, border: 0xcc8844, text: '#ffcc88', glow: 'rgba(204,136,68,0.18)' },
    fav:     { bg: 0x2e2233, border: 0xaa66aa, text: '#ddaadd', glow: 'rgba(170,102,170,0.18)' },
    history: { bg: 0x22282e, border: 0x558899, text: '#99c4d4', glow: 'rgba(85,136,153,0.18)' },
  };
export const A_CAT: Record<string, string> = { equipment: '装备', consumable: '消耗品', material: '材料', title: '称号', quest: '任务', key: '钥匙', etc: '杂物' };
export const A_CAT_ORDER = ['equipment', 'consumable', 'material', 'title', 'quest', 'key', 'etc'];
export const A_CAT_ICON: Record<string, string> = { equipment: '装', consumable: '消', material: '材', title: '称', quest: '任', key: '钥', etc: '杂' };
export const A_QUAL: Record<string, string> = { white: '白', green: '绿', blue: '蓝', purple: '紫', gold: '金' };
export const A_QUAL_ORDER = [null, 'white', 'green', 'blue', 'purple', 'gold'] as (string | null)[];
export const A_QUAL_COLOR: Record<string, string> = { white: '#cfcfcf', green: '#7dd87d', blue: '#7da8ff', purple: '#c98dff', gold: '#ffd24a' };
export const A_SORT_LABEL: Record<string, string> = { price_asc: '价格↑', price_desc: '价格↓', recent: '最新' };
export const AUCTION_FEE_RATE = 0.05;

export function fmtNum(n: number): string { return (n || 0).toLocaleString('en-US'); }
export function hexNum(s: string): number { return parseInt(s.replace('#', ''), 16); }

export function parseAuctionItem(a: any): any {
    try { return typeof a.item_data === 'string' ? JSON.parse(a.item_data) : (a.item_data || {}); } catch { return {}; }
  }
export function auctionStatsLines(item: any): string[] {
    const lines: string[] = [];
    if (item && item.stats) for (const [k, v] of Object.entries(item.stats as Record<string, number>)) lines.push(`${k} +${v}`);
    if (item && item.enhanceLevel) lines.push(`强化 +${item.enhanceLevel}`);
    if (item && item.refineStats && item.refineStats.length) for (const r of item.refineStats) lines.push(`${r.key} +${r.value} (精炼)`);
    if (item && item.set) lines.push(`套装: ${item.set}`);
    return lines;
  }

  export function closeAuctionPanel(scene: GameScene): void {
    if (auctionToolbar) { auctionToolbar.destroy(true); auctionToolbar = null; }
    auctionBodyInputs.forEach(el => { try { if (el.parentNode) el.parentNode.removeChild(el); } catch {} });
    auctionBodyInputs = [];
    auctionShellInputs.forEach(it => { try { if (it.el.parentNode) it.el.parentNode.removeChild(it.el); } catch {} });
    auctionShellInputs = [];
    if (auctionBody) { auctionBody.destroy(true); auctionBody = null; }
    if (scene.auctionPanel) { scene.auctionPanel.destroy(true); scene.auctionPanel = null; scene.resumeFromMenu(); }
  }

  export function openAuctionPanel(scene: GameScene, reset = true): void {
    closeAuctionPanel(scene);
    scene.pauseForMenu();
    scene.auctionPanel = renderAuctionPanel(scene, reset);
  }

  export function toggleAuctionPanel(scene: GameScene): void {
    if (scene.auctionPanel) closeAuctionPanel(scene); else openAuctionPanel(scene, true);
  }

  /** auctionData 消息到达或操作后调用：仅重建列表区（不重建面板壳/不重复请求），避免闪烁与请求风暴。 */
  export function refreshAuctionPanel(scene: GameScene): void {
    if (scene.auctionPanel) renderAuctionBody(scene);
  }

export function reqAuctionTab(): void {
    if (auctionPanelTab === 'market') requestAuctionList({ ...auctionFilter });
    else if (auctionPanelTab === 'mine') requestAuctionMine();
    else if (auctionPanelTab === 'fav') requestAuctionFavList();
    else if (auctionPanelTab === 'history') requestAuctionHistory();
  }

  // 只重建列表区（auctionBody），不销毁整个面板壳——避免每次操作都 resumeFromMenu/pauseForMenu
  // 造成相机闪烁，也根除「重建时 scene.auctionPanel 短暂为 null → renderAuctionBody 直接 return」的时序 bug。
export function rebuildAuction(scene: GameScene): void {
    if (!scene.auctionPanel) { openAuctionPanel(scene); return; }
    renderAuctionBody(scene);
    if (!auctionCreating) reqAuctionTab();
  }

export function aBtn(scene: GameScene, c: Phaser.GameObjects.Container, lx: number, ly: number, label: string, color: number, textColor: string, cb: () => void): void {
    const bw = Math.max(48, label.length * 14 + 18), bh = 26;
    const g = scene.add.graphics();
    g.fillStyle(color, 0.92); g.fillRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6);
    g.lineStyle(1, 0xc9a96e, 0.5); g.strokeRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6);
    const t = scene.add.text(lx, ly, label, { padding: { x: 4, y: 4 }, fontSize: '12px', color: textColor, fontStyle: 'bold' }).setOrigin(0.5);
    const z = scene.add.zone(lx, ly, bw, bh).setInteractive({ useHandCursor: true });
    z.on('pointerover', () => { g.clear(); g.fillStyle(color, 1); g.fillRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6); });
    z.on('pointerout', () => { g.clear(); g.fillStyle(color, 0.92); g.fillRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6); });
    z.on('pointerdown', cb);
    c.add([g, t, z]);
  }

export function aToast(scene: GameScene, c: Phaser.GameObjects.Container, msg: string): void {
    const t = scene.add.text(0, -296, msg, { padding: { x: 4, y: 4 }, fontSize: '14px', color: '#ffcc88', fontStyle: 'bold' }).setOrigin(0.5);
    c.add(t);
    scene.time.delayedCall(1800, () => t.destroy());
  }

export function aPlaceShellInput(scene: GameScene, lx: number, ly: number, w = 200, h = 28, maxLen = 20, initial = ''): HTMLInputElement {
    const el = document.createElement('input');
    el.type = 'text'; el.maxLength = maxLen; el.value = initial;
    el.style.cssText = 'position:absolute;font-size:14px;color:#ddd;background:#0a0a1e;border:1px solid #446688;border-radius:5px;padding:4px 8px;outline:none;z-index:9999;';
    const canvas = scene.game.canvas; const rect = canvas.getBoundingClientRect();
    const sx = rect.width / GAME_WIDTH, sy = rect.height / GAME_HEIGHT;
    el.style.left = (rect.left + (auctionCx + lx) * sx - (w * sx) / 2) + 'px';
    el.style.top = (rect.top + (auctionCy + ly) * sy - (h * sy) / 2) + 'px';
    el.style.width = (w * sx) + 'px'; el.style.height = (h * sy) + 'px';
    document.body.appendChild(el); el.focus();
    auctionShellInputs.push({ el, lx, ly, w, h });
    return el;
  }

export function aPlaceBodyInput(scene: GameScene, lx: number, ly: number, w = 200, h = 28, maxLen = 20, initial = ''): HTMLInputElement {
    const el = document.createElement('input');
    el.type = 'text'; el.maxLength = maxLen; el.value = initial;
    el.style.cssText = 'position:absolute;font-size:14px;color:#ddd;background:#0a0a1e;border:1px solid #446688;border-radius:5px;padding:4px 8px;outline:none;z-index:9999;';
    const canvas = scene.game.canvas; const rect = canvas.getBoundingClientRect();
    const sx = rect.width / GAME_WIDTH, sy = rect.height / GAME_HEIGHT;
    el.style.left = (rect.left + (auctionCx + lx) * sx - (w * sx) / 2) + 'px';
    el.style.top = (rect.top + (auctionCy + ly) * sy - (h * sy) / 2) + 'px';
    el.style.width = (w * sx) + 'px'; el.style.height = (h * sy) + 'px';
    document.body.appendChild(el); el.focus();
    auctionBodyInputs.push(el);
    return el;
  }

  // ══ 动作（走 intent，服务端权威；操作后整面板重建以刷新列表） ══
export function auctionAct(scene: GameScene, msg: string, fn: () => void): void {
    fn();
    auctionSelectedId = null; auctionPage = 0;
    rebuildAuction(scene);
    if (scene.auctionPanel) aToast(scene, scene.auctionPanel, msg);
  }
export function onBuy(scene: GameScene, a: any): void {
    auctionAct(scene, '购买请求已发送…', () => requestAuctionBuy(a.id));
  }
export function onCancel(scene: GameScene, a: any): void {
    auctionAct(scene, '撤单请求已发送…', () => requestAuctionCancel(a.id));
  }
export function onFav(scene: GameScene, a: any): void {
    const on = !a.favorited;
    requestAuctionFav(a.id, on);
    const au = (GameState as any).auctionData;
    if (au && au.auctions) {
      const found = au.auctions.find((x: any) => x.id === a.id);
      if (found) found.favorited = on;
      if (!on && auctionPanelTab === 'fav') {
        au.auctions = au.auctions.filter((x: any) => x.id !== a.id);
        if (auctionSelectedId === a.id) auctionSelectedId = null;
      }
    }
    renderAuctionBody(scene);
    if (scene.auctionPanel) aToast(scene, scene.auctionPanel, on ? '已收藏' : '已取消收藏');
  }

  // Tab 按钮（DNF 式顶栏分页，每个 Tab 有独立主题色）
export function aTab(scene: GameScene, c: Phaser.GameObjects.Container, cx: number, cy: number, w: number, label: string, active: boolean, tabKey: string, cb: () => void): void {
    const h = 30;
    const accent = A_TAB_ACCENT[tabKey] || A_TAB_ACCENT.market;
    const g = scene.add.graphics();
    if (active) {
      g.fillStyle(accent.bg, 1); g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 8);
      g.lineStyle(1.5, accent.border, 0.95); g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 8);
      // 底部色条（2px 高亮线，DNF 风格选中指示）
      g.fillStyle(accent.border, 1); g.fillRect(cx - w / 2 + 8, cy + h / 2 - 2, w - 16, 2);
    } else {
      g.fillStyle(0x1a1a30, 0.9); g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 8);
      g.lineStyle(1, 0x33405e, 0.6); g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 8);
    }
    const t = scene.add.text(cx, cy, label, { padding: { x: 4, y: 4 }, fontSize: '14px', color: active ? accent.text : '#8899bb', fontStyle: active ? 'bold' : 'normal' }).setOrigin(0.5);
    const z = scene.add.zone(cx, cy, w, h).setInteractive({ useHandCursor: true });
    z.on('pointerover', () => { if (!active) { g.clear(); g.fillStyle(0x2a2a48, 1); g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 8); g.lineStyle(1, 0x445577, 0.8); g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 8); } });
    z.on('pointerout', () => { if (!active) { g.clear(); g.fillStyle(0x1a1a30, 0.9); g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 8); g.lineStyle(1, 0x33405e, 0.6); g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 8); } });
    z.on('pointerdown', cb);
    c.add([g, t, z]);
  }

  // 筛选变更：market 走服务端重拉；mine/fav 本地即时过滤
export function applyAuctionFilter(scene: GameScene): void {
    auctionPage = 0; auctionSelectedId = null;
    if (auctionPanelTab === 'market') reqAuctionTab();
    else renderAuctionBody(scene);
  }

  // 工具条（独立容器，可随搜索展开/收起重建）
export function renderAuctionToolbar(scene: GameScene): void {
    const c = scene.auctionPanel; if (!c) return;
    const PW = AUCTION_PW, PH = AUCTION_PH;
    const px = -PW / 2, py = -PH / 2;
    // 重建前移除旧搜索框 DOM（搜索框是唯一的 shell 输入）
    auctionShellInputs.forEach(it => { try { if (it.el.parentNode) it.el.parentNode.removeChild(it.el); } catch {} });
    auctionShellInputs = [];
    if (auctionToolbar) { auctionToolbar.destroy(true); auctionToolbar = null; }
    const bar = scene.add.container(0, 0); c.add(bar); auctionToolbar = bar;

    // 历史/上架态不显示工具条
    if (auctionPanelTab === 'history' || auctionCreating) return;

    const gridX = px + 208, gy = py + 128;
    // 「搜索」按钮：默认收起，点击展开/收起输入框（展开时高亮）
    aBtn(scene, bar, gridX + 56, gy, '🔍 搜索', auctionSearchOpen ? 0x33507a : 0x2a3a5a, auctionSearchOpen ? '#bcd4ff' : '#8899bb', () => {
      auctionSearchOpen = !auctionSearchOpen;
      renderAuctionToolbar(scene);
    });
    // 展开时：搜索输入框 + 「应用」按钮
    if (auctionSearchOpen) {
      const searchInput = aPlaceShellInput(scene, gridX + 280, gy, 240, 30, 20, auctionFilter.name);
      searchInput.placeholder = '物品名称';
      searchInput.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') { auctionFilter.name = searchInput.value.trim(); applyAuctionFilter(scene); } });
      aBtn(scene, bar, gridX + 450, gy, '应用', 0x33507a, '#bcd4ff', () => { auctionFilter.name = searchInput.value.trim(); applyAuctionFilter(scene); });
    }
    // 排序切换
    aBtn(scene, bar, gridX + 580, gy, '排序:' + A_SORT_LABEL[auctionFilter.sort], 0x2a3a5a, '#bcd4ff', () => {
      const order = ['price_asc', 'price_desc', 'recent'];
      auctionFilter.sort = order[(order.indexOf(auctionFilter.sort) + 1) % order.length];
      applyAuctionFilter(scene);
    });
    // 右侧：上架 / 刷新（置于面板右侧，远离居中 Tab，杜绝误触）
    aBtn(scene, bar, px + PW - 180, gy, '上架', 0x2a6e4a, '#cfeedd', () => { auctionCreating = true; rebuildAuction(scene); });
    aBtn(scene, bar, px + PW - 70, gy, '刷新', 0x444466, '#aaaacc', () => reqAuctionTab());
  }

  export function renderAuctionPanel(scene: GameScene, reset = true): Phaser.GameObjects.Container {
    if (reset) {
      auctionPanelTab = 'market'; auctionCreating = false; auctionCreateItem = null;
      auctionFilter = { name: '', category: null, quality: null, sort: 'price_asc' };
      auctionSelectedId = null; auctionPage = 0; auctionSearchOpen = false;
    }
    const cam = scene.cameras.main;
    auctionCx = Math.round(cam.scrollX) + GAME_WIDTH / 2;
    auctionCy = Math.round(cam.scrollY) + GAME_HEIGHT / 2;
    const c = scene.add.container(auctionCx, auctionCy).setDepth(500);
    // 关键：在 renderAuctionBody 之前即绑定引用，否则 renderAuctionBody 内 `if (!scene.auctionPanel) return`
    // 会因赋值时机（renderAuctionPanel 返回后才赋值）而直接 return，导致内容区空白（尤其上架模式无异步补渲染）。
    scene.auctionPanel = c;
    const PW = AUCTION_PW, PH = AUCTION_PH;
    const px = -PW / 2, py = -PH / 2;

    const ov = scene.add.graphics();
    ov.fillStyle(0, 0.55); ov.fillRect(-GAME_WIDTH / 2, -GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT);
    ov.setInteractive(new Phaser.Geom.Rectangle(-GAME_WIDTH / 2, -GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains);
    c.add(ov);

    const bg = scene.add.graphics();
    bg.fillStyle(0x121222, 0.98); bg.fillRoundedRect(px, py, PW, PH, 14);
    bg.lineStyle(2, 0xc9a96e, 0.7); bg.strokeRoundedRect(px, py, PW, PH, 14);
    c.add(bg);

    // 标题栏
    const tb = scene.add.graphics(); tb.fillStyle(0x1a1a36, 1); tb.fillRoundedRect(px + 2, py + 2, PW - 4, 54, { tl: 12, tr: 12, bl: 0, br: 0 }); c.add(tb);
    c.add(scene.add.text(px + 28, py + 28, '拍卖行', { padding: { x: 4, y: 4 }, fontSize: '22px', color: '#e8d5a3', fontStyle: 'bold' }).setOrigin(0, 0.5));
    c.add(scene.add.text(px + PW - 250, py + 28, `金币 ${fmtNum((GameState as any).gold || 0)}`, { padding: { x: 4, y: 4 }, fontSize: '15px', color: '#ffd24a', fontStyle: 'bold' }).setOrigin(0, 0.5));
    const close = scene.add.text(px + PW - 28, py + 28, '✕', { padding: { x: 4, y: 4 }, fontSize: '24px', color: '#aa6677', fontStyle: 'bold' }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
    close.on('pointerdown', () => closeAuctionPanel(scene));
    close.on('pointerover', () => close.setColor('#ff8899'));
    close.on('pointerout', () => close.setColor('#aa6677'));
    c.add(close);

    // 分隔线（标题 ↔ Tab）
    const dl1 = scene.add.graphics(); dl1.lineStyle(1, 0x33405e, 0.7); dl1.lineBetween(px + 12, py + 58, px + PW - 12, py + 58); c.add(dl1);

    // Tab 栏（DNF 顶栏分页，独立横向条，每 Tab 独立主题色）
    const tabs: [typeof auctionPanelTab, string][] = [['market', '浏览市场'], ['mine', '我的挂单'], ['fav', '收藏'], ['history', '历史']];
    const tabW = 156, tabGap = 10, tabTotal = tabs.length * tabW + (tabs.length - 1) * tabGap;
    const tabStartX = px + (PW - tabTotal) / 2 + tabW / 2;
    tabs.forEach(([t, label], i) => {
      const active = auctionPanelTab === t;
      aTab(scene, c, tabStartX + i * (tabW + tabGap), py + 80, tabW, label, active, t, () => {
        if (auctionPanelTab === t) return;
        auctionPanelTab = t; auctionCreating = false; auctionCreateItem = null; auctionSelectedId = null; auctionPage = 0;
        rebuildAuction(scene);
      });
    });

    // 分隔线（Tab ↔ 内容/工具条）
    const dl2 = scene.add.graphics(); dl2.lineStyle(1, 0x33405e, 0.7); dl2.lineBetween(px + 12, py + 106, px + PW - 12, py + 106); c.add(dl2);

    // 工具条（独立容器，可随搜索展开/收起重建；搜索框默认收起，点「搜索」才弹出）
    renderAuctionToolbar(scene);

    renderAuctionBody(scene);
    if (!auctionCreating) reqAuctionTab();

    // 面板壳输入框随窗口缩放重定位
    const reposition = (): void => {
      const canvas = scene.game.canvas; const rect = canvas.getBoundingClientRect();
      const sx = rect.width / GAME_WIDTH, sy = rect.height / GAME_HEIGHT;
      for (const it of auctionShellInputs) {
        it.el.style.left = (rect.left + (auctionCx + it.lx) * sx - (it.w * sx) / 2) + 'px';
        it.el.style.top = (rect.top + (auctionCy + it.ly) * sy - (it.h * sy) / 2) + 'px';
        it.el.style.width = (it.w * sx) + 'px'; it.el.style.height = (it.h * sy) + 'px';
      }
    };
    scene.scale.on('resize', reposition);
    c.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.scale.off('resize', reposition);
      auctionShellInputs.forEach(it => { try { if (it.el.parentNode) it.el.parentNode.removeChild(it.el); } catch {} });
      auctionShellInputs = [];
    });

    return c;
  }

export function renderAuctionBody(scene: GameScene): void {
    if (!scene.auctionPanel) return;
    // 销毁旧列表区（触发 setupScroll 的 DESTROY 清理滚轮/拖拽监听），再建新容器
    if (auctionBody) { auctionBody.destroy(true); auctionBody = null; }
    auctionBodyInputs.forEach(el => { try { if (el.parentNode) el.parentNode.removeChild(el); } catch {} });
    auctionBodyInputs = [];
    // 搜索框仅在展开态显示（默认收起），上架态一并隐藏
    const showShell = !auctionCreating && auctionSearchOpen;
    auctionShellInputs.forEach(it => { it.el.style.display = showShell ? '' : 'none'; });
    const c = scene.auctionPanel!;
    const body = scene.add.container(0, 0); c.add(body); auctionBody = body;

    if (auctionCreating) { renderCreate(scene, c, body); return; }
    if (auctionPanelTab === 'history') { renderHistoryList(scene, body); return; }

    // ══ Tab 主题色横幅（四 Tab 视觉区分核心）══
    const accent = A_TAB_ACCENT[auctionPanelTab] || A_TAB_ACCENT.market;
    const TAB_LABELS: Record<string, string> = { market: '🔍  市场浏览', mine: '📦  我的挂单', fav: '⭐  收藏夹', history: '📋  交易历史' };
    const bPx = -AUCTION_PW / 2, bPy = -AUCTION_PH / 2;
    const bannerY = bPy + 156;
    const banG = scene.add.graphics();
    banG.fillStyle(accent.bg, 0.6); banG.fillRoundedRect(bPx + 16, bannerY, AUCTION_PW - 32, 28, 6);
    banG.lineStyle(1, accent.border, 0.35); banG.strokeRoundedRect(bPx + 16, bannerY, AUCTION_PW - 32, 28, 6);
    // 左侧色条（3px 竖线标识当前 Tab）
    banG.fillStyle(accent.border, 0.8); banG.fillRect(bPx + 16, bannerY + 3, 3, 22);
    body.add(banG);
    body.add(scene.add.text(bPx + 28, bannerY + 14, TAB_LABELS[auctionPanelTab] || '', { padding: { x: 4, y: 4 }, fontSize: '14px', color: accent.text, fontStyle: 'bold' }).setOrigin(0, 0.5));

    // 三栏：左筛选 / 中卡片网格 / 右详情（从 banner 下方开始）
    renderSidebar(scene, body);
    renderGrid(scene, body);
    renderDetail(scene, body);
  }

  // 稀有度图标方块（分类字 + 品质色描边/外发光），用于卡片与详情
export function drawIconTile(scene: GameScene, parent: Phaser.GameObjects.Container, cx: number, cy: number, size: number, category: string, quality: string): void {
    const qc = A_QUAL_COLOR[quality] || '#cdd6e8';
    const col = hexNum(qc);
    const g = scene.add.graphics();
    g.fillStyle(0x000000, 0.32); g.fillRoundedRect(cx - size / 2, cy - size / 2, size, size, 10);
    g.lineStyle(3, col, 0.95); g.strokeRoundedRect(cx - size / 2, cy - size / 2, size, size, 10);
    g.lineStyle(8, col, 0.16); g.strokeRoundedRect(cx - size / 2, cy - size / 2, size, size, 10);
    parent.add(g);
    const icon = A_CAT_ICON[category] || '·';
    parent.add(scene.add.text(cx, cy, icon, { padding: { x: 4, y: 4 }, fontSize: Math.round(size * 0.46) + 'px', color: qc, fontStyle: 'bold' }).setOrigin(0.5));
  }

  // 物品卡片（DNF 式：图标 + 名 + 价格，稀有度边框发光）
export function aCard(scene: GameScene, parent: Phaser.GameObjects.Container, x: number, y: number, w: number, h: number, a: any, selected: boolean, onClick: () => void): void {
    const qc = A_QUAL_COLOR[a.quality] || '#cdd6e8';
    const col = hexNum(qc);
    const g = scene.add.graphics();
    g.fillStyle(selected ? 0x23233f : 0x16162a, selected ? 1 : 0.92); g.fillRoundedRect(x, y, w, h, 10);
    g.lineStyle(selected ? 2.5 : 1.5, col, selected ? 1 : 0.7); g.strokeRoundedRect(x, y, w, h, 10);
    if (selected) { g.lineStyle(7, col, 0.16); g.strokeRoundedRect(x, y, w, h, 10); }
    parent.add(g);
    const iconSz = Math.min(56, w * 0.3);
    drawIconTile(scene, parent, x + w / 2, y + 46, iconSz, a.category, a.quality);
    // 物品名：wordWrap 宽度留足内边距，防止长名截断
    const nameWrapW = w - 16;
    parent.add(scene.add.text(x + w / 2, y + 90, a.item_name, { padding: { x: 4, y: 4 }, fontSize: '13px', color: qc, fontStyle: 'bold', align: 'center', wordWrap: { width: nameWrapW } }).setOrigin(0.5, 0.5));
    parent.add(scene.add.text(x + w / 2, y + h - 22, `${fmtNum(a.price)} 金`, { padding: { x: 4, y: 4 }, fontSize: '14px', color: '#ffd24a', fontStyle: 'bold' }).setOrigin(0.5));
    const z = scene.add.zone(x + w / 2, y + h / 2, w, h).setInteractive({ useHandCursor: true });
    z.on('pointerdown', onClick);
    parent.add(z);
  }

  // 侧栏筛选行
export function aSideRow(scene: GameScene, parent: Phaser.GameObjects.Container, x: number, y: number, w: number, label: string, active: boolean, cb: () => void): void {
    const h = 28;
    const g = scene.add.graphics();
    g.fillStyle(active ? 0x33507a : 0x16162a, active ? 0.95 : 0.55); g.fillRoundedRect(x, y, w, h, 6);
    if (active) { g.fillStyle(0x9fc0ff, 1); g.fillRoundedRect(x, y, 4, h, 2); }
    g.lineStyle(1, active ? 0x9fc0ff : 0x2a3450, active ? 0.8 : 0.5); g.strokeRoundedRect(x, y, w, h, 6);
    const t = scene.add.text(x + 14, y + h / 2, label, { padding: { x: 4, y: 4 }, fontSize: '13px', color: active ? '#dceaff' : '#9fb0d0' }).setOrigin(0, 0.5);
    const z = scene.add.zone(x + w / 2, y + h / 2, w, h).setInteractive({ useHandCursor: true });
    z.on('pointerover', () => { if (!active) { g.clear(); g.fillStyle(0x222238, 0.9); g.fillRoundedRect(x, y, w, h, 6); g.lineStyle(1, 0x3a4a6a, 0.8); g.strokeRoundedRect(x, y, w, h, 6); } });
    z.on('pointerout', () => { if (!active) { g.clear(); g.fillStyle(0x16162a, 0.55); g.fillRoundedRect(x, y, w, h, 6); g.lineStyle(1, 0x2a3450, 0.5); g.strokeRoundedRect(x, y, w, h, 6); } });
    z.on('pointerdown', cb);
    parent.add([g, t, z]);
  }

  // ══ 左栏：分类 + 稀有度筛选 ══
export function renderSidebar(scene: GameScene, body: Phaser.GameObjects.Container): void {
    const PW = AUCTION_PW, px = -PW / 2, py = -AUCTION_PH / 2;
    const sx = px + 16, sy = py + 184, sw = 176;
    const sh = (py + AUCTION_PH - 16) - sy;
    const accent = A_TAB_ACCENT[auctionPanelTab] || A_TAB_ACCENT.market;
    const g = scene.add.graphics(); g.fillStyle(0x0e0e1c, 0.6); g.fillRoundedRect(sx, sy, sw, sh, 10); g.lineStyle(1, accent.border, 0.4); g.strokeRoundedRect(sx, sy, sw, sh, 10); body.add(g);
    body.add(scene.add.text(sx + 14, sy + 16, '分类', { padding: { x: 4, y: 4 }, fontSize: '13px', color: accent.text, fontStyle: 'bold' }).setOrigin(0, 0.5));
    const cats: (string | null)[] = [null, ...A_CAT_ORDER];
    cats.forEach((cat, i) => {
      const label = cat ? (A_CAT[cat] || cat) : '全部';
      aSideRow(scene, body, sx + 8, sy + 34 + i * 28, sw - 16, label, auctionFilter.category === cat, () => { auctionFilter.category = cat; applyAuctionFilter(scene); });
    });
    const rLabelY = sy + 34 + cats.length * 28 + 10;
    body.add(scene.add.text(sx + 14, rLabelY, '稀有度', { padding: { x: 4, y: 4 }, fontSize: '13px', color: accent.text, fontStyle: 'bold' }).setOrigin(0, 0.5));
    A_QUAL_ORDER.forEach((q, i) => {
      const label = q ? (A_QUAL[q] || q) : '全部';
      aSideRow(scene, body, sx + 8, rLabelY + 20 + i * 28, sw - 16, label, auctionFilter.quality === q, () => { auctionFilter.quality = q; applyAuctionFilter(scene); });
    });
  }

  // ══ 中栏：物品卡片网格（4×3，分页）══
export function renderGrid(scene: GameScene, body: Phaser.GameObjects.Container): void {
    const PW = AUCTION_PW, px = -PW / 2, py = -AUCTION_PH / 2;
    const gridX = px + 208, gridTop = py + 184, cardW = 190, cardH = 156, gapX = 14, gapY = 12, cols = 4;
    let list = (GameState.auctionData && (GameState.auctionData as any).auctions) || [];
    if (auctionPanelTab !== 'market') {
      const nm = (auctionFilter.name || '').toLowerCase();
      list = list.filter((a: any) => (!auctionFilter.category || a.category === auctionFilter.category) && (!auctionFilter.quality || a.quality === auctionFilter.quality) && (!nm || (a.item_name || '').toLowerCase().includes(nm)));
      const o = auctionFilter.sort;
      list = [...list].sort((a: any, b: any) => o === 'price_desc' ? b.price - a.price : o === 'recent' ? (b.id - a.id) : a.price - b.price);
    }
    if (!GameState.auctionData) { body.add(scene.add.text(gridX + 392, gridTop + 156, '加载中…', { padding: { x: 4, y: 4 }, fontSize: '16px', color: '#8899bb' }).setOrigin(0.5)); return; }
    const accent = A_TAB_ACCENT[auctionPanelTab] || A_TAB_ACCENT.market;
    const emptyMsg = auctionPanelTab === 'mine' ? '你还没有在售挂单' : auctionPanelTab === 'fav' ? '你还没有收藏任何挂单' : '暂无在售物品，去「上架」挂点东西吧';
    if (list.length === 0) { body.add(scene.add.text(gridX + 392, gridTop + 156, emptyMsg, { padding: { x: 4, y: 4 }, fontSize: '15px', color: accent.text }).setOrigin(0.5)); return; }
    const pages = Math.max(1, Math.ceil(list.length / AUCTION_PAGE_SIZE));
    auctionPage = Phaser.Math.Clamp(auctionPage, 0, pages - 1);
    const start = auctionPage * AUCTION_PAGE_SIZE;
    const pageItems = list.slice(start, start + AUCTION_PAGE_SIZE);
    pageItems.forEach((a: any, idx: number) => {
      const col = idx % cols, row = Math.floor(idx / cols);
      const x = gridX + col * (cardW + gapX);
      const y = gridTop + row * (cardH + gapY);
      aCard(scene, body, x, y, cardW, cardH, a, auctionSelectedId === a.id, () => { auctionSelectedId = a.id; renderAuctionBody(scene); });
    });
    // 分页
    const pgY = gridTop + 3 * cardH + 2 * gapY + 22;
    aBtn(scene, body, gridX + 70, pgY, '上一页', 0x2a3a5a, auctionPage > 0 ? '#bcd4ff' : '#556677', () => { if (auctionPage > 0) { auctionPage--; renderAuctionBody(scene); } });
    body.add(scene.add.text(gridX + 392, pgY, `第 ${auctionPage + 1} / ${pages} 页`, { padding: { x: 4, y: 4 }, fontSize: '13px', color: '#aabbcc' }).setOrigin(0.5));
    aBtn(scene, body, gridX + 714, pgY, '下一页', 0x2a3a5a, auctionPage < pages - 1 ? '#bcd4ff' : '#556677', () => { if (auctionPage < pages - 1) { auctionPage++; renderAuctionBody(scene); } });
  }

  // ══ 右栏：选中物品详情 ══
export function renderDetail(scene: GameScene, body: Phaser.GameObjects.Container): void {
    const PW = AUCTION_PW, px = -PW / 2, py = -AUCTION_PH / 2;
    const dx = px + PW - 264, dy = py + 184, dw = 248, dh = (py + AUCTION_PH - 16) - dy;
    const accent = A_TAB_ACCENT[auctionPanelTab] || A_TAB_ACCENT.market;
    const g = scene.add.graphics(); g.fillStyle(0x0e0e1c, 0.6); g.fillRoundedRect(dx, dy, dw, dh, 10); g.lineStyle(1, accent.border, 0.4); g.strokeRoundedRect(dx, dy, dw, dh, 10); body.add(g);
    body.add(scene.add.text(dx + 14, dy + 16, '物品详情', { padding: { x: 4, y: 4 }, fontSize: '14px', color: accent.text, fontStyle: 'bold' }).setOrigin(0, 0.5));
    const list = (GameState.auctionData && (GameState.auctionData as any).auctions) || [];
    const a = list.find((x: any) => x.id === auctionSelectedId);
    if (!a) { body.add(scene.add.text(dx + dw / 2, dy + dh / 2, '选择左侧物品\n查看详情', { padding: { x: 4, y: 4 }, fontSize: '14px', color: accent.text, align: 'center' }).setOrigin(0.5)); return; }
    const item = parseAuctionItem(a);
    drawIconTile(scene, body, dx + dw / 2, dy + 92, 76, a.category, a.quality);
    body.add(scene.add.text(dx + dw / 2, dy + 150, a.item_name, { padding: { x: 4, y: 4 }, fontSize: '15px', color: A_QUAL_COLOR[a.quality] || '#cdd6e8', fontStyle: 'bold', align: 'center', wordWrap: { width: dw - 20 } }).setOrigin(0.5, 0));
    body.add(scene.add.text(dx + dw / 2, dy + 178, `${A_CAT[a.category] || a.category} · ${A_QUAL[a.quality] || a.quality}`, { padding: { x: 4, y: 4 }, fontSize: '12px', color: '#99aabb', align: 'center' }).setOrigin(0.5, 0));
    let yy = dy + 204;
    if (item.desc) { body.add(scene.add.text(dx + 16, yy, item.desc, { padding: { x: 4, y: 4 }, fontSize: '11px', color: '#7788aa', wordWrap: { width: dw - 32 } }).setOrigin(0, 0)); yy += 24; }
    const lines = auctionStatsLines(item);
    if (lines.length) {
      body.add(scene.add.text(dx + 16, yy, '属性', { padding: { x: 4, y: 4 }, fontSize: '12px', color: '#9fb0d0', fontStyle: 'bold' }).setOrigin(0, 0)); yy += 18;
      for (const ln of lines) { body.add(scene.add.text(dx + 18, yy, ln, { padding: { x: 4, y: 4 }, fontSize: '12px', color: '#cdd6e8' }).setOrigin(0, 0)); yy += 18; }
    }
    const isMine = auctionPanelTab === 'mine';
    body.add(scene.add.text(dx + 16, dy + dh - 150, `数量  ×${a.quantity}`, { padding: { x: 4, y: 4 }, fontSize: '13px', color: '#aabbcc' }).setOrigin(0, 0));
    body.add(scene.add.text(dx + 16, dy + dh - 122, `单价  ${fmtNum(a.price)} 金`, { padding: { x: 4, y: 4 }, fontSize: '15px', color: '#ffd24a', fontStyle: 'bold' }).setOrigin(0, 0));
    body.add(scene.add.text(dx + 16, dy + dh - 94, `卖家  ${a.seller_name || '—'}`, { padding: { x: 4, y: 4 }, fontSize: '12px', color: '#99aabb' }).setOrigin(0, 0));
    if (isMine) aBtn(scene, body, dx + dw / 2 - 58, dy + dh - 40, '撤单', 0x6a4a2a, '#ffd9a0', () => onCancel(scene, a));
    else aBtn(scene, body, dx + dw / 2 - 58, dy + dh - 40, '购买', 0x2a6e4a, '#cfeedd', () => onBuy(scene, a));
    aBtn(scene, body, dx + dw / 2 + 58, dy + dh - 40, a.favorited ? '★' : '☆', 0x33507a, '#bcd4ff', () => onFav(scene, a));
  }

export function renderHistoryList(scene: GameScene, body: Phaser.GameObjects.Container): void {
    const PW = AUCTION_PW, px = -PW / 2, py = -AUCTION_PH / 2;
    const accent = A_TAB_ACCENT.history;
    // 历史主题横幅
    const bannerY = py + 156;
    const banG = scene.add.graphics();
    banG.fillStyle(accent.bg, 0.6); banG.fillRoundedRect(px + 16, bannerY, PW - 32, 28, 6);
    banG.lineStyle(1, accent.border, 0.35); banG.strokeRoundedRect(px + 16, bannerY, PW - 32, 28, 6);
    banG.fillStyle(accent.border, 0.8); banG.fillRect(px + 16, bannerY + 3, 3, 22);
    body.add(banG);
    body.add(scene.add.text(px + 28, bannerY + 14, '📋  交易记录', { padding: { x: 4, y: 4 }, fontSize: '14px', color: accent.text, fontStyle: 'bold' }).setOrigin(0, 0.5));

    if (!GameState.auctionData) { body.add(scene.add.text(0, py + 380, '加载中…', { padding: { x: 4, y: 4 }, fontSize: '16px', color: '#8899bb' }).setOrigin(0.5)); return; }
    const hist = (GameState.auctionData as any).history || [];
    if (hist.length === 0) { body.add(scene.add.text(0, py + 380, '暂无交易记录', { padding: { x: 4, y: 4 }, fontSize: '15px', color: accent.text, fontStyle: 'bold' }).setOrigin(0.5)); return; }
    const hdrY = py + 196;
    body.add(scene.add.text(px + 60, hdrY, '物品', { padding: { x: 4, y: 4 }, fontSize: '12px', color: '#667788' }).setOrigin(0, 0.5));
    body.add(scene.add.text(px + 420, hdrY, '类型', { padding: { x: 4, y: 4 }, fontSize: '12px', color: '#667788' }).setOrigin(0, 0.5));
    body.add(scene.add.text(px + 580, hdrY, '价格', { padding: { x: 4, y: 4 }, fontSize: '12px', color: '#667788' }).setOrigin(0, 0.5));
    body.add(scene.add.text(px + 760, hdrY, '对方', { padding: { x: 4, y: 4 }, fontSize: '12px', color: '#667788' }).setOrigin(0, 0.5));
    body.add(scene.add.text(px + 980, hdrY, '时间', { padding: { x: 4, y: 4 }, fontSize: '12px', color: '#667788' }).setOrigin(0, 0.5));
    const vpTop = py + 214, vpBottom = py + AUCTION_PH - 16;
    setupScroll(scene, body, auctionCx, auctionCy, hist, 34, vpTop, vpBottom, px + 40, PW - 80,
      (h: any, i: number, ry: number, sc: Phaser.GameObjects.Container, _btnS: any) => {
        if (i % 2 === 0) { const rb = scene.add.graphics(); rb.fillStyle(0x1a1a2e, 0.35); rb.fillRoundedRect(px + 40, ry - 12, PW - 80, 28, 4); sc.add(rb); }
        const kindLabel = h.kind === 'sold' ? '售出' : h.kind === 'bought' ? '购入' : '撤单';
        const kindColor = h.kind === 'sold' ? '#9fe6a0' : h.kind === 'bought' ? '#ffd24a' : '#aa6677';
        const other = h.kind === 'sold' ? ('给 #' + h.buyer_char_id) : h.kind === 'bought' ? ('自 #' + h.seller_char_id) : '—';
        const time = (h.created_at || '').replace('T', ' ').slice(0, 16);
        sc.add(scene.add.text(px + 60, ry, h.item_name, { padding: { x: 4, y: 4 }, fontSize: '13px', color: '#cdd6e8' }).setOrigin(0, 0.5));
        sc.add(scene.add.text(px + 420, ry, kindLabel, { padding: { x: 4, y: 4 }, fontSize: '12px', color: kindColor }).setOrigin(0, 0.5));
        sc.add(scene.add.text(px + 580, ry, `${h.price} 金`, { padding: { x: 4, y: 4 }, fontSize: '12px', color: '#ffd24a' }).setOrigin(0, 0.5));
        sc.add(scene.add.text(px + 760, ry, other, { padding: { x: 4, y: 4 }, fontSize: '11px', color: '#99aabb' }).setOrigin(0, 0.5));
        sc.add(scene.add.text(px + 980, ry, time, { padding: { x: 4, y: 4 }, fontSize: '11px', color: '#7788aa' }).setOrigin(0, 0.5));
      });
  }

export function renderCreate(scene: GameScene, c: Phaser.GameObjects.Container, body: Phaser.GameObjects.Container): void {
    const PW = AUCTION_PW, px = -PW / 2, py = -AUCTION_PH / 2;
    // 遮罩（盖住背后网格/侧栏，形成模态）
    const dim = scene.add.graphics(); dim.fillStyle(0, 0.55); dim.fillRoundedRect(px + 8, py + 156, PW - 16, AUCTION_PH - 156 - 16, 10); body.add(dim);
    const bw = 860, bh = AUCTION_PH - 168 - 16, bx = px + (PW - bw) / 2, by = py + 168;
    const g = scene.add.graphics(); g.fillStyle(0x14142a, 0.99); g.fillRoundedRect(bx, by, bw, bh, 12); g.lineStyle(2, 0xc9a96e, 0.7); g.strokeRoundedRect(bx, by, bw, bh, 12); body.add(g);
    body.add(scene.add.text(bx + bw / 2, by + 28, '上架物品', { padding: { x: 4, y: 4 }, fontSize: '20px', color: '#e8d5a3', fontStyle: 'bold' }).setOrigin(0.5));
    aBtn(scene, body, bx + bw - 64, by + 28, '✕', 0x6a2a2a, '#ffb0b0', () => { auctionCreating = false; rebuildAuction(scene); });
    if (!auctionCreateItem) {
      const items = Inventory.items.filter(it => it.quantity > 0);
      if (items.length === 0) { body.add(scene.add.text(bx + bw / 2, by + bh / 2, '背包为空，无可上架物品', { padding: { x: 4, y: 4 }, fontSize: '15px', color: '#667788' }).setOrigin(0.5)); return; }
      body.add(scene.add.text(bx + 24, by + 56, `选择要上架的物品（共 ${items.length} 件）：`, { padding: { x: 4, y: 4 }, fontSize: '14px', color: '#8899bb' }).setOrigin(0, 0.5));
      setupScroll(scene, body, auctionCx, auctionCy, items, 36, by + 86, by + bh - 20, bx + 24, bw - 48,
        (it: any, i: number, ry: number, sc: Phaser.GameObjects.Container, btnS: any) => {
          if (i % 2 === 0) { const rb = scene.add.graphics(); rb.fillStyle(0x1a1a2e, 0.35); rb.fillRoundedRect(bx + 24, ry - 14, bw - 48, 30, 4); sc.add(rb); }
          const qc = A_QUAL_COLOR[it.quality] || '#cdd6e8';
          sc.add(scene.add.text(bx + 36, ry, it.name, { padding: { x: 4, y: 4 }, fontSize: '14px', color: qc, fontStyle: 'bold' }).setOrigin(0, 0.5));
          sc.add(scene.add.text(bx + 400, ry, A_CAT[it.type] || it.type || '—', { padding: { x: 4, y: 4 }, fontSize: '12px', color: '#99aabb' }).setOrigin(0, 0.5));
          sc.add(scene.add.text(bx + 520, ry, `×${it.quantity}`, { padding: { x: 4, y: 4 }, fontSize: '12px', color: '#aabbcc' }).setOrigin(0, 0.5));
          btnS(bx + bw - 90, ry, '选择', 0x33507a, '#bcd4ff', () => { auctionCreateItem = it; rebuildAuction(scene); });
        });
    } else {
      const it = auctionCreateItem;
      const detail = `${it.name}（${A_CAT[it.type] || it.type} · ${A_QUAL[it.quality || 'white'] || it.quality || '—'}）`;
      drawIconTile(scene, body, bx + 100, by + 124, 76, it.type, it.quality);
      body.add(scene.add.text(bx + 160, by + 108, '上架：' + detail, { padding: { x: 4, y: 4 }, fontSize: '15px', color: '#e8d5a3', wordWrap: { width: bw - 200 } }).setOrigin(0, 0.5));
      body.add(scene.add.text(bx + 50, by + 210, '数量', { padding: { x: 4, y: 4 }, fontSize: '14px', color: '#8899bb' }).setOrigin(0, 0.5));
      const qtyInput = aPlaceBodyInput(scene, bx + 120, by + 210, 120, 30, 4, '1');
      body.add(scene.add.text(bx + 255, by + 210, `（上限 ${it.quantity}）`, { padding: { x: 4, y: 4 }, fontSize: '12px', color: '#556677' }).setOrigin(0, 0.5));
      body.add(scene.add.text(bx + 50, by + 264, '单价(金)', { padding: { x: 4, y: 4 }, fontSize: '14px', color: '#8899bb' }).setOrigin(0, 0.5));
      const priceInput = aPlaceBodyInput(scene, bx + 120, by + 264, 160, 30, 9, '');
      body.add(scene.add.text(bx + 295, by + 264, `（成交收取 ${Math.round(AUCTION_FEE_RATE * 100)}% 手续费）`, { padding: { x: 4, y: 4 }, fontSize: '12px', color: '#556677' }).setOrigin(0, 0.5));
      aBtn(scene, body, bx + 130, by + 340, '确认上架', 0x2a6e4a, '#cfeedd', () => {
        const qty = Math.max(1, Math.min(it.quantity, parseInt(qtyInput.value, 10) || 1));
        const price = parseInt(priceInput.value, 10) || 0;
        if (price <= 0) { aToast(scene, c, '请输入有效单价'); return; }
        requestAuctionCreate(it.id, qty, price);
        aToast(scene, c, '上架请求已发送…');
        auctionCreating = false; auctionCreateItem = null; auctionPanelTab = 'mine';
        rebuildAuction(scene);
      });
      aBtn(scene, body, bx + 260, by + 320, '返回', 0x444466, '#aaaacc', () => { auctionCreateItem = null; rebuildAuction(scene); });
    }
  }

// ══════════════════════════════════════════════════
//  灵宠面板（U 键）— 查看 / 出战 / 收回 / 放生 + 光环预览
// ══════════════════════════════════════════════════
