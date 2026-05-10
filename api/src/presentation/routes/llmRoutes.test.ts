import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Context } from 'hono';
import type { HonoEnv } from '../../env';

// Hoisted mocks — vi.mock must declare the spies via vi.hoisted so the
// factory closures see them.
const mocks = vi.hoisted(() => ({
  hashSecret: vi.fn(),
  verifyJwt:  vi.fn(),
  buildDatabase: vi.fn(),
}));

vi.mock('../../infrastructure/auth/HashService', () => ({
  hashSecret: mocks.hashSecret,
  generateApiKey: vi.fn(() => 'bfk_test'),
}));
vi.mock('../../infrastructure/auth/JwtService', () => ({ verifyJwt: mocks.verifyJwt }));
vi.mock('../../infrastructure/database/connection', () => ({ buildDatabase: mocks.buildDatabase }));

// Imports must follow the vi.mock calls above so the mocks are in place.
const { requireTenantAccess } = await import('./llmRoutes');
const { sanitizeToolName, restoreToolName, sanitizeRequestToolNames, restoreResponseToolNames } =
  await import('../../application/llm/toolNameSanitizer');

// ---------------------------------------------------------------------------
// Tool-name sanitizer — bidirectional dot escape for vendors that reject dots
// (Anthropic). Sanitizer runs gateway-side; restoration brings the caller's
// dotted namespace back on the response path.
// ---------------------------------------------------------------------------

describe('toolNameSanitizer', () => {
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
    const out = sanitizeRequestToolNames(body) as typeof body;
    expect(out.tools[0]!.function.name).not.toMatch(/\./);
    expect((out.tool_choice.function as { name: string }).name).not.toMatch(/\./);
    expect((out.messages[1]!.tool_calls as Array<{ function: { name: string } }>)[0]!.function.name).not.toMatch(/\./);
    expect((out.messages[2] as { name: string }).name).not.toMatch(/\./);
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
});

// ---------------------------------------------------------------------------
// requireTenantAccess — bfk_* tenant API key path
// ---------------------------------------------------------------------------

type TenantApiKeyRow = { id: string; tenantId: number; revokedAt: Date | null };
type TenantRow = { id: number; plan: 'free' | 'pro' | 'teams'; billingStatus: string };

function mockDb(opts: { keyRow?: TenantApiKeyRow; tenantRow?: TenantRow }) {
  // Drizzle-style chainable selects: each terminal `.limit(1)` resolves
  // with `[row]`. Two distinct lookups happen in the bfk_* path: the key
  // row, then the tenant row. We hand back an iterator of canned results.
  const queue: unknown[][] = [];
  if (opts.keyRow !== undefined) queue.push([opts.keyRow]);
  if (opts.tenantRow !== undefined) queue.push([opts.tenantRow]);

  const select = vi.fn(() => ({
    from:  () => ({
      where: () => ({
        limit: () => Promise.resolve(queue.shift() ?? []),
      }),
    }),
  }));
  const update = vi.fn(() => ({
    set:   () => ({
      where: () => ({
        catch: (_h: unknown) => Promise.resolve(),
        then:  (r: (v: unknown) => unknown) => Promise.resolve(r(undefined)),
      }),
    }),
  }));

  return { select, update } as unknown;
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
    expect(access.clawId).toBeNull();
    expect(access.clawTokenDailyLimit).toBeNull();
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
