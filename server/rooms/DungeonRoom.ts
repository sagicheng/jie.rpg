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

    // 玩家清剿本阶全部明雷怪后按 F 领奖 → 服务端权威发放本阶奖励并推进阶段
    // 必须在 onCreate 中注册（Colyseus 0.15 onJoin 中注册的消息 handler 不生效）
    this.onMessage('claimStage', (c: Client, data: { stage?: number }) => {
      const s = Number(data?.stage) || 0;
      const p = this.state.players.get(c.sessionId);
      if (!p) return;
      if (s !== this.state.stage) return;
      if (this.state.phase === 'clear') return;

      // 全队发放：同副本房间的所有在场玩家（含跟随队员）都拿到本阶奖励。
      // grantLoot 内部对每件战利品 { ...item } 展开入包，不污染源 rw.loot，
      // 故 dungeonStageReward 只需计算一次，gold/exp/loot 对所有玩家一致。
      const rw = dungeonStageReward(this.state.dungeonId, s);
      this.state.players.forEach((dp: any) => {
        const pw = world.get(dp.gameSid);
        if (!pw) return;
        world.grantLoot(pw, rw.loot);
        world.gainExp(pw, rw.exp);
        world.addGold(pw, rw.gold);
        const target = this.clients.find((x: Client) => x.sessionId === dp.dungeonSid);
        if (target) target.send('claimStageReward', { gold: rw.gold, exp: rw.exp, loot: rw.loot.map(i => i.name) });
      });

    if (s >= 3) {
      this.state.phase = 'clear';
      // 全队标记副本完成（清除各自的活动副本，下次进入重新计次）
      this.state.players.forEach((dp: any) => {
        const pw = world.get(dp.gameSid);
        if (pw) world.completeDungeon(pw, this.state.dungeonId);
      });
      // 完成即毁图落库：清进度（pw.dungeon=null）后立即持久化，确保重连无僵尸续打。
      this.state.players.forEach((dp: any) => world.persistBySid(dp.gameSid));
      // 完成即毁图：清进度后兜底强制销毁房间（对齐老副本场景过期 +1s）。
      // disconnect() 会先断开全部在场客户端（触发其 room.onLeave → 自动返回主场景），
      // 再 dispose 房间，确保即便有客户端滞留，房间也不会成为孤儿实例。
      setTimeout(() => { try { this.disconnect(); } catch (e) { /* 已销毁 */ } }, 2500);
    } else {
      this.state.stage = s + 1;
      // 回写持久化 stage：掉线后重连可续到本阶（而非第1阶重来）
      this.state.players.forEach((dp: any) => {
        const pw = world.get(dp.gameSid);
        if (pw && pw.dungeon) pw.dungeon.stage = s + 1;
      });
      // 落库：副本内推进的 stage 立即持久化，确保断连重连（从 DB 重载）续到原阶。
      this.state.players.forEach((dp: any) => world.persistBySid(dp.gameSid));
    }
    });

    // 副本内位置同步（队友可见）：更新在场玩家 x/y，@colyseus/schema 自动广播给同房间
    this.onMessage('move', (c: Client, data: { x?: number; y?: number }) => {
      const p = this.state.players.get(c.sessionId);
      if (!p) return;
      if (typeof data?.x === 'number') p.x = data.x;
      if (typeof data?.y === 'number') p.y = data.y;
    });
  }

  onJoin(client: Client, options: { gameSid?: string; name?: string; color?: string; x?: number; y?: number }) {
    const gameSid = options?.gameSid || client.sessionId;
    const pw = world.get(gameSid);
    const res = world.enterDungeon(pw, this.state.dungeonId);
    if (!res.ok) {
      // 周次已用完：直接拒绝连接（抛错让 Colyseus 拒绝客户端 join，避免 dungeonError 消息竞态丢包）。
      // 客户端 joinOrCreate 的 Promise 会 reject，DungeonMapScene 收到 catch 后退出副本。
      throw new Error(res.msg || '本周副本次数已用完');
    }
    // 续打：用持久化的 stage 初始化房间进度。
    //  - 房间存活（还有别人）：沿用房间内最新 stage。
    //  - 房间已销毁（最后一人掉线）：重连开新房间，用 pw.dungeon.stage 续到原阶（而非从第1阶重来）。
    // Math.max 避免新加入队员把进度拉低。
    this.state.stage = Math.max(this.state.stage, (pw.dungeon && pw.dungeon.stage) || 1);
    // 进本即落库：把 enterDungeon 写入的 pw.dungeon（含 stage）持久化，
    // 否则仅内存推进、断连后从 DB 重载会丢失活动副本（重连当新本从第 1 阶重来）。
    world.persistBySid(gameSid);
    const dp = new DungeonPlayer();
    dp.dungeonSid = client.sessionId;
    dp.gameSid = gameSid;
    dp.name = (options?.name ?? '勇者').slice(0, 16);
    dp.color = (options?.color ?? '#4ecdc4').slice(0, 16);
    dp.x = Number(options?.x) || 0;
    dp.y = Number(options?.y) || 0;
    this.state.players.set(client.sessionId, dp);
  }

  onLeave(client: Client) {
    // 仅移出在场列表；进度存于 WorldService，断连不丢，可续打。
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    // no-op
  }
}
