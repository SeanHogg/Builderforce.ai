/**
 * Body validation on the OpenAI-compatible gateway (`llmRoutes.schemas.ts`).
 *
 * Two promises, both load-bearing for third-party SDKs:
 *   1. a malformed body is a 400 in the endpoint's OWN `{ error }` envelope, with the
 *      sentence it has always answered — never a TypeError 500;
 *   2. a well-formed body is NOT narrowed: every field the gateway does not read
 *      (tools, tool_choice, response_format, temperature, vendor extras, rich message
 *      parts) reaches the upstream call untouched.
 *
 * Mocking mirrors llmRoutes.test.ts: a bfk_* key resolves through a canned Drizzle
 * chain, and `llmProxyForPlan` is replaced so the "upstream call" is a spy.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { TenantLlmCredentials } from '../../application/llm/tenantProviderKeyService';

const mocks = vi.hoisted(() => ({
  hashSecret: vi.fn(),
  buildDatabase: vi.fn(),
  llmProxyForPlan: vi.fn(),
  resolveTenantLlmCredentials: vi.fn<() => Promise<TenantLlmCredentials>>(),
}));

vi.mock('../../infrastructure/auth/HashService', () => ({
  hashSecret: mocks.hashSecret,
  generateApiKey: vi.fn(() => 'bfk_test'),
}));
vi.mock('../../infrastructure/auth/JwtService', () => ({
  verifyJwt: vi.fn(),
  signJwt: vi.fn(),
}));
vi.mock('../../infrastructure/database/connection', () => ({
  buildDatabase: mocks.buildDatabase,
  buildTransactionalDatabase: (...args: unknown[]) => mocks.buildDatabase(...args),
}));
vi.mock('../../application/llm/LlmProxyService', async (orig) => ({
  ...(await orig<typeof import('../../application/llm/LlmProxyService')>()),
  llmProxyForPlan: mocks.llmProxyForPlan,
}));
vi.mock('../../application/llm/tenantProviderKeyService', async (orig) => ({
  ...(await orig<typeof import('../../application/llm/tenantProviderKeyService')>()),
  resolveAnthropicOAuthToken: async () => null,
  resolveTenantLlmCredentials: mocks.resolveTenantLlmCredentials,
  resolveAnthropicResolution: vi.fn(async () => ({ auth: null })),
}));

const { createLlmRoutes } = await import('./llmRoutes');

/** Drizzle-shaped chain: `.limit(1)` pops the key row then the tenant row; a bare
 *  awaited `.where()` is the token-usage sum. Same shape as llmRoutes.test.ts. */
function mockDb() {
  const queue: unknown[][] = [
    [{ id: 'kid', tenantId: 1, revokedAt: null, allowedOrigins: null }],
    [{ id: 1, plan: 'free', billingStatus: 'none', tokenDailyLimitOverride: null }],
  ];
  const select = vi.fn(() => ({
    from: () => {
      const where = () => ({
        limit: () => Promise.resolve(queue.shift() ?? []),
        orderBy: () => ({ limit: () => Promise.resolve([]) }),
        then: (resolve: (v: unknown) => unknown) => resolve([{ used: 0 }]),
      });
      const chain = { leftJoin: () => chain, innerJoin: () => chain, where };
      return chain;
    },
  }));
  const settled = {
    catch: (_h: unknown) => Promise.resolve(),
    then: (r: (v: unknown) => unknown) => Promise.resolve(r(undefined)),
  };
  const update = vi.fn(() => ({ set: () => ({ where: () => settled }) }));
  const insert = vi.fn(() => ({ values: () => ({ ...settled, returning: () => Promise.resolve([]) }) }));
  return { select, update, insert } as unknown;
}

