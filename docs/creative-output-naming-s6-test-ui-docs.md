# 创意拓展图片命名标准化 S6 测试、提示与文档记录

日期：2026-06-02

## 范围

阶段 6 补齐了命名规则的长期回归入口，并在现有前端预览位置增加轻量提示，帮助产图前确认最终保存名和标准标签识别结果。

## 测试入口

新增总验收脚本：

```bash
npm run test:creative-output-naming
```

脚本文件：

```text
scripts/test-creative-output-naming.js
```

该脚本覆盖以下稳定规则：

- 一级标签命名：`一级标签_新内容标题`。
- 二级标签命名：`一级标签_二级标签_新内容标题`。
- 三级标签命名：`一级标签_二级标签_三级标签_新内容标题`。
- 三级以下方向截断到三级：只保留标准一级、二级、三级，再拼本次新内容标题。
- 素材分析旧内容归一到方向库标准三级，例如 `避难所形象拓展` 只用于匹配 `避难所`。
- 普通批量产图旧内容不误当三级：方向库只有二级时，原图最后一段进入 `sourceContentTitle`，不进入新文件名。
- 原图最后一段确实是标准三级时保留。
- Windows 非法字符清洗。
- `outputNameBase` 长度控制。
- 无标签 fallback：无法识别标准标签时只使用本次标题作为命名基础。

分阶段脚本仍保留：

```bash
npm run test:creative-output-naming-s0
npm run test:creative-output-naming-s1
npm run test:creative-output-naming-s2
npm run test:creative-output-naming-s3
npm run test:creative-output-naming-s4
npm run test:creative-output-naming-s5
```

## 前端提示

已接入三个轻量提示点：

- 创意拓展 prompt 预览：若 prompt item 带有 `outputNameBase` 或标准标签字段，显示“保存名预览”。
- 素材分析转创意拓展 prompt 池：显示识别到的标准标签路径和保存名。
- 普通 prompt 管理面板：结构化 prompt 若带有 `outputNameBase`，显示保存名；若只有 `standardLabelPath`，显示标准标签；若结构化 prompt 无可识别标签，提示“未识别标准标签，将使用旧命名或标题命名”。

## 维护建议

后续修改命名规则时，优先更新统一命名服务，并同步更新 `scripts/test-creative-output-naming.js` 中的总验收样例。若只改某条入口链路，仍应补充对应 S 阶段脚本，避免总验收通过但入口字段传递断裂。
