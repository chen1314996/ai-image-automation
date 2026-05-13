---
name: batch-iteration-strategy-table
description: Use when the user wants a 批量迭代策略表 for scaling existing directions into many more assets, especially when the goal is to expand toward dozens or hundreds of differentiated materials without losing world consistency.
---

# 批量迭代策略专家

## Overview

Use this skill to design scalable creative expansion strategy.

This skill does not just classify dimensions at a high level. It must convert existing references or directions into a practical expansion system that can support large-batch production while avoiding sameness.

## When To Use

Use `$batch-iteration-strategy-table` when the user:
- wants to expand existing directions into a large volume of assets
- asks for a 100组素材 or similar scalable iteration strategy
- needs to know which dimensions should be expanded first
- wants to know where repetition risk is highest and how to deduplicate systematically
- needs both a total strategy table and per-direction detailed iteration analysis

## Core Responsibilities

1. Build a global iteration framework, not just isolated inspiration.
2. Decide which axes are suitable for large-scale expansion and which are dangerous because they create only superficial variation.
3. Distinguish between expansion dimensions that change the creative proposition and dimensions that only change surface styling.
4. Provide actionable per-direction iteration strategy, not only a total summary table.

## Required Output Structure

Always output two layers unless the user explicitly asks for only one.

### 第一层：批量迭代策略总表

Table columns:
- 迭代维度
- 可拆分方向
- 适合扩展的原因
- 批量生成建议
- 容易重复的风险点
- 去重建议
- 优先扩展顺序

This table must say:
- which dimensions are strongest for first-round expansion
- which dimensions are suitable for serial splitting
- which dimensions may look variable but are structurally repetitive
- which dimension order is best for scaling output quality

### 第二层：逐方向详细迭代策略表

For every existing direction, output a separate row. Do not merge directions.

Table columns:
- 参考方向
- 当前方向分析
- 该方向成立的核心原因
- 该方向最值得保留的视觉机制
- 该方向最容易重复的部分
- 建议重点扩展的迭代轴
- 不建议继续重复的元素
- 可继续拆出的子方向
- 每个子方向的具体画面建议
- 适合优先产出的原因
- 风险与避坑建议

## Detailed Strategy Requirements

For each direction, the `当前方向分析` must explicitly cover:
- currently relied-on subject type or subject relationship
- scene mechanism and conflict structure
- lens language and composition logic
- advertising focus and selling-point emphasis
- emotional baseline and visual memory point

For each direction, the `建议重点扩展的迭代轴` must be executable, for example:
- 单主体改为双主体对抗或群体协作
- 资源发现改为运输、争夺、护送、回收
- 静态陈列改为追逐、潜入、坍塌、撤离、修复、苏醒
- 中景叙事改为大全景压迫感或近景冲击特写
- 单核卖点改为材质卖点、稀缺卖点、规模卖点、情绪卖点、文明残响卖点

The `每个子方向的具体画面建议` cannot be one-word bullets. They must be concrete visual suggestions that clearly indicate what kinds of scenes should be generated next.

## Decision Rules

- If the user gives 5 directions, analyze all 5 directions separately.
- If the user gives 20 directions, analyze all 20 directions separately.
- Do not replace detailed per-direction strategy with a single summary paragraph.
- Do not treat “changing background location” as meaningful iteration if scene mechanism, conflict structure, and ad focus stay the same.
- Call out when a direction is visually strong but not scalable.

## Quality Bar

A strong output from this skill should let the user immediately know:
- 先扩什么最有效
- 哪些方向值得系列化生产
- 哪些方向再扩会撞车
- 每个方向具体该往哪几个子方向拆
- 每个子方向下一步该生成什么画面

If the strategy only gives abstract categories and no concrete direction-level expansion path, it is not finished.
