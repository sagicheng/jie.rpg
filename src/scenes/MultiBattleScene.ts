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
import { getClient } from '../core/Net';
import { SKILL_BY_NAME, getSkillTargetType, SkillData } from '../managers/Skills';
import { Kido, KidoNode } from '../managers/Kido';
import { Inventory } from '../managers/Inventory';
import type { Item } from '../managers/Inventory';
import type { EnemyData } from '../managers/BattleData';
import { PET_SKILLS_CLIENT } from '../managers/PetSystem';

interface Card {
  root: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;  // 卡片底色（灵宠卡片重绘为紫调）
  name: Phaser.GameObjects.Text;
  hpBar: Phaser.GameObjects.Graphics;
  hpText: Phaser.GameObjects.Text;
  hl: Phaser.GameObjects.Graphics; // 待选目标高亮边框
  statusIcons: Phaser.GameObjects.GameObject[]; // 异常状态 PNG 图标 + 回合数（每帧重绘）
}

interface Button {
  container: Phaser.GameObjects.Container;
  setEnable: (b: boolean) => void;
  setVisible: (b: boolean) => void;
}

export interface ClientLoadout {
  skills: string[];
  kidos: KidoNode[];
  items: Item[];
  playerStats?: { hp?: number; maxHp?: number; mp?: number; maxMp?: number; atk?: number; def?: number; matk?: number; mdef?: number; spd?: number };
  /** 出战灵宠战斗 DTO（v1.1 战斗协同）；undefined = 无宠。 */
  pet?: { name?: string; speciesId?: string; element?: string; quality?: string; level?: number; stats?: any; mp?: number; maxMp?: number; skills?: string[] };
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
  private petActionBtns: Record<string, Button> = {};
  private nextBtn!: Button;
  private backBtn!: Button;
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
  private isTeamPull = false;
  private ownerSessionId = '';          // GameRoom sessionId（用于奖励写回正确世界）
  private lastRoundSeen = 0;             // 上次看到的回合号（切轮时重置 submittedActors）

  // 进房携带的可用技能/鬼道/道具/玩家真实属性（服务端据其做权威校验与结算）
  private loadout: ClientLoadout = { skills: [], kidos: [], items: [] };

  // 出战灵宠（v1.1 战斗协同）：随负载下发；宠物作为同一客户端的第二战斗员（SID = mySessionId+':pet'）
  private pet: ClientLoadout['pet'] = undefined;
  private petSid = '';
  /** 本轮已提交指令的战斗员 SID 集合（人物 / 宠物分别守卫）。 */
  private submittedActors: Set<string> = new Set();

  // —— 两步固定选择（梦幻/飘流式）：先人物、后灵宠 ——
  /** 0=非指令阶段；1=人物指令阶段；2=灵宠指令阶段 */
  private commandStep: 0 | 1 | 2 = 0;
  /** 已暂存（本地）未上报的人物/灵宠指令；两步都确定后一起上报服务端 */
  private stagedChar: { type: string; id?: string; targetId?: string } | null = null;
  private stagedPet: { type: string; id?: string; targetId?: string } | null = null;
  /** 待选目标：某 actor 已确定动作类型，等待点卡片选目标（多怪/选目标时） */
  private pendingTarget: { actor: 'char' | 'pet'; type: string; id?: string } | null = null;

  /** 诊断标记：renderState 首帧是否已打印 players 快照 */
  private _diagPlayersLogged = false;

  // 子菜单 / 目标选择弹层
  private menu: Phaser.GameObjects.Container | null = null;
  private menuOpen = false;

  // 20s 决策倒计时显示（截止时间来自服务端 schema.turnExpiresAt，自己/队友回合都显示）
  private turnCountdownText!: Phaser.GameObjects.Text;

  // 服务端权威战斗奖励（battleReward 消息），透传给 GameScene.onMultiBattleEnd 供结算报告
  private lastReward: { exp: number; gold: number; loot: string[]; leveled: boolean } | null = null;

  constructor() {
    super({ key: 'MultiBattleScene' });
  }

