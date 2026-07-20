import type { NamedEnemyDef, NamedEquipDrop, BestiaryTier } from '../managers/BestiaryData';

export const ZONE1_ENEMIES: NamedEnemyDef[] = [
  {
    name: '低级虚',
    type: '杂妖', element: '无',
    statusResist: { 冻结: 0.30, 灼烧: 0.50 },
    lore: '空座町最常见的虚。没有自主意识，凭本能捕食人类的灵魂。',
  },
  {
    name: '蛇虚',
    type: '杂妖', element: '土', weakness: '风',
    statusResist: { 冻结: 0.30, 减速: 0.50 },
    skills: [
      { name: '撕咬', power: 1.1, desc: '带毒撕咬', damageType: 'physical' },
    ],
    drops: [
      { item: '铁矿石', rate: 0.25 },
      { item: '麻布片', rate: 0.15 },
    ],
    lore: '蛇形虚，盘踞在空座町的暗巷。鳞片坚硬但惧风。',
  },
  {
    name: '飞虚',
    type: '杂妖', element: '风', weakness: '火',
    statusResist: { 眩晕: 0.30, 减速: 0.60 },
    skills: [
      { name: '俯冲', power: 1.2, desc: '空中俯冲攻击', damageType: 'physical' },
    ],
    drops: [
      { item: '灵木枝', rate: 0.20 },
      { item: '麻布片', rate: 0.15 },
    ],
    lore: '拥有薄翼的虚，行动迅捷。翅膀脆弱，畏惧火焰。',
  },
  {
    name: '大虚·基利安',
    type: '恶妖', element: '无',
    statusResist: { 冻结: 0.50, 眩晕: 0.50, 恐惧: 0.70 },
    skills: [
      { name: '猛击', power: 1.3, desc: '巨爪横扫', damageType: 'physical' },
      { name: '虚闪', power: 1.6, desc: '口部凝聚黑色灵力射线', damageType: 'magical' },
    ],
    drops: [
      { item: '银矿石', rate: 0.30 },
      { item: '硬皮', rate: 0.25 },
      { item: '虚夜碎片', rate: 0.08 },
    ],
    statMult: { HP: 1.2, ATK: 1.1 },
    rewardMult: { exp: 1.5, gold: 1.3 },
    lore: '由数百只低级虚融合而成的巨大虚。高逾数十米，能释放虚闪。是空座町少有出现的中级虚。',
  },
  // ── 区域①Boss ──
  {
    name: '大虚·亚丘卡斯',
    type: '妖将', element: '无',
    weakness: undefined,
    statusResist: { 冻结: 0.70, 眩晕: 0.80, 恐惧: 0.90, 中毒: 0.50 },
    skills: [
      { name: '虚闪·凝聚', power: 1.8, desc: '蓄力后释放强力虚闪', damageType: 'magical' },
      { name: '旋风爪', power: 1.5, desc: '旋转利爪攻击全体', damageType: 'physical' },
      { name: '再生', power: 0, desc: 'HP低于40%时回复20%最大HP（1次）', damageType: 'physical' },
    ],
    drops: [
      { item: '妖将核心', rate: 1.0 },
      { item: '灵晶碎片', rate: 0.60 },
      { item: '虚夜护腕', rate: 0.30, quality: 'green' },
      { item: '虚夜碎片', rate: 0.40 },
    ],
    statMult: { HP: 1.3, ATK: 1.2, SPD: 1.1 },
    rewardMult: { exp: 2.0, gold: 1.8 },
    lore: '基利安进化的上位虚。拥有自主意识和高度战斗本能。它的出现意味着虚圈的裂隙正在扩大。',
  },
];

