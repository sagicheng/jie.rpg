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
 * 按副本波次组装敌人阵容（共 7 波：4 普通 + 2 精英 + 1 BOSS）：
 *  - stage 1~4：本区域小怪（杂妖/恶妖）成组 2~3 只（每波独立一场战斗）
 *  - stage 5~6：本区域精英（妖将非Boss，无则最强恶妖）每波 2 只
 *  - stage 7：本区域 BOSS（isBoss/妖将妖王）+ 2~3 随从
 */
export function buildDungeonParty(dungeonId: number, stage: number): EnemyData[] {
  const cfg = ZONE_CONFIGS[dungeonId];
  const enemies = cfg?.enemies || [];

  // 第 7 波：区域 BOSS + 随从
  if (stage >= 7) {
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

  // 第 5~6 波：精英妖将（每波 2 只）
  if (stage >= 5) {
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

  // stage 1~4：普通妖群（每波 2~3 只）
  let mobs = enemies.filter((e) => e.type === '杂妖' || e.type === '恶妖');
  if (mobs.length === 0) mobs = [{ name: '副本虚', type: '杂妖' as const, element: '无', x: 0.5, y: 0.5 }];
  const n = 2 + Math.floor(Math.random() * 2); // 2~3
  const party: EnemyData[] = [];
  for (let i = 0; i < n; i++) {
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
  '第 1 波 · 普通妖群', '第 2 波 · 普通妖群', '第 3 波 · 普通妖群', '第 4 波 · 普通妖群',
  '第 5 波 · 精英妖将', '第 6 波 · 精英妖将',
  '第 7 波 · 区域 BOSS'];
const STAGE_DESCS = [
  '',
  '击败本波普通妖群（2~3 只），清剿后前往中央领取奖励。',
  '击败本波普通妖群（2~3 只），清剿后前往中央领取奖励。',
  '击败本波普通妖群（2~3 只），清剿后前往中央领取奖励。',
  '击败本波普通妖群（2~3 只），清剿后前往中央领取奖励。',
  '击败本波精英妖将（2 只），击破后前往中央领取奖励。',
  '击败本波精英妖将（2 只），击破后前往中央领取奖励。',
  '击败区域 BOSS（含随从），通关副本后可返回原地图。',
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
