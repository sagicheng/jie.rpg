/**
 * GameScene 地图/NPC/怪物渲染子系统
 */
import { GAME_WIDTH, GAME_HEIGHT } from '../../config/config';
import { GameState } from '../../managers/GameState';
import { ZONE_CONFIGS, getDungeonPortal } from '../../config/zones';
import { enemyDisplayName, npcDisplayName } from '../../config/entityNames';
import type { DialogueLine } from '../../ui/DialogueBox';
import { MAIN_QUEST_ORDER, MAIN_QUESTS, SIDE_QUESTS } from '../../managers/QuestData';
import { renderQuestBoardPanel, toggleEnhancePanel } from '../../ui/panels';
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

export function createMap(scene: any): void {
  const cfg = ZONE_CONFIGS[GameState.zone] || ZONE_CONFIGS[1];
  const mapW = GAME_WIDTH * 3, mapH = GAME_HEIGHT * 2;
  const g = scene.add.graphics().setDepth(0);
  if (cfg.backgroundImage && scene.textures.exists(cfg.backgroundImage)) {
    if (cfg.backgroundMode === 'cover') {
      scene.add.image(mapW / 2, mapH / 2, cfg.backgroundImage).setOrigin(0.5).setDisplaySize(mapW, mapH).setDepth(0);
    } else {
      scene.add.tileSprite(mapW / 2, mapH / 2, mapW, mapH, cfg.backgroundImage).setDepth(0);
    }
  } else {
    g.fillStyle(cfg.groundColor, 1); g.fillRect(0, 0, mapW, mapH);
    if (scene.textures.exists('tile_ground')) {
      const ground = scene.add.tileSprite(mapW / 2, mapH / 2, mapW, mapH, 'tile_ground').setDepth(0);
      ground.setTint(cfg.groundColor); ground.setAlpha(0.35);
    }
  }
  for (const exit of cfg.exits) {
    const ex = exit.x * mapW, ey = exit.y * mapH;
    const arrowMap: Record<string, string> = { east: '\u2192', west: '\u2190', north: '\u2191', south: '\u2193', northwest: '\u2196', northeast: '\u2197', southwest: '\u2199', southeast: '\u2198' };
    const portal = scene.add.graphics();
    portal.fillStyle(0x44aaff, 0.15); portal.fillCircle(ex, ey, 35);
    portal.fillStyle(0x44aaff, 0.30); portal.fillCircle(ex, ey, 22);
    portal.lineStyle(2, 0x88ddff, 0.8); portal.strokeCircle(ex, ey, 30);
    portal.setDepth(3);
    scene.tweens.add({ targets: portal, alpha: 0.35, duration: 1200, yoyo: true, repeat: -1 });
    const arrow = scene.add.text(ex, ey, arrowMap[exit.edge] || '\u2192', { fontSize: '22px', color: '#88ddff', fontStyle: 'bold', padding: { x: 4, y: 2 } }).setOrigin(0.5).setDepth(4);
    scene.tweens.add({ targets: arrow, alpha: 0.4, duration: 1000, yoyo: true, repeat: -1 });
  }
  const dp = getDungeonPortal(GameState.zone);
  const dx = dp.x * mapW, dy = dp.y * mapH;
  scene.dungeonPortalPos = { x: dx, y: dy };
  if (scene.textures.exists('dungeon_portal_1')) {
    const portal = scene.add.image(dx, dy, 'dungeon_portal_1').setDepth(3);
    portal.setDisplaySize(96, 96);
    scene.tweens.add({ targets: portal, alpha: 0.65, duration: 1100, yoyo: true, repeat: -1 });
  } else {
    const portal = scene.add.graphics();
    portal.fillStyle(0xaa66ff, 0.15); portal.fillCircle(dx, dy, 38);
    portal.fillStyle(0xaa66ff, 0.32); portal.fillCircle(dx, dy, 24);
    portal.lineStyle(2, 0xcc99ff, 0.9); portal.strokeCircle(dx, dy, 32);
    portal.setDepth(3);
    scene.tweens.add({ targets: portal, alpha: 0.35, duration: 1100, yoyo: true, repeat: -1 });
  }
  const tag = scene.add.text(dx, dy - 46, '\u25C6 副本' + GameState.zone, { fontSize: '12px', color: '#d9b3ff', fontStyle: 'bold', backgroundColor: '#221133cc', padding: { x: 5, y: 2 } }).setOrigin(0.5).setDepth(6);
  scene.tweens.add({ targets: tag, y: dy - 52, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
}

export function createNPCs(scene: any): void {
  const cfg = ZONE_CONFIGS[GameState.zone] || ZONE_CONFIGS[1];
  for (const c of cfg.npcs) {
    const nx = c.x * GAME_WIDTH * 3, ny = c.y * GAME_HEIGHT * 2;
    const npcTexture = scene.textures.exists(c.id) ? c.id : 'npc';
    const npc = scene.physics.add.sprite(nx, ny, npcTexture).setImmovable(true).setDepth(5).setDisplaySize(40, 60);
    const tag = scene.add.text(nx, ny - 30, npcDisplayName(c.id), {
      fontSize: '11px',
      color: c.role === 'merchant' ? '#ffdd88' : c.role === 'return_point' ? '#88ccff' : c.role === 'craft' ? '#aa88ff' : c.role === 'enhance' ? '#ff8844' : c.role === 'quest_board' ? '#ffcc66' : '#ffe8b0',
      backgroundColor: '#00000088', padding: { x: 4, y: 2 },
    }).setOrigin(0.5).setDepth(6);
    const dialogueLines: DialogueLine[] = c.dialogue.map((d: any, i: number) => {
      const line: DialogueLine = { speaker: npcDisplayName(c.id), text: d.text };
      if (d.choices && i === 0) {
        line.choices = d.choices.map((ch: any) => ({
          text: ch.text,
          callback: () => {
            if (ch.callback === 'openShop') scene.openShopPanel(c.shop || []);
            else if (ch.callback === 'acceptQuest') scene.acceptQuestFromNPC(c);
            else if (ch.callback === 'completeQuest') scene.completeQuestFromNPC(c);
            else if (ch.callback === 'closeDialogue') scene.isInDialogue = false;
            else if (ch.callback === 'openReturn') scene.openReturn();
            else if (ch.callback === 'openCraft') scene.openCraft();
            else if (ch.callback === 'openQuestBoard') { scene.isInDialogue = false; renderQuestBoardPanel(scene); }
            else if (ch.callback === 'openEnhance') { scene.isInDialogue = false; toggleEnhancePanel(scene); }
            else { scene.isInDialogue = false; }
          },
        }));
      }
      return line;
    });
    const questChoices: Array<{ text: string; callback: () => void }> = [];
    for (const questId of MAIN_QUEST_ORDER) {
      const quest = MAIN_QUESTS[questId];
      if (!quest || quest.acceptFrom !== c.id) continue;
      if (GameState.questCompleted.includes(questId)) continue;
      if (GameState.isQuestActive(questId)) continue;
      if (quest.prerequisite && !GameState.questCompleted.includes(quest.prerequisite)) continue;
      questChoices.push({ text: `接受任务：${quest.name}`, callback: () => scene.acceptQuestFromNPC(c) });
      break;
    }
    const readyId = GameState.activeQuests.find((id: string) => {
      const q = GameState.getQuestDef(id);
      return !!q && q.completeAt === c.id && GameState.isQuestReady(id);
    });
    if (readyId) {
      const q = GameState.getQuestDef(readyId)!;
      questChoices.push({ text: `完成任务：${q.name}`, callback: () => scene.completeQuestFromNPC(c) });
    } else {
      const activeId = GameState.activeQuests.find((id: string) => {
        const q = GameState.getQuestDef(id);
        return !!q && q.completeAt === c.id;
      });
      if (activeId && dialogueLines.length > 0) {
        dialogueLines[0].text += `\n\n任务进度：${GameState.getQuestTrackFor(activeId)}`;
      }
    }
    for (const sq of Object.values(SIDE_QUESTS) as any[]) {
      if (sq.acceptFrom !== c.id) continue;
      if (GameState.questCompleted.includes(sq.id)) continue;
      if (GameState.isQuestActive(sq.id)) continue;
      if (sq.prerequisite && !GameState.questCompleted.includes(sq.prerequisite)) continue;
      questChoices.push({ text: `接受支线：${sq.name}`, callback: () => scene.acceptQuestFromNPC(c) });
      break;
    }
    if (questChoices.length > 0 && dialogueLines.length > 0) {
      if (!dialogueLines[0].choices) dialogueLines[0].choices = [];
      dialogueLines[0].choices!.push(...questChoices);
      dialogueLines[0].choices!.push({ text: '离开', callback: () => { scene.isInDialogue = false; } });
    }
    scene.npcList.push({ sprite: npc, id: c.id, name: npcDisplayName(c.id), role: c.role, dialogue: dialogueLines, nameTag: tag, x: nx, y: ny, shop: c.shop });
  }
}

export function createGatheringPts(scene: any): void {
  scene.gatherPoints = [];
  const cfg = ZONE_CONFIGS[GameState.zone] || ZONE_CONFIGS[1];
  for (const pt of cfg.gathering) {
    const gx = pt.x * GAME_WIDTH * 3, gy = pt.y * GAME_HEIGHT * 2;
    const key = `gather_${pt.type}`;
    if (!scene.textures.exists(key)) { console.warn('[gather] missing texture ' + key + ', skipped'); continue; }
    const sprite = scene.physics.add.sprite(gx, gy, key).setDepth(2);
    const label = scene.add.text(gx, gy - 20, pt.type, { fontSize: '10px', color: '#aaddaa', backgroundColor: '#00000066', padding: { x: 3, y: 1 } }).setOrigin(0.5).setDepth(3);
    scene.tweens.add({ targets: sprite, alpha: 0.6, duration: 1500, yoyo: true, repeat: -1 });
    scene.gatherPoints.push({ sprite, type: pt.type, label });
  }
}

export function updateMiniMap(scene: any): void {
  scene.miniMap.clear();
  const mmX = GAME_WIDTH - 180, mmY = 8, mmW = 170, mmH = 110;
  scene.miniMap.fillStyle(0x111122, 0.7);
  scene.miniMap.fillRoundedRect(mmX, mmY, mmW, mmH, 4);
  scene.miniMap.lineStyle(1, 0x444466, 1);
  scene.miniMap.strokeRoundedRect(mmX, mmY, mmW, mmH, 4);
  const sx = mmW / (GAME_WIDTH * 3), sy = mmH / (GAME_HEIGHT * 2);
  const cfg = ZONE_CONFIGS[GameState.zone];
  if (cfg) {
    for (const exit of cfg.exits) {
      const dotX = mmX + exit.x * mmW, dotY = mmY + exit.y * mmH;
      const flash = Math.sin(scene.time.now / 300) * 0.3 + 0.7;
      scene.miniMap.fillStyle(0x44aaff, flash * 0.3); scene.miniMap.fillCircle(dotX, dotY, 6);
      scene.miniMap.fillStyle(0x88ddff, flash); scene.miniMap.fillCircle(dotX, dotY, 3);
      scene.miniMap.lineStyle(1, 0xffffff, 0.8); scene.miniMap.strokeCircle(dotX, dotY, 4);
    }
    const dp = getDungeonPortal(GameState.zone);
    const ddx = mmX + dp.x * mmW, ddy = mmY + dp.y * mmH;
    const dflash = Math.sin(scene.time.now / 250) * 0.3 + 0.7;
    scene.miniMap.fillStyle(0xaa66ff, dflash * 0.4); scene.miniMap.fillCircle(ddx, ddy, 7);
    scene.miniMap.fillStyle(0xcc99ff, dflash); scene.miniMap.fillCircle(ddx, ddy, 3.5);
    scene.miniMap.lineStyle(1, 0xffffff, 0.8); scene.miniMap.strokeCircle(ddx, ddy, 5);
  }
  scene.miniMap.fillStyle(0x44aaff, 1);
  scene.miniMap.fillCircle(mmX + scene.player.x * sx, mmY + scene.player.y * sy, 3);
  scene.npcList.forEach((npc: any) => {
    const ndx = mmX + npc.x * sx, ndy = mmY + npc.y * sy;
    const color = npc.role === 'merchant' ? 0xffdd44 : npc.role === 'return_point' ? 0x88ccff : npc.role === 'craft' ? 0xaa88ff : npc.role === 'enhance' ? 0xff8844 : npc.role === 'quest_board' ? 0xffcc44 : 0x44cc44;
    scene.miniMap.fillStyle(color, 0.8); scene.miniMap.fillCircle(ndx, ndy, 2);
  });
}
