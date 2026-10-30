/**
 * The cloud adapter's events / people / steering ports (PRD 35 WS3). Fakes only at the DB edge: the timeline writer, the
 * typed-claim ledger, the approval pause and the pending-steer reader.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  record: vi.fn(async (..._args: unknown[]) => undefined),
  claim: vi.fn(async (..._args: unknown[]) => ({ ok: true })),
  pause: vi.fn(async (..._args: unknown[]) => ({ approvalId: 'appr-3' })),
  steers: vi.fn(async (..._args: unknown[]) => [] as string[]),
}));
vi.mock('./cloudToolEvents', () => ({ recordCloudToolEvent: h.record }));
vi.mock('../provenance/finishClaimService', () => ({ recordTypedExecutionClaim: h.claim }));
vi.mock('./executionPause', () => ({ pauseExecutionForQuestion: h.pause }));
vi.mock('./cloudLoopControl', () => ({ applyPendingSteering: h.steers }));

import { durableHuman, pendingSteering, timelineSink } from './cloudAdapterPorts';

const run = { tenantId: 1, projectId: 2, taskId: 3, executionId: 4, cloudAgentRef: 'agent-x', agentLabel: 'Ada' };
const rowOf = (name: string) => h.record.mock.calls.map((c) => c[1] as Record<string, unknown>).find((r) => r.toolName === name);

beforeEach(() => vi.clearAllMocks());

describe('timelineSink', () => {
  it('records a dispatched call with its args, its capped result and its MEASURED duration', async () => {
    await timelineSink({} as never, run, () => null, () => undefined).emit({ kind: 'tool.dispatched', step: 1, tool: 'write_file', ok: true, callId: 'c1', args: { path: 'a.ts', summary: 's', content: 'x' }, result: { ok: true } }, { durationMs: 42 });
    expect(rowOf('write_file')).toMatchObject({ tenantId: 1, executionId: 4, category: 'tool', toolCallId: 'c1', detail: { path: 'a.ts', summary: 's' }, durationMs: 42 });
  });

  it('files a typed claim for a successful validation or review verdict — and only a successful one', async () => {
    const sink = timelineSink({} as never, run, () => null, () => undefined);
    await sink.emit({ kind: 'tool.dispatched', step: 1, tool: 'run_checks', ok: true, args: {}, result: {} });
    await sink.emit({ kind: 'tool.dispatched', step: 1, tool: 'builtin_reviews_record', ok: true, args: {}, result: {} });
    await sink.emit({ kind: 'tool.dispatched', step: 1, tool: 'run_command', ok: false, args: {}, result: {} });
    expect(h.claim.mock.calls.map((c) => (c[1] as { kind: string }).kind)).toEqual(['validation', 'review_verdict']);
  });

  it('restores the governance, finish, repetition and compaction rows in the shapes the UI reads', async () => {
    const sink = timelineSink({} as never, run, () => 'm-1', () => undefined);
    await sink.emit({ kind: 'policy.blocked', step: 1, tool: 'delete_file', gateId: 'g2', reason: 'no deletes' });
    await sink.emit({ kind: 'finish.blocked', step: 1, reason: 'review_verdict_missing', block: 'sign off first', detail: { roleKey: 'qa' } });
    await sink.emit({ kind: 'loop.repetition', step: 2, copies: 4, block: 'same words' });
    await sink.emit({ kind: 'context.compacted', step: 3, dropped: 6, beforeTokens: 90_000, afterTokens: 20_000, summarized: true });
    expect(rowOf('policy.blocked')).toMatchObject({ result: 'Blocked delete_file: no deletes' });
    expect(rowOf('finish.blocked')).toMatchObject({ detail: { reason: 'review_verdict_missing', roleKey: 'qa' } });
    expect(rowOf('llm.repetition_loop')).toMatchObject({ detail: { step: 2, model: 'm-1', copies: 4 } });
    expect(rowOf('context.compacted')?.result).toContain('builder-memory summary');
  });

  it('names a released model and why on the cascade row', async () => {
    await timelineSink({} as never, run, () => null, () => undefined).emit({ kind: 'model.cascade', step: 4, from: 'opus', status: 413, released: true });
    expect(rowOf('model.cascade')).toMatchObject({ detail: { step: 4, from: 'opus', reason: '413' } });
  });

  it('a sink that cannot write never fails the run', async () => {
    h.record.mockRejectedValueOnce(new Error('db down'));
    const sink = timelineSink({} as never, run, () => null, () => undefined);
    await expect(sink.emit({ kind: 'run.started', step: 0 })).resolves.toBeUndefined();
  });

  it('hands the outcome row to the tail instead of writing it: the cloud writes the ONE row after the run has landed', async () => {
    const taken: unknown[] = [];
    const sink = timelineSink({} as never, run, () => null, (row) => { taken.push(row); });
    const row = { entryPoint: 'cloud', steps: 3, toolCalls: 2, toolErrors: 0, compactions: 0, stallRecoveries: 0, escalations: 0, verify: 'not-run', terminalStatus: 'finished' } as const;
    await sink.outcome?.(row);
    expect(taken).toEqual([row]);
    expect(h.record).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toolName: 'run.outcome' }));
  });
});

describe('durableHuman', () => {
  it('reports a question as parked — the approval already exists, so it creates none', async () => {
    expect(await durableHuman({} as never, {} as never, run).ask('which db?')).toEqual({ kind: 'paused' });
    expect(h.pause).not.toHaveBeenCalled();
  });

  it('parks a governance gate on an approval and returns its id', async () => {
    const answer = await durableHuman({} as never, {} as never, run).approve!(
      { id: 'g1', effect: 'require-approval', reason: 'needs a person' },
      { tool: 'run_command', args: { command: 'ls' }, reason: 'needs a person' },
    );
    expect(answer).toEqual({ kind: 'paused', approvalId: 'appr-3' });
    expect(h.pause.mock.calls[0]?.[2]).toMatchObject({ executionId: 4, surface: 'durable', question: expect.stringContaining('run_command') });
  });
});

describe('pendingSteering', () => {
  it('drains the execution\'s steers at the current step, each exactly once (consumption is the dedupe), two identical ones included', async () => {
    h.steers.mockResolvedValueOnce(['go left', 'go left']);
    const drained = await pendingSteering({} as never, run, () => 7).drain();
    expect(drained).toEqual(['go left', 'go left']);
    expect(h.steers.mock.calls[0]?.[1]).toMatchObject({ executionId: 4, step: 7 });
  });
});
