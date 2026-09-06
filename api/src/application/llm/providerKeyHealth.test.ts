import { describe, expect, it, vi } from 'vitest';

// The status read is the ONLY caller that needs the online-host lookup; everything
// else under test is pure. Mock the lookup so the verdict can be driven both ways
// without a database.
const mocks = vi.hoisted(() => ({ onlineAgentHostId: vi.fn<() => Promise<number | null>>(async () => null) }));
vi.mock('./hostEgress', () => ({ onlineAgentHostId: mocks.onlineAgentHostId }));

const {
  deriveProviderKeyHealth,
  providerRequiresLocalEgress,
  resolveProviderKeyHealth,
} = await import('./providerKeyHealth');
type ProviderAuthAlert = import('./providerAuthAlerts').ProviderAuthAlert;
type TenantLlmCredentials = import('./tenantProviderKeyService').TenantLlmCredentials;

const alert = (reason: ProviderAuthAlert['reason']): ProviderAuthAlert =>
  ({ provider: 'kimi', reason, status: 403, vendor: 'kimi-code', at: Date.now() });

const base = { configured: true, usable: true, authAlert: null, requiresLocalEgress: false, localEgressOnline: false };

describe('deriveProviderKeyHealth', () => {
  it('is ready for a resolvable, un-alerted credential whose vendor the gateway can reach', () => {
    expect(deriveProviderKeyHealth(base)).toBe('ready');
  });

  // The production symptom: "Current status: ready" painted green one line above a Test
  // button answering "needs a runtime of your own". The read must reach the same verdict
  // the probe does, and reach it BEFORE the operator spends a probe finding out.
  it('answers local_egress_required — not ready — when the vendor needs the tenant\'s own runtime and none is online', () => {
    expect(deriveProviderKeyHealth({ ...base, requiresLocalEgress: true })).toBe('local_egress_required');
  });

  it('is ready again the moment a runtime is online', () => {
    expect(deriveProviderKeyHealth({ ...base, requiresLocalEgress: true, localEgressOnline: true })).toBe('ready');
  });

  it('keeps health above reachability: a rejection observed from a connected runtime is a verdict on the account', () => {
    expect(deriveProviderKeyHealth({ ...base, requiresLocalEgress: true, authAlert: alert('not_entitled') })).toBe('needs_attention');
    expect(deriveProviderKeyHealth({ ...base, requiresLocalEgress: true, authAlert: alert('capacity') })).toBe('capacity');
  });

  it('keeps resolvability above reachability: an unusable credential names its own reason', () => {
    expect(deriveProviderKeyHealth({ ...base, usable: false, unresolvedReason: 'revoked', requiresLocalEgress: true })).toBe('revoked');
    expect(deriveProviderKeyHealth({ ...base, usable: false })).toBe('unavailable');
  });

  it('is not_connected before anything else when no credential row exists', () => {
    expect(deriveProviderKeyHealth({ ...base, configured: false, requiresLocalEgress: true })).toBe('not_connected');
  });
});

describe('providerRequiresLocalEgress', () => {
  it('reads the vendor module\'s ONE declaration, auth-type aware', () => {
    // Kimi Code's edge refuses the hosted gateway whichever way the account connected.
    expect(providerRequiresLocalEgress('kimi', 'oauth')).toBe(true);
    expect(providerRequiresLocalEgress('kimi', 'api_key')).toBe(true);
    // A self-hosted engine lives at a private address only the runtime can reach.
    expect(providerRequiresLocalEgress('ollama-local', 'api_key')).toBe(true);
    // The hosted vendors call out from the Worker directly.
    expect(providerRequiresLocalEgress('anthropic', 'oauth')).toBe(false);
    expect(providerRequiresLocalEgress('moonshot', 'api_key')).toBe(false);
  });
});

describe('resolveProviderKeyHealth', () => {
  const creds = (over: Partial<TenantLlmCredentials> = {}): TenantLlmCredentials => ({
    anthropicOAuthToken: null,
    openaiCodexAuth: null,
    xaiOAuthToken: null,
    vendorKeys: { kimi: 'kimi-access-token' },
    configuredProviders: ['kimi'],
    unresolvedReasons: {},
    vendorPriority: ['kimi-code'],
    ...over,
  });
  const env = {} as import('../../env').Env;
  const kimiRow = { id: 'k1', provider: 'kimi' as const, authType: 'oauth' as const, priority: null };

  it('consults the online-host lookup only for a vendor that needs it', async () => {
    mocks.onlineAgentHostId.mockClear();
    const verdict = await resolveProviderKeyHealth(env, 1, 'moonshot', {
      details: [{ id: 'm1', provider: 'moonshot', authType: 'api_key', priority: null }],
      creds: creds({ vendorKeys: { moonshot: 'sk-moon' }, configuredProviders: ['moonshot'], vendorPriority: ['moonshot'] }),
      authAlert: null,
    });
    expect(verdict).toEqual({ status: 'ready', configured: true, usable: true });
    expect(mocks.onlineAgentHostId).not.toHaveBeenCalled();
  });

  it('reports a connected Kimi subscription as local_egress_required with no runtime online, and ready with one', async () => {
    mocks.onlineAgentHostId.mockResolvedValueOnce(null);
    expect((await resolveProviderKeyHealth(env, 1, 'kimi', { details: [kimiRow], creds: creds(), authAlert: null })).status)
      .toBe('local_egress_required');

    mocks.onlineAgentHostId.mockResolvedValueOnce(7);
    expect((await resolveProviderKeyHealth(env, 1, 'kimi', { details: [kimiRow], creds: creds(), authAlert: null })).status)
      .toBe('ready');
  });

  it('does not spend the lookup on a credential that is already unusable or alerted', async () => {
    mocks.onlineAgentHostId.mockClear();
    const revoked = await resolveProviderKeyHealth(env, 1, 'kimi', {
      details: [kimiRow],
      creds: creds({ vendorKeys: {}, unresolvedReasons: { kimi: 'revoked' } }),
      authAlert: null,
    });
    expect(revoked).toEqual({ status: 'revoked', configured: true, usable: false });
    const alerted = await resolveProviderKeyHealth(env, 1, 'kimi', { details: [kimiRow], creds: creds(), authAlert: alert('capacity') });
    expect(alerted.status).toBe('capacity');
    expect(mocks.onlineAgentHostId).not.toHaveBeenCalled();
  });
});