export const ZONE2_ENEMIES: NamedEnemyDef[] = [
  {
    name: '中级虚', type: '杂妖', element: '无',
    statusResist: { 冻结: 0.40, 灼烧: 0.40 },
    lore: '比低级虚稍强，有基本的战斗本能。空座町住宅区常见的虚。',
  },
  {
    name: '飞虚·改', type: '杂妖', element: '风', weakness: '火',
    statusResist: { 眩晕: 0.40, 减速: 0.50 },
    skills: [{ name: '裂风俯冲', power: 1.3, desc: '高速俯冲带风刃', damageType: 'physical' }],
    drops: [{ item: '灵木枝', rate: 0.25 }, { item: '硬皮', rate: 0.10 }],
    lore: '飞虚的变种，翅膀更坚韧，速度更快。',
  },
  {
    name: '蛇虚·改', type: '杂妖', element: '土', weakness: '风',
    statusResist: { 冻结: 0.40, 减速: 0.40 },
    skills: [{ name: '毒牙撕咬', power: 1.2, desc: '带强烈毒素的撕咬', damageType: 'physical' }],
    drops: [{ item: '铁矿石', rate: 0.30 }, { item: '毒腺', rate: 0.15 }],
    lore: '蛇虚的变种，毒性更强，鳞片更硬。',
  },
  {
    name: '虚群', type: '杂妖', element: '无',
    statusResist: { 冻结: 0.20, 眩晕: 0.30 },
    lore: '多只低级虚聚集形成的虚群。个体弱小但数量多，围攻时危险。',
  },
];

export const ZONE3_ENEMIES: NamedEnemyDef[] = [
  {
    name: '流魂街强盗', type: '杂妖', element: '土', weakness: '风',
    statusResist: { 眩晕: 0.30, 恐惧: 0.40 },
    skills: [{ name: '横劈', power: 1.1, desc: '粗犷的刀法横劈', damageType: 'physical' }],
    drops: [{ item: '铁矿石', rate: 0.25 }, { item: '麻布片', rate: 0.30 }],
    lore: '流魂街的流浪者堕落为盗匪。武艺粗浅但穷凶极恶。',
  },
  {
    name: '暴走虚', type: '杂妖', element: '无',
    statusResist: { 眩晕: 0.60, 恐惧: 0.70, 禁锢: 0.40 },
    skills: [{ name: '疯狂乱抓', power: 1.3, desc: '失去理智的连续抓击', damageType: 'physical' }],
    lore: '失去理智暴走的虚。攻击毫无章法但异常凶猛。',
  },
  {
    name: '叛逆队员', type: '杂妖', element: '无',
    statusResist: { 眩晕: 0.30, 恐惧: 0.30 },
    skills: [{ name: '斩击', power: 1.1, desc: '死神队员的基本斩击', damageType: 'physical' }],
    drops: [{ item: '浅打碎片', rate: 0.10 }, { item: '麻布片', rate: 0.25 }],
    lore: '叛离护廷十三队的死神队员。保留着基本的战斗训练。',
  },
];

export const ZONE4_ENEMIES: NamedEnemyDef[] = [
  {
    name: '流魂街暴徒', type: '杂妖', element: '土', weakness: '风',
    statusResist: { 眩晕: 0.30, 恐惧: 0.40 },
    skills: [{ name: '重击', power: 1.2, desc: '力量型重击', damageType: 'physical' }],
    drops: [{ item: '铁矿石', rate: 0.25 }, { item: '麻布片', rate: 0.25 }],
    lore: '比强盗更暴力的流魂街暴徒。力量更强但更莽撞。',
  },
  {
    name: '暴走虚·改', type: '杂妖', element: '无',
    statusResist: { 眩晕: 0.70, 恐惧: 0.80, 禁锢: 0.50 },
    skills: [{ name: '狂暴连爪', power: 1.4, desc: '更狂暴的连续爪击', damageType: 'physical' }],
    statMult: { HP: 1.1, ATK: 1.1 },
    lore: '暴走虚的强化形态。更难控制，攻击力更高。',
  },
];

export const ZONE5_ENEMIES: NamedEnemyDef[] = [
  {
    name: '武装暴徒', type: '杂妖', element: '土', weakness: '风',
    statusResist: { 眩晕: 0.30, 恐惧: 0.30 },
    skills: [{ name: '武装斩击', power: 1.3, desc: '持武器的高级斩击', damageType: 'physical' }],
    drops: [{ item: '铁矿石', rate: 0.30 }, { item: '浅打碎片', rate: 0.08 }],
    lore: '全副武装的流魂街暴徒。装备精良，战斗力不俗。',
  },
  {
    name: '叛逆队员·长', type: '杂妖', element: '无',
    statusResist: { 眩晕: 0.30, 恐惧: 0.30 },
    skills: [{ name: '连斩', power: 1.2, desc: '快速连续斩击', damageType: 'physical' }],
    statMult: { HP: 1.1, ATK: 1.1 },
    drops: [{ item: '浅打碎片', rate: 0.15 }],
    lore: '叛逆队员的小队长。战斗经验更丰富。',
  },
  {
    name: '叛逆死神', type: '恶妖', element: '无',
    statusResist: { 眩晕: 0.40, 恐惧: 0.50, 禁锢: 0.40 },
    skills: [{ name: '鬼道·白伏', power: 1.4, desc: '中级鬼道攻击', damageType: 'magical' }],
    statMult: { HP: 1.2, ATK: 1.1, MATK: 1.2 },
    rewardMult: { exp: 1.3, gold: 1.2 },
    drops: [{ item: '鬼道卷轴', rate: 0.20 }, { item: '浅打碎片', rate: 0.15 }],
    lore: '正式叛离的死神。掌握鬼道，战斗力远超普通队员。',
  },
];

