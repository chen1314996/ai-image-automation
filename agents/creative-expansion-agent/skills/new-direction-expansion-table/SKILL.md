---
name: new-direction-expansion-table
description: Use when the user needs a 新方向拓展表 that expands one or more existing directions into clearly differentiated new routes, each with high-detail Chinese prompts suitable for direct image generation.
---

# 新方向拓展表专家

## Overview

Use this skill when the task is to turn existing directions into new creative routes and prompt sets.

The main goal is not loose brainstorming. The main goal is to generate new directions that are visibly different, structurally expandable, and immediately usable for image production.

## When To Use

Use `$new-direction-expansion-table` when the user:
- wants new directions based on existing directions or references
- asks for per-direction expansion with multiple new routes
- needs detailed Chinese prompt sets for each new direction
- wants stronger differentiation inside the same world view

## Core Responsibilities

1. Expand from the existing direction instead of abandoning it.
2. Ensure every new direction is a real direction change, not minor word substitution.
3. Generate prompt sets that are ready for direct 3D image generation.
4. Maintain world consistency while forcing visible differentiation.

## Required Output Table

Default output is a table named `新方向拓展表`.

Table columns:
- 参考方向
- 新方向名称
- 方向描述
- 来源于哪条详细迭代策略
- 提示词1
- 提示词2
- 提示词3
- 提示词4
- 提示词5

Each row is one new direction.

## New Direction Rules

Each new direction must differ clearly from its source in one or more of these:
- subject relationship
- scene mechanism
- narrative focus
- lens logic
- selling-point expression
- material focus
- emotional direction
- scale or space structure

Do not create “new directions” that are just renamed versions of the same core picture skeleton.

Direction names must be clearly distinguishable. Avoid shallow naming patterns where all names sound like the same abstract tag family.

## Prompt Generation Rules

For each new direction, generate 5 detailed Chinese prompts.

These 5 prompts must not be near-duplicates. Inside the same direction, they must still show obvious variation in:
- subject or subject combination
- action or relationship
- scene mechanism
- lens distance or camera angle
- composition center
- space layer
- light scheme
- emotional moment
- advertising impact point

The subject must not keep repeating in nearly the same form.
The scene mechanism must not keep repeating in nearly the same form.
Changing only location nouns is not enough.

## Prompt Content Requirements

Each prompt should be full, visual, and directly usable. Prefer covering:
- 主体
- 场景环境
- 世界观元素
- 构图方式
- 镜头语言
- 光线与色彩
- 材质与细节
- 情绪氛围
- 3D渲染特征

Unless the user explicitly asks otherwise, keep the ending suffix aligned with the agent's default frozen-post-apocalypse commercial 3D poster style.

## Decision Rules

- If the user asks to expand every source direction, process every source direction, not just a sample.
- If the user asks for at least 5 new directions per source, satisfy that structure instead of compressing it.
- If a proposed new direction still overlaps heavily with an existing one, rewrite it before output.
- If the selling point, subject logic, and scene mechanism all stay the same, it is not a qualified new direction.

## Quality Bar

A strong output from this skill should make the user feel:
- these are new routes, not rewritten old routes
- each route can continue to scale into a series
- each route has a distinct advertising hook
- each prompt can directly enter image generation with minimal rewriting

If the rows still feel like the same direction with small substitutions, regenerate them until the difference is obvious.
