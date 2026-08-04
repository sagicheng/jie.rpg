/**
 * GameScene 聊天子系统
 * 每个导出的函数对应原 GameScene 中的一个方法。
 * 主文件方法变为一行委托：`method() { fn(this, ...); }`
 */
import Phaser from 'phaser';
import { GameState } from '../../managers/GameState';

export const CHAT_COLORS: Record<string, string> = {
  all: '#cdd6e8', world: '#cdd6e8', guild: '#9fe6a0', team: '#9fc6ff', whisper: '#e6b3ff', system: '#ffd27f', event: '#ff8f8f',
};
export const CHAT_PREFIX: Record<string, string> = {
  world: '[世界] ', guild: '[公会] ', team: '[队伍] ', system: '[系统] ', event: '[活动] ',
};

// ===== 基础聊天消息 =====

export function sendChat(scene: any, channel: string, text: string, targetCharId = 0): void {
  const t = (text || '').trim();
  if (!t) return;
  scene.gameRoom?.send('chat', { channel, text: t, targetCharId });
}

export function sendGuildChat(scene: any, text: string): void {
  sendChat(scene, 'guild', text);
}

export function onChat(scene: any, msg: any): void {
  appendChatLine(scene, msg.channel, msg.fromName, msg.fromCharId, msg.text);
}

export function appendChatLine(scene: any, channel: string, fromName: string, fromCharId: number, text: string): void {
  GameState.chatLog.push({ channel, fromName, fromCharId, text, ts: Date.now() });
  if (GameState.chatLog.length > 200) GameState.chatLog.shift();
  renderChatLines(scene);
}

export function renderChatLines(scene: any): void {
  if (!scene.chatHudLines) return;
  scene.chatHudLines.removeAll(true);
  const ch = scene.chatChannel;
  const filtered = GameState.chatLog.filter((m: any) => ch === 'all' || m.channel === ch);
  filtered.slice(-12).forEach((m: any, i: number) => {
    const color = CHAT_COLORS[m.channel] || '#cdd6e8';
    const prefix = m.channel === 'whisper'
      ? (m.fromCharId === scene.characterId ? '\u2192[\u79c1\u804a] ' : '[\u79c1\u804a] ')
      : (CHAT_PREFIX[m.channel] || '');
    const line = scene.add.text(0, i * 16, `${prefix}${m.fromName}\uff1a${m.text}`, {
      fontSize: '12px', color, wordWrap: { width: 500 }, padding: { y: 1 },
    });
    scene.chatHudLines!.add(line);
  });
}

// ===== 聊天 HUD 创建（DOM 实现）=====

