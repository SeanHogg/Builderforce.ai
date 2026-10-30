/**
 * cloudOutcomeRow — the ONE writer of a cloud run's `run.outcome` row: its landed status, counts only when the run had a tally,
 * once per execution, for every way a run ends.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  /** Executions that already hold their outcome row (the table's partial unique index). */
  written: new Set<number>(),
  calls: [] as Array<Record<string, unknown>>,
}));
vi.mock('./cloudToolEvents', () => ({
  recordCloudToolEvent: async (_db: unknown, args: Record<string, unknown>) => {
    h.calls.push(args);
    if (args.once) {
      if (h.written.has(args.executionId as number)) return false;
      h.written.add(args.executionId as number);
    }
    return true;
  },
}));

import { handOffOutcomeCounts, recordReapedOutcomes, recordTerminalOutcome } from './cloudOutcomeRow';

const outcomes = () => h.calls.filter((c) => c.toolName === 'run.outcome');
const finishes = () => h.calls.filter((c) => c.toolName === 'run.finished');
const exec = (over: Record<string, unknown> = {}) => ({ id: 9, tenantId: 4, cloudAgentRef: 'cloud-agent:1', agentHostId: null, status: 'completed', errorMessage: null, ...over });

beforeEach(() => { h.written.clear(); h.calls.length = 0; });

describe('recordTerminalOutcome', () => {
  it('records the row with the status the execution LANDED with, and the agent\'s counts when the run had a tally', async () => {
    handOffOutcomeCounts(9, { entryPoint: 'cloud', steps: 3, toolCalls: 5, toolErrors: 1, terminalStatus: 'failed' });
    await recordTerminalOutcome({} as never, exec({ status: 'completed' }));
    expect(outcomes()).toHaveLength(1);
    expect(outcomes()[0]).toMatchObject({
      tenantId: 4, executionId: 9, once: true, category: 'run', result: 'finished after 3 step(s)',
      detail: expect.objectContaining({ entryPoint: 'cloud', runId: 'cloud:9', steps: 3, toolCalls: 5, toolErrors: 1, terminalStatus: 'finished' }),
    });
    // The trace closes with the same landed status, written by the writer that recorded the row.
    expect(finishes()).toHaveLength(1);
    expect(finishes()[0]).toMatchObject({ detail: { kind: 'run.finished', outcome: 'finished' } });
  });

  it('a run with no tally (a cancel between ticks, a refusal before it started) carries NO counts - absent, never zero', async () => {
    await recordTerminalOutcome({} as never, exec({ status: 'cancelled' }));
    const detail = outcomes()[0]!.detail as Record<string, unknown>;
    expect(detail.terminalStatus).toBe('cancelled');
    expect(detail).not.toHaveProperty('steps');
    expect(detail).not.toHaveProperty('toolCalls');
    expect(detail).not.toHaveProperty('toolErrors');
  });

  it('names why a run that did not finish stopped', async () => {
    await recordTerminalOutcome({} as never, exec({ status: 'failed', errorMessage: 'Agent execution is halted by the platform operator.' }));
    expect(outcomes()[0]!.detail).toMatchObject({ terminalStatus: 'failed', reason: 'Agent execution is halted by the platform operator.' });
  });

  it('racing writers (a reap and a cancel, a re-run after an eviction) record ONE row and ONE run.finished', async () => {
    await Promise.all([recordTerminalOutcome({} as never, exec({ status: 'failed', errorMessage: 'reaped' })), recordTerminalOutcome({} as never, exec({ status: 'cancelled' }))]);
    await recordTerminalOutcome({} as never, exec({ status: 'cancelled' }));
    expect(h.written.size).toBe(1);
    expect(finishes()).toHaveLength(1);
  });

  it('skips a self-hosted run (its host reports its own) and a non-terminal status', async () => {
    await recordTerminalOutcome({} as never, exec({ agentHostId: 3 }));
    await recordTerminalOutcome({} as never, exec({ status: 'running' }));
    expect(h.calls).toHaveLength(0);
  });
});

describe('recordReapedOutcomes', () => {
  it('records a failed row for every reaped cloud run - running, queued or paused alike - and none for a host run', async () => {
    await recordReapedOutcomes({} as never, [
      { id: 1, tenant_id: 4, agent_host_id: null, cloud_agent_ref: 'cloud-agent:1', error_message: 'timed out' },
      { id: 2, tenant_id: 4, agent_host_id: null, cloud_agent_ref: null, error_message: 'abandoned question' },
      { id: 3, tenant_id: 4, agent_host_id: 7, cloud_agent_ref: null, error_message: 'host crash' },
    ]);
    expect(outcomes().map((c) => [c.executionId, (c.detail as { terminalStatus: string }).terminalStatus])).toEqual([[1, 'failed'], [2, 'failed']]);
    expect(outcomes()[0]).toMatchObject({ cloudAgentRef: 'cloud-agent:1' });
  });
});
