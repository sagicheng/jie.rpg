/**
 * 鬼道系统 v3.0 — 参照LOL早期天赋树重做
 *
 * 三系：破道(hado) / 缚道(bakudo) / 回道(kaido)
 * 每系5层，每层2~4个节点
 *
 * 规则（仿LOL 30点天赋）：
 * - 投入鬼道点(Kido Point)提升节点等级
 * - 每个节点 maxPoints 级（主动技能1~3级，被动1~3级）
 * - 第N层解锁条件：该系已投入 >= TIER_LOCK[N] 点数
 * - 无节点间前置条件
 * - 每升1级获得1点鬼道点
 * - 战斗最多装备4个主动鬼道技能
 * - 主修系别提供额外加成
 */

export type KidoSchool = 'hado' | 'bakudo' | 'kaido';

export interface KidoNode {
  id: string;
  name: string;
  number?: string;
  school: KidoSchool;
  tier: number;          // 1~5
  column: number;        // UI列位
  maxPoints: number;     // 最大投入点数（1~3）
  mp: number;            // MP消耗，0=被动
  basePower: number;     // 基础威力
  desc: string;
  effect: KidoEffect;
  passive?: boolean;
  isMastery?: boolean;   // T5终极节点
}

export type KidoEffect =
  | { type: 'damage'; target: 'single' | 'all'; scalePerPoint?: number }
  | { type: 'control'; subtype: 'seal' | 'slow' | 'bind' | 'freeze' | 'stun'; turns: number; target: 'single' | 'all'; rate: number }
  | { type: 'heal'; target: 'single' | 'all'; amount?: number }
  | { type: 'shield'; turns: number; scalePerPoint?: number }
  | { type: 'revive'; hpPercent: number }
  | { type: 'cleanse'; target: 'single' | 'all' }
  | { type: 'passive_stat'; stat: string; amount: number }
  | { type: 'passive_school'; stat: string; amount: number; school: KidoSchool }
  | { type: 'chant_speed'; amount: number }
  | { type: 'mana_eff'; amount: number };

// ═══════════════════════════════════════════
// 主修加成
// ═══════════════════════════════════════════
export const SCHOOL_BONUS: Record<KidoSchool, {
  name: string; desc: string; dmgBonus?: number; ctrlBonus?: number; healBonus?: number; extraTurn?: number;
}> = {
  hado:   { name: '破道', desc: '破道伤害+25%', dmgBonus: 0.25 },
  bakudo: { name: '缚道', desc: '控制成功率+20%，持续回合+1', ctrlBonus: 0.2, extraTurn: 1 },
  kaido:  { name: '回道', desc: '治疗效果+30%', healBonus: 0.3 },
};

// ═══════════════════════════════════════════
// 层锁：第N层需要该系已投入多少点（仿LOL）
// ═══════════════════════════════════════════
export const TIER_LOCK: Record<number, number> = {
  1: 0,
  2: 5,
  3: 10,
  4: 15,
  5: 20,
};

const POINT_SCALE = 0.20;

