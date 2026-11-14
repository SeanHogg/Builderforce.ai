/**
 * PRD 39 §4b — fleet failover: when the stale-execution reaper finds a SELF-HOSTED run
 * stranded and another online host exists in the tenant, it re-dispatches the run ONCE
 * — but ONLY when the write-ahead rule proves nothing unsafe ran. Otherwise it fails
 * the run with the reason recorded (asks a human). Old hosts (no advertised support)
 * are failed exactly as today, with no behavior change.
 *
 * These tests drive `reapStaleExecutions` against the shared fake DB. The write-ahead
 * intent state lives on the OPERATIONAL endpoint; `siblingDatabase(env, db, 'operational')`
 * resolves to the core handle when no operational binding is set, so the fake's intent
 * rows are read through the same handle here.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createReaperFakeDb, newReaperFakeDbScript, type ReaperFakeDbScript } from './__fixtures__/staleExecutionReaperDb';

interface Captured {
  failed: number[];
  failedReasons: Map<number, string>;
  /** Per execution: the payload each `executions` UPDATE wrote (requeue flag, redispatch flip). */
  updatePayloads: Map<number, string>;
  updateStatuses: Map<number, string>;
  /** tool_audit rows the reaper inserted, by toolName → executionIds. */
  auditEvents: Map<string, number[]>;
  /** Intent rows the fake operational handle holds (loaded by the reaper's read model). */
  intents: Map<number, Array<{ seq: number; requiresAck: boolean; toolName: string }>>;
}

let captured: Captured;
let script: ReaperFakeDbScript;
let dispatchMock: ReturnType<typeof vi.fn>;

/** Intent rows as the fake operational `tool_intents` SELECT returns them. */
function intentRows(executionId: number) {
  return (captured.intents.get(executionId) ?? []).map((i) => ({
    seq: i.seq,
    requires_ack: i.requiresAck,
    tool_name: i.toolName,
  }));
}

function newScript(): ReaperFakeDbScript {
  return newReaperFakeDbScript({
    onUpdate: (set, params) => {
      const id = Number(params[0]);
      // Host-failover redispatch: flip to submitted (payload unchanged — keep the
      // once-only-flag payload captured by the earlier payload-only update).
      if (set.status === 'submitted') {
        captured.updateStatuses.set(id, 'submitted');
        return [];
      }
      // Persist the once-only flag (requeue/redispatch path) — payload-only update.
      if (set.status === undefined && set.payload !== undefined) {
        captured.updatePayloads.set(id, String(set.payload));
        return [];
      }
      // Fail a run by id: `where id = $1 and status = $2` binds the id first.
      if (set.status === 'failed' && Number.isFinite(id)) {
        const reason = String(set.errorMessage);
        captured.failed.push(id);
        captured.failedReasons.set(id, reason);
        return [{ id, tenant_id: 1, agent_host_id: null, payload: null, error_message: reason }];
      }
      return [];
    },
    onInsert: (v) => {
      const list = captured.auditEvents.get(String(v.toolName)) ?? [];
      list.push(Number(v.executionId));
      captured.auditEvents.set(String(v.toolName), list);
    },
  });
}

vi.mock('../../infrastructure/database/connection', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../infrastructure/database/connection')>();
  const intentSelect = (fields: Record<string, unknown>) => {
    // camelCase keys — the read model reads row.requiresAck / row.toolName.
    const rows = [...captured.intents.entries()].flatMap(([, list]) =>
      list.map((i) => ({ seq: i.seq, requiresAck: i.requiresAck, toolName: i.toolName })),
    );
    const where = () => Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
    return { from: () => ({ where }) };
  };
  return {
    ...original,
    buildDatabase: () => createReaperFakeDb(script),
    // The reaper resolves the operational sibling through this; with no NEON_TRANSACTIONAL
    // binding the real siblingDatabase returns the core handle, but the fake replaces it.
    siblingDatabase: (_env: unknown, _core: unknown) => ({
      ...createReaperFakeDb(script),
      select: (fields: Record<string, unknown> = {}) =>
        'toolName' in fields ? intentSelect(fields) : createReaperFakeDb(script).select(fields),
    }),
  };
});

import { reapStaleExecutions } from './staleExecutionReaper';
import { hostFailoverUnsafeReason, HOST_FAILOVER_REDISPATCH_REASON } from './orphanReasons';

function envWithRelay(ok = true) {
  dispatchMock.mockResolvedValue({ ok, status: ok ? 200 : 500 });
  return {
    NEON_DATABASE_URL: 'postgres://fake',
    AGENT_HOST_RELAY: {
      idFromName: (name: string) => ({ name }),
      get: () => ({ fetch: dispatchMock }),
    },
  } as unknown as Parameters<typeof reapStaleExecutions>[0];
}

const STALE_TS = '2000-01-01T00:00:00.000Z';

/** A stranded self-hosted run on host 10, task 7, with a given payload. */
function hostRun(id: number, payload: string, hostId = 10) {
  return {
    id, tenant_id: 1, agent_host_id: hostId, cloud_agent_ref: null, payload, error_message: null,
    task_id: 7, task_title: 'Build feature',
  };
}

