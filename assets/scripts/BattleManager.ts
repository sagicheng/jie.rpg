/**
 * 战斗管理器（P2 实战版）。
 *
 * 职责：点击地图怪后由 GameManager 拉起 → 连权威 BattleRoom → 轮询 state 渲染战斗 UI
 * （玩家/敌人 HP·MP 条、战斗日志、回合/阶段指示、指令菜单 攻击/防御/逃跑）→
 * 指令阶段发 `action` → 服务端结算（伤害/胜负/奖励）→ 结算面板 + 返回地图。
 *
 * 所有可视节点运行时创建，零预制体——与 P1 风格一致，后续可直接替换为真实美术。
 *
 * 协议严格对齐 server/api/BattleRoom.ts + server/core/schema.ts：
 *   - joinOrCreate('battle', { name, ownerSessionId, enemyData, enemyParty, monsterId, playerStats, loadout })
 *   - 消息：action / startbattle（单人自动开战无需）/ battleReward / system
 *   - state：players(Map CombatPlayer) / enemies(Map CombatEnemy) / turnOrder / currentTurn /
 *            phase(waiting|combat|victory|defeat|fled) / roundPhase(command|execute) /
 *            round / log(Array ChatMessage)
 */

import { Node, Color, Label, Graphics, UITransform, Layers } from 'cc';
import { ColyseusBridge } from './network/ColyseusBridge';

/** 演示用玩家属性（对齐 BattleRoom BASE_PLAYER）。真实接入时由角色档案下发。 */
const DEMO_PLAYER_STATS = {
  hp: 220, maxHp: 220, mp: 120, maxMp: 120,
  atk: 42, def: 18, matk: 36, mdef: 16, spd: 12,
};

/** 演示用敌人（单只，适中属性，战斗约 3-5 回合）。 */
const DEMO_ENEMY = {
  name: '测试妖', type: '杂妖', zone: 'zone1',
  maxHp: 180, atk: 30, def: 14, matk: 22, mdef: 12, spd: 11,
  expReward: 30, goldReward: 15, skills: [] as any[],
};

interface CardRefs {
  node: Node;
  nameLabel: Label;
  hpLabel: Label;
  barG: Graphics;        // 单 Graphics：hp 条 + mp 条都画在同一组件（Cocos 不允许同节点挂两个同类组件）
  mpLabel: Label;
  color: Color;
}

export class BattleManager {
  private bridge: ColyseusBridge | null = null;
  private canvas: Node | null = null;
  private room: any = null;
  private monsterId = '';
  private selfId = '';
  private playerName = '勇者';
  private onEnd: ((result: string) => void) | null = null;

  private root: Node | null = null;
  private roundLabel: Label | null = null;
  private logLabel: Label | null = null;
  private menuNode: Node | null = null;
  private resultLabel: Label | null = null;
  private returnBtn: Node | null = null;

  private playerCards = new Map<string, CardRefs>();
  private enemyCards = new Map<string, CardRefs>();

  private syncTimer: any = null;
  private autoActTimer: any = null;
  private curPhaseKey = '';        // round:roundPhase，用于检测新阶段以重置指令菜单/自动行动
  private menuEnabled = false;
  private finished = false;
  private lastReward: any = null;

  // —— 临时诊断（定位 P2 验证问题用，确认后移除）——
  private pollCount = 0;
  private errPlayers = 0;
  private errEnemies = 0;
  private errLog = 0;
  private errPhase = 0;
  private firstCard = false;

