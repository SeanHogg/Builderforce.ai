import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { autonomousCandidatesQuery, groupByTenant, MAX_CANDIDATES_PER_TICK } from './autonomousExecutionSweep';
import { RuntimeService } from './RuntimeService';
import { buildDatabase } from '../../infrastructure/database/connection';
import { buildUpgradeCopy, upgradeEmailDedupeKey } from './pendingAgentsUpgradeEmail';

describe('groupByTenant', () => {
  it('buckets candidates by tenant, preserving per-tenant order', () => {
    const grouped = groupByTenant([
      { taskId: 1, projectId: 10, tenantId: 100, status: 'todo' },
      { taskId: 2, projectId: 11, tenantId: 200, status: 'todo' },
      { taskId: 3, projectId: 10, tenantId: 100, status: 'in_progress' },
    ]);
    expect(grouped.get(100)?.map((c) => c.taskId)).toEqual([1, 3]);
    expect(grouped.get(200)?.map((c) => c.taskId)).toEqual([2]);
    expect(grouped.size).toBe(2);
  });

  it('returns an empty map for no candidates', () => {
    expect(groupByTenant([]).size).toBe(0);
  });
});

describe('upgradeEmailDedupeKey', () => {
  it('is stable within a UTC day and rolls over at midnight', () => {
    const morning = new Date('2026-07-01T06:00:00Z');
    const night = new Date('2026-07-01T23:59:00Z');
    const nextDay = new Date('2026-07-02T00:01:00Z');
    expect(upgradeEmailDedupeKey(42, morning)).toBe('auto-exec:upgrade-emailed:42:2026-07-01');
    expect(upgradeEmailDedupeKey(42, night)).toBe(upgradeEmailDedupeKey(42, morning));
    expect(upgradeEmailDedupeKey(42, nextDay)).toBe('auto-exec:upgrade-emailed:42:2026-07-02');
  });

  it('is tenant-scoped', () => {
    const now = new Date('2026-07-01T06:00:00Z');
    expect(upgradeEmailDedupeKey(1, now)).not.toBe(upgradeEmailDedupeKey(2, now));
  });
});

describe('buildUpgradeCopy', () => {
  it('pluralizes and names the exhausted window', () => {
    const one = buildUpgradeCopy({ pendingAgents: 1, reason: 'daily_exhausted', effectivePlan: 'free' });
    expect(one.subject).toContain('1 agent is');
    expect(one.subject).toContain('daily');
    expect(one.intro).toContain('1 agent is');

    const many = buildUpgradeCopy({ pendingAgents: 5, reason: 'monthly_exhausted', effectivePlan: 'pro' });
    expect(many.subject).toContain('5 agents are');
    expect(many.subject).toContain('monthly');
    expect(many.intro).toContain('5 agents are');
  });

  it('tailors the upgrade hint to the current plan', () => {
    expect(buildUpgradeCopy({ pendingAgents: 2, reason: 'daily_exhausted', effectivePlan: 'free' }).upgradeHint)
      .toContain('Pro');
    expect(buildUpgradeCopy({ pendingAgents: 2, reason: 'daily_exhausted', effectivePlan: 'pro' }).upgradeHint)
      .toContain('Teams');
    // Teams is already the top plan — no "upgrade to X" pitch.
    expect(buildUpgradeCopy({ pendingAgents: 2, reason: 'monthly_exhausted', effectivePlan: 'teams' }).upgradeHint)
      .not.toContain('Upgrade to');
  });
});

