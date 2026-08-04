/**
 * 将 GameScene.ts 拆分到 src/scenes/systems/ 子文件。
 * 策略：提取方法体为独立函数，主文件方法变成薄壳委托。
 * 用法：node scripts/split_gamescene.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const SRC = join(import.meta.dirname, '..', 'src', 'scenes');
const SYS = join(SRC, 'systems');
if (!existsSync(SYS)) mkdirSync(SYS, { recursive: true });

const lines = readFileSync(join(SRC, 'GameScene.ts'), 'utf8').split('\n');

// 行号索引（1-based → 0-based）
function getLine(n) { return lines[n - 1]; }

// 方法名到行号的映射
const methods = {
  // create 相关
  'create': 225, 'pauseForMenu': 573, 'resumeFromMenu': 577, 'setGameUIVisible': 583,
  'checkNPCProximity': 593, 'onInteractKey': 600, 'tryGather': 631, 'checkDungeonPortal': 664,
  'checkZoneExit': 688, 'transitionToZone': 698, 'startDialogue': 678,

  // map 相关
  'createMap': 953, 'createNPCs': 1018, 'createEnemies': 1103, 'createGatheringPoints': 1149,
  'updateMiniMap': 1163, 'fitBody': 946, 'fitMonsterSprite': 911,

  // battle 相关
  'onEnemyOverlap': 723, 'checkEnemyCollision': 730, 'enterBattle': 742, 'isMonsterAvailable': 771,
  'onBattleEnd': 775, 'onMultiBattleEnd': 832, 'flushBattleReport': 867, 'monsterRespawnMs': 895,
  'removeMonster': 901, 'restoreMonster': 917, 'pruneSharedMonsters': 926,
  'launchMultiBattle': 1648, 'enterDungeon': 1659, 'exitDungeon': 1694,
  'buildBattleLoadout': 1700, 'buildEncounterParty': 1744,

  // chat 相关
  'whisperTo': 1846, 'resolveWhisperTarget': 1856, 'onChat': 1881, 'appendChatLine': 1885,
  'renderChatLines': 1893, 'sendChat': 1911, 'sendGuildChat': 1917, 'createChatHud': 1922,

  // team 相关
  'addPendingInvite': null, 'removePendingInvite': null, 'toggleTeamPanel': null,
  'closeTeamPanel': null, 'toggleGuildPanel': null, 'closeGuildPanel': null, 'openGuildPanel': null,
  'toggleFriendPanel': null, 'closeFriendPanel': null, 'openFriendPanel': null, 'refreshFriendPanel': null,
  'toggleAuctionPanel': null, 'openAuctionPanel': null, 'togglePetPanel': null,

  // multiplayer
  'connectGameRoom': 1351, 'onIntentResult': 1540, 'showWorldNotif': 1548, 'showTitleUnlockNotif': 1557,
  'refreshOpenPanels': 1566, 'openShopPanel': 1578, 'broadcastTitle': 1584,
  'syncRemotePlayers': 1591, 'clearRemotePlayers': 1625, 'setBattling': 1631, 'sendMoveThrottled': 1636,

  // panels
  'acceptQuestFromNPC': 1197, 'completeQuestFromNPC': 1222, 'startIntroDialogue': 1263,
  'tryAutoStartNextQuest': 1279, 'openReturn': 1295, 'openCraft': 1296,
};

// 找到所有缺失的行号
for (const [name, line] of Object.entries(methods)) {
  if (line === null) {
    // 搜索这些方法
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(new RegExp(`^\\s+(public |private |async )?${name}\\(`))) {
        methods[name] = i + 1; // 1-based
        break;
      }
    }
  }
}

// 找方法体结束行（找到下一个同缩进级别的方法声明或类结束）
function findMethodEnd(startLine) {
  let braceDepth = 0;
  let started = false;
  for (let i = startLine - 1; i < lines.length; i++) {
    const line = lines[i];
    // 跳过空行和注释
    if (i === startLine - 1) continue;
    
    for (const ch of line) {
      if (ch === '{') { braceDepth++; started = true; }
      else if (ch === '}') { braceDepth--; }
    }
    if (started && braceDepth === 0) return i + 1; // 1-based
  }
  return lines.length;
}

// 提取方法体（不包括方法签名行）
function extractBody(startLine) {
  let braceDepth = 0;
  let started = false;
  const bodyLines = [];
  let signatureLine = '';
  
  for (let i = startLine - 1; i < lines.length; i++) {
    const line = lines[i];
    
    if (!started) {
      // 收集签名直到开括号
      if (line.includes('{')) {
        started = true;
        // 如果开括号后还有内容，加入 body
        const afterBrace = line.substring(line.indexOf('{') + 1);
        if (afterBrace.trim()) bodyLines.push(afterBrace);
        braceDepth = 1;
        for (const ch of line) {
          if (ch === '{') braceDepth = 1; 
        }
        // 处理闭括号
        for (const ch of afterBrace) {
          if (ch === '{') braceDepth++;
          if (ch === '}') braceDepth--;
        }
        if (braceDepth === 0) break;
      }
      continue;
    }
    
    bodyLines.push(line);
    for (const ch of line) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
    }
    if (braceDepth === 0) break;
  }
  return bodyLines.join('\n');
}

// 获取缩进
function getIndent(lineNum) {
  const line = getLine(lineNum);
  const match = line.match(/^(\s*)/);
  return match ? match[1] : '';
}

// ===== 生成子文件 =====

// 子文件分组
const groups = {
  'GameScene.create': ['create'],
  'GameScene.chat': ['whisperTo', 'resolveWhisperTarget', 'onChat', 'appendChatLine', 'renderChatLines', 'sendChat', 'sendGuildChat', 'createChatHud'],
  'GameScene.map': ['createMap', 'createNPCs', 'createEnemies', 'createGatheringPoints', 'updateMiniMap', 'fitBody', 'fitMonsterSprite'],
  'GameScene.battle': ['onEnemyOverlap', 'checkEnemyCollision', 'enterBattle', 'isMonsterAvailable', 'onBattleEnd', 'onMultiBattleEnd', 'flushBattleReport', 'monsterRespawnMs', 'removeMonster', 'restoreMonster', 'pruneSharedMonsters', 'launchMultiBattle', 'enterDungeon', 'exitDungeon', 'buildBattleLoadout', 'buildEncounterParty'],
  'GameScene.multiplayer': ['connectGameRoom', 'onIntentResult', 'showWorldNotif', 'showTitleUnlockNotif', 'refreshOpenPanels', 'openShopPanel', 'broadcastTitle', 'syncRemotePlayers', 'clearRemotePlayers', 'setBattling', 'sendMoveThrottled'],
  'GameScene.panels': ['acceptQuestFromNPC', 'completeQuestFromNPC', 'startIntroDialogue', 'tryAutoStartNextQuest', 'openReturn', 'openCraft'],
};

// 需要从主文件移至子文件的方法名
const movedMethods = new Set();
for (const names of Object.values(groups)) {
  for (const n of names) movedMethods.add(n);
}

for (const [filename, methodNames] of Object.entries(groups)) {
  const parts = [];
  parts.push(`// Auto-generated split from GameScene.ts`);
  parts.push(`import { GameScene } from '../GameScene';`);
  parts.push('');
  
  for (const name of methodNames) {
    const startLine = methods[name];
    if (!startLine) { console.warn(`WARN: method "${name}" not found`); continue; }
    
    const body = extractBody(startLine);
    const indent = getIndent(startLine);
    
    // 判断是 public 还是 private
    const sigLine = getLine(startLine);
    const isPrivate = sigLine.includes('private ');
    const isAsync = sigLine.includes('async ');
    
    parts.push(`export function _${name}(this: GameScene): void {`);
    parts.push(body);
    parts.push(`}`);
    parts.push('');
  }
  
  const outPath = join(SYS, `${filename}.ts`);
  writeFileSync(outPath, parts.join('\n'), 'utf8');
  console.log(`Wrote ${outPath} (${parts.length} lines)`);
}

// ===== 更新主文件 =====
// 将提取出的方法体替换为薄壳委托
const newLines = [];
let skipUntil = 0;
let importSectionInserted = false;

for (let i = 0; i < lines.length; i++) {
  const lineNum = i + 1;
  
  // 如果正在跳过方法体
  if (lineNum < skipUntil) continue;
  
  // 检查这一行是否是某个要移动的方法的起始行
  let matchedMethod = null;
  for (const name of movedMethods) {
    if (methods[name] === lineNum) {
      matchedMethod = name;
      break;
    }
  }
  
  if (matchedMethod) {
    const indent = getIndent(lineNum);
    const sigLine = getLine(lineNum);
    const isAsync = sigLine.includes('async ');
    
    // 创建薄壳方法
    const asyncPrefix = isAsync ? 'async ' : '';
    // 保留原始方法签名但替换方法体
    const sig = sigLine.replace(/\{.*/, '{');
    const endLine = findMethodEnd(lineNum);
    if (endLine <= lineNum) { newLines.push(sigLine); continue; }
    
    // 简化为一行调用
    const callExpr = `_${matchedMethod}(${isAsync ? 'await ' : ''}this as any)`;
    if (sigLine.trimEnd().endsWith('{')) {
      newLines.push(`${indent}${sigLine.trimEnd().replace(/\s*\{/, '')} { ${callExpr}; }`);
    } else {
      newLines.push(`${indent}${sigLine.trimEnd()} { ${callExpr}; }`);
    }
    
    skipUntil = endLine;
    continue;
  }
  
  // 在文件末尾插入 import
  if (i === lines.length - 1 && !importSectionInserted) {
    newLines.push(lines[i]);
    newLines.push('');
    newLines.push('// ===== 子模块委托（由 split_gamescene.mjs 生成） =====');
    for (const filename of Object.keys(groups)) {
      newLines.push(`import { ${groups[filename].map(n => '_' + n).join(', ')} } from './systems/${filename}';`);
    }
    importSectionInserted = true;
  } else {
    newLines.push(lines[i]);
  }
}

writeFileSync(join(SRC, 'GameScene.ts'), newLines.join('\n'), 'utf8');
console.log(`\nUpdated GameScene.ts (${newLines.length} lines)`);
console.log('Done! Run npx tsc --noEmit to verify.');
