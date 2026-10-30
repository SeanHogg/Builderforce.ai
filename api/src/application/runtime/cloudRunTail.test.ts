/**
 * settleCloudRun — how the agent's outcome becomes the cloud's result. The old engine's paths are the oracle:
 * a finish, a cancel, a stall that gave up and a tripped breaker LAND the run; containment and an unrouted gateway
 * failure are hard stops; an eviction-shaped exception is re-thrown so the Durable Object re-arms instead of failing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelTransportError, type RunOutcome, type RunState } from '@builderforce/agent-run';

const h = vi.hoisted(() => ({
  finalize: vi.fn(async () => ({ ok: true, output: 'landed' })),
  release: vi.fn(async () => undefined),
  commit: vi.fn(async () => true),
  workerCancel: vi.fn(async () => undefined),
  sender: vi.fn(async (..._a: unknown[]) => null as string | null),
  row: vi.fn(async (..._a: unknown[]) => undefined),
}));
vi.mock('./executionSteering', () => ({ lastPersonSteerSender: h.sender }));
vi.mock('./cloudOutcomeRow', async (orig) => ({ ...(await orig<Record<string, unknown>>()), handOffOutcomeCounts: h.row }));
vi.mock('../../buildRuntimeService', () => ({ buildRuntimeService: () => ({ cancel: h.workerCancel }) }));
vi.mock('./cloudFinalize', () => ({ finalizeCloudRun: h.finalize }));
vi.mock('../coordination/leaseService', () => ({ releaseAllForExecution: h.release }));
vi.mock('./cloudAgent/runEndMemory', () => ({
  commitRunMemory: h.commit,
  recordRunVerifyEvents: vi.fn(),
}));

import { settleCloudRun, verifySandboxOf } from './cloudRunTail';

const state = { messages: [{ role: 'assistant', content: 'last words' }], step: 3, writtenPaths: ['src/a.ts'], finish: { ciVerified: true, reviewVerdictRecorded: true } } as unknown as RunState;

function host(over: { cancelled?: boolean; runtime?: { cancel: ReturnType<typeof vi.fn> }; opts?: Record<string, unknown> } = {}) {
  return {
    env: {}, db: {}, taskRow: { id: 5, title: 'T', description: null },
    refs: { tenantId: 1, projectId: 2, taskId: 5, executionId: 9, agentLabel: 'Ada' },
    repoCtx: null, repoMiss: '', routing: {}, writtenPaths: new Set<string>(), writtenHashes: new Map<string, string>(),
    cost: { snapshot: () => ({}) },
    cancel: { cancelled: () => over.cancelled === true },
    opts: { ...(over.runtime ? { delegation: { runtime: over.runtime } } : {}), ...(over.opts ?? {}) },
  } as never;
}
const model = (failure?: string) => ({ flushFailure: async () => failure }) as never;
const stash = {};

beforeEach(() => vi.clearAllMocks());

describe('settleCloudRun', () => {
  it('lands a finished run: leases, memory, then the pull request', async () => {
    const result = await settleCloudRun(host(), { kind: 'finished', output: 'done', state }, stash, model());
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.finalize).toHaveBeenCalledWith({}, {}, expect.objectContaining({ finalOutput: 'done', cancelled: false, ciVerified: true }));
    expect(result).toEqual({ ok: true, output: 'landed', cancelled: false, finished: true });
  });

  it('a steered stop CANCELS the execution (nothing restarts it) and lands the cancel finalize', async () => {
    const runtime = { cancel: vi.fn(async () => undefined) };
    const result = await settleCloudRun(host({ runtime }), { kind: 'failed', reason: 'cancelled', state }, stash, model());
    expect(runtime.cancel).toHaveBeenCalledWith(9, expect.any(String));
    expect(h.finalize).toHaveBeenCalledWith({}, {}, expect.objectContaining({ cancelled: true }));
    expect(result.cancelled).toBe(true);
  });

  it('attributes the steered stop to the person who sent it, else to the execution itself', async () => {
    const runtime = { cancel: vi.fn(async () => undefined) };
    h.sender.mockResolvedValueOnce('user-42');
    await settleCloudRun(host({ runtime }), { kind: 'failed', reason: 'cancelled', state }, stash, model());
    expect(h.sender).toHaveBeenCalledWith({}, 1, 9);
    expect(runtime.cancel).toHaveBeenLastCalledWith(9, 'user-42');
    h.sender.mockResolvedValueOnce(null);
    await settleCloudRun(host({ runtime }), { kind: 'failed', reason: 'cancelled', state }, stash, model());
    expect(runtime.cancel).toHaveBeenLastCalledWith(9, 'execution:9');
  });

  it('on a surface with no delegation runtime (the Worker fallback) the same cancel use case transitions the row', async () => {
    const result = await settleCloudRun(host(), { kind: 'failed', reason: 'cancelled', state }, stash, model());
    expect(h.workerCancel).toHaveBeenCalledWith(9, expect.any(String));
    expect(h.finalize).toHaveBeenCalledWith({}, {}, expect.objectContaining({ cancelled: true }));
    expect(result.cancelled).toBe(true);
  });

  it('a cancel the row already carries is not cancelled twice, but still lands', async () => {
    const runtime = { cancel: vi.fn(async () => undefined) };
    await settleCloudRun(host({ cancelled: true, runtime }), { kind: 'failed', reason: 'cancelled', state }, stash, model());
    expect(runtime.cancel).not.toHaveBeenCalled();
    expect(h.finalize).toHaveBeenCalledTimes(1);
  });

  it('a tripped breaker or exhausted budget lands the run with its notice', async () => {
    const result = await settleCloudRun(host(), { kind: 'failed', reason: 'tool calls kept failing', exhausted: true, state }, stash, model());
    expect(h.finalize).toHaveBeenCalledWith({}, {}, expect.objectContaining({ finalOutput: 'tool calls kept failing', cancelled: false }));
    expect(result.finished).toBe(true);
  });

  it('containment and an unrouted gateway failure are hard stops: no finalize, no lease release', async () => {
    const contained = await settleCloudRun(host(), { kind: 'failed', reason: 'Run contained: spend limit', state }, stash, model());
    expect(contained).toEqual({ ok: false, output: 'Run contained: spend limit', cancelled: false, finished: true });
    const gateway = await settleCloudRun(host(), { kind: 'failed', reason: 'the gateway answered 500', state }, stash, model('provider exploded'));
    expect(gateway.output).toBe('provider exploded');
    expect(h.finalize).not.toHaveBeenCalled();
    expect(h.release).not.toHaveBeenCalled();
  });

  it('re-throws an exception that is not a transport failure, so an eviction re-arms rather than fails', async () => {
    const eviction = new Error('Durable Object reset because its code was updated.');
    await expect(settleCloudRun(host(), { kind: 'failed', reason: eviction.message, state, cause: eviction }, stash, model())).rejects.toBe(eviction);
    const transport = new ModelTransportError('429', 429);
    await expect(settleCloudRun(host(), { kind: 'failed', reason: '429', state, cause: transport }, stash, model())).resolves.toMatchObject({ ok: false, finished: true });
  });

  it('a durable tick that yields hands back the resume state; a rehearsal that yields ends with what it said', async () => {
    const yielded: RunOutcome = { kind: 'yielded', state };
    const durable = await settleCloudRun(host({ opts: { deferFinalize: true } }), yielded, stash, model());
    expect(durable).toMatchObject({ ok: true, finished: false, state: { run: state } });
    const rehearsal = await settleCloudRun(host({ opts: { suppressFinalize: true } }), yielded, stash, model());
    expect(rehearsal).toEqual({ ok: true, output: 'last words', cancelled: false, finished: true });
  });

  describe("the agent's counts are handed to the ONE outcome-row writer at the landing", () => {
    it("a finished run hands over the agent's own row", async () => {
      const agentRow = { entryPoint: 'cloud', steps: 3, toolCalls: 4, toolErrors: 1, terminalStatus: 'finished' };
      await settleCloudRun(host(), { kind: 'finished', output: 'done', state }, { row: agentRow as never }, model());
      expect(h.row).toHaveBeenCalledTimes(1);
      expect(h.row).toHaveBeenCalledWith(9, agentRow);
    });

    it('a rehearsal that spent its step budget (settled yielded, landed terminal) hands over a row built from its state', async () => {
      await settleCloudRun(host({ opts: { suppressFinalize: true } }), { kind: 'yielded', state }, {}, model());
      expect(h.row).toHaveBeenCalledWith(9, expect.objectContaining({ entryPoint: 'cloud', runId: 'cloud:9', steps: 3 }));
    });

    it('a run that goes on (paused, a durable tick that yielded) hands over nothing', async () => {
      await settleCloudRun(host(), { kind: 'paused', question: 'q?', approvalId: 'a1', state }, {}, model());
      await settleCloudRun(host({ opts: { deferFinalize: true } }), { kind: 'yielded', state }, {}, model());
      expect(h.row).not.toHaveBeenCalled();
    });
  });

  it('a programming error in the verify/remember tail SURFACES instead of silently skipping the memory write', async () => {
    const unseeded = { ...(host() as unknown as Record<string, unknown>), writtenHashes: undefined } as never;
    await expect(settleCloudRun(unseeded, { kind: 'finished', output: 'done', state }, {}, model())).rejects.toBeInstanceOf(TypeError);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('only the I/O is best-effort: a memory write that fails is reported and the run still lands', async () => {
    h.commit.mockRejectedValueOnce(new Error('memory db down'));
    const result = await settleCloudRun(host(), { kind: 'finished', output: 'done', state }, {}, model());
    expect(result.finished).toBe(true);
    expect(h.finalize).toHaveBeenCalledTimes(1);
  });

  it('reads the run\'s sandbox for the agent\'s verify executor: package.json content, and a basename listing', async () => {
    const fs = vi.fn(async (op: { op: string; path?: string; glob?: string }) => op.op === 'read' ? { ok: true, content: '{"scripts":{}}' } : { ok: true, paths: ['yarn.lock'] });
    const adapted = verifySandboxOf({ fs } as never);
    expect(await adapted.read('package.json')).toBe('{"scripts":{}}');
    expect(await adapted.list('yarn.lock')).toEqual(['yarn.lock']);
    fs.mockResolvedValueOnce({ ok: false } as never);
    expect(await adapted.read('package.json')).toBeNull();
  });

  it('a reviewer run without its verdict does not land as accepted', async () => {
    const noVerdict = { ...state, finish: { ciVerified: false, reviewVerdictRecorded: false } } as unknown as RunState;
    const result = await settleCloudRun(host({ opts: { requiredSignoff: { roleKey: 'qa-tester' } } }), { kind: 'finished', output: 'ok', state: noVerdict }, stash, model());
    expect(result.ok).toBe(false);
    expect(h.finalize).not.toHaveBeenCalled();
  });
});
