/**
 * ticketPendingChanges — "does this ticket have code that has NOT landed on the
 * base branch?", as ONE property of the ticket.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * Asked "which tickets have pending code changes?", an agent had no ticket property
 * to read. Every fact was already in the platform — `tasks.gitBranch`, the
 * `pull_requests` row, and `listBranchCommits(base, branch)` — but nothing composed
 * them, so the only way to answer was to shell out: `git branch -a`, then
 * `git rev-list main..<branch> --count` once per branch. Measured on a real VSIX
 * session that did exactly that: 100+ branches enumerated, 500 KB of tool output,
 * five results truncated before the model saw them, and the run died of context
 * exhaustion before it reached a verdict. A question this cheap must not cost a
 * context window.
 *
 * ── WHY A PROJECTION AND NOT A COLUMN ────────────────────────────────────────────
 * The obvious shape is a `has_pending_changes` boolean on `tasks`. It is the wrong
 * one: the BRANCH is the source of truth for what is unmerged (the same stance
 * `taskFileChangeFeed` takes for content), so a stored copy is a second home for a
 * fact that changes without us — every push, merge, force-push and branch delete
 * would silently rot it, and a ticket would confidently report pending work that
 * landed a month ago. This is derived on read and CACHED instead, so there is one
 * fact in one place (3NF) and the cache, not the truth, is what goes stale.
 *
 * ── THE STATE THAT MATTERS ───────────────────────────────────────────────────────
 * `abandoned` is the reason this module earns its keep. A ticket whose PR was CLOSED
 * without merging, while its branch still carries commits, reads as finished
 * everywhere — status `done`, progress 100%, `prState: 'closed'` — and its code is
 * nowhere. Measured on this repo: tickets #61 (1 commit), #65 (17 commits) and #58
 * (21 commits) are all in exactly that state. No existing field distinguishes them
 * from a ticket that genuinely landed, because `closed` and `merged` are both
 * terminal and only the commit count tells them apart.
 *
 * PURE. Takes gathered facts, returns a verdict — every branch is unit-testable
 * without a provider, and the caller does the gathering (see `ticketPendingChangesPort`).
 *
 * BIAS: never claim "clean". Unreadable evidence resolves to `unknown`, never to
 * `none` — a ticket whose branch could not be read must not be reported as having
 * landed its work, because that is the answer that gets a ticket closed on a lie.
 */
import type { ListBranchCommitsResult } from '../repos/branchLifecycle';
import type { TaskProgressPrState } from './taskProgressBreakdown';

/**
 * Where a ticket's code actually is. Ordered from "nothing to do" to "someone must
 * look at this".
 */
export type PendingChangesState =
  /** No branch, or a branch with nothing ahead of base. Nothing is outstanding. */
  | 'none'
  /** The PR merged — the work is ON the base branch. Nothing is outstanding. */
  | 'landed'
  /** Commits ahead of base with an OPEN/draft PR: pending review, not yet landed. */
  | 'in_review'
  /** Commits ahead of base and no PR was ever opened: pending, and nobody is looking. */
  | 'unmerged'
  /** Commits ahead of base and the PR was CLOSED without merging. The ticket may
   *  read as done while its code is on a branch nobody will merge. */
  | 'abandoned'
  /** The branch could not be read (provider unsupported, network, truncated
   *  listing). NOT a claim of cleanliness — see the bias note above. */
  | 'unknown';

/** The states that mean "this ticket has code that is not on the base branch". */
const PENDING_STATES: ReadonlySet<PendingChangesState> = new Set<PendingChangesState>([
  'in_review',
  'unmerged',
  'abandoned',
]);

/** The ticket property. Flat and small — it rides every ticket read. */
export interface TicketPendingChanges {
  /** THE flag. True when code exists that has not landed on the base branch. */
  hasPendingChanges: boolean;
  /** Which of the six situations produced the flag. */
  state: PendingChangesState;
  /** The branch the work is on, normalized; null when the ticket has none. */
  branch: string | null;
  /** Commits ahead of base. Null when the listing could not be read (`unknown`). */
  aheadCount: number | null;
  /** True when the commit listing hit its bound — `aheadCount` is a FLOOR, not a total. */
  truncated: boolean;
  /** One human-readable sentence naming the evidence. Surfaced verbatim to the
   *  model and the UI, so a verdict never has to be explained from the logs. */
  reason: string;
}

/** Everything the verdict is made from. Gathered by the caller; never fetched here. */
export interface TicketPendingChangesFacts {
  /** `tasks.gitBranch`, or the conventional `builderforce/task-<id>` fallback. */
  branch: string | null | undefined;
  /** The repository's default/base branch the work would land on. */
  defaultBranch: string | null | undefined;
  /** The recorded PR's state for this ticket (`pull_requests.status`), normalized. */
  prState: TaskProgressPrState;
  /**
   * Commits the branch carries ahead of base, as the provider answered. Passed
   * through UNWRAPPED so this function — not the caller — decides what an error or
   * a truncation means. Null when no listing was attempted (e.g. the ticket has no
   * branch, or the repo has no reachable provider).
   */
  commits: ListBranchCommitsResult | null;
}

