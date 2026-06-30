import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Context } from 'hono';
import type { HonoEnv } from '../../env';

// Hoisted mocks — vi.mock must declare the spies via vi.hoisted so the
// factory closures see them.
const mocks = vi.hoisted(() => ({
  hashSecret: vi.fn(),
  verifyJwt:  vi.fn(),
  signJwt:    vi.fn(),
  buildDatabase: vi.fn(),
  llmProxyForPlan: vi.fn(),
}));

vi.mock('../../infrastructure/auth/HashService', () => ({
  hashSecret: mocks.hashSecret,
  generateApiKey: vi.fn(() => 'bfk_test'),
}));
vi.mock('../../infrastructure/auth/JwtService', () => ({
  verifyJwt: mocks.verifyJwt,
  signJwt: mocks.signJwt,
}));
vi.mock('../../infrastructure/database/connection', () => ({ buildDatabase: mocks.buildDatabase }));
// Partial mock — keep every real LlmProxyService export (ChatCompletionRequest,
// reorderPoolByShape, modelPoolForPlan, …) and override only the network call.
vi.mock('../../application/llm/LlmProxyService', async (orig) => ({
  ...(await orig<typeof import('../../application/llm/LlmProxyService')>()),
  llmProxyForPlan: mocks.llmProxyForPlan,
}));

// Imports must follow the vi.mock calls above so the mocks are in place.
const { requireTenantAccess } = await import('./llmRoutes');
const { sanitizeToolName, restoreToolName, sanitizeToolCallId, sanitizeRequestToolCalls, restoreResponseToolNames, StreamingToolNameRestorer } =
  await import('../../application/llm/toolNameSanitizer');

// ---------------------------------------------------------------------------
// Tool-call sanitizer — one gateway-side pass that makes tool NAMES (reversible
// dot escape, restored on the response path) and tool-call IDs (deterministic
// rewrite, never restored) safe for vendors that reject dots / non-`[A-Za-z0-9_-]`
// ids (Anthropic).
// ---------------------------------------------------------------------------

