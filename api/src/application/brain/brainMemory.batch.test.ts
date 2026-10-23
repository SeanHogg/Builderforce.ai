/**
 * Deferred (PRD D6) project-memory consolidation: the call nobody waits on rides a
 * provider batch, the route answers with the CURRENT memory, and the batch handler does
 * the same store the synchronous path does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as llmProxy from '../llm/LlmProxyService';
import * as brainLlmCall from './brainLlmCall';
import * as brainChatGuards from './brainChatGuards';
import * as deferModule from '../llm/batch/deferLlmCall';
import type { BatchJob } from '../llm/batch/batchTypes';

// Spy the live exports the use cases bound (see brainMemory.test.ts for why not vi.mock).
const defer = vi.spyOn(deferModule, 'deferLlmCall');
const completeTraced = vi.spyOn(brainLlmCall, 'completeTraced').mockResolvedValue({} as never);
vi.spyOn(brainLlmCall, 'buildTenantLlmService').mockResolvedValue({} as never);
vi.spyOn(llmProxy, 'readProxyChoice').mockResolvedValue({ content: '<think>hmm</think>Project memory.' } as never);
const verifyProject = vi.spyOn(brainChatGuards, 'verifyProjectInTenant');

import { consolidateProjectMemory, projectMemoryBatchHandler } from './brainMemory';

/** A db whose selects resolve to `selectRows` in order and whose upserts are recorded. */
function fakeDb(selectRows: unknown[][]) {
  const upserts: Array<Record<string, unknown>> = [];
  let call = 0;
  const chain = () => {
    const rows = selectRows[call++] ?? [];
    const c: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy']) c[m] = () => c;
    c.limit = async () => rows;
    return c;
  };
  const db = {
    select: chain,
    insert: () => ({ values: (v: Record<string, unknown>) => ({ onConflictDoUpdate: async () => { upserts.push(v); } }) }),
  };
  return { db: db as never, upserts };
}

const env = { OPENROUTER_API_KEY: 'k' } as never;

describe('consolidateProjectMemory — deferred', () => {
  beforeEach(() => {
    defer.mockReset();
    completeTraced.mockClear();
    verifyProject.mockResolvedValue({ id: 2, name: 'Atlas' } as never);
  });

  it('queues the consolidation and answers with the memory readers already see', async () => {
    defer.mockResolvedValue({ deferred: true, jobId: 12 });
    const { db, upserts } = fakeDb([[{ chatId: 1, summary: 'chat one' }], [{ consolidatedSummary: 'old memory' }]]);
    const r = await consolidateProjectMemory(db, 1, 2, env);
    expect(r).toEqual({ consolidatedSummary: 'old memory', deferred: true, jobId: 12 });
    expect(completeTraced).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
    expect(defer).toHaveBeenCalledWith(env, db, expect.objectContaining({ tenantId: 1, projectId: 2, kind: 'project_memory', payload: { projectId: 2 } }));
  });

  it('runs synchronously when the job was not queued, or when the caller waits', async () => {
    defer.mockResolvedValue({ deferred: false, reason: 'lever_off' });
    const first = fakeDb([[{ chatId: 1, summary: 'chat one' }]]);
    expect(await consolidateProjectMemory(first.db, 1, 2, env)).toEqual({ consolidatedSummary: 'Project memory.' });

    defer.mockClear();
    const second = fakeDb([[{ chatId: 1, summary: 'chat one' }]]);
    await consolidateProjectMemory(second.db, 1, 2, env, { wait: true });
    expect(defer).not.toHaveBeenCalled();
    expect(second.upserts[0]).toMatchObject({ consolidatedSummary: 'Project memory.' });
  });
});

describe('projectMemoryBatchHandler', () => {
  const job = { tenantId: 1, callbackPayload: { projectId: 2 } } as unknown as BatchJob;

  it('stores the cleaned answer exactly as the synchronous path does', async () => {
    verifyProject.mockResolvedValue({ id: 2, name: 'Atlas' } as never);
    const { db, upserts } = fakeDb([]);
    await projectMemoryBatchHandler.settle({ env, db }, job, { content: '<think>x</think>Consolidated.', model: 'm' });
    expect(upserts).toEqual([{ tenantId: 1, projectId: 2, consolidatedSummary: 'Consolidated.' }]);
  });

  it('skips a project that left the tenant, and fails an empty answer', async () => {
    verifyProject.mockResolvedValue(null as never);
    const gone = fakeDb([]);
    await projectMemoryBatchHandler.settle({ env, db: gone.db }, job, { content: 'x', model: 'm' });
    expect(gone.upserts).toHaveLength(0);

    verifyProject.mockResolvedValue({ id: 2, name: 'Atlas' } as never);
    const empty = fakeDb([]);
    await expect(projectMemoryBatchHandler.settle({ env, db: empty.db }, job, { content: '<think>only</think>', model: 'm' })).rejects.toThrow(/empty/);
  });
});
