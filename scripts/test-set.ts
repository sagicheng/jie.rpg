/**
 * 套装系统单元验证（Node 端，无需浏览器 / 无需起服）。
 * 直接调用真实 SetSystem 逻辑，断言加成数值与「攻防双维对称」。
 *
 * 跑法（在 E:\My2ddemo\game 目录下）：
 *   npx tsx scripts/test-set.ts
 *
 * 说明：本脚本只验证 SetSystem.computeSetBonuses / listSetProgress 的纯逻辑，
 * 以及 recalcStats 末尾那一段「百分比乘算」的公式（与 src/systems/GameStateStats.ts 第 81-89 行一致）。
 * 真机最终确认请以游戏内「背包面板套装进度 + 属性面板数值」为准。
 */
import { computeSetBonuses, listSetProgress, makeSetId, setName, setShortName } from '../src/managers/SetSystem';
import type { Equipment, Item, EquipSlot } from '../src/managers/Inventory';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? '  ' + detail : ''}`); }
}
function approx(a: number | undefined, b: number): boolean {
  return Math.abs((a || 0) - b) < 1e-9;
}

function mk(slot: EquipSlot, setId: string): Item {
  return { id: `${slot}-${setId}`, name: `${slot}`, type: 'equipment', desc: '', quantity: 1, slot, set: setId };
}
function eq(slots: Partial<Record<EquipSlot, string>>): Equipment {
  const e: Equipment = {
    head: null, body: null, bracer: null, boots: null, belt: null,
    ring: null, necklace: null, charm: null, pendant: null,
  };
  for (const k of Object.keys(slots) as EquipSlot[]) {
    e[k] = mk(k, slots[k]!);
  }
  return e;
}

// 镜像 recalcStats 末尾的乘算公式（GameStateStats.ts 81-89）
function applySet(base: Record<string, number>, bonus: ReturnType<typeof computeSetBonuses>): Record<string, number> {
  const out = { ...base };
  if (bonus.hp) out.maxHp = Math.round(out.maxHp * (1 + bonus.hp));
  if (bonus.mp) out.maxMp = Math.round(out.maxMp * (1 + bonus.mp));
  if (bonus.atk) out.atk = Math.round(out.atk * (1 + bonus.atk));
  if (bonus.def) out.def = Math.round(out.def * (1 + bonus.def));
  if (bonus.matk) out.matk = Math.round(out.matk * (1 + bonus.matk));
  if (bonus.mdef) out.mdef = Math.round(out.mdef * (1 + bonus.mdef));
  if (bonus.spd) out.spd = Math.round(out.spd * (1 + bonus.spd));
  return out;
}

console.log('\n=== 套装系统验证 ===\n');

// 0. 空装备
{
  const b = computeSetBonuses(eq({}));
  check('空装备无任何加成', Object.keys(b).length === 0);
}

// 1. 防具 2pc → 仅 HP+5%
{
  const b = computeSetBonuses(eq({ head: '1_green', body: '1_green' }));
  check('防具2pc 仅 HP+5%', approx(b.hp, 0.05) && !b.def && !b.mdef && !b.atk && !b.matk && !b.mp && !b.spd, JSON.stringify(b));
}

// 2. 防具 3pc → HP+5% + DEF&MDEF+8%（对称：def===mdef）
{
  const b = computeSetBonuses(eq({ head: '1_green', body: '1_green', bracer: '1_green' }));
  check('防具3pc HP+5%/DEF&MDEF+8%', approx(b.hp, 0.05) && approx(b.def, 0.08) && approx(b.mdef, 0.08), JSON.stringify(b));
  check('防具3pc 双防对称 (def===mdef)', approx(b.def ?? 0, b.mdef ?? 0));
}

// 3. 防具 4pc → HP 0.13 / DEF 0.14 / MDEF 0.14
{
  const b = computeSetBonuses(eq({ head: '1_green', body: '1_green', bracer: '1_green', boots: '1_green' }));
  check('防具4pc HP0.13/DEF0.14/MDEF0.14', approx(b.hp, 0.13) && approx(b.def, 0.14) && approx(b.mdef, 0.14), JSON.stringify(b));
}

// 4. 防具 5pc → 堆叠 + 全属性+10%
{
  const b = computeSetBonuses(eq({ head: '1_green', body: '1_green', bracer: '1_green', boots: '1_green', belt: '1_green' }));
  check('防具5pc 全属性+10%', approx(b.atk, 0.10) && approx(b.def, 0.14 + 0.10) && approx(b.matk, 0.10) && approx(b.mdef, 0.14 + 0.10) && approx(b.spd, 0.10) && approx(b.hp, 0.13), JSON.stringify(b));
}

// 5. 饰品 2pc → 仅 MP+5%
{
  const b = computeSetBonuses(eq({ ring: '1_green', necklace: '1_green' }));
  check('饰品2pc 仅 MP+5%', approx(b.mp, 0.05) && !b.atk && !b.matk && !b.hp && !b.def && !b.mdef && !b.spd, JSON.stringify(b));
}

// 6. 饰品 3pc → MP+5% + ATK&MATK+8%（对称：atk===matk）
{
  const b = computeSetBonuses(eq({ ring: '1_green', necklace: '1_green', charm: '1_green' }));
  check('饰品3pc MP+5%/ATK&MATK+8%', approx(b.mp, 0.05) && approx(b.atk, 0.08) && approx(b.matk, 0.08), JSON.stringify(b));
  check('饰品3pc 双攻对称 (atk===matk)', approx(b.atk ?? 0, b.matk ?? 0));
}

// 7. 饰品 4pc → MP 0.13 / ATK 0.08 / MATK 0.08 / SPD 0.08
{
  const b = computeSetBonuses(eq({ ring: '1_green', necklace: '1_green', charm: '1_green', pendant: '1_green' }));
  check('饰品4pc MP0.13/ATK0.08/MATK0.08/SPD0.08', approx(b.mp, 0.13) && approx(b.atk, 0.08) && approx(b.matk, 0.08) && approx(b.spd, 0.08), JSON.stringify(b));
}

// 8. 两套防具同时穿 → 各自计件、加成叠加（1_green 3件 + 2_blue 2件）
{
  const b = computeSetBonuses(eq({ head: '1_green', body: '1_green', bracer: '1_green', boots: '2_blue', belt: '2_blue' }));
  check('双防具套独立计件并叠加', approx(b.hp, 0.05 + 0.05) && approx(b.def, 0.08) && approx(b.mdef, 0.08), JSON.stringify(b));
}

// 9. 同标识：防具+饰品各计各的（不混槽位）
{
  const b = computeSetBonuses(eq({ head: '1_green', body: '1_green', bracer: '1_green', ring: '1_green', necklace: '1_green' }));
  check('同set防具3pc+饰品2pc 各自生效', approx(b.hp, 0.05) && approx(b.def, 0.08) && approx(b.mdef, 0.08) && approx(b.mp, 0.05), JSON.stringify(b));
}

// 10. listSetProgress 进度统计
{
  const list = listSetProgress(eq({ head: '1_green', body: '1_green', ring: '1_green', necklace: '1_green' }));
  const s = list.find((x) => x.setId === '1_green')!;
  check('进度统计 防具2/5 + 饰品2/4', !!s && s.armorCount === 2 && s.armorTotal === 5 && s.jewelCount === 2 && s.jewelTotal === 4, JSON.stringify(s && { a: s.armorCount, at: s.armorTotal, j: s.jewelCount, jt: s.jewelTotal }));
}

// 11. 展示名
{
  check('setName 输出', setName(makeSetId(1, 'green')) === '第1区·绿套装', setName(makeSetId(1, 'green')));
  check('setShortName 输出', setShortName(makeSetId(3, 'blue')) === '第3区·蓝', setShortName(makeSetId(3, 'blue')));
}

// 12. 集成：镜像 recalcStats 乘算（验证最终属性确实被放大）
{
  const base = { maxHp: 200, maxMp: 100, atk: 100, def: 80, matk: 90, mdef: 70, spd: 50 };
  // 防具2pc + 饰品3pc
  const bonus = computeSetBonuses(eq({ head: '1_green', body: '1_green', ring: '1_green', necklace: '1_green', charm: '1_green' }));
  const final = applySet(base, bonus);
  const expect = { maxHp: 210, maxMp: 105, atk: 108, def: 80, matk: 98, mdef: 70, spd: 50 };
  check('集成: 防具2pc 使 maxHp 200→210', final.maxHp === expect.maxHp, `got ${final.maxHp}`);
  check('集成: 饰品3pc 使 maxMp 100→105', final.maxMp === expect.maxMp, `got ${final.maxMp}`);
  // 对称校验：atk 与 matk 应被同一百分比放大（90×1.08=97.2→97，取整差异非逻辑问题）
  check('集成: 饰品3pc atk/matk 同比例+8%', final.atk === Math.round(100 * 1.08) && final.matk === Math.round(90 * 1.08), `atk=${final.atk}, matk=${final.matk}`);
}

console.log(`\n==== 套装验证 ${fail === 0 ? 'PASS ✅' : 'FAIL ❌'} ====  (通过 ${pass} / 失败 ${fail})`);
process.exit(fail === 0 ? 0 : 1);