export const ZONE6_ENEMIES: NamedEnemyDef[] = [
  {
    name: '护廷队士', type: '杂妖', element: '无',
    statusResist: { 眩晕: 0.30, 恐惧: 0.30 },
    skills: [{ name: '护廷斩术', power: 1.2, desc: '护廷十三队标准斩术', damageType: 'physical' }],
    drops: [{ item: '浅打碎片', rate: 0.15 }, { item: '麻布片', rate: 0.20 }],
    lore: '护廷十三队的基层队士。训练有素，配合默契。',
  },
];

export const ZONE7_ENEMIES: NamedEnemyDef[] = [
  {
    name: '上级死神', type: '杂妖', element: '无',
    statusResist: { 眩晕: 0.40, 恐惧: 0.40, 禁锢: 0.30 },
    skills: [{ name: '上级斩术', power: 1.3, desc: '高阶死神斩术', damageType: 'physical' }],
    statMult: { HP: 1.2, ATK: 1.2 },
    drops: [{ item: '浅打碎片', rate: 0.20 }, { item: '灵木枝', rate: 0.10 }],
    lore: '护廷十三队的上级死神。实力强劲，是队士的数倍。',
  },
  {
    name: '叛逆死神·长', type: '恶妖', element: '无',
    statusResist: { 眩晕: 0.50, 恐惧: 0.50, 禁锢: 0.40 },
    skills: [
      { name: '鬼道·苍火坠', power: 1.5, desc: '火系鬼道', damageType: 'magical' },
      { name: '连斩·烈', power: 1.3, desc: '强力连续斩击', damageType: 'physical' },
    ],
    statMult: { HP: 1.3, ATK: 1.2, MATK: 1.3 },
    rewardMult: { exp: 1.5, gold: 1.3 },
    drops: [{ item: '鬼道卷轴', rate: 0.25 }, { item: '妖将核心', rate: 0.05 }],
    lore: '叛离死神的队长级人物。精通鬼道与斩术，极其危险。',
  },
];

