/**
 * 副本客户端辅助（纯函数，无副作用）。
 *  - buildDungeonParty：按副本阶数 + 区域怪物表组装该阶敌人阵容（小怪/精英/BOSS），
 *    整组传给 BattleRoom 权威 spawn（与地图怪同款流程）。
 *  - buildClientBattleLoadout：组装玩家可用技能/鬼道/道具/真实属性，供战斗房间权威校验。
 */
import { ZONE_CONFIGS } from './Zones';
import { createEnemyData, EnemyData } from './BattleData';
import { Inventory } from './Inventory';
import { GameState } from './GameState';
import { getAvailableSkills } from './Skills';
import { Kido } from './Kido';
import { BOSS_CONFIG } from './BossMechanics';
import type { ClientLoadout } from '../scenes/MultiBattleScene';

/** 组装玩家战斗负载（与 GameScene.buildBattleLoadout 同款，供副本战斗复用）。 */
export function buildClientBattleLoadout(): ClientLoadout {
  return {
    skills: getAvailableSkills(GameState.zanpakuto, GameState.element, GameState.hasShikai, GameState.hasBankai, false, false, false).map((s) => s.name),
    kidos: Kido.getActiveLearned(),
    items: Inventory.items.filter((i) => i.type === 'consumable'),
    playerStats: {
      hp: GameState.hp, maxHp: GameState.maxHp,
      mp: GameState.mp, maxMp: GameState.maxMp,
      atk: GameState.atk, def: GameState.def,
      matk: GameState.matk, mdef: GameState.mdef,
      spd: GameState.spd,
    },
  };
}

/**
 * 按副本阶数组装敌人阵容：
 *  - stage 1：本区域小怪（杂妖/恶妖）成组 2~4 只
 *  - stage 2：本区域精英（妖将非Boss，无则最强恶妖）2~3 只
 *  - stage 3：本区域 BOSS（isBoss/妖将妖王）+ 2~3 随从
 */
export function buildDungeonParty(dungeonId: number, stage: number): EnemyData[] {
  const cfg = ZONE_CONFIGS[dungeonId];
  const enemies = cfg?.enemies || [];

  if (stage >= 3) {
    const boss = enemies.find((e) => e.isBoss)
      || enemies.find((e) => e.type === '妖将' || e.type === '妖王')
      || { name: '副本守卫', type: '妖王' as const, element: '无', x: 0.5, y: 0.5 };
    const party: EnemyData[] = [createEnemyData(boss.name, boss.type, boss.element, dungeonId)];
    const bcfg = BOSS_CONFIG[boss.name];
    const adds: EnemyData[] = [];
    if (bcfg?.retinue) for (const r of bcfg.retinue) adds.push(createEnemyData(r.name, r.type, r.element, dungeonId));
    const pick = adds.slice(0, 3);
    if (pick.length === 0) {
      for (let i = 0; i < 2; i++) pick.push(createEnemyData('副本喽啰', '杂妖', boss.element, dungeonId));
    }
    return [party[0], ...pick];
  }

  if (stage === 2) {
    let elites = enemies.filter((e) => e.type === '妖将' && !e.isBoss);
    if (elites.length === 0) elites = enemies.filter((e) => e.type === '恶妖');
    if (elites.length === 0) elites = [{ name: '副本精英', type: '恶妖' as const, element: '无', x: 0.5, y: 0.5 }];
    const n = Math.min(3, Math.max(2, elites.length));
    const party: EnemyData[] = [];
    for (let i = 0; i < n; i++) {
      const e = elites[i % elites.length];
      party.push(createEnemyData(e.name, e.type, e.element, dungeonId));
    }
    return party;
  }

  // stage 1：小怪成组
  let mobs = enemies.filter((e) => e.type === '杂妖' || e.type === '恶妖');
  if (mobs.length === 0) mobs = [{ name: '副本虚', type: '杂妖' as const, element: '无', x: 0.5, y: 0.5 }];
  const n = 2 + Math.floor(Math.random() * 3); // 2~4
  const party: EnemyData[] = [];
  for (let i = 0; i < n; i++) {
    const e = mobs[i % mobs.length];
    party.push(createEnemyData(e.name, e.type, e.element, dungeonId));
  }
  return party;
}
