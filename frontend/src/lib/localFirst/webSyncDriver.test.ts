// @vitest-environment jsdom
import {
  createMemoryLocalFirstStore,
  createPlatformPolicy,
  type EntityDestination,
  type HttpSyncFetch,
  type LocalFirstStore,
} from '@builderforce/local-first';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebSyncDriver, type WebSyncDriver, type WebSyncDriverOptions } from './webSyncDriver';
import { createWebSyncLease } from './webSyncLease';

const DEST: EntityDestination = { kind: 'bound', platformInstance: 'https://builderforce.example', accountId: 'a', tenantId: 't' };
const AT = '2026-11-24T12:00:00.000Z';
const running: WebSyncDriver[] = [];
afterEach(() => { for (const driver of running.splice(0)) driver.stop(); });

async function enqueue(store: LocalFirstStore, destination: EntityDestination = DEST): Promise<void> {
  await store.transact((tx) => tx.append({
    idempotencyKey: `project:${crypto.randomUUID()}:v1`, clientEntityId: crypto.randomUUID(), entityType: 'project', operation: 'create',
    schemaVersion: 1, occurredAt: AT, dependsOn: [], destination, payload: { name: 'p' },
  }));
}

/** Accepts everything it is sent; counts requests and captures the headers it carried. */
function acceptingFetch() {
  const seen: { calls: number; headers: Array<Readonly<Record<string, string>>> } = { calls: 0, headers: [] };
  const fetch: HttpSyncFetch = async (_url, init) => {
    seen.calls += 1;
    seen.headers.push(init.headers);
    const { events } = JSON.parse(init.body) as { events: Array<{ eventId: string }> };
    const receipts = events.map((event) => ({ eventId: event.eventId, status: 'accepted', receivedAt: AT, serverVersion: 1 }));
    return { ok: true, status: 200, json: async () => ({ receipts }), headers: { get: () => null } };
  };
  return { seen, fetch };
}

function build(store: LocalFirstStore, extra: Partial<WebSyncDriverOptions> = {}) {
  const reported: Array<[string, unknown]> = [];
  const driver = createWebSyncDriver({
    store, deviceId: `d-${crypto.randomUUID()}`, destination: () => DEST,
    policy: createPlatformPolicy({ synchronize: true }), baseUrl: 'https://api.example', headers: { authorization: 'Bearer t' },
    events: new EventTarget(), debounceMs: 0, report: (where, error) => { reported.push([where, error]); },
    ...extra,
  });
  running.push(driver);
  return { driver, reported };
}

const failing = (status: number, retryAfter?: string): HttpSyncFetch => async () => ({
  ok: false, status, json: async () => ({ error: 'nope' }), headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? retryAfter ?? null : null) },
});

describe('web sync driver', () => {
  it('pushes the journal with the auth headers and settles the pending count', async () => {
    const store = createMemoryLocalFirstStore();
    await enqueue(store);
    const { seen, fetch } = acceptingFetch();
    const { driver } = build(store, { fetch });
    const status = await driver.syncNow();
    expect(status).toMatchObject({ state: 'idle', pending: 0 });
    expect(status.lastSummary?.pushed).toBe(1);
    expect(seen.headers[0]).toMatchObject({ authorization: 'Bearer t', 'content-type': 'application/json' });
  });

  it('sends nothing while the capability is denied, while unbound, and while offline', async () => {
    const store = createMemoryLocalFirstStore();
    await enqueue(store);
    const { seen, fetch } = acceptingFetch();
    expect((await build(store, { fetch, policy: createPlatformPolicy() }).driver.syncNow()).state).toBe('denied');
    expect((await build(store, { fetch, destination: () => ({ kind: 'unbound' }) }).driver.syncNow()).state).toBe('unbound');
    const offline = await build(store, { fetch, isOnline: () => false }).driver.syncNow();
    expect(offline).toMatchObject({ state: 'offline', pending: 1 });
    expect(seen.calls).toBe(0);
  });

  it('holds on a 503, takes the server Retry-After, and does not retry inside it', async () => {
    const store = createMemoryLocalFirstStore();
    await enqueue(store);
    let clock = 1_000_000;
    const { driver, reported } = build(store, { fetch: failing(503, '30'), now: () => clock });
    const status = await driver.syncNow();
    expect(status).toMatchObject({ state: 'held', pending: 1 });
    expect(Date.parse(status.nextAttemptAt!)).toBe(clock + 30_000);
    expect(reported).toEqual([]);
    clock += 10_000;
    expect((await driver.syncNow()).state).toBe('held');
  });

  it('backs off exponentially without a Retry-After, and a refusal (400) is reported', async () => {
    const store = createMemoryLocalFirstStore();
    await enqueue(store);
    const clock = 5_000_000;
    const { driver, reported } = build(store, { fetch: failing(400), now: () => clock, backoffBaseMs: 1_000 });
    const status = await driver.syncNow();
    expect(status.state).toBe('held');
    expect(Date.parse(status.nextAttemptAt!)).toBe(clock + 1_000);
    expect(reported).toHaveLength(1);
    expect(reported[0]![0]).toBe('webSyncDriver.round');
  });

  it('treats an unreachable network as held, not as an error', async () => {
    const store = createMemoryLocalFirstStore();
    await enqueue(store);
    const { driver, reported } = build(store, { fetch: async () => { throw new TypeError('Failed to fetch'); } });
    expect((await driver.syncNow()).state).toBe('held');
    expect(reported).toEqual([]);
  });

  it('pushes after a commit once started, and again when the browser comes back online', async () => {
    const store = createMemoryLocalFirstStore();
    const { seen, fetch } = acceptingFetch();
    const bus = new EventTarget();
    let online = false;
    const { driver } = build(store, { fetch, events: bus, isOnline: () => online, lease: createWebSyncLease({ deviceId: `bus-${crypto.randomUUID()}`, locks: null }) });
    driver.start();
    await enqueue(store);
    await vi.waitFor(() => expect(driver.status().state).toBe('offline'));
    expect(seen.calls).toBe(0);
    online = true;
    bus.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(driver.status().pending).toBe(0));
    expect(seen.calls).toBe(1);
    // A later commit is picked up by the store subscription alone.
    await enqueue(store);
    await vi.waitFor(() => expect(seen.calls).toBe(2));
  });
});
