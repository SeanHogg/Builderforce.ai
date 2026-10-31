/**
 * AgentContainerDO — the idle reap keeps a container for a running BACKGROUND job, capped, and
 * never past a stop that must win. The `@cloudflare/containers` base is replaced by a recording
 * double: the behaviour under test is this class's own override and `fetch`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  stopped: 0,
  renewed: 0,
  forwarded: 0,
  probes: [] as Array<{ url: string; init?: RequestInit }>,
  probe: (async () => Response.json({ active: false })) as () => Promise<Response>,
}));

vi.mock('@cloudflare/containers', () => ({
  Container: class {
    ctx: unknown;
    env: unknown;
    envVars?: Record<string, string>;
    constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; }
    async stop() { h.stopped += 1; }
    renewActivityTimeout() { h.renewed += 1; }
    async containerFetch(url: string, init?: RequestInit) { h.probes.push({ url, init }); return h.probe(); }
    async fetch() { h.forwarded += 1; return new Response('proxied'); }
  },
}));
vi.mock('../../application/observability/durableErrorReporter', () => ({ createDurableErrorReporter: () => vi.fn() }));
vi.mock('../../application/runtime/previewSessions', () => ({ PREVIEW_CONTROL_STOP_PATH: '/__preview_control__/stop' }));

import { AgentContainerDO, JOB_PROBE_TIMEOUT_MS } from './AgentContainerDO';
import { JOB_KEEPALIVE_MAX_MS } from '../../application/runtime/sandbox/jobKeepAlive';

const NOW = 50_000_000;

function makeDo(opts: { running?: boolean; executionId?: number | null } = {}) {
  const storage = new Map<string, unknown>();
  if (opts.executionId !== null) storage.set('executionId', opts.executionId ?? 5);
  const ctx = {
    storage: {
      get: async (k: string) => storage.get(k),
      put: async (k: string, v: unknown) => { storage.set(k, v); },
      delete: async (k: string) => storage.delete(k),
    },
    container: { running: opts.running ?? true },
  };
  return { container: new AgentContainerDO(ctx as never, {} as never), storage };
}

const post = (path: string) => new Request(`https://agent-container${path}`, { method: 'POST', body: '{}' });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  h.stopped = 0; h.renewed = 0; h.forwarded = 0; h.probes.length = 0;
  h.probe = async () => Response.json({ active: false });
});
afterEach(() => { vi.useRealTimers(); });

describe('AgentContainerDO.onActivityExpired', () => {
  it('renews while a background job runs, starting the keep-alive clock', async () => {
    h.probe = async () => Response.json({ ok: true, active: true });
    const { container, storage } = makeDo();
    await container.onActivityExpired();
    expect(h.renewed).toBe(1);
    expect(h.stopped).toBe(0);
    expect(storage.get('jobKeepAliveSince')).toBe(NOW);
    expect(h.probes[0]!.url).toContain('/sandbox/job/active');
    expect(JSON.parse(String(h.probes[0]!.init!.body))).toEqual({ executionId: 5 });
  });

  it('keeps the original clock across renewals', async () => {
    h.probe = async () => Response.json({ active: true });
    const { container, storage } = makeDo();
    storage.set('jobKeepAliveSince', NOW - 30 * 60_000);
    await container.onActivityExpired();
    expect(h.renewed).toBe(1);
    expect(storage.get('jobKeepAliveSince')).toBe(NOW - 30 * 60_000);
  });

  it('stops at the cap even though a job still runs, and clears the clock', async () => {
    h.probe = async () => Response.json({ active: true });
    const { container, storage } = makeDo();
    storage.set('jobKeepAliveSince', NOW - JOB_KEEPALIVE_MAX_MS - 1);
    await container.onActivityExpired();
    expect(h.stopped).toBe(1);
    expect(h.renewed).toBe(0);
    expect(storage.has('jobKeepAliveSince')).toBe(false);
  });

  it('stops when no job runs, and clears the clock', async () => {
    const { container, storage } = makeDo();
    storage.set('jobKeepAliveSince', NOW - 60_000);
    await container.onActivityExpired();
    expect(h.stopped).toBe(1);
    expect(storage.has('jobKeepAliveSince')).toBe(false);
  });

  it('stops when the container cannot be reached', async () => {
    h.probe = async () => { throw new Error('connection refused'); };
    const { container } = makeDo();
    await container.onActivityExpired();
    expect(h.stopped).toBe(1);
    expect(h.renewed).toBe(0);
  });

  it('stops when the probe never answers, instead of holding the reap open', async () => {
    h.probe = () => new Promise<Response>(() => {});
    const { container } = makeDo();
    const expired = container.onActivityExpired();
    await vi.advanceTimersByTimeAsync(JOB_PROBE_TIMEOUT_MS + 1);
    await expired;
    expect(h.stopped).toBe(1);
    expect(h.renewed).toBe(0);
    expect(h.probes[0]!.init!.signal).toBeInstanceOf(AbortSignal);
  });

  it('stops when it does not know which run it serves, and does nothing when no container runs', async () => {
    const unknown = makeDo({ executionId: null });
    await unknown.container.onActivityExpired();
    expect(h.stopped).toBe(1);
    expect(h.probes).toHaveLength(0);

    h.stopped = 0;
    const idle = makeDo({ running: false });
    await idle.container.onActivityExpired();
    expect(h.stopped).toBe(0);
    expect(h.probes).toHaveLength(0);
  });
});

describe('AgentContainerDO.fetch and the keep-alive clock', () => {
  it('a forwarded request is real activity: it restarts the clock', async () => {
    const { container, storage } = makeDo();
    storage.set('jobKeepAliveSince', NOW - 40 * 60_000);
    const res = await container.fetch(post('/sandbox/fs'));
    expect(await res.text()).toBe('proxied');
    expect(h.forwarded).toBe(1);
    expect(storage.has('jobKeepAliveSince')).toBe(false);
  });

  it('the idle probe is not activity: the clock survives it', async () => {
    h.probe = async () => Response.json({ active: true });
    const { container, storage } = makeDo();
    await container.onActivityExpired();
    await container.onActivityExpired();
    expect(storage.get('jobKeepAliveSince')).toBe(NOW);
    expect(h.forwarded).toBe(0);
  });

  it('a stale clock from an earlier job does not stop a fresh one early', async () => {
    h.probe = async () => Response.json({ active: true });
    const { container, storage } = makeDo();
    // T20: a job kept the container; then requests resumed (run active); a fresh job goes quiet.
    await container.onActivityExpired();
    vi.setSystemTime(NOW + 80 * 60_000);
    await container.fetch(post('/sandbox/run'));
    vi.setSystemTime(NOW + 100 * 60_000);
    await container.onActivityExpired();
    expect(h.stopped).toBe(0);
    expect(storage.get('jobKeepAliveSince')).toBe(NOW + 100 * 60_000);
  });

  it('a preview stop wins over any keep-alive: the instance stops, nothing is forwarded, the clock goes', async () => {
    h.probe = async () => Response.json({ active: true });
    const { container, storage } = makeDo();
    await container.onActivityExpired();
    expect(storage.has('jobKeepAliveSince')).toBe(true);
    const res = await container.fetch(post('/__preview_control__/stop'));
    expect(res.status).toBe(204);
    expect(h.stopped).toBe(1);
    expect(h.forwarded).toBe(0);
    expect(storage.has('jobKeepAliveSince')).toBe(false);
  });
});
