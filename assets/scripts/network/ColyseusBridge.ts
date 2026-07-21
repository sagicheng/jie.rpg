/**
 * Colyseus 联机桥接：封装 colyseus.js（以 UMD 插件脚本注入的全局 Colyseus）。
 *
 * 协议严格对齐 server/api/GameRoom.ts：
 *   - 进房 joinOrCreate('game', { token, characterId, title })，缺 token/characterId 会被服务端踢。
 *   - 状态按属性名读取（@colyseus/schema 自动解码），客户端无需重复定义 Schema。
 *   - 消息：move / enterBattle / killMonster / chat / worldSync / authError。
 *
 * 客户端库版本固定 colyseus.js 0.15.28（与服务器 Colyseus 0.15 一致，已验证可连）。
 */
declare const Colyseus: any;

import { log } from 'cc';

export interface PlayerView {
  sessionId: string;
  name: string;
  title: string;
  color: string;
  x: number;
  y: number;
  battling: boolean;
  teamId: string;
}

export interface MonsterView {
  id: string;
  state: string;   // available | busy | dead
  owner: string;
  respawnAt: number;
}

export class ColyseusBridge {
  client: any = null;
  room: any = null;
  selfId = '';

  // 轮询同步用的本地已知 key 集合（diff 增量）
  private knownPlayers = new Set<string>();
  private knownMonsters = new Set<string>();
  private lastPlayerPos = new Map<string, { x: number; y: number }>();
  private lastMonsterState = new Map<string, string>();
  private syncTimer: any = null;

  // —— 外部回调（由 GameManager 赋值）——
  onPlayerAdd: (p: PlayerView, key: string) => void = () => {};
  onPlayerChange: (p: PlayerView, key: string) => void = () => {};
  onPlayerRemove: (key: string) => void = () => {};
  onMonsterChange: (m: MonsterView, key: string) => void = () => {};
  onWorldSync: (pw: any) => void = () => {};
  onChat: (msg: any) => void = () => {};
  onAuthError: (msg: string) => void = () => {};
  onError: (msg: string) => void = () => {};
  onLeave: (code: number) => void = () => {};

  async connect(endpoint: string, token: string, characterId: number, title: string): Promise<any> {
    this.client = new Colyseus.Client(endpoint);
    this.room = await this.client.joinOrCreate('game', { token, characterId, title });
    this.selfId = this.room.sessionId;
    this.bind();
    return this.room;
  }

  private bind(): void {
    try {
      const room = this.room;
      const st = room.state;
      console.log('[Bridge诊断] bind 开始 state=' + (st ? (st.constructor?.name || typeof st) : 'undefined') +
        ' players=' + (st?.players ? (st.players.constructor?.name + ' size=' + st.players.size) : 'missing'));

      room.onMessage('worldSync', (pw: any) => this.onWorldSync(pw));
      room.onMessage('chat', (msg: any) => this.onChat(msg));
      room.onMessage('authError', (msg: any) => this.onAuthError(typeof msg === 'string' ? msg : (msg?.msg || 'authError')));

      room.onError((code: number, msg: string) => this.onError(msg || ('code ' + code)));
      room.onLeave((code: number) => this.onLeave(code));

      // 启动轮询同步（绕过 Colyseus onAdd/onChange 回调——Cocos 预览环境下该回调不触发）。
      // 直接每隔 300ms 读取 room.state 做增量 diff，保证服务端状态最终一致地渲染到前端。
      this.startSyncLoop();

      // 2s 后诊断：确认服务端数据是否已到达客户端 state（decode 是否成功）
      setTimeout(() => {
        try {
          const s = this.room?.state;
          const ps = s?.players;
          const ms = s?.monsters;
          console.log('[Bridge诊断] 2s 后 players.size=' + (ps ? ps.size : 'n/a') +
            ' monsters.size=' + (ms ? ms.size : 'n/a') +
            ' knownPlayers=' + this.knownPlayers.size);
        } catch (e: any) { console.error('[Bridge诊断] 2s 异常 ' + (e?.message || e)); }
      }, 2000);
    } catch (e: any) {
      console.error('[Bridge诊断] bind 异常：' + (e?.message || e));
    }
  }

  // ——— 轮询同步（替代不可靠的 onAdd/onChange）———
  private startSyncLoop(): void {
    this.stopSyncLoop();
    this.syncTimer = setInterval(() => this.syncTick(), 300);
  }

