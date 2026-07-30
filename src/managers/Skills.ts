/** 斩魄刀技能数据 — 浅打4元素 → 始解/卍解36把（zp01~zp36） */

import { ZANPAKUTO_ELEMENT } from '../config/zanpakuto';

export interface SkillData {
  name: string;
  mp: number;
  power: number;
  desc: string;
  element: string;
  phase: '浅打' | '始解' | '卍解';
  zanpakuto?: string;
  damageType: 'physical' | 'magical';
  skillType?: 'damage' | 'heal' | 'control';
  targetType: 'enemy' | 'enemy-all' | 'self' | 'ally' | 'ally-all';
  statusEffect?: {
    subtype: 'seal' | 'slow' | 'bind' | 'freeze' | 'stun' | 'poison' | 'burn' | 'parasite' | 'taunt' | 'fear' | 'atkDown' | 'defDown' | 'matkDown';
    turns: number;
    rate: number;
  };
}

export type SkillTargetType = 'enemy' | 'enemy-all' | 'self' | 'ally' | 'ally-all';
export function getSkillTargetType(sk: SkillData): SkillTargetType {
  if (sk.targetType) return sk.targetType;
  if (sk.skillType === 'heal') return sk.desc.includes('全体') || sk.desc.includes('全队') ? 'ally-all' : 'ally';
  if (sk.desc.includes('自身')) return 'self';
  if (sk.desc.includes('全队')) return 'ally-all';
  if (sk.desc.includes('全体')) return 'enemy-all';
  return 'enemy';
}

export const SHALLOW_SKILLS: Record<string, SkillData> = {
  火: { name: '炽刃', mp: 15, power: 2.2, desc: '火系单体斩击，暴击率+15%', element: '火', phase: '浅打', damageType: 'physical', targetType: 'enemy' },
  风: { name: '裂风', mp: 12, power: 1.8, desc: '风系高速单体斩击', element: '风', phase: '浅打', damageType: 'physical', targetType: 'enemy' },
  水: { name: '寒切', mp: 12, power: 1.6, desc: '水系斩击+概率减速', element: '水', phase: '浅打', damageType: 'magical', statusEffect: { subtype: 'slow', turns: 2, rate: 0.30 }, targetType: 'enemy' },
  土: { name: '碎岩', mp: 12, power: 1.6, desc: '土系重击+概率眩晕', element: '土', phase: '浅打', damageType: 'physical', statusEffect: { subtype: 'stun', turns: 1, rate: 0.25 }, targetType: 'enemy' },
};

