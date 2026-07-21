/**
 * 背包面板（L0 地基）。
 *
 * 单例 toggle。从 LocalPlayerWorld 读真实数据：
 *   - 装备槽位(9)：头部/身体/护腕/靴子/腰带/戒指/项链/护符/挂饰，显示装备名+强化+主属性，可卸下
 *   - 背包物品：名称×数量 + 描述，装备类可一键装备
 *
 * 装备/卸下 发 intent {op:'equip'|'unequip'}。数据随 worldSync 自动刷新。
 */
import { Node, Label, Color } from 'cc';
import { UIManager } from './UIManager';
import { makeText, makeButton, makePanel, drawHLine } from './widgets';
import { LocalPlayerWorld } from '../model/LocalPlayerWorld';
import { WorldItem, EquipSlot, getEffectiveStats } from '../model/PlayerWorld';

const W = 660, H = 580;
const SLOTS: Array<{ slot: EquipSlot; name: string }> = [
  { slot: 'head', name: '头部' }, { slot: 'body', name: '身体' }, { slot: 'bracer', name: '护腕' },
  { slot: 'boots', name: '靴子' }, { slot: 'belt', name: '腰带' }, { slot: 'ring', name: '戒指' },
  { slot: 'necklace', name: '项链' }, { slot: 'charm', name: '护符' }, { slot: 'pendant', name: '挂饰' },
];
const QUALITY_COLOR: Record<string, Color> = {
  white: new Color(220, 220, 220, 255), green: new Color(120, 230, 140, 255),
  blue: new Color(120, 180, 255, 255), purple: new Color(200, 140, 255, 255),
  gold: new Color(255, 210, 100, 255),
};

export class InventoryPanel {
  private static _inst: InventoryPanel | null = null;
  static get instance(): InventoryPanel {
    if (!this._inst) this._inst = new InventoryPanel();
    return this._inst;
  }

  private root: Node | null = null;
  private bridge: any = null;
  private open_ = false;

  private slotName: Record<string, Label> = {};
  private slotUnequip: Record<string, Node> = {};
  private bagList: Node | null = null;

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
    makeText(root, 0, H / 2 - 28, '背包 / 装备', 24, new Color(255, 230, 150, 255), 400);

    // 装备槽 3×3 网格
    const cols = [-W / 2 + 110, 0, W / 2 - 110];
    const rows = [H / 2 - 70, H / 2 - 130, H / 2 - 190];
    let i = 0;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const s = SLOTS[i++];
        makeText(root, cols[c], rows[r] + 18, s.name, 13, new Color(180, 200, 220, 255), 160);
        this.slotName[s.slot] = makeText(root, cols[c], rows[r] - 2, '（空）', 13, new Color(150, 150, 150, 255), 200);
        this.slotUnequip[s.slot] = makeButton(root, cols[c], rows[r] - 26, 100, 24, '卸下', new Color(150, 90, 90, 255), () => this.unequip(s.slot));
      }
    }

    drawHLine(root, W - 40, rows[2] - 50);

    // 背包标题 + 列表容器
    makeText(root, -W / 2 + 20, rows[2] - 70, '— 背包物品 —', 15, new Color(200, 200, 220, 255), 400);
    const list = new Node('BagList');
    list.layer = root.layer;
    list.setParent(root);
    list.setPosition(-W / 2 + 20, rows[2] - 96, 0);
    this.bagList = list;

    makeButton(root, 0, -H / 2 + 28, 160, 40, '关闭 (B)', new Color(120, 120, 140, 255), () => this.close());
  }

  private unequip(slot: EquipSlot): void {
    if (!this.bridge) return;
    this.bridge.room?.send('intent', { op: 'unequip', slot });
  }

  private equip(itemId: string): void {
    if (!this.bridge) return;
    this.bridge.room?.send('intent', { op: 'equip', itemId });
  }

  private itemSummary(it: WorldItem): string {
    const eff = getEffectiveStats(it);
    const parts: string[] = [];
    const order = ['atk', 'def', 'matk', 'mdef', 'hp', 'mp', 'spd'];
    for (const k of order) if (eff[k]) parts.push(`${k}+${eff[k]}`);
    let s = parts.join(' ');
    if (it.enhanceLevel) s += ` [+${it.enhanceLevel}]`;
    if (it.refineStats && it.refineStats.length) s += ` 精炼${it.refineStats.length}`;
    return s;
  }

  private refresh(): void {
    const pw = LocalPlayerWorld.instance.get();
    if (!pw) return;
    const eq = pw.equipment || ({} as Record<EquipSlot, WorldItem | null>);

    for (const s of SLOTS) {
      const it = eq[s.slot];
      const lbl = this.slotName[s.slot];
      const btn = this.slotUnequip[s.slot];
      if (it) {
        const col = QUALITY_COLOR[it.quality || 'white'] || new Color(220, 220, 220, 255);
        lbl.string = `${it.name}  ${this.itemSummary(it)}`;
        lbl.color = col;
        btn.active = true;
      } else {
        lbl.string = '（空）';
        lbl.color = new Color(150, 150, 150, 255);
        btn.active = false;
      }
    }

    // 重建背包列表
    if (!this.bagList) return;
    this.bagList.removeAllChildren(true);
    const inv = pw.inventory || [];
    let y = 0;
    for (const it of inv) {
      const col = it.type === 'equipment' ? (QUALITY_COLOR[it.quality || 'white'] || new Color(220, 220, 220, 255)) : new Color(220, 220, 220, 255);
      makeText(this.bagList, 0, y, `${it.name} ×${it.quantity}`, 14, col, 200);
      makeText(this.bagList, 210, y, it.desc || '', 12, new Color(170, 170, 170, 255), 260);
      if (it.type === 'equipment') {
        makeButton(this.bagList, 430, y, 90, 24, '装备', new Color(70, 130, 200, 255), () => this.equip(it.id));
      }
      y -= 26;
    }
    if (inv.length === 0) makeText(this.bagList, 0, 0, '（背包为空）', 14, new Color(150, 150, 150, 255), 200);
  }
}
