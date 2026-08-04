/**
 * GameScene 交互子系统（NPC对话/采集/传送阵/区域切换）
 */
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, ZONE_NAMES } from '../../config/config';
import { GameState } from '../../managers/GameState';
import { ZONE_CONFIGS } from '../../config/zones';
import { Inventory } from '../../managers/Inventory';
import { SaveManager } from '../../core/SaveManager';
import { requestGather, DUNGEON_WEEKLY_CAP, dungeonWeekly, dungeonProgress } from '../../api/WorldClient';
import { NODE_TO_MATERIAL, matId } from '../../config/materials';
import { CONSUMABLES_BY_NAME } from '../../managers/ConsumableSystem';

interface NPCData { id: string; name: string; role: string; dialogue: any[]; sprite: any; nameTag: any; x: number; y: number; shop?: any[]; }

export function checkNPCProximity(scene: any): void {
  scene.canInteract = false; scene.currentNPC = null; let closestDist = Infinity;
  for (const npc of scene.npcList) { const dist = Phaser.Math.Distance.Between(scene.player.x, scene.player.y, npc.sprite.x, npc.sprite.y); if (dist < 50 && dist < closestDist) { closestDist = dist; scene.currentNPC = npc; scene.canInteract = true; } }
  if (scene.canInteract && scene.currentNPC) { scene.promptText.setText(`按 F 与 ${scene.currentNPC.name} 对话`); scene.promptText.setPosition(scene.currentNPC.sprite.x, scene.currentNPC.sprite.y - 50); scene.promptText.setVisible(true); }
  else { scene.promptText.setVisible(false); }
}

export function onInteractKey(scene: any): void {
  if (scene.isInDialogue) return;
  if (scene.dungeonConfirmOpen) return;
  if (scene.canInteract && scene.currentNPC) { startDialogue(scene, scene.currentNPC); return; }
  if (scene.nearbyDungeon && !scene.inDungeon) { scene.showDungeonConfirm(GameState.zone); return; }
  for (let i = 0; i < scene.gatherPoints.length; i++) {
    const pt = scene.gatherPoints[i];
    const dist = Phaser.Math.Distance.Between(scene.player.x, scene.player.y, pt.sprite.x, pt.sprite.y);
    if (dist < 55) { tryGather(scene, i); return; }
  }
  const cfg = ZONE_CONFIGS[GameState.zone];
  if (cfg) {
    if (scene.dungeonPortalPos) {
      const dpDist = Phaser.Math.Distance.Between(scene.player.x, scene.player.y, scene.dungeonPortalPos.x, scene.dungeonPortalPos.y);
      if (dpDist < 60) return;
    }
    for (const exit of cfg.exits) {
      const ex = exit.x * GAME_WIDTH * 3, ey = exit.y * GAME_HEIGHT * 2;
      if (Phaser.Math.Distance.Between(scene.player.x, scene.player.y, ex, ey) < 60) {
        transitionToZone(scene, exit.targetZone, exit.targetX * GAME_WIDTH * 3, exit.targetY * GAME_HEIGHT * 2);
        return;
      }
    }
  }
}

export function tryGather(scene: any, idx: number): void {
  if (scene.isInDialogue) return;
  const pt = scene.gatherPoints[idx];
  GameState.updateQuestProgress('collect', pt.type, 1);
  if (scene.gameRoom) {
    if (!requestGather(GameState.zone, idx, Math.round(scene.player.x), Math.round(scene.player.y))) return;
    scene.isInDialogue = true;
    scene.time.delayedCall(300, () => { scene.isInDialogue = false; });
    return;
  }
  scene.isInDialogue = true;
  const matName = NODE_TO_MATERIAL[pt.type] || pt.type;
  const conEntry = CONSUMABLES_BY_NAME[matName];
  Inventory.addItem({
    id: conEntry ? conEntry.id : matId(matName),
    name: matName,
    type: conEntry ? 'consumable' : 'material',
    desc: conEntry ? conEntry.desc : '野外采集获得',
    quantity: 1,
  });
  pt.sprite.setVisible(false); pt.label.setVisible(false);
  scene.time.delayedCall(30000, () => { pt.sprite.setVisible(true); pt.label.setVisible(true); });
  const notif = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 80, `获得：${matName}`, { fontSize: '18px', color: '#88ff88', fontStyle: 'bold', backgroundColor: '#112211cc', padding: { x: 16, y: 8 } }).setOrigin(0.5).setScrollFactor(0).setDepth(300);
  scene.tweens.add({ targets: notif, alpha: 0, y: GAME_HEIGHT / 2 - 100, duration: 1500, onComplete: () => notif.destroy() });
  scene.time.delayedCall(300, () => { scene.isInDialogue = false; });
}

