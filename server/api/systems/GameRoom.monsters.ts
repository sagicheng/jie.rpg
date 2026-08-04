/**
 * GameRoom 怪物状态机子系统
 */
  export function getMonster(id: string): MonsterState {
    let m = scene.state.monsters.get(id);
    if (!m) { m = new MonsterState(); m.id = id; m.state = 'available'; scene.state.monsters.set(id, m); }
    return m;
  }

  /** 锁定怪物——组队时广播全队进入战斗。 */
  export function lockMonster(client: Client, data: { id?: string }): void {
    if (!data || typeof data.id !== 'string') return;
    const id = data.id.slice(0, 64);
    if (!id) return;
    const m = scene.getMonster(id);
    if (m.state !== 'available') return;

    m.state = 'busy'; m.owner = client.sessionId; m.respawnAt = 0;

    // 组队：通知其他队员进入同一场战斗（不发给触发者，他自己已走正常流程进战）
    const teamId = playerTeam.get(client.sessionId);
    if (teamId) {
      const team = teams.get(teamId);
      if (team) {
        team.members.forEach((_, sid) => {
          if (sid === client.sessionId) return; // 跳过触发者
          const c = scene.clients.find((x: Client) => x.sessionId === sid);
          if (c) c.send('enterTeamBattle', { monsterId: id });
        });
      }
    }
  }

  export function killMonster(client: Client, data: { id?: string; respawnMs?: number }): void {
    if (!data || typeof data.id !== 'string') return;
    const id = data.id.slice(0, 64);
    if (!id) return;
    const m = scene.getMonster(id);
    if (m.state === 'busy' && m.owner !== client.sessionId) return;
    m.state = 'dead'; m.owner = '';
    m.respawnAt = Date.now() + (Number(data.respawnMs) || 30000);
  }

  export function unlockMonster(client: Client, data: { id?: string }): void {
    if (!data || typeof data.id !== 'string') return;
    const id = data.id.slice(0, 64);
    if (!id) return;
    const m = scene.state.monsters.get(id);
    if (m && m.state === 'busy' && m.owner === client.sessionId) {
      m.state = 'available'; m.owner = ''; m.respawnAt = 0;
    }
  }

  export function tickRespawn(): void {
    const now = Date.now();
    scene.state.monsters.forEach((m) => {
      if (m.state === 'dead' && m.respawnAt > 0 && now >= m.respawnAt) {
        m.state = 'available'; m.respawnAt = 0;
      }
    });
  }

  // ─── 进房 / 离房 ───

  onJoin(client: Client, options: { token?: string; characterId?: number; title?: string }) {
    const token = options?.token;
    const charId = options?.characterId;
