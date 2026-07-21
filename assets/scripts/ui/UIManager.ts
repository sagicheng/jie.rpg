/**
 * UI 管理器（L0 地基）。
 *
 * 提供一个常驻的全屏 UI root（挂在 Canvas 下、UI_2D 层），所有面板/弹窗挂其下。
 * 提供轻量 Toast 提示（屏幕底部短暂出现，自动消失）。
 *
 * 面板自身管理开关（toggle），UIManager 只负责 root 容器与 Toast。
 */
import { Node, Label, Graphics, UITransform, Color, Layers, tween, UIOpacity, view } from 'cc';
import { setUILayer } from './widgets';

export class UIManager {
  private static _inst: UIManager | null = null;
  static get instance(): UIManager {
    if (!this._inst) this._inst = new UIManager();
    return this._inst;
  }

  private root: Node | null = null;
  private toastNode: Node | null = null;

  /** 在 GameManager.start 时调用，挂载 UI root 到 Canvas。 */
  init(canvas: Node): void {
    if (this.root) return;
    const root = new Node('UIRoot');
    setUILayer(root);
    root.setParent(canvas);
    root.setPosition(0, 0, 10); // 置于游戏内容之上
    this.root = root;
  }

  get uiRoot(): Node {
    if (!this.root) throw new Error('UIManager 未初始化（请先 init）');
    return this.root;
  }

  /** 屏幕底部 Toast 提示，2 秒后淡出。 */
  showToast(msg: string): void {
    if (!this.root) return;
    if (this.toastNode) this.toastNode.destroy();
    const n = new Node('Toast');
    setUILayer(n);
    n.setParent(this.root);
    const size = view.getVisibleSize();
    n.setPosition(0, -size.height / 2 + 60, 0);
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(0, 0, 0, 200);
    g.roundRect(-200, -22, 400, 44, 10);
    g.fill();
    const label = n.addComponent(Label);
    label.string = msg;
    label.color = new Color(255, 255, 255, 255);
    label.fontSize = 18;
    label.horizontalAlign = 1;
    const ut = n.getComponent(UITransform) || n.addComponent(UITransform);
    ut.setContentSize(400, 44);
    const fade = n.addComponent(UIOpacity);
    fade.opacity = 255;
    this.toastNode = n;
    // 2 秒后淡出销毁（UIOpacity 可靠控制透明度）
    tween(fade).delay(1.6).to(0.4, { opacity: 0 }).call(() => {
      n.destroy();
      if (this.toastNode === n) this.toastNode = null;
    }).start();
  }
}
