# Legil Prompt Contract

## Fixed Creative World

Default world view:

- 无尽冬日 / 冰封末世.
- 极寒环境, 资源稀缺, 废墟生存, 旧文明遗迹.
- 幸存者行动, 现实材质, 冷蓝冰雪与局部暖光/火光/警示光对比.
- High-quality 3D cartoon rendering, commercial game advertising poster style, cinematic camera feeling.

Do not switch away from this world view unless the user explicitly says the skill should be adapted for another project.

## Legil Assumptions

- Model: Nano Banana 2.
- Aspect ratio: `1:1`.
- Resolution: `2K`.
- Each prompt generates 4 images.

Implications:

- Each prompt describes one clear image, not a set of alternatives.
- Composition must be stable for square ads.
- The main visual should be readable in a thumbnail.
- Use material and lighting detail, but avoid tiny unreadable text or dense UI.

## Prompt Shape

Use Chinese complete sentences. Prefer:

```text
主题：一句话说明画面主题和广告点击点。
画风：高质量3D卡通渲染、商业级游戏宣传海报风格、电影镜头感。
情绪氛围：说明紧张、稀缺、压迫、希望、反差或危机。
画面内容：说明主体、动作、道具、场景、前中后景关系。
整体基调：说明方图构图、光线、色彩、材质、缩略图可读性和默认风格尾句。
```

Each prompt should include:

- 主体和主体关系.
- 正在发生的动作.
- 明确场景.
- 构图和镜头.
- 光线和色彩.
- 材质细节.
- 广告点击点.
- Legil 出图所需的完整视觉指令.

## Default Ending

Use or naturally paraphrase:

```text
冰雪氛围，画面直观、主题明确，高质量3D卡通渲染，商业级游戏宣传海报风格，电影镜头感。
```

Do not repeat the exact suffix more than once in one prompt.

## Good Variant Patterns

For the same source direction, make variants differ by scene mechanics instead of only synonyms.

Example for `题材/探索发现/物品展示/急救药品`:

- A small team escorts a medicine box through a storm.
- A parent protects the last fever medicine at a shelter entrance.
- A medicine kit slides toward cracked ice while survivors reach for it.
- A glowing medical box is found inside an abandoned ambulance as danger approaches.

These are prompt variants under the same source direction. They are not new direction-tree nodes.
