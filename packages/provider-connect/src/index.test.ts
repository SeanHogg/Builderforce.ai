import { describe, expect, it, vi } from 'vitest';
import {
  LOCAL_CREDENTIAL_REFRESH_MARGIN_MS,
  ProviderConnectError,
  awaitDeviceApproval,
  createLocalCredentialStore,
  fetchLocalCredential,
  startProviderConnect,
  type GatewayRequest,
} from './index.js';

/** A scripted gateway: each call takes the next answer. */
function scripted(answers: Array<{ status: number; body: unknown } | Error>): GatewayRequest & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (path: string) => {
    calls.push(path);
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    if (next instanceof Error) throw next;
    return next;
  }) as GatewayRequest & { calls: string[] };
  fn.calls = calls;
  return fn;
}

const clock = () => {
  let t = 1_000_000;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
};

describe('startProviderConnect', () => {
  it('reads a device start', async () => {
    const request = scripted([{ status: 200, body: { authorizeUrl: 'https://auth.kimi.com/d?c=AB', state: 's1', grant: 'device', userCode: 'AB-CD', pollIntervalSeconds: 3 } }]);
    const start = await startProviderConnect(request, 'kimi');
    expect(start).toEqual({ grant: 'device', authorizeUrl: 'https://auth.kimi.com/d?c=AB', state: 's1', userCode: 'AB-CD', intervalMs: 3000 });
    expect(request.calls).toEqual(['/llm/provider-keys/kimi/oauth/start']);
  });

  it('maps a refused start to unavailable', async () => {
    await expect(startProviderConnect(scripted([{ status: 502, body: { error: 'upstream down' } }]), 'kimi'))
      .rejects.toMatchObject({ reason: 'unavailable' });
  });
});

describe('awaitDeviceApproval', () => {
  it('waits through pending and slow_down, then resolves on ok', async () => {
    const c = clock();
    const sleep = vi.fn(c.sleep);
    const request = scripted([
      { status: 200, body: { ok: false, status: 'pending' } },
      new Error('offline'),
      { status: 200, body: { ok: false, status: 'slow_down' } },
      { status: 200, body: { ok: true, provider: 'kimi' } },
    ]);
    await awaitDeviceApproval(request, 'kimi', { state: 's', intervalMs: 2000 }, { sleep, now: c.now });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 2000, 2000, 7000]);
  });

  it('stops at once on a decline instead of polling out the window', async () => {
    const c = clock();
    const request = scripted([{ status: 400, body: { error: 'declined', code: 'oauth_denied' } }]);
    await expect(awaitDeviceApproval(request, 'kimi', { state: 's', intervalMs: 1000 }, c)).rejects.toMatchObject({ reason: 'denied' });
    expect(request.calls).toHaveLength(1);
  });

  it('reports expiry from the server and from the window', async () => {
    const c = clock();
    await expect(awaitDeviceApproval(scripted([{ status: 400, body: { code: 'oauth_state_expired' } }]), 'kimi', { state: 's', intervalMs: 1000 }, c))
      .rejects.toMatchObject({ reason: 'expired' });
    const pending = Array.from({ length: 5 }, () => ({ status: 200, body: { ok: false, status: 'pending' } }));
    await expect(awaitDeviceApproval(scripted(pending), 'kimi', { state: 's', intervalMs: 1000 }, { ...c, windowMs: 3000 }))
      .rejects.toBeInstanceOf(ProviderConnectError);
  });

  it('honours cancellation', async () => {
    const c = clock();
    const controller = new AbortController();
    controller.abort();
    await expect(awaitDeviceApproval(scripted([]), 'kimi', { state: 's', intervalMs: 1000 }, { ...c, signal: controller.signal }))
      .rejects.toMatchObject({ reason: 'cancelled' });
  });
});

const wire = (expiresAt: number) => ({
  provider: 'kimi',
  runtime: 'kimi-code',
  accessToken: 'at-1',
  expiresAt,
  baseUrl: 'https://api.kimi.com/coding/v1',
  models: [{ model: 'k3', displayName: 'Kimi K3', contextWindow: 1048576 }, { model: '' }],
});

describe('fetchLocalCredential', () => {
  it('decides each server answer', async () => {
    expect(await fetchLocalCredential(scripted([{ status: 404, body: { code: 'provider_not_connected' } }]), 'kimi')).toEqual({ kind: 'not_connected' });
    expect((await fetchLocalCredential(scripted([{ status: 409, body: { error: 'revoked' } }]), 'kimi')).kind).toBe('reconnect');
    expect((await fetchLocalCredential(scripted([new Error('offline')]), 'kimi')).kind).toBe('unavailable');
    const ok = await fetchLocalCredential(scripted([{ status: 200, body: wire(5) }]), 'kimi');
    expect(ok.kind === 'credential' && ok.credential.models).toEqual([{ model: 'k3', displayName: 'Kimi K3', contextWindow: 1048576 }]);
  });
});

describe('createLocalCredentialStore', () => {
  const memory = () => {
    const map = new Map<string, string>();
    return { map, get: async (k: string) => map.get(k), set: async (k: string, v: string) => { map.set(k, v); }, delete: async (k: string) => { map.delete(k); } };
  };

  it('persists, reuses while fresh, and refetches inside the margin', async () => {
    let now = 0;
    const store = memory();
    const request = scripted([
      { status: 200, body: wire(15 * 60 * 1000) },
      { status: 200, body: { ...wire(30 * 60 * 1000), accessToken: 'at-2' } },
    ]);
    const credentials = createLocalCredentialStore({ request, provider: 'kimi', store, now: () => now });
    const first = await credentials.resolve();
    expect(first.kind === 'credential' && first.credential.accessToken).toBe('at-1');
    await credentials.resolve();
    expect(request.calls).toHaveLength(1);

    // A restart reads the persisted copy without a round trip.
    const restarted = createLocalCredentialStore({ request, provider: 'kimi', store, now: () => now });
    await restarted.hydrate();
    expect(restarted.snapshot()?.baseUrl).toBe('https://api.kimi.com/coding/v1');

    now = 15 * 60 * 1000 - LOCAL_CREDENTIAL_REFRESH_MARGIN_MS + 1;
    const second = await credentials.resolve();
    expect(second.kind === 'credential' && second.credential.accessToken).toBe('at-2');
  });

  it('shares one fetch between concurrent callers', async () => {
    const request = scripted([{ status: 200, body: wire(60 * 60 * 1000) }]);
    const credentials = createLocalCredentialStore({ request, provider: 'kimi', store: memory(), now: () => 0 });
    await Promise.all([credentials.resolve(), credentials.resolve(), credentials.resolve()]);
    expect(request.calls).toHaveLength(1);
  });

  it('drops the cache on a definite disconnect but keeps it through a blip', async () => {
    let now = 0;
    const store = memory();
    const request = scripted([
      { status: 200, body: wire(10 * 60 * 1000) },
      new Error('offline'),
      { status: 404, body: { code: 'provider_not_connected' } },
    ]);
    const credentials = createLocalCredentialStore({ request, provider: 'kimi', store, now: () => now });
    await credentials.resolve();
    now = 9 * 60 * 1000;
    expect((await credentials.resolve()).kind).toBe('unavailable');
    expect(credentials.snapshot()).not.toBeNull();
    expect((await credentials.resolve()).kind).toBe('not_connected');
    expect(credentials.snapshot()).toBeNull();
    expect(store.map.size).toBe(0);
  });
});