// ═══════════════════════════════════════════
// 破道 — 攻击系（4列 × 5层 = 20节点）
// ═══════════════════════════════════════════
const HADO_NODES: KidoNode[] = [
  // ===== T1 (0点解锁) =====
  { id: 'hado_t1_01', name: '冲', number: '之一', school: 'hado', tier: 1, column: 0, maxPoints: 3, mp: 8, basePower: 1.4, desc: '单体灵力冲击', effect: { type: 'damage', target: 'single', scalePerPoint: 0.18 } },
  { id: 'hado_t1_02', name: '白雷', number: '之四', school: 'hado', tier: 1, column: 1, maxPoints: 3, mp: 12, basePower: 1.9, desc: '单体雷击', effect: { type: 'damage', target: 'single', scalePerPoint: 0.18 } },
  { id: 'hado_t1_03', name: '缀雷电', number: '之十一', school: 'hado', tier: 1, column: 2, maxPoints: 3, mp: 14, basePower: 2.0, desc: '雷电地脉传导，无视防御', effect: { type: 'damage', target: 'single', scalePerPoint: 0.18 } },
  { id: 'hado_t1_04', name: '灵压感知', school: 'hado', tier: 1, column: 3, maxPoints: 3, mp: 0, basePower: 0, passive: true, desc: '每级MATK+2%', effect: { type: 'passive_stat', stat: 'matk_pct', amount: 0.02 } },

  // ===== T2 (5点解锁) =====
  { id: 'hado_t2_01', name: '赤火炮', number: '之三十一', school: 'hado', tier: 2, column: 0, maxPoints: 3, mp: 22, basePower: 1.6, desc: '全体灵力弹', effect: { type: 'damage', target: 'all', scalePerPoint: 0.18 } },
  { id: 'hado_t2_02', name: '苍火坠', number: '之三十三', school: 'hado', tier: 2, column: 1, maxPoints: 3, mp: 18, basePower: 2.4, desc: '单体灵力爆破', effect: { type: 'damage', target: 'single', scalePerPoint: 0.18 } },
  { id: 'hado_t2_03', name: '废炎', number: '之五十四', school: 'hado', tier: 2, column: 2, maxPoints: 3, mp: 20, basePower: 2.2, desc: '火焰吞噬，无视防御', effect: { type: 'damage', target: 'single', scalePerPoint: 0.18 } },
  { id: 'hado_t2_04', name: '灵力集中', school: 'hado', tier: 2, column: 3, maxPoints: 3, mp: 0, basePower: 0, passive: true, desc: '每级破道暴击率+2%', effect: { type: 'passive_school', stat: 'crit', amount: 0.02, school: 'hado' } },

  // ===== T3 (10点解锁) =====
  { id: 'hado_t3_01', name: '雷吼炮', number: '之六十三', school: 'hado', tier: 3, column: 0, maxPoints: 3, mp: 30, basePower: 2.0, desc: '全体雷电轰击', effect: { type: 'damage', target: 'all', scalePerPoint: 0.18 } },
  { id: 'hado_t3_02', name: '双莲苍火坠', number: '之七十三', school: 'hado', tier: 3, column: 1, maxPoints: 3, mp: 34, basePower: 2.8, desc: '双发苍火坠·单体', effect: { type: 'damage', target: 'single', scalePerPoint: 0.18 } },
  { id: 'hado_t3_03', name: '斩华轮', number: '之七十八', school: 'hado', tier: 3, column: 2, maxPoints: 3, mp: 28, basePower: 2.2, desc: '斩击灵力全体攻击', effect: { type: 'damage', target: 'all', scalePerPoint: 0.18 } },
  { id: 'hado_t3_04', name: '灵子集中', school: 'hado', tier: 3, column: 3, maxPoints: 3, mp: 0, basePower: 0, passive: true, desc: '每级破道伤害+3%', effect: { type: 'passive_school', stat: 'dmg', amount: 0.03, school: 'hado' } },

  // ===== T4 (15点解锁) =====
  { id: 'hado_t4_01', name: '黑棺', number: '之九十', school: 'hado', tier: 4, column: 0, maxPoints: 2, mp: 55, basePower: 4.5, desc: '单体毁灭级灵力打击', effect: { type: 'damage', target: 'single', scalePerPoint: 0.18 } },
  { id: 'hado_t4_02', name: '千手皎天汰炮', number: '之九十一', school: 'hado', tier: 4, column: 1, maxPoints: 2, mp: 62, basePower: 3.2, desc: '全体光弹连射', effect: { type: 'damage', target: 'all', scalePerPoint: 0.18 } },
  { id: 'hado_t4_03', name: '一刀火葬', number: '之九十六', school: 'hado', tier: 4, column: 2, maxPoints: 2, mp: 58, basePower: 3.8, desc: '单体献祭级攻击(消耗HP)', effect: { type: 'damage', target: 'single', scalePerPoint: 0.18 } },
  { id: 'hado_t4_04', name: '破弃之型', school: 'hado', tier: 4, column: 3, maxPoints: 3, mp: 0, basePower: 0, passive: true, desc: '每级瞬发鬼道伤害+4%', effect: { type: 'passive_school', stat: 'instant_dmg', amount: 0.04, school: 'hado' } },

  // ===== T5 (20点解锁·终极) =====
  { id: 'hado_t5_01', name: '天地灰尽', school: 'hado', tier: 5, column: 0, maxPoints: 1, mp: 80, basePower: 5.5, isMastery: true, desc: '单体终结技', effect: { type: 'damage', target: 'single', scalePerPoint: 0.18 } },
  { id: 'hado_t5_02', name: '五龙转灭', number: '之九十九', school: 'hado', tier: 5, column: 1, maxPoints: 1, mp: 65, basePower: 4.0, isMastery: true, desc: '五条灵龙毁灭单体', effect: { type: 'damage', target: 'single', scalePerPoint: 0.18 } },
  { id: 'hado_t5_03', name: '灵王之力', school: 'hado', tier: 5, column: 2, maxPoints: 1, mp: 100, basePower: 6.0, isMastery: true, desc: '单体最强灵力轰击', effect: { type: 'damage', target: 'single', scalePerPoint: 0.18 } },
  { id: 'hado_t5_04', name: '崩玉共鸣', school: 'hado', tier: 5, column: 3, maxPoints: 1, mp: 0, basePower: 0, passive: true, isMastery: true, desc: '最终伤害+15%', effect: { type: 'passive_school', stat: 'dmg_bonus', amount: 0.15, school: 'hado' } },
];