export function createChatHud(scene: any): void {
  if (scene.chatHud) return;
  const W = scene.scale.width, H = scene.scale.height;
  const c = scene.add.container(0, 0).setDepth(5000).setScrollFactor(0);
  scene.chatHud = c;
  const boxX = 12, boxY = H - 260, boxW = 540, boxH = 200;

  const bg = scene.add.graphics();
  bg.fillStyle(0x0c0c18, 0.55); bg.fillRoundedRect(boxX, boxY, boxW, boxH, 8);
  bg.lineStyle(1, 0x334466, 0.5); bg.strokeRoundedRect(boxX, boxY, boxW, boxH, 8);
  c.add(bg);

  c.add(scene.add.text(boxX + 10, boxY + 8, '\ud83d\udcac \u804a\u5929', { fontSize: '12px', color: '#88aacc', fontStyle: 'bold' }).setOrigin(0, 0.5));
  scene.chatChannelText = scene.add.text(boxX + boxW - 10, boxY + 8, '[\u4e16\u754c]', { fontSize: '12px', color: '#aaccff' }).setOrigin(1, 0.5);
  c.add(scene.chatChannelText);

  const TABS: Array<{ id: string; label: string; color: string }> = [
    { id: 'all', label: '\u5168\u90e8', color: '#cdd6e8' },
    { id: 'world', label: '\u4e16\u754c', color: '#cdd6e8' },
    { id: 'guild', label: '\u516c\u4f1a', color: '#9fe6a0' },
    { id: 'team', label: '\u961f\u4f0d', color: '#9fc6ff' },
    { id: 'whisper', label: '\u79c1\u804a', color: '#e6b3ff' },
    { id: 'system', label: '\u7cfb\u7edf', color: '#ffd27f' },
  ];
  const tabStartX = boxX + 10, tabY = boxY + 28;
  const tabW = 50, tabH = 22;

  if (!document.getElementById('chat-tab-style')) {
    const st = document.createElement('style');
    st.id = 'chat-tab-style';
    st.textContent = '.chat-tabbar{position:absolute;display:flex;gap:3px;z-index:9998}.chat-tab{font-family:sans-serif;color:#9aa;background:rgba(34,34,68,0.30);border:1px solid #334466;border-radius:4px;padding:0 5px;cursor:pointer;user-select:none;white-space:nowrap;box-sizing:border-box}.chat-tab:hover{color:#fff}.chat-tab.selected{color:#fff;background:#33507a;border-color:#5599cc}';
    document.head.appendChild(st);
  }

  const cRect = scene.game.canvas.getBoundingClientRect();
  const cSx = cRect.width / W, cSy = cRect.height / H;
  const bar = document.createElement('div');
  bar.className = 'chat-tabbar';
  bar.style.left = (cRect.left + tabStartX * cSx) + 'px';
  bar.style.top = (cRect.top + tabY * cSy) + 'px';
  scene.chatTabEls = [];
  TABS.forEach((tab: any) => {
    const el = document.createElement('div');
    el.className = 'chat-tab';
    el.textContent = tab.label;
    el.style.minWidth = (tabW * cSx) + 'px';
    el.style.height = (tabH * cSy) + 'px';
    el.style.fontSize = (11 * cSx) + 'px';
    el.style.lineHeight = (tabH * cSy) + 'px';
    el.addEventListener('pointerdown', (e: PointerEvent) => { e.stopPropagation(); switchChatChannel(scene, tab.id); });
    bar.appendChild(el);
    scene.chatTabEls.push(el);
  });
  document.body.appendChild(bar);
  scene.chatTabBar = bar;

  renderChatTabs(scene);

  scene.chatHudLines = scene.add.container(boxX + 8, boxY + 58);
  c.add(scene.chatHudLines);

  scene.chatInputEl = spawnChatInput(scene);
  scene.chatInputEl.addEventListener('focus', () => { scene.chatInputFocused = true; if (scene.input.keyboard) scene.input.keyboard.enabled = false; });
  scene.chatInputEl.addEventListener('blur', () => { scene.chatInputFocused = false; if (scene.input.keyboard) scene.input.keyboard.enabled = true; });
  scene.chatInputEl.addEventListener('keydown', (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
const v = scene.chatInputEl!.value; scene.chatInputEl!.value = ''; scene.chatInputEl!.blur();
        scene.submitChat(v);
    } else if (e.key === 'Escape') {
      scene.chatInputEl!.value = ''; scene.chatInputEl!.blur();
    }
  });

  scene.chatWhisperTargetEl = spawnWhisperTargetInput(scene);
  scene.chatWhisperTargetEl.addEventListener('focus', () => { if (scene.input.keyboard) scene.input.keyboard.enabled = false; });
  scene.chatWhisperTargetEl.addEventListener('blur', () => { if (scene.input.keyboard) scene.input.keyboard.enabled = true; });
  scene.chatWhisperTargetEl.addEventListener('keydown', (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') { scene.chatInputEl?.focus(); }
    else if (e.key === 'Escape') { scene.chatWhisperTargetEl!.value = ''; scene.chatWhisperTargetEl!.blur(); }
  });

  relayoutChatDom(scene);
  if (!scene.chatResizeHooked) {
    scene.chatResizeHooked = true;
    scene.scale.on('resize', () => relayoutChatDom(scene));
  }

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    if (scene.chatInputEl && scene.chatInputEl.parentNode) scene.chatInputEl.parentNode.removeChild(scene.chatInputEl);
    if (scene.chatWhisperTargetEl && scene.chatWhisperTargetEl.parentNode) scene.chatWhisperTargetEl.parentNode.removeChild(scene.chatWhisperTargetEl);
    if (scene.chatTabBar && scene.chatTabBar.parentNode) scene.chatTabBar.parentNode.removeChild(scene.chatTabBar);
  });
}

