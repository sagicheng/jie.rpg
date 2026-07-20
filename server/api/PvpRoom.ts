/**
 * PVP 竞技场战斗房间：真人 vs 真人（1v1 / 4v4，不允许组队）。
 * ───────────────────────────────────────────────────────────
 * - 所有战斗员都是 CombatPlayer（带 team A/B），**绝不使用 CombatEnemy / 怪物 AI**。
 * - 属性由服务端用 computePvpStats(world.get(gameSid)) 权威重算（防作弊），不信客户端。
 * - 回合制引擎复用 BattleRoom 的「指令阶段→执行阶段」骨架，但目标解析在玩家之间。
 * - 胜负 = 某队全员阵亡；断线 = 该队判负（防拔线逃避扣分）。
 *
 * 会话标识约定（关键）：
 * - 本房间内一切状态键（players / pendingActions / 计时）统一用 `client.sessionId`
 *   （即本 pvp 房间的 per-room 会话 id），与 receiveAction / onLeave 的查找保持一致。
 * - 需要读写玩家权威世界时，用 `gameSid`（进房时由 options.sid 传入的游戏房会话 id）
 *   去 WorldService 取——二者不同，必须分开存。
 */
import { Room, Client } from '@colyseus/core';
import { BattleRoomState, CombatPlayer, ChatMessage } from '../core/schema';
import { calcDamage, calcMagicDamage } from '../../src/managers/BattleData';
import { world } from '../core/world';
import { findAccountByToken, getCharacter, saveCharacterWorld } from '../core/db';
import { SKILL_BY_NAME, getSkillTargetType } from '../../src/managers/Skills';
import { CONSUMABLES } from '../../src/managers/ConsumableSystem';
import { computePvpStats, ARENA_JOIN_GRACE_MS, tierName, type ArenaMode } from '../modules/feature/arena';

interface KidoLoadoutDTO {
  id: string; mp: number; power: number;
  effectType: string; target?: string; reviveHpPercent?: number;
}
interface PlayerLoadout {
  skills: Set<string>; kidos: Map<string, KidoLoadoutDTO>; items: Set<string>;
}
const EMPTY_LOADOUT: PlayerLoadout = { skills: new Set(), kidos: new Map(), items: new Set() };

const COLORS = ['#ff6b6b', '#4ecdc4', '#ffd93d', '#a78bfa', '#ff9f43', '#54a0ff', '#f368e0', '#1abc9c'];
const COMMAND_SECONDS = 20;
const EXEC_DELAY_MS = 800;

interface PendingAction {
  type: string;
  playerSid: string;
  skillId?: string;
  kidoId?: string;
  itemId?: string;
  targetId?: string;
}

interface ExpectedPlayer { sid: string; team: string; charId: number; token: string; }

export class PvpRoom extends Room<BattleRoomState> {
  private mode: ArenaMode = '1v1';
  private expected: ExpectedPlayer[] = [];
  private joinedCount = 0;
  /** pvp 房间会话 id → 游戏房会话 id（用于取权威世界）。 */
  private gameSid = new Map<string, string>();
  /** pvp 房间会话 id → charId（落库用）。 */
  private charIdOf = new Map<string, number>();
  private loadouts = new Map<string, PlayerLoadout>();
  private pendingActions = new Map<string, PendingAction>();
  private defending = new Set<string>();
  private commandTimer: ReturnType<typeof setTimeout> | null = null;
  private commandCheckInterval: ReturnType<typeof setInterval> | null = null;
  private execTimer: ReturnType<typeof setTimeout> | null = null;
  private execQueue: string[] = [];
  private commandStartedAt = 0;
  private settled = false;

  onCreate(options: { mode?: ArenaMode; players?: ExpectedPlayer[] }) {
    this.mode = options?.mode === '4v4' ? '4v4' : '1v1';
    this.expected = Array.isArray(options?.players) ? options!.players! : [];
    this.setState(new BattleRoomState());
    this.onMessage('action', (client, data: { type?: string; id?: string; targetId?: string }) =>
      this.receiveAction(client, data));

    // 进房宽限：未齐人则解散（避免空房常驻）
    this.clock.setTimeout(() => {
      if (this.joinedCount < this.expected.length) {
        this.logMsg('system', '匹配成员未全部进入，本场取消');
        this.disconnectAll();
        this.disconnect();
      }
    }, ARENA_JOIN_GRACE_MS);
  }

