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

  // 副本战斗上下文：非零表示本场为某副本某阶战斗；returnScene 指定胜利后回写的场景
  private dungeonId = 0;
  private dungeonStage = 0;
  private dungeonRoomId = '';
  private returnScene = 'GameScene';

  // 进房携带的可用技能/鬼道/道具/玩家真实属性（服务端据其做权威校验与结算）
  private loadout: ClientLoadout = { skills: [], kidos: [], items: [] };

  // 子菜单 / 目标选择弹层
  private menu: Phaser.GameObjects.Container | null = null;
  private menuOpen = false;
  private lastIsMyTurn = false;

  // 待释放的单体意图（攻击 / 敌方单体技能 / 伤害型鬼道）：选中后不再弹选怪框，直接点敌人卡片释放
  private pendingAction: { type: string; id?: string } | null = null;

  // 20s 决策倒计时显示（截止时间来自服务端 schema.turnExpiresAt，自己/队友回合都显示）
  private turnCountdownText!: Phaser.GameObjects.Text;

  // 服务端权威战斗奖励（battleReward 消息），透传给 GameScene.onMultiBattleEnd 供结算报告
  private lastReward: { exp: number; gold: number; loot: string[]; leveled: boolean } | null = null;

  constructor() {
    super({ key: 'MultiBattleScene' });
  }

  init(data: { playerName?: string; mode?: 'vkey' | 'map'; enemyData?: any; enemyParty?: EnemyData[]; monsterId?: string; loadout?: ClientLoadout; dungeonId?: number; dungeonStage?: number; dungeonRoomId?: string; returnScene?: string }): void {
    this.playerName = data?.playerName || '玩家';
    this.mode = data?.mode || 'vkey';
    this.enemyData = data?.enemyData || null;
    this.enemyParty = data?.enemyParty || [];
    this.monsterId = data?.monsterId || '';
    this.loadout = data?.loadout || { skills: [], kidos: [], items: [] };
    this.dungeonId = data?.dungeonId || 0;
    this.dungeonStage = data?.dungeonStage || 0;
    this.dungeonRoomId = data?.dungeonRoomId || '';
    this.returnScene = data?.returnScene || 'GameScene';
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
    this.pendingAction = null;
    this.lastReward = null;
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

    // 20s 决策倒计时（由服务端 turnExpiresAt 驱动，覆盖自己与队友回合）
    this.turnCountdownText = this.add.text(w / 2, 138, '', { fontSize: '16px', color: '#ffcc66', fontStyle: 'bold' }).setOrigin(0.5).setDepth(10);
    this.time.addEvent({ delay: 200, loop: true, callback: () => this.updateCountdown() });

    // ESC：战斗中也可主动退出（返回副本/地图），避免卡死时无法退出
    this.input.keyboard!.on('keydown-ESC', () => {
      if (this.resultPanel) return;
      this.intentionalLeave = true;
      this.scene.stop();
    });

    this.connect();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.menu) { this.menu.destroy(true); this.menu = null; this.menuOpen = false; }
      if (this.room) { this.room.leave(); this.room = null; }
      // 恢复被本场战斗暂停的底层场景（地图 → GameScene；副本 → DungeonMapScene）
      if (this.scene.isPaused(this.returnScene)) this.scene.resume(this.returnScene);
    });
  }

  // ——— 连接权威战斗房间 ———
  private connect(): void {
    // 副本战斗：monsterId 用 `dungeon:ID:阶` 便于多人同阶同场（filterBy 同源隔离）
    const battleMonsterId = this.dungeonStage > 0 ? `dungeon:${this.dungeonId}:${this.dungeonStage}` : this.monsterId;
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

    // 连接超时兜底：joinOrCreate 既不 resolve 也不 reject（个别网络/浏览器）时，
    // 8s 后主动弹「无法连接」并返回，避免永久卡在「连接中…」
    const failTimer = this.time.delayedCall(8000, () => {
      if (!this.room) {
        console.warn('[battle] 连接超时（8s 未连上）');
        this.showResult('无法连接战斗服务器');
      }
    });

    // 副本模式：enterBattle 时若 DungeonRoom 尚未连上，dungeonRoomId 可能为空快照，
    // 导致胜利后 BattleRoom 找不到 DungeonRoom、阶不推进（旧 RACE bug）。
    // 此处从源场景实时读取已连接的 roomId：副本房连接在战斗场景启动前就已发起，几乎必然先连上，
    // 战斗房连接又多一轮往返，故此时读取基本必为有效值。以此封死 RACE，同时允许玩家即时进战斗（不再硬挡碰撞）。
    if (this.dungeonStage > 0 && this.returnScene) {
      const src = this.scene.get(this.returnScene) as any;
      if (src && src.dungeonRoomId) {
        this.dungeonRoomId = src.dungeonRoomId;
      }
    }

    getClient().joinOrCreate('battle', {
      name: this.playerName,
      // 传递游戏房(GameRoom) sessionId 作为稳定身份：BattleRoom 据此把奖励写入玩家本体世界，
      // 否则 Colyseus 每房间独立 sessionId 会导致奖励落到战斗房孤儿世界、玩家实际金币/经验不变。
      ownerSessionId: (this.scene.get('GameScene') as any)?.mySessionId || '',
      enemyData: this.enemyData ?? undefined,
      enemyParty: this.enemyParty,
      monsterId: battleMonsterId,
      loadout: serverLoadout,
      playerStats: this.loadout.playerStats,
      dungeonId: this.dungeonStage > 0 ? this.dungeonId : undefined,
      dungeonStage: this.dungeonStage > 0 ? this.dungeonStage : undefined,
      dungeonRoomId: this.dungeonStage > 0 ? this.dungeonRoomId : undefined,
    })
      .then((room: any) => {
        failTimer.remove();
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
        // 服务端权威战斗奖励（gold/exp/loot），供结算报告使用；若胜利已回写后再到，则刷新报告真实数值
        room.onMessage('battleReward', (r: any) => {
          this.lastReward = { exp: r?.exp ?? 0, gold: r?.gold ?? 0, loot: Array.isArray(r?.loot) ? r.loot : [], leveled: !!r?.leveled };
          if (this.endReported) {
            const target = this.scene.get(this.returnScene) as any;
            if (target && typeof target.onMultiBattleEnd === 'function') {
              target.onMultiBattleEnd('victory', this.monsterId, this.enemyData, this.lastReward);
            }
          }
        });
        this.renderState();
        // 单人自检：若 1.5s 内仍只有自己（无人组队），则主动开战，便于单窗口验证 UI
        this.time.delayedCall(1500, () => {
          if (this.room && this.room.state && this.room.state.phase === 'waiting') {
            this.room.send('startbattle');
          }
        });
        // 状态同步兜底：若 onStateChange 未推送初始状态（个别浏览器/网络抖动），
        // 3s 后若仍显示「连接中…」则强制重绘一次，避免画面卡在连接态。
        this.time.delayedCall(3000, () => {
          if (this.room && this.room.state && this.turnText && this.turnText.text === '连接中…') {
            console.warn('[battle] 初始状态未推送，强制重绘');
            this.renderState();
          }
        });
      })
      .catch((e: any) => {
        failTimer.remove();
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

  // ——— 攻击：单怪直接打；多怪设待释放意图，点敌人卡片释放 ———
  private onAttack(): void {
    if (!this.room || !this.room.state) return;
    const enemies = [...this.room.state.enemies.values()].filter((e: any) => e.alive);
    if (enemies.length === 1) this.send({ type: 'attack', targetId: enemies[0].id });
    else this.setPendingTarget('attack');
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
    if (tt === 'enemy') {
      const enemies = [...this.room.state.enemies.values()].filter((e: any) => e.alive);
      if (enemies.length === 1) this.send({ type: 'skill', id: sk.name, targetId: enemies[0].id });
      else this.setPendingTarget('skill', sk.name); // 多怪：点敌人卡片释放
    } else this.send({ type: 'skill', id: sk.name }); // self / ally / ally-all / enemy-all 无需选怪
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
    if (eff === 'damage' || eff === 'control') {
      const enemies = [...this.room.state.enemies.values()].filter((e: any) => e.alive);
      if (enemies.length === 1) this.send({ type: 'kido', id: k.id, targetId: enemies[0].id });
      else this.setPendingTarget('kido', k.id); // 多怪：点敌人卡片释放
    } else this.send({ type: 'kido', id: k.id }); // heal / revive / cleanse / shield 作用于自身或队友
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

  // ——— 目标选择：不再弹额外选怪框，改为高亮敌人、点击敌人卡片直接释放 ———
  private setPendingTarget(type: string, id?: string): void {
    if (!this.room || !this.room.state) return;
    const enemies = [...this.room.state.enemies.values()].filter((e: any) => e.alive);
    if (enemies.length === 0) return;
    this.pendingAction = { type, id };
    this.closeMenu();
    this.flashMessage('请点击要攻击的敌人');
    this.syncCards(this.enemyCards, this.room.state.enemies, false); // 刷新高亮
  }

  // 敌人卡片被点击：若有待释放意图则直接发送（全局适用：主场景与镜像场景共用此场景）
  private onEnemyCardClicked(enemyId: string): void {
    if (!this.pendingAction) return;
    if (!this.room || !this.room.state) return;
    if (this.room.state.phase !== 'combat' || this.room.state.currentTurn !== this.mySessionId) return;
    const action = { type: this.pendingAction.type, id: this.pendingAction.id, targetId: enemyId };
    this.pendingAction = null;
    this.send(action);
    this.syncCards(this.enemyCards, this.room.state.enemies, false); // 清除高亮
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

  /** 显示当前行动者（自己或队友）的 20s 决策倒计时，由服务端 turnExpiresAt 驱动。 */
  private updateCountdown(): void {
    if (!this.turnCountdownText) return;
    const s = this.room?.state;
    if (!s || s.phase !== 'combat' || !s.turnExpiresAt) { this.turnCountdownText.setText(''); return; }
    const remain = Math.max(0, (s.turnExpiresAt - Date.now()) / 1000);
    const secs = Math.ceil(remain);
    const cur = s.players.get(s.currentTurn);
    const who = cur?.name ?? '行动者';
    this.turnCountdownText.setText(`${who} 决策时间 ${secs}s`);
    this.turnCountdownText.setColor(secs <= 5 ? '#ff6666' : '#ffcc66');
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
      // 权威战斗结束 → 回写目标场景（地图怪回写 GameScene；副本回写 DungeonMapScene），仅触发一次
      if (!this.endReported) {
        const target = this.scene.get(this.returnScene) as any;
        if (target && typeof target.onMultiBattleEnd === 'function') {
          this.endReported = true;
          target.onMultiBattleEnd(s.phase, this.monsterId, this.enemyData, this.lastReward ?? undefined);
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
      if (!card) {
        card = this.makeCard(baseX, y, isPlayer);
        map.set(id, card);
        // 敌人卡片可点击：有待释放意图时点击直接释放（主/镜像场景共用本场景，全局生效）
        if (!isPlayer) {
          card.root.setSize(380, 96).setInteractive({ useHandCursor: true });
          card.root.on('pointerdown', () => this.onEnemyCardClicked(id));
        }
      }
      card.name.setText(`${c.name}${c.alive ? '' : '（倒下）'}`);
      this.drawHpBar(card, c.hp, c.maxHp);
      card.root.setAlpha(c.alive ? 1 : 0.4);
      // 高亮：多怪且有待释放意图时，存活敌人边框发光提示「点我释放」
      const highlight = !isPlayer && !!this.pendingAction && c.alive;
      card.hl.clear();
      if (highlight) {
        card.hl.lineStyle(3, 0xffe066, 1);
        card.hl.strokeRoundedRect(-190, -50, 380, 100, 10);
      }
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
    const hl = this.add.graphics(); // 待选目标高亮（默认隐藏）
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
    const btn = this.add.text(0, 80, this.returnScene === 'GameScene' ? '返回地图' : '返回副本', {
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
