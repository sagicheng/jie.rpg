import type { GameScene } from '../../scenes/GameScene';

import Phaser from 'phaser';

import { GAME_WIDTH, GAME_HEIGHT, ZANPAKUTO_GROWTH } from '../../core/config';

import { GameState } from '../../systems/progression/GameState';

import { GuildClient } from '../../systems/social/GuildClient';

import { FriendClient } from '../../systems/social/FriendClient';

import { GUILD_SKILLS, guildSkillCost } from '../../systems/social/GuildSkills';

import { SaveManager } from '../../core/SaveManager';

import { NAMED_ENEMIES, BESTIARY_TIERS, getBestiaryTierReached, getBestiaryTierProgress, BESTIARY_TITLES } from '../../systems/progression/BestiaryData';

import { expForLevel } from '../../systems/combat/BattleData';

import { Inventory, EquipSlot, Item } from '../../systems/items/Inventory';

import { listSetProgress, setShortName } from '../../systems/items/SetSystem';

import { PET_SPECIES_CLIENT, petIcon, petColor, computePetAura, petElementInfo, petQualityInfo, petSkillNames } from '../../systems/pet/PetSystem';

import { applyConsumable, getConsumableEffect } from '../../systems/items/ConsumableSystem';

import { createPlayerStatus } from '../../systems/combat/StatusSystem';

import { MAIN_QUESTS, MAIN_QUEST_ORDER, SIDE_QUESTS, getQuestDef, rollDailyPool, rollWeeklyPool, DAILY_CAP, WEEKLY_CAP } from '../../systems/quest/QuestData';

import { SHIKAI_SKILLS, ZANPAKUTO_ELEMENT } from '../../systems/combat/Skills';

import { Kido, KIDO_NODES, KidoSchool, TIER_LOCK } from '../../systems/combat/Kido';

import {
  getEnhanceRate, getEnhanceCost, doEnhance,
  getRefineMaxSlots, getRefineCost, doRefine, doRefineReset, getRefineDisplay,
  getDecompReturn, doDecompose,
  getEnhanceLabel, getEnhanceGlow,
} from '../../systems/items/EnhanceSystem';

import {
  requestBuy, requestEquip, requestUnequip, requestCraft, requestEnhance, requestRefine, requestDecompose, requestRefineReset, requestClaimQuest, requestAllocateStat, requestMallBuy, requestRespec,
  requestUnlock, requestSetZanpakuto, requestKidoSetSchool, requestKidoAllocate, requestClaimBestiaryTier, requestSetTitle, isOnline,
  requestArenaQueue, requestArenaCancel, requestArenaStatus, arena, tierNameById, ARENA_WEEKLY_CAP_CLIENT,
  requestGuildShopBuy,
  requestAuctionList, requestAuctionMine, requestAuctionFavList, requestAuctionHistory,
  requestAuctionFav, requestAuctionCreate, requestAuctionBuy, requestAuctionCancel,
  requestPetSetActive, requestPetRelease, requestPetRecall, requestPetSetAttr, requestUsePetEgg,
} from '../../systems/social/WorldClient';

import { GUILD_SHOP_ITEMS } from '../../systems/social/GuildShop';


import { setupScroll } from './GuildPanel';
import { auctionBody } from './AuctionPanel';

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