describe('toolCallSanitizer', () => {
  it('escapes dots and restores them losslessly', () => {
    const cases = ['governance.snapshot', 'agile.kanban.list', 'no_dots', 'a.b.c.d'];
    for (const original of cases) {
      const sanitized = sanitizeToolName(original);
      expect(sanitized).not.toMatch(/\./);
      expect(restoreToolName(sanitized)).toBe(original);
    }
  });

  it('round-trips a name that already contains the sentinel', () => {
    const original = 'foo__DOT__bar.baz';
    expect(restoreToolName(sanitizeToolName(original))).toBe(original);
  });

  it('walks tools, tool_choice, message tool_calls, and tool messages on request', () => {
    const body = {
      tools: [{ type: 'function', function: { name: 'governance.snapshot' } }],
      tool_choice: { type: 'function', function: { name: 'agile.kanban.list' } },
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'governance.snapshot', arguments: '{}' } }],
        },
        { role: 'tool', name: 'governance.snapshot', tool_call_id: 'c1', content: '{}' },
      ],
    };
    const out = sanitizeRequestToolCalls(body) as typeof body;
    expect(out.tools[0]!.function.name).not.toMatch(/\./);
    expect((out.tool_choice.function as { name: string }).name).not.toMatch(/\./);
    expect((out.messages[1]!.tool_calls as Array<{ function: { name: string } }>)[0]!.function.name).not.toMatch(/\./);
    expect((out.messages[2] as { name: string }).name).not.toMatch(/\./);
  });

  it('rewrites foreign tool-call ids to Anthropic\'s charset, keeping use↔result paired', () => {
    // A non-Anthropic provider minted an id with ':' and '/'. When the cascade
    // later fails over into Anthropic, the id must already match ^[a-zA-Z0-9_-]+$
    // AND the assistant tool_call id must still equal the tool result's tool_call_id.
    const foreignId = 'call_abc:123/xyz';
    const body = {
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: foreignId, type: 'function', function: { name: 'search', arguments: '{}' } }],
        },
        { role: 'tool', tool_call_id: foreignId, content: '{}' },
      ],
    };
    const out = sanitizeRequestToolCalls(body) as typeof body;
    const useId = (out.messages[0]!.tool_calls as Array<{ id: string }>)[0]!.id;
    const resultId = (out.messages[1] as { tool_call_id: string }).tool_call_id;
    expect(useId).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(resultId).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(useId).toBe(resultId); // deterministic → still paired
  });

  it('leaves already-valid tool-call ids untouched (idempotent across failover turns)', () => {
    for (const id of ['c1', 'toolu_01ABC', 'call-9_x']) {
      expect(sanitizeToolCallId(id)).toBe(id);
    }
    // Distinct foreign ids that collapse to the same characters do not collide.
    expect(sanitizeToolCallId('a:b')).not.toBe(sanitizeToolCallId('a/b'));
    // Deterministic: same input → same output (pairing guarantee).
    expect(sanitizeToolCallId('x.y:z')).toBe(sanitizeToolCallId('x.y:z'));
  });

  it('restores tool_calls names in the response', () => {
    const raw = {
      choices: [{
        message: {
          role: 'assistant',
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'governance__DOT__snapshot', arguments: '{}' } }],
        },
      }],
    };
    const restored = restoreResponseToolNames(raw) as typeof raw;
    expect(restored.choices[0]!.message.tool_calls[0]!.function.name).toBe('governance.snapshot');
  });

  describe('StreamingToolNameRestorer', () => {
    type Delta = {
      choices: Array<{
        index?: number;
        delta: { tool_calls?: Array<{ index: number; function?: { name?: string; arguments?: string } }> };
      }>;
    };
    // Feed the restorer a sequence of name fragments and reassemble the emitted tail.
    const drive = (fragments: string[]): string => {
      const r = new StreamingToolNameRestorer();
      let out = '';
      for (const frag of fragments) {
        const chunk: Delta = {
          choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: frag } }] } }],
        };
        r.restoreChunk(chunk as unknown as Record<string, unknown>);
        out += chunk.choices[0]!.delta.tool_calls![0]!.function!.name ?? '';
      }
      return out;
    };

    it('restores a name delivered in a single delta', () => {
      expect(drive([sanitizeToolName('governance.snapshot')])).toBe('governance.snapshot');
    });

    it('restores a name fragmented across multiple deltas', () => {
      // 'agile.kanban.list' → 'agile__DOT__kanban__DOT__list', split mid-token.
      const sanitized = sanitizeToolName('agile.kanban.list');
      const fragments = [
        sanitized.slice(0, 4),
        sanitized.slice(4, 9),
        sanitized.slice(9, 18),
        sanitized.slice(18),
      ];
      expect(drive(fragments)).toBe('agile.kanban.list');
    });

    it('restores when a sentinel is split across the fragment boundary', () => {
      const sanitized = sanitizeToolName('a.b'); // a__DOT__b
      const cut = sanitized.indexOf('__DOT__') + 3; // split inside the sentinel
      expect(drive([sanitized.slice(0, cut), sanitized.slice(cut)])).toBe('a.b');
    });

    it('tracks two concurrent tool calls by index independently', () => {
      const r = new StreamingToolNameRestorer();
      const chunk = {
        choices: [{
          index: 0,
          delta: {
            tool_calls: [
              { index: 0, function: { name: sanitizeToolName('governance.snapshot') } },
              { index: 1, function: { name: sanitizeToolName('agile.kanban.list') } },
            ],
          },
        }],
      };
      r.restoreChunk(chunk as unknown as Record<string, unknown>);
      const tcs = chunk.choices[0]!.delta.tool_calls!;
      expect(tcs[0]!.function.name).toBe('governance.snapshot');
      expect(tcs[1]!.function.name).toBe('agile.kanban.list');
    });

    it('leaves argument-only deltas (no name) untouched', () => {
      const r = new StreamingToolNameRestorer();
      const chunk = {
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"x":1}' } }] } }],
      };
      r.restoreChunk(chunk as unknown as Record<string, unknown>);
      expect(chunk.choices[0]!.delta.tool_calls![0]!.function).toEqual({ arguments: '{"x":1}' });
    });
  });
});

// ---------------------------------------------------------------------------
// requireTenantAccess — bfk_* tenant API key path
// ---------------------------------------------------------------------------

type TenantApiKeyRow = {
  id: string;
  tenantId: number;
  revokedAt: Date | null;
  allowedOrigins?: string | null;
};
type TenantRow = {
  id: number;
  plan: 'free' | 'pro' | 'teams';
  billingStatus: string;
  tokenDailyLimitOverride?: number | null;
  premiumOverride?: boolean;
};

