/**
 * The Brain's tool RANKER. The per-turn selection itself (the cap, the prompt-named tools, the pinned tools appended beyond it) is the
 * agent's one selector (`@builderforce/agent-run` `policy/tools`); what this module owns is how a tool scores against the turn's text:
 * the shared `rankLexically` from `@builderforce/agent-tools` (the same ranker the Worker's `tool_search` uses), fed this module's
 * product synonyms as extra weighted fields. The agent takes `relevantTools` as its ranker (`run/brainPlatformTools.ts`).
 *
 * Why a catalog is trimmed at all: the Brain's catalog has grown to ~300 tools, and most providers degrade sharply past ~128 tool
 * definitions - small free-pool models answer an oversized catalog with NO tool calls (a chart request answered "I do not have the task
 * status data", zero calls, three times running, with 308 tools advertised) - and every definition carries a JSON schema.
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

/**
 * The tools of `tools` that match `query`, best first (the shared lexical ranker over this module's fields). The relevance order of the
 * agent's tool selection (`run/brainPlatformTools.ts`).
 */
export function relevantTools<T extends BrainToolSpec>(tools: readonly T[], query: string): T[] {
  return rankLexically(tools, query, toolFields, tools.length);
}
