import type { GameScene } from '../scenes/GameScene';
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, ZANPAKUTO_GROWTH } from '../config';
import { GameState } from '../systems/GameState';
import { GuildClient } from '../systems/GuildClient';
import { FriendClient } from '../systems/FriendClient';
import { GUILD_SKILLS, guildSkillCost } from '../systems/GuildSkills';
import { SaveManager } from '../systems/SaveManager';
import { NAMED_ENEMIES, BESTIARY_TIERS, getBestiaryTierReached, getBestiaryTierProgress, BESTIARY_TITLES } from '../systems/BestiaryData';
import { expForLevel } from '../systems/BattleData';
import { Inventory, EquipSlot, Item } from '../systems/Inventory';
import { listSetProgress, setShortName } from '../systems/SetSystem';
import { applyConsumable, getConsumableEffect } from '../systems/ConsumableSystem';
import { createPlayerStatus } from '../systems/StatusSystem';
import { MAIN_QUESTS, MAIN_QUEST_ORDER, SIDE_QUESTS, getQuestDef, rollDailyPool, rollWeeklyPool, DAILY_CAP, WEEKLY_CAP } from '../systems/QuestData';
import { SHIKAI_SKILLS, ZANPAKUTO_ELEMENT } from '../systems/Skills';
import { Kido, KIDO_NODES, KidoSchool, TIER_LOCK } from '../systems/Kido';
import {
  getEnhanceRate, getEnhanceCost, doEnhance,
  getRefineMaxSlots, getRefineCost, doRefine, doRefineReset, getRefineDisplay,
  getDecompReturn, doDecompose,
  getEnhanceLabel, getEnhanceGlow,
} from '../systems/EnhanceSystem';
import {
  requestBuy, requestEquip, requestUnequip, requestCraft, requestEnhance, requestRefine, requestDecompose, requestRefineReset, requestClaimQuest, requestAllocateStat, requestMallBuy, requestRespec,
  requestUnlock, requestSetZanpakuto, requestKidoSetSchool, requestKidoAllocate, requestClaimBestiaryTier, requestSetTitle, isOnline,
  requestArenaQueue, requestArenaCancel, requestArenaStatus, arena, tierNameById, ARENA_WEEKLY_CAP_CLIENT,
  requestGuildShopBuy,
  requestAuctionList, requestAuctionMine, requestAuctionFavList, requestAuctionHistory,
  requestAuctionFav, requestAuctionCreate, requestAuctionBuy, requestAuctionCancel,
} from '../systems/WorldClient';
import { GUILD_SHOP_ITEMS } from '../systems/GuildShop';

// ═══════════════════════════════════════════
// UI 面板（从 GameScene 抽取，scene 为 GameScene 实例）
// ═══════════════════════════════════════════

/**
 * 装备强化光效（+8 冰蓝 / +9 橙 / +10 金）。
 * 在卡片描边外侧叠加独立发光层并轻微呼吸脉冲；发光层与卡片本体分离，
 * 不被 hover 重绘清掉；面板容器销毁时自动清理 tween，避免泄漏。
 */
function addEnhanceGlow(
  scene: GameScene,
  container: Phaser.GameObjects.Container,
  base: Phaser.GameObjects.Graphics,
  x: number, y: number, w: number, h: number,
  item: Item, radius = 6,
): void {
  const glow = getEnhanceGlow(item);
  if (!glow) return;
  const g = scene.add.graphics();
  // 外柔光：宽描边低透明
  g.lineStyle(7, glow.color, glow.intensity * 0.22);
  g.strokeRoundedRect(x - 2, y - 2, w + 4, h + 4, radius + 2);
  // 内高亮：细描边
  g.lineStyle(2, glow.color, Math.min(1, glow.intensity * 0.9));
  g.strokeRoundedRect(x, y, w, h, radius);
  // 插到卡片本体之后、文字之前，保证发光在文字下方
  container.addAt(g, container.list.indexOf(base) + 1);
  const tw = scene.tweens.add({
    targets: g, alpha: { from: 0.5, to: 1 },
    duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
  });
  container.once('destroy', () => { scene.tweens.remove(tw); });
}