  init(data: { playerName?: string; mode?: 'vkey' | 'map'; enemyData?: any; enemyParty?: EnemyData[]; monsterId?: string; loadout?: ClientLoadout; dungeonId?: number; dungeonStage?: number; dungeonRoomId?: string; returnScene?: string; isTeamPull?: boolean; ownerSessionId?: string }): void {
    this.playerName = data?.playerName || '玩家';
    this.mode = data?.mode || 'vkey';
    this.enemyData = data?.enemyData || null;
    this.enemyParty = data?.enemyParty || [];
    this.monsterId = data?.monsterId || '';
    this.loadout = data?.loadout || { skills: [], kidos: [], items: [] };
    this.pet = this.loadout.pet;
    this.petSid = '';
    this.submittedActors.clear();
    this.commandStep = 0;
    this.stagedChar = null;
    this.stagedPet = null;
    this.pendingTarget = null;
    this._diagPlayersLogged = false;
    this.dungeonId = data?.dungeonId || 0;
    this.dungeonStage = data?.dungeonStage || 0;
    this.dungeonRoomId = data?.dungeonRoomId || '';
    this.returnScene = data?.returnScene || 'GameScene';
    this.isTeamPull = data?.isTeamPull || false;
    this.ownerSessionId = data?.ownerSessionId || '';
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
    this.lastReward = null;
  }

