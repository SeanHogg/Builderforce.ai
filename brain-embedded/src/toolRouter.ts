/**
 * The tool ROUTER — the escape hatch that makes per-turn tool selection lossless.
 *
 * The problem with advertising a relevance-picked subset of a ~317-tool catalog is
 * not that it picks badly; it is that picking AT ALL is lossy and the model has no
 * way to know. A tool that misses the cut simply does not exist from where the model
 * is standing, so a request that needs it ends in a narrated call or an "I don't have
 * that data" — with no signal that the capability was there all along, one rank below
 * the cut. Worse, the cut is recomputed per turn, so a tool can be present on one
 * turn and gone on the next.
 *
 * The fix is a different DATA STRUCTURE rather than a better ranking: keep advertising
 * the relevant leaves for ergonomics, and additionally advertise three small, FIXED
 * tools that together reach every tool in the catalog:
 *
 *   find     → search the full catalog by keyword          (name + description only)
 *   describe → fetch one tool's exact JSON schema           (so args can be built)
 *   invoke   → call any tool in the catalog by name         (dispatch to the real one)
 *
 * Cost is three schemas per turn instead of 317, and the guarantee flips: nothing is
 * ever unreachable, only less convenient. This is progressive disclosure — the model
 * pays a round trip for the long tail and nothing for the hot set.
 *
 * Everything resolves against the in-memory catalog the run already holds, so `find`
 * and `describe` cost no network at all.
 */

import { asToolArgs } from '@builderforce/agent-loop';
import { advertisedToolName, resolveAdvertisedToolName, toolNameSet } from '@builderforce/agent-tools';
import type { BrainToolSpec } from './streamChatCompletion';

/** Advertised names of the three router tools. Stable — the model learns them. */
export const TOOL_ROUTER_FIND = 'builtin_tools_find';
export const TOOL_ROUTER_DESCRIBE = 'builtin_tools_describe';
export const TOOL_ROUTER_INVOKE = 'builtin_tools_invoke';

/** True when `name` is one of the router's own tools (not a catalog tool). */
export function isRouterTool(name: string): boolean {
  return name === TOOL_ROUTER_FIND || name === TOOL_ROUTER_DESCRIBE || name === TOOL_ROUTER_INVOKE;
}

/** How many matches `find` returns. Enough to choose from, small enough to stay cheap. */
const FIND_LIMIT = 25;

/**
 * The three router specs. Their descriptions are written AT the model: they have to
 * make it obvious that a missing tool is a lookup away, because a model that does not
 * know the catalog is bigger than its tool list will never think to look.
 */
export function routerToolSpecs(catalogSize: number): BrainToolSpec[] {
  const preamble =
    `This conversation has ${catalogSize} platform tools available in total, but only the most`
    + ' relevant ones are listed directly on each turn.';
  return [
    {
      type: 'function',
      function: {
        name: TOOL_ROUTER_FIND,
        description:
          `${preamble} Search ALL of them by keyword and get back their names and descriptions.`
          + ' Use this FIRST whenever the tool you want is not in your visible list —'
          + ' do NOT assume a capability is missing, and never write a tool call as plain text.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Keywords, e.g. "tickets backlog status" or "pull request".' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: TOOL_ROUTER_DESCRIBE,
        description:
          `${preamble} Get the exact parameter schema for one tool by name, so you can build`
          + ` its arguments before calling it with ${TOOL_ROUTER_INVOKE}.`,
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: `Exact tool name, e.g. "builtin_chats_list_tickets".` },
          },
          required: ['name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: TOOL_ROUTER_INVOKE,
        description:
          `${preamble} Call ANY of them by name, including ones not listed on this turn.`
          + ' This is a real call and it really executes — use it instead of describing what you'
          + ' would call.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Exact tool name to call; a catalog id such as "tasks.archive_many" is accepted too.' },
            args: { type: 'object', description: 'Arguments object for that tool.' },
          },
          required: ['name'],
        },
      },
    },
  ];
}

/** One catalog entry as `find` reports it. */
export interface ToolCatalogMatch {
  name: string;
  description: string;
}

/** Lower-cased words of length > 1, for the keyword match. */
function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
}

/**
 * App-manifest finder aliases (contract: docs/specs/make.md "W11 contract — the app manifest ai resource" §8).
 * Exactly these phrases resolve to BOTH app-manifest tools. Bare `service`, `schema`
 * or `launch` must NOT surface them — those words belong to other tools — so the two
 * tools are scored ONLY on an alias phrase or the word `manifest`, never on the
 * generic words (`schema`, `validate`, `ai`, `resource`) in their names/descriptions.
 */
const APP_MANIFEST_ALIAS_PHRASES = ['app manifest', 'builderforce.json', 'ai resource'] as const;
const APP_MANIFEST_TOOL_NAMES: ReadonlySet<string> = new Set([
  advertisedToolName('app_manifest.schema'),
  advertisedToolName('app_manifest.validate'),
]);

