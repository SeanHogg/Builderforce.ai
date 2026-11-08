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
  WorkerEntrypoint: class {},
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
      kv: { get: vi.fn((k: string) => kv.get(k)), put: vi.fn((k: string, v: unknown) => { kv.set(k, v); }) },
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
