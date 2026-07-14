/**
 * 《解》副本「中途掉线续打」无界面集成测试
 * ------------------------------------------------------------------
 * 目标：验证「最后一人掉线 → 房间因 autoDispose 销毁 → 重连再进同一副本」
 *      仍能续到原阶（stage 保留），且周次不重复计。
 *
 * 设计缺口背景：
 *   - 补丁前：DungeonRoom.stage 只存在房间内存，房间销毁即归零；
 *             pw.dungeon 仅存 dungeonId，重连开新房间 stage 重置为 1（进度丢失）。
 *   - 补丁后：pw.dungeon 增加 stage 字段，claimStage 推进时回写，
 *             DungeonRoom.onJoin 用 pw.dungeon.stage 初始化房间进度 → 续到原阶。
 *
 * 流程：
 *   1) REST 注册 + 创建角色 → token + characterId
 *   2) Colyseus join 'game'（建立 pw）
 *   3) joinOrCreate 'dungeon'（client D1）→ 进本 stage=1，周次=1
 *   4) 发送 claimStage(stage=1) → 房间 stage=2，pw.dungeon.stage=2
 *   5) 关闭 D1（最后一人 → 房间销毁），睡够 autoDispose
 *   6) 重新 joinOrCreate 'dungeon'（client D2，同 gameSid）→ 续打
 *   7) 断言：D2 房间 stage === 2（续到原阶，非 1）；DB 周次 === 1（不重复计）
 *
 * 运行前置：server(2567) 已起。
 *   node scripts/dungeon_reconnect_test.cjs
 */
const { Client } = require('colyseus.js');
const WebSocket = require('ws');
const Database = require('better-sqlite3');
global.WebSocket = WebSocket; // colyseus.js 在 node 下需要 WebSocket 实现

const BASE = 'http://localhost:2567';
const WS = 'ws://localhost:2567';
const DB_PATH = 'E:/My2ddemo/game/data.db';
const DUNGEON_ID = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function registerAndCreate(account, password, charName) {
  const reg = await api('/api/register', { username: account, password, security: password });
  if (!reg.ok) throw new Error('register failed: ' + JSON.stringify(reg));
  const token = reg.token;
  const cre = await api('/api/character/create', { token, name: charName, element: 'fire' });
  if (!cre.ok) throw new Error('create char failed: ' + JSON.stringify(cre));
  return { token, charId: cre.character.id };
}

function readDB(charName) {
  try {
    const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    const row = db.prepare('SELECT world_data FROM characters WHERE name = ?').get(charName);
    db.close();
    if (!row) return null;
    return JSON.parse(row.world_data);
  } catch (e) {
    return null;
  }
}

