/**
 * The `<available_skills>` catalog — level one of the spec's progressive disclosure.
 *
 * An agent is shown each skill's name and description (and, where it can read files,
 * where the SKILL.md lives) and nothing else. It loads a skill's instructions only when
 * a task matches, and a bundled file only when those instructions point at it. That is
 * what lets a workspace carry fifty skills for the price of fifty one-line entries.
 *
 * Two hosts render it: a FILE host (the agent-runtime, which reads SKILL.md from disk
 * with its read tool) and a TOOL host (every platform surface, which loads a skill
 * through the `skills.read` tool). They differ only in the instruction line and in
 * whether `<location>` is present — one formatter, so the block cannot drift.
 */

import { SKILL_READ_TOOL_NAME } from "./spec.js";

export interface SkillCatalogEntry {
  name: string;
  description: string;
  /** Absolute SKILL.md path, for a host whose agent reads skills off disk. */
  location?: string;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** How a FILE host's agent loads a skill. */
export const FILE_HOST_INSTRUCTIONS = [
  "The following skills provide specialized instructions for specific tasks.",
  "Use the read tool to load a skill's file when the task matches its description.",
  "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
];

/** How a TOOL host's agent loads a skill. */
export const TOOL_HOST_INSTRUCTIONS = [
  "The following skills provide specialized instructions for specific tasks.",
  `When a task matches a skill's description, call \`${SKILL_READ_TOOL_NAME}\` with its name and follow the instructions it returns before acting.`,
  `A skill may list bundled files (scripts, references); load one with \`${SKILL_READ_TOOL_NAME}\` { name, path } only when its instructions call for it.`,
];

/** Render the catalog block. '' when there are no skills, so callers can inject unconditionally. */
export function formatSkillCatalog(entries: readonly SkillCatalogEntry[], instructions: readonly string[]): string {
  if (entries.length === 0) return "";
  const lines = ["", "", ...instructions, "", "<available_skills>"];
  for (const entry of entries) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(entry.name)}</name>`);
    lines.push(`    <description>${escapeXml(entry.description)}</description>`);
    if (entry.location) lines.push(`    <location>${escapeXml(entry.location)}</location>`);
    lines.push("  </skill>");
  }
  lines.push("</available_skills>");
  return lines.join("\n");
}
