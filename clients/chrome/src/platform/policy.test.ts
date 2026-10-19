import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformAccessDenied, platformSendPermission } from '@builderforce/local-first';
import { createMemoryOutboxStore, createOnlineSignal, createOutbox } from '@builderforce/write-outbox';
import { createRovrGuardedFetch, platformCapabilityFor } from './guardedFetch';
import { createMemoryKeyValue } from './keyValue';
import { createRovrPlatformPolicy } from './policy';

describe('Rovr platform policy', () => {
  it('denies every capability by default, including on a fresh store', async () => {
    const policy = createRovrPlatformPolicy(createMemoryKeyValue());
    await policy.ready();
    const snapshot = policy.snapshot();
    expect(Object.values(snapshot).every((on) => on === false)).toBe(true);
    expect(policy.allows('synchronize')).toBe(false);
    expect(policy.allows('gateway-inference')).toBe(false);
    expect(() => policy.assert('synchronize')).toThrow(PlatformAccessDenied);
    // Authentication is implied by any connected capability, never standing alone.
    expect(policy.allows('authenticate')).toBe(false);
  });

  it('persists each capability independently and reads it back in a new context', async () => {
    const storage = createMemoryKeyValue();
    const panel = createRovrPlatformPolicy(storage);
    await panel.ready();
    await panel.setCapability('synchronize', true);

    // The service worker is another context over the SAME storage: it sees the grant,
    // and only the grant — gateway inference stays denied.
    const worker = createRovrPlatformPolicy(storage);
    await worker.ready();
    expect(worker.allows('synchronize')).toBe(true);
    expect(worker.allows('authenticate')).toBe(true); // implied by sync
    expect(worker.allows('gateway-inference')).toBe(false);

    await panel.setCapability('gatewayInference', true);
    const again = createRovrPlatformPolicy(storage);
    await again.ready();
    expect(again.snapshot()).toMatchObject({ synchronize: true, gatewayInference: true, connectedFeatures: false });
  });

  it('follows changes made in another context, including revocation back to the default', async () => {
    const storage = createMemoryKeyValue();
    const panel = createRovrPlatformPolicy(storage);
    const worker = createRovrPlatformPolicy(storage);
    await Promise.all([panel.ready(), worker.ready()]);

    await panel.setCapability('synchronize', true);
    await vi.waitFor(() => expect(worker.allows('synchronize')).toBe(true));

    // Revoking removes the value's effect everywhere; an absent key is the denial default.
    await storage.remove('policy.synchronize');
    await vi.waitFor(() => expect(worker.allows('synchronize')).toBe(false));
    expect(worker.allows('authenticate')).toBe(false);
  });

  it('gates every outbox send path absolutely while sync is disabled, and resumes on grant', async () => {
    const storage = createMemoryKeyValue();
    const policy = createRovrPlatformPolicy(storage);
    await policy.ready();
    const sent: string[] = [];
    const outbox = createOutbox<string, string>({
      send: (_key, items) => {
        sent.push(...items);
      },
      store: createMemoryOutboxStore<string, string>(),
      online: createOnlineSignal(true),
      sendPermission: platformSendPermission(policy),
      retry: {},
    });

    outbox.enqueue('chat', 'queued while denied');
    await outbox.flush(); // explicit flush is NOT a bypass
    await expect(outbox.drainWith('chat', async () => ' ridden')).rejects.toMatchObject({ code: 'PLATFORM_SEND_DISABLED' });
    expect(sent).toEqual([]);
    expect(outbox.size()).toBe(1); // nothing dropped

    await policy.setCapability('synchronize', true);
    await vi.waitFor(() => expect(sent).toEqual(['queued while denied']));
    expect(outbox.size()).toBe(0);

    // Revocation stops sends again and keeps the backlog.
    await policy.setCapability('synchronize', false);
    outbox.enqueue('chat', 'after revocation');
    await outbox.flush();
    expect(sent).toEqual(['queued while denied']);
    expect(outbox.stats().queued).toBe(1);
    outbox.close();
  });

  it('grants nothing to being online or signed in', async () => {
    const storage = createMemoryKeyValue();
    const policy = createRovrPlatformPolicy(storage);
    await policy.ready();

    // Reaching the network is not consent.
    const online = createOnlineSignal(true);
    online.set(true);
    expect(online.isOnline()).toBe(true);
    expect(policy.allows('synchronize')).toBe(false);

    // Neither is holding a credential: writing one the way a sign-in does, with no
    // capability grant beside it, leaves the platform write and the gateway denied.
    await storage.set('session.key', 'bfk_live_example');
    await storage.set('session.tenantId', 7);
    await vi.waitFor(() => expect(policy.allows('synchronize')).toBe(false));
    expect(policy.allows('gateway-inference')).toBe(false);
    expect(policy.allows('authenticate')).toBe(false);
    expect(platformSendPermission(policy).isAllowed()).toBe(false);
  });

  it('classifies platform requests and leaves everything else ungated', () => {
    const base = 'https://builderforce.ai/gateway';
    // The same rules the VS Code host applies, so both modalities answer one way.
    expect(platformCapabilityFor(`${base}/api/auth/tenant-api-key-token`, { method: 'POST' })).toBe('authenticate');
    expect(platformCapabilityFor('https://api.builderforce.ai/llm/chat/completions', { method: 'POST' })).toBe(
      'gateway-inference',
    );
    expect(platformCapabilityFor(`${base}/api/brain/chats`, { method: 'POST' })).toBe('synchronize');
    expect(platformCapabilityFor(`${base}/api/tasks`)).toBe('connected-feature');
    expect(platformCapabilityFor(`${base}/api/tasks`, { method: 'HEAD' })).toBe('connected-feature');
    // On-device inference and direct providers are not the platform: never classified.
    expect(platformCapabilityFor('http://127.0.0.1:11434/api/generate', { method: 'POST' })).toBeNull();
    expect(platformCapabilityFor('https://api.anthropic.com/v1/messages', { method: 'POST' })).toBeNull();
    expect(platformCapabilityFor('not a url')).toBeNull();
  });

  describe('guarded platform fetch', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('never calls fetch for a denied capability', async () => {
      const policy = createRovrPlatformPolicy(createMemoryKeyValue());
      await policy.ready();
      const native = vi.fn(async () => new Response('{}'));
      vi.stubGlobal('fetch', native);
      const guarded = createRovrGuardedFetch({ policy });

      await expect(
        guarded('https://builderforce.ai/gateway/api/brain/chats', { method: 'POST' }),
      ).rejects.toBeInstanceOf(PlatformAccessDenied);
      await expect(
        guarded('https://api.builderforce.ai/llm/chat/completions', { method: 'POST' }),
      ).rejects.toBeInstanceOf(PlatformAccessDenied);
      await expect(
        guarded('https://builderforce.ai/gateway/api/auth/tenant-api-key-token', { method: 'POST' }),
      ).rejects.toBeInstanceOf(PlatformAccessDenied);
      expect(native).not.toHaveBeenCalled();

      // On-device inference still runs while every platform capability is denied.
      const loopback = new Response('{}');
      native.mockResolvedValueOnce(loopback);
      await expect(guarded('http://localhost:11434/api/generate', { method: 'POST' })).resolves.toBe(loopback);
      expect(native).toHaveBeenCalledTimes(1);
    });

    it('reports the denied request and sends an allowed one with redirects off', async () => {
      const policy = createRovrPlatformPolicy(createMemoryKeyValue());
      await policy.ready();
      await policy.setCapability('synchronize', true);
      const native = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(new Response('{}')));
      vi.stubGlobal('fetch', native);
      const outcomes: string[] = [];
      const guarded = createRovrGuardedFetch({ policy, onRequest: (record) => outcomes.push(record.outcome) });

      await guarded('https://builderforce.ai/gateway/api/tasks', { method: 'POST' });
      expect(native).toHaveBeenCalledTimes(1);
      // A BuilderForce URL can never be chased to an origin the classifier never saw.
      expect(native.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', redirect: 'error' });

      // Granting sync grants writing, not the gateway.
      await expect(
        guarded('https://api.builderforce.ai/llm/chat/completions', { method: 'POST' }),
      ).rejects.toBeInstanceOf(PlatformAccessDenied);
      expect(native).toHaveBeenCalledTimes(1);
      expect(outcomes).toEqual(['attempted', 'blocked']);
    });
  });
});

describe('the service worker composes the Rovr policy', () => {
  it('constructs the policy and gates the session and API fetch through it', () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../background/serviceWorker.ts'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).toContain('createRovrPlatformPolicy(');
    expect(code).toContain('createRovrGuardedFetch(');
    expect(code).toMatch(/const fetchImpl = createRovrGuardedFetch\(/);
    expect(code).toMatch(/createSession\(\{[\s\S]*?fetch:\s*fetchImpl/);
    expect(code).toMatch(/createApiClient\(\{[\s\S]*?fetch:\s*fetchImpl/);
    expect(code).not.toMatch(/fetch:\s*(globalThis\.)?fetch\b/);
    const ready = code.indexOf('await platformPolicy.ready()');
    const flush = code.indexOf('chatSync.flush()');
    expect(ready).toBeGreaterThan(-1);
    expect(flush).toBeGreaterThan(ready);
  });
});
