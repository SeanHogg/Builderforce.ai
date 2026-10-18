/**
 * The client half of incremental canvas presence (`api/.../creation/presenceDelta.ts`).
 *
 * The presence poll sends `known` — userId → fingerprint from its last answer — and
 * the server answers with full rows only for members whose drawn presence changed,
 * `present` (every active id) and the new `fingerprints`. {@link createPresenceTracker}
 * holds the roster between ticks and folds each answer into it, so the board keeps
 * drawing every member while the wire carries only what moved.
 *
 * An answer without `present` is a full list (an older server): it replaces the
 * roster outright. If an answer ever names a present member the tracker holds no
 * row for, it forgets its fingerprints so the next tick asks for everyone.
 */

export interface PresenceAnswer<M extends { userId: string }> {
  members: M[];
  present?: string[];
  fingerprints?: Record<string, string>;
}

/** Fold one answer into the held roster. Pure; returns the roster in `present` order. */
export function mergePresence<M extends { userId: string }>(
  held: readonly M[],
  answer: PresenceAnswer<M>,
): { members: M[]; complete: boolean } {
  if (!answer.present) return { members: answer.members, complete: true };
  const changed = new Map(answer.members.map((member) => [member.userId, member]));
  const prior = new Map(held.map((member) => [member.userId, member]));
  const members: M[] = [];
  let complete = true;
  for (const userId of answer.present) {
    const row = changed.get(userId) ?? prior.get(userId);
    if (row) members.push(row);
    else complete = false;
  }
  return { members, complete };
}

export interface PresenceTracker<M extends { userId: string }> {
  /** The `known` map to send on the next tick. */
  known: () => Record<string, string>;
  /** Fold an answer in; returns the full roster to draw. */
  apply: (answer: PresenceAnswer<M>) => M[];
  /** Forget the roster, so the next tick asks for every member (a different board). */
  reset: () => void;
}

export function createPresenceTracker<M extends { userId: string }>(): PresenceTracker<M> {
  let roster: M[] = [];
  let fingerprints: Record<string, string> = {};
  return {
    known: () => fingerprints,
    apply(answer) {
      const { members, complete } = mergePresence(roster, answer);
      roster = members;
      fingerprints = complete && answer.fingerprints ? answer.fingerprints : {};
      return roster;
    },
    reset() {
      roster = [];
      fingerprints = {};
    },
  };
}
