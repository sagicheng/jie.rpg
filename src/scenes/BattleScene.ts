import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
import { GameState } from '../systems/GameState';
import { EnemyData, calcDamage, calcMagicDamage, expForLevel, generateLoot } from '../systems/BattleData';
import { Inventory } from '../systems/Inventory';
import { getAvailableSkills } from '../systems/Skills';
import { Kido, KIDO_NODES, KidoNode } from '../systems/Kido';
import {
  EnemyStatus, PlayerStatus, StatusType,
  createEnemyStatus, createPlayerStatus,
  applyStatusToEnemy, applyStatusToPlayer,
  isEnemyBlocked, doesEnemySkipFromFear,
  getEnemyAtkMod, getEnemyDefMod, getEnemySpdMod,
  getEnemyStatusIcons, getPlayerStatusIcons,
  clearAllEnemyStatus, clearAllPlayerStatus,
} from '../systems/StatusSystem';
import { applyConsumable, getConsumableEffect, CONSUMABLES, ConsumableEffect, TempBuff } from '../systems/ConsumableSystem';
import { getStatusHitRate, getEnemyElementInfo, getElementMultiplier, generateNamedLoot, NAMED_ENEMIES } from '../systems/BestiaryData';
import {
  getSkillMechanics, applyConditionalDamage, hasIgnoreDef, getHpCost,
  getMultiHitCount, getLifestealPct, getMpStealPct, getSpeedScaling,
  applyDebuffFromMechanics, getBuffsFromMechanics, getShieldFromMechanics,
  isCleanseSkill, getAoEHealAmount, getReflectInfo, getMarkInfo, getMarkDetonateMult,
  MarkState,
} from '../systems/SkillMechanics';

type BattlePhase = 'intro' | 'playerTurn' | 'targetSelect' | 'enemyTurn' | 'executing' | 'victory' | 'defeat';

/** 鬼道subtype → 图鉴抗性表key (中文状态名) */
const SUBTYPE_TO_STATUS_NAME: Record<string, string> = {
  seal: '束缚', slow: '减速', bind: '束缚', freeze: '冻结',
  stun: '眩晕', poison: '中毒', burn: '灼烧', parasitic: '寄生',
  fear: '恐惧', atk_down: '攻降', def_down: '防降', spirit_drain: '灵消',
};

/**
 * 计算状态命中率 (0~1)
 * 优先查具名敌人的per-status抗性，无则fallback到enemy.statusRes
 */
function calcStatusHitRate(baseRate: number, subtype: string, enemyName: string, fallbackRes: number): number {
  const statusName = SUBTYPE_TO_STATUS_NAME[subtype];
  let resist: number;
  if (statusName) {
    // 具名抗性返回的是"抗性值"(0~1)，1=免疫
    // getStatusHitRate返回的是"命中率"(1-抗性)
    // 转换回抗性值
    const hitRate = getStatusHitRate(statusName, enemyName);
    resist = 1 - hitRate;
  } else {
    resist = fallbackRes;
  }
  return Math.min(0.95, Math.max(0.05, baseRate + GameState.statusAcc - resist));
}

export class BattleScene extends Phaser.Scene {
  // 多敌人数据
  private enemies: EnemyData[] = [];
  private enemySprites: Phaser.GameObjects.Sprite[] = [];
  private enemyHpBars: Phaser.GameObjects.Graphics[] = [];
  private enemyNameTexts: Phaser.GameObjects.Text[] = [];
  private enemyTypeTexts: Phaser.GameObjects.Text[] = [];
  private enemyStatuses: EnemyStatus[] = [];
  private selectedEnemyIndex = 0;
  private enemyActQueue: number[] = [];   // 本轮待行动敌人队列
  private enemyPhaseActive = false;        // 防重入守卫
  private playerActed = false; // 玩家是否已在本轮行动
  private templateEnemy!: EnemyData;
  private shortcutKeys: Phaser.Input.Keyboard.Key[] = []; // 键盘快捷键引用(清理用)
  private battleZone = 1;  // 当前战斗所在区域(调试用)

  private phase: BattlePhase = 'intro';
  private logText!: Phaser.GameObjects.Text;
  private playerHpBar!: Phaser.GameObjects.Graphics;
  private playerMpBar!: Phaser.GameObjects.Graphics;
  private commandContainer!: Phaser.GameObjects.Container | null;
  private subMenuContainer!: Phaser.GameObjects.Container | null;
  private enemyRefs: any[] = [];
  private playerStatus!: PlayerStatus;
  private isDefending = false;

  // 技能特殊机制状态
  private tempBuffs: TempBuff[] = [];     // 消耗品临时buff
  private marks: MarkState[] = [];         // 每个敌人的标记状态
  private reflectPct = 0;                  // 当前反伤比例
  private reflectTurns = 0;                 // 反伤持续回合

  // 变身状态
  private bankaiActive = false;
  private bankaiTurnsLeft = 0;
  private bankaiUsed = false;
  private hollowActive = false;
  private hollowTurnsLeft = 0;
  private hollowUsed = false;
  private hellActive = false;
  private hellTurnsLeft = 0;
  private hellUsed = false;

  private playerHp: number;
  private playerMaxHp: number;
  private playerMp: number;
  private playerMaxMp: number;
  private playerAtk: number;
  private playerDef: number;
  private playerMatk: number;
  private playerMdef: number;
  private playerSpd: number;

  constructor() {
    super({ key: 'BattleScene' });
    const gs = GameState;
    this.playerMaxHp = gs.maxHp;
    this.playerHp = gs.hp;
    this.playerMaxMp = gs.maxMp;
    this.playerMp = gs.mp;
    this.playerAtk = gs.atk;
    this.playerDef = gs.def;
    this.playerMatk = gs.matk;
    this.playerMdef = gs.mdef;
    this.playerSpd = gs.spd;
  }

  init(data: { template: EnemyData; enemyRef?: any; zone?: number }): void {
    this.phase = 'intro';
    this.selectedEnemyIndex = 0;
    this.playerActed = false;
    this.enemyActQueue = [];
    this.enemyPhaseActive = false;
    this.commandContainer = null;
    this.subMenuContainer = null;
    this.isDefending = false;
    this.shortcutKeys = [];
    this.bankaiActive = false; this.bankaiTurnsLeft = 0; this.bankaiUsed = false;
    this.hollowActive = false; this.hollowTurnsLeft = 0; this.hollowUsed = false;
    this.hellActive = false; this.hellTurnsLeft = 0; this.hellUsed = false;
    this.enemySprites = [];
    this.enemyHpBars = [];
    this.enemyNameTexts = [];
    this.enemyTypeTexts = [];

    // 根据区域难度随机生成1-8只敌人
    const zone = typeof data.zone === 'number' ? data.zone : (GameState.zone || 1);
    this.battleZone = zone;
    this.templateEnemy = data.template;
    // Boss战强制1只，普通战随机1-8只
    const isBossBattle = data.template.type === '妖将' || data.template.type === '妖王';
    const count = isBossBattle ? 1 : this.randomEnemyCount(zone);

    // 复制模板生成多只敌人（每只独立血量）
    this.enemies = [];
    this.enemyRefs = data.enemyRef ? [data.enemyRef] : [];
    for (let i = 0; i < count; i++) {
      const clone = { ...data.template };
      clone.hp = data.template.maxHp;
      clone.maxHp = data.template.maxHp;
      this.enemies.push(clone);
    }

    // Boss机制状态重置
    (this as any)._bossRegenUsed = false;

    // 记录图鉴遭遇
    this.enemies.forEach(e => GameState.recordEncounter(e.name));

    this.enemyStatuses = this.enemies.map(() => createEnemyStatus());
    this.playerStatus = createPlayerStatus();
    this.marks = this.enemies.map(() => ({ active: false, turns: 0, detonateMult: 0 }));
    this.tempBuffs = [];
    this.reflectPct = 0;
    this.reflectTurns = 0;
    this.playerMaxHp = GameState.maxHp; this.playerHp = GameState.hp;
    this.playerMaxMp = GameState.maxMp; this.playerMp = GameState.mp;
    this.playerAtk = GameState.atk; this.playerDef = GameState.def;
    this.playerMatk = GameState.matk; this.playerMdef = GameState.mdef;
    this.playerSpd = GameState.spd;
  }

