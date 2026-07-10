/**
 * 联机权威战斗场景（Stage C 切片）。
 * 设计要点（贴合 12-联机化总体方案.md）：
 *  - 本场景"只当渲染器"：不发任何战斗数学，只发意图（action），状态全部来自 battle 房间。
 *  - 服务端（server/rooms/BattleRoom.ts）跑回合循环、伤害结算、掉落、胜负——天然防作弊、多端一致。
 *  - 动画/表现由"收到服务端状态变更"驱动（这里用 onStateChange 全量重绘，切片够用；后续可细化到逐条日志插值）。
 *  - 单机 BattleScene 完全不动，两个入口互不干扰。
 *
 * 交互（还原单机完整指令 + 联机权威化）：
 *  - 6 按钮：攻击 / 技能 / 鬼道 / 道具 / 防御 / 逃跑。
 *  - 技能 / 鬼道 / 道具 点击后弹出子菜单（列出可用项，MP 不足灰显）。
 *  - 攻击 / 敌方单体技能 / 伤害型鬼道 点击后弹出"选择目标"。
 *  - 服务端按 skillName / kidoId / itemId 权威结算，根除"点了直接胜利"的假结算。
 *
 * 触发：GameScene 按 V 进入（两个窗口都按 V → 同房间组队打怪），或地图碰怪进入（map 模式权威战斗）。
 */
import Phaser from 'phaser';
import { getClient } from '../net/Net';
import { SKILL_BY_NAME, getSkillTargetType, SkillData } from '../systems/Skills';
import { Kido, KidoNode } from '../systems/Kido';
import { Inventory } from '../systems/Inventory';
import type { Item } from '../systems/Inventory';
import type { EnemyData } from '../systems/BattleData';

interface Card {
  root: Phaser.GameObjects.Container;
  name: Phaser.GameObjects.Text;
  hpBar: Phaser.GameObjects.Graphics;
  hpText: Phaser.GameObjects.Text;
}

interface Button {
  container: Phaser.GameObjects.Container;
  setEnable: (b: boolean) => void;
}

interface ClientLoadout {
  skills: string[];
  kidos: KidoNode[];
  items: Item[];
  playerStats?: { hp?: number; maxHp?: number; mp?: number; maxMp?: number; atk?: number; def?: number; matk?: number; mdef?: number; spd?: number };
}

interface MenuEntry {
  label: string;
  sub?: string;
  disabled?: boolean;
  onClick: () => void;
}

export class MultiBattleScene extends Phaser.Scene {
  private room: any = null;
  private mySessionId = '';
  private playerName = '勇者';

  private playerCards: Map<string, Card> = new Map();
  private enemyCards: Map<string, Card> = new Map();
  private logText!: Phaser.GameObjects.Text;
  private turnText!: Phaser.GameObjects.Text;
  private actionBtns: Record<string, Button> = {};
  private mpText!: Phaser.GameObjects.Text;
  private resultPanel: Phaser.GameObjects.Container | null = null;

  // 地图怪权威战斗模式（区别于 V键组队虚怪）
  private mode: 'vkey' | 'map' = 'vkey';
  private enemyData: any = null;       // 真实地图怪数据（map 模式，用于胜利回写）
  private enemyParty: EnemyData[] = []; // 本场敌人阵容（小怪成组 / Boss+随从），传给服务端权威 spawn
  private monsterId = '';              // 该怪在 GameRoom 的 `${zone}:${idx}`（map 模式）
  private endReported = false;         // 防止 victory/defeat 重复回写
  private intentionalLeave = false;    // 主动点「返回地图」时置真，避免 onLeave 误弹「连接断开」

  // 进房携带的可用技能/鬼道/道具/玩家真实属性（服务端据其做权威校验与结算）
  private loadout: ClientLoadout = { skills: [], kidos: [], items: [] };

  // 子菜单 / 目标选择弹层
  private menu: Phaser.GameObjects.Container | null = null;
  private menuOpen = false;
  private lastIsMyTurn = false;

  constructor() {
    super({ key: 'MultiBattleScene' });
  }