/**
 * Keyword search over the FULL catalog. Ranks a name match above a description match
 * (the same weighting `selectTools` uses — the model should see the tool whose NAME is
 * about tickets before one that merely mentions them).
 */
export function findTools(catalog: BrainToolSpec[], query: string, limit = FIND_LIMIT): ToolCatalogMatch[] {
  const terms = words(query);
  const lowered = query.toLowerCase();
  const manifestAlias = APP_MANIFEST_ALIAS_PHRASES.some((p) => lowered.includes(p));
  if (terms.length === 0 && !manifestAlias) return [];
  const scored: Array<{ m: ToolCatalogMatch; score: number; index: number }> = [];
  catalog.forEach((tool, index) => {
    const name = tool.function?.name ?? '';
    if (!name) return;
    const description = tool.function?.description ?? '';
    const haystackName = name.toLowerCase();
    const haystackDesc = description.toLowerCase();
    if (APP_MANIFEST_TOOL_NAMES.has(name)) {
      // Alias-gated: an alias phrase surfaces BOTH tools above the keyword crowd;
      // otherwise only the word `manifest` reaches them. Bare `schema`/`launch`/
      // `service` never do (done-check, contract §8).
      const score = (manifestAlias ? 20 : 0) + (terms.includes('manifest') ? 10 : 0);
      if (score > 0) scored.push({ m: { name, description }, score, index });
      return;
    }
    let score = 0;
    for (const t of terms) {
      if (haystackName.includes(t)) score += 10;
      else if (haystackDesc.includes(t)) score += 1;
    }
    if (score > 0) scored.push({ m: { name, description }, score, index });
  });
  return scored
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, limit)
    .map((e) => e.m);
}

/**
 * The spec for one catalog tool, or null when the name is unknown. The name resolves through
 * the shared `resolveAdvertisedToolName`, so a catalog id (`tasks.archive_many`) or the unprefixed
 * form reaches `builtin_tasks_archive_many`; the returned spec carries the ADVERTISED name.
 */
export function describeTool(catalog: BrainToolSpec[], name: string): BrainToolSpec | null {
  const resolved = resolveAdvertisedToolName(name, toolNameSet(catalog, (t) => t.function?.name));
  return resolved === null ? null : catalog.find((t) => t.function?.name === resolved) ?? null;
}

/**
 * Run a router call against the in-memory catalog.
 *
 * `find` and `describe` are answered locally (no network). `invoke` unwraps to a real
 * catalog call and is dispatched by the caller through `runTool`, so every guard the
 * normal path applies — confirmation gate, dedupe, audit, auto-link — still applies to
 * a routed call. Returns `{ dispatch }` for that case rather than calling anything
 * itself, keeping this module pure.
 */
export function handleRouterCall(
  catalog: BrainToolSpec[],
  name: string,
  args: unknown,
): { result: unknown } | { dispatch: { name: string; args: Record<string, unknown> } } {
  const a = (args ?? {}) as { query?: unknown; name?: unknown; args?: unknown };
  if (name === TOOL_ROUTER_FIND) {
    const query = typeof a.query === 'string' ? a.query : '';
    const matches = findTools(catalog, query);
    return {
      result: matches.length
        ? { matches, note: `Call one with ${TOOL_ROUTER_INVOKE}, or ${TOOL_ROUTER_DESCRIBE} first for its arguments.` }
        : { matches: [], note: `No tool matches "${query}". Try broader keywords; ${catalog.length} tools exist.` },
    };
  }
  if (name === TOOL_ROUTER_DESCRIBE) {
    const target = typeof a.name === 'string' ? a.name : '';
    const spec = describeTool(catalog, target);
    return {
      result: spec
        ? { name: spec.function?.name ?? target, description: spec.function?.description ?? '', parameters: spec.function?.parameters ?? {} }
        : { error: `Unknown tool "${target}". Use ${TOOL_ROUTER_FIND} to look up the exact name.` },
    };
  }
  // invoke
  const target = typeof a.name === 'string' ? a.name : '';
  if (!target) return { result: { error: `${TOOL_ROUTER_INVOKE} requires a "name".` } };
  if (isRouterTool(target)) {
    return { result: { error: `${target} cannot be invoked through the router.` } };
  }
  const spec = describeTool(catalog, target);
  const resolved = spec?.function?.name;
  if (!resolved) {
    return { result: { error: `Unknown tool "${target}". Use ${TOOL_ROUTER_FIND} to look up the exact name.` } };
  }
  // A router tool named by its catalog id (`tools.invoke`) is refused like the advertised name.
  if (isRouterTool(resolved)) {
    return { result: { error: `${target} cannot be invoked through the router.` } };
  }
  // The nested `args` came from model JSON, so it can be anything. The kernel's own
  // rule decides what counts as a bag — a routed call must not reach a tool with a
  // scalar or an array where every direct call would have had `{}`.
  // The dispatch carries the RESOLVED advertised name, never the catalog id the model wrote.
  return { dispatch: { name: resolved, args: asToolArgs(a.args) ?? {} } };
}
