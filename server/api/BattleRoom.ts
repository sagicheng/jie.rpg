/**
 * 权威战斗房间：组队打怪（梦幻西游/飘流幻境式回合制）。
 *
 * 每回合 = 指令阶段（全员选操作，30s）→ 执行阶段（按 SPD 排序逐行动画播放）。
 * 所有战斗数学在服务端用 src/systems 纯函数跑；客户端只发意图、播动画。
 */

import { Room, Client } from '@colyseus/core';
import { BattleRoomState, CombatPlayer, CombatEnemy, ChatMessage } from '../core/schema';
import { createEnemyData, calcDamage, calcMagicDamage, generateLoot } from '../../src/managers/BattleData';
import { world } from '../core/world';
import { PET_SKILLS } from '../core/world';

import type { EnemyData } from '../../src/managers/BattleData';
import { SKILL_BY_NAME, getSkillTargetType } from '../../src/managers/Skills';
import { CONSUMABLES } from '../../src/managers/ConsumableSystem';

interface KidoLoadoutDTO {
  id: string; mp: number; power: number;
  effectType: string; target?: string; reviveHpPercent?: number;
}
interface PlayerLoadout {
  skills: Set<string>; kidos: Map<string, KidoLoadoutDTO>; items: Set<string>;
  /** 出战灵宠标记（仅宠物战斗员为 true）。 */
  isPet?: boolean;
  /** 宠物技能 → 战斗参数（仅宠物战斗员有值）。 */
  petSkills?: Map<string, { power: number; damageType: 'physical' | 'magical'; mp: number }>;
}
const EMPTY_LOADOUT: PlayerLoadout = { skills: new Set(), kidos: new Map(), items: new Set() };

const COLORS = ['#ff6b6b', '#4ecdc4', '#ffd93d', '#a78bfa', '#ff9f43', '#54a0ff'];
const BASE_PLAYER = { hp: 220, atk: 42, def: 18, matk: 36, mdef: 16, spd: 12, mp: 120, maxMp: 120 };
const COMMAND_SECONDS = 20;
/** 执行阶段动作间隔（ms），让客户端有时间播动画 */
const EXEC_DELAY_MS = 800;

/** 玩家已选的指令 */
interface PendingAction {
  type: string;       // attack|skill|kido|item|defend|escape
  playerSid: string;
  skillId?: string;
  kidoId?: string;
  itemId?: string;
  targetId?: string;
}

export class BattleRoom extends Room<BattleRoomState> {
  private enemyDef!: EnemyData;
  private defending: Set<string> = new Set();
  private loadouts: Map<string, PlayerLoadout> = new Map();
  private enemyParty: EnemyData[] = [];
  private enemySkills: Map<string, { name: string; power: number; damageType: 'physical' | 'magical' }[]> = new Map();
  private ownerSids: Map<string, string> = new Map();
  private commandTimer: ReturnType<typeof setTimeout> | null = null;
  private commandCheckInterval: ReturnType<typeof setInterval> | null = null;
  private execTimer: ReturnType<typeof setTimeout> | null = null;
  private execQueue: string[] = [];   // 执行阶段队列（turnOrder 副本，逐步 shift）
  /** 指令阶段玩家提交的意图 */
  private pendingActions: Map<string, PendingAction> = new Map();
  private dungeonId = 0;
  private dungeonStage = 0;
  private dungeonRoomId = '';
  /** 指令阶段开始时间（epoch ms），用于最小等待（3s 内不提前执行）。 */
  private commandStartedAt = 0;

  onCreate(options: { monsterId?: string }) {
    this.setMetadata({ monsterId: options.monsterId ?? '' });
    this.setState(new BattleRoomState());
    this.onMessage('startbattle', () => this.tryBeginCombat());
    this.onMessage('action', (client, data: { type?: string; id?: string; targetId?: string }) =>
      this.receiveAction(client, data));
  }

