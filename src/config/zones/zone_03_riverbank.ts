// Region 3 — 河川敷
import type { ZoneConfig } from './types';
import { shop } from './shop';
  export const zone03: ZoneConfig = {
    id: 3, name: '河川敷',
    backgroundImage: 'bg_zone_03',
    backgroundMode: 'cover',
    groundColor: 0x556688,
    npcs: [
      { x: 0.45, y: 0.35, id: 'npc_m03', role: 'merchant', dialogue: [
        { speaker: '铁云堂', text: '店长让我在这里设摊。河川敷的虚比镇子里强，装备也得跟上。', choices: [{ text: '交易', callback: 'openShop' }] },
      ],
      shop: shop(2, '河川', ['river_hat', 'river_armor', 'river_bracer', 'river_boots', 'river_belt', 'river_ring', 'river_necklace', 'river_charm', 'river_pendant']) },
      { x: 0.7, y: 0.5, id: 'npc_q03', role: 'quest', dialogue: [
        { speaker: '苍山', text: '哦？你也有死神的力量？那去流魂街之前——先帮我清理河川敷的虚！', choices: [
          { text: '接受任务', callback: 'acceptQuest' }, { text: '稍等', callback: 'closeDialogue' },
        ]},
      ]},
      { x: 0.85, y: 0.2, id: 'sys_return', name: '穿界门', role: 'return_point', dialogue: [
        { speaker: '穿界门', text: '河川敷下游的穿界门——通往尸魂界流魂街。', choices: [{ text: '使用传送', callback: 'openReturn' }] },
      ]},
      { x: 0.5, y: 0.3, id: 'sys_craft', name: '神奇的魔法阵', role: 'craft', dialogue: [
        { speaker: '魔法阵', text: '嗡……古老制造阵法的遗存。', choices: [{ text: '打开制造', callback: 'openCraft' }] },
      ]},
      { x: 0.55, y: 0.45, id: 'sys_board', name: '任务公告板', role: 'quest_board', dialogue: [
        { speaker: '任务公告板', text: '今日与本周的委托都张贴在这里。完成它们能稳定获取金币与经验。', choices: [
          { text: '查看任务板', callback: 'openQuestBoard' }, { text: '离开', callback: 'closeDialogue' },
        ]},
      ]},
      { x: 0.55, y: 0.38, id: 'npc_f03', role: 'enhance', dialogue: [{ speaker: '流浪锻', text: '装备的强化、精炼、分解都交给我吧。好的装备是战斗的基础。', choices: [{ text: '打开强化工坊', callback: 'openEnhance' }, { text: '离开', callback: 'closeDialogue' }] },] },
      { x: 0.2, y: 0.7, id: 'npc_s10', role: 'side_quest', dialogue: [
        { speaker: '虚探', text: '我受伤了……帮我采集药草疗伤，我告诉你虚的弱点。' },
      ]},
      { x: 0.65, y: 0.8, id: 'npc_s11', role: 'side_quest', dialogue: [
        { speaker: '流翁', text: '去流魂街需要斩魄刀。帮我收集矿脉，我替你磨一把临时的。' },
      ]},
      { x: 0.15, y: 0.5, id: 'npc_s12', role: 'lore', dialogue: [
        { speaker: '铁裁', text: '斩魄刀——死神灵魂的具现化。浅打是它的初始形态。' },
        { speaker: '铁裁', text: '北边的穿界门通往尸魂界。流魂街是所有灵魂的起点。' },
      ]},
      { x: 0.8, y: 0.65, id: 'npc_s05', role: 'lore', dialogue: [
        { speaker: '魂影', text: '河川敷的虚比镇上强多了！大虚·基利安都出来了。' },
        { speaker: '魂影', text: '去流魂街吧。那里有你觉醒斩魄刀的试炼场。' },
      ]},

    ],
    enemies: [

      { name: 'm_mid_void', type: '杂妖', element: '无', x: 0.14, y: 0.9 },
      { name: 'm_fly_void2', type: '杂妖', element: '风', x: 0.66, y: 0.07 },
      { name: 'm_gillian', type: '恶妖', element: '无', x: 0.22, y: 0.19 },
      { name: 'm_void_swarm', type: '杂妖', element: '无', x: 0.93, y: 0.45 },
      { name: 'm_serpent_void2', type: '杂妖', element: '土', x: 0.5, y: 0.6 },
      { name: 'm_gillian', type: '恶妖', element: '无', x: 0.7, y: 0.3 },
      // ── 区域Boss（梅塔史塔西亚） ──
      { name: 'b_metastacia', type: '妖将', element: '水', x: 0.93, y: 0.88, isBoss: true },
      { name: 'm_mid_void', type: '杂妖', element: '无', x: 0.05, y: 0.08 },
      { name: 'm_fly_void2', type: '杂妖', element: '风', x: 0.47, y: 0.39 },
      { name: 'm_void_swarm', type: '杂妖', element: '无', x: 0.95, y: 0.61 },
      { name: 'm_serpent_void2', type: '杂妖', element: '土', x: 0.27, y: 0.08 },
      { name: 'm_mid_void', type: '杂妖', element: '无', x: 0.75, y: 0.33 },
      { name: 'm_fly_void2', type: '杂妖', element: '风', x: 0.05, y: 0.9 },
      { name: 'm_void_swarm', type: '杂妖', element: '无', x: 0.51, y: 0.08 },
      { name: 'm_serpent_void2', type: '杂妖', element: '土', x: 0.95, y: 0.35 },
      { name: 'm_mid_void', type: '杂妖', element: '无', x: 0.29, y: 0.92 },
      { name: 'm_fly_void2', type: '杂妖', element: '风', x: 0.73, y: 0.08 },
      { name: 'm_void_swarm', type: '杂妖', element: '无', x: 0.05, y: 0.63 },
      { name: 'm_serpent_void2', type: '杂妖', element: '土', x: 0.52, y: 0.91 },
      { name: 'm_mid_void', type: '杂妖', element: '无', x: 0.95, y: 0.08 },
      { name: 'm_fly_void2', type: '杂妖', element: '风', x: 0.3, y: 0.61 },
      { name: 'm_void_swarm', type: '杂妖', element: '无', x: 0.72, y: 0.92 },
      { name: 'm_serpent_void2', type: '杂妖', element: '土', x: 0.06, y: 0.34 },
      { name: 'm_mid_void', type: '杂妖', element: '无', x: 0.52, y: 0.66 },
      { name: 'm_fly_void2', type: '杂妖', element: '风', x: 0.93, y: 0.92 },
      { name: 'm_void_swarm', type: '杂妖', element: '无', x: 0.3, y: 0.36 },
      { name: 'm_serpent_void2', type: '杂妖', element: '土', x: 0.7, y: 0.66 },
      { name: 'm_mid_void', type: '杂妖', element: '无', x: 0.06, y: 0.08 },
      { name: 'm_gillian', type: '恶妖', element: '无', x: 0.53, y: 0.34 },
      { name: 'm_gillian', type: '恶妖', element: '无', x: 0.95, y: 0.67 },
      { name: 'm_gillian', type: '恶妖', element: '无', x: 0.27, y: 0.08 },
    ],
    gathering: [
      { x: 0.39, y: 0.52, type: '矿脉' },
      { x: 0.34, y: 0.07, type: '矿脉' },
      { x: 0.64, y: 0.68, type: '灵木' },
      { x: 0.89, y: 0.33, type: '灵木' },
      { x: 0.55, y: 0.55, type: '灵木' },
      { x: 0.88, y: 0.08, type: '药草' },
      { x: 0.3, y: 0.49, type: '药草' },
      { x: 0.81, y: 0.39, type: '灵脉' },
      { x: 0.05, y: 0.08, type: '矿脉' },
      { x: 0.51, y: 0.36, type: '矿脉' },
      { x: 0.95, y: 0.64, type: '灵木' },
      { x: 0.26, y: 0.09, type: '灵木' },
      { x: 0.74, y: 0.36, type: '灵木' },
      { x: 0.07, y: 0.92, type: '药草' },
      { x: 0.51, y: 0.09, type: '药草' },
      { x: 0.95, y: 0.33, type: '灵脉' },
      { x: 0.29, y: 0.91, type: '矿脉' },
      { x: 0.72, y: 0.08, type: '矿脉' },
      { x: 0.07, y: 0.66, type: '灵木' },
      { x: 0.5, y: 0.92, type: '灵木' },
      { x: 0.95, y: 0.08, type: '灵木' },
      { x: 0.29, y: 0.64, type: '药草' },
      { x: 0.75, y: 0.91, type: '药草' },
      { x: 0.05, y: 0.38, type: '灵脉' },
    ],
    exits: [
      { edge: 'west', x: 0.03, y: 0.5, targetZone: 2, targetX: 0.9, targetY: 0.5 },
      { edge: 'north', x: 0.5, y: 0.03, targetZone: 4, targetX: 0.5, targetY: 0.95 },
    ],
  };
