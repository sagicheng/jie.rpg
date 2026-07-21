/**
 * 角色属性面板（L0）——按 Phaser3 版式在 Cocos 1920×1080 下 1:1 复刻。
 *
 * 坐标转换：Phaser 是「左上原点、y 向下、(0,0)=屏幕左上、1920×1080」。
 * Cocos 是「中心原点、y 向上、x∈[-960,960]、y∈[-540,540]」。
 * 统一用 `cx(px)=px-960`、`cy(py)=540-py` 把 Phaser 任意点映射到 Cocos，
 * 文本锚点据此取 0/0.5/1（0=左/上，1=右/下）。所有数值直接照搬 Phaser StatPanel.ts。
 *
 * 数据每次 worldSync 自动刷新（GameManager.onWorldSync 调用 refreshIfOpen）。
 */
import { Node, Label, Color } from 'cc';
import { UIManager } from './UIManager';
import { makeText, makeColorButton, makeModalShell, makeCard } from './widgets';
import { LocalPlayerWorld } from '../model/LocalPlayerWorld';
import { expForLevel, STAT_PER_POINT } from '../model/PlayerWorld';

const ALLOC_KEYS: Array<{ l: string; a: string; per: number; dk: string }> = [
  { l: 'HP', a: 'allocatedHP', per: STAT_PER_POINT.HP, dk: 'maxHp' },
  { l: 'MP', a: 'allocatedMP', per: STAT_PER_POINT.MP, dk: 'maxMp' },
  { l: 'ATK', a: 'allocatedATK', per: STAT_PER_POINT.ATK, dk: 'atk' },
  { l: 'DEF', a: 'allocatedDEF', per: STAT_PER_POINT.DEF, dk: 'def' },
  { l: 'MATK', a: 'allocatedMATK', per: STAT_PER_POINT.MATK, dk: 'matk' },
  { l: 'MDEF', a: 'allocatedMDEF', per: STAT_PER_POINT.MDEF, dk: 'mdef' },
  { l: 'SPD', a: 'allocatedSPD', per: STAT_PER_POINT.SPD, dk: 'spd' },
];
const POWERS = ['始解', '卍解', '虚化', '完现', '圣文', '狱解'];
const SLOT_NAME: Record<string, string> = {
  head: '头部', body: '身体', bracer: '手甲', boots: '战靴', belt: '腰带',
  ring: '戒指', necklace: '项链', charm: '护符', pendant: '挂饰',
};
const DERIV_KEYS: Array<{ k: string; label: string }> = [
  { k: 'maxHp', label: '生命' }, { k: 'maxMp', label: '法力' },
  { k: 'atk', label: '物攻' }, { k: 'def', label: '物防' },
  { k: 'matk', label: '魔攻' }, { k: 'mdef', label: '魔防' },
  { k: 'spd', label: '速度' }, { k: 'critRate', label: '暴击' },
  { k: 'statusAcc', label: '异常命中' },
];
const QUALITY_COLOR: Record<string, Color> = {
  white: new Color(204, 204, 204, 255), green: new Color(68, 204, 68, 255),
  blue: new Color(68, 136, 255, 255), purple: new Color(204, 68, 204, 255),
  gold: new Color(255, 170, 0, 255),
};

export class StatPanel {
  private static _inst: StatPanel | null = null;
  static get instance(): StatPanel {
    if (!this._inst) this._inst = new StatPanel();
    return this._inst;
  }

  private root: Node | null = null;
  private bridge: any = null;
  private open_ = false;

  private vNameLv: Label | null = null;
  private vSubInfo: Label | null = null;
  private vSP: Label | null = null;
  private vAllocTotal: Label | null = null;
  private vExpCur: Label | null = null;
  private vExpPct: Label | null = null;
  private powerLabels: Label[] = [];
  private allocVal: Record<string, Label> = {};
  private allocDetail: Record<string, Label> = {};
  private addBtns: Node[] = [];
  private zkName: Label | null = null;
  private zkSub: Label | null = null;
  private eqSlotName: Record<string, Label> = {};
  private eqSlotStats: Record<string, Label> = {};
  private eqSlotRefine: Record<string, Label> = {};
  private derivVal: Record<string, Label> = {};

