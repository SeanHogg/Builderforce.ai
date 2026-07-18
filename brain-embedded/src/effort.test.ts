/**
 * The composer's Effort + Thinking controls must produce a MEASURABLY different
 * outgoing request — that was the whole bug: both were prose-only, so toggling
 * them changed nothing on the wire.
 *
 * These tests assert on the actual serialized request body. They deliberately
 * assert ONLY the vendor-neutral `reasoning.level` intent: mapping that to
 * Anthropic `thinking` vs OpenAI `reasoning_effort` is the gateway's job (see
 * `reasoningCapability.ts`), because the client usually doesn't know which model
 * will serve the turn.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamChatCompletion, type BrainTransport } from './streamChatCompletion';
import { effortProfile, isEffort, reasoningForRun, type Effort } from './effort';

/** Build a Response whose body streams the given SSE lines. */
function sseResponse(lines: string[], init?: ResponseInit): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const l of lines) controller.enqueue(enc.encode(l));
      controller.close();
    },
  });
  return new Response(body, { status: 200, ...init });
}

const baseTransport: BrainTransport = {
  baseUrl: 'https://gw.example',
  getToken: () => 'tok_123',
};

afterEach(() => vi.restoreAllMocks());

/** Run one completion through a fetch mock and return the parsed request body. */
async function bodyFor(opts: { effort: Effort; thinking: boolean }): Promise<Record<string, unknown>> {
  const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n']));
  vi.stubGlobal('fetch', fetchMock);
  await streamChatCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    transport: baseTransport,
    maxTokens: effortProfile(opts.effort).maxTokens,
    reasoning: reasoningForRun(opts),
  });
  return JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as Record<string, unknown>;
}

describe('effort → request params', () => {
  it('drives max_tokens from the effort level (was a hardcoded 4096 for every turn)', async () => {
    const quick = await bodyFor({ effort: 'quick', thinking: false });
    const balanced = await bodyFor({ effort: 'balanced', thinking: false });
    const thorough = await bodyFor({ effort: 'thorough', thinking: false });

    expect(quick.max_tokens).toBe(2048);
    expect(balanced.max_tokens).toBe(4096);
    expect(thorough.max_tokens).toBe(16384);
    // The three levels are genuinely distinct — not three names for one budget.
    expect(new Set([quick.max_tokens, balanced.max_tokens, thorough.max_tokens]).size).toBe(3);
  });

  it('keeps balanced + thinking-off byte-identical to a pre-feature request', async () => {
    const body = await bodyFor({ effort: 'balanced', thinking: false });
    expect(body.max_tokens).toBe(4096);
    expect(body).not.toHaveProperty('reasoning');
  });
});

describe('thinking toggle → wire body', () => {
  it('OMITS the reasoning field entirely when thinking is off', async () => {
    for (const effort of ['quick', 'balanced', 'thorough'] as const) {
      const body = await bodyFor({ effort, thinking: false });
      expect(body).not.toHaveProperty('reasoning');
    }
  });

  it('EMITS reasoning.level when thinking is on, scaled by effort', async () => {
    expect((await bodyFor({ effort: 'quick', thinking: true })).reasoning).toEqual({ level: 'low' });
    expect((await bodyFor({ effort: 'balanced', thinking: true })).reasoning).toEqual({ level: 'medium' });
    expect((await bodyFor({ effort: 'thorough', thinking: true })).reasoning).toEqual({ level: 'high' });
  });

  it('composes both controls on one request', async () => {
    const body = await bodyFor({ effort: 'thorough', thinking: true });
    expect(body).toMatchObject({ max_tokens: 16384, reasoning: { level: 'high' } });
  });

  it('never emits a VENDOR-specific reasoning param (the server owns that mapping)', async () => {
    const body = await bodyFor({ effort: 'thorough', thinking: true });
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('drops an explicit off level rather than sending it', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n']));
    vi.stubGlobal('fetch', fetchMock);
    await streamChatCompletion({ messages: [], transport: baseTransport, reasoning: { level: 'off' } });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).not.toHaveProperty('reasoning');
  });
});

describe('effort profile table', () => {
  it('mirrors the gateway registry thinking budgets (low/medium/high)', () => {
    expect(effortProfile('quick').thinkingBudgetTokens).toBe(2048);
    expect(effortProfile('balanced').thinkingBudgetTokens).toBe(8192);
    expect(effortProfile('thorough').thinkingBudgetTokens).toBe(16384);
  });

  it('falls back to balanced for an unknown/absent level', () => {
    expect(effortProfile(undefined).effort).toBe('balanced');
    expect(effortProfile('nonsense' as Effort).effort).toBe('balanced');
  });

  it('guards a persisted value with isEffort', () => {
    expect(isEffort('quick')).toBe(true);
    expect(isEffort('thorough')).toBe(true);
    expect(isEffort('turbo')).toBe(false);
    expect(isEffort(null)).toBe(false);
  });

  it('gives balanced no prose nudge (the neutral default) but the others one', () => {
    expect(effortProfile('balanced').directive).toBe('');
    expect(effortProfile('quick').directive).toContain('Effort:');
    expect(effortProfile('thorough').directive).toContain('Effort:');
  });

  it('reasoningForRun returns undefined when thinking is off', () => {
    expect(reasoningForRun({ effort: 'thorough', thinking: false })).toBeUndefined();
    expect(reasoningForRun({ effort: 'quick', thinking: true })).toEqual({ level: 'low' });
  });
});
