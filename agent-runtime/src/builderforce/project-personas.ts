import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { loadPersonasFromDir } from "./personas.js";
import { loadProjectContext, saveProjectContext } from "./project-context-store.js";
import { resolveBuilderForceAgentsDir } from "./project-dir.js";
import type { AgentRole, PersonaAssignment, PersonaPlugin } from "./types.js";

const LEGACY_AGENTS_DIR = "agents";

/**
 * Load project-local personas/roles from .builderforce/personas/.
 * Aligned with the persona system; returns AgentRole-compatible entries.
 * Migrates legacy .builderforce/agents/*.yaml to personas/ on first load.
 */
export async function loadCustomAgentRoles(projectRoot: string): Promise<AgentRole[]> {
  const dir = resolveBuilderForceAgentsDir(projectRoot);
  const plugins = await loadPersonasFromDir(dir.personasDir, "project-local");

  // Backward compat: migrate legacy .builderforce/agents/ to personas/ if present
  const legacyAgentsDir = path.join(dir.root, LEGACY_AGENTS_DIR);
  try {
    const legacyFiles = (await fs.readdir(legacyAgentsDir)).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
    );
    if (legacyFiles.length > 0 && plugins.length === 0) {
      const migrated: AgentRole[] = [];
      await fs.mkdir(dir.personasDir, { recursive: true });
      for (const file of legacyFiles) {
        const src = path.join(legacyAgentsDir, file);
        const content = await fs.readFile(src, "utf-8");
        const role = parseYaml(content) as AgentRole;
        if (role?.name) {
          migrated.push(role);
          const dest = path.join(dir.personasDir, file);
          await fs.writeFile(dest, content, "utf-8");
        }
      }
      return migrated;
    }
  } catch {
    // Legacy dir missing or inaccessible
  }

  return plugins as AgentRole[];
}

/**
 * Save custom agent role/persona definition to .builderforce/personas/
 */
export async function saveAgentRole(projectRoot: string, role: AgentRole): Promise<void> {
  const dir = resolveBuilderForceAgentsDir(projectRoot);
  await fs.mkdir(dir.personasDir, { recursive: true });
  const filename = `${role.name.toLowerCase().replace(/\s+/g, "-")}.yaml`;
  await fs.writeFile(path.join(dir.personasDir, filename), stringifyYaml(role), "utf-8");
}

/**
 * Load project-scoped persona plugins from `.builderforce/personas/`.
 * Returns an empty array when the directory does not exist.
 */
export async function loadProjectPersonaPlugins(projectRoot: string): Promise<PersonaPlugin[]> {
  const dir = resolveBuilderForceAgentsDir(projectRoot);
  return loadPersonasFromDir(dir.personasDir, "project-local");
}

/**
 * Read persona assignments from `context.yaml`.
 * Returns an empty array when none are configured.
 */
export async function loadPersonaAssignments(projectRoot: string): Promise<PersonaAssignment[]> {
  try {
    const context = await loadProjectContext(projectRoot);
    return context?.personas?.assignments ?? [];
  } catch {
    return [];
  }
}

/**
 * Persist a persona assignment to `context.yaml`.
 * Merges with existing assignments; replaces any existing entry with the same name.
 */
export async function savePersonaAssignment(
  projectRoot: string,
  assignment: PersonaAssignment,
): Promise<void> {
  const context = await loadProjectContext(projectRoot);
  if (!context) {
    return;
  }
  const existing = context.personas?.assignments ?? [];
  const filtered = existing.filter((a) => a.name !== assignment.name);
  const updated = {
    ...context,
    personas: {
      assignments: [...filtered, assignment],
    },
  };
  await saveProjectContext(projectRoot, updated);
}

/**
 * Remove a persona assignment from `context.yaml`.
 */
export async function removePersonaAssignment(projectRoot: string, name: string): Promise<void> {
  const context = await loadProjectContext(projectRoot);
  if (!context?.personas?.assignments?.length) {
    return;
  }
  const updated = {
    ...context,
    personas: {
      assignments: context.personas.assignments.filter((a) => a.name !== name),
    },
  };
  await saveProjectContext(projectRoot, updated);
}