  onJoin(client: Client, options: {
    name?: string; enemyData?: any; enemyParty?: EnemyData[]; monsterId?: string;
    loadout?: { skills?: string[]; kidos?: KidoLoadoutDTO[]; items?: string[] };
    playerStats?: { hp?: number; maxHp?: number; mp?: number; maxMp?: number; atk?: number; def?: number; matk?: number; mdef?: number; spd?: number };
    /** 出战灵宠战斗 DTO（含属性快照与技能列表）。 */
    pet?: { name?: string; speciesId?: string; element?: string; quality?: string; level?: number; stats?: { hp: number; maxHp?: number; atk: number; def: number; matk: number; mdef: number; spd: number }; mp?: number; maxMp?: number; skills?: string[] };
    dungeonId?: number; dungeonStage?: number; dungeonRoomId?: string;
  }) {
    const p = new CombatPlayer();
    p.sessionId = client.sessionId;
    p.name = (options?.name ?? '勇者').slice(0, 16);
    p.color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const st = options?.playerStats;
    p.maxHp = st?.maxHp ?? BASE_PLAYER.hp; p.hp = st?.hp ?? p.maxHp;
    p.atk = st?.atk ?? BASE_PLAYER.atk; p.def = st?.def ?? BASE_PLAYER.def;
    p.matk = st?.matk ?? BASE_PLAYER.matk; p.mdef = st?.mdef ?? BASE_PLAYER.mdef;
    p.spd = st?.spd ?? BASE_PLAYER.spd; p.maxMp = st?.maxMp ?? BASE_PLAYER.maxMp; p.mp = st?.mp ?? p.maxMp;
    p.alive = true;
    this.state.players.set(client.sessionId, p);
    this.ownerSids.set(client.sessionId, (options as any).ownerSessionId || client.sessionId);

    // 出战灵宠：作为同一客户端的第二战斗员（独立 SID + 独立回合）。
    // 宠物 inherit 主人的 ownerSid，便于胜利回写与断连清理。
    const petOpt: any = options?.pet;
    console.log('[BattleRoom.onJoin] pet option received:', JSON.stringify(petOpt));
    if (petOpt && petOpt.stats && typeof petOpt.stats.hp === 'number') {
      const pet = new CombatPlayer();
      const petSid = client.sessionId + ':pet';
      pet.sessionId = petSid;
      pet.name = (petOpt.name ? `${petOpt.name}` : '灵宠');
      pet.color = COLORS[(Math.floor(Math.random() * COLORS.length) + 3) % COLORS.length];
      pet.isPet = true;
      // ownerSid 指向同战斗房内主人战斗员（client.sessionId），用于 onLeave 击倒宠物 + 客户端布局配对
      // （地图房 GameRoom 的 ownerSessionId 映射由独立的 this.ownerSids Map 处理，不依赖此字段）
      pet.ownerSid = client.sessionId;
      const ps = petOpt.stats;
      pet.maxHp = ps.maxHp ?? ps.hp; pet.hp = ps.hp ?? pet.maxHp;
      pet.atk = ps.atk ?? 0; pet.def = ps.def ?? 0;
      pet.matk = ps.matk ?? 0; pet.mdef = ps.mdef ?? 0; pet.spd = ps.spd ?? 0;
      pet.maxMp = petOpt.maxMp ?? 30; pet.mp = petOpt.mp ?? pet.maxMp;
      pet.alive = true;
      this.state.players.set(petSid, pet);
      this.ownerSids.set(petSid, client.sessionId);
      // 宠物技能负载（id → 战斗参数，从 PET_SKILLS 取）
      const plo: PlayerLoadout = { skills: new Set(), kidos: new Map(), items: new Set(), isPet: true, petSkills: new Map() };
      if (Array.isArray(petOpt.skills)) {
        for (const sid of petOpt.skills) {
          const sk = PET_SKILLS[sid];
          if (sk) plo.petSkills!.set(sid, { power: sk.power, damageType: sk.damageType, mp: sk.mp });
        }
      }
      this.loadouts.set(petSid, plo);
      this.logMsg('system', `${pet.name}（灵宠）随 ${p.name} 出战`);
      console.log('[BattleRoom.onJoin] ✅ pet combatant created:', petSid, 'name=', pet.name, 'players.size=', this.state.players.size);
    }

    if (typeof options?.dungeonId === 'number' && options.dungeonId > 0) {
      this.dungeonId = options.dungeonId; this.dungeonStage = options.dungeonStage || 0; this.dungeonRoomId = options.dungeonRoomId || '';
    }
    const lo: PlayerLoadout = { skills: new Set(), kidos: new Map(), items: new Set() };
    const l = options?.loadout;
    if (l) {
      if (Array.isArray(l.skills)) for (const s of l.skills) if (typeof s === 'string') lo.skills.add(s);
      if (Array.isArray(l.kidos)) for (const k of l.kidos) if (k && typeof k.id === 'string') lo.kidos.set(k.id, k);
      if (Array.isArray(l.items)) for (const i of l.items) if (typeof i === 'string') lo.items.add(i);
    }
    this.loadouts.set(client.sessionId, lo);
    this.logMsg('system', `${p.name} 加入了战斗`);

    if (options?.enemyParty && Array.isArray(options.enemyParty) && options.enemyParty.length) {
      this.enemyParty = options.enemyParty as EnemyData[];
    } else if (options?.enemyData && options.enemyData.name) {
      this.enemyParty = [options.enemyData as EnemyData];
    }

    // 战斗开始判定：仅在 phase=waiting 时触发（首个玩家进房或 V键组队满2人）
    const wasWaiting = this.state.phase === 'waiting';
    if (wasWaiting && this.enemyParty.length) {
      this.tryBeginCombat();
    } else if (wasWaiting && this.state.players.size >= 2) {
      this.tryBeginCombat();
    }

    // 晚到玩家（combat 已开始）：重建 turnOrder 使其包含新玩家
    // 不用 splice(index,0,el) 动态插入——Colyseus ArraySchema 可能不兼容此操作
    if (this.state.phase === 'combat' && this.state.turnOrder.indexOf(client.sessionId) === -1) {
      this.rebuildTurnOrder(p.name);
      // 重置指令阶段计时：给晚到玩家充分时间选择指令
      if (this.state.roundPhase === 'command') {
        this.commandStartedAt = Date.now();
      }
      // 安全网：若执行阶段已开始，将晚到玩家追加到当前执行队列末尾
      if (this.state.roundPhase === 'execute') {
        this.execQueue.push(client.sessionId);
        this.logMsg('system', `${p.name} 补入执行队列`);
      }
    }
  }

