/**
 * 通用 UI 控件工厂（L0 地基）。
 *
 * 从 BattleManager 的控件思路抽出，独立成共享模块，避免重复实现。
 * 关键教训（来自 P2 的 bug）：**文字(Label)与背景(Graphics)必须分处不同节点**，
 * Cocos 不允许同一节点挂两个同名组件。所以按钮 = 父节点(Graphics 背景 + UITransform + 点击)
 * + 子节点(Label 文字)。
 *
 * 本版新增：锚点控制、小卡片、进度条、标题栏面板，为复刻 Phaser3 全屏面板做准备。
 */
import {
  Node, Label, Graphics, UITransform, Color, Layers,
  SpriteFrame, Texture2D, Sprite,
} from 'cc';

/** 让节点能被 Canvas 的 UI 相机渲染。 */
export function setUILayer(n: Node): void {
  n.layer = Layers.Enum.UI_2D;
}

/** 创建文字节点（返回 Label 组件，父节点已设 UI_2D）。 */
export function makeText(
  parent: Node, x: number, y: number, str: string,
  size: number, color: Color, width = 300,
  hAlign: Label.HorizontalAlign = Label.HorizontalAlign.LEFT,
  anchorX = 0, anchorY = 1,
): Label {
  const n = new Node('Txt');
  setUILayer(n);
  n.setParent(parent);
  n.setPosition(x, y, 0);
  const ut = n.getComponent(UITransform) || n.addComponent(UITransform);
  ut.setAnchorPoint(anchorX, anchorY);
  const label = n.addComponent(Label);
  label.string = str;
  label.color = color;
  label.fontSize = size;
  label.lineHeight = Math.round(size * 1.2);
  label.overflow = Label.Overflow.NONE;
  label.horizontalAlign = hAlign;
  ut.setContentSize(width, label.lineHeight);
  return label;
}

/**
 * 创建按钮：父节点持 Graphics 背景 + UITransform + 点击事件，文字在独立子节点。
 * 返回按钮父节点（便于后续 setPosition / active 控制）。
 */
export function makeButton(
  parent: Node, x: number, y: number, w: number, h: number,
  text: string, bg: Color, onClick: () => void,
  textSize = 18, radius = 8,
): Node {
  const n = new Node('Btn_' + text);
  setUILayer(n);
  n.setParent(parent);
  n.setPosition(x, y, 0);

  const ut = n.getComponent(UITransform) || n.addComponent(UITransform);
  ut.setContentSize(w, h);

  const g = n.addComponent(Graphics);
  g.fillColor = bg;
  g.roundRect(-w / 2, -h / 2, w, h, radius);
  g.fill();
  g.lineWidth = 1;
  g.strokeColor = new Color(255, 255, 255, 120);
  g.roundRect(-w / 2, -h / 2, w, h, radius);
  g.stroke();

  const label = new Node('Label');
  setUILayer(label);
  label.setParent(n);
  label.setPosition(0, 0, 0);
  const labelComp = label.addComponent(Label);
  labelComp.string = text;
  labelComp.color = new Color(255, 255, 255, 255);
  labelComp.fontSize = textSize;
  labelComp.horizontalAlign = Label.HorizontalAlign.CENTER;
  const lut = label.getComponent(UITransform) || label.addComponent(UITransform);
  lut.setContentSize(w, h);
  lut.setAnchorPoint(0.5, 0.5);

  n.on(Node.EventType.TOUCH_END, () => onClick(), n);
  return n;
}

/** 创建可变色按钮（支持按下/悬停颜色变化）。 */
export function makeColorButton(
  parent: Node, x: number, y: number, w: number, h: number,
  text: string, normal: Color, hover: Color, onClick: () => void,
  textSize = 18, radius = 8,
): Node {
  const n = makeButton(parent, x, y, w, h, text, normal, onClick, textSize, radius);
  const g = n.getComponent(Graphics);
  const label = n.getChildByName('Label')?.getComponent(Label);
  n.on(Node.EventType.TOUCH_START, () => {
    if (!g) return;
    g.clear();
    g.fillColor = hover;
    g.roundRect(-w / 2, -h / 2, w, h, radius);
    g.fill();
    g.lineWidth = 1;
    g.strokeColor = new Color(255, 255, 255, 180);
    g.roundRect(-w / 2, -h / 2, w, h, radius);
    g.stroke();
  }, n);
  n.on(Node.EventType.TOUCH_END, () => {
    if (!g) return;
    g.clear();
    g.fillColor = normal;
    g.roundRect(-w / 2, -h / 2, w, h, radius);
    g.fill();
    g.lineWidth = 1;
    g.strokeColor = new Color(255, 255, 255, 120);
    g.roundRect(-w / 2, -h / 2, w, h, radius);
    g.stroke();
  }, n);
  return n;
}

/**
 * 创建居中半透明面板容器（深底 + 描边 + 圆角）。
 * 返回容器节点位于 (0,0)，子控件坐标范围 x∈[-w/2,w/2], y∈[-h/2,h/2]。
 */
export function makePanel(parent: Node, w: number, h: number): Node {
  const n = new Node('Panel');
  setUILayer(n);
  n.setParent(parent);
  n.setPosition(0, 0, 0);

  const g = n.addComponent(Graphics);
  g.fillColor = new Color(18, 22, 32, 245);
  g.roundRect(-w / 2, -h / 2, w, h, 16);
  g.fill();
  g.lineWidth = 2;
  g.strokeColor = new Color(120, 160, 220, 200);
  g.roundRect(-w / 2, -h / 2, w, h, 16);
  g.stroke();

  const ut = n.getComponent(UITransform) || n.addComponent(UITransform);
  ut.setContentSize(w, h);
  return n;
}

