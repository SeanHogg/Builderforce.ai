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
 * Driven against a tiny in-memory fake of the neon tagged-template SQL (same
 * approach as staleExecutionReaper.test.ts) — no live database.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

interface Captured {
  /** The cutoff timestamp the paused sweep compared against. */
  pausedCutoff: string | null;
  pausedReason: string | null;
  /** tool_audit_events rows: [executionId, toolName]. */
  events: Array<{ executionId: number; toolName: string }>;
}

let pausedRows: Array<Record<string, unknown>> = [];
let captured: Captured;

function makeSql() {
  return (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ');
    // Stale cloud-candidate SELECT — none in these tests.
    if (text.includes('FROM executions e') && text.includes('JOIN tasks t')) return Promise.resolve([]);
    // The paused sweep: UPDATE ... error_message = ${reason} ... WHERE status = 'paused' ... < ${cutoff}
    if (text.includes("status = 'paused'")) {
      captured.pausedReason = String(values[0]);
      captured.pausedCutoff = String(values[1]);
      return Promise.resolve(pausedRows);
    }
    // Telemetry mirror: VALUES (tenant_id, agent_host_id, cloud_agent_ref, execution_id,
    // session_key, tool_name, ...) — all interpolated, so indices 3 and 5.
    if (text.includes('INSERT INTO tool_audit_events')) {
      captured.events.push({ executionId: Number(values[3]), toolName: String(values[5]) });
      return Promise.resolve([]);
    }
    // The host-running + queued sweeps.
    if (text.includes("status = 'failed'")) return Promise.resolve([]);
    return Promise.resolve([]);
  };
}

vi.mock('@neondatabase/serverless', () => ({
  neon: () => makeSql(),
}));

import { reapStaleExecutions } from './staleExecutionReaper';
import { PAUSED_DEADLINE_MS, PAUSED_ORPHAN_REASON } from './orphanReasons';

const env = { NEON_DATABASE_URL: 'postgres://fake' } as unknown as Parameters<typeof reapStaleExecutions>[0];
const NOW = Date.parse('2026-07-19T12:00:00.000Z');

beforeEach(() => {
  pausedRows = [];
  captured = { pausedCutoff: null, pausedReason: null, events: [] };
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