  onLeave(client: Client) {
    this.loadouts.delete(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (p) p.alive = false;
    // 同步击倒该客户端的出战灵宠（宠物非独立连接，随主人离场）
    for (const [sid, pl] of this.state.players) {
      if (pl.ownerSid === client.sessionId) { pl.alive = false; this.loadouts.delete(sid); }
    }
  }

  onDispose() { this.clearCommandTimer(); this.clearExecTimer(); }

  // ══════════════════════════════════════════════════
  //  指令阶段 — 收集所有玩家操作
  // ══════════════════════════════════════════════════

  private receiveAction(client: Client, data: { type?: string; id?: string; targetId?: string; actorSid?: string }) {
    if (this.state.phase !== 'combat' || this.state.roundPhase !== 'command') return;
    // 同一客户端可分别指挥「人物」与「出战灵宠」两个战斗员（各自独立 SID / 独立回合）
    const actorSid = (data.actorSid === client.sessionId || data.actorSid === client.sessionId + ':pet')
      ? data.actorSid : client.sessionId;
    const p = this.state.players.get(actorSid);
    if (!p || !p.alive) return;
    // 该战斗员已提交过本轮指令？
    if (this.pendingActions.has(actorSid)) return;

    const lo = this.loadouts.get(actorSid) || EMPTY_LOADOUT;

    // 校验指令合法性（不执行，仅存储）
    const type = String(data.type || 'attack');
    if (p.isPet) {
      // 宠物仅允许：攻击 / 防御 / 宠物技能
      if (type !== 'attack' && type !== 'defend' && type !== 'petSkill') return;
      if (type === 'petSkill' && (!data.id || !lo.petSkills?.has(data.id))) return;
    } else {
      if (type === 'skill' && (!data.id || !lo.skills.has(data.id))) return;
      if (type === 'kido' && (!data.id || !lo.kidos.has(data.id))) return;
      if (type === 'item' && (!data.id || !lo.items.has(data.id))) return;
    }

    this.pendingActions.set(actorSid, {
      type, playerSid: actorSid,
      skillId: (type === 'skill' || type === 'petSkill') ? data.id : undefined,
      kidoId: type === 'kido' ? data.id : undefined,
      itemId: type === 'item' ? data.id : undefined,
      targetId: data.targetId,
    });

    // 不在此处触发执行——由 checkCommandReady 每秒轮询判断，
    // 避免 A 提交时 B 尚未入队导致 alivePlayers 误判为 1 人而提前开战。
    // receiveAction 仅做「记录意图」这一件事。
  }

  private armCommandTimer(): void {
    this.clearCommandTimer();
    this.state.roundPhase = 'command';
    this.state.roundExpiresAt = Date.now() + COMMAND_SECONDS * 1000;
    this.commandTimer = setTimeout(() => this.onCommandTimeout(), COMMAND_SECONDS * 1000);
    // 周期性重检：解决「两人都提交了但 3s 未到→无人触发→硬等 30s」的竞态
    this.commandCheckInterval = setInterval(() => this.checkCommandReady(), 1000);
  }

  private clearCommandTimer(): void {
    if (this.commandTimer) { clearTimeout(this.commandTimer); this.commandTimer = null; }
    if (this.commandCheckInterval) { clearInterval(this.commandCheckInterval); this.commandCheckInterval = null; }
    this.state.roundExpiresAt = 0;
  }

  /** 周期性检查：全员提交 + 3s 已过 → 立即执行 */
  private checkCommandReady(): void {
    if (this.state.phase !== 'combat' || this.state.roundPhase !== 'command') {
      if (this.commandCheckInterval) { clearInterval(this.commandCheckInterval); this.commandCheckInterval = null; }
      return;
    }
    const alivePlayers = [...this.state.players.values()].filter((pl) => pl.alive);
    const waited = Date.now() - this.commandStartedAt >= 1000;
    if (waited && this.pendingActions.size >= alivePlayers.length) {
      if (this.commandCheckInterval) { clearInterval(this.commandCheckInterval); this.commandCheckInterval = null; }
      this.clearCommandTimer();
      this.startExecutePhase();
    }
  }

  private onCommandTimeout(): void {
    this.commandTimer = null;
    if (this.state.phase !== 'combat' || this.state.roundPhase !== 'command') return;
    // 未选指令的存活玩家自动普攻
    for (const pl of this.state.players.values()) {
      if (!pl.alive || this.pendingActions.has(pl.sessionId)) continue;
      this.pendingActions.set(pl.sessionId, {
        type: 'attack', playerSid: pl.sessionId,
        targetId: this.firstAliveEnemy(),
      });
      this.logMsg('system', `${pl.name} 未选择指令，自动普攻`);
    }
    this.startExecutePhase();
  }

  // ══════════════════════════════════════════════════
  //  战斗开始
  // ══════════════════════════════════════════════════

  private tryBeginCombat() {
    if (this.state.phase !== 'waiting') return;
    if (this.state.players.size < 1) return;

    let party: EnemyData[];
    if (this.enemyParty && this.enemyParty.length > 0) {
      party = this.enemyParty;
    } else {
      party = [createEnemyData('虚', '杂妖', '火', 2), createEnemyData('虚', '杂妖', '火', 2)];
    }
    const nPlayers = this.state.players.size;
    const bossHpMult = 1 + 0.35 * (nPlayers - 1);

    this.enemySkills.clear();
    party.forEach((ed, i) => {
      const e = new CombatEnemy();
      e.id = `enemy:${i}`; e.name = ed.name; e.type = ed.type;
      let maxHp = ed.maxHp;
      if ((ed.type === '妖将' || ed.type === '妖王') && nPlayers > 1) maxHp = Math.round(maxHp * bossHpMult);
      e.maxHp = maxHp; e.hp = maxHp; e.atk = ed.atk; e.def = ed.def;
      e.matk = ed.matk; e.mdef = ed.mdef; e.spd = ed.spd; e.alive = true;
      this.state.enemies.set(e.id, e);
      this.enemySkills.set(e.id, (ed.skills || []).map((s) => ({ name: s.name, power: s.power, damageType: s.damageType })));
      if (i === 0 || ed.type === '妖将' || ed.type === '妖王') this.enemyDef = ed;
    });

    // 构建 SPD 降序的回合顺序（所有玩家 + 所有敌人）
    const order: string[] = [];
    this.state.players.forEach((pl) => order.push(pl.sessionId));
    this.state.enemies.forEach((e) => order.push(e.id));
    order.sort((a, b) => this.spdCmp(a, b));
    this.state.turnOrder.splice(0, this.state.turnOrder.length, ...order);
    this.state.phase = 'combat';
    this.state.round = 1;
    this.state.roundPhase = 'command';
    this.logMsg('system', `战斗开始！${nPlayers} 名队员 VS ${this.state.enemies.size} 只${this.enemyDef?.type || '敌人'}`);
    this.defending.clear();
    this.startCommandPhase();
  }

  /** 开始新一轮指令阶段 */
  private startCommandPhase(): void {
    this.pendingActions.clear();
    this.state.roundPhase = 'command';
    this.commandStartedAt = Date.now();
    this.armCommandTimer();
  }

  /** 切换到执行阶段——按 SPD 顺序逐行动画播放 */
  private startExecutePhase(): void {
    this.state.roundPhase = 'execute';
    this.execQueue = [];
    for (let i = 0; i < this.state.turnOrder.length; i++) {
      const id = this.state.turnOrder[i];
      if (id && this.isAlive(id)) this.execQueue.push(id);
    }
    this.executeNext();
  }

  /** 执行队列中的下一个动作 */
  private executeNext(): void {
    if (this.state.phase !== 'combat' || this.state.roundPhase !== 'execute') return;

    // 当前动作开始前清除 turnExpiresAt
    this.state.turnExpiresAt = 0;

    if (this.execQueue.length === 0) {
      // 本回合所有实体行动完毕 → 下一回合
      if (this.checkVictory() || this.checkDefeat()) return;
      this.state.round += 1;
      this.defending.clear();
      this.startCommandPhase();
      return;
    }

    const id = this.execQueue.shift()!;
    if (!this.isAlive(id)) { this.executeNext(); return; }
    this.state.currentTurn = id;

    if (id.startsWith('enemy:')) {
      this.executeEnemyAction(id);
    } else {
      this.executePlayerAction(id);
    }
  }

  private executePlayerAction(sid: string): void {
    const action = this.pendingActions.get(sid);
    if (!action) {
      // 无指令（不应该发生，兜底普攻）
      this.executeAttack(sid, this.firstAliveEnemy() || '');
      this.scheduleExecuteNext();
      return;
    }
    const p = this.state.players.get(sid)!;
    const lo = this.loadouts.get(sid) || EMPTY_LOADOUT;

    this.defending.delete(sid);

    switch (action.type) {
      case 'attack': {
        const targetId = this.resolveTarget(action.targetId);
        if (!targetId) { this.scheduleExecuteNext(); return; }
        this.executeAttack(sid, targetId);
        break;
      }
      case 'skill': {
        const sk = action.skillId ? SKILL_BY_NAME[action.skillId] : undefined;
        if (!sk || !lo.skills.has(sk.name)) { this.scheduleExecuteNext(); return; }
        if (p.mp < sk.mp) { this.logMsg(p.name, `${p.name} 灵力不足，技能失败`); this.scheduleExecuteNext(); return; }
        p.mp = Math.max(0, p.mp - sk.mp);
        this.executeSkill(p, sk, action.targetId);
        break;
      }
      case 'kido': {
        const k = action.kidoId ? lo.kidos.get(action.kidoId) : undefined;
        if (!k) { this.scheduleExecuteNext(); return; }
        if (p.mp < k.mp) { this.logMsg(p.name, `${p.name} 灵力不足`); this.scheduleExecuteNext(); return; }
        p.mp = Math.max(0, p.mp - k.mp);
        this.executeKido(p, k, action.targetId);
        break;
      }
      case 'item': {
        const itemId = action.itemId || '';
        if (!lo.items.has(itemId)) { this.scheduleExecuteNext(); return; }
        this.executeItem(p, itemId, action.targetId);
        break;
      }
      case 'petSkill': {
        const sk = action.skillId ? lo.petSkills?.get(action.skillId) : undefined;
        if (!sk) { this.scheduleExecuteNext(); return; }
        if (p.mp < sk.mp) {
          // 灵力不足：自动转为普攻，保证宠物当回合仍有行动
          this.logMsg(p.name, `${p.name} 灵力不足，改为普攻`);
          const tid = this.resolveTarget(action.targetId);
          if (tid) this.executeAttack(p.sessionId, tid);
          break;
        }
        p.mp = Math.max(0, p.mp - sk.mp);
        const magic = sk.damageType === 'magical';
        const tid = this.resolveTarget(action.targetId);
        if (!tid) { this.scheduleExecuteNext(); return; }
        const e = this.state.enemies.get(tid)!;
        const r = magic ? calcMagicDamage(p.matk, e.mdef, sk.power) : calcDamage(p.atk, e.def, sk.power);
        e.hp = Math.max(0, e.hp - r.damage);
        const skName = PET_SKILLS[action.skillId!]?.name || action.skillId!;
        this.logMsg(p.name, `${p.name}「${skName}」→ ${e.name} -${r.damage}${r.crit ? '（暴击！）' : ''}`);
        if (e.hp <= 0) { e.alive = false; this.logMsg('system', `${e.name} 被击败！`); }
        break;
      }
      case 'defend':
        this.defending.add(sid);
        this.logMsg(p.name, `${p.name} 进入防御姿态`);
        break;
      case 'escape': {
        const aliveEnemies = [...this.state.enemies.values()].filter((e) => e.alive);
        const avgSpd = aliveEnemies.length ? aliveEnemies.reduce((s, e) => s + e.spd, 0) / aliveEnemies.length : 0;
        let rate = 0.5 + (p.spd - avgSpd) * 0.03;
        rate = Math.max(0.1, Math.min(0.95, rate));
        if (Math.random() < rate) {
          this.state.phase = 'fled'; this.state.winner = 'escape';
          this.logMsg(p.name, `${p.name} 成功逃脱！`);
          return;
        }
        this.logMsg(p.name, `${p.name} 逃跑失败！`);
        break;
      }
    }
    this.scheduleExecuteNext();
  }

  /** 延时执行下一个（给客户端动画播放时间）。胜败判定只在整个执行队列清空后进行。 */
  private scheduleExecuteNext(): void {
    this.clearExecTimer();
    this.execTimer = setTimeout(() => this.executeNext(), EXEC_DELAY_MS);
  }

  private clearExecTimer(): void {
    if (this.execTimer) { clearTimeout(this.execTimer); this.execTimer = null; }
  }

  // ══════════════════════════════════════════════════
  //  具体行动执行（从旧 handleAction 移植）
  // ══════════════════════════════════════════════════

  private executeAttack(sid: string, targetId: string): void {
    const p = this.state.players.get(sid)!;
    const e = this.state.enemies.get(targetId)!;
    const r = calcDamage(p.atk, e.def, 1.0);
    e.hp = Math.max(0, e.hp - r.damage);
    this.logMsg(p.name, `${p.name} 斩击 ${e.name} 造成 ${r.damage} 伤害${r.crit ? '（暴击！）' : ''}`);
    if (e.hp <= 0) { e.alive = false; this.logMsg('system', `${e.name} 被击败！`); }
  }

  private executeSkill(p: CombatPlayer, sk: { name: string; damageType: string; power: number; mp: number; statusEffect?: any }, targetId?: string): void {
    const tt = getSkillTargetType(sk as any);
    const magic = sk.damageType === 'magical';
    if (tt === 'enemy') {
      const tid = this.resolveTarget(targetId); if (!tid) return;
      const e = this.state.enemies.get(tid)!;
      const r = magic ? calcMagicDamage(p.matk, e.mdef, sk.power) : calcDamage(p.atk, e.def, sk.power);
      e.hp = Math.max(0, e.hp - r.damage);
      this.logMsg(p.name, `${p.name}「${sk.name}」→ ${e.name} -${r.damage}${r.crit ? '（暴击！）' : ''}`);
      if (e.hp <= 0) { e.alive = false; this.logMsg('system', `${e.name} 被击败！`); }
    } else if (tt === 'enemy-all') {
      for (const e of this.state.enemies.values()) {
        if (!e.alive) continue;
        const r = magic ? calcMagicDamage(p.matk, e.mdef, sk.power) : calcDamage(p.atk, e.def, sk.power);
        e.hp = Math.max(0, e.hp - r.damage);
        if (e.hp <= 0) { e.alive = false; this.logMsg('system', `${e.name} 被击败！`); }
      }
      this.logMsg(p.name, `${p.name}「${sk.name}」横扫全场！`);
    } else if (tt === 'self' || tt === 'ally') {
      const target = tt === 'ally' ? this.lowestHpAlly(p.sessionId) : p;
      const heal = Math.round(p.matk * sk.power);
      target.hp = Math.min(target.maxHp, target.hp + heal);
      this.logMsg(p.name, `${p.name}「${sk.name}」→ ${target.name} +${heal} HP`);
    } else if (tt === 'ally-all') {
      for (const pl of this.state.players.values()) {
        if (!pl.alive) continue;
        const heal = Math.round(p.matk * sk.power);
        pl.hp = Math.min(pl.maxHp, pl.hp + heal);
      }
      this.logMsg(p.name, `${p.name}「${sk.name}」全队回复！`);
    }
  }

  private executeKido(p: CombatPlayer, k: KidoLoadoutDTO, targetId?: string): void {
    if (k.effectType === 'damage') {
      const tid = this.resolveTarget(targetId); if (!tid) return;
      const e = this.state.enemies.get(tid)!;
      const r = calcMagicDamage(p.matk, e.mdef, k.power);
      e.hp = Math.max(0, e.hp - r.damage);
      this.logMsg(p.name, `${p.name} 鬼道 → ${e.name} -${r.damage}${r.crit ? '（暴击！）' : ''}`);
      if (e.hp <= 0) { e.alive = false; this.logMsg('system', `${e.name} 被击败！`); }
    } else if (k.effectType === 'heal') {
      const target = this.lowestHpAlly(p.sessionId);
      const heal = Math.round(k.power);
      target.hp = Math.min(target.maxHp, target.hp + heal);
      this.logMsg(p.name, `${p.name} 回道 → ${target.name} +${heal} HP`);
    } else if (k.effectType === 'revive') {
      const target = this.lowestHpAlly(p.sessionId);
      if (!target.alive) {
        const pct = k.reviveHpPercent ?? 50;
        target.hp = Math.round(target.maxHp * pct / 100); target.alive = true;
        this.logMsg(p.name, `${p.name} 复活 ${target.name}（${pct}% HP）`);
      }
    } else {
      this.logMsg(p.name, `${p.name} 鬼道（${k.effectType}）`);
    }
  }

  private executeItem(p: CombatPlayer, itemId: string, targetId?: string): void {
    const def = CONSUMABLES[itemId];
    if (!def) return;
    // 确定目标：若 targetId 指向存活玩家则用该玩家，否则默认自己
    let target: CombatPlayer = p;
    if (targetId && this.state.players.has(targetId)) {
      const t = this.state.players.get(targetId);
      if (t && t.alive) target = t;
    }
    const eff = def.effect;
    let msg = '';
    switch (eff.type) {
      case 'heal_hp': { const h = Math.min(target.maxHp, target.hp + (eff.hpAmount || 0)); msg = `+${h - target.hp} HP`; target.hp = h; break; }
      case 'heal_mp': { const m = Math.min(target.maxMp, target.mp + (eff.mpAmount || 0)); msg = `+${m - target.mp} MP`; target.mp = m; break; }
      case 'heal_both': { const h = Math.min(target.maxHp, target.hp + (eff.hpAmount || 0)); const m = Math.min(target.maxMp, target.mp + (eff.mpAmount || 0)); msg = `+${h - target.hp} HP +${m - target.mp} MP`; target.hp = h; target.mp = m; break; }
      case 'full_heal': { target.hp = target.maxHp; target.mp = target.maxMp; msg = 'HP·MP 完全回复'; break; }
      case 'revive': {
        if (!target.alive) { target.hp = Math.round(target.maxHp * (eff.reviveHpPercent || 50) / 100); target.alive = true; msg = `复活(${eff.reviveHpPercent}%)`; }
        else { const h = Math.min(target.maxHp, target.hp + Math.round(target.maxHp * 0.3)); msg = `+${h - target.hp} HP`; target.hp = h; }
        break;
      }
      case 'buff_temp': {
        const stat = eff.buffStat || 'atk'; const v = eff.buffValue || 0;
        if (stat === 'atk') target.atk = Math.round(target.atk * (1 + v));
        else if (stat === 'def') target.def = Math.round(target.def * (1 + v));
        else if (stat === 'matk') target.matk = Math.round(target.matk * (1 + v));
        else if (stat === 'mdef') target.mdef = Math.round(target.mdef * (1 + v));
        else if (stat === 'spd') target.spd = Math.round(target.spd * (1 + v));
        msg = `${stat}↑`;
        break;
      }
      default: msg = '使用道具';
    }
    const who = target.sessionId === p.sessionId ? p.name : `${p.name}→${target.name}`;
    this.logMsg(p.name, `${who} 使用「${def.name}」${msg}`);
  }

  // ══════════════════════════════════════════════════
  //  敌人 AI
  // ══════════════════════════════════════════════════

  private executeEnemyAction(eid: string): void {
    const e = this.state.enemies.get(eid);
    if (!e || !e.alive) { this.scheduleExecuteNext(); return; }

    const alivePlayers = [...this.state.players.values()].filter((p) => p.alive);
    if (alivePlayers.length === 0) { this.checkDefeat(); return; }
    const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];

    const skills = this.enemySkills.get(eid) || [];
    const sk = skills.length ? (Math.random() < 0.4 ? skills[Math.floor(Math.random() * skills.length)] : skills[0]) : null;
    const power = sk?.power ?? 1.0;
    const magical = sk?.damageType === 'magical';
    const r = magical ? calcMagicDamage(e.matk, target.mdef, power) : calcDamage(e.atk, target.def, power);
    let dmg = r.damage;
    const isDefending = this.defending.has(target.sessionId);
    if (isDefending) dmg = Math.round(dmg * 0.2);
    target.hp = Math.max(0, target.hp - dmg);
    const skName = sk?.name ? `【${sk.name}】` : '';
    this.logMsg(e.name, `${e.name}${skName} → ${target.name} -${dmg}${r.crit ? '（暴击！）' : ''}${isDefending ? '（防御）' : ''}`);

    if (target.hp <= 0) { target.alive = false; this.logMsg('system', `${target.name} 倒下了！`); }
    this.scheduleExecuteNext();
  }

