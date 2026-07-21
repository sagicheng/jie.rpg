/**
 * 美术资源清单（单一事实来源）
 *
 * AI 生成的 2D 卡通风格素材，按 key 接入 Phaser 预加载管线（见 BootScene）。
 * 路径相对 public/ 根目录（Vite 静态服务，构建时原样拷贝到 dist/）。
 *
 * 重要：贴图分辨率与场景内 setDisplaySize / 物理碰撞体数值绑定。
 * 若更换图片或改变生成分辨率，需同步调整对应精灵的显示尺寸与 body。
 */

export interface AssetImage {
  /** Phaser 纹理 key，与场景中 this.add.sprite(x, y, key) 对应 */
  key: string;
  /** public/ 下的相对路径 */
  path: string;
}

export const ASSET_IMAGES: AssetImage[] = [
  { key: 'player', path: 'assets/characters/player.png' },
  { key: 'enemy', path: 'assets/monsters/enemy.png' },
  { key: 'bg_battle', path: 'assets/backgrounds/bg_battle.png' },
  { key: 'bg_town', path: 'assets/backgrounds/bg_town.png' },
];
