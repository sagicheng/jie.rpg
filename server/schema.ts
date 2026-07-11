/**
 * 联机权威状态 Schema（@colyseus/schema v3）
 * 仅服务端定义即可——客户端通过 room.state 按属性名读取，无需重复定义。
 */
import { Schema, MapSchema, ArraySchema, type } from '@colyseus/schema';

/** 共享地图房间：玩家（移动同步 + 聊天用） */
export class GamePlayer extends Schema {
  @type('string') sessionId = '';
  @type('string') name = '';
  @type('string') title = '';
  @type('string') color = '';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('boolean') battling = false;   // 是否处于战斗中（用于远端名牌显示「战斗中」标签）
}

export class ChatMessage extends Schema {
  @type('string') name = '';
  @type('string') text = '';
  @type('number') t = 0;
}

/** 共享怪物状态机：available 可打 | busy 被某玩家锁定中(对其余玩家消失) | dead 已死(按 respawnAt 刷新)。 */
export class MonsterState extends Schema {
  @type('string') id = '';
  @type('string') state = 'available'; // available | busy | dead
  @type('string') owner = '';           // busy 时的锁定者 sessionId
  @type('number') respawnAt = 0;        // 何时重新 available（epoch ms，0=无需）
}

export class GameRoomState extends Schema {
  @type({ map: GamePlayer }) players = new MapSchema<GamePlayer>();
  @type([ChatMessage]) messages = new ArraySchema<ChatMessage>();
  /** 共享怪物权威状态：key = `${zone}:${序号}`。服务端驱动锁定/死亡/刷新，自动广播给同房所有客户端。 */
  @type({ map: MonsterState }) monsters = new MapSchema<MonsterState>();
}

/** 战斗房间：战斗员（玩家） */
export class CombatPlayer extends Schema {
  @type('string') sessionId = '';
  @type('string') name = '';
  @type('string') color = '';
  @type('number') hp = 0;
  @type('number') maxHp = 0;
  @type('number') atk = 0;
  @type('number') def = 0;
  @type('number') matk = 0;
  @type('number') mdef = 0;
  @type('number') spd = 0;
  @type('boolean') alive = true;
  @type('number') mp = 0;
  @type('number') maxMp = 0;
}

/** 战斗房间：敌人 */
export class CombatEnemy extends Schema {
  @type('string') id = '';
  @type('string') name = '';
  @type('string') type = '';
  @type('number') hp = 0;
  @type('number') maxHp = 0;
  @type('number') atk = 0;
  @type('number') def = 0;
  @type('number') matk = 0;
  @type('number') mdef = 0;
  @type('number') spd = 0;
  @type('boolean') alive = true;
}

export class BattleRoomState extends Schema {
  @type({ map: CombatPlayer }) players = new MapSchema<CombatPlayer>();
  @type({ map: CombatEnemy }) enemies = new MapSchema<CombatEnemy>();
  /** 回合顺序：玩家 sessionId 与敌人 id（'enemy:N'）交替，按 spd 降序 */
  @type(['string']) turnOrder = new ArraySchema<string>();
  @type('string') currentTurn = '';
  /** waiting | combat | victory | defeat */
  @type('string') phase = 'waiting';
  /** 当前行动者(玩家)的决策截止时间 epoch ms；>0 表示正在限时决策（敌人回合/非战斗为 0）。客户端据此显示 20s 倒计时。 */
  @type('number') turnExpiresAt = 0;
  @type([ChatMessage]) log = new ArraySchema<ChatMessage>();
  @type('string') winner = '';
}

/** 副本房间：独立实例（每副本一个，多人可同场）。
 *  仅维护轻量进度与在场玩家；实际战斗由 BattleRoom 承载（复用权威结算骨架）。 */
export class DungeonPlayer extends Schema {
  @type('string') dungeonSid = '';
  @type('string') gameSid = '';
  @type('string') name = '';
}

export class DungeonRoomState extends Schema {
  @type('number') dungeonId = 1;
  /** 副本当前进行到的阶（1|2|3，全队共享进度）。 */
  @type('number') stage = 1;
  /** lobby（进行中）| clear（3阶全通） */
  @type('string') phase = 'lobby';
  @type({ map: DungeonPlayer }) players = new MapSchema<DungeonPlayer>();
}
