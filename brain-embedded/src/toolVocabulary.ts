/**
 * toolVocabulary — the product's words, mapped to the catalog's words, for per-turn
 * tool selection.
 *
 * ── THE BUG THIS FIXES ───────────────────────────────────────────────────────────
 * {@link ./selectTools} scores a tool by matching the turn's word stems against the
 * tool's NAME (+10) and description (+1). That is a good ranker and it had one blind
 * spot big enough to lose whole domains: the catalog is named in the DOMAIN's
 * vocabulary (`tasks.list`, `tasks.get`, `tasks.update`) while users write in the
 * PRODUCT's ("review the open tickets…"). `ticket` and `task` share no stem, so every
 * `tasks_*` tool scored ZERO on a question that was entirely about tasks.
 *
 * Measured on a real session: the turn "Review the open tickets and the status of each
 * ticket. For tickets that have pending code changes…" advertised 67 of 445 tools and
 * `builtin_tasks_list` was not among them — it lost to `builtin_chats_list_tickets` and
 * `builtin_manager_stalled_tickets`, which won only because the literal string "ticket"
 * appears in their names. The model concluded "I don't have a direct list all project
 * tickets tool", fell back to enumerating git branches in a shell, and exhausted its
 * context window. The tool it needed existed the whole time.
 *
 * ── EQUIVALENCE CLASSES, NOT A DIRECTIONAL MAP ───────────────────────────────────
 * Synonyms are declared as CLASSES of interchangeable terms rather than as
 * `from → to` pairs, so the relation is symmetric by construction: adding `ticket` to
 * the task class makes "ticket" find `tasks.*` AND "task" find a tool named `ticket*`,
 * with no second table to keep in sync. A class is DATA — a new one is another array,
 * never another branch in the scorer.
 *
 * ── THE BAR FOR ADDING A CLASS ───────────────────────────────────────────────────
 * Only words that name the SAME platform object. Widening a class is not free: every
 * term added makes some unrelated tool reachable by a word the user did not mean, and
 * the budget is fixed, so a bad synonym evicts a good tool. Two rules follow:
 *
 *   • NEVER merge things the domain deliberately keeps apart. `epic` and `objective`
 *     are the standing example: OKR objectives and delivery epics are separate
 *     entities with separate tables and separate tools on this platform, and folding
 *     them together here would answer an OKR question with epic tooling. They are in
 *     different classes below, and must stay that way.
 *   • Prefer the word users actually type. These classes are drawn from observed
 *     phrasing, not from a thesaurus.
 */

/**
 * Interchangeable terms, as STEMS — already singularised the way
 * {@link ./selectTools} stems them, so "tickets" and "ticket" both land here.
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
  // Delivery planning. `epic` stays OUT of the objective class on purpose — see the
  // header: objectives/OKRs and epics are different entities with different tools.
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

/**
 * The stems a query term should also match. Returns an empty array for a term with
 * no class, so the caller pays nothing for the overwhelmingly common case.
 */
export function synonymsFor(stem: string): readonly string[] {
  return SYNONYMS.get(stem) ?? [];
}

/**
 * Expand a set of query stems with every interchangeable term.
 *
 * Returned SEPARATELY from the original stems rather than merged into them, so the
 * scorer can weight an exact hit above a synonym hit. Never includes a stem the
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
