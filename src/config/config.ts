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

import { ZANPAKUTO_LIST } from './zanpakuto';
/** 斩魄刀成长倾向（id→growth） */
export const ZANPAKUTO_GROWTH: Record<string, Record<string,number>> = Object.fromEntries(
  ZANPAKUTO_LIST.map(z => [z.id, z.growth])
);

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
