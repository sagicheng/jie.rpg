/**
 * 任务系统 — Bleach原著世界观
 */

export type QuestType = 'main' | 'side' | 'daily' | 'weekly';
export type QuestObjective = 'kill' | 'collect' | 'talk' | 'reach' | 'craft' | 'custom';

export interface QuestObjectiveDef {
  type: QuestObjective;
  target: string;
  count: number;
  desc: string;
}

export interface QuestDef {
  id: string;
  name: string;
  type: QuestType;
  chapter: number;
  desc: string;
  objectives: QuestObjectiveDef[];
  rewards: {
    gold?: number;
    exp?: number;
    items?: Array<{ id: string; name: string; count: number }>;
    unlock?: string;
  };
  acceptFrom?: string;
  completeAt?: string;
  prerequisite?: string;
  zoneRequired?: number;
}

export const MAIN_QUESTS: Record<string, QuestDef> = {
  // ===== 序章：空座町·觉醒 =====
  'prologue_awaken': {
    id: 'prologue_awaken',
    name: '觉醒之刻',
    type: 'main',
    chapter: 0,
    desc: '你在空座町苏醒，能看见虚的存在。浦原喜助愿意帮你觉醒斩魄刀。',
    objectives: [
      { type: 'talk', target: '浦原喜助', count: 1, desc: '与浦原喜助对话' },
    ],
    rewards: { gold: 100, exp: 50 },
    acceptFrom: '浦原喜助',
    completeAt: '浦原喜助',
    zoneRequired: 1,
  },

  // ===== 第一章：空座町 ── 浅打试炼 =====
  'ch1_hollow_threat': {
    id: 'ch1_hollow_threat',
    name: '虚的威胁',
    type: 'main',
    chapter: 1,
    desc: '有泽龙贵请你帮忙清除空座町游荡的虚。证明你有成为死神的资格。',
    objectives: [
      { type: 'kill', target: 'any', count: 3, desc: '击败任意虚' },
    ],
    rewards: { gold: 500, exp: 200 },
    acceptFrom: '有泽龙贵',
    completeAt: '有泽龙贵',
    prerequisite: 'prologue_awaken',
    zoneRequired: 1,
  },
  'ch1_shopkeeper_test': {
    id: 'ch1_shopkeeper_test',
    name: '浦原的特训',
    type: 'main',
    chapter: 1,
    desc: '浦原喜助要测试你的基本能力。去收集材料并击败几只虚。',
    objectives: [
      { type: 'collect', target: 'any', count: 3, desc: '采集药草' },
      { type: 'kill', target: '低级虚', count: 2, desc: '击败低级虚' },
    ],
    rewards: { gold: 300, exp: 150, items: [{ id: 'potion_small', name: '回复药', count: 3 }] },
    acceptFrom: '浦原喜助',
    completeAt: '浦原喜助',
    prerequisite: 'ch1_hollow_threat',
    zoneRequired: 1,
  },
  'ch1_menos_grande': {
    id: 'ch1_menos_grande',
    name: '大虚来袭',
    type: 'main',
    chapter: 1,
    desc: '空座町出现了大虚——基利安。击败它，证明你已经超越了普通虚。',
    objectives: [
      { type: 'kill', target: '大虚·基利安', count: 1, desc: '击败大虚·基利安' },
    ],
    rewards: { gold: 800, exp: 400, unlock: 'ch1_complete' },
    acceptFrom: '有泽龙贵',
    completeAt: '有泽龙贵',
    prerequisite: 'ch1_shopkeeper_test',
    zoneRequired: 1,
  },

  // 始解解锁
  'shikai_trial': {
    id: 'shikai_trial',
    name: '始解试炼',
    type: 'main',
    chapter: 1,
    desc: '浦原喜助感受到你的斩魄刀中沉睡的力量。去流魂街完成试炼，唤醒它的真名。',
    objectives: [
      { type: 'reach', target: '流魂街', count: 1, desc: '进入流魂街' },
      { type: 'kill', target: 'any', count: 5, desc: '在试炼中击败敌人' },
    ],
    rewards: { gold: 1000, exp: 500, unlock: 'shikai' },
    acceptFrom: '浦原喜助',
    completeAt: '斑目一角',
    prerequisite: 'ch1_menos_grande',
    zoneRequired: 4,
  },

  // ===== 第二章：流魂街 ── 始解修行 =====
  'ch2_enter_river': {
    id: 'ch2_enter_river',
    name: '流魂街的试炼',
    type: 'main',
    chapter: 2,
    desc: '进入流魂街，在斑目一角的注视下击败强敌，证明你有资格获得始解。',
    objectives: [
      { type: 'kill', target: '流魂街强盗', count: 4, desc: '击败流魂街强盗' },
      { type: 'kill', target: '暴走虚', count: 3, desc: '击败暴走虚' },
    ],
    rewards: { gold: 500, exp: 300, items: [{ id: 'potion_medium', name: '强效回复药', count: 2 }] },
    acceptFrom: '斑目一角',
    completeAt: '斑目一角',
    prerequisite: 'shikai_trial',
    zoneRequired: 4,
  },
  'ch2_squad_eleven': {
    id: 'ch2_squad_eleven',
    name: '十一番队的挑战',
    type: 'main',
    chapter: 2,
    desc: '斑目一角认可了你，但他还要看看你的极限。击败叛逆队员和大虚。',
    objectives: [
      { type: 'kill', target: '叛逆队员', count: 4, desc: '击败叛逆队员' },
      { type: 'kill', target: '大虚·基利安', count: 2, desc: '击败大虚' },
    ],
    rewards: { gold: 800, exp: 500, unlock: 'ch2_complete' },
    acceptFrom: '斑目一角',
    completeAt: '志波空鹤',
    prerequisite: 'ch2_enter_river',
    zoneRequired: 4,
  },

  // ===== 第三章：静灵庭 ── 卍解修行 =====
  'ch3_enter_court': {
    id: 'ch3_enter_court',
    name: '护廷之门',
    type: 'main',
    chapter: 3,
    desc: '进入静灵庭——死神的大本营。日番谷冬狮郎在等你完成卍解试炼。',
    objectives: [
      { type: 'reach', target: '静灵庭', count: 1, desc: '进入静灵庭' },
    ],
    rewards: { gold: 400, exp: 300 },
    acceptFrom: '志波空鹤',
    completeAt: '日番谷冬狮郎',
    prerequisite: 'ch2_squad_eleven',
    zoneRequired: 7,
  },
  'ch3_court_training': {
    id: 'ch3_court_training',
    name: '静灵庭特训',
    type: 'main',
    chapter: 3,
    desc: '日番谷冬狮郎要求你在静灵庭完成高强度训练。击败叛死神和虚群。',
    objectives: [
      { type: 'kill', target: '叛逆死神', count: 5, desc: '击败叛逆死神' },
      { type: 'kill', target: '虚群', count: 4, desc: '击败虚群' },
    ],
    rewards: { gold: 700, exp: 500 },
    acceptFrom: '日番谷冬狮郎',
    completeAt: '日番谷冬狮郎',
    prerequisite: 'ch3_enter_court',
    zoneRequired: 7,
  },
  'ch3_adjuchas': {
    id: 'ch3_adjuchas',
    name: '亚丘卡斯的威胁',
    type: 'main',
    chapter: 3,
    desc: '静灵庭出现了大虚中的精英——亚丘卡斯。击败它，证明你有资格获得卍解。',
    objectives: [
      { type: 'kill', target: '大虚·亚丘卡斯', count: 3, desc: '击败亚丘卡斯' },
    ],
    rewards: { gold: 1500, exp: 800, unlock: 'ch3_complete' },
    acceptFrom: '日番谷冬狮郎',
    completeAt: '日番谷冬狮郎',
    prerequisite: 'ch3_court_training',
    zoneRequired: 7,
  },

  // 卍解解锁
  'bankai_trial': {
    id: 'bankai_trial',
    name: '卍解试炼',
    type: 'main',
    chapter: 3,
    desc: '山本总队长说，真正的死神能在极限中觉醒卍解。在静灵庭的终极试炼中证明自己。',
    objectives: [
      { type: 'kill', target: 'any', count: 10, desc: '在极限战斗中展示力量' },
    ],
    rewards: { gold: 2000, exp: 1000, unlock: 'bankai' },
    acceptFrom: '山本元柳斋',
    completeAt: '山本元柳斋',
    prerequisite: 'ch3_adjuchas',
    zoneRequired: 7,
  },

  // ===== 第四章：虚圈 ── 虚化觉醒 =====
  'ch4_enter_hueco': {
    id: 'ch4_enter_hueco',
    name: '虚圈之门',
    type: 'main',
    chapter: 4,
    desc: '涅茧利告诉你，虚圈中有一种禁忌的力量——虚化。去吧，接受虚的试炼。',
    objectives: [
      { type: 'reach', target: '虚圈', count: 1, desc: '进入虚圈' },
    ],
    rewards: { gold: 500, exp: 400 },
    acceptFrom: '涅茧利',
    completeAt: '乌尔奇奥拉(残影)',
    prerequisite: 'bankai_trial',
    zoneRequired: 10,
  },
  'ch4_arrancar_hunt': {
    id: 'ch4_arrancar_hunt',
    name: '破面狩猎',
    type: 'main',
    chapter: 4,
    desc: '乌尔奇奥拉要你在虚圈猎杀破面和亚丘卡斯，证明你有承受虚化的资格。',
    objectives: [
      { type: 'kill', target: '破面·下级', count: 5, desc: '击败下级破面' },
      { type: 'kill', target: '亚丘卡斯', count: 3, desc: '击败亚丘卡斯' },
    ],
    rewards: { gold: 1000, exp: 700 },
    acceptFrom: '乌尔奇奥拉(残影)',
    completeAt: '乌尔奇奥拉(残影)',
    prerequisite: 'ch4_enter_hueco',
    zoneRequired: 10,
  },
  'ch4_vasto_lorde': {
    id: 'ch4_vasto_lorde',
    name: '最上级破面',
    type: 'main',
    chapter: 4,
    desc: '虚圈最强的破面——上级破面。击败它，虚化之力将为你所用。',
    objectives: [
      { type: 'kill', target: '破面·上级', count: 2, desc: '击败上级破面' },
      { type: 'kill', target: '亚丘卡斯', count: 3, desc: '击败亚丘卡斯' },
    ],
    rewards: { gold: 2500, exp: 1200, unlock: 'ch4_complete' },
    acceptFrom: '乌尔奇奥拉(残影)',
    completeAt: '葛力姆乔(残影)',
    prerequisite: 'ch4_arrancar_hunt',
    zoneRequired: 10,
  },

  // 虚化解锁
  'hollow_trial': {
    id: 'hollow_trial',
    name: '虚化试炼',
    type: 'main',
    chapter: 4,
    desc: '击败了最上级破面后，葛力姆乔指引你触碰虚化的禁忌之力——戴上面具，化身猛兽。',
    objectives: [
      { type: 'kill', target: 'any', count: 8, desc: '在虚化觉醒下击败敌人' },
    ],
    rewards: { gold: 2000, exp: 1000, unlock: 'hollow' },
    acceptFrom: '葛力姆乔(残影)',
    completeAt: '葛力姆乔(残影)',
    prerequisite: 'ch4_vasto_lorde',
    zoneRequired: 10,
  },

  // ===== 第五章：空座町·归 ── 完现术 =====
  'ch5_return_home': {
    id: 'ch5_return_home',
    name: '回归现世',
    type: 'main',
    chapter: 5,
    desc: '带着虚化之力回到空座町。毒峰莉露卡说，完现术——物质附灵之力——在等你。',
    objectives: [
      { type: 'reach', target: '空座町·归', count: 1, desc: '回到空座町' },
    ],
    rewards: { gold: 600, exp: 500 },
    acceptFrom: '葛力姆乔(残影)',
    completeAt: '毒峰莉露卡',
    prerequisite: 'ch4_vasto_lorde',
    zoneRequired: 13,
  },
  'ch5_fullbringer_test': {
    id: 'ch5_fullbringer_test',
    name: '完现术的试炼',
    type: 'main',
    chapter: 5,
    desc: '毒峰莉露卡要你在空座町完成完现术的修行——击败完现者和虚。',
    objectives: [
      { type: 'kill', target: '完现者(敌)', count: 5, desc: '击败敌对完现者' },
      { type: 'kill', target: '完现虚', count: 4, desc: '击败完现虚' },
    ],
    rewards: { gold: 1000, exp: 700 },
    acceptFrom: '毒峰莉露卡',
    completeAt: '毒峰莉露卡',
    prerequisite: 'ch5_return_home',
    zoneRequired: 13,
  },
  'ch5_fullbring_master': {
    id: 'ch5_fullbring_master',
    name: '完现术极意',
    type: 'main',
    chapter: 5,
    desc: '完现术的最终试炼——击败来袭的亚丘卡斯和完现者，证明你已经掌握了物质附灵之力。',
    objectives: [
      { type: 'kill', target: '大虚·亚丘卡斯', count: 3, desc: '击败亚丘卡斯' },
      { type: 'kill', target: '完现者(敌)', count: 3, desc: '击败完现者' },
    ],
    rewards: { gold: 2800, exp: 1400, unlock: 'ch5_complete' },
    acceptFrom: '毒峰莉露卡',
    completeAt: '银城空吾',
    prerequisite: 'ch5_fullbringer_test',
    zoneRequired: 13,
  },

  // 完现术解锁
  'fullbring_trial': {
    id: 'fullbring_trial',
    name: '完现术觉醒',
    type: 'main',
    chapter: 5,
    desc: '银城空吾说，完现术的最终形态是"物质附灵"——将周围物质的灵魂化为己用。在战斗中证明自己。',
    objectives: [
      { type: 'kill', target: 'any', count: 8, desc: '用物质附灵之力击败敌人' },
    ],
    rewards: { gold: 2000, exp: 1000, unlock: 'fullbring' },
    acceptFrom: '银城空吾',
    completeAt: '银城空吾',
    prerequisite: 'ch5_fullbring_master',
    zoneRequired: 13,
  },

  // ===== 第六章：无形帝国 ── 圣文字 =====
  'ch6_enter_empire': {
    id: 'ch6_enter_empire',
    name: '无形帝国',
    type: 'main',
    chapter: 6,
    desc: '石田雨龙指引你前往北方的无形帝国——灭却师的领域，圣文字的力量在等待。',
    objectives: [
      { type: 'reach', target: '无形帝国', count: 1, desc: '进入无形帝国' },
    ],
    rewards: { gold: 700, exp: 500 },
    acceptFrom: '石田雨龙',
    completeAt: '巴兹比',
    prerequisite: 'ch5_fullbring_master',
    zoneRequired: 16,
  },
  'ch6_sternritter': {
    id: 'ch6_sternritter',
    name: '星十字骑士',
    type: 'main',
    chapter: 6,
    desc: '巴兹比要求你击败无形帝国的精锐——星十字骑士和圣兵，证明你有资格获得圣文字。',
    objectives: [
      { type: 'kill', target: '星十字骑士', count: 5, desc: '击败星十字骑士' },
      { type: 'kill', target: '圣兵', count: 5, desc: '击败圣兵' },
    ],
    rewards: { gold: 1200, exp: 800, items: [{ id: 'potion_large', name: '高级回复药', count: 3 }] },
    acceptFrom: '巴兹比',
    completeAt: '巴兹比',
    prerequisite: 'ch6_enter_empire',
    zoneRequired: 16,
  },
  'ch6_quincy_king': {
    id: 'ch6_quincy_king',
    name: '灭却师之王',
    type: 'main',
    chapter: 6,
    desc: '无形帝国的最终试炼——击败星十字骑士长和虚化兵。圣文字将为你刻印。',
    objectives: [
      { type: 'kill', target: '星十字骑士·长', count: 1, desc: '击败星十字骑士长' },
      { type: 'kill', target: '星十字骑士', count: 3, desc: '击败星十字骑士' },
      { type: 'kill', target: '虚化兵', count: 3, desc: '击败虚化兵' },
    ],
    rewards: { gold: 3500, exp: 1800, unlock: 'ch6_complete' },
    acceptFrom: '巴兹比',
    completeAt: '友哈巴赫(残影)',
    prerequisite: 'ch6_sternritter',
    zoneRequired: 16,
  },

  // 圣文字解锁
  'schrift_trial': {
    id: 'schrift_trial',
    name: '圣文字刻印',
    type: 'main',
    chapter: 6,
    desc: '友哈巴赫承认了你的力量。接受圣文字——灭却师血脉中的终极之力。',
    objectives: [
      { type: 'kill', target: 'any', count: 10, desc: '用圣文字之力击败敌人' },
    ],
    rewards: { gold: 3000, exp: 1500, unlock: 'schrift' },
    acceptFrom: '友哈巴赫(残影)',
    completeAt: '友哈巴赫(残影)',
    prerequisite: 'ch6_quincy_king',
    zoneRequired: 16,
  },

  // ===== 第七章：地狱 ── 最终试炼 =====
  'ch7_enter_hell': {
    id: 'ch7_enter_hell',
    name: '地狱之门',
    type: 'main',
    chapter: 7,
    desc: '四力集齐——始解、卍解、虚化、完现术、圣文字。地狱之门为你打开。',
    objectives: [
      { type: 'reach', target: '地狱', count: 1, desc: '进入地狱' },
    ],
    rewards: { gold: 800, exp: 600 },
    acceptFrom: '友哈巴赫(残影)',
    completeAt: '井上织姬(残影)',
    prerequisite: 'ch6_quincy_king',
    zoneRequired: 19,
  },
  'ch7_hell_guardians': {
    id: 'ch7_hell_guardians',
    name: '地狱的守护者',
    type: 'main',
    chapter: 7,
    desc: '井上织姬请求你清理地狱中的咎人和地狱犬——它们是终焉之兽的爪牙。',
    objectives: [
      { type: 'kill', target: '咎人', count: 5, desc: '击败咎人' },
      { type: 'kill', target: '地狱犬', count: 3, desc: '击败地狱犬' },
      { type: 'kill', target: '混沌兽', count: 2, desc: '击败混沌兽' },
    ],
    rewards: { gold: 1500, exp: 1000, items: [{ id: 'potion_ultimate', name: '终极回复药', count: 3 }] },
    acceptFrom: '井上织姬(残影)',
    completeAt: '井上织姬(残影)',
    prerequisite: 'ch7_enter_hell',
    zoneRequired: 19,
  },
  'ch7_final_beast': {
    id: 'ch7_final_beast',
    name: '终焉之兽',
    type: 'main',
    chapter: 7,
    desc: '终焉之兽——地狱最深处的存在。击败它，完成你跨越尸魂界、虚圈、无形帝国和地狱的试炼。',
    objectives: [
      { type: 'kill', target: '终焉之兽', count: 2, desc: '击败终焉之兽' },
      { type: 'kill', target: '地狱守卫', count: 3, desc: '击败地狱守卫' },
    ],
    rewards: { gold: 5000, exp: 3000, unlock: 'all_complete' },
    acceptFrom: '井上织姬(残影)',
    completeAt: '朽木露琪亚(残影)',
    prerequisite: 'ch7_hell_guardians',
    zoneRequired: 19,
  },

  // 狱解解锁
  'hell_trial': {
    id: 'hell_trial',
    name: '狱解觉醒',
    type: 'main',
    chapter: 7,
    desc: '击败终焉之兽后，地狱的业火回应了你。接受这份最后的试炼——狱解。',
    objectives: [
      { type: 'kill', target: 'any', count: 12, desc: '在地狱业火中击败敌人' },
    ],
    rewards: { gold: 5000, exp: 3000, unlock: 'hell' },
    acceptFrom: '朽木露琪亚(残影)',
    completeAt: '朽木露琪亚(残影)',
    prerequisite: 'ch7_final_beast',
    zoneRequired: 19,
  },
};

