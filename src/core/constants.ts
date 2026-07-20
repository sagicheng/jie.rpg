/**
 * 全局常量与纯计算 helper（无运行期依赖，叶子模块）
 */

/** 强化/精炼等级 → 属性倍率：1 + lv*0.05 */
export const enhanceMult = (lv: number): number => 1 + lv * 0.05;

/** 品质倍率（config / BattleData / EnhanceSystem / BattleScene 共用单一来源） */
export const QUALITY_MULT: Record<string, number> = { white: 1.0, green: 1.3, blue: 1.6, purple: 2.0, gold: 2.5 };
/** 品质中文名 */
export const QUALITY_CN: Record<string, string> = { white: '白', green: '绿', blue: '蓝', purple: '紫', gold: '金' };
/** 品质颜色 */
export const QUALITY_COLOR: Record<string, string> = { white: '#cccccc', green: '#44cc44', blue: '#4488ff', purple: '#cc44cc', gold: '#ffaa00' };
