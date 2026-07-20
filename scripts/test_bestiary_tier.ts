/**
 * 开发测试：图鉴阶层奖励领取逻辑校验（部分 / 全收集阈值）
 */

import { world } from '../server/core/world';
import { NAMED_ENEMIES } from '../src/managers/BestiaryData';

const pw: any = world.get('tier_test_sid');
const names = Object.keys(NAMED_ENEMIES);
console.log('具名敌人数:', names.length);

// 注入前 8 种各击杀 1 次（8/49 ≈ 16% > Tier1 阈值 15%）
for (let i = 0; i < 8; i++) pw.bestiary[names[i]] = 1;

const r1 = world.claimBestiaryTier(pw, 1); // 部分收集 → 应 ok
const r4 = world.claimBestiaryTier(pw, 4); // 仅 8/49 → 应 not reached
console.log('[部分收集] Tier1:', r1.ok, r1.msg, '| Tier4:', r4.ok, r4.msg);

// 全收集各 100 次
for (const n of names) pw.bestiary[n] = 100;
const r4b = world.claimBestiaryTier(pw, 4); // 全收集 → 应 ok
console.log('[全收集] Tier4:', r4b.ok, r4b.msg);

const pass = r1.ok && !r4.ok && r4b.ok;
console.log(pass ? 'BESTIARY_TIER_PASS' : 'BESTIARY_TIER_FAIL');
process.exit(pass ? 0 : 1);
