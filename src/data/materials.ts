/**
 * 材料 id 与节点→材料映射（纯数据/helper，叶子模块）
 */

/** 统一材料 id 拼接：name → 'mat_' + name */
export const matId = (name: string): string => `mat_${name}`;

/**
 * 采集节点类型 → 材料真实名。
 * 根治：节点类型名（如'矿脉'）不得直接当材料 id，必须映射到材料真实名（如'铁矿石'）。
 * 来源：原 GameScene.matNames。
 */
export const NODE_TO_MATERIAL: Record<string, string> = {
  '矿脉': '铁矿石',
  '药草': '止血草',
  '灵木': '灵木枝',
  '灵脉': '灵力水',
};