// ═══════════════════════════════════════════
// 缚道 — 控制/防御系（4列 × 5层 = 20节点）
// ═══════════════════════════════════════════
const BAKUDO_NODES: KidoNode[] = [
  // ===== T1 =====
  { id: 'bakudo_t1_01', name: '塞', number: '之一', school: 'bakudo', tier: 1, column: 0, maxPoints: 3, mp: 10, basePower: 0, desc: '单体封印技能1回合', effect: { type: 'control', subtype: 'seal', turns: 1, target: 'single', rate: 0.60 } },
  { id: 'bakudo_t1_02', name: '这绳', number: '之四', school: 'bakudo', tier: 1, column: 1, maxPoints: 3, mp: 12, basePower: 0, desc: '单体减速2回合', effect: { type: 'control', subtype: 'slow', turns: 2, target: 'single', rate: 0.65 } },
  { id: 'bakudo_t1_03', name: '斥', number: '之八', school: 'bakudo', tier: 1, column: 2, maxPoints: 3, mp: 14, basePower: 0, desc: '单体击退+眩晕', effect: { type: 'control', subtype: 'stun', turns: 1, target: 'single', rate: 0.50 } },
  { id: 'bakudo_t1_04', name: '铁壁', school: 'bakudo', tier: 1, column: 3, maxPoints: 3, mp: 0, basePower: 0, passive: true, desc: '每级DEF+2%', effect: { type: 'passive_stat', stat: 'def_pct', amount: 0.02 } },

  // ===== T2 =====
  { id: 'bakudo_t2_01', name: '赤烟遁', number: '之二十一', school: 'bakudo', tier: 2, column: 0, maxPoints: 3, mp: 18, basePower: 0, desc: '全体烟幕·减速', effect: { type: 'control', subtype: 'slow', turns: 2, target: 'all', rate: 0.55 } },
  { id: 'bakudo_t2_02', name: '嘴突三闪', number: '之三十', school: 'bakudo', tier: 2, column: 1, maxPoints: 3, mp: 22, basePower: 0, desc: '三道光牢定身1回合', effect: { type: 'control', subtype: 'bind', turns: 1, target: 'single', rate: 0.65 } },
  { id: 'bakudo_t2_03', name: '圆闸扇', number: '之三十九', school: 'bakudo', tier: 2, column: 2, maxPoints: 3, mp: 22, basePower: 0, desc: '圆形灵子护盾2回合', effect: { type: 'shield', turns: 2, scalePerPoint: 0.25 } },
  { id: 'bakudo_t2_04', name: '束缚强化', school: 'bakudo', tier: 2, column: 3, maxPoints: 3, mp: 0, basePower: 0, passive: true, desc: '每级控制成功率+2%', effect: { type: 'passive_school', stat: 'ctrl_rate', amount: 0.02, school: 'bakudo' } },

  // ===== T3 =====
  { id: 'bakudo_t3_01', name: '六杖光牢', number: '之六十一', school: 'bakudo', tier: 3, column: 0, maxPoints: 3, mp: 22, basePower: 0, desc: '六片光牢禁锢2回合', effect: { type: 'control', subtype: 'bind', turns: 2, target: 'single', rate: 0.75 } },
  { id: 'bakudo_t3_02', name: '百步栏杆', number: '之六十二', school: 'bakudo', tier: 3, column: 1, maxPoints: 3, mp: 24, basePower: 0, desc: '全体减速+概率定身', effect: { type: 'control', subtype: 'slow', turns: 2, target: 'all', rate: 0.65 } },
  { id: 'bakudo_t3_03', name: '倒山晶', number: '之七十三', school: 'bakudo', tier: 3, column: 2, maxPoints: 3, mp: 28, basePower: 0, desc: '倒金字塔全队护盾', effect: { type: 'shield', turns: 2, scalePerPoint: 0.25 } },
  { id: 'bakudo_t3_04', name: '不动心', school: 'bakudo', tier: 3, column: 3, maxPoints: 3, mp: 0, basePower: 0, passive: true, desc: '每级被暴击伤害-3%', effect: { type: 'passive_stat', stat: 'crit_def', amount: 0.03 } },

  // ===== T4 =====
  { id: 'bakudo_t4_01', name: '五柱铁贯', number: '之七十五', school: 'bakudo', tier: 4, column: 0, maxPoints: 2, mp: 32, basePower: 0, desc: '五根铁柱禁锢4回合', effect: { type: 'control', subtype: 'bind', turns: 4, target: 'single', rate: 0.80 } },
  { id: 'bakudo_t4_02', name: '九曜缚', number: '之七十九', school: 'bakudo', tier: 4, column: 1, maxPoints: 2, mp: 34, basePower: 0, desc: '九个黑洞完全禁锢5回合', effect: { type: 'control', subtype: 'bind', turns: 5, target: 'single', rate: 0.75 } },
  { id: 'bakudo_t4_03', name: '断空', number: '之八十一', school: 'bakudo', tier: 4, column: 2, maxPoints: 2, mp: 28, basePower: 0, desc: '防御壁·抵挡下次伤害', effect: { type: 'shield', turns: 1, scalePerPoint: 0.30 } },
  { id: 'bakudo_t4_04', name: '反镜', school: 'bakudo', tier: 4, column: 3, maxPoints: 3, mp: 0, basePower: 0, passive: true, desc: '每级反弹伤害+3%', effect: { type: 'passive_stat', stat: 'thorns', amount: 0.03 } },

  // ===== T5 =====
  { id: 'bakudo_t5_01', name: '四兽塞门', school: 'bakudo', tier: 5, column: 0, maxPoints: 1, mp: 80, basePower: 0, isMastery: true, desc: '最强封印·四兽之门', effect: { type: 'control', subtype: 'bind', turns: 4, target: 'single', rate: 0.95 } },
  { id: 'bakudo_t5_02', name: '时间停止', school: 'bakudo', tier: 5, column: 1, maxPoints: 1, mp: 90, basePower: 0, isMastery: true, desc: '全体时封1回合', effect: { type: 'control', subtype: 'freeze', turns: 1, target: 'all', rate: 0.85 } },
  { id: 'bakudo_t5_03', name: '神盾', school: 'bakudo', tier: 5, column: 2, maxPoints: 1, mp: 70, basePower: 0, isMastery: true, desc: '吸收大量伤害的绝对屏障', effect: { type: 'shield', turns: 3, scalePerPoint: 0.50 } },
  { id: 'bakudo_t5_04', name: '镜花水月', school: 'bakudo', tier: 5, column: 3, maxPoints: 1, mp: 0, basePower: 0, passive: true, isMastery: true, desc: '概率闪避所有攻击', effect: { type: 'passive_stat', stat: 'dodge', amount: 0.15 } },
];