  // ——————————————————— 生命周期 ———————————————————
  async start(bridge: ColyseusBridge, canvas: Node, monsterId: string, selfId: string,
              playerName: string, onEnd: (result: string) => void): Promise<void> {
    this.bridge = bridge;
    this.canvas = canvas;
    this.monsterId = monsterId;
    this.selfId = selfId;
    this.playerName = playerName || '勇者';
    this.onEnd = onEnd;

    this.buildUI();

    try {
      this.room = await bridge.connectBattle({
        name: this.playerName,
        ownerSessionId: selfId,                 // 服务端据此把奖励写回玩家本体世界
        enemyData: DEMO_ENEMY,
        enemyParty: [DEMO_ENEMY],
        monsterId: monsterId,
        playerStats: DEMO_PLAYER_STATS,
        loadout: { skills: [], kidos: [], items: [] },   // P2 仅 攻击/防御/逃跑，无需技能负载
        pet: {},                                        // 无宠哨兵：绕过服务端 onJoin 调试日志对 undefined.pet.stats 的崩溃
      });
    } catch (e: any) {
      console.error('[Battle] connectBattle 失败：' + (e?.message || e));
      this.showFatal('进入战斗失败：' + (e?.message || e));
      return;
    }

    console.log('[Battle] room 连接成功 sessionId=' + (this.room?.sessionId) +
      ' stateExists=' + (!!this.room?.state) + ' phase=' + (this.room?.state?.phase));

    this.registerRoom();
    this.startPolling();
  }

  private registerRoom(): void {
    if (!this.room) return;
    this.room.onMessage('battleReward', (r: any) => { this.lastReward = r; console.log('[Battle] 收到 battleReward: ' + JSON.stringify(r)); });
    this.room.onMessage('system', () => { /* 系统提示已进 log，无需额外处理 */ });
    this.room.onLeave(() => {
      if (this.finished || !this.root) return;
      // 非主动离开且战斗未结束 → 视为断连
      this.showFatal('战斗连接断开');
    });
  }

  private startPolling(): void {
    this.stopPolling();
    console.log('[Battle] 开始轮询（300ms）');
    this.syncTimer = setInterval(() => this.poll(), 300);
  }
  private stopPolling(): void {
    if (this.syncTimer !== null) { clearInterval(this.syncTimer); this.syncTimer = null; }
  }
  private clearAutoAct(): void {
    if (this.autoActTimer !== null) { clearTimeout(this.autoActTimer); this.autoActTimer = null; }
  }

  /** 销毁全部 UI 并断开房间（返回地图前调用）。 */
  dispose(): void {
    this.stopPolling();
    this.clearAutoAct();
    try { this.room?.leave(); } catch { /* ignore */ }
    this.room = null;
    if (this.root) { this.root.destroy(); this.root = null; }
    this.playerCards.clear();
    this.enemyCards.clear();
  }

  // ——————————————————— 轮询渲染 ———————————————————
  private poll(): void {
    if (!this.room) { if (this.pollCount === 0) console.log('[Battle] poll#0 room 未就绪'); this.pollCount++; return; }
    if (!this.room.state) { if (this.pollCount === 0) console.log('[Battle] poll#0 state 未就绪'); this.pollCount++; return; }
    const st = this.room.state;
    if (this.pollCount < 5 || this.pollCount % 20 === 0) {
      console.log(`[Battle] poll#${this.pollCount} phase=${st.phase} round=${st.round} ` +
        `players=${this.probe(st.players)} enemies=${this.probe(st.enemies)} logLen=${st.log ? st.log.length : 'n/a'} curTurn=${st.currentTurn}`);
    }
    this.pollCount++;
    try { this.renderRound(st); } catch (e: any) { if (this.errPhase++ < 1) console.error('[Battle] renderRound 抛错: ' + e.message); }
    try { this.renderPlayers(st); } catch (e: any) { if (this.errPlayers++ < 1) console.error('[Battle] renderPlayers 抛错: ' + e.message + '\n' + (e.stack || '')); }
    try { this.renderEnemies(st); } catch (e: any) { if (this.errEnemies++ < 1) console.error('[Battle] renderEnemies 抛错: ' + e.message + '\n' + (e.stack || '')); }
    try { this.renderLog(st); } catch (e: any) { if (this.errLog++ < 1) console.error('[Battle] renderLog 抛错: ' + e.message); }
    try { this.handlePhase(st); } catch (e: any) { if (this.errPhase++ < 1) console.error('[Battle] handlePhase 抛错: ' + e.message); }
  }

