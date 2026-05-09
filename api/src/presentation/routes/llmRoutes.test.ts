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
