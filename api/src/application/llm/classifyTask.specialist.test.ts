import { beforeEach, describe, expect, it, vi } from 'vitest';

const { complete, resolveSpecialist, captureSpecialistSample } = vi.hoisted(() => ({
  complete: vi.fn(),
  resolveSpecialist: vi.fn(),
  captureSpecialistSample: vi.fn(async () => undefined),
}));

vi.mock('./LlmProxyService', async (importActual) => ({
  ...(await importActual<typeof import('./LlmProxyService')>()),
  ideProxy: () => ({ complete }),
}));
vi.mock('./specialists/resolveSpecialist', () => ({ resolveSpecialist }));
vi.mock('./specialists/evalCaseStore', () => ({ captureSpecialistSample }));

import { classifyTaskAction } from './classifyTask';

const env = {} as never;
const ambiguous = { title: 'Look into the thing', description: 'Something is off.' };
const answer = (content: string) => ({ response: new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }) });

beforeEach(() => vi.clearAllMocks());

describe('classifyTaskAction — the task_action_type specialist (cost lever E2)', () => {
  it('with no specialist admitted, asks the free pool unpinned and keeps the input as an eval case', async () => {
    resolveSpecialist.mockResolvedValue(null);
    complete.mockResolvedValue(answer('{"action_type":"bugfix","confidence":0.7}'));
    const r = await classifyTaskAction(env, ambiguous, { tenantId: 9 });
    expect(r).toEqual({ actionType: 'bugfix', confidence: 0.7 });
    expect(resolveSpecialist).toHaveBeenCalledWith(env, 9, 'task_action_type');
    expect(complete.mock.calls[0]![0]).not.toHaveProperty('model');
    expect(captureSpecialistSample).toHaveBeenCalledWith(env, expect.objectContaining({
      jobId: 'task_action_type',
      tenantId: 9,
      request: expect.objectContaining({ max_tokens: 256, response_format: expect.objectContaining({ type: 'json_schema' }) }),
    }));
  });

  it('hints the admitted specialist and does not sample its own answers', async () => {
    resolveSpecialist.mockResolvedValue({ jobId: 'task_action_type', model: '@cf/qwen/qwen3-30b-a3b-fp8', ratio: 0.97, dataset: 'd', evaluatedAt: 'x' });
    complete.mockResolvedValue(answer('{"action_type":"tests","confidence":0.8}'));
    expect(await classifyTaskAction(env, ambiguous, { tenantId: 9 })).toEqual({ actionType: 'tests', confidence: 0.8 });
    expect(complete.mock.calls[0]![0]).toMatchObject({ model: '@cf/qwen/qwen3-30b-a3b-fp8' });
    expect(captureSpecialistSample).not.toHaveBeenCalled();
  });

  it('never samples a failed classification', async () => {
    resolveSpecialist.mockResolvedValue(null);
    complete.mockResolvedValue(answer('not json'));
    expect(await classifyTaskAction(env, ambiguous)).toEqual({ actionType: 'other', confidence: 0 });
    expect(resolveSpecialist).toHaveBeenCalledWith(env, null, 'task_action_type');
    expect(captureSpecialistSample).not.toHaveBeenCalled();
  });
});
