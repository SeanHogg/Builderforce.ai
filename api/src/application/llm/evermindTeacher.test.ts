import { describe, expect, it, vi, beforeEach } from 'vitest';

// Stub the premium proxy so the teacher is exercised without a real gateway call.
// Spread the ACTUAL module so real exports (readProxyChoice) keep working — only the
// proxy factory is overridden.
const completeMock = vi.fn();
vi.mock('./LlmProxyService', async (importActual) => ({
  ...(await importActual<typeof import('./LlmProxyService')>()),
  llmProxyForPlan: () => ({ complete: completeMock }),
}));

// Stub the token-availability gate so distillation cost-gating is deterministic.
const availabilityMock = vi.fn();
vi.mock('./tenantTokenAvailability', () => ({
  getTenantTokenAvailability: (...args: unknown[]) => availabilityMock(...args),
}));

import { generateTeacherExemplar, buildEvermindTrainingText, resolveEvermindTeacherModel } from './evermindTeacher';

/** Build a minimal ProxyResult-shaped object with a chat-completion JSON body.
 *  Uses a REAL Response so `readProxyChoice`'s `.clone().json()` works as in production. */
function gatewayResponse(content: unknown, status = 200, resolvedModel = 'claude-opus-4-8') {
  return {
    response: new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status, headers: { 'content-type': 'application/json' } }),
    resolvedModel,
  };
}

const env = {} as never;
const db = {} as never;
const TENANT = 7;
const RUN_TEXT = 'The agent edited three files and left a TODO in the handler for the retry path.';
const TASK_PROMPT = 'Implement a resilient retry path for the webhook handler with exponential backoff.';

