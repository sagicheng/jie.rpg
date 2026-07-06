/** 斩魄刀技能数据 — 浅打4元素 → 始解24把 */

export interface SkillData {
  name: string;
  mp: number;
  power: number;
  desc: string;
  element: string;
  phase: '浅打' | '始解' | '卍解';
  zanpakuto?: string;
  damageType: 'physical' | 'magical';
  skillType?: 'damage' | 'heal' | 'control';  // 默认=damage
  /** 附带的异常状态效果 */
  statusEffect?: {
    subtype: 'seal' | 'slow' | 'bind' | 'freeze' | 'stun' | 'poison';
    turns: number;
    rate: number;  // 基础触发概率 0~1
  };
}

/** 浅打技能：4元素各1个 — 物理单体为主 */
export const SHALLOW_SKILLS: Record<string, SkillData> = {
  火: { name: '烈闪', mp: 15, power: 2.2, desc: '火系单体斩击，暴击率+15%', element: '火', phase: '浅打', damageType: 'physical' },
  风: { name: '风牙', mp: 12, power: 1.8, desc: '风系高速单体斩击', element: '风', phase: '浅打', damageType: 'physical' },
  水: { name: '霜斩', mp: 12, power: 1.6, desc: '水系斩击+概率减速', element: '水', phase: '浅打', damageType: 'magical', statusEffect: { subtype: 'slow', turns: 2, rate: 0.30 } },
  土: { name: '镇击', mp: 12, power: 1.6, desc: '土系重击+概率眩晕', element: '土', phase: '浅打', damageType: 'physical', statusEffect: { subtype: 'stun', turns: 1, rate: 0.25 } },
};

/** 始解技能：24把斩魄刀，每把0~2个始解技能
 *  物理(ATK)：单体2.5~4.0倍率 / 群体1.0~1.5倍率
 *  魔法(MATK)：单体1.5~2.5倍率 / 群体2.0~2.8倍率 */
