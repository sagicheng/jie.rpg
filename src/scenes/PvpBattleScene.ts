/**
 * PVP 竞技场战斗场景（玩家 vs 玩家，1v1 / 4v4）。
 * 设计要点：
 *  - 同样是「只当渲染器」：发意图（action），状态全来自 pvp 房间（服务端权威）。
 *  - 对手是真·玩家（CombatPlayer，带 team），绝无怪物 AI / 逃跑。
 *  - 渲染：左为我方队伍、右为敌方队伍；攻击/敌方技能/伤害鬼道点敌方卡片释放，
 *    回复类技能/道具点我方卡片（或自身）释放。
 *  - 结算：服务端下发 arenaResult（胜负 + 积分变动 + 段位），展示后返回地图。
 */
import Phaser from 'phaser';
import { getClient } from '../net/Net';
import { SKILL_BY_NAME, getSkillTargetType, SkillData } from '../systems/Skills';
import { Kido, KidoNode } from '../systems/Kido';
import { Inventory } from '../systems/Inventory';
import type { Item } from '../systems/Inventory';

interface Card {
  root: Phaser.GameObjects.Container;
  name: Phaser.GameObjects.Text;
  hpBar: Phaser.GameObjects.Graphics;
  hpText: Phaser.GameObjects.Text;
  hl: Phaser.GameObjects.Graphics; // 待选目标高亮边框
}

interface Button {
  container: Phaser.GameObjects.Container;
  setEnable: (b: boolean) => void;
}

export interface ClientLoadout {
  skills: string[];
  kidos: KidoNode[];
  items: Item[];
}

interface MenuEntry {
  label: string;
  sub?: string;
  disabled?: boolean;
  onClick: () => void;
}

export class PvpBattleScene extends Phaser.Scene {
  private room: any = null;
  private mySessionId = '';
  private playerName = '勇者';
  private myTeam = 'A';
  private mode: '1v1' | '4v4' = '1v1';

  private allyCards: Map<string, Card> = new Map();   // 我方（含自己）
  private enemyCards: Map<string, Card> = new Map();  // 敌方
  private logText!: Phaser.GameObjects.Text;
  private turnText!: Phaser.GameObjects.Text;
  private actionBtns: Record<string, Button> = {};
  private mpText!: Phaser.GameObjects.Text;
  private resultPanel: Phaser.GameObjects.Container | null = null;

  private loadout: ClientLoadout = { skills: [], kidos: [], items: [] };
  private menu: Phaser.GameObjects.Container | null = null;
  private menuOpen = false;
  private pendingAction: { type: string; id?: string } | null = null;

  private lastActionSent = false;
  private lastRoundSeen = 0;
  private endReported = false;
  private intentionalLeave = false;
  private turnCountdownText!: Phaser.GameObjects.Text;

  private joinData: any = null;

  constructor() {
    super({ key: 'PvpBattleScene' });
  }

  init(data: { roomId?: string; token?: string; charId?: number; team?: string; gameSid?: string; playerName?: string; mode?: '1v1' | '4v4'; loadout?: ClientLoadout }): void {
    this.joinData = data;
    this.playerName = data?.playerName || '勇者';
    this.mode = data?.mode || '1v1';
    this.myTeam = data?.team || 'A';
    this.loadout = data?.loadout || { skills: [], kidos: [], items: [] };
    this.room = null;
    this.mySessionId = '';
    this.allyCards.clear();
    this.enemyCards.clear();
    this.resultPanel = null;
    this.menu = null;
    this.menuOpen = false;
    this.pendingAction = null;
    this.lastActionSent = false;
    this.lastRoundSeen = 0;
    this.endReported = false;
    this.intentionalLeave = false;
  }