// ═══════════════════════════════════════════
// 回道 — 治愈/辅助系（4列 × 5层 = 20节点）
// ═══════════════════════════════════════════
const KAIDO_NODES: KidoNode[] = [
  // ===== T1 =====
  { id: 'kaido_t1_01', name: '治', school: 'kaido', tier: 1, column: 0, maxPoints: 3, mp: 10, basePower: 60, desc: '单体HP小回复', effect: { type: 'heal', target: 'single', amount: 60 } },
  { id: 'kaido_t1_02', name: '中治', school: 'kaido', tier: 1, column: 1, maxPoints: 3, mp: 16, basePower: 150, desc: '单体HP中回复+解1异常', effect: { type: 'heal', target: 'single', amount: 150 } },
  { id: 'kaido_t1_03', name: '大治', school: 'kaido', tier: 1, column: 2, maxPoints: 3, mp: 24, basePower: 100, desc: '全队HP回复', effect: { type: 'heal', target: 'all', amount: 100 } },
  { id: 'kaido_t1_04', name: '生机勃勃', school: 'kaido', tier: 1, column: 3, maxPoints: 3, mp: 0, basePower: 0, passive: true, desc: '每级HP上限+2%', effect: { type: 'passive_stat', stat: 'hp_pct', amount: 0.02 } },

  // ===== T2 =====
  { id: 'kaido_t2_01', name: '灵复', school: 'kaido', tier: 2, column: 0, maxPoints: 3, mp: 32, basePower: 0, desc: '复活单体(50%HP)', effect: { type: 'revive', hpPercent: 50 } },
  { id: 'kaido_t2_02', name: '结界·生', school: 'kaido', tier: 2, column: 1, maxPoints: 3, mp: 28, basePower: 50, desc: '全队3回合持续回复', effect: { type: 'heal', target: 'all', amount: 50 } },
  { id: 'kaido_t2_03', name: '解毒', school: 'kaido', tier: 2, column: 2, maxPoints: 3, mp: 18, basePower: 0, desc: '全队解除异常', effect: { type: 'cleanse', target: 'all' } },
  { id: 'kaido_t2_04', name: '治疗强化', school: 'kaido', tier: 2, column: 3, maxPoints: 3, mp: 0, basePower: 0, passive: true, desc: '每级回道效果+3%', effect: { type: 'passive_school', stat: 'heal', amount: 0.03, school: 'kaido' } },

  // ===== T3 =====
  { id: 'kaido_t3_01', name: '圣疗', school: 'kaido', tier: 3, column: 0, maxPoints: 3, mp: 48, basePower: 400, desc: '全队HP大回复+清异常', effect: { type: 'heal', target: 'all', amount: 400 } },
  { id: 'kaido_t3_02', name: '回生', school: 'kaido', tier: 3, column: 1, maxPoints: 2, mp: 55, basePower: 0, desc: '复活单体(80%HP)', effect: { type: 'revive', hpPercent: 80 } },
  { id: 'kaido_t3_03', name: '甘露', school: 'kaido', tier: 3, column: 2, maxPoints: 3, mp: 30, basePower: 60, desc: '全队持续回复(5回合)', effect: { type: 'heal', target: 'all', amount: 60 } },
  { id: 'kaido_t3_04', name: '祈祷', school: 'kaido', tier: 3, column: 3, maxPoints: 3, mp: 0, basePower: 0, passive: true, desc: '每级被治疗量+3%', effect: { type: 'passive_stat', stat: 'heal_recv', amount: 0.03 } },

  // ===== T4 =====
  { id: 'kaido_t4_01', name: '天神救赎', school: 'kaido', tier: 4, column: 0, maxPoints: 2, mp: 65, basePower: 700, desc: '全队巨额回复', effect: { type: 'heal', target: 'all', amount: 700 } },
  { id: 'kaido_t4_02', name: '永恒回生', school: 'kaido', tier: 4, column: 1, maxPoints: 1, mp: 80, basePower: 0, desc: '复活单体(100%HP)', effect: { type: 'revive', hpPercent: 100 } },
  { id: 'kaido_t4_03', name: '圣域', school: 'kaido', tier: 4, column: 2, maxPoints: 2, mp: 50, basePower: 80, desc: '全队持续回复+净化3回合', effect: { type: 'heal', target: 'all', amount: 80 } },
  { id: 'kaido_t4_04', name: '庇护', school: 'kaido', tier: 4, column: 3, maxPoints: 3, mp: 0, basePower: 0, passive: true, desc: '每级SPD+3%', effect: { type: 'passive_stat', stat: 'spd_pct', amount: 0.03 } },

  // ===== T5 =====
  { id: 'kaido_t5_01', name: '创世之光', school: 'kaido', tier: 5, column: 0, maxPoints: 1, mp: 100, basePower: 1200, isMastery: true, desc: '全队满血+全净化', effect: { type: 'heal', target: 'all', amount: 1200 } },
  { id: 'kaido_t5_02', name: '轮回', school: 'kaido', tier: 5, column: 1, maxPoints: 1, mp: 90, basePower: 0, isMastery: true, desc: '全队复活(50%HP)', effect: { type: 'revive', hpPercent: 50 } },
  { id: 'kaido_t5_03', name: '不死领域', school: 'kaido', tier: 5, column: 2, maxPoints: 1, mp: 80, basePower: 0, isMastery: true, desc: '全队数回合不死', effect: { type: 'shield', turns: 3, scalePerPoint: 0.50 } },
  { id: 'kaido_t5_04', name: '生命之源', school: 'kaido', tier: 5, column: 3, maxPoints: 1, mp: 0, basePower: 0, passive: true, isMastery: true, desc: 'HP上限+20%', effect: { type: 'passive_stat', stat: 'hp_pct', amount: 0.20 } },
];

