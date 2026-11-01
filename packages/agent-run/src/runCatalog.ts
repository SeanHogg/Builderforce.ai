/**
 * runCatalog - the tools a run is offered and which calls the surface's own provider runs.
 *
 * The core registry (built once), the registries of entry points that bring tools of their own, the schemas the model is shown before
 * the tools policy narrows them, and the ownership test the dispatch and the kernel's hooks share. Split out of `runTurn.ts` (PRD 35 §5 rule 4).
 */

import { SKILL_TOOLS, SUBAGENT_TOOLS, buildCoreToolRegistry, type ToolRegistry, type ToolSchema } from "@builderforce/agent-tools";
import type { RunPorts } from "./contract.js";

/**
 * The registry the agent dispatches through. Built once: the catalog does not change per run.
 * Delegation and skill authoring are not core task tools, so they are registered on top of the
 * core set: a surface is offered them only by granting `orchestrate` / `skill.author`. Without
 * them a parent could never delegate - and a child, being a clone of its parent, could not either.
 */
const CORE_REGISTRY = buildCoreToolRegistry();
for (const tool of [...SKILL_TOOLS, ...SUBAGENT_TOOLS]) CORE_REGISTRY.register(tool);
/** The registries of entry points that bring tools of their own (skill authoring, delegation), built once per tool list. */
const REGISTRIES = new WeakMap<readonly object[], ToolRegistry>();

/** The registry THIS run dispatches through: the core catalog, plus whatever the entry point supplied as data. */
export function registryOf(ports: RunPorts): ToolRegistry {
  const extra = ports.tools;
  if (!extra || extra.length === 0) return CORE_REGISTRY;
  let registry = REGISTRIES.get(extra);
  if (!registry) {
    registry = buildCoreToolRegistry();
    for (const tool of extra) registry.register(tool);
    REGISTRIES.set(extra, registry);
  }
  return registry;
}

/**
 * Does the surface's own tool provider run this call? It runs the names the shared
 * registry does not - all of them, when it declares its catalog closed.
 */
export function ownsCall(ports: RunPorts, name: string): boolean {
  const platform = ports.platform;
  return platform !== undefined && (platform.closed === true || !registryOf(ports).has(name));
}

/** The schemas the model is offered, before the tools policy narrows them: the registry's, then the surface's own. */
export function offeredSchemas(ports: RunPorts): ToolSchema[] {
  const seen = new Set<string>();
  return [...registryOf(ports).schemasFor(ports.capabilities), ...(ports.extensions?.schemas() ?? []), ...(ports.platform?.schemas({ rungs: {} }) ?? [])].filter((schema) => {
    const name = schema.function?.name;
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}