  create(): void {
    const w = this.scale.width;
    const h = this.scale.height;

    this.add.rectangle(0, 0, w, h, 0x0a0a1e).setOrigin(0).setDepth(0);
    this.add.text(w / 2, 36, `PVP 竞技场 · ${this.mode === '4v4' ? '4v4 团战' : '1v1 决斗'}`, { fontSize: '26px', color: '#c9a96e', fontStyle: 'bold' }).setOrigin(0.5).setDepth(10);
    this.turnText = this.add.text(w / 2, 80, '连接中…', { fontSize: '18px', color: '#ffe8b0' }).setOrigin(0.5).setDepth(10);

    this.logText = this.add.text(60, h - 360, '', {
      fontSize: '14px', color: '#cccccc', wordWrap: { width: w - 120 }, lineSpacing: 4,
    }).setDepth(10);

    // 指令栏：攻击/技能/鬼道/道具/防御（PVP 无逃跑）
    const cmdDefs: { label: string; type: string; color: number; act: () => void }[] = [
      { label: '攻击', type: 'attack', color: 0x2e7d32, act: () => this.onAttack() },
      { label: '技能', type: 'skill', color: 0x1565c0, act: () => this.openSkillMenu() },
      { label: '鬼道', type: 'kido', color: 0x283593, act: () => this.openKidoMenu() },
      { label: '道具', type: 'item', color: 0xef6c00, act: () => this.openItemMenu() },
      { label: '防御', type: 'defend', color: 0x455a64, act: () => this.send({ type: 'defend' }) },
    ];
    const bw = 150, bh = 48, bgap = 8;
    const totalW = bw * cmdDefs.length + bgap * (cmdDefs.length - 1);
    const startX = (w - totalW) / 2 + bw / 2;
    const by = h - 70;
    cmdDefs.forEach((c, i) => {
      const bx = startX + i * (bw + bgap);
      this.actionBtns[c.type] = this.makeButton(bx, by, c.label, c.color, c.act, bw, bh);
    });
    this.mpText = this.add.text(w / 2, 110, '', { fontSize: '15px', color: '#88aaff' }).setOrigin(0.5).setDepth(10);
    this.turnCountdownText = this.add.text(w / 2, 138, '', { fontSize: '16px', color: '#ffcc66', fontStyle: 'bold' }).setOrigin(0.5).setDepth(10);
    this.time.addEvent({ delay: 200, loop: true, callback: () => this.updateCountdown() });

    this.input.keyboard!.on('keydown-ESC', () => {
      if (this.resultPanel) return;
      this.intentionalLeave = true;
      this.scene.stop();
    });

    this.connect();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.menu) { this.menu.destroy(true); this.menu = null; this.menuOpen = false; }
      if (this.room) { this.room.leave(); this.room = null; }
      // 恢复被本场战斗暂停的地图场景
      if (this.scene.isPaused('GameScene')) this.scene.resume('GameScene');
    });
  }

  private connect(): void {
    const jd = this.joinData;
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

    const failTimer = this.time.delayedCall(8000, () => {
      if (!this.room) this.showResult('无法连接竞技场服务器');
    });

    getClient().joinById(jd.roomId, {
      sid: jd.gameSid,
      token: jd.token,
      charId: jd.charId,
      team: jd.team,
      name: this.playerName,
      loadout: serverLoadout,
    })
      .then((room: any) => {
        failTimer.remove();
        this.room = room;
        this.mySessionId = room.sessionId;
        const myRoom = room;
        room.onStateChange(() => this.renderState());
        room.onLeave(() => {
          if (this.room !== myRoom) return;
          if (this.intentionalLeave) return;
          if (this.resultPanel) return;
          this.showResult('连接断开');
        });
        room.onMessage('system', () => {});
        // 服务端权威结算：胜负 + 积分变动 + 段位
        room.onMessage('arenaResult', (r: any) => this.onArenaResult(r));
        this.renderState();
      })
      .catch((e: any) => {
        failTimer.remove();
        console.error('[pvp] 连接失败', e);
        this.showResult('无法连接竞技场服务器');
      });
  }

  private send(action: { type: string; id?: string; targetId?: string }): void {
    if (!this.room || !this.room.state) return;
    if (this.room.state.phase !== 'combat') return;
    if (this.room.state.roundPhase !== 'command') return;
    if (this.lastActionSent) return;
    this.lastActionSent = true;
    this.room.send('action', action);
    this.renderState();
  }

  // ——— 攻击：单敌直接打；多敌设待释放意图，点敌人卡片释放 ———
  private onAttack(): void {
    if (!this.room || !this.room.state) return;
    const enemies = [...this.room.state.players.values()].filter((p: any) => p.alive && p.team !== this.myTeam);
    if (enemies.length === 1) this.send({ type: 'attack', targetId: enemies[0].sessionId });
    else this.setPendingTarget('attack');
  }

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
    if (tt === 'enemy') {
      const enemies = [...this.room.state.players.values()].filter((p: any) => p.alive && p.team !== this.myTeam);
      if (enemies.length === 1) this.send({ type: 'skill', id: sk.name, targetId: enemies[0].sessionId });
      else this.setPendingTarget('skill', sk.name);
    } else this.send({ type: 'skill', id: sk.name }); // self / ally / ally-all / enemy-all 无需选怪
  }

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
    if (eff === 'damage' || eff === 'control') {
      const enemies = [...this.room.state.players.values()].filter((p: any) => p.alive && p.team !== this.myTeam);
      if (enemies.length === 1) this.send({ type: 'kido', id: k.id, targetId: enemies[0].sessionId });
      else this.setPendingTarget('kido', k.id);
    } else this.send({ type: 'kido', id: k.id }); // heal / revive / cleanse / shield 由服务端选最低血队友
  }

  private openItemMenu(): void {
    if (this.loadout.items.length === 0) { this.flashMessage('没有可用道具'); return; }
    const entries: MenuEntry[] = this.loadout.items.map((it) => ({
      label: `道具·${it.name}`,
      sub: it.desc,
      onClick: () => this.setPendingTarget('item', it.id),
    }));
    this.openList('使用道具（再选目标）', entries);
  }

  private setPendingTarget(type: string, id?: string): void {
    if (!this.room || !this.room.state) return;
    this.pendingAction = { type, id };
    this.closeMenu();
    this.flashMessage(type === 'item' ? '请点击目标（自己或队友）' : '请点击要攻击的敌人');
    const s = this.room.state;
    this.syncCards(this.enemyCards, [...s.players.values()].filter((p: any) => p.team !== this.myTeam), false);
    this.syncCards(this.allyCards, [...s.players.values()].filter((p: any) => p.team === this.myTeam), true);
  }

  private onEnemyCardClicked(enemyId: string): void {
    if (!this.pendingAction) return;
    if (!this.room || !this.room.state) return;
    if (this.room.state.phase !== 'combat' || this.room.state.roundPhase !== 'command' || this.lastActionSent) return;
    const action = { type: this.pendingAction.type, id: this.pendingAction.id, targetId: enemyId };
    this.pendingAction = null;
    this.send(action);
    this.syncCards(this.enemyCards, [...this.room.state.players.values()].filter((p: any) => p.team !== this.myTeam), false);
  }

  private onAllyCardClicked(allyId: string): void {
    if (!this.pendingAction || this.pendingAction.type !== 'item') return;
    if (!this.room || !this.room.state) return;
    if (this.room.state.phase !== 'combat' || this.room.state.roundPhase !== 'command' || this.lastActionSent) return;
    const action = { type: 'item', id: this.pendingAction.id, targetId: allyId };
    this.pendingAction = null;
    this.send(action);
    this.syncCards(this.allyCards, [...this.room.state.players.values()].filter((p: any) => p.team === this.myTeam), true);
  }

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
    if (!this.room || !this.room.state) return;
    const s = this.room.state;
    const btnEnable = s.phase === 'combat' && s.roundPhase === 'command' && !this.lastActionSent && !this.menuOpen;
    for (const b of Object.values(this.actionBtns)) b.setEnable(btnEnable);
  }

  private flashMessage(text: string): void {
    const w = this.scale.width;
    const t = this.add.text(w / 2, 150, text, {
      fontSize: '16px', color: '#ffcc66', backgroundColor: '#000000aa', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(70);
    this.time.delayedCall(1000, () => t.destroy());
  }

  private updateCountdown(): void {
    if (!this.turnCountdownText) return;
    const s = this.room?.state;
    if (!s || s.phase !== 'combat' || s.roundPhase !== 'command' || !s.roundExpiresAt) {
      this.turnCountdownText.setText(''); return;
    }
    const remain = Math.max(0, (s.roundExpiresAt - Date.now()) / 1000);
    const secs = Math.ceil(remain);
    this.turnCountdownText.setText(`指令选择 剩余 ${secs}s`);
    this.turnCountdownText.setColor(secs <= 5 ? '#ff6666' : '#ffcc66');
  }

  private renderState(): void {
    if (!this.room || !this.room.state) return;
    const s = this.room.state;

    const inCombat = s.phase === 'combat';
    const inCommand = inCombat && s.roundPhase === 'command';
    const inExecute = inCombat && s.roundPhase === 'execute';

    if (inCommand && this.lastActionSent && this.lastRoundSeen !== s.round) {
      this.lastActionSent = false;
    }
    this.lastRoundSeen = s.round;

    if ((!inCommand || this.lastActionSent) && this.menuOpen) this.closeMenu();

    if (inCommand) {
      this.turnText.setText(this.lastActionSent ? '已选择，等待执行…' : '★ 选择指令');
      this.turnText.setColor(this.lastActionSent ? '#ffe8b0' : '#88ff88');
    } else if (inExecute) {
      const cur = s.players.get(s.currentTurn);
      this.turnText.setText(`执行中 — ${cur?.name ?? ''} 行动`);
      this.turnText.setColor('#aaaacc');
    } else {
      this.turnText.setText(`阶段：${s.phase}`); this.turnText.setColor('#aaaacc');
    }

    const btnEnable = inCommand && !this.lastActionSent && !this.menuOpen;
    for (const b of Object.values(this.actionBtns)) b.setEnable(btnEnable);

    const me = s.players.get(this.mySessionId);
    if (this.mpText) this.mpText.setText(me ? `灵力 MP ${Math.max(0, Math.round(me.mp))} / ${Math.round(me.maxMp)}` : '');

    const players: any[] = [...s.players.values()];
    this.syncCards(this.allyCards, players.filter((p) => p.team === this.myTeam), true);
    this.syncCards(this.enemyCards, players.filter((p) => p.team !== this.myTeam), false);

    const logs = (s.log as any[]) ?? [];
    this.logText.setText(logs.slice(-13).map((m: any) => `[${m.name}] ${m.text}`).join('\n'));

    if (s.phase === 'victory') {
      // 胜负由 arenaResult 权威下发，这里仅兜底防止卡死（若未收到 arenaResult）
      if (!this.endReported) this.showResult('战斗结束');
    }
  }

  private syncCards(map: Map<string, Card>, list: any[], isAlly: boolean): void {
    const baseX = isAlly ? this.scale.width * 0.28 : this.scale.width * 0.72;
    list.forEach((c: any, i: number) => {
      const id = c.sessionId;
      const y = 170 + i * 120;
      let card = map.get(id);
      if (!card) {
        card = this.makeCard(baseX, y, isAlly);
        map.set(id, card);
        if (!isAlly) {
          card.root.setSize(380, 96).setInteractive({ useHandCursor: true });
          card.root.on('pointerdown', () => this.onEnemyCardClicked(id));
        } else {
          card.root.setSize(380, 96);
        }
      }
      // 我方卡片在「用道具选目标」时可点击
      if (isAlly && this.pendingAction && this.pendingAction.type === 'item') {
        card.root.setInteractive({ useHandCursor: true });
        card.root.off('pointerdown');
        card.root.on('pointerdown', () => this.onAllyCardClicked(id));
      } else if (isAlly) {
        card.root.disableInteractive();
      }
      card.name.setText(`${c.name}${c.team === this.myTeam ? '（我方）' : ''}${c.alive ? '' : '（倒下）'}`);
      this.drawHpBar(card, c.hp, c.maxHp);
      card.root.setAlpha(c.alive ? 1 : 0.4);
      const highlight = !isAlly && !!this.pendingAction && c.alive;
      card.hl.clear();
      if (highlight) {
        card.hl.lineStyle(3, 0xffe066, 1);
        card.hl.strokeRoundedRect(-190, -50, 380, 100, 10);
      }
    });
    for (const [id, card] of map) {
      if (!list.some((c: any) => c.sessionId === id)) {
        card.root.destroy();
        map.delete(id);
      }
    }
  }

  private makeCard(x: number, y: number, isAlly: boolean): Card {
    const w = 380, h = 96;
    const root = this.add.container(x, y).setDepth(10);
    const bg = this.add.graphics();
    bg.fillStyle(isAlly ? 0x16261a : 0x2a1616, 0.92);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
    bg.lineStyle(2, isAlly ? 0x44aa44 : 0xaa4444, 0.8);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
    const name = this.add.text(-w / 2 + 16, -h / 2 + 12, '', { fontSize: '16px', color: isAlly ? '#aaffaa' : '#ffaaaa', fontStyle: 'bold' });
    const hpBar = this.add.graphics();
    const hpText = this.add.text(-w / 2 + 16, 28 + 4, '', { fontSize: '12px', color: '#dddddd' });
    const hl = this.add.graphics();
    root.add([bg, name, hpBar, hpText, hl]);
    return { root, name, hpBar, hpText, hl };
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

  /** 服务端权威结算结果（胜负 + 积分 + 段位）。 */
  private onArenaResult(r: any): void {
    if (this.endReported) return;
    this.endReported = true;
    const won = !!r.won;
    const delta = r.pointsDelta || 0;
    const points = r.points || 0;
    const tier = r.tierName || '';
    const promoted = !!r.promoted;
    this.showResult(
      won ? '胜 利 ！' : '战 斗 失 败',
      `积分 ${delta >= 0 ? '+' : ''}${delta}  →  ${points}\n当前段位：${tier}${promoted ? '（升段！）' : ''}`,
    );
  }

  private showResult(title: string, sub = ''): void {
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
    const t = this.add.text(0, -100, title, {
      fontSize: '40px', color: title.includes('胜利') ? '#88ff88' : '#ff8866', fontStyle: 'bold',
    }).setOrigin(0.5);
    if (sub) c.add(this.add.text(0, -20, sub, { fontSize: '18px', color: '#ffe8b0', align: 'center', lineSpacing: 6 }).setOrigin(0.5));
    const btn = this.add.text(0, 90, '返回地图', {
      fontSize: '22px', color: '#d4c5a0', padding: { x: 24, y: 10 }, backgroundColor: '#2a2a3e',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => btn.setColor('#ffe8b0'));
    btn.on('pointerout', () => btn.setColor('#d4c5a0'));
    btn.on('pointerdown', () => {
      c.destroy(true);
      this.resultPanel = null;
      this.intentionalLeave = true;
      this.scene.stop();
    });
    c.add([bg, panel, t, btn]);
    this.resultPanel = c;
  }
}
