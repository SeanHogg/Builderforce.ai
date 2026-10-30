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

  it('persists each advanced override independently and reads it back in a new context', async () => {
    const storage = createMemoryKeyValue({ 'session.key': 'bfk_live_example' });
    const panel = createRovrPlatformPolicy(storage);
    await panel.ready();
    await panel.setCapability('synchronize', true);

    // The service worker is another context over the SAME storage: it sees the grant on
    // top of the signed-in default (Hybrid), and only the grant.
    const worker = createRovrPlatformPolicy(storage);
    await worker.ready();
    expect(worker.allows('synchronize')).toBe(true);
    expect(worker.allows('gateway-inference')).toBe(true);

    await panel.setCapability('gatewayInference', false);
    const again = createRovrPlatformPolicy(storage);
    await again.ready();
    expect(again.snapshot()).toMatchObject({ synchronize: true, gatewayInference: false, connectedFeatures: true });
  });

  it('follows changes made in another context, including revocation back to the mode default', async () => {
    const storage = createMemoryKeyValue({ 'session.key': 'bfk_live_example' });
    const panel = createRovrPlatformPolicy(storage);
    const worker = createRovrPlatformPolicy(storage);
    await Promise.all([panel.ready(), worker.ready()]);

    await panel.setCapability('synchronize', true);
    await vi.waitFor(() => expect(worker.allows('synchronize')).toBe(true));

    // Removing the override hands the capability back to the mode: Hybrid keeps sync off.
    await storage.remove('policy.synchronize');
    await vi.waitFor(() => expect(worker.allows('synchronize')).toBe(false));
  });

  // The send gate is "the platform is reachable" (gateway, connected features or sync), not the
  // sync switch: 7dbaaeb25 (2026-10-22) moved it, because gating run writes, activity beats and
  // outcomes on sync held a Hybrid run's own writes (`platform_send_disabled`). The absolute gate
  // is therefore proved where nothing is reachable - a signed-out person in Local only.
  it('gates every outbox send path absolutely while the platform is unreachable, and resumes when the person reaches it', async () => {
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

    // Signing in moves an undecided person onto Hybrid: the platform is reachable, so the backlog
    // goes and a request may carry the queue - with sync still off (`synchronize` waits for its own grant).
    await storage.set('session.key', 'bfk_live_example');
    await vi.waitFor(() => expect(sent).toEqual(['queued while denied']));
    expect(outbox.size()).toBe(0);
    expect(policy.allows('synchronize')).toBe(false);
    await expect(outbox.drainWith('chat', async () => ' ridden')).resolves.toBe(' ridden');

    // Signing out makes the platform unreachable again: sends stop and the backlog is kept.
    await storage.remove('session.key');
    await vi.waitFor(() => expect(policy.allows('gateway-inference')).toBe(false));
    outbox.enqueue('chat', 'after sign-out');
    await outbox.flush();
    expect(sent).toEqual(['queued while denied']);
    expect(outbox.stats().queued).toBe(1);
    outbox.close();
  });

  it('grants nothing to being online; signing in moves an undecided person onto Hybrid', async () => {
    const storage = createMemoryKeyValue();
    const policy = createRovrPlatformPolicy(storage);
    await policy.ready();

    // Reaching the network is not consent.
    const online = createOnlineSignal(true);
    online.set(true);
    expect(online.isOnline()).toBe(true);
    expect(policy.allows('synchronize')).toBe(false);
    expect(policy.inferenceMode()).toEqual({ mode: 'local-only', chosen: false, signedIn: false, loaded: true });
    expect(platformSendPermission(policy).isAllowed()).toBe(false); // genuinely unreachable

    // Signing in (unchosen) is Hybrid: the gateway and connected features open, so the
    // person's turns and reads work — but sync still waits for its own grant.
    await storage.set('session.key', 'bfk_live_example');
    await storage.set('session.tenantId', 7);
    await vi.waitFor(() => expect(policy.allows('gateway-inference')).toBe(true));
    expect(policy.inferenceMode()).toEqual({ mode: 'hybrid', chosen: false, signedIn: true, loaded: true });
    expect(policy.allows('connected-feature')).toBe(true);
    expect(policy.allows('authenticate')).toBe(true);
    expect(policy.allows('synchronize')).toBe(false);
    // The send permission is "the platform is reachable", not the sync switch (7dbaaeb25, 2026-10-22):
    // a signed-in Hybrid person's activity beats, run writes and outcomes go with sync still off.
    expect(platformSendPermission(policy).isAllowed()).toBe(true);

    // Signing out returns to Local only.
    await storage.remove('session.key');
    await vi.waitFor(() => expect(policy.allows('gateway-inference')).toBe(false));
  });

  describe('inference mode', () => {
    it('is not a mode until storage has been read — never Local only shown to a Hybrid person', async () => {
      const storage = createMemoryKeyValue({ 'session.key': 'bfk_live_example', 'policy.inferenceMode': 'hybrid' });
      const policy = createRovrPlatformPolicy(storage);
      expect(policy.inferenceMode().loaded).toBe(false);
      await policy.ready();
      expect(policy.inferenceMode()).toEqual({ mode: 'hybrid', chosen: true, signedIn: true, loaded: true });
    });

    it('persists a chosen mode under policy.inferenceMode and every context follows it', async () => {
      const storage = createMemoryKeyValue({ 'session.key': 'bfk_live_example' });
      const panel = createRovrPlatformPolicy(storage);
      const worker = createRovrPlatformPolicy(storage);
      await Promise.all([panel.ready(), worker.ready()]);
      const seen: string[] = [];
      worker.subscribeMode((state) => seen.push(state.mode));

      await panel.setInferenceMode('local-only');
      expect(await storage.get('policy.inferenceMode')).toBe('local-only');
      expect(panel.inferenceMode()).toEqual({ mode: 'local-only', chosen: true, signedIn: true, loaded: true });
      expect(panel.allows('gateway-inference')).toBe(false);
      await vi.waitFor(() => expect(worker.inferenceMode().mode).toBe('local-only'));
      expect(seen).toContain('local-only');

      const restarted = createRovrPlatformPolicy(storage);
      await restarted.ready();
      expect(restarted.inferenceMode()).toMatchObject({ mode: 'local-only', chosen: true });
    });

    it('Local only keeps the gateway, connected features, sync and direct providers off whatever an override says', async () => {
      const storage = createMemoryKeyValue({
        'session.key': 'bfk_live_example',
        'policy.inferenceMode': 'local-only',
        'policy.gatewayInference': true,
        'policy.connectedFeatures': true,
        'policy.synchronize': true,
        'policy.directProviders': true,
      });
      const policy = createRovrPlatformPolicy(storage);
      await policy.ready();
      expect(policy.snapshot()).toMatchObject({ gatewayInference: false, connectedFeatures: false, synchronize: false, directProviders: false });
    });

    it('Specific opens direct providers; an invalid stored mode reads as unchosen', async () => {
      const storage = createMemoryKeyValue({ 'session.key': 'bfk_live_example', 'policy.inferenceMode': 'specific' });
      const policy = createRovrPlatformPolicy(storage);
      await policy.ready();
      expect(policy.allows('direct-provider')).toBe(true);
      await storage.set('policy.inferenceMode', 'cloud');
      await vi.waitFor(() => expect(policy.inferenceMode()).toMatchObject({ mode: 'hybrid', chosen: false }));
    });
  });

  it('classifies platform requests and leaves everything else ungated', () => {
    const base = 'https://builderforce.ai/gateway';
    // The same rules the VS Code host applies, so both modalities answer one way.
    expect(platformCapabilityFor(`${base}/api/auth/tenant-api-key-token`, { method: 'POST' })).toBe('authenticate');
    expect(platformCapabilityFor('https://api.builderforce.ai/llm/chat/completions', { method: 'POST' })).toBe(
      'gateway-inference',
    );
    // Binding a chat to the account sends its title and project only - never the transcript - so it is a
    // connected feature, not a write (9f6feefa7, 2026-10-24; `platformRoutes.test.ts` holds the table).
    expect(platformCapabilityFor(`${base}/api/brain/chats`, { method: 'POST' })).toBe('connected-feature');
    // The transcript itself still rides the sync gate: a POST that is not a read.
    expect(platformCapabilityFor(`${base}/api/brain/chats/3/messages`, { method: 'POST' })).toBe('synchronize');
    // A POST that READS is a connected feature (the shared route table), behind the mount too.
    expect(platformCapabilityFor(`${base}/api/limbic/block`, { method: 'POST' })).toBe('connected-feature');
    expect(platformCapabilityFor(`${base}/llm/v1/models`, { method: 'POST' })).toBe('connected-feature');
    expect(platformCapabilityFor('https://api.builderforce.ai/api/limbic/block', { method: 'POST' })).toBe('connected-feature');
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

    it("signed-in Hybrid with sync off: a run's writes, transcript and stream go (the web's and the editor's answer)", async () => {
      const policy = createRovrPlatformPolicy(createMemoryKeyValue({ 'session.key': 'bfk_live_example' }));
      await policy.ready();
      expect(policy.inferenceMode().mode).toBe('hybrid');
      expect(policy.allows('synchronize')).toBe(false);
      const native = vi.fn(async () => new Response('{}'));
      vi.stubGlobal('fetch', native);
      const guarded = createRovrGuardedFetch({ policy });
      await guarded('https://builderforce.ai/gateway/api/projects/11/tickets', { method: 'POST' });
      await guarded('https://builderforce.ai/gateway/api/brain/chats/3/messages', { method: 'POST' });
      await guarded('https://builderforce.ai/gateway/api/brain/stream', { method: 'POST' });
      expect(native).toHaveBeenCalledTimes(3);
      await expect(
        guarded('https://builderforce.ai/gateway/api/sync/v1/push', { method: 'POST' }),
      ).rejects.toMatchObject({ capability: 'synchronize' });
      expect(native).toHaveBeenCalledTimes(3);
    });

    it('signed out (Local only): never calls fetch for inference or content — the shared gate', async () => {
      const policy = createRovrPlatformPolicy(createMemoryKeyValue());
      await policy.ready();
      const native = vi.fn(async () => new Response('{}'));
      vi.stubGlobal('fetch', native);
      const guarded = createRovrGuardedFetch({ policy });

      await expect(
        guarded('https://builderforce.ai/gateway/api/brain/chats/3/messages', { method: 'POST' }),
      ).rejects.toBeInstanceOf(PlatformAccessDenied);
      await expect(
        guarded('https://api.builderforce.ai/llm/chat/completions', { method: 'POST' }),
      ).rejects.toBeInstanceOf(PlatformAccessDenied);
      await expect(
        guarded('https://builderforce.ai/gateway/api/limbic/block', { method: 'POST' }),
      ).rejects.toBeInstanceOf(PlatformAccessDenied);
      expect(native).not.toHaveBeenCalled();

      // On-device inference still runs while every platform capability is denied.
      const loopback = new Response('{}');
      native.mockResolvedValueOnce(loopback);
      await expect(guarded('http://localhost:11434/api/generate', { method: 'POST' })).resolves.toBe(loopback);
      expect(native).toHaveBeenCalledTimes(1);
    });

    it('reports the denied request and sends an allowed one with redirects off', async () => {
      const policy = createRovrPlatformPolicy(createMemoryKeyValue({ 'session.key': 'bfk_live_example' }));
      await policy.ready();
      await policy.setCapability('synchronize', true);
      await policy.setCapability('gatewayInference', false);
      const native = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(new Response('{}')));
      vi.stubGlobal('fetch', native);
      const outcomes: string[] = [];
      const guarded = createRovrGuardedFetch({ policy, onRequest: (record) => outcomes.push(record.outcome) });

      await guarded('https://builderforce.ai/gateway/api/tasks', { method: 'POST' });
      expect(native).toHaveBeenCalledTimes(1);
      // A BuilderForce URL can never be chased to an origin the classifier never saw.
      expect(native.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', redirect: 'error' });

      // Granting sync grants writing, not the gateway the person switched off.
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
