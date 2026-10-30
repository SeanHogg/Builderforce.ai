/**
 * cloudOutcomeRow - the ONE writer of a cloud run's `run.outcome` row: its landed status, counts only when the run had a tally,
 * once per execution (the table's partial unique index), via ONE multi-row insert per batch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  /** Executions that already hold their outcome row (the partial unique index). */
  written: new Set<number>(),
  inserts: [] as Array<Array<Record<string, unknown>>>,
}));
vi.mock('../shared/runTelemetryDatabase', () => ({
  runTelemetryDatabase: () => ({
    insert: () => ({
      values: (rows: unknown) => {
        const list = (Array.isArray(rows) ? rows : [rows]) as Array<Record<string, unknown>>;
        h.inserts.push(list);
        return Object.assign(Promise.resolve(undefined), {
          onConflictDoNothing: () => ({
            returning: async () => {
              const won: Array<{ executionId: number }> = [];
              for (const r of list) {
                const id = r.executionId as number;
                if (r.toolName === 'run.outcome' && !h.written.has(id)) { h.written.add(id); won.push({ executionId: id }); }
              }
              return won;
            },
          }),
        });
      },
    }),
  }),
}));

import { handOffOutcomeCounts, recordReapedOutcomes, recordTerminalOutcome } from './cloudOutcomeRow';

const rows = () => h.inserts.flat();
const outcomes = () => rows().filter((r) => r.toolName === 'run.outcome');
const finishes = () => rows().filter((r) => r.toolName === 'run.finished');
const detail = (r: Record<string, unknown>) => JSON.parse(String(r.args)) as Record<string, unknown>;
const exec = (over: Record<string, unknown> = {}) => ({ id: 9, tenantId: 4, cloudAgentRef: 'cloud-agent:1', agentHostId: null, status: 'completed', errorMessage: null, ...over });

beforeEach(() => { h.written.clear(); h.inserts.length = 0; });

describe('recordTerminalOutcome', () => {
  it('records the row with the status the execution LANDED with, and the agent\'s counts when the run had a tally', async () => {
    handOffOutcomeCounts(9, { entryPoint: 'cloud', steps: 3, toolCalls: 5, toolErrors: 1, terminalStatus: 'failed' });
    await recordTerminalOutcome({} as never, exec({ status: 'completed' }));
    expect(outcomes()).toHaveLength(1);
    expect(outcomes()[0]).toMatchObject({ tenantId: 4, executionId: 9, category: 'run', result: 'finished after 3 step(s)' });
    expect(detail(outcomes()[0]!)).toMatchObject({ entryPoint: 'cloud', runId: 'cloud:9', steps: 3, toolCalls: 5, toolErrors: 1, terminalStatus: 'finished' });
    expect(finishes()).toHaveLength(1);
    expect(detail(finishes()[0]!)).toEqual({ kind: 'run.finished', outcome: 'finished' });
  });

  it('a run with no tally (a cancel between ticks, a refusal before it started) carries NO counts - absent, never zero', async () => {
    await recordTerminalOutcome({} as never, exec({ status: 'cancelled' }));
    const d = detail(outcomes()[0]!);
    expect(d.terminalStatus).toBe('cancelled');
    expect(d).not.toHaveProperty('steps');
    expect(d).not.toHaveProperty('toolCalls');
    expect(d).not.toHaveProperty('toolErrors');
  });

  it('names why a run that did not finish stopped', async () => {
    await recordTerminalOutcome({} as never, exec({ status: 'failed', errorMessage: 'Agent execution is halted by the platform operator.' }));
    expect(detail(outcomes()[0]!)).toMatchObject({ terminalStatus: 'failed', reason: 'Agent execution is halted by the platform operator.' });
  });

  it('a lost race (a second writer for the same execution) records no second row and NO second run.finished', async () => {
    await recordTerminalOutcome({} as never, exec({ status: 'failed', errorMessage: 'reaped' }));
    await recordTerminalOutcome({} as never, exec({ status: 'cancelled' }));
    expect(h.written.size).toBe(1);
    expect(finishes()).toHaveLength(1);
  });

  it('skips a self-hosted run (its host reports its own) and a non-terminal status', async () => {
    await recordTerminalOutcome({} as never, exec({ agentHostId: 3 }));
    await recordTerminalOutcome({} as never, exec({ status: 'running' }));
    expect(h.inserts).toHaveLength(0);
  });
});

describe('recordReapedOutcomes', () => {
  it('records ONE multi-row insert per batch: a failed row for every reaped cloud run, none for a host run', async () => {
    await recordReapedOutcomes({} as never, [
      { id: 1, tenant_id: 4, agent_host_id: null, cloud_agent_ref: 'cloud-agent:1', error_message: 'timed out' },
      { id: 2, tenant_id: 4, agent_host_id: null, cloud_agent_ref: null, error_message: 'abandoned question' },
      { id: 3, tenant_id: 4, agent_host_id: 7, cloud_agent_ref: null, error_message: 'host crash' },
    ]);
    expect(h.inserts[0]).toHaveLength(2); // the outcome rows, in one statement
    expect(outcomes().map((r) => [r.executionId, detail(r).terminalStatus])).toEqual([[1, 'failed'], [2, 'failed']]);
    expect(outcomes()[0]).toMatchObject({ cloudAgentRef: 'cloud-agent:1' });
    expect(finishes().map((r) => r.executionId)).toEqual([1, 2]);
  });

  it('writes run.finished only for the rows that won the insert', async () => {
    h.written.add(2);
    await recordReapedOutcomes({} as never, [
      { id: 1, tenant_id: 4, agent_host_id: null, cloud_agent_ref: null, error_message: 'timed out' },
      { id: 2, tenant_id: 4, agent_host_id: null, cloud_agent_ref: null, error_message: 'timed out' },
    ]);
    expect(finishes().map((r) => r.executionId)).toEqual([1]);
  });
});
