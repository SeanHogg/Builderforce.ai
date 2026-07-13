/**
 * Native skills loader — the pi-free replacement for `@mariozechner/pi-coding-agent`'s
 * `Skill` / `loadSkillsFromDir` / `formatSkillsForPrompt` (PI cutover). Discovers skills
 * (direct `.md` children + recursive `SKILL.md` under subdirs), parses their frontmatter
 * via the repo's own {@link parseFrontmatterBlock}, and renders the XML prompt block per
 * the Agent Skills standard. Faithful to pi 0.54's shapes + discovery rules (the
 * `.gitignore`-style ignore-file filtering pi layered on is dropped — dotfiles +
 * `node_modules` are still skipped).
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseFrontmatterBlock } from "../../markdown/frontmatter.js";

export interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  source: string;
  disableModelInvocation: boolean;
}

export interface ResourceDiagnostic {
  type: "warning" | "error";
  message: string;
  path: string;
}

export interface LoadSkillsResult {
  skills: Skill[];
  diagnostics: ResourceDiagnostic[];
}

export interface LoadSkillsFromDirOptions {
  dir: string;
  source: string;
}

function loadSkillFromFile(
  filePath: string,
  source: string,
): { skill: Skill | null; diagnostics: ResourceDiagnostic[] } {
  const diagnostics: ResourceDiagnostic[] = [];
  try {
    const frontmatter = parseFrontmatterBlock(readFileSync(filePath, "utf-8")) as Record<
      string,
      unknown
    >;
    const skillDir = dirname(filePath);
    const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
    if (!description.trim()) return { skill: null, diagnostics };
    const name = (typeof frontmatter.name === "string" && frontmatter.name) || basename(skillDir);
    return {
      skill: {
        name,
        description,
        filePath,
        baseDir: skillDir,
        source,
        disableModelInvocation: frontmatter["disable-model-invocation"] === true,
      },
      diagnostics,
    };
  } catch (error) {
    diagnostics.push({
      type: "warning",
      message: error instanceof Error ? error.message : "failed to parse skill file",
      path: filePath,
    });
    return { skill: null, diagnostics };
  }
}

function loadSkillsFromDirInternal(
  dir: string,
  source: string,
  includeRootFiles: boolean,
): LoadSkillsResult {
  const skills: Skill[] = [];
  const diagnostics: ResourceDiagnostic[] = [];
  if (!existsSync(dir)) return { skills, diagnostics };

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = join(dir, entry.name);
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        const stats = statSync(fullPath);
        isDirectory = stats.isDirectory();
        isFile = stats.isFile();
      } catch {
        continue;
      }
    }
    if (isDirectory) {
      const sub = loadSkillsFromDirInternal(fullPath, source, false);
      skills.push(...sub.skills);
      diagnostics.push(...sub.diagnostics);
      continue;
    }
    if (!isFile) continue;
    const isRootMd = includeRootFiles && entry.name.endsWith(".md");
    const isSkillMd = !includeRootFiles && entry.name === "SKILL.md";
    if (!isRootMd && !isSkillMd) continue;
    const result = loadSkillFromFile(fullPath, source);
    if (result.skill) skills.push(result.skill);
    diagnostics.push(...result.diagnostics);
  }
  return { skills, diagnostics };
}

/** Discovery: direct `.md` children of `dir`, plus recursive `SKILL.md` under subdirs. */
export function loadSkillsFromDir(options: LoadSkillsFromDirOptions): LoadSkillsResult {
  return loadSkillsFromDirInternal(options.dir, options.source, true);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Render the `<available_skills>` system-prompt block (model-invocable skills only). */
export function formatSkillsForPrompt(skills: Skill[]): string {
  const visible = skills.filter((s) => !s.disableModelInvocation);
  if (visible.length === 0) return "";
  const lines = [
    "\n\nThe following skills provide specialized instructions for specific tasks.",
    "Use the read tool to load a skill's file when the task matches its description.",
    "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
    "",
    "<available_skills>",
  ];
  for (const skill of visible) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push("  </skill>");
  }
  lines.push("</available_skills>");
  return lines.join("\n");
}