export const MAIN_QUEST_ORDER: string[] = [
  'prologue_awaken',
  'ch1_hollow_threat', 'ch1_shopkeeper_test', 'ch1_menos_grande', 'shikai_trial',
  'ch2_enter_river', 'ch2_squad_eleven',
  'ch3_enter_court', 'ch3_court_training', 'ch3_adjuchas', 'bankai_trial',
  'ch4_enter_hueco', 'ch4_arrancar_hunt', 'ch4_vasto_lorde', 'hollow_trial',
  'ch5_return_home', 'ch5_fullbringer_test', 'ch5_fullbring_master', 'fullbring_trial',
  'ch6_enter_empire', 'ch6_sternritter', 'ch6_quincy_king', 'schrift_trial',
  'ch7_enter_hell', 'ch7_hell_guardians', 'ch7_final_beast', 'hell_trial',
];

// ═══ 支线任务 ═══
export const SIDE_QUESTS: Record<string, QuestDef> = {
  // ① 空座町
  'side_1_shop_herb': {
    id: 'side_1_shop_herb', name: '紬屋雨的请求', type: 'side', chapter: 1,
    desc: '紬屋雨需要采集药草补充浦原商店的库存。',
    objectives: [{ type: 'collect', target: 'any', count: 5, desc: '采集药草' }],
    rewards: { gold: 300, exp: 100, items: [{ id: 'potion_small', name: '回复药', count: 3 }] },
    acceptFrom: '紬屋雨', completeAt: '紬屋雨', zoneRequired: 1,
  },
  'side_1_hollow_hunt': {
    id: 'side_1_hollow_hunt', name: '虚退治', type: 'side', chapter: 1,
    desc: '花刈甚太请你帮忙赶走几只低级虚。',
    objectives: [{ type: 'kill', target: 'any', count: 3, desc: '击败虚' }],
    rewards: { gold: 400, exp: 150, items: [{ id: 'potion_small', name: '回复药', count: 2 }] },
    acceptFrom: '花刈甚太', completeAt: '花刈甚太', zoneRequired: 1,
  },
  'side_1_charm': {
    id: 'side_1_charm', name: '护身符', type: 'side', chapter: 1,
    desc: '启吾的妹妹的护身符被虚抢走了。帮他对付几只虚。',
    objectives: [{ type: 'kill', target: '低级虚', count: 4, desc: '击败低级虚' }],
    rewards: { gold: 500, exp: 200 },
    acceptFrom: '启吾', completeAt: '启吾', zoneRequired: 1,
  },

  // ② 流魂街
  'side_4_beauty': { id: 'side_4_beauty', name: '弓亲的审美', type: 'side', chapter: 4, desc: '绫濑川弓亲需要灵木制作武器配饰。', objectives: [{ type: 'collect', target: 'any', count: 5, desc: '采集灵木' }], rewards: { gold: 400, exp: 180 }, acceptFrom: '绫濑川弓亲', completeAt: '绫濑川弓亲', zoneRequired: 4 },
  'side_4_bandits': { id: 'side_4_bandits', name: '流魂街治安', type: 'side', chapter: 4, desc: '桧佐木修兵请你清理流魂街的强盗。', objectives: [{ type: 'kill', target: '流魂街强盗', count: 5, desc: '击败强盗' }], rewards: { gold: 500, exp: 450 }, acceptFrom: '桧佐木修兵', completeAt: '桧佐木修兵', zoneRequired: 4 },
  'side_4_healing': { id: 'side_4_healing', name: '吉良的伤势', type: 'side', chapter: 4, desc: '吉良井鹤需要药草治伤。', objectives: [{ type: 'collect', target: 'any', count: 5, desc: '采集药草' }], rewards: { gold: 350, exp: 150, items: [{ id: 'antidote', name: '解毒草', count: 4 }] }, acceptFrom: '吉良井鹤', completeAt: '吉良井鹤', zoneRequired: 4 },

  // ③ 静灵庭
  'side_7_rangiku': { id: 'side_7_rangiku', name: '松本的休息', type: 'side', chapter: 7, desc: '松本乱菊想要药草和灵木。', objectives: [{ type: 'collect', target: 'any', count: 7, desc: '采集补给' }], rewards: { gold: 500, exp: 250, items: [{ id: 'potion_medium', name: '强效回复药', count: 2 }] }, acceptFrom: '松本乱菊', completeAt: '松本乱菊', zoneRequired: 7 },
  'side_7_zaraki': { id: 'side_7_zaraki', name: '剑八的热身', type: 'side', chapter: 7, desc: '更木剑八让你找强敌热身。', objectives: [{ type: 'kill', target: '叛逆死神', count: 6, desc: '击败叛逆死神' }], rewards: { gold: 700, exp: 750, items: [{ id: 'bronze_bracer', name: '护廷手甲', count: 1 }] }, acceptFrom: '更木剑八', completeAt: '更木剑八', zoneRequired: 7 },
  'side_7_unohana': { id: 'side_7_unohana', name: '卯之花的药剂', type: 'side', chapter: 7, desc: '卯之花烈需要灵脉样本。', objectives: [{ type: 'collect', target: 'any', count: 6, desc: '收集灵脉' }], rewards: { gold: 600, exp: 700 }, acceptFrom: '卯之花烈', completeAt: '卯之花烈', zoneRequired: 7 },

  // ④ 虚圈
  'side_10_yammy': { id: 'side_10_yammy', name: '牙密的练习', type: 'side', chapter: 10, desc: '牙密拿亚丘卡斯练手。', objectives: [{ type: 'kill', target: '亚丘卡斯', count: 10, desc: '击败亚丘卡斯' }], rewards: { gold: 700, exp: 350 }, acceptFrom: '牙密', completeAt: '牙密', zoneRequired: 10 },
  'side_10_ruby': { id: 'side_10_ruby', name: '露比的触手', type: 'side', chapter: 10, desc: '露比的触手被虚群缠住了。', objectives: [{ type: 'kill', target: '基利安', count: 5, desc: '清理基利安' }], rewards: { gold: 600, exp: 300, items: [{ id: 'potion_medium', name: '强效回复药', count: 3 }] }, acceptFrom: '露比', completeAt: '露比', zoneRequired: 10 },
  'side_10shawlong': { id: 'side_10shawlong', name: '萧隆的教导', type: 'side', chapter: 10, desc: '萧隆库方需要灵脉研究。', objectives: [{ type: 'collect', target: 'any', count: 6, desc: '收集灵脉' }], rewards: { gold: 500, exp: 280, items: [{ id: 'jade_ring', name: '虚闪戒指', count: 1 }] }, acceptFrom: '萧隆库方', completeAt: '萧隆库方', zoneRequired: 10 },

  // ⑤ 空座町·归
  'side_13_jackie': { id: 'side_13_jackie', name: '贾姬的靴子', type: 'side', chapter: 13, desc: '贾姬需要矿脉做新靴子。', objectives: [{ type: 'collect', target: 'any', count: 6, desc: '采集矿脉' }], rewards: { gold: 600, exp: 300 }, acceptFrom: '贾姬', completeAt: '贾姬', zoneRequired: 13 },
  'side_13_yukio': { id: 'side_13_yukio', name: '雪绪的数据', type: 'side', chapter: 13, desc: '雪绪需要战斗数据。', objectives: [{ type: 'kill', target: '完现虚', count: 13, desc: '击败完现虚' }], rewards: { gold: 700, exp: 3130, items: [{ id: 'potion_large', name: '高级回复药', count: 2 }] }, acceptFrom: '雪绪', completeAt: '雪绪', zoneRequired: 13 },
  'side_13_chad': { id: 'side_13_chad', name: '茶渡的调整', type: 'side', chapter: 13, desc: '茶渡泰虎需要灵木稳定右臂。', objectives: [{ type: 'collect', target: 'any', count: 13, desc: '采集灵木' }], rewards: { gold: 1300, exp: 300, items: [{ id: 'royal_ring', name: '显灵戒指', count: 1 }] }, acceptFrom: '茶渡泰虎', completeAt: '茶渡泰虎', zoneRequired: 13 },

  // ⑥ 无形帝国
  'side_16_as': { id: 'side_16_as', name: '艾斯的恐惧', type: 'side', chapter: 16, desc: '艾斯·诺特让你采集灵脉对抗恐惧。', objectives: [{ type: 'collect', target: 'any', count: 7, desc: '采集灵脉' }], rewards: { gold: 800, exp: 400 }, acceptFrom: '艾斯·诺特', completeAt: '艾斯·诺特', zoneRequired: 16 },
  'side_16_bambi': { id: 'side_16_bambi', name: '邦比爱塔的爆炸', type: 'side', chapter: 16, desc: '邦比爱塔让你炸圣兵。', objectives: [{ type: 'kill', target: '圣兵', count: 16, desc: '击败圣兵' }], rewards: { gold: 900, exp: 450 }, acceptFrom: '邦比爱塔', completeAt: '邦比爱塔', zoneRequired: 16 },
  'side_16_liltotto': { id: 'side_16_liltotto', name: '莉托托的食物', type: 'side', chapter: 16, desc: '莉托托饿了，需要药草和灵木。', objectives: [{ type: 'collect', target: 'any', count: 8, desc: '收集食物' }], rewards: { gold: 1000, exp: 500, items: [{ id: 'ruby_ring', name: '星十字戒指', count: 1 }] }, acceptFrom: '莉托托', completeAt: '莉托托', zoneRequired: 16 },

  // ⑦ 地狱
  'side_19_jailer': { id: 'side_19_jailer', name: '越狱的咎人', type: 'side', chapter: 19, desc: '地狱狱卒让你抓回越狱的咎人。', objectives: [{ type: 'kill', target: '咎人', count: 19, desc: '击败咎人' }], rewards: { gold: 1200, exp: 600, items: [{ id: 'dark_ring', name: '狱戒指', count: 1 }] }, acceptFrom: '地狱狱卒', completeAt: '地狱狱卒', zoneRequired: 19 },
  'side_19_soul': { id: 'side_19_soul', name: '墓碑', type: 'side', chapter: 19, desc: '被囚的灵魂想刻一块墓碑。', objectives: [{ type: 'collect', target: 'any', count: 6, desc: '收集矿脉' }], rewards: { gold: 1000, exp: 500 }, acceptFrom: '被囚的灵魂', completeAt: '被囚的灵魂', zoneRequired: 19 },
  'side_19_gatekeeper': { id: 'side_19_gatekeeper', name: '守门人的请求', type: 'side', chapter: 19, desc: '守门人让你清理混沌兽。', objectives: [{ type: 'kill', target: '混沌兽', count: 4, desc: '击败混沌兽' }], rewards: { gold: 1500, exp: 1950, items: [{ id: 'abyss_necklace', name: '狱魂项链', count: 1 }] }, acceptFrom: '守门人', completeAt: '守门人', zoneRequired: 19 },
};

