import { afterEach, describe, expect, it, vi } from 'vitest';

// The gateway used to read tenant_llm_provider_keys six times per request. These tests pin
// the contract of the ONE cached loader: every resolver derives from it, the empty answer
// is cached, and every writer invalidates it.

let selects = 0;
let rows: unknown[] = [];

function fakeDb() {
  const result = () => Object.assign(Promise.resolve(rows), { orderBy: () => { selects += 1; return Promise.resolve(rows); } });
  return {
    select: () => ({ from: () => ({ where: result }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve() }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  };
}

vi.mock('../../infrastructure/database/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/database/connection')>()),
  buildDatabase: () => fakeDb(),
}));
vi.mock('../../infrastructure/auth/MfaService', () => ({
  encryptSecretForStorage: async (s: string) => `enc:${s}`,
  decryptSecretFromStorage: async (s: string) => s.replace(/^enc:/, ''),
}));

import {
  listTenantProviderKeys,
  resolveAnthropicResolution,
  resolveTenantVendorKeys,
  setTenantProviderKey,
  setTenantProviderPriorityRanks,
  deleteTenantProviderKey,
} from './tenantProviderKeyService';

const env = { NEON_DATABASE_URL: 'x', JWT_SECRET: 's' } as never;

afterEach(() => { selects = 0; rows = []; });

describe('tenant provider rows — one cached read', () => {
  it('serves vendor keys, the provider list and per-provider resolution from ONE statement', async () => {
    rows = [
      { id: 'a', provider: 'anthropic', keyEnc: 'enc:sk-ant', authType: 'api_key', priority: 0 },
      { id: 'o', provider: 'openai', keyEnc: 'enc:sk-oai', authType: 'api_key', priority: null },
    ];
    const [keys, list, anth] = await Promise.all([
      resolveTenantVendorKeys(env, 7),
      listTenantProviderKeys(env, 7),
      resolveAnthropicResolution(env, 7),
    ]);
    // Repeat after warm — still no further statement.
    await listTenantProviderKeys(env, 7);
    await resolveTenantVendorKeys(env, 7);
    expect(selects).toBeLessThanOrEqual(1 + 2); // concurrent cold readers may each load once; warm adds none
    const afterWarm = selects;
    await resolveAnthropicResolution(env, 7);
    expect(selects).toBe(afterWarm);
    expect(keys).toMatchObject({ anthropic: 'sk-ant', openai: 'sk-oai' });
    expect(list.map((p) => p.provider)).toEqual(['anthropic', 'openai']);
    expect(anth.auth).toEqual({ mode: 'api_key', key: 'sk-ant' });
  });

  it('caches the empty result (no BYO account) too', async () => {
    rows = [];
    await listTenantProviderKeys(env, 8);
    await listTenantProviderKeys(env, 8);
    await resolveTenantVendorKeys(env, 8);
    expect(selects).toBe(1);
  });

  it.each([
    ['setTenantProviderKey', () => setTenantProviderKey(env, 9, 'anthropic', 'k', null)],
    ['deleteTenantProviderKey', () => deleteTenantProviderKey(env, 9, 'anthropic')],
    ['setTenantProviderPriorityRanks', () => setTenantProviderPriorityRanks(env, 9, new Map([['anthropic', 1]]))],
  ])('%s invalidates the cached rows', async (_name, write) => {
    rows = [];
    await listTenantProviderKeys(env, 9);
    expect(selects).toBe(1);
    rows = [{ id: 'a', provider: 'anthropic', keyEnc: 'enc:new', authType: 'api_key', priority: 0 }];
    await write();
    const list = await listTenantProviderKeys(env, 9);
    expect(selects).toBe(2);
    expect(list).toHaveLength(1);
  });
});
