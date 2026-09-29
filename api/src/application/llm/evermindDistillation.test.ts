import { describe, expect, it, vi, beforeEach } from 'vitest';

// Stub the premium proxy so the teacher is exercised without a real gateway call.
const completeMock = vi.fn();
vi.mock('./LlmProxyService', async (importActual) => ({
  ...(await importActual<typeof import('./LlmProxyService')>()),
  llmProxyForPlan: () => ({ complete: completeMock }),
}));

// No DB in tests: nothing connected, nothing budget-gated.
vi.mock('./tenantProviderKeyService', async (importActual) => ({
  ...(await importActual<typeof import('./tenantProviderKeyService')>()),
  listTenantProviderKeys: async () => [],
  resolveTenantLlmCredentials: async () => ({ anthropicOAuthToken: null, vendorKeys: {} }),
}));

import { distillEvermindEntry, TEACHER_CONTEXT_CHARS, type EvermindAdaptation } from './evermindDistillation';
import type { DistillationStudent } from '@seanhogg/builderforce-memory/distillation';

function gatewayResponse(content: unknown, status = 200, resolvedModel = 'claude-opus-4-8') {
  return {
    response: new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status, headers: { 'content-type': 'application/json' } }),
    resolvedModel,
  };
}

const env = {} as never;
const TENANT = 7;
const RUN_TEXT = 'The agent edited three files and left a TODO in the handler for the retry path.';
const TASK_PROMPT = 'Implement a resilient retry path for the webhook handler with exponential backoff.';
const EXEMPLAR = 'The ideal, expert, fully-worked retry implementation with exponential backoff.';

/** A student that records what it was taught and returns a stand-in diff. */
function recordingStudent(): DistillationStudent<EvermindAdaptation> & { taught: string[] } {
  const taught: string[] = [];
  return {
    taught,
    adapt: async (text) => {
      taught.push(text);
      return { diff: new ArrayBuffer(0), loss: 1, sequences: 1 } as unknown as EvermindAdaptation;
    },
    skippedResult: () => null,
    describe: (r) => ({ epochs: r ? 1 : 0 }),
  };
}

beforeEach(() => completeMock.mockReset());

describe('distillEvermindEntry', () => {
  it('with no teacher, learns the raw run text', async () => {
    const student = recordingStudent();
    const r = await distillEvermindEntry(env, TENANT, { model: null, reason: 'not_pinned' }, student, RUN_TEXT);
    expect(student.taught).toEqual([RUN_TEXT]);
    expect(r).toMatchObject({ distilled: false, skipReason: 'not_pinned' });
    expect(r.exemplar).toBeUndefined();
    expect(completeMock).not.toHaveBeenCalled();
  });

  it('with a teacher + task prompt, learns (task → answer) and surfaces the answer alone', async () => {
    completeMock.mockResolvedValue(gatewayResponse(EXEMPLAR));
    const student = recordingStudent();
    const r = await distillEvermindEntry(env, TENANT, { model: 'claude-opus-4-8' }, student, RUN_TEXT, { prompt: TASK_PROMPT });
    expect(r).toMatchObject({ distilled: true, teacherModel: 'claude-opus-4-8', exemplar: EXEMPLAR });
    // The teacher answers the TASK prompt (answer mode) …
    expect((completeMock.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[1]!.content).toBe(TASK_PROMPT);
    // … and the student learns the pair.
    expect(student.taught).toEqual([`${TASK_PROMPT}\n${EXEMPLAR}`]);
    // Regression guard: "Learned" is the answer, never the question echoed back.
    expect(r.exemplar).not.toContain(TASK_PROMPT);
  });

  it('with a teacher but no prompt, refines the run OUTPUT, capping its context', async () => {
    completeMock.mockResolvedValue(gatewayResponse(EXEMPLAR));
    const student = recordingStudent();
    const longRun = RUN_TEXT.repeat(40);
    await distillEvermindEntry(env, TENANT, { model: 'claude-opus-4-8' }, student, longRun);
    expect((completeMock.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[1]!.content).toBe(longRun);
    expect(student.taught[0]).toBe(`${longRun.trim().slice(0, TEACHER_CONTEXT_CHARS)}\n${EXEMPLAR}`);
  });

  it('falls back to raw text when the teacher call fails, naming the failing model', async () => {
    completeMock.mockResolvedValue(gatewayResponse('nope', 500));
    const student = recordingStudent();
    const r = await distillEvermindEntry(env, TENANT, { model: 'claude-opus-4-8' }, student, RUN_TEXT);
    expect(student.taught).toEqual([RUN_TEXT]);
    expect(r).toMatchObject({
      distilled: false, skipReason: 'gateway_error', attemptedTeacherModel: 'claude-opus-4-8', skipDetail: 'HTTP 500',
    });
    expect(r.exemplar).toBeUndefined();
  });

  it('treats a too-short exemplar as empty_output and still learns the raw text', async () => {
    completeMock.mockResolvedValue(gatewayResponse('ok'));
    const student = recordingStudent();
    const r = await distillEvermindEntry(env, TENANT, { model: 'claude-opus-4-8' }, student, RUN_TEXT);
    expect(student.taught).toEqual([RUN_TEXT]);
    expect(r).toMatchObject({ distilled: false, skipReason: 'empty_output', skipDetail: '2 chars', attemptedTeacherModel: 'claude-opus-4-8' });
  });

  it('passes a null adaptation through (no trainable window)', async () => {
    const student = recordingStudent();
    student.adapt = async () => null;
    const r = await distillEvermindEntry(env, TENANT, { model: null, reason: 'not_pinned' }, student, RUN_TEXT);
    expect(r.adapted).toBeNull();
  });
});
