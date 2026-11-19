import { describe, expect, it, vi } from 'vitest';
import { testAccountFromThisMachine, type AccountUnderTest, type FetchLike } from './accountTest.js';
import { accountTestHealth, createConnectedAccounts } from './connectedAccounts.js';
import type { GatewayRequest } from './port.js';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const KIMI: AccountUnderTest = {
  provider: 'kimi',
  endpoint: { baseUrl: 'https://api.kimi.ai/coding/v1', token: 'tok-1' },
  model: 'k3',
  providerSampling: true,
};

describe('testAccountFromThisMachine', () => {
  it('lists the account’s models with its own bearer, from this machine: working on the lead model', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json(200, { data: [{ id: 'k3' }] }));
    expect(await testAccountFromThisMachine(KIMI, fetchImpl)).toEqual({ kind: 'working', provider: 'kimi', model: 'k3', status: 200 });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.kimi.ai/coding/v1/models');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-1');
  });

  it('a runtime with no catalog route is asked a 1-token completion on the lead model (no temperature where the provider picks sampling)', async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url) => (url.endsWith('/models') ? json(404, { error: 'not found' }) : json(200, { choices: [] })));
    expect(await testAccountFromThisMachine(KIMI, fetchImpl)).toMatchObject({ kind: 'working', model: 'k3' });
    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(url).toBe('https://api.kimi.ai/coding/v1/chat/completions');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'k3', max_tokens: 1 });
    expect(body).not.toHaveProperty('temperature');
  });

  it('401: the provider’s own status and message, remedy reconnect (after the one replacement token a real turn gets)', async () => {
    const credential = vi.fn(async (rejected?: string) => (rejected ? 'tok-2' : 'tok-1'));
    const fetchImpl = vi.fn<FetchLike>(async () => json(401, { error: { message: 'The API Key appears to be invalid', type: 'invalid_authentication_error' } }));
    const outcome = await testAccountFromThisMachine({ ...KIMI, endpoint: { ...KIMI.endpoint, credential } }, fetchImpl);
    expect(outcome).toEqual({
      kind: 'refused', provider: 'kimi', model: 'k3', status: 401, message: 'The API Key appears to be invalid', remedy: 'reconnect',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[1]![1].headers as Record<string, string>).authorization).toBe('Bearer tok-2');
    expect(accountTestHealth(outcome)).toBe('rejected');
  });

  it.each([402, 429])('%i: capacity — remedy wait', async (status) => {
    const fetchImpl = vi.fn<FetchLike>(async () => json(status, { error: { message: 'quota exhausted' } }));
    const outcome = await testAccountFromThisMachine(KIMI, fetchImpl);
    expect(outcome).toMatchObject({ kind: 'refused', status, message: 'quota exhausted', remedy: 'wait' });
    expect(accountTestHealth(outcome)).toBe('capacity');
  });

  it('a non-JSON refusal (an edge HTML page) carries its text', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response('<html>blocked</html>', { status: 403 }));
    expect(await testAccountFromThisMachine(KIMI, fetchImpl)).toMatchObject({ status: 403, message: '<html>blocked</html>', remedy: 'reconnect' });
  });

  it('no answer at all: unreachable, never a throw', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => { throw new Error('getaddrinfo ENOTFOUND'); });
    const outcome = await testAccountFromThisMachine(KIMI, fetchImpl);
    expect(outcome).toEqual({ kind: 'unreachable', provider: 'kimi', detail: 'getaddrinfo ENOTFOUND' });
    expect(accountTestHealth(outcome)).toBeNull();
  });
});

describe('ConnectedAccounts.testFromThisMachine', () => {
  const memoryStore = () => {
    const map = new Map<string, string>();
    return { get: async (k: string) => map.get(k), set: async (k: string, v: string) => { map.set(k, v); }, delete: async (k: string) => { map.delete(k); } };
  };
  const credential = {
    provider: 'kimi', runtime: 'kimi-code', accessToken: 'tok-1', expiresAt: Date.now() + 15 * 60_000,
    baseUrl: 'https://api.kimi.ai/coding/v1', models: [{ model: 'k3', displayName: 'Kimi K3' }],
  };

  it('resolves the account’s credential and probes its lead model from this machine', async () => {
    const request = vi.fn<GatewayRequest>(async () => ({ status: 200, body: credential }));
    const accounts = createConnectedAccounts({ request, store: memoryStore(), now: Date.now });
    const fetchImpl = vi.fn<FetchLike>(async () => json(200, { data: [] }));
    expect(await accounts.testFromThisMachine('kimi', fetchImpl)).toEqual({ kind: 'working', provider: 'kimi', model: 'k3', status: 200 });
    // The gateway is asked only for the credential — never its own Test.
    expect(request.mock.calls.map(([path]) => path)).toEqual(['/llm/provider-keys/kimi/local-credential']);
  });

  it('not connected: says so (no request to the provider)', async () => {
    const request = vi.fn<GatewayRequest>(async () => ({ status: 404, body: { code: 'provider_not_connected' } }));
    const accounts = createConnectedAccounts({ request, store: memoryStore(), now: Date.now });
    const fetchImpl = vi.fn<FetchLike>();
    expect(await accounts.testFromThisMachine('kimi', fetchImpl)).toEqual({ kind: 'connect', provider: 'kimi', reason: 'not_connected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a provider this client does not call itself: null (the gateway’s Test runs)', async () => {
    const accounts = createConnectedAccounts({ request: vi.fn<GatewayRequest>(), store: memoryStore(), now: Date.now });
    expect(await accounts.testFromThisMachine('anthropic', vi.fn<FetchLike>())).toBeNull();
  });
});
