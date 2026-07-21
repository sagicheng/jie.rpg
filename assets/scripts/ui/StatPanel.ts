/**
 * 角色属性面板（L0 地基）——按 Phaser3 版式在 Cocos 960×640 下全屏复刻。
 *
 * 单例 toggle。从 LocalPlayerWorld 读真实角色数据并渲染：
 *   - 等级 / 经验(距下一级) / 金币 / 可用属性点
 *   - 已分配属性(HP/MP/ATK/DEF/MATK/MDEF/SPD) + 加点按钮(发 intent allocateStat)
 *   - 六大力量体系解锁(unlocks)
 *   - 鬼道(kidoSchool + 已投点数 + 已装备主动技)
 *   - 称号(activeTitle)
 *   - 派生战斗属性(maxHp/maxMp/atk/def/matk/mdef/spd，来自 deriveStats)
 *
 * 数据每次 worldSync 自动刷新（GameManager.onWorldSync 调用 refreshIfOpen）。
 */
import { Node, Label, Color } from 'cc';
import { UIManager } from './UIManager';
import { makeText, makeColorButton, makeFullScreenPanel, makeCard } from './widgets';
import { LocalPlayerWorld } from '../model/LocalPlayerWorld';
import { expForLevel, STAT_PER_POINT } from '../model/PlayerWorld';