export const ZONE8_ENEMIES: NamedEnemyDef[] = [
  {
    name: '基利安', type: '杂妖', element: '无',
    statusResist: { 冻结: 0.50, 眩晕: 0.50, 恐惧: 0.60 },
    skills: [{ name: '虚闪', power: 1.5, desc: '黑色灵力射线', damageType: 'magical' }],
    statMult: { HP: 1.3, MATK: 1.2 },
    rewardMult: { exp: 1.5, gold: 1.2 },
    drops: [{ item: '虚夜碎片', rate: 0.15 }, { item: '硬皮', rate: 0.20 }],
    lore: '断界中游荡的大虚。比空座町的基利安更强。',
  },
  {
    name: '亚丘卡斯', type: '恶妖', element: '无',
    statusResist: { 冻结: 0.60, 眩晕: 0.60, 恐惧: 0.70, 中毒: 0.40 },
    skills: [
      { name: '虚闪·强', power: 1.7, desc: '强化虚闪', damageType: 'magical' },
      { name: '高速爪击', power: 1.4, desc: '极速爪击', damageType: 'physical' },
    ],
    statMult: { HP: 1.4, ATK: 1.2, SPD: 1.2 },
    rewardMult: { exp: 1.8, gold: 1.5 },
    drops: [{ item: '虚夜碎片', rate: 0.25 }, { item: '妖将核心', rate: 0.10 }],
    lore: '断界中的亚丘卡斯级大虚。有自主意识，能使用强化虚闪。',
  },
  {
    name: '破面·下级', type: '杂妖', element: '无',
    statusResist: { 冻结: 0.50, 眩晕: 0.50, 恐惧: 0.60 },
    skills: [{ name: '虚闪', power: 1.5, desc: '基本虚闪', damageType: 'magical' }],
    statMult: { HP: 1.3, ATK: 1.2 },
    drops: [{ item: '虚夜碎片', rate: 0.20 }, { item: '硬皮', rate: 0.25 }],
    lore: '摘下面具的下级破面。拥有虚的力量和类似死神的外观。',
  },
  {
    name: '基利安群', type: '杂妖', element: '无',
    statusResist: { 冻结: 0.40, 眩晕: 0.40, 恐惧: 0.50 },
    lore: '多只基利安聚集。个体实力一般，但虚闪齐射威力惊人。',
  },
  {
    name: '破面·上级', type: '恶妖', element: '无',
    statusResist: { 冻结: 0.60, 眩晕: 0.60, 恐惧: 0.70, 中毒: 0.40 },
    skills: [
      { name: '王虚的闪光', power: 1.8, desc: '破面专属强力虚闪', damageType: 'magical' },
      { name: '响转·斩', power: 1.5, desc: '高速移动后斩击', damageType: 'physical' },
    ],
    statMult: { HP: 1.5, ATK: 1.3, SPD: 1.3 },
    rewardMult: { exp: 2.0, gold: 1.5 },
    drops: [{ item: '虚夜碎片', rate: 0.30 }, { item: '破面面具', rate: 0.10 }],
    lore: '实力强劲的上级破面。掌握响转，速度极快。',
  },
  {
    name: '破面·中级', type: '恶妖', element: '无',
    statusResist: { 冻结: 0.55, 眩晕: 0.55, 恐惧: 0.65 },
    skills: [{ name: '虚闪·中', power: 1.6, desc: '中级虚闪', damageType: 'magical' }],
    statMult: { HP: 1.4, ATK: 1.2 },
    rewardMult: { exp: 1.6, gold: 1.3 },
    drops: [{ item: '虚夜碎片', rate: 0.25 }, { item: '硬皮', rate: 0.20 }],
    lore: '中等实力的破面。介于下级与上级之间。',
  },
  {
    name: '亚丘卡斯·改', type: '恶妖', element: '无',
    statusResist: { 冻结: 0.65, 眩晕: 0.65, 恐惧: 0.75, 中毒: 0.45 },
    skills: [
      { name: '虚闪·极', power: 1.9, desc: '极强虚闪', damageType: 'magical' },
      { name: '旋风爪·烈', power: 1.6, desc: '强化旋风爪', damageType: 'physical' },
    ],
    statMult: { HP: 1.5, ATK: 1.3, SPD: 1.2 },
    rewardMult: { exp: 2.0, gold: 1.6 },
    drops: [{ item: '虚夜碎片', rate: 0.30 }, { item: '妖将核心', rate: 0.15 }],
    lore: '亚丘卡斯的强化形态。接近瓦史托德级别的实力。',
  },
  {
    name: '瓦史托德', type: '恶妖', element: '无',
    statusResist: { 冻结: 0.70, 眩晕: 0.70, 恐惧: 0.80, 中毒: 0.50, 禁锢: 0.50 },
    skills: [
      { name: '虚闪·王', power: 2.0, desc: '大虚之王虚闪', damageType: 'magical' },
      { name: '瞬身连斩', power: 1.7, desc: '瞬移连续斩击', damageType: 'physical' },
    ],
    statMult: { HP: 1.6, ATK: 1.4, MATK: 1.3, SPD: 1.4 },
    rewardMult: { exp: 2.5, gold: 2.0 },
    drops: [{ item: '虚夜碎片', rate: 0.40 }, { item: '妖将核心', rate: 0.20 }, { item: '破面面具', rate: 0.15 }],
    lore: '大虚的最高阶。极其稀有且强大，足以匹敌队长级死神。',
  },
];

