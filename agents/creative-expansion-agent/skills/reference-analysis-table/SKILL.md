---
name: reference-analysis-table
description: Use when the user provides reference images, reference direction tables, screenshots, spreadsheets, or existing creative routes and needs a structured 参考分析表 that explains why each reference works, what can be reused, and what should not be repeated.
---

# 参考分析表专家

## Overview

Use this skill when the task is to digest existing creative references before expansion.

The goal is not to jump straight into new ideas. The goal is to first explain why each reference direction成立, what visual mechanism makes it effective, what should be preserved, and what parts are already overused.

## When To Use

Use `$reference-analysis-table` when the user:
- gives one or more reference images, image boards, table screenshots, Excel/CSV direction lists, or extracted direction text
- asks why existing directions are good or effective
- wants a structured reference analysis table before iterative expansion
- wants to summarize reusable mechanisms, avoid repeated elements, or identify uncovered creative space

Do not use this skill as the main workflow when the task is primarily to produce a large-scale iteration plan or directly generate many new directions. In those cases, use the more specific downstream skills after this analysis is complete.

## Core Responsibilities

1. Read all provided references instead of sampling only part of them, unless the user explicitly narrows scope.
2. Identify each reference as a concrete direction, not as a vague style tag.
3. Explain why each reference works at the level of subject, scene mechanism, composition, lens language, emotional tone, advertising focus, and visual memory point.
4. Separate reusable strengths from elements that are likely to cause repetition if reused blindly.
5. Surface the creative gaps that have not yet been covered.
6. For this project, always separate **买量判断** and **美术判断**. A picture can be beautiful but weak for advertising, or strong for CTR but visually repetitive; keep those judgments separate.

## Required Analysis Dimensions

For each reference direction, explicitly analyze:
- 主体是谁，主体关系是什么
- 场景机制是什么，画面内部正在发生什么
- 镜头语言如何服务广告表达
- 构图重心与视觉抓手在哪里
- 卖点是通过什么被放大的
- 情绪基调与传播记忆点是什么
- 哪些元素值得复用
- 哪些元素已经接近重复上限
- 如果输入来自方向种子表，结合 `一级标签 / 二级标签 / 三级标签 / 细分标签 / 方向简述` 解释方向成立原因。
- 如果输入来自 TOP 素材洞察，结合 CTR、花费、D7 ROI、CPI 判断其买量信号，但不要直接复刻素材名。

Do not collapse this into abstract language like “氛围感强” or “有冲击力”. Every judgment must be tied to visible image logic or direction structure.

## Output Contract

Default output is a table named `参考分析表`.

Table columns:
- 参考图/编号/方向名
- 买量判断_为什么容易出效果
- 买量判断_核心优势拆解
- 买量判断_可复用投放元素
- 美术判断_为什么好
- 美术判断_核心优势拆解
- 美术判断_可复用美术元素
- 不宜重复的部分

If the user supplied many references, keep one row per reference direction. Do not merge multiple rows into a vague summary row.

When the task is a backend `run-once` / `creative-auto` task, this analysis can be compact and used internally. Do not let long analysis crowd out the required `新方向拓展表`.

After the table, add a short `分析结论` section that summarizes:
- 当前参考集中最强的共性机制
- 当前最容易重复的骨架
- 后续扩展最值得避开的重复区
- 后续扩展最值得优先切入的缺口

## Decision Rules

- If the user provides a strict row-based source, preserve the original order.
- If several references look visually similar, still analyze them separately first, then explain the overlap.
- If a reference is weak, say so directly and explain which layer is weak: subject clarity, mechanism, composition, advertising focus, or emotional memory.
- If a reference has strong style but weak expandability, mark that clearly.

## Quality Bar

A strong output from this skill should let the next step answer all of these:
- 为什么这个方向成立
- 这个方向最值钱的视觉机制是什么
- 继续扩展时最容易重复什么
- 后续拓展最该保留什么、最该避开什么

If the user could not use the output to guide later direction expansion, the analysis is not detailed enough.