// ═══════════════════════════════════════════
// 汇总
// ═══════════════════════════════════════════
export const ALL_KIDO_NODES: KidoNode[] = [...HADO_NODES, ...BAKUDO_NODES, ...KAIDO_NODES];

export const KIDO_NODES: Record<string, KidoNode> = Object.fromEntries(
  ALL_KIDO_NODES.map(n => [n.id, n])
);

// ═══════════════════════════════════════════
// 鬼道管理器
// ═══════════════════════════════════════════
class KidoManager {
  school: KidoSchool | null = null;
  nodes: Record<string, number> = {};
  totalPoints = 0;
  equipped: string[] = [];
  static readonly MAX_EQUIPPED = 4;

  pointsSpent(): number {
    return Object.values(this.nodes).reduce((a, b) => a + b, 0);
  }

  availablePoints(): number {
    return this.totalPoints - this.pointsSpent();
  }

  addPoints(amount: number): void {
    this.totalPoints += amount;
  }

  /** 该系已投入总点数 */
  pointsInSchool(school: KidoSchool): number {
    return ALL_KIDO_NODES
      .filter(n => n.school === school)
      .reduce((sum, n) => sum + (this.nodes[n.id] || 0), 0);
  }

  getPoints(id: string): number {
    return this.nodes[id] || 0;
  }

