# 前端 CSS 阅读说明

`public/index.html` 只引用 `css/app.css`。  
`app.css` 再按顺序引入下面这些文件，顺序不能随便换，因为后面的样式会覆盖前面的样式。

| 文件 | 负责什么 |
| --- | --- |
| `base.css` | 全局变量、字体、页面背景 |
| `layout.css` | 页面头部、主网格、卡片布局 |
| `components.css` | 表单、按钮、状态条、提示框等通用组件 |
| `workflow.css` | 批量产图工作流、进度面板、提示词管理区 |
| `logs-modal-toast.css` | 实时日志、弹窗、右下角提示 |
| `visual-polish.css` | 多轮 UI 视觉优化，保留原顺序避免页面变化 |
| `feature-pages.css` | 页面切换、批量改尺寸、创意拓展 Agent |

如果只是想改某个按钮、输入框或提示框的样式，优先看 `components.css`。  
如果想看“批量产图/改尺寸/创意拓展”这些具体页面，优先看 `workflow.css` 和 `feature-pages.css`。
