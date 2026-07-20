/**
 * GameState 核心模块 — 基础数据、坐标、等级、金币、重置
 */
import { Inventory } from '../items/Inventory';
import { Kido } from '../combat/Kido';
import { Constructor } from '../../core/types';

export function GameStateCoreMixin<TBase extends Constructor>(Base: TBase) {
  return class GameStateCore extends Base {
    playerName = '隐世';
    zone = 1;
    discoveredZones: number[] = [1];
    // 公会（客户端缓存，进房后由 REST 拉取；实时聊天不依赖此）
    guildId: number | null = null;
    guildName = '';
    guildRank: 'leader' | 'elder' | 'member' | '' = '';
    // 公会成长（v2）：进房由 REST 拉取缓存，战斗属性计算时读取加成
    guildLevel = 1;
    guildExp = 0;
    guildExpCap = 0;
    guildContribution = 0;      // 公会贡献池
    guildMyContribution = 0;    // 个人累计贡献
    guildSkills: Record<string, number> = {};
    /** 好友系统（客户端缓存，面板打开/收到 friendNotify 时由 REST 拉取） */
    friendList: Array<{ charId: number; name: string; online: boolean; location: string }> = [];
    friendRequests: Array<{ charId: number; name: string }> = [];
    friendOnline: Record<number, boolean> = {};
    /** 拍卖行（客户端缓存，收到 auctionData 消息时由 GameRoom 写入；面板据此渲染） */
    auctionData: any = null;
    /** 统一聊天记录：多频道（world/guild/team/whisper/system/event）合并，按 channel 分流展示 */
    chatLog: Array<{ channel: string; fromName: string; fromCharId: number; text: string; ts: number }> = [];
    level = 1;
    exp = 0;
    statPoints = 0;
    hasCreated = false;
    newGame = false;
    gold = 0;
    x = 400;
    y = 500;

    /** 重置核心数据 */
    resetCore(): void {
      this.playerName = '';
      this.level = 1; this.exp = 0; this.statPoints = 0;
      this.gold = 0; this.x = 400; this.y = 500; this.zone = 1;
      this.hasCreated = false; this.newGame = true;
      this.discoveredZones = [1];
      this.guildId = null; this.guildName = ''; this.guildRank = ''; this.chatLog = [];
      this.guildLevel = 1; this.guildExp = 0; this.guildExpCap = 0;
      this.guildContribution = 0; this.guildMyContribution = 0; this.guildSkills = {};
      this.friendList = []; this.friendRequests = []; this.friendOnline = {};
      this.auctionData = null;
      Inventory.reset();
      Kido.reset();
    }
  };
}