  onJoin(client: Client, options: {
    sid?: string; token?: string; charId?: number; team?: string; name?: string;
    loadout?: { skills?: string[]; kidos?: KidoLoadoutDTO[]; items?: string[] };
  }) {
    const sid = client.sessionId;                       // pvp 房间会话 id（本房间内唯一键）
    const gsid = String(options?.sid || '');            // 游戏房会话 id（取权威世界用）
    const token = options?.token;
    const charId = Number(options?.charId) || 0;
    const team = String(options?.team || '');

    // 鉴权 + 允许名单校验
    const exp = this.expected.find((e) => e.sid === gsid && e.team === team && e.charId === charId);
    if (!exp || !token || !charId || !gsid) { client.leave(); return; }
    const acc = findAccountByToken(token);
    if (!acc) { client.leave(); return; }
    const ch = getCharacter(charId);
    if (!ch || ch.account_id !== acc.id) { client.leave(); return; }

    const pw = world.get(gsid);
    world.ensureArena(pw);                 // 赛季/周次重置 + 跨季发奖
    pw.arena.weeklyUsed += 1;              // 计入本周次数（服务端权威）
    try { saveCharacterWorld(charId, JSON.stringify(pw)); } catch {}

    const st = computePvpStats(pw);
    const p = new CombatPlayer();
    p.sessionId = sid;
    p.name = (options?.name || '勇者').slice(0, 16);
    p.color = COLORS[this.joinedCount % COLORS.length];
    p.team = team;
    p.maxHp = st.maxHp; p.hp = st.maxHp;
    p.maxMp = st.maxMp; p.mp = st.maxMp;
    p.atk = st.atk; p.def = st.def; p.matk = st.matk; p.mdef = st.mdef; p.spd = st.spd;
    p.alive = true;
    this.state.players.set(sid, p);

    this.gameSid.set(sid, gsid);
    this.charIdOf.set(sid, charId);
    const lo: PlayerLoadout = { skills: new Set(), kidos: new Map(), items: new Set() };
    const l = options?.loadout;
    if (l) {
      if (Array.isArray(l.skills)) for (const s of l.skills) if (typeof s === 'string') lo.skills.add(s);
      if (Array.isArray(l.kidos)) for (const k of l.kidos) if (k && typeof k.id === 'string') lo.kidos.set(k.id, k);
      if (Array.isArray(l.items)) for (const i of l.items) if (typeof i === 'string') lo.items.add(i);
    }
    this.loadouts.set(sid, lo);

    this.joinedCount += 1;
    this.logMsg('system', `${p.name} 加入竞技场（${this.mode}）`);

    if (this.joinedCount >= this.expected.length) this.tryBeginCombat();
  }

  onLeave(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (p) {
      p.alive = false;
      // 断线方判负：本场进行中则该玩家所在队伍判负，对方胜出
      if (this.state.phase === 'combat' && !this.settled) {
        this.settle(this.otherTeam(p.team));
      }
    }
    this.loadouts.delete(client.sessionId);
  }

  onDispose() { this.clearCommandTimer(); this.clearExecTimer(); }

  // ═══════════════ 指令阶段 ═══════════════
  private receiveAction(client: Client, data: { type?: string; id?: string; targetId?: string }) {
    if (this.state.phase !== 'combat' || this.state.roundPhase !== 'command') return;
    const sid = client.sessionId;
    const p = this.state.players.get(sid);
    if (!p || !p.alive) return;
    if (this.pendingActions.has(sid)) return;

    const lo = this.loadouts.get(sid) || EMPTY_LOADOUT;
    const type = String(data.type || 'attack');
    if (type === 'skill' && (!data.id || !lo.skills.has(data.id))) return;
    if (type === 'kido' && (!data.id || !lo.kidos.has(data.id))) return;
    if (type === 'item' && (!data.id || !lo.items.has(data.id))) return;
    if (type === 'escape') return; // PVP 不允许逃跑

    this.pendingActions.set(sid, {
      type, playerSid: sid,
      skillId: type === 'skill' ? data.id : undefined,
      kidoId: type === 'kido' ? data.id : undefined,
      itemId: type === 'item' ? data.id : undefined,
      targetId: data.targetId,
    });
  }

