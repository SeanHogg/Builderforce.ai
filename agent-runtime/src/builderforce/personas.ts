/**
 * Persona plugin system for builderForceAgents.
 *
 * Personas are agent roles that can be:
 *  - Shipped as built-ins in builderForceAgents core
 *  - Installed from the Builderforce.ai Marketplace (synced via Builderforce)
 *  - Assigned to a specific agentNode instance via Builderforce
 *  - Defined locally in `.builderforce/personas/*.yaml` (project-scoped)
 *  - Defined globally in `~/.builderforce/personas/*.yaml` (user-global)
 *
 * Loading precedence (highest wins):
 *   builderforce-assigned > marketplace > project-local > user-global > builtin
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { logDebug } from "../logger.js";
import type { AgentRole, PersonaAssignment, PersonaPlugin, PersonaSource } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Directory name inside `.builderforce/` for project-scoped personas */
export const PERSONAS_SUBDIR = "personas";

/** Directory name inside `~/.builderforce/` for user-global personas */
export const USER_PERSONAS_DIR = path.join(os.homedir(), ".builderforce", "personas");

// ---------------------------------------------------------------------------
// PersonaRegistry
// ---------------------------------------------------------------------------

/**
 * Registry for persona plugins.
 *
 * Maintains four layers of personas (built-ins, user-global, project-local,
 * marketplace) and a set of active assignments.  `resolve()` returns the
 * highest-precedence persona matching the requested name so callers never
 * need to care about the loading source.
 */
export class PersonaRegistry {
  private readonly builtins: PersonaPlugin[] = [];
  private readonly byName = new Map<string, PersonaPlugin>();
  private assignments: PersonaAssignment[] = [];

  // Source precedence — lower index = lower priority
  private static readonly SOURCE_PRIORITY: PersonaSource[] = [
    "builtin",
    "user-global",
    "project-local",
    "marketplace",
    "builderforce-assigned",
  ];

  private static priority(source: PersonaSource): number {
    const idx = PersonaRegistry.SOURCE_PRIORITY.indexOf(source);
    return idx === -1 ? -1 : idx;
  }

  /**
   * Register one or more built-in roles as personas.
   * These form the lowest-priority layer and are always available.
   */
  registerBuiltins(roles: AgentRole[]): void {
    for (const role of roles) {
      const plugin: PersonaPlugin = { ...role, source: "builtin", active: false };
      this.builtins.push(plugin);
      if (!this.byName.has(role.name)) {
        this.byName.set(role.name, plugin);
      }
    }
  }

  /**
   * Register a persona plugin, replacing any existing entry with the same name
   * only if the new plugin has higher or equal source precedence.
   */
  register(plugin: PersonaPlugin): void {
    const existing = this.byName.get(plugin.name);
    if (
      !existing ||
      PersonaRegistry.priority(plugin.source) >= PersonaRegistry.priority(existing.source)
    ) {
      this.byName.set(plugin.name, plugin);
      logDebug(
        `[personas] registered "${plugin.name}" from ${plugin.source}` +
          (plugin.pluginMetadata?.version ? ` v${plugin.pluginMetadata.version}` : ""),
      );
    }
  }

  /**
   * Load personas from a directory of PERSONA.yaml files and register them.
   * Silently skips files that cannot be parsed.
   */
  async loadFromDir(dir: string, source: PersonaSource): Promise<number> {
    const plugins = await loadPersonasFromDir(dir, source);
    for (const p of plugins) {
      this.register(p);
    }
    return plugins.length;
  }

  /**
   * Apply persona assignments (e.g. from context.yaml or Builderforce).
   * Marks matching personas as active; unknown names are stored and will
   * activate if the persona is registered later.
   */
  applyAssignments(assignments: PersonaAssignment[]): void {
    this.assignments = assignments;
    for (const assignment of assignments) {
      const plugin = this.byName.get(assignment.name);
      if (plugin) {
        plugin.active = true;
      }
    }
  }

