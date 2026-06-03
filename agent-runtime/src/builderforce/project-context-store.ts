import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { resolveBuilderForceAgentsDir } from "./project-dir.js";
import type { ProjectContext, ProjectRules } from "./types.js";

/**
 * Update specific fields in context.yaml without overwriting unrelated data.
 */
export async function updateProjectContextFields(
  projectRoot: string,
  updates: Partial<ProjectContext>,
): Promise<void> {
  const dir = resolveBuilderForceAgentsDir(projectRoot);
  const raw = await fs.readFile(dir.contextPath, "utf-8");
  const existing = parseYaml(raw) as ProjectContext;
  const updated: ProjectContext = { ...existing, ...updates };
  await fs.writeFile(dir.contextPath, stringifyYaml(updated), "utf-8");
}

/**
 * Load project context from .builderForceAgents directory
 */
export async function loadProjectContext(projectRoot: string): Promise<ProjectContext | null> {
  const dir = resolveBuilderForceAgentsDir(projectRoot);
  try {
    const content = await fs.readFile(dir.contextPath, "utf-8");
    return parseYaml(content) as ProjectContext;
  } catch {
    return null;
  }
}

/**
 * Save project context to .builderForceAgents directory
 */
export async function saveProjectContext(
  projectRoot: string,
  context: ProjectContext,
): Promise<void> {
  const dir = resolveBuilderForceAgentsDir(projectRoot);
  await fs.mkdir(path.dirname(dir.contextPath), { recursive: true });
  await fs.writeFile(dir.contextPath, stringifyYaml(context), "utf-8");
}

/**
 * Load project rules from .builderForceAgents directory
 */
export async function loadProjectRules(projectRoot: string): Promise<ProjectRules | null> {
  const dir = resolveBuilderForceAgentsDir(projectRoot);
  try {
    const content = await fs.readFile(dir.rulesPath, "utf-8");
    return parseYaml(content) as ProjectRules;
  } catch {
    return null;
  }
}

/**
 * Save project rules to .builderForceAgents directory
 */
export async function saveProjectRules(projectRoot: string, rules: ProjectRules): Promise<void> {
  const dir = resolveBuilderForceAgentsDir(projectRoot);
  await fs.mkdir(path.dirname(dir.rulesPath), { recursive: true });
  await fs.writeFile(dir.rulesPath, stringifyYaml(rules), "utf-8");
}

export async function loadProjectGovernance(projectRoot: string): Promise<string | null> {
  const dir = resolveBuilderForceAgentsDir(projectRoot);
  try {
    return await fs.readFile(dir.governancePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Load project architecture documentation
 */
export async function loadProjectArchitecture(projectRoot: string): Promise<string | null> {
  const dir = resolveBuilderForceAgentsDir(projectRoot);
  try {
    return await fs.readFile(dir.architecturePath, "utf-8");
  } catch {
    return null;
  }
}
