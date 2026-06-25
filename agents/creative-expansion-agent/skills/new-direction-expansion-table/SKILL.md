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
5. Ensure the final table can be parsed by the backend and sent directly to Legil.

## Required Automation Output

For backend `run-once`, `creative-auto`, and Legil automation tasks, default output is strict JSON, not a Markdown table. The JSON top-level object must contain:

- `directionPlans`
- `candidateDirections`

`directionPlans` is the hidden planning layer used by the program for automatic scoring, dedupe, rejection, and fallback filling. It is not for manual preview or selection.

Each `directionPlans` item must include:

- `sourceDirectionPath`
- `currentJudgment`
- `exclusionSummary`
- `extensions`

Each `extensions` item must include:

- `extensionKey`
- `extensionType`
- `name`
- `description`
- `visualHook`
- `dedupeReason`
- `riskNote`
- `productionAdvice`
- `promptPair`

Default automation scale:

- Generate 8 candidate extensions per source direction.
- The backend will automatically select about 4 extensions.
- Each extension should provide 2 prompts in `promptPair`.
- `candidateDirections` is a backward-compatible flattened field and may include only the final recommended extensions.

Only output the old `新方向拓展表` Markdown table when the user explicitly asks for a human planning sheet.

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

For each extension direction, generate 2 detailed Chinese prompts.

These 2 prompts must not be near-duplicates. Inside the same extension, they must still show obvious variation in at least two of:
- subject or subject combination
- action or relationship
- scene mechanism
- lens distance or camera angle
- composition center
- space layer
- light scheme
- emotional moment
- advertising impact point

Prompt 1 is the stable main-visual version. Prompt 2 is the differentiated version. The subject must not keep repeating in nearly the same form, the scene mechanism must not keep repeating in nearly the same form, and changing only location nouns is not enough.

Current Legil assumptions:

- Model: Nano Banana 2.
- Aspect ratio: 1:1.
- Resolution: 2K.
- Each prompt generates 4 images.

Therefore each prompt should describe one clear square-format ad image. Do not put four alternative scenes into one prompt. Let Legil create the 4 image variants from a stable visual concept.

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
- 广告点击点或传播动机
- 方图构图中的主视觉中心

Unless the user explicitly asks otherwise, keep the ending suffix aligned with the agent's default frozen-post-apocalypse commercial 3D poster style.

Avoid relying on tiny text, dense UI, real brands, cyber interfaces, mechs, floating holograms, or futuristic laser screens unless the source direction explicitly asks for them.

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
