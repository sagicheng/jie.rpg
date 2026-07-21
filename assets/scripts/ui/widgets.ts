/**
 * 通用 UI 控件工厂（L0 地基）。
 *
 * 从 BattleManager 的控件思路抽出，独立成共享模块，避免重复实现。
 * 关键教训（来自 P2 的 bug）：**文字(Label)与背景(Graphics)必须分处不同节点**，
 * Cocos 不允许同一节点挂两个同名组件。所以按钮 = 父节点(Graphics 背景 + UITransform + 点击)
 * + 子节点(Label 文字)。
 */
import { Node, Label, Graphics, UITransform, Color, Layers } from 'cc';

/** 让节点能被 Canvas 的 UI 相机渲染。 */
export function setUILayer(n: Node): void {
  n.layer = Layers.Enum.UI_2D;
}

/** 创建文字节点（返回 Label 组件，父节点已设 UI_2D）。 */
export function makeText(parent: Node, x: number, y: number, str: string,
                         size: number, color: Color, width = 300): Label {
  const n = new Node('Txt');
  setUILayer(n);
  n.setParent(parent);
  n.setPosition(x, y, 0);
  const label = n.addComponent(Label);
  label.string = str;
  label.color = color;
  label.fontSize = size;
  label.lineHeight = Math.round(size * 1.2);
  label.overflow = Label.Overflow.NONE;
  const ut = n.getComponent(UITransform) || n.addComponent(UITransform);
  ut.setContentSize(width, label.lineHeight);
  return label;
}

/**
 * 创建按钮：父节点持 Graphics 背景 + UITransform + 点击事件，文字在独立子节点。
 * 返回按钮父节点（便于后续 setPosition / active 控制）。
 */
export function makeButton(parent: Node, x: number, y: number, w: number, h: number,
                           text: string, bg: Color, onClick: () => void): Node {
  const n = new Node('Btn_' + text);
  setUILayer(n);
  n.setParent(parent);
  n.setPosition(x, y, 0);

  const g = n.addComponent(Graphics);
  g.fillColor = bg;
  g.roundRect(-w / 2, -h / 2, w, h, 8);
  g.fill();
  g.lineWidth = 1;
  g.strokeColor = new Color(255, 255, 255, 120);
  g.roundRect(-w / 2, -h / 2, w, h, 8);
  g.stroke();

  const label = new Node('Label');
  setUILayer(label);
  label.setParent(n);
  label.setPosition(0, 0, 0);
  const labelComp = label.addComponent(Label);
  labelComp.string = text;
  labelComp.color = new Color(255, 255, 255, 255);
  labelComp.fontSize = 18;
  labelComp.horizontalAlign = 1; // CENTER

  const ut = n.getComponent(UITransform) || n.addComponent(UITransform);
  ut.setContentSize(w, h);

  n.on(Node.EventType.TOUCH_END, () => onClick(), n);
  return n;
}

/** 创建居中半透明面板容器（深底 + 描边 + 圆角）。返回容器节点，子控件挂其下。 */
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
