/**
 * evermindChatTiering — "this conversation's memories FIRST, the project's after".
 *
 * ── THE BUG THIS FIXES ───────────────────────────────────────────────────────────
 * Reply-time recall was scoped to `(tenantId, projectId, query)` and nothing else.
 * A project Evermind learns from EVERY chat in the project (plus agent runs and
 * incident post-mortems), so reopening a conversation recalled whatever the whole
 * project had ever learned that matched lexically. Reported from the field: a chat
 * closed and reopened "recalled information that was not part of the chat" — which is
 * exactly what a project-wide ranker does, and it reads to the user as the assistant
 * confidently remembering things nobody in that conversation ever said.
 *
 * ── WHY TIERING AND NOT FILTERING ────────────────────────────────────────────────
 * The obvious fix is to filter recall to the current chat. That is worse than the
 * bug. A project Evermind's most valuable memories have NO chat at all — agent run
 * outcomes, incident causes, imported lessons — and a brand-new chat has none of its
 * own, so a filter would give the first turn of every conversation an empty memory
 * and throw away the institutional knowledge the model exists to accumulate.
 *
 * So recall is TIERED, which is what "pinned first by the chat and then broadened"
 * means: the conversation's own memories are placed first and are never displaced by
 * a higher-scoring memory from elsewhere, and the remaining budget is filled from the
 * wider project. The chat gets primacy; the project still gets to contribute.
 *
 * ── ABSENT PROVENANCE IS "PROJECT-WIDE", NOT "NOT MINE" ──────────────────────────
 * Memories merged before contributions carried a `chatId` have none, as do all
 * non-chat contributions. Those are BROADER-tier, never excluded — treating a missing
 * id as a non-match would silently discard every memory the project learned before
 * this shipped.
 *
 * PURE: takes ranked candidates, returns a reordered slice. No IO, no cache, no
 * knowledge of how the ranking was produced (lexical or SSM-embedding), so it applies
 * identically to both.
 */

/** The minimum a candidate needs to be tiered. Structural, so both the lexical
 *  `RankedRecall` and any future ranked shape satisfy it without a conversion. */
export interface ChatTierable {
  /** The chat that contributed this memory; absent for project-wide memories. */
  chatId?: number;
}

/** Which tier a returned memory came from — recorded so a recall is explainable. */
export type RecallTier = 'chat' | 'project';

export interface TieredRecall<T> {
  items: T[];
  /** How many of {@link items} came from the current chat. */
  fromChat: number;
  /** How many came from the wider project (including memories with no chat). */
  fromProject: number;
}

/**
 * Order ranked candidates so the current chat's own memories come first.
 *
 * Relative order WITHIN each tier is preserved exactly as the ranker produced it —
 * this decides precedence between tiers and nothing else, so a better-scoring memory
 * never overtakes a worse-scoring one inside the same tier.
 *
 * With no `chatId` (a global chat, or a caller that does not track one) the input is
 * returned in rank order, capped — i.e. exactly the previous behaviour, so nothing
 * regresses for surfaces that have no conversation to pin to.
 *
 * @param limit total memories to return. Both tiers draw from this one budget: the
 *   chat's memories take what they need and the project fills the remainder, so a
 *   conversation with plenty of its own history naturally crowds the project out,
 *   and a fresh conversation is answered almost entirely from the project.
 */
export function tierRecallByChat<T extends ChatTierable>(
  candidates: readonly T[],
  chatId: number | null | undefined,
  limit: number,
): TieredRecall<T> {
  const cap = Math.max(0, Math.trunc(limit));
  if (cap === 0) return { items: [], fromChat: 0, fromProject: 0 };

  if (chatId == null) {
    const items = candidates.slice(0, cap);
    return { items, fromChat: 0, fromProject: items.length };
  }

  const own: T[] = [];
  const broader: T[] = [];
  for (const candidate of candidates) {
    (candidate.chatId === chatId ? own : broader).push(candidate);
  }

  const items = [...own, ...broader].slice(0, cap);
  // Counted from what was actually RETURNED, not from the partition: a chat with more
  // matching memories than the budget returns none from the project, and the report
  // has to say so rather than describing candidates the caller never saw.
  const fromChat = items.filter((i) => i.chatId === chatId).length;
  return { items, fromChat, fromProject: items.length - fromChat };
}
