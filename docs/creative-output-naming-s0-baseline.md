# 创意拓展图片命名标准化 S0 基线锁定

日期：2026-06-02

本文是 `docs/创意拓展图片命名标准化分阶段开发方案.md` 的阶段 0 产物，只锁定当前链路、旧命名格式、入口字段和后续新规则验收样例，不改生产命名逻辑。

## 1. 当前保存文件名链路

### 1.1 创意拓展入口

当前创意拓展产图入口是：

```text
POST /api/legil/creative-batch
```

链路如下：

```text
自动创意 / 素材分析 prompt 池 / 前端创意拓展表格
  -> /api/legil/creative-batch
  -> normalizeCreativeBatchPromptItems()
  -> legilAutomation.generateImage(promptItem.prompt, ...)
  -> saveGeneratedImages() 或 saveGeneratedImage()
  -> buildOutputFileName()
```

`/api/legil/creative-batch` 当前传给 Legil 保存逻辑的命名相关字段主要在 `generateImage()` 的 options 中：

```js
{
  outputSequence,
  outputTotal,
  runId: batchRunId,
  referenceImageIndex: i + 1,
  totalReferenceImages: normalizedPrompts.length,
  referenceImageName: directionName,
  promptIndexWithinImage: 1,
  totalPromptsForImage: 1
}
```

其中 `directionName` 当前由以下逻辑生成：

```js
[promptItem.direction, promptItem.promptTitle].filter(Boolean).join('_')
```

因此，当前创意拓展保存图片文件名里的可读业务字段来自 `/api/legil/creative-batch` 传入 Legil 的 `referenceImageName`，而这个字段目前是 `direction + promptTitle`。

### 1.2 Legil 最终文件名

Legil 最终文件名由 `src/services/legil/config-methods.js` 中的 `buildOutputFileName(promptIndex, options)` 生成。

实际保存点有两处，都调用同一个文件名函数：

- `src/services/legil/save/save-flow.js` 的 `saveGeneratedImages()`
- `src/services/legil/save/save-flow.js` 的 `saveGeneratedImage()`

## 2. 旧文件名格式

### 2.1 创意拓展旧格式

当 `outputSequence` 和 `referenceImageIndex` 存在时，当前格式是：

```text
{runPart}_{sequence}_ref{refIndex}_prompt{promptIndex}_v{variant}_{referenceImageName}_{timestamp}.png
```

在当前创意拓展链路中，`referenceImageName = direction + '_' + promptTitle`，所以实际常见格式是：

```text
{runId}_{sequence}_ref{refIndex}_prompt01_v{variant}_{direction}_{promptTitle}_{timestamp}.png
```

示例形态：

```text
creative_20260602_153012_0001_ref001_prompt01_v01_题材_探索发现_避难所_雪原信号塔救援_门口抢修热源灯_20260602_153245.png
```

问题：旧格式会把 prompt 标题放进文件名，并且无法区分“标准标签路径”“旧素材内容标题”“本次新内容标题”。

### 2.2 普通批量产图旧格式

`POST /api/legil/batch-generate` 当前只保留 prompt 文本，不传参考图名、标签、标题等命名上下文。带 `outputSequence` 时格式是：

```text
{runPart}_{sequence}_prompt{promptIndex}_v{variant}_{timestamp}.png
```

示例形态：

```text
20260602_153012_0001_prompt01_v01_20260602_153245.png
```

没有 `outputSequence` 时兜底格式是：

```text
legil_{promptIndex}_v{variant}_{timestamp}.png
```

## 3. 三条入口当前字段矩阵

### 3.1 自动创意入口

来源：`src/services/creative-auto/index.js`、`src/services/creative-auto/prompt-translator.js`、`src/services/creative-auto/prompt-gate.js`

进入 `/api/legil/creative-batch` 前，prompt item 当前常见可用字段：

| 字段 | 当前状态 |
| --- | --- |
| `index` / `originalIndex` | 有 |
| `direction` | 有，通常是新方向名 |
| `newDirectionName` | 有 |
| `promptTitle` | 有 |
| `prompt` | 有，最终中文 prompt |
| `promptHash` / `sourcePromptHash` | 有 |
| `sourceDirectionId` | 有 |
| `sourceDirectionPath` | 有 |
| `promptSchemaVersion` / `translationVersion` | 有 |
| `standardLabelPath` | 无 |
| `primaryTag` / `secondaryTag` / `tertiaryTag` | 无 |
| `contentTitle` | 无 |
| `outputNameBase` | 无 |

但进入 `/api/legil/creative-batch` 后，`normalizeCreativeBatchPromptItems()` 当前只保留：

```js
{
  index,
  batchIndex,
  sourceRow,
  direction,
  promptTitle,
  prompt,
  selected
}
```

所以自动创意当前“有字段”，但在 Legil 命名前大部分会被裁掉。

### 3.2 素材分析转创意拓展入口

来源：`src/services/material-analysis/creative-expansion.js`

素材分析生成 prompt 池时，prompt item 当前常见可用字段：

