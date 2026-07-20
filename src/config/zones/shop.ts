import { makeSetId } from '../../managers/SetSystem';
import type { ZoneNPC } from './types';

export function shop(tier: number, prefix: string, ids: string[]): Array<{ name: string; price: number; id: string; slot: string; stats: Record<string, number>; desc: string; quality?: string; set?: string }> {
  const base = [8, 10, 6, 5, 4, 6, 3, 6, 4]; // def/hp/atk/spd/etc baselines
  const m = 1 + (tier - 1) * 0.55;
  const slots = ['head', 'body', 'bracer', 'boots', 'belt', 'ring', 'necklace', 'charm', 'pendant'];
  const names = ['盔', '甲', '手甲', '靴', '腰带', '戒指', '项链', '护符', '挂饰'];
  const statMap: Record<string, Record<string, number>> = {
    head: { def: Math.round(base[0] * m), hp: Math.round(base[1] * m * 0.5) },
    body: { def: Math.round(base[0] * m * 1.3), mdef: Math.round(base[0] * m * 0.4) },
    bracer: { atk: Math.round(base[2] * m), spd: Math.round(base[3] * m * 0.5) },
    boots: { spd: Math.round(base[3] * m), def: Math.round(base[0] * m * 0.3) },
    belt: { hp: Math.round(base[1] * m), mp: Math.round(base[4] * m) },
    ring: { matk: Math.round(base[5] * m) },
    necklace: { hp: Math.round(base[1] * m * 0.6), mp: Math.round(base[4] * m * 0.8) },
    charm: { mdef: Math.round(base[7] * m) },
    pendant: { spd: Math.round(base[8] * m) },
  };
  const items = slots.map((slot, i) => ({
    name: `${prefix}${names[i]}`,
    price: Math.round([200, 300, 200, 150, 150, 180, 200, 200, 180][i] * m),
    id: `${ids[i]}_z${tier}`,
    slot,
    stats: statMap[slot],
    desc: `${prefix}·${slot} ${Object.entries(statMap[slot]).map(([k, v]) => `${k}+${v}`).join(' ')}`,
    quality: 'white',
    // 商店装备按「区域(=tier) + 品质」纳套装：与同区同品质掉落/制造装备共享套装标识。
    set: slot ? makeSetId(tier, 'white') : undefined,
  }));
  const potions = [
    { name: tier <= 3 ? '回复药' : tier <= 6 ? '强效回复药' : tier <= 9 ? '高级回复药' : '终极回复药', price: [80, 180, 350, 600][Math.min(3, Math.floor((tier - 1) / 3))], id: `potion_z${tier}`, slot: '', stats: {}, desc: `回复${[100, 300, 600, 1000][Math.min(3, Math.floor((tier - 1) / 3))]}HP` },
  ];
  if (tier >= 4) potions.push({ name: '灵水', price: 400, id: `spirit_z${tier}`, slot: '', stats: {}, desc: '回复200MP' });
  return [...items, ...potions];
}