export const SIDE_QUEST_IDS = Object.keys(SIDE_QUESTS);

// ═══ 日常 / 周常 任务 ═══
// 设计：每天从 DAILY_QUESTS 池确定性抽取 3 个，每周从 WEEKLY_QUESTS 池抽 3 个（date 种子，
// 联机下所有玩家同天同池，保证公平）。日完成上限 DAILY_CAP、周上限 WEEKLY_CAP。
export const DAILY_CAP = 5;
export const WEEKLY_CAP = 3;

export const DAILY_QUESTS: Record<string, QuestDef> = {
  daily_hunt_low:     { id: 'daily_hunt_low',     name: '清剿虚群',   type: 'daily', chapter: 0, desc: '空座町周边的虚出没频繁，清除它们。', objectives: [{ type: 'kill', target: '低级虚', count: 5, desc: '击败低级虚' }], rewards: { gold: 200, exp: 80 }, zoneRequired: 1 },
  daily_patrol_rukon: { id: 'daily_patrol_rukon', name: '流魂街巡逻', type: 'daily', chapter: 0, desc: '流魂街的强盗又在作乱，去巡逻清场。', objectives: [{ type: 'kill', target: '流魂街强盗', count: 5, desc: '击败流魂街强盗' }], rewards: { gold: 300, exp: 120 }, zoneRequired: 4 },
  daily_sweep_hueco:  { id: 'daily_sweep_hueco',  name: '虚圈扫荡',   type: 'daily', chapter: 0, desc: '虚圈的低级破面四处游荡，镇压它们。', objectives: [{ type: 'kill', target: '破面·下级', count: 5, desc: '击败破面·下级' }], rewards: { gold: 400, exp: 150 }, zoneRequired: 10 },
  daily_herb:         { id: 'daily_herb',         name: '药草采集',   type: 'daily', chapter: 0, desc: '浦原商店需要补充药草库存。', objectives: [{ type: 'collect', target: '药草', count: 5, desc: '采集药草' }], rewards: { gold: 150, exp: 60 }, zoneRequired: 1 },
  daily_wood:         { id: 'daily_wood',         name: '灵木伐採',   type: 'daily', chapter: 0, desc: '流魂街的匠人缺少灵木。', objectives: [{ type: 'collect', target: '灵木', count: 5, desc: '采集灵木' }], rewards: { gold: 180, exp: 70 }, zoneRequired: 4 },
  daily_ore:          { id: 'daily_ore',          name: '矿脉发掘',   type: 'daily', chapter: 0, desc: '空座町·归的矿工需要矿石。', objectives: [{ type: 'collect', target: '矿脉', count: 5, desc: '采集矿脉' }], rewards: { gold: 200, exp: 80 }, zoneRequired: 13 },
  daily_craft_weapon: { id: 'daily_craft_weapon', name: '铁匠委托·武器', type: 'daily', chapter: 0, desc: '为铁匠锻造一把铁剑。', objectives: [{ type: 'craft', target: '铁剑', count: 1, desc: '制造铁剑' }], rewards: { gold: 200, exp: 100 }, zoneRequired: 1 },
  daily_craft_armor:  { id: 'daily_craft_armor',  name: '铁匠委托·护甲', type: 'daily', chapter: 0, desc: '为铁匠锻造一件铁甲。', objectives: [{ type: 'craft', target: '铁甲', count: 1, desc: '制造铁甲' }], rewards: { gold: 260, exp: 120 }, zoneRequired: 1 },
  daily_craft_bracer: { id: 'daily_craft_bracer', name: '铁匠委托·手甲', type: 'daily', chapter: 0, desc: '为铁匠锻造一副铁手甲。', objectives: [{ type: 'craft', target: '铁手甲', count: 1, desc: '制造铁手甲' }], rewards: { gold: 180, exp: 90 }, zoneRequired: 1 },
};