/**
 * 创建全屏面板（带标题栏、关闭按钮、底栏）。
 * 返回面板根节点，子控件坐标基于面板中心坐标系。
 *
 * @param title 标题文字
 * @param closeCb 关闭回调
 * @param footer 底栏文字，可选
 */
export function makeFullScreenPanel(
  parent: Node, w: number, h: number, title: string,
  closeCb: () => void, footer = '',
): { root: Node; contentW: number; contentH: number; ox: number; oy: number } {
  const root = makePanel(parent, w, h);

  const titleH = 50;
  const margin = 20;
  const contentW = w - margin * 2;
  const contentH = h - titleH - margin * 2 - (footer ? 28 : 0);
  const ox = -w / 2 + margin;
  const oy = h / 2 - titleH - margin; // 内容区顶部 y（中心坐标系，向上为正）

  // 标题栏背景
  const tb = new Node('TitleBar');
  setUILayer(tb);
  tb.setParent(root);
  tb.setPosition(0, h / 2 - titleH / 2, 0);
  const tbg = tb.addComponent(Graphics);
  tbg.fillColor = new Color(26, 26, 54, 250);
  tbg.roundRect(-w / 2 + 4, -titleH / 2, w - 8, titleH, 10);
  tbg.fill();

  // 标题
  makeText(root, 0, h / 2 - 18, title, 22, new Color(232, 213, 163, 255), 400, Label.HorizontalAlign.CENTER, 0.5, 0.5);

  // 关闭按钮（右上角）
  const closeBtn = makeColorButton(root, w / 2 - 32, h / 2 - 24, 40, 32, '✕',
    new Color(120, 80, 80, 220), new Color(180, 90, 90, 255), closeCb, 20, 6);
  closeBtn.setPosition(w / 2 - 32, h / 2 - 24, 0);

  // 底栏
  if (footer) {
    const fy = -h / 2 + 16;
    const ft = new Node('Footer');
    setUILayer(ft);
    ft.setParent(root);
    ft.setPosition(0, fy, 0);
    const ftg = ft.addComponent(Graphics);
    ftg.fillColor = new Color(26, 26, 54, 200);
    ftg.roundRect(-w / 2 + 4, -12, w - 8, 24, 10);
    ftg.fill();
    makeText(root, 0, fy, footer, 12, new Color(120, 130, 160, 255), contentW, Label.HorizontalAlign.CENTER, 0.5, 0.5);
  }

  return { root, contentW, contentH, ox, oy };
}

/** 创建小卡片背景（用于装备槽、属性行等）。 */
export function makeCard(
  parent: Node, x: number, y: number, w: number, h: number,
  fill: Color = new Color(13, 13, 29, 180),
  stroke: Color = new Color(51, 68, 102, 80),
  radius = 6,
): Graphics {
  const n = new Node('Card');
  setUILayer(n);
  n.setParent(parent);
  n.setPosition(x, y, 0);
  const ut = n.getComponent(UITransform) || n.addComponent(UITransform);
  ut.setContentSize(w, h);
  const g = n.addComponent(Graphics);
  g.fillColor = fill;
  g.roundRect(-w / 2, -h / 2, w, h, radius);
  g.fill();
  g.lineWidth = 1;
  g.strokeColor = stroke;
  g.roundRect(-w / 2, -h / 2, w, h, radius);
  g.stroke();
  return g;
}

/** 创建一个可后续更新进度的进度条，返回 { root, setRatio }。 */
export function makeBar(
  parent: Node, x: number, y: number, w: number, h: number,
  bg: Color, fg: Color,
): { root: Node; setRatio: (r: number) => void } {
  const n = new Node('Bar');
  setUILayer(n);
  n.setParent(parent);
  n.setPosition(x, y, 0);
  const ut = n.getComponent(UITransform) || n.addComponent(UITransform);
  ut.setContentSize(w, h);

  const g = n.addComponent(Graphics);
  g.fillColor = bg;
  g.rect(-w / 2, -h / 2, w, h);
  g.fill();

  const draw = (ratio: number) => {
    if (!g) return;
    g.clear();
    g.fillColor = bg;
    g.rect(-w / 2, -h / 2, w, h);
    g.fill();
    g.fillColor = fg;
    g.rect(-w / 2, -h / 2, w * Math.max(0, Math.min(1, ratio)), h);
    g.fill();
  };
  draw(0);

  return { root: n, setRatio: draw };
}

/** 画一条水平分隔线（在 parent 坐标 x∈[-w/2,w/2], y 处）。 */
export function drawHLine(parent: Node, w: number, y: number, color: Color = new Color(255, 255, 255, 50)): void {
  const g = parent.getComponent(Graphics);
  if (!g) return;
  g.lineWidth = 1;
  g.strokeColor = color;
  g.moveTo(-w / 2, y);
  g.lineTo(w / 2, y);
  g.stroke();
}

/** 创建空节点作为容器，方便成组控制。 */
export function makeContainer(parent: Node, x: number, y: number, name = 'Container'): Node {
  const n = new Node(name);
  setUILayer(n);
  n.setParent(parent);
  n.setPosition(x, y, 0);
  return n;
}
