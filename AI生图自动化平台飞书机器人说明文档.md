# AI生图自动化平台飞书机器人说明文档

本文档说明本项目里的飞书机器人有什么用、怎么配置和使用、什么情况下会掉线，以及掉线后如何恢复。

## 1. 机器人定位

飞书机器人是 `AI生图自动化平台` 的远程值班面板，不是完整后台。

它只负责高频、适合手机端处理的事情：

1. **看状态**
   - 当前是否运行
   - 跑到哪个阶段
   - Legil 保存、失败和队列进度
   - 浏览器和飞书桥接是否正常

2. **接管长跑任务**
   - 继续可恢复任务
   - 暂停创意任务
   - 停止全部页面任务
   - 重试失败 Prompt

3. **处理异常**
   - 查看最近日志
   - 查看浏览器状态
   - 无运行任务时安全重启服务器

4. **接收通知**
   - 队列完成、异常中断、卡住、启动异常等通知

新任务配置、目录选择、模型参数、知识库同步、交付打包确认等操作应在网页端完成。

一句话总结：**飞书端负责值班和止损，网页端负责完整生产配置。**

## 2. 当前项目里的飞书链路

项目里有两套飞书相关链路：

### 2.1 推荐链路：飞书企业自建应用 + lark-cli / SDK 长连接

这是当前主要使用的链路。

相关文件：

| 文件 | 作用 |
| --- | --- |
| `feishu-cli-bridge.js` | 飞书长连接桥接，负责收消息、回消息、发卡片、发通知 |
| `feishu-command-router.js` | 解析飞书文字指令 |
| `feishu-control-service.js` | 把飞书指令转换为本机平台 API 调用 |
| `feishu-card-builder.js` | 构造飞书交互卡片 |
| `feishu-cli-config.js` | 读取飞书 CLI 配置和白名单 |
| `feishu-notification-service.js` | 任务通知、异常通知、冷却控制 |
| `health-monitor.js` | 健康监控、无进展提醒、飞书连接状态提醒 |
| `feishu-watchdog.js` | 外部守护进程，检查服务是否掉线并尝试重启 |

该链路依赖：

- 本机 Node 服务正在运行
- `lark-cli` 已配置独立 profile
- 飞书企业自建应用已启用机器人能力
- 飞书应用已开通消息事件和发消息权限
- 机器人可在当前私聊或控制会话里收发消息
- 当前会话或当前用户在白名单里

### 2.2 兼容链路：Webhook 事件接口

项目里也保留了 `/api/feishu/events` 和 `/api/feishu/notify` 这类接口，用于兼容 webhook 形式的飞书机器人。

但是当前更推荐使用 `feishu-cli` / SDK 长连接链路，因为它支持：

- 更稳定的消息接收
- 消息回复
- 交互卡片
- 自动重连
- 首次绑定
- 本地白名单控制

## 3. 首次配置方法

项目根目录里已经提供了极简配置脚本：

```powershell
.\setup-feishu-ai-platform.bat
```

这个脚本会做这些事：

1. 检查本地服务是否运行。
2. 如果服务没运行，尝试启动 `node server.js`。
3. 写入首次绑定模式。
4. 检查 `ai-image-automation` 这个 lark-cli profile。
5. 如果 profile 不存在，引导你创建飞书企业自建应用。
6. 启动飞书桥接。
7. 提示你在飞书私聊或控制会话里向机器人发送绑定指令。
8. 等你在飞书里发送：

```text
绑定平台
```

绑定成功后，会把当前会话和当前用户写入 `automation-secrets.json`。

注意：`automation-secrets.json` 已经被 `.gitignore` 忽略，不会提交到 Git。

## 4. 手动配置要点

如果不使用配置脚本，也可以手动配置。

### 4.1 创建飞书企业自建应用

建议应用名和机器人名：

```text
AI生图自动化平台
```

如果要另建控制会话，建议命名：

```text
AI生图自动化平台控制台
```

### 4.2 开通权限和事件

至少需要：

- 接收消息事件：`im.message.receive_v1`
- 机器人发送 / 回复消息
- 会话基础信息读取