export function relayoutChatDom(scene: any): void {
  if (!scene.chatInputEl && !scene.chatTabBar && !scene.chatWhisperTargetEl) return;
  const canvas = scene.game.canvas;
  const rect = canvas.getBoundingClientRect();
  const gw = scene.scale.width, gh = scene.scale.height;
  const sx = rect.width / gw, sy = rect.height / gh;
  if (scene.chatTabBar) {
    const tabStartX = 12 + 10, tabY = (gh - 260) + 28;
    scene.chatTabBar.style.left = (rect.left + tabStartX * sx) + 'px';
    scene.chatTabBar.style.top = (rect.top + tabY * sy) + 'px';
  }
  if (scene.chatInputEl) {
    const w = 320, h = 30, lx = 14, ly = gh - 60;
    scene.chatInputEl.style.left = (rect.left + lx * sx) + 'px';
    scene.chatInputEl.style.top = (rect.top + ly * sy) + 'px';
    scene.chatInputEl.style.width = (w * sx) + 'px';
    scene.chatInputEl.style.height = (h * sy) + 'px';
    scene.chatInputEl.style.fontSize = (15 * Math.min(sx, sy)) + 'px';
  }
  if (scene.chatWhisperTargetEl) {
    const w = 186, h = 30, lx = 342, ly = gh - 60;
    scene.chatWhisperTargetEl.style.left = (rect.left + lx * sx) + 'px';
    scene.chatWhisperTargetEl.style.top = (rect.top + ly * sy) + 'px';
    scene.chatWhisperTargetEl.style.width = (w * sx) + 'px';
    scene.chatWhisperTargetEl.style.height = (h * sy) + 'px';
    scene.chatWhisperTargetEl.style.fontSize = (15 * Math.min(sx, sy)) + 'px';
  }
  refreshWhisperInputVis(scene);
}

export function switchChatChannel(scene: any, channelId: string): void {
  if (channelId === 'guild' && !GameState.guildId) return;
  if (channelId === 'team' && !scene.teamId) return;
  scene.chatChannel = channelId;
  renderChatTabs(scene);
  renderChatLines(scene);
}

export function renderChatTabs(scene: any): void {
  const IDS = ['all', 'world', 'guild', 'team', 'whisper', 'system'];
  if (scene.chatTabEls) {
    scene.chatTabEls.forEach((el: any, i: number) => el.classList.toggle('selected', IDS[i] === scene.chatChannel));
  }
  const LABELS: Record<string, string> = { all: '[\u5168\u90e8]', world: '[\u4e16\u754c]', guild: '[\u516c\u4f1a]', team: '[\u961f\u4f0d]', whisper: '[\u79c1\u804a]', system: '[\u7cfb\u7edf]' };
  scene.chatChannelText?.setText(LABELS[scene.chatChannel] || scene.chatChannel);
  scene.chatChannelText?.setColor(CHAT_COLORS[scene.chatChannel] || '#aaccff');
  refreshWhisperInputVis(scene);
}

export function spawnChatInput(scene: any): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'text'; el.maxLength = 200; el.value = '';
  el.style.cssText = 'position:absolute;font-size:15px;color:#fff;background:#0a0a1e;border:1px solid #446688;border-radius:4px;outline:none;z-index:9999;';
  const canvas = scene.game.canvas;
  const rect = canvas.getBoundingClientRect();
  const gw = scene.scale.width, gh = scene.scale.height;
  const sx = rect.width / gw, sy = rect.height / gh;
  const w = 366, h = 30;
  const lx = 14, ly = gh - 60;
  el.style.left = (rect.left + lx * sx) + 'px';
  el.style.top = (rect.top + ly * sy) + 'px';
  el.style.width = (w * sx) + 'px'; el.style.height = (h * sy) + 'px';
  document.body.appendChild(el);
  return el;
}

export function spawnWhisperTargetInput(scene: any): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'text'; el.maxLength = 24; el.value = '';
  el.placeholder = '\u5bf9\u65b9\u89d2\u8272\u540d';
  el.style.cssText = 'position:absolute;font-size:15px;color:#fff;background:#0a0a1e;border:1px solid #a06bd0;border-radius:4px;outline:none;z-index:9999;display:none;';
  const canvas = scene.game.canvas;
  const rect = canvas.getBoundingClientRect();
  const gw = scene.scale.width, gh = scene.scale.height;
  const sx = rect.width / gw, sy = rect.height / gh;
  const w = 186, h = 30, lx = 342, ly = gh - 60;
  el.style.left = (rect.left + lx * sx) + 'px';
  el.style.top = (rect.top + ly * sy) + 'px';
  el.style.width = (w * sx) + 'px'; el.style.height = (h * sy) + 'px';
  document.body.appendChild(el);
  return el;
}

export function refreshWhisperInputVis(scene: any): void {
  if (!scene.chatWhisperTargetEl) return;
  const show = scene.chatChannel === 'whisper' && (scene.chatHud ? scene.chatHud.visible : true);
  scene.chatWhisperTargetEl.style.display = show ? 'block' : 'none';
}

export function focusChatInput(scene: any): void {
  createChatHud(scene);
  scene.chatInputEl?.focus();
}
