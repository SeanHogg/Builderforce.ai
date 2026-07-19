/**
 * Per-turn tool selection.
 *
 * The Brain's catalog has grown to ~300 tools (205 first-party `builtin_*` entries
 * plus tenant MCP servers and navigation). Sending ALL of them on every turn is
 * the failure mode this module exists to fix:
 *
 *   - Most providers degrade sharply past ~128 tool definitions, and small
 *     free-pool models routinely respond to an oversized catalog by emitting NO
 *     tool calls at all — observed live: a chart request answered with "I do not
 *     have the task status data", zero tool calls, three times running, with 308
 *     tools advertised.
 *   - Every definition carries a JSON schema, so the catalog alone can dominate
 *     the prompt budget before the conversation is even considered.
 *
 * The selection is LEXICAL and deterministic — no embeddings, no extra round trip,
 * no network. It scores each tool against the live turn's text and keeps the best
 * `limit`, while pinning anything the run has already touched so a multi-step task
 * never loses a tool mid-flight.
 *
 * Safety posture: when in doubt, INCLUDE. A catalog at or under the limit is
 * returned untouched, so small deployments behave exactly as before.
 */

import type { BrainToolSpec } from './streamChatCompletion';

/**
 * How many tools to advertise per turn. Comfortably under the ~128 threshold where
 * providers start to degrade, while leaving room for a broad request to still see
 * several domains at once.
 */
export const DEFAULT_TOOL_LIMIT = 64;

/** Words too common to carry signal when matching a query against a tool. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'is', 'are', 'was', 'be', 'by',
  'with', 'from', 'this', 'that', 'these', 'those', 'it', 'its', 'as', 'at', 'me', 'my', '我',
  'i', 'we', 'you', 'your', 'please', 'can', 'could', 'would', 'should', 'do', 'does', 'did',
  'get', 'show', 'give', 'make', 'now', 'all', 'any', 'how', 'what', 'which', 'who', 'when',
]);

/** Split text into lower-cased, meaningful word stems. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9一-鿿]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/** Singular/plural-insensitive comparison ("tasks" matches "task"). */
function stem(word: string): string {
  if (word.length > 3 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 2 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/**
 * Relevance of one tool to the turn's query terms.
 *
 * The NAME is weighted far above the description: `builtin_tasks_list` matching
 * "tasks" is a much stronger signal than the word appearing somewhere in prose.
 */
function scoreTool(tool: BrainToolSpec, queryStems: Set<string>): number {
  const name = (tool.function?.name ?? '').toLowerCase();
  const description = (tool.function?.description ?? '').toLowerCase();
  if (!name) return 0;

  let score = 0;
  const nameStems = new Set(tokenize(name).map(stem));
  for (const s of nameStems) if (queryStems.has(s)) score += 10;

  const descStems = new Set(tokenize(description).map(stem));
  for (const s of descStems) if (queryStems.has(s)) score += 1;

  return score;
}

export interface SelectToolsOptions {
  /** The turn's text — typically the latest user message. */
  query: string;
  /** Max tools to advertise. Defaults to {@link DEFAULT_TOOL_LIMIT}. */
  limit?: number;
  /**
   * Tool names already called in this run. Always kept regardless of score, so a
   * multi-step task cannot lose a tool it is mid-way through using.
   */
  pinned?: Iterable<string>;
}

export interface ToolSelection {
  tools: BrainToolSpec[];
  /** True when the catalog was trimmed (i.e. selection actually applied). */
  trimmed: boolean;
  /** Size of the catalog before selection — recorded in the run trace. */
  available: number;
}

/**
 * Choose the tools to advertise for one turn.
 *
 * Order of inclusion: pinned tools first (continuity), then by descending
 * relevance, then — if the limit is still unmet — catalog order, so a vague query
 * ("help me") still gets a usable, stable set rather than an arbitrary one.
 */
export function selectToolsForTurn(
  tools: BrainToolSpec[] | undefined,
  options: SelectToolsOptions,
): ToolSelection {
  const available = tools?.length ?? 0;
  const limit = options.limit ?? DEFAULT_TOOL_LIMIT;

  // Nothing to do — behave exactly as before for small catalogs.
  if (!tools || available <= limit) {
    return { tools: tools ?? [], trimmed: false, available };
  }

  const pinned = new Set(options.pinned ?? []);
  const queryStems = new Set(tokenize(options.query).map(stem));

  const chosen: BrainToolSpec[] = [];
  const taken = new Set<string>();

  const take = (tool: BrainToolSpec): void => {
    const name = tool.function?.name;
    if (!name || taken.has(name)) return;
    taken.add(name);
    chosen.push(tool);
  };

  // 1. Tools this run already used — never drop one mid-task.
  for (const tool of tools) {
    if (chosen.length >= limit) break;
    if (pinned.has(tool.function?.name ?? '')) take(tool);
  }

  // 2. Relevance to the turn. Stable sort: equal scores keep catalog order.
  const scored = tools
    .map((tool, index) => ({ tool, index, score: scoreTool(tool, queryStems) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));
  for (const entry of scored) {
    if (chosen.length >= limit) break;
    take(entry.tool);
  }

  // 3. Backfill in catalog order so a vague query still gets a full, stable set.
  for (const tool of tools) {
    if (chosen.length >= limit) break;
    take(tool);
  }

  return { tools: chosen, trimmed: true, available };
}
