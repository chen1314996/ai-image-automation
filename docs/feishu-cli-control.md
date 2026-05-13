# 飞书 CLI 控制接入说明

本项目使用独立的飞书企业自建应用机器人控制自动化平台，推荐应用和机器人名称：

```text
AI生图自动化平台
```

## 1. 新建飞书企业自建应用

在飞书开放平台创建企业自建应用，启用机器人能力，并把机器人加入控制群。

建议控制群名称：

```text
AI生图自动化平台控制台
```

第一阶段建议只开放给你本人或少量可信成员。

## 2. 开通权限与事件

至少需要：

- 接收消息事件：`im.message.receive_v1`
- 机器人发送/回复消息
- 群聊基础信息读取

如果后续需要从飞书消息里下载用户上传的表格、图片或文件，再额外开通文件资源读取权限。

## 3. 配置独立 lark-cli profile

不要复用其他项目的机器人 profile。本项目固定推荐：

```text
ai-image-automation
```

配置命令：

```bash
lark-cli config init --name ai-image-automation --app-id <APP_ID> --app-secret-stdin --brand feishu
```

所有桥接命令都会显式使用：

```bash
lark-cli --profile ai-image-automation ...
```

不会切换全局默认 profile。

## 4. 本地密钥配置

把控制白名单写入 `automation-secrets.json`。该文件已经被 `.gitignore` 忽略，不会提交到 Git。

示例：

```json
{
  "feishuCliEnabled": false,
  "feishuCliProfile": "ai-image-automation",
  "feishuCliAllowedChatIds": "oc_xxx",
  "feishuCliAllowedUserIds": "ou_xxx",
  "feishuCliNotifyChatId": "oc_xxx"
}
```

说明：

- `feishuCliEnabled`: 是否随服务器自动启动桥接。建议先设为 `false`，确认能手动启动后再改 `true`。
- `feishuCliAllowedChatIds`: 允许控制平台的群聊 ID，多个用英文逗号分隔。
- `feishuCliAllowedUserIds`: 允许控制平台的用户 open_id，多个用英文逗号分隔。
- `feishuCliNotifyChatId`: 开发完成或测试完成后主动通知的群聊 ID。

如果没有配置白名单，桥接服务会拒绝处理消息。

## 5. 服务端 API

```text
GET  /api/feishu-cli/status
POST /api/feishu-cli/start
POST /api/feishu-cli/stop
POST /api/feishu-cli/test-send
```

## 6. 支持的飞书指令

```text
帮助
状态
进度
日志
浏览器状态
停止创意拓展
继续创意拓展
停止完整工作流
停止工作流
继续工作流
重启工作流
```

`重启工作流` 需要二次确认。机器人会返回确认码，例如：

```text
确认重启 4821
```

只有同一个群、同一个用户在 5 分钟内回复正确确认码，才会执行。

## 7. 本地测试

```bash
npm run test:feishu
node --check feishu-cli-bridge.js
node --check feishu-command-router.js
node --check feishu-control-service.js
```

测试只验证本地命令路由和语法，不会连接飞书，也不会影响正在运行的图片生成任务。
