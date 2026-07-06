/**
 * 消耗品效果系统 — 替代硬编码 +100HP
 * 支持HP/MP回复、状态解除、复活、临时buff
 */

import { PlayerStatus, applyStatusToPlayer, createPlayerStatus } from './StatusSystem';

/** 消耗品效果类型 */
export type ConsumableEffectType =
  | 'heal_hp'
  | 'heal_mp'
  | 'heal_both'
  | 'cure_status'
  | 'revive'
  | 'buff_temp'
  | 'full_heal';

export interface ConsumableEffect {
  type: ConsumableEffectType;
  hpAmount?: number;
  hpPercent?: number;   // 百分比回复 (基于maxHp)
  mpAmount?: number;
  mpPercent?: number;
  cureTypes?: string[]; // 可治愈的状态类型 (空=全解)
  buffStat?: string;     // buff属性 atk/def/matk/mdef/spd
  buffValue?: number;   // buff百分比
  buffTurns?: number;
  reviveHpPercent?: number;
}

/** 消耗品定义 */
export interface ConsumableDef {
  id: string;
  name: string;
  desc: string;
  effect: ConsumableEffect;
  buyPrice: number;
  sellPrice: number;
}

/** 全部消耗品定义 */
export const CONSUMABLES: Record<string, ConsumableDef> = {
  // ── HP回复 ──
  stop_blood_grass: {
    id: 'stop_blood_grass', name: '止血草', desc: '回复50HP',
    effect: { type: 'heal_hp', hpAmount: 50 },
    buyPrice: 10, sellPrice: 2,
  },
  medicine_pill_s: {
    id: 'medicine_pill_s', name: '伤药丸(小)', desc: '回复150HP',
    effect: { type: 'heal_hp', hpAmount: 150 },
    buyPrice: 30, sellPrice: 6,
  },
  medicine_pill_m: {
    id: 'medicine_pill_m', name: '伤药丸(中)', desc: '回复400HP',
    effect: { type: 'heal_hp', hpAmount: 400 },
    buyPrice: 80, sellPrice: 16,
  },
  medicine_pill_l: {
    id: 'medicine_pill_l', name: '伤药丸(大)', desc: '回复1000HP',
    effect: { type: 'heal_hp', hpAmount: 1000 },
    buyPrice: 200, sellPrice: 40,
  },
  medicine_pill_xl: {
    id: 'medicine_pill_xl', name: '伤药丸(特)', desc: '回复2500HP',
    effect: { type: 'heal_hp', hpAmount: 2500 },
    buyPrice: 500, sellPrice: 100,
  },

  // ── MP回复 ──
  spirit_water_s: {
    id: 'spirit_water_s', name: '灵力水(小)', desc: '回复30MP',
    effect: { type: 'heal_mp', mpAmount: 30 },
    buyPrice: 15, sellPrice: 3,
  },
  spirit_water_m: {
    id: 'spirit_water_m', name: '灵力水(中)', desc: '回复80MP',
    effect: { type: 'heal_mp', mpAmount: 80 },
    buyPrice: 40, sellPrice: 8,
  },
  spirit_water_l: {
    id: 'spirit_water_l', name: '灵力水(大)', desc: '回复200MP',
    effect: { type: 'heal_mp', mpAmount: 200 },
    buyPrice: 100, sellPrice: 20,
  },

  // ── HP+MP ──
  recovery_pill: {
    id: 'recovery_pill', name: '回复丹', desc: '回复300HP + 50MP',
    effect: { type: 'heal_both', hpAmount: 300, mpAmount: 50 },
    buyPrice: 60, sellPrice: 12,
  },
  full_recovery_pill: {
    id: 'full_recovery_pill', name: '全回复丹', desc: '完全回复HP和MP',
    effect: { type: 'full_heal' },
    buyPrice: 1000, sellPrice: 200,
  },

  // ── 状态解除 ──
  antidote: {
    id: 'antidote', name: '解毒药', desc: '解除中毒·寄生·灼烧',
    effect: { type: 'cure_status', cureTypes: ['poison', 'parasite', 'burn'] },
    buyPrice: 25, sellPrice: 5,
  },
  unseal_charm: {
    id: 'unseal_charm', name: '解缚符', desc: '解除束缚·冻结·眩晕·封印',
    effect: { type: 'cure_status', cureTypes: ['bind', 'freeze', 'stun', 'sealed'] },
    buyPrice: 35, sellPrice: 7,
  },
  purify_talisman: {
    id: 'purify_talisman', name: '净化符', desc: '解除全部异常状态',
    effect: { type: 'cure_status', cureTypes: [] },
    buyPrice: 80, sellPrice: 16,
  },

  // ── 复活 ──
  soul_revive: {
    id: 'soul_revive', name: '还魂符', desc: '战斗不能时以50%HP复活',
    effect: { type: 'revive', reviveHpPercent: 50 },
    buyPrice: 300, sellPrice: 60,
  },
  soul_revive_full: {
    id: 'soul_revive_full', name: '真·还魂符', desc: '战斗不能时以100%HP复活',
    effect: { type: 'revive', reviveHpPercent: 100 },
    buyPrice: 800, sellPrice: 160,
  },

  // ── 临时buff ──
  atk_elixir: {
    id: 'atk_elixir', name: '力量药剂', desc: '攻击力+20%(3回合)',
    effect: { type: 'buff_temp', buffStat: 'atk', buffValue: 0.20, buffTurns: 3 },
    buyPrice: 100, sellPrice: 20,
  },
  def_elixir: {
    id: 'def_elixir', name: '护壁药剂', desc: '防御力+20%(3回合)',
    effect: { type: 'buff_temp', buffStat: 'def', buffValue: 0.20, buffTurns: 3 },
    buyPrice: 100, sellPrice: 20,
  },
  spd_elixir: {
    id: 'spd_elixir', name: '迅捷药剂', desc: '速度+25%(3回合)',
    effect: { type: 'buff_temp', buffStat: 'spd', buffValue: 0.25, buffTurns: 3 },
    buyPrice: 120, sellPrice: 24,
  },
  matk_elixir: {
    id: 'matk_elixir', name: '灵击药剂', desc: '魔攻+20%(3回合)',
    effect: { type: 'buff_temp', buffStat: 'matk', buffValue: 0.20, buffTurns: 3 },
    buyPrice: 100, sellPrice: 20,
  },
};