const W = 940, H = 620;
const ALLOC_KEYS: Array<{ k: string; label: string; per: number }> = [
  { k: 'allocatedHP', label: 'HP', per: STAT_PER_POINT.HP },
  { k: 'allocatedMP', label: 'MP', per: STAT_PER_POINT.MP },
  { k: 'allocatedATK', label: 'ATK', per: STAT_PER_POINT.ATK },
  { k: 'allocatedDEF', label: 'DEF', per: STAT_PER_POINT.DEF },
  { k: 'allocatedMATK', label: 'MATK', per: STAT_PER_POINT.MATK },
  { k: 'allocatedMDEF', label: 'MDEF', per: STAT_PER_POINT.MDEF },
  { k: 'allocatedSPD', label: 'SPD', per: STAT_PER_POINT.SPD },
];
const ALLOC_INTENT: Record<string, string> = {
  allocatedHP: 'HP', allocatedMP: 'MP', allocatedATK: 'ATK', allocatedDEF: 'DEF',
  allocatedMATK: 'MATK', allocatedMDEF: 'MDEF', allocatedSPD: 'SPD',
};
const ALLOC_TO_DERIVED: Record<string, string> = {
  allocatedHP: 'maxHp', allocatedMP: 'maxMp', allocatedATK: 'atk', allocatedDEF: 'def',
  allocatedMATK: 'matk', allocatedMDEF: 'mdef', allocatedSPD: 'spd',
};
const DERIV_KEYS: Array<{ k: string; label: string }> = [
  { k: 'maxHp', label: '生命' }, { k: 'maxMp', label: '法力' },
  { k: 'atk', label: '物攻' }, { k: 'def', label: '物防' },
  { k: 'matk', label: '魔攻' }, { k: 'mdef', label: '魔防' },
  { k: 'spd', label: '速度' }, { k: 'critRate', label: '暴击' },
  { k: 'statusAcc', label: '异常命中' },
];
const POWERS = ['始解', '卍解', '虚化', '完现', '圣文', '狱解'];
const SLOT_NAME: Record<string, string> = {
  head: '头部', body: '身体', bracer: '手甲', boots: '战靴', belt: '腰带',
  ring: '戒指', necklace: '项链', charm: '护符', pendant: '挂饰',
};
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

  // 需要刷新的文本引用
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
  private derivVal: Record<string, Label> = {};
  private eqSlotName: Record<string, Label> = {};
  private eqSlotStats: Record<string, Label> = {};
  private eqSlotRefine: Record<string, Label> = {};
  private zkName: Label | null = null;
  private zkSub: Label | null = null;

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

  refreshIfOpen(): void {
    if (this.open_ && this.root) this.refresh();
  }

  private build(): void {
    const { root, contentW, ox, oy } = makeFullScreenPanel(
      UIManager.instance.uiRoot, W, H, '◆  属 性 面 板  ◆',
      () => this.close(),
      'C键 开关  |  ESC 关闭  |  属性点已分配后如需洗点，请到商城购买「洗点符」使用  |  卸下装备请开背包(B)',
    );
    this.root = root;

    const colW = (contentW - 40) / 2;
    const lx = ox;          // 左列左边界
    const rx = ox + colW + 40; // 右列左边界

    // ═══ 左列：信息 banner ═══
    makeCard(root, lx + colW / 2, oy - 25, colW, 50,
      new Color(26, 26, 54, 180), new Color(51, 68, 102, 100));
    this.vNameLv = makeText(root, lx + 16, oy - 10,
      '勇者   Lv.1', 16, new Color(232, 213, 163, 255), 300);
    this.vNameLv.isBold = true;
    this.vSubInfo = makeText(root, lx + 16, oy - 34,
      '金币: 0    元素: 无    斩魄刀: 无', 12, new Color(136, 153, 187, 255), colW - 32);

    // ═══ 左列：力量体系 ═══
    const unlockY = oy - 70;
    makeCard(root, lx + colW / 2, unlockY - 20, colW, 40,
      new Color(13, 13, 29, 180), new Color(51, 68, 102, 80));
    makeText(root, lx + 16, unlockY - 6, '力量体系', 11, new Color(85, 102, 136, 255), 100);
    const pwSpacing = (colW - 32) / 6;
    for (let i = 0; i < 6; i++) {
      const px = lx + 16 + i * pwSpacing + pwSpacing / 2;
      const lbl = makeText(root, px, unlockY - 26,
        `${POWERS[i]}✗`, 12,
        new Color(68, 85, 102, 255), pwSpacing, Label.HorizontalAlign.CENTER, 0.5, 0.5);
      lbl.isBold = true;
      this.powerLabels.push(lbl);
    }

    // ═══ 左列：剩余属性点 banner ═══
    const spY = unlockY - 54;
    makeCard(root, lx + colW / 2, spY - 18, colW, 36,
      new Color(42, 26, 10, 180), new Color(102, 85, 51, 130));
    this.vSP = makeText(root, lx + 20, spY - 7,
      '剩余属性点: 0', 19, new Color(102, 119, 136, 255), 220);
    this.vSP.isBold = true;
    makeText(root, lx + colW - 16, spY - 10,
      'HP+15 / MP+5 / 其他+1', 11, new Color(85, 102, 136, 255), 200, Label.HorizontalAlign.RIGHT, 1, 0.5);

    // 已分配点数
    const allocTotalY = spY - 46;
    this.vAllocTotal = makeText(root, lx + 20, allocTotalY,
      '已分配点数: 0', 13, new Color(136, 204, 255, 255), 200);

    // ═══ 左列：经验 banner ═══
    const expY = allocTotalY - 20;
    makeCard(root, lx + colW / 2, expY - 22, colW, 44,
      new Color(13, 29, 42, 180), new Color(51, 85, 102, 130));
    this.vExpCur = makeText(root, lx + 20, expY - 8,
      '当前经验: 0 / 升级所需: 0', 13, new Color(136, 204, 255, 255), 350);
    this.vExpPct = makeText(root, lx + 20, expY - 28,
      '当前经验百分比: 0%', 13, new Color(136, 204, 255, 255), 350);

    // ═══ 左列：属性行 ═══
    const attrTop = expY - 54;
    const rowH = 38;
    for (let i = 0; i < ALLOC_KEYS.length; i++) {
      const a = ALLOC_KEYS[i];
      const ay = attrTop - i * rowH - 17; // 卡片中心
      makeCard(root, lx + colW / 2, ay, colW, 34,
        new Color(13, 13, 29, 180), new Color(51, 68, 102, 80));
      makeText(root, lx + 18, ay + 9, a.label, 16,
        new Color(255, 232, 176, 255), 60, Label.HorizontalAlign.LEFT, 0, 1);
      this.allocVal[a.k] = makeText(root, lx + 90, ay + 11, '0', 20,
        new Color(136, 204, 255, 255), 80, Label.HorizontalAlign.LEFT, 0, 1);
      this.allocVal[a.k].isBold = true;
      this.allocDetail[a.k] = makeText(root, lx + 160, ay + 7,
        `(加点0 × ${a.per} = +0)`, 12, new Color(102, 119, 170, 255), 160);
      const btn = makeColorButton(root, lx + colW - 36, ay, 44, 26, '+',
        new Color(60, 140, 60, 220), new Color(100, 200, 100, 255),
        () => this.allocate(a.k), 20, 4);
      this.addBtns.push(btn);
    }

    // ═══ 右列：装备栏标题 ═══
    makeText(root, rx, oy - 4, '装备栏', 18,
      new Color(170, 204, 221, 255), 100, Label.HorizontalAlign.LEFT, 0, 1);
    makeText(root, rx + 80, oy - 8, '（查看用·卸下请开背包 B）', 11,
      new Color(85, 102, 136, 255), 250, Label.HorizontalAlign.LEFT, 0, 1);

    // ═══ 右列：斩魄刀卡片 ═══
    const zkY = oy - 40;
    makeCard(root, rx + colW / 2, zkY - 25, colW, 50,
      new Color(13, 13, 29, 160), new Color(51, 68, 102, 100));
    makeText(root, rx + 10, zkY - 6, '斩魄刀', 11,
      new Color(102, 119, 153, 255), 60, Label.HorizontalAlign.LEFT, 0, 1);
    this.zkName = makeText(root, rx + 10, zkY - 24,
      '— 未觉醒 —', 13, new Color(51, 68, 85, 255), colW - 20);
    this.zkSub = makeText(root, rx + 10, zkY - 42,
      '元素: 无  (始解✗)', 10, new Color(136, 153, 187, 255), colW - 20);

    // ═══ 右列：装备槽 2×5 ═══
    const eqTop = zkY - 64;
    const eqGap = 8;
    const eqH = 60;
    const eqRowH = eqH + eqGap;
    const eqColW = (colW - eqGap) / 2;
    const eqs = ['head', 'body', 'bracer', 'boots', 'belt', 'ring', 'necklace', 'charm', 'pendant'];
    for (let i = 0; i < eqs.length; i++) {
      const s = eqs[i];
      const c = i % 2;
      const r = Math.floor(i / 2);
      const sx = rx + eqColW / 2 + c * (eqColW + eqGap);
      const sy = eqTop - r * eqRowH - eqH / 2;
      makeCard(root, sx, sy, eqColW, eqH,
        new Color(13, 13, 29, 160), new Color(51, 68, 102, 100));
      makeText(root, sx - eqColW / 2 + 10, sy + eqH / 2 - 4,
        SLOT_NAME[s], 11, new Color(85, 102, 136, 255), 80, Label.HorizontalAlign.LEFT, 0, 1);
      this.eqSlotName[s] = makeText(root, sx - eqColW / 2 + 10, sy + 8,
        '— 空 —', 13, new Color(51, 68, 85, 255), eqColW - 20);
      this.eqSlotStats[s] = makeText(root, sx - eqColW / 2 + 10, sy - 10,
        '', 10, new Color(136, 153, 187, 255), eqColW - 20);
      this.eqSlotRefine[s] = makeText(root, sx - eqColW / 2 + 10, sy - 24,
        '', 9, new Color(245, 166, 35, 255), eqColW - 20);
    }

    // ═══ 右列：战斗属性 ═══
    const sumTop = eqTop - 5 * eqRowH - 14;
    const sumH = 120;
    makeCard(root, rx + colW / 2, sumTop - sumH / 2, colW, sumH,
      new Color(26, 26, 54, 130), new Color(51, 68, 102, 80));
    makeText(root, rx + 16, sumTop - 8, '战斗属性', 13,
      new Color(170, 204, 221, 255), 120, Label.HorizontalAlign.LEFT, 0, 1);
    for (let i = 0; i < DERIV_KEYS.length; i++) {
      const d = DERIV_KEYS[i];
      const c2 = i % 2;
      const r2 = Math.floor(i / 2);
      const dx = rx + 16 + c2 * (colW / 2 - 10);
      const dy = sumTop - 32 - r2 * 22;
      makeText(root, dx, dy, `${d.label}:`, 12, new Color(136, 153, 187, 255), 60, Label.HorizontalAlign.LEFT, 0, 1);
      this.derivVal[d.k] = makeText(root, dx + 60, dy, '0', 12,
        new Color(255, 255, 255, 255), 80, Label.HorizontalAlign.LEFT, 0, 1);
    }
  }

  private allocate(allocKey: string): void {
    const attr = ALLOC_INTENT[allocKey];
    if (!attr || !this.bridge) return;
    this.bridge.room?.send('intent', { op: 'allocateStat', attr });
  }

  private refresh(): void {
    const pw = LocalPlayerWorld.instance.get();
    if (!pw) return;
    const d = LocalPlayerWorld.instance.getDerived();

    const allocatedTotal =
      (pw.allocatedHP || 0) + (pw.allocatedMP || 0) + (pw.allocatedATK || 0) +
      (pw.allocatedDEF || 0) + (pw.allocatedMATK || 0) + (pw.allocatedMDEF || 0) + (pw.allocatedSPD || 0);
    const need = expForLevel(pw.level + 1);
    const expPct = need > 0 ? Math.floor((pw.exp / need) * 100) : 0;

    this.vNameLv!.string = `${pw.zanpakuto || '勇者'}   Lv.${pw.level}`;
    const element = (pw as any).element || '无';
    this.vSubInfo!.string = `金币: ${pw.gold}    元素: ${element}    斩魄刀: ${pw.zanpakuto || '无'}`;

    // 力量体系
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

    // 属性行
    for (const a of ALLOC_KEYS) {
      const al = (pw as any)[a.k] || 0;
      const av = d ? ((d as any)[ALLOC_TO_DERIVED[a.k]] || 0) : 0;
      this.allocVal[a.k].string = `${av}`;
      this.allocDetail[a.k].string = `(加点${al} × ${a.per} = +${al * a.per})`;
    }

    // 斩魄刀 + 鬼道 + 称号 整合进斩魄刀卡片副行（避免额外布局层）
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

    // 装备槽
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

    // 派生战斗属性
    if (d) {
      for (const k of DERIV_KEYS) {
        if (k.k === 'critRate') {
          this.derivVal[k.k].string = `${(d as any).critRate || 0}%`;
        } else if (k.k === 'statusAcc') {
          const acc = Math.round(((d as any).statusAcc || 0) * 100);
          this.derivVal[k.k].string = `${acc}%`;
        } else {
          this.derivVal[k.k].string = String((d as any)[k.k] ?? 0);
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
