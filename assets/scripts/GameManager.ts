/**
 * 游戏主控制器（P1 验证版）。
 *
 * 职责：自动登录 → 连接 game 房间 → 运行时创建节点渲染玩家/怪物 → 键盘移动 → 点击怪物触发 enterBattle。
 * 所有可视节点由代码在运行时创建，不依赖任何预制体——这样你后续可以在编辑器里直接替换成自己的真实美术，
 * 而无需改动这里的联机逻辑。
 *
 * 操作空间（你打开编辑器即可体验）：
 *   - GameManager 节点上的属性面板可直接改 serverPort / title / debugNet。
 *   - 场景里加一个空节点挂本组件，点 Preview 即跑；玩家用 WASD/方向键移动，点怪物看它变黄(锁定)→变灰(死亡)。
 */
import {
  _decorator, Component, Node, Vec3, Color, Label, Graphics, UITransform,
  input, Input, EventKeyboard, KeyCode, find, log, Layers, Camera, Canvas,
  director, view,
} from 'cc';
const { ccclass, property } = _decorator;

import { AuthService } from './network/AuthService';
import { ColyseusBridge, PlayerView, MonsterView } from './network/ColyseusBridge';
import { BattleManager } from './BattleManager';
import { LocalPlayerWorld } from './model/LocalPlayerWorld';
import { UIManager } from './ui/UIManager';
import { StatPanel } from './ui/StatPanel';
import { InventoryPanel } from './ui/InventoryPanel';
import { makeButton } from './ui/widgets';

/** P1 演示用的本地怪物摆位（id 与服务器怪物状态机 key 对应；状态由服务器权威下发）。 */
const DEMO_MONSTERS = [
  { id: 'zone1:1', x: 220, y: 200, name: '测试怪 A' },
  { id: 'zone1:2', x: 640, y: 360, name: '测试怪 B' },
];

@ccclass('GameManager')
export class GameManager extends Component {
  @property({ tooltip: '服务器端口（与 dev:server 的 2567 一致）' }) serverPort = 2567;
  @property({ tooltip: '进房称号 title，留空则用角色名' }) title = '';
  @property({ tooltip: '是否在控制台打印联机原始消息' }) debugNet = true;
  @property({ tooltip: 'P1调试：取消自动连接，只验证画面渲染' }) autoConnect = true;

  private bridge = new ColyseusBridge();
  private canvas: Node | null = null;
  private players = new Map<string, Node>();
  private monsters = new Map<string, Node>();
  private selfId = '';
  private selfNode: Node | null = null;
  private selfPos = new Vec3(400, 300, 0);
  private keys = new Set<number>();
  private sendAccum = 0;
  private statusLabel: Label | null = null;
  private hudLabel: Label | null = null;
  private updateReturnCount = 0;
  private battle: BattleManager | null = null;
  private inBattle = false;

  onLoad(): void {
    try {
      console.log('[GameManager] onLoad 开始');
      // 主通道：Cocos input 系统。先在此注册（与场景加载顺序无关，Input 是全局单例）
      input.on(Input.EventType.KEY_DOWN, this.onKey, this);
      input.on(Input.EventType.KEY_UP, this.onKey, this);
      console.log('[GameManager] input 键盘监听已注册');
    } catch (e: any) {
      console.error('[GameManager] onLoad 异常：' + (e?.message || e));
    }
  }

  // window 级兜底：当 Cocos input 在 Preview 里未捕获键盘时仍能驱动移动
  private onWindowKeyDown = (ev: KeyboardEvent): void => this.onWindowKey(ev, true);
  private onWindowKeyUp = (ev: KeyboardEvent): void => this.onWindowKey(ev, false);
  private onWindowKey = (ev: KeyboardEvent, isDown: boolean): void => {
    if (!ev) return;
    if (isDown) {
      if (ev.code === 'KeyC') { StatPanel.instance.toggle(this.bridge); return; }
      if (ev.code === 'KeyB') { InventoryPanel.instance.toggle(this.bridge); return; }
    }
    const map: Record<string, number> = {
      KeyW: KeyCode.KEY_W, ArrowUp: KeyCode.ARROW_UP,
      KeyS: KeyCode.KEY_S, ArrowDown: KeyCode.ARROW_DOWN,
      KeyA: KeyCode.KEY_A, ArrowLeft: KeyCode.ARROW_LEFT,
      KeyD: KeyCode.KEY_D, ArrowRight: KeyCode.ARROW_RIGHT,
    };
    const code = map[ev.code];
    if (code === undefined) return;
    if (isDown) this.keys.add(code); else this.keys.delete(code);
  };

