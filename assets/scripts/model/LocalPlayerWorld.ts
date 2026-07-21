/**
 * 本地玩家世界单例（L0 地基）。
 *
 * worldSync 由服务端每秒强推全量 PlayerWorld（见 ColyseusBridge.onWorldSync）。
 * 任何系统（属性面板/背包/战斗/任务）都从这里读自己角色的数据，
 * 不要各写一份缓存——服务端是唯一真相，本地只是镜像。
 */
import { PlayerWorld, DerivedStats, deriveStats } from './PlayerWorld';

export class LocalPlayerWorld {
  private static _inst: LocalPlayerWorld | null = null;
  static get instance(): LocalPlayerWorld {
    if (!this._inst) this._inst = new LocalPlayerWorld();
    return this._inst;
  }

  private pw: PlayerWorld | null = null;

  /** 用服务端推送的全量 PlayerWorld 覆盖本地镜像。 */
  update(pw: PlayerWorld): void {
    this.pw = pw;
  }

  /** 是否已收到第一份 worldSync（面板/背包打开前应确保为 true）。 */
  hasData(): boolean {
    return !!this.pw;
  }

  /** 读当前 PlayerWorld 镜像（只读，勿篡改）。 */
  get(): PlayerWorld | null {
    return this.pw;
  }

  /** 派生战斗属性（基础 + 分配 + 装备 + 鬼道被动...）。 */
  getDerived(): DerivedStats | null {
    return this.pw ? deriveStats(this.pw) : null;
  }

  /** 便捷读取自己当前等级。 */
  get level(): number {
    return this.pw?.level || 1;
  }

  get gold(): number {
    return this.pw?.gold || 0;
  }

  get statPoints(): number {
    return this.pw?.statPoints || 0;
  }
}
