# AI生图自动化平台飞书机器人说明文档

本文档说明本项目里的飞书机器人有什么用、怎么配置和使用、什么情况下会掉线，以及掉线后如何恢复。

## 1. 机器人定位

本项目的飞书机器人不是单纯的消息通知机器人，而是一个面向 `AI生图自动化平台` 的远程控制台。

它主要负责四件事：

1. **远程查看平台状态**
   - 查看完整工作流是否运行
   - 查看 Legil 任务进度
   - 查看浏览器、豆包 API、Legil 页面状态
   - 查看最近日志

2. **远程控制自动化任务**
   - 开始量产
   - 停止当前工作流或 Legil 批量任务
   - 继续可恢复任务
   - 单独继续或停止创意拓展任务
   - 二次确认后重启工作流

3. **发送异常和完成通知**
   - 服务启动通知
   - 任务完成通知
   - 任务异常中断通知
   - 长时间无进展通知
   - Legil 页面异常截图通知

4. **配合 watchdog 做掉线守护**
   - 本地 watchdog 会定期检查 `/api/health`
   - 如果服务连续健康检查失败，会发送飞书告警
   - 如果已启用自动重启，会尝试重新拉起 `server.js`

一句话总结：**人在飞书群里，就能看平台跑到哪了，也能远程停、续、查、重启。**

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
- 机器人在控制群里
- 当前群或当前用户在白名单里

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
7. 提示你把机器人拉进飞书控制群。
8. 等你在飞书里发送：

```text
绑定平台
```

绑定成功后，会把当前群和当前用户写入 `automation-secrets.json`。

注意：`automation-secrets.json` 已经被 `.gitignore` 忽略，不会提交到 Git。

## 4. 手动配置要点

如果不使用配置脚本，也可以手动配置。

### 4.1 创建飞书企业自建应用

建议应用名和机器人名：

```text
AI生图自动化平台
```

建议控制群名：

```text
AI生图自动化平台控制台
```

### 4.2 开通权限和事件

至少需要：

- 接收消息事件：`im.message.receive_v1`
- 机器人发送 / 回复消息
- 群聊基础信息读取

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
| `feishuCliAllowedChatIds` | 允许控制平台的飞书群 ID，多个用英文逗号分隔 |
| `feishuCliAllowedUserIds` | 允许控制平台的用户 open_id，多个用英文逗号分隔 |
| `feishuCliNotifyChatId` | 主动发送通知的飞书群 ID |
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

在飞书控制群里直接发送下面的文字即可。

| 指令 | 作用 |
| --- | --- |
| `帮助` | 查看机器人支持的指令 |
| `状态` | 查看平台整体状态 |
| `进度` | 查看当前任务进度 |
| `日志` | 查看最近日志 |
| `浏览器状态` | 查看浏览器、豆包、Legil 页面状态 |
| `控制面板` | 发送飞书交互卡片 |
| `开始量产` | 按当前默认配置启动完整工作流 |
| `停止工作流` | 停止当前完整工作流或 Legil 批量任务 |
| `继续工作流` | 继续上次可恢复的完整工作流 |
| `继续任务` | 优先继续完整工作流；如果没有，则继续创意拓展 |
| `停止创意拓展` | 单独停止创意拓展产图任务 |
| `继续创意拓展` | 单独继续创意拓展剩余提示词 |
| `重启工作流` | 需要二次确认后重新启动工作流 |

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

卡片里常见按钮包括：

- 状态
- 进度
- 开始量产
- 继续任务
- 停止任务
- 重启服务

如果 SDK 长连接正常，卡片按钮可以直接触发后台动作。

如果 SDK 长连接不可用，但文字消息仍可用，机器人会降级为文字指令模式。此时直接发送文字指令即可。

## 8. 高风险操作：重启工作流

`重启工作流` 需要二次确认。

你发送：

```text
重启工作流
```

机器人会回复类似：

```text
确认重启 4821
```

你必须在 5 分钟内，用同一个飞书群、同一个用户回复正确确认码：

```text
确认重启 4821
```

确认通过后才会执行。

这样设计是为了避免误触导致任务被停止、恢复状态被清理或工作流被重新开始。

## 9. 飞书通知与异常监控

前端页面里有一块配置区：

```text
飞书通知与异常监控
```

可配置项包括：

| 配置 | 作用 |
| --- | --- |
| 启用飞书异常通知 | 是否允许发飞书通知 |
| 启用任务完成通知 | 任务完成时是否通知 |
| 启用服务器启动通知 | 服务启动时是否通知 |
| 启用长时间无进展通知 | 任务卡住时是否通知 |
| 无进展阈值 | 默认 15 分钟 |
| 通知冷却时间 | 默认 10 分钟 |
| Legil异常自动截图并发送 | Legil 出错时是否截图 |
| 启用自动恢复策略 | Legil 异常时是否尝试自动恢复 |
| 连续失败后暂停等待确认 | 连续失败达到阈值后暂停任务 |
| 连续失败阈值 | 默认 3 次 |
| Watchdog掉线自动重启服务 | 服务掉线时是否尝试自动重启 |

默认配置偏保守：异常会通知，连续失败会暂停，避免一直盲跑。

## 10. 什么时候会掉线

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
- 机器人被移出控制群

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

- 有些群里发消息机器人完全不回
- 有些用户发消息机器人回复“你没有权限控制 AI生图自动化平台”

原因：

- 当前群不在 `feishuCliAllowedChatIds`
- 当前用户不在 `feishuCliAllowedUserIds`
- 首次绑定模式已关闭

这是安全设计，不是故障。

### 10.5 通知掉线

表现：

- 平台还能在网页运行
- 飞书指令可能也能用
- 但任务完成、异常、启动通知收不到

常见原因：

- `feishuCliNotifyChatId` 未配置
- 机器人不在通知群里
- 机器人无发消息权限
- 飞书发送接口超时
- 通知冷却中
- 前端关闭了飞书通知开关

## 11. 掉线后如何恢复

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

## 12. 常用本地诊断命令

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

## 13. 常见问题

### Q1：飞书里发消息完全没反应怎么办？

按顺序检查：

1. 本地服务是否运行：`/api/health`
2. 飞书桥接是否运行：`/api/feishu-cli/status`
3. 当前群是否在白名单里
4. 当前用户是否在白名单里
5. 机器人是否还在群里
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

### Q3：群里发没反应，私聊有反应，为什么？

通常是群白名单限制。

检查：

```json
{
  "feishuCliAllowedChatIds": "oc_xxx"
}
```

如果配置了群白名单，只有对应群能控制平台。

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

服务内的“重启服务”按钮也会检查是否有任务正在运行；如果有任务，后端会拒绝重启。

## 14. 建议使用习惯

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

4. 要停任务时，发：

```text
停止工作流
```

5. 服务恢复后，不要急着重启，先发：

```text
状态
继续任务
```

6. 只有确认要从头开始时，才使用：

```text
重启工作流
```

## 15. 一句话排障口诀

如果飞书没反应，先查服务；服务活着查桥接；桥接活着查白名单；文字能用但按钮不行，就重新发控制面板；服务刚恢复，先状态再继续任务。