export const WEEKLY_QUESTS: Record<string, QuestDef> = {
  weekly_hunt_low:    { id: 'weekly_hunt_low',    name: '周常·虚群清剿', type: 'weekly', chapter: 0, desc: '一周的和平需要持续清剿虚群。', objectives: [{ type: 'kill', target: '低级虚', count: 15, desc: '击败低级虚' }], rewards: { gold: 1000, exp: 400 }, zoneRequired: 1 },
  weekly_patrol_rukon:{ id: 'weekly_patrol_rukon',name: '周常·流魂街维安', type: 'weekly', chapter: 0, desc: '维持流魂街一周的治安。', objectives: [{ type: 'kill', target: '流魂街强盗', count: 15, desc: '击败流魂街强盗' }], rewards: { gold: 1500, exp: 600 }, zoneRequired: 4 },
  weekly_sweep_hueco: { id: 'weekly_sweep_hueco', name: '周常·虚圈镇压', type: 'weekly', chapter: 0, desc: '压制虚圈一周的破面活动。', objectives: [{ type: 'kill', target: '破面·下级', count: 15, desc: '击败破面·下级' }], rewards: { gold: 2000, exp: 750 }, zoneRequired: 10 },
  weekly_wood:        { id: 'weekly_wood',        name: '周常·灵木收集', type: 'weekly', chapter: 0, desc: '为匠人们储备一周的灵木。', objectives: [{ type: 'collect', target: '灵木', count: 15, desc: '采集灵木' }], rewards: { gold: 900, exp: 350 }, zoneRequired: 4 },
  weekly_ore:         { id: 'weekly_ore',         name: '周常·矿脉开采', type: 'weekly', chapter: 0, desc: '为铁匠储备一周的矿石。', objectives: [{ type: 'collect', target: '矿脉', count: 15, desc: '采集矿脉' }], rewards: { gold: 1000, exp: 400 }, zoneRequired: 13 },
  weekly_craft:       { id: 'weekly_craft',       name: '周常·锻造精进', type: 'weekly', chapter: 0, desc: '一周内持续精进锻造技艺。', objectives: [{ type: 'craft', target: '铁剑', count: 3, desc: '制造铁剑' }], rewards: { gold: 1000, exp: 500 }, zoneRequired: 1 },
};