  private armCommandTimer(): void {
    this.clearCommandTimer();
    this.state.roundPhase = 'command';
    this.state.roundExpiresAt = Date.now() + COMMAND_SECONDS * 1000;
    this.commandTimer = setTimeout(() => this.onCommandTimeout(), COMMAND_SECONDS * 1000);
    this.commandCheckInterval = setInterval(() => this.checkCommandReady(), 1000);
  }
  private clearCommandTimer(): void {
    if (this.commandTimer) { clearTimeout(this.commandTimer); this.commandTimer = null; }
    if (this.commandCheckInterval) { clearInterval(this.commandCheckInterval); this.commandCheckInterval = null; }
    this.state.roundExpiresAt = 0;
  }
  private checkCommandReady(): void {
    if (this.state.phase !== 'combat' || this.state.roundPhase !== 'command') {
      if (this.commandCheckInterval) { clearInterval(this.commandCheckInterval); this.commandCheckInterval = null; }
      return;
    }
    const alive = [...this.state.players.values()].filter((pl) => pl.alive);
    const waited = Date.now() - this.commandStartedAt >= 1000;
    if (waited && this.pendingActions.size >= alive.length) {
      if (this.commandCheckInterval) { clearInterval(this.commandCheckInterval); this.commandCheckInterval = null; }
      this.clearCommandTimer();
      this.startExecutePhase();
    }
  }
  private onCommandTimeout(): void {
    this.commandTimer = null;
    if (this.state.phase !== 'combat' || this.state.roundPhase !== 'command') return;
    for (const pl of this.state.players.values()) {
      if (!pl.alive || this.pendingActions.has(pl.sessionId)) continue;
      this.pendingActions.set(pl.sessionId, { type: 'attack', playerSid: pl.sessionId, targetId: this.firstAliveEnemyOf(pl.sessionId) });
      this.logMsg('system', `${pl.name} 未选择指令，自动普攻`);
    }
    this.startExecutePhase();
  }

  // ═══════════════ 战斗开始 ═══════════════
  private tryBeginCombat(): void {
    if (this.state.phase !== 'waiting') return;
    if (this.state.players.size < 2) return;

    const order: string[] = [];
    this.state.players.forEach((pl) => order.push(pl.sessionId));
    order.sort((a, b) => this.spdCmp(a, b));
    this.state.turnOrder.splice(0, this.state.turnOrder.length, ...order);
    this.state.phase = 'combat';
    this.state.round = 1;
    this.state.roundPhase = 'command';
    this.logMsg('system', `竞技场开始！${this.mode} 对决（${this.state.players.size} 人）`);
    this.defending.clear();
    this.startCommandPhase();
  }

  private startCommandPhase(): void {
    this.pendingActions.clear();
    this.state.roundPhase = 'command';
    this.commandStartedAt = Date.now();
    this.armCommandTimer();
  }

  private startExecutePhase(): void {
    this.state.roundPhase = 'execute';
    this.execQueue = [];
    for (const id of this.state.turnOrder) {
      if (id && this.isAlive(id)) this.execQueue.push(id);
    }
    this.executeNext();
  }

  private executeNext(): void {
    if (this.state.phase !== 'combat' || this.state.roundPhase !== 'execute') return;
    this.state.turnExpiresAt = 0;
    if (this.execQueue.length === 0) {
      if (this.checkVictory()) return;
      this.state.round += 1;
      this.defending.clear();
      this.startCommandPhase();
      return;
    }
    const id = this.execQueue.shift()!;
    if (!this.isAlive(id)) { this.executeNext(); return; }
    this.state.currentTurn = id;
    this.executePlayerAction(id);
  }

