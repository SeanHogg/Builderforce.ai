/**
 * Late steers — operator decision 2026-09-12: "steers that arrive after a run's last
 * turn => spend the tokens". The use case turns such a steer into ONE follow-up run, and
 * these tests pin the three contracts that decision rests on:
 *   - a late steer starts exactly one follow-up, carrying the steer, under its sender;
 *   - a duplicate frame (a retried report, a second terminal chokepoint) is still one run;
 *   - an entitlement refusal falls back to the visible drop, carrying the reason.
 * The world is an in-memory port whose `claim` is atomic, exactly like the real
 * single-statement UPDATE … WHERE late_claimed_at IS NULL … RETURNING.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./followUpRun', () => ({ startFollowUpRun: vi.fn() }));
vi.mock('./cloudToolEvents', () => ({ recordCloudToolEvent: vi.fn() }));
vi.mock('./cloudAgent/agent', () => ({ resolveCloudAgent: vi.fn() }));

import { dispatchLateSteerFollowUp, settleLateSteers, type LateSteerPorts } from './lateSteerFollowUp';
import type { FollowUpRunArgs, FollowUpRunOutcome } from './followUpRun';
import type { LateSteerOutcomeKind } from './executionSteering';

interface Row {
  id: number;
  text: string;
  sentBy: string | null;
  consumedAt: Date | null;
  lateClaimedAt: Date | null;
  lateOutcome: LateSteerOutcomeKind | null;
  followUpExecutionId: number | null;
  lateDetail: string | null;
}

function world(opts: { status?: string; steers: Array<Partial<Row> & { id: number; text: string }>; followUp?: FollowUpRunOutcome }) {
  const run = {
    id: 42, tenantId: 7, status: opts.status ?? 'completed', taskId: 11,
    payload: JSON.stringify({ cloudAgentRef: 'bob', model: 'm' }), agentHostId: 5, source: 'agent',
    cloudAgentRef: 'bob', submittedBy: 'system:lane-auto',
  };
  const rows: Row[] = opts.steers.map((s) => ({
    sentBy: null, consumedAt: null, lateClaimedAt: null, lateOutcome: null, followUpExecutionId: null, lateDetail: null, ...s,
  }));
  const startFollowUp = vi.fn(async (_args: FollowUpRunArgs): Promise<FollowUpRunOutcome> =>
    opts.followUp ?? { kind: 'started', executionId: 900, dispatch: { ok: true } });
  const timeline = vi.fn<LateSteerPorts['timeline']>(async () => undefined);
  const ports: LateSteerPorts = {
    loadExecution: async (id, tenantId) => (id === run.id && (tenantId == null || tenantId === run.tenantId) ? { ...run } : null),
    loadTask: async () => ({
      id: 11, title: 'Ship the README', description: null, assignedAgentHostId: null, assignedAgentRef: 'bob',
      assignedUserId: null, priority: 'medium', projectId: 3,
    }),
    repend: async (_tenantId, _executionId, ids) => {
      for (const r of rows) if (ids.includes(r.id) && !r.lateClaimedAt) r.consumedAt = null;
    },
    // Atomic, like the real single UPDATE: no await between the check and the stamp.
    claim: async (_tenantId, _executionId, ids) => {
      const now = new Date();
      const out = [];
      for (const r of rows) {
        if (r.lateClaimedAt) continue;
        if (ids ? !ids.includes(r.id) : r.consumedAt != null) continue;
        r.lateClaimedAt = now;
        r.consumedAt = now;
        out.push({ id: r.id, text: r.text, sentBy: r.sentBy });
      }
      return out;
    },
    priorOutcome: async (_tenantId, _executionId, ids) => {
      const r = rows.find((x) => ids.includes(x.id) && x.lateClaimedAt);
      return r ? { outcome: r.lateOutcome, followUpExecutionId: r.followUpExecutionId } : null;
    },
    recordOutcome: async (_tenantId, ids, o) => {
      for (const r of rows) {
        if (!ids.includes(r.id)) continue;
        r.lateOutcome = o.outcome;
        r.followUpExecutionId = o.followUpExecutionId ?? null;
        r.lateDetail = o.detail ?? null;
      }
    },
    agentLabel: async () => 'Bob',
    startFollowUp,
    timeline,
  };
  return { run, rows, ports, startFollowUp, timeline };
}

describe('dispatchLateSteerFollowUp — a steer that missed its run starts a follow-up', () => {
  it('a late steer starts exactly one follow-up, carrying the steer, under the person who sent it', async () => {
    // Relayed to the host (so already consumed), then refused because the run had closed its input.
    const w = world({ steers: [{ id: 1, text: 'also update the README', sentBy: 'user-ada', consumedAt: new Date() }] });

    const out = await dispatchLateSteerFollowUp(w.ports, { executionId: 42, tenantId: 7, messageIds: [1], reason: 'run_finishing' });

    expect(out).toEqual({ kind: 'started', followUpExecutionId: 900 });
    expect(w.startFollowUp).toHaveBeenCalledTimes(1);
    const args = w.startFollowUp.mock.calls[0]![0];
    expect(args).toMatchObject({ tenantId: 7, directive: 'also update the README', submittedBy: 'user-ada', agentLabel: 'Bob' });
    // Same run the follow-up continues from: its payload (agent/model/repo pin) and host.
    expect(args.prior).toMatchObject({ id: 42, agentHostId: 5, payload: w.run.payload });
    expect(w.timeline).toHaveBeenCalledWith(expect.objectContaining({
      executionId: 42, agentHostId: 5, toolName: 'steer.followed_up',
      detail: expect.objectContaining({ text: 'also update the README', followUpExecutionId: 900, arrival: 'run_finishing' }),
    }));
    expect(w.rows[0]).toMatchObject({ lateOutcome: 'started', followUpExecutionId: 900 });
  });

  it('a duplicate frame is still ONE run — sequential or concurrent', async () => {
    const w = world({ steers: [{ id: 1, text: 'run the tests', sentBy: 'user-ada', consumedAt: new Date() }] });
    const frame = { executionId: 42, tenantId: 7, messageIds: [1], reason: 'run_finishing' as const };

    const [a, b] = await Promise.all([dispatchLateSteerFollowUp(w.ports, frame), dispatchLateSteerFollowUp(w.ports, frame)]);
    const c = await dispatchLateSteerFollowUp(w.ports, frame);
    // …and the run's terminal chokepoint settling afterwards finds nothing left either.
    const d = await settleLateSteers(w.ports, { executionId: 42 });

    expect(w.startFollowUp).toHaveBeenCalledTimes(1);
    expect([a, b].filter((o) => o.kind === 'started')).toHaveLength(1);
    // The racing loser lost the atomic claim while the winner was still dispatching, so it
    // can only say "already claimed" — but it starts nothing, which is the contract.
    expect([a, b].find((o) => o.kind !== 'started')?.kind).toBe('duplicate');
    // Once settled, a retried frame also says what the steer became.
    expect(c).toEqual({ kind: 'duplicate', outcome: 'started', followUpExecutionId: 900 });
    expect(d).toEqual({ kind: 'none' });
  });

  it('an entitlement refusal falls back to the visible drop, carrying the refusal reason', async () => {
    const message = 'Monthly AI spend cap reached for this seat ($5.00).';
    const w = world({
      steers: [{ id: 1, text: 'push it', sentBy: 'user-ada', consumedAt: new Date() }],
      followUp: { kind: 'refused', reason: 'tenant_token_limit', message },
    });

    const out = await dispatchLateSteerFollowUp(w.ports, { executionId: 42, messageIds: [1], reason: 'run_finishing' });

    expect(out).toEqual({ kind: 'refused', reason: 'tenant_token_limit', message });
    expect(w.timeline).toHaveBeenCalledTimes(1);
    const row = w.timeline.mock.calls[0]![0];
    expect(row.toolName).toBe('steer.dropped');
    expect(row.detail).toMatchObject({ reason: 'tenant_token_limit', refusal: message, text: 'push it' });
    expect(row.result).toContain(message);
    expect(w.rows[0]).toMatchObject({ lateOutcome: 'refused', followUpExecutionId: null });
    expect(w.rows[0]!.lateDetail).toContain(message);
  });

  it('the terminal chokepoint folds every still-pending steer into ONE follow-up, oldest first, and leaves delivered ones alone', async () => {
    const w = world({
      steers: [
        { id: 1, text: 'delivered mid-run', consumedAt: new Date() },
        { id: 2, text: 'also bump the version', sentBy: 'user-ada' },
        { id: 3, text: 'and tag the release', sentBy: 'user-bo' },
      ],
    });

    const out = await settleLateSteers(w.ports, { executionId: 42 });

    expect(out).toEqual({ kind: 'started', followUpExecutionId: 900 });
    expect(w.startFollowUp).toHaveBeenCalledTimes(1);
    expect(w.startFollowUp.mock.calls[0]![0]).toMatchObject({ directive: 'also bump the version\n\nand tag the release', submittedBy: 'user-ada' });
    expect(w.rows[0]!.lateClaimedAt).toBeNull();
  });

  it('never starts a follow-up beside a LIVE run — the reported steer goes back to its queue', async () => {
    const w = world({ status: 'running', steers: [{ id: 1, text: 'use Go', consumedAt: new Date() }] });

    const out = await dispatchLateSteerFollowUp(w.ports, { executionId: 42, messageIds: [1], reason: 'no_live_run' });

    expect(out).toEqual({ kind: 'deferred' });
    expect(w.startFollowUp).not.toHaveBeenCalled();
    expect(w.rows[0]).toMatchObject({ consumedAt: null, lateClaimedAt: null });
  });

  it('a cancelled run\'s late steer is released visibly — the person stopped the work', async () => {
    const w = world({ status: 'cancelled', steers: [{ id: 1, text: 'keep going' }] });

    const out = await settleLateSteers(w.ports, { executionId: 42 });

    expect(out).toEqual({ kind: 'released', count: 1 });
    expect(w.startFollowUp).not.toHaveBeenCalled();
    expect(w.timeline).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'steer.dropped', detail: expect.objectContaining({ reason: 'run_cancelled' }) }));
    expect(w.rows[0]!.lateOutcome).toBe('released');
  });

  it('a follow-up held on the approval gate says so on the timeline instead of claiming a run started', async () => {
    const w = world({
      steers: [{ id: 1, text: 'merge it', sentBy: 'user-ada' }],
      followUp: { kind: 'awaiting_approval', approvalId: 'ap_1', reason: 'Task priority requires manager approval before execution.' },
    });

    const out = await settleLateSteers(w.ports, { executionId: 42 });

    expect(out).toEqual({ kind: 'awaiting_approval', approvalId: 'ap_1' });
    expect(w.timeline).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'steer.followed_up', detail: expect.objectContaining({ outcome: 'awaiting_approval' }) }));
    expect(w.rows[0]!.lateOutcome).toBe('awaiting_approval');
  });
});
