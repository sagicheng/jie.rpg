/**
 * 副本房间注册表（进程内单例）。
 * BattleRoom 在副本战斗胜利后，需要通知对应的 DungeonRoom 推进阶进度；
 * 二者是独立的 Colyseus 房间，借此 Map 按 roomId 互相找到对方。
 */
import type { DungeonRoom } from './rooms/DungeonRoom';

const rooms = new Map<string, DungeonRoom>();

export const DungeonRegistry = {
  register(id: string, room: DungeonRoom): void {
    rooms.set(id, room);
  },
  unregister(id: string): void {
    rooms.delete(id);
  },
  get(id: string): DungeonRoom | undefined {
    return rooms.get(id);
  },
};
