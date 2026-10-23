/**
 * Native skills loader — the pi-free replacement for `@mariozechner/pi-coding-agent`'s
 * `Skill` / `loadSkillsFromDir` / `formatSkillsForPrompt` (PI cutover). Discovers skills
 * (direct `.md` children + recursive `SKILL.md` under subdirs) and renders the XML prompt
 * block per the Agent Skills standard. The `.gitignore`-style ignore-file filtering pi
 * layered on is dropped — dotfiles + `node_modules` are still skipped.
 *
 * Frontmatter is read and checked by `@builderforce/agent-skills`, the SAME validator the
 * platform imports and publishes skills through, so a folder that loads here is a folder
 * the web import accepts (and vice versa). The loader is lenient where the spec's client
 * guidance says to be: a skill that breaks a naming rule still loads — under its declared
 * name, or its folder's — with a diagnostic, because refusing it would hide a working
 * procedure over a cosmetic fault. Only a missing description (the agent could never
 * match it) or unreadable frontmatter drops a skill, and that is now reported too.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  FILE_HOST_INSTRUCTIONS,
  formatSkillCatalog,
  validateSkillFrontmatter,
} from "@builderforce/agent-skills";
import { readSkillFrontmatter } from "./frontmatter.js";

export interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  source: string;
  disableModelInvocation: boolean;
  /** Spec `allowed-tools` (experimental): tools the skill pre-approves, as declared. */
  allowedTools?: string[];
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
    const frontmatter = readSkillFrontmatter(readFileSync(filePath, "utf-8"));
    if (frontmatter === null) {
      diagnostics.push({ type: "warning", message: "skipped: no YAML frontmatter (name + description)", path: filePath });
      return { skill: null, diagnostics };
    }
    const skillDir = dirname(filePath);
    // A root-level `foo.md` has no folder of its own, so only a SKILL.md is held to
    // the spec's "name equals its directory" rule.
    const isFolderSkill = basename(filePath) === "SKILL.md";
    const validation = validateSkillFrontmatter(frontmatter, isFolderSkill ? { directoryName: basename(skillDir) } : {});
    for (const problem of validation.issues) {
      diagnostics.push({ type: "warning", message: `${problem.field}: ${problem.message}`, path: filePath });
    }
    const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
    if (!description) return { skill: null, diagnostics };
    const name = (typeof frontmatter.name === "string" && frontmatter.name.trim()) || basename(skillDir);
    const allowedTools = validation.manifest?.allowedTools;
    return {
      skill: {
        name,
        description,
        filePath,
        baseDir: skillDir,
        source,
        disableModelInvocation: frontmatter["disable-model-invocation"] === true || frontmatter["disable-model-invocation"] === "true",
        ...(allowedTools ? { allowedTools } : {}),
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

/** Render the `<available_skills>` system-prompt block (model-invocable skills only). */
export function formatSkillsForPrompt(skills: Skill[]): string {
  const visible = skills.filter((s) => !s.disableModelInvocation);
  return formatSkillCatalog(
    visible.map((s) => ({ name: s.name, description: s.description, location: s.filePath })),
    FILE_HOST_INSTRUCTIONS,
  );
}
