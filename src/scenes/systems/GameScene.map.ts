/**
 * GameScene 地图/NPC/怪物渲染子系统
 */
import { GAME_WIDTH, GAME_HEIGHT } from '../../config/config';
import { GameState } from '../../managers/GameState';
import { ZONE_CONFIGS } from '../../config/zones';
import { enemyDisplayName } from '../../config/entityNames';
import { monsterPortraitKey, ensureMonsterPortrait, bossPortraitKey, ensureBossPortrait } from '../../core/portraitLoader';
import { NAMED_ENEMIES } from '../../managers/BestiaryData';
import { getEnemyData } from '../../managers/BestiaryData';

export function fitBody(scene: any, sprite: any, wFrac: number, hFrac: number, offXFrac = (1 - wFrac) / 2, offYFrac = (1 - hFrac) / 2): void {
  if (!sprite || !sprite.body) return;
  const dw = sprite.displayWidth, dh = sprite.displayHeight;
  const sx = sprite.width / dw, sy = sprite.height / dh;
  sprite.body.setSize(dw * wFrac * sx, dh * hFrac * sy);
  sprite.body.setOffset(offXFrac * sprite.width, offYFrac * sprite.height);
}

export function createEnemies(scene: any): void {
  scene.enemies = [];
  const cfg = ZONE_CONFIGS[GameState.zone] || ZONE_CONFIGS[1];
  const pool = (cfg as any).enemyPool || cfg.enemies || [];
  for (const e of pool) {
    const ed: any = (getEnemyData as any)(e.name) || { name: e.name, type: '\u6742\u5996', element: '\u65e0', zone: GameState.zone, level: 1, hp: 50, atk: 10, def: 5, matk: 5, mdef: 5, spd: 10, expReward: 10, goldReward: 5 };
    const ex = e.x * GAME_WIDTH * 3, ey = e.y * GAME_HEIGHT * 2;
    const isBoss = (NAMED_ENEMIES[e.name] as any)?.isBoss || e.name.includes('\u5927\u865a') || e.name.includes('\u4e9a\u4e18\u5361\u65af');
    const pkey = isBoss ? bossPortraitKey(e.name) : monsterPortraitKey(e.name);
    const applyPortrait = () => {
      if (!scene.textures.exists(pkey)) return;
      const sprite = scene.add.sprite(ex, ey, pkey).setDepth(8);
      if (isBoss) sprite.setDisplaySize(60, 90); else scene.fitMonsterSprite(sprite, 40);
      scene.physics.add.existing(sprite);
      if (!scene.enemyGroup) {
        scene.enemyGroup = scene.physics.add.group();
        scene.physics.add.overlap(scene.player, scene.enemyGroup, scene.onEnemyOverlap, undefined, scene);
      }
      scene.enemyGroup.add(sprite);
      const label = scene.add.text(ex, ey - sprite.displayHeight / 2 - 10, enemyDisplayName(e.name), {
        fontSize: '11px', color: isBoss ? '#ff6644' : '#ffaa88', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 2, padding: { x: 2, y: 1 },
      }).setOrigin(0.5).setDepth(10);
      const en = { sprite, data: ed, label, id: e.id || (e.name + '_' + ex + '_' + ey), dead: false };
      scene.enemies.push(en);
      const speed = isBoss ? 2000 + Math.random() * 2000 : 3000 + Math.random() * 3000;
      const dx = Phaser.Math.Between(-20, 20), dy = Phaser.Math.Between(-15, 15);
      scene.tweens.add({ targets: sprite, x: ex + dx, y: ey + dy, duration: speed, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      label.setPosition(ex, ey - sprite.displayHeight / 2 - 10);
      scene.fitBody(sprite, isBoss ? 0.9 : 0.85, isBoss ? 0.95 : 0.85);
    };
    if (scene.textures.exists(pkey)) {
      applyPortrait();
    } else if (isBoss) {
      ensureBossPortrait(scene, e.name, applyPortrait);
    } else {
      ensureMonsterPortrait(scene, e.name, applyPortrait);
    }
  }
}