  private executePlayerAction(sid: string): void {
    const action = this.pendingActions.get(sid);
    const p = this.state.players.get(sid)!;
    const lo = this.loadouts.get(sid) || EMPTY_LOADOUT;
    this.defending.delete(sid);

    if (!action) { this.executeAttack(sid, this.firstAliveEnemyOf(sid) || ''); this.scheduleExecuteNext(); return; }

    switch (action.type) {
      case 'attack': {
        const targetId = this.resolveTarget(p.team, action.targetId);
        if (!targetId) { this.scheduleExecuteNext(); return; }
        this.executeAttack(sid, targetId);
        break;
      }
      case 'skill': {
        const sk = action.skillId ? SKILL_BY_NAME[action.skillId] : undefined;
        if (!sk || !lo.skills.has(sk.name)) { this.scheduleExecuteNext(); return; }
        if (p.mp < sk.mp) { this.logMsg(p.name, `${p.name} 灵力不足`); this.scheduleExecuteNext(); return; }
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
      case 'defend':
        this.defending.add(sid);
        this.logMsg(p.name, `${p.name} 进入防御姿态`);
        break;
      default:
        this.scheduleExecuteNext(); return;
    }
    this.scheduleExecuteNext();
  }

  private scheduleExecuteNext(): void {
    this.clearExecTimer();
    this.execTimer = setTimeout(() => this.executeNext(), EXEC_DELAY_MS);
  }
  private clearExecTimer(): void {
    if (this.execTimer) { clearTimeout(this.execTimer); this.execTimer = null; }
  }

  // ═══════════════ 行动执行（目标为玩家） ═══════════════
  private executeAttack(sid: string, targetId: string): void {
    const p = this.state.players.get(sid)!;
    const e = this.state.players.get(targetId);
    if (!e || !e.alive) return;
    const r = calcDamage(p.atk, e.def, 1.0);
    e.hp = Math.max(0, e.hp - r.damage);
    this.logMsg(p.name, `${p.name} 斩击 ${e.name} 造成 ${r.damage} 伤害${r.crit ? '（暴击！）' : ''}`);
    if (e.hp <= 0) { e.alive = false; this.logMsg('system', `${e.name} 倒下了！`); }
  }

  private executeSkill(p: CombatPlayer, sk: { name: string; damageType: string; power: number; mp: number; statusEffect?: any }, targetId?: string): void {
    const tt = getSkillTargetType(sk as any);
    const magic = sk.damageType === 'magical';
    if (tt === 'enemy') {
      const tid = this.resolveTarget(p.team, targetId); if (!tid) return;
      const e = this.state.players.get(tid)!;
      const r = magic ? calcMagicDamage(p.matk, e.mdef, sk.power) : calcDamage(p.atk, e.def, sk.power);
      e.hp = Math.max(0, e.hp - r.damage);
      this.logMsg(p.name, `${p.name}「${sk.name}」→ ${e.name} -${r.damage}${r.crit ? '（暴击！）' : ''}`);
      if (e.hp <= 0) { e.alive = false; this.logMsg('system', `${e.name} 倒下了！`); }
    } else if (tt === 'enemy-all') {
      for (const e of this.state.players.values()) {
        if (!e.alive || e.team === p.team) continue;
        const r = magic ? calcMagicDamage(p.matk, e.mdef, sk.power) : calcDamage(p.atk, e.def, sk.power);
        e.hp = Math.max(0, e.hp - r.damage);
        if (e.hp <= 0) { e.alive = false; this.logMsg('system', `${e.name} 倒下了！`); }
      }
      this.logMsg(p.name, `${p.name}「${sk.name}」横扫敌阵！`);
    } else if (tt === 'self' || tt === 'ally') {
      const target = tt === 'ally' ? this.lowestHpAlly(p.team, p.sessionId) : p;
      const heal = Math.round(p.matk * sk.power);
      target.hp = Math.min(target.maxHp, target.hp + heal);
      this.logMsg(p.name, `${p.name}「${sk.name}」→ ${target.name} +${heal} HP`);
    } else if (tt === 'ally-all') {
      for (const pl of this.state.players.values()) {
        if (!pl.alive || pl.team !== p.team) continue;
        const heal = Math.round(p.matk * sk.power);
        pl.hp = Math.min(pl.maxHp, pl.hp + heal);
      }
      this.logMsg(p.name, `${p.name}「${sk.name}」全队回复！`);
    }
  }

  private executeKido(p: CombatPlayer, k: KidoLoadoutDTO, targetId?: string): void {
    if (k.effectType === 'damage' || k.effectType === 'control') {
      const tid = this.resolveTarget(p.team, targetId); if (!tid) return;
      const e = this.state.players.get(tid)!;
      const r = calcMagicDamage(p.matk, e.mdef, k.power);
      e.hp = Math.max(0, e.hp - r.damage);
      this.logMsg(p.name, `${p.name} 鬼道 → ${e.name} -${r.damage}${r.crit ? '（暴击！）' : ''}`);
      if (e.hp <= 0) { e.alive = false; this.logMsg('system', `${e.name} 倒下了！`); }
    } else if (k.effectType === 'heal') {
      const target = this.lowestHpAlly(p.team, p.sessionId);
      const heal = Math.round(k.power);
      target.hp = Math.min(target.maxHp, target.hp + heal);
      this.logMsg(p.name, `${p.name} 回道 → ${target.name} +${heal} HP`);
    } else if (k.effectType === 'revive') {
      const target = this.lowestHpAlly(p.team, p.sessionId);
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
    let target: CombatPlayer = p;
    if (targetId && this.state.players.has(targetId)) {
      const t = this.state.players.get(targetId);
      if (t && t.alive && t.team === p.team) target = t;
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
      default: msg = '使用道具';
    }
    const who = target.sessionId === p.sessionId ? p.name : `${p.name}→${target.name}`;
    this.logMsg(p.name, `${who} 使用「${def.name}」${msg}`);
  }

  // ═══════════════ 胜负 ═══════════════
  /** 检查是否有一队全灭；是则结算对方胜。返回是否已结算。 */
  private checkVictory(): boolean {
    const teamAlive: Record<string, boolean> = {};
    for (const p of this.state.players.values()) {
      if (!teamAlive[p.team]) teamAlive[p.team] = false;
      if (p.alive) teamAlive[p.team] = true;
    }
    const aliveTeams = Object.keys(teamAlive).filter((t) => teamAlive[t]);
    if (aliveTeams.length <= 1) {
      // 全灭或仅一队存活 → 存活队胜（都死则判平，给 A 队胜以收尾）
      const winner = aliveTeams[0] || 'A';
      this.settle(winner);
      return true;
    }
    return false;
  }

  private settle(winnerTeam: string): void {
    if (this.settled) return;
    this.settled = true;
    this.state.phase = 'victory';
    this.state.winner = winnerTeam;
    this.clearCommandTimer(); this.clearExecTimer();
    this.logMsg('system', `竞技场结束：队伍 ${winnerTeam} 获胜！`);

    for (const p of this.state.players.values()) {
      const won = p.team === winnerTeam;
      const sid = p.sessionId;                       // pvp 房间会话 id
      const gsid = this.gameSid.get(sid);            // 游戏房会话 id
      const cid = this.charIdOf.get(sid);
      const pw = gsid ? world.get(gsid) : undefined;
      if (!pw) continue;
      const res = world.arenaRecordResult(pw, won);
      if (cid !== undefined) {
        try { saveCharacterWorld(cid, JSON.stringify(pw)); } catch {}
      }
      const c = this.clients.find((x: Client) => x.sessionId === sid);
      if (c) {
        c.send('arenaResult', {
          won,
          pointsDelta: res.delta,
          points: res.points,
          tier: res.tier,
          tierName: tierName(res.tier),
          promoted: res.promoted,
        });
      }
    }
  }

  // ═══════════════ 工具 ═══════════════
  private otherTeam(team: string): string { return team === 'A' ? 'B' : 'A'; }
  private isAlive(id: string): boolean {
    const p = this.state.players.get(id);
    return !!p && p.alive;
  }
  private spdOf(id: string): number { return this.state.players.get(id)?.spd ?? 0; }
  private spdCmp(a: string, b: string): number {
    const diff = this.spdOf(b) - this.spdOf(a);
    return diff !== 0 ? diff : a.localeCompare(b);
  }
  /** 解析攻击目标：优先指定敌方存活玩家；否则取敌方第一个存活。 */
  private resolveTarget(selfTeam: string, targetId?: string): string | undefined {
    if (targetId && this.state.players.has(targetId)) {
      const t = this.state.players.get(targetId)!;
      if (t.alive && t.team !== selfTeam) return targetId;
    }
    return this.firstAliveEnemyOf(selfTeam);
  }
  private firstAliveEnemyOf(selfTeam: string): string | undefined {
    for (const p of this.state.players.values()) if (p.alive && p.team !== selfTeam) return p.sessionId;
    return undefined;
  }
  private lowestHpAlly(team: string, selfId: string): CombatPlayer {
    let best: CombatPlayer | null = null;
    for (const pl of this.state.players.values()) {
      if (!pl.alive || pl.team !== team) continue;
      if (!best || pl.hp / pl.maxHp < best.hp / best.maxHp) best = pl;
    }
    return best || this.state.players.get(selfId)!;
  }
  private disconnectAll(): void {
    this.clients.forEach((c: Client) => c.leave());
  }
  private logMsg(who: string, text: string): void {
    const m = new ChatMessage(); m.name = who; m.text = text; m.t = Date.now();
    this.state.log.push(m);
    if (this.state.log.length > 100) this.state.log.shift();
  }
}