如果后续需要从飞书消息里下载用户上传的表格、图片或文件，再额外开通文件资源读取权限。

### 4.3 配置 lark-cli profile

本项目推荐固定使用独立 profile：

```text
ai-image-automation
```

配置命令示例：

```bash
lark-cli config init --name ai-image-automation --app-id <APP_ID> --app-secret-stdin --brand feishu
```

项目里的桥接命令都会显式使用：

```bash
lark-cli --profile ai-image-automation ...
```

不会切换或污染全局默认 profile。

### 4.4 配置本地密钥

`automation-secrets.json` 中和飞书相关的常用字段如下：

```json
{
  "feishuCliEnabled": true,
  "feishuCliProfile": "ai-image-automation",
  "feishuCliAllowedChatIds": "oc_xxx",
  "feishuCliAllowedUserIds": "ou_xxx",
  "feishuCliNotifyChatId": "oc_xxx",
  "feishuCliPairingEnabled": false
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `feishuCliEnabled` | 是否随服务器自动启动飞书桥接 |
| `feishuCliProfile` | 使用哪个 lark-cli profile |
| `feishuCliAllowedChatIds` | 允许控制平台的飞书会话 ID，私聊或群聊都可以，多个用英文逗号分隔 |
| `feishuCliAllowedUserIds` | 允许控制平台的用户 open_id，多个用英文逗号分隔 |
| `feishuCliNotifyChatId` | 主动发送通知的飞书会话 ID；私聊机器人可填私聊会话 ID |
| `feishuCliPairingEnabled` | 是否开启首次绑定模式 |

如果没有配置白名单，且没有开启首次绑定模式，桥接服务会拒绝处理消息。

## 5. 启动方式

日常启动平台：

```powershell
npm start
```

等价于：

```powershell
node server.js
```

如果 `feishuCliEnabled=true`，服务启动后会自动启动：

- 飞书 CLI / SDK 桥接
- 健康监控
- watchdog 守护检查

也可以手动启动飞书桥接：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3066/api/feishu-cli/start -Method Post -ContentType 'application/json' -Body '{}'
```

