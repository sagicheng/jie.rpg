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
  '药草': '毒腺',
  '灵木': '灵木枝',
  '灵脉': '灵力水',
};

/**
 * 材料元数据注册表：图标纹理 key + 分级。
 * key = 中文材料名（与 matId / NODE_TO_MATERIAL 一致），图标文件 mat_<name>.png，64x64 透明背景。
 * 来源：美术资源「材料图标」两张表（08=高阶/传说，2Y=基础采集）提取接入。
 */
export type MaterialTier = 'common' | 'advanced';

export interface MaterialInfo {
  /** 显示名（中文） */
  name: string;
  /** Phaser 纹理 key（= mat_<name>） */
  icon: string;
  /** common=基础采集/合成，advanced=高阶/传说合成与强化 */
  tier: MaterialTier;
}

export const MATERIAL_INFO: Record<string, MaterialInfo> = {
  '完现结晶': { name: '完现结晶', icon: 'mat_完现结晶', tier: 'advanced' },
  '灵银碎片': { name: '灵银碎片', icon: 'mat_灵银碎片', tier: 'advanced' },
  '圣文字刻印': { name: '圣文字刻印', icon: 'mat_圣文字刻印', tier: 'advanced' },
  '罪业碎片': { name: '罪业碎片', icon: 'mat_罪业碎片', tier: 'advanced' },
  '地狱火种': { name: '地狱火种', icon: 'mat_地狱火种', tier: 'advanced' },
  '混沌核心': { name: '混沌核心', icon: 'mat_混沌核心', tier: 'advanced' },
  '终焉之核': { name: '终焉之核', icon: 'mat_终焉之核', tier: 'advanced' },
  '怨念结晶': { name: '怨念结晶', icon: 'mat_怨念结晶', tier: 'advanced' },
  '地狱王冠': { name: '地狱王冠', icon: 'mat_地狱王冠', tier: 'advanced' },
  '传说材料碎片': { name: '传说材料碎片', icon: 'mat_传说材料碎片', tier: 'advanced' },
  '灵力水': { name: '灵力水', icon: 'mat_灵力水', tier: 'common' },
  '铁矿石': { name: '铁矿石', icon: 'mat_铁矿石', tier: 'common' },
  '银矿石': { name: '银矿石', icon: 'mat_银矿石', tier: 'common' },
  '麻布片': { name: '麻布片', icon: 'mat_麻布片', tier: 'common' },
  '灵木枝': { name: '灵木枝', icon: 'mat_灵木枝', tier: 'common' },
  '硬皮': { name: '硬皮', icon: 'mat_硬皮', tier: 'common' },
  '虚夜碎片': { name: '虚夜碎片', icon: 'mat_虚夜碎片', tier: 'common' },
  '毒腺': { name: '毒腺', icon: 'mat_毒腺', tier: 'common' },
  '浅打碎片': { name: '浅打碎片', icon: 'mat_浅打碎片', tier: 'common' },
  '鬼道卷轴': { name: '鬼道卷轴', icon: 'mat_鬼道卷轴', tier: 'common' },
  '破面面具': { name: '破面面具', icon: 'mat_破面面具', tier: 'common' },
  '妖将核心': { name: '妖将核心', icon: 'mat_妖将核心', tier: 'common' },
  '灵晶碎片': { name: '灵晶碎片', icon: 'mat_灵晶碎片', tier: 'common' },
};

export const getMaterialInfo = (name: string): MaterialInfo | undefined => MATERIAL_INFO[name];
