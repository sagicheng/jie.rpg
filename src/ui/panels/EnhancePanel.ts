/**
 * 强化 / 精炼 / 分解 面板 — 调用 EnhanceSystem 的 UI 交互
 */
import type { GameScene } from '../../scenes/GameScene';
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../../config/config';
import { GameState } from '../../managers/GameState';
import { Inventory, Item } from '../../managers/Inventory';
import {
  getEnhanceRate, getEnhanceCost, doEnhance,
  getRefineMaxSlots, getRefineCost, doRefine, doRefineReset, getRefineDisplay,
  getDecompReturn, doDecompose,
  getEnhanceLabel, getEnhanceGlow,
} from '../../managers/EnhanceSystem';
import {
  requestEnhance, requestRefine, requestDecompose, requestRefineReset,
} from '../../api/WorldClient';

export function addEnhanceGlow(
  scene: GameScene,
  container: Phaser.GameObjects.Container,
  base: Phaser.GameObjects.Graphics,
  x: number, y: number, w: number, h: number,
  item: Item, radius = 6,
): void {
  const glow = getEnhanceGlow(item);
  if (!glow) return;
  const g = scene.add.graphics();
  g.lineStyle(7, glow.color, glow.intensity * 0.22);
  g.strokeRoundedRect(x - 2, y - 2, w + 4, h + 4, radius + 2);
  g.lineStyle(2, glow.color, Math.min(1, glow.intensity * 0.9));
  g.strokeRoundedRect(x, y, w, h, radius);
  container.addAt(g, container.list.indexOf(base) + 1);
  const tw = scene.tweens.add({
    targets: g, alpha: { from: 0.5, to: 1 },
    duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
  });
  container.once('destroy', () => { scene.tweens.remove(tw); });
}

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
  p.add(scene.add.text(GAME_WIDTH / 2, oy + th / 2, '\u25c6  \u5f3a \u5316 \u5de5 \u574a  \u25c6', {
    fontSize: '22px', color: '#e8d5a3', fontStyle: 'bold', padding: { y: 3 } }).setOrigin(0.5));
  p.add(scene.add.text(ox + ow - 40, oy + th / 2, '\u2715', {
    fontSize: '22px', color: '#cc6666', padding: { x: 8, y: 4 } }).setOrigin(0.5)
    .setInteractive({ useHandCursor: true })
    .on('pointerover', function (this: any) { this.setColor('#ff8888'); })
    .on('pointerout', function (this: any) { this.setColor('#cc6666'); })
    .on('pointerdown', () => closeEnhancePanel(scene)));

  // Tabs
  const tabs = ['\u5f3a\u5316', '\u7cbe\u70bc', '\u5206\u89e3'];
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

  // ======== Scrollable content area ========
  const listY = tabY + 44;
  const FOOTER_H = 32;
  const scrollAreaH = oh - (listY - oy) - FOOTER_H;
  const scrollW = ow - 30;

  // Scroll container — content beyond visible area hidden naturally by panel bg + footer
  const scrollCont = scene.add.container(ox + 15, listY);
  p.add(scrollCont);

  const eq = Inventory.equipment;
  const eqSlots = ['weapon', 'head', 'body', 'bracer', 'boots', 'belt', 'ring', 'necklace', 'charm', 'pendant'];
  const sn: Record<string, string> = { weapon: '\u6b66\u5668', head: '\u5934\u90e8', body: '\u8eab\u4f53', bracer: '\u624b\u7532', boots: '\u6218\u9774', belt: '\u8170\u5e26', ring: '\u6212\u6307', necklace: '\u9879\u94fe', charm: '\u62a4\u7b26', pendant: '\u6302\u9970' };
  const qc: Record<string, string> = { white: '#aaaaaa', green: '#44cc44', blue: '#4488ff', purple: '#cc44cc', gold: '#ffaa00' };
  const ROW_H = 72, BAG_ROW_H = 68;
  let curY = 0;
  let scrollOffset = 0;

  // --- Equipped slots ---
  eqSlots.forEach((s, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const sx = col * 520, sy = row * ROW_H;
    const item = (eq as any)[s];
    curY = Math.max(curY, sy + ROW_H);
    const er = scene.add.graphics(); er.fillStyle(0x0d0d1d, 0.7); er.fillRoundedRect(sx, sy, 500, 62, 6);
    er.lineStyle(1, 0x334466, 0.4); er.strokeRoundedRect(sx, sy, 500, 62, 6); scrollCont.add(er);
    if (item) addEnhanceGlow(scene, scrollCont as any, er, sx, sy, 500, 62, item as Item, 6);
    scrollCont.add(scene.add.text(sx + 10, sy + 4, sn[s] || s, { fontSize: '10px', color: '#556688', padding: { y: 1 } }));
    if (item) {
      const elv = (item as any).enhanceLevel || 0; const enhLabel = getEnhanceLabel(item);
      const q = item.quality || 'white';
      scrollCont.add(scene.add.text(sx + 10, sy + 20, `${enhLabel} ${item.name}`, { fontSize: '13px', color: qc[q] || '#cccccc', fontStyle: 'bold', padding: { y: 1 } }));
      const stats = Object.entries(item.stats as Record<string, number>).map(([k, v]) => `${k}+${v}`).join('  ');
      scrollCont.add(scene.add.text(sx + 10, sy + 40, stats, { fontSize: '9px', color: '#7788aa', padding: { y: 1 } }));
      const eqRef2 = getRefineDisplay(item);
      if (eqRef2) scrollCont.add(scene.add.text(sx + 10, sy + 52, eqRef2, { fontSize: '8px', color: '#F5A623', padding: { y: 1 } }));
      if (activeTab === 0) {
        if (elv < 10) {
          const cost = getEnhanceCost(elv + 1, (item as any).quality || 'white'); const rate = getEnhanceRate(elv + 1);
          scrollCont.add(scene.add.text(sx + 300, sy + 8, `${cost.gold}\u91d1\u5e01 | ${Math.round(rate * 100)}%`, { fontSize: '10px', color: '#888899', padding: { y: 1 } }));
          const btn = scene.add.text(sx + 420, sy + 4, '[ \u5f3a\u5316 ]', { fontSize: '16px', color: '#ff8844', fontStyle: 'bold', padding: { x: 16, y: 8 }, backgroundColor: '#33220088' }).setInteractive({ useHandCursor: true });
          btn.on('pointerover', () => btn.setColor('#ffaa66'));
          btn.on('pointerout', () => btn.setColor('#ff8844'));
          btn.on('pointerdown', () => {
            if (scene.gameRoom) { if (!requestEnhance(item.id)) return; return; }
            const result = doEnhance(item);
            GameState.recalcStats(); closeEnhancePanel(scene); toggleEnhancePanel(scene);
            scene.scene.get('UIScene').events.emit('updateStats');
            const n = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, result.message, { fontSize: '16px', color: result.success ? '#88ff88' : '#ff6666', fontStyle: 'bold', backgroundColor: '#112211cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400);
            scene.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => n.destroy() });
          });
          scrollCont.add(btn);
        } else { scrollCont.add(scene.add.text(sx + 380, sy + 20, '\u5df2\u6ee1\u7ea7', { fontSize: '14px', color: '#ffcc44', fontStyle: 'bold', padding: { y: 2 } })); }
      } else if (activeTab === 1) {
        const maxSlots = getRefineMaxSlots((item as any).quality || 'white');
        const curSlots = (item as any).refineStats?.length || 0;
        const refineCost = getRefineCost(item);
        if (curSlots < maxSlots) {
          scrollCont.add(scene.add.text(sx + 300, sy + 8, `${refineCost.gold}\u91d1\u5e01 | ${curSlots}/${maxSlots}\u69fd`, { fontSize: '10px', color: '#888899', padding: { y: 1 } }));
          const btn = scene.add.text(sx + 420, sy + 4, '[ \u7cbe\u70bc ]', { fontSize: '16px', color: '#4488ff', fontStyle: 'bold', padding: { x: 16, y: 8 }, backgroundColor: '#11224488' }).setInteractive({ useHandCursor: true });
          btn.on('pointerover', () => btn.setColor('#66aaff'));
          btn.on('pointerout', () => btn.setColor('#4488ff'));
          btn.on('pointerdown', () => {
            if (scene.gameRoom) { if (!requestRefine(item.id)) return; return; }
            const result = doRefine(item);
            GameState.recalcStats(); closeEnhancePanel(scene); toggleEnhancePanel(scene);
            scene.scene.get('UIScene').events.emit('updateStats');
            const n = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, result.message, { fontSize: '16px', color: result.success ? '#88ccff' : '#ff6666', fontStyle: 'bold', backgroundColor: '#111122cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400);
            scene.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => n.destroy() });
          });
          scrollCont.add(btn);
        } else {
          scrollCont.add(scene.add.text(sx + 300, sy + 8, `${curSlots}/${maxSlots}\u69fd\u5df2\u6ee1`, { fontSize: '10px', color: '#888899', padding: { y: 1 } }));
          const btn = scene.add.text(sx + 420, sy + 4, '[ \u91cd\u7f6e ]', { fontSize: '16px', color: '#cc8844', fontStyle: 'bold', padding: { x: 16, y: 8 }, backgroundColor: '#33220088' }).setInteractive({ useHandCursor: true });
          btn.on('pointerdown', () => {
            if (scene.gameRoom) { if (!requestRefineReset(item.id)) return; return; }
            doRefineReset(item); GameState.recalcStats(); closeEnhancePanel(scene); toggleEnhancePanel(scene); scene.scene.get('UIScene').events.emit('updateStats');
          });
          scrollCont.add(btn);
        }
      } else {
        const decompReturn = getDecompReturn(item);
        const matStr = decompReturn.materials.map(m => `${m.name}\u00d7${m.qty}`).join(', ');
        scrollCont.add(scene.add.text(sx + 300, sy + 8, `${decompReturn.gold}\u91d1\u5e01 | ${matStr}`, { fontSize: '9px', color: '#888899', padding: { y: 1 } }));
        const btn = scene.add.text(sx + 420, sy + 4, '[ \u5206\u89e3 ]', { fontSize: '16px', color: '#88cc44', fontStyle: 'bold', padding: { x: 16, y: 8 }, backgroundColor: '#11221188' }).setInteractive({ useHandCursor: true });
        btn.on('pointerover', () => btn.setColor('#aaffaa'));
        btn.on('pointerout', () => btn.setColor('#88cc44'));
        btn.on('pointerdown', () => {
          if (scene.gameRoom) { if (!requestDecompose(item.id)) return; return; }
          const result = doDecompose(item);
          GameState.recalcStats(); closeEnhancePanel(scene); toggleEnhancePanel(scene);
          scene.scene.get('UIScene').events.emit('updateStats');
          const n = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, result.message, { fontSize: '16px', color: '#88cc44', fontStyle: 'bold', backgroundColor: '#112211cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400);
          scene.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => n.destroy() });
        });
        scrollCont.add(btn);
      }
    } else { scrollCont.add(scene.add.text(sx + 10, sy + 24, '\u672a\u88c5\u5907', { fontSize: '13px', color: '#334455', padding: { y: 1 } })); }
  });

  // --- Bag equipment ---
  const bagItems = Inventory.items.filter(it => it.type === 'equipment');
  if (bagItems.length > 0) {
    const bagY = 5 * ROW_H + 10;
    curY = Math.max(curY, bagY);
    scrollCont.add(scene.add.text(0, bagY, '\u80cc\u5305\u88c5\u5907', { fontSize: '14px', color: '#88aacc', fontStyle: 'bold', padding: { y: 2 } }));
    bagItems.forEach((item, bi) => {
      const col = bi % 2, row = Math.floor(bi / 2);
      const sx = col * 520, sy = bagY + 28 + row * BAG_ROW_H;
      curY = Math.max(curY, sy + BAG_ROW_H);
      const er2 = scene.add.graphics(); er2.fillStyle(0x0d0d1d, 0.7); er2.fillRoundedRect(sx, sy, 500, 58, 6);
      er2.lineStyle(1, 0x334466, 0.4); er2.strokeRoundedRect(sx, sy, 500, 58, 6); scrollCont.add(er2);
      addEnhanceGlow(scene, scrollCont as any, er2, sx, sy, 500, 58, item, 6);
      const elv = (item as any).enhanceLevel || 0; const q = (item as any).quality || 'white';
      scrollCont.add(scene.add.text(sx + 10, sy + 4, `${item.name}${elv > 0 ? ' +' + elv : ''}`, { fontSize: '12px', color: qc[q] || '#cccccc', fontStyle: 'bold', padding: { y: 1 } }));
      const stats = item.stats ? Object.entries(item.stats as Record<string, number>).map(([k, v]) => `${k}+${v}`).join(' ') : '';
      scrollCont.add(scene.add.text(sx + 10, sy + 24, stats, { fontSize: '9px', color: '#7788aa', padding: { y: 1 } }));
      const bagRef2 = getRefineDisplay(item);
      if (bagRef2) scrollCont.add(scene.add.text(sx + 10, sy + 36, bagRef2, { fontSize: '8px', color: '#F5A623', padding: { y: 1 } }));
      if (scene.enhanceTab === 0 && elv < 10) {
        const cost = getEnhanceCost(elv + 1, q); const rate = getEnhanceRate(elv + 1);
        scrollCont.add(scene.add.text(sx + 280, sy + 6, `${cost.gold}\u91d1 ${Math.round(rate * 100)}%`, { fontSize: '9px', color: '#888899', padding: { y: 1 } }));
        const btn = scene.add.text(sx + 400, sy + 4, '[ \u5f3a\u5316 ]', { fontSize: '14px', color: '#ff8844', fontStyle: 'bold', padding: { x: 12, y: 6 }, backgroundColor: '#33220088' }).setInteractive({ useHandCursor: true });
        btn.on('pointerdown', () => {
          if (scene.gameRoom) { if (!requestEnhance(item.id)) return; return; }
          const result = doEnhance(item); GameState.recalcStats(); closeEnhancePanel(scene); toggleEnhancePanel(scene); scene.scene.get('UIScene').events.emit('updateStats'); const n = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, result.message, { fontSize: '16px', color: result.success ? '#88ff88' : '#ff6666', fontStyle: 'bold', backgroundColor: '#112211cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400); scene.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => n.destroy() });
        });
        scrollCont.add(btn);
      } else if (scene.enhanceTab === 1) {
        const maxSlots = getRefineMaxSlots(q); const curSlots = (item as any).refineStats?.length || 0;
        if (curSlots < maxSlots) {
          const rc = getRefineCost(item);
          scrollCont.add(scene.add.text(sx + 280, sy + 6, `${rc.gold}\u91d1 ${curSlots}/${maxSlots}\u69fd`, { fontSize: '9px', color: '#888899', padding: { y: 1 } }));
          const btn = scene.add.text(sx + 400, sy + 4, '[ \u7cbe\u70bc ]', { fontSize: '14px', color: '#4488ff', fontStyle: 'bold', padding: { x: 12, y: 6 }, backgroundColor: '#11224488' }).setInteractive({ useHandCursor: true });
          btn.on('pointerdown', () => {
            if (scene.gameRoom) { if (!requestRefine(item.id)) return; return; }
            const result = doRefine(item); GameState.recalcStats(); closeEnhancePanel(scene); toggleEnhancePanel(scene); scene.scene.get('UIScene').events.emit('updateStats'); const n = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, result.message, { fontSize: '16px', color: result.success ? '#88ccff' : '#ff6666', fontStyle: 'bold', backgroundColor: '#111122cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400); scene.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => n.destroy() });
          });
          scrollCont.add(btn);
        } else {
          scrollCont.add(scene.add.text(sx + 350, sy + 8, `${curSlots}/${maxSlots}\u6ee1`, { fontSize: '10px', color: '#888899', padding: { y: 1 } }));
          const btn = scene.add.text(sx + 420, sy + 4, '[ \u91cd\u7f6e ]', { fontSize: '14px', color: '#cc8844', fontStyle: 'bold', padding: { x: 12, y: 6 }, backgroundColor: '#33220088' }).setInteractive({ useHandCursor: true });
          btn.on('pointerdown', () => {
            if (scene.gameRoom) { if (!requestRefineReset(item.id)) return; return; }
            doRefineReset(item); GameState.recalcStats(); closeEnhancePanel(scene); toggleEnhancePanel(scene); scene.scene.get('UIScene').events.emit('updateStats');
          });
          scrollCont.add(btn);
        }
      } else if (scene.enhanceTab === 2) {
        const dr = getDecompReturn(item);
        scrollCont.add(scene.add.text(sx + 280, sy + 6, `${dr.gold}\u91d1 ${dr.materials.map(m => m.name + '\u00d7' + m.qty).join(',')}`, { fontSize: '8px', color: '#888899', padding: { y: 1 } }));
        const btn = scene.add.text(sx + 400, sy + 4, '[ \u5206\u89e3 ]', { fontSize: '14px', color: '#88cc44', fontStyle: 'bold', padding: { x: 12, y: 6 }, backgroundColor: '#11221188' }).setInteractive({ useHandCursor: true });
        btn.on('pointerdown', () => {
          if (scene.gameRoom) { if (!requestDecompose(item.id)) return; return; }
          const result = doDecompose(item); GameState.recalcStats(); closeEnhancePanel(scene); toggleEnhancePanel(scene); scene.scene.get('UIScene').events.emit('updateStats'); const n = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, result.message, { fontSize: '16px', color: '#88cc44', fontStyle: 'bold', backgroundColor: '#112211cc', padding: { x: 20, y: 10 } }).setOrigin(0.5).setScrollFactor(0).setDepth(400); scene.tweens.add({ targets: n, alpha: 0, y: GAME_HEIGHT / 2 - 90, duration: 2000, onComplete: () => n.destroy() });
        });
        scrollCont.add(btn);
      }
    });
  }

  // ======== Scroll wheel ========
  // Clip overlay: hides content that overflows below the scroll area
  const clipBg = scene.add.graphics().setDepth(299);
  clipBg.fillStyle(0x121222, 0.98);
  clipBg.fillRect(ox, listY + scrollAreaH, ow, oh - scrollAreaH - (listY - oy));
  p.add(clipBg);

  const maxScroll = Math.max(0, curY - scrollAreaH);
  if (maxScroll > 0) {
    // Scrollbar track
    const trackX = ox + ow - 14;
    const trackH = scrollAreaH - 4;
    const bar = scene.add.graphics().setDepth(301);
    const drawBar = () => {
      bar.clear();
      const ratio = scrollAreaH / curY;
      const barH = Math.max(20, trackH * ratio);
      const barY = listY + 2 + (trackH - barH) * (scrollOffset / maxScroll);
      bar.fillStyle(0x445566, 0.5);
      bar.fillRoundedRect(trackX, listY + 2, 8, trackH, 4);
      bar.fillStyle(0x88aacc, 0.8);
      bar.fillRoundedRect(trackX, barY, 8, barH, 4);
    };
    drawBar();
    p.add(bar);

    // Wheel handler
    const wheelHandler = (e: WheelEvent) => {
      if (!scene.enhancePanel) { window.removeEventListener('wheel', wheelHandler); return; }
      scrollOffset = Phaser.Math.Clamp(scrollOffset + e.deltaY * 0.5, 0, maxScroll);
      scrollCont.y = listY - scrollOffset;
      drawBar();
    };
    window.addEventListener('wheel', wheelHandler);
    p.once('destroy', () => window.removeEventListener('wheel', wheelHandler));
  }

  // Footer
  const fy = oy + oh - 28; const ft = scene.add.graphics();
  ft.fillStyle(0x1a1a36, 0.8); ft.fillRoundedRect(ox + 4, fy, ow - 8, 24, { tl: 0, tr: 0, bl: 10, br: 10 }); p.add(ft);
  p.add(scene.add.text(GAME_WIDTH / 2, fy + 12, 'ESC \u5173\u95ed  |  \u5207\u6362\u6807\u7b7e\u9009\u62e9\u529f\u80fd  |  \u6eda\u8f6e\u7ffb\u9875', {
    fontSize: '11px', color: '#556688', padding: { y: 2 } }).setOrigin(0.5));
}

export function closeEnhancePanel(scene: GameScene): void { scene.enhancePanel?.destroy(true); scene.enhancePanel = null; scene.resumeFromMenu(); }
