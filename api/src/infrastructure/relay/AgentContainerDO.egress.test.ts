/**
 * AgentContainerDO — the sandbox egress policy wiring. The `@cloudflare/containers` base is a
 * recording double that keeps the real contract this class depends on: `outboundHandlers` is a
 * static SETTER feeding a registry, and `setOutboundHandler` throws for an unregistered name.
 * (The REAL library class is exercised in AgentContainerDO.realLibrary.test.ts.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  registry: new Map<string, Record<string, unknown>>(),
  handlerCalls: [] as Array<{ name: string; params: unknown; enableInternet: unknown; usingInterception: unknown }>,
  stopped: 0,
  destroyed: 0,
  forwarded: 0,
  failSetHandler: false,
  /** A running container stays running after destroy() until this is cleared. */
  wedged: false,
  /** When set, destroy() waits for it before the container reads as stopped. */
  destroyGate: null as null | Promise<void>,
}));

vi.mock('@cloudflare/containers', () => ({
  Container: class {
    static set outboundHandlers(handlers: Record<string, unknown>) {
      h.registry.set(this.name, { ...(h.registry.get(this.name) ?? {}), ...handlers });
    }
    static get outboundHandlers(): Record<string, unknown> | undefined { return h.registry.get(this.name); }
    ctx: { container?: { running: boolean } };
    env: unknown;
    enableInternet = true;
    usingInterception = false;
    constructor(ctx: never, env: unknown) { this.ctx = ctx; this.env = env; }
    async stop() { h.stopped += 1; }
    async destroy() {
      h.destroyed += 1;
      if (h.destroyGate) await h.destroyGate;
      if (!h.wedged && this.ctx.container) this.ctx.container.running = false;
    }
    renewActivityTimeout() {}
    async setOutboundHandler(name: string, params?: unknown) {
      const registered = h.registry.get((this.constructor as { name: string }).name);
      if (!registered?.[name]) throw new Error(`Outbound handler '${name}' is not registered`);
      if (h.failSetHandler) throw new Error('interception failed');
      h.handlerCalls.push({ name, params, enableInternet: this.enableInternet, usingInterception: this.usingInterception });
    }
    onStart() {}
    async fetch() { h.forwarded += 1; return new Response('proxied'); }
  },
}));
vi.mock('../../application/observability/durableErrorReporter', () => ({ createDurableErrorReporter: () => vi.fn() }));
vi.mock('../../application/runtime/previewSessions', () => ({ PREVIEW_CONTROL_STOP_PATH: '/__preview_control__/stop' }));

import { AgentContainerDO, DESTROY_TIMEOUT_MS } from './AgentContainerDO';

const SPEC = { executionId: 9, internalBaseUrl: 'https://attacker.example', repo: { cloneUrl: 'https://attacker.example/x.git' } };
const open = () => new Request('https://agent-container/sandbox/open', { method: 'POST', body: JSON.stringify(SPEC) });
const other = (path = '/sandbox/run') => new Request(`https://agent-container${path}`, { method: 'POST', body: '{}' });
const INTERNAL = { SANDBOX_EGRESS_ENFORCE: 'true', INTERNAL_API_BASE_URL: 'https://api.builderforce.ai' };

function makeDo(opts: { name?: string | null; env?: Record<string, string>; running?: boolean; storage?: Map<string, unknown> } = {}) {
  const storage = opts.storage ?? new Map<string, unknown>();
  const ctx = {
    id: opts.name === null ? undefined : { name: opts.name ?? 'exec:9' },
    storage: {
      get: vi.fn(async (k: string) => storage.get(k)),
      put: vi.fn(async (k: string, v: unknown) => { storage.set(k, v); }),
      delete: vi.fn(async (k: string) => storage.delete(k)),
    },
    container: { running: opts.running ?? false },
    // The proactive destroy-if-started-open runs in the real library inside this; here it is a
    // no-op so these tests drive the gate alone (the constructor path is in the realLibrary test).
    blockConcurrencyWhile: async () => undefined,
  };
  return { container: new AgentContainerDO(ctx as never, (opts.env ?? INTERNAL) as never), storage, ctx };
}