  bindBridge(b: any): void { this.bridge = b; }

  toggle(b?: any): void {
    if (b) this.bridge = b;
    if (this.open_) this.close(); else this.open();
  }
  open(): void {
    if (!this.root) this.build();
    this.open_ = true;
    this.root!.active = true;
    this.refresh();
  }
  close(): void {
    this.open_ = false;
    if (this.root) this.root.active = false;
  }
  isOpen(): boolean { return this.open_; }
  refreshIfOpen(): void { if (this.open_ && this.root) this.refresh(); }

  // ══════════════════════════════════════════════════════════════
  // 坐标转换 helpers（Phaser 左上原点 y 向下 → Cocos 中心原点 y 向上）
  // ══════════════════════════════════════════════════════════════
  private build(): void {
    const { root } = makeModalShell(
      UIManager.instance.uiRoot, '◆  属 性 面 板  ◆', () => this.close(),
      'C键 开关  |  ESC 关闭  |  属性点已分配后如需洗点，请到商城购买「洗点符」使用  |  卸下装备请开背包(B)');
    this.root = root;

    const SW = 1920, SH = 1080;
    const cx = (px: number) => px - SW / 2;
    const cy = (py: number) => SH / 2 - py;
    // 文本：anchor(0,1)=左上, (0.5,0.5)=中心, (1,1)=右上
    const T = (px: number, py: number, str: string, size: number, color: Color,
               width = 400, hAlign: Label.HorizontalAlign = Label.HorizontalAlign.LEFT,
               ax = 0, ay = 1): Label =>
      makeText(root, cx(px), cy(py), str, size, color, width, hAlign, ax, ay);
    // 卡片：Phaser 矩形 (X,Y,W,H) 左上 y 向下
    const CR = (X: number, Y: number, W: number, H: number): void => {
      makeCard(root, cx(X) + W / 2, cy(Y) - H / 2, W, H);
    };

    // Phaser 常量（照搬）
    const ox = 30, oy = 20, ow = SW - 60, oh = SH - 40;
    const th = 54;
    const colW = (ow - 100) / 2;
    const lx = ox + 30;
    const rx = lx + colW + 40;
    const hdrY = oy + th + 14;

    // 商城入口按钮（位于标题栏右侧，Phaser ox+ow-200）
    makeColorButton(root, cx(ox + ow - 200), cy(oy + th / 2), 110, 40, '商城',
      new Color(60, 40, 10, 220), new Color(110, 70, 20, 255),
      () => UIManager.instance.showToast('商城将在 L2 装备深化阶段接入'), 15, 6);

    // ═══ 左列：信息 banner ═══
    const infoBgY = hdrY, infoBgH = 58;
    CR(lx, infoBgY, colW, infoBgH);
    this.vNameLv = T(lx + 16, infoBgY + 8, '勇者   Lv.1', 16, new Color(232, 213, 163, 255), 600);
    this.vNameLv.isBold = true;
    this.vSubInfo = T(lx + 16, infoBgY + 32, '金币: 0    元素: 无    斩魄刀: 无', 12, new Color(136, 153, 187, 255), colW - 32);

    // ═══ 左列：力量体系 ═══
    const unlockY = hdrY + 72;
    CR(lx, unlockY, colW, 40);
    T(lx + 16, unlockY + 6, '力量体系', 11, new Color(85, 102, 136, 255), 120);
    const pwSpacing = (colW - 32) / 6;
    for (let i = 0; i < 6; i++) {
      const px = lx + 16 + i * pwSpacing + pwSpacing / 2;
      const lbl = T(px, unlockY + 26, `${POWERS[i]}✗`, 12, new Color(68, 85, 102, 255), pwSpacing, Label.HorizontalAlign.CENTER, 0.5, 0.5);
      lbl.isBold = true;
      this.powerLabels.push(lbl);
    }

    // ═══ 左列：剩余属性点 + 已分配 + 经验 ═══
    const spY = unlockY + 54;
    CR(lx, spY, colW, 36);
    this.vSP = T(lx + 20, spY + 7, '剩余属性点: 0', 19, new Color(102, 119, 136, 255), 280);
    this.vSP.isBold = true;
    T(lx + colW - 20, spY + 10, 'HP+15 / MP+5 / 其他+1', 11, new Color(85, 102, 136, 255), 220, Label.HorizontalAlign.RIGHT, 1, 1);

    const allocLineY = spY + 42;
    this.vAllocTotal = T(lx + 20, allocLineY, '已分配点数: 0', 13, new Color(136, 204, 255, 255), 280);

    const expY = spY + 66;
    CR(lx, expY, colW, 40);
    this.vExpCur = T(lx + 20, expY + 5, '当前经验: 0 / 升级所需: 0', 13, new Color(136, 204, 255, 255), 600);
    this.vExpPct = T(lx + 20, expY + 22, '当前经验百分比: 0%', 13, new Color(136, 204, 255, 255), 600);

    // ═══ 左列：属性行 ═══
    const atY = spY + 112;
    const rowH = 50;
    for (let i = 0; i < ALLOC_KEYS.length; i++) {
      const a = ALLOC_KEYS[i];
      const ay = atY + i * rowH;
      CR(lx, ay, colW, 46);
      T(lx + 18, ay + 14, a.l, 16, new Color(255, 232, 176, 255), 60);
      this.allocVal[a.a] = T(lx + 90, ay + 12, '0', 20, new Color(136, 204, 255, 255), 80);
      this.allocVal[a.a].isBold = true;
      this.allocDetail[a.a] = T(lx + 160, ay + 16, `(加点0 × ${a.per} = +0)`, 12, new Color(102, 119, 170, 255), 260);
      const btn = makeColorButton(root, cx(lx + colW - 110), cy(ay + 8), 44, 40, '＋',
        new Color(60, 140, 60, 220), new Color(100, 200, 100, 255), () => this.allocate(a.a), 22, 4);
      this.addBtns.push(btn);
    }

    // ═══ 左列：PVP 竞技场（占位，数据 L7 接入）═══
    const arenaY = atY + ALLOC_KEYS.length * rowH + 16;
    if (arenaY + 150 < oy + oh) {
      CR(lx, arenaY, colW, 150);
      T(lx + 16, arenaY + 8, '⚔ PVP 竞技场', 13, new Color(201, 160, 255, 255), 300);
      T(lx + 16, arenaY + 30, '当前段位: —    积分: 0', 12, new Color(204, 187, 255, 255), 400);
      T(lx + 16, arenaY + 50, '本周匹配: 0 / 0', 12, new Color(204, 187, 255, 255), 400);
      T(lx + 16, arenaY + 70, '历史最高段位: —', 12, new Color(255, 204, 136, 255), 400);
      T(lx + 16, arenaY + 90, '过往赛季: — 暂无 —', 11, new Color(153, 136, 187, 255), colW - 32);
      T(lx + 16, arenaY + 124, '（点「竞技场」按钮进入匹配）', 10, new Color(102, 119, 170, 255), 400);
      makeColorButton(root, cx(lx + colW - 14), cy(arenaY + 8), 100, 36, '竞技场',
        new Color(50, 35, 80, 220), new Color(90, 60, 140, 255),
        () => UIManager.instance.showToast('竞技场将在 L7 组队/竞技场阶段接入'), 14, 6);
    }

    // ═══ 右列：装备栏标题 ═══
    T(rx, hdrY, '装备栏', 18, new Color(170, 204, 221, 255), 200);
    T(rx + 80, hdrY + 4, '（查看用·卸下请开背包 B）', 11, new Color(85, 102, 136, 255), 320);

    // ═══ 右列：斩魄刀卡片 ═══
    const eqY = hdrY + 36;
    const eqColW = (colW - 10) / 2;
    const zkW = 2 * eqColW + 10, zkH = 66;
    CR(rx, eqY, zkW, zkH);
    T(rx + 10, eqY + 6, '斩魄刀', 11, new Color(102, 119, 153, 255), 200);
    this.zkName = T(rx + 10, eqY + 24, '— 未觉醒 —', 13, new Color(51, 68, 85, 255), zkW - 20);
    this.zkSub = T(rx + 10, eqY + 46, '元素: 无  (始解✗)', 10, new Color(136, 153, 187, 255), zkW - 20);

    // ═══ 右列：装备槽 2×5 ═══
    const eqs = ['head', 'body', 'bracer', 'boots', 'belt', 'ring', 'necklace', 'charm', 'pendant'];
    const eqRowH = 76;
    for (let i = 0; i < eqs.length; i++) {
      const s = eqs[i];
      const c2 = i % 2, r2 = Math.floor(i / 2);
      const sx = rx + c2 * (eqColW + 10);
      const sy = eqY + eqRowH + r2 * eqRowH;
      CR(sx, sy, eqColW, 66);
      T(sx + 10, sy + 6, SLOT_NAME[s], 11, new Color(102, 119, 153, 255), 200);
      this.eqSlotName[s] = T(sx + 10, sy + 24, '— 空 —', 13, new Color(51, 68, 85, 255), eqColW - 20);
      this.eqSlotStats[s] = T(sx + 10, sy + 46, '', 10, new Color(136, 153, 187, 255), eqColW - 20);
      this.eqSlotRefine[s] = T(sx + 10, sy + 58, '', 9, new Color(245, 166, 35, 255), eqColW - 20);
    }

    // ═══ 右列：战斗属性 ═══
    const sumY = eqY + 6 * eqRowH + 8;
    if (sumY + 142 < oy + oh) {
      CR(rx, sumY, colW, 132);
      T(rx + 16, sumY + 8, '战斗属性', 13, new Color(170, 204, 221, 255), 200);
      for (let i = 0; i < DERIV_KEYS.length; i++) {
        const d = DERIV_KEYS[i];
        const c2 = i % 2, r2 = Math.floor(i / 2);
        const dx = rx + 16 + c2 * (colW / 2 - 10);
        const dy = sumY + 32 + r2 * 22;
        this.derivVal[d.k] = T(dx, dy, `${d.label}: 0`, 12, new Color(255, 255, 255, 255), 220);
      }
    }
  }