  private stopSyncLoop(): void {
    if (this.syncTimer !== null) { clearInterval(this.syncTimer); this.syncTimer = null; }
  }

  private syncTick(): void {
    const room = this.room;
    if (!room || !room.state) return;
    try { this.syncPlayers(room.state.players); } catch { /* silent */ }
    try { this.syncMonsters(room.state.monsters); } catch { /* silent */ }
  }

  private syncPlayers(map: any): void {
    if (!map) return;
    const cur = new Set<string>();
    try {
      map.forEach((p: any, key: string) => {
        cur.add(key);
        if (key === this.selfId) { this.knownPlayers.add(key); return; } // 自身用本地预测，跳过
        const view = this.toPlayer(p, key);
        const last = this.lastPlayerPos.get(key);
        const moved = !last || last.x !== view.x || last.y !== view.y;
        if (!this.knownPlayers.has(key)) {
          this.knownPlayers.add(key);
          this.onPlayerAdd(view, key);
          this.lastPlayerPos.set(key, { x: view.x, y: view.y });
        } else if (moved) {
          this.onPlayerChange(view, key);
          this.lastPlayerPos.set(key, { x: view.x, y: view.y });
        }
      });
      for (const key of Array.from(this.knownPlayers)) {
        if (!cur.has(key) && key !== this.selfId) {
          this.knownPlayers.delete(key);
          this.lastPlayerPos.delete(key);
          this.onPlayerRemove(key);
        }
      }
    } catch { /* silent */ }
  }

  private syncMonsters(map: any): void {
    if (!map) return;
    const cur = new Set<string>();
    try {
      map.forEach((m: any, key: string) => {
        cur.add(key);
        const view = this.toMonster(m, key);
        const last = this.lastMonsterState.get(key);
        if (!this.knownMonsters.has(key)) {
          this.knownMonsters.add(key);
          this.onMonsterChange(view, key);
          this.lastMonsterState.set(key, view.state);
        } else if (last !== view.state) {
          this.onMonsterChange(view, key); // 仅在状态变化（available→busy→dead）时重绘
          this.lastMonsterState.set(key, view.state);
        }
      });
      for (const key of Array.from(this.knownMonsters)) {
        if (!cur.has(key)) { this.knownMonsters.delete(key); this.lastMonsterState.delete(key); }
      }
    } catch { /* silent */ }
  }

  private toPlayer(p: any, key: string): PlayerView {
    return {
      sessionId: key,
      name: p.name || '',
      title: p.title || '',
      color: p.color || '#ffffff',
      x: Number(p.x) || 0,
      y: Number(p.y) || 0,
      battling: !!p.battling,
      teamId: p.teamId || '',
    };
  }

  private toMonster(m: any, key: string): MonsterView {
    return {
      id: key,
      state: m.state || 'available',
      owner: m.owner || '',
      respawnAt: Number(m.respawnAt) || 0,
    };
  }

  // —— 发送意图（对齐 GameRoom.onMessage）——
  sendMove(x: number, y: number): void { this.room?.send('move', { x, y }); }
  sendEnterBattle(id: string): void { this.room?.send('enterBattle', { id }); }
  sendKillMonster(id: string): void { this.room?.send('killMonster', { id, respawnMs: 30000 }); }
  sendChat(text: string): void { this.room?.send('chat', { channel: 'world', text }); }
  /** 解锁地图怪（战斗失败/逃跑后调用，使其对所有人重新 available）。 */
  sendUnlockMonster(id: string): void { this.room?.send('unlockMonster', { id }); }

  // ——— 战斗房间（独立 room，复用已连接的 client）———
  battleRoom: any = null;

  /**
   * 进权威战斗房。复用 game 房的 client（一个 Colyseus.Client 可同时持有多房间）。
   * options 对齐服务器 BattleRoom.onJoin：name / ownerSessionId / enemyData / enemyParty /
   * monsterId / playerStats / loadout / (可选 pet / dungeonId 等)。
   * .filterBy(['monsterId']) 使同怪的战斗房可被同场玩家 joinById 复用（组队共斗）。
   */
  async connectBattle(options: any): Promise<any> {
    if (!this.client) throw new Error('未连接 game 房间，无法进战斗');
    this.battleRoom = await this.client.joinOrCreate('battle', options);
    return this.battleRoom;
  }

  leave(): void {
    this.stopSyncLoop();
    try { this.room?.leave(); } catch { /* ignore */ }
  }
}
