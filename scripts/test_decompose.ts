/**
 * 开发测试：装备分解（背包 / 装备栏）逻辑校验
 */

import { world } from '../server/core/world';

const pw: any = world.get('decompose_test_sid');

const mk = (id: string, slot: any) => ({
  id, name: '测试装·' + id, type: 'equipment', desc: '单测', quantity: 1,
  slot, stats: { ATK: 5 }, quality: 'green', enhanceLevel: 0, refineStats: [],
});

// 背包装备（inventory）
pw.inventory.push(mk('equip_bag_1', 'weapon'));
const r1 = world.decompose(pw, 'equip_bag_1');
console.log('[背包] decompose:', r1.ok, r1.msg, '| 背包剩余装备:', pw.inventory.filter((i: any) => i.type === 'equipment').length);

// 已装备（equipment[slot]）
pw.equipment['head'] = mk('equip_eq_1', 'head');
const r2 = world.decompose(pw, 'equip_eq_1');
console.log('[装备栏] decompose:', r2.ok, r2.msg, '| head槽:', pw.equipment['head']);

// 不存在的 id
const r3 = world.decompose(pw, 'nope');
console.log('[不存在] decompose:', r3.ok, r3.msg);

const pass = r1.ok && r2.ok && !r3.ok;
console.log(pass ? 'DECOMPOSE_TEST_PASS' : 'DECOMPOSE_TEST_FAIL');
process.exit(pass ? 0 : 1);