  private allocate(allocKey: string): void {
    const a = ALLOC_KEYS.find((x) => x.a === allocKey);
    if (!a || !this.bridge) return;
    this.bridge.room?.send('intent', { op: 'allocateStat', attr: a.l });
  }

  private refresh(): void {
    const pw = LocalPlayerWorld.instance.get();
    if (!pw) return;
    const d = LocalPlayerWorld.instance.getDerived();
    const element = (pw as any).element || '无';

    const allocatedTotal =
      (pw.allocatedHP || 0) + (pw.allocatedMP || 0) + (pw.allocatedATK || 0) +
      (pw.allocatedDEF || 0) + (pw.allocatedMATK || 0) + (pw.allocatedMDEF || 0) + (pw.allocatedSPD || 0);
    const need = expForLevel(pw.level + 1);
    const expPct = need > 0 ? Math.floor((pw.exp / need) * 100) : 0;

    this.vNameLv!.string = `${pw.zanpakuto || '勇者'}   Lv.${pw.level}`;
    this.vSubInfo!.string = `金币: ${pw.gold}    元素: ${element}    斩魄刀: ${pw.zanpakuto || '无'}`;

    const unlockSet = new Set(pw.unlocks || []);
    const has = [
      unlockSet.has('shikai'), unlockSet.has('bankai'), unlockSet.has('hollow'),
      unlockSet.has('fullbring'), unlockSet.has('schrift'), unlockSet.has('hell'),
    ];
    for (let i = 0; i < 6; i++) {
      const lbl = this.powerLabels[i];
      lbl.string = `${POWERS[i]}${has[i] ? '✓' : '✗'}`;
      lbl.color = has[i] ? new Color(68, 204, 136, 255) : new Color(68, 85, 102, 255);
    }

    this.vSP!.string = `剩余属性点: ${pw.statPoints || 0}`;
    this.vSP!.color = (pw.statPoints || 0) > 0 ? new Color(255, 204, 68, 255) : new Color(102, 119, 136, 255);
    this.vAllocTotal!.string = `已分配点数: ${allocatedTotal}`;
    this.vExpCur!.string = `当前经验: ${pw.exp} / 升级所需: ${need}`;
    this.vExpPct!.string = `当前经验百分比: ${expPct}%`;

    for (const a of ALLOC_KEYS) {
      const al = (pw as any)[a.a] || 0;
      const av = d ? ((d as any)[a.dk] || 0) : 0;
      this.allocVal[a.a].string = `${av}`;
      this.allocDetail[a.a].string = `(加点${al} × ${a.per} = +${al * a.per})`;
    }

    const kn = pw.kidoNodes || {};
    const kidoPts = Object.values(kn).reduce((s: number, v: number) => s + (v || 0), 0);
    const school = pw.kidoSchool || '未修习';
    const equipped = (pw.kidoEquipped || []).length;
    const title = pw.activeTitle || '无';
    if (pw.zanpakuto) {
      this.zkName!.string = pw.zanpakuto;
      this.zkName!.color = new Color(232, 213, 163, 255);
      this.zkSub!.string = `元素:${element} 鬼道:${school}(投${kidoPts}/装${equipped}) 称号:${title} 始解${unlockSet.has('shikai') ? '✓' : '✗'}`;
    } else {
      this.zkName!.string = '— 未觉醒 —';
      this.zkName!.color = new Color(51, 68, 85, 255);
      this.zkSub!.string = `元素:无 鬼道:${school} 称号:${title} 始解✗`;
    }

    const eq = pw.equipment || ({} as Record<string, any>);
    for (const s of Object.keys(this.eqSlotName)) {
      const it = eq[s as any];
      const nameLbl = this.eqSlotName[s];
      const statsLbl = this.eqSlotStats[s];
      const refineLbl = this.eqSlotRefine[s];
      if (it) {
        const elv = it.enhanceLevel || 0;
        const lvTxt = elv > 0 ? ` +${elv}` : '';
        const q = it.quality || 'white';
        nameLbl.string = `${it.name}${lvTxt}`;
        nameLbl.color = QUALITY_COLOR[q] || new Color(204, 204, 204, 255);
        const eff = it.stats ? Object.entries(it.stats as Record<string, number>).map(([k, v]) => `${k}+${v}`).join('  ') : '';
        statsLbl.string = eff;
        refineLbl.string = this.refineDisplay(it);
      } else {
        nameLbl.string = '— 空 —';
        nameLbl.color = new Color(51, 68, 85, 255);
        statsLbl.string = '';
        refineLbl.string = '';
      }
    }

    if (d) {
      for (const k of DERIV_KEYS) {
        if (k.k === 'critRate') {
          this.derivVal[k.k].string = `${k.label}: ${(d as any).critRate || 0}%`;
        } else if (k.k === 'statusAcc') {
          const acc = Math.round(((d as any).statusAcc || 0) * 100);
          this.derivVal[k.k].string = `${k.label}: ${acc}%`;
        } else {
          this.derivVal[k.k].string = `${k.label}: ${String((d as any)[k.k] ?? 0)}`;
        }
      }
    }
  }

  private refineDisplay(it: any): string {
    if (!it.refineStats || !it.refineStats.length) return '';
    const parts = (it.refineStats as Array<{ key: string; value: number }>)
      .map((r) => `${r.key}+${r.value}`)
      .join(' ');
    return `精炼: ${parts}`;
  }
}
