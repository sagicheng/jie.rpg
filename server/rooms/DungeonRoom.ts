/**
 * 副本独立实例房间（每副本一个，多人可同场）。
 * 轻量：仅维护副本进度（当前阶 stage / 通关 phase）与在场玩家；
 * 实际战斗由 BattleRoom 承载（复用权威结算骨架），胜利后 BattleRoom 经
 * DungeonRegistry 回调本房间的 onStageCleared 推进进度。
 *
 * 断连恢复：玩家掉线时仅移出在场列表，进度（当前阶/周次）存于 WorldService，
 * 重连（再次进本副本）时 world.enterDungeon 判定为"续打"不重复计次，进度延续。
 */
import { Room, Client } from '@colyseus/core';
import { DungeonRoomState, DungeonPlayer } from '../schema';
import { world } from '../world';
import { DungeonRegistry } from '../DungeonRegistry';

export class DungeonRoom extends Room<DungeonRoomState> {
  onCreate(options: { dungeonId?: number }) {
    this.setState(new DungeonRoomState());
    this.state.dungeonId = options?.dungeonId ?? 1;
    this.state.stage = 1;
    this.state.phase = 'lobby';
    DungeonRegistry.register(this.roomId, this);
  }

  onJoin(client: Client, options: { gameSid?: string; name?: string }) {
    const gameSid = options?.gameSid || client.sessionId;
    const pw = world.get(gameSid);
    const res = world.enterDungeon(pw, this.state.dungeonId);
    if (!res.ok) {
      // 周次已用完：通知客户端并让其主动离房（不在 onJoin 内强制 leave，避免边界异常）
      client.send('dungeonError', { msg: res.msg || '无法进入副本' });
      return;
    }
    const dp = new DungeonPlayer();
    dp.dungeonSid = client.sessionId;
    dp.gameSid = gameSid;
    dp.name = (options?.name ?? '勇者').slice(0, 16);
    this.state.players.set(client.sessionId, dp);
  }

  onLeave(client: Client) {
    // 仅移出在场列表；进度存于 WorldService，断连不丢，可续打。
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    DungeonRegistry.unregister(this.roomId);
  }

  /** 由 BattleRoom 在副本某阶战斗胜利后调用：推进全局阶进度。 */
  onStageCleared(stage: number, _gameSids: string[]): void {
    if (stage >= this.state.stage && this.state.stage < 3) {
      this.state.stage = this.state.stage + 1;
    }
    if (stage >= 3) this.state.phase = 'clear';
  }
}
