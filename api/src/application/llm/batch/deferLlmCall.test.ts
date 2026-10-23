import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveBatchTarget = vi.fn();
vi.mock('./batchTarget', async (importActual) => ({
  ...(await importActual<typeof import('./batchTarget')>()),
  resolveBatchTarget: (...args: unknown[]) => resolveBatchTarget(...args),
}));

import { deferLlmCall } from './deferLlmCall';
import type { BatchJobStore } from './batchJobStore';

const request = { messages: [{ role: 'user' as const, content: 'consolidate' }], maxTokens: 100 };
const input = { tenantId: 3, kind: 'project_memory' as const, request, payload: { projectId: 9 }, projectId: 9 };

function fakeStore(insert: BatchJobStore['insert'] = async () => 41): BatchJobStore {
  return { insert } as unknown as BatchJobStore;
}

describe('deferLlmCall', () => {
  beforeEach(() => resolveBatchTarget.mockReset());

  it('stays synchronous when the lever is off for the tenant', async () => {
    const r = await deferLlmCall({ COST_LEVER_D6_BATCH_API: 'off' } as never, {} as never, input, fakeStore());
    expect(r).toEqual({ deferred: false, reason: 'lever_off' });
    expect(resolveBatchTarget).not.toHaveBeenCalled();
  });

  it('stays synchronous, with the reason, when no batch target fits', async () => {
    resolveBatchTarget.mockResolvedValue({ ok: false, reason: 'tenant_account_not_batchable' });
    const r = await deferLlmCall({} as never, {} as never, input, fakeStore());
    expect(r).toEqual({ deferred: false, reason: 'tenant_account_not_batchable' });
  });

  it('queues the job on the chosen target under the use case’s ledger name', async () => {
    resolveBatchTarget.mockResolvedValue({ ok: true, target: { vendor: 'anthropic', model: 'claude-sonnet-5-5', funding: 'platform' } });
    const insert = vi.fn(async () => 41);
    const r = await deferLlmCall({} as never, {} as never, input, fakeStore(insert));
    expect(r).toEqual({ deferred: true, jobId: 41 });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 3, projectId: 9, taskId: null, useCase: 'brain_project_memory', callbackKind: 'project_memory',
      callbackPayload: { projectId: 9 }, request, vendor: 'anthropic', model: 'claude-sonnet-5-5', funding: 'platform',
    }));
  });

  it('degrades to the synchronous call when the queue write fails', async () => {
    resolveBatchTarget.mockResolvedValue({ ok: true, target: { vendor: 'openai', model: 'gpt-4.1', funding: 'byo' } });
    const r = await deferLlmCall({} as never, {} as never, input, fakeStore(async () => { throw new Error('db down'); }));
    expect(r).toEqual({ deferred: false, reason: 'enqueue_failed' });
  });
});