(async () => {
  const stamp = Date.now();
  const account = `reconn_${stamp}`;
  const charName = `RC${stamp % 100000}`;
  const password = 'reconn123';

  console.log('=== 《解》副本掉线续打 集成测试 ===');
  console.log(`账号: ${account}  角色: ${charName}`);

  const result = { entered: false, claimed: false, resumedStage: -1, weekly: -1, stageRestored: false, noDoubleCharge: false, resumedAdvanced: false, completedCleared: false, roomDisposed: false, stagePersisted: false, dbReloadStage: -1 };
  let client, gameRoom, dRoom, dRoom2, client2, gameRoom2;

  try {
    const { token, charId } = await registerAndCreate(account, password, charName);
    console.log(`  -> 注册+建角 OK (charId=${charId})`);

    client = new Client(WS);
    gameRoom = await client.joinOrCreate('game', { token, characterId: charId });
    console.log(`  -> join game OK (session=${gameRoom.sessionId.slice(0, 8)})`);

    // 3) 进本（D1）
    dRoom = await client.joinOrCreate('dungeon', {
      dungeonId: DUNGEON_ID,
      gameSid: gameRoom.sessionId,
      name: charName,
      color: '#4ecdc4',
      x: 2880, y: 1080,
    });
    await sleep(600);
    const stageEntered = dRoom.state.stage;
    result.entered = stageEntered === 1;
    console.log(`[进本] 房间 stage=${stageEntered} (期望 1) → ${result.entered ? 'PASS' : 'FAIL'}`);

    // 4) 清 stage1 → 领奖推进到 stage2
    dRoom.send('claimStage', { stage: stageEntered });
    await sleep(600);
    const stageAfterClaim = dRoom.state.stage;
    result.claimed = stageAfterClaim === 2;
    console.log(`[领奖] 房间 stage=${stageAfterClaim} (期望 2) → ${result.claimed ? 'PASS' : 'FAIL'}`);

    // 5) 最后一人掉线 → 房间销毁
    await dRoom.leave();
    dRoom = null;
    await sleep(2000); // 等 autoDispose 真正销毁房间
    console.log('  -> 已断开副本连接（模拟最后一人掉线，房间应销毁）');

    // 5b) 落库验证：claim 到 stage2 后，DungeonRoom 已在关键节点 persistBySid，
    //     DB 中应已写入 dungeon.stage=2（这是真机重连续阶的真相来源）。
    const pwPersist = readDB(charName);
    result.stagePersisted = pwPersist?.dungeon?.stage === 2;
    console.log(`[落库] DB dungeon.stage=${pwPersist?.dungeon?.stage} (期望 2) → ${result.stagePersisted ? 'PASS' : 'FAIL'}`);

    // 6) 真机复现：断开 game 连接（onLeave 保存），用【新 client + 新 game 会话】从 DB 重载后重连进本。
    //    这正是用户真机"关浏览器→重选角"路径：新 sessionId、world.loadFromJSON 从 DB 恢复。
    //    旧测试用同一 client+sessionId 复用内存 pw 才 PASS，恰恰掩盖了"未落库→DB 重载回落第1阶"的 BUG。
    await gameRoom.leave();
    await sleep(800);
    client2 = new Client(WS);
    gameRoom2 = await client2.joinOrCreate('game', { token, characterId: charId });
    await sleep(400);
    let syncedDungeon = null;
    await new Promise((resolve) => {
      gameRoom2.onMessage('worldSync', (pw) => { syncedDungeon = pw.dungeon; resolve(); });
      setTimeout(resolve, 1500);
    });
    result.dbReloadStage = syncedDungeon ? (syncedDungeon.stage ?? -1) : -1;
    console.log(`[DB重载] 重连 worldSync dungeon.stage=${result.dbReloadStage} (期望 2) → ${result.dbReloadStage === 2 ? 'PASS' : 'FAIL'}`);

    dRoom2 = await client2.joinOrCreate('dungeon', {
      dungeonId: DUNGEON_ID,
      gameSid: gameRoom2.sessionId,
      name: charName,
      color: '#4ecdc4',
      x: 2880, y: 1080,
    });
    await sleep(800);
    result.resumedStage = dRoom2.state.stage;
    result.stageRestored = result.resumedStage === 2; // 续到原阶（非 1）才是真续打
    console.log(`[重连续打] 房间 stage=${result.resumedStage} (期望 2=续到原阶, 1=进度丢失) → ${result.stageRestored ? 'PASS' : 'FAIL'}`);

    // 7) 续打到原阶后继续通关剩余阶 → 完成（验证「完成即毁图」）
    dRoom2.send('claimStage', { stage: result.resumedStage }); // stage2 → 3
    await sleep(600);
    const stageAfterResume2 = dRoom2.state ? dRoom2.state.stage : -1;
    result.resumedAdvanced = stageAfterResume2 === 3;
    console.log(`[续打推进] 房间 stage=${stageAfterResume2} (期望 3) → ${result.resumedAdvanced ? 'PASS' : 'FAIL'}`);

    let roomLeft = false;
    try { dRoom2.onLeave(() => { roomLeft = true; }); } catch {}
    dRoom2.send('claimStage', { stage: 3 }); // 完成第3阶 → completeDungeon 清进度 + 兜底销毁房间
    await sleep(3000); // 等服务端「完成即毁」（setTimeout dispose 2.5s + 余量）
    result.roomDisposed = roomLeft;
    console.log(`[完成即毁] 房间在 ~3s 内销毁 → ${result.roomDisposed ? 'PASS' : 'FAIL'}`);

    // 8) 读 DB 验证：周次不重复计 + 完成后 dungeon 被清空（无僵尸续打）
    await gameRoom2.leave();
    await sleep(800);
    const pw = readDB(charName);
    result.weekly = pw?.dungeonWeekly?.count ?? -1;
    result.dungeonAfter = pw && pw.dungeon ? pw.dungeon : null;
    result.noDoubleCharge = result.weekly === 1;
    result.completedCleared = result.dungeonAfter === null;
    console.log(`[DB] 周次=${result.weekly} (期望 1) → ${result.noDoubleCharge ? 'PASS' : 'FAIL'} | 完成后 dungeon=${JSON.stringify(result.dungeonAfter)} (期望 null) → ${result.completedCleared ? 'PASS' : 'FAIL'}`);
  } catch (e) {
    console.error('TEST ERROR', e && e.message ? e.message : e);
  } finally {
    try { if (dRoom) await dRoom.leave(); } catch {}
    try { if (dRoom2) await dRoom2.leave(); } catch {}
    try { if (gameRoom) await gameRoom.leave(); } catch {}
    try { if (gameRoom2) await gameRoom2.leave(); } catch {}
    try { if (client) client.close(); } catch {}
    try { if (client2) client2.close(); } catch {}
  }

  const allPass = result.entered && result.claimed && result.stageRestored && result.noDoubleCharge
    && result.resumedAdvanced && result.completedCleared && result.roomDisposed
    && result.stagePersisted && result.dbReloadStage === 2;
  console.log('\n=== 结果 ===');
  console.log(JSON.stringify(result, null, 2));
  console.log(allPass ? '✅ 掉线续打 + 完成即毁图: PASS' : '❌ 测试: FAIL');
  process.exit(allPass ? 0 : 1);
})();
