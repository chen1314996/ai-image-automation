# 豆包 API 配置说明

本项目现在已经改为通过火山方舟豆包大模型 API 生成提示词，不再打开豆包网页，也不需要登录豆包网页账号。

## 你需要填写什么

在自动化平台页面打开“豆包API配置”，填写这两项：

1. `火山方舟 API Key`
   - 从火山方舟控制台获取。
   - 填写后只保存在本机 `automation-secrets.json`。
   - 页面刷新后不会回显明文，只显示“已配置”。
   - `automation-secrets.json` 已加入 `.gitignore`，不要手动提交它。

2. `模型 ID / Endpoint ID`
   - 填写你在火山方舟控制台创建或拿到的 Doubao-Seed-2.0-pro 模型 ID / Endpoint ID。
   - 这个值不是密钥，可以保存在普通配置中。

## 更安全的填写方式

如果不想让 API Key 写入本机文件，也可以设置环境变量，项目会优先读取环境变量：

```powershell
$env:ARK_API_KEY="你的火山方舟APIKey"
npm start
```

也支持这些环境变量名：

```powershell
$env:VOLCENGINE_API_KEY="你的火山方舟APIKey"
$env:DOUBAO_API_KEY="你的火山方舟APIKey"
```

## 工作流变化

旧流程：

```text
读取参考图 → 打开豆包网页 → 上传图片 → 等网页回复 → 提取提示词 → Legil生成图片
```

新流程：

```text
读取参考图 → 调用豆包大模型API → 直接拿到5组提示词 → Legil生成图片
```

## 默认固定指令

默认发送给豆包 API 的指令是：

```text
参考这张图，生成五组不同的画面提示词，画面直观、主题明确，高质量3D卡通渲染，商业级游戏宣传海报风格，电影镜头感，尽可能详细。
```

你可以在页面里的“发送给豆包API的固定文字指令”中自行调整。