function normalizeRef(ref: string | null | undefined): string | null {
  const trimmed = (ref ?? '').trim().replace(/^refs\/heads\//, '');
  return trimmed.length > 0 ? trimmed : null;
}

const verdict = (
  state: PendingChangesState,
  branch: string | null,
  aheadCount: number | null,
  truncated: boolean,
  reason: string,
): TicketPendingChanges => ({
  hasPendingChanges: PENDING_STATES.has(state),
  state,
  branch,
  aheadCount,
  truncated,
  reason,
});

/**
 * Decide whether a ticket has code that has not landed.
 *
 * Rules, in evaluation order — the order matters, because the cheapest and most
 * absolute answers must not fall through to a later rule that happens to match:
 *
 *  1. No branch → `none`. There is no work to be anywhere.
 *  2. A MERGED PR → `landed`, without consulting commits. A merged PR means the
 *     work is on base; a branch left behind afterwards is residue, not pending work,
 *     and counting its commits would report merged code as outstanding forever.
 *  3. Unreadable/unsupported commit evidence → `unknown`. Never `none`.
 *  4. Zero commits ahead → `none`.
 *  5. Commits ahead, split by what the PR says: open/draft → `in_review`;
 *     closed-unmerged → `abandoned`; no PR at all → `unmerged`.
 *
 * A TRUNCATED listing is still a positive answer: hitting the bound proves there is
 * at least that much work ahead of base, which is all rule 5 needs. `truncated`
 * rides the result so a caller never presents a floor as a total.
 */
export function decideTicketPendingChanges(facts: TicketPendingChangesFacts): TicketPendingChanges {
  const branch = normalizeRef(facts.branch);
  const base = normalizeRef(facts.defaultBranch);

  // 1 — nothing was ever branched for this ticket.
  if (!branch) return verdict('none', null, 0, false, 'no branch is recorded for this ticket');

  // A branch that IS the base carries nothing of its own by definition.
  if (base && branch.toLowerCase() === base.toLowerCase()) {
    return verdict('none', branch, 0, false, `'${branch}' is the base branch — it holds no unmerged work of its own`);
  }

  // 2 — merged wins over any commit count. Checked before the evidence rules so a
  //     landed ticket needs no provider call to answer correctly.
  if (facts.prState === 'merged') {
    return verdict('landed', branch, 0, false, `the pull request for '${branch}' was merged — its code is on ${base ? `'${base}'` : 'the base branch'}`);
  }

  // 3 — no evidence is not evidence of none.
  if (!facts.commits) {
    return verdict('unknown', branch, null, false, `'${branch}' was not compared against its base, so whether it carries unmerged work is unknown`);
  }
  if (!facts.commits.ok) {
    return verdict('unknown', branch, null, false, `could not read the commits on '${branch}': ${facts.commits.reason}`);
  }

  const aheadCount = facts.commits.commits.length;
  const truncated = facts.commits.truncated;

  // 4 — the branch exists but has nothing the base does not already have.
  if (aheadCount === 0) {
    return verdict('none', branch, 0, false, `'${branch}' has no commits ahead of ${base ? `'${base}'` : 'its base'}`);
  }

  const commitsPhrase = `${aheadCount}${truncated ? '+' : ''} commit${aheadCount === 1 && !truncated ? '' : 's'}`;
  const aheadOf = `ahead of ${base ? `'${base}'` : 'its base'}`;

  // 5 — there IS unmerged work; the PR decides which kind of pending it is.
  if (facts.prState === 'open' || facts.prState === 'draft') {
    return verdict('in_review', branch, aheadCount, truncated,
      `'${branch}' carries ${commitsPhrase} ${aheadOf} in an ${facts.prState} pull request — reviewed but not landed`);
  }
  if (facts.prState === 'closed') {
    return verdict('abandoned', branch, aheadCount, truncated,
      `'${branch}' carries ${commitsPhrase} ${aheadOf} but its pull request was CLOSED without merging — this code will not land unless the ticket is reopened or the branch is re-proposed`);
  }
  return verdict('unmerged', branch, aheadCount, truncated,
    `'${branch}' carries ${commitsPhrase} ${aheadOf} and no pull request was ever opened`);
}

/**
 * True when a state means a HUMAN should look — the work exists and no live review
 * is carrying it forward. `in_review` is deliberately excluded: it is pending, but a
 * PR is already the mechanism moving it, so surfacing it as "needs attention" would
 * make every healthy in-flight ticket an alert. Shared so the tool, the board badge
 * and the manager's triage all draw the same line.
 */
export function needsDeliveryAttention(state: PendingChangesState): boolean {
  return state === 'unmerged' || state === 'abandoned';
}