function mockDb(opts: {
  keyRow?:    TenantApiKeyRow;
  tenantRow?: TenantRow;
  /** Reply for the token-sum query (awaited directly on `.where()`). `used` feeds
   *  the single-window sum (sumTenantTextTokens); `day`/`month` feed the combined
   *  day+month scan (sumTenantTextTokensDayAndMonth) used when a monthly cap is
   *  active. */
  usageRow?:  { used?: bigint | number | null; day?: number; month?: number };
}) {
  // Drizzle-style chainable selects: each terminal `.limit(1)` resolves
  // with `[row]`. Two distinct lookups happen in the bfk_* path: the key
  // row, then the tenant row. We hand back an iterator of canned results.
  const queue: unknown[][] = [];
  if (opts.keyRow !== undefined) queue.push([opts.keyRow]);
  if (opts.tenantRow !== undefined) queue.push([opts.tenantRow]);

  const usageRow = opts.usageRow;

  const select = vi.fn(() => ({
    from: () => {
      // `.where()` is awaited directly for the daily-token sum (no `.limit()`),
      // so it must be both thenable AND have a `.limit()` for key/tenant lookups
      // that chain `.limit(1)`. The bfk_* key lookup also `.leftJoin(users)`s to
      // carry the creator's superadmin flag, so the chain must support leftJoin.
      const where = () => ({
        limit: () => Promise.resolve(queue.shift() ?? []),
        then:  (resolve: (v: unknown) => unknown) =>
          resolve(usageRow !== undefined ? [usageRow] : []),
      });
      const chain = { leftJoin: () => chain, where };
      return chain;
    },
  }));
  const update = vi.fn(() => ({
    set:   () => ({
      where: () => ({
        catch: (_h: unknown) => Promise.resolve(),
        then:  (r: (v: unknown) => unknown) => Promise.resolve(r(undefined)),
      }),
    }),
  }));
  // Usage/trace writes (logUsage/logTrace) run inside ctx.waitUntil but their
  // promise argument is built eagerly, so `.insert(...).values(...)` must exist.
  const insert = vi.fn(() => ({
    values: () => ({
      catch:     (_h: unknown) => Promise.resolve(),
      then:      (r: (v: unknown) => unknown) => Promise.resolve(r(undefined)),
      returning: () => Promise.resolve([]),
    }),
  }));

  return { select, update, insert } as unknown;
}

/** Minimal in-memory KVNamespace for the idempotency-replay cache [1232]. */
function makeKvMock() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k: string, fmt?: string) => {
      const v = store.get(k);
      if (v == null) return null;
      return fmt === 'json' ? JSON.parse(v) : v;
    },
    put: async (k: string, v: string) => { store.set(k, v); },
  };
}

function mockContext(token: string, db: unknown): Context<HonoEnv> {
  return {
    req: { header: (n: string) => (n === 'Authorization' ? `Bearer ${token}` : undefined) },
    env: { JWT_SECRET: 'test', NEON_DATABASE_URL: 'x' },
    executionCtx: { waitUntil: (_p: Promise<unknown>) => undefined },
    // resolveTenantPlan calls buildDatabase a second time; same mock works.
    get: () => undefined,
    set: () => undefined,
  } as unknown as Context<HonoEnv>;
}

describe('requireTenantAccess (bfk_* path)', () => {
  beforeEach(() => {
    mocks.hashSecret.mockReset();
    mocks.verifyJwt.mockReset();
    mocks.buildDatabase.mockReset();
  });

  it('resolves a valid bfk_* key to the tenant + effective plan', async () => {
    mocks.hashSecret.mockResolvedValue('hash_of_bfk_test');
    const db = mockDb({
      keyRow:    { id: 'kid', tenantId: 42, revokedAt: null },
      tenantRow: { id: 42, plan: 'pro', billingStatus: 'active' },
    });
    mocks.buildDatabase.mockReturnValue(db);

    const access = await requireTenantAccess(mockContext('bfk_abc123', db));

    expect(access.tenantId).toBe(42);
    expect(access.agentHostId).toBeNull();
    expect(access.agentHostTokenDailyLimit).toBeNull();
    expect(access.userId).toBeNull();
    expect(access.effectivePlan).toBe('pro');
  });

  it('rejects a revoked bfk_* key with 401-shaped error', async () => {
    mocks.hashSecret.mockResolvedValue('hash_of_bfk_test');
    const db = mockDb({
      keyRow: { id: 'kid', tenantId: 42, revokedAt: new Date('2026-01-01') },
    });
    mocks.buildDatabase.mockReturnValue(db);

    await expect(requireTenantAccess(mockContext('bfk_revoked', db)))
      .rejects.toThrow(/Invalid or revoked tenant API key/);
  });

  it('rejects an unknown bfk_* key', async () => {
    mocks.hashSecret.mockResolvedValue('hash_of_bfk_test');
    const db = mockDb({});
    mocks.buildDatabase.mockReturnValue(db);

    await expect(requireTenantAccess(mockContext('bfk_unknown', db)))
      .rejects.toThrow(/Invalid or revoked tenant API key/);
  });
});

