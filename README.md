# 《解》Cocos Creator 客户端 · P1 联网验证工程

> 目标：**先把引擎跑通**——在 Cocos 编辑器里连上你已有的 Colyseus 服务器，验证「操作空间」到位。
> 美术你后续自己画，本工程用代码绘制的占位圆点，所有渲染节点运行时创建、不绑定预制体，方便你随时替换真实美术。

## 一、装引擎（这一步必须你本人做，我无法在环境里跑 GUI 安装）

1. 打开官方下载页：**https://www.cocos.com/creator-download**
2. 下载并安装 **Cocos Dashboard**（一个小型启动器）。
3. 打开 Dashboard → 「编辑器」标签 → 选 **Cocos Creator 3.8.x** → 下载安装（首次会让你登录 Cocos 账号，免费）。
4. 安装时把编辑器装到任意盘均可（工程在 `E:\cocos\jie-cocos`，与编辑器安装位置无关）。

## 二、打开工程并跑起来（约 2 分钟）

1. Dashboard → 「项目」→ 「导入」→ 选择 `E:\cocos\jie-cocos`（或者直接「打开」该文件夹）。
2. 在 **资源管理器** 里右键 → 新建 → **场景(Scene)**，命名 `Main`，双击打开。
3. 在 **层级管理器** 里选中 `Canvas`，右键 → 创建空节点，命名 `GameManager`。
4. 选中 `GameManager` 节点，在 **属性检查器** 点「添加组件」→ 脚本 → 选 `GameManager`（运行时自动登录+连房+渲染）。
5. 在 `Main` 场景上右键 → **设为启动场景**。
6. 点编辑器顶部 **预览(Preview)**（浏览器）。先确认你的服务器已在跑：`E:\My2ddemo\game` 下 `npm run dev:server`（监听 `ws://localhost:2567`）。

打开浏览器后应当看到：深色背景、一个绿色圆点（你）、可选的其他在线玩家、两个红色怪物圆点，左上角状态栏显示「已连接 · 自身 xxxx」。

## 三、P1 演示内容（全走真实服务器）

- **移动**：WASD 或 方向键 移动自己的圆点，位置实时同步给同房其他客户端。
- **怪物开战**：鼠标点怪物圆点 → 客户端发 `enterBattle` → 服务器锁定该怪 → 圆点变黄（busy）；1.2s 后演示 `killMonster` → 变灰（dead）→ 30s 后自动刷新回红。
- **多人**：再开一个浏览器标签页 Preview，会看到第二个玩家圆点，互相位置同步。
- **属性面板**：选中 `GameManager` 节点可改 `serverPort` / `title` / `debugNet`（这就是你要的「操作空间」）。

## 四、联机协议速查（已对齐 server/api/GameRoom.ts）

| 项 | 值 |
|---|---|
| 房间名 | `game`（共享地图，权威状态） |
| 进房参数 | `{ token, characterId, title }`（缺 token/characterId 会被踢） |
| 登录 REST | `POST /api/register|login|characters|character/create`（同端口 2567，见 server/core/auth.ts） |
| 客户端→服务器消息 | `move{x,y}` / `enterBattle{id}` / `killMonster{id,respawnMs}` / `chat{channel,text}` / `intent{...}` |
| 服务器→客户端 | `worldSync(pw)` / `chat(...)` / `authError(...)` / `teamUpdate` 等 |
| 状态字段 | `players`(MapSchema<GamePlayer>：x,y,color,name,teamId,battling) · `monsters`(MapSchema<MonsterState>：state,owner,respawnAt) |

客户端库：`colyseus.js 0.15.28`（UMD 包放在 `assets/libs/colyseus.js`，作为插件脚本注入全局 `Colyseus`，与服务器 Colyseus 0.15 一致，已验证可连）。

## 五、已知注意 & 下一步

- **坐标**：服务器与 Cocos Canvas 同为「原点左下、y 向上」，无需转换。
- **占位美术**：圆点是 `Graphics` 画的，你画好真实精灵后，把 `addPlayer`/`spawnDemoMonsters` 里的 `Graphics` 换成 `Sprite`（挂你的 SpriteFrame）即可，联机逻辑一行不动。
- **真实账号**：`AuthService.ensureSession()` 现在是自动注册 dev 账号；正式登录 UI 上线后替换它即可（依然调用那几个 `/api` 接口）。
- **后续**：P2 接战斗房间(`battle`)、P3 接副本(`dungeon`)、P4 把你的真实美术与 Tilemap 进来。

> 本工程尚未纳入 git（独立文件夹）。需要版本管理时在此目录 `git init` 即可。