  /**
   * Activate a single persona by name (creates an assignment if not present).
   * Returns false when the persona is not registered.
   */
  activate(name: string): boolean {
    const plugin = this.byName.get(name);
    if (!plugin) {
      return false;
    }
    plugin.active = true;
    if (!this.assignments.find((a) => a.name === name)) {
      this.assignments.push({ name, assignedAt: new Date().toISOString() });
    }
    return true;
  }

  /**
   * Deactivate a persona.  The assignment record is retained so Builderforce
   * can see it was intentionally deactivated vs. never assigned.
   */
  deactivate(name: string): void {
    const plugin = this.byName.get(name);
    if (plugin) {
      plugin.active = false;
    }
  }

  /**
   * Resolve the best persona for the given name.
   * Returns null when no persona with that name is registered.
   */
  resolve(name: string): PersonaPlugin | null {
    return this.byName.get(name) ?? null;
  }

  /** All registered personas, sorted by name. */
  listAll(): PersonaPlugin[] {
    return Array.from(this.byName.values()).toSorted((a, b) => a.name.localeCompare(b.name));
  }

  /** Only active (assigned) personas. */
  listActive(): PersonaPlugin[] {
    return this.listAll().filter((p) => p.active);
  }

  /** Current assignment records (suitable for serialising to context.yaml). */
  getAssignments(): PersonaAssignment[] {
    return this.assignments.slice();
  }

  /** Test-only: unregister a persona by name (does not remove builtins). */
  unregisterForTest(name: string): void {
    const existing = this.byName.get(name);
    if (existing && existing.source !== "builtin") {
      this.byName.delete(name);
    }
  }
}

// ---------------------------------------------------------------------------
// File loading helpers
// ---------------------------------------------------------------------------

/** Resolve a string field from pluginMetadata (nested) or top-level raw YAML. */
function metaStr(
  pluginMeta: PersonaPlugin["pluginMetadata"] | undefined,
  raw: Record<string, unknown>,
  field: keyof NonNullable<PersonaPlugin["pluginMetadata"]> | "agenthubId",
): string | undefined {
  const fromMeta = field === "agenthubId" ? undefined : pluginMeta?.[field];
  if (typeof fromMeta === "string") {
    return fromMeta;
  }
  const fromRaw = raw[field];
  return typeof fromRaw === "string" ? fromRaw : undefined;
}

/**
 * Parse a single PERSONA.yaml file into a `PersonaPlugin`.
 * Returns null when the file is missing required fields.
 */
export async function loadPersonaFromFile(
  filePath: string,
  source: PersonaSource,
): Promise<PersonaPlugin | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const raw = parseYaml(content) as Record<string, unknown>;

    if (!raw || typeof raw.name !== "string" || !raw.name.trim()) {
      logDebug(`[personas] skipping ${filePath}: missing required "name" field`);
      return null;
    }

    // Extract plugin-specific metadata (nested under `pluginMetadata:` or top-level)
    const pluginMeta = raw.pluginMetadata as PersonaPlugin["pluginMetadata"] | undefined;

    // Top-level shortcuts for common marketplace fields (PERSONA.yaml may use either form).
    // "agenthubId" is accepted as a legacy alias for "marketplaceId".
    const mergedMeta: PersonaPlugin["pluginMetadata"] = {
      marketplaceId:
        metaStr(pluginMeta, raw, "marketplaceId") ?? metaStr(pluginMeta, raw, "agenthubId"),
      version: metaStr(pluginMeta, raw, "version"),
      author: metaStr(pluginMeta, raw, "author"),
      authorUrl: metaStr(pluginMeta, raw, "authorUrl"),
      license: metaStr(pluginMeta, raw, "license"),
      requiresLicense:
        pluginMeta?.requiresLicense ??
        (typeof raw.requiresLicense === "boolean" ? raw.requiresLicense : undefined),
      marketplaceUrl: metaStr(pluginMeta, raw, "marketplaceUrl"),
      builderForceAgentsVersion: metaStr(pluginMeta, raw, "builderForceAgentsVersion"),
      tags: pluginMeta?.tags ?? (Array.isArray(raw.tags) ? (raw.tags as string[]) : undefined),
    };

    // Remove undefined keys
    const cleanMeta = Object.fromEntries(
      Object.entries(mergedMeta).filter(([, v]) => v !== undefined),
    ) as PersonaPlugin["pluginMetadata"];

    const plugin: PersonaPlugin = {
      name: raw.name,
      description: typeof raw.description === "string" ? raw.description : "",
      capabilities: Array.isArray(raw.capabilities) ? (raw.capabilities as string[]) : [],
      tools: Array.isArray(raw.tools) ? (raw.tools as string[]) : [],
      systemPrompt: typeof raw.systemPrompt === "string" ? raw.systemPrompt : undefined,
      persona:
        raw.persona && typeof raw.persona === "object"
          ? (raw.persona as PersonaPlugin["persona"])
          : undefined,
      outputFormat:
        raw.outputFormat && typeof raw.outputFormat === "object"
          ? (raw.outputFormat as PersonaPlugin["outputFormat"])
          : undefined,
      model: typeof raw.model === "string" ? raw.model : undefined,
      thinking: typeof raw.thinking === "string" ? raw.thinking : undefined,
      constraints: Array.isArray(raw.constraints) ? (raw.constraints as string[]) : undefined,
      source,
      filePath,
      pluginMetadata: Object.keys(cleanMeta ?? {}).length > 0 ? cleanMeta : undefined,
      active: false,
    };

    return plugin;
  } catch (err) {
    logDebug(`[personas] failed to load ${filePath}: ${String(err)}`);
    return null;
  }
}

