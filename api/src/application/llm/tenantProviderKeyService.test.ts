import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// BYO Anthropic resolution — the "should have used my own account" P1 fix.
//
// Verifies (deterministically, no DB/network) that resolveAnthropicResolution:
//   • reports a PRECISE reason when a connected credential can't be used
//     (revoked / expired / undecryptable), so a shared-pool degrade is actionable;
//   • HARDENS against a transient refresh failure — it keeps using a still-valid
//     access token (within its real expiry, margin included) rather than dropping
//     the tenant onto the shared pool on a 5xx/network blip.
// Plus formatByoUnresolvedHeader's `provider:reason` encoding (incl. other-workspace).
// ---------------------------------------------------------------------------

// neon() → a tagged-template fn returning whatever rows the current test staged.
const rowsBox: { current: unknown[] } = { current: [] };
vi.mock('@neondatabase/serverless', () => ({
  neon: () => async () => rowsBox.current,
}));

// Decrypt is swapped per test (valid blob / api key / throws for undecryptable).
const decryptBox: { current: (s: string) => string } = { current: (s) => s };
vi.mock('../../infrastructure/auth/MfaService', () => ({
  encryptSecretForStorage: async (s: string) => `enc:${s}`,
  decryptSecretFromStorage: async (s: string) => decryptBox.current(s),
}));

// Refresh is swapped per test (rotates ok / rejects with a status).
const refreshBox: { current: (t: string) => Promise<unknown> } = {
  current: async () => ({ access: 'A2', refresh: 'R2', expires: Date.now() + 3_600_000 }),
};
vi.mock('./anthropicOAuth', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, refreshAnthropicToken: (t: string) => refreshBox.current(t) };
});

import {
  resolveAnthropicResolution,
  formatByoUnresolvedHeader,
  PROVIDER_VENDOR_MAP,
  byoVendorPriorityOrder,
  type TenantLlmCredentials,
} from './tenantProviderKeyService';
import { OAUTH_SAFETY_MARGIN_MS } from './anthropicOAuth';

const env = { NEON_DATABASE_URL: 'x', JWT_SECRET: 's' } as never;

describe('BYO provider routing map', () => {
  it('maps Kimi, Qwen, and MiniMax to their direct gateway vendors', () => {
    expect(PROVIDER_VENDOR_MAP.kimi).toMatchObject({ vendorId: 'moonshot', envKey: 'MOONSHOT_API_KEY' });
    expect(PROVIDER_VENDOR_MAP.qwen).toMatchObject({ vendorId: 'qwen', envKey: 'QWEN_API_KEY' });
    expect(PROVIDER_VENDOR_MAP.minimax).toMatchObject({ vendorId: 'minimax', envKey: 'MINIMAX_API_KEY' });
    expect(PROVIDER_VENDOR_MAP.xai).toMatchObject({ vendorId: 'xai', envKey: 'XAI_API_KEY', oauth: true });
  });

  it('maps OpenAI OAuth priority to the Codex subscription vendor', () => {
    expect(byoVendorPriorityOrder([{ provider: 'openai', authType: 'oauth', priority: 0 }])).toEqual(['openai-codex']);
    expect(byoVendorPriorityOrder([{ provider: 'openai', authType: 'api_key', priority: 0 }])).toEqual(['openai']);
  });

  it('maps xAI OAuth priority to the SuperGrok Responses vendor', () => {
    expect(byoVendorPriorityOrder([{ provider: 'xai', authType: 'oauth', priority: 0 }])).toEqual(['xai-oauth']);
    expect(byoVendorPriorityOrder([{ provider: 'xai', authType: 'api_key', priority: 0 }])).toEqual(['xai']);
  });
});

/** Stage an oauth row whose decrypted token blob has the given absolute `expires`. */
function stageOAuth(expires: number, access = 'A1') {
  rowsBox.current = [{ key_enc: 'enc', auth_type: 'oauth' }];
  decryptBox.current = () => JSON.stringify({ access, refresh: 'R1', expires });
}

afterEach(() => {
  rowsBox.current = [];
  decryptBox.current = (s) => s;
  refreshBox.current = async () => ({ access: 'A2', refresh: 'R2', expires: Date.now() + 3_600_000 });
});

