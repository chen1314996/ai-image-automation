# Legil 模块说明

这个目录是 Legil 自动化逻辑的拆分版。  
根目录的 `legil-automation.js` 仍然保留，所以旧代码继续 `require('./legil-automation')` 不会失效。

## 建议阅读顺序

1. `index.js`
   - 创建 `LegilAutomation` 类。
   - 把下面所有小模块的方法组装到同一个实例上。

2. `generation-flow.js`
   - 单次生成图片的主流程。
   - 大致顺序是：打开页面、上传参考图、输入提示词、设置参数、点击生成、等待结果、保存图片。

3. `page-actions.js`
   - 页面操作。
   - 打开 Legil 页面、刷新页面、上传参考图、输入提示词、保存错误截图都在这里。

4. `generation-settings.js`
   - 生成参数。
   - 设置模型、画面比例、分辨率、生成数量，并点击生成按钮。

5. `output-detection.js`
   - 结果识别入口。
   - 它会组合 `output/` 目录里的小模块。

6. `image-save.js`
   - 图片保存入口。
   - 它会组合 `save/` 目录里的小模块。

## output 目录

| 文件 | 作用 |
| --- | --- |
| `output/image-keys.js` | 记录生成前后的图片身份，用来判断哪些是新图 |
| `output/generation-waiter.js` | 等待 Legil 生成结束，超时时做清理 |
| `output/output-scanner.js` | 扫描页面里的新图片、失败位置和可保存图片元素 |

## save 目录

| 文件 | 作用 |
| --- | --- |
| `save/download.js` | 按图片地址下载，并校验文件是否保存成功 |
| `save/preview.js` | 打开预览图，截图兜底保存 |
| `save/save-flow.js` | 图片保存主流程，决定保存顺序和失败兜底 |

## 其他文件

| 文件 | 作用 |
| --- | --- |
| `config-methods.js` | 保存目录、参考图目录、文件名、生成参数 |
| `constants.js` | Legil 固定地址、模型选项、比例、分辨率、数量 |
| `helpers.js` | 中止检查、可中断等待、图片 URL 处理 |

## 安全原则

- 不要随意改等待时间和选择器，Legil 页面变化会影响自动化稳定性。
- 不要随意改保存顺序，当前逻辑是先尝试下载，失败后再截图兜底。
- 如果要排查保存问题，优先看 `save-flow.js`，再看 `download.js` 和 `preview.js`。
