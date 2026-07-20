import { enhanceMult } from '../core/constants';

/** 物品类型 */
export type ItemType = 'equipment' | 'material' | 'consumable' | 'key' | 'pet_egg';

/** 装备槽位 */
export type EquipSlot = 'head' | 'body' | 'bracer' | 'boots' | 'belt' | 'ring' | 'necklace' | 'charm' | 'pendant';

/** 精炼词条 */
export interface RefineStat {
  key: string;
  value: number;
}

export interface Item {
  id: string;
  name: string;
  type: ItemType;
  desc: string;
  quantity: number;
  // 装备属性
  slot?: EquipSlot;
  stats?: Partial<Record<string, number>>;
  quality?: string; // white/green/blue/purple/gold
  set?: string;      // 套装标识：`${zone}_${quality}`，同标识装备凑齐件数激活套装加成
  // 强化系统
  enhanceLevel?: number;         // 0~15
  refineStats?: RefineStat[];    // 精炼词条列表
  // 灵宠蛋：记录掉落区域，供开蛋时按区域定品质
  zone?: number;
}

/** 装备栏 */
export interface Equipment {
  head: Item | null;
  body: Item | null;
  bracer: Item | null;
  boots: Item | null;
  belt: Item | null;
  ring: Item | null;
  necklace: Item | null;
  charm: Item | null;
  pendant: Item | null;
}

/** 全局背包 */
class InventoryManager {
  items: Item[] = [];
  equipment: Equipment = {
    head: null, body: null, bracer: null, boots: null, belt: null,
    ring: null, necklace: null, charm: null, pendant: null,
  };

  addItem(item: Item): void {
    const existing = this.items.find(i => i.id === item.id && i.type !== 'equipment');
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      this.items.push({ ...item });
    }
  }

  /** 重置背包 */
  reset(): void {
    this.items = [];
    this.equipment = {
      head: null, body: null, bracer: null, boots: null, belt: null,
      ring: null, necklace: null, charm: null, pendant: null,
    };
  }

  equip(item: Item): string | null {
    if (item.type !== 'equipment' || !item.slot) return '不可装备';
    const slot = item.slot;
    const old = this.equipment[slot];
    if (old) {
      this.items.push(old); // 卸下旧装备放回背包
    }
    this.equipment[slot] = item;
    this.items = this.items.filter(i => i !== item);
    return null;
  }

  unequip(slot: EquipSlot): void {
    const item = this.equipment[slot];
    if (item) {
      this.items.push(item);
      this.equipment[slot] = null;
    }
  }

  /** 计算单件装备的实际属性（含强化倍率+精炼词条） */
  private getItemStats(item: Item): Partial<Record<string, number>> {
    if (!item.stats) return {};
    const enhanceLv = item.enhanceLevel || 0;
    const mult = enhanceMult(enhanceLv);
    const stats: Record<string, number> = {};
    for (const [k, v] of Object.entries(item.stats)) {
      stats[k] = Math.round((v || 0) * mult);
    }
    // 加上精炼词条
    if (item.refineStats) {
      for (const rs of item.refineStats) {
        stats[rs.key] = (stats[rs.key] || 0) + rs.value;
      }
    }
    return stats;
  }

  getEquipStats(): Partial<Record<string, number>> {
    const stats: Partial<Record<string, number>> = {};
    for (const slot of Object.keys(this.equipment) as EquipSlot[]) {
      const item = this.equipment[slot];
      if (item) {
        const itemStats = this.getItemStats(item);
        for (const [k, v] of Object.entries(itemStats)) {
          stats[k] = (stats[k] || 0) + (v || 0);
        }
      }
    }
    return stats;
  }

  /** 装备(防具)统计 — head/body/bracer/boots/belt */
  getBodyEquipStats(): Partial<Record<string, number>> {
    const bodySlots: EquipSlot[] = ['head', 'body', 'bracer', 'boots', 'belt'];
    const stats: Partial<Record<string, number>> = {};
    for (const slot of bodySlots) {
      const item = this.equipment[slot];
      if (item) {
        const itemStats = this.getItemStats(item);
        for (const [k, v] of Object.entries(itemStats)) {
          stats[k] = (stats[k] || 0) + (v || 0);
        }
      }
    }
    return stats;
  }

  /** 首饰统计 — ring/necklace/charm/pendant */
  getJewelryStats(): Partial<Record<string, number>> {
    const jewelSlots: EquipSlot[] = ['ring', 'necklace', 'charm', 'pendant'];
    const stats: Partial<Record<string, number>> = {};
    for (const slot of jewelSlots) {
      const item = this.equipment[slot];
      if (item) {
        const itemStats = this.getItemStats(item);
        for (const [k, v] of Object.entries(itemStats)) {
          stats[k] = (stats[k] || 0) + (v || 0);
        }
      }
    }
    return stats;
  }

  private static instance: InventoryManager;
  static get(): InventoryManager {
    if (!this.instance) this.instance = new InventoryManager();
    return this.instance;
  }
}

export const Inventory = InventoryManager.get();
