/**
 * 联机权威状态 Schema（@colyseus/schema v3）
 * 仅服务端定义即可——客户端通过 room.state 按属性名读取，无需重复定义。
 */
import { Schema, MapSchema, ArraySchema, type } from '@colyseus/schema';

/** 共享地图房间：玩家（移动同步 + 聊天用） */
export class GamePlayer extends Schema {
  @type('string') sessionId = '';
  @type('string') name = '';
  @type('string') color = '';
  @type('number') x = 0;
  @type('number') y = 0;
}

export class ChatMessage extends Schema {
  @type('string') name = '';
  @type('string') text = '';
  @type('number') t = 0;
}

export class GameRoomState extends Schema {
  @type({ map: GamePlayer }) players = new MapSchema<GamePlayer>();
  @type([ChatMessage]) messages = new ArraySchema<ChatMessage>();
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
  @type([ChatMessage]) log = new ArraySchema<ChatMessage>();
  @type('string') winner = '';
}
