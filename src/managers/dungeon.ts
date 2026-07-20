/**
 * 副本客户端辅助（纯函数，无副作用）。
 *  - buildDungeonParty：按副本阶数 + 区域怪物表组装该阶敌人阵容（小怪/精英/BOSS），
 *    整组传给 BattleRoom 权威 spawn（与地图怪同款流程）。
 *  - buildClientBattleLoadout：组装玩家可用技能/鬼道/道具/真实属性，供战斗房间权威校验。
 */
import { ZONE_CONFIGS } from '../config/Zones';
import { createEnemyData, EnemyData } from './BattleData';
import { BOSS_CONFIG } from './BossMechanics';
import { Inventory } from './Inventory';
import { GameState } from './GameState';
import { getAvailableSkills } from './Skills';
import { Kido } from './Kido';
import { applyGuildStatBonus } from '../api/GuildSkills';
import type { ClientLoadout } from '../scenes/MultiBattleScene';

/** 组装玩家战斗负载（与 GameScene.buildBattleLoadout 同款，供副本战斗复用）。 */
export function buildClientBattleLoadout(): ClientLoadout {
  return {
    skills: getAvailableSkills(GameState.zanpakuto, GameState.element, GameState.hasShikai, GameState.hasBankai, false, false, false).map((s) => s.name),
    kidos: Kido.getActiveLearned(),
    items: Inventory.items.filter((i) => i.type === 'consumable'),
    playerStats: applyGuildStatBonus({
      hp: GameState.hp, maxHp: GameState.maxHp,
      mp: GameState.mp, maxMp: GameState.maxMp,
      atk: GameState.atk, def: GameState.def,
      matk: GameState.matk, mdef: GameState.mdef,
      spd: GameState.spd,
    }, GameState.guildSkills),
  };
}

/**
 * 按副本阶段组装敌人阵容（共 3 张镜像地图，各一场战斗）：
 *  - 阶段1（镜像地图1）：本区域小怪（杂妖/恶妖）成组 4 只
 *  - 阶段2（镜像地图2）：本区域精英（妖将，无则最强恶妖）2 只
 *  - 阶段3（镜像地图3）：本区域 BOSS（isBoss/妖将妖王）1 只
 */
export function buildDungeonParty(dungeonId: number, stage: number): EnemyData[] {
  const cfg = ZONE_CONFIGS[dungeonId];
  const enemies = cfg?.enemies || [];

  // 阶段3（镜像地图3）：区域 BOSS + 随从池（小怪/精英，实际7只由 buildEncounterParty 组装）
  if (stage >= 3) {
    const boss = enemies.find((e) => e.isBoss)
      || enemies.find((e) => e.type === '妖将' || e.type === '妖王')
      || { name: '副本守卫', type: '妖王' as const, element: '无', x: 0.5, y: 0.5 };
    const bossData = createEnemyData(boss.name, boss.type, boss.element, dungeonId);
    // 随从池：优先 BOSS_CONFIG retinue，无则用普通妖群
    const bcfg = BOSS_CONFIG[boss.name];
    let minionPool: EnemyData[] = [];
    if (bcfg?.retinue?.length) {
      minionPool = bcfg.retinue.map(r => createEnemyData(r.name, r.type, r.element, dungeonId));
    } else {
      const pool = enemies.filter(e => !e.isBoss && (e.type === '杂妖' || e.type === '恶妖'));
      if (pool.length === 0) pool.push({ name: '副本喽啰', type: '杂妖' as const, element: boss.element, x: 0.5, y: 0.5 });
      for (const e of pool.slice(0, 4)) minionPool.push(createEnemyData(e.name, e.type, e.element, dungeonId));
    }
    return [bossData, ...minionPool];
  }

  // 阶段2（镜像地图2）：精英妖将 2 只
  if (stage === 2) {
    let elites = enemies.filter((e) => e.type === '妖将' && !e.isBoss);
    if (elites.length === 0) elites = enemies.filter((e) => e.type === '恶妖');
    if (elites.length === 0) elites = [{ name: '副本精英', type: '恶妖' as const, element: '无', x: 0.5, y: 0.5 }];
    const party: EnemyData[] = [];
    for (let i = 0; i < 2; i++) {
      const e = elites[i % elites.length];
      party.push(createEnemyData(e.name, e.type, e.element, dungeonId));
    }
    return party;
  }

  // 阶段1（镜像地图1）：普通妖群 4 只（固定）
  let mobs = enemies.filter((e) => e.type === '杂妖' || e.type === '恶妖');
  if (mobs.length === 0) mobs = [{ name: '副本虚', type: '杂妖' as const, element: '无', x: 0.5, y: 0.5 }];
  const party: EnemyData[] = [];
  for (let i = 0; i < 4; i++) {
    const e = mobs[i % mobs.length];
    party.push(createEnemyData(e.name, e.type, e.element, dungeonId));
  }
  return party;
}

// ════════════════ 镜像地图方案：副本地图层视觉配置 ════════════════

export interface DungeonStageVisual {
  title: string;
  subtitle: string;
  groundColor: number;
  roadColor: number;
  treeColor: number;
  decorations: any[];
}

const STAGE_LABELS = ['',
  '镜像地图 1 · 普通妖群', '镜像地图 2 · 精英妖将', '镜像地图 3 · 区域 BOSS'];
const STAGE_DESCS = [
  '',
  '击败本区域的 4 只普通妖（杂妖/恶妖），清剿后前往中央领取奖励并进入镜像地图 2。',
  '击败本区域的 2 只精英妖将，击破后前往中央领取奖励并进入镜像地图 3。',
  '击败区域 BOSS，通关副本后可返回原地图。',
];

/**
 * 副本地图每层的视觉配置。复用对应区域的地面/道路/树木配色与装饰，
 * 仅叠加层标题与层描述，保持与原地图风格一致。
 */
export function getDungeonStageVisual(dungeonId: number, stage: number): DungeonStageVisual {
  const zone = ZONE_CONFIGS[dungeonId] || ZONE_CONFIGS[1];
  return {
    title: `副本 ${dungeonId} · ${zone.name} — ${STAGE_LABELS[stage] || ''}`,
    subtitle: STAGE_DESCS[stage] || '',
    groundColor: zone.groundColor,
    roadColor: zone.roadColor,
    treeColor: zone.treeColor,
    decorations: zone.decorations || [],
  };
}