/** 全任务索引（主线 + 支线 + 日常 + 周常）。 */
export const ALL_QUESTS: Record<string, QuestDef> = {
  ...MAIN_QUESTS, ...SIDE_QUESTS, ...DAILY_QUESTS, ...WEEKLY_QUESTS,
};

export function getQuestDef(id: string): QuestDef | null {
  return ALL_QUESTS[id] || null;
}

// ——— 确定性日期种子（保证同一天/周所有玩家池一致，联机公平）———
function pad2(n: number): string { return `${n}`.padStart(2, '0'); }

/** 本地日期串 YYYY-MM-DD（用于每日刷新判定）。 */
export function todayStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 本周周一的日期串（同一周恒定，用于每周刷新判定）。 */
export function weekStr(d: Date = new Date()): string {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // 周一=0
  x.setDate(x.getDate() - dow);
  return todayStr(x);
}

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** 基于种子做确定性洗牌（mulberry32），取前 n 个。 */
function seededPick(keys: string[], seed: string, n: number): string[] {
  let a = hashStr(seed);
  const rand = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const arr = keys.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

/** 今天的日常任务池（3 个，确定性）。 */
export function rollDailyPool(): string[] {
  return seededPick(Object.keys(DAILY_QUESTS), todayStr(), 3);
}

/** 本周的周常任务池（3 个，确定性）。 */
export function rollWeeklyPool(): string[] {
  return seededPick(Object.keys(WEEKLY_QUESTS), weekStr(), 3);
}
