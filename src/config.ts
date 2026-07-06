/**
 * 《解》— 游戏配置常量
 * 所有数值来源于设计文档
 */
export const GAME_WIDTH = 1920;
export const GAME_HEIGHT = 1080;
export const TILE_SIZE = 32;

/** 区域战力基数 (PL) */
export const ZONE_PL: Record<number, number> = {
  1: 4, 2: 6, 3: 8,     // 空座町·南/北/东
  4: 10, 5: 12, 6: 14,   // 润林安/东/北
  7: 18, 8: 20, 9: 24,   // 静灵庭·外/内/中枢
  10: 28, 11: 30, 12: 34,// 虚圈·表/深/虚夜宫
  13: 36, 14: 38, 15: 42,// 空座町·战后/鸣木市/据点
  16: 44, 17: 46, 18: 50,// 无形帝国·外/内/银架城
  19: 54, 20: 56, 21: 60,// 地狱·表/深/地狱之门
};

/** 品质倍率 */
export const QUALITY_MULTIPLIER: Record<string, number> = {
  white: 1.0,
  green: 1.3,
  blue: 1.6,
  purple: 2.0,
  gold: 2.5,
};

/** 基础属性初始值 */
export const BASE_STATS = {
  HP: 100, MP: 50, ATK: 10, DEF: 8,
  MATK: 10, MDEF: 8, SPD: 10, CRT: 0.05, CDM: 1.5,
};

/** 每级属性点 */
export const POINTS_PER_LEVEL = 6;

/** 属性点换算 */
export const STAT_PER_POINT: Record<string, number> = {
  HP: 15, MP: 5, ATK: 1, DEF: 1, MATK: 1, MDEF: 1, SPD: 1,
};

