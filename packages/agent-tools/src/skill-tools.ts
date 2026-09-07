/**
 * Skill authoring — the tools an agent uses to turn a procedure that worked into
 * one the next agent can follow.
 *
 * Defined here rather than in `core-tools.ts` because they are their own concern
 * (a run writing back into the capability catalogue, not a run doing its task) and
 * because a surface advertises them separately: a run only gets them when its
 * provider actually backs `skill.author`.
 *
 * The contract deliberately stops at a draft. An agent that could publish a skill
 * directly would be an agent that can rewrite what every other agent is told to
 * do, on its own say-so, from inside a single run.
 */

import { defineTool, type ToolDefinition, type ToolResult } from "./tool.js";
import type { SkillListResult, SkillProposalResult } from "./capabilities.js";

export const skillProposeTool: ToolDefinition = defineTool({
  name: "skill_propose",
  description:
    "Propose a reusable SKILL — a procedure a future agent can follow — drafted from work you just completed and verified. Use it when you worked out a repeatable way to do something non-obvious in this codebase (a migration + guard + test sequence, a release path, a debugging route) and a future run would otherwise rediscover it. Do NOT propose a skill for a one-off fix, for something the repo already documents, or for a procedure you did not actually complete. The draft goes to a human for review; it does not take effect until approved.",
  parameters: {
    type: "object",
    properties: {
      slug: {
        type: "string",
        description: "Stable kebab-case id, e.g. 'add-a-schema-column'. Re-using one revises your existing draft.",
      },
      name: { type: "string", description: "Short human title, e.g. 'Add a schema column end to end'." },
      description: {
        type: "string",
        description: "One line saying WHEN to use this skill — a future agent matches on this, so name the situation, not the steps.",
      },
      body: {
        type: "string",
        description: "The procedure as Markdown: ordered steps, exact commands, and how to tell it worked.",
      },
      evidence: {
        type: "string",
        description: "What proves this procedure works — the graded proof, the merged PR, the passing check.",
      },
    },
    required: ["slug", "name", "description", "body"],
  },
  requires: ["skill.author"],
  async execute(args, ctx): Promise<ToolResult> {
    const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
    const slug = str(args.slug);
    const name = str(args.name);
    const description = str(args.description);
    const body = str(args.body);
    if (!slug || !name || !description || !body) {
      return { data: { ok: false, error: "slug, name, description and body are all required" } };
    }
    const evidence = str(args.evidence);
    const r = (await ctx.caps.skillAuthor!.propose({
      slug,
      name,
      description,
      body,
      ...(evidence ? { evidence } : {}),
    })) as SkillProposalResult;
    return { data: r as unknown as Record<string, unknown> };
  },
});

export const skillListTool: ToolDefinition = defineTool({
  name: "skill_list",
  description:
    "List the skills this workspace already has — approved ones you can follow, and drafts awaiting review. Call it before proposing, so you revise an existing draft instead of adding a near-duplicate.",
  parameters: { type: "object", properties: {} },
  requires: ["skill.author"],
  async execute(_args, ctx): Promise<ToolResult> {
    const r = (await ctx.caps.skillAuthor!.list()) as SkillListResult;
    return { data: r as unknown as Record<string, unknown> };
  },
});

/** Both skill-authoring tools, for a surface that backs `skill.author`. */
export const SKILL_TOOLS: readonly ToolDefinition[] = [skillProposeTool, skillListTool];
