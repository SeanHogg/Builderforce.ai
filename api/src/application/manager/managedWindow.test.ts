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
  it('leads with grooming need, so ungroomed work is always INSIDE the window', () => {
    const clause = orderBy();
    const unscored = clause.indexOf('business_value');
    const unowned = clause.indexOf('assigned_agent_ref');
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