  // ══════════════════════════════════════════════════
  //  胜负判定
  // ══════════════════════════════════════════════════

  private checkVictory(): boolean {
    if ([...this.state.enemies.values()].some((e) => e.alive)) return false;
    this.state.phase = 'victory'; this.state.winner = 'players';
    this.clearCommandTimer(); this.clearExecTimer();

    if (this.dungeonStage > 0) {
      const baseExp = Math.round((this.enemyDef.expReward || 10) * 0.5);
      const baseGold = Math.round((this.enemyDef.goldReward || 5) * 0.5);
      this.clients.forEach((c: Client) => {
        const pw = world.get(this.ownerSids.get(c.sessionId) || c.sessionId);
        const lvBefore = pw.level;
        world.gainExp(pw, baseExp);
        const leveled = pw.level > lvBefore;
        world.addGold(pw, baseGold);
        c.send('battleReward', { exp: baseExp, gold: baseGold, loot: [], leveled });
      });
      return true;
    }

    const loot = generateLoot(this.enemyDef.type, this.enemyDef.zone);
    this.logMsg('system', `胜利！战利品：${loot.map((i) => i.name).join('、') || '无'}`);
    const playerCount = this.clients.length || 1;
    const exp = Math.max(1, Math.ceil((this.enemyDef.expReward || 0) / playerCount));
    const gold = Math.max(1, Math.ceil((this.enemyDef.goldReward || 0) / playerCount));
    // 物品随机分配给一名玩家
    const luckyIdx = Math.floor(Math.random() * this.clients.length);
    this.clients.forEach((c: Client, idx: number) => {
      const pw = world.get(this.ownerSids.get(c.sessionId) || c.sessionId);
      if (idx === luckyIdx) world.grantLoot(pw, loot);
      const leveled = world.gainExp(pw, exp) > 0;
      world.addGold(pw, gold);
      world.recordKill(pw, this.enemyDef.name);
      const playerLoot = idx === luckyIdx ? loot.map((i) => i.name) : [];
      c.send('battleReward', { exp, gold, loot: playerLoot, leveled });
    });
    return true;
  }

