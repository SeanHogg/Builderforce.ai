/**
 * cloudOutcomeRow — the ONE `run.outcome` row of a cloud run: its landed status, written once, for every way a run ends.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  existing: [] as unknown[],
  record: vi.fn(async (..._a: unknown[]) => undefined),
}));
vi.mock('../shared/runTelemetryDatabase', () => ({
  runTelemetryDatabase: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => h.existing }) }) }) }),
}));
vi.mock('./cloudToolEvents', () => ({ recordCloudToolEvent: h.record }));

import { landedStatus, writeCloudOutcomeRow, writePausedRunEndRow } from './cloudOutcomeRow';
import { cloudRunId } from '../../domain/execution/cloudRunId';

const run = { tenantId: 4, executionId: 9, cloudAgentRef: 'cloud-agent:1' };

beforeEach(() => { h.existing = []; h.record.mockClear(); });

describe('writeCloudOutcomeRow', () => {
  it('writes the agent\'s row with the status the run LANDED as, and why when it did not finish', async () => {
    await writeCloudOutcomeRow({} as never, run, { entryPoint: 'cloud', steps: 3, toolCalls: 5, terminalStatus: 'finished' }, 'failed', 'review verdict missing');
    expect(h.record).toHaveBeenCalledTimes(1);
    expect(h.record).toHaveBeenCalledWith({}, expect.objectContaining({
      tenantId: 4, executionId: 9, toolName: 'run.outcome', category: 'run', result: 'failed after 3 step(s)',
      detail: expect.objectContaining({ entryPoint: 'cloud', runId: 'cloud:9', steps: 3, toolCalls: 5, terminalStatus: 'failed', reason: 'review verdict missing' }),
    }));
  });

  it('a run that never started still gets a row, naming the refusal', async () => {
    await writeCloudOutcomeRow({} as never, run, undefined, 'failed', 'Agent execution is halted by the platform operator.');
    expect(h.record).toHaveBeenCalledWith({}, expect.objectContaining({
      result: 'failed after 0 step(s)',
      detail: expect.objectContaining({ runId: 'cloud:9', steps: 0, terminalStatus: 'failed', reason: 'Agent execution is halted by the platform operator.' }),
    }));
  });

  it('is idempotent per execution: a re-run after an eviction between the write and the terminal save records nothing', async () => {
    h.existing = [{ id: 1 }];
    await writeCloudOutcomeRow({} as never, run, undefined, 'finished');
    expect(h.record).not.toHaveBeenCalled();
  });
});

describe('a run that ended while paused', () => {
  it('writes a cancelled row, and a reaped one a failed row with the abandonment reason', async () => {
    await writePausedRunEndRow({} as never, { id: 9, tenantId: 4, cloudAgentRef: null }, 'cancelled');
    expect(h.record).toHaveBeenLastCalledWith({}, expect.objectContaining({ detail: expect.objectContaining({ terminalStatus: 'cancelled' }) }));
    await writePausedRunEndRow({} as never, { id: 9, tenantId: 4, cloudAgentRef: null }, 'failed', 'abandoned');
    expect(h.record).toHaveBeenLastCalledWith({}, expect.objectContaining({ detail: expect.objectContaining({ terminalStatus: 'failed', reason: 'abandoned' }) }));
  });

  it('never throws into the cancel or reap that triggered it', async () => {
    h.record.mockRejectedValueOnce(new Error('db down'));
    await expect(writePausedRunEndRow({} as never, { id: 9, tenantId: 4, cloudAgentRef: null }, 'cancelled')).resolves.toBeUndefined();
  });
});

describe('landedStatus / cloudRunId', () => {
  it('maps a landed result to its status, cancelled first', () => {
    expect(landedStatus({ ok: true, cancelled: false })).toBe('finished');
    expect(landedStatus({ ok: false, cancelled: false })).toBe('failed');
    expect(landedStatus({ ok: true, cancelled: true })).toBe('cancelled');
  });

  it('names a cloud run in the shared run-id space', () => {
    expect(cloudRunId(9)).toBe('cloud:9');
  });
});