  private probe(m: any): string {
    if (!m) return 'missing';
    try { return (m.constructor?.name || typeof m) + '(size=' + (m.size ?? '?') + ')'; }
    catch (e: any) { return 'err:' + e.message; }
  }

  private renderRound(st: any): void {
    if (!this.roundLabel) return;
    const phaseText =
      st.phase === 'waiting' ? '准备中…' :
      st.phase === 'victory' ? '胜利！' :
      st.phase === 'defeat' ? '战败…' :
      st.phase === 'fled' ? '逃脱' :
      (st.roundPhase === 'command' ? '指令阶段（选择行动）' : '执行中…');
    this.roundLabel.string = `第 ${st.round || 0} 回合 · ${phaseText}`;
  }

  private renderPlayers(st: any): void {
    const map = st.players;
    if (!map) { console.log('[Battle] renderPlayers: players 表缺失'); return; }
    if (!this.firstCard && map.size === 0) { console.log('[Battle] renderPlayers: players 表为空 size=0'); }
    const seen = new Set<string>();
    map.forEach((p: any, key: string) => {
      seen.add(key);
      let card = this.playerCards.get(key);
      if (!card) { card = this.createPlayerCard(key, p); if (!this.firstCard) { this.firstCard = true; console.log('[Battle] 首个玩家卡已建 key=' + key + ' name=' + p.name + ' hp=' + p.hp + '/' + p.maxHp); } }
      this.updateCard(card, p.hp, p.maxHp, p.mp, p.maxMp, p.name + (p.isPet ? '（灵宠）' : ''));
    });
    for (const key of Array.from(this.playerCards.keys())) {
      if (!seen.has(key)) { this.playerCards.get(key)!.node.destroy(); this.playerCards.delete(key); }
    }
  }

  private renderEnemies(st: any): void {
    const map = st.enemies;
    if (!map) { console.log('[Battle] renderEnemies: enemies 表缺失'); return; }
    const seen = new Set<string>();
    map.forEach((e: any, key: string) => {
      seen.add(key);
      let card = this.enemyCards.get(key);
      if (!card) { card = this.createEnemyCard(key, e); console.log('[Battle] 首个敌人卡已建 key=' + key + ' name=' + e.name + ' hp=' + e.hp + '/' + e.maxHp); }
      this.updateCard(card, e.hp, e.maxHp, null, null, e.name);
    });
    for (const key of Array.from(this.enemyCards.keys())) {
      if (!seen.has(key)) { this.enemyCards.get(key)!.node.destroy(); this.enemyCards.delete(key); }
    }
  }

  private renderLog(st: any): void {
    if (!this.logLabel || !st.log) return;
    const n = st.log.length;
    const start = Math.max(0, n - 8);
    const lines: string[] = [];
    for (let i = start; i < n; i++) {
      const m = st.log[i];
      lines.push(`${m.name}：${m.text}`);
    }
    this.logLabel.string = lines.join('\n');
  }

  // ——————————————————— 阶段 / 指令 ———————————————————
  private handlePhase(st: any): void {
    const key = `${st.round}:${st.phase}:${st.roundPhase}`;
    const phaseChanged = key !== this.curPhaseKey;
    this.curPhaseKey = key;

    // 进入新指令阶段：启用菜单 + 安排 6s 自动普攻（保证无操作也能推进服务端结算）
    if (st.phase === 'combat' && st.roundPhase === 'command' && phaseChanged) {
      this.menuEnabled = true;
      if (this.menuNode) this.menuNode.active = true;
      this.clearAutoAct();
      this.autoActTimer = setTimeout(() => {
        if (this.menuEnabled && !this.finished && this.room &&
            this.room.state && this.room.state.roundPhase === 'command') {
          this.sendAction('attack');
        }
      }, 6000);
    }

    // 非指令阶段：禁用菜单
    if (!(st.phase === 'combat' && st.roundPhase === 'command')) {
      this.menuEnabled = false;
      if (this.menuNode) this.menuNode.active = false;
      this.clearAutoAct();
    }

    // 终局：结算
    if ((st.phase === 'victory' || st.phase === 'defeat' || st.phase === 'fled') && !this.finished) {
      this.finished = true;
      this.menuEnabled = false;
      if (this.menuNode) this.menuNode.active = false;
      this.clearAutoAct();
      this.stopPolling();
      this.showResult(st);
    }
  }