describe('resolveAnthropicResolution — reason reporting', () => {
  it('nothing connected → null, no reason (not a failure)', async () => {
    rowsBox.current = [];
    expect(await resolveAnthropicResolution(env, 1)).toEqual({ auth: null });
  });

  it('a valid subscription token resolves with no reason', async () => {
    stageOAuth(Date.now() + 10 * 60_000, 'GOOD');
    const r = await resolveAnthropicResolution(env, 1);
    expect(r.reason).toBeUndefined();
    expect(r.auth).toEqual({ mode: 'oauth', accessToken: 'GOOD' });
  });

  it('an api key resolves with no reason', async () => {
    rowsBox.current = [{ key_enc: 'enc', auth_type: 'api_key' }];
    decryptBox.current = () => 'sk-ant-123';
    const r = await resolveAnthropicResolution(env, 1);
    expect(r.reason).toBeUndefined();
    expect(r.auth).toEqual({ mode: 'api_key', key: 'sk-ant-123' });
  });

  it('an undecryptable blob → reason "undecryptable"', async () => {
    rowsBox.current = [{ key_enc: 'enc', auth_type: 'oauth' }];
    decryptBox.current = () => { throw new Error('bad key'); };
    expect(await resolveAnthropicResolution(env, 1)).toEqual({ auth: null, reason: 'undecryptable' });
  });

  it('expired token + successful refresh → new token, no reason', async () => {
    stageOAuth(Date.now() - 10 * 60_000); // past real expiry
    refreshBox.current = async () => ({ access: 'FRESH', refresh: 'R2', expires: Date.now() + 3_600_000 });
    const r = await resolveAnthropicResolution(env, 1);
    expect(r.reason).toBeUndefined();
    expect(r.auth).toEqual({ mode: 'oauth', accessToken: 'FRESH' });
  });

  it('expired token + refresh 401 → reason "revoked" (reconnect required)', async () => {
    stageOAuth(Date.now() - 10 * 60_000);
    refreshBox.current = async () => { throw Object.assign(new Error('nope'), { status: 401 }); };
    expect(await resolveAnthropicResolution(env, 1)).toEqual({ auth: null, reason: 'revoked' });
  });

  it('HARDENING: just-expired + transient refresh 500, still within real validity → reuse existing token', async () => {
    // Expired by the safety margin only (real expiry = expires + margin is still ahead),
    // so a transient refresh failure must NOT drop the tenant onto the shared pool.
    stageOAuth(Date.now() - OAUTH_SAFETY_MARGIN_MS / 2, 'STILL_GOOD');
    refreshBox.current = async () => { throw Object.assign(new Error('boom'), { status: 500 }); };
    const r = await resolveAnthropicResolution(env, 1);
    expect(r.reason).toBeUndefined();
    expect(r.auth).toEqual({ mode: 'oauth', accessToken: 'STILL_GOOD' });
  });

  it('past real expiry + transient refresh 500 → reason "expired" (retryable)', async () => {
    stageOAuth(Date.now() - 2 * OAUTH_SAFETY_MARGIN_MS); // real expiry also passed
    refreshBox.current = async () => { throw Object.assign(new Error('boom'), { status: 503 }); };
    expect(await resolveAnthropicResolution(env, 1)).toEqual({ auth: null, reason: 'expired' });
  });
});

describe('formatByoUnresolvedHeader — provider:reason encoding', () => {
  const base: TenantLlmCredentials = {
    anthropicOAuthToken: null,
    vendorKeys: {},
    configuredProviders: ['anthropic'],
    unresolvedReasons: { anthropic: 'revoked' },
    vendorPriority: [],
  };

  it('encodes a same-tenant unresolved provider with its reason', () => {
    expect(formatByoUnresolvedHeader(base)).toBe('anthropic:revoked');
  });

  it('appends a cross-workspace provider as other-workspace', () => {
    expect(formatByoUnresolvedHeader(base, ['openai'])).toBe('anthropic:revoked,openai:other-workspace');
  });

  it('is empty when everything resolved and nothing is connected elsewhere', () => {
    const ok: TenantLlmCredentials = { anthropicOAuthToken: 'tok', vendorKeys: {}, configuredProviders: ['anthropic'], unresolvedReasons: {}, vendorPriority: [] };
    expect(formatByoUnresolvedHeader(ok)).toBe('');
  });
});
