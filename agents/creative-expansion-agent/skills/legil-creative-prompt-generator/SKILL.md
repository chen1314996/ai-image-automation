---
name: legil-creative-prompt-generator
description: Generate promptItems JSON for selected Legil image-generation directions in the frozen-apocalypse / Whiteout Survival creative system. Use when the user or project already provides a direction, direction path, material description, table row, reference-image description, or prompt brief and needs Chinese long prompts for Legil Nano Banana 2. This skill must not auto-expand new directions, choose directions, write direction tables, operate Legil, update Feishu, or modify seed/knowledge tables.
---

# Legil Creative Prompt Generator

## Purpose

Generate only production-ready image prompts for already-selected creative directions.

Do not perform automatic direction expansion. Do not create a `新方向拓展表`. Do not make `candidateDirections` the main output. The main output is always parseable `promptItems` JSON.

## Workflow

1. Identify the selected source direction from the user request or provided row data.
2. Confirm the prompt count only if the caller did not specify it and no surrounding task context provides it.
3. Generate Chinese long prompts for that exact direction.
4. Ensure prompts under the same direction are visually different while remaining within the same direction.
5. Output `promptItems` JSON only unless the caller explicitly asks for an additional human preview.
6. Self-check against the Legil prompt contract and quality gate before finalizing.

## Scope Boundaries

Do:

- Generate prompt text for Legil image generation.
- Preserve the provided direction path, labels, source row, and naming fields when available.
- Create distinct prompt variants within the same direction.
- Keep the frozen-apocalypse / Whiteout Survival world view.
- Follow the current Legil assumptions: Nano Banana 2, square `1:1`, `2K`, 4 images per prompt.

Do not:

- Select directions automatically.
- Expand a direction into new direction-tree nodes.
- Output `新方向拓展表` as the primary artifact.
- Use `candidateDirections` as the primary artifact.
- Write to Feishu, seed tables, knowledge bases, or local project configs.
- Operate the Legil browser or start image generation.
- Judge generated image quality.
- Pretend to have seen reference images unless image content was actually supplied.

If the user asks for automatic direction expansion, ask for the selected direction first or hand off to a direction-expansion capability. This skill remains prompt-only.

## Input Handling

Accept any of these as source material:

- Direction path, such as `题材 / 探索发现 / 物品展示 / 急救药品`.
- Table row fields: `一级标签`, `二级标签`, `三级标签`, `细分标签`, `方向简述`, `参考图说明`, `用户补充要求`.
- Material descriptions, TOP-material insights, or creative briefs.
- Reference-image filenames or descriptions.
- Explicit style, forbidden-element, count, model, ratio, or output-name requirements.

Priority order:

1. User's latest explicit requirement.
2. Provided direction path and row fields.
3. Provided brief or reference description.
4. Frozen-apocalypse / Whiteout Survival defaults.

When image files are referenced only by filename or path, use only the filename/path semantics and user-provided descriptions. Do not invent unseen visual details.

## Output Contract

Return a JSON object with top-level `promptItems`.

Each item should use these fields when available:

```json
{
  "promptItems": [
    {
      "index": 1,
      "sourceRow": 1,
      "direction": "急救药品",
      "sourceDirectionPath": "题材/探索发现/物品展示/急救药品",
      "standardLabelPath": ["题材", "探索发现", "物品展示"],
      "primaryTag": "题材",
      "secondaryTag": "探索发现",
      "tertiaryTag": "物品展示",
      "contentTitle": "雪夜急救箱护送",
      "outputNameBase": "题材_探索发现_物品展示_雪夜急救箱护送",
      "promptTitle": "提示词1",
      "prompt": "主题：..."
    }
  ]
}
```

Rules:

- `promptItems` must be an array.
- `prompt` must be the complete final prompt, not a strategy note.
- `direction` should stay anchored to the provided source direction.
- `contentTitle` may name the specific prompt scene, but must not imply a new direction-tree node.
- `outputNameBase` should be filename-safe and derived from labels plus `contentTitle` when possible.
- If the caller provides a required schema, preserve this contract while mapping fields into that schema.

## Prompt Writing

Each prompt must be a complete Chinese visual description, not a keyword list.

Prefer this structure:

```text
主题：...
画风：...
情绪氛围：...
画面内容：...
整体基调：...
```

Each prompt should cover:

- Subject and subject relationship.
- Current action or event mechanism.
- Clear frozen-apocalypse scene.
- Square composition and visual center.
- Camera distance, angle, and foreground/midground/background organization.
- Light, color, weather, snow/ice/fog, and material details.
- Advertising hook readable in a thumbnail.
- Direct Legil image-generation instructions.

Use or naturally paraphrase the default ending:

```text
冰雪氛围，画面直观、主题明确，高质量3D卡通渲染，商业级游戏宣传海报风格，电影镜头感。
```

For detailed prompt contract and examples, read `references/prompt-contract.md`.

## Variant Rules

Even without automatic direction expansion, prompts under the same direction must not be near-duplicates.

Vary at least two of:

- Subject combination.
- Action mechanism.
- Camera distance or angle.
- Space structure.
- Foreground object or visual center.
- Light scheme.
- Emotional moment.
- Advertising hook.

Keep all variants inside the provided source direction. For example, for `急救药品`, variants can cover escorting, discovering, rescuing, trading, or protecting medicine, but should not create unrelated new direction categories.

## Quality Gate

Before output, check:

- The output is valid JSON with top-level `promptItems`.
- The requested prompt count is satisfied when explicitly provided.
- Every prompt has `主题`, `画风`, `情绪氛围`, `画面内容`, and `整体基调`.
- Every prompt is concrete enough to visualize a single image.
- No prompt contains multiple mutually exclusive scene plans.
- No prompt is just abstract atmosphere or style words.
- Prompt variants are visibly different.
- No forbidden elements are introduced.
- The result remains in the frozen-apocalypse / Whiteout Survival world view.

Read `references/quality-gate.md` when the task is high-volume, has strict review requirements, or involves debugging rejected prompts.
