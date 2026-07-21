/**
 * 角色属性面板（L0 地基）。
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
import { makeText, makeButton, makePanel, drawHLine } from './widgets';
import { LocalPlayerWorld } from '../model/LocalPlayerWorld';
import { UNLOCK_LABELS, expForLevel } from '../model/PlayerWorld';

const W = 620, H = 560;
const ALLOC_KEYS: Array<{ k: string; label: string }> = [
  { k: 'allocatedHP', label: 'HP' }, { k: 'allocatedMP', label: 'MP' },
  { k: 'allocatedATK', label: 'ATK' }, { k: 'allocatedDEF', label: 'DEF' },
  { k: 'allocatedMATK', label: 'MATK' }, { k: 'allocatedMDEF', label: 'MDEF' },
  { k: 'allocatedSPD', label: 'SPD' },
];
const ALLOC_INTENT: Record<string, string> = {
  allocatedHP: 'HP', allocatedMP: 'MP', allocatedATK: 'ATK', allocatedDEF: 'DEF',
  allocatedMATK: 'MATK', allocatedMDEF: 'MDEF', allocatedSPD: 'SPD',
};
const DERIV_KEYS: Array<{ k: string; label: string }> = [
  { k: 'maxHp', label: '最大HP' }, { k: 'maxMp', label: '最大MP' },
  { k: 'atk', label: '攻击' }, { k: 'def', label: '防御' },
  { k: 'matk', label: '魔攻' }, { k: 'mdef', label: '魔防' },
  { k: 'spd', label: '速度' },
];

export class StatPanel {
  private static _inst: StatPanel | null = null;
  static get instance(): StatPanel {
    if (!this._inst) this._inst = new StatPanel();
    return this._inst;
  }

  private root: Node | null = null;
  private bridge: any = null;
  private open_ = false;

  private vLv: Label | null = null;
  private vExp: Label | null = null;
  private vGold: Label | null = null;
  private vSP: Label | null = null;
  private allocVal: Record<string, Label> = {};
  private vUnlock: Label | null = null;
  private vKido: Label | null = null;
  private vTitle: Label | null = null;
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

  refreshIfOpen(): void {
    if (this.open_ && this.root) this.refresh();
  }

  private build(): void {
    const root = makePanel(UIManager.instance.uiRoot, W, H);
    this.root = root;

    makeText(root, 0, H / 2 - 28, '角色属性', 24, new Color(255, 230, 150, 255), 400);

    // 等级 / 经验 / 金币 / 可分配点
    this.vLv = makeText(root, -W / 2 + 20, H / 2 - 64, 'Lv.1', 16, new Color(255, 255, 255, 255), 140);
    this.vExp = makeText(root, -W / 2 + 170, H / 2 - 64, 'Exp 0/0', 16, new Color(180, 220, 255, 255), 200);
    this.vGold = makeText(root, W / 2 - 220, H / 2 - 64, '金币 0', 16, new Color(255, 220, 120, 255), 140);
    this.vSP = makeText(root, W / 2 - 70, H / 2 - 64, '可分配 0', 16, new Color(150, 255, 180, 255), 140);

    drawHLine(root, W - 40, H / 2 - 84);

    // 已分配属性 + 加点
    makeText(root, -W / 2 + 20, H / 2 - 104, '— 已分配属性（点 + 加点）—', 15, new Color(200, 200, 220, 255), 400);
    let y = H / 2 - 130;
    for (const a of ALLOC_KEYS) {
      makeText(root, -W / 2 + 20, y, a.label, 16, new Color(255, 255, 255, 255), 80);
      this.allocVal[a.k] = makeText(root, -W / 2 + 110, y, '0', 16, new Color(150, 255, 180, 255), 80);
      makeButton(root, W / 2 - 70, y, 90, 28, '+1', new Color(70, 130, 200, 255), () => this.allocate(a.k));
      y -= 24;
    }

    drawHLine(root, W - 40, y - 8);

    // 力量体系 / 鬼道 / 称号
    this.vUnlock = makeText(root, -W / 2 + 20, y - 28, '力量体系：无', 15, new Color(255, 200, 230, 255), W - 60);
    this.vKido = makeText(root, -W / 2 + 20, y - 50, '鬼道：未修习', 15, new Color(200, 180, 255, 255), W - 60);
    this.vTitle = makeText(root, -W / 2 + 20, y - 72, '称号：无', 15, new Color(255, 230, 150, 255), W - 60);

    drawHLine(root, W - 40, y - 90);

    // 派生战斗属性
    makeText(root, -W / 2 + 20, y - 110, '— 战斗属性（派生）—', 15, new Color(200, 200, 220, 255), 400);
    let dy = y - 134;
    for (const d of DERIV_KEYS) {
      makeText(root, -W / 2 + 20, dy, d.label, 15, new Color(220, 230, 240, 255), 120);
      this.derivVal[d.k] = makeText(root, -W / 2 + 150, dy, '0', 15, new Color(255, 255, 255, 255), 120);
      dy -= 20;
    }

    makeButton(root, 0, -H / 2 + 28, 160, 40, '关闭 (C)', new Color(120, 120, 140, 255), () => this.close());
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

    this.vLv!.string = `Lv.${pw.level}`;
    const need = expForLevel(pw.level + 1);
    this.vExp!.string = `Exp ${pw.exp}/${need}`;
    this.vGold!.string = `金币 ${pw.gold}`;
    this.vSP!.string = `可分配 ${pw.statPoints}`;

    for (const a of ALLOC_KEYS) {
      const v = (pw as any)[a.k] || 0;
      this.allocVal[a.k].string = String(v);
    }

    const unlocks = (pw.unlocks || []).map((u) => UNLOCK_LABELS[u] || u);
    this.vUnlock!.string = '力量体系：' + (unlocks.length ? unlocks.join(' / ') : '无');

    const kn = pw.kidoNodes || {};
    const kidoPts = Object.values(kn).reduce((s: number, v: number) => s + (v || 0), 0);
    const school = pw.kidoSchool || '未修习';
    const equipped = (pw.kidoEquipped || []).length;
    this.vKido!.string = `鬼道：${school}（已投 ${kidoPts} 点，装备 ${equipped} 技）`;

    this.vTitle!.string = '称号：' + (pw.activeTitle || '无');

    if (d) {
      for (const k of DERIV_KEYS) this.derivVal[k.k].string = String((d as any)[k.k]);
    }
  }
}