  /** 节点是否已解锁（仅判断层锁） */
  isUnlocked(id: string): boolean {
    const node = KIDO_NODES[id];
    if (!node) return false;
    const inSchool = this.pointsInSchool(node.school);
    return inSchool >= (TIER_LOCK[node.tier] || 0);
  }

  /** 判断节点是否可加点 */
  canAddPoint(id: string): boolean {
    const node = KIDO_NODES[id];
    if (!node) return false;
    if (!this.isUnlocked(id)) return false;
    if ((this.nodes[id] || 0) >= node.maxPoints) return false;
    if (this.availablePoints() <= 0) return false;
    return true;
  }

  /** 投入1点 */
  addPoint(id: string): boolean {
    if (!this.canAddPoint(id)) return false;
    this.nodes[id] = (this.nodes[id] || 0) + 1;
    return true;
  }

  /** 移除1点（仅当节点已满级或多余点数时使用） */
  removePoint(id: string): boolean {
    const current = this.nodes[id] || 0;
    if (current <= 0) return false;
    this.nodes[id] = current - 1;
    if (this.nodes[id] === 0) delete this.nodes[id];
    if (this.equipped.includes(id)) this.unequipKido(id);
    return true;
  }

  /** 重置某系天赋 */
  resetSchool(school: KidoSchool): void {
    for (const id of Object.keys(this.nodes)) {
      const node = KIDO_NODES[id];
      if (node && node.school === school) {
        delete this.nodes[id];
        this.unequipKido(id);
      }
    }
  }