let infoSpy: { mock: { calls: unknown[][] }; mockClear(): unknown };
beforeEach(() => {
  h.registry.clear(); h.handlerCalls.length = 0;
  h.stopped = 0; h.destroyed = 0; h.forwarded = 0; h.failSetHandler = false; h.wedged = false; h.destroyGate = null;
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  infoSpy.mockClear();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('handler registration (B1) is lazy', () => {
  it('registers through the base setter for an enforced exec instance, before super(), so setOutboundHandler does not throw', async () => {
    const { container } = makeDo();
    expect(Object.keys(AgentContainerDO.outboundHandlers ?? {})).toContain('egressAllowlist');
    await expect(container.setOutboundHandler('egressAllowlist', { executionId: 1, internalHost: null })).resolves.toBeUndefined();
  });

  it('registers NOTHING with enforcement off (the library would otherwise enable interception for every instance)', () => {
    makeDo({ env: {} });
    makeDo({ env: { SANDBOX_EGRESS_ENFORCE: 'false' } });
    expect(AgentContainerDO.outboundHandlers).toBeUndefined();
  });

  it('registers nothing for an enforced non-run instance', () => {
    makeDo({ name: 'webscan:1' });
    expect(AgentContainerDO.outboundHandlers).toBeUndefined();
  });
});

describe('enforcement ON', () => {
  it('restricts a run sandbox on open: persists the flag, drops internet, turns interception on, scopes the internal host from the ENV (not the body), then proxies', async () => {
    const { container, storage } = makeDo();
    const res = await container.fetch(open());
    expect(await res.text()).toBe('proxied');
    expect(h.handlerCalls).toEqual([{ name: 'egressAllowlist', params: { executionId: 9, internalHost: 'api.builderforce.ai' }, enableInternet: false, usingInterception: true }]);
    expect(storage.get('egressPolicy')).toEqual({ executionId: 9, internalHost: 'api.builderforce.ai' });
  });

  it('answers 503 and does not proxy when the policy cannot be applied; the flag is already persisted', async () => {
    h.failSetHandler = true;
    const { container, storage } = makeDo();
    const res = await container.fetch(open());
    expect(res.status).toBe(503);
    expect(h.forwarded).toBe(0);
    expect(storage.get('egressPolicy')).toBeDefined();
    expect((await container.fetch(other())).status).toBe(503);
    expect(h.forwarded).toBe(0);
  });

  it('re-applies after a restart from a non-open request, without destroying a container that started restricted', async () => {
    const storage = new Map<string, unknown>([['executionId', 9], ['egressPolicy', { executionId: 9, internalHost: 'api.builderforce.ai' }], ['egressStartedRestricted', true]]);
    const { container } = makeDo({ storage, running: true });
    expect(await (await container.fetch(other())).text()).toBe('proxied');
    expect(h.handlerCalls).toHaveLength(1);
    expect(h.handlerCalls[0]!.enableInternet).toBe(false);
    expect(h.destroyed).toBe(0);
  });

  it('destroys a running container that never recorded a restricted start (EGRESS_KEY alone is not proof)', async () => {
    const storage = new Map<string, unknown>([['executionId', 9], ['egressPolicy', { executionId: 9, internalHost: 'api.builderforce.ai' }]]);
    const { container } = makeDo({ storage, running: true });
    await container.fetch(other());
    expect(h.destroyed).toBe(1);
    expect(h.stopped).toBe(0);
    expect(h.forwarded).toBe(1);
  });

  it('restricts an exec instance with only the exec key present (flag lost)', async () => {
    const storage = new Map<string, unknown>([['executionId', 9]]);
    const { container } = makeDo({ storage });
    await container.fetch(other());
    expect(h.handlerCalls).toHaveLength(1);
  });

  it('destroys an already-running container before open, then applies the policy', async () => {
    const { container } = makeDo({ running: true });
    await container.fetch(open());
    expect(h.destroyed).toBe(1);
    expect(h.handlerCalls).toHaveLength(1);
    expect(h.forwarded).toBe(1);
  });

  it('after a stop timeout answers 503, and the NEXT request retries the destroy and succeeds', async () => {
    vi.useFakeTimers();
    h.wedged = true;
    const { container } = makeDo({ running: true });
    const first = container.fetch(open());
    await vi.advanceTimersByTimeAsync(11_000);
    expect((await first).status).toBe(503);
    expect(h.forwarded).toBe(0);
    h.wedged = false;
    const second = await container.fetch(other());
    expect(await second.text()).toBe('proxied');
    expect(h.destroyed).toBe(2);
    expect(h.forwarded).toBe(1);
  });

  it('queues a request that arrives mid-destroy behind the one in-flight gate', async () => {
    let release!: () => void;
    h.destroyGate = new Promise<void>((r) => { release = r; });
    const { container } = makeDo({ running: true });
    const first = container.fetch(open());
    // The open request parses its body before it reaches the gate, so wait until its destroy is
    // really in flight; only then does a second request arrive "mid-destroy".
    await vi.waitFor(() => expect(h.destroyed).toBe(1));
    const second = container.fetch(other());
    await new Promise((r) => setTimeout(r, 20));
    expect(h.forwarded).toBe(0);
    expect(h.destroyed).toBe(1);
    release();
    expect(await (await first).text()).toBe('proxied');
    expect(await (await second).text()).toBe('proxied');
    expect(h.destroyed).toBe(1);
    expect(h.handlerCalls).toHaveLength(1);
  });

  it('re-applies once when the executionId becomes known (handler params changed), and never when nothing changed', async () => {
    const { container } = makeDo();
    await container.fetch(other()); // arrives before open: run id unknown
    await container.fetch(open());  // now known: the handler's attribution params differ
    await container.fetch(open());  // same again: idempotent
    await container.fetch(other());
    expect(h.handlerCalls.map((c) => (c.params as { executionId: number | null }).executionId)).toEqual([null, 9]);
  });

  it('records a restricted start in onStart, and only when internet really is off', async () => {
    const { container, storage } = makeDo();
    await container.onStart();
    expect(storage.get('egressStartedRestricted')).toBeUndefined();
    container.enableInternet = false;
    await container.onStart();
    expect(storage.get('egressStartedRestricted')).toBe(true);
  });

  it('clears the marker on a start WITH internet — whatever the flag says (ON, OFF, ON toggle)', async () => {
    for (const env of [INTERNAL, {}]) {
      const storage = new Map<string, unknown>([['egressStartedRestricted', true]]);
      const { container } = makeDo({ storage, env });
      container.enableInternet = true;
      await container.onStart();
      expect(storage.has('egressStartedRestricted'), JSON.stringify(env)).toBe(false);
    }
  });

  it('lets a nameless instance with nothing persisted through (no permanent 503), uncached, and gates it once it opens', async () => {
    const { container, storage } = makeDo({ name: null });
    expect((await container.fetch(other())).status).toBe(200);
    expect((await container.fetch(other())).status).toBe(200);
    expect(h.handlerCalls).toHaveLength(0);
    expect(container.enableInternet).toBe(true);
    await container.fetch(open());
    expect(h.handlerCalls).toHaveLength(1);
    expect(storage.get('egressPolicy')).toBeDefined();
  });

  it('restricts a nameless instance when persisted state says it was restricted', async () => {
    const storage = new Map<string, unknown>([['egressPolicy', { executionId: 9, internalHost: 'api.builderforce.ai' }]]);
    const { container } = makeDo({ name: null, storage });
    await container.fetch(other());
    expect(h.handlerCalls).toHaveLength(1);
  });

  it('rejects an open whose executionId does not match the exec:<id> name (enforcement on), not when off', async () => {
    const { container, storage } = makeDo({ name: 'exec:5' });
    const res = await container.fetch(open());
    expect(res.status).toBe(400);
    expect(h.forwarded).toBe(0);
    expect(storage.get('executionId')).toBeUndefined();
    const off = makeDo({ name: 'exec:5', env: {} });
    expect((await off.container.fetch(open())).status).toBe(200);
  });

  it('clears a stale restricted marker in the gate when the container is not running', async () => {
    const storage = new Map<string, unknown>([['egressStartedRestricted', true]]);
    const { container } = makeDo({ storage, running: false });
    await container.fetch(open());
    expect(storage.has('egressStartedRestricted')).toBe(false);
  });

  it('does not wedge the gate chain when destroy hangs: 503, then a later request recovers', async () => {
    vi.useFakeTimers();
    h.destroyGate = new Promise<void>(() => { /* never settles */ });
    const { container } = makeDo({ running: true });
    const first = container.fetch(open());
    await vi.advanceTimersByTimeAsync(DESTROY_TIMEOUT_MS + 1_000);
    expect((await first).status).toBe(503);
    expect(h.forwarded).toBe(0);
    h.destroyGate = null;
    const second = await container.fetch(other());
    expect(await second.text()).toBe('proxied');
    expect(h.destroyed).toBe(2);
  });

  it('leaves a scan instance unrestricted and caches that verdict (no storage reads after the first)', async () => {
    const { container, ctx } = makeDo({ name: 'webscan:abc' });
    await container.fetch(other('/scan'));
    await container.fetch(other('/scan'));
    expect(h.handlerCalls).toHaveLength(0);
    expect(h.forwarded).toBe(2);
    expect(container.enableInternet).toBe(true);
    expect(ctx.storage.get).not.toHaveBeenCalledWith('egressPolicy');
  });
});

describe('enforcement OFF (default)', () => {
  it.each([[{}], [{ SANDBOX_EGRESS_ENFORCE: 'false' }]])('behaves exactly as before (%j) and logs once', async (env) => {
    const { container, storage } = makeDo({ env });
    await container.fetch(open());
    await container.fetch(other());
    expect(h.handlerCalls).toHaveLength(0);
    expect(container.enableInternet).toBe(true);
    expect(container.usingInterception).toBe(false);
    expect(storage.get('egressPolicy')).toBeUndefined();
    expect(h.forwarded).toBe(2);
    await container.onStart();
    expect(storage.get('egressStartedRestricted')).toBeUndefined();
    const disabledLogs = infoSpy.mock.calls.filter((c) => String(c[0]).includes('enforcement_disabled'));
    expect(disabledLogs).toHaveLength(1);
  });
});
