import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { PR_ACTION_TYPES } from './ManagerService';
import { MAX_REMEDY_ATTEMPTS, isActionExhausted } from './stallTriage';

/**
 * THE MANAGER'S PR LOOP MUST BE ABLE TO STOP, AND MUST REACH EVERY PR.
 *
 * Two measured failures on project 11 (2026-07-28, api 2026.7.175), both structural
 * rather than logical — which is why they survived a green suite:
 *
 *  1. THE MERGE NEVER RETIRED. A provider refusal was journalled as a generic 'flag'.
 *     `manager_actions` carries ~1,770 flags a day on that project, so nothing could
 *     count one PR's refusals, so no ceiling could fire: "Could not merge PR #29 …
 *     Pull Request is not mergeable" appeared four times in the last thirty decisions,
 *     once per pass, and would have done so indefinitely. The sync ceiling one branch
 *     earlier in the same function had exactly this guard; the merge did not.
 *
 *  2. THE LOOP ONLY EVER SAW THE SAME TWENTY PRs. The open-PR query was an UNORDERED
 *     `limit(20)` over 386 open pull requests, and an unordered LIMIT returns whatever
 *     the heap scan yields — the same rows every pass. 366 PRs were never examined once.
 *
 * Both fixes hang off `PR_ACTION_TYPES`: the ceilings COUNT those types and the
 * least-recently-worked rotation ORDERS by the newest of them. So the invariants worth
 * pinning are the ones that would silently disable either mechanism — a type that cannot
 * be persisted, a duplicate, or a write that goes back to 'flag'.
 *
 * ── AND THE KEY THEY ARE COUNTED ON (0383) ───────────────────────────────────────
 * 0381 keyed all of it on `manager_actions.task_id`, and re-measured on 2026-07-29 the
 * loop was STILL unbounded: `pull_requests.task_id` is nullable, `NULL = NULL` is never
 * true in a join, and every guard was additionally written `pr.taskId != null && …`. So
 * an orphan PR was exempt from both ceilings AND — its `last_acted_at` being NULL —
 * pinned to the front of the NULLS-FIRST rotation on every pass. Measured: "Could not
 * merge PR #29 … not mergeable" journalled with `{"attempt":1,"maxAttempts":3}` six times
 * in thirty minutes, attempt 1 every time, while 381 open PRs waited behind it.
 *
 * The counters are now keyed on the PULL REQUEST, which is the contract the loop is
 * actually about, and the third unbounded remedy on the same function — a conflict whose
 * recovery can never start — got the same ceiling.
 */
