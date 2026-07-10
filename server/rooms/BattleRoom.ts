/**
 * 权威战斗房间：组队打怪。
 * 关键原则——所有战斗数学在服务端用 src/systems 的纯函数跑（calcDamage / createEnemyData / generateLoot），
 * 客户端只发"意图"(action)，收到状态后播动画。这是联机防作弊 + 多端一致的基石。
 *
 * 注意：玩家属性当前由服务端给基础值（BASE_PLAYER）。真实属性后续接 recalcStats(GameState)，
 * 待账号/存档（stage D）落地后替换，不影响本切片架构验证。
 */
import { Room, Client } from '@colyseus/core';
import { BattleRoomState, CombatPlayer, CombatEnemy, ChatMessage } from '../schema';
import { createEnemyData, calcDamage, calcMagicDamage, generateLoot } from '../../src/systems/BattleData';
import type { EnemyData } from '../../src/systems/BattleData';
import { SKILL_BY_NAME, getSkillTargetType } from '../../src/systems/Skills';
import { CONSUMABLES } from '../../src/systems/ConsumableSystem';

/** 客户端进房时携带的战斗配置（可用技能/鬼道/道具），用于服务端权威校验与结算。 */
interface KidoLoadoutDTO {
  id: string;
  mp: number;
  power: number;                                  // 已含等级的威力倍率
  effectType: string;                             // damage | control | heal | shield | revive | cleanse
  target?: string;                                // single | all
  reviveHpPercent?: number;
}
interface PlayerLoadout {
  skills: Set<string>;
  kidos: Map<string, KidoLoadoutDTO>;
  items: Set<string>;
}
const EMPTY_LOADOUT: PlayerLoadout = { skills: new Set(), kidos: new Map(), items: new Set() };

const COLORS = ['#ff6b6b', '#4ecdc4', '#ffd93d', '#a78bfa', '#ff9f43', '#54a0ff'];
const BASE_PLAYER = { hp: 220, atk: 42, def: 18, matk: 36, mdef: 16, spd: 12, mp: 120, maxMp: 120 };

export class BattleRoom extends Room<BattleRoomState> {
  private enemyDef!: EnemyData;
  /** 本回合处于防御姿态的玩家 sessionId 集合（防御只减伤一次敌人攻击） */
  private defending: Set<string> = new Set();
  /** 每玩家的可用技能/鬼道/道具（仅服务端内存，不进 schema） */
  private loadouts: Map<string, PlayerLoadout> = new Map();

  onCreate(options: { monsterId?: string }) {
    // matchmaking：按 monsterId 隔离房间（地图怪各自独立，V键组队统一 ''）
    this.setMetadata({ monsterId: options.monsterId ?? '' });
    this.setState(new BattleRoomState());
    this.onMessage('startbattle', () => this.tryBeginCombat());
    this.onMessage('action', (client, data: { type?: string; targetId?: string }) => this.handleAction(client, data));
  }

  onJoin(client: Client, options: { name?: string; enemyData?: any; monsterId?: string; loadout?: { skills?: string[]; kidos?: KidoLoadoutDTO[]; items?: string[] } }) {
    const p = new CombatPlayer();
    p.sessionId = client.sessionId;
    p.name = (options?.name ?? '勇者').slice(0, 16);
    p.color = COLORS[Math.floor(Math.random() * COLORS.length)];
    p.maxHp = BASE_PLAYER.hp;
    p.hp = BASE_PLAYER.hp;
    p.atk = BASE_PLAYER.atk;
    p.def = BASE_PLAYER.def;
    p.matk = BASE_PLAYER.matk;
    p.mdef = BASE_PLAYER.mdef;
    p.spd = BASE_PLAYER.spd;
    p.mp = BASE_PLAYER.mp;
    p.maxMp = BASE_PLAYER.maxMp;
    p.alive = true;
    this.state.players.set(client.sessionId, p);

    // 记录玩家可用技能/鬼道/道具，供后续意图权威校验与结算
    const lo: PlayerLoadout = { skills: new Set(), kidos: new Map(), items: new Set() };
    const l = options?.loadout;
    if (l) {
      if (Array.isArray(l.skills)) for (const s of l.skills) if (typeof s === 'string') lo.skills.add(s);
      if (Array.isArray(l.kidos)) for (const k of l.kidos) if (k && typeof k.id === 'string') lo.kidos.set(k.id, k);
      if (Array.isArray(l.items)) for (const i of l.items) if (typeof i === 'string') lo.items.add(i);
    }
    this.loadouts.set(client.sessionId, lo);

    this.logMsg('system', `${p.name} 加入了战斗`);

    // 地图怪遭遇战：携带真实怪数据 → 单人立即开战（权威结算，根除双杀双掉落）
    if (options?.enemyData && options.enemyData.name) {
      this.enemyDef = options.enemyData as EnemyData;
      this.tryBeginCombat();
      return;
    }
    // V键组队：满 2 人自动开局（单人可发 startbattle 主动开战，见 MultiBattleScene）
    if (this.state.phase === 'waiting' && this.state.players.size >= 2) {
      this.tryBeginCombat();
    }
  }

