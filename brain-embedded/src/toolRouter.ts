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
            name: { type: 'string', description: 'Exact tool name to call.' },
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
 * Keyword search over the FULL catalog. Ranks a name match above a description match
 * (the same weighting `selectTools` uses — the model should see the tool whose NAME is
 * about tickets before one that merely mentions them).
 */
export function findTools(catalog: BrainToolSpec[], query: string, limit = FIND_LIMIT): ToolCatalogMatch[] {
  const terms = words(query);
  if (terms.length === 0) return [];
  const scored: Array<{ m: ToolCatalogMatch; score: number; index: number }> = [];
  catalog.forEach((tool, index) => {
    const name = tool.function?.name ?? '';
    if (!name) return;
    const description = tool.function?.description ?? '';
    const haystackName = name.toLowerCase();
    const haystackDesc = description.toLowerCase();
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

/** The exact spec for one catalog tool, or null when the name is unknown. */
export function describeTool(catalog: BrainToolSpec[], name: string): BrainToolSpec | null {
  return catalog.find((t) => t.function?.name === name) ?? null;
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
): { result: unknown } | { dispatch: { name: string; args: unknown } } {
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
        ? { name: target, description: spec.function?.description ?? '', parameters: spec.function?.parameters ?? {} }
        : { error: `Unknown tool "${target}". Use ${TOOL_ROUTER_FIND} to look up the exact name.` },
    };
  }
  // invoke
  const target = typeof a.name === 'string' ? a.name : '';
  if (!target) return { result: { error: `${TOOL_ROUTER_INVOKE} requires a "name".` } };
  if (isRouterTool(target)) {
    return { result: { error: `${target} cannot be invoked through the router.` } };
  }
  if (!describeTool(catalog, target)) {
    return { result: { error: `Unknown tool "${target}". Use ${TOOL_ROUTER_FIND} to look up the exact name.` } };
  }
  return { dispatch: { name: target, args: a.args ?? {} } };
}