// ---------------------------------------------------------------------------
// POST /v1/chat/completions — modelStrict entitlement gate
// ---------------------------------------------------------------------------

const { createLlmRoutes } = await import('./llmRoutes');

function buildApp() {
  // The route module exports a Hono router factory; mount it on a parent app
  // so we can invoke via app.request(...) the same way prod does.
  const router = createLlmRoutes();
  return router;
}

function strictPinRequest(token = 'bfk_strict') {
  return new Request('http://test.local/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model:       'cerebras/llama-3.3-70b',
      modelStrict: true,
      messages:    [{ role: 'user', content: 'hi' }],
    }),
  });
}

const baseEnv = {
  JWT_SECRET:       'test',
  NEON_DATABASE_URL: 'x',
  // Intentionally NO OPENROUTER_API_KEY — paid-plan acceptance tests stop at
  // the vendor-key check (503), proving the strict-pin gate didn't fire.
} as unknown;

// Hono's `app.request(input, init, env, executionCtx)` takes a 4th-arg
// ExecutionContext. The bfk_* auth path calls `c.executionCtx.waitUntil(...)`
// to bookkeep `lastUsedAt`; without this, the route throws and returns 401.
const fakeExecutionCtx = {
  waitUntil: (_p: Promise<unknown>) => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

describe('POST /v1/chat/completions strict-pin gate', () => {
  beforeEach(() => {
    mocks.hashSecret.mockReset();
    mocks.verifyJwt.mockReset();
    mocks.signJwt.mockReset();
    mocks.buildDatabase.mockReset();
  });

  it('rejects free tenant without override with 403 strict_pin_not_allowed', async () => {
    mocks.hashSecret.mockResolvedValue('hash_of_bfk_test');
    const db = mockDb({
      keyRow:    { id: 'kid', tenantId: 1, revokedAt: null, allowedOrigins: null },
      tenantRow: { id: 1, plan: 'free', billingStatus: 'none', tokenDailyLimitOverride: null },
    });
    mocks.buildDatabase.mockReturnValue(db);

    const app = buildApp();
    const res = await app.request(strictPinRequest(), {}, baseEnv as Record<string, unknown>, fakeExecutionCtx);

    expect(res.status).toBe(403);
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('strict_pin_not_allowed');
  });

  it('allows free tenant WITH override past the strict gate', async () => {
    mocks.hashSecret.mockResolvedValue('hash_of_bfk_test');
    const db = mockDb({
      keyRow:    { id: 'kid', tenantId: 1, revokedAt: null, allowedOrigins: null },
      // tokenDailyLimitOverride === -1 (unlimited via superadmin) → strict allowed
      tenantRow: { id: 1, plan: 'free', billingStatus: 'none', tokenDailyLimitOverride: -1 },
      usageRow:  { used: 0 },
    });
    mocks.buildDatabase.mockReturnValue(db);

    const app = buildApp();
    const res = await app.request(strictPinRequest(), {}, baseEnv as Record<string, unknown>, fakeExecutionCtx);

    // We don't reach 403 strict_pin_not_allowed; the request progresses past
    // the gate to the vendor-key check, which returns 503 (no OPENROUTER_API_KEY
    // in baseEnv). Proves the gate did not fire.
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(503);
  });

  it('allows paid tenant past the strict gate', async () => {
    mocks.hashSecret.mockResolvedValue('hash_of_bfk_test');
    const db = mockDb({
      keyRow:    { id: 'kid', tenantId: 1, revokedAt: null, allowedOrigins: null },
      tenantRow: { id: 1, plan: 'pro', billingStatus: 'active', tokenDailyLimitOverride: null },
      usageRow:  { used: 0 },
    });
    mocks.buildDatabase.mockReturnValue(db);

    const app = buildApp();
    const res = await app.request(strictPinRequest(), {}, baseEnv as Record<string, unknown>, fakeExecutionCtx);

    expect(res.status).not.toBe(403);
    expect(res.status).toBe(503); // missing OPENROUTER_API_KEY_PRO
  });

  it('gates the public `strict: true` alias the same as `modelStrict`', async () => {
    mocks.hashSecret.mockResolvedValue('hash_of_bfk_test');
    const db = mockDb({
      keyRow:    { id: 'kid', tenantId: 1, revokedAt: null, allowedOrigins: null },
      tenantRow: { id: 1, plan: 'free', billingStatus: 'none', tokenDailyLimitOverride: null },
    });
    mocks.buildDatabase.mockReturnValue(db);

    // Public alias `strict: true` (no `modelStrict`) — free tenant still rejected.
    const req = new Request('http://test.local/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer bfk_strict', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:    'cerebras/llama-3.3-70b',
        strict:   true,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    const app = buildApp();
    const res = await app.request(req, {}, baseEnv as Record<string, unknown>, fakeExecutionCtx);

    expect(res.status).toBe(403);
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('strict_pin_not_allowed');
  });

  it('honours `?strict=true` query param for the entitlement gate', async () => {
    mocks.hashSecret.mockResolvedValue('hash_of_bfk_test');
    const db = mockDb({
      keyRow:    { id: 'kid', tenantId: 1, revokedAt: null, allowedOrigins: null },
      tenantRow: { id: 1, plan: 'free', billingStatus: 'none', tokenDailyLimitOverride: null },
    });
    mocks.buildDatabase.mockReturnValue(db);

    const req = new Request('http://test.local/v1/chat/completions?strict=true', {
      method: 'POST',
      headers: { Authorization: 'Bearer bfk_strict', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:    'cerebras/llama-3.3-70b',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    const app = buildApp();
    const res = await app.request(req, {}, baseEnv as Record<string, unknown>, fakeExecutionCtx);

    expect(res.status).toBe(403);
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('strict_pin_not_allowed');
  });
});

describe('POST /v1/chat/completions monthly token cap', () => {
  beforeEach(() => {
    mocks.hashSecret.mockReset();
    mocks.verifyJwt.mockReset();
    mocks.signJwt.mockReset();
    mocks.buildDatabase.mockReset();
  });

  function plainRequest(token = 'bfk_plain') {
    return new Request('http://test.local/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'cerebras/llama-3.3-70b', messages: [{ role: 'user', content: 'hi' }] }),
    });
  }

  it('blocks a free tenant whose month-to-date usage hit the 50K allowance', async () => {
    mocks.hashSecret.mockResolvedValue('hash_of_bfk_test');
    const db = mockDb({
      keyRow:    { id: 'kid', tenantId: 1, revokedAt: null, allowedOrigins: null },
      tenantRow: { id: 1, plan: 'free', billingStatus: 'none', tokenDailyLimitOverride: null },
      // Under the daily cap (10K) but over the monthly allowance (50K).
      usageRow:  { day: 100, month: 60_000 },
    });
    mocks.buildDatabase.mockReturnValue(db);

    const res = await buildApp().request(plainRequest(), {}, baseEnv as Record<string, unknown>, fakeExecutionCtx);

    expect(res.status).toBe(429);
    const body = await res.json() as { code?: string; monthlyLimit?: number; usedThisMonth?: number };
    expect(body.code).toBe('plan_monthly_token_limit_exceeded');
    expect(body.monthlyLimit).toBe(50_000);
    expect(body.usedThisMonth).toBe(60_000);
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('lets a free tenant under both caps through to the vendor-key check', async () => {
    mocks.hashSecret.mockResolvedValue('hash_of_bfk_test');
    const db = mockDb({
      keyRow:    { id: 'kid', tenantId: 1, revokedAt: null, allowedOrigins: null },
      tenantRow: { id: 1, plan: 'free', billingStatus: 'none', tokenDailyLimitOverride: null },
      usageRow:  { day: 100, month: 100 },
    });
    mocks.buildDatabase.mockReturnValue(db);

    const res = await buildApp().request(plainRequest(), {}, baseEnv as Record<string, unknown>, fakeExecutionCtx);

    // Past both caps → stops at the missing-OPENROUTER_API_KEY check (503).
    expect(res.status).not.toBe(429);
    expect(res.status).toBe(503);
  });

  it('does not apply a monthly cap to teams (unlimited allowance)', async () => {
    mocks.hashSecret.mockResolvedValue('hash_of_bfk_test');
    const db = mockDb({
      keyRow:    { id: 'kid', tenantId: 1, revokedAt: null, allowedOrigins: null },
      tenantRow: { id: 1, plan: 'teams', billingStatus: 'active', tokenDailyLimitOverride: null },
      // Huge usage — teams monthly is -1 (unlimited), so this must NOT block.
      usageRow:  { day: 100, month: 99_000_000 },
    });
    mocks.buildDatabase.mockReturnValue(db);

    const res = await buildApp().request(plainRequest(), {}, baseEnv as Record<string, unknown>, fakeExecutionCtx);

    expect(res.status).not.toBe(429);
  });
});

// ---------------------------------------------------------------------------
// Server-side / caller-side boundary [1300]: the response envelope echoes the
// trace id (so a consumer can quote it for a superadmin lookup) but must NEVER
// serialize the builder-side per-attempt detail (attempts[].error, requestBody,
// responseBody) — those live only in the llm_traces row.
// ---------------------------------------------------------------------------
describe('POST /v1/chat/completions trace-id leak boundary [1300]', () => {
  beforeEach(() => {
    mocks.hashSecret.mockReset();
    mocks.buildDatabase.mockReset();
    mocks.llmProxyForPlan.mockReset();
  });

  it('echoes the trace id but does NOT leak attempts/requestBody/responseBody', async () => {
    mocks.hashSecret.mockResolvedValue('hash_of_bfk_test');
    mocks.buildDatabase.mockReturnValue(mockDb({
      keyRow:    { id: 'kid', tenantId: 1, revokedAt: null, allowedOrigins: null },
      tenantRow: { id: 1, plan: 'pro', billingStatus: 'active', tokenDailyLimitOverride: null },
      usageRow:  { used: 0 },
    }));
    // Proxy returns a success — but with rich SERVER-SIDE diagnostics (attempts
    // carrying raw upstream error text). The route must keep all of it off the wire.
    mocks.llmProxyForPlan.mockReturnValue({
      complete: async () => ({
        response: new Response(
          JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
        resolvedModel: 'cerebras/llama-3.3-70b',
        resolvedVendor: 'cerebras',
        retries: 0,
        failovers: [],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        attempts: [{ model: 'x', vendor: 'cerebras', status: 500, error: 'RAW_UPSTREAM_SECRET_PAYLOAD', durationMs: 1 }],
      }),
    });

    const req = new Request('http://test.local/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer bfk_trace', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'cerebras/llama-3.3-70b', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const env = { ...(baseEnv as Record<string, unknown>), OPENROUTER_API_KEY: 'x' };
    const res = await buildApp().request(req, {}, env, fakeExecutionCtx);

    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as { _builderforce?: { traceId?: string } };

    // (a) trace id IS surfaced to the caller in the response envelope
    //     (non-streaming carries it in `_builderforce.traceId`; the streaming
    //     path additionally sets the `x-builderforce-trace-id` header).
    expect(body._builderforce?.traceId).toBeTruthy();
    // (b) builder-side detail is NOT serialized back
    expect(text).not.toContain('attempts');
    expect(text).not.toContain('requestBody');
    expect(text).not.toContain('responseBody');
    expect(text).not.toContain('RAW_UPSTREAM_SECRET_PAYLOAD');
  });
});

// ---------------------------------------------------------------------------
// Idempotency-Key REPLAY [1232]: a repeated key with a cached original body
// replays it (200 + replay header) and must NOT re-dispatch to the proxy.
// ---------------------------------------------------------------------------
describe('POST /v1/chat/completions idempotency replay [1232]', () => {
  beforeEach(() => {
    mocks.hashSecret.mockReset();
    mocks.buildDatabase.mockReset();
    mocks.llmProxyForPlan.mockReset();
  });

  it('replays the cached body and does NOT call the proxy on a repeated key', async () => {
    mocks.hashSecret.mockResolvedValue('hash_of_bfk_test');
    mocks.buildDatabase.mockReturnValue(mockDb({
      keyRow:    { id: 'kid', tenantId: 1, revokedAt: null, allowedOrigins: null },
      tenantRow: { id: 1, plan: 'pro', billingStatus: 'active', tokenDailyLimitOverride: null },
      usageRow:  { used: 0 },
    }));
    // If replay short-circuits correctly, the proxy is never invoked.
    mocks.llmProxyForPlan.mockReturnValue({
      complete: async () => { throw new Error('proxy must NOT be called on idempotent replay'); },
    });
    const kv = makeKvMock();
    await kv.put('idem:1:abc', JSON.stringify({
      status: 200,
      body: { choices: [{ message: { role: 'assistant', content: 'cached' } }], _builderforce: { traceId: 'llm-original' } },
    }));

    const req = new Request('http://test.local/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer bfk_idem', 'Content-Type': 'application/json', 'Idempotency-Key': 'abc' },
      body: JSON.stringify({ model: 'cerebras/llama-3.3-70b', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const env = { ...(baseEnv as Record<string, unknown>), OPENROUTER_API_KEY: 'x', AUTH_CACHE_KV: kv };
    const res = await buildApp().request(req, {}, env, fakeExecutionCtx);

    expect(res.status).toBe(200);
    expect(res.headers.get('x-builderforce-idempotent-replay')).toBe('true');
    const body = await res.json() as { _builderforce?: { traceId?: string }; choices?: unknown };
    expect(body._builderforce?.traceId).toBe('llm-original'); // the ORIGINAL response, replayed
  });
});

// ---------------------------------------------------------------------------
// POST /v1/embed-session — server-to-server relay token mint
// ---------------------------------------------------------------------------

function embedSessionRequest(token = 'bfk_embed') {
  // No Origin header — this is the server-to-server call a customer's backend
  // makes. A server-only bfk_* key (allowedOrigins null) passes originAllowed.
  return new Request('http://test.local/v1/embed-session', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

describe('POST /v1/embed-session', () => {
  beforeEach(() => {
    mocks.hashSecret.mockReset();
    mocks.verifyJwt.mockReset();
    mocks.signJwt.mockReset();
    mocks.buildDatabase.mockReset();
  });

  it('mints a short-lived embed token from a valid bfk_* key (server-to-server)', async () => {
    mocks.hashSecret.mockResolvedValue('hash_of_bfk_test');
    mocks.signJwt.mockResolvedValue('embed.jwt.token');
    const db = mockDb({
      keyRow:    { id: 'kid-7', tenantId: 42, revokedAt: null, allowedOrigins: null },
      tenantRow: { id: 42, plan: 'pro', billingStatus: 'active' },
    });
    mocks.buildDatabase.mockReturnValue(db);

    const app = buildApp();
    const res = await app.request(embedSessionRequest(), {}, baseEnv as Record<string, unknown>, fakeExecutionCtx);

    expect(res.status).toBe(200);
    const body = await res.json() as { token: string; expiresInSeconds: number; expiresAt: string };
    expect(body.token).toBe('embed.jwt.token');
    expect(body.expiresInSeconds).toBe(600);
    expect(typeof body.expiresAt).toBe('string');

    // Token must be scoped to the key's tenant and tagged `embed:<keyId>`.
    const [payload, , ttl] = mocks.signJwt.mock.calls[0]!;
    expect(payload).toMatchObject({ sub: 'embed:kid-7', tid: 42 });
    expect(ttl).toBe(600);
  });

  it('rejects a server-only bfk_* key presented from a browser Origin', async () => {
    mocks.hashSecret.mockResolvedValue('hash_of_bfk_test');
    const db = mockDb({
      keyRow:    { id: 'kid', tenantId: 42, revokedAt: null, allowedOrigins: null },
      tenantRow: { id: 42, plan: 'pro', billingStatus: 'active' },
    });
    mocks.buildDatabase.mockReturnValue(db);

    const app = buildApp();
    const req = new Request('http://test.local/v1/embed-session', {
      method: 'POST',
      headers: { Authorization: 'Bearer bfk_embed', Origin: 'https://evil.example' },
    });
    const res = await app.request(req, {}, baseEnv as Record<string, unknown>, fakeExecutionCtx);

    expect(res.status).toBe(403);
    expect(mocks.signJwt).not.toHaveBeenCalled();
  });
});
