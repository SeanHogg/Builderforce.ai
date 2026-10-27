/**
 * toolVocabulary — the product's words, mapped to the catalog's words, for per-turn
 * tool selection.
 *
 * Ported VERBATIM from `brain-embedded/src/toolVocabulary.ts` (PRD 35 WS2f). The
 * equivalence classes are DATA: a new class is another array, never another branch in
 * the scorer. See the source file for the full rationale (the "tickets → tasks" live
 * context-exhaustion bug this fixes).
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

/**
 * Interchangeable terms, as STEMS — already singularised the way the selector stems
 * them, so "tickets" and "ticket" both land here.
 */
const EQUIVALENCE_CLASSES: readonly (readonly string[])[] = [
  // The work item itself. `ticket` is the product's word and `task` is the catalog's;
  // this one class is what makes every `tasks.*` tool reachable from a ticket question.
  ['task', 'ticket', 'issue', 'story', 'backlog', 'todo'],
  // The board and its geography.
  ['kanban', 'board', 'lane', 'swimlane', 'column', 'card'],
  // Source control.
  ['repo', 'repository', 'codebase', 'git'],
  ['branch', 'commit', 'merge', 'rebase'],
  ['pr', 'pull', 'pullrequest'],
  // People. `member` is the catalog's word; the rest are what users type.
  ['member', 'teammate', 'colleague', 'people', 'person', 'staff'],
  // Conversations.
  ['chat', 'conversation', 'thread'],
  // Delivery planning. `epic` stays OUT of the objective class on purpose — objectives/
  // OKRs and epics are different entities with different tools.
  ['epic', 'feature'],
  ['objective', 'okr', 'keyresult'],
  // Runs.
  ['execution', 'run', 'dispatch'],
];

/** stem → every stem it is interchangeable with (including itself). Built once. */
const SYNONYMS: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const group of EQUIVALENCE_CLASSES) {
    for (const term of group) {
      const existing = map.get(term) ?? [];
      // A term appearing in two classes accumulates both — the classes are a
      // relation, not a partition, so this stays correct if one ever overlaps.
      for (const other of group) if (!existing.includes(other)) existing.push(other);
      map.set(term, existing);
    }
  }
  return map;
})();

/** The stems a query term should also match. Empty array when the term has no class. */
export function synonymsFor(stem: string): readonly string[] {
  return SYNONYMS.get(stem) ?? [];
}

/**
 * Expand a set of query stems with every interchangeable term, returned SEPARATELY so
 * the scorer can weight an exact hit above a synonym hit. Never includes a stem the
 * caller already has.
 */
export function expandWithSynonyms(stems: ReadonlySet<string>): Set<string> {
  const expanded = new Set<string>();
  for (const stem of stems) {
    for (const synonym of synonymsFor(stem)) {
      if (!stems.has(synonym)) expanded.add(synonym);
    }
  }
  return expanded;
}
