/**
 * 背包面板（L0 地基）——按 Phaser3 版式在 Cocos 960×640 下全屏复刻。
 *
 * 单例 toggle。从 LocalPlayerWorld 读真实数据：
 *   - 装备槽位(9)：头部/身体/护腕/靴子/腰带/戒指/项链/护符/挂饰，显示装备名+强化+主属性
 *   - 背包物品：名称×数量 + 描述，装备类可一键装备，消耗品可一键使用
 *
 * 装备/卸下/使用 发 intent {op:'equip'|'unequip'|'useConsumable'}。
 * 数据随 worldSync 自动刷新。
 */
import { Node, Label, Color, UITransform } from 'cc';
import { UIManager } from './UIManager';
import { makeText, makeColorButton, makeFullScreenPanel, makeCard } from './widgets';
import { LocalPlayerWorld } from '../model/LocalPlayerWorld';
import { WorldItem, EquipSlot, getEffectiveStats } from '../model/PlayerWorld';

const W = 920, H = 600;
const SLOT_NAME: Record<string, string> = {
  head: '头部', body: '身体', bracer: '护腕', boots: '靴子', belt: '腰带',
  ring: '戒指', necklace: '项链', charm: '护符', pendant: '挂饰',
};
const SLOTS: EquipSlot[] = ['head', 'body', 'bracer', 'boots', 'belt', 'ring', 'necklace', 'charm', 'pendant'];
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

  private vGold: Label | null = null;
  private eqSlotName: Record<string, Label> = {};
  private eqSlotStats: Record<string, Label> = {};
  private eqSlotRefine: Record<string, Label> = {};
  private equipList: Node | null = null;
  private consList: Node | null = null;
  private matList: Node | null = null;
  private setList: Node | null = null;

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
      UIManager.instance.uiRoot, W, H, '◆  背 包  ◆',
      () => this.close(),
      'B键 开关  |  ESC 关闭',
    );
    this.root = root;

    // 金币
    this.vGold = makeText(root, ox, oy - 6,
      '金币: 0', 16, new Color(255, 204, 68, 255), 200);
    this.vGold.isBold = true;

    // ═══ 装备栏 2 行 × 5 列 ═══
    const eqTitleY = oy - 32;
    makeText(root, ox, eqTitleY, '装备栏（点击卸下）', 15,
      new Color(136, 170, 204, 255), 200, Label.HorizontalAlign.LEFT, 0, 1);

    const eqTop = eqTitleY - 18;
    const eW = 164, eH = 52, eGap = 10;
    for (let i = 0; i < SLOTS.length; i++) {
      const s = SLOTS[i];
      const c = i % 5;
      const r = Math.floor(i / 5);
      const sx = ox + eW / 2 + c * (eW + eGap);
      const sy = eqTop - r * (eH + eGap) - eH / 2;
      makeCard(root, sx, sy, eW, eH,
        new Color(13, 13, 29, 180), new Color(51, 68, 102, 100));
      makeText(root, sx - eW / 2 + 8, sy + eH / 2 - 3,
        SLOT_NAME[s], 10, new Color(85, 102, 136, 255), 60, Label.HorizontalAlign.LEFT, 0, 1);
      this.eqSlotName[s] = makeText(root, sx - eW / 2 + 8, sy + 8,
        '空', 12, new Color(51, 68, 85, 255), eW - 16);
      this.eqSlotStats[s] = makeText(root, sx - eW / 2 + 8, sy - 8,
        '', 9, new Color(136, 153, 187, 255), eW - 16);
      this.eqSlotRefine[s] = makeText(root, sx - eW / 2 + 8, sy - 20,
        '', 8, new Color(245, 166, 35, 255), eW - 16);

      // 点击热区：卸下
      const hit = new Node('Hit_' + s);
      hit.layer = root.layer;
      hit.setParent(root);
      hit.setPosition(sx, sy, 0);
      const ut = hit.addComponent(UITransform);
      ut.setContentSize(eW, eH);
      hit.on(Node.EventType.TOUCH_END, () => this.unequip(s), hit);
    }

    // ═══ 可穿戴装备 ═══
    const equipTitleY = eqTop - 2 * (eH + eGap) - 16;
    makeText(root, ox, equipTitleY, '背包装备（点击穿戴）', 14,
      new Color(136, 170, 204, 255), 200, Label.HorizontalAlign.LEFT, 0, 1);
    const equipList = new Node('EquipList');
    equipList.layer = root.layer;
    equipList.setParent(root);
    equipList.setPosition(ox, equipTitleY - 18, 0);
    this.equipList = equipList;

    // ═══ 消耗品 ═══
    const consTitleY = equipTitleY - 86;
    makeText(root, ox, consTitleY, '消耗品', 15,
      new Color(136, 170, 204, 255), 100, Label.HorizontalAlign.LEFT, 0, 1);
    const consList = new Node('ConsList');
    consList.layer = root.layer;
    consList.setParent(root);
    consList.setPosition(ox, consTitleY - 18, 0);
    this.consList = consList;

    // ═══ 材料 ═══
    const matTitleY = consTitleY - 86;
    makeText(root, ox, matTitleY, '材料', 15,
      new Color(136, 170, 204, 255), 100, Label.HorizontalAlign.LEFT, 0, 1);
    const matList = new Node('MatList');
    matList.layer = root.layer;
    matList.setParent(root);
    matList.setPosition(ox, matTitleY - 18, 0);
    this.matList = matList;

    // ═══ 套装进度 ═══
    const setTitleY = matTitleY - 70;
    makeText(root, ox, setTitleY, '套装进度', 15,
      new Color(201, 169, 110, 255), 100, Label.HorizontalAlign.LEFT, 0, 1);
    const setList = new Node('SetList');
    setList.layer = root.layer;
    setList.setParent(root);
    setList.setPosition(ox, setTitleY - 18, 0);
    this.setList = setList;
  }

  private unequip(slot: EquipSlot): void {
    if (!this.bridge) return;
    this.bridge.room?.send('intent', { op: 'unequip', slot });
  }

  private equip(itemId: string): void {
    if (!this.bridge) return;
    this.bridge.room?.send('intent', { op: 'equip', itemId });
  }

  // 消耗品使用暂由 L1 战斗/状态系统接入；当前仅作展示。

  private itemSummary(it: WorldItem): string {
    const eff = getEffectiveStats(it);
    const parts: string[] = [];
    const order = ['atk', 'def', 'matk', 'mdef', 'hp', 'mp', 'spd'];
    for (const k of order) if (eff[k]) parts.push(`${k}+${eff[k]}`);
    return parts.join(' ');
  }

  private refineDisplay(it: WorldItem): string {
    if (!it.refineStats || !it.refineStats.length) return '';
    return it.refineStats.map((r) => `${r.key}+${r.value}`).join(' ');
  }

  private refresh(): void {
    const pw = LocalPlayerWorld.instance.get();
    if (!pw) return;
    const eq = pw.equipment || ({} as Record<EquipSlot, WorldItem | null>);

    this.vGold!.string = `金币: ${pw.gold}`;

    // 装备槽
    for (const s of SLOTS) {
      const it = eq[s];
      const nameLbl = this.eqSlotName[s];
      const statsLbl = this.eqSlotStats[s];
      const refineLbl = this.eqSlotRefine[s];
      if (it) {
        const elv = it.enhanceLevel || 0;
        const lvTxt = elv > 0 ? ` +${elv}` : '';
        const col = QUALITY_COLOR[it.quality || 'white'] || new Color(220, 220, 220, 255);
        nameLbl.string = `${it.name}${lvTxt}`;
        nameLbl.color = col;
        statsLbl.string = this.itemSummary(it);
        refineLbl.string = this.refineDisplay(it);
      } else {
        nameLbl.string = '空';
        nameLbl.color = new Color(51, 68, 85, 255);
        statsLbl.string = '';
        refineLbl.string = '';
      }
    }

    // 背包装备
    this.equipList!.removeAllChildren(true);
    const equipItems = (pw.inventory || []).filter((it) => it.type === 'equipment');
    const ecW = 210, ecH = 48, ecGap = 10, ecCols = 4;
    let y = 0;
    for (let i = 0; i < equipItems.length; i++) {
      const it = equipItems[i];
      const c = i % ecCols;
      const r = Math.floor(i / ecCols);
      const x = c * (ecW + ecGap) + ecW / 2;
      const cy = -r * (ecH + ecGap) - ecH / 2;
      makeCard(this.equipList!, x, cy, ecW, ecH,
        new Color(10, 10, 26, 180), QUALITY_COLOR[it.quality || 'white'] || new Color(102, 102, 102, 100), 5);
      const col = QUALITY_COLOR[it.quality || 'white'] || new Color(220, 220, 220, 255);
      const elv = it.enhanceLevel || 0;
      makeText(this.equipList!, x - ecW / 2 + 6, cy + ecH / 2 - 3,
        `${it.name}${elv > 0 ? ` +${elv}` : ''}`, 11, col, ecW - 12);
      makeText(this.equipList!, x - ecW / 2 + 6, cy - 3,
        this.itemSummary(it), 9, new Color(136, 153, 187, 255), ecW - 12);
      const hit = new Node('Hit');
      hit.layer = this.equipList!.layer;
      hit.setParent(this.equipList!);
      hit.setPosition(x, cy, 0);
      const ut = hit.addComponent(UITransform);
      ut.setContentSize(ecW, ecH);
      hit.on(Node.EventType.TOUCH_END, () => this.equip(it.id), hit);
    }
    if (equipItems.length === 0) {
      makeText(this.equipList!, 0, -10, '（没有可装备物品）', 12, new Color(85, 102, 136, 255), 200);
    }

    // 消耗品
    this.consList!.removeAllChildren(true);
    const cons = (pw.inventory || []).filter((it) => it.type === 'consumable' && it.quantity > 0);
    const ccW = 166, ccH = 52, ccGap = 10, ccCols = 5;
    for (let i = 0; i < cons.length; i++) {
      const it = cons[i];
      const c = i % ccCols;
      const r = Math.floor(i / ccCols);
      const x = c * (ccW + ccGap) + ccW / 2;
      const cy = -r * (ccH + ccGap) - ccH / 2;
      makeCard(this.consList!, x, cy, ccW, ccH,
        new Color(10, 26, 10, 180), new Color(34, 85, 34, 130), 5);
      makeText(this.consList!, x - ccW / 2 + 6, cy + ccH / 2 - 3,
        it.name, 11, new Color(136, 204, 136, 255), ccW - 12);
      makeText(this.consList!, x + ccW / 2 - 6, cy + ccH / 2 - 3,
        `×${it.quantity}`, 11, new Color(136, 204, 136, 255), 60, Label.HorizontalAlign.RIGHT, 1, 1);
      makeText(this.consList!, x - ccW / 2 + 6, cy - 5,
        it.desc || '', 9, new Color(85, 136, 85, 255), ccW - 12);
    }
    if (cons.length === 0) {
      makeText(this.consList!, 0, -10, '（没有消耗品）', 12, new Color(85, 102, 136, 255), 200);
    }

    // 材料
    this.matList!.removeAllChildren(true);
    const mats = (pw.inventory || []).filter((it) => it.type === 'material' && it.quantity > 0);
    const mc = 6, mGap = 280;
    for (let i = 0; i < mats.length; i++) {
      const c = i % mc;
      const r = Math.floor(i / mc);
      const x = c * mGap + 80;
      const cy = -r * 22 - 10;
      makeText(this.matList!, x, cy,
        `${mats[i].name} ×${mats[i].quantity}`, 11, new Color(170, 170, 204, 255), 260, Label.HorizontalAlign.LEFT, 0.5, 0.5);
    }
    if (mats.length === 0) {
      makeText(this.matList!, 0, -10, '（没有材料）', 12, new Color(85, 102, 136, 255), 200);
    }

    // 套装进度（L0 简单显示同区域同品质统计；完整套装加成在 L2 接入）
    this.setList!.removeAllChildren(true);
    makeText(this.setList!, 0, -10, '（套装系统将在 L2 装备深化阶段接入）', 12,
      new Color(85, 102, 136, 255), 400, Label.HorizontalAlign.CENTER, 0.5, 0.5);
  }
}
