// 区域名映射（服务端精简版，避免引入客户端大文件 src/systems/Zones.ts）。
// 与 ZONE_CONFIGS 的 id→name 保持一致，仅取显示名。
export const ZONE_NAMES: Record<number, string> = {
  1: '浦原商店街', 2: '空座高校', 3: '河川敷', 4: '润林安', 5: '戌吊',
  6: '草鹿', 7: '一番队舍', 8: '技術開発局', 9: '真央霊術院', 10: '白砂原',
  11: '黒腔深部', 12: '虚夜宮', 13: '戦跡', 14: 'XCUTION基地', 15: '完現術総本山',
  16: '影ノ領域', 17: '星十字宮', 18: '銀架城', 19: '咎人ノ門', 20: '無間', 21: '終焉ノ淵',
};

export function zoneName(zone: number): string {
  return ZONE_NAMES[zone] || `区域${zone}`;
}