手动停止飞书桥接：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3066/api/feishu-cli/stop -Method Post
```

## 6. 常用飞书指令

日常值班优先使用下面这些指令。

| 指令 | 作用 |
| --- | --- |
| `控制面板` | 发送主控卡片 |
| `生产面板` | 打开创意生产接管卡片 |
| `交付面板` | 打开改尺寸交付接管卡片 |
| `系统面板` | 打开浏览器、日志和重启服务器卡片 |
| `状态` | 查看简洁运行状态 |
| `进度` | 查看当前任务进度 |
| `日志` | 查看最近日志 |
| `浏览器状态` | 查看浏览器和 Legil 页面状态 |
| `继续任务` | 继续当前可恢复任务 |
| `停止全部` | 停止完整工作流、自动创意、Legil 队列和 Agent |
| `继续创意` | 继续创意拓展任务 |
| `暂停创意` | 暂停创意拓展任务 |
| `重试失败Prompt` | 重试当前或最近自动创意 run 的失败 Prompt |
| `继续交付` | 继续改尺寸交付任务 |
| `停止交付` | 停止改尺寸交付任务 |
| `重启服务器` | 二次确认后重启本地 Node 服务；有任务运行时后端会拒绝 |

下面这些高级指令仍可保留给排障使用，但不建议日常直接从飞书触发：

```text
生成Prompt
小批量验证
持续生图
开始量产
知识库状态
素材状态
任务表状态
同步飞书库
导入方向表
重启工作流
```

## 7. 交互卡片

发送这些文字之一：

```text
控制面板
卡片
按钮
菜单
panel
menu
```

机器人会返回一张控制卡片。

### 7.1 主控面板

```text
状态 | 进度
继续任务 | 停止全部
生产面板 | 交付面板
日志 | 系统面板
```

主控面板只保留值班高频动作：看状态、看进度、续跑、止损和进入分面板。

### 7.2 生产面板

```text
生产状态 | 进度
继续创意 | 暂停创意
重试失败 | 日志
主控面板 | 系统面板
```

生产面板用于长跑创意任务的查看、暂停、续跑和失败补跑。新任务启动建议先在网页端确认目录和生成参数。

### 7.3 交付面板

```text
交付状态 | 进度
继续交付 | 停止交付
日志 | 浏览器
主控面板 | 系统面板
```

交付面板用于接管改尺寸交付任务。扫描、开始、标准化和最终打包等配置型操作建议在网页端执行。

### 7.4 系统面板

```text
浏览器 | 日志
重启服务器 | 主控面板
```

系统面板用于查看浏览器和日志，并在无运行任务时安全重启服务器。

如果 SDK 长连接正常，卡片按钮可以直接触发后台动作。

如果 SDK 长连接不可用，但文字消息仍可用，机器人会降级为文字指令模式。此时直接发送文字指令即可。

## 8. 高风险操作：重启服务器

`重启服务器` 用于服务仍能响应、但需要刷新后端状态或恢复飞书桥接异常的场景。

适合使用：

- 飞书桥接异常
- 卡片按钮异常
- 后端状态疑似卡住但 `/api/health` 仍有响应
- 本地服务需要重启以加载代码更新

不适合使用：

- Legil 正在出图
- 创意拓展正在运行
- 改尺寸交付正在运行
- 只是想开始新任务

按钮会先弹出飞书确认框；文字指令会要求输入确认码。后端还会检查是否有任务正在运行，如果有，会拒绝重启。

## 9. 高风险操作：重启工作流

`重启工作流` 需要二次确认。

你发送：

```text
重启工作流
```

机器人会回复类似：

```text
确认重启 4821
```

你必须在 5 分钟内，用同一个飞书会话、同一个用户回复正确确认码：

```text
确认重启 4821
```

确认通过后才会执行。

这样设计是为了避免误触导致任务被停止、恢复状态被清理或工作流被重新开始。

## 10. 飞书通知与异常监控

前端页面里有一块配置区：

```text
飞书通知与异常监控
```

可配置项包括：

| 配置 | 作用 |
| --- | --- |
| 启用飞书异常通知 | 是否允许发飞书通知 |
| 启用队列完成通知 | 创意目标队列全部完成后通知；不会按每个方向逐条通知 |
| 启用启动异常通知 | 服务启动且发现可继续任务或飞书未就绪时通知；普通启动默认静默 |
| 启用卡住提醒 | 任务达到卡住阈值仍无进展时通知一次 |
| 卡住阈值 | 默认 30 分钟 |
| 通知冷却时间 | 默认 10 分钟 |
| Legil异常自动截图并发送 | Legil 出错时是否截图 |
| 启用自动恢复策略 | Legil 异常时是否尝试自动恢复 |
| 连续失败后暂停等待确认 | 连续失败达到阈值后暂停任务 |
| 连续失败阈值 | 默认 3 次 |
| Watchdog掉线自动重启服务 | 服务掉线时是否尝试自动重启 |

默认配置偏安静：普通方向完成、普通服务启动、飞书恢复成功不会通知；队列最终完成和需要处理的异常会通知。

当前通知策略：

- 创意目标队列：所有可运行目标都结束后，只发 1 条“创意队列已完成”。
- 单个方向完成、单个 Legil creative-batch 正常完成：不主动通知。
- 队列暂停、失败、卡住、飞书长连接异常：会通知，便于及时处理。
- 飞书长连接恢复、普通服务启动：不通知，避免私聊里堆太多状态消息。

## 11. 什么时候会掉线

这里的“掉线”分好几种，不同情况表现不一样。

### 10.1 本地服务掉线

表现：

- 打不开 `http://127.0.0.1:3066`
- `/api/health` 请求失败
- 飞书里发 `状态` 没反应
- watchdog 可能发送“自动化平台服务可能已掉线”

常见原因：

- `node server.js` 进程退出
- 电脑睡眠、重启、断电
- 端口 `3066` 被占用
- 代码异常导致服务崩溃
- 手动 Ctrl+C 停止服务
- 安全软件或系统策略结束了 Node 进程

### 10.2 飞书长连接掉线

表现：

- 本地网页还能打开
- 自动化任务可能还在跑
- 飞书收不到指令或回复变慢
- `/api/feishu-cli/status` 中 `ready=false`
- 健康监控可能通知“飞书长连接异常”

