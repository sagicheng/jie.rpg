// Region 4 — 润林安
import type { ZoneConfig } from './types';
import { shop } from './shop';
  export const zone04: ZoneConfig = {
    id: 4, name: '润林安',
    backgroundImage: 'bg_zone_04',
    backgroundMode: 'cover',
    groundColor: 0x665544,
    npcs: [
      { x: 0.5, y: 0.2, id: 'npc_m04', role: 'merchant', dialogue: [
        { text: '花火和武器都在我这。流魂街最好的装备店！', choices: [{ text: '交易', callback: 'openShop' }] },
      ],
      shop: shop(2, '流魂', ['leather_hat', 'leather_armor', 'leather_bracer', 'leather_boots', 'leather_belt', 'copper_ring', 'bone_necklace', 'leather_charm', 'feather_pendant']) },
      { x: 0.75, y: 0.5, id: 'npc_q04', role: 'quest', dialogue: [
        { text: '喂！新人！想进静灵庭？先打几场让我看看你的本事！', choices: [
          { text: '接受任务', callback: 'acceptQuest' },
        ]},
      ]},
      { x: 0.2, y: 0.85, id: 'sys_return', role: 'return_point', dialogue: [
        { text: '流魂街的传送据点。', choices: [{ text: '使用传送', callback: 'openReturn' }] },
      ]},
      { x: 0.5, y: 0.3, id: 'sys_craft', role: 'craft', dialogue: [
        { text: '嗡……古老制造阵法的遗存。', choices: [{ text: '打开制造', callback: 'openCraft' }] },
      ]},
      { x: 0.5, y: 0.55, id: 'sys_board', role: 'quest_board', dialogue: [
        { text: '今日与本周的委托都张贴在这里。完成它们能稳定获取金币与经验。', choices: [
          { text: '查看任务板', callback: 'openQuestBoard' }, { text: '离开', callback: 'closeDialogue' },
        ]},
      ]},
      { x: 0.55, y: 0.38, id: 'npc_f04', role: 'enhance', dialogue: [{ text: '装备的强化、精炼、分解都交给我吧。好的装备是战斗的基础。', choices: [{ text: '打开强化工坊', callback: 'openEnhance' }, { text: '离开', callback: 'closeDialogue' }] },] },
      { x: 0.35, y: 0.4, id: 'npc_s13', role: 'side_quest', dialogue: [
        { text: '我需要5株灵木来制作新的武器配饰。帮我收集一些。' },
      ]},
      { x: 0.7, y: 0.2, id: 'npc_s14', role: 'side_quest', dialogue: [
        { text: '流魂街的强盗越来越嚣张了。帮我清理几个。' },
      ]},
      { x: 0.85, y: 0.7, id: 'npc_s15', role: 'lore', dialogue: [
        { text: '斩魄刀是死神的灵魂。始解的试炼在静灵庭南侧……去那里吧。' },
        { text: '我见过无数把斩魄刀。每把都有自己的故事——你也会找到属于你的。' },
      ]},
      { x: 0.25, y: 0.6, id: 'npc_s16', role: 'lore', dialogue: [
        { text: '你也有斩魄刀吗？每把刀都有自己的名字。呼唤它，它就会回应。' },
        { text: '始解是斩魄刀的第一次解放。你需要完成试炼才能听到刀的声音。' },
      ]},

    ],
    enemies: [

      { name: 'm_sl_thug', type: '杂妖', element: '土', x: 0.3, y: 0.2 },
      { name: 'm_sl_thug', type: '杂妖', element: '土', x: 1.5, y: 0.3 }, { name: 'm_berserk_void', type: '杂妖', element: '无', x: 0.7, y: 0.5 },
      { name: 'm_berserk_void', type: '杂妖', element: '无', x: 1.9, y: 0.7 }, { name: 'm_rebel_grunt', type: '杂妖', element: '无', x: 2.2, y: 0.4 },
      { name: 'm_rebel_grunt', type: '杂妖', element: '无', x: 0.5, y: 0.75 }, { name: 'm_sl_thug', type: '杂妖', element: '土', x: 2.5, y: 0.6 },
      { name: 'm_berserk_void', type: '杂妖', element: '无', x: 1.2, y: 0.8 }, { name: 'm_gillian', type: '恶妖', element: '无', x: 2.8, y: 0.3 },
      { name: 'm_rebel_grunt', type: '杂妖', element: '无', x: 0.9, y: 0.15 },
      // ── 区域Boss（萧隆·库方） ──
      { name: 'b_cirucci', type: '妖将', element: '风', x: 0.93, y: 0.88, isBoss: true },
      { name: 'm_sl_thug', type: '杂妖', element: '土', x: 0.07, y: 0.08 },
      { name: 'm_berserk_void', type: '杂妖', element: '无', x: 0.52, y: 0.34 },
      { name: 'm_rebel_grunt', type: '杂妖', element: '无', x: 0.93, y: 0.66 },
      { name: 'm_sl_thug', type: '杂妖', element: '土', x: 0.28, y: 0.1 },
      { name: 'm_berserk_void', type: '杂妖', element: '无', x: 0.71, y: 0.33 },
      { name: 'm_rebel_grunt', type: '杂妖', element: '无', x: 0.05, y: 0.92 },
      { name: 'm_sl_thug', type: '杂妖', element: '土', x: 0.49, y: 0.09 },
      { name: 'm_berserk_void', type: '杂妖', element: '无', x: 0.94, y: 0.37 },
      { name: 'm_rebel_grunt', type: '杂妖', element: '无', x: 0.27, y: 0.89 },
      { name: 'm_sl_thug', type: '杂妖', element: '土', x: 0.7, y: 0.08 },
      { name: 'm_berserk_void', type: '杂妖', element: '无', x: 0.05, y: 0.64 },
      { name: 'm_rebel_grunt', type: '杂妖', element: '无', x: 0.52, y: 0.92 },
      { name: 'm_sl_thug', type: '杂妖', element: '土', x: 0.95, y: 0.08 },
      { name: 'm_berserk_void', type: '杂妖', element: '无', x: 0.28, y: 0.67 },
      { name: 'm_rebel_grunt', type: '杂妖', element: '无', x: 0.72, y: 0.89 },
      { name: 'm_sl_thug', type: '杂妖', element: '土', x: 0.07, y: 0.38 },
      { name: 'm_berserk_void', type: '杂妖', element: '无', x: 0.48, y: 0.66 },
      { name: 'm_rebel_grunt', type: '杂妖', element: '无', x: 0.93, y: 0.92 },
      { name: 'm_sl_thug', type: '杂妖', element: '土', x: 0.27, y: 0.36 },
      { name: 'm_berserk_void', type: '杂妖', element: '无', x: 0.7, y: 0.64 },
      { name: 'm_rebel_grunt', type: '杂妖', element: '无', x: 0.05, y: 0.08 },
      { name: 'm_gillian', type: '恶妖', element: '无', x: 0.47, y: 0.39 },
      { name: 'm_gillian', type: '恶妖', element: '无', x: 0.93, y: 0.61 },
      { name: 'm_gillian', type: '恶妖', element: '无', x: 0.3, y: 0.1 },
      { name: 'm_gillian', type: '恶妖', element: '无', x: 0.74, y: 0.39 },
      { name: 'm_gillian', type: '恶妖', element: '无', x: 0.07, y: 0.9 },
      { name: 'm_gillian', type: '恶妖', element: '无', x: 0.49, y: 0.08 },
      { name: 'm_gillian', type: '恶妖', element: '无', x: 0.92, y: 0.38 },
    ],
    gathering: [
      { x: 0.15, y: 0.25, type: '灵木' },
      { x: 0.4, y: 0.35, type: '矿脉' },
      { x: 0.65, y: 0.55, type: '药草' },
      { x: 0.85, y: 0.8, type: '灵木' },
      { x: 1.2, y: 0.3, type: '矿脉' },
      { x: 1.5, y: 0.7, type: '药草' },
      { x: 1.8, y: 0.4, type: '灵木' },
      { x: 2.2, y: 0.8, type: '矿脉' },
      { x: 2.6, y: 0.25, type: '药草' },
      { x: 0.3, y: 0.65, type: '灵脉' },
      { x: 1.7, y: 0.15, type: '灵木' },
      { x: 2, y: 0.6, type: '灵脉' },
      { x: 0.05, y: 0.08, type: '灵木' },
      { x: 0.5, y: 0.33, type: '矿脉' },
      { x: 0.92, y: 0.64, type: '药草' },
      { x: 0.29, y: 0.1, type: '灵木' },
      { x: 0.71, y: 0.36, type: '矿脉' },
      { x: 0.05, y: 0.91, type: '药草' },
      { x: 0.53, y: 0.09, type: '灵木' },
      { x: 0.92, y: 0.39, type: '矿脉' },
      { x: 0.26, y: 0.92, type: '药草' },
      { x: 0.75, y: 0.1, type: '灵脉' },
      { x: 0.05, y: 0.67, type: '灵木' },
      { x: 0.5, y: 0.92, type: '灵脉' },
      { x: 0.95, y: 0.08, type: '灵木' },
      { x: 0.3, y: 0.65, type: '矿脉' },
    ],
    exits: [
      { edge: 'south', x: 0.5, y: 0.97, targetZone: 3, targetX: 0.5, targetY: 0.05 },
      { edge: 'east', x: 0.97, y: 0.5, targetZone: 5, targetX: 0.08, targetY: 0.5 },
    ],
  };