  onLeave(client: Client) {
    this.loadouts.delete(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (p) p.alive = false;
    if (this.state.phase === 'combat') this.advanceTurn();
  }

  // ——— 战斗开始 ———
  private tryBeginCombat() {
    if (this.state.phase !== 'waiting') return;
    if (this.state.players.size < 1) return;

    // 地图怪模式：onJoin 已设置 this.enemyDef（真实怪）；V键组队：仍用虚怪
    const ed: EnemyData = this.enemyDef && this.enemyDef.name ? this.enemyDef : createEnemyData('虚', '杂妖', '火', 2);
    this.enemyDef = ed;

    const e = new CombatEnemy();
    e.id = 'enemy:0';
    e.name = ed.name;
    e.type = ed.type;
    e.maxHp = ed.maxHp;
    e.hp = ed.hp;
    e.atk = ed.atk;
    e.def = ed.def;
    e.matk = ed.matk;
    e.mdef = ed.mdef;
    e.spd = ed.spd;
    e.alive = true;
    this.state.enemies.set(e.id, e);

    const order: string[] = [];
    this.state.players.forEach((pl) => order.push(pl.sessionId));
    order.push(e.id);
    order.sort((a, b) => this.spdOf(b) - this.spdOf(a)); // 按 spd 降序

    this.state.turnOrder.splice(0, this.state.turnOrder.length, ...order);
    this.state.phase = 'combat';
    this.state.currentTurn = this.state.turnOrder[0] ?? '';
    this.logMsg('system', `战斗开始！${this.state.players.size} 名队员 VS ${ed.name}`);

    this.maybeRunEnemyTurn();
  }

  // ——— 玩家意图处理（权威结算）———
  private handleAction(client: Client, data: { type?: string; id?: string; targetId?: string }) {
    if (this.state.phase !== 'combat') return;
    if (this.state.currentTurn !== client.sessionId) return; // 非当前行动者，忽略
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive) return;

    // 防御只持续一轮：玩家再次行动时清除自身防御标记（覆盖中间的敌人回合）
    this.defending.delete(client.sessionId);
    const lo = this.loadouts.get(client.sessionId) || EMPTY_LOADOUT;

    // ——— 攻击（物理单体，可指定目标）———
    if (data.type === 'attack') {
      const targetId = this.resolveTarget(data.targetId);
      if (!targetId) return;
      const e = this.state.enemies.get(targetId)!;
      const r = calcDamage(p.atk, e.def, 1.0);
      e.hp = Math.max(0, e.hp - r.damage);
      this.logMsg(p.name, `${p.name} 斩击 ${e.name} 造成 ${r.damage} 伤害${r.crit ? '（暴击！）' : ''}`);
      if (e.hp <= 0) { e.alive = false; this.logMsg('system', `${e.name} 被击败！`); }
      if (this.checkVictory()) return;
      this.advanceTurn();
      return;
    }

    // ——— 斩魄刀技能（按技能名权威解析：伤害/治疗/控制）———
    if (data.type === 'skill') {
      const sk = data.id ? SKILL_BY_NAME[data.id] : undefined;
      if (!sk || !lo.skills.has(sk.name)) { this.logMsg('system', `${p.name} 使用了无效的技能`); return; }
      if (p.mp < sk.mp) { this.logMsg('system', `${p.name} 灵力不足，无法施展「${sk.name}」`); return; }
      p.mp = Math.max(0, p.mp - sk.mp);
      const tt = getSkillTargetType(sk);
      const magic = sk.damageType === 'magical';

      if (tt === 'enemy') {
        const targetId = this.resolveTarget(data.targetId);
        if (!targetId) return;
        const e = this.state.enemies.get(targetId)!;
        const r = magic ? calcMagicDamage(p.matk, e.mdef, sk.power) : calcDamage(p.atk, e.def, sk.power);
        e.hp = Math.max(0, e.hp - r.damage);
        this.logMsg(p.name, `${p.name} 施展「${sk.name}」对 ${e.name} 造成 ${r.damage} 伤害${r.crit ? '（暴击！）' : ''}${sk.statusEffect ? `（附带${sk.statusEffect.subtype}）` : ''}`);
        if (e.hp <= 0) { e.alive = false; this.logMsg('system', `${e.name} 被击败！`); }
      } else if (tt === 'enemy-all') {
        for (const e of this.state.enemies.values()) {
          if (!e.alive) continue;
          const r = magic ? calcMagicDamage(p.matk, e.mdef, sk.power) : calcDamage(p.atk, e.def, sk.power);
          e.hp = Math.max(0, e.hp - r.damage);
          if (e.hp <= 0) { e.alive = false; this.logMsg('system', `${e.name} 被击败！`); }
        }
        this.logMsg(p.name, `${p.name} 施展「${sk.name}」横扫全场！`);
      } else if (tt === 'self' || tt === 'ally') {
        const target = tt === 'ally' ? this.lowestHpAlly(p.sessionId) : p;
        const heal = Math.round(p.matk * sk.power);
        target.hp = Math.min(target.maxHp, target.hp + heal);
        this.logMsg(p.name, `${p.name} 施展「${sk.name}」为 ${target.name} 回复 ${heal} HP`);
      } else if (tt === 'ally-all') {
        for (const pl of this.state.players.values()) {
          if (!pl.alive) continue;
          const heal = Math.round(p.matk * sk.power);
          pl.hp = Math.min(pl.maxHp, pl.hp + heal);
        }
        this.logMsg(p.name, `${p.name} 施展「${sk.name}」全队回复！`);
      }
      if (this.checkVictory()) return;
      this.advanceTurn();
      return;
    }

    // ——— 鬼道（按 kidoId 权威解析：伤害/治疗/复活/控制）———
    if (data.type === 'kido') {
      const k = data.id ? lo.kidos.get(data.id) : undefined;
      if (!k) { this.logMsg('system', `${p.name} 使用了无效的鬼道`); return; }
      if (p.mp < k.mp) { this.logMsg('system', `${p.name} 灵力不足，无法施展鬼道`); return; }
      p.mp = Math.max(0, p.mp - k.mp);

      if (k.effectType === 'damage') {
        const targetId = this.resolveTarget(data.targetId);
        if (!targetId) return;
        const e = this.state.enemies.get(targetId)!;
        const r = calcMagicDamage(p.matk, e.mdef, k.power);
        e.hp = Math.max(0, e.hp - r.damage);
        this.logMsg(p.name, `${p.name} 施展鬼道对 ${e.name} 造成 ${r.damage} 伤害${r.crit ? '（暴击！）' : ''}`);
        if (e.hp <= 0) { e.alive = false; this.logMsg('system', `${e.name} 被击败！`); }
      } else if (k.effectType === 'heal') {
        const target = this.lowestHpAlly(p.sessionId);
        const heal = Math.round(k.power); // 回道 basePower 即固定回复量（已含等级缩放）
        target.hp = Math.min(target.maxHp, target.hp + heal);
        this.logMsg(p.name, `${p.name} 施展回道为 ${target.name} 回复 ${heal} HP`);
      } else if (k.effectType === 'revive') {
        const target = this.lowestHpAlly(p.sessionId);
        if (!target.alive) {
          const pct = k.reviveHpPercent ?? 50;
          target.hp = Math.round(target.maxHp * pct / 100);
          target.alive = true;
          this.logMsg(p.name, `${p.name} 施展鬼道令 ${target.name} 以 ${pct}% HP 复活！`);
        } else {
          this.logMsg(p.name, `${p.name} 的复活鬼道对存活目标无效`);
        }
      } else {
        // control / shield / cleanse：本切片仅记录，不施加机械效果（完整状态机为后续 stage）
        this.logMsg(p.name, `${p.name} 施展鬼道（${k.effectType}）`);
      }
      if (this.checkVictory()) return;
      this.advanceTurn();
      return;
    }

    // ——— 道具（按 itemId 权威解析消耗品效果）———
    if (data.type === 'item') {
      const itemId = data.id || '';
      if (!lo.items.has(itemId)) { this.logMsg('system', `${p.name} 使用了无效的道具`); return; }
      const def = CONSUMABLES[itemId];
      if (!def) { this.logMsg('system', `${p.name} 使用了未知道具`); return; }
      const eff = def.effect;
      let msg = '';
      switch (eff.type) {
        case 'heal_hp': { const h = Math.min(p.maxHp, p.hp + (eff.hpAmount || 0)); msg = `回复 ${h - p.hp} HP`; p.hp = h; break; }
        case 'heal_mp': { const m = Math.min(p.maxMp, p.mp + (eff.mpAmount || 0)); msg = `回复 ${m - p.mp} MP`; p.mp = m; break; }
        case 'heal_both': { const h = Math.min(p.maxHp, p.hp + (eff.hpAmount || 0)); const m = Math.min(p.maxMp, p.mp + (eff.mpAmount || 0)); msg = `回复 ${h - p.hp} HP + ${m - p.mp} MP`; p.hp = h; p.mp = m; break; }
        case 'full_heal': { p.hp = p.maxHp; p.mp = p.maxMp; msg = 'HP·MP 完全回复'; break; }
        case 'revive': {
          if (!p.alive) { p.hp = Math.round(p.maxHp * (eff.reviveHpPercent || 50) / 100); p.alive = true; msg = `以 ${eff.reviveHpPercent}% HP 复活`; }
          else { const h = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.3)); msg = `回复 ${h - p.hp} HP`; p.hp = h; }
          break;
        }
        case 'cure_status': { msg = '异常状态已净化'; break; }
        case 'buff_temp': {
          const stat = eff.buffStat || 'atk';
          const v = eff.buffValue || 0;
          if (stat === 'atk') p.atk = Math.round(p.atk * (1 + v));
          else if (stat === 'def') p.def = Math.round(p.def * (1 + v));
          else if (stat === 'matk') p.matk = Math.round(p.matk * (1 + v));
          else if (stat === 'mdef') p.mdef = Math.round(p.mdef * (1 + v));
          else if (stat === 'spd') p.spd = Math.round(p.spd * (1 + v));
          msg = `${stat} 提升`;
          break;
        }
        default: msg = '使用道具';
      }
      this.logMsg(p.name, `${p.name} 使用「${def.name}」${msg}`);
      if (this.checkVictory()) return;
      this.advanceTurn();
      return;
    }

    // ——— 防御：减伤下一次受到的敌人伤害 ———
    if (data.type === 'defend') {
      this.defending.add(client.sessionId);
      this.logMsg(p.name, `${p.name} 进入防御姿态（下次受伤减伤）`);
      this.advanceTurn();
      return;
    }

    // ——— 逃跑：按速度差算概率，成功则脱离战斗 ———
    if (data.type === 'escape') {
      const aliveEnemies = [...this.state.enemies.values()].filter((e) => e.alive);
      const avgSpd = aliveEnemies.length ? aliveEnemies.reduce((s, e) => s + e.spd, 0) / aliveEnemies.length : 0;
      let rate = 0.5 + (p.spd - avgSpd) * 0.03;
      rate = Math.max(0.1, Math.min(0.95, rate));
      if (Math.random() < rate) {
        this.state.phase = 'fled';
        this.state.winner = 'escape';
        this.logMsg('system', `${p.name} 成功逃脱！`);
        return;
      }
      this.logMsg('system', `${p.name} 逃跑失败，被敌人包围！`);
      this.advanceTurn();
      return;
    }
  }

  /** 选取 HP 比例最低的存活友方（单人战斗即自身），用于治疗/复活目标。 */
  private lowestHpAlly(selfId: string): CombatPlayer {
    let best: CombatPlayer | null = null;
    for (const pl of this.state.players.values()) {
      if (!pl.alive) continue;
      if (!best || pl.hp / pl.maxHp < best.hp / best.maxHp) best = pl;
    }
    return best || this.state.players.get(selfId)!;
  }

  /** 解析攻击目标：优先指定 id（存活），否则首个存活敌人。 */
  private resolveTarget(targetId?: string): string | undefined {
    if (targetId && this.state.enemies.has(targetId) && this.state.enemies.get(targetId)!.alive) return targetId;
    return this.firstAliveEnemy();
  }

  // ——— 回合推进 ———
  private advanceTurn() {
    if (this.state.phase !== 'combat') return;
    const order = this.state.turnOrder;
    if (order.length === 0) return;

    const idx = order.indexOf(this.state.currentTurn);
    let nextIdx = (idx + 1) % order.length;
    let guard = 0;
    while (guard < order.length) {
      const id = order[nextIdx]!;
      if (this.isAlive(id)) {
        this.state.currentTurn = id;
        break;
      }
      nextIdx = (nextIdx + 1) % order.length;
      guard++;
    }
    if (guard >= order.length) return; // 不应发生（胜负已判定）
    this.maybeRunEnemyTurn();
  }

  // ——— 敌人 AI（服务端自动结算）———
  private maybeRunEnemyTurn() {
    if (this.state.phase !== 'combat') return;
    const id = this.state.currentTurn;
    if (!id.startsWith('enemy:')) return; // 玩家回合，等客户端发意图

    const e = this.state.enemies.get(id);
    if (!e || !e.alive) {
      this.advanceTurn();
      return;
    }

    const alivePlayers = [...this.state.players.values()].filter((p) => p.alive);
    if (alivePlayers.length === 0) {
      this.checkDefeat();
      return;
    }
    const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    const r = calcDamage(e.atk, target.def, 1.0);
    let dmg = r.damage;
    const isDefending = this.defending.has(target.sessionId);
    if (isDefending) dmg = Math.round(dmg * 0.2);
    target.hp = Math.max(0, target.hp - dmg);
    this.logMsg(e.name, `${e.name} 攻击 ${target.name} 造成 ${dmg} 伤害${r.crit ? '（暴击！）' : ''}${isDefending ? '（防御减伤）' : ''}`);

    if (target.hp <= 0) {
      target.alive = false;
      this.logMsg('system', `${target.name} 倒下了！`);
      if (this.checkDefeat()) return;
    }
    this.advanceTurn();
  }

  // ——— 胜负判定 ———
  private checkVictory(): boolean {
    const anyEnemy = [...this.state.enemies.values()].some((e) => e.alive);
    if (anyEnemy) return false;
    this.state.phase = 'victory';
    this.state.winner = 'players';
    const loot = generateLoot(this.enemyDef.type, this.enemyDef.zone);
    const lootNames = loot.map((i) => i.name).join('、') || '无';
    this.logMsg('system', `胜利！获得战利品：${lootNames}`);
    return true;
  }

  private checkDefeat(): boolean {
    const anyPlayer = [...this.state.players.values()].some((p) => p.alive);
    if (anyPlayer) return false;
    this.state.phase = 'defeat';
    this.state.winner = 'enemy';
    this.logMsg('system', '全员阵亡……战斗失败。');
    return true;
  }

  // ——— 工具 ———
  private isAlive(id: string): boolean {
    if (this.state.players.has(id)) return this.state.players.get(id)!.alive;
    const e = this.state.enemies.get(id);
    return !!e && e.alive;
  }

  private spdOf(id: string): number {
    if (this.state.players.has(id)) return this.state.players.get(id)!.spd;
    return this.state.enemies.get(id)?.spd ?? 0;
  }

  private firstAliveEnemy(): string | undefined {
    for (const e of this.state.enemies.values()) if (e.alive) return e.id;
    return undefined;
  }

  private logMsg(who: string, text: string) {
    const m = new ChatMessage();
    m.name = who;
    m.text = text;
    m.t = Date.now();
    this.state.log.push(m);
    if (this.state.log.length > 100) this.state.log.shift();
  }
}