/** 斩魄刀成长倾向 — 每元素5把有技能刀(定位各异) + 1把锻体刀(纯平A,无技能,高全属性) */
export const ZANPAKUTO_GROWTH: Record<string, Record<string, number>> = {
  // ═══ 火系 ═══
  流刃若火: { HP: 0.8, MP: 1.1, ATK: 1.6, DEF: 0.6, MATK: 1.2, MDEF: 0.6, SPD: 0.9 },
  飞梅:     { HP: 0.8, MP: 1.3, ATK: 1.0, DEF: 0.7, MATK: 1.6, MDEF: 0.8, SPD: 0.8 },
  红姬:     { HP: 1.0, MP: 1.2, ATK: 1.2, DEF: 1.0, MATK: 1.3, MDEF: 0.9, SPD: 0.9 },
  剡月:     { HP: 0.9, MP: 1.0, ATK: 1.8, DEF: 0.5, MATK: 0.8, MDEF: 0.5, SPD: 1.0 },
  雀蜂:     { HP: 0.7, MP: 0.9, ATK: 1.5, DEF: 0.5, MATK: 0.8, MDEF: 0.5, SPD: 1.7 },
  疋杀地蔵: { HP: 0.9, MP: 1.3, ATK: 1.0, DEF: 0.7, MATK: 1.5, MDEF: 0.9, SPD: 0.9, statusAcc: 0.10 },  // 毒系控制
  天狗丸:   { HP: 1.1, MP: 1.0, ATK: 1.4, DEF: 0.9, MATK: 1.0, MDEF: 0.9, SPD: 0.8 },
  馘大蛇:   { HP: 0.7, MP: 0.9, ATK: 1.6, DEF: 0.6, MATK: 0.9, MDEF: 0.6, SPD: 1.2 },
  严灵丸:   { HP: 2.0, MP: 1.6, ATK: 1.8, DEF: 1.8, MATK: 1.8, MDEF: 1.8, SPD: 1.6 },
  // ═══ 风系 ═══
  斩月:     { HP: 1.0, MP: 0.9, ATK: 1.6, DEF: 0.7, MATK: 0.7, MDEF: 0.7, SPD: 1.3 },
  千本樱:   { HP: 0.9, MP: 0.9, ATK: 1.3, DEF: 0.7, MATK: 0.9, MDEF: 0.7, SPD: 1.5 },
  神枪:     { HP: 0.8, MP: 0.8, ATK: 1.7, DEF: 0.5, MATK: 0.6, MDEF: 0.5, SPD: 1.9 },
  花天狂骨: { HP: 1.0, MP: 1.2, ATK: 1.2, DEF: 0.8, MATK: 1.3, MDEF: 0.8, SPD: 1.1 },
  藤孔雀:   { HP: 0.9, MP: 1.3, ATK: 1.1, DEF: 0.7, MATK: 1.4, MDEF: 0.8, SPD: 1.2, statusAcc: 0.10 },  // 束缚控制
  逆抚:     { HP: 0.8, MP: 1.2, ATK: 1.0, DEF: 0.7, MATK: 1.5, MDEF: 0.9, SPD: 1.3, statusAcc: 0.15 },  // 混乱控制
  断地风:   { HP: 1.0, MP: 0.9, ATK: 1.5, DEF: 0.8, MATK: 0.8, MDEF: 0.7, SPD: 1.1 },
  铁浆蜻蛉: { HP: 0.9, MP: 1.0, ATK: 1.3, DEF: 0.8, MATK: 1.0, MDEF: 0.8, SPD: 1.4 },
  风死:     { HP: 1.9, MP: 1.5, ATK: 1.9, DEF: 1.7, MATK: 1.7, MDEF: 1.7, SPD: 1.7 },
  // ═══ 水系 ═══
  冰轮丸:   { HP: 1.0, MP: 1.3, ATK: 1.0, DEF: 0.8, MATK: 1.5, MDEF: 1.0, SPD: 0.8, statusAcc: 0.15 },  // 冰冻控制
  袖白雪:   { HP: 1.0, MP: 1.2, ATK: 1.2, DEF: 0.7, MATK: 1.5, MDEF: 0.9, SPD: 1.0, statusAcc: 0.10 },  // 冰冻控制
  镜花水月: { HP: 0.9, MP: 1.5, ATK: 0.8, DEF: 0.7, MATK: 1.7, MDEF: 1.0, SPD: 1.0, statusAcc: 0.10 },  // 幻术控制
  双鱼理:   { HP: 1.1, MP: 1.2, ATK: 0.8, DEF: 1.0, MATK: 1.2, MDEF: 1.6, SPD: 0.7 },
  肉雫唼:   { HP: 1.3, MP: 1.5, ATK: 0.7, DEF: 0.9, MATK: 1.4, MDEF: 1.3, SPD: 0.8 },
  金沙罗:   { HP: 0.9, MP: 1.4, ATK: 0.9, DEF: 0.7, MATK: 1.6, MDEF: 1.0, SPD: 0.9 },
  捩花:     { HP: 1.0, MP: 1.1, ATK: 1.3, DEF: 0.8, MATK: 1.2, MDEF: 0.9, SPD: 1.0 },
  瓠丸:     { HP: 1.2, MP: 1.4, ATK: 0.7, DEF: 0.9, MATK: 1.3, MDEF: 1.2, SPD: 0.8 },
  清虫:     { HP: 2.0, MP: 1.6, ATK: 1.8, DEF: 1.8, MATK: 1.8, MDEF: 1.8, SPD: 1.6 },
  // ═══ 土系 ═══
  天谴:     { HP: 1.4, MP: 0.9, ATK: 1.2, DEF: 1.4, MATK: 0.8, MDEF: 1.2, SPD: 0.7, statusAcc: 0.10 },  // 眩晕控制
  蛇尾丸:   { HP: 1.2, MP: 0.9, ATK: 1.5, DEF: 1.0, MATK: 0.8, MDEF: 0.9, SPD: 1.1 },
  鬼灯丸:   { HP: 1.2, MP: 0.8, ATK: 1.6, DEF: 1.1, MATK: 0.7, MDEF: 1.0, SPD: 0.8 },
  灰猫:     { HP: 1.0, MP: 1.1, ATK: 1.1, DEF: 0.9, MATK: 1.2, MDEF: 1.0, SPD: 1.1 },
  侘助:     { HP: 1.3, MP: 0.9, ATK: 0.9, DEF: 1.5, MATK: 0.7, MDEF: 1.4, SPD: 0.6 },
  土鯰:     { HP: 1.1, MP: 0.9, ATK: 1.2, DEF: 1.2, MATK: 0.8, MDEF: 1.2, SPD: 0.9 },
  五形头:   { HP: 1.5, MP: 0.8, ATK: 0.8, DEF: 1.6, MATK: 0.6, MDEF: 1.5, SPD: 0.5 },
  裂岩:     { HP: 1.1, MP: 0.9, ATK: 1.5, DEF: 1.0, MATK: 0.7, MDEF: 0.9, SPD: 0.9 },
  崩山:     { HP: 2.1, MP: 1.5, ATK: 1.8, DEF: 2.0, MATK: 1.7, MDEF: 2.0, SPD: 1.5 },  // ★锻体
};

/** 区域名称 */
export const ZONE_NAMES: Record<number, string> = {
  1: '浦原商店街', 2: '空座高校', 3: '河川敷',
  4: '润林安', 5: '戌吊', 6: '草鹿',
  7: '一番队舍', 8: '技术開発局', 9: '真央灵术院',
  10: '白砂原', 11: '黑腔深部', 12: '虚夜宫',
  13: '战迹', 14: 'XCUTION基地', 15: '完现术总本山',
  16: '影之领域', 17: '星十字宫', 18: '银架城',
  19: '咎人之门', 20: '无间', 21: '终焉之渊',
};
