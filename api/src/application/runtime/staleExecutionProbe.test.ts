/**
 * The `live_runs` arm of the stale-execution probe: which statuses keep the cron gate open, and that
 * the arm is bounded by the run's age. Rendered through the Postgres dialect so the assertions read
 * the statement the database receives, not a test double's idea of it.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { LIVE_RUN_MAX_AGE_MS, LIVE_RUN_STATUSES, stalePredicates } from './staleExecutionProbe';

const CUTOFF = '2026-10-31T00:00:00.000Z';
const render = () => {
  const predicates = stalePredicates({
    running: 'r', cloudRunning: 'c', queued: 'q', paused: 'p', parkAge: 'a', liveRunsStartedAfter: CUTOFF,
  });
  return new PgDialect().sqlToQuery(predicates.liveRuns);
};

describe('the live_runs probe arm', () => {
  it('counts pending, submitted and running runs, and never a paused one', () => {
    const { params } = render();

    expect([...LIVE_RUN_STATUSES].sort()).toEqual(['pending', 'running', 'submitted']);
    expect(params).toEqual(expect.arrayContaining(['pending', 'submitted', 'running']));
    // A run parked on `ask_human` can wait 72 hours and changes nothing on a timer.
    expect(params).not.toContain('paused');
  });

  it('is bounded by the run start, so a hung run with a live heartbeat cannot hold the gate open', () => {
    const { sql: text, params } = render();

    expect(text).toContain('coalesce("executions"."started_at", "executions"."created_at") >');
    expect(params).toContain(CUTOFF);
  });

  it('bounds the arm at twelve hours', () => {
    expect(LIVE_RUN_MAX_AGE_MS).toBe(12 * 60 * 60 * 1000);
  });
});