| 字段 | 当前状态 |
| --- | --- |
| `promptId` | 有 |
| `index` / `sourceRow` | 有 |
| `source` | 有，值为 `material-analysis` |
| `sourceRunId` | 有 |
| `sourceMaterialId` | 有 |
| `sourceMaterialName` | 有 |
| `sourceDirectionKey` | 有 |
| `sourceDirectionPath` | 有 |
| `newDirectionName` | 有 |
| `direction` | 有，当前为 `sourceDirectionPath / newDirectionName` |
| `promptTitle` | 有 |
| `prompt` | 有 |
| `selected` | 有 |
| `meta.sourceStrategy` / `meta.directionDescription` / `meta.targetId` | 有 |
| `levels.primary` / `levels.secondary` / `levels.tertiary` / `levels.concretePoint` | 在 target 上有，不在每条 prompt 顶层 |
| `standardLabelPath` | 无 |
| `contentTitle` | 无 |
| `outputNameBase` | 无 |

同样，进入 `/api/legil/creative-batch` 后会被归一化裁剪到 `direction`、`promptTitle`、`prompt` 等少数字段。

### 3.3 普通批量产图入口

来源：`src/routes/legil.routes.js` 的 `POST /api/legil/batch-generate`

当前代码：

```js
const normalizedPrompts = prompts
  .map(promptData => typeof promptData === 'string' ? promptData : promptData && promptData.content)
  .filter(promptText => typeof promptText === 'string' && promptText.trim())
  .map(promptText => promptText.trim());
```

因此普通批量产图当前只拿到：

| 字段 | 当前状态 |
| --- | --- |
| prompt 文本 | 有 |
| prompt item `content` | 作为文本读取 |
| 原图名 / 参考图名 | 无 |
| 标签字段 | 无 |
| `title` / `promptTitle` | 无 |
| `sourceRawName` | 无 |
| `standardLabelPath` | 无 |
| `contentTitle` | 无 |
| `outputNameBase` | 无 |

后续若要支持“普通批量产图有标签原图 / 无标签原图”的新命名，必须给该入口补充结构化命名上下文，或从原图/参考图选择链路传入 `sourceRawName`、`contentTitle` 等字段。

## 4. 方向库模拟数据

阶段 0 锁定以下模拟方向库，后续阶段的命名服务必须能基于这些标准路径给出一致结果：

```js
[
  { id: 'dir-topic', path: ['题材'] },
  { id: 'dir-explore', path: ['题材', '探索发现'] },
  { id: 'dir-shelter', path: ['题材', '探索发现', '避难所'] }
]
```

原则：

- 标准标签路径最多保留三级。
- 三级以下方向只作为识别线索，不进入标签路径。
- 原图名、素材名里的旧内容标题不直接继承。
- 文件名业务核心段为：`标准标签路径_本次新内容标题`。

## 5. 命名验收样例

以下样例锁定的是新规则预期的 `outputNameBase`，不是当前生产代码输出。

| 场景 | 输入关键字段 | 预期 `outputNameBase` |
| --- | --- | --- |
| 创意拓展一级标签 | `sourceDirectionPath = 题材`，`contentTitle = 冰封地铁站避难` | `题材_冰封地铁站避难` |
| 创意拓展二级标签 | `sourceDirectionPath = 题材 / 探索发现`，`contentTitle = 冰封地铁站避难` | `题材_探索发现_冰封地铁站避难` |
| 创意拓展三级标签 | `sourceDirectionPath = 题材 / 探索发现 / 避难所`，`contentTitle = 雪原信号塔救援` | `题材_探索发现_避难所_雪原信号塔救援` |
| 创意拓展三级以下方向 | `sourceDirectionPath = 题材 / 探索发现 / 避难所 / 地下入口`，`contentTitle = 地下补给仓发现` | `题材_探索发现_避难所_地下补给仓发现` |
| 素材分析转创意拓展 | `sourceRawName = GOFCNIM6724_DR_题材_探索发现_避难所形象拓展_800x800`，方向库标准路径为 `题材 / 探索发现 / 避难所`，`contentTitle = 雪原信号塔救援` | `题材_探索发现_避难所_雪原信号塔救援` |
| 普通批量产图有标签原图 | `sourceRawName = 题材_探索发现_废弃观测站.png`，方向库仅确认到 `题材 / 探索发现`，`contentTitle = 夜间求生信号` | `题材_探索发现_夜间求生信号` |
| 普通批量产图无标签原图 | `sourceRawName = GOFCNIM6724_DR_废墟暖光补给_800x800.png`，方向库无可确认标签，`contentTitle = 夜间求生信号` | `夜间求生信号` |

## 6. 可执行检查

阶段 0 新增脚本：

```bash
npm run test:creative-output-naming-s0
```

该脚本验证：

- 当前 `buildOutputFileName()` 的创意拓展旧格式。
- 当前 `buildOutputFileName()` 的普通批量旧格式。
- 当前 `normalizeCreativeBatchPromptItems()` 会裁剪掉 `newDirectionName`、`sourceDirectionPath`、`outputNameBase` 等命名增强字段。
- 上述 7 个新规则验收样例的预期 `outputNameBase`。