  create(): void {
    const w = this.scale.width;
    const h = this.scale.height;

    this.add.rectangle(0, 0, w, h, 0x0a0a1e).setOrigin(0).setDepth(0);
    this.add.text(w / 2, 36, '联机权威战斗', { fontSize: '28px', color: '#c9a96e', fontStyle: 'bold' }).setOrigin(0.5).setDepth(10);
    this.turnText = this.add.text(w / 2, 80, '连接中…', { fontSize: '18px', color: '#ffe8b0' }).setOrigin(0.5).setDepth(10);

    // 战斗信息播报：移到右下角，避免与 GameScene chatHud（左下）+ 血蓝UI（顶部中央）冲突
    const logW = 420, logH = 240;
    this.logText = this.add.text(w - logW - 20, h - logH - 100, '', {
      fontSize: '13px', color: '#cccccc', wordWrap: { width: logW }, lineSpacing: 3,
      backgroundColor: '#0a0a1acc', padding: { x: 8, y: 6 },
    }).setDepth(10);

    // 战斗信息播报已移至右下角，与左下角 chatHud 不重叠，故保留聊天 HUD 可见（用户要求）。

    // ——— 两步固定选择指令栏（梦幻/飘流式：先人物 6 项，后灵宠 3 项）———
    const by = h - 70;
    const bw = 140, bh = 48, bgap = 6;

    // STEP1 人物指令（6 项）
    const charDefs: { label: string; type: string; color: number; act: () => void }[] = [
      { label: '攻击', type: 'attack', color: 0x2e7d32, act: () => this.onCharAttack() },
      { label: '技能', type: 'skill', color: 0x1565c0, act: () => this.openSkillMenu() },
      { label: '鬼道', type: 'kido', color: 0x283593, act: () => this.openKidoMenu() },
      { label: '道具', type: 'item', color: 0xef6c00, act: () => this.openItemMenu() },
      { label: '防御', type: 'defend', color: 0x455a64, act: () => this.stageChar({ type: 'defend' }) },
      { label: '逃跑', type: 'escape', color: 0xc62828, act: () => this.stageChar({ type: 'escape' }) },
    ];
    const charTotalW = bw * charDefs.length + bgap * (charDefs.length - 1);
    const charStartX = (w - charTotalW) / 2 + bw / 2;
    charDefs.forEach((c, i) => {
      const bx = charStartX + i * (bw + bgap);
      this.actionBtns[c.type] = this.makeButton(bx, by, c.label, c.color, c.act, bw, bh);
    });

    // STEP2 灵宠指令（3 项：攻击 / 宠物技能 / 防御）
    const petDefs: { label: string; color: number; act: () => void }[] = [
      { label: '🐾攻击', color: 0x2e7d32, act: () => this.onPetAttack() },
      { label: '✨宠物技能', color: 0x8a5cff, act: () => this.openPetSkillMenu() },
      { label: '🛡防御', color: 0x455a64, act: () => this.stagePet({ type: 'defend' }) },
    ];
    const petTotalW = bw * petDefs.length + bgap * (petDefs.length - 1);
    const petStartX = (w - petTotalW) / 2 + bw / 2;
    petDefs.forEach((c, i) => {
      const bx = petStartX + i * (bw + bgap);
      this.petActionBtns[c.label] = this.makeButton(bx, by, c.label, c.color, c.act, bw, bh);
    });

    // 阶段切换按钮：STEP1「▶ 下一步(指挥灵宠)」、STEP2「← 返回改人物」
    this.nextBtn = this.makeButton(w - 95, by, '▶ 下一步', 0x5c6bc0, () => this.advanceAfterChar(), 130, bh);
    this.backBtn = this.makeButton(95, by, '← 返回', 0x8a5cff, () => this.goBackToChar(), 120, bh);
    this.mpText = this.add.text(w / 2, 110, '', { fontSize: '15px', color: '#88aaff' }).setOrigin(0.5).setDepth(10);

    // 20s 决策倒计时（由服务端 turnExpiresAt 驱动，覆盖自己与队友回合）
    this.turnCountdownText = this.add.text(w / 2, 138, '', { fontSize: '16px', color: '#ffcc66', fontStyle: 'bold' }).setOrigin(0.5).setDepth(10);
    this.time.addEvent({ delay: 200, loop: true, callback: () => this.updateCountdown() });

    // ESC：战斗中也可主动退出（返回副本/地图），避免卡死时无法退出
    this.input.keyboard!.on('keydown-ESC', () => {
      if (this.resultPanel) return;
      this.intentionalLeave = true;
      this.broadcastTeamExit();      // 队长主动退出 → 广播全队一起退出战斗
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
        // 缚道(control)必带 statusEffect；破道(damage)按配置可选携带
        statusEffect: (k.effect as any).subtype
          ? { subtype: (k.effect as any).subtype, turns: (k.effect as any).turns, rate: (k.effect as any).rate }
          : undefined,
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

    console.log('[MultiBattleScene] 📦 sending pet DTO to battle room:', JSON.stringify(this.loadout.pet));
    getClient().joinOrCreate('battle', {
      name: this.playerName,
      // 传递游戏房(GameRoom) sessionId 作为稳定身份：BattleRoom 据此把奖励写入玩家本体世界，
      // 否则 Colyseus 每房间独立 sessionId 会导致奖励落到战斗房孤儿世界、玩家实际金币/经验不变。
      ownerSessionId: this.ownerSessionId,
      enemyData: this.enemyData ?? undefined,
      enemyParty: this.enemyParty,
      monsterId: battleMonsterId,
      loadout: serverLoadout,
      playerStats: this.loadout.playerStats,
      dungeonId: this.dungeonStage > 0 ? this.dungeonId : undefined,
      dungeonStage: this.dungeonStage > 0 ? this.dungeonStage : undefined,
      dungeonRoomId: this.dungeonStage > 0 ? this.dungeonRoomId : undefined,
      // 出战灵宠 DTO（v1.1 战斗协同）：服务端据此生成宠物战斗员
      pet: this.loadout.pet,
    })
      .then((room: any) => {
        failTimer.remove();
        this.room = room;
        this.mySessionId = room.sessionId;
        this.petSid = this.mySessionId + ':pet';
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
        // 服务端构建信息：在浏览器 console 显示服务端启动时间，确认是否为最新构建
        room.onMessage('serverInfo', (data: any) => {
          console.log('[ServerInfo] buildTime=', data?.buildTime, 'statusSystem=', data?.statusSystem,
            '（若 buildTime 不是你最近一次 npm run dev 的时间 → 服务端是旧进程，状态系统不生效）');
        });
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
        // 组队战斗：只有触发者(撞怪的人)负责发 startbattle，被拉进来的队员静默等待
        if (!this.isTeamPull) {
          // 延长等待到 3s，给其他队员时间 joinOrCreate 进入 BattleRoom
          this.time.delayedCall(3000, () => {
            if (this.room && this.room.state && this.room.state.phase === 'waiting') {
              this.room.send('startbattle');
            }
          });
        }
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

  /** 发送意图（仅指令阶段可发；人物/宠物各自每轮限1次，按 actorSid 分别守卫）。 */
  private send(action: { type: string; id?: string; targetId?: string }, actorSid?: string): void {
    if (!this.room || !this.room.state) return;
    if (this.room.state.phase !== 'combat') return;
    if (this.room.state.roundPhase !== 'command') return;
    const aid = actorSid || this.mySessionId;
    if (this.submittedActors.has(aid)) return;
    this.submittedActors.add(aid);
    // 诊断：技能/鬼道/宠技派发时打印（浏览器 console），确认指令是否真正发出
    if (action.type === 'skill' || action.type === 'kido' || action.type === 'petSkill') {
      console.log(`[Skill.dispatch] type=${action.type} id=${action.id || ''} targetId=${action.targetId || ''}`);
    }
    this.room.send('action', { ...action, actorSid: aid });
    // 立即刷新 UI：显示"已选择，等待执行…"（Colyseus 消息不触发 onStateChange）
    this.renderState();
  }

  // ——— 两步选择辅助：暂存与上报 ———
  private petAlive(): boolean {
    if (!this.pet || !this.room?.state) return false;
    const petp = this.room.state.players.get(this.petSid);
    return !!petp && petp.alive;
  }
  private stageChar(a: { type: string; id?: string; targetId?: string }): void {
    this.stagedChar = a;
    this.advanceAfterChar();
  }
  private stagePet(a: { type: string; id?: string; targetId?: string }): void {
    this.stagedPet = a;
    this.advanceAfterPet();
  }
  private advanceAfterChar(): void {
    if (!this.stagedChar) return;
    if (this.petAlive()) this.commandStep = 2;
    else this.submitAll();
    this.refreshButtons();
    this.renderState();
  }
  private advanceAfterPet(): void {
    if (!this.stagedPet) return;
    this.submitAll();
  }
  private submitAll(): void {
    if (this.stagedChar) this.send({ type: this.stagedChar.type, id: this.stagedChar.id, targetId: this.stagedChar.targetId }, this.mySessionId);
    if (this.stagedPet) this.send({ type: this.stagedPet.type, id: this.stagedPet.id, targetId: this.stagedPet.targetId }, this.petSid);
    this.commandStep = 0;
    this.stagedChar = null;
    this.stagedPet = null;
    this.pendingTarget = null;
    this.refreshButtons();
  }
  private goBackToChar(): void {
    if (this.commandStep !== 2) return;
    this.commandStep = 1;
    this.stagedPet = null;
    this.pendingTarget = null;
    this.refreshButtons();
    this.renderState();
  }

  // ——— 人物：攻击（单怪直接暂存；多怪进待选目标）———
  private onCharAttack(): void {
    if (!this.room || !this.room.state) return;
    const enemies = [...this.room.state.enemies.values()].filter((e: any) => e.alive);
    if (enemies.length === 1) this.stageChar({ type: 'attack', targetId: enemies[0].id });
    else this.armTarget('char', 'attack');
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
      if (enemies.length === 1) this.stageChar({ type: 'skill', id: sk.name, targetId: enemies[0].id });
      else this.armTarget('char', 'skill', sk.name); // 多怪：点敌人卡片释放
    } else this.stageChar({ type: 'skill', id: sk.name }); // self / ally / ally-all / enemy-all 无需选怪
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
      if (enemies.length === 1) this.stageChar({ type: 'kido', id: k.id, targetId: enemies[0].id });
      else this.armTarget('char', 'kido', k.id); // 多怪：点敌人卡片释放
    } else this.stageChar({ type: 'kido', id: k.id }); // heal / revive / cleanse / shield 作用于自身或队友
  }

  // ——— 道具子菜单（选道具→选目标，可对队友使用）———
  private openItemMenu(): void {
    if (this.loadout.items.length === 0) { this.flashMessage('没有可用道具'); return; }
    const entries: MenuEntry[] = this.loadout.items.map((it) => ({
      label: `道具·${it.name}`,
      sub: it.desc,
      onClick: () => this.armTarget('char', 'item', it.id),
    }));
    this.openList('使用道具（再选目标）', entries);
  }

  // ——— 灵宠：攻击（单怪直接暂存；多怪进待选目标）———
  private onPetAttack(): void {
    if (!this.room || !this.room.state) return;
    const enemies = [...this.room.state.enemies.values()].filter((e: any) => e.alive);
    if (enemies.length === 1) this.stagePet({ type: 'attack', targetId: enemies[0].id });
    else this.armTarget('pet', 'attack');
  }

  private openPetSkillMenu(): void {
    if (!this.pet) { this.flashMessage('没有出战灵宠'); return; }
    const skills = Array.isArray(this.pet.skills) ? this.pet.skills : [];
    if (skills.length === 0) { this.flashMessage('灵宠没有可用技能'); return; }
    const petp = this.room?.state?.players?.get(this.petSid);
    const entries: MenuEntry[] = skills.map((sid: string) => {
      const sk = PET_SKILLS_CLIENT[sid];
      const mp = (petp?.mp ?? 0);
      const can = (petp?.maxMp ?? 0) > 0; // 灵力不足时服务端会自动转普攻，此处仅提示
      return {
        label: `✨ ${sk?.name || sid}${can ? '' : '（灵力不足→普攻）'}`,
        sub: sk?.desc || '',
        disabled: false,
        onClick: () => this.onPickPetSkill(sid),
      };
    });
    this.openList('灵宠技能', entries);
  }

  private onPickPetSkill(skillId: string): void {
    if (!this.room || !this.room.state) return;
    const enemies = [...this.room.state.enemies.values()].filter((e: any) => e.alive);
    if (enemies.length === 1) this.stagePet({ type: 'petSkill', id: skillId, targetId: enemies[0].id });
    else this.armTarget('pet', 'petSkill', skillId);
  }

  // ——— 待选目标：某 actor 已确定动作类型，等待点卡片选目标 ———
  private armTarget(actor: 'char' | 'pet', type: string, id?: string): void {
    if (!this.room || !this.room.state) return;
    this.pendingTarget = { actor, type, id };
    this.closeMenu();
    if (type === 'item') this.flashMessage('请点击目标（自己或队友）');
    else {
      const enemies = [...this.room.state.enemies.values()].filter((e: any) => e.alive);
      if (enemies.length === 0) return;
      this.flashMessage('请点击要攻击的敌人');
    }
    // 重绘：敌人高亮 + 玩家卡片可点击
    const s = this.room.state;
    this.syncCards(this.enemyCards, s.enemies, false);
    this.syncCards(this.playerCards, s.players, true);
  }

  // 敌人卡片被点击：若有待选目标则暂存为对应 actor 的指令
  private onEnemyCardClicked(enemyId: string): void {
    if (!this.pendingTarget) return;
    if (!this.room || !this.room.state) return;
    if (this.room.state.phase !== 'combat' || this.room.state.roundPhase !== 'command') return;
    const pt = this.pendingTarget;
    const action = { type: pt.type, id: pt.id, targetId: enemyId };
    this.pendingTarget = null;
    if (pt.actor === 'char') this.stageChar(action);
    else this.stagePet(action);
    this.syncCards(this.enemyCards, this.room.state.enemies, false); // 清除高亮
  }

  // 玩家卡片被点击：道具选目标（对自己或队友使用）
  private onPlayerCardClicked(playerId: string): void {
    if (!this.pendingTarget || this.pendingTarget.type !== 'item') return;
    if (!this.room || !this.room.state) return;
    if (this.room.state.phase !== 'combat' || this.room.state.roundPhase !== 'command') return;
    const pt = this.pendingTarget;
    const action = { type: pt.type, id: pt.id, targetId: playerId };
    this.pendingTarget = null;
    if (pt.actor === 'char') this.stageChar(action);
    else this.stagePet(action);
    const s = this.room.state;
    this.syncCards(this.enemyCards, s.enemies, false);
    this.syncCards(this.playerCards, s.players, true);
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
    // 两步固定选择：按钮可见性/可用性完全由 commandStep 驱动
    if (!this.room || !this.room.state) return;
    const s = this.room.state;
    const inCommand = s.phase === 'combat' && s.roundPhase === 'command';

    // STEP1：仅人物 6 按钮可见/可点（无待选目标时）
    const charVisible = this.commandStep === 1;
    for (const b of Object.values(this.actionBtns)) {
      b.setVisible(charVisible);
      b.setEnable(charVisible && inCommand && !this.pendingTarget && !this.menuOpen);
    }
    // STEP2：仅灵宠 3 按钮可见/可点
    const petVisible = this.commandStep === 2;
    for (const b of Object.values(this.petActionBtns)) {
      b.setVisible(petVisible);
      b.setEnable(petVisible && inCommand && !this.pendingTarget && !this.menuOpen);
    }
    // 「▶ 下一步（指挥灵宠）」：STEP1 且人物已选（含返回后重进）
    this.nextBtn.setVisible(this.commandStep === 1 && !!this.pet && !!this.stagedChar);
    this.nextBtn.setEnable(this.commandStep === 1 && !!this.stagedChar && inCommand && !this.pendingTarget);
    // 「← 返回改人物」：STEP2
    this.backBtn.setVisible(this.commandStep === 2);
    this.backBtn.setEnable(this.commandStep === 2 && inCommand && !this.pendingTarget);
  }

  private flashMessage(text: string): void {
    const w = this.scale.width;
    const t = this.add.text(w / 2, 150, text, {
      fontSize: '16px', color: '#ffcc66', backgroundColor: '#000000aa', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(70);
    this.time.delayedCall(1000, () => t.destroy());
  }

  /** 指令阶段倒计时：服务端 roundExpiresAt 驱动，超时自动开战。 */
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

  // ——— 渲染（DQ式回合：指令阶段/执行阶段两态）———
  private renderState(): void {
    if (!this.room || !this.room.state) return;
    const s = this.room.state;

    // 诊断：每帧首次渲染时打印 players 快照（仅首帧，防刷屏）
    if (!this['_diagPlayersLogged']) {
      const playerList = [...s.players.values()].map((p: any) => ({ sid: p.sessionId, name: p.name, isPet: p.isPet, alive: p.alive }));
      console.log('[MultiBattleScene.renderState] 📋 s.players (first frame):', JSON.stringify(playerList), 'total=', s.players.size);
      this['_diagPlayersLogged'] = true;
    }

    const inCombat = s.phase === 'combat';
    const inCommand = inCombat && s.roundPhase === 'command';
    const inExecute = inCombat && s.roundPhase === 'execute';

    // 新一轮指令阶段：重置两步选择状态，进入人物指令阶段
    if (inCommand && this.lastRoundSeen !== s.round) {
      this.submittedActors.clear();
      this.stagedChar = null;
      this.stagedPet = null;
      this.pendingTarget = null;
      this.commandStep = 1; // 进入人物指令阶段
    }
    this.lastRoundSeen = s.round;

    const charSubmitted = this.submittedActors.has(this.mySessionId);
    const petSubmitted = this.pet ? this.submittedActors.has(this.petSid) : true;
    const allSubmitted = charSubmitted && petSubmitted;

    if ((!inCommand || allSubmitted) && this.menuOpen) this.closeMenu();

    if (inCommand) {
      let label: string;
      if (allSubmitted) label = '已选择，等待执行…';
      else if (this.commandStep === 1) label = this.stagedChar ? '② 人物已选 — 点「▶ 下一步」指挥灵宠' : '① 选择人物指令';
      else label = '② 选择灵宠指令（或「← 返回」改人物）';
      this.turnText.setText(label);
      this.turnText.setColor(allSubmitted ? '#ffe8b0' : (this.commandStep === 1 ? '#88ff88' : '#c9a0ff'));
    } else if (inExecute) {
      const cur = s.players.get(s.currentTurn) || s.enemies.get(s.currentTurn);
      this.turnText.setText(`执行中 — ${cur?.name ?? ''} 行动`);
      this.turnText.setColor('#aaaacc');
    } else {
      this.turnText.setText(`阶段：${s.phase}`); this.turnText.setColor('#aaaacc');
    }

    this.refreshButtons();

    const me = s.players.get(this.mySessionId);
    let mpStr = me ? `灵力 MP ${Math.max(0, Math.round(me.mp))} / ${Math.round(me.maxMp)}` : '';
    if (this.pet) {
      const petp = s.players.get(this.petSid);
      if (petp) mpStr += `    🐾MP ${Math.max(0, Math.round(petp.mp))} / ${Math.round(petp.maxMp)}`;
    }
    if (this.mpText) this.mpText.setText(mpStr);

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
    //
    // ═══ 全屏响应式战场布局 ═══
    //
    //  纵轴：标题(~5%) + 状态栏(~6%) → 卡片区起始于 ~22% 屏高
    //        指令按钮区在底部 ~10% → 卡片区终止于 ~72% 屏高
    //        可用卡片区 ≈ 50% 屏高，行距按此均分
    //
    //  横轴：我方紧凑组(左 16%/38%) | 对战区(~30%) | 敌方组(右 68%/88%)
    //
    const W = this.scale.width;
    const H = this.scale.height;
    const cardAreaTop = H * 0.20;
    const playerRowH = H * 0.14;   // 我方行距（人物+宠物同行，紧凑）
    const enemyRowH  = H * 0.18;   // 敌方行距（双列，稍宽）

    const ownerPositions: Record<string, { x: number; y: number }> = {};
    if (isPlayer) {
      let row = 0;
      // 第一遍：非宠物（人物/队友）—— 左侧主列
      for (const c of list) {
        if (!c.isPet) {
          const id = c.sessionId || c.id;
          ownerPositions[id] = { x: W * 0.15, y: cardAreaTop + row * playerRowH };
          row++;
        }
      }
      // 第二遍：宠物紧跟主人右侧同行 —— 紧凑配对
      for (const c of list) {
        if (c.isPet && c.ownerSid) {
          const op = ownerPositions[c.ownerSid];
          if (op) {
            ownerPositions[c.sessionId] = { x: W * 0.37, y: op.y };
          } else {
            ownerPositions[c.sessionId] = { x: W * 0.15, y: cardAreaTop + row * playerRowH };
            row++;
          }
        }
      }
    }

    list.forEach((c: any, i: number) => {
      const id = c.sessionId || c.id;
      let x: number, y: number;
      if (isPlayer) {
        const pos = ownerPositions[id];
        x = pos?.x ?? W * 0.26;
        y = pos?.y ?? cardAreaTop + i * playerRowH;
      } else {
        const col = i % 2, row = Math.floor(i / 2);
        x = W * (col === 0 ? 0.67 : 0.87);
        y = cardAreaTop + row * enemyRowH;
      }
      let card = map.get(id);
      if (!card) {
        card = this.makeCard(x, y, isPlayer);
        map.set(id, card);
        // 敌人卡片可点击：攻击/技能/鬼道选怪时高亮并接受点击
        if (!isPlayer) {
          card.root.setSize(380, 96).setInteractive({ useHandCursor: true });
          card.root.on('pointerdown', () => this.onEnemyCardClicked(id));
        }
      } else {
        card.root.setPosition(x, y);
      }
      // 玩家卡片：道具选目标时可点击
      if (isPlayer && this.pendingTarget && this.pendingTarget.type === 'item') {
        card.root.setSize(380, 96).setInteractive({ useHandCursor: true });
        card.root.off('pointerdown');
        card.root.on('pointerdown', () => this.onPlayerCardClicked(id));
      } else if (isPlayer && !(this.pendingTarget && this.pendingTarget.type === 'item')) {
        card.root.disableInteractive();
      }
      card.name.setText(`${c.name}${c.alive ? '' : '（倒下）'}`);
      // 出战灵宠卡片：紫调描边 + 🐾 标识，与人物区分
      if (c.isPet) {
        card.name.setText(`🐾 ${c.name}${c.alive ? '' : '（倒下）'}`);
        card.bg.clear();
        card.bg.fillStyle(0x241a36, 0.95);
        card.bg.fillRoundedRect(-190, -48, 380, 96, 8);
        card.bg.lineStyle(2, c.alive ? 0xaa7cff : 0x66508c, 0.9);
        card.bg.strokeRoundedRect(-190, -48, 380, 96, 8);
      }
      this.drawHpBar(card, c.hp, c.maxHp);
      this.drawStatusIcons(card, c);
      card.root.setAlpha(c.alive ? 1 : 0.4);
      // 高亮：多怪且有待选目标时，存活敌人边框发光提示「点我释放」
      const highlight = !isPlayer && !!this.pendingTarget && c.alive;
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
    return { root, bg, name, hpBar, hpText, hl, statusIcons: [] };
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

  /** 渲染异常状态 PNG 图标（依据服务端 schema.status 字段），含剩余回合数 + 背板 + 文字兜底 */
  private drawStatusIcons(card: Card, c: any): void {
    for (const obj of card.statusIcons) obj.destroy();
    card.statusIcons = [];
    const st = c.status;
    if (!st) return;
    const list: { key: string; name: string; turns: number }[] = [
      { key: 'icon_burn', name: '灼烧', turns: st.burn },
      { key: 'icon_freeze', name: '冻结', turns: st.freeze },
      { key: 'icon_poison', name: '中毒', turns: st.poison },
      { key: 'icon_parasite', name: '寄生', turns: st.parasite },
      { key: 'icon_slow', name: '减速', turns: st.slow },
      { key: 'icon_stun', name: '眩晕', turns: st.stun },
      { key: 'icon_bind', name: '禁锢', turns: st.bind },
      { key: 'icon_taunt', name: '嘲讽', turns: st.taunt },
      { key: 'icon_fear', name: '恐惧', turns: st.fear },
      { key: 'icon_atkDown', name: '攻降', turns: st.atkDown },
      { key: 'icon_defDown', name: '防降', turns: st.defDown },
      { key: 'icon_matkDown', name: '降灵压', turns: st.matkDown },
      { key: 'icon_seal', name: '封印', turns: st.sealed },
    ];
    const active = list.filter((k) => k.turns > 0);
    if (active.length === 0) return;

    // 诊断：状态到达客户端时打印一次（去重防刷屏），用于确认服务端状态同步是否生效。
    {
      const sig = `${c.name || '敌方'}:${active.map(k => `${k.name}×${k.turns}`).join(',')}`;
      if ((this as any)._lastStatusSig !== sig) {
        (this as any)._lastStatusSig = sig;
        console.log(`[Status.render] ${sig}`);
      }
    }

    // 背板：半透明圆角矩形，让状态"不可能不被看到"（即使所有纹理都丢失也能看到色块）
    const ICON = 22, GAP = 3, PAD = 6;
    const totalW = active.length * (ICON + GAP) - GAP + PAD * 2;
    const plateX = -totalW / 2, plateY = -54 - 4;
    const plateW = totalW, plateH = ICON + 8;
    const plate = this.add.graphics();
    plate.fillStyle(0x000000, 0.65);
    plate.fillRoundedRect(plateX, plateY, plateW, plateH, 4);
    plate.lineStyle(1, 0x7799cc, 0.6);
    plate.strokeRoundedRect(plateX, plateY, plateW, plateH, 4);
    card.root.add(plate);
    card.statusIcons.push(plate);

    const startX = -totalW / 2 + PAD + ICON / 2;
    const y = -54;
    active.forEach((k, i) => {
      const x = startX + i * (ICON + GAP);
      if (this.textures.exists(k.key)) {
        const img = this.add.image(x, y, k.key).setDisplaySize(ICON, ICON).setDepth(12);
        card.root.add(img);
        card.statusIcons.push(img);
      } else {
        // 纹理缺失兜底：中文名（深色底+亮色字）
        const t = this.add.text(x, y, k.name, { fontSize: '10px', color: '#ffcc66', backgroundColor: '#00000088', padding: { x: 2, y: 1 } }).setOrigin(0.5).setDepth(12);
        card.root.add(t);
        card.statusIcons.push(t);
      }
      const tn = this.add.text(x, y + ICON / 2 - 1, String(k.turns), {
        fontSize: '10px', color: '#ffffff', backgroundColor: '#000000aa', padding: { x: 1, y: 0 },
      }).setOrigin(0.5).setDepth(13);
      card.root.add(tn);
      card.statusIcons.push(tn);
    });
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
    let enabled = true;
    container.on('pointerdown', () => { if (enabled) cb(); });
    return {
      container,
      setEnable: (b: boolean) => {
        if (b === enabled) return;
        enabled = b;
        draw(b);
        text.setColor(b ? '#ffffff' : '#888899');
        container.setAlpha(b ? 1 : 0.55);
      },
      setVisible: (b: boolean) => { container.setVisible(b); },
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
      this.broadcastTeamExit();      // 队长返回 → 广播全队一起退出战斗
      this.scene.stop();
    });
    c.add([bg, panel, t, btn]);
    this.resultPanel = c;
  }

  /** 队长（非被拉入）主动返回时，广播给全队一起退出战斗场景。
   *  队员侧收到 teamExitBattleEnd 后 stop 自身 MultiBattleScene 并 resume 对应场景（副本/地图）。 */
  private broadcastTeamExit(): void {
    if (this.isTeamPull) return;
    const gs = this.scene.get('GameScene') as any;
    if (gs?.gameRoom) gs.gameRoom.send('teamExitBattle');
  }
}