export const ZONE9_ENEMIES: NamedEnemyDef[] = [
  {
    name: '完现虚', type: '杂妖', element: '无',
    statusResist: { 冻结: 0.50, 眩晕: 0.50, 恐惧: 0.60 },
    skills: [{ name: '完现爪击', power: 1.4, desc: '附带完现术的爪击', damageType: 'physical' }],
    statMult: { HP: 1.3, ATK: 1.2 },
    drops: [{ item: '虚夜碎片', rate: 0.20 }, { item: '完现结晶', rate: 0.10 }],
    lore: '受到完现术影响的虚。力量异变，比普通虚更强。',
  },
  {
    name: '完现者(敌)', type: '恶妖', element: '无',
    statusResist: { 眩晕: 0.50, 恐惧: 0.50, 禁锢: 0.40, 降灵压: 0.30 },
    skills: [
      { name: '完现术·武器', power: 1.5, desc: '完现术具现化武器攻击', damageType: 'physical' },
      { name: '灵压爆发', power: 1.3, desc: '释放灵压冲击', damageType: 'magical' },
    ],
    statMult: { HP: 1.4, ATK: 1.3, MATK: 1.2 },
    rewardMult: { exp: 1.8, gold: 1.5 },
    drops: [{ item: '完现结晶', rate: 0.25 }, { item: '灵木枝', rate: 0.15 }],
    lore: '敌对的完现术使用者。能将物品具现化为武器。',
  },
  {
    name: '完现虚·改', type: '杂妖', element: '无',
    statusResist: { 冻结: 0.60, 眩晕: 0.60, 恐惧: 0.70 },
    skills: [{ name: '完现·暴走爪', power: 1.6, desc: '暴走的完现爪击', damageType: 'physical' }],
    statMult: { HP: 1.4, ATK: 1.3 },
    drops: [{ item: '虚夜碎片', rate: 0.25 }, { item: '完现结晶', rate: 0.15 }],
    lore: '完现虚的强化形态。完现术的力量更加不稳定。',
  },
  {
    name: '完现者·长', type: '恶妖', element: '无',
    statusResist: { 眩晕: 0.60, 恐惧: 0.60, 禁锢: 0.50, 降灵压: 0.40 },
    skills: [
      { name: '完现术·神兵', power: 1.7, desc: '强力完现武器', damageType: 'physical' },
      { name: '灵压屏障', power: 1.0, desc: '防御型完现术', damageType: 'magical' },
    ],
    statMult: { HP: 1.5, ATK: 1.4, DEF: 1.2 },
    rewardMult: { exp: 2.0, gold: 1.6 },
    drops: [{ item: '完现结晶', rate: 0.30 }, { item: '妖将核心', rate: 0.10 }],
    lore: '完现者组织的干部。完现术造诣深厚。',
  },
  {
    name: '完现者·精英', type: '恶妖', element: '无',
    statusResist: { 眩晕: 0.65, 恐惧: 0.65, 禁锢: 0.55, 降灵压: 0.50 },
    skills: [
      { name: '完现术·极', power: 1.9, desc: '精英级完现术', damageType: 'physical' },
      { name: '灵压风暴', power: 1.6, desc: '大范围灵压攻击', damageType: 'magical' },
    ],
    statMult: { HP: 1.6, ATK: 1.5, MATK: 1.3 },
    rewardMult: { exp: 2.2, gold: 1.8 },
    drops: [{ item: '完现结晶', rate: 0.35 }, { item: '妖将核心', rate: 0.15 }],
    lore: '完现者中的精英战士。实力接近队长级。',
  },
  {
    name: '完现术·暴走', type: '恶妖', element: '无',
    statusResist: { 眩晕: 0.80, 恐惧: 0.90, 禁锢: 0.60, 降灵压: 0.50 },
    skills: [
      { name: '暴走冲击', power: 2.0, desc: '失控的完现术冲击', damageType: 'physical' },
      { name: '灵压失控', power: 1.8, desc: '灵压暴走', damageType: 'magical' },
    ],
    statMult: { HP: 1.7, ATK: 1.6, MATK: 1.4 },
    rewardMult: { exp: 2.5, gold: 2.0 },
    drops: [{ item: '完现结晶', rate: 0.40 }, { item: '妖将核心', rate: 0.20 }],
    lore: '完现术失控暴走的个体。极度危险，无法沟通。',
  },
];