export const SHIKAI_SKILLS: Record<string, SkillData[]> = {
  // ── 火系·9把 ──
  流刃若火: [
    { name: '焚城', mp: 25, power: 1.4, desc: '全体火伤+灼烧(3回合)', element: '火', phase: '始解', damageType: 'physical' },
    { name: '狱炎', mp: 30, power: 3.2, desc: '单体强力火伤', element: '火', phase: '始解', damageType: 'physical' },
  ],
  飞梅: [
    { name: '火种', mp: 18, power: 2.0, desc: '单体·延迟引爆火种印记(2回合)', element: '火', phase: '始解', damageType: 'magical' },
    { name: '飞梅', mp: 24, power: 2.5, desc: '全体种火+引爆增伤', element: '火', phase: '始解', damageType: 'magical' },
  ],
  红姬: [
    { name: '血霞之盾', mp: 20, power: 0, desc: '自身防御+50%+反伤(3回合)', element: '火', phase: '始解', damageType: 'physical' },
    { name: '红姬炮击', mp: 24, power: 2.8, desc: '单体远程火弹', element: '火', phase: '始解', damageType: 'magical' },
  ],
  剡月: [
    { name: '月牙天冲', mp: 22, power: 3.5, desc: '直线贯穿高伤', element: '火', phase: '始解', damageType: 'physical' },
    { name: '剡月断空', mp: 28, power: 2.8, desc: '全体火伤', element: '火', phase: '始解', damageType: 'physical' },
  ],
  雀蜂: [
    { name: '二击必杀', mp: 20, power: 1.5, desc: '标记目标，再次命中造成5倍伤害', element: '火', phase: '始解', damageType: 'physical' },
    { name: '雀蜂迅雷', mp: 16, power: 2.0, desc: '先制单体攻击，高暴击', element: '火', phase: '始解', damageType: 'physical' },
  ],
  疋杀地蔵: [
    { name: '毒雾', mp: 22, power: 1.3, desc: '全体毒伤+中毒(4回合)', element: '火', phase: '始解', damageType: 'magical', statusEffect: { subtype: 'poison', turns: 4, rate: 0.50 } },
    { name: '地蔵针', mp: 26, power: 2.6, desc: '单体，中毒目标伤害翻倍', element: '火', phase: '始解', damageType: 'magical' },
  ],
  天狗丸: [
    { name: '豪火碎击', mp: 20, power: 3.0, desc: '单体高伤+概率眩晕', element: '火', phase: '始解', damageType: 'physical' },
    { name: '天狗烈风', mp: 24, power: 1.4, desc: '全体火伤+敌方攻击-15%(3回合)', element: '火', phase: '始解', damageType: 'physical' },
  ],
  馘大蛇: [
    { name: '蛇咬', mp: 16, power: 2.2, desc: '单体多段撕咬+流血(3回合)', element: '火', phase: '始解', damageType: 'physical' },
    { name: '大蛇噬', mp: 24, power: 2.5, desc: '全体火伤', element: '火', phase: '始解', damageType: 'physical' },
  ],
  严灵丸: [],  // ★锻体

  // ── 风系·9把 ──
  斩月: [
    { name: '天冲', mp: 22, power: 2.8, desc: '直线贯穿+自身速度+20%(3回合)', element: '风', phase: '始解', damageType: 'physical' },
    { name: '黑牙', mp: 20, power: 3.5, desc: '消耗HP20%，单体2倍伤害', element: '风', phase: '始解', damageType: 'physical' },
  ],
  千本樱: [
    { name: '千景', mp: 28, power: 0.6, desc: '全体5段风伤+破甲', element: '风', phase: '始解', damageType: 'physical' },
    { name: '吭景', mp: 25, power: 3.0, desc: '单体大伤害，无视护盾', element: '风', phase: '始解', damageType: 'physical' },
  ],
  神枪: [
    { name: '穿心', mp: 16, power: 2.5, desc: '极速单体突刺，先制攻击', element: '风', phase: '始解', damageType: 'physical' },
    { name: '神枪连突', mp: 22, power: 1.2, desc: '单体4段高速突刺', element: '风', phase: '始解', damageType: 'physical' },
  ],
  花天狂骨: [
    { name: '崭鬼', mp: 20, power: 2.2, desc: '单体，站位越高伤害越大', element: '风', phase: '始解', damageType: 'magical' },
    { name: '影鬼', mp: 22, power: 1.8, desc: '全体，影子重叠者受额外伤害', element: '风', phase: '始解', damageType: 'magical' },
  ],
  藤孔雀: [
    { name: '孔雀开屏', mp: 18, power: 1.5, desc: '全体风伤+吸收敌方MP', element: '风', phase: '始解', damageType: 'magical' },
    { name: '藤蔓缠绕', mp: 22, power: 2.4, desc: '单体风伤+概率束缚(2回合)', element: '风', phase: '始解', damageType: 'magical', statusEffect: { subtype: 'bind', turns: 2, rate: 0.35 } },
  ],
  逆抚: [
    { name: '逆抚', mp: 20, power: 1.6, desc: '全体风伤+概率混乱(3回合)', element: '风', phase: '始解', damageType: 'magical', statusEffect: { subtype: 'stun', turns: 3, rate: 0.40 } },
    { name: '颠倒世界', mp: 26, power: 2.8, desc: '单体，混乱目标暴击伤害+50%', element: '风', phase: '始解', damageType: 'magical' },
  ],
  断地风: [
    { name: '断风', mp: 18, power: 2.8, desc: '单体风刃高伤', element: '风', phase: '始解', damageType: 'physical' },
    { name: '地裂风', mp: 22, power: 1.3, desc: '全体风伤+敌方速度-15%(3回合)', element: '风', phase: '始解', damageType: 'physical' },
  ],
  铁浆蜻蛉: [
    { name: '蜻蛉切', mp: 16, power: 2.2, desc: '先制单体，高暴击+破甲', element: '风', phase: '始解', damageType: 'physical' },
    { name: '铁浆旋', mp: 22, power: 1.4, desc: '全体风伤', element: '风', phase: '始解', damageType: 'physical' },
  ],
  风死: [],  // ★锻体

  // ── 水系·9把 ──
  冰轮丸: [
    { name: '冰龙', mp: 24, power: 2.2, desc: '全体水伤+概率冻结', element: '水', phase: '始解', damageType: 'magical', statusEffect: { subtype: 'freeze', turns: 1, rate: 0.30 } },
    { name: '冰牢', mp: 20, power: 0, desc: '单体冻结控制2回合', element: '水', phase: '始解', damageType: 'magical', skillType: 'control', statusEffect: { subtype: 'freeze', turns: 2, rate: 0.70 } },
  ],
  袖白雪: [
    { name: '白涟', mp: 22, power: 2.8, desc: '单体，冻结目标三倍伤害', element: '水', phase: '始解', damageType: 'magical' },
    { name: '白刀', mp: 18, power: 2.3, desc: '贯穿攻击，无视冻结目标防御', element: '水', phase: '始解', damageType: 'magical' },
  ],
  镜花水月: [
    { name: '镜花', mp: 22, power: 1.6, desc: '全体水伤+概率混乱(2回合)', element: '水', phase: '始解', damageType: 'magical' },
    { name: '水月', mp: 28, power: 3.2, desc: '单体幻术·高额魔法伤害', element: '水', phase: '始解', damageType: 'magical' },
  ],
  双鱼理: [
    { name: '吸收', mp: 18, power: 0, desc: '吸收下次受到的魔法伤害转HP', element: '水', phase: '始解', damageType: 'magical' },
    { name: '反転', mp: 24, power: 2.0, desc: '全体水伤+自身MDEF+30%(3回合)', element: '水', phase: '始解', damageType: 'magical' },
  ],
  肉雫唼: [
    { name: '愈', mp: 22, power: 2.0, desc: '单体HP大回复(MATK×200%)', element: '水', phase: '始解', damageType: 'magical', skillType: 'heal' },
    { name: '雫', mp: 30, power: 1.2, desc: '全体HP回复+净化异常状态(MATK×120%)', element: '水', phase: '始解', damageType: 'magical', skillType: 'heal' },
  ],
  金沙罗: [
    { name: '金沙乱舞', mp: 22, power: 1.5, desc: '全体水伤+敌方命中-20%(3回合)', element: '水', phase: '始解', damageType: 'magical' },
    { name: '缚之歌', mp: 26, power: 0, desc: '单体眩晕2回合', element: '水', phase: '始解', damageType: 'magical', skillType: 'control', statusEffect: { subtype: 'stun', turns: 2, rate: 0.65 } },
  ],
  捩花: [
    { name: '水流葬', mp: 18, power: 2.5, desc: '单体旋转水刃', element: '水', phase: '始解', damageType: 'magical' },
    { name: '潮旋', mp: 22, power: 1.6, desc: '全体水伤+概率减速(3回合)', element: '水', phase: '始解', damageType: 'magical', statusEffect: { subtype: 'slow', turns: 3, rate: 0.35 } },
  ],
  瓠丸: [
    { name: '愈之光', mp: 18, power: 1.5, desc: '单体HP中回复(MATK×150%)', element: '水', phase: '始解', damageType: 'magical', skillType: 'heal' },
    { name: '瓠丸闪光', mp: 24, power: 1.2, desc: '全体水伤+我方攻击+10%(3回合)', element: '水', phase: '始解', damageType: 'magical' },
  ],
  清虫: [],  // ★锻体

  // ── 土系·9把 ──
  天谴: [
    { name: '明王', mp: 24, power: 1.4, desc: '全体土伤+敌方速度-20%(3回合)', element: '土', phase: '始解', damageType: 'physical' },
    { name: '地裂', mp: 20, power: 1.2, desc: '全体土伤+高概率眩晕', element: '土', phase: '始解', damageType: 'physical', statusEffect: { subtype: 'stun', turns: 1, rate: 0.40 } },
  ],
  蛇尾丸: [
    { name: '蛇尾鞭笞', mp: 20, power: 1.3, desc: '全体中距土伤', element: '土', phase: '始解', damageType: 'physical' },
    { name: '狒牙绝咬', mp: 26, power: 3.0, desc: '单体高伤+流血(3回合)', element: '土', phase: '始解', damageType: 'physical' },
  ],
  鬼灯丸: [
    { name: '三节裂甲', mp: 18, power: 2.5, desc: '单体破甲(防御-25%,3回合)', element: '土', phase: '始解', damageType: 'physical' },
    { name: '龙纹鬼灯', mp: 24, power: 3.5, desc: '单体，破甲目标伤害+50%', element: '土', phase: '始解', damageType: 'physical' },
  ],
  灰猫: [
    { name: '灰化', mp: 18, power: 1.2, desc: '全体土伤+敌方命中-20%(3回合)', element: '土', phase: '始解', damageType: 'physical' },
    { name: '猫袭', mp: 22, power: 2.4, desc: '单体+概率流血(3回合)', element: '土', phase: '始解', damageType: 'physical' },
  ],
  侘助: [
    { name: '重压', mp: 18, power: 1.3, desc: '全体土伤+敌方速度-30%(3回合)', element: '土', phase: '始解', damageType: 'physical' },
    { name: '侘助百贯', mp: 24, power: 2.0, desc: '单体，目标速度越低伤害越高', element: '土', phase: '始解', damageType: 'physical' },
  ],
  土鯰: [
    { name: '土流壁', mp: 20, power: 0, desc: '全队防御+30%(3回合)', element: '土', phase: '始解', damageType: 'physical' },
    { name: '鯰震', mp: 22, power: 1.8, desc: '全体土伤+概率减速', element: '土', phase: '始解', damageType: 'physical', statusEffect: { subtype: 'slow', turns: 2, rate: 0.30 } },
  ],
  五形头: [
    { name: '五形重锤', mp: 22, power: 3.2, desc: '单体高伤+概率眩晕', element: '土', phase: '始解', damageType: 'physical', statusEffect: { subtype: 'stun', turns: 1, rate: 0.30 } },
    { name: '地鸣震', mp: 26, power: 1.5, desc: '全体土伤+概率眩晕', element: '土', phase: '始解', damageType: 'physical', statusEffect: { subtype: 'stun', turns: 1, rate: 0.25 } },
  ],
  裂岩: [
    { name: '裂岩斩', mp: 18, power: 2.8, desc: '单体高伤+破甲', element: '土', phase: '始解', damageType: 'physical' },
    { name: '岩碎崩', mp: 24, power: 1.5, desc: '全体土伤', element: '土', phase: '始解', damageType: 'physical' },
  ],
  崩山: [],  // ★锻体
};