常见原因：

- 网络抖动
- 飞书 SDK WebSocket 断开
- 飞书开放平台服务临时异常
- lark-cli profile 凭据过期或损坏
- 飞书应用权限变更
- 机器人无法访问当前控制会话

代码里已经做了自动重连：

- SDK 模式会自动重连
- SDK 启动失败时会回退到 lark-cli 消息桥接
- lark-cli 子进程异常退出后，会按 5 秒到 60 秒退避重连

### 10.3 卡片按钮掉线

表现：

- 发 `状态` 有回复
- 点飞书卡片按钮没反应或提示 token 无效
- `/api/feishu-cli/status` 中 `cardActionReady=false`

常见原因：

- 当前不是 SDK 长连接模式
- 卡片太旧，token 已更新
- 飞书卡片事件没有正常推送
- 机器人权限或事件订阅不完整

恢复方式：

1. 先直接发文字指令，例如 `状态`、`进度`。
2. 如果文字指令可用，说明机器人主体没掉。
3. 再发 `控制面板`，让机器人重新发一张新卡片。
4. 如果仍不可用，就先用文字指令控制。

### 10.4 白名单导致“看起来像掉线”

表现：

- 有些会话里发消息机器人完全不回
- 有些用户发消息机器人回复“你没有权限控制 AI生图自动化平台”

原因：

- 当前会话不在 `feishuCliAllowedChatIds`
- 当前用户不在 `feishuCliAllowedUserIds`
- 首次绑定模式已关闭

这是安全设计，不是故障。

### 10.5 通知掉线

表现：

- 平台还能在网页运行
- 飞书指令可能也能用
- 但队列完成、异常、启动异常通知收不到

常见原因：

- `feishuCliNotifyChatId` 未配置
- 机器人无法向通知会话发消息
- 机器人无发消息权限
- 飞书发送接口超时
- 通知冷却中
- 前端关闭了飞书通知开关

## 12. 掉线后如何恢复

建议按下面顺序排查。

### 11.1 先看本地服务是否还活着

```powershell
Invoke-RestMethod http://127.0.0.1:3066/api/health | ConvertTo-Json -Depth 8
```

如果失败，说明本地服务大概率已经掉了。

恢复：

```powershell
npm start
```

或：

```powershell
node server.js
```

如果端口被占用，先找出旧进程或换端口。

### 11.2 查看飞书桥接状态

```powershell
Invoke-RestMethod http://127.0.0.1:3066/api/feishu-cli/status | ConvertTo-Json -Depth 8
```

重点看：

| 字段 | 含义 |
| --- | --- |
| `bridge.running` | 桥接是否运行 |
| `bridge.ready` | 长连接是否就绪 |
| `bridge.consumerMode` | 当前模式，常见为 `sdk` 或 `lark-cli` |
| `bridge.cardActionReady` | 卡片按钮是否可用 |
| `bridge.lastError` | 最近错误 |
| `validation.success` | 配置是否完整 |
| `validation.warnings` | 配置告警 |

如果桥接未运行，手动启动：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3066/api/feishu-cli/start -Method Post -ContentType 'application/json' -Body '{}'
```

如果启动失败，看返回里的 `message`、`lastError`、`validation.warnings`。

### 11.3 查看 watchdog 状态

```powershell
Invoke-RestMethod http://127.0.0.1:3066/api/watchdog/status | ConvertTo-Json -Depth 8
```

重点看：

| 字段 | 含义 |
| --- | --- |
| `running` | watchdog 是否运行 |
| `serverDown` | watchdog 是否认为服务掉线 |
| `consecutiveFailures` | 连续失败次数 |
| `lastError` | 最近健康检查错误 |
| `lastRestartResult` | 最近一次自动重启结果 |
| `lastRecoveryAt` | 最近恢复时间 |

如果 watchdog 没运行，可以手动启动：

```powershell
npm run watchdog
```

或通过接口：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3066/api/watchdog/start -Method Post
```

### 11.4 服务恢复后继续任务

恢复服务和飞书桥接后，先在飞书里发：

```text
状态
```

