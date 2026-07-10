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

const COLORS = ['#ff6b6b', '#4ecdc4', '#ffd93d', '#a78bfa', '#ff9f43', '#54a0ff'];
const BASE_PLAYER = { hp: 220, atk: 42, def: 18, matk: 36, mdef: 16, spd: 12, mp: 120, maxMp: 120 };

export class BattleRoom extends Room<BattleRoomState> {
  private enemyDef!: EnemyData;
  /** 本回合处于防御姿态的玩家 sessionId 集合（防御只减伤一次敌人攻击） */
  private defending: Set<string> = new Set();

  onCreate(options: { monsterId?: string }) {
    // matchmaking：按 monsterId 隔离房间（地图怪各自独立，V键组队统一 ''）
    this.setMetadata({ monsterId: options.monsterId ?? '' });
    this.setState(new BattleRoomState());
    this.onMessage('startbattle', () => this.tryBeginCombat());
    this.onMessage('action', (client, data: { type?: string; targetId?: string }) => this.handleAction(client, data));
  }

  onJoin(client: Client, options: { name?: string; enemyData?: any; monsterId?: string }) {
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
  private handleAction(client: Client, data: { type?: string; targetId?: string }) {
    if (this.state.phase !== 'combat') return;
    if (this.state.currentTurn !== client.sessionId) return; // 非当前行动者，忽略
    const p = this.state.players.get(client.sessionId);
    if (!p || !p.alive) return;

    // 防御只持续一轮：玩家再次行动时清除自身防御标记（覆盖中间的敌人回合）
    this.defending.delete(client.sessionId);

    // 攻击 / 斩魄刀技能：物理伤害
    if (data.type === 'attack' || data.type === 'skill') {
      const targetId = this.resolveTarget(data.targetId);
      if (!targetId) return;
      const e = this.state.enemies.get(targetId)!;
      const r = calcDamage(p.atk, e.def, 1.0);
      e.hp = Math.max(0, e.hp - r.damage);
      this.logMsg(p.name, `${p.name} 使用${data.type === 'attack' ? '斩击' : '技能'}对 ${e.name} 造成 ${r.damage} 伤害${r.crit ? '（暴击！）' : ''}`);
      if (e.hp <= 0) { e.alive = false; this.logMsg('system', `${e.name} 被击败！`); if (this.checkVictory()) return; }
      this.advanceTurn();
      return;
    }

    // 鬼道：魔法伤害（耗蓝）
    if (data.type === 'kido') {
      if (p.mp < 15) { this.logMsg('system', '灵力不足，无法施展鬼道'); return; }
      const targetId = this.resolveTarget(data.targetId);
      if (!targetId) return;
      const e = this.state.enemies.get(targetId)!;
      p.mp = Math.max(0, p.mp - 15);
      const r = calcMagicDamage(p.matk, e.mdef, 1.3);
      e.hp = Math.max(0, e.hp - r.damage);
      this.logMsg(p.name, `${p.name} 施展鬼道对 ${e.name} 造成 ${r.damage} 伤害${r.crit ? '（暴击！）' : ''}`);
      if (e.hp <= 0) { e.alive = false; this.logMsg('system', `${e.name} 被击败！`); if (this.checkVictory()) return; }
      this.advanceTurn();
      return;
    }

    // 道具：回复 HP/MP（服务端无背包，统一基础回复）
    if (data.type === 'item') {
      const healHp = Math.round(p.maxHp * 0.4);
      const healMp = Math.round(p.maxMp * 0.4);
      p.hp = Math.min(p.maxHp, p.hp + healHp);
      p.mp = Math.min(p.maxMp, p.mp + healMp);
      this.logMsg(p.name, `${p.name} 使用道具，回复 HP${healHp} / MP${healMp}`);
      this.advanceTurn();
      return;
    }

    // 防御：减伤下一次受到的敌人伤害
    if (data.type === 'defend') {
      this.defending.add(client.sessionId);
      this.logMsg(p.name, `${p.name} 进入防御姿态（下次受伤减伤）`);
      this.advanceTurn();
      return;
    }

    // 逃跑：按速度差算概率，成功则脱离战斗
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
