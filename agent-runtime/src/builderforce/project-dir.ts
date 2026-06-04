import fs from "node:fs/promises";
import path from "node:path";
import { PERSONAS_SUBDIR } from "./personas.js";

export const BUILDERFORCE_AGENTS_DIR = ".builderforce";
export const CONTEXT_FILE = "context.yaml";
export const ARCHITECTURE_FILE = "architecture.md";
export const RULES_FILE = "rules.yaml";
export const GOVERNANCE_FILE = "governance.md";
export const WORKSPACE_STATE_FILE = "workspace-state.json";
export const SKILLS_DIR = "skills";
export const MEMORY_DIR = "memory";
export const SESSIONS_DIR = "sessions";

export type BuilderForceAgentsDirectory = {
  root: string;
  contextPath: string;
  architecturePath: string;
  rulesPath: string;
  governancePath: string;
  skillsDir: string;
  memoryDir: string;
  sessionsDir: string;
  /** Project-scoped persona/role plugins: .builderforce/personas/ */
  personasDir: string;
};

/**
 * Resolve the .builderForceAgents directory for a project
 */
export function resolveBuilderForceAgentsDir(projectRoot: string): BuilderForceAgentsDirectory {
  const root = path.join(projectRoot, BUILDERFORCE_AGENTS_DIR);
  return {
    root,
    contextPath: path.join(root, CONTEXT_FILE),
    architecturePath: path.join(root, ARCHITECTURE_FILE),
    rulesPath: path.join(root, RULES_FILE),
    governancePath: path.join(root, GOVERNANCE_FILE),
    skillsDir: path.join(root, SKILLS_DIR),
    memoryDir: path.join(root, MEMORY_DIR),
    sessionsDir: path.join(root, SESSIONS_DIR),
    personasDir: path.join(root, PERSONAS_SUBDIR),
  };
}

/**
 * Check if a project has been initialized with builderForceAgents
 */
export async function isBuilderForceAgentsProject(projectRoot: string): Promise<boolean> {
  const dir = resolveBuilderForceAgentsDir(projectRoot);
  try {
    const stat = await fs.stat(dir.root);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
