/**
 * GameState 战斗属性模块 — HP/MP/ATK/DEF 等、加点、recalcStats、gainExp
 */
import { STAT_PER_POINT, POINTS_PER_LEVEL, ZANPAKUTO_GROWTH } from '../../core/config';
import { Inventory } from '../items/Inventory';
import { Kido } from '../combat/Kido';
import { computeSetBonuses } from '../items/SetSystem';
import { computePetAura } from '../pet/PetSystem';
import { expForLevel } from '../combat/BattleData';
import { Constructor } from '../../core/types';

export function GameStateStatsMixin<TBase extends Constructor>(Base: TBase) {
  return class GameStateStats extends Base {
    // 加点字段
    allocatedHP = 0; allocatedMP = 0; allocatedATK = 0;
    allocatedDEF = 0; allocatedMATK = 0; allocatedMDEF = 0; allocatedSPD = 0;

    // 战斗属性
    hp = 100; maxHp = 100; mp = 50; maxMp = 50;
    atk = 10; def = 8; matk = 10; mdef = 8; spd = 10;
    zanpakuto = '';
    element = '';
    statusAcc = 0;
    statusRes = 0;

    // 灵宠（由 worldSync 重建；recalcStats 据此算光环加成）
    pets: any[] = [];

    resetStats(): void {
      this.hp = 100; this.maxHp = 100; this.mp = 50; this.maxMp = 50;
      this.atk = 10; this.def = 8; this.matk = 10; this.mdef = 8; this.spd = 10;
      this.allocatedHP = 0; this.allocatedMP = 0; this.allocatedATK = 0;
      this.allocatedDEF = 0; this.allocatedMATK = 0; this.allocatedMDEF = 0; this.allocatedSPD = 0;
      this.zanpakuto = ''; this.element = '';
      this.statusAcc = 0; this.statusRes = 0;
    }// 火/风/水/土

    recalcStats(): void {
      const g = this.zanpakuto ? (ZANPAKUTO_GROWTH[this.zanpakuto] || {}) : {};
      const gt = (k: string) => (g as any)[k] || 1.0;
      const eqBody = Inventory.getBodyEquipStats();
      const eqJewel = Inventory.getJewelryStats();
      const kp = Kido.getPassiveStats();
      const fbMult = (this as any).hasUnlock && (this as any).hasUnlock('fullbring') ? 1.10 : 1.0;
      const sfMult = (this as any).hasUnlock && (this as any).hasUnlock('schrift') ? 1.10 : 1.0;

      this.maxHp = 100 + Math.round(this.allocatedHP * STAT_PER_POINT.HP * gt('HP'))
        + Math.round((eqBody.hp || 0) * fbMult) + Math.round((eqJewel.hp || 0) * sfMult);
      this.maxHp = Math.round(this.maxHp * (1 + (kp.hp_pct || 0)));

      this.maxMp = 50 + Math.round(this.allocatedMP * STAT_PER_POINT.MP * gt('MP'))
        + Math.round((eqBody.mp || 0) * fbMult) + Math.round((eqJewel.mp || 0) * sfMult);
      this.maxMp = Math.round(this.maxMp * (1 + (kp.mp_pct || 0)));

      this.atk = 10 + Math.round(this.allocatedATK * STAT_PER_POINT.ATK * gt('ATK'))
        + Math.round((eqBody.atk || 0) * fbMult) + Math.round((eqJewel.atk || 0) * sfMult);

      this.def = 8 + Math.round(this.allocatedDEF * STAT_PER_POINT.DEF * gt('DEF'))
        + Math.round((eqBody.def || 0) * fbMult) + Math.round((eqJewel.def || 0) * sfMult);
      this.def = Math.round(this.def * (1 + (kp.def_pct || 0)));

      this.matk = 10 + Math.round(this.allocatedMATK * STAT_PER_POINT.MATK * gt('MATK'))
        + Math.round((eqBody.matk || 0) * fbMult) + Math.round((eqJewel.matk || 0) * sfMult);
      this.matk = Math.round(this.matk * (1 + (kp.matk_pct || 0)));

      this.mdef = 8 + Math.round(this.allocatedMDEF * STAT_PER_POINT.MDEF * gt('MDEF'))
        + Math.round((eqBody.mdef || 0) * fbMult) + Math.round((eqJewel.mdef || 0) * sfMult);

      this.spd = 10 + Math.round(this.allocatedSPD * STAT_PER_POINT.SPD * gt('SPD'))
        + Math.round((eqBody.spd || 0) * fbMult) + Math.round((eqJewel.spd || 0) * sfMult);
      this.spd = Math.round(this.spd * (1 + (kp.spd_pct || 0)));

      // 称号全属性加成（仅当前装备称号生效）
      const titlePct = (this as any).getActiveTitleAllStatsPct ? (this as any).getActiveTitleAllStatsPct() : 0;
      if (titlePct > 0) {
        this.maxHp = Math.round(this.maxHp * (1 + titlePct));
        this.maxMp = Math.round(this.maxMp * (1 + titlePct));
        this.atk = Math.round(this.atk * (1 + titlePct));
        this.def = Math.round(this.def * (1 + titlePct));
        this.matk = Math.round(this.matk * (1 + titlePct));
        this.mdef = Math.round(this.mdef * (1 + titlePct));
        this.spd = Math.round(this.spd * (1 + titlePct));
      }

      // 套装加成（% 类，叠加在称号之后；联机下 equipment 由 worldSync 重建并带 set 字段）
      const setBonus = computeSetBonuses(Inventory.equipment);
      if (setBonus.hp) this.maxHp = Math.round(this.maxHp * (1 + setBonus.hp));
      if (setBonus.mp) this.maxMp = Math.round(this.maxMp * (1 + setBonus.mp));
      if (setBonus.atk) this.atk = Math.round(this.atk * (1 + setBonus.atk));
      if (setBonus.def) this.def = Math.round(this.def * (1 + setBonus.def));
      if (setBonus.matk) this.matk = Math.round(this.matk * (1 + setBonus.matk));
      if (setBonus.mdef) this.mdef = Math.round(this.mdef * (1 + setBonus.mdef));
      if (setBonus.spd) this.spd = Math.round(this.spd * (1 + setBonus.spd));

      // 灵宠光环（出战灵宠按比例提升玩家属性；联机下 pets 由 worldSync 重建并带 active 标记）
      const petsArr = (this as any).pets as any[] | undefined;
      const activePet = petsArr ? petsArr.find((p: any) => p.active) : null;
      if (activePet) {
        const aura = computePetAura(activePet);
        if (aura) {
          this.maxHp += aura.hp;
          this.atk += aura.atk;
          this.def += aura.def;
          this.matk += aura.matk;
          this.mdef += aura.mdef;
          this.spd += aura.spd;
        }
      }

      this.statusAcc = (g as any).statusAcc || 0;
      this.hp = Math.min(this.hp || this.maxHp, this.maxHp);
      this.mp = Math.min(this.mp || this.maxMp, this.maxMp);
    }

    gainExp(amount: number): boolean {
      let leveled = false;
      const self = this as any;
      self.exp += amount;
      while (self.level < 70 && self.exp >= expForLevel(self.level + 1)) {
        self.exp -= expForLevel(self.level + 1);
        self.level++;
        self.statPoints += POINTS_PER_LEVEL;
        this.maxHp += 15;
        this.maxMp += 5;
        this.hp = this.maxHp;
        this.mp = this.maxMp;
        leveled = true;
        Kido.addPoints(1);
        this.recalcStats();
      }
      return leveled;
    }

    /** 检查是否有待处理的升级（用于外部经验注入后触发） */
    checkLevelUp(): void {
      this.gainExp(0);
    }
  };
}