describe('manager PR action ceiling + rotation', () => {
  /**
   * ── WHERE THE LOOP LIVES NOW ─────────────────────────────────────────────────────
   * `application/repos/prMergeSweep.ts`. It was stage 4b of the manager pass and measured
   * 93% of the pass's wall-clock, starving every stage behind it including triage; it is
   * now its own registry sweep with its own budget. Every invariant below is about the
   * LOOP, not about where it is mounted, so they follow it — and `PR_ACTION_TYPES` is
   * still imported from ManagerService here on purpose, because that re-export is what
   * keeps every existing caller resolving.
   */
  const source = readFileSync(
    fileURLToPath(new URL('../repos/prMergeSweep.ts', import.meta.url).href),
    'utf8',
  );

  it('every PR action type fits `action_type varchar(24)`', () => {
    // A longer value does not fail a type check — it throws at INSERT, inside a
    // best-effort `recordManagerAction` that swallows the error. The ceiling would then
    // count zero forever and the livelock would come back silently.
    for (const type of PR_ACTION_TYPES) {
      expect(type.length, `'${type}' is ${type.length} chars`).toBeLessThanOrEqual(24);
    }
  });

  it('names each type once — a duplicate would double-count a ceiling', () => {
    expect(new Set(PR_ACTION_TYPES).size).toBe(PR_ACTION_TYPES.length);
  });

  it('carries the two types the ceilings depend on', () => {
    expect(PR_ACTION_TYPES).toContain('merge_failed');
    expect(PR_ACTION_TYPES).toContain('pr_conflict');
  });

  /**
   * The regression itself, and it has to be a source assertion: whether a journal write
   * uses a COUNTABLE type is invisible to the type checker (every action type is just a
   * string) and invisible to a unit test of the surrounding function (the write is
   * best-effort and its type is never read back in-process). The only thing that can
   * catch a revert is the text of the call.
   */
  it('journals a refused merge and a conflict as their OWN types, never as a flag', () => {
    expect(source).toMatch(/actionType: MERGE_FAILED_ACTION,\s*\n\s*summary: `Could not merge PR/);
    expect(source).toMatch(/actionType: PR_CONFLICT_ACTION,\s*\n\s*summary: recovery\.recoveryStarted/);
    // And the two former spellings are gone from the PR loop.
    expect(source).not.toContain("actionType: 'flag',\n          summary: `Could not merge PR");
  });

  /**
   * ── AND THE ORDER REVERSED AGAIN (0386) ──────────────────────────────────────────
   * 0383's least-recently-worked rotation fixed a real starvation and caused a worse one.
   * A turn every ~19 passes (381 open PRs, 20 a pass ≈ 95 minutes) against a base branch
   * that moves every few minutes means a PR's attempts never accumulate: measured on
   * project 11, 2026-07-30, the stuck register showed `attempts=2` on row after row after
   * 16 to 28 days, so no ceiling ever fired, so nothing merged AND nothing retired.
   *
   * A ceiling that cannot be reached is not a ceiling. The window is now oldest-first and
   * STABLE, which is what lets the head accumulate its three attempts and reach a
   * conclusion — see `prMergeQueue.ts`.
   */
  it('orders the open-PR window oldest-first and STABLE, and bounds it', () => {
    expect(source).toContain('asc(pullRequests.createdAt), asc(pullRequests.id)');
    expect(source).toContain("pullRequests.buildStatus} = 'success'");
    expect(source).toMatch(/\.limit\(PR_MERGE_WINDOW\)/);
    // The rotation must not come back: re-sorting the window by when the manager last
    // touched each PR is precisely what dilutes the attempts below the ceiling.
    expect(source).not.toMatch(/lastActedAt\} asc nulls first/);
  });

  /**
   * THE DEADLOCK A STABLE ORDER CREATES, and the reason the exit condition is two
   * clauses rather than one.
   *
   * Retiring a PR writes `merge_blocked` — it does NOT close the pull request, which
   * stays `open` until a person acts. A stable oldest-first window therefore fills with
   * its own retirements and never advances unless retired PRs are excluded.
   *
   * But `merge_blocked` is written for TWO different situations, and only one of them is
   * terminal. A spent ceiling is; withheld merge authority (0363) is a project policy
   * that a human can grant, after which that PR must merge on the very next pass. So the
   * exit is the conjunction, and either half alone is a bug: `blockedReports > 0` alone
   * would strand every authority-blocked PR permanently, and the ceiling test alone would
   * evict a PR in the same pass that is supposed to report it.
   */
  it('lets a retired PR leave the window WITHOUT stranding an authority-blocked one', () => {
    const where = source.slice(source.indexOf('const openPrs = await db'), source.indexOf('.orderBy(', source.indexOf('const openPrs = await db')));
    expect(where, 'the queue must exclude PRs it has already retired, or it deadlocks')
      .toMatch(/coalesce\(\$\{prActivity\.blockedReports\}, 0\) > 0/);
    // Conjoined with a spent ceiling — never on the report alone.
    expect(where).toMatch(/\band greatest\(/);
    expect(where).toMatch(/>= \$\{MAX_REMEDY_ATTEMPTS\}/);
    for (const counter of ['syncs', 'mergeFailures']) {
      expect(where, `${counter} must count toward the exit`).toContain(`prActivity.${counter}`);
    }
    const exitCounters = where.slice(where.indexOf('and greatest('), where.indexOf(') >= ${MAX_REMEDY_ATTEMPTS}'));
    expect(exitCounters, 'recoverable conflicts must not be permanently evicted from autonomy')
      .not.toContain('prActivity.conflicts');
  });

  it('applies the SAME exhaustion rule the stall remedies use — no second ceiling', () => {
    // The merge ceiling must not invent its own threshold; a PR that gives up after a
    // different number of tries than every other remedy is a rule nobody can state.
    expect(isActionExhausted(MAX_REMEDY_ATTEMPTS - 1)).toBe(false);
    expect(isActionExhausted(MAX_REMEDY_ATTEMPTS)).toBe(true);
  });

  /**
   * THE 0383 REGRESSION, and like the one above it can only be a source assertion: the
   * defect is a JOIN KEY, which no type check and no unit test of the surrounding
   * function can see. `pull_requests.task_id` is nullable, so keying any of this on the
   * ticket silently exempts every orphan PR from every ceiling.
   */
  it('counts all three ceilings on the PULL REQUEST, never on its (nullable) ticket', () => {
    // 0386 moved the three comparisons themselves into `planMergeQueue`, which cannot
    // express a ticket key at all: `QueuedPr` carries the counters, and they are read
    // straight off the PR row. What remains here — and is still only checkable in the
    // source — is that the row those counters come from is joined on the PR.
    expect(source).toMatch(/\.groupBy\(managerActions\.prId\)/);
    expect(source).toMatch(/leftJoin\(prActivity, eq\(prActivity\.prId, pullRequests\.id\)\)/);
    // The dedupe that decides whether a retired PR is reported at all shares the key.
    expect(source).toMatch(/alreadyReportedBlocked\.has\(pr\.id\)/);
    // And no intermediate per-ticket map may reappear between the row and the decision —
    // the three `Map<taskId, …>` lookups are what hid the orphan PR in the first place.
    expect(source).not.toMatch(/pr\.taskId != null && isActionExhausted/);
    expect(source).not.toMatch(/mergeFailures\.get\(/);
    expect(source).not.toMatch(/conflictAttempts\.get\(/);
    for (const counter of ['syncs', 'mergeFailures', 'conflicts']) {
      expect(source, `${counter} must reach the plan off the PR row`)
        .toMatch(new RegExp(`${counter}: prActivity\\.${counter}`));
    }
  });

  /**
   * A journalled PR action with no `pr_id` is invisible to both the ceilings and the
   * rotation — i.e. it recreates the livelock silently. Every write in the merge loop
   * must carry it.
   */
  it('stamps every PR-loop journal write with the pull request it was about', () => {
    const loop = source.slice(source.indexOf('const prActivity = db'));
    const writes = loop.match(/tenantId, projectId, taskId: pr\.taskId,[^\n]*/g) ?? [];
    expect(writes.length).toBeGreaterThanOrEqual(7);
    for (const write of writes) expect(write, write).toContain('prId: pr.id');
  });

  it('is backed by the index its grouped scan needs (0381, re-keyed 0383)', () => {
    // manager_actions is append-only and grows ~3.5k rows/day on one active project.
    // Without this index the per-pass group-by is a sequential scan that gets slower
    // every day — the pass would start dying on the very loop this fixes.
    const migration = readFileSync(
      fileURLToPath(new URL('../../../migrations/0383_manager_actions_pr_scope.sql', import.meta.url).href),
      'utf8',
    ).replace(/\s+/g, ' ');
    expect(migration).toContain(
      'CREATE INDEX IF NOT EXISTS idx_manager_actions_pr_scope ON manager_actions(tenant_id, project_id, action_type, pr_id)',
    );
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS pr_id uuid');
  });
});