  start(): void {
    try {
      console.log('[GameManager] start 开始');
      this.canvas = find('Canvas');
      if (!this.canvas) {
        console.warn('[GameManager] 找不到 Canvas 节点，回退到 GameManager 自身');
        this.canvas = this.node;
      }

      // 兜底：直接监听 window 的键盘事件（部分 Preview 环境 Cocos input 不触发）
      window.addEventListener('keydown', this.onWindowKeyDown);
      window.addEventListener('keyup', this.onWindowKeyUp);
      console.log('[GameManager] window 键盘兜底监听已注册');

      // 确保 Canvas 有 UI 相机；如果没有，动态创建一个（Preview 偶发不创建的情况）
      this.ensureCanvasCamera();

      this.buildBackground();
      this.buildStatus();
      UIManager.instance.init(this.canvas!);
      this.buildTopButtons();
      this.setStatus('初始化完成，准备连接…');
      console.log('[GameManager] 背景和状态节点已创建');

      // 强制先做纯渲染测试：显示一个本地测试点，让用户能立即看到画面有反应
      this.spawnTestDot();

      if (!this.autoConnect) {
        this.setStatus('autoConnect 已关闭，只渲染画面');
        return;
      }

      this.bootstrapWithTimeout().catch((e: any) => {
        const msg = '启动失败：' + (e?.message || e);
        console.error('[GameManager] ' + msg);
        this.setStatus(msg);
      });
    } catch (e: any) {
      console.error('[GameManager] start 异常：' + (e?.message || e));
    }
  }

  onDestroy(): void {
    input.off(Input.EventType.KEY_DOWN, this.onKey, this);
    input.off(Input.EventType.KEY_UP, this.onKey, this);
    window.removeEventListener('keydown', this.onWindowKeyDown);
    window.removeEventListener('keyup', this.onWindowKeyUp);
    this.battle?.dispose();
    this.bridge.leave();
  }

  // ——————————————————— 启动流程 ———————————————————
  private async bootstrapWithTimeout(): Promise<void> {
    return this.withTimeout(this.bootstrap(), 15000, '连接超时（15s）');
  }

  // 让运行时创建的节点能被 Canvas 的 UI 相机渲染
  private static setUILayer(n: Node): void {
    n.layer = Layers.Enum.UI_2D;
  }

  private ensureCanvasCamera(): void {
    const canvasComp = this.canvas!.getComponent(Canvas);
    if (!canvasComp) {
      console.error('[GameManager] Canvas 组件不存在');
      return;
    }
    let cam = canvasComp.cameraComponent;
    if (!cam) {
      console.log('[GameManager] Canvas 没有 UI 相机，动态创建（兜底）');
      const camNode = new Node('UICamera');
      GameManager.setUILayer(camNode);
      camNode.setParent(this.canvas!);
      camNode.setPosition(0, 0, 1000);

      cam = camNode.addComponent(Camera);
      cam.projection = Camera.ProjectionType.ORTHO;
      cam.visibility = Layers.Enum.UI_2D;
      cam.priority = 100;
      cam.near = 0.1;
      cam.far = 2000;
      // 关键：正交相机 half-height 必须 = 设计分辨率高度/2（960×640 → 320）。
      // 写死 640 会把视锥拉大一倍，导致整个 UI 缩到约 50% 并向中心内移（错位根因）。
      cam.orthoHeight = view.getDesignResolutionSize().height / 2;

      canvasComp.cameraComponent = cam;
      console.log('[GameManager] UI 相机已创建并绑定到 Canvas');
    } else {
      console.log('[GameManager] Canvas 复用已有 UI 相机，visibility=' + cam.visibility);
    }

    // 无论新建或复用，统一把清屏色强制设为深蓝，保证背景一定可见
    cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
    cam.clearColor = new Color(24, 28, 38, 255);
    console.log('[GameManager] UI 相机 clearColor 已强制设为深蓝');
  }