  private firstAliveEnemy(): string | undefined {
    if (!this.room || !this.room.state) return undefined;
    const es = this.room.state.enemies;
    if (!es) return undefined;
    let found: string | undefined;
    es.forEach((e: any, key: string) => { if (!found && e.alive) found = key; });
    return found;
  }

  private sendAction(type: string): void {
    if (!this.room || this.finished || !this.menuEnabled) return;
    const targetId = (type === 'attack' || type === 'defend') ? this.firstAliveEnemy() : undefined;
    this.room.send('action', { type, targetId });
    // 提交后禁用菜单，等下一指令阶段（handlePhase 会重新启用）
    this.menuEnabled = false;
    if (this.menuNode) this.menuNode.active = false;
    this.clearAutoAct();
  }

  // ——————————————————— 结果 ———————————————————
  private showResult(st: any): void {
    if (!this.resultLabel) return;
    console.log('[Battle] 结算 phase=' + st.phase + ' winner=' + st.winner +
      ' reward=' + JSON.stringify(this.lastReward));
    const win = st.phase === 'victory';
    const r = this.lastReward || {};
    let txt: string;
    if (st.phase === 'fled') {
      txt = '成功逃脱';
    } else if (win) {
      txt = `胜利！\n经验 +${r.exp ?? 0}   金币 +${r.gold ?? 0}`;
      if (Array.isArray(r.loot) && r.loot.length) txt += `\n战利品：${r.loot.join('、')}`;
      if (r.leveled) txt += '\n升级！';
    } else {
      txt = '战败……\n（怪物将对所有人重新出现）';
    }
    this.resultLabel.string = txt;
    this.resultLabel.node.active = true;
    if (this.resultLabel.node.parent) this.resultLabel.node.parent.active = true;  // 激活整个结算面板
    if (this.returnBtn) this.returnBtn.active = true;
  }

  private showFatal(msg: string): void {
    if (this.resultLabel) {
      this.resultLabel.string = msg;
      this.resultLabel.node.active = true;
      if (this.resultLabel.node.parent) this.resultLabel.node.parent.active = true;
    }
    if (this.returnBtn) this.returnBtn.active = true;
    this.finished = true;
  }

  // ——————————————————— UI 构建 ———————————————————
  private setUILayer(n: Node): void { n.layer = Layers.Enum.UI_2D; }