  private checkDefeat(): boolean {
    if ([...this.state.players.values()].some((p) => p.alive)) return false;
    this.state.phase = 'defeat'; this.state.winner = 'enemy';
    this.clearCommandTimer(); this.clearExecTimer();
    this.logMsg('system', '全员阵亡……战斗失败。');
    return true;
  }

  // ══════════════════════════════════════════════════
  //  工具
  // ══════════════════════════════════════════════════

  private isAlive(id: string): boolean {
    if (this.state.players.has(id)) return this.state.players.get(id)!.alive;
    const e = this.state.enemies.get(id);
    return !!e && e.alive;
  }
  private spdOf(id: string): number {
    if (this.state.players.has(id)) return this.state.players.get(id)!.spd;
    return this.state.enemies.get(id)?.spd ?? 0;
  }
  /** SPD 确定性比较：高速优先，相同时用 ID 字典序做 tie-breaker（梦幻西游式 Internal_ID）。 */
  private spdCmp(a: string, b: string): number {
    const diff = this.spdOf(b) - this.spdOf(a);
    return diff !== 0 ? diff : a.localeCompare(b);
  }
  /** 从 state.players + state.enemies 完整重建 turnOrder（SPD 降序）。替代不稳定的 splice 动态插入。 */
  private rebuildTurnOrder(who: string): void {
    const order: string[] = [];
    this.state.players.forEach((pl) => order.push(pl.sessionId));
    this.state.enemies.forEach((e) => order.push(e.id));
    order.sort((a, b) => this.spdCmp(a, b));
    this.state.turnOrder.splice(0, this.state.turnOrder.length, ...order);
    this.logMsg('system', `${who} 加入，战斗队列已重建（${order.length} 人）`);
  }
  private firstAliveEnemy(): string | undefined {
    for (const e of this.state.enemies.values()) if (e.alive) return e.id;
    return undefined;
  }
  private resolveTarget(targetId?: string): string | undefined {
    if (targetId && this.state.enemies.has(targetId) && this.state.enemies.get(targetId)!.alive) return targetId;
    return this.firstAliveEnemy();
  }
  private lowestHpAlly(selfId: string): CombatPlayer {
    let best: CombatPlayer | null = null;
    for (const pl of this.state.players.values()) {
      if (!pl.alive) continue;
      if (!best || pl.hp / pl.maxHp < best.hp / best.maxHp) best = pl;
    }
    return best || this.state.players.get(selfId)!;
  }
  private logMsg(who: string, text: string) {
    const m = new ChatMessage(); m.name = who; m.text = text; m.t = Date.now();
    this.state.log.push(m);
    if (this.state.log.length > 100) this.state.log.shift();
  }
}
