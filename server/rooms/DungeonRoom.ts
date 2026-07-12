/**
 * 副本独立实例房间（每副本一个，多人可同场）。
 * 轻量：仅维护副本进度（当前阶 stage / 通关 phase）与在场玩家；
 * 实际战斗由 BattleRoom 承载（复用权威结算骨架）。
 * 阶段推进：玩家逐只击杀本阶全部明雷怪后按 F 领奖 → 发送 claimStage → 服务端权威发奖+推进。
 *
 * 断连恢复：玩家掉线时仅移出在场列表，进度（当前阶/周次）存于 WorldService，
 * 重连（再次进本副本）时 world.enterDungeon 判定为"续打"不重复计次，进度延续。
 */
import { Room, Client } from '@colyseus/core';
import { DungeonRoomState, DungeonPlayer } from '../schema';
import { world } from '../world';
import { dungeonStageReward } from '../../src/systems/BattleData';

export class DungeonRoom extends Room<DungeonRoomState> {
  onCreate(options: { dungeonId?: number }) {
    this.setState(new DungeonRoomState());
    this.state.dungeonId = options?.dungeonId ?? 1;
    this.state.stage = 1;
    this.state.phase = 'lobby';
  }

  onJoin(client: Client, options: { gameSid?: string; name?: string }) {
    const gameSid = options?.gameSid || client.sessionId;
    const pw = world.get(gameSid);
    const res = world.enterDungeon(pw, this.state.dungeonId);
    if (!res.ok) {
      // 周次已用完：直接拒绝连接（抛错让 Colyseus 拒绝客户端 join，避免 dungeonError 消息竞态丢包）。
      // 客户端 joinOrCreate 的 Promise 会 reject，DungeonMapScene 收到 catch 后退出副本。
      throw new Error(res.msg || '本周副本次数已用完');
    }
    const dp = new DungeonPlayer();
    dp.dungeonSid = client.sessionId;
    dp.gameSid = gameSid;
    dp.name = (options?.name ?? '勇者').slice(0, 16);
    this.state.players.set(client.sessionId, dp);

    // 玩家清剿本阶全部明雷怪后按 F 领奖 → 服务端权威发放本阶奖励并推进阶段
    this.onMessage('claimStage', async (c: Client, data: { stage?: number }) => {
      const p = this.state.players.get(c.sessionId);
      if (!p) return;
      const s = Number(data?.stage) || 0;
      if (s !== this.state.stage) return;
      if (this.state.phase === 'clear') return;

      const pw = world.get(p.gameSid);
      const rw = dungeonStageReward(this.state.dungeonId, s);
      world.grantLoot(pw, rw.loot);
      world.gainExp(pw, rw.exp);
      world.addGold(pw, rw.gold);
      c.send('claimStageReward', { gold: rw.gold, exp: rw.exp, loot: rw.loot.map(i => i.name) });

      if (s >= 3) {
        this.state.phase = 'clear';
        world.completeDungeon(pw, this.state.dungeonId);
      } else {
        this.state.stage = s + 1;
      }
    });
  }

  onLeave(client: Client) {
    // 仅移出在场列表；进度存于 WorldService，断连不丢，可续打。
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    // no-op
  }
}
