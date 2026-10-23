import { beforeEach, describe, expect, it, vi } from 'vitest';

const deferLlmCall = vi.fn();
vi.mock('./batch/deferLlmCall', () => ({ deferLlmCall: (...args: unknown[]) => deferLlmCall(...args) }));
const completeMock = vi.fn();
vi.mock('./LlmProxyService', async (importActual) => ({
  ...(await importActual<typeof import('./LlmProxyService')>()),
  ideProxy: () => ({ complete: completeMock }),
}));

import { classificationBatchRequest, classifyTaskAction, taskActionTypeBatchHandler } from './classifyTask';
import type { BatchJob } from './batch/batchTypes';

const env = {} as never;
const ambiguous = { title: 'Look into the thing', description: 'Something is off.' };
const deferral = { db: {} as never, tenantId: 2, taskId: 77 };

describe('classifyTaskAction — deferred LLM pass', () => {
  beforeEach(() => { deferLlmCall.mockReset(); completeMock.mockReset(); });

  it('answers with the lexical verdict and queues the model pass when deferred', async () => {
    deferLlmCall.mockResolvedValue({ deferred: true, jobId: 5 });
    const r = await classifyTaskAction(env, ambiguous, deferral);
    expect(completeMock).not.toHaveBeenCalled();
    expect(r.actionType).toBeDefined();
    expect(deferLlmCall).toHaveBeenCalledWith(env, deferral.db, expect.objectContaining({
      tenantId: 2, taskId: 77, kind: 'task_action_type', payload: { taskId: 77 }, request: classificationBatchRequest(ambiguous),
    }));
  });

  it('runs the synchronous pass when the job was not queued', async () => {
    deferLlmCall.mockResolvedValue({ deferred: false, reason: 'lever_off' });
    completeMock.mockResolvedValue({ response: new Response(JSON.stringify({ choices: [{ message: { content: '{"action_type":"bugfix","confidence":0.8}' } }] }), { status: 200 }) });
    expect(await classifyTaskAction(env, ambiguous, deferral)).toEqual({ actionType: 'bugfix', confidence: 0.8 });
  });

  it('sends the batch the same strict schema and output cap as the sync pass', () => {
    const req = classificationBatchRequest(ambiguous);
    expect(req).toMatchObject({ maxTokens: 256, temperature: 0, responseFormat: { type: 'json_schema' } });
    expect(req.messages.map((m) => m.role)).toEqual(['system', 'user']);
  });
});

describe('taskActionTypeBatchHandler', () => {
  function fakeDb(task: { title: string; description: string | null } | undefined) {
    const set = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => (task ? [task] : []) }) }) }),
      update: vi.fn(() => ({ set })),
    };
    return { db: db as never, set, update: db.update };
  }
  const job = { tenantId: 2, callbackPayload: { taskId: 77 } } as unknown as BatchJob;

  it('overwrites the cached label with the model verdict', async () => {
    const f = fakeDb({ title: 'Fix the login crash', description: null });
    await taskActionTypeBatchHandler.settle({ env, db: f.db }, job, { content: '{"action_type":"bugfix","confidence":0.9}', model: 'm' });
    expect(f.set).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'bugfix', actionTypeConfidence: 0.9 }));
  });

  it('does nothing for a task deleted while the batch ran', async () => {
    const f = fakeDb(undefined);
    await taskActionTypeBatchHandler.settle({ env, db: f.db }, job, { content: '{"action_type":"docs","confidence":1}', model: 'm' });
    expect(f.update).not.toHaveBeenCalled();
  });

  it('fails the job on an unparseable answer, leaving the lexical label', async () => {
    const f = fakeDb({ title: 't', description: null });
    await expect(taskActionTypeBatchHandler.settle({ env, db: f.db }, job, { content: 'not json', model: 'm' })).rejects.toThrow(/not JSON/);
    expect(f.update).not.toHaveBeenCalled();
  });
});