/**
 * THE WINDOW THAT NEVER MOVED, one layer below the manager's (see `managedWindow.test.ts`).
 *
 * `loadAutonomousCandidates` bounds one tick to {@link MAX_CANDIDATES_PER_TICK} rows under
 * a TOTAL, STABLE order (manager rank, then priority tier, then `updated_at`). A fixed cap
 * over a fixed order is a set, not a window — so with more qualifying tickets than the
 * limit, the same rows are examined on every tick and the tail is unreachable, not merely
 * delayed.
 *
 * The bound was justified by "each dispatched ticket becomes a live run and is skipped
 * next tick, so the backlog naturally paces itself". The skip happened in the EVALUATOR;
 * the ticket kept its slot here. Measured on project 11, 2026-07-29: 372 of 670 stalled
 * tickets `never_started`, oldest idle 49 days, on a board that completed 2,151 agent runs
 * that day and holds 708 managed tickets against a 400-row window.
 *
 * The defect lives entirely in the WHERE clause, so this reads the rendered SQL —
 * `.toSQL()` never dials the connection.
 */
const db = buildDatabase({ NEON_DATABASE_URL: 'postgresql://user:pw@localhost/db' } as Parameters<typeof buildDatabase>[0]);
const candidateQuery = () => autonomousCandidatesQuery(db, MAX_CANDIDATES_PER_TICK).toSQL();
const candidateSql = (): string => candidateQuery().sql;

describe('the autonomous executor\'s candidate window', () => {
  it('excludes a ticket that already has a live run, so its slot is freed', () => {
    const sql = candidateSql();
    // The exclusion itself: a correlated NOT EXISTS over non-terminal executions.
    expect(sql).toMatch(/not exists/);
    expect(sql).toContain('"executions"');
    // Every non-terminal status must be named — omitting one (paused, say) would let
    // that ticket hold its slot for as long as it stays in that state.
    expect(RuntimeService.NON_TERMINAL_STATUSES.length).toBeGreaterThan(0);
    const { params } = candidateQuery();
    for (const status of RuntimeService.NON_TERMINAL_STATUSES) {
      expect(params, `'${status}' must vacate the window`).toContain(status);
    }
  });

  it('counts only LIVE runs — a rehearsal must not park a ticket out of the window', () => {
    // A rehearsal (0372) drives the real loop and writes a real `executions` row, but it
    // ships nothing. Letting one hold a candidate slot would starve the queue for the
    // length of a dry run.
    expect(candidateSql()).toMatch(/"executions"\."mode"\s*=/);
  });

  it('serializes failed open-PR repairs behind one stable project head', () => {
    const sql = candidateSql();
    expect(sql).toContain('auto_exec_candidate_pr');
    expect(sql).toContain('auto_exec_earlier_pr');
    expect(sql).toMatch(/build_status/);
    expect(sql).toMatch(/created_at.*id/);
    const migration = readFileSync(
      fileURLToPath(new URL('../../../migrations/0397_pr_repair_queue_head.sql', import.meta.url).href),
      'utf8',
    ).replace(/\s+/g, ' ');
    expect(migration).toContain(
      'ON pull_requests(tenant_id, project_id, created_at, id)',
    );
  });

  it('is backed by the index the correlated probe needs (0384)', () => {
    // The probe is evaluated per candidate row on a five-minute cron path, over a table
    // growing by thousands of rows a day, and `executions` had no index that serves it.
    // Unindexed, this fix would trade one starvation for a sequential scan.
    const migration = readFileSync(
      fileURLToPath(new URL('../../../migrations/0384_autonomous_candidate_window.sql', import.meta.url).href),
      'utf8',
    ).replace(/\s+/g, ' ');
    expect(migration).toContain(
      'CREATE INDEX IF NOT EXISTS idx_executions_task_status ON executions(task_id, status)',
    );
  });

  it('still bounds the scan and still drains by priority', () => {
    // The fix must not turn the queue back into arrival order — priority-first dispatch
    // is the reason the ordering exists.
    const sql = candidateSql();
    expect(sql).toContain('limit');
    const orderBy = sql.slice(sql.lastIndexOf(' order by '));
    expect(orderBy).toContain('manager_rank');
    expect(orderBy.indexOf('manager_rank')).toBeLessThan(orderBy.indexOf('priority'));
  });
});
