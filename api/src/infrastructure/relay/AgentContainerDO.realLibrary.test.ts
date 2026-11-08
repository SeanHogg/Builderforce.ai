/**
 * AgentContainerDO against the REAL `@cloudflare/containers` Container class (only the
 * `cloudflare:workers` runtime module and the DO ctx are faked). Proves the claim the egress
 * flag rests on: with enforcement OFF nothing in the library's interception path runs, and
 * with it ON registering after construction / before super() really does turn interception on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; }
  },
  WorkerEntrypoint: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; }
  },
}));
vi.mock('../../application/observability/durableErrorReporter', () => ({ createDurableErrorReporter: () => vi.fn() }));
vi.mock('../../application/runtime/previewSessions', () => ({ PREVIEW_CONTROL_STOP_PATH: '/__preview_control__/stop' }));

function fakeCtx(name: string | undefined, opts: { running?: boolean; persisted?: Record<string, unknown> } = {}) {
  // One keyspace for the sync `kv` API and the async storage API, as in a real DO.
  const kv = new Map<string, unknown>(Object.entries(opts.persisted ?? {}));
  const container = {
    running: opts.running ?? false,
    start: vi.fn(),
    monitor: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
    signal: vi.fn(),
    interceptOutboundHttp: vi.fn(async () => undefined),
    interceptOutboundHttps: vi.fn(async () => undefined),
    interceptAllOutboundHttp: vi.fn(async () => undefined),
  };
  container.destroy.mockImplementation(async () => { container.running = false; });
  const proxy = vi.fn(() => ({ fetch: vi.fn() }));
  const blocking: Array<Promise<unknown>> = [];
  const ctx = {
    id: { name, toString: () => `id-${name ?? 'nameless'}` },
    storage: {
      kv: { get: vi.fn((k: string) => kv.get(k)), put: vi.fn((k: string, v: unknown) => { kv.set(k, v); }), delete: vi.fn((k: string) => kv.delete(k)) },
      sql: { exec: vi.fn(() => []) },
      get: vi.fn(async (k: string) => kv.get(k)),
      put: vi.fn(async (k: string, v: unknown) => { kv.set(k, v); }),
      delete: vi.fn(async (k: string) => kv.delete(k)),
      setAlarm: vi.fn(async () => undefined),
      getAlarm: vi.fn(async () => null),
      sync: vi.fn(async () => undefined),
    },
    blockConcurrencyWhile: (fn: () => Promise<unknown>) => { const p = fn(); blocking.push(p); return p; },
    container,
    exports: { ContainerProxy: proxy },
  };
  return { ctx, kv, container, proxy, settled: () => Promise.all(blocking) };
}

async function load() {
  vi.resetModules(); // the library's handler registry is module-global
  return (await import('./AgentContainerDO')).AgentContainerDO;
}

const OUTBOUND_KEY = 'OUTBOUND_CONFIGURATION';

beforeEach(() => { vi.spyOn(console, 'info').mockImplementation(() => {}); });

describe('real Container class', () => {
  it.each([[{}], [{ SANDBOX_EGRESS_ENFORCE: 'false' }]])('enforcement OFF (%j): no interception call, no outbound-config write, nothing registered', async (env) => {
    const AgentContainerDO = await load();
    const f = fakeCtx('exec:9');
    const container = new AgentContainerDO(f.ctx as never, env as never);
    await f.settled();
    expect(AgentContainerDO.outboundHandlers).toBeUndefined();
    expect(container.usingInterception).toBe(false);
    // Drive the library's own refresh: with interception off it must be a no-op.
    await (container as unknown as { refreshOutboundInterception(): Promise<void> }).refreshOutboundInterception();
    await expect(container.setOutboundHandler('egressAllowlist', { executionId: 9, internalHost: null })).rejects.toThrow(/not found/);
    expect(f.proxy).not.toHaveBeenCalled();
    expect(f.container.interceptAllOutboundHttp).not.toHaveBeenCalled();
    expect(f.container.interceptOutboundHttps).not.toHaveBeenCalled();
    expect(f.container.interceptOutboundHttp).not.toHaveBeenCalled();
    expect(f.ctx.storage.kv.put.mock.calls.filter(([k]) => k === OUTBOUND_KEY)).toHaveLength(0);
  });

  it('enforcement ON for an exec instance: registered before construction, so interception is on and the handler applies', async () => {
    const AgentContainerDO = await load();
    const f = fakeCtx('exec:9');
    const container = new AgentContainerDO(f.ctx as never, { SANDBOX_EGRESS_ENFORCE: 'true' } as never);
    await f.settled();
    expect(Object.keys(AgentContainerDO.outboundHandlers ?? {})).toContain('egressAllowlist');
    expect(container.usingInterception).toBe(true);
    container.enableInternet = false;
    await container.setOutboundHandler('egressAllowlist', { executionId: 9, internalHost: 'api.builderforce.ai' });
    expect(f.proxy).toHaveBeenCalledTimes(1);
    const props = (f.proxy.mock.calls[0] as unknown as [{ props: { enableInternet: boolean; interceptAll: boolean; outboundHandlerOverride: { method: string } } }])[0].props;
    expect(props.enableInternet).toBe(false);
    expect(props.interceptAll).toBe(true);
    expect(props.outboundHandlerOverride.method).toBe('egressAllowlist');
    expect(f.container.interceptAllOutboundHttp).toHaveBeenCalledTimes(1);
    expect(f.container.interceptOutboundHttps).toHaveBeenCalledWith('*', expect.anything());
    expect(f.ctx.storage.kv.put.mock.calls.filter(([k]) => k === OUTBOUND_KEY).length).toBeGreaterThan(0);
  });

  // An evicted exec DO rebuilt around a still-running container, with its interception config persisted.
  describe.each([['named exec:9', 'exec:9'], ['nameless', undefined]])('rebuild with persisted config + running container (%s)', (_label, name) => {
    const persisted = () => ({
      [OUTBOUND_KEY]: {
        outboundByHostOverrides: {},
        outboundHandlerOverride: { method: 'egressAllowlist', params: { executionId: 9, internalHost: 'api.builderforce.ai' } },
        hasInterceptAllRegistration: true,
      },
    });

    it('keeps the persisted handler override (registered before super) so the restored interception is NOT open', async () => {
      const AgentContainerDO = await load();
      // The marker says this container started restricted, so the DO leaves it running and the
      // library's constructor-time restore applies interception to it. (Without the marker the DO
      // destroys the container concurrently — covered below — and the library, finding it no longer
      // running, has nothing to apply.)
      const f = fakeCtx(name, { running: true, persisted: { ...persisted(), egressStartedRestricted: true } });
      const container = new AgentContainerDO(f.ctx as never, { SANDBOX_EGRESS_ENFORCE: 'true' } as never);
      await f.settled();
      expect((container as unknown as { outboundHandlerOverride?: { method: string } }).outboundHandlerOverride?.method).toBe('egressAllowlist');
      expect(f.proxy).toHaveBeenCalled();
      const props = (f.proxy.mock.calls[0] as unknown as [{ props: { interceptAll?: boolean; outboundHandlerOverride?: { method: string } } }])[0].props;
      expect(props.interceptAll).toBe(true);
      expect(props.outboundHandlerOverride?.method).toBe('egressAllowlist');
    });

    it('keeps the override on the instance even when the DO destroys the unmarked container', async () => {
      const AgentContainerDO = await load();
      const f = fakeCtx(name, { running: true, persisted: persisted() });
      const container = new AgentContainerDO(f.ctx as never, { SANDBOX_EGRESS_ENFORCE: 'true' } as never);
      await f.settled();
      expect((container as unknown as { outboundHandlerOverride?: { method: string } }).outboundHandlerOverride?.method).toBe('egressAllowlist');
    });

    it('destroys the running container proactively when it never recorded a restricted start', async () => {
      const AgentContainerDO = await load();
      const f = fakeCtx(name, { running: true, persisted: persisted() });
      new AgentContainerDO(f.ctx as never, { SANDBOX_EGRESS_ENFORCE: 'true' } as never);
      await f.settled();
      expect(f.container.destroy).toHaveBeenCalledTimes(1);
    });

    it('leaves a container that DID record a restricted start alone', async () => {
      const AgentContainerDO = await load();
      const f = fakeCtx(name, { running: true, persisted: { ...persisted(), egressStartedRestricted: true } });
      new AgentContainerDO(f.ctx as never, { SANDBOX_EGRESS_ENFORCE: 'true' } as never);
      await f.settled();
      expect(f.container.destroy).not.toHaveBeenCalled();
    });

    it('does nothing of the kind with enforcement OFF', async () => {
      const AgentContainerDO = await load();
      const f = fakeCtx(name, { running: true, persisted: persisted() });
      new AgentContainerDO(f.ctx as never, {} as never);
      await f.settled();
      expect(f.container.destroy).not.toHaveBeenCalled();
    });
  });

  // The library writes a per-host (zero-host) config for EVERY instance once any exec instance has
  // registered in the isolate. That bare config must not make a scan or managed host "ours".
  describe.each([['named non-exec', 'webscan:1'], ['nameless', undefined]])('scan / managed host with a bare library config + running container (%s)', (_label, name) => {
    const bare = () => ({ [OUTBOUND_KEY]: { outboundByHostOverrides: undefined, hasInterceptAllRegistration: undefined } });

    it('is neither destroyed nor restricted', async () => {
      const AgentContainerDO = await load();
      const f = fakeCtx(name, { running: true, persisted: bare() });
      const container = new AgentContainerDO(f.ctx as never, { SANDBOX_EGRESS_ENFORCE: 'true' } as never);
      await f.settled();
      expect(f.container.destroy).not.toHaveBeenCalled();
      expect(container.enableInternet).toBe(true);
      expect((container as unknown as { outboundHandlerOverride?: unknown }).outboundHandlerOverride).toBeUndefined();
    });

    it('is not put under the allowlist or destroyed by the idle handler either', async () => {
      const AgentContainerDO = await load();
      const f = fakeCtx(name, { running: true, persisted: bare() });
      const container = new AgentContainerDO(f.ctx as never, { SANDBOX_EGRESS_ENFORCE: 'true' } as never);
      await f.settled();
      const stop = vi.spyOn(container, 'stop').mockResolvedValue(undefined); // the idle handler's normal outcome
      await container.onActivityExpired();
      expect(f.container.destroy).not.toHaveBeenCalled();
      expect(stop).toHaveBeenCalledTimes(1);
    });
  });

  it('the idle handler destroys a restricted container that never recorded a restricted start, instead of keeping it alive', async () => {
    const AgentContainerDO = await load();
    const f = fakeCtx('exec:9');
    const container = new AgentContainerDO(f.ctx as never, { SANDBOX_EGRESS_ENFORCE: 'true' } as never);
    await f.settled();
    f.container.running = true; // e.g. a start after a timed-out destroy left it up, marker absent
    f.container.destroy.mockClear();
    const renew = vi.spyOn(container, 'renewActivityTimeout');
    await container.onActivityExpired();
    expect(f.container.destroy).toHaveBeenCalledTimes(1);
    expect(renew).not.toHaveBeenCalled();
  });

  it('a failed identity/marker READ is not a destroy: the idle handler falls through to stop() (fail closed)', async () => {
    const AgentContainerDO = await load();
    const f = fakeCtx('exec:9');
    const container = new AgentContainerDO(f.ctx as never, { SANDBOX_EGRESS_ENFORCE: 'true' } as never);
    await f.settled();
    f.container.running = true;
    f.container.destroy.mockClear();
    f.ctx.storage.get.mockRejectedValue(new Error('storage down'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stop = vi.spyOn(container, 'stop').mockResolvedValue(undefined);
    await container.onActivityExpired();
    expect(f.container.destroy).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('a destroy that was attempted and FAILED still counts as acted: no stop(), no keep-alive renewal (retried next expiry)', async () => {
    const AgentContainerDO = await load();
    const f = fakeCtx('exec:9');
    const container = new AgentContainerDO(f.ctx as never, { SANDBOX_EGRESS_ENFORCE: 'true' } as never);
    await f.settled();
    f.container.running = true;
    f.container.destroy.mockReset();
    f.container.destroy.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stop = vi.spyOn(container, 'stop').mockResolvedValue(undefined);
    const renew = vi.spyOn(container, 'renewActivityTimeout');
    await container.onActivityExpired();
    expect(f.container.destroy).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(renew).not.toHaveBeenCalled();
  });

  // ON, then OFF, then ON: with the flag off the library dropped our override and re-persisted
  // intercept-all with NO handler. Rebuilt with the flag on again it must not fall through to open.
  describe.each([['named exec:9', 'exec:9'], ['nameless (EGRESS_KEY persisted)', undefined]])('rebuild after an ON, OFF, ON toggle (%s)', (_label, name) => {
    const toggled = () => ({
      [OUTBOUND_KEY]: { outboundByHostOverrides: undefined, hasInterceptAllRegistration: true },
      egressPolicy: { executionId: 9, internalHost: 'api.builderforce.ai' },
      egressStartedRestricted: true,
    });

    it('restores internet-off and the allowlist override synchronously, so the applied interception is restricted', async () => {
      const AgentContainerDO = await load();
      const f = fakeCtx(name, { running: true, persisted: toggled() });
      const container = new AgentContainerDO(f.ctx as never, { SANDBOX_EGRESS_ENFORCE: 'true' } as never);
      expect(container.enableInternet).toBe(false);
      await f.settled();
      expect(f.proxy).toHaveBeenCalled();
      const props = (f.proxy.mock.calls[0] as unknown as [{ props: { enableInternet: boolean; interceptAll: boolean; outboundHandlerOverride?: { method: string; params?: { executionId: number } } } }])[0].props;
      expect(props.enableInternet).toBe(false);
      expect(props.interceptAll).toBe(true);
      expect(props.outboundHandlerOverride?.method).toBe('egressAllowlist');
      expect(props.outboundHandlerOverride?.params?.executionId).toBe(9);
    });
  });

  it('the captured ContainerProxy props drive a real ContainerProxy.fetch: a disallowed host is refused, an allowed one passes', async () => {
    const AgentContainerDO = await load();
    const { ContainerProxy } = await import('@cloudflare/containers');
    const f = fakeCtx('exec:9');
    const container = new AgentContainerDO(f.ctx as never, { SANDBOX_EGRESS_ENFORCE: 'true' } as never);
    await f.settled();
    // The DO's own path: gate -> restrict -> setOutboundHandler (what `fetch` runs for an open).
    const gated = await (container as unknown as { egress: { gate(openBody: unknown): Promise<Response | null> } }).egress.gate({ executionId: 9 });
    expect(gated).toBeNull();
    const props = (f.proxy.mock.calls.at(-1) as unknown as [{ props: unknown }])[0].props;
    const proxy = new ContainerProxy({ props } as never, {} as never);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const upstream = vi.fn(async (_r: Request) => new Response('ok'));
    vi.stubGlobal('fetch', upstream);
    try {
      const denied = await proxy.fetch(new Request('https://evil.example.org/steal'));
      expect(denied.status).toBe(403);
      expect(await denied.text()).toContain('evil.example.org');
      expect((await proxy.fetch(new Request('http://169.254.169.254/latest/meta-data/'))).status).toBe(403);
      expect(upstream).not.toHaveBeenCalled();
      const allowed = await proxy.fetch(new Request('https://registry.npmjs.org/left-pad'));
      expect(allowed.status).toBe(200);
      expect(upstream).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });

  describe('enforcement OFF: our own stale interception config', () => {
    const ours = () => ({ [OUTBOUND_KEY]: { outboundHandlerOverride: { method: 'egressAllowlist', params: {} }, hasInterceptAllRegistration: true } });

    it('is deleted before super() when the container is not running, restoring pre-flag behaviour', async () => {
      const AgentContainerDO = await load();
      const f = fakeCtx('exec:9', { running: false, persisted: ours() });
      const container = new AgentContainerDO(f.ctx as never, {} as never);
      await f.settled();
      expect(f.kv.has(OUTBOUND_KEY)).toBe(false);
      expect(container.usingInterception).toBe(false);
      expect(f.proxy).not.toHaveBeenCalled();
    });

    it('is kept while a container is running (the library re-applies it to the live container)', async () => {
      const AgentContainerDO = await load();
      const f = fakeCtx('exec:9', { running: true, persisted: ours() });
      new AgentContainerDO(f.ctx as never, {} as never);
      await f.settled();
      expect(f.kv.has(OUTBOUND_KEY)).toBe(true);
    });

    it('the residue a RUNNING off-rebuild re-persists (intercept-all, no override) is removed at the next STOPPED off-rebuild', async () => {
      const AgentContainerDO = await load();
      const first = fakeCtx('exec:9', { running: true, persisted: ours() });
      new AgentContainerDO(first.ctx as never, {} as never);
      await first.settled();
      const residue = first.kv.get(OUTBOUND_KEY) as { outboundHandlerOverride?: unknown; hasInterceptAllRegistration?: boolean } | undefined;
      expect(residue).toBeDefined();
      expect(residue!.outboundHandlerOverride).toBeUndefined(); // the library dropped our unregistered override
      expect(residue!.hasInterceptAllRegistration).toBe(true);  // ...but kept intercept-all
      const second = fakeCtx('exec:9', { running: false, persisted: Object.fromEntries(first.kv) });
      new AgentContainerDO(second.ctx as never, {} as never);
      await second.settled();
      expect(second.kv.has(OUTBOUND_KEY)).toBe(false);
      expect(second.proxy).not.toHaveBeenCalled();
    });

    it('is deleted for a non-exec instance too', async () => {
      const AgentContainerDO = await load();
      const f = fakeCtx('webscan:1', { running: false, persisted: { [OUTBOUND_KEY]: { hasInterceptAllRegistration: true } } });
      new AgentContainerDO(f.ctx as never, {} as never);
      await f.settled();
      expect(f.kv.has(OUTBOUND_KEY)).toBe(false);
    });
  });

  it('a nameless instance with NO persisted state is not destroyed (a scan / managed host)', async () => {
    const AgentContainerDO = await load();
    const f = fakeCtx(undefined, { running: true });
    new AgentContainerDO(f.ctx as never, { SANDBOX_EGRESS_ENFORCE: 'true' } as never);
    await f.settled();
    expect(f.container.destroy).not.toHaveBeenCalled();
  });

  it('enforcement ON, registered AFTER construction: setOutboundHandler is a no-op until usingInterception is turned on', async () => {
    const AgentContainerDO = await load();
    const f = fakeCtx('unnamed');
    const container = new AgentContainerDO(f.ctx as never, { SANDBOX_EGRESS_ENFORCE: 'true' } as never);
    await f.settled();
    expect(container.usingInterception).toBe(false); // not an exec name: nothing registered at construction
    (AgentContainerDO as unknown as { registerEgressHandler(): void }).registerEgressHandler();
    await container.setOutboundHandler('egressAllowlist', { executionId: 9, internalHost: null });
    expect(f.container.interceptAllOutboundHttp).not.toHaveBeenCalled(); // the library skipped it
    container.usingInterception = true; // what the gate does
    await container.setOutboundHandler('egressAllowlist', { executionId: 9, internalHost: null });
    expect(f.container.interceptAllOutboundHttp).toHaveBeenCalledTimes(1);
  });
});