  init(data: { playerName?: string; mode?: 'vkey' | 'map'; enemyData?: any; enemyParty?: EnemyData[]; monsterId?: string; loadout?: ClientLoadout }): void {
    this.playerName = data?.playerName || '玩家';
    this.mode = data?.mode || 'vkey';
    this.enemyData = data?.enemyData || null;
    this.enemyParty = data?.enemyParty || [];
    this.monsterId = data?.monsterId || '';
    this.loadout = data?.loadout || { skills: [], kidos: [], items: [] };
    // 重置（场景复用同一实例时避免脏状态）
    this.room = null;
    this.mySessionId = '';
    this.playerCards.clear();
    this.enemyCards.clear();
    this.resultPanel = null;
    this.endReported = false;
    this.intentionalLeave = false;
    this.menu = null;
    this.menuOpen = false;
  }

  create(): void {
    const w = this.scale.width;
    const h = this.scale.height;

    this.add.rectangle(0, 0, w, h, 0x0a0a1e).setOrigin(0).setDepth(0);
    this.add.text(w / 2, 36, '联机权威战斗', { fontSize: '28px', color: '#c9a96e', fontStyle: 'bold' }).setOrigin(0.5).setDepth(10);
    this.turnText = this.add.text(w / 2, 80, '连接中…', { fontSize: '18px', color: '#ffe8b0' }).setOrigin(0.5).setDepth(10);

    this.logText = this.add.text(60, h - 360, '', {
      fontSize: '14px', color: '#cccccc', wordWrap: { width: w - 120 }, lineSpacing: 4,
    }).setDepth(10);

    // 命令栏：攻击/技能/鬼道/道具/防御/逃跑（还原单机完整指令，左右布局不变）
    const cmdDefs: { label: string; type: string; color: number; act: () => void }[] = [
      { label: '攻击', type: 'attack', color: 0x2e7d32, act: () => this.onAttack() },
      { label: '技能', type: 'skill', color: 0x1565c0, act: () => this.openSkillMenu() },
      { label: '鬼道', type: 'kido', color: 0x283593, act: () => this.openKidoMenu() },
      { label: '道具', type: 'item', color: 0xef6c00, act: () => this.openItemMenu() },
      { label: '防御', type: 'defend', color: 0x455a64, act: () => this.send({ type: 'defend' }) },
      { label: '逃跑', type: 'escape', color: 0xc62828, act: () => this.send({ type: 'escape' }) },
    ];
    const bw = 140, bh = 48, bgap = 6;
    const totalW = bw * cmdDefs.length + bgap * (cmdDefs.length - 1);
    const startX = (w - totalW) / 2 + bw / 2;
    const by = h - 70;
    cmdDefs.forEach((c, i) => {
      const bx = startX + i * (bw + bgap);
      this.actionBtns[c.type] = this.makeButton(bx, by, c.label, c.color, c.act, bw, bh);
    });
    this.mpText = this.add.text(w / 2, 110, '', { fontSize: '15px', color: '#88aaff' }).setOrigin(0.5).setDepth(10);

    this.connect();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.menu) { this.menu.destroy(true); this.menu = null; this.menuOpen = false; }
      if (this.room) { this.room.leave(); this.room = null; }
      if (this.scene.isPaused('GameScene')) this.scene.resume('GameScene');
    });
  }

  // ——— 连接权威战斗房间 ———
  private connect(): void {
    // monsterId 保留原值：map 模式为具体怪 id，V键组队为 ''（filterBy 据此匹配同房）
    const serverLoadout = {
      skills: this.loadout.skills,
      kidos: this.loadout.kidos.map((k) => ({
        id: k.id,
        mp: Kido.getNodeMp(k.id),
        power: Kido.getNodePower(k.id),
        effectType: k.effect.type,
        target: (k.effect as any).target || 'single',
        reviveHpPercent: (k.effect as any).hpPercent,
      })),
      items: this.loadout.items.map((i) => i.id),
    };
    getClient().joinOrCreate('battle', {
      name: this.playerName,
      enemyData: this.enemyData ?? undefined,
      enemyParty: this.enemyParty,
      monsterId: this.monsterId,
      loadout: serverLoadout,
      playerStats: this.loadout.playerStats,
    })
      .then((room: any) => {
        this.room = room;
        this.mySessionId = room.sessionId;
        const myRoom = room; // 闭包捕获，避免场景复用单例下旧房间异步离开误判
        room.onStateChange(() => this.renderState());
        room.onLeave(() => {
          // 仅当离开的是"当前房间"且非主动离开（点返回地图）且战斗仍在进行，才视为断连
          if (this.room !== myRoom) return;
          if (this.intentionalLeave) return;
          if (this.resultPanel) return;
          this.showResult('连接断开');
        });
        // 服务端 BattleRoom.logMsg('system', ...) 的系统提示，客户端暂无需处理，注册空处理器消除告警。
        room.onMessage('system', () => {});
        this.renderState();
        // 单人自检：若 1.5s 内仍只有自己（无人组队），则主动开战，便于单窗口验证 UI
        this.time.delayedCall(1500, () => {
          if (this.room && this.room.state && this.room.state.phase === 'waiting') {
            this.room.send('startbattle');
          }
        });
      })
      .catch((e: any) => {
        console.error('[battle] 连接失败', e);
        this.showResult('无法连接战斗服务器');
      });
  }

  /** 发送意图（仅当前回合、战斗阶段可发）。 */
  private send(action: { type: string; id?: string; targetId?: string }): void {
    if (!this.room || !this.room.state) return;
    if (this.room.state.phase !== 'combat') return;
    if (this.room.state.currentTurn !== this.mySessionId) return; // 非我方回合，忽略（防加速/作弊）
    this.room.send('action', action);
  }

  // ——— 攻击：多怪时选目标，单怪直接打 ———
  private onAttack(): void {
    if (!this.room || !this.room.state) return;
    const enemies = [...this.room.state.enemies.values()].filter((e: any) => e.alive);
    if (enemies.length === 1) this.send({ type: 'attack', targetId: enemies[0].id });
    else this.openTargetSelect('attack', undefined);
  }

  // ——— 技能子菜单 ———
  private openSkillMenu(): void {
    if (this.loadout.skills.length === 0) { this.flashMessage('没有可用技能'); return; }
    const me = this.room?.state?.players?.get(this.mySessionId);
    const entries: MenuEntry[] = this.loadout.skills.map((name) => {
      const sk: SkillData | undefined = SKILL_BY_NAME[name];
      const mp = sk?.mp ?? 0;
      const can = !!me && me.mp >= mp;
      return {
        label: `${this.skillTag(sk)} ${name}${sk ? `  MP${mp}` : ''}`,
        sub: sk?.desc,
        disabled: !can,
        onClick: () => this.onPickSkill(sk),
      };
    });
    this.openList('选择技能', entries);
  }

  private skillTag(sk?: SkillData): string {
    if (!sk) return '';
    const dmg = sk.skillType === 'heal' ? '[愈]' : sk.skillType === 'control' ? '[控]' : (sk.damageType === 'magical' ? '[魔]' : '[物]');
    const tt = getSkillTargetType(sk);
    const tgt = (tt === 'enemy' || tt === 'enemy-all') ? '[敌]' : '[我]';
    return `${dmg}${tgt}`;
  }

  private onPickSkill(sk?: SkillData): void {
    if (!sk) return;
    const tt = getSkillTargetType(sk);
    if (tt === 'enemy') this.openTargetSelect('skill', sk.name);
    else this.send({ type: 'skill', id: sk.name }); // self / ally / ally-all / enemy-all 无需选怪
  }

  // ——— 鬼道子菜单 ———
  private openKidoMenu(): void {
    if (this.loadout.kidos.length === 0) { this.flashMessage('没有学习鬼道'); return; }
    const me = this.room?.state?.players?.get(this.mySessionId);
    const entries: MenuEntry[] = this.loadout.kidos.map((k) => {
      const mp = Kido.getNodeMp(k.id);
      const can = !!me && me.mp >= mp;
      const tag = k.school === 'hado' ? '[破]' : k.school === 'bakudo' ? '[缚]' : '[回]';
      const kname = (k as any).number ? `${(k as any).number}·${k.name}` : k.name;
      return {
        label: `${tag} ${kname}  MP${mp}`,
        sub: k.desc,
        disabled: !can,
        onClick: () => this.onPickKido(k),
      };
    });
    this.openList('选择鬼道', entries);
  }

  private onPickKido(k: KidoNode): void {
    const eff = k.effect.type;
    if (eff === 'damage' || eff === 'control') this.openTargetSelect('kido', k.id);
    else this.send({ type: 'kido', id: k.id }); // heal / revive / cleanse / shield 作用于自身或队友
  }

  // ——— 道具子菜单（道具作用于自身，无需选怪）———
  private openItemMenu(): void {
    if (this.loadout.items.length === 0) { this.flashMessage('没有可用道具'); return; }
    const entries: MenuEntry[] = this.loadout.items.map((it) => ({
      label: `道具·${it.name}`,
      sub: it.desc,
      onClick: () => this.send({ type: 'item', id: it.id }),
    }));
    this.openList('使用道具', entries);
  }

  // ——— 目标选择（攻击 / 敌方单体技能 / 伤害型鬼道）———
  private openTargetSelect(type: string, id?: string): void {
    if (!this.room || !this.room.state) return;
    const enemies = [...this.room.state.enemies.values()].filter((e: any) => e.alive);
    if (enemies.length === 0) return;
    if (enemies.length === 1) { this.send({ type, id, targetId: enemies[0].id }); return; }
    const entries: MenuEntry[] = enemies.map((e: any) => ({
      label: `目标·${e.name}  HP ${Math.max(0, Math.round(e.hp))}/${Math.round(e.maxHp)}`,
      onClick: () => this.send({ type, id, targetId: e.id }),
    }));
    this.openList('选择目标', entries);
  }

  // ——— 通用弹层（子菜单 / 目标选择共用）———
  private openList(title: string, entries: MenuEntry[]): void {
    this.closeMenu();
    this.menuOpen = true;
    const w = this.scale.width, h = this.scale.height;
    const c = this.add.container(0, 0).setDepth(60);
    const panelW = 560, rowH = 40, pad = 10, titleH = 36, backH = 40;
    const listH = entries.length * (rowH + 6);
    const panelH = titleH + listH + backH + pad * 3;
    const px = (w - panelW) / 2;
    const py = (h - panelH) / 2;

    const bg = this.add.graphics();
    bg.fillStyle(0x0d0d1e, 0.94); bg.fillRoundedRect(px, py, panelW, panelH, 12);
    bg.lineStyle(2, 0xc9a96e, 0.7); bg.strokeRoundedRect(px, py, panelW, panelH, 12);
    c.add(bg);
    c.add(this.add.text(px + panelW / 2, py + 18, title, { fontSize: '20px', color: '#c9a96e', fontStyle: 'bold' }).setOrigin(0.5));

    let y = py + pad + titleH;
    entries.forEach((en) => {
      const ry = y;
      const rowBg = this.add.graphics();
      rowBg.fillStyle(en.disabled ? 0x1a1a2e : 0x2a2a4e, 0.95);
      rowBg.fillRoundedRect(px + pad, ry, panelW - pad * 2, rowH, 8);
      rowBg.lineStyle(1, en.disabled ? 0x333344 : 0x556688, 0.5);
      rowBg.strokeRoundedRect(px + pad, ry, panelW - pad * 2, rowH, 8);
      c.add(rowBg);
      c.add(this.add.text(px + pad + 14, ry + 8, en.label, { fontSize: '15px', color: en.disabled ? '#556' : '#dde', fontStyle: 'bold' }).setOrigin(0, 0.5));
      if (en.sub) c.add(this.add.text(px + pad + 14, ry + 25, en.sub, { fontSize: '11px', color: '#889', wordWrap: { width: panelW - pad * 2 - 28 } }).setOrigin(0, 0.5));
      if (!en.disabled) {
        const z = this.add.zone(px + pad, ry, panelW - pad * 2, rowH).setOrigin(0, 0).setInteractive({ useHandCursor: true });
        z.on('pointerdown', () => { this.closeMenu(); en.onClick(); });
        c.add(z);
      }
      y += rowH + 6;
    });

    const by = py + pad + titleH + listH + 6;
    const backBg = this.add.graphics();
    backBg.fillStyle(0x3a2a2a, 0.95); backBg.fillRoundedRect(px + pad, by, panelW - pad * 2, backH, 8);
    backBg.lineStyle(1, 0xaa6666, 0.6); backBg.strokeRoundedRect(px + pad, by, panelW - pad * 2, backH, 8);
    c.add(backBg);
    c.add(this.add.text(px + panelW / 2, by + backH / 2, '← 返回', { fontSize: '15px', color: '#e0b0b0', fontStyle: 'bold' }).setOrigin(0.5));
    const bz = this.add.zone(px + pad, by, panelW - pad * 2, backH).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    bz.on('pointerdown', () => this.closeMenu());
    c.add(bz);

    this.menu = c;
    this.refreshButtons();
  }

  private closeMenu(): void {
    if (this.menu) { this.menu.destroy(true); this.menu = null; }
    this.menuOpen = false;
    this.refreshButtons();
  }

  private refreshButtons(): void {
    for (const b of Object.values(this.actionBtns)) b.setEnable(this.lastIsMyTurn && !this.menuOpen);
  }

  private flashMessage(text: string): void {
    const w = this.scale.width;
    const t = this.add.text(w / 2, 150, text, {
      fontSize: '16px', color: '#ffcc66', backgroundColor: '#000000aa', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(70);
    this.time.delayedCall(1000, () => t.destroy());
  }

  // ——— 渲染（完全由服务端状态驱动）———
  private renderState(): void {
    if (!this.room || !this.room.state) return;
    const s = this.room.state;

    const isMyTurn = s.currentTurn === this.mySessionId;
    const cur = s.players.get(s.currentTurn) || s.enemies.get(s.currentTurn);
    // 非我方回合或非战斗阶段：关闭残留弹层
    if ((!isMyTurn || s.phase !== 'combat') && this.menuOpen) this.closeMenu();
    this.lastIsMyTurn = isMyTurn;

    if (s.phase === 'combat') {
      this.turnText.setText(isMyTurn ? '★ 你的回合 — 选择行动' : `等待 ${cur?.name ?? ''} 行动…`);
      this.turnText.setColor(isMyTurn ? '#88ff88' : '#ffe8b0');
    } else {
      this.turnText.setText(`阶段：${s.phase}`);
      this.turnText.setColor('#aaaacc');
    }
    for (const b of Object.values(this.actionBtns)) b.setEnable(isMyTurn && !this.menuOpen);
    const me = s.players.get(this.mySessionId);
    if (this.mpText) this.mpText.setText(me ? `灵力 MP ${Math.max(0, Math.round(me.mp))} / ${Math.round(me.maxMp)}` : '');

    this.syncCards(this.playerCards, s.players, true);
    this.syncCards(this.enemyCards, s.enemies, false);

    const logs = (s.log as any[]) ?? [];
    this.logText.setText(logs.slice(-13).map((m: any) => `[${m.name}] ${m.text}`).join('\n'));

    if (s.phase === 'victory' || s.phase === 'defeat' || s.phase === 'fled') {
      const title = s.phase === 'victory' ? '胜 利 ！' : s.phase === 'defeat' ? '战 斗 失 败' : '脱 逃 成 功';
      this.showResult(title);
      // 地图怪模式：权威战斗结束 → 回写 GameScene（奖励结算 + 怪物 kill/unlock/复原），仅触发一次
      if (this.mode === 'map' && !this.endReported) {
        const gs = this.scene.get('GameScene') as any;
        if (gs && typeof gs.onMultiBattleEnd === 'function') {
          this.endReported = true;
          gs.onMultiBattleEnd(s.phase, this.monsterId, this.enemyData);
        }
      }
    }
  }

  private syncCards(map: Map<string, Card>, src: Map<string, any>, isPlayer: boolean): void {
    const list = [...(src as Map<string, any>).values()];
    const baseX = isPlayer ? this.scale.width * 0.28 : this.scale.width * 0.72;
    list.forEach((c: any, i: number) => {
      const id = c.sessionId || c.id;
      const y = 170 + i * 120;
      let card = map.get(id);
      if (!card) { card = this.makeCard(baseX, y, isPlayer); map.set(id, card); }
      card.name.setText(`${c.name}${c.alive ? '' : '（倒下）'}`);
      this.drawHpBar(card, c.hp, c.maxHp);
      card.root.setAlpha(c.alive ? 1 : 0.4);
    });
    for (const [id, card] of map) {
      if (![...src.values()].some((c: any) => (c.sessionId || c.id) === id)) {
        card.root.destroy();
        map.delete(id);
      }
    }
  }

  private makeCard(x: number, y: number, isPlayer: boolean): Card {
    const w = 380, h = 96;
    const root = this.add.container(x, y).setDepth(10);
    const bg = this.add.graphics();
    bg.fillStyle(isPlayer ? 0x16261a : 0x2a1616, 0.92);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
    bg.lineStyle(2, isPlayer ? 0x44aa44 : 0xaa4444, 0.8);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
    const barY = 28;
    const name = this.add.text(-w / 2 + 16, -h / 2 + 12, '', { fontSize: '16px', color: isPlayer ? '#aaffaa' : '#ffaaaa', fontStyle: 'bold' });
    const hpBar = this.add.graphics();
    const hpText = this.add.text(-w / 2 + 16, barY + 4, '', { fontSize: '12px', color: '#dddddd' });
    root.add([bg, name, hpBar, hpText]);
    return { root, name, hpBar, hpText };
  }

  private drawHpBar(card: Card, hp: number, maxHp: number): void {
    const w = 348, x = -174, y = 28;
    const ratio = maxHp > 0 ? Phaser.Math.Clamp(hp / maxHp, 0, 1) : 0;
    card.hpBar.clear();
    card.hpBar.fillStyle(0x000000, 0.6);
    card.hpBar.fillRect(x, y, w, 14);
    card.hpBar.fillStyle(ratio > 0.3 ? 0x44dd44 : 0xdd4444, 1);
    card.hpBar.fillRect(x, y, w * ratio, 14);
    card.hpBar.lineStyle(1, 0xffffff, 0.3);
    card.hpBar.strokeRect(x, y, w, 14);
    card.hpText.setText(`HP ${Math.max(0, Math.round(hp))} / ${Math.round(maxHp)}`);
  }

  private makeButton(x: number, y: number, label: string, color: number, cb: () => void, w = 200, h = 56): Button {
    const container = this.add.container(x, y).setDepth(20);
    const bg = this.add.graphics();
    const text = this.add.text(0, 0, label, { fontSize: '20px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);
    const draw = (enabled: boolean) => {
      bg.clear();
      bg.fillStyle(enabled ? color : 0x333344, 0.95);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
      bg.lineStyle(2, enabled ? 0xffffff : 0x555566, 0.6);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    };
    draw(true);
    container.add([bg, text]);
    container.setSize(w, h).setInteractive({ useHandCursor: true });
    container.on('pointerdown', () => cb());
    let enabled = true;
    return {
      container,
      setEnable: (b: boolean) => {
        if (b === enabled) return;
        enabled = b;
        draw(b);
        text.setColor(b ? '#ffffff' : '#888899');
        container.setAlpha(b ? 1 : 0.55);
      },
    };
  }

  private showResult(title: string): void {
    if (this.resultPanel) return;
    const w = this.scale.width, h = this.scale.height;
    const c = this.add.container(w / 2, h / 2).setDepth(50);
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.7);
    bg.fillRect(-w / 2, -h / 2, w, h);
    const panel = this.add.graphics();
    panel.fillStyle(0x1a1a2e, 0.98);
    panel.fillRoundedRect(-260, -170, 520, 340, 14);
    panel.lineStyle(2, 0xc9a96e, 0.8);
    panel.strokeRoundedRect(-260, -170, 520, 340, 14);
    const t = this.add.text(0, -90, title, {
      fontSize: '40px', color: title.includes('胜利') ? '#88ff88' : title.includes('脱') ? '#ffdd66' : '#ff8866', fontStyle: 'bold',
    }).setOrigin(0.5);
    const btn = this.add.text(0, 80, '返回地图', {
      fontSize: '22px', color: '#d4c5a0', padding: { x: 24, y: 10 }, backgroundColor: '#2a2a3e',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => btn.setColor('#ffe8b0'));
    btn.on('pointerout', () => btn.setColor('#d4c5a0'));
    btn.on('pointerdown', () => {
      c.destroy(true);
      this.resultPanel = null;
      this.intentionalLeave = true; // 主动离开，onLeave 不应再弹「连接断开」
      this.scene.stop();
    });
    c.add([bg, panel, t, btn]);
    this.resultPanel = c;
  }
}
