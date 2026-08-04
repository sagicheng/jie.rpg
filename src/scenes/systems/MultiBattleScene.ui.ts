/**
 * MultiBattleScene 卡片+UI子系统
 */
import Phaser from 'phaser';
import { GameState } from '../../managers/GameState';
import { SkinBar, SkinButton, cardHl, tagBg, panel, hpColor } from '../../ui/BattleSkin';

export interface Card {
  root: Phaser.GameObjects.Container;
  name: Phaser.GameObjects.Text;
  hpBar: SkinBar;
  hpText: Phaser.GameObjects.Text;
  portrait: Phaser.GameObjects.Image;
  hl: Phaser.GameObjects.Image;
  lastHp: number;
  statusIcons: Phaser.GameObjects.GameObject[];
  locked?: boolean;
  wasAlive?: boolean;
}

export interface Button {
  container: Phaser.GameObjects.Container;
  setEnable: (b: boolean) => void;
  setVisible: (b: boolean) => void;
}

export function makeCard(scene: any, x: number, y: number, isPlayer: boolean): Card {
  const root = scene.add.container(x, y).setDepth(10);
  const barW = 160, barH = 8;
  const hpBar = new SkinBar(scene, { x: -barW / 2, y: -112, w: barW, h: barH, depth: 12, pad: 1 });
  const hpText = scene.add.text(0, -98, '', { fontSize: '12px', color: '#ffffff' }).setOrigin(0.5);
  const name = scene.add.text(0, -80, '', { fontSize: '13px', color: isPlayer ? '#aaffaa' : '#ffaaaa', fontStyle: 'bold' }).setOrigin(0.5);
  const portrait = scene.add.image(0, 0, GameState.gender).setDisplaySize(120, 180).setDepth(15).setVisible(false);
  const hl = cardHl(scene).setDisplaySize(190, 290);
  root.add([hpBar.frame, hpBar.fill, hpText, name, portrait, hl]);
  scene.tweens.add({ targets: root, scaleY: 1.035, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  return { root, name, hpBar, hpText, portrait, hl, lastHp: -1, statusIcons: [] };
}

export function drawHpBar(card: Card, hp: number, maxHp: number): void {
  const ratio = maxHp > 0 ? Phaser.Math.Clamp(hp / maxHp, 0, 1) : 0;
  card.hpBar.setRatio(ratio, hpColor(ratio));
  card.hpText.setText(`HP ${Math.max(0, Math.round(hp))} / ${Math.round(maxHp)}`);
}

export function drawStatusIcons(scene: any, card: Card, c: any): void {
  for (const obj of card.statusIcons) obj.destroy();
  card.statusIcons = [];
  const st = c.status;
  if (!st) return;
  const list: { key: string; name: string; turns: number }[] = [
    { key: 'icon_burn', name: '\u707c\u70e7', turns: st.burn },
    { key: 'icon_freeze', name: '\u51bb\u7ed3', turns: st.freeze },
    { key: 'icon_poison', name: '\u4e2d\u6bd2', turns: st.poison },
    { key: 'icon_parasite', name: '\u5bc4\u751f', turns: st.parasite },
    { key: 'icon_slow', name: '\u51cf\u901f', turns: st.slow },
    { key: 'icon_stun', name: '\u7729\u6655', turns: st.stun },
    { key: 'icon_bind', name: '\u7981\u9522', turns: st.bind },
    { key: 'icon_taunt', name: '\u5632\u8bbd', turns: st.taunt },
    { key: 'icon_fear', name: '\u6050\u60e7', turns: st.fear },
    { key: 'icon_atkDown', name: '\u653b\u964d', turns: st.atkDown },
    { key: 'icon_defDown', name: '\u9632\u964d', turns: st.defDown },
    { key: 'icon_matkDown', name: '\u964d\u7075\u538b', turns: st.matkDown },
    { key: 'icon_seal', name: '\u5c01\u5370', turns: st.sealed },
  ];
  const active = list.filter((k) => k.turns > 0);
  if (active.length === 0) return;
  {
    const sig = `${c.name || '\u654c\u65b9'}:${active.map(k => `${k.name}\u00d7${k.turns}`).join(',')}`;
    if ((scene as any)._lastStatusSig !== sig) {
      (scene as any)._lastStatusSig = sig;
      console.log(`[Status.render] ${sig}`);
    }
  }
  const ICON = 22, GAP = 3, PAD = 6;
  const totalW = active.length * (ICON + GAP) - GAP + PAD * 2;
  const nameRight = card.name.x + (card.name.width || 0);
  const iconY = card.name.y + (card.name.height || 16) / 2;
  let contentStartX = nameRight + 8;
  const maxRight = 184;
  if (contentStartX + totalW > maxRight) contentStartX = Math.max(nameRight + 4, maxRight - totalW);
  const plateX = contentStartX, plateY = iconY - (ICON + 8) / 2;
  const plateW = totalW, plateH = ICON + 8;
  const plate = tagBg(scene, plateX + plateW / 2, plateY + plateH / 2).setDisplaySize(plateW, plateH).setDepth(11);
  card.root.add(plate);
  card.statusIcons.push(plate);
  const startX = contentStartX + PAD + ICON / 2;
  const y = iconY;
  active.forEach((k, i) => {
    const x = startX + i * (ICON + GAP);
    if (scene.textures.exists(k.key)) {
      const img = scene.add.image(x, y, k.key).setDisplaySize(ICON, ICON).setDepth(12);
      card.root.add(img);
      card.statusIcons.push(img);
    } else {
      const t = scene.add.text(x, y, k.name, { fontSize: '10px', color: '#ffcc66', backgroundColor: '#00000088', padding: { x: 2, y: 1 } }).setOrigin(0.5).setDepth(12);
      card.root.add(t);
      card.statusIcons.push(t);
    }
    const tn = scene.add.text(x, y + ICON / 2 - 1, String(k.turns), {
      fontSize: '10px', color: '#ffffff', backgroundColor: '#000000aa', padding: { x: 1, y: 0 },
    }).setOrigin(0.5).setDepth(13);
    card.root.add(tn);
    card.statusIcons.push(tn);
  });
}

export function makeButton(scene: any, x: number, y: number, label: string, _color: number, cb: () => void, w = 200, h = 56): Button {
  const sb = new SkinButton(scene, { x, y, label, w, h, depth: 20, onClick: cb });
  return { container: sb.root, setEnable: (b: boolean) => sb.setEnabled(b), setVisible: (b: boolean) => sb.setVisible(b) };
}

export function showResult(scene: any, title: string): void {
  if (scene.resultPanel) return;
  const w = scene.scale.width, h = scene.scale.height;
  const c = scene.add.container(w / 2, h / 2).setDepth(50);
  const bg = scene.add.rectangle(-w / 2, -h / 2, w, h, 0x000000, 0.7).setOrigin(0, 0);
  const panelBg = panel(scene, -260, -170, 520, 340, 50);
  const t = scene.add.text(0, -90, title, {
    fontSize: '40px', color: title.includes('\u80dc\u5229') ? '#88ff88' : title.includes('\u8131') ? '#ffdd66' : '#ff8866', fontStyle: 'bold',
  }).setOrigin(0.5);
  const btn = scene.add.text(0, 80, scene.returnScene === 'GameScene' ? '\u8fd4\u56de\u5730\u56fe' : '\u8fd4\u56de\u526f\u672c', {
    fontSize: '22px', color: '#d4c5a0', padding: { x: 24, y: 10 }, backgroundColor: '#2a2a3e',
  }).setOrigin(0.5).setInteractive({ useHandCursor: true });
  btn.on('pointerover', () => btn.setColor('#ffe8b0'));
  btn.on('pointerout', () => btn.setColor('#d4c5a0'));
  btn.on('pointerdown', () => {
    c.destroy(true);
    scene.resultPanel = null;
    scene.intentionalLeave = true;
    scene.broadcastTeamExit();
    scene.scene.stop();
  });
  c.add([bg, panelBg, t, btn]);
  scene.resultPanel = c;
}
