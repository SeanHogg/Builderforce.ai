import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  runPrMergeForProject, PR_MERGE_PROJECT_BUDGET_MS, PR_MERGE_SWEEP_BUDGET_MS,
  PR_MERGE_WINDOW, MAX_CONCURRENT_PROJECT_QUEUES,
} from './prMergeSweep';
import { MERGE_QUEUE_DEPTH } from '../manager/prMergeQueue';
import { createPassBudget } from '../manager/passBudget';
import { ROTATABLE_STAGES } from '../manager/passRotation';
import { CRON_SWEEPS } from '../../cronSweeps';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';
import type { EffectiveManagerPolicy } from '../manager/managerPolicy';
import type { DispatchReserver } from '../runtime/tickDispatchBudget';

/**
 * THE MERGE LOOP IS NOT A STAGE OF A JUDGEMENT PASS.
 *
 * Measured on project 11, 2026-07-30 (api 2026.7.184), the first pass that timed its own
 * stages:
 *
 *   stageMs {load:468, board_staffing:427, census:1154, pr:28839, …}  elapsed 30888
 *
 * The PR stage was 93% of a 20s pass and everything else together was under two seconds,
 * so every stage behind it — including the triage stage that owns EVERY remedy — was
 * starved to pay for it. The merge queue later bounded the loop to ~4s, which stopped the
 * bleeding and left the shape wrong: the guarantee that triage still ran was a tuned depth
 * rather than a structural fact.
 *
 * These pin the structural version. The loop is its own registry sweep with its own
 * budget, and the manager pass cannot reach it at all.
 */

const source = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url).href), 'utf8');

const sweepSrc = source('./prMergeSweep.ts');
const managerSrc = source('../manager/ManagerService.ts');

