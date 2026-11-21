/**
 * toolNaming — the ONE translation between a platform catalog id (`tasks.archive_many`)
 * and the name a model sees it advertised under (`builtin_tasks_archive_many`).
 *
 * Every surface that resolves a model-emitted name against its tool list goes through
 * {@link resolveAdvertisedToolName} (or {@link resolveCallName}, which remaps a hallucinated
 * synonym first): the Brain's tool router (`describe`/`invoke`) and call preflight, the MCP
 * gateway's flat-name lookup and the VS Code native run tool. A model that names a tool by
 * its catalog id — the form prompts, docs and the model's own earlier prose use — reaches
 * the advertised tool instead of an "Unknown tool" dead end.
 *
 * Pure: no `node:*`, no DOM — the Worker, the browser and Node all import it.
 */

import { resolveToolAlias } from "./toolAliases.js";

/** The prefix every first-party platform tool is advertised under. */
export const BUILTIN_TOOL_PREFIX = "builtin_";

/** A namespace separator (`mcp__server__tool`, `ext__tool`): a name carrying one is another source's, matched exactly. */
const NAMESPACE_SEPARATOR = "__";

const NON_IDENT = /[^a-zA-Z0-9]+/g;

/**
 * The name a platform catalog tool is advertised to the MODEL under:
 * `tasks.archive_many` → `builtin_tasks_archive_many`.
 */
export function advertisedToolName(id: string): string {
  return `${BUILTIN_TOOL_PREFIX}${id.replace(NON_IDENT, "_")}`;
}

/**
 * Resolve a model-emitted tool name to the known (advertised) name it means, or null.
 *
 * Tiers, in order:
 *  1. the exact known name — always wins, so a surface's own unprefixed tool (`read_file`) is never
 *     rerouted to a builtin of a similar name;
 *  2. a name carrying another source's namespace (`mcp__…`, any `__`) — exact only, never re-prefixed;
 *  3. an already-`builtin`-prefixed name whose separators differ (`builtin.tasks.list`);
 *  4. a dotted/slashed catalog id (`tasks.archive_many`) or the bare underscore form without the
 *     prefix (`tasks_archive_many`) — reached only when tier 1 found no exact match on the surface
 *     and tier 2 found no other prefix. A bare name that is not the surface's own (`read_file` on a
 *     surface without it) therefore resolves to `builtin_read_file` when the surface advertises one:
 *     that IS the same catalog tool, flattened.
 * Anything else returns null.
 */
export function resolveAdvertisedToolName(
  requested: string,
  knownNames: Iterable<string> | ReadonlySet<string>,
): string | null {
  const name = requested.trim();
  if (!name) return null;
  const known: ReadonlySet<string> = knownNames instanceof Set ? knownNames : new Set(knownNames);
  if (known.has(name)) return name;
  if (name.includes(NAMESPACE_SEPARATOR)) return null;
  const flat = name.replace(NON_IDENT, "_").replace(/^_+|_+$/g, "");
  if (!flat) return null;
  const candidate = flat.toLowerCase().startsWith(BUILTIN_TOOL_PREFIX)
    ? `${BUILTIN_TOOL_PREFIX}${flat.slice(BUILTIN_TOOL_PREFIX.length)}`
    : advertisedToolName(flat);
  return known.has(candidate) ? candidate : null;
}

/**
 * The known name a model-emitted CALL name means: a hallucinated synonym remapped (`resolveToolAlias`,
 * `list_dir` → `list_files`), then a catalog id written as the name resolved to its advertised tool.
 * Unresolved ⇒ the alias, so the caller's own "unknown tool" handling sees what the model wrote (remapped).
 */
export function resolveCallName(raw: string, knownNames: Iterable<string> | ReadonlySet<string>): string {
  const alias = resolveToolAlias(raw);
  return resolveAdvertisedToolName(alias, knownNames) ?? alias;
}

const nameSets = new WeakMap<object, ReadonlySet<string>>();

/**
 * The set of names in a tool list, built once per list (memoized by the array's identity). A catalog array is
 * built per run / per request and not mutated after, so the resolver's lookups never rebuild it per call.
 */
export function toolNameSet<T>(tools: readonly T[], nameOf: (tool: T) => string | undefined): ReadonlySet<string> {
  let set = nameSets.get(tools);
  if (!set) {
    set = new Set(tools.map(nameOf).filter((n): n is string => !!n));
    nameSets.set(tools, set);
  }
  return set;
}