const env = { JWT_SECRET: 'test', NEON_DATABASE_URL: 'x' } as Record<string, unknown>;
const executionCtx = {
  waitUntil: (_p: Promise<unknown>) => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

function post(path: string, body: string, extraEnv: Record<string, unknown> = {}) {
  const req = new Request(`http://test.local${path}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer bfk_test', 'Content-Type': 'application/json' },
    body,
  });
  return createLlmRoutes().request(req, {}, { ...env, ...extraEnv }, executionCtx);
}

/** The spy standing in for the vendor call; records the request body it was handed. */
function upstreamSpy() {
  const complete = vi.fn(async (_body: Record<string, unknown>) => ({
    response: new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }),
    resolvedModel: 'direct/kimi-code/kimi-for-coding',
    resolvedVendor: 'kimi-code',
    failovers: [],
    retries: 0,
  }));
  mocks.llmProxyForPlan.mockReturnValue({ complete });
  return complete;
}

beforeEach(() => {
  mocks.hashSecret.mockReset();
  mocks.buildDatabase.mockReset();
  mocks.llmProxyForPlan.mockReset();
  mocks.hashSecret.mockResolvedValue('hash_of_bfk_test');
  mocks.buildDatabase.mockReturnValue(mockDb());
  // A connected Kimi key: the one tenant setup llmRoutes.test.ts proves reaches a 200.
  mocks.resolveTenantLlmCredentials.mockResolvedValue({
    anthropicOAuthToken: null, openaiCodexAuth: null, xaiOAuthToken: null,
    vendorKeys: { kimi: 'sk-kimi-code' }, configuredProviders: ['kimi'],
    unresolvedReasons: {}, vendorPriority: ['kimi'],
  });
});

describe('POST /v1/chat/completions — malformed bodies stay in the gateway envelope', () => {
  it('answers a non-JSON body with 400 "messages array is required", not a 500', async () => {
    const complete = upstreamSpy();
    const res = await post('/v1/chat/completions', '{not json');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'messages array is required', code: 'invalid_request' });
    expect(complete).not.toHaveBeenCalled();
  });

  it('answers `messages` that is not an array with the same sentence', async () => {
    const complete = upstreamSpy();
    const res = await post('/v1/chat/completions', JSON.stringify({ messages: 'hi' }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; issues: Array<{ path: string }> };
    expect(body.error).toBe('messages array is required');
    expect(body.issues[0]?.path).toBe('messages');
    expect(complete).not.toHaveBeenCalled();
  });

  it('names the element when a message is not an object', async () => {
    upstreamSpy();
    const res = await post('/v1/chat/completions', JSON.stringify({ messages: ['hi'] }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; issues: Array<{ path: string }> };
    expect(body.issues[0]?.path).toBe('messages.0');
    expect(body.error).toMatch(/messages\.0/);
  });

  it('keeps the handler\'s own answer for an empty list', async () => {
    upstreamSpy();
    const res = await post('/v1/chat/completions', JSON.stringify({ messages: [] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'messages array is required' });
  });
});

describe('POST /v1/chat/completions — a well-formed body is passed through untouched', () => {
  it('forwards every field it does not read to the upstream call', async () => {
    const complete = upstreamSpy();
    const tools = [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: {} } } }];
    const res = await post('/v1/chat/completions', JSON.stringify({
      model: 'direct/kimi-code/kimi-for-coding',
      modelStrict: true,
      messages: [
        { role: 'system', content: 'be brief' },
        // Rich content parts + an unknown per-message key must survive too.
        { role: 'user', content: [{ type: 'text', text: 'hi' }], name: 'sam', x_message_extra: 1 },
      ],
      tools,
      tool_choice: 'auto',
      response_format: { type: 'json_object' },
      temperature: 0.2,
      stream: false,
      x_vendor_extra: { nested: true },
    }));

    expect(res.status).toBe(200);
    expect(complete).toHaveBeenCalledTimes(1);
    const forwarded = complete.mock.calls[0]![0];
    expect(forwarded).toMatchObject({
      tools,
      tool_choice: 'auto',
      response_format: { type: 'json_object' },
      temperature: 0.2,
      x_vendor_extra: { nested: true },
    });
    expect(forwarded.messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: [{ type: 'text', text: 'hi' }], name: 'sam', x_message_extra: 1 },
    ]);
  });
});

describe('POST /v1/embeddings — malformed input keeps its own sentence', () => {
  it('answers a non-string `input` with 400 in the `{ error }` envelope', async () => {
    const res = await post('/v1/embeddings', JSON.stringify({ input: 5 }), { OPENROUTER_API_KEY: 'or-test' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: '`input` must be a string or array of strings' });
  });
});
