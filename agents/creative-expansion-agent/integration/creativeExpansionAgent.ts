import fs from "node:fs";
import path from "node:path";

export type AttachmentSummary = {
  name: string;
  type: "image" | "table" | "spreadsheet" | "document" | "text" | "other";
  content?: string;
};

export type CreativeExpansionInput = {
  userRequest: string;
  referenceText?: string;
  imageNotes?: string;
  targetCount?: number;
  constraints?: string[];
  attachments?: AttachmentSummary[];
  outputMode?: "markdown" | "markdown_and_json";
};

export type CreativeExpansionAgentBundle = {
  instructions: string;
  skills: Record<string, string>;
};

const CORE_SKILLS = [
  "reference-analysis-table",
  "batch-iteration-strategy-table",
  "new-direction-expansion-table",
] as const;

const OPTIONAL_SKILLS = [
  "strict-table-direction-iteration",
  "batch-creative-expansion-accelerator",
] as const;

export function loadCreativeExpansionAgent(
  agentRoot = path.resolve(process.cwd(), "creative-expansion-agent"),
): CreativeExpansionAgentBundle {
  const instructions = fs.readFileSync(path.join(agentRoot, "instructions.md"), "utf8");
  const skillNames = [...CORE_SKILLS, ...OPTIONAL_SKILLS];
  const skills: Record<string, string> = {};

  for (const skillName of skillNames) {
    const skillPath = path.join(agentRoot, "skills", skillName, "SKILL.md");
    skills[skillName] = fs.readFileSync(skillPath, "utf8");
  }

  return { instructions, skills };
}

export function selectSkills(input: CreativeExpansionInput): string[] {
  const selected = new Set<string>(CORE_SKILLS);
  const text = [
    input.userRequest,
    input.referenceText,
    input.imageNotes,
    ...(input.constraints ?? []),
    ...(input.attachments ?? []).map((item) => `${item.type} ${item.name} ${item.content ?? ""}`),
  ]
    .filter(Boolean)
    .join("\n");

  if (/(Excel|CSV|table|spreadsheet|screenshot|row|rows|direction list|no skip|order|表格|截图|逐行|行号|方向表|清单|不要漏|不跳项|按顺序)/i.test(text)) {
    selected.add("strict-table-direction-iteration");
  }

  if (/(100|dozens|hundreds|batch|large scale|series|dedupe|duplicate|asset pool|几十|上百|批量|大规模|系列化|去重|同质化|扩量|素材池)/i.test(text)) {
    selected.add("batch-creative-expansion-accelerator");
  }

  return [...selected];
}

export function buildCreativeExpansionMessages(input: CreativeExpansionInput, agentRoot?: string) {
  const bundle = loadCreativeExpansionAgent(agentRoot);
  const selectedSkillNames = selectSkills(input);
  const selectedSkills = selectedSkillNames
    .map((name) => `\n\n## Skill: ${name}\n\n${bundle.skills[name]}`)
    .join("\n");

  const developerPrompt = [
    bundle.instructions,
    "\n\n# Loaded Skills",
    selectedSkills,
    "\n\n# Runtime Rule",
    "Use the loaded skills as execution guidance. The default workflow is reference analysis -> batch iteration strategy -> new direction expansion.",
  ].join("\n");

  const userPrompt = buildUserPrompt(input, selectedSkillNames);

  return [
    {
      role: "developer" as const,
      content: developerPrompt,
    },
    {
      role: "user" as const,
      content: userPrompt,
    },
  ];
}

export function buildUserPrompt(input: CreativeExpansionInput, selectedSkillNames = selectSkills(input)): string {
  const parts = [
    "# User Request",
    input.userRequest,
    "",
    "# Selected Skills",
    selectedSkillNames.map((name) => `- ${name}`).join("\n"),
  ];

  if (input.targetCount) {
    parts.push("", "# Target Count", `${input.targetCount} requested creative assets or direction expansion target.`);
  }

  if (input.referenceText) {
    parts.push("", "# Reference Directions Or Table Text", input.referenceText);
  }

  if (input.imageNotes) {
    parts.push("", "# Reference Image Notes", input.imageNotes);
  }

  if (input.constraints?.length) {
    parts.push("", "# Constraints", input.constraints.map((item) => `- ${item}`).join("\n"));
  }

  if (input.attachments?.length) {
    const attachmentText = input.attachments
      .map((item, index) => {
        return [`## Attachment ${index + 1}: ${item.name}`, `Type: ${item.type}`, item.content ?? "No readable text was provided."].join("\n");
      })
      .join("\n\n");
    parts.push("", "# Attachment Summaries", attachmentText);
  }

  parts.push(
    "",
    "# Output Requirements",
    input.outputMode === "markdown_and_json"
      ? "First output the default four-part Markdown tables, then output JSON with matching fields."
      : "Output the default four-part Markdown tables.",
  );

  return parts.join("\n");
}