export const ZONE10_11_ENEMIES: NamedEnemyDef[] = [
  {
    name: '圣兵', type: '杂妖', element: '无',
    statusResist: { 眩晕: 0.40, 恐惧: 0.40 },
    skills: [{ name: '圣击', power: 1.3, desc: '灵银武器攻击', damageType: 'physical' }],
    drops: [{ item: '灵银碎片', rate: 0.20 }, { item: '麻布片', rate: 0.20 }],
    lore: '无形帝国的基础士兵。装备灵银武器，对死神特攻。',
  },
  {
    name: '星十字骑士', type: '恶妖', element: '无',
    statusResist: { 眩晕: 0.50, 恐惧: 0.50, 禁锢: 0.40, 降灵压: 0.30 },
    skills: [
      { name: '圣文字·击', power: 1.6, desc: '圣文字能力攻击', damageType: 'magical' },
      { name: '灵银弓', power: 1.4, desc: '灵银箭矢射击', damageType: 'physical' },
    ],
    statMult: { HP: 1.5, ATK: 1.3, MATK: 1.3 },
    rewardMult: { exp: 2.0, gold: 1.6 },
    drops: [{ item: '灵银碎片', rate: 0.25 }, { item: '圣文字刻印', rate: 0.10 }],
    lore: '无形帝国的精锐骑士。每人拥有独特的圣文字能力。',
  },
  {
    name: '虚化兵', type: '杂妖', element: '无',
    statusResist: { 冻结: 0.50, 眩晕: 0.50, 恐惧: 0.60 },
    skills: [{ name: '虚化突击', power: 1.4, desc: '虚化后突击', damageType: 'physical' }],
    statMult: { HP: 1.3, ATK: 1.2 },
    drops: [{ item: '灵银碎片', rate: 0.20 }, { item: '虚夜碎片', rate: 0.10 }],
    lore: '被虚化的无形帝国兵。兼具死神与虚的特征。',
  },
  {
    name: '圣兵精英', type: '恶妖', element: '无',
    statusResist: { 眩晕: 0.50, 恐惧: 0.50, 禁锢: 0.40 },
    skills: [{ name: '圣击·烈', power: 1.5, desc: '强化圣击', damageType: 'physical' }],
    statMult: { HP: 1.4, ATK: 1.3 },
    rewardMult: { exp: 1.6, gold: 1.3 },
    drops: [{ item: '灵银碎片', rate: 0.25 }, { item: '圣文字刻印', rate: 0.05 }],
    lore: '圣兵中的精英。装备和训练都优于普通圣兵。',
  },
  {
    name: '星十字骑士·长', type: '恶妖', element: '无',
    statusResist: { 眩晕: 0.60, 恐惧: 0.60, 禁锢: 0.50, 降灵压: 0.40 },
    skills: [
      { name: '圣文字·烈', power: 1.8, desc: '强化圣文字', damageType: 'magical' },
      { name: '灵银连射', power: 1.5, desc: '灵银箭矢连射', damageType: 'physical' },
    ],
    statMult: { HP: 1.6, ATK: 1.4, MATK: 1.4 },
    rewardMult: { exp: 2.2, gold: 1.8 },
    drops: [{ item: '灵银碎片', rate: 0.30 }, { item: '圣文字刻印', rate: 0.20 }],
    lore: '星十字骑士的队长级。圣文字能力更加强大。',
  },
  {
    name: '亲卫队', type: '恶妖', element: '无',
    statusResist: { 眩晕: 0.70, 恐惧: 0.70, 禁锢: 0.60, 降灵压: 0.50, 中毒: 0.50 },
    skills: [
      { name: '圣文字·极', power: 2.0, desc: '亲卫队级圣文字', damageType: 'magical' },
      { name: '灵银风暴', power: 1.7, desc: '灵银箭矢风暴', damageType: 'physical' },
    ],
    statMult: { HP: 1.8, ATK: 1.5, MATK: 1.5, DEF: 1.2 },
    rewardMult: { exp: 2.5, gold: 2.0 },
    drops: [{ item: '灵银碎片', rate: 0.35 }, { item: '圣文字刻印', rate: 0.25 }, { item: '妖将核心', rate: 0.15 }],
    lore: '护卫星十字骑士团最高层的精锐。实力远超普通骑士。',
  },
  {
    name: '虚化兵·改', type: '杂妖', element: '无',
    statusResist: { 冻结: 0.60, 眩晕: 0.60, 恐惧: 0.70 },
    skills: [{ name: '虚化·暴走', power: 1.6, desc: '虚化暴走突击', damageType: 'physical' }],
    statMult: { HP: 1.4, ATK: 1.3 },
    drops: [{ item: '灵银碎片', rate: 0.25 }, { item: '虚夜碎片', rate: 0.15 }],
    lore: '虚化兵的强化形态。虚化程度更深，更难控制。',
  },
];

