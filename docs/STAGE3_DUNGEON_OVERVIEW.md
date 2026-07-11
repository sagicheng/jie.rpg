# 阶段③ 独立副本系统 —— 实现概览

> 验证：server/client `tsc --noEmit` 0 错 · `vite build` 成功 · Playwright 三阶 E2E `btest/dungeon_mirror_e2e.cjs` 全通并正确返回原地图（零 pageerror）

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
| `src/scenes/GameScene.ts` | 传送阵渲染 + 小地图光标 + `enterDungeon(zone)` 切场景（fadeOut→start DungeonMapScene） |
| `src/scenes/DungeonMapScene.ts` | **镜像地图方案主场景**：独立地图（与 GameScene 平级，非 overlay），每层重绘+明雷怪；连 dungeon 房、`onDungeonStateChange` 驱动进度、`onMultiBattleEnd` 回写、`transitionToStage` 切层 |
| `src/scenes/MultiBattleScene.ts` | `dungeonId/stage/roomId/returnScene` + `battleMonsterId=dungeon:ID:阶`；战斗结束 SHUTDOWN 时 `resume(returnScene)` |
| `src/main.ts` | 注册 `DungeonMapScene`（替换旧 `DungeonScene`）；DEBUG 钩子 `window.__game` / `__gameState`（Playwright 用，上线前清理） |

## 计次规则（已单测覆盖）
- 同副本续打 → 免费（`resumed=true`，不计次）
- 不同/新副本 → 计 1 次，`remaining = 3 - count`
- 满 3 次 → 拒新进入（保留活动副本进度）
- 通关 → 清活动副本，周次不退
- 跨周（`weekStr` 变更）→ 自动重置次数

## 架构修正（2026-07-11 镜像地图重构）
- **原方案**：`DungeonScene` 作为 `GameScene` 的 overlay 场景；进副本 launch `MultiBattleScene` → **overlay 套 overlay 渲染层级崩坏**，表现为 `phase=combat` 但画面卡在 lobby、F/ESC 无反应。
- **现方案（镜像地图）**：副本 = 一张独立地图场景 `DungeonMapScene`（与 `GameScene` 平级）。进副本 = `scene.start('DungeonMapScene')`；打怪复用现有明雷遇敌 → launch `MultiBattleScene`（暂停副本场景）；胜利后 `MultiBattleScene` SHUTDOWN 自动 `resume('DungeonMapScene')`；领奖→传送阵→`transitionToStage(localStage+1)` 重绘下一层。
- **关键修复 `localStage` 解耦**：`onDungeonStateChange` 曾把 `localStage` 直接覆盖成服务端 `stage`（=已通关层+1），导致打完第 2 阶被误判为第 3 阶、`claimReward` 错发 EXIT 传送阵**跳过 BOSS**。现 `localStage` 始终表示"当前显示/刚通关的层"，通关只触发奖励流程不自增；`transitionToStage(localStage+1)` 才真正推进。最终层（stage3）由服务端 `phase='clear'` 判定，传送阵发 EXIT 返回原地图。

## 待办（推荐后续）
- **端到端联机双标签实测**：验证多人同副本 + 一人通关推进共享 stage + 掉线重连续打（本轮先做单人 Playwright 三阶 E2E 全通）。
- **清理 DEBUG 钩子**：`window.__game` / `window.__gameState` 仅供 Playwright 验证，正式发布前移除（或改 `import.meta.env.DEV` 守卫）。
- 右上小地图紫色菱形光标标副本传送阵：GameScene 已预留 `dungeonPortalPos`，需确认小地图绘制接入。