再发：

```text
进度
```

如果看到“完整工作流可继续：是”，发送：

```text
继续工作流
```

如果看到“创意拓展可继续：是”，发送：

```text
继续创意拓展
```

如果不确定是哪种任务，发送：

```text
继续任务
```

机器人会优先继续完整工作流；如果没有完整工作流恢复状态，再尝试继续创意拓展。

## 13. 常用本地诊断命令

检查飞书配置状态：

```powershell
Invoke-RestMethod http://127.0.0.1:3066/api/feishu-cli/status | ConvertTo-Json -Depth 8
```

发送测试消息：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3066/api/feishu-cli/test-send -Method Post -ContentType 'application/json' -Body '{}'
```

发送控制卡片：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3066/api/feishu-cli/send-card -Method Post -ContentType 'application/json' -Body '{}'
```

查看通知状态：

```powershell
Invoke-RestMethod http://127.0.0.1:3066/api/notifications/status | ConvertTo-Json -Depth 8
```

查看健康状态：

```powershell
Invoke-RestMethod http://127.0.0.1:3066/api/health | ConvertTo-Json -Depth 8
```

运行本地飞书指令路由测试：

```powershell
npm run test:feishu
```

语法检查：

```powershell
node --check feishu-cli-bridge.js
node --check feishu-command-router.js
node --check feishu-control-service.js
```

## 14. 常见问题

### Q1：飞书里发消息完全没反应怎么办？

按顺序检查：

1. 本地服务是否运行：`/api/health`
2. 飞书桥接是否运行：`/api/feishu-cli/status`
3. 当前会话是否在白名单里
4. 当前用户是否在白名单里
5. 机器人是否能访问当前会话
6. 飞书应用是否还有消息事件权限

### Q2：别人发指令没反应，我发有反应，为什么？

通常是用户白名单限制。

检查 `automation-secrets.json` 里的：

```json
{
  "feishuCliAllowedUserIds": "ou_xxx"
}
```

如果配置了用户白名单，只有白名单用户能控制平台。

### Q3：某个会话没反应，另一个会话有反应，为什么？

通常是会话白名单限制。

检查：

```json
{
  "feishuCliAllowedChatIds": "oc_xxx"
}
```

如果配置了会话白名单，只有对应私聊或群聊会话能控制平台。

### Q4：卡片按钮不能点，但文字指令能用，怎么办？

优先使用文字指令：

```text
状态
进度
停止工作流
继续任务
```

然后重新发送：

```text
控制面板
```

如果仍不行，检查 `/api/feishu-cli/status` 里的 `consumerMode` 和 `cardActionReady`。

### Q5：服务掉了之后任务会不会丢？

完整工作流和创意拓展都有恢复状态设计。

服务恢复后先发：

```text
状态
```

如果显示有可继续任务，再发：

```text
继续任务
```

### Q6：连续失败后为什么任务暂停？

这是为了防止 Legil 页面异常、登录失效、网络不稳时一直消耗资源。

默认连续失败 3 次后暂停，并通过飞书通知你。你检查状态后，可以决定是否继续。

### Q7：watchdog 自动重启会不会打断任务？

watchdog 只在健康检查连续失败后认为服务掉线，才会尝试重新拉起 `server.js`。

如果服务仍健康，它不会主动重启。

服务内的“重启服务器”按钮也会检查是否有任务正在运行；如果有任务，后端会拒绝重启。

## 15. 建议使用习惯

1. 开始跑任务前，在飞书发一次：

```text
状态
```

2. 长任务运行中，优先发：

```text
进度
```

3. 看到长时间没进展通知后，先发：

```text
日志
浏览器状态
```

4. 要停任务时，优先发：

```text
停止全部
```

5. 服务恢复后，不要急着重启，先发：

```text
状态
继续任务
```

6. 服务仍能响应但桥接或状态异常时，再打开：

```text
系统面板
```

确认无运行任务后，再使用：

```text
重启服务器
```

## 16. 一句话排障口诀

如果飞书没反应，先查服务；服务活着查桥接；桥接活着查白名单；文字能用但按钮不行，就重新发控制面板；服务刚恢复，先状态再继续任务。