export function showNamingInput(scene: GameScene): void {
    scene.namingPanelActive = true;
    const panel = scene.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60).setDepth(400).setScrollFactor(0);
    const bg = scene.add.graphics();
    bg.fillStyle(0x121222, 0.98); bg.fillRoundedRect(-300, -100, 600, 200, 12);
    bg.lineStyle(2, 0x4a5a8a, 0.6); bg.strokeRoundedRect(-300, -100, 600, 200, 12);
    panel.add(bg);
    panel.add(scene.add.text(0, -70, '输入你的名字', { fontSize: '20px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));

    // 使用原生HTML input支持中文输入
    const inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.maxLength = 12;
    inputEl.style.cssText = 'position:absolute;width:360px;height:36px;font-size:18px;color:#ffffff;background:#0a0a1e;border:1px solid #446688;border-radius:4px;text-align:center;outline:none;z-index:9999;';
    const canvas = scene.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / GAME_WIDTH;
    const scaleY = rect.height / GAME_HEIGHT;
    inputEl.style.left = (rect.left + rect.width / 2 - 180 * scaleX) + 'px';
    inputEl.style.top = (rect.top + (GAME_HEIGHT / 2 - 80) * scaleY) + 'px';
    inputEl.style.width = (360 * scaleX) + 'px';
    inputEl.style.height = (36 * scaleY) + 'px';
    document.body.appendChild(inputEl);
    inputEl.focus();

    panel.add(scene.add.text(0, 12, '（输入名字后点击确认）', { fontSize: '11px', color: '#667788', padding: { y: 1 } }).setOrigin(0.5));

    const cleanup = () => {
      if (inputEl.parentNode) inputEl.parentNode.removeChild(inputEl);
      scene.namingPanelActive = false;
    };

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doConfirm(); }
    });

    const doConfirm = () => {
      const name = inputEl.value.trim() || '隐世';
      cleanup();
      GameState.playerName = name;
      GameState.hasCreated = true;
      panel.destroy(true);
      scene.time.delayedCall(300, () => {
        scene.isInDialogue = true;
        scene.dialogueBox.show({
          speaker: '浦原喜助',
          text: `${name}……好名字。你的灵魂中寄宿着一种元素之力——火、风、水、土。选择你的元素共鸣吧。`
        }, () => { scene.isInDialogue = false; showElementSelection(scene); });
      });
    };

    const confirm = scene.add.text(0, 50, '[ 确认 ]', {
      fontSize: '16px', color: '#88cc88', fontStyle: 'bold', padding: { x: 24, y: 8 },
      backgroundColor: '#11221188',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    confirm.on('pointerover', () => { confirm.setColor('#aaffaa'); confirm.setBackgroundColor('#224422aa'); });
    confirm.on('pointerout', () => { confirm.setColor('#88cc88'); confirm.setBackgroundColor('#11221188'); });
    confirm.on('pointerdown', () => doConfirm());
    panel.add(confirm);
  }

export function showElementSelection(scene: GameScene): void {
    scene.isInDialogue = true;
    const elements = ['\u706b', '\u98ce', '\u6c34', '\u571f'];
    const colors: Record<string, string> = { '\u706b': '#ff6644', '\u98ce': '#44cc88', '\u6c34': '#4488ff', '\u571f': '#cc9944' };
    const desc: Record<string, string> = { '\u706b': '\u5f3a\u653b\u578b\uff0cATK+10%', '\u98ce': '\u654f\u6377\u578b\uff0cSPD+10%', '\u6c34': '\u5747\u8861\u578b\uff0cHP+5% MP+5%', '\u571f': '\u9632\u5fa1\u578b\uff0cDEF+10%' };
    const panel = scene.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 30).setDepth(400).setScrollFactor(0);
    const bg = scene.add.graphics();
    bg.fillStyle(0x1a1a2e, 0.95); bg.fillRoundedRect(-250, -100, 500, 200, 10);
    bg.lineStyle(2, 0xc9a96e, 0.7); bg.strokeRoundedRect(-250, -100, 500, 200, 10);
    panel.add(bg);
    panel.add(scene.add.text(0, -70, '选择你的元素共鸣', { fontSize: '20px', color: '#ffe8b0', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));
    elements.forEach((el, i) => {
      const ex = -180 + i * 120;
      const card = scene.add.graphics();
      card.fillStyle(parseInt(colors[el].replace('#', ''), 16), 0.2); card.fillRoundedRect(ex - 45, -25, 90, 80, 6);
      card.lineStyle(2, parseInt(colors[el].replace('#', ''), 16), 0.6); card.strokeRoundedRect(ex - 45, -25, 90, 80, 6);
      panel.add(card);
      panel.add(scene.add.text(ex, -15, el, { fontSize: '22px', color: colors[el], fontStyle: 'bold', padding: { y: 2 } }).setOrigin(0.5));
      panel.add(scene.add.text(ex, 10, desc[el], { fontSize: '9px', color: '#aaaacc', wordWrap: { width: 80 }, padding: { y: 1 } }).setOrigin(0.5));
      card.setInteractive(new Phaser.Geom.Rectangle(ex - 45, -25, 90, 80), Phaser.Geom.Rectangle.Contains);
      card.on('pointerover', () => { card.clear(); card.fillStyle(parseInt(colors[el].replace('#', ''), 16), 0.4); card.fillRoundedRect(ex - 45, -25, 90, 80, 6); card.lineStyle(2, parseInt(colors[el].replace('#', ''), 16), 0.9); card.strokeRoundedRect(ex - 45, -25, 90, 80, 6); });
      card.on('pointerout', () => { card.clear(); card.fillStyle(parseInt(colors[el].replace('#', ''), 16), 0.2); card.fillRoundedRect(ex - 45, -25, 90, 80, 6); card.lineStyle(2, parseInt(colors[el].replace('#', ''), 16), 0.6); card.strokeRoundedRect(ex - 45, -25, 90, 80, 6); });
      card.on('pointerdown', () => {
        GameState.element = el;
        GameState.recalcStats();
        panel.destroy(true);
        scene.time.delayedCall(300, () => {
          scene.isInDialogue = true;
          scene.dialogueBox.show({
            speaker: '浦原喜助',
            text: `${el}元素……你的灵魂中寄宿着这种力量。现在去探索空座町吧，和镇上的人聊聊，可能会有需要你帮助的人。`
          }, () => {
            scene.isInDialogue = false;
            scene.scene.get('UIScene').events.emit('updateStats');
            SaveManager.save();
            scene.tryAutoStartNextQuest();
          });
        });
      });
    });
  }

export function showShikaiSelection(scene: GameScene): void {
    // \u4eceZANPAKUTO_ELEMENT\u8bfb\u53d6\u5f53\u524d\u5143\u7d20\u7684\u5168\u90e89\u628a\u65a9\u9b44\u5200
    const el = GameState.element || '\u706b';
    const zanList = Object.entries(ZANPAKUTO_ELEMENT)
      .filter(([_, e]) => e === el)
      .map(([name]) => name);

    scene.isInDialogue = true;
    const cam = scene.cameras.main;
    const panel = scene.add.container(Math.round(cam.scrollX) + GAME_WIDTH / 2, Math.round(cam.scrollY) + GAME_HEIGHT / 2).setDepth(400);
    const bg = scene.add.graphics();
    bg.fillStyle(0x121222, 0.98); bg.fillRoundedRect(-560, -340, 1120, 680, 14);
    bg.lineStyle(2, 0x4a5a8a, 0.6); bg.strokeRoundedRect(-560, -340, 1120, 680, 14);
    panel.add(bg);

    // \u6807\u9898\u680f
    const tb = scene.add.graphics(); tb.fillStyle(0x1a1a36, 1);
    tb.fillRoundedRect(-556, -336, 1112, 50, { tl: 10, tr: 10, bl: 0, br: 0 }); panel.add(tb);
    const elNames: Record<string, string> = { '\u706b': '\u706b\u7cfb', '\u98ce': '\u98ce\u7cfb', '\u6c34': '\u6c34\u7cfb', '\u571f': '\u571f\u7cfb' };
    panel.add(scene.add.text(0, -311, '\u25c6  ' + (elNames[el] || el) + '\u59cb\u89e3\u65a9\u9b44\u5200\u9009\u62e9  \u25c6', {
      fontSize: '20px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));

    const elColors: Record<string, number> = { '\u706b': 0xff6644, '\u98ce': 0x44cc88, '\u6c34': 0x4488ff, '\u571f': 0xcc9944 };
    const elColor = elColors[el] || 0x888888;

    // 3\u00d73\u7f51\u683c\u5c55\u793a9\u628a\u65a9\u9b44\u5200
    const cols = 3, cardW = 340, cardH = 170, gapX = 16, gapY = 14;
    const startX = -(cols * cardW + (cols - 1) * gapX) / 2;
    const startY = -270;

    zanList.forEach((zan, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const zx = startX + col * (cardW + gapX);
      const zy = startY + row * (cardH + gapY);

      // \u5361\u7247\u80cc\u666f
      const card = scene.add.graphics();
      card.fillStyle(0x0d0d1d, 0.8); card.fillRoundedRect(zx, zy, cardW, cardH, 8);
      card.lineStyle(1, elColor, 0.3); card.strokeRoundedRect(zx, zy, cardW, cardH, 8);
      panel.add(card);

      // \u540d\u79f0
      panel.add(scene.add.text(zx + 12, zy + 8, zan, {
        fontSize: '16px', color: '#ffe8b0', fontStyle: 'bold', padding: { y: 2 } }));

      // \u6210\u957f\u7387\u63cf\u8ff0
      const growth = ZANPAKUTO_GROWTH[zan] || {};
      const topStats = Object.entries(growth)
        .filter(([k]) => k !== 'statusAcc')
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .slice(0, 3)
        .map(([k, v]) => `${k} ${v}`);
      panel.add(scene.add.text(zx + 12, zy + 32, topStats.join('  |  '), {
        fontSize: '10px', color: '#8899bb', padding: { y: 1 } }));

      // \u6280\u80fd\u4fe1\u606f
      const skills = SHIKAI_SKILLS[zan];
      if (skills && skills.length > 0) {
        const sInfo = skills.slice(0, 2).map(s => `\u2726 ${s.name} [\u5a01${s.power}]`).join('\n');
        panel.add(scene.add.text(zx + 12, zy + 52, sInfo, {
          fontSize: '10px', color: '#ddaabb', padding: { y: 1 } }));
        if (skills[0].desc) {
          panel.add(scene.add.text(zx + 12, zy + 92, skills[0].desc, {
            fontSize: '9px', color: '#778899', wordWrap: { width: cardW - 24 }, padding: { y: 1 } }));
        }
      }

      // \u72b6\u6001\u63a7\u5236\u6807\u8bb0
      if (growth.statusAcc) {
        panel.add(scene.add.text(zx + cardW - 60, zy + 8, '\u63a7\u5236', {
          fontSize: '9px', color: '#cc88ff', fontStyle: 'bold',
          backgroundColor: '#22114488', padding: { x: 4, y: 1 } }));
      }

      // \u9009\u62e9\u6309\u94ae
      const sel = scene.add.text(zx + cardW / 2, zy + cardH - 22, '[ \u9009\u62e9\u6b64\u5200 ]', {
        fontSize: '13px', color: '#ffcc44', fontStyle: 'bold',
        backgroundColor: '#33220088', padding: { x: 16, y: 5 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      sel.on('pointerover', () => { sel.setColor('#ffff88'); sel.setBackgroundColor('#443300aa'); });
      sel.on('pointerout', () => { sel.setColor('#ffcc44'); sel.setBackgroundColor('#33220088'); });
      sel.on('pointerdown', () => {
        GameState.zanpakuto = zan; if (isOnline()) { requestUnlock('shikai', zan); requestSetZanpakuto(zan); } else GameState.addUnlock('shikai');
        GameState.recalcStats();
        panel.destroy(true);
        scene.time.delayedCall(300, () => {
          scene.isInDialogue = true;
          scene.dialogueBox.show({
            speaker: '\u6d66\u539f\u559c\u52a9',
            text: `${zan}\u2026\u2026\u5b83\u4e0a\u9762\u6709\u5148\u9063\u961f\u7684\u5370\u8bb0\u3002\u4f60\u5df2\u7ecf\u89e6\u6478\u5230\u59cb\u89e3\u7684\u95e8\u69db\u4e86\u3002\u53bb\u6d66\u539f\u5546\u5e97\u8857\u5427\uff0c\u90a3\u91cc\u6709\u4f60\u9700\u8981\u7684\u88c5\u5907\u3002`
          }, () => {
            scene.isInDialogue = false;
            scene.scene.get('UIScene').events.emit('updateStats');
            SaveManager.save();
            scene.tryAutoStartNextQuest();
          });
        });
      });
      panel.add(sel);
    });

    // \u5173\u95ed\u6309\u94ae
    panel.add(scene.add.text(530, -316, '\u2715', {
      fontSize: '22px', color: '#cc6666', padding: { x: 8, y: 4 } }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', function (this: any) { this.setColor('#ff8888'); })
      .on('pointerout', function (this: any) { this.setColor('#cc6666'); })
      .on('pointerdown', () => { panel.destroy(true); scene.isInDialogue = false; }));

    // \u5e95\u90e8\u63d0\u793a
    panel.add(scene.add.text(0, 320, '\u70b9\u51fb\u9009\u62e9\u4f60\u7684\u59cb\u89e3\u65a9\u9b44\u5200\uff0c\u9009\u5b9a\u540e\u4e0d\u53ef\u66f4\u6539', {
      fontSize: '11px', color: '#556688', padding: { y: 2 } }).setOrigin(0.5));
  }

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

    // 套装进度汇总（联机下 equipment 由 worldSync 重建并带 set 字段）
    const setProgress = listSetProgress(Inventory.equipment);
    const setBlockY = matY + 30 + Math.ceil(mats.length / 6) * 24 + 14;
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
    p.add(scene.add.text(ox + ow - 200, oy + th / 2, '拍卖行', { fontSize: '15px', color: '#9fe6a0', fontStyle: 'bold', padding: { x: 8, y: 4 }, backgroundColor: '#11331188' }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerover', function (this: any) { this.setColor('#c6ffc6'); this.setBackgroundColor('#225522aa'); })
      .on('pointerout', function (this: any) { this.setColor('#9fe6a0'); this.setBackgroundColor('#11331188'); })
      .on('pointerdown', () => { closeStatPanel(scene); openAuctionPanel(scene); }));
    p.add(scene.add.text(ox + ow - 118, oy + th / 2, '商城', { fontSize: '15px', color: '#ffcc88', fontStyle: 'bold', padding: { x: 8, y: 4 }, backgroundColor: '#33220088' }).setOrigin(0.5).setInteractive({ useHandCursor: true })
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

export function showKidoPanel(scene: GameScene): void {
    if (scene.kidoPanel) { closeKidoPanel(scene); return; }
    scene.pauseForMenu(); const cam = scene.cameras.main;
    const p = scene.add.container(Math.round(cam.scrollX), Math.round(cam.scrollY)).setDepth(300); scene.kidoPanel = p;
    const ov = scene.add.graphics(); ov.fillStyle(0, 0.78); ov.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    ov.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains); p.add(ov);
    const ox = 30, oy = 20, ow = GAME_WIDTH - 60, oh = GAME_HEIGHT - 40;
    const mb = scene.add.graphics(); mb.fillStyle(0x121222, 0.98); mb.fillRoundedRect(ox, oy, ow, oh, 12);
    mb.lineStyle(2, 0x4a5a8a, 0.6); mb.strokeRoundedRect(ox, oy, ow, oh, 12); p.add(mb);
    const th = 54; const tb = scene.add.graphics(); tb.fillStyle(0x1a1a36, 1);
    tb.fillRoundedRect(ox + 4, oy + 4, ow - 8, th, { tl: 10, tr: 10, bl: 0, br: 0 }); p.add(tb);
    p.add(scene.add.text(GAME_WIDTH / 2, oy + th / 2, '\u25c6  \u9b3c \u9053 \u5929 \u8d4b  \u25c6', {
      fontSize: '22px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));
    p.add(scene.add.text(ox + ow - 40, oy + th / 2, '\u2715', {
      fontSize: '22px', color: '#cc6666', padding: { x: 8, y: 4 } }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', function (this: any) { this.setColor('#ff8888'); })
      .on('pointerout', function (this: any) { this.setColor('#cc6666'); })
      .on('pointerdown', () => closeKidoPanel(scene)));

    const schools: { id: KidoSchool; name: string; color: string }[] = [
      { id: 'hado', name: '\u7834\u9053', color: '#ff6644' },
      { id: 'bakudo', name: '\u7e1b\u9053', color: '#4488ff' },
      { id: 'kaido', name: '\u56de\u9053', color: '#44cc66' },
    ];

    // 使用Kido.school作为当前tab（持久化）
    if (!Kido.school) Kido.school = 'hado';
    const activeTab: KidoSchool = Kido.school;
    const avail = Kido.availablePoints();
    const totalSpent = Kido.pointsSpent();
    p.add(scene.add.text(GAME_WIDTH / 2, oy + th + 16, `\u53ef\u7528\u9b3c\u9053\u70b9: ${avail}  |  \u5df2\u6295\u5165: ${totalSpent}  |  \u5f53\u524d: ${schools.find(s => s.id === activeTab)?.name || ''}`, {
      fontSize: '14px', color: '#ffcc44', fontStyle: 'bold', padding: { y: 2 }, backgroundColor: '#121222' }).setOrigin(0.5));

    // Tab buttons
    const tabY = oy + th + 44;
    schools.forEach((s, i) => {
      const isA = s.id === activeTab; const tx = ox + 30 + i * 140;
      const tb2 = scene.add.graphics();
      tb2.fillStyle(isA ? 0x2a1a0a : 0x111122, 0.8); tb2.fillRoundedRect(tx, tabY, 130, 34, 6);
      tb2.lineStyle(1, isA ? parseInt(s.color.replace('#', ''), 16) : 0x334466, isA ? 0.8 : 0.4);
      tb2.strokeRoundedRect(tx, tabY, 130, 34, 6); p.add(tb2);
      const t = scene.add.text(tx + 65, tabY + 17, s.name, {
        fontSize: '15px', color: isA ? s.color : '#555566', fontStyle: 'bold', padding: { y: 2 }
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      t.on('pointerover', () => { if (!isA) t.setColor('#888899'); });
      t.on('pointerout', () => { if (!isA) t.setColor('#555566'); });
      t.on('pointerdown', () => {
        if (s.id !== activeTab) { if (isOnline()) requestKidoSetSchool(s.id); Kido.school = s.id; closeKidoPanel(scene); showKidoPanel(scene); }
      });
      p.add(t);
    });

    // Get nodes for active school, grouped by tier
    const sch = Object.values(KIDO_NODES).filter(n => n.school === activeTab);
    const tiers = [1, 2, 3, 4, 5];
    const colStr = activeTab === 'hado' ? '#ff6644' : activeTab === 'bakudo' ? '#4488ff' : '#44cc66';
    const colNum = parseInt(colStr.replace('#', ''), 16);

    // Layout: 5 rows (one per tier), nodes spread horizontally within each row
    const nodeAreaY = tabY + 50;
    const nodeAreaH = oh - (nodeAreaY - oy) - 50;
    const rowH = nodeAreaH / 5;
    const nR = 26;

    tiers.forEach((tier, tierIdx) => {
      const tierNodes = sch.filter(n => n.tier === tier).sort((a, b) => (a.column || 0) - (b.column || 0));
      if (tierNodes.length === 0) return;
      const rowY = nodeAreaY + tierIdx * rowH + rowH / 2;

      // Tier label
      const tierLock = TIER_LOCK[tier] || 0;
      const inSchool = Kido.pointsInSchool(activeTab);
      const tierUnlocked = inSchool >= tierLock;
      p.add(scene.add.text(ox + 20, rowY - 10, `T${tier} (${tierLock}\u70b9)`, {
        fontSize: '10px', color: tierUnlocked ? '#667788' : '#444455', padding: { y: 1 }
      }));

      // Nodes in this tier
      const nodeSpacing = (ow - 120) / Math.max(tierNodes.length, 1);
      tierNodes.forEach((n, ni) => {
        const nx = ox + 80 + nodeSpacing * (ni + 0.5);
        const ny = rowY;
        const nodePts = Kido.getPoints(n.id) || 0;
        const unlocked = tierUnlocked;
        const active = nodePts > 0;
        const canAdd = Kido.canAddPoint(n.id);
        const isMaxed = nodePts >= n.maxPoints;

        // Connection line to parent (previous tier, same column)
        if (tierIdx > 0) {
          const parentTier = tier - 1;
          const parentNodes = sch.filter(nn => nn.tier === parentTier);
          // Find closest parent by column
          const parent = parentNodes.reduce((best, nn) => {
            const dist = Math.abs((nn.column || 0) - (n.column || 0));
            return dist < Math.abs((best?.column || 0) - (n.column || 0)) ? nn : best;
          }, parentNodes[0]);
          if (parent) {
            const py = nodeAreaY + (tierIdx - 1) * rowH + rowH / 2;
            const parentPts = Kido.getPoints(parent.id) || 0;
            const lg = scene.add.graphics();
            lg.lineStyle(parentPts > 0 ? 3 : 1, parentPts > 0 ? colNum : 0x334466, parentPts > 0 ? 0.7 : 0.3);
            lg.beginPath(); lg.moveTo(nx, ny - nR - 2); lg.lineTo(nx, py + nR + 2); lg.strokePath();
            p.add(lg);
          }
        }

        // Node glow
        const og = scene.add.graphics();
        og.fillStyle(colNum, active ? 0.15 : 0.03); og.fillCircle(nx, ny, nR + 8); p.add(og);

        // Node circle
        const nc = scene.add.graphics();
        nc.fillStyle(active ? colNum : unlocked ? 0x1a1a3e : 0x080812, active ? 0.95 : 0.6);
        nc.fillCircle(nx, ny, nR);
        nc.lineStyle(active ? 3 : 1, active ? colNum : unlocked ? 0x445566 : 0x334455, active ? 1 : 0.5);
        nc.strokeCircle(nx, ny, nR); p.add(nc);

        // Points display
        const ptStr = nodePts > 0 ? `${nodePts}/${n.maxPoints}` : n.passive ? 'P' : '';
        p.add(scene.add.text(nx, ny - 2, ptStr, {
          fontSize: '11px', color: unlocked ? '#ffffff' : '#334455', fontStyle: 'bold', padding: { y: 1 }
        }).setOrigin(0.5));

        // Name
        p.add(scene.add.text(nx, ny + nR + 6, n.name, {
          fontSize: '11px', color: unlocked ? '#ccccdd' : '#445566', padding: { y: 1 }
        }).setOrigin(0.5));

        // Interactive zone
        const z = scene.add.zone(nx, ny, nR * 3, nR * 3 + 24).setInteractive({ useHandCursor: true });
        z.on('pointerover', () => {
          if (scene.kidoTooltip) scene.kidoTooltip.destroy();
          scene.kidoTooltip = scene.add.container(Math.min(nx + 30, GAME_WIDTH - 240), ny - 10).setDepth(320);
          const tt = scene.add.graphics(); tt.fillStyle(0x0a0a1a, 0.95); tt.fillRoundedRect(0, 0, 220, 80, 6);
          tt.lineStyle(1, colNum, 0.6); tt.strokeRoundedRect(0, 0, 220, 80, 6); scene.kidoTooltip.add(tt);
          scene.kidoTooltip.add(scene.add.text(8, 6, n.name, { fontSize: '12px', color: '#ffe8b0', fontStyle: 'bold', padding: { y: 1 } }));
          scene.kidoTooltip.add(scene.add.text(8, 24, n.desc, { fontSize: '9px', color: '#aaaacc', wordWrap: { width: 204 }, padding: { y: 1 } }));
          let status = '';
          let statusColor = '#666688';
          if (isMaxed) { status = '\u5df2\u6ee1\u7ea7'; statusColor = '#ffcc44'; }
          else if (canAdd) { status = `[\u70b9\u51fb\u52a0\u70b9] \u5269\u4f59${avail}\u70b9`; statusColor = '#88cc88'; }
          else if (!unlocked) { status = `\u9700\u8be5\u7cfb${tierLock}\u70b9\u89e3\u9501`; statusColor = '#cc6644'; }
          else if (avail <= 0) { status = '\u9b3c\u9053\u70b9\u4e0d\u8db3'; statusColor = '#cc6644'; }
          scene.kidoTooltip.add(scene.add.text(8, 56, status, { fontSize: '10px', color: statusColor, padding: { y: 1 } }));
        });
        z.on('pointerout', () => { if (scene.kidoTooltip) { scene.kidoTooltip.destroy(); scene.kidoTooltip = null; } });
        z.on('pointerdown', () => {
          if (canAdd) {
            if (isOnline()) requestKidoAllocate(n.id); else Kido.addPoint(n.id);
            GameState.recalcStats();
            closeKidoPanel(scene); showKidoPanel(scene);
            scene.scene.get('UIScene').events.emit('updateStats');
          }
        });
        p.add(z);
      });
    });

    const fy = oy + oh - 28; const ft = scene.add.graphics();
    ft.fillStyle(0x1a1a36, 0.8); ft.fillRoundedRect(ox + 4, fy, ow - 8, 24, { tl: 0, tr: 0, bl: 10, br: 10 }); p.add(ft);
    p.add(scene.add.text(GAME_WIDTH / 2, fy + 12, 'K\u952e \u5f00\u5173  |  ESC \u5173\u95ed  |  \u60ac\u505c\u67e5\u770b  |  \u70b9\u51fb\u52a0\u70b9  |  \u5207\u6362\u6807\u7b7e\u4fdd\u5b58\u5f53\u524d\u7cfb\u522b', {
      fontSize: '11px', color: '#556688', padding: { y: 2 } }).setOrigin(0.5));
  }

export function closeKidoPanel(scene: GameScene): void { scene.kidoPanel?.destroy(true); scene.kidoPanel = null; if (scene.kidoTooltip) { scene.kidoTooltip.destroy(); scene.kidoTooltip = null; } scene.resumeFromMenu(); }

export function toggleEnhancePanel(scene: GameScene): void {
    if (scene.enhancePanel) { closeEnhancePanel(scene); return; }
    scene.pauseForMenu(); const cam = scene.cameras.main;
    const p = scene.add.container(Math.round(cam.scrollX), Math.round(cam.scrollY)).setDepth(300); scene.enhancePanel = p;
    const ov = scene.add.graphics(); ov.fillStyle(0, 0.78); ov.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    ov.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains); p.add(ov);
    const ox = 30, oy = 20, ow = GAME_WIDTH - 60, oh = GAME_HEIGHT - 40;
    const mb = scene.add.graphics(); mb.fillStyle(0x121222, 0.98); mb.fillRoundedRect(ox, oy, ow, oh, 12);
    mb.lineStyle(2, 0x4a5a8a, 0.6); mb.strokeRoundedRect(ox, oy, ow, oh, 12); p.add(mb);
    const th = 54; const tb = scene.add.graphics(); tb.fillStyle(0x1a1a36, 1);
    tb.fillRoundedRect(ox + 4, oy + 4, ow - 8, th, { tl: 10, tr: 10, bl: 0, br: 0 }); p.add(tb);
    p.add(scene.add.text(GAME_WIDTH / 2, oy + th / 2, '◆  强 化 工 坊  ◆', {
      fontSize: '22px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));
    p.add(scene.add.text(ox + ow - 40, oy + th / 2, '✕', {
      fontSize: '22px', color: '#cc6666', padding: { x: 8, y: 4 } }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', function (this: any) { this.setColor('#ff8888'); })
      .on('pointerout', function (this: any) { this.setColor('#cc6666'); })
      .on('pointerdown', () => closeEnhancePanel(scene)));

    // Tabs
    const tabs = ['强化', '精炼', '分解'];
    const tabColors = ['#ff8844', '#4488ff', '#88cc44'];
    let activeTab = scene.enhanceTab;
    const tabY = oy + th + 10;
    const renderTabs = () => {
      tabs.forEach((t, i) => {
        const tx = ox + 30 + i * 130;
        const isA = i === activeTab;
        const tbg = scene.add.graphics();
        tbg.fillStyle(isA ? 0x2a1a0a : 0x111122, 0.8); tbg.fillRoundedRect(tx, tabY, 120, 32, 6);
        tbg.lineStyle(1, isA ? parseInt(tabColors[i].replace('#', ''), 16) : 0x334466, isA ? 0.8 : 0.4);
        tbg.strokeRoundedRect(tx, tabY, 120, 32, 6); p.add(tbg);
        const tt = scene.add.text(tx + 60, tabY + 16, t, {
          fontSize: '14px', color: isA ? tabColors[i] : '#555566', fontStyle: 'bold', padding: { y: 2 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        tt.on('pointerdown', () => { if (i !== activeTab) { scene.enhanceTab = i; closeEnhancePanel(scene); toggleEnhancePanel(scene); } });
        p.add(tt);
      });
    };
    renderTabs();

    // Equipment list
    const eq = Inventory.equipment;
    const eqSlots = ['weapon', 'head', 'body', 'bracer', 'boots', 'belt', 'ring', 'necklace', 'charm', 'pendant'];
    const sn: Record<string, string> = { weapon: '武器', head: '头部', body: '身体', bracer: '手甲', boots: '战靴', belt: '腰带', ring: '戒指', necklace: '项链', charm: '护符', pendant: '挂饰' };
    const listY = tabY + 44;
    eqSlots.forEach((s, i) => {
      const col = i % 2, row = Math.floor(i / 2); const sx = ox + 30 + col * 520, sy = listY + row * 72;
      const item = (eq as any)[s];
      const er = scene.add.graphics(); er.fillStyle(0x0d0d1d, 0.7); er.fillRoundedRect(sx, sy, 500, 62, 6);
      er.lineStyle(1, 0x334466, 0.4); er.strokeRoundedRect(sx, sy, 500, 62, 6); p.add(er);
      if (item) addEnhanceGlow(scene, p, er, sx, sy, 500, 62, item as Item, 6);
      p.add(scene.add.text(sx + 10, sy + 4, sn[s] || s, { fontSize: '10px', color: '#556688', padding: { y: 1 } }));
      if (item) {
        const elv = (item as any).enhanceLevel || 0; const enhLabel = getEnhanceLabel(item);
        const qc: Record<string, string> = { white: '#aaaaaa', green: '#44cc44', blue: '#4488ff', purple: '#cc44cc', gold: '#ffaa00' };
        const q = item.quality || 'white';
        p.add(scene.add.text(sx + 10, sy + 20, `${enhLabel} ${item.name}`, { fontSize: '13px', color: qc[q] || '#cccccc', fontStyle: 'bold', padding: { y: 1 } }));
        const stats = Object.entries(item.stats as Record<string, number>).map(([k, v]) => `${k}+${v}`).join('  ');
        p.add(scene.add.text(sx + 10, sy + 40, stats, { fontSize: '9px', color: '#7788aa', padding: { y: 1 } }));
        const eqRef2 = getRefineDisplay(item);
        if (eqRef2) p.add(scene.add.text(sx + 10, sy + 52, eqRef2, { fontSize: '8px', color: '#F5A623', padding: { y: 1 } }));

        if (activeTab === 0) {
          // 强化
          if (elv < 10) {
            const cost = getEnhanceCost(elv + 1, (item as any).quality || 'white'); const rate = getEnhanceRate(elv + 1);
            p.add(scene.add.text(sx + 300, sy + 8, `${cost.gold}金币 | ${Math.round(rate * 100)}%`, { fontSize: '10px', color: '#888899', padding: { y: 1 } }));
            const btn = scene.add.text(sx + 420, sy + 4, '[ 强化 ]', { fontSize: '16px', color: '#ff8844', fontStyle: 'bold', padding: { x: 16, y: 8 }, backgroundColor: '#33220088' }).setInteractive({ useHandCursor: true });
            btn.on('pointerover', () => btn.setColor('#ffaa66'));
            btn.on('pointerout', () => btn.setColor('#ff8844'));
            btn.on('pointerdown', () => {
              if (scene.gameRoom) {
                // 联机：强化走服务端权威（按 id 定位装备栏/背包），成功由 worldSync 刷新面板，结果由 intentResult 提示
                if (!requestEnhance(item.id)) return;
                return;
              }
              const result = doEnhance(item);
              GameState.recalcStats(); closeEnhancePanel(scene); toggleEnhancePanel(scene);
              scene.scene.get('UIScene').events.emit('updateStats');
              const n = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, result.message, { fontSize: '16px', color: result.success ? '#88ff88' : '#ff6666', fontStyle: 'bold', backgroundColor: '#112211cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400);
              scene.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => n.destroy() });
            });
            p.add(btn);
          } else { p.add(scene.add.text(sx + 380, sy + 20, '已满级', { fontSize: '14px', color: '#ffcc44', fontStyle: 'bold', padding: { y: 2 } })); }
        } else if (activeTab === 1) {
          // 精炼
          const maxSlots = getRefineMaxSlots((item as any).quality || 'white');
          const curSlots = (item as any).refineStats?.length || 0;
          const refineCost = getRefineCost(item);
          if (curSlots < maxSlots) {
            p.add(scene.add.text(sx + 300, sy + 8, `${refineCost.gold}金币 | ${curSlots}/${maxSlots}槽`, { fontSize: '10px', color: '#888899', padding: { y: 1 } }));
            const btn = scene.add.text(sx + 420, sy + 4, '[ 精炼 ]', { fontSize: '16px', color: '#4488ff', fontStyle: 'bold', padding: { x: 16, y: 8 }, backgroundColor: '#11224488' }).setInteractive({ useHandCursor: true });
            btn.on('pointerover', () => btn.setColor('#66aaff'));
            btn.on('pointerout', () => btn.setColor('#4488ff'));
            btn.on('pointerdown', () => {
              if (scene.gameRoom) {
                // 联机：精炼走服务端权威（按 id 定位），成功由 worldSync 刷新面板
                if (!requestRefine(item.id)) return;
                return;
              }
              const result = doRefine(item);
              GameState.recalcStats(); closeEnhancePanel(scene); toggleEnhancePanel(scene);
              scene.scene.get('UIScene').events.emit('updateStats');
              const n = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, result.message, { fontSize: '16px', color: result.success ? '#88ccff' : '#ff6666', fontStyle: 'bold', backgroundColor: '#111122cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400);
              scene.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => n.destroy() });
            });
            p.add(btn);
          } else {
            p.add(scene.add.text(sx + 300, sy + 8, `${curSlots}/${maxSlots}槽已满`, { fontSize: '10px', color: '#888899', padding: { y: 1 } }));
            const btn = scene.add.text(sx + 420, sy + 4, '[ 重置 ]', { fontSize: '16px', color: '#cc8844', fontStyle: 'bold', padding: { x: 16, y: 8 }, backgroundColor: '#33220088' }).setInteractive({ useHandCursor: true });
            btn.on('pointerdown', () => {
              if (scene.gameRoom) {
                if (!requestRefineReset(item.id)) return;
                return;
              }
              doRefineReset(item); GameState.recalcStats(); closeEnhancePanel(scene); toggleEnhancePanel(scene); scene.scene.get('UIScene').events.emit('updateStats');
            });
            p.add(btn);
          }
        } else {
          // 分解
          const decompReturn = getDecompReturn(item);
          const matStr = decompReturn.materials.map(m => `${m.name}×${m.qty}`).join(', ');
          p.add(scene.add.text(sx + 300, sy + 8, `${decompReturn.gold}金币 | ${matStr}`, { fontSize: '9px', color: '#888899', padding: { y: 1 } }));
          const btn = scene.add.text(sx + 420, sy + 4, '[ 分解 ]', { fontSize: '16px', color: '#88cc44', fontStyle: 'bold', padding: { x: 16, y: 8 }, backgroundColor: '#11221188' }).setInteractive({ useHandCursor: true });
          btn.on('pointerover', () => btn.setColor('#aaffaa'));
          btn.on('pointerout', () => btn.setColor('#88cc44'));
          btn.on('pointerdown', () => {
            if (scene.gameRoom) {
              // 联机：分解走服务端权威（按 id 定位装备栏/背包），成功由 worldSync 刷新面板
              if (!requestDecompose(item.id)) return;
              return;
            }
            const result = doDecompose(item);
            GameState.recalcStats(); closeEnhancePanel(scene); toggleEnhancePanel(scene);
            scene.scene.get('UIScene').events.emit('updateStats');
            const n = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, result.message, { fontSize: '16px', color: '#88cc44', fontStyle: 'bold', backgroundColor: '#112211cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400);
            scene.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => n.destroy() });
          });
          p.add(btn);
        }
      } else { p.add(scene.add.text(sx + 10, sy + 24, '未装备', { fontSize: '13px', color: '#334455', padding: { y: 1 } })); }
    });

    // 背包装备列表（可强化/精炼/分解）
    const bagItems = Inventory.items.filter(it => it.type === 'equipment');
    if (bagItems.length > 0) {
      const bagY = listY + 5 * 72 + 10;
      p.add(scene.add.text(ox + 30, bagY, '背包装备', { fontSize: '14px', color: '#88aacc', fontStyle: 'bold', padding: { y: 2 } }));
      const qc2: Record<string, string> = { white: '#aaaaaa', green: '#44cc44', blue: '#4488ff', purple: '#cc44cc', gold: '#ffaa00' };
      bagItems.forEach((item, bi) => {
        const col = bi % 2, row = Math.floor(bi / 2); const sx = ox + 30 + col * 520, sy = bagY + 28 + row * 68;
        const er2 = scene.add.graphics(); er2.fillStyle(0x0d0d1d, 0.7); er2.fillRoundedRect(sx, sy, 500, 58, 6);
        er2.lineStyle(1, 0x334466, 0.4); er2.strokeRoundedRect(sx, sy, 500, 58, 6); p.add(er2);
        addEnhanceGlow(scene, p, er2, sx, sy, 500, 58, item, 6);
        const elv = (item as any).enhanceLevel || 0; const q = (item as any).quality || 'white';
        p.add(scene.add.text(sx + 10, sy + 4, `${item.name}${elv > 0 ? ' +' + elv : ''}`, { fontSize: '12px', color: qc2[q] || '#cccccc', fontStyle: 'bold', padding: { y: 1 } }));
        const stats = item.stats ? Object.entries(item.stats as Record<string, number>).map(([k, v]) => `${k}+${v}`).join(' ') : '';
        p.add(scene.add.text(sx + 10, sy + 24, stats, { fontSize: '9px', color: '#7788aa', padding: { y: 1 } }));
        const bagRef2 = getRefineDisplay(item);
        if (bagRef2) p.add(scene.add.text(sx + 10, sy + 36, bagRef2, { fontSize: '8px', color: '#F5A623', padding: { y: 1 } }));

        if (scene.enhanceTab === 0 && elv < 10) {
          const cost = getEnhanceCost(elv + 1, q); const rate = getEnhanceRate(elv + 1);
          p.add(scene.add.text(sx + 280, sy + 6, `${cost.gold}金 ${Math.round(rate * 100)}%`, { fontSize: '9px', color: '#888899', padding: { y: 1 } }));
          const btn = scene.add.text(sx + 400, sy + 4, '[ 强化 ]', { fontSize: '14px', color: '#ff8844', fontStyle: 'bold', padding: { x: 12, y: 6 }, backgroundColor: '#33220088' }).setInteractive({ useHandCursor: true });
          btn.on('pointerdown', () => {
            if (scene.gameRoom) { if (!requestEnhance(item.id)) return; return; }
            const result = doEnhance(item); GameState.recalcStats(); closeEnhancePanel(scene); toggleEnhancePanel(scene); scene.scene.get('UIScene').events.emit('updateStats'); const n = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, result.message, { fontSize: '16px', color: result.success ? '#88ff88' : '#ff6666', fontStyle: 'bold', backgroundColor: '#112211cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400); scene.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => n.destroy() });
          });
          p.add(btn);
        } else if (scene.enhanceTab === 1) {
          const maxSlots = getRefineMaxSlots(q); const curSlots = (item as any).refineStats?.length || 0;
          if (curSlots < maxSlots) {
            const rc = getRefineCost(item);
            p.add(scene.add.text(sx + 280, sy + 6, `${rc.gold}金 ${curSlots}/${maxSlots}槽`, { fontSize: '9px', color: '#888899', padding: { y: 1 } }));
            const btn = scene.add.text(sx + 400, sy + 4, '[ 精炼 ]', { fontSize: '14px', color: '#4488ff', fontStyle: 'bold', padding: { x: 12, y: 6 }, backgroundColor: '#11224488' }).setInteractive({ useHandCursor: true });
            btn.on('pointerdown', () => {
            if (scene.gameRoom) { if (!requestRefine(item.id)) return; return; }
            const result = doRefine(item); GameState.recalcStats(); closeEnhancePanel(scene); toggleEnhancePanel(scene); scene.scene.get('UIScene').events.emit('updateStats'); const n = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, result.message, { fontSize: '16px', color: result.success ? '#88ccff' : '#ff6666', fontStyle: 'bold', backgroundColor: '#111122cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400); scene.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => n.destroy() });
          });
            p.add(btn);
          } else {
            p.add(scene.add.text(sx + 350, sy + 8, `${curSlots}/${maxSlots}满`, { fontSize: '10px', color: '#888899', padding: { y: 1 } }));
            const btn = scene.add.text(sx + 420, sy + 4, '[ 重置 ]', { fontSize: '14px', color: '#cc8844', fontStyle: 'bold', padding: { x: 12, y: 6 }, backgroundColor: '#33220088' }).setInteractive({ useHandCursor: true });
            btn.on('pointerdown', () => {
              if (scene.gameRoom) {
                if (!requestRefineReset(item.id)) return;
                return;
              }
              doRefineReset(item); GameState.recalcStats(); closeEnhancePanel(scene); toggleEnhancePanel(scene); scene.scene.get('UIScene').events.emit('updateStats');
            });
            p.add(btn);
          }
        } else if (scene.enhanceTab === 2) {
          const dr = getDecompReturn(item);
          p.add(scene.add.text(sx + 280, sy + 6, `${dr.gold}金 ${dr.materials.map(m => m.name + '×' + m.qty).join(',')}`, { fontSize: '8px', color: '#888899', padding: { y: 1 } }));
          const btn = scene.add.text(sx + 400, sy + 4, '[ 分解 ]', { fontSize: '14px', color: '#88cc44', fontStyle: 'bold', padding: { x: 12, y: 6 }, backgroundColor: '#11221188' }).setInteractive({ useHandCursor: true });
          btn.on('pointerdown', () => {
            if (scene.gameRoom) { if (!requestDecompose(item.id)) return; return; }
            const result = doDecompose(item); GameState.recalcStats(); closeEnhancePanel(scene); toggleEnhancePanel(scene); scene.scene.get('UIScene').events.emit('updateStats'); const n = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, result.message, { fontSize: '16px', color: '#88cc44', fontStyle: 'bold', backgroundColor: '#112211cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400); scene.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => n.destroy() });
          });
          p.add(btn);
        }
      });
    }

    const fy = oy + oh - 28; const ft = scene.add.graphics();
    ft.fillStyle(0x1a1a36, 0.8); ft.fillRoundedRect(ox + 4, fy, ow - 8, 24, { tl: 0, tr: 0, bl: 10, br: 10 }); p.add(ft);
    p.add(scene.add.text(GAME_WIDTH / 2, fy + 12, 'ESC 关闭  |  切换标签选择功能', {
      fontSize: '11px', color: '#556688', padding: { y: 2 } }).setOrigin(0.5));
  }

export function closeEnhancePanel(scene: GameScene): void { scene.enhancePanel?.destroy(true); scene.enhancePanel = null; scene.resumeFromMenu(); }

export function toggleQuestLog(scene: GameScene): void {
    if (scene.questLogPanel) { scene.questLogPanel.destroy(true); scene.questLogPanel = null; scene.resumeFromMenu(); return; }
    scene.pauseForMenu(); renderQuestLogPanel(scene);
  }

export function renderQuestLogPanel(scene: GameScene): void {
    const cam = scene.cameras.main;
    const p = scene.add.container(Math.round(cam.scrollX), Math.round(cam.scrollY)).setDepth(300);
    scene.questLogPanel = p;
    const ov = scene.add.graphics(); ov.fillStyle(0, 0.78); ov.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    ov.setInteractive(new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains); p.add(ov);
    const ox = 30, oy = 20, ow = GAME_WIDTH - 60, oh = GAME_HEIGHT - 40;
    const mb = scene.add.graphics(); mb.fillStyle(0x121222, 0.98); mb.fillRoundedRect(ox, oy, ow, oh, 12);
    mb.lineStyle(2, 0x4a5a8a, 0.6); mb.strokeRoundedRect(ox, oy, ow, oh, 12); p.add(mb);
    const th = 54; const tb = scene.add.graphics(); tb.fillStyle(0x1a1a36, 1);
    tb.fillRoundedRect(ox + 4, oy + 4, ow - 8, th, { tl: 10, tr: 10, bl: 0, br: 0 }); p.add(tb);
    p.add(scene.add.text(GAME_WIDTH / 2, oy + th / 2, '\u25c6  \u4efb \u52a1 \u65e5 \u5fd7  \u25c6', {
      fontSize: '22px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));
    p.add(scene.add.text(ox + ow - 40, oy + th / 2, '\u2715', {
      fontSize: '22px', color: '#cc6666', padding: { x: 8, y: 4 } }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', function (this: any) { this.setColor('#ff8888'); })
      .on('pointerout', function (this: any) { this.setColor('#cc6666'); })
      .on('pointerdown', () => toggleQuestLog(scene)));

    // 当前任务（多任务队列）
    let cy = oy + th + 20;
    p.add(scene.add.text(ox + 30, cy, '\u5f53\u524d\u4efb\u52a1', { fontSize: '16px', color: '#88aacc', fontStyle: 'bold', padding: { y: 3 } }));
    cy += 30;
    if (GameState.activeQuests.length === 0) {
      p.add(scene.add.text(ox + 30, cy, '\u65e0\u6d3b\u8dc3\u4efb\u52a1\uff0c\u53bb\u627eNPC\u5bf9\u8bdd\u6216\u4efb\u52a1\u677f\u63a5\u53d6\u4efb\u52a1\u5427\u3002', { fontSize: '13px', color: '#667788', padding: { y: 2 } }));
      cy += 24;
    } else {
      for (const aid of GameState.activeQuests) {
        const q = getQuestDef(aid);
        if (!q) continue;
        const ready = GameState.isQuestReady(aid);
        p.add(scene.add.text(ox + 30, cy, `${ready ? '\u2713' : '\u2605'} ${q.name}`, { fontSize: '15px', color: ready ? '#88cc88' : '#ffe8b0', fontStyle: 'bold', padding: { y: 2 } }));
        cy += 22;
        const prog = GameState.questProgress[aid] || {};
        for (const obj of q.objectives) {
          const pv = prog[obj.target] || 0;
          const done = pv >= obj.count;
          p.add(scene.add.text(ox + 50, cy, `${done ? '\u2713' : '\u25cb'} ${obj.desc} ${Math.min(pv, obj.count)}/${obj.count}`, {
            fontSize: '12px', color: done ? '#88cc88' : '#ccccdd', padding: { y: 1 } }));
          cy += 19;
        }
        cy += 4;
        let rewardStr = '\u5956\u52b1: ';
        if (q.rewards.gold) rewardStr += `${q.rewards.gold}\u91d1\u5e01 `;
        if (q.rewards.exp) rewardStr += `${q.rewards.exp}\u7ecf\u9a8c `;
        if (q.rewards.items) rewardStr += q.rewards.items.map(it => `${it.name}\u00d7${it.count}`).join(' ');
        if (q.rewards.unlock) rewardStr += `\u89e3\u9501:${q.rewards.unlock}`;
        p.add(scene.add.text(ox + 30, cy, rewardStr, { fontSize: '11px', color: '#ffcc44', padding: { y: 1 } }));
        cy += 22;
      }
    }

    // 分割线
    cy += 10;
    const sep = scene.add.graphics(); sep.lineStyle(1, 0x334466, 0.4); sep.lineBetween(ox + 30, cy, ox + ow - 30, cy); p.add(sep);
    cy += 16;

    // 主线任务列表（全部）
    p.add(scene.add.text(ox + 30, cy, '主线任务', { fontSize: '16px', color: '#88aacc', fontStyle: 'bold', padding: { y: 3 } }));
    cy += 28;
    const colW2 = (ow - 60) / 2;
    let mainIdx = 0;
    for (const questId of MAIN_QUEST_ORDER) {
      const quest = MAIN_QUESTS[questId];
      if (!quest) continue;
      const isCompleted = GameState.questCompleted.includes(questId);
      const isActive = GameState.isQuestActive(questId);
      const isAvailable = !isCompleted && !isActive && (!quest.prerequisite || GameState.questCompleted.includes(quest.prerequisite));
      const col = mainIdx % 2, row = Math.floor(mainIdx / 2);
      const mx = ox + 30 + col * colW2, my = cy + row * 22;
      let icon = '\u25cb', color = '#556677';
      if (isCompleted) { icon = '\u2713'; color = '#558855'; }
      else if (isActive) { icon = '\u2605'; color = '#ffe8b0'; }
      else if (isAvailable) { icon = '\u25cb'; color = '#aabbcc'; }
      else { icon = '\u25a6'; color = '#445566'; } // 锁定
      const chLabel = quest.chapter === 0 ? '\u5e8f\u7ae0' : `\u7b2c${quest.chapter}\u7ae0`;
      p.add(scene.add.text(mx, my, `${icon} [${chLabel}] ${quest.name}`, { fontSize: '12px', color, fontStyle: isActive ? 'bold' : 'normal', padding: { y: 1 } }));
      mainIdx++;
    }
    cy += Math.ceil(mainIdx / 2) * 22 + 16;

    // 分割线2
    const sep2 = scene.add.graphics(); sep2.lineStyle(1, 0x334466, 0.4); sep2.lineBetween(ox + 30, cy, ox + ow - 30, cy); p.add(sep2);
    cy += 16;

    // 支线任务
    p.add(scene.add.text(ox + 30, cy, '支线任务', { fontSize: '16px', color: '#88aacc', fontStyle: 'bold', padding: { y: 3 } }));
    cy += 28;
    const sideQuests = Object.values(SIDE_QUESTS);
    sideQuests.forEach((sq, i) => {
      const isCompleted = GameState.questCompleted.includes(sq.id);
      const isActive = GameState.isQuestActive(sq.id);
      const isAvailable = !isCompleted && !isActive && (!sq.prerequisite || GameState.questCompleted.includes(sq.prerequisite));
      const col = i % 2, row = Math.floor(i / 2);
      const sx2 = ox + 30 + col * colW2, sy2 = cy + row * 22;
      let icon = '\u25cb', color = '#556677';
      if (isCompleted) { icon = '\u2713'; color = '#558855'; }
      else if (isActive) { icon = '\u2605'; color = '#ffe8b0'; }
      else if (isAvailable) { icon = '\u25cb'; color = '#aabbcc'; }
      else { icon = '\u25a6'; color = '#445566'; }
      p.add(scene.add.text(sx2, sy2, `${icon} ${sq.name} (${sq.acceptFrom})`, { fontSize: '12px', color, fontStyle: isActive ? 'bold' : 'normal', padding: { y: 1 } }));
    });

    const fy = oy + oh - 28; const ft = scene.add.graphics();
    ft.fillStyle(0x1a1a36, 0.8); ft.fillRoundedRect(ox + 4, fy, ow - 8, 24, { tl: 0, tr: 0, bl: 10, br: 10 }); p.add(ft);
    p.add(scene.add.text(GAME_WIDTH / 2, fy + 12, 'L\u952e \u5f00\u5173  |  ESC \u5173\u95ed  |  \u2605\u8fdb\u884c\u4e2d  \u2713\u5b8c\u6210  \u25cb\u53ef\u63a5\u53d6  \u25a6\u9501\u5b9a', {
      fontSize: '11px', color: '#556688', padding: { y: 2 } }).setOrigin(0.5));
  }

// ═══ 任务板（每日 / 周常）═══
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

function renderBoardSection(scene: GameScene, p: Phaser.GameObjects.Container, ox: number, ow: number, startY: number, title: string, poolIds: string[], completedToday: string[], cap: number): number {
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

function claimBoardQuest(scene: GameScene, id: string): void {
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

export function toggleBestiaryPanel(scene: GameScene): void { if (scene.bestiaryPanel) { closeBestiaryPanel(scene); return; } scene.pauseForMenu(); renderBestiaryPanel(scene); }

export function closeBestiaryPanel(scene: GameScene): void { if (scene.titlePanel) { scene.titlePanel.destroy(true); scene.titlePanel = null; } if (scene.bestiaryPanel) { scene.bestiaryPanel.destroy(true); scene.bestiaryPanel = null; scene.resumeFromMenu(); } }

export function closeTitlePanel(scene: GameScene): void {
  if (scene.titlePanel) { scene.titlePanel.destroy(true); scene.titlePanel = null; }
  if ((scene as any).titleWheelHandler) { scene.input.off('wheel', (scene as any).titleWheelHandler); (scene as any).titleWheelHandler = null; }
  if ((scene as any).titleMoveHandler) { scene.input.off('pointermove', (scene as any).titleMoveHandler); (scene as any).titleMoveHandler = null; }
  if ((scene as any).titleUpHandler) { scene.input.off('pointerup', (scene as any).titleUpHandler); (scene as any).titleUpHandler = null; }
}

export function toggleTitlePanel(scene: GameScene): void { if (scene.titlePanel) { closeTitlePanel(scene); } else { renderTitlePanel(scene); } }

export function renderTitlePanel(scene: GameScene): void {
    closeTitlePanel(scene);
    const cam=scene.cameras.main;
    const c=scene.add.container(Math.round(cam.scrollX),Math.round(cam.scrollY)).setDepth(320);scene.titlePanel=c;
    const vw=GAME_WIDTH,vh=GAME_HEIGHT,mw=560,mh=470,mx=(vw-mw)/2,my=(vh-mh)/2;
    const ov=scene.add.graphics();ov.fillStyle(0,0.55);ov.fillRect(0,0,vw,vh);ov.setInteractive(new Phaser.Geom.Rectangle(0,0,vw,vh),Phaser.Geom.Rectangle.Contains);c.add(ov);
    const bg=scene.add.graphics();bg.fillStyle(0x121222,0.985);bg.fillRoundedRect(mx,my,mw,mh,12);bg.lineStyle(2,0x6a5a3a,0.7);bg.strokeRoundedRect(mx,my,mw,mh,12);c.add(bg);
    c.add(scene.add.text(mx+mw/2,my+26,'◆  称  号  ◆',{fontSize:'20px',color:'#e8d5a3',fontStyle:'bold',padding:{y:3}}).setOrigin(0.5));
    const closeT=scene.add.text(mx+mw-30,my+26,'✕',{fontSize:'20px',color:'#cc6666',padding:{x:6,y:4}}).setOrigin(0.5).setInteractive({useHandCursor:true});
    closeT.on('pointerover',function(this:any){this.setColor('#ff8888');});closeT.on('pointerout',function(this:any){this.setColor('#cc6666');});
    closeT.on('pointerdown',()=>closeTitlePanel(scene));c.add(closeT);
    c.add(scene.add.text(mx+mw/2,my+50,'装备称号可获得对应加成（同时仅生效一个）',{fontSize:'11px',color:'#6677aa',padding:{y:2}}).setOrigin(0.5));
    // 滚动视口（内容超出时裁剪 + 滚动条）
    const viewTop=my+72, viewBottom=my+mh-56, viewH=viewBottom-viewTop, rowH=72;
    const listX=mx+24;
    const contentH=BESTIARY_TITLES.length*rowH;
    const scrollable=contentH>viewH;
    const scrollContent=scene.add.container(0,0);c.add(scrollContent);
    const rowBtns: Phaser.GameObjects.Text[] = [];
    BESTIARY_TITLES.forEach((def,i)=>{
      const ry=i*rowH;const st=(GameState as any).getTitleStatus(def);const isActive=(GameState as any).activeTitle===def.id;
      const rowBg=scene.add.graphics();rowBg.fillStyle(st.unlocked?(isActive?0x2a2410:0x152028):0x12121e,0.85);rowBg.fillRoundedRect(listX,ry,mw-48,rowH-8,8);rowBg.lineStyle(1,st.unlocked?(isActive?0xc9a96e:0x3a5a6a):0x2a2a3a,0.7);rowBg.strokeRoundedRect(listX,ry,mw-48,rowH-8,8);scrollContent.add(rowBg);
      const nc=st.unlocked?(isActive?'#ffcc44':'#cfe8ff'):'#556688';
      scrollContent.add(scene.add.text(listX+14,ry+10,def.name,{fontSize:'15px',color:nc,fontStyle:'bold',padding:{y:1}}));
      scrollContent.add(scene.add.text(listX+14,ry+32,`条件：${def.conditionDesc}`,{fontSize:'11px',color:'#8899bb',padding:{y:1}}));
      scrollContent.add(scene.add.text(listX+14,ry+50,`效果：${def.effectDesc}`,{fontSize:'11px',color:def.effectDesc==='无特殊效果'?'#667788':'#aadd88',padding:{y:1}}));
      if(st.unlocked){
        const btnLabel=isActive?'卸下':'装备';
        const ab=scene.add.text(listX+mw-48-72,ry+rowH/2-12,`[ ${btnLabel} ]`,{fontSize:'12px',color:isActive?'#ffcc66':'#88ccff',fontStyle:'bold',backgroundColor:isActive?'#3a2e00aa':'#002233aa',padding:{x:10,y:5}}).setOrigin(0,0.5).setInteractive({useHandCursor:true});
        ab.on('pointerover',()=>ab.setColor('#ffffff'));ab.on('pointerout',()=>ab.setColor(isActive?'#ffcc66':'#88ccff'));
        ab.on('pointerdown',()=>{ if(isOnline()) requestSetTitle(def.id); else (GameState as any).setActiveTitle(def.id); scene.broadcastTitle(); closeTitlePanel(scene); renderBestiaryPanel(scene); });
        (ab as any)._localY=ry;
        (ab as any)._enabled=!scrollable;
        if(scrollable) ab.disableInteractive();
        rowBtns.push(ab);
        scrollContent.add(ab);
      }else{
        scrollContent.add(scene.add.text(listX+mw-48-130,ry+rowH/2,st.progress,{fontSize:'11px',color:'#7788aa',padding:{y:1}}).setOrigin(0,0.5));
      }
    });
    if(scrollable){
      const maskG=scene.make.graphics({});maskG.fillStyle(0xffffff);maskG.fillRect(cam.scrollX+mx,cam.scrollY+viewTop,mw-22,viewH);
      scrollContent.setMask(maskG.createGeometryMask());
    }
    // 滚动条（轨道 + 手柄）
    const sbX=mx+mw-13; let scrollY=0; const scrollBar=scene.add.graphics();c.add(scrollBar);
    function updateScroll():void{
      scrollY=Phaser.Math.Clamp(scrollY, viewH-contentH, 0);
      scrollContent.y=viewTop+scrollY;
      scrollBar.clear();
      if(scrollable){
        const thumbH=Math.max(24, viewH*viewH/contentH);
        const progress=(contentH>viewH)?scrollY/(viewH-contentH):0;
        const ty=viewTop+progress*(viewH-thumbH);
        scrollBar.fillStyle(0x000000,0.35);scrollBar.fillRoundedRect(sbX-3,viewTop,6,viewH,3);
        scrollBar.fillStyle(0x99aacc,0.6);scrollBar.fillRoundedRect(sbX-3,ty,6,thumbH,3);
        // 越界（被遮罩裁掉）的装备/卸下按钮自动禁用，避免误触
        for(const b of rowBtns){const rel=((b as any)._localY)+scrollY;const vis=rel>=-rowH&&rel<=viewH;const en=(b as any)._enabled===true;if(vis&&!en){b.setInteractive({useHandCursor:true});(b as any)._enabled=true;}else if(!vis&&en){b.disableInteractive();(b as any)._enabled=false;}}
      }
    }
    updateScroll();
    // 交互：滚轮 + 拖动手柄
    const onWheel=(_p:any,_o:any,_dx:number,dy:number)=>{ if(!scrollable)return; scrollY-=dy*0.5; updateScroll(); };
    scene.input.on('wheel',onWheel);
    let dragging=false;
    const onMove=(p:any)=>{ if(!dragging||!scrollable)return; const rel=p.worldY-cam.scrollY-viewTop; const thumbH=Math.max(24,viewH*viewH/contentH); const newTop=Phaser.Math.Clamp(rel-thumbH/2,0,viewH-thumbH); const progress=newTop/(viewH-thumbH); scrollY=progress*(viewH-contentH); updateScroll(); };
    const onUp=()=>{dragging=false;};
    scrollBar.setInteractive(new Phaser.Geom.Rectangle(sbX-8,viewTop,16,viewH),Phaser.Geom.Rectangle.Contains);
    scrollBar.on('pointerdown',()=>{dragging=true;});
    scene.input.on('pointermove',onMove);
    scene.input.on('pointerup',onUp);
    (scene as any).titleWheelHandler=onWheel;(scene as any).titleMoveHandler=onMove;(scene as any).titleUpHandler=onUp;
    // 底部：卸下当前称号（固定在面板底部，不随滚动）
    const footY=my+mh-36;
    const noneBtn=scene.add.text(mx+mw/2,footY,(GameState as any).activeTitle?'[ 卸下当前称号 ]':'（当前未装备称号）',{fontSize:'12px',color:(GameState as any).activeTitle?'#cc8888':'#556688',padding:{y:2}}).setOrigin(0.5).setInteractive({useHandCursor:(GameState as any).activeTitle?true:false});
    if((GameState as any).activeTitle){
      noneBtn.on('pointerover',()=>noneBtn.setColor('#ffaaaa'));noneBtn.on('pointerout',()=>noneBtn.setColor('#cc8888'));
      noneBtn.on('pointerdown',()=>{ if(isOnline()) requestSetTitle(null); else (GameState as any).setActiveTitle(null); scene.broadcastTitle(); closeTitlePanel(scene); renderBestiaryPanel(scene); });
    }
    c.add(noneBtn);
  }

export function renderBestiaryPanel(scene: GameScene): void {
    if (scene.bestiaryPanel) { scene.bestiaryPanel.destroy(true); scene.bestiaryPanel = null; }
    const cam=scene.cameras.main;const c=scene.add.container(Math.round(cam.scrollX),Math.round(cam.scrollY)).setDepth(300);scene.bestiaryPanel=c;
    const ov=scene.add.graphics();ov.fillStyle(0,0.78);ov.fillRect(0,0,GAME_WIDTH,GAME_HEIGHT);ov.setInteractive(new Phaser.Geom.Rectangle(0,0,GAME_WIDTH,GAME_HEIGHT),Phaser.Geom.Rectangle.Contains);c.add(ov);
    const ox=30,oy=20,ow=GAME_WIDTH-60,oh=GAME_HEIGHT-40;
    const bg=scene.add.graphics();bg.fillStyle(0x121222,0.98);bg.fillRoundedRect(ox,oy,ow,oh,12);bg.lineStyle(2,0x4a5a8a,0.6);bg.strokeRoundedRect(ox,oy,ow,oh,12);c.add(bg);
    const th=54;const tb=scene.add.graphics();tb.fillStyle(0x1a1a36,1);tb.fillRoundedRect(ox+4,oy+4,ow-8,th,{tl:10,tr:10,bl:0,br:0});c.add(tb);
    c.add(scene.add.text(GAME_WIDTH/2,oy+th/2,'◆  妖 魔 图 鉴  ◆',{fontSize:'22px',color:'#e8d5a3',fontStyle:'bold',padding:{y:3}}).setOrigin(0.5));
    c.add(scene.add.text(ox+ow-40,oy+th/2,'✕',{fontSize:'22px',color:'#cc6666',padding:{x:8,y:4}}).setOrigin(0.5).setInteractive({useHandCursor:true}).on('pointerover',function(this:any){this.setColor('#ff8888');}).on('pointerout',function(this:any){this.setColor('#cc6666');}).on('pointerdown',()=>closeBestiaryPanel(scene)));
    const ty=oy+th+16;const cw=(ow-60)/4;const rd=getBestiaryTierReached(GameState.bestiaryKilled);const tn=Object.keys(NAMED_ENEMIES).length;
    BESTIARY_TIERS.forEach((tr,ti)=>{const cx=ox+14+ti*(cw+12);const ir=rd>=tr.id;const ic=GameState.bestiaryTierClaimed.includes(tr.id);const pg=getBestiaryTierProgress(tr.id,GameState.bestiaryKilled);const pt=pg.total>0?pg.completed/pg.total:0;const cc=ir?parseInt(tr.color.replace('#',''),16):0x222244;const cb=scene.add.graphics();cb.fillStyle(cc,ir?0.18:0.12);cb.fillRoundedRect(cx,ty,cw,100,8);cb.lineStyle(1,cc,ir?0.6:0.25);cb.strokeRoundedRect(cx,ty,cw,100,8);c.add(cb);const ic2=ir?parseInt(tr.color.replace('#',''),16):0x444466;const ico=scene.add.graphics();ico.fillStyle(ic2,ir?1:0.5);ico.fillCircle(cx+20,ty+20,6);ico.lineStyle(2,ic2,0.7);ico.strokeCircle(cx+20,ty+20,9);c.add(ico);c.add(scene.add.text(cx+34,ty+11,tr.name,{fontSize:'14px',color:ir?tr.color:'#666688',fontStyle:'bold',padding:{y:2}}));c.add(scene.add.text(cx+34,ty+32,`每类×${tr.requiredKills}杀`,{fontSize:'10px',color:'#555577',padding:{y:1}}));const by2=ty+52,bw=cw-28;c.add(scene.add.rectangle(cx+14+bw/2,by2,bw,6,0x111122,0.9));if(pt>0){const fw=Math.max(2,bw*pt);c.add(scene.add.rectangle(cx+14+fw/2,by2,fw,5,ir?parseInt(tr.color.replace('#',''),16):0x334466,1));}const bty=ty+68;if(ic){c.add(scene.add.text(cx+cw/2,bty,'✔ 已领取',{fontSize:'12px',color:'#558855',fontStyle:'bold',padding:{y:1}}).setOrigin(0.5));}else if(ir){const bt=scene.add.text(cx+cw/2,bty,'[ 领取奖励 ]',{fontSize:'12px',color:'#ffcc44',fontStyle:'bold',backgroundColor:'#33220088',padding:{x:10,y:4}}).setOrigin(0.5).setInteractive({useHandCursor:true});bt.on('pointerover',()=>{bt.setColor('#ffff88');bt.setBackgroundColor('#443300aa');});bt.on('pointerout',()=>{bt.setColor('#ffcc44');bt.setBackgroundColor('#33220088');});bt.on('pointerdown',()=>{if(isOnline()) requestClaimBestiaryTier(tr.id); else GameState.claimBestiaryTierReward(tr.id); closeBestiaryPanel(scene); renderBestiaryPanel(scene);});c.add(bt);}else{c.add(scene.add.text(cx+cw/2,bty,`${Math.round(pt*100)}% · ${pg.completed}/${pg.total}`,{fontSize:'10px',color:'#556688',padding:{y:1}}).setOrigin(0.5));c.add(scene.add.text(cx+cw/2,bty+16,tr.reward.desc,{fontSize:'9px',color:'#444466',padding:{y:1},wordWrap:{width:cw-10}}).setOrigin(0.5));}});
    const sy2=ty+130;const sp=scene.add.graphics();sp.lineStyle(1,0x3a4a6a,0.5);sp.lineBetween(ox+14,sy2,ox+ow-14,sy2);c.add(sp);
    const bodyY=sy2+14,bh=oh-(sy2-oy)-36,lw=380,dw2=ow-lw-40,lx=ox+14,dx2=lx+lw+16;
    const lb=scene.add.graphics();lb.fillStyle(0x0e0e22,0.7);lb.fillRoundedRect(lx,bodyY,lw,bh,6);lb.lineStyle(1,0x334466,0.4);lb.strokeRoundedRect(lx,bodyY,lw,bh,6);c.add(lb);
    const enc=GameState.bestiaryEncountered;c.add(scene.add.text(lx+12,bodyY+10,`已遭遇 ${enc.length} / ${tn}`,{fontSize:'12px',color:'#8899cc',fontStyle:'bold',padding:{y:2}}));
    // 当前称号 + 称号按钮
    const activeTD=(GameState as any).getActiveTitleDef ? (GameState as any).getActiveTitleDef() : null;
    c.add(scene.add.text(lx+lw-205,bodyY+10,`称号：${activeTD?activeTD.name:'无'}`,{fontSize:'11px',color:activeTD?'#ffcc66':'#6677aa',fontStyle:'bold',padding:{y:2}}));
    const tBtn=scene.add.text(lx+lw-92,bodyY+6,'[ 称号 ]',{fontSize:'12px',color:'#ffcc44',fontStyle:'bold',backgroundColor:'#33220088',padding:{x:8,y:4}}).setInteractive({useHandCursor:true});
    tBtn.on('pointerover',()=>{tBtn.setColor('#ffff88');tBtn.setBackgroundColor('#443300aa');});
    tBtn.on('pointerout',()=>{tBtn.setColor('#ffcc44');tBtn.setBackgroundColor('#33220088');});
    tBtn.on('pointerdown',()=>{renderTitlePanel(scene);});
    c.add(tBtn);
    const an=Object.entries(NAMED_ENEMIES);const ih=26,mv=Math.floor((bh-40)/ih);const lc=scene.add.container(lx,bodyY+34);c.add(lc);
    an.forEach(([nm,df],i)=>{if(i>=mv)return;const ry=i*ih;const en=GameState.bestiaryEncountered.includes(nm);const kl=GameState.bestiaryKilled[nm]||0;const ib2=df.type==='妖将'||df.type==='妖王';const rw=scene.add.container(0,ry);const rb=scene.add.rectangle(2,0,lw-6,ih-2,en?0x152525:0x121222,0.8);rb.setOrigin(0,0);rw.add(rb);if(ib2)rw.add(scene.add.text(8,3,'👑',{fontSize:'11px',padding:{y:1}}));const nc2=en?(ib2?'#ffcc44':df.type==='恶妖'?'#ff8866':'#bbbbdd'):'#444466';rw.add(scene.add.text(ib2?24:10,4,en?nm:'???',{fontSize:'12px',color:nc2,fontStyle:en&&ib2?'bold':'normal',padding:{y:1}}));if(en&&df.element&&df.element!=='无'){const ec2:Record<string,string>={火:'#ff6644',水:'#4488ff',风:'#44cc88',土:'#cc9944',暗:'#8844cc',光:'#ffdd44'};rw.add(scene.add.text(lw-110,4,df.element,{fontSize:'10px',color:ec2[df.element]||'#888888',padding:{y:1}}));}if(kl>0)rw.add(scene.add.text(lw-55,4,`×${kl}`,{fontSize:'11px',color:'#668866',fontStyle:'bold',padding:{y:1}}));rb.setInteractive({useHandCursor:true});rb.on('pointerover',()=>rb.setFillStyle(0x1a2a3a,1));rb.on('pointerout',()=>rb.setFillStyle(en?0x152525:0x121222,0.8));rb.on('pointerdown',()=>{showBestiaryDetail(scene, dx2,bodyY,dw2,bh,nm,df,en,kl,c);});lc.add(rw);});
    const rb2=scene.add.graphics();rb2.fillStyle(0x0e0e22,0.7);rb2.fillRoundedRect(dx2,bodyY,dw2,bh,6);rb2.lineStyle(1,0x334466,0.4);rb2.strokeRoundedRect(dx2,bodyY,dw2,bh,6);c.add(rb2);
    c.add(scene.add.text(dx2+dw2/2,bodyY+bh/2-20,'← 点击左侧敌人',{fontSize:'16px',color:'#334466',padding:{y:2}}).setOrigin(0.5));
    c.add(scene.add.text(dx2+dw2/2,bodyY+bh/2+10,'查看详细信息',{fontSize:'14px',color:'#223355',padding:{y:2}}).setOrigin(0.5));
    const fy2=bodyY+bh+6;const ft=scene.add.graphics();ft.fillStyle(0x1a1a36,0.8);ft.fillRoundedRect(ox+4,fy2,ow-8,24,{tl:0,tr:0,bl:10,br:10});c.add(ft);
    c.add(scene.add.text(GAME_WIDTH/2,fy2+12,'N键 开关  |  ESC 关闭  |  点击敌人查看详情',{fontSize:'11px',color:'#556688',padding:{y:2}}).setOrigin(0.5));
  }

export function showBestiaryDetail(scene: GameScene, x:number,y:number,w:number,h:number,nm:string,df:any,en:boolean,kl:number,pa:Phaser.GameObjects.Container):void {
    if(scene.bestiaryDetailContainer)scene.bestiaryDetailContainer.destroy(true);scene.bestiaryDetailContainer=scene.add.container(x,y);pa.add(scene.bestiaryDetailContainer);const dc=scene.bestiaryDetailContainer,pad=14;
    if(!en){dc.add(scene.add.text(w/2,h/2-30,'？',{fontSize:'48px',color:'#334466',fontStyle:'bold',padding:{y:4}}).setOrigin(0.5));dc.add(scene.add.text(w/2,h/2+30,'尚未遭遇',{fontSize:'16px',color:'#445566',padding:{y:2}}).setOrigin(0.5));dc.add(scene.add.text(w/2,h/2+56,'击败后解锁详细信息',{fontSize:'12px',color:'#334455',padding:{y:2}}).setOrigin(0.5));return;}
    const ib=df.type==='妖将'||df.type==='妖王';const nc=ib?'#ffcc44':df.type==='恶妖'?'#ff8866':'#ddddff';dc.add(scene.add.text(pad,pad,nm,{fontSize:'22px',color:nc,fontStyle:'bold',padding:{y:3}}));
    const tc:Record<string,string>={杂妖:'#6688aa',恶妖:'#cc6644',妖将:'#cc8844',妖王:'#cc4444'};dc.add(scene.add.text(pad,pad+32,df.type,{fontSize:'11px',color:tc[df.type]||'#666688',fontStyle:'bold',backgroundColor:'#00000066',padding:{x:8,y:3}}));
    dc.add(scene.add.text(w-pad-80,pad+4,`击杀 ×${kl}`,{fontSize:'13px',color:'#8899cc',fontStyle:'bold',padding:{y:2}}));
    let cy=pad+68;const lh=22;const ec:Record<string,string>={火:'#ff6644',水:'#4488ff',风:'#44cc88',土:'#cc9944',暗:'#8844cc',光:'#ffdd44',无:'#888899'};
    [{l:'元素',v:df.element,c:ec[df.element]||'#888899'},{l:'弱点',v:df.weakness||'无',c:df.weakness?'#ff8866':'#666688'},{l:'抗性',v:df.resist||'无',c:df.resist?'#6688cc':'#666688'}].forEach(p=>{dc.add(scene.add.text(pad+8,cy,`${p.l}：`,{fontSize:'12px',color:'#7788aa',padding:{y:1}}));dc.add(scene.add.text(pad+60,cy,p.v,{fontSize:'12px',color:p.c,fontStyle:'bold',padding:{y:1}}));cy+=lh;});
    cy+=6;const h1=scene.add.graphics();h1.lineStyle(1,0x2a3a4a,0.4);h1.lineBetween(pad,cy,w-pad,cy);dc.add(h1);cy+=12;
    const sn:Record<string,string>={灼烧:'灼烧',冻结:'冻结',中毒:'中毒',寄生:'寄生',减速:'减速',眩晕:'眩晕',禁锢:'禁锢',嘲讽:'嘲讽',恐惧:'恐惧',攻降:'攻降',防降:'防降',降灵压:'降灵压'};
    const es=Object.entries(df.statusResist||{});if(es.length===0){dc.add(scene.add.text(pad+8,cy,'无特殊抗性',{fontSize:'11px',color:'#556688',padding:{y:2}}));cy+=lh;}
    else{es.forEach(([k,v]:any,i:number)=>{const col=i%2;const sx=pad+8+col*(w/2-8);const pct=Math.round(v*100);const sc=pct>=80?'#ff5555':pct>=40?'#ffaa44':'#66cc66';dc.add(scene.add.text(sx,cy+Math.floor(i/2)*lh,`${sn[k]||k} ${pct}%`,{fontSize:'11px',color:sc,padding:{y:2}}));});cy+=Math.ceil(es.length/2)*lh;}
    cy+=6;const h2=scene.add.graphics();h2.lineStyle(1,0x2a3a4a,0.4);h2.lineBetween(pad,cy,w-pad,cy);dc.add(h2);cy+=12;
    if(df.skills?.length){df.skills.forEach((s:any)=>{const dt=s.damageType==='magical'?'魔':'物';dc.add(scene.add.text(pad+8,cy,`✦ ${s.name} [${dt}×${s.power}]`,{fontSize:'12px',color:'#ddbbee',fontStyle:'bold',padding:{y:1}}));cy+=lh;if(s.desc){dc.add(scene.add.text(pad+16,cy,s.desc,{fontSize:'10px',color:'#7788aa',wordWrap:{width:w-pad*2-16},padding:{y:1}}));cy+=18;}});cy+=4;const h3=scene.add.graphics();h3.lineStyle(1,0x2a3a4a,0.4);h3.lineBetween(pad,cy,w-pad,cy);dc.add(h3);cy+=12;}
    if(df.drops?.length){df.drops.forEach((d:any)=>{dc.add(scene.add.text(pad+8,cy,`◆ ${d.item}`,{fontSize:'12px',color:'#88cc88',padding:{y:1}}));dc.add(scene.add.text(w-pad-50,cy,`${Math.round(d.rate*100)}%`,{fontSize:'11px',color:'#669966',padding:{y:1}}));cy+=lh;});cy+=4;const h4=scene.add.graphics();h4.lineStyle(1,0x2a3a4a,0.4);h4.lineBetween(pad,cy,w-pad,cy);dc.add(h4);cy+=12;}
    if(kl>=3&&df.lore){dc.add(scene.add.text(pad,cy,'背景笔记',{fontSize:'13px',color:'#8899cc',fontStyle:'bold',padding:{y:2}}));cy+=lh+4;dc.add(scene.add.text(pad+8,cy,df.lore,{fontSize:'11px',color:'#ccbb88',wordWrap:{width:w-pad*2-8},padding:{y:2}}));}
    else if(kl>0&&kl<3){dc.add(scene.add.text(pad,cy,`再击败 ${3-kl} 次解锁背景笔记`,{fontSize:'11px',color:'#556688',padding:{y:2}}));}
  }

  // ═══════════════════════════════════════════
  //  PVP 竞技场面板
  // ═════════════════════════════════════════

  /** 最近一次服务端竞技场状态（由 GameScene 的 arenaStatus 消息写入）。 */
  let arenaStatusCache: any = null;
  /** 当前选择的匹配模式。 */
  let arenaSelectedMode: '1v1' | '4v4' = '1v1';
  /** 是否正在匹配中。 */
  let arenaMatching = false;

  export function setArenaStatus(s: any): void { arenaStatusCache = s; }
  export function isArenaMatching(): boolean { return arenaMatching; }
  export function setArenaMatching(v: boolean): void { arenaMatching = v; }

  function showArenaPanel(scene: GameScene): void {
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

  const RANK_NAME: Record<string, string> = { leader: '会长', elder: '长老', member: '成员' };

  // 公会面板 Tab 状态（模块级：避免 refresh() 重建面板时把 Tab 重置回 info，导致"行会商店打不开"）
  let guildPanelTab: 'info' | 'shop' = 'info';

  export function renderGuildPanel(scene: GameScene, resetTab = true): Phaser.GameObjects.Container {
    // 对齐 B/C 面板的坐标策略：容器按开面板瞬间的相机滚动量偏移定位，
    // 不使用 setScrollFactor(0)（否则子对象 Zone 的点击命中会差一个相机滚动量，导致点击偏上）。
    const cam = scene.cameras.main;
    const cx = Math.round(cam.scrollX) + GAME_WIDTH / 2, cy = Math.round(cam.scrollY) + GAME_HEIGHT / 2;
    const c = scene.add.container(cx, cy).setDepth(500);

    // 全屏遮罩（覆盖整屏，拦截面板外点击）
    const ov = scene.add.graphics();
    ov.fillStyle(0, 0.55); ov.fillRect(-GAME_WIDTH / 2, -GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT);
    ov.setInteractive(new Phaser.Geom.Rectangle(-GAME_WIDTH / 2, -GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains);
    c.add(ov);

    const PW = 1000, PH = 720;
    const px = -PW / 2, py = -PH / 2;

    // 面板背景
    const bg = scene.add.graphics();
    bg.fillStyle(0x121222, 0.98); bg.fillRoundedRect(px, py, PW, PH, 14);
    bg.lineStyle(2, 0xc9a96e, 0.7); bg.strokeRoundedRect(px, py, PW, PH, 14);
    c.add(bg);

    // 标题栏
    const tb = scene.add.graphics(); tb.fillStyle(0x1a1a36, 1); tb.fillRoundedRect(px + 2, py + 2, PW - 4, 48, { tl: 12, tr: 12, bl: 0, br: 0 }); c.add(tb);
    c.add(scene.add.text(px + 20, py + 24, '公会', { fontSize: '20px', color: '#e8d5a3', fontStyle: 'bold' }).setOrigin(0, 0.5));
    const close = scene.add.text(px + PW - 20, py + 24, '✕', { fontSize: '22px', color: '#aa6677', fontStyle: 'bold' }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
    close.on('pointerdown', () => scene.closeGuildPanel());
    close.on('pointerover', () => close.setColor('#ff8899'));
    close.on('pointerout', () => close.setColor('#aa6677'));
    c.add(close);

    // 分隔线：左右两列
    const divider = scene.add.graphics();
    divider.lineStyle(1, 0x334466, 0.4); divider.lineBetween(px + PW / 2, py + 58, px + PW / 2, py + PH - 10);
    c.add(divider);

    // HTML 输入框（中文输入支持），随面板销毁自动清理。
    // 记录每个 DOM 框的逻辑坐标，窗口缩放时按当前画布尺寸重新定位，避免“乱跑”。
    const inputs: { el: HTMLInputElement | HTMLTextAreaElement; lx: number; ly: number; w: number; h: number }[] = [];
    const repositionInputs = (): void => {
      const canvas = scene.game.canvas;
      const rect = canvas.getBoundingClientRect();
      const sx = rect.width / GAME_WIDTH, sy = rect.height / GAME_HEIGHT;
      for (const it of inputs) {
        it.el.style.left = (rect.left + (cx + it.lx) * sx - (it.w * sx) / 2) + 'px';
        it.el.style.top = (rect.top + (cy + it.ly) * sy - (it.h * sy) / 2) + 'px';
        it.el.style.width = (it.w * sx) + 'px';
        it.el.style.height = (it.h * sy) + 'px';
      }
    };
    const placeInput = (lx: number, ly: number, w = 280, h = 34, maxLen = 200, initial = ''): HTMLInputElement => {
      const el = document.createElement('input');
      el.type = 'text'; el.maxLength = maxLen; el.value = initial;
      el.style.cssText = 'position:absolute;font-size:15px;color:#ddd;background:#0a0a1e;border:1px solid #446688;border-radius:5px;padding:4px 8px;outline:none;z-index:9999;';
      const canvas = scene.game.canvas;
      const rect = canvas.getBoundingClientRect();
      const sx = rect.width / GAME_WIDTH, sy = rect.height / GAME_HEIGHT;
      el.style.left = (rect.left + (cx + lx) * sx - (w * sx) / 2) + 'px';
      el.style.top = (rect.top + (cy + ly) * sy - (h * sy) / 2) + 'px';
      el.style.width = (w * sx) + 'px'; el.style.height = (h * sy) + 'px';
      document.body.appendChild(el); el.focus();
      inputs.push({ el, lx, ly, w, h });
      return el;
    };

    // 多行文本域（公告编辑用：可自动换行、能看到已输入内容）
    const placeTextarea = (lx: number, ly: number, w = 280, h = 120, maxLen = 500, initial = ''): HTMLTextAreaElement => {
      const el = document.createElement('textarea');
      el.value = initial;
      el.maxLength = maxLen;
      el.style.cssText = 'position:absolute;font-size:14px;line-height:1.5;color:#cdd6e8;background:#0a0a1e;border:1px solid #446688;border-radius:5px;padding:8px 10px;outline:none;resize:none;overflow:auto;z-index:9999;';
      const canvas = scene.game.canvas;
      const rect = canvas.getBoundingClientRect();
      const sx = rect.width / GAME_WIDTH, sy = rect.height / GAME_HEIGHT;
      el.style.left = (rect.left + (cx + lx) * sx - (w * sx) / 2) + 'px';
      el.style.top = (rect.top + (cy + ly) * sy - (h * sy) / 2) + 'px';
      el.style.width = (w * sx) + 'px'; el.style.height = (h * sy) + 'px';
      document.body.appendChild(el); el.focus();
      inputs.push({ el, lx, ly, w, h });
      return el;
    };
    // 窗口缩放时重定位所有 DOM 输入框
    scene.scale.on('resize', repositionInputs);
    c.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.scale.off('resize', repositionInputs);
      inputs.forEach(it => { try { if (it.el.parentNode) it.el.parentNode.removeChild(it.el); } catch {} });
    });

    // 通用按钮
    const btn = (lx: number, ly: number, label: string, color: number, textColor: string, cb: () => void): void => {
      const bw = Math.max(56, label.length * 15 + 20), bh = 28;
      const g = scene.add.graphics();
      g.fillStyle(color, 0.92); g.fillRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6);
      g.lineStyle(1, 0xc9a96e, 0.5); g.strokeRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6);
      const t = scene.add.text(lx, ly, label, { fontSize: '13px', color: textColor, fontStyle: 'bold' }).setOrigin(0.5);
      const z = scene.add.zone(lx, ly, bw, bh).setInteractive({ useHandCursor: true });
      z.on('pointerover', () => { g.clear(); g.fillStyle(color, 1); g.fillRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6); });
      z.on('pointerout', () => { g.clear(); g.fillStyle(color, 0.92); g.fillRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6); });
      z.on('pointerdown', cb);
      c.add([g, t, z]);
    };

    if (resetTab) guildPanelTab = 'info';
    const refresh = () => { scene.closeGuildPanel(); scene.openGuildPanel(false); };
    const toast = (msg: string) => {
      const t = scene.add.text(0, py + 64, msg, { fontSize: '14px', color: '#ffcc88', fontStyle: 'bold' }).setOrigin(0.5);
      c.add(t);
      scene.time.delayedCall(1800, () => t.destroy());
    };

    const loading = scene.add.text(0, 0, '加载中…', { fontSize: '16px', color: '#8899bb' }).setOrigin(0.5);
    c.add(loading);

    GuildClient.info(scene.authToken, scene.characterId).then((r: any) => {
      if (!r || !r.ok) { loading.setText('加载失败：' + (r?.msg || '未知错误')); return; }
      loading.destroy();
      if (!r.inGuild) renderNoGuild();
      else renderInGuild(r);
    }).catch(() => { loading.setText('网络错误'); });

    // ══════════════════════════════════════
    //  未加入公会：左列=创建表单  右列=公会列表
    // ══════════════════════════════════════
    function renderNoGuild(): void {
      // ── 左列：创建公会 ──
      const lx = px + 30;
      c.add(scene.add.text(lx, py + 70, '创建公会', { fontSize: '18px', color: '#e8d5a3', fontStyle: 'bold' }).setOrigin(0, 0.5));

      // 公会名
      c.add(scene.add.text(lx, py + 110, '公会名称', { fontSize: '13px', color: '#8899bb' }).setOrigin(0, 0.5));
      const nameInput = placeInput(lx + 170, py + 110, 260, 32, 12);
      // 初始公告
      c.add(scene.add.text(lx, py + 158, '初始公告（可选）', { fontSize: '13px', color: '#8899bb' }).setOrigin(0, 0.5));
      const noticeInput = placeInput(lx + 190, py + 158, 380, 32, 200);
      btn(lx + 120, py + 210, '创建公会', 0x2a6e4a, '#cfeedd', () => {
        const name = nameInput.value.trim();
        if (!name) { toast('请输入公会名（2-12 字符）'); return; }
        if (name.length < 2 || name.length > 12) { toast('公会名须 2-12 字符'); return; }
        GuildClient.create(scene.authToken, scene.characterId, name, noticeInput.value.trim()).then((res: any) => {
          if (res.ok) { toast('公会「' + name + '」创建成功！'); refresh(); }
          else toast(res.msg || '创建失败');
        });
      });

      // 提示文字
      c.add(scene.add.text(lx, py + 250, '提示：创建后你将成为会长，可审批申请、管理成员。', { fontSize: '11px', color: '#556677', wordWrap: { width: 420 } }).setOrigin(0, 0));

      // ── 右列：公会列表（浏览+申请） ──
      const rx = px + 520;
      c.add(scene.add.text(rx, py + 70, '已有公会', { fontSize: '18px', color: '#e8d5a3', fontStyle: 'bold' }).setOrigin(0, 0.5));
      c.add(scene.add.text(rx, py + 98, '选择一个公会提交申请，等待会长/长老审批后即可加入。', { fontSize: '11px', color: '#556677' }).setOrigin(0, 0));

      GuildClient.list(scene.authToken, scene.characterId).then((res: any) => {
        if (!res || !res.ok) {
          c.add(scene.add.text(rx, py + 130, '⚠ 列表加载失败，请稍后重试', { fontSize: '13px', color: '#cc6644' }).setOrigin(0, 0));
          return;
        }
        const list = res.guilds || [];
        if (list.length === 0) {
          c.add(scene.add.text(rx, py + 130, '（暂无公会，你可以创建一个！）', { fontSize: '13px', color: '#667788' }).setOrigin(0, 0));
          return;
        }
        // 表头
        c.add(scene.add.text(rx, py + 128, '公会名', { fontSize: '12px', color: '#667788' }).setOrigin(0, 0.5));
        c.add(scene.add.text(rx + 200, py + 128, '等级', { fontSize: '12px', color: '#667788' }).setOrigin(0, 0.5));
        c.add(scene.add.text(rx + 270, py + 128, '人数', { fontSize: '12px', color: '#667788' }).setOrigin(0, 0.5));
        // 列表行
        list.slice(0, 12).forEach((g: any, i: number) => {
          const ry = py + 152 + i * 36;
          // 行背景（交替色）
          if (i % 2 === 0) {
            const rowBg = scene.add.graphics();
            rowBg.fillStyle(0x1a1a2e, 0.4); rowBg.fillRoundedRect(rx - 6, ry - 12, 440, 32, 4);
            c.add(rowBg);
          }
          c.add(scene.add.text(rx, ry, `〈${g.name}〉`, { fontSize: '14px', color: '#cdd6e8' }).setOrigin(0, 0.5));
          c.add(scene.add.text(rx + 200, ry, `Lv.${g.level}`, { fontSize: '13px', color: '#99aabb' }).setOrigin(0, 0.5));
          c.add(scene.add.text(rx + 270, ry, `${g.memberCount}人`, { fontSize: '13px', color: '#99aabb' }).setOrigin(0, 0.5));
          btn(rx + 380, ry, '申请加入', 0x33507a, '#bcd4ff', () => {
            GuildClient.apply(scene.authToken, scene.characterId, g.id, '').then((ar: any) => {
              if (ar.ok) toast('已提交申请，等待审批');
              else toast(ar.msg || '申请失败');
            });
          });
        });
      });
    }

    // ══════════════════════════════════════
    //  已加入公会：左列=成员列表  右列=公告展示+编辑
    //  （聊天已移至全局左下角 HUD，频道切换）
    // ══════════════════════════════════════
    function renderInGuild(r: any): void {
      const g = r.guild;
      const meIsLeader = r.myRank === 'leader';
      const meIsElder = r.myRank === 'elder';

      // ══ 顶部 Tab 切换（公会信息 / 行会商店）══
      const switchTab = (t: 'info' | 'shop') => { if (guildPanelTab === t) return; guildPanelTab = t; refresh(); };
      btn(px + PW - 300, py + 24, '公会信息', guildPanelTab === 'info' ? 0x33507a : 0x222244, guildPanelTab === 'info' ? '#bcd4ff' : '#7788aa', () => switchTab('info'));
      btn(px + PW - 210, py + 24, '行会商店', guildPanelTab === 'shop' ? 0x33507a : 0x222244, guildPanelTab === 'shop' ? '#bcd4ff' : '#7788aa', () => switchTab('shop'));

      // 行会商店 Tab：独立渲染，不再显示信息列
      if (guildPanelTab === 'shop') { renderShopTab(r); return; }

      // ── 左列：基本信息 + 成员列表 ──
      const leftX = px + 28;
      const colDivider = px + PW / 2; // 左右分界线 x 坐标

      // 公会名（大标题）
      c.add(scene.add.text(leftX, py + 68, `〈${g.name}〉`, { fontSize: '22px', color: '#ffe8b0', fontStyle: 'bold' }).setOrigin(0, 0.5));
      // 信息行
      c.add(scene.add.text(leftX, py + 102,
        `职位：${RANK_NAME[r.myRank]}   成员：${g.memberCount}人   等级：Lv.${g.level} (${g.exp}/${g.expCap})`,
        { fontSize: '14px', color: '#aabbcc' }).setOrigin(0, 0.5));

      // 分隔线
      const sep1 = scene.add.graphics();
      sep1.lineStyle(1, 0x334466, 0.3); sep1.lineBetween(leftX, py + 126, colDivider - 12, py + 126);
      c.add(sep1);

      // ── 成员列表（可滚动，避免人多溢出）──
      const members = g.members || [];
      // 成员数 / 上限（30 与 server/guild.ts GUILD_MAX_MEMBERS 保持一致）
      c.add(scene.add.text(leftX, py + 142, '成员列表', { fontSize: '16px', color: '#e8d5a3', fontStyle: 'bold' }).setOrigin(0, 0.5));
      c.add(scene.add.text(leftX + 110, py + 142, `${members.length}/30`, { fontSize: '12px', color: '#8aa0c0' }).setOrigin(0, 0.5));
      // 表头（固定，不随滚动）—— 彻底消除与操作按钮的 x 坐标碰撞
      c.add(scene.add.text(leftX + 4, py + 168, '状态', { fontSize: '11px', color: '#556677' }).setOrigin(0, 0.5));
      c.add(scene.add.text(leftX + 34, py + 168, '角色名', { fontSize: '11px', color: '#556677' }).setOrigin(0, 0.5));
      c.add(scene.add.text(leftX + 155, py + 168, '职位', { fontSize: '11px', color: '#556677' }).setOrigin(0, 0.5));
      c.add(scene.add.text(leftX + 210, py + 168, '贡献', { fontSize: '11px', color: '#556677' }).setOrigin(0, 0.5));
      c.add(scene.add.text(colDivider - 100, py + 168, '操作', { fontSize: '11px', color: '#556677' }).setOrigin(0.5));

      // 成员列表滚动（复用模块级 setupScroll：几何遮罩 + 同款滚动条，严格从上到下排列，与称号面板一致）
      setupScroll(scene, c, cx, cy, members, 28, py + 186, py + PH - 86, leftX - 4, colDivider - leftX - 8,
        (m: any, i: number, ry: number, sc: Phaser.GameObjects.Container, btnS: any) => {
          const isLeader = m.rank === 'leader';
          if (i % 2 === 0) {
            const rb = scene.add.graphics();
            rb.fillStyle(0x1a1a2e, 0.35); rb.fillRoundedRect(leftX - 4, ry - 12, colDivider - leftX - 8, 26, 4); sc.add(rb);
          }
          const dot = scene.add.graphics(); dot.fillStyle(0x556677, 1); dot.fillCircle(leftX + 12, ry, 4); sc.add(dot);
          sc.add(scene.add.text(leftX + 34, ry, m.name, { fontSize: '14px', color: isLeader ? '#ffd27a' : '#cdd6e8' }).setOrigin(0, 0.5));
          sc.add(scene.add.text(leftX + 155, ry, RANK_NAME[m.rank], { fontSize: '12px', color: '#8899bb' }).setOrigin(0, 0.5));
          sc.add(scene.add.text(leftX + 210, ry, `${m.contribution || 0}`, { fontSize: '12px', color: '#9fe6a0' }).setOrigin(0, 0.5));
          // 操作按钮：三按钮（升职/转让/踢出）以 52px 等距紧凑靠右，中心 x = colDivider-152/-100/-48
          // 贡献列结束于 leftX+210+30 ≈ -232；升职左边缘 -176 → 间隙 56px，绝对无碰撞
          if (meIsLeader && !isLeader) {
            btnS(colDivider - 152, ry, '升职', 0x33507a, '#bcd4ff', () => {
              GuildClient.setRank(scene.authToken, scene.characterId, m.charId, m.rank === 'elder' ? 'member' : 'elder').then((res: any) => res.ok ? refresh() : toast(res.msg));
            });
            btnS(colDivider - 100, ry, '转让', 0x6a4a2a, '#ffd9a0', () => {
              GuildClient.transfer(scene.authToken, scene.characterId, m.charId).then((res: any) => res.ok ? (toast('已转让会长'), refresh()) : toast(res.msg));
            });
            btnS(colDivider - 48, ry, '踢出', 0x6a2a2a, '#ffb0b0', () => {
              GuildClient.kick(scene.authToken, scene.characterId, m.charId).then((res: any) => res.ok ? refresh() : toast(res.msg));
            });
          } else if (meIsElder && !isLeader && m.rank !== 'elder') {
            // 长老只能踢出：单按钮居中于 colDivider-48
            btnS(colDivider - 48, ry, '踢出', 0x6a2a2a, '#ffb0b0', () => {
              GuildClient.kick(scene.authToken, scene.characterId, m.charId).then((res: any) => res.ok ? refresh() : toast(res.msg));
            });
          }
        });

      // 底部按钮：退出 / 解散
      btn(leftX + 70, py + PH - 44, '退出公会', 0x6a4a2a, '#ffd9a0', () => {
        GuildClient.leave(scene.authToken, scene.characterId)
          .then((res: any) => res.ok ? (toast('已退出公会'), refresh()) : toast(res.msg));
      });
      if (meIsLeader) {
        btn(leftX + 210, py + PH - 44, '解散公会', 0x6a2a2a, '#ffb0b0', () => {
          GuildClient.disband(scene.authToken, scene.characterId)
            .then((res: any) => res.ok ? (toast('公会已解散'), refresh()) : toast(res.msg));
        });
      }

      // ── 右列：公告展示区 + 编辑（替换式） ──
      const rightX = px + 512;
      const noticeBoxW = 456, noticeBoxH = 340;

      // 公告标题
      c.add(scene.add.text(rightX + 8, py + 68, '📜 公告', { fontSize: '15px', color: '#aaccdd', fontStyle: 'bold' }).setOrigin(0, 0.5));
      // 公会贡献池 / 个人贡献（右对齐到公告框右上角）
      c.add(scene.add.text(rightX + 8 + noticeBoxW, py + 68, `贡献 ${g.contribution} · 我的 ${r.myContribution}`, {
        fontSize: '12px', color: '#9fe6a0',
      }).setOrigin(1, 0.5));

      const nbX = rightX + 8, nbY = py + 90;

      // 公告框背景（常驻）
      const nbg = scene.add.graphics();
      nbg.fillStyle(0x0c0c18, 0.65); nbg.fillRoundedRect(nbX, nbY, noticeBoxW, noticeBoxH, 10);
      nbg.lineStyle(1, 0x334466, 0.5); nbg.strokeRoundedRect(nbX, nbY, noticeBoxW, noticeBoxH, 10);
      c.add(nbg);

      // 公告内容文字（可被隐藏/销毁以切换编辑态）
      let noticeTextObj: Phaser.GameObjects.Text | null = null;
      const showNoticeText = (text: string) => {
        noticeTextObj = scene.add.text(nbX + 16, nbY + 14, text, {
          fontSize: '14px', color: '#cdd6e8',
          wordWrap: { width: noticeBoxW - 32 }, padding: { y: 6 }, lineSpacing: 4,
        }).setOrigin(0, 0);
        c.add(noticeTextObj);
      };
      showNoticeText(g.notice || '（暂无公告）');

      // ══ 会长/长老：公告编辑（替换式）══
      // 点击 → textarea 替换公告框内文字（同位置）；保存/取消 → 恢复只读
      if (meIsLeader || meIsElder) {
        const editBtnY = nbY + noticeBoxH + 16;
        let nInput: HTMLTextAreaElement | null = null;
        let saveBtnPlaced = false;

        btn(rightX + 65, editBtnY, '✏ 编辑公告', 0x33507a, '#bcd4ff', () => {
          if (nInput) { nInput.focus(); return; } // 已在编辑态则聚焦
          // 进入编辑：隐藏只读文字
          if (noticeTextObj) { noticeTextObj.destroy(); noticeTextObj = null; }
          // 在公告框内部创建 textarea（与公告框等宽减内边距、等高）
          nInput = placeTextarea(nbX + noticeBoxW / 2, nbY + noticeBoxH / 2, noticeBoxW - 32, noticeBoxH - 36, 500, g.notice || '');
          if (!saveBtnPlaced) {
            btn(rightX + 190, editBtnY, '保存', 0x2a6e4a, '#cfeedd', () => {
              if (!nInput) return;
              GuildClient.setNotice(scene.authToken, scene.characterId, nInput.value.trim())
                .then((res: any) => res.ok ? (toast('公告已更新'), refresh()) : toast(res.msg));
            });
            btn(rightX + 270, editBtnY, '取消', 0x444466, '#aaaacc', () => {
              if (nInput && nInput.parentNode) { nInput.parentNode.removeChild(nInput); nInput = null; }
              showNoticeText(g.notice || '（暂无公告）');
            });
            saveBtnPlaced = true;
          }
        });
      }

      // ══ 公会技能树（v2：全体被动加成，消耗公会贡献池） ══
      {
        const skillY = nbY + noticeBoxH + 56;
        const sep = scene.add.graphics();
        sep.lineStyle(1, 0x334466, 0.25); sep.lineBetween(rightX + 8, skillY - 14, rightX + 8 + noticeBoxW, skillY - 14);
        c.add(sep);
        c.add(scene.add.text(rightX + 8, skillY, '⚔ 公会技能', { fontSize: '14px', color: '#e8d5a3', fontStyle: 'bold' }).setOrigin(0, 0.5));
        const canLearn = meIsLeader || meIsElder;
        GUILD_SKILLS.forEach((sk, i) => {
          const sy = skillY + 28 + i * 30;
          const lv = (g.skills && g.skills[sk.id]) || 0;
          const maxed = lv >= sk.maxLevel;
          c.add(scene.add.text(rightX + 16, sy, `${sk.name}  Lv.${lv}/${sk.maxLevel}  (+${sk.perLevel}%/级)`, {
            fontSize: '13px', color: maxed ? '#ffd27a' : '#cdd6e8',
          }).setOrigin(0, 0.5));
          if (canLearn && !maxed) {
            const cost = guildSkillCost(sk, lv);
            const enough = g.contribution >= cost;
            btn(rightX + 370, sy, `升级(${cost})`, enough ? 0x2a6e4a : 0x444466, enough ? '#cfeedd' : '#8899aa', () => {
              GuildClient.learnSkill(scene.authToken, scene.characterId, sk.id)
                .then((res: any) => res.ok ? refresh() : toast(res.msg));
            });
          } else if (maxed) {
            c.add(scene.add.text(rightX + 370, sy, '已满级', { fontSize: '12px', color: '#ffd27a' }).setOrigin(0.5));
          }
        });
      }

      // ══ 待审申请（公会技能树下方） ══
      const apps = r.applications || [];
      if ((meIsLeader || meIsElder) && apps.length > 0) {
        const ay = nbY + noticeBoxH + 56 + 160; // 技能树块之后
        // 分隔线
        const appSep = scene.add.graphics();
        appSep.lineStyle(1, 0x334466, 0.25); appSep.lineBetween(rightX + 8, ay - 14, rightX + 8 + noticeBoxW, ay - 14);
        c.add(appSep);
        c.add(scene.add.text(rightX + 8, ay, '📋 待审申请', { fontSize: '14px', color: '#e8d5a3', fontStyle: 'bold' }).setOrigin(0, 0.5));
        apps.slice(0, 5).forEach((a: any, i: number) => {
          const ary = ay + 30 + i * 32;
          c.add(scene.add.text(rightX + 12, ary, a.name, { fontSize: '13px', color: '#cdd6e8' }).setOrigin(0, 0.5));
          btn(rightX + 180, ary, '同意', 0x2a6e4a, '#cfeedd', () => {
            GuildClient.handleApply(scene.authToken, scene.characterId, a.id, true)
              .then((res: any) => res.ok ? refresh() : toast(res.msg));
          });
          btn(rightX + 255, ary, '拒绝', 0x6a2a2a, '#ffb0b0', () => {
            GuildClient.handleApply(scene.authToken, scene.characterId, a.id, false)
              .then((res: any) => res.ok ? refresh() : toast(res.msg));
          });
        });
      }
    }

    // ════════════════════════════════════════
    //  行会商店 Tab（个人贡献消费闭环）
    // ════════════════════════════════════════
    function renderShopTab(r: any): void {
      const contentX = px + 40;
      const contentW = PW - 80;

      // 标题 + 个人贡献余额
      c.add(scene.add.text(contentX, py + 70, '行会商店', { fontSize: '22px', color: '#ffe8b0', fontStyle: 'bold' }).setOrigin(0, 0.5));
      c.add(scene.add.text(contentX, py + 104, `我的个人贡献：${r.myContribution}`, { fontSize: '15px', color: '#9fe6a0' }).setOrigin(0, 0.5));
      c.add(scene.add.text(contentX, py + 128,
        '用个人贡献兑换公会专属物资 · 个人贡献通过做日常/周常任务、通关副本累积',
        { fontSize: '12px', color: '#7788aa' }).setOrigin(0, 0.5));

      // 商品分类标签（按 id 前缀归类，避免改动数据层）
      const CAT: Record<string, string> = {
        potion_s_5: 'HP药', potion_l_3: 'HP药', recovery_5: 'HP药', full_heal_1: 'HP药',
        spirit_l_3: 'MP药',
        crystal_3: '材料', silver_3: '材料', core_1: '材料', legend_1: '材料',
        purify_3: '状态', revive_full_1: '状态',
        atk_elixir_2: '增益', matk_elixir_2: '增益',
        title_tongxin: '称号', title_tongpao: '称号',
      };

      // 3 列网格（15 项 → 5 行，紧凑卡片无需滚动，正好落入面板高度）
      const cols = 3, gap = 16, rowGap = 4;
      const cardW = (contentW - gap * (cols - 1)) / cols; // 296
      const cardH = 106;
      const startY = py + 150;
      GUILD_SHOP_ITEMS.forEach((it, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx0 = contentX + col * (cardW + gap);
        const cy0 = startY + row * (cardH + rowGap);

        // 卡片背景
        const card = scene.add.graphics();
        card.fillStyle(0x1a1a2e, 0.6); card.fillRoundedRect(cx0, cy0, cardW, cardH, 10);
        card.lineStyle(1, 0x334466, 0.6); card.strokeRoundedRect(cx0, cy0, cardW, cardH, 10);
        c.add(card);

        // 分类标签
        c.add(scene.add.text(cx0 + 12, cy0 + 10, CAT[it.id] || (it.kind === 'title' ? '称号' : '物资'), {
          fontSize: '11px', color: '#8899bb', backgroundColor: '#22304a', padding: { x: 6, y: 2 },
        }).setOrigin(0, 0));

        // 名称
        c.add(scene.add.text(cx0 + cardW / 2, cy0 + 30, it.name, {
          fontSize: '15px', color: '#ffe8b0', fontStyle: 'bold', align: 'center', wordWrap: { width: cardW - 16 },
        }).setOrigin(0.5, 0));

        // 描述
        c.add(scene.add.text(cx0 + cardW / 2, cy0 + 52, it.desc, {
          fontSize: '12px', color: '#aabbcc', align: 'center', wordWrap: { width: cardW - 20 }, lineSpacing: 2,
        }).setOrigin(0.5, 0));

        // 购买按钮（价格内嵌标签）
        const afford = r.myContribution >= it.price;
        const label = afford ? `购买 · 💎${it.price}` : '贡献不足';
        btn(cx0 + cardW / 2, cy0 + cardH - 20, label,
          afford ? 0x2a6e4a : 0x444466, afford ? '#cfeedd' : '#8899aa', () => {
            if (!afford) { toast('个人贡献不足'); return; }
            requestGuildShopBuy(it.id);
            // 服务端处理有延迟：400ms 后重拉 /info 刷新余额（intentResult 即时提示，worldSync 下发物品/称号）
            scene.time.delayedCall(400, () => refresh());
          });
      });
    }

    return c;
  }

  // ═════════════════════════════════════════
  // 好友面板（O 键）— 非实时管理走 REST，实时通知走 game 房 friendNotify
  // ═════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════
  // 通用滚动列表助手（模块级，好友面板 / 行会成员列表 / 称号面板共用）
  // 几何遮罩裁剪 + 滚动条（轨道+手柄）+ 滚轮/拖拽 + 越界按钮自动禁用
  // 排列严格「从上到下」（首行在视口顶部，scrollY=0 即置顶），与称号面板滚动条完全一致
  // ═══════════════════════════════════════════════════════════════════════════
  function setupScroll(
    scene: GameScene, c: Phaser.GameObjects.Container, cx: number, cy: number,
    items: any[], rowH: number,
    vpTop: number, vpBottom: number,
    colLeft: number, colWidth: number,
    renderRow: (item: any, i: number, ry: number, sc: Phaser.GameObjects.Container, btnS: (lx: number, ly: number, label: string, color: number, textColor: string, cb: () => void) => void) => void
  ): void {
    const viewH = vpBottom - vpTop;
    const contentH = items.length * rowH + 8;
    const scrollable = contentH > viewH;
    const scrollContent = scene.add.container(0, 0); c.add(scrollContent);
    const rowBtns: any[] = [];
    const btnS = (lx: number, ly: number, label: string, color: number, textColor: string, cb: () => void): void => {
      const bw = Math.max(48, label.length * 13 + 16), bh = 24;
      const g = scene.add.graphics();
      g.fillStyle(color, 0.92); g.fillRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6);
      g.lineStyle(1, 0xc9a96e, 0.5); g.strokeRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6);
      const t = scene.add.text(lx, ly, label, { fontSize: '12px', color: textColor, fontStyle: 'bold' }).setOrigin(0.5);
      const z = scene.add.zone(lx, ly, bw, bh).setInteractive({ useHandCursor: true });
      z.on('pointerover', () => { g.clear(); g.fillStyle(color, 1); g.fillRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6); });
      z.on('pointerout', () => { g.clear(); g.fillStyle(color, 0.92); g.fillRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6); });
      z.on('pointerdown', cb);
      (z as any)._localY = ly; (z as any)._enabled = !scrollable;
      if (scrollable) z.disableInteractive();
      scrollContent.add([g, t, z]);
      rowBtns.push(z);
    };
    items.forEach((it, i) => { const ry = 12 + i * rowH; renderRow(it, i, ry, scrollContent, btnS); });
    if (scrollable) {
      const maskG = scene.make.graphics({});
      maskG.fillStyle(0xffffff);
      maskG.fillRect(cx + colLeft, cy + vpTop, colWidth, viewH);
      scrollContent.setMask(maskG.createGeometryMask());
    }
    const sbX = colLeft + colWidth + 4;
    let scrollY = 0;
    const scrollBar = scene.add.graphics(); c.add(scrollBar);
    const updateScroll = (): void => {
      // 关键修复：当 contentH < viewH（非滚动）时，viewH-contentH > 0，Clamp(0, 正数, 0) 的 min>max
      // 会让 Phaser.Math.Clamp 返回 min（= viewH-contentH），导致 scrollContent 被向下推到面板底部。
      // 非滚动场景强制 scrollY=0 即可（本来就不该滚动）。
      if (scrollable) {
        scrollY = Phaser.Math.Clamp(scrollY, viewH - contentH, 0);
      } else {
        scrollY = 0;
      }
      scrollContent.y = vpTop + scrollY;
      scrollBar.clear();
      if (scrollable) {
        const thumbH = Math.max(24, viewH * viewH / contentH);
        const progress = contentH > viewH ? scrollY / (viewH - contentH) : 0;
        const ty = vpTop + progress * (viewH - thumbH);
        scrollBar.fillStyle(0x000000, 0.35); scrollBar.fillRoundedRect(sbX - 3, vpTop, 6, viewH, 3);
        scrollBar.fillStyle(0x99aacc, 0.6); scrollBar.fillRoundedRect(sbX - 3, ty, 6, thumbH, 3);
        for (const b of rowBtns) {
          const rel = (b as any)._localY + scrollY;
          const vis = rel >= -rowH && rel <= viewH;
          const en = (b as any)._enabled === true;
          if (vis && !en) { (b as any).setInteractive({ useHandCursor: true }); (b as any)._enabled = true; }
          else if (!vis && en) { (b as any).disableInteractive(); (b as any)._enabled = false; }
        }
      }
    };
    updateScroll();
    if (scrollable) {
      const onWheel = (pointer: any, _o: any, _dx: number, dy: number) => {
        const wx = pointer.worldX, wy = pointer.worldY;
        const vx0 = cx + colLeft, vy0 = cy + vpTop;
        if (wx < vx0 || wx > vx0 + colWidth || wy < vy0 || wy > vy0 + viewH) return;
        scrollY -= dy * 0.5; updateScroll();
      };
      scene.input.on('wheel', onWheel);
      let dragging = false;
      const onMove = (p: any) => {
        if (!dragging) return;
        const rel = p.worldY - cy - vpTop;
        const thumbH = Math.max(24, viewH * viewH / contentH);
        const newTop = Phaser.Math.Clamp(rel - thumbH / 2, 0, viewH - thumbH);
        scrollY = (viewH - contentH) * (newTop / (viewH - thumbH));
        updateScroll();
      };
      const onUp = () => { dragging = false; };
      scrollBar.setInteractive(new Phaser.Geom.Rectangle(sbX - 8, vpTop, 16, viewH), Phaser.Geom.Rectangle.Contains);
      scrollBar.on('pointerdown', () => { dragging = true; });
      scene.input.on('pointermove', onMove);
      scene.input.on('pointerup', onUp);
      c.once(Phaser.GameObjects.Events.DESTROY, () => {
        scene.input.off('wheel', onWheel);
        scene.input.off('pointermove', onMove);
        scene.input.off('pointerup', onUp);
      });
    }
  }

  export function renderFriendPanel(scene: GameScene): Phaser.GameObjects.Container {
    const cam = scene.cameras.main;
    const cx = Math.round(cam.scrollX) + GAME_WIDTH / 2, cy = Math.round(cam.scrollY) + GAME_HEIGHT / 2;
    const c = scene.add.container(cx, cy).setDepth(500);

    // 全屏遮罩（拦截面板外点击）
    const ov = scene.add.graphics();
    ov.fillStyle(0, 0.55); ov.fillRect(-GAME_WIDTH / 2, -GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT);
    ov.setInteractive(new Phaser.Geom.Rectangle(-GAME_WIDTH / 2, -GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains);
    c.add(ov);

    const PW = 1000, PH = 720;
    const px = -PW / 2, py = -PH / 2;

    const bg = scene.add.graphics();
    bg.fillStyle(0x121222, 0.98); bg.fillRoundedRect(px, py, PW, PH, 14);
    bg.lineStyle(2, 0xc9a96e, 0.7); bg.strokeRoundedRect(px, py, PW, PH, 14);
    c.add(bg);

    const tb = scene.add.graphics(); tb.fillStyle(0x1a1a36, 1); tb.fillRoundedRect(px + 2, py + 2, PW - 4, 48, { tl: 12, tr: 12, bl: 0, br: 0 }); c.add(tb);
    c.add(scene.add.text(px + 20, py + 24, '好友', { fontSize: '20px', color: '#e8d5a3', fontStyle: 'bold' }).setOrigin(0, 0.5));
    const close = scene.add.text(px + PW - 20, py + 24, '✕', { fontSize: '22px', color: '#aa6677', fontStyle: 'bold' }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
    close.on('pointerdown', () => scene.closeFriendPanel());
    close.on('pointerover', () => close.setColor('#ff8899'));
    close.on('pointerout', () => close.setColor('#aa6677'));
    c.add(close);

    const divider = scene.add.graphics();
    divider.lineStyle(1, 0x334466, 0.4); divider.lineBetween(px + PW / 2, py + 58, px + PW / 2, py + PH - 10);
    c.add(divider);

    // HTML 输入框（角色名），随面板销毁自动清理
    const inputs: { el: HTMLInputElement | HTMLTextAreaElement; lx: number; ly: number; w: number; h: number }[] = [];
    const repositionInputs = (): void => {
      const canvas = scene.game.canvas;
      const rect = canvas.getBoundingClientRect();
      const sx = rect.width / GAME_WIDTH, sy = rect.height / GAME_HEIGHT;
      for (const it of inputs) {
        it.el.style.left = (rect.left + (cx + it.lx) * sx - (it.w * sx) / 2) + 'px';
        it.el.style.top = (rect.top + (cy + it.ly) * sy - (it.h * sy) / 2) + 'px';
        it.el.style.width = (it.w * sx) + 'px';
        it.el.style.height = (it.h * sy) + 'px';
      }
    };
    const placeInput = (lx: number, ly: number, w = 280, h = 34, maxLen = 12, initial = ''): HTMLInputElement => {
      const el = document.createElement('input');
      el.type = 'text'; el.maxLength = maxLen; el.value = initial;
      el.style.cssText = 'position:absolute;font-size:15px;color:#ddd;background:#0a0a1e;border:1px solid #446688;border-radius:5px;padding:4px 8px;outline:none;z-index:9999;';
      const canvas = scene.game.canvas;
      const rect = canvas.getBoundingClientRect();
      const sx = rect.width / GAME_WIDTH, sy = rect.height / GAME_HEIGHT;
      el.style.left = (rect.left + (cx + lx) * sx - (w * sx) / 2) + 'px';
      el.style.top = (rect.top + (cy + ly) * sy - (h * sy) / 2) + 'px';
      el.style.width = (w * sx) + 'px'; el.style.height = (h * sy) + 'px';
      document.body.appendChild(el); el.focus();
      inputs.push({ el, lx, ly, w, h });
      return el;
    };
    scene.scale.on('resize', repositionInputs);
    c.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.scale.off('resize', repositionInputs);
      inputs.forEach(it => { try { if (it.el.parentNode) it.el.parentNode.removeChild(it.el); } catch {} });
    });

    const btn = (lx: number, ly: number, label: string, color: number, textColor: string, cb: () => void): void => {
      const bw = Math.max(56, label.length * 15 + 20), bh = 28;
      const g = scene.add.graphics();
      g.fillStyle(color, 0.92); g.fillRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6);
      g.lineStyle(1, 0xc9a96e, 0.5); g.strokeRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6);
      const t = scene.add.text(lx, ly, label, { fontSize: '13px', color: textColor, fontStyle: 'bold' }).setOrigin(0.5);
      const z = scene.add.zone(lx, ly, bw, bh).setInteractive({ useHandCursor: true });
      z.on('pointerover', () => { g.clear(); g.fillStyle(color, 1); g.fillRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6); });
      z.on('pointerout', () => { g.clear(); g.fillStyle(color, 0.92); g.fillRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6); });
      z.on('pointerdown', cb);
      c.add([g, t, z]);
    };

    // 通用滚动列表（几何遮罩 + 滚动条；居中容器坐标用 cx/cy 换算世界坐标；多视口时滚轮按区域生效，互不干扰）
    const setupScroll = (
      items: any[], rowH: number,
      vpTop: number, vpBottom: number,
      colLeft: number, colWidth: number,
      renderRow: (item: any, i: number, ry: number, sc: Phaser.GameObjects.Container, btnS: (lx: number, ly: number, label: string, color: number, textColor: string, cb: () => void) => void) => void
    ): void => {
      const viewH = vpBottom - vpTop;
      const contentH = items.length * rowH + 8;
      const scrollable = contentH > viewH;
      const scrollContent = scene.add.container(0, 0); c.add(scrollContent);
      const rowBtns: any[] = [];
      const btnS = (lx: number, ly: number, label: string, color: number, textColor: string, cb: () => void): void => {
        const bw = Math.max(48, label.length * 13 + 16), bh = 24;
        const g = scene.add.graphics();
        g.fillStyle(color, 0.92); g.fillRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6);
        g.lineStyle(1, 0xc9a96e, 0.5); g.strokeRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6);
        const t = scene.add.text(lx, ly, label, { fontSize: '12px', color: textColor, fontStyle: 'bold' }).setOrigin(0.5);
        const z = scene.add.zone(lx, ly, bw, bh).setInteractive({ useHandCursor: true });
        z.on('pointerover', () => { g.clear(); g.fillStyle(color, 1); g.fillRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6); });
        z.on('pointerout', () => { g.clear(); g.fillStyle(color, 0.92); g.fillRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6); });
        z.on('pointerdown', cb);
        (z as any)._localY = ly; (z as any)._enabled = !scrollable;
        if (scrollable) z.disableInteractive();
        scrollContent.add([g, t, z]);
        rowBtns.push(z);
      };
      items.forEach((it, i) => { const ry = 12 + i * rowH; renderRow(it, i, ry, scrollContent, btnS); });
      if (scrollable) {
        const maskG = scene.make.graphics({});
        maskG.fillStyle(0xffffff);
        maskG.fillRect(cx + colLeft, cy + vpTop, colWidth, viewH);
        scrollContent.setMask(maskG.createGeometryMask());
      }
      const sbX = colLeft + colWidth + 4;
      let scrollY = 0;
      const scrollBar = scene.add.graphics(); c.add(scrollBar);
      const updateScroll = (): void => {
        // 与模块级 setupScroll 同样的修复：非滚动场景下 Clamp 的 min>max 边界 bug
        if (scrollable) {
          scrollY = Phaser.Math.Clamp(scrollY, viewH - contentH, 0);
        } else {
          scrollY = 0;
        }
        scrollContent.y = vpTop + scrollY;
        scrollBar.clear();
        if (scrollable) {
          const thumbH = Math.max(24, viewH * viewH / contentH);
          const progress = contentH > viewH ? scrollY / (viewH - contentH) : 0;
          const ty = vpTop + progress * (viewH - thumbH);
          scrollBar.fillStyle(0x000000, 0.35); scrollBar.fillRoundedRect(sbX - 3, vpTop, 6, viewH, 3);
          scrollBar.fillStyle(0x99aacc, 0.6); scrollBar.fillRoundedRect(sbX - 3, ty, 6, thumbH, 3);
          for (const b of rowBtns) {
            const rel = (b as any)._localY + scrollY;
            const vis = rel >= -rowH && rel <= viewH;
            const en = (b as any)._enabled === true;
            if (vis && !en) { (b as any).setInteractive({ useHandCursor: true }); (b as any)._enabled = true; }
            else if (!vis && en) { (b as any).disableInteractive(); (b as any)._enabled = false; }
          }
        }
      };
      updateScroll();
      if (scrollable) {
        const onWheel = (pointer: any, _o: any, _dx: number, dy: number) => {
          const wx = pointer.worldX, wy = pointer.worldY;
          const vx0 = cx + colLeft, vy0 = cy + vpTop;
          if (wx < vx0 || wx > vx0 + colWidth || wy < vy0 || wy > vy0 + viewH) return;
          scrollY -= dy * 0.5; updateScroll();
        };
        scene.input.on('wheel', onWheel);
        let dragging = false;
        const onMove = (p: any) => {
          if (!dragging) return;
          const rel = p.worldY - cy - vpTop;
          const thumbH = Math.max(24, viewH * viewH / contentH);
          const newTop = Phaser.Math.Clamp(rel - thumbH / 2, 0, viewH - thumbH);
          scrollY = (viewH - contentH) * (newTop / (viewH - thumbH));
          updateScroll();
        };
        const onUp = () => { dragging = false; };
        scrollBar.setInteractive(new Phaser.Geom.Rectangle(sbX - 8, vpTop, 16, viewH), Phaser.Geom.Rectangle.Contains);
        scrollBar.on('pointerdown', () => { dragging = true; });
        scene.input.on('pointermove', onMove);
        scene.input.on('pointerup', onUp);
        c.once(Phaser.GameObjects.Events.DESTROY, () => {
          scene.input.off('wheel', onWheel);
          scene.input.off('pointermove', onMove);
          scene.input.off('pointerup', onUp);
        });
      }
    };

    const refresh = () => { scene.closeFriendPanel(); scene.openFriendPanel(); };
    const toast = (msg: string) => {
      const t = scene.add.text(0, py + 64, msg, { fontSize: '14px', color: '#ffcc88', fontStyle: 'bold' }).setOrigin(0.5);
      c.add(t);
      scene.time.delayedCall(1800, () => t.destroy());
    };

    const loading = scene.add.text(0, 0, '加载中…', { fontSize: '16px', color: '#8899bb' }).setOrigin(0.5);
    c.add(loading);

    Promise.all([
      FriendClient.list(scene.authToken, scene.characterId),
      FriendClient.requests(scene.authToken, scene.characterId),
    ]).then(([lr, rr]: any[]) => {
      loading.destroy();
      if (!lr || !lr.ok) { c.add(scene.add.text(0, 0, '加载失败：' + (lr?.msg || '未知错误'), { fontSize: '14px', color: '#cc6644' }).setOrigin(0.5)); return; }
      GameState.friendList = lr.friends || [];
      GameState.friendRequests = (rr && rr.ok) ? (rr.requests || []) : [];
      GameState.friendOnline = {};
      GameState.friendList.forEach((f: any) => { GameState.friendOnline[f.charId] = f.online; });
      renderBody();
    }).catch(() => { loading.setText('网络错误'); });

    function renderBody(): void {
      // ── 左列：好友列表（可滚动，排版完全对齐公会成员列表）──
      const lx = px + 28;
      const colDivider = px + PW / 2;
      const friends = GameState.friendList;
      c.add(scene.add.text(lx, py + 68, '好友列表', { fontSize: '16px', color: '#e8d5a3', fontStyle: 'bold' }).setOrigin(0, 0.5));
      c.add(scene.add.text(lx + 110, py + 68, `${friends.length} 位`, { fontSize: '12px', color: '#8aa0c0' }).setOrigin(0, 0.5));

      if (friends.length === 0) {
        // 空状态：居中提示（与公会"暂无公会"风格一致）
        const emptyIcon = scene.add.text(lx + (colDivider - lx) / 2, py + 200, '👤', { fontSize: '36px' }).setOrigin(0.5);
        c.add(emptyIcon);
        c.add(scene.add.text(lx + (colDivider - lx) / 2, py + 240, '暂无好友', { fontSize: '16px', color: '#667788', fontStyle: 'bold' }).setOrigin(0.5));
        c.add(scene.add.text(lx + (colDivider - lx) / 2, py + 268, '在右侧输入角色名发送申请', { fontSize: '13px', color: '#556677' }).setOrigin(0.5));
      } else {
        // 表头（固定不随滚动，对齐公会成员列表表头风格）
        const hdrY = py + 94;
        c.add(scene.add.text(lx + 4, hdrY, '状态', { fontSize: '11px', color: '#556677' }).setOrigin(0, 0.5));
        c.add(scene.add.text(lx + 32, hdrY, '角色名', { fontSize: '11px', color: '#556677' }).setOrigin(0, 0.5));
        c.add(scene.add.text(lx + 180, hdrY, '所在地图', { fontSize: '11px', color: '#556677' }).setOrigin(0, 0.5));
        c.add(scene.add.text(colDivider - 72, hdrY, '操作', { fontSize: '11px', color: '#556677' }).setOrigin(0.5));

        const fvpTop = py + 112, fvpBottom = py + PH - 24, fROW = 30;
        setupScroll(friends, fROW, fvpTop, fvpBottom, lx - 4, colDivider - lx - 8,
          (f: any, i: number, ry: number, sc: Phaser.GameObjects.Container, btnS: any) => {
            // 交替行背景（与公会成员列表一致）
            if (i % 2 === 0) {
              const rb = scene.add.graphics(); rb.fillStyle(0x1a1a2e, 0.35); rb.fillRoundedRect(lx - 4, ry - 12, colDivider - lx - 8, 26, 4); sc.add(rb);
            }
            // 在线状态圆点（绿=在线 灰=离线）
            const dot = scene.add.graphics(); dot.fillStyle(f.online ? 0x44dd66 : 0x555566, 1); dot.fillCircle(lx + 10, ry, 4); sc.add(dot);
            // 角色名（14px 加粗）
            sc.add(scene.add.text(lx + 32, ry, f.name, { fontSize: '14px', color: '#cdd6e8', fontStyle: 'bold' }).setOrigin(0, 0.5));
            // 地图位置（在线显示地名，离线显示"离线"）
            const locText = f.online ? (f.location || '在线') : '离线';
            sc.add(scene.add.text(lx + 180, ry, locText, { fontSize: '12px', color: f.online ? '#88cc99' : '#667788' }).setOrigin(0, 0.5));
            // 操作按钮（私聊 + 移除）
            btnS(colDivider - 120, ry, '私聊', 0x33507a, '#bcd4ff', () => { scene.whisperTo(f.charId, f.name); });
            btnS(colDivider - 54, ry, '移除', 0x6a2a2a, '#ffb0b0', () => {
              FriendClient.remove(scene.authToken, scene.characterId, f.charId).then((res: any) => res.ok ? (toast('已移除好友'), refresh()) : toast(res.msg || '移除失败'));
            });
          });
      }

      // ── 右列：申请（可滚动）+ 添加表单 ──
      const rx = px + 512;
      c.add(scene.add.text(rx, py + 68, '好友申请', { fontSize: '16px', color: '#e8d5a3', fontStyle: 'bold' }).setOrigin(0, 0.5));
      const reqs = GameState.friendRequests;
      c.add(scene.add.text(rx + 110, py + 68, `${reqs.length} 条`, { fontSize: '12px', color: '#8aa0c0' }).setOrigin(0, 0.5));

      if (reqs.length === 0) {
        c.add(scene.add.text(rx, py + 110, '（暂无待处理申请）', { fontSize: '13px', color: '#667788' }).setOrigin(0, 0));
      } else {
        // 申请表头
        const rhdrY = py + 94;
        c.add(scene.add.text(rx, rhdrY, '申请人', { fontSize: '11px', color: '#556677' }).setOrigin(0, 0.5));
        c.add(scene.add.text(rx + 220, rhdrY, '操作', { fontSize: '11px', color: '#556677' }).setOrigin(0.5));

        const rW = PW - (rx - px) - 28;
        // 申请列表滚到 py+PH-240 给下方"添加好友"卡片留出独立区域
        const rvpTop = py + 112, rvpBottom = py + PH - 240, rROW = 34;
        setupScroll(reqs, rROW, rvpTop, rvpBottom, rx - 6, rW,
          (q: any, i: number, ry: number, sc: Phaser.GameObjects.Container, btnS: any) => {
            // 交替行背景
            if (i % 2 === 0) {
              const rb = scene.add.graphics(); rb.fillStyle(0x1a1a2e, 0.35); rb.fillRoundedRect(rx - 6, ry - 14, rW + 2, 30, 4); sc.add(rb);
            }
            sc.add(scene.add.text(rx, ry, q.name, { fontSize: '14px', color: '#cdd6e8', fontStyle: 'bold' }).setOrigin(0, 0.5));
            btnS(rx + rW - 120, ry, '接受', 0x2a6e4a, '#cfeedd', () => {
              FriendClient.accept(scene.authToken, scene.characterId, q.charId).then((res: any) => res.ok ? (toast('已添加为好友'), refresh()) : toast(res.msg));
            });
            btnS(rx + rW - 54, ry, '拒绝', 0x6a2a2a, '#ffb0b0', () => {
              FriendClient.decline(scene.authToken, scene.characterId, q.charId).then((res: any) => res.ok ? (toast('已拒绝'), refresh()) : toast(res.msg));
            });
          });
      }

      // ══ 添加好友卡片（独立背景框，与上方"好友申请"彻底分隔） ══
      const cardX = rx - 8, cardY = py + PH - 220, cardW = (PW - (rx - px) - 28) + 16, cardH = 200;
      const cardBg = scene.add.graphics();
      cardBg.fillStyle(0x1a1a2e, 0.55); cardBg.fillRoundedRect(cardX, cardY, cardW, cardH, 8);
      cardBg.lineStyle(1, 0x3a4a6a, 0.5); cardBg.strokeRoundedRect(cardX, cardY, cardW, cardH, 8);
      c.add(cardBg);

      const addBtnY = cardY + 56;
      const inputY = cardY + 96; // 输入框在按钮下方独立一行，避免与按钮挤在同一行
      c.add(scene.add.text(rx, cardY + 18, '添加好友', { fontSize: '15px', color: '#e8d5a3', fontStyle: 'bold' }).setOrigin(0, 0.5));
      // 卡片底部提示文字
      c.add(scene.add.text(rx, cardY + 150, '输入对方角色名后点击发送，对方同意后成为好友。', { fontSize: '11px', color: '#556677', wordWrap: { width: cardW - 24 } }).setOrigin(0, 0));

      let nameInput: HTMLInputElement | null = null;
      let addUiPlaced = false;
      btn(rx + 60, addBtnY, '➕ 添加好友', 0x33507a, '#bcd4ff', () => {
        if (nameInput) { nameInput.focus(); return; }
        // 展开：输入框 + 发送 + 取消 在按钮下方独立一行（inputY）
        nameInput = placeInput(rx + 80, inputY, 160, 32, 12);
        if (!addUiPlaced) {
          btn(rx + 270, inputY, '发送', 0x2a6e4a, '#cfeedd', () => {
            if (!nameInput) return;
            const nm = nameInput.value.trim();
            if (!nm) { toast('请输入角色名'); return; }
            FriendClient.add(scene.authToken, scene.characterId, nm).then((res: any) => {
              if (res.ok) { toast('已向「' + res.targetName + '」发送申请'); refresh(); }
              else toast(res.msg || '发送失败');
            });
          });
          btn(rx + 340, inputY, '取消', 0x444466, '#aaaacc', () => {
            if (nameInput && nameInput.parentNode) { nameInput.parentNode.removeChild(nameInput); nameInput = null; }
          });
          addUiPlaced = true;
        }
      });
    }

    return c;
  }

  // ═════════════════════════════════════════
  // 拍卖行面板（P 键）— 一口价交易 + 收藏/历史持久化（DB）
  // 数据经 GameRoom 的 auctionData 消息下发（非 REST），面板据此渲染；
  // 操作走 intent，服务端权威。结构对齐好友/公会面板（全屏遮罩+顶层 Container+Tab）。
  // 列表区(auctionBody)每次 auctionData/操作后销毁重建，避免 worldSync 频繁重拉；
  // 重建会触发 setupScroll 的 DESTROY 清理（滚轮/拖拽监听），无泄漏。
  // ═════════════════════════════════════════
  let auctionPanelTab: 'market' | 'mine' | 'fav' | 'history' = 'market';
  let auctionCreating = false;
  let auctionCreateItem: any = null;
  let auctionFilter = { name: '', category: null as string | null, quality: null as string | null, sort: 'price_asc' as string };
  let auctionSelectedId: number | null = null;   // 当前选中挂单 → 右栏详情
  let auctionPage = 0;                            // 网格分页（DNF 式卡片网格）
  let auctionBody: Phaser.GameObjects.Container | null = null;
  let auctionCx = 0, auctionCy = 0;
  let auctionBodyInputs: (HTMLInputElement | HTMLTextAreaElement)[] = [];
  let auctionShellInputs: { el: HTMLInputElement | HTMLTextAreaElement; lx: number; ly: number; w: number; h: number }[] = [];

  // 面板尺寸（DNF 式三栏：左筛选 / 中卡片网格 / 右详情）
  const AUCTION_PW = 1280, AUCTION_PH = 860;
  const AUCTION_PAGE_SIZE = 12;                  // 4 列 × 3 行
  const A_CAT: Record<string, string> = { equipment: '装备', consumable: '消耗品', material: '材料', title: '称号', quest: '任务', key: '钥匙', etc: '杂物' };
  const A_CAT_ORDER = ['equipment', 'consumable', 'material', 'title', 'quest', 'key', 'etc'];
  const A_CAT_ICON: Record<string, string> = { equipment: '装', consumable: '消', material: '材', title: '称', quest: '任', key: '钥', etc: '杂' };
  const A_QUAL: Record<string, string> = { white: '白', green: '绿', blue: '蓝', purple: '紫', gold: '金' };
  const A_QUAL_ORDER = [null, 'white', 'green', 'blue', 'purple', 'gold'] as (string | null)[];
  const A_QUAL_COLOR: Record<string, string> = { white: '#cfcfcf', green: '#7dd87d', blue: '#7da8ff', purple: '#c98dff', gold: '#ffd24a' };
  const A_SORT_LABEL: Record<string, string> = { price_asc: '价格↑', price_desc: '价格↓', recent: '最新' };
  const AUCTION_FEE_RATE = 0.05;

  function fmtNum(n: number): string { return (n || 0).toLocaleString('en-US'); }
  function hexNum(s: string): number { return parseInt(s.replace('#', ''), 16); }

  function parseAuctionItem(a: any): any {
    try { return typeof a.item_data === 'string' ? JSON.parse(a.item_data) : (a.item_data || {}); } catch { return {}; }
  }
  function auctionStatsLines(item: any): string[] {
    const lines: string[] = [];
    if (item && item.stats) for (const [k, v] of Object.entries(item.stats as Record<string, number>)) lines.push(`${k} +${v}`);
    if (item && item.enhanceLevel) lines.push(`强化 +${item.enhanceLevel}`);
    if (item && item.refineStats && item.refineStats.length) for (const r of item.refineStats) lines.push(`${r.key} +${r.value} (精炼)`);
    if (item && item.set) lines.push(`套装: ${item.set}`);
    return lines;
  }

  export function closeAuctionPanel(scene: GameScene): void {
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

  function reqAuctionTab(): void {
    if (auctionPanelTab === 'market') requestAuctionList({ ...auctionFilter });
    else if (auctionPanelTab === 'mine') requestAuctionMine();
    else if (auctionPanelTab === 'fav') requestAuctionFavList();
    else if (auctionPanelTab === 'history') requestAuctionHistory();
  }

  function rebuildAuction(scene: GameScene): void {
    closeAuctionPanel(scene);
    scene.pauseForMenu();
    scene.auctionPanel = renderAuctionPanel(scene, false);
  }

  function aBtn(scene: GameScene, c: Phaser.GameObjects.Container, lx: number, ly: number, label: string, color: number, textColor: string, cb: () => void): void {
    const bw = Math.max(48, label.length * 14 + 18), bh = 26;
    const g = scene.add.graphics();
    g.fillStyle(color, 0.92); g.fillRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6);
    g.lineStyle(1, 0xc9a96e, 0.5); g.strokeRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6);
    const t = scene.add.text(lx, ly, label, { fontSize: '12px', color: textColor, fontStyle: 'bold' }).setOrigin(0.5);
    const z = scene.add.zone(lx, ly, bw, bh).setInteractive({ useHandCursor: true });
    z.on('pointerover', () => { g.clear(); g.fillStyle(color, 1); g.fillRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6); });
    z.on('pointerout', () => { g.clear(); g.fillStyle(color, 0.92); g.fillRoundedRect(lx - bw / 2, ly - bh / 2, bw, bh, 6); });
    z.on('pointerdown', cb);
    c.add([g, t, z]);
  }

  function aToast(scene: GameScene, c: Phaser.GameObjects.Container, msg: string): void {
    const t = scene.add.text(0, -296, msg, { fontSize: '14px', color: '#ffcc88', fontStyle: 'bold' }).setOrigin(0.5);
    c.add(t);
    scene.time.delayedCall(1800, () => t.destroy());
  }

  function aPlaceShellInput(scene: GameScene, lx: number, ly: number, w = 200, h = 28, maxLen = 20, initial = ''): HTMLInputElement {
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

  function aPlaceBodyInput(scene: GameScene, lx: number, ly: number, w = 200, h = 28, maxLen = 20, initial = ''): HTMLInputElement {
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
  function auctionAct(scene: GameScene, msg: string, fn: () => void): void {
    fn();
    auctionSelectedId = null; auctionPage = 0;
    rebuildAuction(scene);
    if (scene.auctionPanel) aToast(scene, scene.auctionPanel, msg);
  }
  function onBuy(scene: GameScene, a: any): void {
    auctionAct(scene, '购买请求已发送…', () => requestAuctionBuy(a.id));
  }
  function onCancel(scene: GameScene, a: any): void {
    auctionAct(scene, '撤单请求已发送…', () => requestAuctionCancel(a.id));
  }
  function onFav(scene: GameScene, a: any): void {
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

  // Tab 按钮（DNF 式顶栏分页）
  function aTab(scene: GameScene, c: Phaser.GameObjects.Container, cx: number, cy: number, w: number, label: string, active: boolean, cb: () => void): void {
    const h = 30;
    const g = scene.add.graphics();
    g.fillStyle(active ? 0x33507a : 0x1a1a30, active ? 1 : 0.9); g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 8);
    g.lineStyle(1, active ? 0x9fc0ff : 0x33405e, 0.8); g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 8);
    const t = scene.add.text(cx, cy, label, { fontSize: '14px', color: active ? '#dceaff' : '#8899bb', fontStyle: 'bold' }).setOrigin(0.5);
    const z = scene.add.zone(cx, cy, w, h).setInteractive({ useHandCursor: true });
    z.on('pointerover', () => { if (!active) { g.clear(); g.fillStyle(0x2a2a48, 1); g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 8); } });
    z.on('pointerout', () => { if (!active) { g.clear(); g.fillStyle(0x1a1a30, 0.9); g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 8); } });
    z.on('pointerdown', cb);
    c.add([g, t, z]);
  }

  // 筛选变更：market 走服务端重拉；mine/fav 本地即时过滤
  function applyAuctionFilter(scene: GameScene): void {
    auctionPage = 0; auctionSelectedId = null;
    if (auctionPanelTab === 'market') reqAuctionTab();
    else renderAuctionBody(scene);
  }

  export function renderAuctionPanel(scene: GameScene, reset = true): Phaser.GameObjects.Container {
    if (reset) {
      auctionPanelTab = 'market'; auctionCreating = false; auctionCreateItem = null;
      auctionFilter = { name: '', category: null, quality: null, sort: 'price_asc' };
      auctionSelectedId = null; auctionPage = 0;
    }
    const cam = scene.cameras.main;
    auctionCx = Math.round(cam.scrollX) + GAME_WIDTH / 2;
    auctionCy = Math.round(cam.scrollY) + GAME_HEIGHT / 2;
    const c = scene.add.container(auctionCx, auctionCy).setDepth(500);
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
    c.add(scene.add.text(px + 28, py + 28, '拍卖行', { fontSize: '22px', color: '#e8d5a3', fontStyle: 'bold' }).setOrigin(0, 0.5));
    c.add(scene.add.text(px + PW - 250, py + 28, `金币 ${fmtNum((GameState as any).gold || 0)}`, { fontSize: '15px', color: '#ffd24a', fontStyle: 'bold' }).setOrigin(0, 0.5));
    const close = scene.add.text(px + PW - 28, py + 28, '✕', { fontSize: '24px', color: '#aa6677', fontStyle: 'bold' }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
    close.on('pointerdown', () => closeAuctionPanel(scene));
    close.on('pointerover', () => close.setColor('#ff8899'));
    close.on('pointerout', () => close.setColor('#aa6677'));
    c.add(close);

    // 分隔线（标题 ↔ Tab）
    const dl1 = scene.add.graphics(); dl1.lineStyle(1, 0x33405e, 0.7); dl1.lineBetween(px + 12, py + 58, px + PW - 12, py + 58); c.add(dl1);

    // Tab 栏（DNF 顶栏分页，独立横向条）
    const tabs: [typeof auctionPanelTab, string][] = [['market', '浏览市场'], ['mine', '我的挂单'], ['fav', '收藏'], ['history', '历史']];
    const tabW = 150, tabGap = 12, tabTotal = tabs.length * tabW + (tabs.length - 1) * tabGap;
    const tabStartX = px + (PW - tabTotal) / 2 + tabW / 2;
    tabs.forEach(([t, label], i) => {
      const active = auctionPanelTab === t;
      aTab(scene, c, tabStartX + i * (tabW + tabGap), py + 80, tabW, label, active, () => {
        if (auctionPanelTab === t) return;
        auctionPanelTab = t; auctionCreating = false; auctionCreateItem = null; auctionSelectedId = null; auctionPage = 0;
        rebuildAuction(scene);
      });
    });

    // 分隔线（Tab ↔ 内容/工具条）
    const dl2 = scene.add.graphics(); dl2.lineStyle(1, 0x33405e, 0.7); dl2.lineBetween(px + 12, py + 104, px + PW - 12, py + 104); c.add(dl2);

    // 工具条：左=搜索/排序（对齐中栏），右=上架/刷新（置于面板右侧，远离居中 Tab，杜绝误触）
    if (auctionPanelTab !== 'history' && !auctionCreating) {
      const gridX = px + 208, gy = py + 126;
      const searchInput = aPlaceShellInput(scene, gridX + 150, gy, 220, 30, 20, auctionFilter.name);
      searchInput.placeholder = '物品名称';
      aBtn(scene, c, gridX + 300, gy, '搜索', 0x33507a, '#bcd4ff', () => { auctionFilter.name = searchInput.value.trim(); applyAuctionFilter(scene); });
      aBtn(scene, c, gridX + 430, gy, '排序:' + A_SORT_LABEL[auctionFilter.sort], 0x2a3a5a, '#bcd4ff', () => {
        const order = ['price_asc', 'price_desc', 'recent'];
        auctionFilter.sort = order[(order.indexOf(auctionFilter.sort) + 1) % order.length];
        applyAuctionFilter(scene);
      });
      aBtn(scene, c, px + PW - 180, gy, '上架', 0x2a6e4a, '#cfeedd', () => { auctionCreating = true; rebuildAuction(scene); });
      aBtn(scene, c, px + PW - 70, gy, '刷新', 0x444466, '#aaaacc', () => reqAuctionTab());
    }

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

  function renderAuctionBody(scene: GameScene): void {
    if (!scene.auctionPanel) return;
    // 销毁旧列表区（触发 setupScroll 的 DESTROY 清理滚轮/拖拽监听），再建新容器
    if (auctionBody) { auctionBody.destroy(true); auctionBody = null; }
    auctionBodyInputs.forEach(el => { try { if (el.parentNode) el.parentNode.removeChild(el); } catch {} });
    auctionBodyInputs = [];
    const c = scene.auctionPanel!;
    const body = scene.add.container(0, 0); c.add(body); auctionBody = body;

    if (auctionCreating) { renderCreate(scene, c, body); return; }
    if (auctionPanelTab === 'history') { renderHistoryList(scene, body); return; }
    // 三栏：左筛选 / 中卡片网格 / 右详情
    renderSidebar(scene, body);
    renderGrid(scene, body);
    renderDetail(scene, body);
  }

  // 稀有度图标方块（分类字 + 品质色描边/外发光），用于卡片与详情
  function drawIconTile(scene: GameScene, parent: Phaser.GameObjects.Container, cx: number, cy: number, size: number, category: string, quality: string): void {
    const qc = A_QUAL_COLOR[quality] || '#cdd6e8';
    const col = hexNum(qc);
    const g = scene.add.graphics();
    g.fillStyle(0x000000, 0.32); g.fillRoundedRect(cx - size / 2, cy - size / 2, size, size, 10);
    g.lineStyle(3, col, 0.95); g.strokeRoundedRect(cx - size / 2, cy - size / 2, size, size, 10);
    g.lineStyle(8, col, 0.16); g.strokeRoundedRect(cx - size / 2, cy - size / 2, size, size, 10);
    parent.add(g);
    const icon = A_CAT_ICON[category] || '·';
    parent.add(scene.add.text(cx, cy, icon, { fontSize: Math.round(size * 0.46) + 'px', color: qc, fontStyle: 'bold' }).setOrigin(0.5));
  }

  // 物品卡片（DNF 式：图标 + 名 + 价格，稀有度边框发光）
  function aCard(scene: GameScene, parent: Phaser.GameObjects.Container, x: number, y: number, w: number, h: number, a: any, selected: boolean, onClick: () => void): void {
    const qc = A_QUAL_COLOR[a.quality] || '#cdd6e8';
    const col = hexNum(qc);
    const g = scene.add.graphics();
    g.fillStyle(selected ? 0x23233f : 0x16162a, selected ? 1 : 0.92); g.fillRoundedRect(x, y, w, h, 10);
    g.lineStyle(selected ? 2.5 : 1.5, col, selected ? 1 : 0.7); g.strokeRoundedRect(x, y, w, h, 10);
    if (selected) { g.lineStyle(7, col, 0.16); g.strokeRoundedRect(x, y, w, h, 10); }
    parent.add(g);
    drawIconTile(scene, parent, x + w / 2, y + 42, 52, a.category, a.quality);
    parent.add(scene.add.text(x + w / 2, y + 86, a.item_name, { fontSize: '13px', color: qc, fontStyle: 'bold', align: 'center', wordWrap: { width: w - 14 } }).setOrigin(0.5, 0.5));
    parent.add(scene.add.text(x + w / 2, y + h - 22, `${fmtNum(a.price)} 金`, { fontSize: '13px', color: '#ffd24a', fontStyle: 'bold' }).setOrigin(0.5));
    const z = scene.add.zone(x + w / 2, y + h / 2, w, h).setInteractive({ useHandCursor: true });
    z.on('pointerdown', onClick);
    parent.add(z);
  }

  // 侧栏筛选行
  function aSideRow(scene: GameScene, parent: Phaser.GameObjects.Container, x: number, y: number, w: number, label: string, active: boolean, cb: () => void): void {
    const h = 28;
    const g = scene.add.graphics();
    g.fillStyle(active ? 0x33507a : 0x16162a, active ? 0.95 : 0.55); g.fillRoundedRect(x, y, w, h, 6);
    if (active) { g.fillStyle(0x9fc0ff, 1); g.fillRoundedRect(x, y, 4, h, 2); }
    g.lineStyle(1, active ? 0x9fc0ff : 0x2a3450, active ? 0.8 : 0.5); g.strokeRoundedRect(x, y, w, h, 6);
    const t = scene.add.text(x + 14, y + h / 2, label, { fontSize: '13px', color: active ? '#dceaff' : '#9fb0d0' }).setOrigin(0, 0.5);
    const z = scene.add.zone(x + w / 2, y + h / 2, w, h).setInteractive({ useHandCursor: true });
    z.on('pointerover', () => { if (!active) { g.clear(); g.fillStyle(0x222238, 0.9); g.fillRoundedRect(x, y, w, h, 6); g.lineStyle(1, 0x3a4a6a, 0.8); g.strokeRoundedRect(x, y, w, h, 6); } });
    z.on('pointerout', () => { if (!active) { g.clear(); g.fillStyle(0x16162a, 0.55); g.fillRoundedRect(x, y, w, h, 6); g.lineStyle(1, 0x2a3450, 0.5); g.strokeRoundedRect(x, y, w, h, 6); } });
    z.on('pointerdown', cb);
    parent.add([g, t, z]);
  }

  // ══ 左栏：分类 + 稀有度筛选 ══
  function renderSidebar(scene: GameScene, body: Phaser.GameObjects.Container): void {
    const PW = AUCTION_PW, px = -PW / 2, py = -AUCTION_PH / 2;
    const sx = px + 16, sy = py + 156, sw = 176;
    const sh = (py + AUCTION_PH - 16) - sy;
    const g = scene.add.graphics(); g.fillStyle(0x0e0e1c, 0.6); g.fillRoundedRect(sx, sy, sw, sh, 10); g.lineStyle(1, 0x33405e, 0.6); g.strokeRoundedRect(sx, sy, sw, sh, 10); body.add(g);
    body.add(scene.add.text(sx + 14, sy + 16, '分类', { fontSize: '13px', color: '#9fb0d0', fontStyle: 'bold' }).setOrigin(0, 0.5));
    const cats: (string | null)[] = [null, ...A_CAT_ORDER];
    cats.forEach((cat, i) => {
      const label = cat ? (A_CAT[cat] || cat) : '全部';
      aSideRow(scene, body, sx + 8, sy + 34 + i * 28, sw - 16, label, auctionFilter.category === cat, () => { auctionFilter.category = cat; applyAuctionFilter(scene); });
    });
    const rLabelY = sy + 34 + cats.length * 28 + 10;
    body.add(scene.add.text(sx + 14, rLabelY, '稀有度', { fontSize: '13px', color: '#9fb0d0', fontStyle: 'bold' }).setOrigin(0, 0.5));
    A_QUAL_ORDER.forEach((q, i) => {
      const label = q ? (A_QUAL[q] || q) : '全部';
      aSideRow(scene, body, sx + 8, rLabelY + 20 + i * 28, sw - 16, label, auctionFilter.quality === q, () => { auctionFilter.quality = q; applyAuctionFilter(scene); });
    });
  }

  // ══ 中栏：物品卡片网格（4×3，分页）══
  function renderGrid(scene: GameScene, body: Phaser.GameObjects.Container): void {
    const PW = AUCTION_PW, px = -PW / 2, py = -AUCTION_PH / 2;
    const gridX = px + 208, gridTop = py + 156, cardW = 184, cardH = 150, gapX = 16, gapY = 14, cols = 4;
    let list = (GameState.auctionData && (GameState.auctionData as any).auctions) || [];
    if (auctionPanelTab !== 'market') {
      const nm = (auctionFilter.name || '').toLowerCase();
      list = list.filter((a: any) => (!auctionFilter.category || a.category === auctionFilter.category) && (!auctionFilter.quality || a.quality === auctionFilter.quality) && (!nm || (a.item_name || '').toLowerCase().includes(nm)));
      const o = auctionFilter.sort;
      list = [...list].sort((a: any, b: any) => o === 'price_desc' ? b.price - a.price : o === 'recent' ? (b.id - a.id) : a.price - b.price);
    }
    if (!GameState.auctionData) { body.add(scene.add.text(gridX + 392, gridTop + 150, '加载中…', { fontSize: '16px', color: '#8899bb' }).setOrigin(0.5)); return; }
    const emptyMsg = auctionPanelTab === 'mine' ? '你还没有在售挂单' : auctionPanelTab === 'fav' ? '你还没有收藏任何挂单' : '暂无在售物品，去「上架」挂点东西吧';
    if (list.length === 0) { body.add(scene.add.text(gridX + 392, gridTop + 150, emptyMsg, { fontSize: '15px', color: '#667788' }).setOrigin(0.5)); return; }
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
    body.add(scene.add.text(gridX + 392, pgY, `第 ${auctionPage + 1} / ${pages} 页`, { fontSize: '13px', color: '#aabbcc' }).setOrigin(0.5));
    aBtn(scene, body, gridX + 714, pgY, '下一页', 0x2a3a5a, auctionPage < pages - 1 ? '#bcd4ff' : '#556677', () => { if (auctionPage < pages - 1) { auctionPage++; renderAuctionBody(scene); } });
  }

  // ══ 右栏：选中物品详情 ══
  function renderDetail(scene: GameScene, body: Phaser.GameObjects.Container): void {
    const PW = AUCTION_PW, px = -PW / 2, py = -AUCTION_PH / 2;
    const dx = px + PW - 264, dy = py + 156, dw = 248, dh = (py + AUCTION_PH - 16) - dy;
    const g = scene.add.graphics(); g.fillStyle(0x0e0e1c, 0.6); g.fillRoundedRect(dx, dy, dw, dh, 10); g.lineStyle(1, 0x33405e, 0.6); g.strokeRoundedRect(dx, dy, dw, dh, 10); body.add(g);
    body.add(scene.add.text(dx + 14, dy + 16, '物品详情', { fontSize: '14px', color: '#9fb0d0', fontStyle: 'bold' }).setOrigin(0, 0.5));
    const list = (GameState.auctionData && (GameState.auctionData as any).auctions) || [];
    const a = list.find((x: any) => x.id === auctionSelectedId);
    if (!a) { body.add(scene.add.text(dx + dw / 2, dy + dh / 2, '选择左侧物品\n查看详情', { fontSize: '14px', color: '#667788', align: 'center' }).setOrigin(0.5)); return; }
    const item = parseAuctionItem(a);
    drawIconTile(scene, body, dx + dw / 2, dy + 92, 76, a.category, a.quality);
    body.add(scene.add.text(dx + dw / 2, dy + 150, a.item_name, { fontSize: '15px', color: A_QUAL_COLOR[a.quality] || '#cdd6e8', fontStyle: 'bold', align: 'center', wordWrap: { width: dw - 20 } }).setOrigin(0.5, 0));
    body.add(scene.add.text(dx + dw / 2, dy + 178, `${A_CAT[a.category] || a.category} · ${A_QUAL[a.quality] || a.quality}`, { fontSize: '12px', color: '#99aabb', align: 'center' }).setOrigin(0.5, 0));
    let yy = dy + 204;
    if (item.desc) { body.add(scene.add.text(dx + 16, yy, item.desc, { fontSize: '11px', color: '#7788aa', wordWrap: { width: dw - 32 } }).setOrigin(0, 0)); yy += 24; }
    const lines = auctionStatsLines(item);
    if (lines.length) {
      body.add(scene.add.text(dx + 16, yy, '属性', { fontSize: '12px', color: '#9fb0d0', fontStyle: 'bold' }).setOrigin(0, 0)); yy += 18;
      for (const ln of lines) { body.add(scene.add.text(dx + 18, yy, ln, { fontSize: '12px', color: '#cdd6e8' }).setOrigin(0, 0)); yy += 18; }
    }
    const isMine = auctionPanelTab === 'mine';
    body.add(scene.add.text(dx + 16, dy + dh - 150, `数量  ×${a.quantity}`, { fontSize: '13px', color: '#aabbcc' }).setOrigin(0, 0));
    body.add(scene.add.text(dx + 16, dy + dh - 122, `单价  ${fmtNum(a.price)} 金`, { fontSize: '15px', color: '#ffd24a', fontStyle: 'bold' }).setOrigin(0, 0));
    body.add(scene.add.text(dx + 16, dy + dh - 94, `卖家  ${a.seller_name || '—'}`, { fontSize: '12px', color: '#99aabb' }).setOrigin(0, 0));
    if (isMine) aBtn(scene, body, dx + dw / 2 - 58, dy + dh - 40, '撤单', 0x6a4a2a, '#ffd9a0', () => onCancel(scene, a));
    else aBtn(scene, body, dx + dw / 2 - 58, dy + dh - 40, '购买', 0x2a6e4a, '#cfeedd', () => onBuy(scene, a));
    aBtn(scene, body, dx + dw / 2 + 58, dy + dh - 40, a.favorited ? '★' : '☆', 0x33507a, '#bcd4ff', () => onFav(scene, a));
  }

  function renderHistoryList(scene: GameScene, body: Phaser.GameObjects.Container): void {
    const PW = AUCTION_PW, px = -PW / 2, py = -AUCTION_PH / 2;
    if (!GameState.auctionData) { body.add(scene.add.text(0, 0, '加载中…', { fontSize: '16px', color: '#8899bb' }).setOrigin(0.5)); return; }
    const hist = (GameState.auctionData as any).history || [];
    if (hist.length === 0) { body.add(scene.add.text(0, 0, '暂无交易记录', { fontSize: '15px', color: '#667788' }).setOrigin(0.5)); return; }
    const hdrY = py + 150;
    body.add(scene.add.text(px + 60, hdrY, '物品', { fontSize: '12px', color: '#667788' }).setOrigin(0, 0.5));
    body.add(scene.add.text(px + 420, hdrY, '类型', { fontSize: '12px', color: '#667788' }).setOrigin(0, 0.5));
    body.add(scene.add.text(px + 580, hdrY, '价格', { fontSize: '12px', color: '#667788' }).setOrigin(0, 0.5));
    body.add(scene.add.text(px + 760, hdrY, '对方', { fontSize: '12px', color: '#667788' }).setOrigin(0, 0.5));
    body.add(scene.add.text(px + 980, hdrY, '时间', { fontSize: '12px', color: '#667788' }).setOrigin(0, 0.5));
    const vpTop = py + 168, vpBottom = py + AUCTION_PH - 16;
    setupScroll(scene, body, auctionCx, auctionCy, hist, 34, vpTop, vpBottom, px + 40, PW - 80,
      (h: any, i: number, ry: number, sc: Phaser.GameObjects.Container, _btnS: any) => {
        if (i % 2 === 0) { const rb = scene.add.graphics(); rb.fillStyle(0x1a1a2e, 0.35); rb.fillRoundedRect(px + 40, ry - 12, PW - 80, 28, 4); sc.add(rb); }
        const kindLabel = h.kind === 'sold' ? '售出' : h.kind === 'bought' ? '购入' : '撤单';
        const kindColor = h.kind === 'sold' ? '#9fe6a0' : h.kind === 'bought' ? '#ffd24a' : '#aa6677';
        const other = h.kind === 'sold' ? ('给 #' + h.buyer_char_id) : h.kind === 'bought' ? ('自 #' + h.seller_char_id) : '—';
        const time = (h.created_at || '').replace('T', ' ').slice(0, 16);
        sc.add(scene.add.text(px + 60, ry, h.item_name, { fontSize: '13px', color: '#cdd6e8' }).setOrigin(0, 0.5));
        sc.add(scene.add.text(px + 420, ry, kindLabel, { fontSize: '12px', color: kindColor }).setOrigin(0, 0.5));
        sc.add(scene.add.text(px + 580, ry, `${h.price} 金`, { fontSize: '12px', color: '#ffd24a' }).setOrigin(0, 0.5));
        sc.add(scene.add.text(px + 760, ry, other, { fontSize: '11px', color: '#99aabb' }).setOrigin(0, 0.5));
        sc.add(scene.add.text(px + 980, ry, time, { fontSize: '11px', color: '#7788aa' }).setOrigin(0, 0.5));
      });
  }

  function renderCreate(scene: GameScene, c: Phaser.GameObjects.Container, body: Phaser.GameObjects.Container): void {
    const PW = AUCTION_PW, px = -PW / 2, py = -AUCTION_PH / 2;
    // 遮罩（盖住背后网格/侧栏，形成模态）
    const dim = scene.add.graphics(); dim.fillStyle(0, 0.55); dim.fillRoundedRect(px + 8, py + 150, PW - 16, AUCTION_PH - 150 - 16, 10); body.add(dim);
    const bw = 840, bh = AUCTION_PH - 162 - 16, bx = px + (PW - bw) / 2, by = py + 162;
    const g = scene.add.graphics(); g.fillStyle(0x14142a, 0.99); g.fillRoundedRect(bx, by, bw, bh, 12); g.lineStyle(2, 0xc9a96e, 0.7); g.strokeRoundedRect(bx, by, bw, bh, 12); body.add(g);
    body.add(scene.add.text(bx + bw / 2, by + 28, '上架物品', { fontSize: '20px', color: '#e8d5a3', fontStyle: 'bold' }).setOrigin(0.5));
    aBtn(scene, body, bx + bw - 64, by + 28, '✕', 0x6a2a2a, '#ffb0b0', () => { auctionCreating = false; rebuildAuction(scene); });
    if (!auctionCreateItem) {
      const items = Inventory.items.filter(it => it.quantity > 0);
      if (items.length === 0) { body.add(scene.add.text(bx + bw / 2, by + bh / 2, '背包为空，无可上架物品', { fontSize: '15px', color: '#667788' }).setOrigin(0.5)); return; }
      body.add(scene.add.text(bx + 24, by + 56, `选择要上架的物品（共 ${items.length} 件）：`, { fontSize: '13px', color: '#8899bb' }).setOrigin(0, 0.5));
      setupScroll(scene, body, auctionCx, auctionCy, items, 34, by + 84, by + bh - 20, bx + 24, bw - 48,
        (it: any, i: number, ry: number, sc: Phaser.GameObjects.Container, btnS: any) => {
          if (i % 2 === 0) { const rb = scene.add.graphics(); rb.fillStyle(0x1a1a2e, 0.35); rb.fillRoundedRect(bx + 24, ry - 12, bw - 48, 28, 4); sc.add(rb); }
          const qc = A_QUAL_COLOR[it.quality] || '#cdd6e8';
          sc.add(scene.add.text(bx + 36, ry, it.name, { fontSize: '14px', color: qc, fontStyle: 'bold' }).setOrigin(0, 0.5));
          sc.add(scene.add.text(bx + 380, ry, A_CAT[it.type] || it.type || '—', { fontSize: '12px', color: '#99aabb' }).setOrigin(0, 0.5));
          sc.add(scene.add.text(bx + 500, ry, `×${it.quantity}`, { fontSize: '12px', color: '#aabbcc' }).setOrigin(0, 0.5));
          btnS(bx + bw - 90, ry, '选择', 0x33507a, '#bcd4ff', () => { auctionCreateItem = it; rebuildAuction(scene); });
        });
    } else {
      const it = auctionCreateItem;
      const detail = `${it.name}（${A_CAT[it.type] || it.type} · ${A_QUAL[it.quality || 'white'] || it.quality || '—'}）`;
      drawIconTile(scene, body, bx + 90, by + 120, 72, it.type, it.quality);
      body.add(scene.add.text(bx + 150, by + 104, '上架：' + detail, { fontSize: '15px', color: '#e8d5a3' }).setOrigin(0, 0.5));
      body.add(scene.add.text(bx + 40, by + 200, '数量', { fontSize: '13px', color: '#8899bb' }).setOrigin(0, 0.5));
      const qtyInput = aPlaceBodyInput(scene, bx + 110, by + 200, 100, 28, 4, '1');
      body.add(scene.add.text(bx + 225, by + 200, `（上限 ${it.quantity}）`, { fontSize: '11px', color: '#556677' }).setOrigin(0, 0.5));
      body.add(scene.add.text(bx + 40, by + 250, '单价(金)', { fontSize: '13px', color: '#8899bb' }).setOrigin(0, 0.5));
      const priceInput = aPlaceBodyInput(scene, bx + 110, by + 250, 140, 28, 9, '');
      body.add(scene.add.text(bx + 265, by + 250, `（成交收取 ${Math.round(AUCTION_FEE_RATE * 100)}% 手续费）`, { fontSize: '11px', color: '#556677' }).setOrigin(0, 0.5));
      aBtn(scene, body, bx + 120, by + 320, '确认上架', 0x2a6e4a, '#cfeedd', () => {
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
