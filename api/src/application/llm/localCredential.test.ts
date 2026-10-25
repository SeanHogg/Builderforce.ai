import { beforeEach, describe, expect, it, vi } from 'vitest';

const listTenantProviderKeys = vi.fn();
const resolveKimiOAuthResolution = vi.fn();
const listProviderModelSelections = vi.fn();

vi.mock('./tenantProviderKeyService', () => ({
  listTenantProviderKeys: (...args: unknown[]) => listTenantProviderKeys(...args),
  resolveKimiOAuthResolution: (...args: unknown[]) => resolveKimiOAuthResolution(...args),
}));
vi.mock('./providerModelSelection', () => ({
  listProviderModelSelections: (...args: unknown[]) => listProviderModelSelections(...args),
}));

import { KIMI_CODE_API_BASE_URL } from '@builderforce/kimi-oauth';
import { issueLocalCredential, supportsLocalCredential } from './localCredential';

const env = {} as never;

describe('issueLocalCredential', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listProviderModelSelections.mockResolvedValue({});
  });

  it('is offered only for local-egress subscriptions', async () => {
    expect(supportsLocalCredential('kimi')).toBe(true);
    expect(supportsLocalCredential('anthropic')).toBe(false);
    expect(await issueLocalCredential(env, 1, 'anthropic')).toEqual({ kind: 'unsupported' });
  });

  it('says not_connected when nothing is connected, so the client offers to connect', async () => {
    listTenantProviderKeys.mockResolvedValue([{ provider: 'qwen', authType: 'api_key' }]);
    expect(await issueLocalCredential(env, 1, 'kimi')).toEqual({ kind: 'not_connected' });
    expect(resolveKimiOAuthResolution).not.toHaveBeenCalled();
  });

  it('never ships an API-key connection to a device', async () => {
    listTenantProviderKeys.mockResolvedValue([{ provider: 'kimi', authType: 'api_key' }]);
    expect(await issueLocalCredential(env, 1, 'kimi')).toEqual({ kind: 'reconnect', reason: 'api_key_connection' });
  });

  it('asks for a reconnect when the stored grant is dead', async () => {
    listTenantProviderKeys.mockResolvedValue([{ provider: 'kimi', authType: 'oauth' }]);
    resolveKimiOAuthResolution.mockResolvedValue({ token: null, reason: 'revoked' });
    expect(await issueLocalCredential(env, 1, 'kimi')).toEqual({ kind: 'reconnect', reason: 'revoked' });
  });

  it('issues the access token (never the refresh token) with the catalog models', async () => {
    listTenantProviderKeys.mockResolvedValue([{ provider: 'kimi', authType: 'oauth' }]);
    resolveKimiOAuthResolution.mockResolvedValue({ token: 'access-1', expires: 900_000 });
    const result = await issueLocalCredential(env, 7, 'kimi');
    expect(result.kind).toBe('credential');
    if (result.kind !== 'credential') return;
    expect(result.body).toMatchObject({
      provider: 'kimi',
      runtime: 'kimi-code',
      accessToken: 'access-1',
      expiresAt: 900_000,
      baseUrl: KIMI_CODE_API_BASE_URL,
    });
    expect(JSON.stringify(result.body)).not.toContain('refresh');
    expect(result.body.models.map((m) => m.model)).toEqual(['kimi-for-coding', 'k3', 'k3-256k', 'kimi-for-coding-highspeed']);
    expect(result.body.models.find((m) => m.model === 'k3')).toEqual({ model: 'k3', displayName: 'Kimi K3', contextWindow: 1_048_576 });
  });

  it('lists the tenant\'s chosen order when they made one — K3 first on a K3 plan', async () => {
    listTenantProviderKeys.mockResolvedValue([{ provider: 'kimi', authType: 'oauth' }]);
    resolveKimiOAuthResolution.mockResolvedValue({ token: 'access-1', expires: 900_000 });
    listProviderModelSelections.mockResolvedValue({ kimi: ['k3', 'kimi-for-coding'] });
    const result = await issueLocalCredential(env, 7, 'kimi');
    expect(result.kind === 'credential' && result.body.models.map((m) => m.model)).toEqual(['k3', 'kimi-for-coding']);
  });
});