export const ZONE12_13_ENEMIES: NamedEnemyDef[] = [
  {
    name: '咎人', type: '杂妖', element: '无',
    statusResist: { 灼烧: 0.60, 恐惧: 0.50, 降灵压: 0.30 },
    skills: [{ name: '罪业抓击', power: 1.4, desc: '充满怨念的抓击', damageType: 'physical' }],
    statMult: { HP: 1.3, ATK: 1.2 },
    drops: [{ item: '罪业碎片', rate: 0.20 }, { item: '麻布片', rate: 0.15 }],
    lore: '生前罪孽深重被堕入地狱的灵魂。充满怨念与仇恨。',
  },
  {
    name: '地狱犬', type: '恶妖', element: '火', weakness: '水',
    statusResist: { 灼烧: 0.90, 冻结: 0.30, 恐惧: 0.70 },
    skills: [
      { name: '地狱火息', power: 1.6, desc: '喷吐地狱之火', damageType: 'magical' },
      { name: '撕咬·烈', power: 1.4, desc: '猛烈撕咬', damageType: 'physical' },
    ],
    statMult: { HP: 1.5, ATK: 1.3, MATK: 1.3 },
    rewardMult: { exp: 1.8, gold: 1.5 },
    drops: [{ item: '罪业碎片', rate: 0.25 }, { item: '地狱火种', rate: 0.15 }],
    lore: '地狱的看门犬。全身燃烧地狱之火，免疫火焰。',
  },
  {
    name: '混沌兽', type: '恶妖', element: '无',
    statusResist: { 灼烧: 0.50, 冻结: 0.50, 眩晕: 0.60, 恐惧: 0.60, 降灵压: 0.40 },
    skills: [
      { name: '混沌冲击', power: 1.7, desc: '混沌之力冲击', damageType: 'magical' },
      { name: '混乱爪击', power: 1.5, desc: '附带混乱效果的爪击', damageType: 'physical' },
    ],
    statMult: { HP: 1.6, ATK: 1.3, MATK: 1.4 },
    rewardMult: { exp: 2.0, gold: 1.6 },
    drops: [{ item: '罪业碎片', rate: 0.30 }, { item: '混沌核心', rate: 0.10 }],
    lore: '由地狱怨念凝聚而成的混沌之兽。形态不定，极其危险。',
  },
  {
    name: '地狱守卫', type: '恶妖', element: '土', weakness: '风',
    statusResist: { 灼烧: 0.50, 冻结: 0.50, 眩晕: 0.70, 恐惧: 0.70, 禁锢: 0.50 },
    skills: [
      { name: '大地震荡', power: 1.6, desc: '震撼大地的重击', damageType: 'physical' },
      { name: '岩壁守护', power: 1.0, desc: '提升防御', damageType: 'physical' },
    ],
    statMult: { HP: 1.7, ATK: 1.3, DEF: 1.4 },
    rewardMult: { exp: 2.0, gold: 1.6 },
    drops: [{ item: '罪业碎片', rate: 0.30 }, { item: '硬皮', rate: 0.25 }],
    lore: '地狱的守卫。身躯庞大，防御极高，很难被击倒。',
  },
  {
    name: '咎人·怨', type: '杂妖', element: '无',
    statusResist: { 灼烧: 0.70, 恐惧: 0.60, 降灵压: 0.40 },
    skills: [{ name: '怨念爆发', power: 1.5, desc: '释放怨念攻击', damageType: 'magical' }],
    statMult: { HP: 1.4, MATK: 1.3 },
    drops: [{ item: '罪业碎片', rate: 0.25 }, { item: '怨念结晶', rate: 0.10 }],
    lore: '怨念更深重的咎人。能释放怨念作为攻击手段。',
  },
  {
    name: '终焉之兽', type: '恶妖', element: '无',
    statusResist: { 灼烧: 0.60, 冻结: 0.60, 眩晕: 0.70, 恐惧: 0.70, 降灵压: 0.50, 中毒: 0.50 },
    skills: [
      { name: '终焉咆哮', power: 1.9, desc: '终结一切的咆哮', damageType: 'magical' },
      { name: '毁灭爪击', power: 1.7, desc: '毁灭性爪击', damageType: 'physical' },
    ],
    statMult: { HP: 1.8, ATK: 1.5, MATK: 1.5 },
    rewardMult: { exp: 2.5, gold: 2.0 },
    drops: [{ item: '罪业碎片', rate: 0.35 }, { item: '终焉之核', rate: 0.15 }],
    lore: '预示终结的巨兽。传说它的出现意味着世界的终焉。',
  },
  {
    name: '混沌兽·极', type: '恶妖', element: '无',
    statusResist: { 灼烧: 0.60, 冻结: 0.60, 眩晕: 0.70, 恐惧: 0.70, 降灵压: 0.50, 中毒: 0.50 },
    skills: [
      { name: '混沌·极致', power: 2.0, desc: '混沌之力的极致释放', damageType: 'magical' },
      { name: '虚无爪', power: 1.8, desc: '附带虚无之力的爪击', damageType: 'physical' },
    ],
    statMult: { HP: 1.9, ATK: 1.5, MATK: 1.6 },
    rewardMult: { exp: 2.5, gold: 2.0 },
    drops: [{ item: '罪业碎片', rate: 0.35 }, { item: '混沌核心', rate: 0.20 }],
    lore: '混沌兽的终极形态。混沌之力达到极致。',
  },
  {
    name: '地狱之王', type: '妖王', element: '无',
    statusResist: { 灼烧: 0.90, 冻结: 0.80, 眩晕: 0.90, 恐惧: 1.0, 降灵压: 0.60, 中毒: 0.70, 禁锢: 0.70 },
    skills: [
      { name: '地狱审判', power: 2.2, desc: '地狱之王的终极审判', damageType: 'magical' },
      { name: '业火焚烧', power: 2.0, desc: '地狱业火焚烧一切', damageType: 'magical' },
      { name: '绝对统治', power: 1.8, desc: '压制性的物理攻击', damageType: 'physical' },
    ],
    statMult: { HP: 2.0, ATK: 1.6, MATK: 1.8, DEF: 1.3, MDEF: 1.3 },
    rewardMult: { exp: 3.0, gold: 2.5 },
    drops: [
      { item: '罪业碎片', rate: 1.0 },
      { item: '终焉之核', rate: 0.50 },
      { item: '地狱王冠', rate: 0.30, quality: 'gold' },
      { item: '妖将核心', rate: 0.60 },
    ],
    lore: '地狱的最高统治者。掌控地狱的一切力量，恐惧的化身。传说只有超越死神与虚的存在才能抗衡。',
  },
];

