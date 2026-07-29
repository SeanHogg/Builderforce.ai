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
  const source = readFileSync(
    fileURLToPath(new URL('./ManagerService.ts', import.meta.url).href),
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

  it('orders the open-PR window least-recently-worked first, and bounds it', () => {
    // NULLS FIRST is the half that matters: a PR the manager has never touched is the
    // one most in need of a turn, and without it the never-examined tail stays never
    // examined. `asc` alone would sort NULLs LAST in Postgres.
    expect(source).toMatch(/lastActedAt\} asc nulls first/);
    expect(source).toMatch(/\.limit\(MAX_PR_ACTIONS_PER_RUN\)/);
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
    for (const counter of ['syncAttempts', 'mergeFailures', 'conflictAttempts']) {
      expect(source, `${counter} must be keyed by pr.id`)
        .toMatch(new RegExp(`isActionExhausted\\(${counter}\\.get\\(pr\\.id\\) \\?\\? 0\\)`));
    }
    // The dedupe that decides whether a retired PR is reported at all shares the key.
    expect(source).toMatch(/alreadyReportedBlocked\.has\(pr\.id\)/);
    // And the join/grouping the counts come from.
    expect(source).toMatch(/\.groupBy\(managerActions\.prId\)/);
    expect(source).toMatch(/leftJoin\(prActivity, eq\(prActivity\.prId, pullRequests\.id\)\)/);
    // A ticket-keyed guard is exactly what let the orphan through — none may return.
    expect(source).not.toMatch(/pr\.taskId != null && isActionExhausted/);
    expect(source).not.toMatch(/mergeFailures\.get\(pr\.taskId/);
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
