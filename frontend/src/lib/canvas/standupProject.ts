/**
 * WHICH PROJECT IS THIS STANDUP FOR — decided once, for every surface that asks.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * A standup is a meeting, and a meeting is about something. The product had two
 * different answers to what: the `standup` canvas OBJECT took the first project
 * node on the board, and the room surface had none at all, which is why the room
 * shipped recording nothing. Two answers to one question is how a standup held
 * in the room and a standup started from a card end up filed against different
 * projects — or against none.
 *
 * So the precedence is declared here, in the order a person would say it out loud:
 *
 *   1. what they picked IN the meeting — including picking "no project", which is
 *      a real answer and not an absence of one;
 *   2. the project they are working in (the global scope switcher);
 *   3. the project this board is about, when it names one;
 *   4. nothing — an unassociated standup, which is still a standup.
 *
 * ── WHY "NONE" IS NOT A FAILURE ──────────────────────────────────────────────
 * A standup with no project attached still happens: people still turn up, still
 * take turns, still talk. What it cannot do is file attendance, because ceremony
 * records are keyed by project. Treating that as an error state would push a
 * caller into inventing a project to satisfy the record, which is worse than the
 * record being absent. `source` is carried so a surface can SAY which of the four
 * answers it got rather than showing a project id and hoping.
 */

export type StandupProjectSource = 'chosen' | 'scope' | 'board' | 'none';

export interface StandupProject {
  /** `null` means an unassociated standup — a real, supported state. */
  projectId: number | null;
  source: StandupProjectSource;
}

export interface StandupProjectInput {
  /**
   * What the meeting itself chose. `undefined` means "nobody has chosen in here";
   * `null` means somebody deliberately chose to run it against no project. The
   * two are different answers and collapsing them would make an explicit
   * "all projects" silently fall back to the scope it was overriding.
   */
  chosen?: number | null | undefined;
  /** The global project switcher's current drill-down. */
  scopeProjectId?: number | null;
  /** The project this board itself names, when it names one. */
  boardProjectId?: number | null;
}

export function resolveStandupProject(input: StandupProjectInput): StandupProject {
  if (input.chosen !== undefined) {
    return { projectId: input.chosen, source: input.chosen === null ? 'none' : 'chosen' };
  }
  if (input.scopeProjectId != null) return { projectId: input.scopeProjectId, source: 'scope' };
  if (input.boardProjectId != null) return { projectId: input.boardProjectId, source: 'board' };
  return { projectId: null, source: 'none' };
}

/**
 * Step to the next project in a standup that is walking all of them.
 *
 * The sequence is `[none, …projects]` and it CYCLES, so "go through all the
 * projects" is a loop with a natural end rather than a list you fall off. Coming
 * back around to `null` is meaningful: the team has been through everything and
 * is talking about the company again.
 *
 * Returns `null` for an empty list, in both directions — with no projects to walk
 * there is nowhere to step to, and the caller's state is already correct.
 */
export function stepStandupProject(
  projectIds: readonly number[],
  current: number | null,
  step: 1 | -1,
): number | null {
  if (projectIds.length === 0) return null;
  const ring: Array<number | null> = [null, ...projectIds];
  // An id that has since been deleted behaves like "not in the ring", and the
  // walk restarts from the unassociated slot rather than throwing.
  const at = ring.indexOf(current);
  const from = at === -1 ? 0 : at;
  const next = (from + step + ring.length) % ring.length;
  return ring[next] ?? null;
}