beforeEach(() => {
  captured = {
    failed: [], failedReasons: new Map(), updatePayloads: new Map(), updateStatuses: new Map(),
    auditEvents: new Map(), intents: new Map(),
  };
  script = newScript();
  dispatchMock = vi.fn();
  dispatchMock.mockReset();
});

describe('reapStaleExecutions — PRD 39 §4b fleet failover', () => {
  it('(a) re-dispatches ONCE when safe: advertised support + no non-allowlisted intent + gap-free sequence', async () => {
    script.hostCandidates = [hostRun(42, '{"writeAhead":1}')];
    script.onlineHosts = [20]; // host 20 online, host 10 (dead) excluded
    // Only allowlisted (read) intents → requires_ack false, sequence 1,2,3 gap-free.
    captured.intents.set(42, [
      { seq: 1, requiresAck: false, toolName: 'read_file' },
      { seq: 2, requiresAck: false, toolName: 'search_code' },
      { seq: 3, requiresAck: false, toolName: 'list_files' },
    ]);

    const res = await reapStaleExecutions(envWithRelay(true));

    expect(res.redispatchedHost).toBe(1);
    expect(captured.failed).not.toContain(42);
    // Reused the relay dispatch to host 20.
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    // Once-only flag persisted before kickoff; the row flips back to submitted.
    expect(JSON.parse(captured.updatePayloads.get(42)!).reaperRequeued).toBe(true);
    expect(captured.updateStatuses.get(42)).toBe('submitted');
    // The resurrection is explained on the timeline, and no failure event is written.
    expect(captured.auditEvents.get('runtime.host_redispatch')).toContain(42);
    expect(captured.auditEvents.get('run.failed')).toBeUndefined();
  });

  it('(b) fails with the reason recorded when a non-allowlisted intent is held (a mutating tool was in flight)', async () => {
    script.hostCandidates = [hostRun(43, '{"writeAhead":1}')];
    script.onlineHosts = [20];
    captured.intents.set(43, [
      { seq: 1, requiresAck: false, toolName: 'read_file' },
      { seq: 2, requiresAck: true, toolName: 'git_push' }, // non-allowlisted, never acked
    ]);

    const res = await reapStaleExecutions(envWithRelay(true));

    expect(res.redispatchedHost).toBe(0);
    expect(captured.failed).toContain(43);
    const reason = captured.failedReasons.get(43)!;
    expect(reason).toContain('git_push');
    expect(reason).toContain('side effect');
    // Not re-dispatched.
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('(c) no re-dispatch for an OLD host that never advertised support — failed exactly as today', async () => {
    script.hostCandidates = [hostRun(44, '{"model":"m"}')]; // no writeAhead flag
    script.onlineHosts = [20];
    captured.intents.set(44, []); // no intents — but for old hosts "no intent" proves nothing

    const res = await reapStaleExecutions(envWithRelay(true));

    expect(res.redispatchedHost).toBe(0);
    expect(captured.failed).toContain(44);
    // Not re-dispatched even though another host is online and there are no intents.
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('(d) sequence-gap detection fails safe — a lost tool call refuses automatic re-dispatch', async () => {
    script.hostCandidates = [hostRun(45, '{"writeAhead":1}')];
    script.onlineHosts = [20];
    // GAP: sequence jumps 1 → 3 (the seq-2 call, possibly a mutating one, was lost).
    captured.intents.set(45, [
      { seq: 1, requiresAck: false, toolName: 'read_file' },
      { seq: 3, requiresAck: false, toolName: 'list_files' },
    ]);

    const res = await reapStaleExecutions(envWithRelay(true));

    expect(res.redispatchedHost).toBe(0);
    expect(captured.failed).toContain(45);
    expect(captured.failedReasons.get(45)!).toContain('gap');
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('never re-dispatches a run that already used its one retry (reaperRequeued already set)', async () => {
    script.hostCandidates = [hostRun(46, '{"writeAhead":1,"reaperRequeued":true}')];
    script.onlineHosts = [20];
    captured.intents.set(46, [{ seq: 1, requiresAck: false, toolName: 'read_file' }]);

    const res = await reapStaleExecutions(envWithRelay(true));

    expect(res.redispatchedHost).toBe(0);
    expect(captured.failed).toContain(46);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('fails (does not re-dispatch) when no other host in the tenant is online', async () => {
    script.hostCandidates = [hostRun(47, '{"writeAhead":1}')];
    script.onlineHosts = []; // no failover target
    captured.intents.set(47, [{ seq: 1, requiresAck: false, toolName: 'read_file' }]);

    const res = await reapStaleExecutions(envWithRelay(true));

    expect(res.redispatchedHost).toBe(0);
    expect(captured.failed).toContain(47);
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});

describe('PRD 39 §4b write-ahead reasons', () => {
  it('hostFailoverUnsafeReason embeds the specific detail and mentions review', () => {
    const reason = hostFailoverUnsafeReason('the run’s tool-call sequence has a gap');
    expect(reason).toContain('the run’s tool-call sequence has a gap');
    expect(reason).toContain('human to review');
  });

  it('HOST_FAILOVER_REDISPATCH_REASON explains the verified re-dispatch', () => {
    expect(HOST_FAILOVER_REDISPATCH_REASON).toContain('write-ahead intents');
    expect(HOST_FAILOVER_REDISPATCH_REASON).toContain('another online host');
  });
});
