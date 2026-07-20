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



export const RANK_NAME: Record<string, string> = { leader: '会长', elder: '长老', member: '成员' };

  // 公会面板 Tab 状态（模块级：避免 refresh() 重建面板时把 Tab 重置回 info，导致"行会商店打不开"）
export let guildPanelTab: 'info' | 'shop' = 'info';

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
export function setupScroll(
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
    let maskG: Phaser.GameObjects.Graphics | null = null;
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
      maskG = scene.make.graphics({});
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
      // 挂到 scrollContent 的 DESTROY（而非面板 c）：拍卖行改为「只重建列表区」后，面板 c 不再销毁，
      // 必须由 scrollContent 级联销毁来触发监听清理，否则 wheel/drag 监听会泄漏并多实例冲突。
      scrollContent.once(Phaser.GameObjects.Events.DESTROY, () => {
        scene.input.off('wheel', onWheel);
        scene.input.off('pointermove', onMove);
        scene.input.off('pointerup', onUp);
        if (maskG) maskG.destroy();
      });
    }
  }