export const SHIKAI_SKILLS: Record<string, SkillData[]> = {
  /* ── 火系9 ── */
  zp01: [
    { name: '天火降', mp: 25, power: 1.4, desc: '全体火伤+灼烧(3回合)', element: '火', phase: '始解', damageType: 'physical', statusEffect: { subtype: 'burn', turns: 3, rate: 1.0 }, targetType: 'enemy-all' },
    { name: '炼狱',   mp: 30, power: 3.2, desc: '单体强力火伤', element: '火', phase: '始解', damageType: 'physical', targetType: 'enemy' },
  ],
  zp02: [
    { name: '种焰', mp: 18, power: 2.0, desc: '单体·延迟引爆火种印记(2回合)', element: '火', phase: '始解', damageType: 'magical', targetType: 'enemy' },
    { name: '花爆', mp: 24, power: 2.5, desc: '全体种火+引爆增伤', element: '火', phase: '始解', damageType: 'magical', targetType: 'enemy-all' },
  ],
  zp03: [
    { name: '赤霞盾', mp: 20, power: 0, desc: '自身防御+50%+反伤(3回合)', element: '火', phase: '始解', damageType: 'physical', targetType: 'self' },
    { name: '焰光炮', mp: 24, power: 2.8, desc: '单体远程火弹', element: '火', phase: '始解', damageType: 'magical', targetType: 'enemy' },
  ],
  zp04: [
    { name: '烈阳斩', mp: 22, power: 3.5, desc: '直线贯穿高伤', element: '火', phase: '始解', damageType: 'physical', targetType: 'enemy' },
    { name: '裂空斩', mp: 28, power: 2.8, desc: '全体火伤', element: '火', phase: '始解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp05: [
    { name: '双击',   mp: 20, power: 1.5, desc: '标记目标，再次命中造成5倍伤害', element: '火', phase: '始解', damageType: 'physical', targetType: 'enemy' },
    { name: '闪击',   mp: 16, power: 2.0, desc: '先制单体攻击，高暴击', element: '火', phase: '始解', damageType: 'physical', targetType: 'enemy' },
  ],
  zp06: [
    { name: '毒烟', mp: 22, power: 1.3, desc: '全体毒伤+中毒(4回合)', element: '火', phase: '始解', damageType: 'magical', statusEffect: { subtype: 'poison', turns: 4, rate: 1.0 }, targetType: 'enemy-all' },
    { name: '蚀针', mp: 26, power: 2.6, desc: '单体，中毒目标伤害翻倍', element: '火', phase: '始解', damageType: 'magical', targetType: 'enemy' },
  ],
  zp07: [
    { name: '爆碎', mp: 20, power: 3.0, desc: '单体高伤+概率眩晕', element: '火', phase: '始解', damageType: 'physical', statusEffect: { subtype: 'stun', turns: 1, rate: 0.25 }, targetType: 'enemy' },
    { name: '爆风', mp: 24, power: 1.4, desc: '全体火伤+敌方攻击-15%(3回合)', element: '火', phase: '始解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp08: [
    { name: '炎咬', mp: 16, power: 2.2, desc: '单体多段撕咬+灼烧(3回合)', element: '火', phase: '始解', damageType: 'physical', statusEffect: { subtype: 'burn', turns: 3, rate: 1.0 }, targetType: 'enemy' },
    { name: '蛇噬', mp: 24, power: 2.5, desc: '全体火伤', element: '火', phase: '始解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp09: [],  /* 锻体 */

  /* ── 风系9 ── */
  zp10: [
    { name: '风冲', mp: 22, power: 2.8, desc: '直线贯穿+自身速度+20%(3回合)', element: '风', phase: '始解', damageType: 'physical', targetType: 'self' },
    { name: '暗牙', mp: 20, power: 3.5, desc: '消耗HP20%，单体2倍伤害', element: '风', phase: '始解', damageType: 'physical', targetType: 'enemy' },
  ],
  zp11: [
    { name: '万华·景', mp: 28, power: 0.6, desc: '全体5段风伤+破甲', element: '风', phase: '始解', damageType: 'physical', targetType: 'enemy-all' },
    { name: '万华·碎', mp: 25, power: 3.0, desc: '单体大伤害，无视护盾', element: '风', phase: '始解', damageType: 'physical', targetType: 'enemy' },
  ],
  zp12: [
    { name: '穿心', mp: 16, power: 2.5, desc: '极速单体突刺，先制攻击', element: '风', phase: '始解', damageType: 'physical', targetType: 'enemy' },
    { name: '疾突', mp: 22, power: 1.2, desc: '单体4段高速突刺', element: '风', phase: '始解', damageType: 'physical', targetType: 'enemy' },
  ],
  zp13: [
    { name: '游影', mp: 20, power: 2.2, desc: '单体，站位越高伤害越大', element: '风', phase: '始解', damageType: 'magical', targetType: 'enemy' },
    { name: '暗影', mp: 22, power: 1.8, desc: '全体，影子重叠者受额外伤害', element: '风', phase: '始解', damageType: 'magical', targetType: 'enemy-all' },
  ],
  zp14: [
    { name: '藤开', mp: 18, power: 1.5, desc: '全体风伤+中毒(3回合)+吸收敌方MP', element: '风', phase: '始解', damageType: 'magical', statusEffect: { subtype: 'poison', turns: 3, rate: 1.0 }, targetType: 'enemy-all' },
    { name: '缠缚', mp: 22, power: 2.4, desc: '单体风伤+概率束缚(2回合)', element: '风', phase: '始解', damageType: 'magical', statusEffect: { subtype: 'bind', turns: 2, rate: 0.35 }, targetType: 'enemy' },
  ],
  zp15: [
    { name: '逆乱', mp: 20, power: 1.6, desc: '全体风伤+概率混乱(3回合)', element: '风', phase: '始解', damageType: 'magical', statusEffect: { subtype: 'stun', turns: 3, rate: 0.40 }, targetType: 'enemy-all' },
    { name: '迷乱', mp: 26, power: 2.8, desc: '单体，混乱目标暴击伤害+50%', element: '风', phase: '始解', damageType: 'magical', targetType: 'enemy' },
  ],
  zp16: [
    { name: '断岚', mp: 18, power: 2.8, desc: '单体风刃高伤', element: '风', phase: '始解', damageType: 'physical', targetType: 'enemy' },
    { name: '岚裂', mp: 22, power: 1.3, desc: '全体风伤+敌方速度-15%(3回合)', element: '风', phase: '始解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp17: [
    { name: '蜻切', mp: 16, power: 2.2, desc: '先制单体，高暴击+破甲', element: '风', phase: '始解', damageType: 'physical', targetType: 'enemy' },
    { name: '迅旋', mp: 22, power: 1.4, desc: '全体风伤', element: '风', phase: '始解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp18: [],  /* 锻体 */

  /* ── 水系9 ── */
  zp19: [
    { name: '沧龙', mp: 24, power: 2.2, desc: '全体水伤+概率冻结', element: '水', phase: '始解', damageType: 'magical', statusEffect: { subtype: 'freeze', turns: 1, rate: 0.30 }, targetType: 'enemy-all' },
    { name: '渊牢', mp: 20, power: 0, desc: '单体冻结控制2回合', element: '水', phase: '始解', damageType: 'magical', skillType: 'control', statusEffect: { subtype: 'freeze', turns: 2, rate: 0.70 }, targetType: 'enemy' },
  ],
  zp20: [
    { name: '霜涟', mp: 22, power: 2.8, desc: '单体，冻结目标三倍伤害', element: '水', phase: '始解', damageType: 'magical', targetType: 'enemy' },
    { name: '霜刃', mp: 18, power: 2.3, desc: '贯穿攻击，无视冻结目标防御', element: '水', phase: '始解', damageType: 'magical', targetType: 'enemy' },
  ],
  zp21: [
    { name: '幻花', mp: 22, power: 1.6, desc: '全体水伤+概率混乱(2回合)', element: '水', phase: '始解', damageType: 'magical', targetType: 'enemy-all' },
    { name: '幻月', mp: 28, power: 3.2, desc: '单体幻术·高额魔法伤害', element: '水', phase: '始解', damageType: 'magical', targetType: 'enemy' },
  ],
  zp22: [
    { name: '吸灵', mp: 18, power: 0, desc: '吸收下次受到的魔法伤害转HP', element: '水', phase: '始解', damageType: 'magical', targetType: 'self' },
    { name: '反射', mp: 24, power: 2.0, desc: '全体水伤+自身MDEF+30%(3回合)', element: '水', phase: '始解', damageType: 'magical', targetType: 'enemy-all' },
  ],
  zp23: [
    { name: '治愈', mp: 22, power: 2.0, desc: '单体HP大回复(MATK×200%)', element: '水', phase: '始解', damageType: 'magical', skillType: 'heal', targetType: 'ally' },
    { name: '灵滴', mp: 30, power: 1.2, desc: '全体HP回复+净化异常状态(MATK×120%)', element: '水', phase: '始解', damageType: 'magical', skillType: 'heal', targetType: 'ally-all' },
  ],
  zp24: [
    { name: '潋舞', mp: 22, power: 1.5, desc: '全体水伤+敌方命中-20%(3回合)', element: '水', phase: '始解', damageType: 'magical', targetType: 'enemy-all' },
    { name: '镇歌', mp: 26, power: 0, desc: '单体眩晕2回合', element: '水', phase: '始解', damageType: 'magical', skillType: 'control', statusEffect: { subtype: 'stun', turns: 2, rate: 0.65 }, targetType: 'enemy' },
  ],
  zp25: [
    { name: '漩涡', mp: 18, power: 2.5, desc: '单体旋转水刃', element: '水', phase: '始解', damageType: 'magical', targetType: 'enemy' },
    { name: '潮涌', mp: 22, power: 1.6, desc: '全体水伤+减速(3回合)+中毒(3回合)', element: '水', phase: '始解', damageType: 'magical', statusEffect: { subtype: 'poison', turns: 3, rate: 1.0 }, targetType: 'enemy-all' },
  ],
  zp26: [
    { name: '澪愈', mp: 18, power: 1.5, desc: '单体HP中回复(MATK×150%)', element: '水', phase: '始解', damageType: 'magical', skillType: 'heal', targetType: 'ally' },
    { name: '光愈', mp: 24, power: 1.2, desc: '全体水伤+我方攻击+10%(3回合)', element: '水', phase: '始解', damageType: 'magical', targetType: 'enemy-all' },
  ],
  zp27: [],  /* 锻体 */

  /* ── 土系9 ── */
  zp28: [
    { name: '镇王', mp: 24, power: 1.4, desc: '全体土伤+敌方速度-20%(3回合)', element: '土', phase: '始解', damageType: 'physical', targetType: 'enemy-all' },
    { name: '地裂', mp: 20, power: 1.2, desc: '全体土伤+高概率眩晕', element: '土', phase: '始解', damageType: 'physical', statusEffect: { subtype: 'stun', turns: 1, rate: 0.40 }, targetType: 'enemy-all' },
  ],
  zp29: [
    { name: '棘鞭', mp: 20, power: 1.3, desc: '全体中距土伤', element: '土', phase: '始解', damageType: 'physical', targetType: 'enemy-all' },
    { name: '牙绝', mp: 26, power: 3.0, desc: '单体高伤+灼烧(3回合)', element: '土', phase: '始解', damageType: 'physical', targetType: 'enemy' },
  ],
  zp30: [
    { name: '碎甲', mp: 18, power: 2.5, desc: '单体破甲(防御-25%,3回合)', element: '土', phase: '始解', damageType: 'physical', targetType: 'enemy' },
    { name: '碎纹', mp: 24, power: 3.5, desc: '单体，破甲目标伤害+50%', element: '土', phase: '始解', damageType: 'physical', targetType: 'enemy' },
  ],
  zp31: [
    { name: '尘化', mp: 18, power: 1.2, desc: '全体土伤+敌方命中-20%(3回合)', element: '土', phase: '始解', damageType: 'physical', targetType: 'enemy-all' },
    { name: '尘袭', mp: 22, power: 2.4, desc: '单体+概率灼烧(3回合)', element: '土', phase: '始解', damageType: 'physical', targetType: 'enemy' },
  ],
  zp32: [
    { name: '重压', mp: 18, power: 1.3, desc: '全体土伤+敌方速度-30%(3回合)', element: '土', phase: '始解', damageType: 'physical', targetType: 'enemy-all' },
    { name: '钧贯', mp: 24, power: 2.0, desc: '单体，目标速度越低伤害越高', element: '土', phase: '始解', damageType: 'physical', targetType: 'enemy' },
  ],
  zp33: [
    { name: '土壁', mp: 20, power: 0, desc: '全队防御+30%(3回合)', element: '土', phase: '始解', damageType: 'physical', targetType: 'ally-all' },
    { name: '地崩', mp: 22, power: 1.8, desc: '全体土伤+概率减速', element: '土', phase: '始解', damageType: 'physical', statusEffect: { subtype: 'slow', turns: 2, rate: 0.30 }, targetType: 'enemy-all' },
  ],
  zp34: [
    { name: '重锤', mp: 22, power: 3.2, desc: '单体高伤+概率眩晕', element: '土', phase: '始解', damageType: 'physical', statusEffect: { subtype: 'stun', turns: 1, rate: 0.30 }, targetType: 'enemy' },
    { name: '地鸣', mp: 26, power: 1.5, desc: '全体土伤+概率眩晕', element: '土', phase: '始解', damageType: 'physical', statusEffect: { subtype: 'stun', turns: 1, rate: 0.25 }, targetType: 'enemy-all' },
  ],
  zp35: [
    { name: '岩斩', mp: 18, power: 2.8, desc: '单体高伤+破甲', element: '土', phase: '始解', damageType: 'physical', targetType: 'enemy' },
    { name: '碎崩', mp: 24, power: 1.5, desc: '全体土伤', element: '土', phase: '始解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp36: [],  /* 锻体 */
};

export const BANKAI_SKILLS: Record<string, SkillData[]> = {
  /* ── 火系 ── */
  zp01: [
    { name: '焚天·劫火', mp: 55, power: 6.0, desc: '卍解·单体焚尽一切', element: '火', phase: '卍解', damageType: 'physical', targetType: 'enemy' },
    { name: '焚天·燎原', mp: 65, power: 3.5, desc: '卍解·全体烈日灼烧', element: '火', phase: '卍解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp02: [
    { name: '燎华·万花', mp: 48, power: 4.2, desc: '卍解·单体火种引爆', element: '火', phase: '卍解', damageType: 'magical', targetType: 'enemy' },
    { name: '燎华·百花', mp: 56, power: 2.5, desc: '卍解·全体火种风暴', element: '火', phase: '卍解', damageType: 'magical', targetType: 'enemy-all' },
  ],
  zp03: [
    { name: '赤霞·天变', mp: 50, power: 4.8, desc: '卍解·单体火弹轰炸', element: '火', phase: '卍解', damageType: 'magical', targetType: 'enemy' },
    { name: '赤霞·地动', mp: 58, power: 2.8, desc: '卍解·全体流星火雨', element: '火', phase: '卍解', damageType: 'magical', targetType: 'enemy-all' },
  ],
  zp04: [
    { name: '烈阳·无间', mp: 52, power: 6.2, desc: '卍解·单体终极斩击', element: '火', phase: '卍解', damageType: 'physical', targetType: 'enemy' },
    { name: '烈阳·断空', mp: 60, power: 3.0, desc: '卍解·全体横扫斩', element: '火', phase: '卍解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp05: [
    { name: '闪焰·雷鞭', mp: 45, power: 5.5, desc: '卍解·单体贯穿+先制', element: '火', phase: '卍解', damageType: 'physical', targetType: 'enemy' },
    { name: '闪焰·雷阵', mp: 52, power: 3.0, desc: '卍解·全体雷弹齐射', element: '火', phase: '卍解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp06: [
    { name: '蚀火·万毒', mp: 50, power: 4.5, desc: '卍解·单体毒爆+中毒4T', element: '火', phase: '卍解', damageType: 'magical', statusEffect: { subtype: 'poison', turns: 4, rate: 0.75 }, targetType: 'enemy' },
    { name: '蚀火·毒域', mp: 58, power: 2.2, desc: '卍解·全体毒雾弥漫', element: '火', phase: '卍解', damageType: 'magical', statusEffect: { subtype: 'poison', turns: 3, rate: 0.60 }, targetType: 'enemy-all' },
  ],
  zp07: [
    { name: '爆煌·天冲', mp: 48, power: 5.5, desc: '卍解·单体豪火爆裂', element: '火', phase: '卍解', damageType: 'physical', targetType: 'enemy' },
    { name: '爆煌·焰阵', mp: 55, power: 3.2, desc: '卍解·全体火焰阵', element: '火', phase: '卍解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp08: [
    { name: '蛇炎·八岐', mp: 50, power: 5.8, desc: '卍解·单体八岐咬杀', element: '火', phase: '卍解', damageType: 'physical', targetType: 'enemy' },
    { name: '蛇炎·万蛇', mp: 58, power: 2.8, desc: '卍解·全体群蛇噬咬', element: '火', phase: '卍解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp09: [
    { name: '烬恒·不灭', mp: 42, power: 5.0, desc: '卍解·锻体单体昇华', element: '火', phase: '卍解', damageType: 'physical', targetType: 'self' },
  ],

  /* ── 风系 ── */
  zp10: [
    { name: '裂风·锁天', mp: 45, power: 6.0, desc: '卍解·单体超高速斩', element: '风', phase: '卍解', damageType: 'physical', targetType: 'enemy' },
    { name: '裂风·天牙', mp: 52, power: 3.5, desc: '卍解·全体横扫', element: '风', phase: '卍解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp11: [
    { name: '万华·歼景', mp: 55, power: 5.0, desc: '卍解·单体千刀集中', element: '风', phase: '卍解', damageType: 'physical', targetType: 'enemy' },
    { name: '万华·景严', mp: 62, power: 1.5, desc: '卍解·全体万花', element: '风', phase: '卍解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp12: [
    { name: '疾穿·破军', mp: 40, power: 6.5, desc: '卍解·单体极限射程', element: '风', phase: '卍解', damageType: 'physical', targetType: 'enemy' },
    { name: '疾穿·连破', mp: 48, power: 3.0, desc: '卍解·全体连突', element: '风', phase: '卍解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp13: [
    { name: '游影·行鬼', mp: 50, power: 5.2, desc: '卍解·单体灵压碾压', element: '风', phase: '卍解', damageType: 'magical', targetType: 'enemy' },
    { name: '游影·狂骨', mp: 58, power: 3.0, desc: '卍解·全体幻影重叠', element: '风', phase: '卍解', damageType: 'magical', targetType: 'enemy-all' },
  ],
  zp14: [
    { name: '缠藤·千本', mp: 48, power: 4.5, desc: '卍解·单体束缚+2T', element: '风', phase: '卍解', damageType: 'magical', statusEffect: { subtype: 'bind', turns: 2, rate: 0.70 }, targetType: 'enemy' },
    { name: '缠藤·万藤', mp: 55, power: 2.5, desc: '卍解·全体藤缚', element: '风', phase: '卍解', damageType: 'magical', statusEffect: { subtype: 'bind', turns: 1, rate: 0.55 }, targetType: 'enemy-all' },
  ],
  zp15: [
    { name: '逆乱·万象', mp: 50, power: 5.0, desc: '卍解·单体极致混乱', element: '风', phase: '卍解', damageType: 'magical', statusEffect: { subtype: 'stun', turns: 3, rate: 0.75 }, targetType: 'enemy' },
    { name: '逆乱·颠倒', mp: 58, power: 2.8, desc: '卍解·全体混乱2T', element: '风', phase: '卍解', damageType: 'magical', statusEffect: { subtype: 'stun', turns: 2, rate: 0.60 }, targetType: 'enemy-all' },
  ],
  zp16: [
    { name: '断岚·裂空', mp: 42, power: 6.0, desc: '卍解·单体风刃破甲', element: '风', phase: '卍解', damageType: 'physical', targetType: 'enemy' },
    { name: '断岚·暴岚', mp: 50, power: 3.2, desc: '卍解·全体暴风', element: '风', phase: '卍解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp17: [
    { name: '迅蜻·万贯', mp: 44, power: 5.8, desc: '卍解·单体多段破甲', element: '风', phase: '卍解', damageType: 'physical', targetType: 'enemy' },
    { name: '迅蜻·千贯', mp: 52, power: 3.0, desc: '卍解·全体蜻蛉阵', element: '风', phase: '卍解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp18: [
    { name: '疾空·迅雷', mp: 45, power: 3.2, desc: '卍解·锻体全体加速', element: '风', phase: '卍解', damageType: 'physical', targetType: 'ally-all' },
  ],

  /* ── 水系 ── */
  zp19: [
    { name: '沧渊·冰莲',   mp: 60, power: 5.5, desc: '卍解·单体冰封+冻结', element: '水', phase: '卍解', damageType: 'magical', statusEffect: { subtype: 'freeze', turns: 2, rate: 0.80 }, targetType: 'enemy' },
    { name: '沧渊·百花葬', mp: 68, power: 3.0, desc: '卍解·全体冰封+冻结', element: '水', phase: '卍解', damageType: 'magical', statusEffect: { subtype: 'freeze', turns: 1, rate: 0.60 }, targetType: 'enemy-all' },
  ],
  zp20: [
    { name: '霜华·霞罚', mp: 55, power: 5.8, desc: '卍解·单体绝对零度', element: '水', phase: '卍解', damageType: 'magical', statusEffect: { subtype: 'freeze', turns: 1, rate: 0.90 }, targetType: 'enemy' },
    { name: '霜华·极涟', mp: 62, power: 3.2, desc: '卍解·全体冰雪风暴', element: '水', phase: '卍解', damageType: 'magical', targetType: 'enemy-all' },
  ],
  zp21: [
    { name: '幻溟·碎梦', mp: 60, power: 6.0, desc: '卍解·单体幻术粉碎', element: '水', phase: '卍解', damageType: 'magical', targetType: 'enemy' },
    { name: '幻溟·镜界', mp: 68, power: 3.5, desc: '卍解·全体精神崩坏', element: '水', phase: '卍解', damageType: 'magical', targetType: 'enemy-all' },
  ],
  zp22: [
    { name: '双漪·双天', mp: 50, power: 5.0, desc: '卍解·单体水刃', element: '水', phase: '卍解', damageType: 'magical', targetType: 'enemy' },
    { name: '双漪·归海', mp: 58, power: 3.0, desc: '卍解·全体漩涡', element: '水', phase: '卍解', damageType: 'magical', targetType: 'enemy-all' },
  ],
  zp23: [
    { name: '湛愈·皆愈', mp: 55, power: 3.0, desc: '卍解·全队满血净化', element: '水', phase: '卍解', damageType: 'magical', skillType: 'heal', targetType: 'ally-all' },
    { name: '湛愈·大愈', mp: 45, power: 2.0, desc: '卍解·单体究极治愈', element: '水', phase: '卍解', damageType: 'magical', skillType: 'heal', targetType: 'ally' },
  ],
  zp24: [
    { name: '潋光·舞踏', mp: 52, power: 5.2, desc: '卍解·单体多段+眩晕', element: '水', phase: '卍解', damageType: 'magical', statusEffect: { subtype: 'stun', turns: 2, rate: 0.75 }, targetType: 'enemy' },
    { name: '潋光·狂舞', mp: 60, power: 2.8, desc: '卍解·全体舞踏', element: '水', phase: '卍解', damageType: 'magical', targetType: 'enemy-all' },
  ],
  zp25: [
    { name: '漩流·水天', mp: 48, power: 5.0, desc: '卍解·单体水龙钻', element: '水', phase: '卍解', damageType: 'magical', targetType: 'enemy' },
    { name: '漩流·潮葬', mp: 56, power: 3.0, desc: '卍解·全体水龙卷', element: '水', phase: '卍解', damageType: 'magical', targetType: 'enemy-all' },
  ],
  zp26: [
    { name: '澪光·神愈', mp: 50, power: 2.5, desc: '卍解·全队大回复', element: '水', phase: '卍解', damageType: 'magical', skillType: 'heal', targetType: 'ally-all' },
    { name: '澪光·光愈', mp: 40, power: 1.8, desc: '卍解·单体净化+回复', element: '水', phase: '卍解', damageType: 'magical', skillType: 'heal', targetType: 'ally' },
  ],
  zp27: [
    { name: '寂渊·终式', mp: 44, power: 5.2, desc: '卍解·锻体单体音波', element: '水', phase: '卍解', damageType: 'magical', targetType: 'enemy' },
  ],

  /* ── 土系 ── */
  zp28: [
    { name: '镇岳·明王', mp: 55, power: 5.5, desc: '卍解·单体巨神重击+眩晕', element: '土', phase: '卍解', damageType: 'physical', statusEffect: { subtype: 'stun', turns: 2, rate: 0.70 }, targetType: 'enemy' },
    { name: '镇岳·怒',   mp: 62, power: 3.2, desc: '卍解·全体巨神碾压', element: '土', phase: '卍解', damageType: 'physical', statusEffect: { subtype: 'stun', turns: 1, rate: 0.50 }, targetType: 'enemy-all' },
  ],
  zp29: [
    { name: '牙棘·狒骨', mp: 50, power: 6.0, desc: '卍解·单体绝咬', element: '土', phase: '卍解', damageType: 'physical', targetType: 'enemy' },
    { name: '牙棘·大蛇', mp: 58, power: 3.2, desc: '卍解·全体鞭笞', element: '土', phase: '卍解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp30: [
    { name: '碎岩·龙纹', mp: 52, power: 6.2, desc: '卍解·单体极限破甲', element: '土', phase: '卍解', damageType: 'physical', targetType: 'enemy' },
    { name: '碎岩·灯阵', mp: 60, power: 3.0, desc: '卍解·全体灯阵', element: '土', phase: '卍解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp31: [
    { name: '尘灰·尘界', mp: 48, power: 4.5, desc: '卍解·单体灰化', element: '土', phase: '卍解', damageType: 'physical', targetType: 'enemy' },
    { name: '尘灰·雾界', mp: 55, power: 2.5, desc: '卍解·全体灰雾', element: '土', phase: '卍解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp32: [
    { name: '沉钧·万钧', mp: 45, power: 5.8, desc: '卍解·单体重压', element: '土', phase: '卍解', damageType: 'physical', targetType: 'enemy' },
    { name: '沉钧·百贯', mp: 52, power: 3.0, desc: '卍解·全体重力场', element: '土', phase: '卍解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp33: [
    { name: '地震·地崩',   mp: 50, power: 4.8, desc: '卍解·单体地裂', element: '土', phase: '卍解', damageType: 'physical', targetType: 'enemy' },
    { name: '地震·大地震', mp: 58, power: 2.8, desc: '卍解·全体地震+减速', element: '土', phase: '卍解', damageType: 'physical', statusEffect: { subtype: 'slow', turns: 3, rate: 0.65 }, targetType: 'enemy-all' },
  ],
  zp34: [
    { name: '重锤·天崩', mp: 55, power: 6.0, desc: '卍解·单体终极重击', element: '土', phase: '卍解', damageType: 'physical', statusEffect: { subtype: 'stun', turns: 2, rate: 0.65 }, targetType: 'enemy' },
    { name: '重锤·地裂', mp: 62, power: 3.2, desc: '卍解·全体地裂', element: '土', phase: '卍解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp35: [
    { name: '崩岩·山碎',   mp: 48, power: 5.8, desc: '卍解·单体全力破岩', element: '土', phase: '卍解', damageType: 'physical', targetType: 'enemy' },
    { name: '崩岩·岩石雨', mp: 55, power: 3.0, desc: '卍解·全体岩石奔流', element: '土', phase: '卍解', damageType: 'physical', targetType: 'enemy-all' },
  ],
  zp36: [
    { name: '不动·铁壁', mp: 46, power: 3.0, desc: '卍解·锻体全体铁壁', element: '土', phase: '卍解', damageType: 'physical', targetType: 'ally-all' },
  ],
};

/** ZANPAKUTO_ELEMENT 从 zanpakuto.ts 重导出（id→元素） */
export { ZANPAKUTO_ELEMENT };

export function getAvailableSkills(zpId: string, element: string, hasShikai: boolean, hasBankai?: boolean, bankaiActive?: boolean, hollowActive?: boolean, hellActive?: boolean): SkillData[] {
  const result: SkillData[] = [];
  if (element && SHALLOW_SKILLS[element]) result.push(SHALLOW_SKILLS[element]);
  if (hasShikai && zpId && SHIKAI_SKILLS[zpId]) result.push(...SHIKAI_SKILLS[zpId]);
  if (hasBankai && bankaiActive && zpId && BANKAI_SKILLS[zpId]) result.push(...BANKAI_SKILLS[zpId]);
  if (hollowActive) result.push(...HOLLOW_SKILLS);
  if (hellActive) result.push(...HELL_SKILLS);
  return result;
}

export const HOLLOW_SKILLS: SkillData[] = [
  { name: '灵虚闪', mp: 45, power: 5.0, desc: '虚化·单体高伤灵力炮', element: '无', phase: '卍解', damageType: 'magical', targetType: 'enemy' },
  { name: '王虚炮', mp: 60, power: 3.2, desc: '虚化·全体毁灭光炮', element: '无', phase: '卍解', damageType: 'magical', targetType: 'enemy-all' },
];

export const HELL_SKILLS: SkillData[] = [
  { name: '炼狱炎', mp: 60, power: 6.5, desc: '狱解·单体地狱业火', element: '无', phase: '卍解', damageType: 'magical', targetType: 'enemy' },
  { name: '冥狱门', mp: 75, power: 4.0, desc: '狱解·全体地狱吞噬', element: '无', phase: '卍解', damageType: 'magical', targetType: 'enemy-all' },
];

export const SKILL_BY_NAME: Record<string, SkillData> = (() => {
  const m: Record<string, SkillData> = {};
  const add = (list: SkillData[]) => { for (const s of list) if (!m[s.name]) m[s.name] = s; };
  for (const s of Object.values(SHALLOW_SKILLS)) add([s]);
  for (const list of Object.values(SHIKAI_SKILLS)) add(list);
  for (const list of Object.values(BANKAI_SKILLS)) add(list);
  add(HOLLOW_SKILLS);
  add(HELL_SKILLS);
  return m;
})();
