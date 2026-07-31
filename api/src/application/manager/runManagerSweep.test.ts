import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  MAX_PROJECTS_PER_TICK, MAX_CONCURRENT_PROJECT_PASSES, MANAGER_SWEEP_BUDGET_MS,
} from './runManagerSweep';
import { MANAGER_PASS_BUDGET_MS } from './ManagerService';

/**
 * THE MANAGER WAS A QUEUE WITH ONE SERVER.
 *
 * `runManagerSweep` awaited a full {@link runManagerForProject} inside a plain `for`
 * loop over up to {@link MAX_PROJECTS_PER_TICK} projects, and one pass costs 20–31s of
 * wall-clock (measured on project 11, 2026-07-30 — `elapsedMs` 20874 and 30888 on
 * consecutive passes). The first project therefore consumed the whole Worker
 * invocation and every project behind it got NOTHING, on every tick.
 *
 * And "behind it" was a fixed set: `loadManagedProjects` had no ORDER BY, so it
 * returned heap order — in practice the same rows in the same sequence every time. The
 * two defects compose into the worst version of themselves. One project was managed
 * forever and the rest were never managed once, with nothing anywhere reporting it,
 * because a sweep that is evicted mid-loop cannot report how far it got.
 *
 * The invariants below are the ones whose loss would silently restore that: the pool,
 * the rotation, the deadline, and the count of what was not reached.
 */
describe('manager sweep fans out across projects', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./runManagerSweep.ts', import.meta.url).href),
    'utf8',
  );

  /**
   * A source assertion because the defect IS the control flow. `await` inside a `for`
   * over the project list type-checks, tests green, and quietly serialises the fleet —
   * no unit test of the surrounding function can see the difference, since a fake pass
   * that returns instantly makes serial and concurrent behave identically.
   */
  it('runs projects through a bounded pool, never a serial await-in-loop', () => {
    expect(source, 'the fan-out must be a pool of workers over a shared cursor')
      .toMatch(/Promise\.all\(\s*Array\.from\(\{ length: Math\.min\(MAX_CONCURRENT_PROJECT_PASSES, managed\.length\) \}, worker\)/);
    expect(source).toMatch(/const next = managed\[cursor\+\+\]/);
    // The regression itself: the pass may never again be awaited directly from a loop
    // over the project list.
    expect(source).not.toMatch(/for \(const p of managed\) \{/);
  });

  it('stops starting projects at the deadline, and checks BEFORE claiming one', () => {
    // Order matters: claiming then checking would leave a project marked as reached
    // that never ran, and it would sort to the BACK of the next tick's rotation.
    const worker = source.slice(source.indexOf('const worker = async ()'), source.indexOf('await Promise.all('));
    expect(worker.indexOf('MANAGER_SWEEP_BUDGET_MS')).toBeLessThan(worker.indexOf('managed[cursor++]'));
  });

  /**
   * Longest-unmanaged first, maintained by the pass's own `last_run_at` stamp — no
   * cursor, no extra storage. NULLS FIRST is the half that matters: a project with no
   * manager config row has never been managed at all and is the one most in need of a
   * turn. `asc` alone sorts NULLs LAST in Postgres, which would bury exactly those.
   */
  it('orders projects longest-unmanaged first so the tail is reachable', () => {
    expect(source).toMatch(/lastActedAt|lastRunAt\} asc nulls first/);
    expect(source).toMatch(/\.orderBy\(sql`\$\{projectManagerConfigs\.lastRunAt\} asc nulls first`, asc\(projects\.id\)\)/);
    // Tenant-correlated join — `project_manager_configs` is tenant-owned.
    expect(source).toMatch(/eq\(projectManagerConfigs\.tenantId, projects\.tenantId\)/);
  });

  /**
   * The per-tenant token verdict is cached as a PROMISE. Caching the resolved boolean
   * was correct while passes ran one at a time and becomes an N+1 the moment they do
   * not: every project of one tenant would miss simultaneously and start its own scan.
   */
  it('collapses concurrent token lookups for one tenant into a single scan', () => {
    expect(source).toMatch(/const tokenOk = new Map<number, Promise<boolean>>\(\)/);
    expect(source).toMatch(/tokenOk\.set\(tenantId, pending\)/);
  });

  it('reports what it did not reach', () => {
    expect(source).toMatch(/result\.notReached = Math\.max\(0, managed\.length - cursor\)/);
  });

  /**
   * THE OPT-IN, and the SQL mirror of `isProjectManaged`.
   *
   * The rule used to be `hasBoard AND (hasWork OR hasConfig)` — i.e. any project with a
   * board and one open ticket got an AI manager, configured or not, because a project
   * with no config row folds to the hardcoded `enabled: true` default. That is opt-OUT
   * for something that reopens tickets, dispatches billable runs and merges PRs.
   *
   * An INNER join is the point: as a LEFT join the requirement is a WHERE clause someone
   * can drop, and dropping it silently restores management of every project on the
   * instance.
   */
  it('selects ONLY projects that opted in — an enabled config row of their own', () => {
    expect(source, 'the config row must be required structurally, not by a clause')
      .toMatch(/\.innerJoin\(projectManagerConfigs, and\(/);
    expect(source).toMatch(/eq\(projectManagerConfigs\.enabled, true\)/);
    // The opt-out shape must not return in any form.
    expect(source).not.toMatch(/\.leftJoin\(projectManagerConfigs/);
    expect(source).not.toMatch(/hasWork\} OR \$\{hasConfig\}/);
  });

  /**
   * THE ROTATION AND THE OPT-IN ARE THE SAME FIX.
   *
   * `last_run_at` is stamped by an UPDATE, not an upsert, so a project with no config
   * row can never be stamped. Ordering NULLS FIRST over a LEFT join therefore selected
   * such a project, managed it, failed to stamp it, and selected it again — pinning the
   * head of the rotation forever and starving every project behind it. Requiring the row
   * makes every selectable project one the pass can also stamp, which is what makes the
   * ordering terminate. Guarded because the two changes look unrelated and a later edit
   * could reintroduce the LEFT join for a plausible-sounding reason.
   */
  it('can stamp every project it selects, so the rotation terminates', () => {
    const service = readFileSync(
      fileURLToPath(new URL('./ManagerService.ts', import.meta.url).href),
      'utf8',
    );
    expect(service, 'the stamp is an UPDATE — an unstampable project would pin the rotation')
      .toMatch(/db\.update\(projectManagerConfigs\)\s*\n?\s*\.set\(\{ lastRunAt/);
    expect(source).toMatch(/\.innerJoin\(projectManagerConfigs/);
  });

  /**
   * The pool only helps if the deadline is worth several passes; at one pass per worker
   * it is just the old serial sweep with extra steps. And it must stay well inside the
   * 5-minute cadence, or a slow tick overlaps the next one.
   */
  it('budgets enough wall-clock for the pool to be worth having', () => {
    expect(MANAGER_SWEEP_BUDGET_MS).toBeGreaterThan(MANAGER_PASS_BUDGET_MS * 2);
    expect(MANAGER_SWEEP_BUDGET_MS).toBeLessThan(5 * 60_000);
    expect(MAX_CONCURRENT_PROJECT_PASSES).toBeGreaterThan(1);
    // Bounded: neon-http opens a connection per query, so an unbounded fan-out over the
    // whole tick limit would trade a starved sweep for a throttled database.
    expect(MAX_CONCURRENT_PROJECT_PASSES).toBeLessThan(MAX_PROJECTS_PER_TICK);
  });
});
