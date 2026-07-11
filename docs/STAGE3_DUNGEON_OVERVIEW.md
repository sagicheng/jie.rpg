# 阶段③ 独立副本系统 —— 实现概览

> 提交：`aa43f50`（本地 multiplayer 分支，未 push）
> 验证：server/client `tsc --noEmit` 0 错 · `vite build` 成功 · `scripts/test_dungeon.ts` 24/24 PASS

## 设计要点（用户拍板）
- 《解》是**多人**游戏、可实时组队：副本 = 独立实例房间，**支持多人同副本**。
- **掉线可续打**：副本进度存服务端 `WorldService`，`DungeonRoom.onLeave` 不清进度，断连不丢。
- 入口：21 区域各一个副本传送阵（数据驱动）；**右上小地图紫色菱形光标标传送阵**。地图 N → 副本 N。
- 结构：每副本 3 阶（stage1 小怪全清→领奖1；stage2 精英→领奖2；stage3 BOSS→领奖3），stage 间传送。
- 难度/刷新：**每周 3 次，副本共享**，按"进入"计次。
- 奖励：每阶通关各领一次（gold/exp/loot，按区 PL 缩放）。

## 关键文件
| 文件 | 作用 |
|------|------|
| `server/DungeonRegistry.ts` | 进程内 room 注册表，供 BattleRoom 回调 DungeonRoom |
| `server/rooms/DungeonRoom.ts` | 副本实例（filterBy dungeonId），onJoin 调 `enterDungeon`，onLeave 不清进度，onStageCleared 推进 stage |
| `server/world.ts` | `ActiveDungeon` + `dungeonWeekly/dungeon` 字段 + `enterDungeon`/`completeDungeon` + `DUNGEON_WEEKLY_CAP=3` |
| `server/schema.ts` | `DungeonRoomState`/`DungeonPlayer` |
| `server/rooms/BattleRoom.ts` | `dungeonStage>0` 分支 → `dungeonStageReward` + `completeDungeon` + `DungeonRegistry.get(roomId).onStageCleared` |
| `src/systems/BattleData.ts` | `dungeonStageReward(dungeonId, stage)` 按区缩放 |
| `src/systems/Zones.ts` | `dungeonPortal` + `getDungeonPortal` 默认兜底 |
| `src/systems/WorldClient.ts` | 镜像 `dungeonProgress`/`dungeonWeekly` |
| `src/systems/dungeon.ts` | 纯函数 `buildDungeonParty`/`buildClientBattleLoadout` |
| `src/scenes/GameScene.ts` | 传送阵渲染 + 小地图光标 + `checkDungeonPortal` + F 进副本 |
| `src/scenes/DungeonScene.ts` | 连 dungeon 房 · F 开战 · `onMultiBattleEnd` 回写 |
| `src/scenes/MultiBattleScene.ts` | `dungeonId/stage/roomId/returnScene` + `battleMonsterId=dungeon:ID:阶` |
| `src/main.ts` | 注册 `DungeonScene` |

## 计次规则（已单测覆盖）
- 同副本续打 → 免费（`resumed=true`，不计次）
- 不同/新副本 → 计 1 次，`remaining = 3 - count`
- 满 3 次 → 拒新进入（保留活动副本进度）
- 通关 → 清活动副本，周次不退
- 跨周（`weekStr` 变更）→ 自动重置次数

## 待办（推荐后续）
- **端到端浏览器双标签实测**（参照 Stage C 21/21）：验证 DungeonRoom 接战 → 三阶推进 → 断连重连续打。本轮仅做了服务端计次单测 + 类型/构建验证。