export function checkDungeonPortal(scene: any): void {
  if (!scene.dungeonPortalPos) { scene.nearbyDungeon = false; return; }
  const dist = Phaser.Math.Distance.Between(scene.player.x, scene.player.y, scene.dungeonPortalPos.x, scene.dungeonPortalPos.y);
  if (dist < 60 && !scene.inDungeon) {
    scene.nearbyDungeon = true;
    const remaining = Math.max(0, DUNGEON_WEEKLY_CAP - dungeonWeekly.count);
    const active = dungeonProgress && dungeonProgress.dungeonId === GameState.zone;
    scene.promptText.setText(active ? `按 F 继续副本${GameState.zone}（第 ${dungeonProgress!.stage} 阶）` : `按 F 进入副本${GameState.zone}（本周剩余 ${remaining} 次）`);
    scene.promptText.setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60);
    scene.promptText.setVisible(true);
  } else {
    scene.nearbyDungeon = false;
  }
}

export function startDialogue(scene: any, npc: NPCData): void {
  scene.isInDialogue = true; scene.player.setVelocity(0, 0); scene.promptText.setVisible(false);
  GameState.updateQuestProgress('talk', npc.id, 1);
  let lineIndex = 0;
  const showNext = () => { if (lineIndex < npc.dialogue.length) { const line = npc.dialogue[lineIndex]; lineIndex++; scene.dialogueBox.show(line, lineIndex < npc.dialogue.length ? showNext : () => { scene.isInDialogue = false; }); } };
  showNext();
}

export function checkZoneExit(scene: any): void {
  const cfg = ZONE_CONFIGS[GameState.zone]; if (!cfg) return;
  if (scene.dungeonPortalPos) {
    const dpDist = Phaser.Math.Distance.Between(scene.player.x, scene.player.y, scene.dungeonPortalPos.x, scene.dungeonPortalPos.y);
    if (dpDist < 60) return;
  }
  for (const exit of cfg.exits) { const ex = exit.x * GAME_WIDTH * 3, ey = exit.y * GAME_HEIGHT * 2; const dist = Phaser.Math.Distance.Between(scene.player.x, scene.player.y, ex, ey); if (dist < 60) { scene.promptText.setText(`按 F 前往 ${ZONE_NAMES[exit.targetZone]}`); scene.promptText.setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60); scene.promptText.setVisible(true); return; } }
  if (!scene.canInteract) scene.promptText.setVisible(false);
}

export function transitionToZone(scene: any, tz: number, tx: number, ty: number): void {
  scene.isInDialogue = true; GameState.zone = tz; GameState.x = tx; GameState.y = ty; scene.battleCooldown = 60;
  if (!GameState.discoveredZones.includes(tz)) GameState.discoveredZones.push(tz);
  GameState.updateQuestProgress('reach', ZONE_NAMES[tz] || '', 1);
  scene.cameras.main.fadeOut(400, 0, 0, 0);
  scene.cameras.main.once('camerafadeoutcomplete', () => {
    scene.enemies.forEach((e: any) => { e.sprite.destroy(); e.label.destroy(); }); scene.enemies = [];
    scene.npcList.forEach((n: any) => { n.sprite.destroy(); n.nameTag.destroy(); }); scene.npcList = [];
    scene.gatherPoints.forEach((gp: any) => { gp.sprite.destroy(); gp.label.destroy(); }); scene.gatherPoints = [];
    const stale = scene.children.list.filter((c2: any) =>
      (c2.type === 'Graphics' && [0,1,3,4].includes(c2.depth||-1)) ||
      (c2.type === 'Text' && [4,6].includes(c2.depth||-1)) ||
      (c2.type === 'TileSprite' && [0,1].includes(c2.depth||-1))
    );
    stale.forEach((c2: any) => c2.destroy());
    scene.createMap(); scene.createNPCs(); scene.createEnemies(); scene.createGatheringPoints();
    scene.zoneText.setText(`${ZONE_NAMES[GameState.zone]}`);
    scene.player.setPosition(tx, ty); scene.isInDialogue = false; scene.cameras.main.fadeIn(400,0,0,0); SaveManager.save();
    const b = scene.add.text(GAME_WIDTH/2, GAME_HEIGHT/2-40, ZONE_NAMES[tz], {fontSize:'28px',color:'#ffe8b0',fontStyle:'bold',backgroundColor:'#000000aa',padding:{x:24,y:12}}).setOrigin(0.5).setScrollFactor(0).setDepth(250).setAlpha(0);
    scene.tweens.add({targets:b,alpha:1,duration:500,onComplete:()=>{scene.tweens.add({targets:b,alpha:0,duration:1200,delay:1000,onComplete:()=>b.destroy()});}});
  });
}
