# 前端 JS 阅读说明

这个目录里的文件都是浏览器直接加载的普通 JavaScript，不需要打包工具。  
`public/index.html` 通过 `<script src="...">` 按顺序加载这些文件，所以函数会挂在同一个页面环境里。

## 建议阅读顺序

1. `app-state.js`
   - 全局配置和运行状态。
   - 先看这里可以知道默认输入目录、输出目录、Legil 参数、提示词列表放在哪里。

2. `ui-core.js`
   - 通用界面工具。
   - 日志、弹窗、提示消息、页面切换、按钮禁用/恢复都在这里。

3. `config-panels.js`
   - 配置面板。
   - 负责把页面上的配置保存到后台，也负责从后台读配置回填页面。

4. `platform-config.js`
   - 平台配置辅助。
   - 负责豆包提示词模板、Legil 参数、文件夹历史、配置加载等零散辅助动作。

5. `browser-actions.js`
   - 浏览器按钮。
   - 对应“打开 Legil”“打开两个平台”“关闭浏览器”“刷新浏览器状态”等按钮。

6. `workflow.js`
   - 批量产图主流程。
   - 对应“开始完整工作流”“停止任务”“继续任务”等批量产图按钮。

7. `resize-workflow.js`
   - 批量改尺寸流程。
   - 对应“开始改尺寸”和改尺寸进度展示。

8. `creative-agent.js`
   - 创意拓展 Agent。
   - 对应上传表格、解析表格、启动 Agent、查看 Agent 任务结果。

9. `creative-prompts.js`
   - 创意拓展提示词列表。
   - 对应提示词选择、全选、取消选择、预览。

10. `creative-workflow.js`
    - 创意拓展批量生成。
    - 对应创意提示词发送到 Legil、停止、续跑、进度展示。

11. `prompt-management.js`
    - 普通提示词管理面板。
    - 对应获取最新提示词、复制提示词、发送单条或全部提示词到 Legil。

## 按按钮找代码

| 页面按钮/功能 | 主要 JS 文件 | 主要后台接口 |
| --- | --- | --- |
| 打开 Legil | `browser-actions.js` | `POST /api/open-website` |
| 打开两个平台 | `browser-actions.js` | `POST /api/open-both-websites` |
| 关闭浏览器 | `browser-actions.js` | `POST /api/close-browser` |
| 统计文件夹图片 | `platform-config.js` / `config-panels.js` | `POST /api/count-images` |
| 保存豆包配置 | `config-panels.js` | `POST /api/config/doubao` |
| 保存 Legil 参数 | `config-panels.js` | `POST /api/config/legil-generation` |
| 开始完整工作流 | `workflow.js` | `POST /api/workflow/start` |
| 停止完整工作流 | `workflow.js` | `POST /api/workflow/stop` |
| 继续完整工作流 | `workflow.js` | `POST /api/workflow/resume` |
| 单条提示词发给 Legil | `prompt-management.js` | `POST /api/legil/generate` |
| 批量提示词发给 Legil | `prompt-management.js` | `POST /api/legil/batch-generate` |
| 开始批量改尺寸 | `resize-workflow.js` | `POST /api/legil/resize-batch` |
| 解析创意表格 | `creative-agent.js` | `POST /api/creative/parse-table` |
| 启动创意 Agent | `creative-agent.js` | `POST /api/creative-agent/run` |
| 创意提示词批量生成 | `creative-workflow.js` | `POST /api/legil/creative-batch` |

## 注意

- 不要随意改 HTML 里的 `id`，很多 JS 是靠这些 `id` 找按钮和输入框的。
- 不要随意改接口地址，后台路由已经按这些地址提供服务。
- 这里只做页面交互，真正打开浏览器、调用豆包、操作 Legil 的逻辑都在后台。