describe('generateTeacherExemplar', () => {
  beforeEach(() => completeMock.mockReset());

  it('strict-pins the chosen frontier model and returns its exemplar', async () => {
    completeMock.mockResolvedValue(gatewayResponse('A clean, complete retry handler with backoff.'));
    const r = await generateTeacherExemplar(env, 'claude-opus-4-8', RUN_TEXT);
    expect(r).toEqual({ model: 'claude-opus-4-8', output: 'A clean, complete retry handler with backoff.' });
    // The manager's pick must be dispatched as a hard pin (no silent substitution).
    const body = completeMock.mock.calls[0]![0] as { model?: string; modelStrict?: boolean };
    expect(body.model).toBe('claude-opus-4-8');
    expect(body.modelStrict).toBe(true);
  });

  it('uses the ANSWER system prompt in answer mode, REFINE otherwise', async () => {
    completeMock.mockResolvedValue(gatewayResponse('A fully worked, idiomatic implementation of the retry path.'));
    await generateTeacherExemplar(env, 'claude-opus-4-8', TASK_PROMPT, 'answer');
    const answerSys = (completeMock.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[0]!.content;
    expect(answerSys).toContain('coding task or ticket');

    completeMock.mockClear();
    await generateTeacherExemplar(env, 'claude-opus-4-8', RUN_TEXT, 'refine');
    const refineSys = (completeMock.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[0]!.content;
    expect(refineSys).toContain('raw output of an autonomous coding-agent run');
  });

  it('reports the model the gateway actually resolved', async () => {
    completeMock.mockResolvedValue(gatewayResponse('A fully worked, idiomatic implementation of the retry path.', 200, 'mistral-large'));
    const r = await generateTeacherExemplar(env, 'mistral-large', RUN_TEXT);
    expect(r?.model).toBe('mistral-large');
  });

  it('returns null on a gateway error status (best-effort — never throws)', async () => {
    completeMock.mockResolvedValue(gatewayResponse('nope', 503));
    expect(await generateTeacherExemplar(env, 'claude-opus-4-8', RUN_TEXT)).toBeNull();
  });

  it('returns null on a too-short exemplar (not a teaching signal)', async () => {
    completeMock.mockResolvedValue(gatewayResponse('ok'));
    expect(await generateTeacherExemplar(env, 'claude-opus-4-8', RUN_TEXT)).toBeNull();
  });

  it('returns null when the teacher model is empty or the input is trivial', async () => {
    expect(await generateTeacherExemplar(env, '', RUN_TEXT)).toBeNull();
    expect(await generateTeacherExemplar(env, 'claude-opus-4-8', 'short')).toBeNull();
    expect(completeMock).not.toHaveBeenCalled();
  });

  it('swallows a malformed gateway result and returns null (never throws)', async () => {
    completeMock.mockResolvedValue({});
    expect(await generateTeacherExemplar(env, 'claude-opus-4-8', RUN_TEXT)).toBeNull();
  });
});

describe('buildEvermindTrainingText', () => {
  beforeEach(() => completeMock.mockReset());

  it('with no teacher, returns raw run text unchanged', async () => {
    const r = await buildEvermindTrainingText(env, null, RUN_TEXT);
    expect(r).toEqual({ text: RUN_TEXT, distilled: false, skipReason: 'no_teacher' });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it('with a teacher + task prompt, distils (task → answer) via answer mode', async () => {
    completeMock.mockResolvedValue(gatewayResponse('The ideal, expert, fully-worked retry implementation.'));
    const r = await buildEvermindTrainingText(env, 'claude-opus-4-8', RUN_TEXT, { prompt: TASK_PROMPT });
    expect(r.distilled).toBe(true);
    expect(r.teacherModel).toBe('claude-opus-4-8');
    // The teacher answers the TASK prompt (answer mode), and the training text pairs it.
    expect((completeMock.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[1]!.content).toBe(TASK_PROMPT);
    expect(r.text.startsWith(TASK_PROMPT.slice(0, 20))).toBe(true);
    expect(r.text).toContain('The ideal, expert, fully-worked retry implementation.');
  });

  it('with a teacher but no prompt, refines the run OUTPUT', async () => {
    completeMock.mockResolvedValue(gatewayResponse('The ideal, expert version of this task output text.'));
    const r = await buildEvermindTrainingText(env, 'claude-opus-4-8', RUN_TEXT);
    expect(r.distilled).toBe(true);
    expect((completeMock.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[1]!.content).toBe(RUN_TEXT);
    expect(r.text.startsWith(RUN_TEXT.slice(0, 20))).toBe(true);
  });

  it('falls back to raw text when the teacher call fails (contribution never lost)', async () => {
    completeMock.mockResolvedValue(gatewayResponse('too short', 500));
    const r = await buildEvermindTrainingText(env, 'claude-opus-4-8', RUN_TEXT);
    expect(r).toEqual({ text: RUN_TEXT, distilled: false, skipReason: 'teacher_failed' });
  });
});

describe('resolveEvermindTeacherModel (once-per-alarm budget gate)', () => {
  beforeEach(() => {
    availabilityMock.mockReset();
    availabilityMock.mockResolvedValue({ hasTokens: true });
  });

  it('returns null (no scan) when no teacher is pinned', async () => {
    expect(await resolveEvermindTeacherModel(db, TENANT, null)).toBeNull();
    expect(await resolveEvermindTeacherModel(db, TENANT, '   ')).toBeNull();
    expect(availabilityMock).not.toHaveBeenCalled();
  });

  it('returns the model when the tenant has token budget', async () => {
    expect(await resolveEvermindTeacherModel(db, TENANT, 'claude-opus-4-8')).toBe('claude-opus-4-8');
  });

  it('returns null when the tenant is out of token budget', async () => {
    availabilityMock.mockResolvedValue({ hasTokens: false, reason: 'daily_exhausted' });
    expect(await resolveEvermindTeacherModel(db, TENANT, 'claude-opus-4-8')).toBeNull();
  });

  it('fails OPEN (keeps the teacher) when the token scan throws', async () => {
    availabilityMock.mockRejectedValue(new Error('db down'));
    expect(await resolveEvermindTeacherModel(db, TENANT, 'claude-opus-4-8')).toBe('claude-opus-4-8');
  });
});
