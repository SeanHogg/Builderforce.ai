import { describe, expect, it } from 'vitest';
import { completeDeviceSignIn, DeviceAuthError, revokeKey, startDeviceSignIn, type DeviceAuthDeps } from './index';

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Fake deps: a scripted response queue, a virtual clock and a recorded opener. */
function fakeDeps(responses: Array<Response | Error>) {
  let clock = 0;
  const calls: Array<{ url: string; body: unknown }> = [];
  const opened: string[] = [];
  const deps: DeviceAuthDeps = {
    baseUrl: 'https://api.example',
    client: 'test',
    fetch: async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const next = responses.shift();
      if (!next) throw new Error('no scripted response');
      if (next instanceof Error) throw next;
      return next;
    },
    openTab: (url) => { opened.push(url); },
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
  };
  return { deps, calls, opened };
}

const START = { device_code: 'dc', user_code: 'ABCD', verification_uri: 'https://app/activate', verification_uri_complete: 'https://app/activate?c=ABCD', interval: 1, expires_in: 60 };

async function rejection(p: Promise<unknown>): Promise<DeviceAuthError> {
  try { await p; } catch (e) { if (e instanceof DeviceAuthError) return e; throw e; }
  throw new Error('expected a DeviceAuthError');
}

describe('startDeviceSignIn', () => {
  it('posts the client name and reads the code pair', async () => {
    const { deps, calls } = fakeDeps([json(200, START)]);
    const start = await startDeviceSignIn(deps);
    expect(calls[0]).toEqual({ url: 'https://api.example/api/auth/device/code', body: { client: 'test' } });
    expect(start).toMatchObject({ deviceCode: 'dc', userCode: 'ABCD', verificationUrl: 'https://app/activate?c=ABCD', intervalMs: 1000, expiresAt: 60_000 });
  });

  it('is unavailable when the endpoint is absent, unreachable or malformed', async () => {
    expect((await rejection(startDeviceSignIn(fakeDeps([json(404)]).deps))).reason).toBe('unavailable');
    expect((await rejection(startDeviceSignIn(fakeDeps([new Error('offline')]).deps))).reason).toBe('unavailable');
    expect((await rejection(startDeviceSignIn(fakeDeps([json(200, { user_code: 'x' })]).deps))).reason).toBe('unavailable');
  });
});

describe('completeDeviceSignIn', () => {
  it('opens the approval page, polls through pending / slow_down / a network blip, and yields the key', async () => {
    const { deps, calls, opened } = fakeDeps([json(200, START), json(428), json(429), new Error('blip'), json(200, { access_key: 'bfk_1', tenant_id: 7 })]);
    const start = await startDeviceSignIn(deps);
    await expect(completeDeviceSignIn(deps, start)).resolves.toEqual({ accessKey: 'bfk_1', tenantId: 7 });
    expect(opened).toEqual(['https://app/activate?c=ABCD']);
    expect(calls.slice(1).every((c) => c.url.endsWith('/api/auth/device/token'))).toBe(true);
  });

  it('maps denied, expired and an aborted wait to their reasons', async () => {
    for (const [status, reason] of [[403, 'denied'], [410, 'expired'], [500, 'failed']] as const) {
      const { deps } = fakeDeps([json(200, START), json(status)]);
      expect((await rejection(completeDeviceSignIn(deps, await startDeviceSignIn(deps)))).reason).toBe(reason);
    }
    const aborted = new AbortController();
    aborted.abort();
    const { deps } = fakeDeps([json(200, START)]);
    expect((await rejection(completeDeviceSignIn(deps, await startDeviceSignIn(deps), aborted.signal))).reason).toBe('cancelled');
  });

  it('expires once the code outlives its window', async () => {
    const pending = Array.from({ length: 70 }, () => json(428));
    const { deps } = fakeDeps([json(200, START), ...pending]);
    expect((await rejection(completeDeviceSignIn(deps, await startDeviceSignIn(deps)))).reason).toBe('expired');
  });
});

describe('revokeKey', () => {
  it('posts the key and never throws', async () => {
    const { deps, calls } = fakeDeps([new Error('offline')]);
    await expect(revokeKey(deps, 'bfk_1')).resolves.toBeUndefined();
    expect(calls[0]).toEqual({ url: 'https://api.example/api/auth/keys/revoke', body: { apiKey: 'bfk_1' } });
  });
});