/** 临时buff状态 (战斗内) */
export interface TempBuff {
  stat: string;
  value: number;
  turns: number;
}

/** 应用消耗品效果，返回日志消息 */
export function applyConsumable(
  effect: ConsumableEffect,
  context: {
    hp: number; maxHp: number;
    mp: number; maxMp: number;
    playerStatus: PlayerStatus;
    isDead: boolean;
  },
): { hp: number; mp: number; message: string; cured: boolean; revived: boolean; buff?: TempBuff } {
  let { hp, mp } = context;
  const { maxHp, maxMp, playerStatus, isDead } = context;
  let message = '';
  let cured = false;
  let revived = false;
  let buff: TempBuff | undefined;

  switch (effect.type) {
    case 'heal_hp': {
      const heal = effect.hpAmount || 0;
      hp = Math.min(hp + heal, maxHp);
      message = `回复 ${heal} HP`;
      break;
    }
    case 'heal_mp': {
      const heal = effect.mpAmount || 0;
      mp = Math.min(mp + heal, maxMp);
      message = `回复 ${heal} MP`;
      break;
    }
    case 'heal_both': {
      const hpHeal = effect.hpAmount || 0;
      const mpHeal = effect.mpAmount || 0;
      hp = Math.min(hp + hpHeal, maxHp);
      mp = Math.min(mp + mpHeal, maxMp);
      message = `回复 ${hpHeal} HP + ${mpHeal} MP`;
      break;
    }
    case 'full_heal': {
      hp = maxHp;
      mp = maxMp;
      message = 'HP·MP 完全回复';
      break;
    }
    case 'cure_status': {
      const types = effect.cureTypes || [];
      if (types.length === 0) {
        // 全解
        clearAllPlayerStatusInternal(playerStatus);
        cured = true;
        message = '全部异常状态已解除';
      } else {
        let curedList: string[] = [];
        for (const t of types) {
          if (cureOneStatus(playerStatus, t)) {
            curedList.push(t);
          }
        }
        cured = curedList.length > 0;
        message = cured ? `解除 ${curedList.length} 个异常状态` : '没有可解除的异常';
      }
      break;
    }
    case 'revive': {
      if (isDead) {
        hp = Math.round(maxHp * (effect.reviveHpPercent || 50) / 100);
        revived = true;
        message = `以 ${effect.reviveHpPercent}% HP 复活`;
      } else {
        // 活着时使用 → 转为HP回复
        const heal = Math.round(maxHp * 0.3);
        hp = Math.min(hp + heal, maxHp);
        message = `回复 ${heal} HP`;
      }
      break;
    }
    case 'buff_temp': {
      buff = {
        stat: effect.buffStat || 'atk',
        value: effect.buffValue || 0,
        turns: effect.buffTurns || 3,
      };
      const statName: Record<string, string> = {
        atk: '攻击', def: '防御', matk: '魔攻', mdef: '魔防', spd: '速度',
      };
      message = `${statName[buff.stat] || buff.stat}+${Math.round(buff.value * 100)}% (${buff.turns}回合)`;
      break;
    }
  }

  return { hp, mp, message, cured, revived, buff };
}

