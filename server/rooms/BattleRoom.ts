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
const BASE_PLAYER = { hp: 220, atk: 42, def: 18, matk: 36, mdef: 16, spd: 12 };

export class BattleRoom extends Room<BattleRoomState> {
  private enemyDef!: EnemyData;

  onCreate() {
    this.setState(new BattleRoomState());
    this.onMessage('startbattle', () => this.tryBeginCombat());
    this.onMessage('action', (client, data: { type?: string; targetId?: string }) => this.handleAction(client, data));
  }

  onJoin(client: Client, options: { name?: string }) {
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
    p.alive = true;
    this.state.players.set(client.sessionId, p);
    this.logMsg('system', `${p.name} 加入了战斗`);

    // 组队满 2 人自动开局（切片验证用；单人可发 startbattle 主动开战）
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

    const ed = createEnemyData('虚', '杂妖', '火', 2);
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

    const targetId = (data.targetId && this.state.enemies.has(data.targetId) && this.state.enemies.get(data.targetId)!.alive)
      ? data.targetId
      : this.firstAliveEnemy();
    if (!targetId) return;

    const e = this.state.enemies.get(targetId)!;
    const isSkill = data.type === 'skill';
    const r = isSkill ? calcMagicDamage(p.matk, e.mdef, 1.3) : calcDamage(p.atk, e.def, 1.0);
    const dmg = r.damage;
    e.hp = Math.max(0, e.hp - dmg);

    this.logMsg(p.name, `${p.name} 使用${isSkill ? '鬼道' : '斩击'}对 ${e.name} 造成 ${dmg} 伤害${r.crit ? '（暴击！）' : ''}`);

    if (e.hp <= 0) {
      e.alive = false;
      this.logMsg('system', `${e.name} 被击败！`);
      if (this.checkVictory()) return;
    }
    this.advanceTurn();
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
    const dmg = r.damage;
    target.hp = Math.max(0, target.hp - dmg);
    this.logMsg(e.name, `${e.name} 攻击 ${target.name} 造成 ${dmg} 伤害${r.crit ? '（暴击！）' : ''}`);

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
    const loot = generateLoot('杂妖', 2);
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
