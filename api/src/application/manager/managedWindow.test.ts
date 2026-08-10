import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { buildDatabase } from '../../infrastructure/database/connection';
import { managedTasksQuery } from './ManagerService';

/**
 * THE WINDOW THAT NEVER MOVED.
 *
 * One pass may groom at most MAX_RANKED (300) tickets, and the window was ordered
 * `created_at asc`. A fixed cap over a fixed order is a set, not a window: on project 11
 * (676 open tickets) the SAME 300 oldest tickets loaded every pass, forever. They had long
 * since been scored and assigned, so every pass reported `scored 0 · assigned 0` and
 * COMPLETED SUCCESSFULLY — while 375 unscored and 339 unowned tickets sat outside the
 * window with no path to ever entering it. Two capabilities (`autoBusinessValue`,
 * `autoAssign`) reported healthy and changed nothing for 14 days; the diagnostics could
 * only say "the pass is finishing and reporting success without changing the backlog".
 *
 * The defect lived entirely in the ORDER BY — same tables, same columns, same row shape —
 * which is why this reads the rendered SQL. `.toSQL()` never dials the connection.
 */
const db = buildDatabase({ NEON_DATABASE_URL: 'postgresql://user:pw@localhost/db' } as Parameters<typeof buildDatabase>[0]);

const orderBy = (): string => {
  const { sql } = managedTasksQuery(db, 11).toSQL();
  const clause = sql.slice(sql.lastIndexOf(' order by '));
  expect(clause, 'the window must be explicitly ordered').toContain('order by');
  return clause;
};

describe('the manager\'s managed-ticket window', () => {
  it('carries open stall rows before grooming need, then puts ungroomed work first', () => {
    const clause = orderBy();
    const stalls = clause.indexOf('manager_stall_watch');
    const unscored = clause.indexOf('business_value');
    const unowned = clause.indexOf('assigned_agent_ref');
    expect(stalls, 'open remedies must stay inside the triage window').toBeGreaterThan(-1);
    expect(unscored).toBeGreaterThan(stalls);
    expect(unscored, 'unscored tickets must sort first').toBeGreaterThan(-1);
    expect(unowned, 'unowned tickets must sort next').toBeGreaterThan(unscored);
  });

  it('treats a ticket as unowned only when NO assignee of any kind is set', () => {
    // A ticket owned by a human, a cloud agent ref or a self-hosted host is owned. Missing
    // any one of the three would drag already-owned tickets to the front of the window and
    // starve the tail all over again, just with a different pin.
    const clause = orderBy();
    for (const col of ['assigned_user_id', 'assigned_agent_ref', 'assigned_agent_host_id']) {
      expect(clause, col).toContain(col);
    }
  });

  it('does NOT lead with created_at — the ordering that froze the window', () => {
    const clause = orderBy();
    const created = clause.indexOf('created_at');
    expect(created).toBeGreaterThan(-1); // still present, as the final stable tiebreak
    expect(created, 'created_at must never be the leading sort key again')
      .toBeGreaterThan(clause.indexOf('business_value'));
  });

  it('rotates on least-recently-touched once grooming has drained', () => {
    // Scoring and assignment both stamp `updated_at`, so a groomed ticket drops to the
    // back and the next-oldest rotates in. Without this the window would re-freeze the
    // moment `unscored` and `unowned` both reached zero.
    const clause = orderBy();
    expect(clause).toContain('updated_at');
    expect(clause.indexOf('updated_at')).toBeGreaterThan(clause.indexOf('assigned_agent_host_id'));
  });

  it('is still capped — the fix is a moving window, not an unbounded scan', () => {
    expect(managedTasksQuery(db, 11).toSQL().sql).toContain('limit');
  });
});

/**
 * THE STAGE THAT SPENT THE PASS AND CHANGED NOTHING.
 *
 * RANK is neither rotatable nor budget-shed, so it pays its full cost before every stage
 * that actually moves a ticket. It re-stamped `manager_rank` on all 300 windowed tickets
 * every five minutes — and on a settled backlog the order does not change: project 11,
 * 2026-07-30, journalled "Ranked 300 tickets…" seven times in thirty decisions with a
 * byte-identical top five (score 123.15 each time), which the diagnostics flagged as a
 * `decision_loop`. ~86,000 no-op UPDATE round-trips a day on one project.
 *
 * What it cost is in the same capture: three of the last six passes shed EVERY remaining
 * stage — `["value","assign","systemic","pr_conduct","pr_merge","audit","triage"]` at
 * `elapsedMs` 20405 and 24610 against a 20s budget. The budget was gone before `value`,
 * and RANK is the only expensive thing ahead of it.
 *
 * Ranking is pure derived data, so re-deriving is free and only the WRITES matter. These
 * pin the diff behaviour, which is invisible to a type check and to any test of
 * `rankBacklog` (which is unchanged and still ranks everything).
 */
describe('the RANK stage writes the diff, not the order', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./ManagerService.ts', import.meta.url).href),
    'utf8',
  );
  const stage = source.slice(source.indexOf('// 2. RANK'), source.indexOf('// 2.5 SCHEDULE'));

  it('compares against the rank ALREADY PERSISTED', () => {
    // Which means the managed window must carry it — a diff against a column the query
    // does not select silently degrades to "everything moved" and restores the old cost.
    expect(managedTasksQuery(db, 11).toSQL().sql).toContain('manager_rank');
    expect(stage).toMatch(/previousRank[\s\S]*managerRank/);
    expect(stage).toMatch(/previousRank\.get\(r\.taskId\) !== r\.rank/);
  });

  it('writes only the tickets whose rank moved', () => {
    expect(stage).toMatch(/if \(moved\.length\)[\s\S]*flushBatched/);
    // The old unconditional write must not come back.
    expect(stage).not.toMatch(/flushBatched\(db, ranked\.map/);
  });

  it('journals nothing when the order did not change — a decision_loop by construction', () => {
    const journal = stage.slice(stage.indexOf('summary.ranked'));
    expect(journal).toMatch(/if \(moved\.length\)[\s\S]*actionType: 'prioritize'/);
  });
});
