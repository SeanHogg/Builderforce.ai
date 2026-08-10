import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// BYO PRECEDENCE WRITES + unresolved-reason accuracy.
//
// Two defects this locks out, both surfaced by the drag-to-reorder provider-priority UI
// (which issues a full re-rank on every drop):
//
//  1. The rank write was ONE UPDATE PER PROVIDER. neon-http has no interactive transaction,
//     so a failure midway left precedence half-applied — two providers sharing a rank, or
//     the new #1 stamped while the rest kept the old order. It must be a single statement.
//
//  2. A provider row stored `auth_type='oauth'` for a provider with NO OAuth resolver
//     (google/meta/kimi/qwen/minimax) was reported unresolved as `undecryptable`, sending
//     the owner to re-save a credential that reads back perfectly. The auth TYPE is the
//     problem, and the reason now says so.
// ---------------------------------------------------------------------------

const rowsBox: { current: unknown[] } = { current: [] };
const updates: Array<{ set: Record<string, unknown>; where: unknown }> = [];

function rowsResult() {
  return Object.assign(Promise.resolve(rowsBox.current), {
    limit: () => Promise.resolve(rowsBox.current),
    orderBy: () => Promise.resolve(rowsBox.current),
  });
}

function fakeDb() {
  const reader = () => ({ from: () => ({ where: rowsResult, innerJoin: () => ({ where: rowsResult }) }) });
  return {
    select: reader,
    selectDistinct: reader,
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve() }) }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: unknown) => { updates.push({ set, where }); return Promise.resolve(); },
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  };
}

vi.mock('../../infrastructure/database/connection', () => ({ buildDatabase: () => fakeDb() }));

const decryptBox: { current: (s: string) => string } = { current: (s) => s };
vi.mock('../../infrastructure/auth/MfaService', () => ({
  encryptSecretForStorage: async (s: string) => `enc:${s}`,
  decryptSecretFromStorage: async (s: string) => decryptBox.current(s),
}));

// No OpenRouter connections in these scenarios — the provider half is what's under test.
vi.mock('./openRouterConnectionService', () => ({
  listOpenRouterConnections: async () => [],
  resolveOpenRouterConnectionKeys: async () => ({}),
  connectionModelRefs: () => [],
}));

import {
  setTenantProviderPriorityRanks,
  resolveTenantLlmCredentials,
  OAUTH_CAPABLE_PROVIDERS,
  type LlmProvider,
} from './tenantProviderKeyService';

const env = { NEON_DATABASE_URL: 'x', JWT_SECRET: 's' } as never;

/** Flatten a drizzle `sql` fragment to its literal text + bound values. Walks `queryChunks`
 *  only — the column/table chunks are self-referential and can't be JSON-stringified. */
function sqlLiterals(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  const rec = node as Record<string, unknown>;
  if (Array.isArray(rec.value)) for (const v of rec.value) { if (typeof v === 'string') out.push(v); }
  else if (typeof rec.value === 'string' || typeof rec.value === 'number') out.push(String(rec.value));
  if (Array.isArray(rec.queryChunks)) for (const chunk of rec.queryChunks) sqlLiterals(chunk, out);
  return out;
}

afterEach(() => {
  rowsBox.current = [];
  updates.length = 0;
  decryptBox.current = (s) => s;
});

describe('setTenantProviderPriorityRanks — atomic re-rank', () => {
  it('writes the whole ordering in ONE statement, not one UPDATE per provider', async () => {
    await setTenantProviderPriorityRanks(env, 1, new Map<LlmProvider, number | null>([
      ['anthropic', 0],
      ['openai', 1],
      ['google', 2],
    ]));
    expect(updates).toHaveLength(1);
  });

  it('stamps every ranked provider through a single CASE expression, nulls included', async () => {
    await setTenantProviderPriorityRanks(env, 1, new Map<LlmProvider, number | null>([
      ['anthropic', 0],
      ['openai', null],
    ]));
    // The rank column is set from a SQL CASE, not a per-row literal — that's what makes the
    // multi-provider write a single round trip.
    const text = sqlLiterals(updates[0]?.set.priority).join(' ');
    expect(text).toContain('CASE');
    expect(text).toContain('anthropic');
    expect(text).toContain('openai');
  });

  it('no-ops without touching the table when nothing rankable is passed', async () => {
    await setTenantProviderPriorityRanks(env, 1, new Map());
    await setTenantProviderPriorityRanks(env, 1, new Map([['bogus' as LlmProvider, 0]]));
    expect(updates).toHaveLength(0);
  });
});

describe('resolveTenantLlmCredentials — why a connected provider was unusable', () => {
  it('blames the auth TYPE, not the ciphertext, for an oauth row on a key-only provider', async () => {
    rowsBox.current = [{ provider: 'google', keyEnc: 'enc', authType: 'oauth', priority: 0 }];
    decryptBox.current = () => 'AIza-perfectly-readable';

    const creds = await resolveTenantLlmCredentials(env, 1);

    expect(creds.configuredProviders).toEqual(['google']);
    expect(creds.unresolvedReasons.google).toBe('unsupported-auth');
  });

  it('still reports undecryptable when an api-key row genuinely will not decrypt', async () => {
    rowsBox.current = [{ provider: 'google', keyEnc: 'enc', authType: 'api_key', priority: 0 }];
    decryptBox.current = () => { throw new Error('bad key'); };

    const creds = await resolveTenantLlmCredentials(env, 1);

    expect(creds.unresolvedReasons.google).toBe('undecryptable');
  });

  it('only anthropic, openai and xai can be connected as a subscription', () => {
    expect([...OAUTH_CAPABLE_PROVIDERS].sort()).toEqual(['anthropic', 'openai', 'xai']);
  });
});