// ═══════════════════════════════════════════
// 卍解技能 — 每把刀1个终极技能
// ═══════════════════════════════════════════
export const BANKAI_SKILLS: Record<string, SkillData[]> = {
  // ── 火系 ──
  流刃若火: [
    { name: '残火太刀·东', mp: 55, power: 6.0, desc: '卍解·单体焚尽一切', element: '火', phase: '卍解', damageType: 'physical' },
    { name: '残火太刀·西', mp: 65, power: 3.5, desc: '卍解·全体烈日灼烧', element: '火', phase: '卍解', damageType: 'physical' },
  ],
  飞梅: [
    { name: '飞梅·万花缭乱', mp: 48, power: 4.2, desc: '卍解·单体火种引爆', element: '火', phase: '卍解', damageType: 'magical' },
    { name: '飞梅·百花缭乱', mp: 56, power: 2.5, desc: '卍解·全体火种风暴', element: '火', phase: '卍解', damageType: 'magical' },
  ],
  红姬: [
    { name: '红姬·天变', mp: 50, power: 4.8, desc: '卍解·单体火弹轰炸', element: '火', phase: '卍解', damageType: 'magical' },
    { name: '红姬·地异', mp: 58, power: 2.8, desc: '卍解·全体流星火雨', element: '火', phase: '卍解', damageType: 'magical' },
  ],
  剡月: [
    { name: '剡月·无间', mp: 52, power: 6.2, desc: '卍解·单体终极斩击', element: '火', phase: '卍解', damageType: 'physical' },
    { name: '剡月·断空', mp: 60, power: 3.0, desc: '卍解·全体横扫斩', element: '火', phase: '卍解', damageType: 'physical' },
  ],
  雀蜂: [
    { name: '雀蜂·雷公鞭', mp: 45, power: 5.5, desc: '卍解·单体贯穿+先制', element: '火', phase: '卍解', damageType: 'physical' },
    { name: '雀蜂·雷公阵', mp: 52, power: 3.0, desc: '卍解·全体雷弹齐射', element: '火', phase: '卍解', damageType: 'physical' },
  ],
  疋杀地蔵: [
    { name: '金色疋杀地蔵', mp: 50, power: 4.5, desc: '卍解·单体毒爆+中毒4T', element: '火', phase: '卍解', damageType: 'magical', statusEffect: { subtype: 'poison', turns: 4, rate: 0.75 } },
    { name: '地蔵·万毒', mp: 58, power: 2.2, desc: '卍解·全体毒雾弥漫', element: '火', phase: '卍解', damageType: 'magical', statusEffect: { subtype: 'poison', turns: 3, rate: 0.60 } },
  ],
  天狗丸: [
    { name: '天狗丸·豪火天冲', mp: 48, power: 5.5, desc: '卍解·单体豪火爆裂', element: '火', phase: '卍解', damageType: 'physical' },
    { name: '天狗丸·焰阵', mp: 55, power: 3.2, desc: '卍解·全体火焰阵', element: '火', phase: '卍解', damageType: 'physical' },
  ],
  馘大蛇: [
    { name: '馘大蛇·八岐', mp: 50, power: 5.8, desc: '卍解·单体八岐咬杀', element: '火', phase: '卍解', damageType: 'physical' },
    { name: '馘大蛇·万蛇', mp: 58, power: 2.8, desc: '卍解·全体群蛇噬咬', element: '火', phase: '卍解', damageType: 'physical' },
  ],
  严灵丸: [
    { name: '严灵丸·不灭', mp: 42, power: 5.0, desc: '卍解·锻体单体昇华', element: '火', phase: '卍解', damageType: 'physical' },
  ],

  // ── 风系 ──
  斩月: [
    { name: '天锁斩月', mp: 45, power: 6.0, desc: '卍解·单体超高速斩', element: '风', phase: '卍解', damageType: 'physical' },
    { name: '月牙天冲·极', mp: 52, power: 3.5, desc: '卍解·全体月牙横扫', element: '风', phase: '卍解', damageType: 'physical' },
  ],
  千本樱: [
    { name: '千本樱·歼景', mp: 55, power: 5.0, desc: '卍解·单体千刀集中', element: '风', phase: '卍解', damageType: 'physical' },
    { name: '千本樱·景严', mp: 62, power: 1.5, desc: '卍解·全体亿片樱花', element: '风', phase: '卍解', damageType: 'physical' },
  ],
  神枪: [
    { name: '神枪·神杀', mp: 40, power: 6.5, desc: '卍解·单体极限射程', element: '风', phase: '卍解', damageType: 'physical' },
    { name: '神枪·连杀', mp: 48, power: 3.0, desc: '卍解·全体连突', element: '风', phase: '卍解', damageType: 'physical' },
  ],
  花天狂骨: [
    { name: '花天·崭鬼', mp: 50, power: 5.2, desc: '卍解·单体灵压碾压', element: '风', phase: '卍解', damageType: 'magical' },
    { name: '狂骨·影鬼', mp: 58, power: 3.0, desc: '卍解·全体幻影重叠', element: '风', phase: '卍解', damageType: 'magical' },
  ],
  藤孔雀: [
    { name: '藤孔雀·千本藤', mp: 48, power: 4.5, desc: '卍解·单体束缚+2T', element: '风', phase: '卍解', damageType: 'magical', statusEffect: { subtype: 'bind', turns: 2, rate: 0.70 } },
    { name: '藤孔雀·万藤', mp: 55, power: 2.5, desc: '卍解·全体藤缚', element: '风', phase: '卍解', damageType: 'magical', statusEffect: { subtype: 'bind', turns: 1, rate: 0.55 } },
  ],
  逆抚: [
    { name: '逆抚·万象颠倒', mp: 50, power: 5.0, desc: '卍解·单体极致混乱', element: '风', phase: '卍解', damageType: 'magical', statusEffect: { subtype: 'stun', turns: 3, rate: 0.75 } },
    { name: '逆抚·颠倒世界', mp: 58, power: 2.8, desc: '卍解·全体混乱2T', element: '风', phase: '卍解', damageType: 'magical', statusEffect: { subtype: 'stun', turns: 2, rate: 0.60 } },
  ],
  断地风: [
    { name: '断地风·裂空', mp: 42, power: 6.0, desc: '卍解·单体风刃破甲', element: '风', phase: '卍解', damageType: 'physical' },
    { name: '断地风·岚', mp: 50, power: 3.2, desc: '卍解·全体暴风', element: '风', phase: '卍解', damageType: 'physical' },
  ],
  铁浆蜻蛉: [
    { name: '铁浆蜻蛉·万贯', mp: 44, power: 5.8, desc: '卍解·单体多段破甲', element: '风', phase: '卍解', damageType: 'physical' },
    { name: '铁浆蜻蛉·千贯', mp: 52, power: 3.0, desc: '卍解·全体蜻蛉阵', element: '风', phase: '卍解', damageType: 'physical' },
  ],
  风死: [
    { name: '风死·疾风迅雷', mp: 45, power: 3.2, desc: '卍解·锻体全体加速', element: '风', phase: '卍解', damageType: 'physical' },
  ],

  // ── 水系 ──
  冰轮丸: [
    { name: '大红莲冰轮丸', mp: 60, power: 5.5, desc: '卍解·单体冰封+冻结', element: '水', phase: '卍解', damageType: 'magical', statusEffect: { subtype: 'freeze', turns: 2, rate: 0.80 } },
    { name: '冰天百花葬', mp: 68, power: 3.0, desc: '卍解·全体冰封+冻结', element: '水', phase: '卍解', damageType: 'magical', statusEffect: { subtype: 'freeze', turns: 1, rate: 0.60 } },
  ],
  袖白雪: [
    { name: '白霞罚', mp: 55, power: 5.8, desc: '卍解·单体绝对零度', element: '水', phase: '卍解', damageType: 'magical', statusEffect: { subtype: 'freeze', turns: 1, rate: 0.90 } },
    { name: '白涟·极', mp: 62, power: 3.2, desc: '卍解·全体冰雪风暴', element: '水', phase: '卍解', damageType: 'magical' },
  ],
  镜花水月: [
    { name: '完全催眠·碎', mp: 60, power: 6.0, desc: '卍解·单体幻术粉碎', element: '水', phase: '卍解', damageType: 'magical' },
    { name: '完全催眠·镜', mp: 68, power: 3.5, desc: '卍解·全体精神崩坏', element: '水', phase: '卍解', damageType: 'magical' },
  ],
  双鱼理: [
    { name: '双鱼理·双天', mp: 50, power: 5.0, desc: '卍解·单体水刃', element: '水', phase: '卍解', damageType: 'magical' },
    { name: '双鱼理·归海', mp: 58, power: 3.0, desc: '卍解·全体漩涡', element: '水', phase: '卍解', damageType: 'magical' },
  ],
  肉雫唼: [
    { name: '肉雫唼·皆尽', mp: 55, power: 3.0, desc: '卍解·全队满血净化', element: '水', phase: '卍解', damageType: 'magical', skillType: 'heal' },
    { name: '肉雫唼·大愈', mp: 45, power: 2.0, desc: '卍解·单体究极治愈', element: '水', phase: '卍解', damageType: 'magical', skillType: 'heal' },
  ],
  金沙罗: [
    { name: '金沙罗·舞踏连刃', mp: 52, power: 5.2, desc: '卍解·单体多段+眩晕', element: '水', phase: '卍解', damageType: 'magical', statusEffect: { subtype: 'stun', turns: 2, rate: 0.75 } },
    { name: '金沙罗·狂舞', mp: 60, power: 2.8, desc: '卍解·全体舞踏', element: '水', phase: '卍解', damageType: 'magical' },
  ],
  捩花: [
    { name: '捩花·水天一碧', mp: 48, power: 5.0, desc: '卍解·单体水龙钻', element: '水', phase: '卍解', damageType: 'magical' },
    { name: '捩花·潮旋葬', mp: 56, power: 3.0, desc: '卍解·全体水龙卷', element: '水', phase: '卍解', damageType: 'magical' },
  ],
  瓠丸: [
    { name: '瓠丸·神愈', mp: 50, power: 2.5, desc: '卍解·全队大回复', element: '水', phase: '卍解', damageType: 'magical', skillType: 'heal' },
    { name: '瓠丸·光愈', mp: 40, power: 1.8, desc: '卍解·单体净化+回复', element: '水', phase: '卍解', damageType: 'magical', skillType: 'heal' },
  ],
  清虫: [
    { name: '清虫·终式', mp: 44, power: 5.2, desc: '卍解·锻体单体音波', element: '水', phase: '卍解', damageType: 'magical' },
  ],

  // ── 土系 ──
  天谴: [
    { name: '黑绳天谴明王', mp: 55, power: 5.5, desc: '卍解·单体巨神重击+眩晕', element: '土', phase: '卍解', damageType: 'physical', statusEffect: { subtype: 'stun', turns: 2, rate: 0.70 } },
    { name: '明王·怒', mp: 62, power: 3.2, desc: '卍解·全体巨神碾压', element: '土', phase: '卍解', damageType: 'physical', statusEffect: { subtype: 'stun', turns: 1, rate: 0.50 } },
  ],
  蛇尾丸: [
    { name: '蛇尾丸·狒骨', mp: 50, power: 6.0, desc: '卍解·单体绝咬', element: '土', phase: '卍解', damageType: 'physical' },
    { name: '蛇尾丸·大蛇', mp: 58, power: 3.2, desc: '卍解·全体鞭笞', element: '土', phase: '卍解', damageType: 'physical' },
  ],
  鬼灯丸: [
    { name: '鬼灯丸·龙纹鬼灯', mp: 52, power: 6.2, desc: '卍解·单体极限破甲', element: '土', phase: '卍解', damageType: 'physical' },
    { name: '鬼灯丸·鬼灯阵', mp: 60, power: 3.0, desc: '卍解·全体灯阵', element: '土', phase: '卍解', damageType: 'physical' },
  ],
  灰猫: [
    { name: '灰猫·尘界', mp: 48, power: 4.5, desc: '卍解·单体灰化', element: '土', phase: '卍解', damageType: 'physical' },
    { name: '灰猫·雾界', mp: 55, power: 2.5, desc: '卍解·全体灰雾', element: '土', phase: '卍解', damageType: 'physical' },
  ],
  侘助: [
    { name: '侘助·万钧', mp: 45, power: 5.8, desc: '卍解·单体重压', element: '土', phase: '卍解', damageType: 'physical' },
    { name: '侘助·百贯', mp: 52, power: 3.0, desc: '卍解·全体重力场', element: '土', phase: '卍解', damageType: 'physical' },
  ],
  土鯰: [
    { name: '土鯰·地崩', mp: 50, power: 4.8, desc: '卍解·单体地裂', element: '土', phase: '卍解', damageType: 'physical' },
    { name: '土鯰·大地震', mp: 58, power: 2.8, desc: '卍解·全体地震+减速', element: '土', phase: '卍解', damageType: 'physical', statusEffect: { subtype: 'slow', turns: 3, rate: 0.65 } },
  ],
  五形头: [
    { name: '五形头·天崩', mp: 55, power: 6.0, desc: '卍解·单体终极重击', element: '土', phase: '卍解', damageType: 'physical', statusEffect: { subtype: 'stun', turns: 2, rate: 0.65 } },
    { name: '五形头·地裂', mp: 62, power: 3.2, desc: '卍解·全体地裂', element: '土', phase: '卍解', damageType: 'physical' },
  ],
  裂岩: [
    { name: '裂岩·山碎', mp: 48, power: 5.8, desc: '卍解·单体全力破岩', element: '土', phase: '卍解', damageType: 'physical' },
    { name: '裂岩·岩石雨', mp: 55, power: 3.0, desc: '卍解·全体岩石奔流', element: '土', phase: '卍解', damageType: 'physical' },
  ],
  崩山: [
    { name: '崩山·不动', mp: 46, power: 3.0, desc: '卍解·锻体全体铁壁', element: '土', phase: '卍解', damageType: 'physical' },
  ],
};

