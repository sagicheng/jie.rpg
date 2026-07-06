/** 存档管理器 — localStorage序列化 */

import { GameState } from './GameState';
import { Inventory, Item } from './Inventory';
import { Kido } from './Kido';

interface SaveData {
  version: number;
  timestamp: number;
  gameState: Record<string, any>;
  inventory: { items: Item[]; equipment: Record<string, Item | null> };
  kido: { school: string | null; nodes: Record<string, number>; equipped: string[] };
}

const SAVE_KEY = 'jie_save_v3';

export const SaveManager = {
  /** 保存 */
  save(): void {
    const data: SaveData = {
      version: 2,
      timestamp: Date.now(),
      gameState: { ...GameState },
      inventory: {
        items: [...Inventory.items],
        equipment: { ...Inventory.equipment },
      },
      kido: {
        school: Kido.school,
        nodes: { ...Kido.nodes },
        equipped: [...Kido.equipped],
      },
    };
    // 排除函数引用
    delete (data.gameState as any).gainExp;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('存档失败：', e);
    }
  },

  /** 读取 — 返回包含Kido数据的对象 */
  load(): { success: boolean; kidoSchool?: string | null; kidoEquipped?: string[]; kidoNodes?: Record<string, number> } {
    try {
      let raw = localStorage.getItem(SAVE_KEY);
      if (!raw) {
        raw = localStorage.getItem('jie_save_v2');
      }
      if (!raw) return { success: false };
      const data: SaveData = JSON.parse(raw);

      // 恢复 GameState
      const gs = data.gameState as any;
      if (gs.spi !== undefined && gs.matk === undefined) {
        gs.matk = gs.spi;
      }
      if (gs.allocatedSPI !== undefined && gs.allocatedMATK === undefined) {
        gs.allocatedMATK = gs.allocatedSPI;
      }
      Object.assign(GameState, data.gameState);

      // 恢复 Inventory
      Inventory.items.length = 0;
      Inventory.items.push(...data.inventory.items);
      for (const key of Object.keys(Inventory.equipment)) {
        delete (Inventory.equipment as any)[key];
      }
      Object.assign(Inventory.equipment, data.inventory.equipment);

      GameState.recalcStats();
      return {
        success: true,
        kidoSchool: data.kido?.school ?? null,
        kidoEquipped: data.kido?.equipped ?? [],
        kidoNodes: data.kido?.nodes ?? {},
      };
    } catch (e) {
      console.warn('读档失败：', e);
      return { success: false };
    }
  },

  /** 是否有存档 */
  hasSave(): boolean {
    return localStorage.getItem(SAVE_KEY) !== null || localStorage.getItem('jie_save_v2') !== null;
  },

  /** 删除存档 */
  deleteSave(): void {
    localStorage.removeItem(SAVE_KEY);
  },
};