  private buildUI(): void {
    const canvas = this.canvas!;
    const root = new Node('BattleRoot');
    this.setUILayer(root);
    root.setParent(canvas);
    root.setPosition(0, 0, 100);   // 盖在地图之上
    root.setScale(1.5);            // 960×640 坐标系均匀放大到 1920×1080（非均匀会扭曲文字）
    this.root = root;

    // 遮罩底（深蓝近黑，盖住地图）
    const bg = new Node('BG');
    this.setUILayer(bg); bg.setParent(root); bg.setPosition(0, 0, -1);
    const g = bg.addComponent(Graphics);
    g.fillColor = new Color(16, 18, 26, 240);
    g.rect(-1000, -1000, 2000, 2000); g.fill();

    // 标题
    const title = this.makeText(root, 0, 300, '战 斗', 30, new Color(255, 232, 176, 255), 400);
    title.node.active = true;

    // 回合/阶段指示
    const round = this.makeText(root, 0, 262, '准备中…', 18, new Color(180, 220, 255, 255), 600);
    this.roundLabel = round;

    // 战斗日志面板（中央）
    const logPanel = new Node('LogPanel');
    this.setUILayer(logPanel); logPanel.setParent(root); logPanel.setPosition(0, 30, 0);
    const lg = logPanel.addComponent(Graphics);
    lg.fillColor = new Color(28, 32, 44, 200);
    lg.roundRect(-310, -90, 620, 180, 10); lg.fill();
    lg.lineWidth = 1; lg.strokeColor = new Color(80, 90, 120, 200); lg.roundRect(-310, -90, 620, 180, 10); lg.stroke();
    const log = this.makeText(root, 0, 100, '', 14, new Color(210, 220, 235, 255), 600);
    this.logLabel = log;

    // 指令菜单（底部）
    const menu = new Node('Menu');
    this.setUILayer(menu); menu.setParent(root); menu.setPosition(0, -210, 0);
    this.makeButton(menu, -200, 0, 160, 54, '攻击', new Color(220, 90, 90, 255), () => this.sendAction('attack'));
    this.makeButton(menu, 0, 0, 160, 54, '防御', new Color(90, 150, 220, 255), () => this.sendAction('defend'));
    this.makeButton(menu, 200, 0, 160, 54, '逃跑', new Color(150, 150, 160, 255), () => this.sendAction('escape'));
    this.menuNode = menu;

    // 结算面板（带背景框，默认隐藏，确保醒目）
    const resultPanel = new Node('ResultPanel');
    this.setUILayer(resultPanel); resultPanel.setParent(root); resultPanel.setPosition(0, 60, 1);
    const rg = resultPanel.addComponent(Graphics);
    rg.fillColor = new Color(20, 24, 36, 248);
    rg.roundRect(-230, -120, 460, 240, 16); rg.fill();
    rg.lineWidth = 2; rg.strokeColor = new Color(120, 200, 160, 230);
    rg.roundRect(-230, -120, 460, 240, 16); rg.stroke();
    const result = this.makeText(resultPanel, 0, 50, '', 24, new Color(255, 240, 200, 255), 400);
    result.node.active = false;
    this.resultLabel = result;

    // 返回地图按钮（默认隐藏）
    const back = this.makeButton(resultPanel, 0, -70, 220, 56, '返回地图', new Color(90, 200, 140, 255), () => {
      const res = this.room ? (this.room.state ? this.room.state.phase : 'defeat') : 'defeat';
      this.dispose();
      if (this.onEnd) this.onEnd(res);
    });
    back.active = false;
    this.returnBtn = back;
  }

  private makeText(parent: Node, x: number, y: number, str: string, size: number,
                   color: Color, width: number): Label {
    const n = new Node('Text');
    this.setUILayer(n); n.setParent(parent); n.setPosition(x, y, 0);
    const label = n.addComponent(Label);
    label.string = str; label.color = color; label.fontSize = size;
    label.lineHeight = size + 4; label.horizontalAlign = 1; // 1 = CENTER
    const ut = n.getComponent(UITransform) || n.addComponent(UITransform);
    ut.setContentSize(width, (size + 4) * 3);
    return label;
  }

  private makeButton(parent: Node, x: number, y: number, w: number, h: number,
                      text: string, color: Color, onClick: () => void): Node {
    const n = new Node('Btn_' + text);
    this.setUILayer(n); n.setParent(parent); n.setPosition(x, y, 0);

    // 背景 Graphics（按钮自身只承载 Graphics，文字放在独立子节点）
    const g = n.addComponent(Graphics);
    g.fillColor = color;
    g.roundRect(-w / 2, -h / 2, w, h, 10); g.fill();
    g.lineWidth = 2; g.strokeColor = new Color(255, 255, 255, 180);
    g.roundRect(-w / 2, -h / 2, w, h, 10); g.stroke();

    // 文字 Label（独立子节点，避免与 Graphics 渲染组件冲突）
    const labelNode = new Node('BtnLabel_' + text);
    this.setUILayer(labelNode); labelNode.setParent(n);
    const label = labelNode.addComponent(Label);
    label.string = text; label.color = new Color(255, 255, 255, 255);
    label.fontSize = 20; label.horizontalAlign = 1;

    const ut = n.getComponent(UITransform) || n.addComponent(UITransform);
    ut.setContentSize(w, h);
    n.on(Node.EventType.TOUCH_END, () => onClick(), this);
    return n;
  }