/** 治愈单个状态 */
function cureOneStatus(ps: PlayerStatus, type: string): boolean {
  switch (type) {
    case 'poison':   if (ps.poison > 0)   { ps.poison = 0; ps.poisonDmg = 0; return true; } break;
    case 'burn':     if (ps.burn > 0)     { ps.burn = 0; return true; } break;
    case 'parasite': if (ps.parasite > 0) { ps.parasite = 0; return true; } break;
    case 'freeze':   if (ps.freeze > 0)   { ps.freeze = 0; return true; } break;
    case 'stun':     if (ps.stun > 0)     { ps.stun = 0; return true; } break;
    case 'bind':     if (ps.bind > 0)     { ps.bind = 0; return true; } break;
    case 'slow':     if (ps.slow > 0)     { ps.slow = 0; return true; } break;
    case 'fear':     if (ps.fear > 0)     { ps.fear = 0; return true; } break;
    case 'atkDown':  if (ps.atkDown > 0)  { ps.atkDown = 0; return true; } break;
    case 'defDown':  if (ps.defDown > 0)  { ps.defDown = 0; return true; } break;
    case 'matkDown': if (ps.matkDown > 0) { ps.matkDown = 0; return true; } break;
    case 'taunt':    if (ps.taunt > 0)    { ps.taunt = 0; ps.tauntSourceIdx = -1; return true; } break;
    case 'sealed':   return false; // sealed 不在 PlayerStatus 里，由 BattleScene 管理
  }
  return false;
}

function clearAllPlayerStatusInternal(ps: PlayerStatus): void {
  ps.burn = 0; ps.freeze = 0; ps.poison = 0; ps.poisonDmg = 0; ps.parasite = 0;
  ps.slow = 0; ps.stun = 0; ps.bind = 0; ps.taunt = 0; ps.tauntSourceIdx = -1; ps.fear = 0;
  ps.atkDown = 0; ps.defDown = 0; ps.matkDown = 0;
  ps.playerShield = 0; ps.playerShieldTurns = 0;
  ps.regenAmount = 0; ps.regenTurns = 0;
}

/** 根据物品ID获取消耗品效果 (兼容旧物品没有effect的情况) */
export function getConsumableEffect(itemId: string, itemName?: string): ConsumableEffect | null {
  if (CONSUMABLES[itemId]) return CONSUMABLES[itemId].effect;
  // 旧物品名称匹配
  if (itemName) {
    for (const def of Object.values(CONSUMABLES)) {
      if (def.name === itemName) return def.effect;
    }
    // 止血草等旧名
    if (itemName.includes('止血') || itemName.includes('草药')) {
      return { type: 'heal_hp', hpAmount: 50 };
    }
    if (itemName.includes('药') || itemName.includes('丹')) {
      return { type: 'heal_hp', hpAmount: 100 };
    }
  }
  // 默认回退
  return { type: 'heal_hp', hpAmount: 100 };
}