describe('the PR merge loop moved OUT of the manager pass', () => {
  it('the manager pass no longer merges anything', () => {
    // The three doors into a merge. None of them may be reachable from the pass.
    expect(managerSrc).not.toMatch(/mergeRecordedPullRequest\(/);
    expect(managerSrc).not.toMatch(/updateRecordedPullRequestBranch\(/);
    expect(managerSrc).not.toMatch(/planMergeQueue\(/);
    // …nor may it journal the merge outcomes the sweep owns.
    expect(managerSrc).not.toMatch(/actionType: 'merge_pr'/);
    expect(managerSrc).not.toMatch(/actionType: MERGE_FAILED_ACTION/);
  });

  it('is a MOVE, not a fork — the loop exists in exactly one place', () => {
    expect(sweepSrc).toMatch(/mergeRecordedPullRequest\(/);
    expect(sweepSrc).toMatch(/updateRecordedPullRequestBranch\(/);
    expect(sweepSrc).toMatch(/planMergeQueue\(/);
    expect(sweepSrc).toMatch(/actionType: 'merge_pr'/);
  });

  it('drops the stage from the rotation, so nothing can yield a turn to a stage that is gone', () => {
    expect(ROTATABLE_STAGES.has('pr_merge')).toBe(false);
    // The conduct half stayed in the pass and stayed rotatable.
    expect(ROTATABLE_STAGES.has('pr_conduct')).toBe(true);
  });

  it('reports what landed by READING the journal, not by doing the work', () => {
    expect(managerSrc).toMatch(/summary\.prsMerged = await countPrMergesSince\(/);
  });
});

describe('the sweep is registered like every other scheduled sweep', () => {
  const def = CRON_SWEEPS.find((s) => s.key === 'pr-merge');

  it('is on the frequent tick, beside board-sync', () => {
    expect(def).toBeDefined();
    expect(def?.cadence).toBe('frequent');
    expect(CRON_SWEEPS.find((s) => s.key === 'board-sync')?.cadence).toBe('frequent');
  });

  it('declares that it can start billable runs (conflict recovery dispatches an agent)', () => {
    expect(def?.dispatches).toBe(true);
  });
});

describe('the sweep runs the loop within its OWN budget', () => {
  it('bounds one project well inside the sweep, so no project can consume the tick', () => {
    expect(PR_MERGE_PROJECT_BUDGET_MS).toBeGreaterThan(0);
    expect(PR_MERGE_PROJECT_BUDGET_MS).toBeLessThan(PR_MERGE_SWEEP_BUDGET_MS);
    // Room for more than one project per tick even at the full project budget —
    // otherwise the pool below would be decorative.
    expect(PR_MERGE_SWEEP_BUDGET_MS / PR_MERGE_PROJECT_BUDGET_MS)
      .toBeGreaterThanOrEqual(MAX_CONCURRENT_PROJECT_QUEUES / 2);
  });

  it('the project budget is spent, not merely declared', () => {
    const fresh = createPassBudget(Date.now(), PR_MERGE_PROJECT_BUDGET_MS, 0);
    expect(fresh.over()).toBe(false);
    const spent = createPassBudget(Date.now() - PR_MERGE_PROJECT_BUDGET_MS - 1, PR_MERGE_PROJECT_BUDGET_MS, 0);
    expect(spent.over()).toBe(true);
  });

  /**
   * A source assertion, deliberately. The loop reaches its eviction point only through
   * provider round-trips (update-branch, CI poll, merge), so a behavioural test of the
   * guard would be a test of the mocks. What can silently regress is the SHAPE: checking
   * the budget in the wrong place is how a pass ran 7.6s past its whole budget.
   */
  it('checks the budget BETWEEN pull requests, never mid-merge', () => {
    const loop = sweepSrc.indexOf('for (const { pr, disposition, mayRecover } of queue) {');
    const guard = sweepSrc.indexOf("if (budget.over()) { budget.shed('pr_merge'); break; }", loop);
    const tryBlock = sweepSrc.indexOf('try {', loop);
    expect(loop).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(loop);
    expect(guard).toBeLessThan(tryBlock);
  });

  it('asks whether a DISPATCH still fits before starting one', () => {
    // `over()` cannot stop a unit that has not started; the conflict recovery is measured
    // at 16.4s, which is larger than any reserve can defend.
    expect(sweepSrc).toMatch(/budget\.canAfford\(MIN_DISPATCH_WINDOW_MS\)/);
  });
});

describe('the queue semantics carried over unchanged', () => {
  it('keeps MERGE_QUEUE_DEPTH at one — only the head can merge', () => {
    expect(MERGE_QUEUE_DEPTH).toBe(1);
  });

  it('keeps the 20-row examination window (the ceilings are computed over it)', () => {
    expect(PR_MERGE_WINDOW).toBe(20);
  });

  it('still refuses to merge without the sign-off gate AND explicit merge authority', () => {
    expect(sweepSrc).toMatch(/resolveRequiredSignoffGate\(/);
    expect(sweepSrc).toMatch(/if \(!policy\.allowAutoMerge\) \{/);
  });
});

/**
 * A project on the 'queue' policy has said "a human merges here". The sweep must cost
 * that project NOTHING — not a query, not a provider call — which is why the check is the
 * first line of the loop and is proved here against a database that throws on touch.
 */
describe("a 'queue'-policy project costs the sweep nothing", () => {
  it('returns before any database access', async () => {
    const db = new Proxy({}, {
      get() { throw new Error('the queue policy must not reach the database'); },
    }) as unknown as Db;
    const result = await runPrMergeForProject(
      {} as Env,
      db,
      {} as RuntimeService,
      {
        tenantId: 1,
        projectId: 1,
        policy: { prMergePolicy: 'queue', allowAutoMerge: true } as unknown as EffectiveManagerPolicy,
        runs: { spend: async () => { throw new Error('no dispatch'); } } as unknown as DispatchReserver,
      },
    );
    expect(result).toEqual({ merged: 0, dispatched: 0, queue: null, truncated: false });
  });
});
