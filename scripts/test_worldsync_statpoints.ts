/**
 * 验证 applyWorldSync 的 statPoints 收口逻辑（修复「刷新后剩余点数变总点数」BUG）。
 * 模拟重连：客户端 GameState 处于 fresh 状态（level 1, statPoints 0），
 * 收到服务端 pw（level 10，已分配 6 点 → 剩余 = (10-1)*6 - 6 = 48）。
 * 断言：GameState.statPoints === 48（剩余），而非 54（总获取）。
 */
import { applyWorldSync } from '../src/systems/social/WorldClient';
import { GameState } from '../src/systems/progression/GameState';

function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  console.log('  ok  : ' + msg);
}

const sceneMock: any = { scene: { get: () => ({ events: { emit() {}, on() {}, off() {} } }) } };

// 重置客户端为 fresh（模拟刷新浏览器后的初始状态）
(GameState as any).level = 1;
(GameState as any).exp = 0;
(GameState as any).statPoints = 0;
GameState.allocatedHP = 0; GameState.allocatedMP = 0; GameState.allocatedATK = 0;
GameState.allocatedDEF = 0; GameState.allocatedMATK = 0; GameState.allocatedMDEF = 0; GameState.allocatedSPD = 0;

// 服务端权威状态：10 级，总获取 (10-1)*6=54，已分配 6 → 剩余 48
const pw: any = {
  inventory: [], equipment: {}, gold: 0,
  level: 10, exp: 50, statPoints: 48,
  allocatedHP: 0, allocatedMP: 0, allocatedATK: 6, allocatedDEF: 0,
  allocatedMATK: 0, allocatedMDEF: 0, allocatedSPD: 0,
  bestiary: {}, completedQuests: [],
};

applyWorldSync(sceneMock, pw);

assert((GameState as any).statPoints === 48, `重连后剩余点数 = 48 (实际 ${GameState.statPoints})，不是总获取 54`);
assert(GameState.allocatedATK === 6, `已分配 ATK = 6 (实际 ${GameState.allocatedATK})`);
assert((GameState as any).level === 10, `level = 10 (实际 ${(GameState as any).level})`);

console.log('\n=== WORLDSYNC STATPOINTS TEST PASSED ===');
process.exit(0);