/** 获取当前阶段可用技能 */
export const ZANPAKUTO_ELEMENT: Record<string, string> = {
  流刃若火: '火', 飞梅: '火', 红姬: '火', 剡月: '火', 雀蜂: '火', 疋杀地蔵: '火', 天狗丸: '火', 馘大蛇: '火', 严灵丸: '火',
  斩月: '风', 千本樱: '风', 神枪: '风', 花天狂骨: '风', 藤孔雀: '风', 逆抚: '风', 断地风: '风', 铁浆蜻蛉: '风', 风死: '风',
  冰轮丸: '水', 袖白雪: '水', 镜花水月: '水', 双鱼理: '水', 肉雫唼: '水', 金沙罗: '水', 捩花: '水', 瓠丸: '水', 清虫: '水',
  天谴: '土', 蛇尾丸: '土', 鬼灯丸: '土', 灰猫: '土', 侘助: '土', 土鯰: '土', 五形头: '土', 裂岩: '土', 崩山: '土',
};

/** 获取当前可用技能 */
export function getAvailableSkills(zanpakuto: string, element: string, hasShikai: boolean, hasBankai?: boolean, bankaiActive?: boolean, hollowActive?: boolean, hellActive?: boolean): SkillData[] {
  const result: SkillData[] = [];
  if (element && SHALLOW_SKILLS[element]) result.push(SHALLOW_SKILLS[element]);
  if (hasShikai && zanpakuto && SHIKAI_SKILLS[zanpakuto]) result.push(...SHIKAI_SKILLS[zanpakuto]);
  if (hasBankai && bankaiActive && zanpakuto && BANKAI_SKILLS[zanpakuto]) result.push(...BANKAI_SKILLS[zanpakuto]);
  if (hollowActive) result.push(...HOLLOW_SKILLS);
  if (hellActive) result.push(...HELL_SKILLS);
  return result;
}

// ═══════════════════════════════════════════
// 虚化技能 — 全刀通用2个
// ═══════════════════════════════════════════
export const HOLLOW_SKILLS: SkillData[] = [
  { name: '虚闪', mp: 45, power: 5.0, desc: '虚化·单体高伤灵力炮', element: '无', phase: '卍解', damageType: 'magical' },
  { name: '王虚闪', mp: 60, power: 3.2, desc: '虚化·全体毁灭光炮', element: '无', phase: '卍解', damageType: 'magical' },
];

// ═══════════════════════════════════════════
// 狱解技能
// ═══════════════════════════════════════════
export const HELL_SKILLS: SkillData[] = [
  { name: '狱炎', mp: 60, power: 6.5, desc: '狱解·单体地狱业火', element: '无', phase: '卍解', damageType: 'magical' },
  { name: '冥府之门', mp: 75, power: 4.0, desc: '狱解·全体地狱吞噬', element: '无', phase: '卍解', damageType: 'magical' },
];