  getNodeMp(id: string): number {
    const node = KIDO_NODES[id];
    const pts = this.nodes[id] || 0;
    if (!node || pts <= 0) return 0;
    if (node.passive) return 0;
    // 等级越高MP消耗越高：每级+12%
    return Math.round(node.mp * (1 + (pts - 1) * 0.12));
  }

  getNodePower(id: string): number {
    const node = KIDO_NODES[id];
    const pts = this.nodes[id] || 0;
    if (!node || pts <= 0) return 0;
    const scale = (node.effect as any).scalePerPoint || POINT_SCALE;
    return node.basePower * (1 + (pts - 1) * scale);
  }

  /** 获取所有被动属性加成（用于角色面板+战斗属性计算） */
  getPassiveStats(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const nodeId of Object.keys(this.nodes)) {
      const pts = this.nodes[nodeId];
      if (pts <= 0) continue;
      const node = KIDO_NODES[nodeId];
      if (!node || !node.passive) continue;
      const eff = node.effect;
      if (eff.type === 'passive_stat' || eff.type === 'passive_school') {
        result[eff.stat] = (result[eff.stat] || 0) + eff.amount * pts;
      }
    }
    return result;
  }

  getActiveLearned(): KidoNode[] {
    return ALL_KIDO_NODES
      .filter(n => (this.nodes[n.id] || 0) > 0 && !n.passive)
      .sort((a, b) => a.tier - b.tier || a.column - b.column);
  }

  getLearnedNodes(): KidoNode[] {
    return ALL_KIDO_NODES.filter(n => (this.nodes[n.id] || 0) > 0);
  }

  getEquippedNodes(): KidoNode[] {
    return this.equipped.map(id => KIDO_NODES[id]).filter(Boolean);
  }

  equipKido(id: string): boolean {
    const node = KIDO_NODES[id];
    if (!node || (this.nodes[id] || 0) <= 0) return false;
    if (node.passive) return false;
    if (this.equipped.includes(id)) return false;
    if (this.equipped.length >= KidoManager.MAX_EQUIPPED) {
      this.equipped.pop();
    }
    this.equipped.push(id);
    return true;
  }

  unequipKido(id: string): void {
    this.equipped = this.equipped.filter(e => e !== id);
  }

  getSchoolNodes(school: KidoSchool): KidoNode[] {
    return ALL_KIDO_NODES.filter(n => n.school === school);
  }

  reset(): void {
    this.school = null;
    this.nodes = {};
    this.equipped = [];
    this.totalPoints = 0;
  }

  private static instance: KidoManager;
  static get(): KidoManager {
    if (!this.instance) this.instance = new KidoManager();
    return this.instance;
  }
}

export const Kido = KidoManager.get();

export function getKidoFullName(node: KidoNode): string {
  if (node.number) return `${node.school === 'hado' ? '破道' : '缚道'}${node.number}·${node.name}`;
  return node.name;
}

export function getKidoColor(school: KidoSchool): string {
  return school === 'hado' ? '#cc4444' : school === 'bakudo' ? '#6666ff' : '#44cc44';
}

export function calcKidoPoints(level: number, chapter: number): number {
  const fromLevel = Math.floor(level / 2);
  const fromChapter = chapter * 3;
  return fromLevel + fromChapter;
}
