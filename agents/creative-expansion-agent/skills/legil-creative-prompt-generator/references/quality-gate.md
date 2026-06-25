# Prompt Quality Gate

Use this checklist before returning `promptItems`.

## Required Structure

Each prompt should include these labels:

- `主题`
- `画风`
- `情绪氛围`
- `画面内容`
- `整体基调`

Warnings:

- Under 120 Chinese characters is usually too short.
- Over 1200 characters is usually too long.
- Missing structure labels may cause Prompt Gate warnings.

## Forbidden Elements

Do not introduce these unless the user explicitly requires them and the project owner accepts the risk:

- 真实品牌
- 品牌 logo / 品牌logo
- 强赛博
- 高科技 UI / 高科技UI
- 枪支
- 军事强相关物品
- 悬浮设备
- 机甲
- 激光界面
- 大面积英文
- 二次元赛璐璐
- 真实政治、宗教或敏感符号
- 过度写实恐怖、血腥、肢体破坏

## Rejection Patterns

Reject or rewrite prompts that:

- Are empty or only keywords.
- Contain placeholders such as `undefined`, `null`, `NaN`, `TODO`, `${...}`, or `{{...}}`.
- Start with broken grammar such as `主题：的...`.
- Describe multiple mutually exclusive plans in one prompt, such as `方案一/方案二`, `四宫格`, `三联画`, `分屏`, `或者`, `另一种`, or `分别呈现`.
- Depend on tiny text, dense UI, unreadable labels, or real logos.
- Only say the image should feel "高级", "震撼", "史诗", "氛围感", or "末日感" without concrete subjects, actions, camera, and materials.

## Similarity Check

Within the same direction, prompt variants should differ in at least two of:

- Subject or relationship.
- Action/event mechanism.
- Camera distance or angle.
- Space structure.
- Foreground prop or visual center.
- Light scheme.
- Emotional moment.
- Advertising hook.

If two prompts would produce nearly the same thumbnail, rewrite one of them.

## Final Acceptance

A prompt is acceptable when:

- A visual artist can imagine one specific square ad image immediately.
- The subject, action, scene, conflict/reward, and visual center are clear.
- The prompt can be pasted directly into Legil.
- It preserves the frozen-apocalypse / Whiteout Survival world view.
- It avoids forbidden elements and excessive abstraction.
