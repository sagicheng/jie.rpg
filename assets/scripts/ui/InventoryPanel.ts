/**
 * 背包面板（L0）——按 Phaser3 版式在 Cocos 1920×1080 下 1:1 复刻。
 *
 * 坐标转换同 StatPanel：Phaser 左上原点 y 向下 → Cocos 中心原点 y 向上，
 * 用 cx/cy 把 Phaser 任意点映射到 Cocos，数值直接照搬 Phaser InventoryPanel.ts。
 *
 * 关键：消耗品/材料/灵宠蛋/套装等动态分区，其标题与列表容器的纵向位置在 refresh 时
 * 按 Phaser 的「顺序累进」公式重算（装备多行时后续分区自动下移），避免重叠。
 *
 * 装备/卸下/使用 发 intent {op:'equip'|'unequip'|'useConsumable'}。数据随 worldSync 自动刷新。
 */
import { Node, Label, Color, UITransform } from 'cc';
import { UIManager } from './UIManager';
import { makeText, makeColorButton, makeModalShell, makeCard } from './widgets';
import { LocalPlayerWorld } from '../model/LocalPlayerWorld';
import { WorldItem, EquipSlot, getEffectiveStats } from '../model/PlayerWorld';

const SLOT_NAME: Record<string, string> = {
  head: '头部', body: '身体', bracer: '手甲', boots: '战靴', belt: '腰带',
  ring: '戒指', necklace: '项链', charm: '护符', pendant: '挂饰',
};
const SLOTS: EquipSlot[] = ['head', 'body', 'bracer', 'boots', 'belt', 'ring', 'necklace', 'charm', 'pendant'];
const QUALITY_COLOR: Record<string, Color> = {
  white: new Color(170, 170, 170, 255), green: new Color(68, 204, 68, 255),
  blue: new Color(68, 136, 255, 255), purple: new Color(204, 68, 204, 255),
  gold: new Color(255, 170, 0, 255),
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
  // 动态分区标题 + 列表容器（refresh 时按累进公式重定位）
  private equipTitle: Label | null = null;
  private consTitle: Label | null = null;
  private matTitle: Label | null = null;
  private eggTitle: Label | null = null;
  private setTitle: Label | null = null;
  private equipList: Node | null = null;
  private consList: Node | null = null;
  private matList: Node | null = null;
  private eggList: Node | null = null;
  private setList: Node | null = null;

  private cx = (px: number) => px - 960;
  private cy = (py: number) => 540 - py;

  bindBridge(b: any): void { this.bridge = b; }
  toggle(b?: any): void { if (b) this.bridge = b; if (this.open_) this.close(); else this.open(); }
  open(): void { if (!this.root) this.build(); this.open_ = true; this.root!.active = true; this.refresh(); }
  close(): void { this.open_ = false; if (this.root) this.root.active = false; }
  isOpen(): boolean { return this.open_; }
  refreshIfOpen(): void { if (this.open_ && this.root) this.refresh(); }

  private build(): void {
    const { root } = makeModalShell(
      UIManager.instance.uiRoot, '◆  背 包  ◆', () => this.close(),
      'B键 开关  |  ESC 关闭');
    this.root = root;

    const ox = 30, oy = 20, ow = 1920 - 60, th = 54;
    const T = (px: number, py: number, str: string, size: number, color: Color,
               width = 400, ax = 0, ay = 1): Label =>
      makeText(root, this.cx(px), this.cy(py), str, size, color, width, Label.HorizontalAlign.LEFT, ax, ay);
    const CR = (X: number, Y: number, W: number, H: number): void => {
      makeCard(root, this.cx(X) + W / 2, this.cy(Y) - H / 2, W, H);
    };

    this.vGold = T(ox + 20, oy + th + 16, '金币: 0', 16, new Color(255, 204, 68, 255), 300);
    this.vGold.isBold = true;

    // ═══ 装备栏 2 行 × 5 列（固定 9 槽）═══
    const eqY = oy + th + 48, eW = 180, eH = 64, eGap = 10;
    for (let i = 0; i < SLOTS.length; i++) {
      const s = SLOTS[i];
      const c2 = i % 5, r2 = Math.floor(i / 5);
      const sx = ox + 20 + c2 * (eW + eGap);
      const sy = eqY + r2 * (eH + eGap);
      CR(sx, sy, eW, eH);
      T(sx + 8, sy + 4, SLOT_NAME[s], 10, new Color(85, 102, 136, 255), 160);
      this.eqSlotName[s] = T(sx + 8, sy + 20, '空', 13, new Color(51, 68, 85, 255), eW - 16);
      this.eqSlotStats[s] = T(sx + 8, sy + 40, '', 9, new Color(119, 136, 170, 255), eW - 16);
      this.eqSlotRefine[s] = T(sx + 8, sy + 51, '', 8, new Color(245, 166, 35, 255), eW - 16);
      const hit = new Node('Hit_' + s);
      hit.layer = root.layer;
      hit.setParent(root);
      hit.setPosition(this.cx(sx) + eW / 2, this.cy(sy) - eH / 2, 0);
      hit.addComponent(UITransform).setContentSize(eW, eH);
      hit.on(Node.EventType.TOUCH_END, () => this.unequip(s), hit);
    }

    // ═══ 动态分区标题（位置在 refresh 中按累进公式重算）═══
    this.equipTitle = T(ox + 20, 286, '装备（点击穿戴）', 14, new Color(136, 170, 204, 255), 400);
    this.consTitle = T(ox + 20, 370, '消耗品', 15, new Color(136, 170, 204, 255), 200);
    this.matTitle = T(ox + 20, 470, '材料', 15, new Color(136, 170, 204, 255), 200);
    this.eggTitle = T(ox + 20, 570, '灵宠蛋（双击开启）', 15, new Color(255, 170, 102, 255), 400);
    this.setTitle = T(ox + 20, 670, '套装进度', 15, new Color(201, 169, 110, 255), 200);

    // 列表容器
    const mkList = (name: string): Node => {
      const n = new Node(name);
      n.layer = root.layer;
      n.setParent(root);
      n.setPosition(0, 0, 0);
      return n;
    };
    this.equipList = mkList('EquipList');
    this.consList = mkList('ConsList');
    this.matList = mkList('MatList');
    this.eggList = mkList('EggList');
    this.setList = mkList('SetList');
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
    const order = ['atk', 'def', 'matk', 'mdef', 'hp', 'mp', 'spd'];
    const parts: string[] = [];
    for (const k of order) if (eff[k]) parts.push(`${k}+${eff[k]}`);
    return parts.join(' ');
  }
  private refineDisplay(it: WorldItem): string {
    if (!it.refineStats || !it.refineStats.length) return '';
    return it.refineStats.map((r) => `${r.key}+${r.value}`).join(' ');
  }

  private makeRowItem(list: Node, x: number, y: number, w: number, h: number,
                       fill: Color, stroke: Color, name: string, nameColor: Color,
                       sub: string, subColor: Color, onClick?: () => void): void {
    makeCard(list, x, y, w, h, fill, stroke, 5);
    makeText(list, x - w / 2 + 6, y + h / 2 - 3, name, 11, nameColor, w - 12);
    if (sub) makeText(list, x - w / 2 + 6, y - 3, sub, 9, subColor, w - 12);
    if (onClick) {
      const hit = new Node('Hit');
      hit.layer = list.layer;
      hit.setParent(list);
      hit.setPosition(x, y, 0);
      hit.addComponent(UITransform).setContentSize(w, h);
      hit.on(Node.EventType.TOUCH_END, onClick, hit);
    }
  }

  private refresh(): void {
    const pw = LocalPlayerWorld.instance.get();
    if (!pw) return;
    const ox = 30, ow = 1920 - 60, th = 54;
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
        const col = QUALITY_COLOR[it.quality || 'white'] || new Color(204, 204, 204, 255);
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

    // ═══ 动态分区纵向位置（Phaser 顺序累进公式）═══
    const eH = 64, eGap = 10;
    const eqY = oy + th + 48;
    const eiY = eqY + 2 * (eH + eGap) + 16;
    const ec = 6, ecardH = 48, eGap2 = 8;
    const equipItems = (pw.inventory || []).filter((it) => it.type === 'equipment');
    const cons = (pw.inventory || []).filter((it) => it.type === 'consumable' && it.quantity > 0);
    const mats = (pw.inventory || []).filter((it) => it.type === 'material' && it.quantity > 0);
    const eggs = (pw.inventory || []).filter((it) => it.type === 'pet_egg' && it.quantity > 0);

    const ecardW = (ow - 50) / ec - 8;
    const consY = eiY + 28 + (equipItems.length > 0 ? (Math.ceil(equipItems.length / ec) * (ecardH + eGap2) + 28) : 0);
    const cc = 8, cW = (ow - 50) / cc - 8, cH = 58, cGap = 8;
    const matY = consY + 30 + Math.ceil(cons.length / cc) * (cH + cGap) + 14;
    const mc = 6, mGap = 280, mRowH = 24;
    const matEndY = matY + 30 + Math.ceil(mats.length / mc) * mRowH;
    const eggY = matEndY + 14;
    const eggC = 8, eggW = (ow - 50) / eggC - 8, eggH = 58, eggGap = 8;
    const eggEndY = eggY + 30 + Math.ceil(eggs.length / eggC) * (eggH + eggGap);
    const setBlockY = eggEndY + 14;

    // 重定位标题 + 列表容器
    this.equipTitle!.node.setPosition(this.cx(ox + 20), this.cy(eiY));
    this.equipList!.setPosition(this.cx(ox + 20), this.cy(eiY + 28));
    this.consTitle!.node.setPosition(this.cx(ox + 20), this.cy(consY));
    this.consList!.setPosition(this.cx(ox + 20), this.cy(consY + 30));
    this.matTitle!.node.setPosition(this.cx(ox + 20), this.cy(matY));
    this.matList!.setPosition(this.cx(ox + 20), this.cy(matY + 30));
    this.eggTitle!.node.setPosition(this.cx(ox + 20), this.cy(eggY));
    this.eggList!.setPosition(this.cx(ox + 20), this.cy(eggY + 30));
    this.setTitle!.node.setPosition(this.cx(ox + 20), this.cy(setBlockY));
    this.setList!.setPosition(this.cx(ox + 20), this.cy(setBlockY + 26));

    // 背包装备
    this.equipList!.removeAllChildren(true);
    equipItems.forEach((it, i) => {
      const col = i % ec, row = Math.floor(i / ec);
      const x = col * (ecardW + eGap2) + ecardW / 2;
      const y = -row * (ecardH + eGap2) - ecardH / 2;
      const q = QUALITY_COLOR[it.quality || 'white'] || new Color(204, 204, 204, 255);
      const elv = it.enhanceLevel || 0;
      this.makeRowItem(this.equipList!, x, y, ecardW, ecardH,
        new Color(10, 10, 26, 180), q, `${it.name}${elv > 0 ? ` +${elv}` : ''}`,
        q, this.itemSummary(it), new Color(119, 136, 170, 255), () => this.equip(it.id));
    });
    if (equipItems.length === 0) makeText(this.equipList!, 0, -10, '（没有可装备物品）', 12, new Color(85, 102, 136, 255), 300);

    // 消耗品
    this.consList!.removeAllChildren(true);
    cons.forEach((it, i) => {
      const col = i % cc, row = Math.floor(i / cc);
      const x = col * (cW + cGap) + cW / 2;
      const y = -row * (cH + cGap) - cH / 2;
      this.makeRowItem(this.consList!, x, y, cW, cH,
        new Color(10, 26, 10, 180), new Color(34, 85, 34, 130),
        it.name, new Color(136, 204, 136, 255), it.desc || '', new Color(85, 136, 85, 255));
    });
    if (cons.length === 0) makeText(this.consList!, 0, -10, '（没有消耗品）', 12, new Color(85, 102, 136, 255), 300);

    // 材料
    this.matList!.removeAllChildren(true);
    mats.forEach((it, i) => {
      const col = i % mc, row = Math.floor(i / mc);
      const x = col * mGap + 140;
      const y = -row * mRowH - 12;
      makeText(this.matList!, x, y, `${it.name} ×${it.quantity}`, 11, new Color(170, 170, 204, 255), 260, Label.HorizontalAlign.LEFT, 0.5, 0.5);
    });
    if (mats.length === 0) makeText(this.matList!, 0, -10, '（没有材料）', 12, new Color(85, 102, 136, 255), 300);

    // 灵宠蛋
    this.eggList!.removeAllChildren(true);
    eggs.forEach((it, i) => {
      const col = i % eggC, row = Math.floor(i / eggC);
      const x = col * (eggW + eggGap) + eggW / 2;
      const y = -row * (eggH + eggGap) - eggH / 2;
      this.makeRowItem(this.eggList!, x, y, eggW, eggH,
        new Color(26, 18, 8, 200), new Color(170, 102, 34, 150),
        it.name, new Color(255, 204, 136, 255), it.desc || '双击开启', new Color(204, 153, 102, 255));
    });
    if (eggs.length === 0) makeText(this.eggList!, 0, -10, '（没有灵宠蛋）', 12, new Color(85, 102, 136, 255), 300);

    // 套装进度（L0 占位；完整加成 L2 接入）
    this.setList!.removeAllChildren(true);
    makeText(this.setList!, 0, -10, '（套装系统将在 L2 装备深化阶段接入）', 12, new Color(85, 102, 136, 255), 500, Label.HorizontalAlign.CENTER, 0.5, 0.5);
  }
}
