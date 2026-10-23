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
 * no network — and the scoring is the shared `rankLexically` from
 * `@builderforce/agent-tools` (the same ranker the Worker's `tool_search` uses), fed
 * this module's product synonyms as extra weighted fields. It scores each tool against the live turn's text and keeps the best
 * `limit`, while pinning anything the run has already touched so a multi-step task
 * never loses a tool mid-flight.
 *
 * Safety posture: when in doubt, INCLUDE. A catalog at or under the limit is
 * returned untouched, so small deployments behave exactly as before.
 */

import { LEXICAL_WEIGHTS, lexicalStems, rankLexically, type LexicalField } from '@builderforce/agent-tools';
import type { BrainToolSpec } from './streamChatCompletion';
import { expandWithSynonyms } from './toolVocabulary';

/**
 * How many tools to advertise per turn. Comfortably under the ~128 threshold where
 * providers start to degrade, while leaving room for a broad request to still see
 * several domains at once.
 */
export const DEFAULT_TOOL_LIMIT = 64;

/** Score for a tool NAME stem the user typed verbatim. */
const NAME_HIT = LEXICAL_WEIGHTS.name;
/**
 * Score for a tool NAME stem reached through {@link expandWithSynonyms} — a user who asked
 * about "tickets" matching `builtin_tasks_list`. Deliberately below {@link NAME_HIT} so
 * a tool the user named exactly always outranks one found by synonym, while still
 * scoring far above any description match: before this existed, the whole `tasks_*`
 * domain scored ZERO on a question about tickets and was left out of the advertised
 * set entirely.
 */
const NAME_SYNONYM_HIT = 7;
/** Score for a description stem. Prose is weak evidence either way, so an exact hit
 *  and a synonym hit are worth the same here. */
const DESCRIPTION_HIT = LEXICAL_WEIGHTS.description;

/**
 * The product-vocabulary expansion of a field (see {@link ./toolVocabulary}): the
 * words a USER would say for the catalog words in `text`, minus the field's own stems,
 * so a term the user typed verbatim scores on the field itself and never twice.
 * Equivalence classes are symmetric, so expanding the catalog side matches exactly
 * the queries that expanding the query side used to.
 */
function synonymText(text: string): string {
  return [...expandWithSynonyms(lexicalStems(text))].join(' ');
}

/**
 * The weighted fields one tool is scored on by the shared lexical ranker
 * (`@builderforce/agent-tools` `rankLexically`). The NAME is weighted far above the
 * description: `builtin_tasks_list` matching "tasks" is a much stronger signal than the
 * word appearing somewhere in prose. The synonym fields carry the product vocabulary.
 */
function toolFields(tool: BrainToolSpec): LexicalField[] {
  const name = tool.function?.name ?? '';
  if (!name) return [];
  const description = tool.function?.description ?? '';
  return [
    { text: name, weight: NAME_HIT },
    { text: synonymText(name), weight: NAME_SYNONYM_HIT },
    { text: description, weight: DESCRIPTION_HIT },
    { text: synonymText(description), weight: DESCRIPTION_HIT },
  ];
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
  /**
   * Tool names the SYSTEM PROMPT instructs the model to call. Kept ahead of
   * everything else, because advertising less than the prompt promises is a
   * contradiction the model can only resolve by narrating a call it cannot make.
   */
  required?: Iterable<string>;
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

  const required = new Set(options.required ?? []);
  const pinned = new Set(options.pinned ?? []);
  const chosen: BrainToolSpec[] = [];
  const taken = new Set<string>();

  const take = (tool: BrainToolSpec): void => {
    const name = tool.function?.name;
    if (!name || taken.has(name)) return;
    taken.add(name);
    chosen.push(tool);
  };

  // 0. Tools the system prompt NAMES. These outrank even continuity: a prompt that
  //    says "call builtin_chats_list_tickets" while the tool is absent leaves the
  //    model no honest move, and it narrates the call instead of making it.
  for (const tool of tools) {
    if (chosen.length >= limit) break;
    if (required.has(tool.function?.name ?? '')) take(tool);
  }

  // 1. Tools this run already used — never drop one mid-task.
  for (const tool of tools) {
    if (chosen.length >= limit) break;
    if (pinned.has(tool.function?.name ?? '')) take(tool);
  }

  // 2. Relevance to the turn — the ONE shared lexical ranker. Ties keep catalog order.
  for (const tool of rankLexically(tools, options.query, toolFields, tools.length)) {
    if (chosen.length >= limit) break;
    take(tool);
  }

  // 3. Backfill in catalog order so a vague query still gets a full, stable set.
  for (const tool of tools) {
    if (chosen.length >= limit) break;
    take(tool);
  }

  // Emit in CATALOG order, whichever pass chose each tool. The passes above decide
  // the SET; they must not decide the ORDER, because the order is what the vendor's
  // prompt cache hashes. Tools precede the system prompt in Anthropic's cached prefix,
  // so any reordering — a tool the run just called moving from the "relevant" pass to
  // the "pinned" pass and therefore ahead of its neighbours — invalidated the cached
  // tools block AND the system prompt behind it on the very next turn. A tool loop
  // pins a new tool on most of its early turns, so the ~13k-token prefix was re-billed
  // at full price for most of the run. Same set ⇒ same bytes ⇒ a cache read.
  const position = new Map(tools.map((t, i) => [t, i] as const));
  chosen.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));

  return { tools: chosen, trimmed: true, available };
}
