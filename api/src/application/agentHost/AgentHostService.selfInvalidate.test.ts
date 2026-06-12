import { describe, expect, it, vi } from 'vitest';
import { AgentHostService } from './AgentHostService';
import { invalidateAgentHostKeyCache } from '../../infrastructure/auth/keyResolutionCache';
import type { IAgentHostRepository } from '../../domain/agentHost/IAgentHostRepository';
import type { Env } from '../../env';

/**
 * Gap [1234]: status mutations must self-invalidate the long-TTL clk_* auth
 * cache AT THE MUTATION so no caller can leave a stale "active" entry serving a
 * deactivated key for up to a year.
 */

function fakeKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string, _type?: string) => {
      const raw = store.get(key);
      return raw ? JSON.parse(raw) : null;
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
}

describe('AgentHostService status mutations thread env through to the repo', () => {
  it('setStatus passes env to repo.updateStatus (so invalidation lives with the mutation)', async () => {
    const env = { AUTH_CACHE_KV: undefined } as unknown as Env;
    const updateStatus: IAgentHostRepository['updateStatus'] = vi.fn(async () => null);
    const repo = { updateStatus } as unknown as IAgentHostRepository;
    const service = new AgentHostService(repo);

    await service.setStatus(7, 42, 'suspended', env);

    expect(updateStatus).toHaveBeenCalledTimes(1);
    // (id, tenantId, status, env)
    expect(updateStatus).toHaveBeenCalledWith(7, 42, 'suspended', env);
  });

  it('deactivate threads env and sets inactive', async () => {
    const env = { AUTH_CACHE_KV: undefined } as unknown as Env;
    const updateStatus: IAgentHostRepository['updateStatus'] = vi.fn(async () => null);
    const repo = { updateStatus } as unknown as IAgentHostRepository;
    const service = new AgentHostService(repo);

    await service.deactivate(7, 42, env);

    expect(updateStatus).toHaveBeenCalledWith(7, 42, 'inactive', env);
  });
});

describe('invalidateAgentHostKeyCache', () => {
  it('writes a clk tombstone for a present hash', async () => {
    const kv = fakeKv();
    const env = { AUTH_CACHE_KV: kv as unknown } as unknown as Env;

    await invalidateAgentHostKeyCache(env, 'abc123');

    expect(kv.put).toHaveBeenCalledTimes(1);
    const [key, value] = kv.put.mock.calls[0]!;
    expect(key).toBe('auth:clk:abc123');
    expect(JSON.parse(value as string)).toEqual({ revoked: true });
  });

  it('no-ops when the hash is null/undefined (NULL apiKeyHash rows)', async () => {
    const kv = fakeKv();
    const env = { AUTH_CACHE_KV: kv as unknown } as unknown as Env;

    await invalidateAgentHostKeyCache(env, null);
    await invalidateAgentHostKeyCache(env, undefined);

    expect(kv.put).not.toHaveBeenCalled();
  });

  it('no-ops cleanly when the KV binding is absent', async () => {
    const env = { AUTH_CACHE_KV: undefined } as unknown as Env;
    await expect(invalidateAgentHostKeyCache(env, 'abc123')).resolves.toBeUndefined();
  });
});