export const NAMED_EQUIPS: Record<string, NamedEquipDrop> = {
  // 区域①Boss掉落
  '虚夜护腕': {
    name: '虚夜护腕', slot: 'bracer', quality: 'green',
    stats: { atk: 6, spd: 3 },
    desc: '亚丘卡斯掉落的护腕，蕴含虚夜的灵力',
  },
  // 区域①材料
};

export const NAMED_MATERIALS: Record<string, { desc: string }> = {
  '虚夜碎片': { desc: '大虚身上的碎片，散发微弱灵压' },
  '麻布片': { desc: '破旧的麻布，制造材料' },
  '灵木枝': { desc: '蕴含灵力的木材' },
};

export const BESTIARY_TIERS: BestiaryTier[] = [
  {
    id: 1, name: '初级图鉴', requiredKills: 1, color: '#88cc88',
    reward: { statPoints: 5, gold: 1000, desc: '属性点×5 + 1000金币' },
  },
  {
    id: 2, name: '中级图鉴', requiredKills: 10, color: '#6688cc',
    reward: { statPoints: 10, gold: 5000, exp: 5000, desc: '属性点×10 + 5000金币 + 5000经验' },
  },
  {
    id: 3, name: '高级图鉴', requiredKills: 50, color: '#cc88cc',
    reward: { statPoints: 20, gold: 20000, exp: 20000, desc: '属性点×20 + 20000金币 + 20000经验' },
  },
  {
    id: 4, name: '超级图鉴', requiredKills: 100, color: '#ffcc44',
    reward: { statPoints: 50, gold: 100000, exp: 100000, desc: '属性点×50 + 100000金币 + 100000经验' },
  },
];
