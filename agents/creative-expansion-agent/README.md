# 冰封末世广告创意拓展Agent

这是一个可接入项目的 Agent 包，而不是单个 prompt。它把你的主 Agent 规则、5 个已打包 skill、接入适配器和调用示例放在同一个目录里，方便后续迁移到现有项目。

## 目录结构

```text
creative-expansion-agent/
  agent.yaml                         # Agent 元信息、skill 编排、输入输出契约
  instructions.md                    # 主 Agent 提示词，可作为 system/developer prompt
  skills/
    reference-analysis-table/
      SKILL.md
      agents/openai.yaml
    batch-iteration-strategy-table/
      SKILL.md
      agents/openai.yaml
    new-direction-expansion-table/
      SKILL.md
      agents/openai.yaml
    strict-table-direction-iteration/
      SKILL.md
      agents/openai.yaml
    batch-creative-expansion-accelerator/
      SKILL.md
      agents/openai.yaml
  integration/
    creativeExpansionAgent.ts         # TypeScript 项目接入适配器
  examples/
    request.example.md                # 一次标准调用示例
```

## 为什么要这样拆

正常项目里最好把 Agent 拆成 4 层：

1. `agent.yaml`
   给程序读的配置文件，写清楚 Agent 名称、版本、入口提示词、有哪些 skill、默认流程和输出契约。
2. `instructions.md`
   给模型读的主提示词，负责角色、工作流、质量标准和输出格式。
3. `skills/*/SKILL.md`
   可复用的局部能力。你的 5 个 zip 都已经是合格的 skill 小包，所以这里保持原样解压。
4. `integration/*`
   给已有项目调用的适配层。项目不需要理解所有 prompt，只要调用这个适配器生成最终请求即可。

这种拆法的好处是：以后你要改“Agent 总流程”只改 `instructions.md` 或 `agent.yaml`；要改某个局部能力，只改对应 skill；要接不同项目，只改 `integration/`。

## 在 Codex / 本地 skill 环境中使用

如果你想让这些 skill 变成 Codex 环境可自动触发的 skill，可以把 `skills` 下的 5 个目录复制到：

```text
C:\Users\dd\.codex\skills\
```

也就是最终类似：

```text
C:\Users\dd\.codex\skills\reference-analysis-table\SKILL.md
C:\Users\dd\.codex\skills\batch-iteration-strategy-table\SKILL.md
C:\Users\dd\.codex\skills\new-direction-expansion-table\SKILL.md
C:\Users\dd\.codex\skills\strict-table-direction-iteration\SKILL.md
C:\Users\dd\.codex\skills\batch-creative-expansion-accelerator\SKILL.md
```

如果你的项目自己负责读取 skill，则不需要复制，直接读取本包内的 `skills/` 即可。

## 接入已有项目的推荐方式

### 方式 A：最简单，直接加载主提示词

适合你先快速跑通：

1. 项目读取 `instructions.md`。
2. 把它作为模型的 system/developer prompt。
3. 把用户输入、表格提取文本、图片 OCR 结果、参考图描述放进 user message。
4. 要求模型按默认四部分表格输出。

这种方式最省事，但不会在程序层显式区分每个 skill。

### 方式 B：推荐，主 Agent + skill 文本一起加载

适合正式接入：

1. 项目读取 `agent.yaml`，拿到默认 skill 顺序。
2. 项目读取 `instructions.md` 作为主规则。
3. 根据输入类型加载对应 skill：
   - 默认加载前三个核心 skill。
   - 输入是表格时额外加载 `strict-table-direction-iteration`。
   - 大规模批量扩展时额外加载 `batch-creative-expansion-accelerator`。
4. 把主规则和 skill 规则拼成一次请求。
5. 模型输出 Markdown 表格，项目直接展示；如果需要入库，再让模型输出 JSON 或由项目解析表格。

### 方式 C：工作流式调用

适合你后面要做成更稳定的产品能力：

1. 第一次模型调用只做“参考图分析表”。
2. 第二次模型调用把第一步结果作为输入，只做“批量迭代策略总表 + 逐方向详细迭代策略表”。
3. 第三次模型调用把前两步结果作为输入，只做“新方向拓展表”。

这种方式成本稍高，但质量更稳，也更容易调试是哪一层出了问题。

## 项目调用伪流程

```text
用户上传参考图/表格/方向文本
  -> 项目做文件解析、OCR、图片说明或人工标注
  -> 调用 creativeExpansionAgent.ts 构建模型请求
  -> 发送给你的模型服务
  -> 返回 Markdown 表格
  -> 前端展示或后端入库
```

## 输入建议

项目传给 Agent 的用户输入最好包含这些字段：

- `userRequest`：用户原始要求。
- `referenceText`：从 Excel、CSV、截图、文档中提取出的方向文本。
- `imageNotes`：参考图描述、OCR 结果、图中主体、场景、构图、卖点。
- `targetCount`：期望扩展数量，例如 5 个方向、100 组素材。
- `constraints`：必须保留、必须避开、品牌调性、禁止元素等。

如果图片还没有被模型识别，项目至少要先给出每张图的编号和基础描述，避免 Agent 在没有视觉信息的情况下假装看过图。

## 输出建议

默认输出 Markdown 表格，适合人工审阅和复制到表格工具。正式产品里建议再增加一个可选参数：

```text
请在 Markdown 表格后，额外输出 JSON，字段与表格列一致。
```

这样你的项目既能给策划看表格，也能把结构化结果存入数据库。

## 最小接入清单

1. 把 `creative-expansion-agent/` 放进你的项目，例如 `agents/creative-expansion-agent/`。
2. 在后端或脚本中读取 `instructions.md`。
3. 根据需要读取 `skills/*/SKILL.md`。
4. 使用 `integration/creativeExpansionAgent.ts` 构建请求。
5. 把返回结果展示给用户。

## 后续可加强

- 增加图片理解前置步骤：先把每张参考图转成结构化描述，再交给本 Agent。
- 增加 JSON schema 输出：让新方向、提示词、来源策略能稳定入库。
- 增加去重检测：对新方向名称、主体关系、场景机制做相似度检查。
- 增加分步运行：参考分析、策略表、新方向表分别保存，便于人工审核。
