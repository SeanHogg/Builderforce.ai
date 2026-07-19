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

// Stub BYO credential/provider reads (no DB in tests). Default: nothing connected.
const providerKeysMock = vi.fn();
const credsMock = vi.fn();
vi.mock('./tenantProviderKeyService', () => ({
  listTenantProviderKeys: (...a: unknown[]) => providerKeysMock(...a),
  resolveTenantLlmCredentials: (...a: unknown[]) => credsMock(...a),
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

// Default BYO stubs (nothing connected) — reset before every test.
beforeEach(() => {
  providerKeysMock.mockReset();
  providerKeysMock.mockResolvedValue([]);
  credsMock.mockReset();
  credsMock.mockResolvedValue({ anthropicOAuthToken: null, vendorKeys: {} });
});

describe('generateTeacherExemplar', () => {
  beforeEach(() => completeMock.mockReset());

  it('strict-pins the chosen frontier model and returns its exemplar', async () => {
    completeMock.mockResolvedValue(gatewayResponse('A clean, complete retry handler with backoff.'));
    const r = await generateTeacherExemplar(env, TENANT, 'claude-opus-4-8', RUN_TEXT);
    expect(r).toEqual({ ok: true, exemplar: { model: 'claude-opus-4-8', output: 'A clean, complete retry handler with backoff.' } });
    // The manager's pick must be dispatched as a hard pin (no silent substitution).
    const body = completeMock.mock.calls[0]![0] as { model?: string; modelStrict?: boolean };
    expect(body.model).toBe('claude-opus-4-8');
    expect(body.modelStrict).toBe(true);
  });

  it('uses the ANSWER system prompt in answer mode, REFINE otherwise', async () => {
    completeMock.mockResolvedValue(gatewayResponse('A fully worked, idiomatic implementation of the retry path.'));
    await generateTeacherExemplar(env, TENANT, 'claude-opus-4-8', TASK_PROMPT, 'answer');
    const answerSys = (completeMock.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[0]!.content;
    expect(answerSys).toContain('coding task or ticket');

    completeMock.mockClear();
    await generateTeacherExemplar(env, TENANT, 'claude-opus-4-8', RUN_TEXT, 'refine');
    const refineSys = (completeMock.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[0]!.content;
    expect(refineSys).toContain('raw output of an autonomous coding-agent run');
  });

  it('reports the model the gateway actually resolved', async () => {
    completeMock.mockResolvedValue(gatewayResponse('A fully worked, idiomatic implementation of the retry path.', 200, 'mistral-large'));
    const r = await generateTeacherExemplar(env, TENANT, 'mistral-large', RUN_TEXT);
    expect(r.ok && r.exemplar.model).toBe('mistral-large');
  });

  // Every failure must name its CAUSE rather than collapse to a bare null — a silently
  // skipped teacher is exactly how a broken teacher mode stayed invisible in the console.
  it('reports gateway_error (with the status) on a gateway error', async () => {
    completeMock.mockResolvedValue(gatewayResponse('nope', 503));
    const r = await generateTeacherExemplar(env, TENANT, 'claude-opus-4-8', RUN_TEXT);
    expect(r).toEqual({ ok: false, reason: 'gateway_error', detail: 'HTTP 503' });
  });

  it('reports empty_output on a too-short exemplar (not a teaching signal)', async () => {
    completeMock.mockResolvedValue(gatewayResponse('ok'));
    const r = await generateTeacherExemplar(env, TENANT, 'claude-opus-4-8', RUN_TEXT);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('empty_output');
  });

  it('reports input_too_short when the model is empty or the input is trivial', async () => {
    expect(await generateTeacherExemplar(env, TENANT, '', RUN_TEXT)).toEqual({ ok: false, reason: 'input_too_short' });
    expect(await generateTeacherExemplar(env, TENANT, 'claude-opus-4-8', 'short')).toEqual({ ok: false, reason: 'input_too_short' });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it('reports exception on a malformed gateway result (never throws)', async () => {
    completeMock.mockResolvedValue({});
    const r = await generateTeacherExemplar(env, TENANT, 'claude-opus-4-8', RUN_TEXT);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('exception');
  });
});

describe('buildEvermindTrainingText', () => {
  beforeEach(() => completeMock.mockReset());

  it('with no teacher, returns raw run text unchanged', async () => {
    const r = await buildEvermindTrainingText(env, TENANT, { model: null, reason: 'not_pinned' }, RUN_TEXT);
    expect(r).toEqual({ text: RUN_TEXT, distilled: false, skipReason: 'not_pinned' });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it('with a teacher + task prompt, distils (task → answer) via answer mode', async () => {
    completeMock.mockResolvedValue(gatewayResponse('The ideal, expert, fully-worked retry implementation.'));
    const r = await buildEvermindTrainingText(env, TENANT, { model: 'claude-opus-4-8' }, RUN_TEXT, { prompt: TASK_PROMPT });
    expect(r.distilled).toBe(true);
    expect(r.teacherModel).toBe('claude-opus-4-8');
    // The teacher answers the TASK prompt (answer mode), and the training text pairs it.
    expect((completeMock.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[1]!.content).toBe(TASK_PROMPT);
    expect(r.text.startsWith(TASK_PROMPT.slice(0, 20))).toBe(true);
    expect(r.text).toContain('The ideal, expert, fully-worked retry implementation.');
    // The exemplar (teacher's ANSWER alone, no task prefix) is surfaced so the console's
    // "Learned" shows the answer — not the question echoed back. Regression guard for the
    // teach-a-task bug where text === prompt === the task.
    expect(r.exemplar).toBe('The ideal, expert, fully-worked retry implementation.');
    expect(r.exemplar).not.toContain(TASK_PROMPT);
  });

  it('leaves exemplar undefined when the teacher is skipped (no answer to surface)', async () => {
    const noTeacher = await buildEvermindTrainingText(env, TENANT, { model: null, reason: 'not_pinned' }, RUN_TEXT);
    expect(noTeacher.exemplar).toBeUndefined();
    completeMock.mockResolvedValue(gatewayResponse('too short', 500));
    const failed = await buildEvermindTrainingText(env, TENANT, { model: 'claude-opus-4-8' }, RUN_TEXT);
    expect(failed.exemplar).toBeUndefined();
  });

  it('with a teacher but no prompt, refines the run OUTPUT', async () => {
    completeMock.mockResolvedValue(gatewayResponse('The ideal, expert version of this task output text.'));
    const r = await buildEvermindTrainingText(env, TENANT, { model: 'claude-opus-4-8' }, RUN_TEXT);
    expect(r.distilled).toBe(true);
    expect((completeMock.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[1]!.content).toBe(RUN_TEXT);
    expect(r.text.startsWith(RUN_TEXT.slice(0, 20))).toBe(true);
  });

  it('falls back to raw text when the teacher call fails (contribution never lost)', async () => {
    completeMock.mockResolvedValue(gatewayResponse('too short', 500));
    const r = await buildEvermindTrainingText(env, TENANT, { model: 'claude-opus-4-8' }, RUN_TEXT);
    // The FAILING model is carried so the console can NAME it rather than only saying
    // "not distilled" — the difference between a diagnosable and an invisible fault.
    expect(r).toEqual({
      text: RUN_TEXT, distilled: false, skipReason: 'gateway_error',
      attemptedTeacherModel: 'claude-opus-4-8', skipDetail: 'HTTP 500',
    });
  });
});

describe('resolveEvermindTeacherModel (once-per-alarm budget gate)', () => {
  beforeEach(() => {
    availabilityMock.mockReset();
    availabilityMock.mockResolvedValue({ hasTokens: true });
  });

  it('returns null (no scan) when no teacher is pinned', async () => {
    expect(await resolveEvermindTeacherModel(env, db, TENANT, null)).toEqual({ model: null, reason: 'not_pinned' });
    expect(await resolveEvermindTeacherModel(env, db, TENANT, '   ')).toEqual({ model: null, reason: 'not_pinned' });
    expect(availabilityMock).not.toHaveBeenCalled();
  });

  it('returns the model when the tenant has token budget', async () => {
    expect(await resolveEvermindTeacherModel(env, db, TENANT, 'claude-opus-4-8')).toEqual({ model: 'claude-opus-4-8' });
  });

  it('returns null when the tenant is out of token budget', async () => {
    availabilityMock.mockResolvedValue({ hasTokens: false, reason: 'daily_exhausted' });
    // Distinct from 'not_pinned': a pinned teacher blocked by budget is a different fix.
    expect(await resolveEvermindTeacherModel(env, db, TENANT, 'claude-opus-4-8')).toEqual({ model: null, reason: 'budget_exhausted' });
  });

  it('BYPASSES the our-pool budget gate when the tenant has a connected BYO account', async () => {
    // Their own account funds the teacher, so an exhausted platform budget must not
    // disable distillation — and the token scan is never even run.
    availabilityMock.mockResolvedValue({ hasTokens: false, reason: 'daily_exhausted' });
    providerKeysMock.mockResolvedValue([{ provider: 'anthropic', authType: 'oauth' }]);
    expect(await resolveEvermindTeacherModel(env, db, TENANT, 'claude-opus-4-8')).toEqual({ model: 'claude-opus-4-8' });
    expect(availabilityMock).not.toHaveBeenCalled();
  });

  it('fails OPEN (keeps the teacher) when the token scan throws', async () => {
    availabilityMock.mockRejectedValue(new Error('db down'));
    expect(await resolveEvermindTeacherModel(env, db, TENANT, 'claude-opus-4-8')).toEqual({ model: 'claude-opus-4-8' });
  });
});
