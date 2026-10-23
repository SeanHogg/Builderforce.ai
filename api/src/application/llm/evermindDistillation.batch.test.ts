import { beforeEach, describe, expect, it, vi } from 'vitest';

const deferLlmCall = vi.fn();
vi.mock('./batch/deferLlmCall', () => ({ deferLlmCall: (...args: unknown[]) => deferLlmCall(...args) }));
const stubFetch = vi.fn(async () => new Response('{}', { status: 200 }));
vi.mock('./projectEvermind', () => ({ coordinatorStub: () => ({ fetch: stubFetch }) }));
const noteTeacherFault = vi.fn(async () => undefined);
vi.mock('./evermindTeacher', async (importActual) => ({
  ...(await importActual<typeof import('./evermindTeacher')>()),
  noteTeacherFault: (...args: unknown[]) => noteTeacherFault(...(args as [])),
}));

import { adaptPreDistilledEntry, distillEvermindEntry, evermindTeacherBatchHandler, readPreDistillation, type EvermindAdaptation, type PreDistilledLearnText } from './evermindDistillation';
import type { DistillationStudent } from '@seanhogg/builderforce-memory/distillation';
import type { BatchJob } from './batch/batchTypes';

const env = {} as never;
const RUN_TEXT = 'The agent edited three files and left a TODO in the handler for the retry path.';
const TASK_PROMPT = 'Implement a resilient retry path for the webhook handler with exponential backoff.';
const EXEMPLAR = 'The ideal, expert, fully-worked retry implementation with exponential backoff.';

function student(): DistillationStudent<EvermindAdaptation> & { taught: string[] } {
  const taught: string[] = [];
  return {
    taught,
    adapt: async (text) => { taught.push(text); return { diff: new ArrayBuffer(0), loss: 1, sequences: 1 } as unknown as EvermindAdaptation; },
    skippedResult: () => null,
    describe: (r) => ({ epochs: r ? 1 : 0 }),
  };
}

function posted(): PreDistilledLearnText {
  const call = stubFetch.mock.calls.at(-1) as unknown as [string, RequestInit] | undefined;
  return JSON.parse(String(call?.[1].body));
}

beforeEach(() => { deferLlmCall.mockReset(); stubFetch.mockClear(); noteTeacherFault.mockClear(); });

describe('distillEvermindEntry — deferred teacher', () => {
  const defer = { db: {} as never, projectId: 4, chatId: 9, weight: 2 };

  it('queues the teacher and fits nothing now', async () => {
    deferLlmCall.mockResolvedValue({ deferred: true, jobId: 33 });
    const s = student();
    const r = await distillEvermindEntry(env, 7, { model: 'claude-opus-5-5' }, s, RUN_TEXT, { prompt: TASK_PROMPT, defer });
    expect(r).toEqual({ adapted: null, distilled: false, deferredJobId: 33 });
    expect(s.taught).toEqual([]);
    expect(deferLlmCall).toHaveBeenCalledWith(env, defer.db, expect.objectContaining({
      tenantId: 7, projectId: 4, kind: 'evermind_teacher', pinnedModel: 'claude-opus-5-5',
      payload: expect.objectContaining({ projectId: 4, teacherModel: 'claude-opus-5-5', prompt: TASK_PROMPT, fallbackText: RUN_TEXT, chatId: 9, weight: 2 }),
    }));
  });

  it('never defers without a coordinator to deliver to', async () => {
    deferLlmCall.mockResolvedValue({ deferred: true, jobId: 1 });
    await distillEvermindEntry(env, 7, { model: null, reason: 'not_pinned' }, student(), RUN_TEXT, { defer });
    expect(deferLlmCall).not.toHaveBeenCalled();
  });
});

describe('evermindTeacherBatchHandler', () => {
  const job = {
    tenantId: 7,
    callbackPayload: { projectId: 4, teacherModel: 'claude-opus-5-5', prompt: TASK_PROMPT, fallbackText: RUN_TEXT, chatId: 9 },
  } as unknown as BatchJob;

  it('delivers the exemplar as one pre-distilled contribution', async () => {
    await evermindTeacherBatchHandler.settle({ env, db: {} as never }, job, { content: EXEMPLAR, model: 'claude-opus-5-5' });
    expect(posted()).toEqual({
      tenantId: 7, projectId: 4, text: EXEMPLAR, prompt: TASK_PROMPT, chatId: 9,
      distillation: { distilled: true, teacherModel: 'claude-opus-5-5' },
    });
  });

  it('learns the cleaned run text, un-distilled, when the exemplar is too short', async () => {
    await evermindTeacherBatchHandler.settle({ env, db: {} as never }, job, { content: 'ok', model: 'claude-opus-5-5' });
    expect(posted()).toMatchObject({ text: RUN_TEXT, distillation: { distilled: false, skipReason: 'empty_output', attemptedTeacherModel: 'claude-opus-5-5' } });
  });

  it('benches the teacher and keeps the contribution when no answer could be had', async () => {
    await evermindTeacherBatchHandler.abandon!({ env, db: {} as never }, job, 'sync: HTTP 503');
    expect(noteTeacherFault).toHaveBeenCalledWith(env, 7, 'claude-opus-5-5', 'gateway_error');
    expect(posted()).toMatchObject({ text: RUN_TEXT, distillation: { distilled: false, skipReason: 'gateway_error' } });
  });
});

describe('a pre-distilled contribution — what the coordinator alarm learns from the batch answer', () => {
  it('adapts on the text as is and stamps the distilled provenance', async () => {
    const s = student();
    const r = await adaptPreDistilledEntry(s, EXEMPLAR, { distilled: true, teacherModel: 'anthropic/claude' });
    expect(s.taught).toEqual([EXEMPLAR]);
    expect(r).toMatchObject({ distilled: true, teacherModel: 'anthropic/claude', learnedText: EXEMPLAR });
  });

  it('carries the un-distilled fault fields', async () => {
    const r = await adaptPreDistilledEntry(student(), RUN_TEXT, { distilled: false, skipReason: 'gateway_error', skipDetail: 'HTTP 503', attemptedTeacherModel: 'x/y' });
    expect(r).toMatchObject({ distilled: false, skipReason: 'gateway_error', skipDetail: 'HTTP 503', attemptedTeacherModel: 'x/y', learnedText: RUN_TEXT });
  });

  it('validates the wire field', () => {
    expect(readPreDistillation({ distilled: true, teacherModel: 'm' })).toEqual({ distilled: true, teacherModel: 'm' });
    expect(readPreDistillation({ distilled: false, skipReason: 'bogus', attemptedTeacherModel: 'm' })).toBeUndefined();
    expect(readPreDistillation(null)).toBeUndefined();
  });
});