  private randomEnemyCount(zone: number): number {
    let min: number, max: number;
    if (zone <= 3)      { min = 1; max = 2; }
    else if (zone <= 6) { min = 1; max = 4; }
    else if (zone <= 9) { min = 2; max = 6; }
    else if (zone <= 12){ min = 3; max = 7; }
    else if (zone <= 15){ min = 4; max = 8; }
    else if (zone <= 18){ min = 5; max = 8; }
    else                { min = 6; max = 8; }
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  create(): void {
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x0a0a1a, 0x0a0a1a, 0x1a0a0a, 0x1a0a0a, 1);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // 根据敌人数量计算位置
    const count = this.enemies.length;
    const positions = this.getEnemyPositions(count);

    this.enemies.forEach((enemy, i) => {
      const pos = positions[i];
      const tex = enemy.type === '妖将' || enemy.type === '妖王' ? 'enemy_boss' : 'enemy_elite';
      const scale = count <= 4 ? 2.2 : 1.6; // 多怪时缩小
      const sprite = this.add.sprite(pos.x, pos.y, tex).setScale(scale);
      this.enemySprites.push(sprite);

      const nameOffset = count <= 4 ? -70 : -48;
      const nameSize = count <= 4 ? '13px' : '11px';
      const nameText = this.add.text(pos.x, pos.y + nameOffset, enemy.name, {
        fontSize: nameSize, color: '#ff6666', fontFamily: 'serif', fontStyle: 'bold', padding: { y: 2 },
      }).setOrigin(0.5);
      this.enemyNameTexts.push(nameText);

      // 敌人类型标签
      const typeOffset = count <= 4 ? -54 : -36;
      const typeText = this.add.text(pos.x, pos.y + typeOffset, enemy.type, {
        fontSize: '8px', color: '#994444', padding: { y: 1 },
      }).setOrigin(0.5);
      this.enemyTypeTexts.push(typeText);

      // 独立血条
      const hpBar = this.add.graphics();
      this.enemyHpBars.push(hpBar);
    });

    // 我方
    const player = this.add.sprite(GAME_WIDTH / 2, 460, 'player').setScale(2.5).setFlipX(true);
    this.add.text(GAME_WIDTH / 2, 530, GameState.playerName, {
      fontSize: '14px', color: '#88aacc', padding: { y: 2 },
    }).setOrigin(0.5);

    this.playerHpBar = this.add.graphics();
    this.playerMpBar = this.add.graphics();

    // 战斗日志
    this.logText = this.add.text(GAME_WIDTH / 2, 360, '', {
      fontSize: '14px', color: '#ccaa88',
      wordWrap: { width: 600 }, align: 'center', padding: { y: 2 },
    }).setOrigin(0.5);

    // 开场动画
    this.spritesFadeIn(() => {
      const names = this.enemies.map(e => e.name).join('、');
      this.enemyNameTexts.forEach(t => t.setVisible(false));
      this.enemyTypeTexts.forEach(t => t.setVisible(false));
      // 检测Boss
      const boss = this.enemies.find(e => e.type === '妖将' || e.type === '妖王');
      if (boss) {
        // Boss战特殊演出
        const bossBanner = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 100, '⚠ BOSS战 ⚠', {
          fontSize: '36px', color: '#ff3333', fontStyle: 'bold',
          backgroundColor: '#1a0000dd', padding: { x: 40, y: 16 },
        }).setOrigin(0.5).setDepth(500).setAlpha(0);
        const bossName = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, boss.name, {
          fontSize: '28px', color: '#ffcc44', fontStyle: 'bold',
          backgroundColor: '#000000dd', padding: { x: 30, y: 10 },
        }).setOrigin(0.5).setDepth(500).setAlpha(0);
        this.tweens.add({ targets: [bossBanner, bossName], alpha: 1, duration: 400, onComplete: () => {
          this.tweens.add({ targets: [bossBanner, bossName], alpha: 0, duration: 600, delay: 1400, onComplete: () => {
            bossBanner.destroy(); bossName.destroy();
          } });
        } });
        this.logText.setText(`⚔ ${names} 出现了！`);
        this.time.delayedCall(2200, () => {
          this.enemyNameTexts.forEach(t => t.setVisible(true));
          this.enemyTypeTexts.forEach(t => t.setVisible(true));
          this.startTurn();
        });
      } else {
        this.logText.setText(`⚔ ${names} 出现了！  [区域${this.battleZone} · ${this.enemies.length}只]`);
        this.time.delayedCall(1000, () => {
          this.enemyNameTexts.forEach(t => t.setVisible(true));
          this.enemyTypeTexts.forEach(t => t.setVisible(true));
          this.startTurn();
        });
      }
    });
  }

  /** 飘流幻境式双排站位 */
  private getEnemyPositions(count: number): { x: number; y: number }[] {
    const cx = GAME_WIDTH / 2;
    const positions: { x: number; y: number }[] = [];

    if (count <= 4) {
      // 单排
      const spread = Math.min(560, (count - 1) * 160);
      const startX = cx - spread / 2;
      const y = 200;
      for (let i = 0; i < count; i++) {
        positions.push({ x: startX + i * (spread / Math.max(1, count - 1)), y });
      }
    } else {
      // 双排：前排靠近玩家，后排远离
      const backCount = Math.ceil(count / 2);
      const frontCount = count - backCount;
      const spreadB = Math.min(560, (backCount - 1) * 150);
      const spreadF = Math.min(560, (frontCount - 1) * 150);
      const startBX = cx - spreadB / 2;
      const startFX = cx - spreadF / 2;

      for (let i = 0; i < backCount; i++) {
        positions.push({ x: startBX + i * (spreadB / Math.max(1, backCount - 1)), y: 150 });
      }
      for (let i = 0; i < frontCount; i++) {
        positions.push({ x: startFX + i * (spreadF / Math.max(1, frontCount - 1)), y: 230 });
      }
    }
    return positions;
  }

  /** 敌人精灵淡入 */
  private spritesFadeIn(onDone: () => void): void {
    const scale = this.enemies.length <= 4 ? 2.2 : 1.6;
    this.enemySprites.forEach(s => s.setScale(0.1).setAlpha(0));
    let done = 0;
    this.enemySprites.forEach((s, i) => {
      this.tweens.add({
        targets: s,
        alpha: 1, scaleX: scale, scaleY: scale,
        duration: 500, delay: i * 150,
        onComplete: () => { done++; if (done >= this.enemySprites.length) onDone(); },
      });
    });
  }

  // ════════════════════ 回合控制 ════════════════════

  private startTurn(): void {
    const fastestEnemySpd = Math.max(...this.enemies.map(e => e.hp > 0 ? e.spd : 0));
    const playerGoesFirst = this.playerSpd >= fastestEnemySpd;
    this.phase = playerGoesFirst ? 'playerTurn' : 'enemyTurn';
    if (playerGoesFirst) {
      this.logText.setText('You act first!');
      this.time.delayedCall(500, () => this.showPlayerCommands());
    } else {
      const fastest = this.enemies.find(e => e.spd === fastestEnemySpd && e.hp > 0);
      this.logText.setText((fastest?.name || 'Enemy') + ' acts first!');
      this.playerActed = true;
      this.startEnemyPhase();
    }
  }

  /** 玩家行动完毕，进入敌人阶段 */
  private startEnemyPhase(): void {
    // ★ 防重入守卫：如果敌人阶段正在进行，直接返回
    if (this.enemyPhaseActive) return;
    this.enemyPhaseActive = true;
    this.phase = 'enemyTurn';
    this.tickKidoStatus();
    if (this.allEnemiesDead()) { this.enemyPhaseActive = false; this.victory(); return; }
    // 构建本轮行动队列（仅存活敌人）
    this.enemyActQueue = this.getAliveEnemyIndices();
    this.processEnemyQueue();
  }

  /** 从队列中取出下一个敌人行动 */
  private processEnemyQueue(): void {
    // 跳过已死亡敌人
    while (this.enemyActQueue.length > 0 && this.enemies[this.enemyActQueue[0]].hp <= 0) {
      this.enemyActQueue.shift();
    }

    if (this.enemyActQueue.length === 0) {
      // 全部敌人行动完毕 → 玩家回合
      this.enemyPhaseActive = false;
      this.playerActed = false;
      if (this.allEnemiesDead()) { this.victory(); return; }
      this.logText.setText('Your turn!');
      this.time.delayedCall(300, () => this.showPlayerCommands());
      return;
    }

    const idx = this.enemyActQueue.shift()!;
    this.time.delayedCall(300, () => {
      if (this.playerHp <= 0) { this.enemyPhaseActive = false; this.defeat(); return; }
      // 再次确认敌人存活（可能被毒杀死）
      if (this.enemies[idx].hp > 0) {
        this.processEnemyAction(idx);
      }
      this.time.delayedCall(1200, () => {
        if (this.playerHp <= 0) { this.enemyPhaseActive = false; this.defeat(); return; }
        this.processEnemyQueue();
      });
    });
  }

  private processEnemyAction(index: number): void {
    const enemy = this.enemies[index];
    if (enemy.hp <= 0) return;
    const ks = this.enemyStatuses[index];
    const sprite = this.enemySprites[index];

    // 状态检定：冻结/束缚/封印/眩晕 → 无法行动
    if (isEnemyBlocked(ks)) {
      this.logText.setText(`${enemy.name} 被控制，无法行动！${getEnemyStatusIcons(ks)}`);
      return;
    }
    // 恐惧 → 30%概率跳过
    if (doesEnemySkipFromFear(ks)) {
      this.logText.setText(`${enemy.name} 陷入恐惧，不敢行动！`);
      return;
    }

    // Boss特殊机制：大虚·亚丘卡斯 HP<40%时再生（1次）
    if (enemy.name === '大虚·亚丘卡斯' && !(this as any)._bossRegenUsed && enemy.hp > 0 && enemy.hp <= enemy.maxHp * 0.4) {
      const heal = Math.round(enemy.maxHp * 0.20);
      enemy.hp += heal;
      if (enemy.hp > enemy.maxHp) enemy.hp = enemy.maxHp;
      (this as any)._bossRegenUsed = true;
      this.logText.setText(`⚠ ${enemy.name} 发动【再生】！回复 ${heal} HP！`);
      this.flashEnemySprite(sprite);
      this.time.delayedCall(1200, () => this.processEnemyQueue());
      return;
    }

    const canUseSkill = enemy.skills.length > 0 && ks.sealed <= 0 && Math.random() < 0.4;
    const skill = canUseSkill ? enemy.skills[Math.floor(Math.random() * enemy.skills.length)] : enemy.skills[0];
    let power = skill.power * getEnemyAtkMod(ks); // 攻降/减速影响伤害

    const isPhysical = skill.damageType !== 'magical';
    const defVal = hasIgnoreDef([]) ? 0 : this.playerDef; // 敌人暂无视防御
    const { damage, crit } = isPhysical
      ? calcDamage(enemy.atk, defVal, power)
      : calcMagicDamage(enemy.matk, this.playerMdef, power);
    let actualDamage = damage;

    // 防御减伤
    if (this.isDefending) actualDamage = Math.round(actualDamage * 0.2);

    // 护盾抵消
    if (this.playerStatus.playerShield > 0) {
      if (this.playerStatus.playerShield >= actualDamage) {
        this.playerStatus.playerShield -= actualDamage; actualDamage = 0;
      } else {
        actualDamage -= this.playerStatus.playerShield; this.playerStatus.playerShield = 0;
      }
    }

    this.playerHp -= actualDamage;
    if (this.playerHp < 0) this.playerHp = 0;

    // 反伤
    let reflectMsg = '';
    if (actualDamage > 0 && this.reflectPct > 0 && this.reflectTurns > 0) {
      const reflectDmg = Math.round(actualDamage * this.reflectPct);
      enemy.hp -= reflectDmg;
      if (enemy.hp <= 0) { enemy.hp = 0; this.removeDeadEnemy(index); }
      reflectMsg = ` [反伤${reflectDmg}]`;
      this.flashEnemySprite(sprite);
    }

    this.logText.setText(`${enemy.name} 使用 ${skill.name}！${crit ? '暴击！' : ''}造成 ${actualDamage} 伤害！${reflectMsg}`);
    this.flashPlayer();
    if (sprite) this.tweens.add({ targets: sprite, tint: 0xffffff, duration: 150, yoyo: true });
  }


  // ════════════════════ 目标选择 ════════════════════

  private startTargetSelect(action: string, extra?: any): void {
    const alive = this.getAliveEnemyIndices();
    if (alive.length <= 1) {
      this.selectedEnemyIndex = alive[0] || 0;
      this.executeAction(action, extra);
      return;
    }

    this.phase = 'targetSelect';
    this.clearCommands();
    this.logText.setText('点击敌人选择目标  |  ESC返回');

    // 高亮可选敌人
    this.enemySprites.forEach((sprite, i) => {
      if (this.enemies[i].hp <= 0) return;
      sprite.setInteractive({ useHandCursor: true });
      sprite.setTint(0xcccccc);
    });

    const escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    const cancel = () => {
      escKey.removeAllListeners();
      this.enemySprites.forEach(s => { s.clearTint(); s.disableInteractive(); });
      this.showPlayerCommands();
    };
    escKey.on('down', cancel);

    // 点击敌人确认目标
    this.enemySprites.forEach((sprite, i) => {
      if (this.enemies[i].hp <= 0) return;
      sprite.once('pointerdown', () => {
        escKey.removeAllListeners();
        this.enemySprites.forEach(s => { s.clearTint(); s.disableInteractive(); });
        this.selectedEnemyIndex = i;
        this.executeAction(action, extra);
      });
    });
  }

  private executeAction(action: string, extra?: any): void {
    if (action === 'attack') this.playerAttack();
    else if (action === 'skill') this.executePlayerSkill(extra.name, extra.power, extra.mp, extra.damageType, extra.skillType, extra.statusEffect);
    else if (action === 'kido') this.executeKido(extra);
  }

  private getAliveEnemyIndices(): number[] {
    return this.enemies.map((e, i) => e.hp > 0 ? i : -1).filter(i => i >= 0);
  }

  private getFirstAliveEnemyIndex(): number {
    return this.enemies.findIndex(e => e.hp > 0);
  }

  /** 敌人死亡时消失 */
  private removeDeadEnemy(index: number): void {
    const sprite = this.enemySprites[index];
    const name = this.enemyNameTexts[index];
    const type = this.enemyTypeTexts[index];
    const bar = this.enemyHpBars[index];
    if (sprite && sprite.visible) {
      this.tweens.add({ targets: sprite, alpha: 0, scaleX: 0, scaleY: 0, duration: 400, onComplete: () => sprite.setVisible(false) });
    }
    if (name && name.visible) {
      this.tweens.add({ targets: name, alpha: 0, duration: 300, onComplete: () => name.setVisible(false) });
    }
    if (type && type.visible) {
      this.tweens.add({ targets: type, alpha: 0, duration: 300, onComplete: () => type.setVisible(false) });
    }
    if (bar) bar.clear();
  }

  private allEnemiesDead(): boolean {
    return this.enemies.every(e => e.hp <= 0);
  }

  /** 获取当前选择的敌人 */
  private get enemy(): EnemyData { return this.enemies[this.selectedEnemyIndex]; }

  // ════════════════════ 技能菜单 ════════════════════

  private showSkillMenu(): void {
    this.clearSubMenu();
    this.clearCommands();
    this.subMenuContainer = this.add.container(0, 0).setDepth(51);
    const skills = getAvailableSkills(
      GameState.zanpakuto, GameState.element, GameState.hasShikai, GameState.hasBankai, this.bankaiActive, this.hollowActive, this.hellActive
    );
    if (skills.length === 0) {
      this.logText.setText('没有可用技能');
      this.time.delayedCall(800, () => this.showPlayerCommands());
      return;
    }
    const btnW = 260, btnH = 44;
    skills.forEach((sk, i) => {
      const y = GAME_HEIGHT - 120 - i * (btnH + 6);
      const canUse = this.playerMp >= sk.mp;
      const bg = this.add.graphics();
      bg.fillStyle(canUse ? 0x2a2a4e : 0x1a1a2e, 0.9);
      bg.fillRoundedRect(GAME_WIDTH / 2 - btnW / 2, y, btnW, btnH, 8);
      bg.lineStyle(1, canUse ? 0x556688 : 0x333344, 0.5);
      bg.strokeRoundedRect(GAME_WIDTH / 2 - btnW / 2, y, btnW, btnH, 8);
      this.subMenuContainer!.add(bg);
      const phaseTag = sk.phase === '始解' ? '[始]' : sk.phase === '卍解' ? '[卍]' : '';
      const typeTag = sk.skillType === 'heal' ? '[愈]' : sk.skillType === 'control' ? '[控]' : (sk.damageType === 'physical' ? '[物]' : '[魔]');
      const txtColor = sk.skillType === 'heal' ? '#88ff88' : sk.skillType === 'control' ? '#88aaff' : '#cce';
      const txt = this.add.text(GAME_WIDTH / 2, y + 10, `${phaseTag}${typeTag}${sk.name}  MP${sk.mp}`, {
        fontSize: '14px', color: canUse ? txtColor : '#556', fontStyle: 'bold', padding: { y: 2 },
      }).setOrigin(0.5);
      this.subMenuContainer!.add(txt);
      const descText = sk.statusEffect
        ? `${sk.desc} (基础${Math.round(sk.statusEffect.rate * 100)}% + 命中加成)`
        : sk.desc;
      this.subMenuContainer!.add(this.add.text(GAME_WIDTH / 2, y + 32, descText, {
        fontSize: '10px', color: sk.statusEffect ? '#aaddff' : '#778',
        wordWrap: { width: 500 }, padding: { y: 2 },
      }).setOrigin(0.5));
      if (canUse) {
        const zone = this.add.zone(GAME_WIDTH / 2, y + btnH / 2, btnW, btnH).setInteractive({ useHandCursor: true });
        zone.on('pointerdown', () => {
          this.clearSubMenu();
          if (sk.skillType === 'heal') {
            this.executePlayerSkill(sk.name, sk.power, sk.mp, sk.damageType, sk.skillType, sk.statusEffect);
          } else {
            this.startTargetSelect('skill', { name: sk.name, power: sk.power, mp: sk.mp, damageType: sk.damageType, skillType: sk.skillType, statusEffect: sk.statusEffect });
          }
        });
        this.subMenuContainer!.add(zone);
      }
    });
    const backY = GAME_HEIGHT - 120 - skills.length * (btnH + 6) - 6;
    const backText = this.add.text(GAME_WIDTH / 2, backY, '← 返回', {
      fontSize: '14px', color: '#888', padding: { y: 2 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backText.on('pointerdown', () => { this.clearSubMenu(); this.showPlayerCommands(); });
    this.subMenuContainer!.add(backText);
  }

  // ════════════════════ 鬼道菜单 ════════════════════

  private showKidoMenu(): void {
    this.clearSubMenu();
    this.clearCommands();
    this.subMenuContainer = this.add.container(0, 0).setDepth(51);
    const equippedSkills = Kido.getActiveLearned();
    if (equippedSkills.length === 0) {
      this.logText.setText('没有学习鬼道技能');
      this.time.delayedCall(800, () => this.showPlayerCommands());
      return;
    }
    const btnW = 300, btnH = 44;
    equippedSkills.forEach((sk, i) => {
      const y = GAME_HEIGHT - 120 - i * (btnH + 6);
      const mp = Kido.getNodeMp(sk.id);
      const canUse = this.playerMp >= mp;
      const healType = sk.effect.type === 'heal' || sk.effect.type === 'shield' || sk.effect.type === 'revive';
      const bg = this.add.graphics();
      bg.fillStyle(canUse ? 0x2a1a4e : 0x1a1a2e, 0.9);
      bg.fillRoundedRect(GAME_WIDTH / 2 - btnW / 2, y, btnW, btnH, 8);
      bg.lineStyle(1, canUse ? 0x8866cc : 0x333344, 0.5);
      bg.strokeRoundedRect(GAME_WIDTH / 2 - btnW / 2, y, btnW, btnH, 8);
      this.subMenuContainer!.add(bg);
      const schoolTag = sk.school === 'hado' ? '[破]' : sk.school === 'bakudo' ? '[缚]' : '[回]';
      const kidoName = sk.number ? `${sk.number}·${sk.name}` : sk.name;
      const txt = this.add.text(GAME_WIDTH / 2, y + 10, `${schoolTag}${kidoName}  MP${mp}`, {
        fontSize: '14px', color: canUse ? '#ccbbee' : '#556', fontStyle: 'bold', padding: { y: 2 },
      }).setOrigin(0.5);
      this.subMenuContainer!.add(txt);
      this.subMenuContainer!.add(this.add.text(GAME_WIDTH / 2, y + 32, sk.desc, {
        fontSize: '10px', color: '#887799',
        wordWrap: { width: 500 }, padding: { y: 2 },
      }).setOrigin(0.5));
      if (canUse) {
        const zone = this.add.zone(GAME_WIDTH / 2, y + btnH / 2, btnW, btnH).setInteractive({ useHandCursor: true });
        zone.on('pointerdown', () => {
          this.clearSubMenu();
          if (healType) {
            this.executeKido(sk);
          } else {
            this.startTargetSelect('kido', sk);
          }
        });
        this.subMenuContainer!.add(zone);
      }
    });
    const backY = GAME_HEIGHT - 120 - equippedSkills.length * (btnH + 6) - 6;
    const backText = this.add.text(GAME_WIDTH / 2, backY, '← 返回', {
      fontSize: '14px', color: '#888', padding: { y: 2 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backText.on('pointerdown', () => { this.clearSubMenu(); this.showPlayerCommands(); });
    this.subMenuContainer!.add(backText);
  }

  // ════════════════════ 鬼道执行 ════════════════════

  private executeKido(skill: KidoNode): void {
    this.playerActed = true;
    this.phase = 'executing';
    const mp = Kido.getNodeMp(skill.id);
    this.playerMp -= mp;
    this.showChantEffect(skill);

    const execDelay = 600;
    const execute = () => {
      let msg = '';
      const pts = Kido.getPoints(skill.id);
      const scalePerPoint = (skill.effect as any).scalePerPoint || 0.20;
      const enemy = this.enemy;
      const ks = this.enemyStatuses[this.selectedEnemyIndex];

      switch (skill.effect.type) {
        case 'damage': {
          const power = Kido.getNodePower(skill.id);
          const { damage, crit } = calcMagicDamage(this.playerMatk, enemy.mdef, power);
          const dmg = this.hellActive ? damage * 2 : damage;
          enemy.hp -= dmg;
          if (enemy.hp <= 0) { enemy.hp = 0; this.removeDeadEnemy(this.selectedEnemyIndex); }
          msg = `${skill.name}！${crit ? '暴击！' : ''}造成 ${dmg} 伤害！`;
          if (this.hellActive) msg += ' (狱解×2)';
          this.flashEnemySprite(this.enemySprites[this.selectedEnemyIndex]);
          break;
        }
        case 'control': {
          const turns = skill.effect.turns;
          const baseRate = skill.effect.rate || 0.6;
          const finalRate = calcStatusHitRate(baseRate, skill.effect.subtype, enemy.name, enemy.statusRes);
          const hit = Math.random() < finalRate;
          if (hit) {
            const sub = skill.effect.subtype;
            const statusMsg = applyStatusToEnemy(ks, sub, turns, enemy.maxHp);
            msg = `${skill.name}！${enemy.name} ${statusMsg}！`;
          } else { msg = `${skill.name}！但 ${enemy.name} 抵抗了...`; }
          break;
        }
        case 'heal': {
          const base = skill.effect.amount || 80;
          const heal = Math.round(base * (1 + (pts - 1) * scalePerPoint));
          this.playerHp = Math.min(this.playerHp + heal, this.playerMaxHp);
          msg = `${skill.name}！回复 ${heal} HP！`;
          if (skill.id === 'kaido_t1_02') {
            clearAllPlayerStatus(this.playerStatus);
            msg += ' 异常状态已解除！';
          }
          if (skill.id === 'kaido_t3_01') {
            clearAllPlayerStatus(this.playerStatus);
            msg = `${skill.name}！全队HP大回复，异常状态全部清除！`;
          }
          if (skill.id === 'kaido_t2_02') {
            const regenAmt = Math.round(heal / 3);
            this.playerStatus.regenAmount = regenAmt;
            this.playerStatus.regenTurns = 3;
            msg = `${skill.name}！获得持续回复(3回合，每回合${regenAmt}HP)！`;
          }
          break;
        }
        case 'shield': {
          const shieldAmount = Math.round(this.playerDef * 2 * (1 + (pts - 1) * (skill.effect.scalePerPoint || 0.25)));
          this.playerStatus.playerShield = shieldAmount;
          this.playerStatus.playerShieldTurns = skill.effect.turns;
          msg = `${skill.name}！获得 ${shieldAmount} 点护盾！`;
          break;
        }
        case 'revive': {
          const hp = Math.round(this.playerMaxHp * skill.effect.hpPercent / 100);
          this.playerHp = hp;
          msg = `${skill.name}！以 ${skill.effect.hpPercent}% HP 复活！`;
          break;
        }
        default: msg = `${skill.name}！`;
      }

      this.logText.setText(msg);
      if (this.allEnemiesDead()) { this.time.delayedCall(800, () => this.victory()); }
      else { this.time.delayedCall(1200, () => this.startEnemyPhase()); }
    };
    this.time.delayedCall(execDelay, execute);
  }

  private showChantEffect(skill: KidoNode): void {
    const schoolNames: Record<string, string> = { hado: '破道', bakudo: '缚道', kaido: '回道' };
    const schoolName = schoolNames[skill.school] || '';
    const kidoName = skill.number ? `${schoolName}${skill.number}·${skill.name}` : skill.name;
    const chantText = `咏唱——${kidoName}！`;
    const chant = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 100, chantText, {
      fontSize: '28px',
      color: skill.school === 'hado' ? '#cc4444' : skill.school === 'bakudo' ? '#8888ff' : '#44cc44',
      fontFamily: 'serif', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 4,
      padding: { y: 3 },
    }).setOrigin(0.5).setDepth(200).setAlpha(0).setScale(0.5);
    this.tweens.add({
      targets: chant, alpha: 1, scaleX: 1, scaleY: 1, duration: 300, ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({ targets: chant, alpha: 0, y: GAME_HEIGHT / 2 - 140, duration: 400, delay: 200, onComplete: () => chant.destroy() });
      },
    });
    const flashColor = skill.school === 'hado' ? 0xff3333 : skill.school === 'bakudo' ? 0x6666ff : 0x33cc33;
    this.cameras.main.flash(400, (flashColor >> 16) & 0xff, (flashColor >> 8) & 0xff, flashColor & 0xff);
  }

  // ════════════════════ 玩家行动 ════════════════════

  private playerAttack(): void {
    this.playerActed = true;
    this.phase = 'executing';
    this.clearCommands();
    const enemy = this.enemy;
    // 元素克制：玩家element vs 敌人弱点/抗性
    const eInfo = getEnemyElementInfo(enemy.name);
    const elemMult = GameState.element
      ? getElementMultiplier(GameState.element, eInfo.element, eInfo.weakness, eInfo.resist)
      : 1.0;
    const { damage, crit } = calcDamage(this.playerAtk, enemy.def, 1.0, elemMult);
    const dmg = this.hellActive ? damage * 2 : damage;
    let logMsg = crit ? `暴击！造成 ${dmg} 伤害！` : `攻击 ${enemy.name}！造成 ${dmg} 伤害！`;
    if (elemMult > 1.0) logMsg += ' [克制]';
    else if (elemMult < 1.0) logMsg += ' [抵抗]';
    if (this.hellActive) logMsg += ' (狱解×2)';
    this.logText.setText(logMsg);
    this.flashEnemySprite(this.enemySprites[this.selectedEnemyIndex]);
    enemy.hp -= dmg;
    if (enemy.hp <= 0) { enemy.hp = 0; this.removeDeadEnemy(this.selectedEnemyIndex); }
    if (this.allEnemiesDead()) { this.time.delayedCall(800, () => this.victory()); }
    else { this.time.delayedCall(1000, () => this.startEnemyPhase()); }
  }

  private executePlayerSkill(
    name: string, power: number, mpCost: number,
    damageType: 'physical' | 'magical' = 'physical',
    skillType?: 'damage' | 'heal' | 'control',
    statusEffect?: { subtype: string; turns: number; rate: number },
  ): void {
    this.playerActed = true;
    this.phase = 'executing';
    this.playerMp -= mpCost;

    const mechanics = getSkillMechanics(name);

    // HP消耗 (如斩月·黑牙)
    const hpCost = getHpCost(mechanics, this.playerHp);
    if (hpCost) {
      this.playerHp = Math.max(1, this.playerHp - hpCost.cost);
    }

    // ── 治疗技能 ──
    if (skillType === 'heal') {
      const aoeHeal = getAoEHealAmount(mechanics, this.playerMatk);
      if (aoeHeal > 0) {
        // 全队回复 (单人时=自身)
        const heal = aoeHeal;
        this.playerHp = Math.min(this.playerHp + heal, this.playerMaxHp);
        let msg = `${name}！回复 ${heal} HP！`;
        if (isCleanseSkill(mechanics)) {
          clearAllPlayerStatus(this.playerStatus);
          msg += ' 异常状态已清除！';
        }
        this.logText.setText(msg);
        this.time.delayedCall(1000, () => this.startEnemyPhase());
        return;
      }
      // 原始单体治疗逻辑
      const heal = Math.round(this.playerMatk * power);
      this.playerHp = Math.min(this.playerHp + heal, this.playerMaxHp);
      let msg = `${name}！回复 ${heal} HP！`;
      if (isCleanseSkill(mechanics)) {
        clearAllPlayerStatus(this.playerStatus);
        msg += ' 异常状态已清除！';
      }
      this.logText.setText(msg);
      this.time.delayedCall(1000, () => this.startEnemyPhase());
      return;
    }

    // ── 控制技能 ──
    if (skillType === 'control' && statusEffect) {
      this.doApplyStatus(name, statusEffect.subtype, statusEffect.turns, statusEffect.rate);
      return;
    }

    // ── 自身buff/shield/reflect (在伤害前应用) ──
    const buffs = getBuffsFromMechanics(mechanics);
    for (const b of buffs) {
      this.tempBuffs.push({ stat: b.stat, value: b.value, turns: b.turns });
    }
    const shieldInfo = getShieldFromMechanics(mechanics, this.playerDef);
    if (shieldInfo) {
      this.playerStatus.playerShield = shieldInfo.amount;
      this.playerStatus.playerShieldTurns = shieldInfo.turns;
    }
    const reflectInfo = getReflectInfo(mechanics);
    if (reflectInfo) {
      this.reflectPct = reflectInfo.pct;
      this.reflectTurns = reflectInfo.turns;
    }

    // ── 伤害技能 ──
    const enemy = this.enemy;
    const enemyIdx = this.selectedEnemyIndex;
    const ks = this.enemyStatuses[enemyIdx];
    const isPhysical = damageType === 'physical';

    // 多段攻击
    const hitCount = getMultiHitCount(mechanics);
    // 条件增伤
    const condMult = applyConditionalDamage(mechanics, ks);
    // 速度缩放
    const spdMult = getSpeedScaling(mechanics, enemy.spd, this.playerSpd);
    // HP消耗增伤
    const hpCostMult = hpCost ? hpCost.dmgMult : 1.0;
    // 无视防御
    const ignoreDef = hasIgnoreDef(mechanics);
    // 标记引爆
    const detonateMult = this.marks[enemyIdx]?.active ? getMarkDetonateMult(mechanics) : 0;

    // 应用临时buff到属性
    const buffMods = this.getBuffMods();

    let totalDamage = 0;
    let anyCrit = false;
    const perHitPower = power; // 每段倍率不变
    const atkVal = isPhysical
      ? Math.round(this.playerAtk * buffMods.atk)
      : Math.round(this.playerMatk * buffMods.matk);
    const defVal = ignoreDef ? 0 : (isPhysical ? enemy.def : enemy.mdef);
    const defMod = ignoreDef ? 0.0 : 0.4;

    for (let h = 0; h < hitCount; h++) {
      let hitDmg = isPhysical
        ? atkVal * perHitPower - enemy.def * defMod
        : atkVal * perHitPower - enemy.mdef * defMod;
      if (hitDmg < atkVal * perHitPower * 0.1) hitDmg = atkVal * perHitPower * 0.1;
      hitDmg *= condMult * spdMult * hpCostMult;
      if (detonateMult > 0) hitDmg *= detonateMult;
      // 元素克制（物理技能用玩家element，魔法技能也用element）
      const eInfo = getEnemyElementInfo(enemy.name);
      const elemMult = GameState.element
        ? getElementMultiplier(GameState.element, eInfo.element, eInfo.weakness, eInfo.resist)
        : 1.0;
      hitDmg *= elemMult;
      const crit = Math.random() < 0.05;
      if (crit) { hitDmg *= 1.5; anyCrit = true; }
      hitDmg *= 0.9 + Math.random() * 0.2;
      totalDamage += Math.round(hitDmg);
    }

    // 狱解倍率
    if (this.hellActive) totalDamage = Math.round(totalDamage * 2);

    // 标记消耗
    if (detonateMult > 0 && this.marks[enemyIdx]) {
      this.marks[enemyIdx].active = false;
      this.marks[enemyIdx].turns = 0;
    }

    enemy.hp -= totalDamage;
    if (enemy.hp <= 0) { enemy.hp = 0; this.removeDeadEnemy(enemyIdx); }

    // 吸血
    const lifestealPct = getLifestealPct(mechanics);
    let lifeMsg = '';
    if (lifestealPct > 0 && totalDamage > 0) {
      const heal = Math.round(totalDamage * lifestealPct);
      this.playerHp = Math.min(this.playerHp + heal, this.playerMaxHp);
      lifeMsg = ` [吸血${heal}]`;
    }

    // MP吸取
    const mpStealPct = getMpStealPct(mechanics);
    let mpMsg = '';
    if (mpStealPct > 0) {
      const stolen = Math.round(enemy.maxHp * mpStealPct * 0.1); // MP量基于敌人HP
      this.playerMp = Math.min(this.playerMp + stolen, this.playerMaxMp);
      mpMsg = ` [吸灵${stolen}]`;
    }

    // 敌人debuff (来自机制)
    let debuffMsg = '';
    if (enemy.hp > 0) {
      const debuffs = applyDebuffFromMechanics(mechanics, ks, enemy.statusRes);
      if (debuffs.length > 0) debuffMsg = ` [${debuffs.join('·')}]`;
    }

    // 原始statusEffect (来自SkillData)
    let statusMsg = '';
    if (enemy.hp > 0 && statusEffect) {
      const finalRate = calcStatusHitRate(statusEffect.rate, statusEffect.subtype, enemy.name, enemy.statusRes);
      if (Math.random() < finalRate) {
        this.applySkillStatus(statusEffect.subtype, statusEffect.turns);
        const effectNames: Record<string, string> = {
          seal: '封印', slow: '减速', bind: '禁锢', freeze: '冻结',
          stun: '眩晕', poison: '中毒',
        };
        statusMsg = ` [${effectNames[statusEffect.subtype] || statusEffect.subtype}]`;
      }
    }

    // 标记施加
    const markInfo = getMarkInfo(mechanics);
    let markMsg = '';
    if (markInfo && enemy.hp > 0) {
      this.marks[enemyIdx] = { active: true, turns: markInfo.turns, detonateMult: markInfo.detonateMult };
      markMsg = ` [标记${markInfo.turns}T]`;
    }

    let msg = `${name}！${hitCount > 1 ? `${hitCount}连击！` : ''}${anyCrit ? '暴击！' : ''}造成 ${totalDamage} 伤害！`;
    if (hpCost) msg += ` [消耗HP${hpCost.cost}]`;
    if (this.hellActive) msg += ' (狱解×2)';
    msg += lifeMsg + mpMsg + debuffMsg + statusMsg + markMsg;
    this.logText.setText(msg);

    this.flashEnemySprite(this.enemySprites[enemyIdx]);
    if (this.allEnemiesDead()) { this.time.delayedCall(800, () => this.victory()); }
    else { this.time.delayedCall(1000, () => this.startEnemyPhase()); }
  }

  /** 获取临时buff对属性的修正倍率 */
  private getBuffMods(): { atk: number; def: number; matk: number; mdef: number; spd: number } {
    let atk = 1, def = 1, matk = 1, mdef = 1, spd = 1;
    for (const b of this.tempBuffs) {
      switch (b.stat) {
        case 'atk':  atk += b.value; break;
        case 'def':   def += b.value; break;
        case 'matk': matk += b.value; break;
        case 'mdef': mdef += b.value; break;
        case 'spd':  spd += b.value; break;
        case 'crit': /* 暴击暂不在此处理 */ break;
      }
    }
    return { atk, def, matk, mdef, spd };
  }

  private doApplyStatus(name: string, subtype: string, turns: number, rate: number): void {
    const enemy = this.enemy;
    const finalRate = Math.min(0.95, Math.max(0.05, rate + GameState.statusAcc - enemy.statusRes));
    const hit = Math.random() < finalRate;
    if (hit) {
      this.applySkillStatus(subtype, turns);
      const effectNames: Record<string, string> = {
        seal: '封印', slow: '减速', bind: '禁锢', freeze: '冻结', stun: '眩晕', poison: '中毒',
        burn: '灼烧', fear: '恐惧', taunt: '嘲讽', atkDown: '攻击降低', defDown: '防御降低', mpDrain: '灵消',
      };
      const ks = this.enemyStatuses[this.selectedEnemyIndex];
      this.logText.setText(`${name}！${enemy.name} ${effectNames[subtype] || subtype} ${turns} 回合！${subtype === 'poison' ? ` (每回合${ks.poisonDmg})` : ''}`);
    } else { this.logText.setText(`${name}！但 ${enemy.name} 抵抗了...`); }
    this.time.delayedCall(1200, () => this.startEnemyPhase());
  }

  private applySkillStatus(subtype: string, turns: number): void {
    const ks = this.enemyStatuses[this.selectedEnemyIndex];
    applyStatusToEnemy(ks, subtype, turns, this.enemy.maxHp);
  }

  private useItem(): void {
    this.playerActed = true;
    const consumables = Inventory.items.filter(i => i.type === 'consumable');
    if (consumables.length === 0) {
      this.logText.setText('暂无可用道具');
      this.time.delayedCall(800, () => this.showPlayerCommands());
      return;
    }
    this.clearCommands();
    this.clearSubMenu();
    this.subMenuContainer = this.add.container(0, 0).setDepth(51);
    const btnW = 260, btnH = 44;
    consumables.forEach((item, i) => {
      const y = GAME_HEIGHT - 120 - i * (btnH + 6);
      // 获取消耗品效果
      const effect = getConsumableEffect(item.id, item.name);
      const def = item.id ? CONSUMABLES[item.id] : null;
      const descText = def ? def.desc : (effect?.type === 'heal_hp' ? `回复${effect.hpAmount}HP` : (item.desc || '消耗品'));

      const bg = this.add.graphics();
      bg.fillStyle(0x2a2a4e, 0.9); bg.fillRoundedRect(GAME_WIDTH / 2 - btnW / 2, y, btnW, btnH, 8);
      bg.lineStyle(1, 0x556688, 0.5); bg.strokeRoundedRect(GAME_WIDTH / 2 - btnW / 2, y, btnW, btnH, 8);
      this.subMenuContainer!.add(bg);
      this.subMenuContainer!.add(this.add.text(GAME_WIDTH / 2, y + 12,
        `${item.name} ×${item.quantity}`, { fontSize: '14px', color: '#88ee88', fontStyle: 'bold', padding: { y: 2 } }).setOrigin(0.5));
      this.subMenuContainer!.add(this.add.text(GAME_WIDTH / 2, y + 30, descText, {
        fontSize: '10px', color: '#778',
        wordWrap: { width: 500 }, padding: { y: 2 },
      }).setOrigin(0.5));
      const zone = this.add.zone(GAME_WIDTH / 2, y + btnH / 2, btnW, btnH).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => {
        this.clearSubMenu();
        this.phase = 'executing';

        // 应用消耗品效果
        const effectiveEffect = effect || { type: 'heal_hp' as const, hpAmount: 100 };
        const result = applyConsumable(effectiveEffect, {
          hp: this.playerHp,
          maxHp: this.playerMaxHp,
          mp: this.playerMp,
          maxMp: this.playerMaxMp,
          playerStatus: this.playerStatus,
          isDead: this.playerHp <= 0,
        });
        this.playerHp = result.hp;
        this.playerMp = result.mp;

        // 临时buff
        if (result.buff) {
          this.tempBuffs.push({ ...result.buff });
        }

        // 消耗
        item.quantity--;
        if (item.quantity <= 0) Inventory.items = Inventory.items.filter(it => it !== item);

        this.logText.setText(`使用 ${item.name}！${result.message}`);
        this.time.delayedCall(1000, () => this.startEnemyPhase());
      });
      this.subMenuContainer!.add(zone);
    });
    const backY = GAME_HEIGHT - 120 - consumables.length * (btnH + 6) - 6;
    const backText = this.add.text(GAME_WIDTH / 2, backY, '← 返回', {
      fontSize: '14px', color: '#888', padding: { y: 2 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backText.on('pointerdown', () => { this.clearSubMenu(); this.showPlayerCommands(); });
    this.subMenuContainer!.add(backText);
  }

  private playerDefend(): void {
    this.playerActed = true;
    this.phase = 'executing';
    this.clearCommands();
    this.isDefending = true;
    this.logText.setText('防御！受到的伤害减少80%。');
    this.time.delayedCall(1000, () => this.startEnemyPhase());
  }

  // ════════════════════ 变身系统 ════════════════════

  private activateBankai(): void {
    this.playerActed = true;
    if (this.bankaiUsed || this.bankaiActive) return;
    this.phase = 'executing';
    this.clearCommands(); this.clearSubMenu();
    this.bankaiActive = true; this.bankaiTurnsLeft = 5; this.bankaiUsed = true;
    this.playerAtk = Math.round(this.playerAtk * 1.3);
    this.playerDef = Math.round(this.playerDef * 1.3);
    this.playerMatk = Math.round(this.playerMatk * 1.3);
    this.playerMdef = Math.round(this.playerMdef * 1.3);
    this.playerSpd = Math.round(this.playerSpd * 1.3);
    this.logText.setText('卍 解！全属性大幅提升（5回合）！');
    this.cameras.main.flash(600, 0, 100, 200);
    this.cameras.main.shake(300, 0.01);
    this.time.delayedCall(1500, () => this.startEnemyPhase());
  }

  private activateHollow(): void {
    this.playerActed = true;
    if (this.hollowUsed || this.hollowActive) return;
    this.phase = 'executing';
    this.clearCommands(); this.clearSubMenu();
    this.hollowActive = true; this.hollowTurnsLeft = 4; this.hollowUsed = true;
    GameState.statusRes += 0.30;
    this.playerMaxMp = Math.round(this.playerMaxMp * 1.5);
    this.playerMp = this.playerMaxMp;
    this.logText.setText('虚 化！异常抗性+30% · MP上限激增！');
    this.cameras.main.flash(400, 200, 50, 50);
    this.time.delayedCall(1500, () => this.startEnemyPhase());
  }

  private activateHell(): void {
    this.playerActed = true;
    if (this.hellUsed || this.hellActive) return;
    this.phase = 'executing';
    this.clearCommands(); this.clearSubMenu();
    this.hellActive = true; this.hellTurnsLeft = 3; this.hellUsed = true;
    this.logText.setText('狱 解！业火焚身——伤害倍增！');
    this.cameras.main.flash(500, 180, 0, 0);
    this.cameras.main.shake(400, 0.015);
    this.time.delayedCall(1500, () => this.startEnemyPhase());
  }



  private showPlayerCommands(): void {
    this.phase = 'playerTurn';
    this.playerActed = false;
    this.clearCommands();
    this.isDefending = false;
    this.selectedEnemyIndex = this.getFirstAliveEnemyIndex();
    // ★ 不在此处 tickKidoStatus —— 只在敌人阶段开始时tick一次
    if (this.allEnemiesDead()) { this.victory(); return; }

    this.commandContainer = this.add.container(0, 0).setDepth(50);
    const hasBankaiUnlocked = GameState.hasBankai;
    const hasHollowUnlocked = GameState.hasUnlock('hollow');
    const hasHellUnlocked = GameState.hasUnlock('hell');
    const extraBtns = (hasBankaiUnlocked ? 1 : 0) + (hasHollowUnlocked ? 1 : 0) + (hasHellUnlocked ? 1 : 0);
    const btnCount = 5 + extraBtns;
    const btnW = 96, btnH = 36, gap = 4;
    const totalW = btnW * btnCount + gap * (btnCount - 1);
    const startX = (GAME_WIDTH - totalW) / 2;
    const btnY = GAME_HEIGHT - 70;
    const hasKido = Kido.getActiveLearned().length > 0;
    const canBankai = hasBankaiUnlocked && !this.bankaiUsed && !this.bankaiActive;
    const canHollow = hasHollowUnlocked && !this.hollowUsed && !this.hollowActive;
    const canHell = hasHellUnlocked && !this.hellUsed && !this.hellActive;

    const cmds: { label: string; action: () => void; disabled?: boolean }[] = [
      { label: '[1]Atk', action: () => this.startTargetSelect('attack') },
      { label: '[2]Skill', action: () => this.showSkillMenu() },
      { label: '[3]Kido', action: () => this.showKidoMenu(), disabled: !hasKido },
      { label: '[4]Item', action: () => this.useItem() },
      { label: '[5]Def', action: () => this.playerDefend() },
    ];
    if (hasBankaiUnlocked) cmds.push({ label: this.bankaiActive ? 'Bankai(' + this.bankaiTurnsLeft + ')' : (this.bankaiUsed ? 'Bankai-' : 'Bankai'), action: () => this.activateBankai(), disabled: !canBankai });
    if (hasHollowUnlocked) cmds.push({ label: this.hollowActive ? 'Hollow(' + this.hollowTurnsLeft + ')' : (this.hollowUsed ? 'Hollow-' : 'Hollow'), action: () => this.activateHollow(), disabled: !canHollow });
    if (hasHellUnlocked) cmds.push({ label: this.hellActive ? 'Hell(' + this.hellTurnsLeft + ')' : (this.hellUsed ? 'Hell-' : 'Hell'), action: () => this.activateHell(), disabled: !canHell });

    const shortcuts = [Phaser.Input.Keyboard.KeyCodes.ONE, Phaser.Input.Keyboard.KeyCodes.TWO,
      Phaser.Input.Keyboard.KeyCodes.THREE, Phaser.Input.Keyboard.KeyCodes.FOUR,
      Phaser.Input.Keyboard.KeyCodes.FIVE, Phaser.Input.Keyboard.KeyCodes.SIX];
    shortcuts.forEach((keyCode, i) => {
      const key = this.input.keyboard!.addKey(keyCode);
      key.once('down', () => { if (this.phase !== 'playerTurn') return; const cmd = cmds[i]; if (cmd && !cmd.disabled) { cmd.action(); } });
      this.shortcutKeys.push(key);
    });

    cmds.forEach((cmd, i) => {
      const bx = startX + i * (btnW + gap);
      const isDisabled = cmd.disabled === true;
      const bg = this.add.graphics();
      bg.fillStyle(isDisabled ? 0x1a1a2e : 0x2a2a4e, 0.9);
      bg.fillRoundedRect(bx, btnY, btnW, btnH, 8);
      bg.lineStyle(1, isDisabled ? 0x333344 : 0x556688, 0.5);
      bg.strokeRoundedRect(bx, btnY, btnW, btnH, 8);
      this.commandContainer!.add(bg);
      const txt = this.add.text(bx + btnW / 2, btnY + btnH / 2, cmd.label, { fontSize: '14px', color: isDisabled ? '#444' : '#cce', padding: { y: 2 } }).setOrigin(0.5);
      this.commandContainer!.add(txt);
      if (isDisabled) return;
      const zone = this.add.zone(bx + btnW / 2, btnY + btnH / 2, btnW, btnH).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => { bg.clear(); bg.fillStyle(0x3a3a6e, 1); bg.fillRoundedRect(bx, btnY, btnW, btnH, 8); bg.lineStyle(2, 0x7799cc, 1); bg.strokeRoundedRect(bx, btnY, btnW, btnH, 8); });
      zone.on('pointerout', () => { bg.clear(); bg.fillStyle(0x2a2a4e, 0.9); bg.fillRoundedRect(bx, btnY, btnW, btnH, 8); bg.lineStyle(1, 0x556688, 0.5); bg.strokeRoundedRect(bx, btnY, btnW, btnH, 8); });
      zone.on('pointerdown', cmd.action);
      this.commandContainer!.add(zone);
    });
  }

  private tickKidoStatus(): void {
    const ps = this.playerStatus;

    // ── 玩家状态tick ──
    if (ps.playerShieldTurns > 0) {
      ps.playerShieldTurns--;
      if (ps.playerShieldTurns <= 0) ps.playerShield = 0;
    }
    if (ps.regenTurns > 0) {
      this.playerHp = Math.min(this.playerHp + ps.regenAmount, this.playerMaxHp);
      ps.regenTurns--;
      if (ps.regenTurns <= 0) ps.regenAmount = 0;
    }
    // 灼烧 (玩家)
    if (ps.burn > 0) {
      const dmg = Math.round(this.playerMaxHp * 0.05);
      this.playerHp = Math.max(0, this.playerHp - dmg);
      ps.burn--;
    }
    // 中毒 (玩家)
    if (ps.poison > 0) {
      const dmg = ps.poisonDmg || Math.round(this.playerMaxHp * 0.03);
      this.playerHp = Math.max(0, this.playerHp - dmg);
      this.playerMp = Math.max(0, this.playerMp - Math.round(this.playerMaxMp * 0.03));
      ps.poison--;
      if (ps.poison <= 0) ps.poisonDmg = 0;
    }
    // 寄生 (玩家)
    if (ps.parasite > 0) {
      const dmg = Math.round(this.playerMaxHp * 0.05);
      this.playerHp = Math.max(0, this.playerHp - dmg);
      ps.parasite--;
    }
    // 灵消 (玩家MP持续损失)
    if (ps.mpDrain > 0) {
      const drain = Math.round(this.playerMaxMp * 0.10);
      this.playerMp = Math.max(0, this.playerMp - drain);
      ps.mpDrain--;
    }
    // 其他玩家状态递减
    if (ps.freeze > 0) ps.freeze--;
    if (ps.slow > 0) ps.slow--;
    if (ps.stun > 0) ps.stun--;
    if (ps.bind > 0) ps.bind--;
    if (ps.taunt > 0) { ps.taunt--; if (ps.taunt <= 0) ps.tauntSourceIdx = -1; }
    if (ps.fear > 0) ps.fear--;
    if (ps.atkDown > 0) ps.atkDown--;
    if (ps.defDown > 0) ps.defDown--;

    // ── 临时buff tick ──
    this.tempBuffs.forEach(b => b.turns--);
    this.tempBuffs = this.tempBuffs.filter(b => b.turns > 0);

    // ── 反伤 tick ──
    if (this.reflectTurns > 0) {
      this.reflectTurns--;
      if (this.reflectTurns <= 0) this.reflectPct = 0;
    }

    // ── 标记 tick ──
    this.marks.forEach(m => {
      if (m.active) {
        m.turns--;
        if (m.turns <= 0) { m.active = false; m.detonateMult = 0; }
      }
    });

    // ── 敌人状态tick ──
    this.enemies.forEach((enemy, i) => {
      const ks = this.enemyStatuses[i];
      if (enemy.hp <= 0) return;

      // 灼烧
      if (ks.burn > 0) {
        enemy.hp -= Math.round(enemy.maxHp * 0.05);
        ks.burn--;
      }
      // 中毒
      if (ks.poison > 0) {
        enemy.hp -= ks.poisonDmg;
        ks.poison--;
        if (ks.poison <= 0) ks.poisonDmg = 0;
      }
      // 寄生
      if (ks.parasite > 0) {
        enemy.hp -= Math.round(enemy.maxHp * 0.05);
        ks.parasite--;
      }
      // 灵消 (敌人MP损失——简化为伤害)
      if (ks.mpDrain > 0) {
        ks.mpDrain--;
      }
      // 其他状态递减
      if (ks.freeze > 0) { ks.freeze--; ks.frozen = ks.freeze; }
      if (ks.slow > 0) { ks.slow--; ks.slowed = ks.slow; }
      if (ks.stun > 0) ks.stun--;
      if (ks.bind > 0) { ks.bind--; ks.bound = ks.bind; }
      if (ks.sealed > 0) ks.sealed--;
      if (ks.taunt > 0) ks.taunt--;
      if (ks.fear > 0) ks.fear--;
      if (ks.atkDown > 0) ks.atkDown--;
      if (ks.defDown > 0) ks.defDown--;

      // 死亡检定（可能被毒/灼烧/寄生杀死）
      if (enemy.hp <= 0) { enemy.hp = 0; this.removeDeadEnemy(i); }
    });

    // ── 变身tick (原有逻辑) ──
    if (this.bankaiActive && this.bankaiTurnsLeft > 0) {
      this.bankaiTurnsLeft--;
      if (this.bankaiTurnsLeft <= 0) {
        this.bankaiActive = false;
        this.playerAtk = Math.round(GameState.atk * 0.8);
        this.playerDef = Math.round(GameState.def * 0.8);
        this.playerMatk = Math.round(GameState.matk * 0.8);
        this.playerMdef = Math.round(GameState.mdef * 0.8);
        this.playerSpd = Math.round(GameState.spd * 0.8);
        this.logText.setText('卍解解除... 属性暂时下降');
      }
    } else if (!this.bankaiActive && this.bankaiUsed && this.bankaiTurnsLeft <= 0) {
      this.playerAtk = GameState.atk;
      this.playerDef = GameState.def;
      this.playerMatk = GameState.matk;
      this.playerMdef = GameState.mdef;
      this.playerSpd = GameState.spd;
    }
    if (this.hollowActive && this.hollowTurnsLeft > 0) {
      const drain = Math.round(this.playerMaxHp * 0.05);
      this.playerHp = Math.max(1, this.playerHp - drain);
      this.hollowTurnsLeft--;
      if (this.hollowTurnsLeft <= 0) {
        this.hollowActive = false;
        GameState.statusRes -= 0.30;
        this.playerMaxMp = GameState.maxMp;
        this.playerMp = Math.min(this.playerMp, this.playerMaxMp);
        this.logText.setText('虚化解除... 状态恢复');
      }
    }
    if (this.hellActive && this.hellTurnsLeft > 0) {
      const drain = Math.round(this.playerMaxHp * 0.10);
      this.playerHp = Math.max(1, this.playerHp - drain);
      this.hellTurnsLeft--;
      if (this.hellTurnsLeft <= 0) {
        this.hellActive = false;
        this.logText.setText('狱解解除... 业火熄灭');
      }
    }
  }

  private victory(): void {
    this.phase = 'victory';
    this.clearCommands();
    this.clearSubMenu();

    // 汇总所有敌人的奖励
    let totalExp = 0, totalGold = 0;
    const allLoot: any[] = [];
    this.enemies.forEach(e => {
      totalExp += e.expReward;
      totalGold += e.goldReward;
      // 优先用具名敌人专属掉落，无则fallback到随机生成
      const namedDef = NAMED_ENEMIES[e.name];
      if (namedDef && namedDef.drops) {
        allLoot.push(...generateNamedLoot(e.name, namedDef.drops));
      } else {
        const loot = generateLoot(e.type, e.zone);
        allLoot.push(...loot);
      }
    });
    // 记录图鉴击杀
    this.enemies.forEach(e => GameState.recordKill(e.name));
    GameState.gold += totalGold;
    const levelUp = GameState.gainExp(totalExp);
    this.playerHp = GameState.hp;
    this.playerMp = GameState.mp;

    allLoot.forEach(item => {
      Inventory.addItem({
        id: item.id, name: item.name, type: item.type as any,
        desc: item.desc, quantity: item.quantity,
        slot: item.slot as any, stats: item.stats, quality: item.quality,
      } as any);
    });

    const panelH = 280 + allLoot.length * 30;
    const container = this.add.container(0, 0).setDepth(100);
    const panel = this.add.graphics();
    panel.fillStyle(0x1a1a2e, 0.95);
    panel.fillRoundedRect(GAME_WIDTH / 2 - 180, 220, 360, panelH, 12);
    panel.lineStyle(2, 0xc9a96e, 0.7);
    panel.strokeRoundedRect(GAME_WIDTH / 2 - 180, 220, 360, panelH, 12);
    container.add(panel);
    container.add(this.add.text(GAME_WIDTH / 2, 248, '胜 利', {
      fontSize: '24px', color: '#c9a96e', fontStyle: 'bold', padding: { y: 2 },
    }).setOrigin(0.5));
    container.add(this.add.text(GAME_WIDTH / 2, 285, `经验 +${totalExp}  |  金币 +${totalGold}`, {
      fontSize: '15px', color: '#ddd', padding: { y: 2 },
    }).setOrigin(0.5));
    if (levelUp) {
      container.add(this.add.text(GAME_WIDTH / 2, 310, `等级提升！Lv.${GameState.level}`, {
        fontSize: '18px', color: '#44ff44', fontStyle: 'bold', padding: { y: 2 },
      }).setOrigin(0.5));
    }
    if (allLoot.length > 0) {
      const looTitleY = levelUp ? 340 : 315;
      container.add(this.add.text(GAME_WIDTH / 2, looTitleY, '─ 战利品 ─', {
        fontSize: '14px', color: '#c9a96e', padding: { y: 2 },
      }).setOrigin(0.5));
      const qualityCol: Record<string, string> = { white: '#cccccc', green: '#44cc44', blue: '#4488ff', purple: '#cc44cc', gold: '#ffaa00' };
      const qualityPre: Record<string, string> = { white: '白', green: '绿', blue: '蓝', purple: '紫', gold: '金' };
      allLoot.forEach((item, i) => {
        const iy = (levelUp ? 365 : 340) + i * 30;
        let color = '#88cc88', label = item.name;
        if (item.quality) { color = qualityCol[item.quality] || '#cccccc'; label = `[${qualityPre[item.quality]}] ${item.name}`; }
        else if (item.type === 'material') color = '#aaaacc';
        container.add(this.add.text(GAME_WIDTH / 2, iy, label, { fontSize: '14px', color, padding: { y: 2 } }).setOrigin(0.5));
      });
    }
    const confirmY = 220 + panelH - 35;
    const confirmText = this.add.text(GAME_WIDTH / 2, confirmY, '[ 点击继续 ]', {
      fontSize: '14px', color: '#c9a96e', padding: { y: 2 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    confirmText.on('pointerdown', () => {
      GameState.hp = this.playerHp;
      GameState.mp = this.playerMp;
      this.enemies.forEach(enemy => GameState.updateQuestProgress('kill', enemy.name, 1));
      if (this.enemyRefs.length > 0) {
        this.notifyGameScene('victory', 0);
      }
      this.scene.stop(); this.scene.resume('GameScene');
      this.scene.get('UIScene').events.emit('updateStats');
    });
    container.add(confirmText);
    container.setAlpha(0);
    this.tweens.add({ targets: container, alpha: 1, duration: 400 });
  }

  private defeat(): void {
    this.phase = 'defeat';
    this.clearCommands();
    this.logText.setText('战斗不能...');
    const container = this.add.container(0, 0).setDepth(100);
    const panel = this.add.graphics();
    panel.fillStyle(0x1a1a2e, 0.95);
    panel.fillRoundedRect(GAME_WIDTH / 2 - 140, 300, 280, 180, 12);
    panel.lineStyle(2, 0x993333, 0.7);
    panel.strokeRoundedRect(GAME_WIDTH / 2 - 140, 300, 280, 180, 12);
    container.add(panel);
    container.add(this.add.text(GAME_WIDTH / 2, 340, '战斗不能', {
      fontSize: '24px', color: '#cc4444', fontStyle: 'bold', padding: { y: 2 },
    }).setOrigin(0.5));
    const retryBtn = this.add.text(GAME_WIDTH / 2, 400, '[ 重新挑战 ]', {
      fontSize: '16px', color: '#c9a96e', padding: { y: 2 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    retryBtn.on('pointerdown', () => {
      this.enemies.forEach(e => { e.hp = e.maxHp; });
      this.scene.restart({ template: this.templateEnemy, enemyRef: this.enemyRefs[0], zone: GameState.zone });
    });
    container.add(retryBtn);
    const fleeBtn = this.add.text(GAME_WIDTH / 2, 440, '[ 返回据点 ]', {
      fontSize: '14px', color: '#887766', padding: { y: 2 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    fleeBtn.on('pointerdown', () => {
      GameState.hp = GameState.maxHp; GameState.mp = GameState.maxMp;
      this.notifyGameScene('defeat', 0);
      this.scene.stop(); this.scene.resume('GameScene');
      this.scene.get('UIScene').events.emit('updateStats');
    });
    container.add(fleeBtn);
    container.setAlpha(0);
    this.tweens.add({ targets: container, alpha: 1, duration: 400 });
  }

  // ════════════════════ 辅助 ════════════════════

  private flashEnemySprite(sprite: Phaser.GameObjects.Sprite): void {
    this.tweens.add({ targets: sprite, tint: 0xff0000, duration: 100, yoyo: true });
  }

  private flashPlayer(): void {
    this.cameras.main.flash(200, 255, 0, 0);
  }

  private notifyGameScene(result: string, index: number): void {
    const gs = this.scene.get('GameScene') as any;
    if (gs && gs.onBattleEnd && this.enemyRefs[index]) {
      gs.onBattleEnd(result, this.enemyRefs[index]);
    }
  }

  private clearCommands(): void {
    if (this.commandContainer) { this.commandContainer.destroy(); this.commandContainer = null; }
    // ★ 清理上一轮残留的键盘快捷键监听器，防止累积
    this.shortcutKeys.forEach(k => k.off('down'));
    this.shortcutKeys = [];
  }

  private clearSubMenu(): void {
    if (this.subMenuContainer) { this.subMenuContainer.destroy(); this.subMenuContainer = null; }
  }

  update(): void {
    this.drawAllEnemyHp();
    this.drawPlayerBars();
  }

  private drawAllEnemyHp(): void {
    const positions = this.getEnemyPositions(this.enemies.length);
    const count = this.enemies.length;
    this.enemyHpBars.forEach((bar, i) => {
      bar.clear();
      const enemy = this.enemies[i];
      if (!enemy || enemy.hp <= 0) return;
      const pos = positions[i];
      const bw = count <= 4 ? 100 : 70, bh = 6;
      const byOffset = count <= 4 ? -45 : -32;
      const bx = pos.x - bw / 2, by = pos.y + byOffset;
      const ratio = Math.max(0, enemy.hp / enemy.maxHp);
      bar.fillStyle(0x331111, 1); bar.fillRect(bx, by, bw, bh);
      const color = ratio > 0.5 ? 0xcc4444 : ratio > 0.25 ? 0xcc8844 : 0xcc2222;
      bar.fillStyle(color, 1); bar.fillRect(bx, by, bw * ratio, bh);
    });
  }

  private drawPlayerBars(): void {
    const bx = GAME_WIDTH / 2 + 50, by = 540, bw = 180;
    this.playerHpBar.clear();
    const hpRatio = this.playerHp / this.playerMaxHp;
    const hpColor = hpRatio > 0.5 ? 0x44cc44 : hpRatio > 0.25 ? 0xcccc44 : 0xcc4444;
    this.playerHpBar.fillStyle(0x331111, 1); this.playerHpBar.fillRect(bx, by, bw, 10);
    this.playerHpBar.fillStyle(hpColor, 1); this.playerHpBar.fillRect(bx, by, bw * hpRatio, 10);
    this.playerMpBar.clear();
    const mpRatio = this.playerMp / this.playerMaxMp;
    this.playerMpBar.fillStyle(0x111133, 1); this.playerMpBar.fillRect(bx, by + 14, bw, 6);
    this.playerMpBar.fillStyle(0x4444cc, 1); this.playerMpBar.fillRect(bx, by + 14, bw * mpRatio, 6);
  }

  /** 获取敌人类型的中文名 */
  private getEnemyRank(type: string): string {
    const map: Record<string, string> = { '杂妖': '杂虚', '恶妖': '恶虚', '妖将': '大虚', '妖王': '王虚' };
    return map[type] || type;
  }
}