  private async bootstrap(): Promise<void> {
    this.setStatus('正在登录…');
    const colyseus = (globalThis as any).Colyseus;
    if (!colyseus) {
      throw new Error('Colyseus 未加载到全局（插件脚本未生效）');
    }

    const session = await AuthService.ensureSession();
    this.setStatus('已登录，连接房间…');

    // Cocos Preview 运行时 location.hostname 是伪主机名 "scene"，不能用，固定 127.0.0.1
    const host = '127.0.0.1';
    const endpoint = `ws://${host}:${this.serverPort}`;

    this.bindBridge();
    try {
      await this.bridge.connect(endpoint, session.token, session.characterId, this.title);
    } catch (e: any) {
      this.setStatus('连接失败：' + (e?.message || e));
      return;
    }

    this.selfId = this.bridge.selfId;
    this.setStatus('已连接 · 自身 ' + this.selfId.slice(0, 6) + ' · WASD/方向键移动，点怪物开战');
    this.spawnDemoMonsters();
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, reason: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(reason)), ms)),
    ]);
  }

  private bindBridge(): void {
    const b = this.bridge;
    b.onPlayerAdd = (p, key) => this.addPlayer(p, key);
    b.onPlayerChange = (p, key) => this.updatePlayer(p, key);
    b.onPlayerRemove = (key) => this.removePlayer(key);
    b.onMonsterChange = (m) => this.updateMonster(m);
    b.onWorldSync = (pw) => {
      LocalPlayerWorld.instance.update(pw);
      if (this.debugNet) log('[sync] worldSync level=' + (pw?.level ?? '?') + ' gold=' + (pw?.gold ?? '?') + ' inv=' + (pw?.inventory?.length ?? 0));
      this.onWorldSync(pw);
    };
    // 面板需要 bridge 才能发 intent（加点/装备/卸下）
    StatPanel.instance.bindBridge(this.bridge);
    InventoryPanel.instance.bindBridge(this.bridge);
    b.onChat = (msg) => { if (this.debugNet) log('[chat]', msg?.name || '', msg?.text || ''); };
    b.onAuthError = (msg) => this.setStatus('鉴权失败：' + msg);
    b.onError = (msg) => this.setStatus('房间错误：' + msg);
    b.onLeave = (code) => this.setStatus('已断开 code=' + code);
  }

  // ——————————————————— 本地世界同步 ———————————————————
  /** worldSync 到达：本地镜像已更新，刷新顶栏 HUD 与已开面板。 */
  private onWorldSync(_pw: any): void {
    this.updateHud();
    StatPanel.instance.refreshIfOpen();
    InventoryPanel.instance.refreshIfOpen();
  }

  /** 刷新顶栏 HUD 的 等级/金币/属性点（HUD 节点在 buildStatus 中创建）。 */
  private updateHud(): void {
    if (!this.hudLabel) return;
    const pw = LocalPlayerWorld.instance;
    this.hudLabel.string =
      `Lv.${pw.level}　金币 ${pw.gold}` + (pw.statPoints > 0 ? `　⚠可分配 ${pw.statPoints}` : '');
  }

  /** 左上角常驻按钮：角色(C) / 背包(B)。 */
  private buildTopButtons(): void {
    if (!this.canvas) return;
    // 1920×1080 坐标（左上角区域），按钮放大匹配分辨率
    makeButton(this.canvas, -900, 505, 175, 56, '角色(C)', new Color(70, 110, 170, 255), () => StatPanel.instance.toggle(this.bridge));
    makeButton(this.canvas, -705, 505, 175, 56, '背包(B)', new Color(70, 130, 110, 255), () => InventoryPanel.instance.toggle(this.bridge));
  }

  // ——————————————————— 背景 / 状态 ———————————————————
  private buildBackground(): void {
    const n = new Node('BG');
    GameManager.setUILayer(n);
    n.setParent(this.canvas!);
    n.setPosition(0, 0, -1);
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(24, 28, 38, 255);
    // 用可见尺寸铺满整个预览窗口，避免黑边
    const size = view.getVisibleSize();
    const w = size.width + 400, h = size.height + 400;
    g.rect(-w / 2, -h / 2, w, h);
    g.fill();
  }

  private buildStatus(): void {
    // 顶栏：临时状态提示（连接/操作反馈），居中（1920×1080 坐标）
    const n = new Node('Status');
    GameManager.setUILayer(n);
    n.setParent(this.canvas!);
    n.setPosition(0, 500, 1);
    const label = n.addComponent(Label);
    label.string = '初始化…';
    label.color = new Color(180, 220, 255, 255);
    label.fontSize = 18;
    label.lineHeight = 22;
    const ut = n.getComponent(UITransform) || n.addComponent(UITransform);
    ut.setContentSize(1200, 28);
    this.statusLabel = label;

    // 右下角常驻 HUD（等级/金币/可分配点）
    const hud = new Node('HUD');
    GameManager.setUILayer(hud);
    hud.setParent(this.canvas!);
    hud.setPosition(900, -490, 1);
    const hut = hud.getComponent(UITransform) || hud.addComponent(UITransform);
    hut.setContentSize(360, 110);
    hut.setAnchorPoint(1, 0.5);

    // HUD 背景
    const bg = hud.addComponent(Graphics);
    bg.fillColor = new Color(18, 22, 32, 220);
    bg.roundRect(-360, -55, 360, 110, 12);
    bg.fill();
    bg.lineWidth = 1;
    bg.strokeColor = new Color(120, 160, 220, 150);
    bg.roundRect(-360, -55, 360, 110, 12);
    bg.stroke();

    const hudLabel = hud.addComponent(Label);
    hudLabel.string = 'Lv.1\n金币 0';
    hudLabel.color = new Color(255, 230, 150, 255);
    hudLabel.fontSize = 20;
    hudLabel.lineHeight = 30;
    hudLabel.horizontalAlign = 2; // RIGHT
    hudLabel.verticalAlign = 1;   // CENTER
    this.hudLabel = hudLabel;
  }

  private spawnTestDot(): void {
    const node = new Node('TestDot');
    GameManager.setUILayer(node);
    node.setParent(this.canvas!);
    node.setPosition(0, 0, 0);
    const g = node.addComponent(Graphics);
    g.fillColor = new Color(120, 255, 160, 255);
    g.circle(0, 0, 30);
    g.fill();
    g.lineWidth = 3;
    g.strokeColor = new Color(255, 255, 255, 255);
    g.stroke();
  }

  private setStatus(text: string): void {
    if (this.statusLabel) this.statusLabel.string = text;
    log('[GameManager] ' + text);
  }

  // ——————————————————— 玩家 ———————————————————
  private addPlayer(p: PlayerView, key: string): void {
    if (this.players.has(key)) { this.updatePlayer(p, key); return; }
    const isSelf = key === this.selfId;

    const node = new Node(isSelf ? 'Self' : 'Player_' + key.slice(0, 4));
    GameManager.setUILayer(node);
    node.setParent(this.canvas!);
    node.setPosition(p.x, p.y, 0);

    const color = this.hexToColor(p.color) || (isSelf ? new Color(120, 255, 160, 255) : new Color(255, 200, 120, 255));
    const g = node.addComponent(Graphics);
    g.fillColor = color;
    g.circle(0, 0, isSelf ? 20 : 16);
    g.fill();
    g.lineWidth = 2;
    g.strokeColor = new Color(255, 255, 255, 200);
    g.stroke();

    const nameNode = new Node('Name');
    GameManager.setUILayer(nameNode);
    nameNode.setParent(node);
    nameNode.setPosition(0, 30, 0);
    const label = nameNode.addComponent(Label);
    label.string = p.name + (p.title ? `【${p.title}】` : '') + (isSelf ? '（你）' : '');
    label.color = new Color(255, 255, 255, 255);
    label.fontSize = 14;
    const nut = nameNode.getComponent(UITransform) || nameNode.addComponent(UITransform);
    nut.setContentSize(200, 20);

    this.players.set(key, node);
    if (!isSelf && this.debugNet) log('[其他玩家] 加入 key=' + key.slice(0, 6) + ' name=' + p.name);
    if (isSelf) { this.selfNode = node; this.selfPos.set(p.x, p.y, 0); }
  }

  private updatePlayer(p: PlayerView, key: string): void {
    const node = this.players.get(key);
    if (!node) { this.addPlayer(p, key); return; }
    // 自身位置由本地输入驱动，不被服务器回包覆盖（避免抖动）
    if (key !== this.selfId) {
      node.setPosition(p.x, p.y, 0);
      if (this.debugNet) log('[其他玩家] 移动 key=' + key.slice(0, 6) + ' pos=' + Math.round(p.x) + ',' + Math.round(p.y));
    }
  }

  private removePlayer(key: string): void {
    const node = this.players.get(key);
    if (node) { node.destroy(); this.players.delete(key); }
  }

  // ——————————————————— 怪物（本地摆位，状态走服务器）———————————————————
  private spawnDemoMonsters(): void {
    for (const def of DEMO_MONSTERS) {
      const node = new Node('Monster_' + def.id);
      GameManager.setUILayer(node);
      node.setParent(this.canvas!);
      node.setPosition(def.x, def.y, 0);

      const g = node.addComponent(Graphics);
      g.fillColor = new Color(220, 80, 90, 255);
      g.circle(0, 0, 18);
      g.fill();

      const nameNode = new Node('Name');
      GameManager.setUILayer(nameNode);
      nameNode.setParent(node);
      nameNode.setPosition(0, 30, 0);
      const label = nameNode.addComponent(Label);
      label.string = def.name;
      label.color = new Color(255, 230, 230, 255);
      label.fontSize = 13;

      // 点击热区（UITransform 提供命中范围）
      const ut = node.getComponent(UITransform) || node.addComponent(UITransform);
      ut.setContentSize(48, 48);
      node.on(Node.EventType.TOUCH_END, () => this.onMonsterClick(def.id), this);

      this.monsters.set(def.id, node);
    }
  }

  private updateMonster(m: MonsterView): void {
    // P1 边角验证日志：证明服务端怪物状态(busy/dead)确实通过 onChange 广播回前端
    if (this.debugNet) log('[sync怪物] id=' + m.id + ' state=' + m.state + ' owner=' + (m.owner || ''));
    const node = this.monsters.get(m.id);
    if (!node) return;
    const g = node.getComponent(Graphics);
    if (!g) return;
    g.clear();
    if (m.state === 'busy') g.fillColor = new Color(230, 200, 60, 255);      // 战斗中（锁定）
    else if (m.state === 'dead') g.fillColor = new Color(90, 90, 90, 255);   // 已死
    else g.fillColor = new Color(220, 80, 90, 255);                          // 可打
    g.circle(0, 0, 18);
    g.fill();
  }

  private onMonsterClick(id: string): void {
    console.log('[GameManager] 点击怪物 ' + id);
    if (this.inBattle) return;                 // 战斗中不允许重复触发
    if (!this.bridge.room) {
      this.setStatus('房间未连接，无法开战');
      return;
    }
    // 锁怪（服务端 busy，对其他玩家消失/防抢）+ 拉起权威战斗房
    this.bridge.sendEnterBattle(id);
    this.enterBattle(id);
  }

  /** 进入权威战斗：拉起 BattleManager，冻结地图移动，战斗结束后回调 endBattle。 */
  private enterBattle(id: string): void {
    this.inBattle = true;
    // 进战前关闭所有面板，避免战斗 UI 与其重叠
    StatPanel.instance.close();
    InventoryPanel.instance.close();
    this.setStatus('进入战斗：' + id);
    this.battle = new BattleManager();
    void this.battle.start(this.bridge, this.canvas!, id, this.selfId, '勇者',
      (result) => this.endBattle(result, id));
  }

  /** 战斗结束回地图：按结果回写地图怪状态（胜→死，负/逃→解锁），恢复移动。 */
  private endBattle(result: string, id: string): void {
    if (result === 'victory') this.bridge.sendKillMonster(id);
    else this.bridge.sendUnlockMonster(id);
    this.inBattle = false;
    this.battle = null;
    this.setStatus('已返回地图 · WASD/方向键移动，点怪开战');
  }

  // 本地直接设置怪物颜色（乐观更新，不依赖服务端下发）
  private setMonsterLocalState(id: string, state: string): void {
    const node = this.monsters.get(id);
    if (!node) return;
    const g = node.getComponent(Graphics);
    if (!g) return;
    g.clear();
    if (state === 'busy') g.fillColor = new Color(230, 200, 60, 255);      // 战斗中（锁定）黄
    else if (state === 'dead') g.fillColor = new Color(90, 90, 90, 255);   // 已死 灰
    else g.fillColor = new Color(220, 80, 90, 255);                       // 可打 红
    g.circle(0, 0, 18);
    g.fill();
  }

  // ——————————————————— 输入与移动 ———————————————————
  // 保底创建自身节点：当 addPlayer 因 selfId 与下发 key 不匹配等原因没建出自身节点时调用，
  // 确保 update 里的移动逻辑一定能驱动一个可见的绿点。
  private ensureSelfNode(): void {
    if (this.selfNode || !this.canvas) return;
    const node = new Node('Self');
    GameManager.setUILayer(node);
    node.setParent(this.canvas);
    node.setPosition(this.selfPos.x, this.selfPos.y, 0);
    const g = node.addComponent(Graphics);
    g.fillColor = new Color(120, 255, 160, 255);
    g.circle(0, 0, 20);
    g.fill();
    g.lineWidth = 2;
    g.strokeColor = new Color(255, 255, 255, 200);
    g.stroke();

    const nameNode = new Node('Name');
    GameManager.setUILayer(nameNode);
    nameNode.setParent(node);
    nameNode.setPosition(0, 30, 0);
    const label = nameNode.addComponent(Label);
    label.string = '（你）';
    label.color = new Color(255, 255, 255, 255);
    label.fontSize = 14;
    const nut = nameNode.getComponent(UITransform) || nameNode.addComponent(UITransform);
    nut.setContentSize(200, 20);

    this.selfNode = node;
    if (this.selfId) this.players.set(this.selfId, node);
    console.log('[GameManager] ensureSelfNode 已补建自身节点');
  }

  private onKey(e: EventKeyboard): void {
    // C/B 打开/关闭面板（不进入移动 keys）
    if (e.type === Input.EventType.KEY_DOWN) {
      if (e.keyCode === KeyCode.KEY_C) { StatPanel.instance.toggle(this.bridge); return; }
      if (e.keyCode === KeyCode.KEY_B) { InventoryPanel.instance.toggle(this.bridge); return; }
      this.keys.add(e.keyCode);
    } else {
      this.keys.delete(e.keyCode);
    }
  }

  update(dt: number): void {
    // 保底：联机已连但 addPlayer 因 key 不匹配等原因没建出自身节点时，立即补建。
    // 否则 update 第一行就 return，绿点永远不动（这是"画面静止"的根因）。
    if (!this.selfNode && this.bridge.room && this.selfId) {
      this.ensureSelfNode();
    }
    if (!this.selfNode) {
      if (this.updateReturnCount++ < 5) {
        console.log('[GameManager] update 跳过（连接建立中）：selfNode 未创建 room=' + (!!this.bridge.room) + ' selfId=' + this.selfId);
      }
      return;
    }

    // 战斗中冻结整个地图更新（移动 + 上报），避免与战斗逻辑互相干扰
    if (this.inBattle) return;
    // 面板打开时冻结移动（避免开着属性面板还能用 WASD 乱跑）
    if (StatPanel.instance.isOpen() || InventoryPanel.instance.isOpen()) return;

    let dx = 0, dy = 0;
    if (this.keys.has(KeyCode.KEY_W) || this.keys.has(KeyCode.ARROW_UP)) dy += 1;
    if (this.keys.has(KeyCode.KEY_S) || this.keys.has(KeyCode.ARROW_DOWN)) dy -= 1;
    if (this.keys.has(KeyCode.KEY_A) || this.keys.has(KeyCode.ARROW_LEFT)) dx -= 1;
    if (this.keys.has(KeyCode.KEY_D) || this.keys.has(KeyCode.ARROW_RIGHT)) dx += 1;

    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy) || 1;
      const speed = 220;
      this.selfPos.x += (dx / len) * speed * dt;
      this.selfPos.y += (dy / len) * speed * dt;
      this.selfPos.x = Math.max(-920, Math.min(920, this.selfPos.x));
      this.selfPos.y = Math.max(-540, Math.min(540, this.selfPos.y));
      this.selfNode.setPosition(this.selfPos.x, this.selfPos.y, 0);
      if (this.debugNet) log('[GameManager] 移动 pos=' + Math.round(this.selfPos.x) + ',' + Math.round(this.selfPos.y));

      // 仅在联机时上报服务端；未连则纯本地移动（便于验证渲染）
      if (this.bridge.room) {
        this.sendAccum += dt;
        if (this.sendAccum >= 0.1) {
          this.sendAccum = 0;
          this.bridge.sendMove(this.selfPos.x, this.selfPos.y);
        }
      }
    }
  }

  private hexToColor(hex: string): Color | null {
    if (!hex || hex[0] !== '#' || hex.length < 7) return null;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if ([r, g, b].some((v) => Number.isNaN(v))) return null;
    return new Color(r, g, b, 255);
  }
}
