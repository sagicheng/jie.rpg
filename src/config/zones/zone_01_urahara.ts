// Region 1 — 浦原商店街
import type { ZoneConfig } from './types';
import { shop } from './shop';
  export const zone01: ZoneConfig = {
    id: 1, name: '浦原商店街',
    groundColor: 0x556688, roadColor: 0x777799, treeColor: 0x334455,
    backgroundImage: 'bg_town',
    backgroundMode: 'cover',
    decorations: [
      { type: 'house', x: 0.35, y: 0.4, w: 180, h: 120 },
      { type: 'house', x: 0.25, y: 0.2, w: 120, h: 80 },
      { type: 'house', x: 0.65, y: 0.7, w: 100, h: 70 },
      { type: 'house', x: 0.75, y: 0.3, w: 110, h: 75 },
      { type: 'pond', x: 0.15, y: 0.6, w: 100, h: 70 },
    ],
    // 拼接装饰：把不同图片摆在不同坐标，组成场景。坐标为 0..1 归一化（×地图宽高 5760×2160）。
    // 当前用 BootScene 生成的占位纹理演示；你出图后把 image 换成真实美术 key 即可。
    props: [
      { image: 'deco_tree', x: 0.18, y: 0.62, scale: 1.6 },
      { image: 'deco_tree', x: 0.62, y: 0.82, scale: 2.4 },
      { image: 'deco_tree', x: 0.85, y: 0.62, scale: 1.8 },
      { image: 'deco_rock', x: 0.34, y: 0.72, scale: 1.3 },
      { image: 'deco_rock', x: 0.78, y: 0.22, scale: 1.1 },
    ],
    npcs: [
      { x: 0.4, y: 0.45, name: '浦原喜助', role: 'merchant', dialogue: [
        { speaker: '浦原喜助', text: '哟，新来的灵魂啊。我这店里什么都有——从义魂丸到斩魄刀保养工具。', choices: [
          { text: '交易', callback: 'openShop' }, { text: '聊聊', callback: 'closeDialogue' },
        ]},
      ],
      shop: shop(1, '义魂', ['cloth_hat', 'cloth_armor', 'cloth_bracer', 'cloth_boots', 'cloth_belt', 'iron_ring', 'hemp_necklace', 'wood_charm', 'cloth_pendant']) },
      { x: 0.7, y: 0.5, name: '黑崎一护(残影)', role: 'lore', dialogue: [
        { speaker: '黑崎一护(残影)', text: '你也能看见虚吗？那就说明你有死神的力量。去流魂街找斩魄刀吧。' },
        { speaker: '黑崎一护(残影)', text: '我曾经的同伴们——露琪亚、茶渡、井上……他们都在尸魂界。' },
      ]},
      { x: 0.85, y: 0.8, name: '有泽龙贵', role: 'quest', dialogue: [
        { speaker: '有泽龙贵', text: '最近镇上虚的出没越来越频繁了。你能帮忙清理一些吗？', choices: [
          { text: '接受任务', callback: 'acceptQuest' }, { text: '暂时没空', callback: 'closeDialogue' },
        ]},
      ]},
      { x: 0.9, y: 0.3, name: '穿界门', role: 'return_point', dialogue: [
        { speaker: '穿界门', text: '浦原商店地下的穿界门——通往尸魂界的通道。', choices: [{ text: '使用传送', callback: 'openReturn' }] },
      ]},
      { x: 0.5, y: 0.3, name: '神奇的魔法阵', role: 'craft', dialogue: [
        { speaker: '魔法阵', text: '嗡……古老制造阵法的遗存。', choices: [{ text: '打开制造', callback: 'openCraft' }] },
      ]},
      { x: 0.62, y: 0.42, name: '任务公告板', role: 'quest_board', dialogue: [
        { speaker: '任务公告板', text: '今日与本周的委托都张贴在这里。完成它们能稳定获取金币与经验。', choices: [
          { text: '查看任务板', callback: 'openQuestBoard' }, { text: '离开', callback: 'closeDialogue' },
        ]},
      ]},
      { x: 0.55, y: 0.38, name: '浦原铁匠', role: 'enhance', dialogue: [{ speaker: '浦原铁匠', text: '装备的强化、精炼、分解都交给我吧。好的装备是战斗的基础。', choices: [{ text: '打开强化工坊', callback: 'openEnhance' }, { text: '离开', callback: 'closeDialogue' }] },] },
      { x: 0.15, y: 0.25, name: '紬屋雨', role: 'side_quest', dialogue: [
        { speaker: '紬屋雨', text: '浦原店长让我收集药材……你能帮我采集5株药草吗？' },
      ]},
      { x: 0.3, y: 0.75, name: '花刈甚太', role: 'side_quest', dialogue: [
        { speaker: '花刈甚太', text: '喂！帮我赶走几只低级虚，我请你喝汽水！' },
      ]},
      { x: 0.55, y: 0.8, name: '启吾', role: 'side_quest', dialogue: [
        { speaker: '启吾', text: '我妹妹的护身符被虚抢走了……帮我对付几只虚拿回来。' },
      ]},
      { x: 0.2, y: 0.5, name: '魂', role: 'lore', dialogue: [
        { speaker: '魂', text: '我可是改造魂魄！一护大哥的斩魄刀超帅的对吧？' },
        { speaker: '魂', text: '流魂街是死神的故乡。去那里能找到属于你的斩魄刀。' },
      ]},
      { x: 0.75, y: 0.15, name: '观音寺', role: 'lore', dialogue: [
        { speaker: '观音寺', text: 'BWAHAHAHA！我是空座町的守护灵媒——唐·观音寺！' },
        { speaker: '观音寺', text: '虚是恶灵。但真正的敌人隐藏在更深处——虚圈的深处。' },
      ]},
      { x: 0.45, y: 0.65, name: '井上织姬(残影)', role: 'lore', dialogue: [
        { speaker: '井上织姬(残影)', text: '我拒绝的力量——"双天归盾"。那是能将一切还原的力量。' },
        { speaker: '井上织姬(残影)', text: '曾经有人对我说过，你的力量不是为了伤害，而是为了保护。' },
      ]},
    ],
    enemies: [

      // 第一屏（左）
      { name: '低级虚', type: '杂妖', element: '无', x: 0.08, y: 0.12 },
      { name: '蛇虚', type: '杂妖', element: '土', x: 0.15, y: 0.35 },
      { name: '低级虚', type: '杂妖', element: '无', x: 0.22, y: 0.65 },
      { name: '飞虚', type: '杂妖', element: '风', x: 0.28, y: 0.22 },
      { name: '蛇虚', type: '杂妖', element: '土', x: 0.12, y: 0.78 },
      { name: '低级虚', type: '杂妖', element: '无', x: 0.32, y: 0.50 },
      { name: '飞虚', type: '杂妖', element: '风', x: 0.18, y: 0.88 },
      // 第二屏（中）
      { name: '低级虚', type: '杂妖', element: '无', x: 0.40, y: 0.15 },
      { name: '蛇虚', type: '杂妖', element: '土', x: 0.45, y: 0.45 },
      { name: '大虚·基利安', type: '恶妖', element: '无', x: 0.50, y: 0.30 },
      { name: '飞虚', type: '杂妖', element: '风', x: 0.55, y: 0.70 },
      { name: '低级虚', type: '杂妖', element: '无', x: 0.48, y: 0.85 },
      { name: '蛇虚', type: '杂妖', element: '土', x: 0.42, y: 0.60 },
      { name: '大虚·基利安', type: '恶妖', element: '无', x: 0.58, y: 0.50 },
      // 第三屏（右）
      { name: '低级虚', type: '杂妖', element: '无', x: 0.65, y: 0.18 },
      { name: '飞虚', type: '杂妖', element: '风', x: 0.72, y: 0.40 },
      { name: '蛇虚', type: '杂妖', element: '土', x: 0.68, y: 0.75 },
      { name: '大虚·基利安', type: '恶妖', element: '无', x: 0.78, y: 0.25 },
      { name: '低级虚', type: '杂妖', element: '无', x: 0.85, y: 0.60 },
      { name: '飞虚', type: '杂妖', element: '风', x: 0.82, y: 0.85 },
      { name: '蛇虚', type: '杂妖', element: '土', x: 0.75, y: 0.55 },
      { name: '低级虚', type: '杂妖', element: '无', x: 0.90, y: 0.35 },
      // ── 区域Boss（右下角） ──
      { name: '葛兰德·费舍尔', type: '妖将', element: '无', x: 0.93, y: 0.88, isBoss: true },
      { name: '低级虚', type: '杂妖', element: '无', x: 0.06, y: 0.08 },
      { name: '蛇虚', type: '杂妖', element: '土', x: 0.49, y: 0.36 },
      { name: '飞虚', type: '杂妖', element: '风', x: 0.93, y: 0.66 },
      { name: '低级虚', type: '杂妖', element: '无', x: 0.29, y: 0.08 },
      { name: '蛇虚', type: '杂妖', element: '土', x: 0.72, y: 0.33 },
      { name: '飞虚', type: '杂妖', element: '风', x: 0.05, y: 0.92 },
      { name: '大虚·基利安', type: '恶妖', element: '无', x: 0.5, y: 0.1 },
      { name: '大虚·基利安', type: '恶妖', element: '无', x: 0.94, y: 0.35 },
    ],
    gathering: [
      { x: 0.1, y: 0.2, type: '矿脉' },
      { x: 0.3, y: 0.5, type: '药草' },
      { x: 0.6, y: 0.8, type: '矿脉' },
      { x: 0.9, y: 0.25, type: '药草' },
      { x: 1.2, y: 0.7, type: '矿脉' },
      { x: 1.5, y: 0.15, type: '药草' },
      { x: 1.8, y: 0.45, type: '灵木' },
      { x: 2.1, y: 0.8, type: '药草' },
      { x: 2.5, y: 0.3, type: '矿脉' },
      { x: 2.8, y: 0.65, type: '灵木' },
      { x: 0.45, y: 0.35, type: '灵脉' },
      { x: 2.2, y: 0.25, type: '药草' },
      { x: 0.05, y: 0.11, type: '矿脉' },
      { x: 0.51, y: 0.36, type: '药草' },
      { x: 0.94, y: 0.65, type: '矿脉' },
      { x: 0.25, y: 0.08, type: '药草' },
      { x: 0.7, y: 0.37, type: '矿脉' },
      { x: 0.05, y: 0.91, type: '药草' },
      { x: 0.53, y: 0.08, type: '灵木' },
      { x: 0.92, y: 0.37, type: '药草' },
      { x: 0.27, y: 0.9, type: '矿脉' },
      { x: 0.74, y: 0.08, type: '灵木' },
      { x: 0.06, y: 0.65, type: '灵脉' },
      { x: 0.5, y: 0.92, type: '药草' },
    ],
    exits: [
      { edge: 'east', x: 0.97, y: 0.5, targetZone: 2, targetX: 0.08, targetY: 0.5 },
    ],
  };
