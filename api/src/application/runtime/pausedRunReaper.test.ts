/**
 * Paused-run timeout in the stale-execution reaper.
 *
 * A run PAUSED on an `ask_human` question was never reaped by anything — but
 * `evaluateTaskAutoRun` and `laneRequirementGate` both COUNT a paused run as LIVE,
 * so one unanswered question permanently blocked every future auto-run on that
 * ticket. The reaper now fails a paused run after PAUSED_DEADLINE_MS (72h, measured
 * from last activity so an ongoing exchange keeps it alive) with a clear reason, and
 * mirrors it onto the Observability timeline under its OWN tool name so "released
 * because nobody answered" is distinguishable from a crashed run.
 *
 * Driven against the shared in-memory fake of the Drizzle builder chain
 * (__fixtures__/staleExecutionReaperDb.ts, same as staleExecutionReaper.test.ts) — no
 * live database. The idle probe is scripted to flag the paused sweep (plus host/queued,
 * which reap nothing here) so the sweep's UPDATE always runs and its cutoff is observable.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createReaperFakeDb, newReaperFakeDbScript, type ReaperFakeDbScript } from './__fixtures__/staleExecutionReaperDb';

interface Captured {
  /** The cutoff timestamp the paused sweep compared against. */
  pausedCutoff: string | null;
  pausedReason: string | null;
  /** tool_audit_events rows: [executionId, toolName]. */
  events: Array<{ executionId: number; toolName: string }>;
  /** execution ids whose resume record the sweep cleaned up. */
  clearedPauseState: number[];
}

let pausedRows: Array<Record<string, unknown>> = [];
let captured: Captured;
let script: ReaperFakeDbScript;

function newScript(): ReaperFakeDbScript {
  return newReaperFakeDbScript({
    probe: () => ({ host_running: true, cloud_running: false, queued: true, paused: true, park_age: false }),
    // The paused sweep binds its status first: `status = $1 and coalesce(...) < $2`
    // (then failStaleBatch's `id IN (SELECT … LIMIT 100)` subquery).
    onUpdate: (set, params) => {
      if (params[0] === 'paused') {
        captured.pausedReason = String(set.errorMessage);
        captured.pausedCutoff = String(params[1]);
        return pausedRows;
      }
      // The host-running + queued sweeps, and the principal revocation.
      return [];
    },
    // Resume-record cleanup for the questions nobody answered.
    onDelete: (params) => {
      for (const p of params) captured.clearedPauseState.push(Number(p));
    },
    // Telemetry mirror.
    onInsert: (v) => {
      captured.events.push({ executionId: Number(v.executionId), toolName: String(v.toolName) });
    },
  });
}

vi.mock('../../infrastructure/database/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/database/connection')>()),
  buildDatabase: () => createReaperFakeDb(script),
}));

import { reapStaleExecutions } from './staleExecutionReaper';
import { PAUSED_DEADLINE_MS, PAUSED_ORPHAN_REASON } from './orphanReasons';

const env = { NEON_DATABASE_URL: 'postgres://fake' } as unknown as Parameters<typeof reapStaleExecutions>[0];
const NOW = Date.parse('2026-07-19T12:00:00.000Z');

beforeEach(() => {
  script = newScript();
  pausedRows = [];
  captured = { pausedCutoff: null, pausedReason: null, events: [], clearedPauseState: [] };
});

describe('reapStaleExecutions — abandoned ask_human pause', () => {
  it('fails a paused run past the deadline and reports it in the result', async () => {
    pausedRows = [{ id: 77, tenant_id: 1, agent_host_id: null, payload: '{"cloudAgentRef":"agent-x"}', error_message: PAUSED_ORPHAN_REASON }];

    const res = await reapStaleExecutions(env, NOW);

    expect(res.failedPaused).toBe(1);
    // Not conflated with the running/queued counters — a paused timeout is its own class.
    expect(res.failedRunning).toBe(0);
    expect(res.failedQueued).toBe(0);
  });

  it('drops the resume record of a question nobody answered (a terminal run is never redispatched)', async () => {
    pausedRows = [{ id: 77, tenant_id: 1, agent_host_id: null, payload: null, error_message: PAUSED_ORPHAN_REASON }];

    await reapStaleExecutions(env, NOW);

    expect(captured.clearedPauseState).toEqual([77]);
  });

  it('stamps the actionable paused reason (not a crash/timeout message)', async () => {
    pausedRows = [{ id: 77, tenant_id: 1, agent_host_id: null, payload: null, error_message: PAUSED_ORPHAN_REASON }];

    await reapStaleExecutions(env, NOW);

    expect(captured.pausedReason).toBe(PAUSED_ORPHAN_REASON);
    expect(captured.pausedReason).toContain('72 hours');
  });

  it('uses a GENEROUS 72h cutoff — a question asked yesterday is untouched', async () => {
    await reapStaleExecutions(env, NOW);

    expect(captured.pausedCutoff).toBe(new Date(NOW - PAUSED_DEADLINE_MS).toISOString());
    // Sanity: the deadline clears a long weekend, so it can never kill a question a
    // human answers next business day.
    expect(PAUSED_DEADLINE_MS).toBeGreaterThanOrEqual(72 * 60 * 60_000);
    const yesterday = NOW - 24 * 60 * 60_000;
    expect(yesterday).toBeGreaterThan(Date.parse(captured.pausedCutoff!));
  });

  it('emits an observable run.paused_timeout event so the release is explainable', async () => {
    pausedRows = [{ id: 77, tenant_id: 1, agent_host_id: null, payload: '{"cloudAgentRef":"agent-x"}', error_message: PAUSED_ORPHAN_REASON }];

    await reapStaleExecutions(env, NOW);

    expect(captured.events).toContainEqual({ executionId: 77, toolName: 'run.paused_timeout' });
    // and NOT the generic crash mirror used for hung/dropped runs.
    expect(captured.events.some((e) => e.executionId === 77 && e.toolName === 'run.failed')).toBe(false);
  });

  it('is a no-op when no paused run has outlived the deadline', async () => {
    const res = await reapStaleExecutions(env, NOW);

    expect(res.failedPaused).toBe(0);
    expect(captured.events).toHaveLength(0);
  });
});