  private createPlayerCard(key: string, p: any): CardRefs {
    const idx = this.playerCards.size;
    const x = -270;
    const y = 150 - idx * 120;
    const node = new Node('PCard_' + key.slice(0, 6));
    this.setUILayer(node); node.setParent(this.root!); node.setPosition(x, y, 0);
    const cardColor = this.hexColor(p.color) || new Color(120, 255, 160, 255);

    const nameLabel = this.makeText(node, 0, 44, p.name, 16, new Color(255, 255, 255, 255), 220);
    const hpLabel = this.makeText(node, 0, 14, 'HP', 13, new Color(200, 220, 200, 255), 220);
    const barG = node.addComponent(Graphics);
    const mpLabel = this.makeText(node, 0, -14, 'MP', 13, new Color(200, 210, 230, 255), 220);

    const refs: CardRefs = { node, nameLabel, hpLabel, barG, mpLabel, color: cardColor };
    this.playerCards.set(key, refs);
    return refs;
  }

  private createEnemyCard(key: string, e: any): CardRefs {
    const idx = this.enemyCards.size;
    const x = 270;
    const y = 150 - idx * 120;
    const node = new Node('ECard_' + key.slice(0, 6));
    this.setUILayer(node); node.setParent(this.root!); node.setPosition(x, y, 0);
    const cardColor = new Color(255, 120, 120, 255);

    const nameLabel = this.makeText(node, 0, 44, e.name, 16, new Color(255, 230, 230, 255), 220);
    const hpLabel = this.makeText(node, 0, 14, 'HP', 13, new Color(230, 200, 200, 255), 220);
    const barG = node.addComponent(Graphics);
    const mpLabel = this.makeText(node, 0, -14, '', 13, new Color(0, 0, 0, 0), 220);

    const refs: CardRefs = { node, nameLabel, hpLabel, barG, mpLabel, color: cardColor };
    this.enemyCards.set(key, refs);
    return refs;
  }

  private updateCard(c: CardRefs, hp: number, maxHp: number, mp: number | null, maxMp: number | null, name: string): void {
    c.nameLabel.string = name;
    const hpRatio = maxHp > 0 ? hp / maxHp : 0;
    c.hpLabel.string = `HP ${Math.max(0, Math.round(hp))}/${Math.round(maxHp)}`;
    // 单 Graphics 先清一次，再画 hp 条 + mp 条（避免同节点双 Graphics 组件冲突）
    c.barG.clear();
    this.drawBar(c.barG, -100, -6, 200, 16, hpRatio, new Color(90, 210, 120, 255));
    if (mp !== null && maxMp !== null) {
      const mpRatio = maxMp > 0 ? mp / maxMp : 0;
      c.mpLabel.string = `MP ${Math.max(0, Math.round(mp))}/${Math.round(maxMp)}`;
      this.drawBar(c.barG, -100, -34, 200, 12, mpRatio, new Color(90, 160, 230, 255));
    }
  }

  private drawBar(g: Graphics, x: number, y: number, w: number, h: number, ratio: number, color: Color): void {
    // 注意：调用方负责 clear（单 Graphics 共用），此处只绘制
    g.fillColor = new Color(40, 44, 56, 255);
    g.roundRect(x, y, w, h, 4); g.fill();
    const fw = Math.max(0, Math.min(1, ratio)) * w;
    if (fw > 1) {
      g.fillColor = color;
      g.roundRect(x, y, fw, h, 4); g.fill();
    }
  }

  private hexColor(hex: string): Color | null {
    if (!hex || hex[0] !== '#' || hex.length < 7) return null;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if ([r, g, b].some((v) => Number.isNaN(v))) return null;
    return new Color(r, g, b, 255);
  }
}
