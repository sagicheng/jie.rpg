import type { GameScene } from '../scenes/GameScene';
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, ZANPAKUTO_GROWTH } from '../config';
import { GameState } from '../systems/GameState';
import { GuildClient } from '../systems/GuildClient';
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
} from '../systems/WorldClient';

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

export function closeTitlePanel(scene: GameScene): void { if (scene.titlePanel) { scene.titlePanel.destroy(true); scene.titlePanel = null; } }

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
    const listX=mx+24,listY=my+70,rowH=72;
    BESTIARY_TITLES.forEach((def,i)=>{
      const ry=listY+i*rowH;const st=(GameState as any).getTitleStatus(def);const isActive=(GameState as any).activeTitle===def.id;
      const rowBg=scene.add.graphics();rowBg.fillStyle(st.unlocked?(isActive?0x2a2410:0x152028):0x12121e,0.85);rowBg.fillRoundedRect(listX,ry,mw-48,rowH-8,8);rowBg.lineStyle(1,st.unlocked?(isActive?0xc9a96e:0x3a5a6a):0x2a2a3a,0.7);rowBg.strokeRoundedRect(listX,ry,mw-48,rowH-8,8);c.add(rowBg);
      const nc=st.unlocked?(isActive?'#ffcc44':'#cfe8ff'):'#556688';
      c.add(scene.add.text(listX+14,ry+10,def.name,{fontSize:'15px',color:nc,fontStyle:'bold',padding:{y:1}}));
      c.add(scene.add.text(listX+14,ry+32,`条件：${def.conditionDesc}`,{fontSize:'11px',color:'#8899bb',padding:{y:1}}));
      c.add(scene.add.text(listX+14,ry+50,`效果：${def.effectDesc}`,{fontSize:'11px',color:def.effectDesc==='无特殊效果'?'#667788':'#aadd88',padding:{y:1}}));
      if(st.unlocked){
        const btnLabel=isActive?'卸下':'装备';
        const ab=scene.add.text(listX+mw-48-72,ry+rowH/2-12,`[ ${btnLabel} ]`,{fontSize:'12px',color:isActive?'#ffcc66':'#88ccff',fontStyle:'bold',backgroundColor:isActive?'#3a2e00aa':'#002233aa',padding:{x:10,y:5}}).setOrigin(0,0.5).setInteractive({useHandCursor:true});
        ab.on('pointerover',()=>ab.setColor('#ffffff'));ab.on('pointerout',()=>ab.setColor(isActive?'#ffcc66':'#88ccff'));
        ab.on('pointerdown',()=>{ if(isOnline()) requestSetTitle(def.id); else (GameState as any).setActiveTitle(def.id); scene.broadcastTitle(); closeTitlePanel(scene); renderBestiaryPanel(scene); });
        c.add(ab);
      }else{
        c.add(scene.add.text(listX+mw-48-130,ry+rowH/2,st.progress,{fontSize:'11px',color:'#7788aa',padding:{y:1}}).setOrigin(0,0.5));
      }
    });
    const ny=listY+BESTIARY_TITLES.length*rowH;
    const noneBtn=scene.add.text(mx+mw/2,ny+6,(GameState as any).activeTitle?'[ 卸下当前称号 ]':'（当前未装备称号）',{fontSize:'12px',color:(GameState as any).activeTitle?'#cc8888':'#556688',padding:{y:2}}).setOrigin(0.5).setInteractive({useHandCursor:(GameState as any).activeTitle?true:false});
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

  export function renderGuildPanel(scene: GameScene): Phaser.GameObjects.Container {
    const cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
    const c = scene.add.container(cx, cy).setDepth(500).setScrollFactor(0);

    // 全屏遮罩
    const ov = scene.add.graphics();
    ov.fillStyle(0, 0.55); ov.fillRect(-cx, -cy, GAME_WIDTH, GAME_HEIGHT);
    ov.setInteractive(new Phaser.Geom.Rectangle(-cx, -cy, GAME_WIDTH, GAME_HEIGHT), Phaser.Geom.Rectangle.Contains);
    c.add(ov);

    const PW = 1000, PH = 720;
    const px = -PW / 2, py = -PH / 2;
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

    const content = scene.add.container(0, 0);
    c.add(content);

    // HTML 输入框（中文输入支持），随面板销毁自动清理
    const inputs: HTMLInputElement[] = [];
    const placeInput = (lx: number, ly: number, w = 280, h = 34, maxLen = 12, initial = ''): HTMLInputElement => {
      const el = document.createElement('input');
      el.type = 'text'; el.maxLength = maxLen; el.value = initial;
      el.style.cssText = 'position:absolute;font-size:16px;color:#fff;background:#0a0a1e;border:1px solid #446688;border-radius:4px;text-align:center;outline:none;z-index:9999;';
      const canvas = scene.game.canvas;
      const rect = canvas.getBoundingClientRect();
      const sx = rect.width / GAME_WIDTH, sy = rect.height / GAME_HEIGHT;
      el.style.left = (rect.left + (cx + lx) * sx - (w * sx) / 2) + 'px';
      el.style.top = (rect.top + (cy + ly) * sy - (h * sy) / 2) + 'px';
      el.style.width = (w * sx) + 'px'; el.style.height = (h * sy) + 'px';
      document.body.appendChild(el); el.focus();
      inputs.push(el);
      return el;
    };
    c.once(Phaser.GameObjects.Events.DESTROY, () => inputs.forEach(el => { if (el.parentNode) el.parentNode.removeChild(el); }));

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
      content.add([g, t, z]);
    };

    const refresh = () => { scene.closeGuildPanel(); scene.openGuildPanel(); };
    const toast = (msg: string) => {
      const t = scene.add.text(0, py + 64, msg, { fontSize: '14px', color: '#ffcc88', fontStyle: 'bold' }).setOrigin(0.5);
      content.add(t);
      scene.time.delayedCall(1800, () => t.destroy());
    };

    const loading = scene.add.text(0, 0, '加载中…', { fontSize: '16px', color: '#8899bb' }).setOrigin(0.5);
    content.add(loading);

    GuildClient.info(scene.authToken, scene.characterId).then((r: any) => {
      if (!r || !r.ok) { loading.setText('加载失败：' + (r?.msg || '未知错误')); return; }
      loading.destroy();
      if (!r.inGuild) renderNoGuild();
      else renderInGuild(r);
    }).catch(() => { loading.setText('网络错误'); });

    // ── 未加入公会：创建 + 浏览申请 ──
    function renderNoGuild(): void {
      const lx = px + 36;
      content.add(scene.add.text(lx, py + 76, '创建公会', { fontSize: '18px', color: '#e8d5a3', fontStyle: 'bold' }).setOrigin(0, 0.5));
      content.add(scene.add.text(lx, py + 116, '公会名（2-12字）：', { fontSize: '14px', color: '#aabbcc' }).setOrigin(0, 0.5));
      const nameInput = placeInput(lx + 200, py + 116, 240, 34, 12);
      content.add(scene.add.text(lx, py + 156, '公告（可选）：', { fontSize: '14px', color: '#aabbcc' }).setOrigin(0, 0.5));
      const noticeInput = placeInput(lx + 200, py + 156, 420, 34, 200);
      btn(lx + 70, py + 206, '创建公会', 0x2a6e4a, '#cfeedd', () => {
        const name = nameInput.value.trim();
        if (!name) { toast('请输入公会名'); return; }
        GuildClient.create(scene.authToken, scene.characterId, name, noticeInput.value.trim()).then((res: any) => {
          if (res.ok) { toast('公会创建成功！'); refresh(); }
          else toast(res.msg || '创建失败');
        });
      });

      const rx = px + 520;
      content.add(scene.add.text(rx, py + 76, '公会列表', { fontSize: '18px', color: '#e8d5a3', fontStyle: 'bold' }).setOrigin(0, 0.5));
      GuildClient.list(scene.authToken).then((res: any) => {
        if (!res || !res.ok) return;
        const list = res.guilds || [];
        if (list.length === 0) content.add(scene.add.text(rx, py + 116, '（暂无公会）', { fontSize: '13px', color: '#667788' }).setOrigin(0, 0.5));
        list.slice(0, 15).forEach((g: any, i: number) => {
          const ry = py + 116 + i * 34;
          content.add(scene.add.text(rx, ry, `〈${g.name}〉 Lv.${g.level}  (${g.memberCount}人)`, { fontSize: '14px', color: '#cdd6e8' }).setOrigin(0, 0.5));
          btn(rx + 330, ry, '申请', 0x33507a, '#bcd4ff', () => {
            GuildClient.apply(scene.authToken, scene.characterId, g.id, '').then((ar: any) => {
              if (ar.ok) toast('已提交申请，等待审批');
              else toast(ar.msg || '申请失败');
            });
          });
        });
      });
    }

    // ── 已加入公会：信息 + 成员管理 + 申请审批 + 公告 + 聊天 ──
    function renderInGuild(r: any): void {
      const g = r.guild;
      const meIsLeader = r.myRank === 'leader';
      const meIsElder = r.myRank === 'elder';
      content.add(scene.add.text(px + 30, py + 66, `〈${g.name}〉`, { fontSize: '22px', color: '#ffe8b0', fontStyle: 'bold' }).setOrigin(0, 0.5));
      content.add(scene.add.text(px + 30, py + 102, `我的职位：${RANK_NAME[r.myRank]}　成员：${g.memberCount}人　等级：Lv.${g.level}`, { fontSize: '14px', color: '#aabbcc' }).setOrigin(0, 0.5));
      content.add(scene.add.text(px + 30, py + 128, `公告：${g.notice || '（无）'}`, { fontSize: '13px', color: '#8899bb', wordWrap: { width: 440 } }).setOrigin(0, 0.5));

      // 成员列表（左列）
      content.add(scene.add.text(px + 30, py + 162, '成员', { fontSize: '16px', color: '#e8d5a3', fontStyle: 'bold' }).setOrigin(0, 0.5));
      (g.members || []).forEach((m: any, i: number) => {
        const ry = py + 190 + i * 27;
        if (ry > py + 560) return; // 简易截断
        const isLeader = m.rank === 'leader';
        content.add(scene.add.text(px + 30, ry, m.name, { fontSize: '14px', color: isLeader ? '#ffd27a' : '#cdd6e8' }).setOrigin(0, 0.5));
        content.add(scene.add.text(px + 220, ry, `[${RANK_NAME[m.rank]}]`, { fontSize: '13px', color: '#8899bb' }).setOrigin(0, 0.5));
        if (meIsLeader && !isLeader) {
          btn(px + 330, ry, m.rank === 'elder' ? '降成员' : '升长老', 0x33507a, '#bcd4ff', () => {
            GuildClient.setRank(scene.authToken, scene.characterId, m.charId, m.rank === 'elder' ? 'member' : 'elder')
              .then((res: any) => res.ok ? refresh() : toast(res.msg));
          });
          btn(px + 415, ry, '转让', 0x6a4a2a, '#ffd9a0', () => {
            GuildClient.transfer(scene.authToken, scene.characterId, m.charId)
              .then((res: any) => res.ok ? (toast('已转让会长'), refresh()) : toast(res.msg));
          });
          btn(px + 480, ry, '踢出', 0x6a2a2a, '#ffb0b0', () => {
            GuildClient.kick(scene.authToken, scene.characterId, m.charId)
              .then((res: any) => res.ok ? refresh() : toast(res.msg));
          });
        } else if (meIsElder && m.rank === 'member') {
          btn(px + 420, ry, '踢出', 0x6a2a2a, '#ffb0b0', () => {
            GuildClient.kick(scene.authToken, scene.characterId, m.charId)
              .then((res: any) => res.ok ? refresh() : toast(res.msg));
          });
        }
      });

      // 待审申请（右列上）
      const apps = r.applications || [];
      if ((meIsLeader || meIsElder) && apps.length > 0) {
        const ax = px + 540;
        content.add(scene.add.text(ax, py + 162, '待审申请', { fontSize: '16px', color: '#e8d5a3', fontStyle: 'bold' }).setOrigin(0, 0.5));
        apps.slice(0, 4).forEach((a: any, i: number) => {
          const ry = py + 192 + i * 30;
          content.add(scene.add.text(ax, ry, a.name, { fontSize: '13px', color: '#cdd6e8' }).setOrigin(0, 0.5));
          btn(ax + 160, ry, '同意', 0x2a6e4a, '#cfeedd', () => {
            GuildClient.handleApply(scene.authToken, scene.characterId, a.id, true)
              .then((res: any) => res.ok ? refresh() : toast(res.msg));
          });
          btn(ax + 235, ry, '拒绝', 0x6a2a2a, '#ffb0b0', () => {
            GuildClient.handleApply(scene.authToken, scene.characterId, a.id, false)
              .then((res: any) => res.ok ? refresh() : toast(res.msg));
          });
        });
      }

      // 公告编辑（会长/长老，右列中）
      if (meIsLeader || meIsElder) {
        const nx = px + 540;
        content.add(scene.add.text(nx, py + 330, '修改公告：', { fontSize: '13px', color: '#aabbcc' }).setOrigin(0, 0.5));
        const nInput = placeInput(nx + 120, py + 330, 320, 30, 200, g.notice || '');
        btn(nx + 410, py + 330, '保存', 0x2a6e4a, '#cfeedd', () => {
          GuildClient.setNotice(scene.authToken, scene.characterId, nInput.value.trim())
            .then((res: any) => res.ok ? (toast('公告已更新'), refresh()) : toast(res.msg));
        });
      }

      // 退出 / 解散（左列底）
      btn(px + 70, py + PH - 46, '退出公会', 0x6a4a2a, '#ffd9a0', () => {
        GuildClient.leave(scene.authToken, scene.characterId)
          .then((res: any) => res.ok ? (toast('已退出公会'), refresh()) : toast(res.msg));
      });
      if (meIsLeader) {
        btn(px + 220, py + PH - 46, '解散公会', 0x6a2a2a, '#ffb0b0', () => {
          GuildClient.disband(scene.authToken, scene.characterId)
            .then((res: any) => res.ok ? (toast('公会已解散'), refresh()) : toast(res.msg));
        });
      }

      // 公会聊天（右列底）
      const chatX = px + 540, chatY = py + 372, chatW = 440, chatH = 270;
      const cbox = scene.add.graphics();
      cbox.fillStyle(0x0c0c18, 0.6); cbox.fillRoundedRect(chatX, chatY, chatW, chatH, 8);
      cbox.lineStyle(1, 0x334466, 0.5); cbox.strokeRoundedRect(chatX, chatY, chatW, chatH, 8);
      content.add(cbox);
      content.add(scene.add.text(chatX + 12, chatY + 8, '公会聊天', { fontSize: '13px', color: '#aaccdd', fontStyle: 'bold' }).setOrigin(0, 0.5));
      const chatLines = scene.add.container(chatX + 8, chatY + 30);
      content.add(chatLines);
      scene.guildChatLines = chatLines;
      (GameState.chatLog || []).filter((m: any) => m.channel === 'guild').forEach((m: any) => {
        chatLines.add(scene.add.text(0, chatLines.length * 15, `${m.fromName}：${m.text}`, {
          fontSize: '12px', color: m.fromCharId === scene.characterId ? '#9fe6ff' : '#cdd6e8',
          wordWrap: { width: chatW - 16 }, padding: { y: 1 },
        }));
      });
      const chatInput = placeInput(chatX + 150, chatY + chatH + 24, 280, 32, 200);
      btn(chatX + 400, chatY + chatH + 24, '发送', 0x33507a, '#bcd4ff', () => {
        const t = chatInput.value.trim();
        if (t) { scene.sendGuildChat(t); chatInput.value = ''; }
      });
    }

    return c;
  }