/**
 * Load all PERSONA.yaml / PERSONA.yml files from a directory.
 */
export async function loadPersonasFromDir(
  dir: string,
  source: PersonaSource,
): Promise<PersonaPlugin[]> {
  const plugins: PersonaPlugin[] = [];
  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (file.endsWith(".yaml") || file.endsWith(".yml")) {
        const filePath = path.join(dir, file);
        const plugin = await loadPersonaFromFile(filePath, source);
        if (plugin) {
          plugins.push(plugin);
        }
      }
    }
  } catch {
    // Directory does not exist or is inaccessible — not an error
  }
  return plugins;
}

// ---------------------------------------------------------------------------
// Brain integration helpers
// ---------------------------------------------------------------------------

/**
 * Build a structured persona identity block suitable for injection into the
 * builderForceAgentsLLM brain's system prompt.
 *
 * The block is recognised by the brain as `--- Agent Persona ---` and tells
 * it which role it is playing, how to communicate (voice), what lens to apply
 * (perspective), how to make decisions (decisionStyle), and what sections to
 * produce (outputFormat).  Returns an empty string when the role has no
 * persona or output-format metadata worth surfacing.
 */
export function buildPersonaSystemBlock(role: AgentRole): string {
  const lines: string[] = [];

  const hasPersona = Boolean(role.persona);
  const hasFormat = Boolean(
    role.outputFormat?.requiredSections?.length || role.outputFormat?.outputPrefix,
  );
  const hasConstraints = Boolean(role.constraints?.length);

  if (!hasPersona && !hasFormat && !hasConstraints) {
    return "";
  }

  lines.push("--- Agent Persona ---");
  lines.push(`Role: ${role.name}`);

  if (role.persona) {
    lines.push(`Voice: ${role.persona.voice}`);
    lines.push(`Perspective: ${role.persona.perspective}`);
    lines.push(`Decision style: ${role.persona.decisionStyle}`);
  }

  if (role.outputFormat?.requiredSections?.length) {
    lines.push(`Required output sections: ${role.outputFormat.requiredSections.join(", ")}`);
  }

  if (role.outputFormat?.outputPrefix) {
    lines.push(`Prefix your summary with: ${role.outputFormat.outputPrefix}`);
  }

  if (role.constraints?.length) {
    lines.push(`Constraints: ${role.constraints.join("; ")}`);
  }

  lines.push("---");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Global registry singleton
// ---------------------------------------------------------------------------

/**
 * Process-wide `PersonaRegistry` instance.
 * Populated at gateway startup; consulted by `findAgentRole()`.
 */
export const globalPersonaRegistry = new PersonaRegistry();
