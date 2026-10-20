import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EntityDestination, SyncReceipt } from './records.js';
import type { SyncPullResult, SyncPushBatch, SyncTransport } from './sync.js';
import {
  HTTP_SYNC_PULL_PATH,
  HTTP_SYNC_PUSH_PATH,
  HttpSyncTransportError,
  createHttpSyncTransport,
  type HttpSyncFetch,
  type HttpSyncRequest,
  type HttpSyncResponse,
} from './httpSyncTransport.js';

const BASE = 'https://sync.example';
const PUSH_URL = `${BASE}${HTTP_SYNC_PUSH_PATH}`;
const PULL_URL = `${BASE}${HTTP_SYNC_PULL_PATH}`;

const destination: EntityDestination = {
  kind: 'bound',
  accountId: 'account-a',
  tenantId: '1',
  projectId: 'project-1',
};

const batch: SyncPushBatch = {
  batchId: 'batch-1',
  protocolVersion: 1,
  deviceId: 'device-a',
  destination,
  events: [{
    eventId: 'evt-1',
    clientEntityId: 'ticket-1',
    entityType: 'ticket',
    operation: 'create',
    schemaVersion: 1,
    localSequence: 1,
    occurredAt: '2026-10-18T00:00:00.000Z',
    dependsOn: [],
    destination,
    payload: { title: 'Offline ticket' },
    payloadHash: 'fnv1a:00000000',
  }],
};

const receipt: SyncReceipt = {
  eventId: 'evt-1',
  status: 'accepted',
  receivedAt: '2026-10-18T00:00:01.000Z',
  serverId: '9001',
  serverVersion: 1,
};

interface Call {
  url: string;
  init: HttpSyncRequest;
}

function jsonResponse(body: unknown, status = 200): HttpSyncResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function install(respond: (url: string, init: HttpSyncRequest) => HttpSyncResponse | Promise<HttpSyncResponse>) {
  const calls: Call[] = [];
  const fetch: HttpSyncFetch = async (url, init) => {
    const recorded: HttpSyncRequest = {
      method: init.method,
      headers: { ...init.headers },
      body: init.body,
    };
    calls.push({ url, init: recorded });
    return respond(url, recorded);
  };
  return { calls, fetch };
}

function transport(fetch: HttpSyncFetch, headers?: Parameters<typeof createHttpSyncTransport>[0]['headers']) {
  return createHttpSyncTransport({ fetch, baseUrl: BASE, ...(headers ? { headers } : {}) });
}

describe('createHttpSyncTransport', () => {
  it('does not call fetch when constructed, and satisfies SyncTransport', () => {
    const { calls, fetch } = install(() => {
      throw new Error('fetch must not run');
    });
    const client = transport(fetch);
    const typed: SyncTransport = client;
    expect(typed.push).toEqual(expect.any(Function));
    expect(typed.pull).toEqual(expect.any(Function));
    expect(calls).toEqual([]);
  });

  it('POSTs the push batch to /api/sync/v1/push', async () => {
    const frozen = Object.freeze({
      ...batch,
      events: Object.freeze(batch.events.map((event) => Object.freeze({ ...event }))),
    });
    const { calls, fetch } = install(() => jsonResponse([receipt]));
    const receipts = await transport(fetch).push(frozen);

    expect(HTTP_SYNC_PUSH_PATH).toBe('/api/sync/v1/push');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(PUSH_URL);
    expect(calls[0]?.url).not.toContain('/sync/batch');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.headers['content-type']).toBe('application/json');
    expect(calls[0]?.init.headers.accept).toBe('application/json');
    expect(JSON.parse(calls[0]?.init.body ?? '')).toEqual(frozen);
    expect(receipts).toEqual([receipt]);
    expect(receipts[0]).not.toBe(receipt);
    expect(frozen.events).toHaveLength(1);
  });

  it('accepts a receipts envelope and does not treat a batch-handler body as receipts', async () => {
    const wrapped = install(() => jsonResponse({ receipts: [receipt] }));
    await expect(transport(wrapped.fetch).push(batch)).resolves.toEqual([receipt]);

    const handler = install(() => jsonResponse({
      applied: [batch.events[0]],
      stoppedAt: null,
      nextCursor: 1,
    }));
    await expect(transport(handler.fetch).push(batch)).rejects.toMatchObject({
      name: 'HttpSyncTransportError',
      code: 'sync_receipts_invalid',
      url: PUSH_URL,
    });
    expect(handler.calls).toHaveLength(1);
    expect(handler.calls[0]?.url).toBe(PUSH_URL);
  });

  it('refuses a non-2xx push without parsing it into receipts', async () => {
    const { calls, fetch } = install(() => jsonResponse({ error: 'destination_tenant_mismatch' }, 400));
    await expect(transport(fetch).push(batch)).rejects.toBeInstanceOf(HttpSyncTransportError);
    await expect(transport(fetch).push(batch)).rejects.toMatchObject({
      code: 'sync_http_status',
      status: 400,
      url: PUSH_URL,
      detail: 'destination_tenant_mismatch',
    });
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.url === PUSH_URL)).toBe(true);
  });

  it('POSTs the pull input to /api/sync/v1/pull and returns records, cursor, and resnapshot', async () => {
    const record = {
      id: 'ticket-1',
      entityType: 'ticket',
      schemaVersion: 1,
      version: 2,
      destination,
      occurredAt: '2026-10-18T00:00:00.000Z',
      updatedAt: '2026-10-18T00:00:00.000Z',
      payload: { title: 'Remote' },
    };
    const { calls, fetch } = install(() => jsonResponse({
      records: [record],
      cursor: 'cursor-2',
      resnapshotRequired: false,
    }));
    const result: SyncPullResult = await transport(fetch).pull({
      destination,
      cursor: 'cursor-1',
      limit: 500,
    });

    expect(HTTP_SYNC_PULL_PATH).toBe('/api/sync/v1/pull');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(PULL_URL);
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(calls[0]?.init.body ?? '')).toEqual({
      destination,
      cursor: 'cursor-1',
      limit: 500,
    });
    expect(result.records).toEqual([record]);
    expect(result.cursor).toBe('cursor-2');
    expect(result.resnapshotRequired).toBeUndefined();
    expect(result).not.toHaveProperty('changes');
  });

  it('omits an absent cursor and passes a resnapshot with no records and no invented cursor', async () => {
    const { calls, fetch } = install((url) => {
      expect(url).toBe(PULL_URL);
      return jsonResponse({ resnapshotRequired: true });
    });
    const result = await transport(fetch).pull({ destination, limit: 25 });

    expect(JSON.parse(calls[0]?.init.body ?? '')).toEqual({ destination, limit: 25 });
    expect(calls[0]?.init.body).not.toContain('cursor');
    expect(result).toEqual({ records: [], resnapshotRequired: true });
    expect(result).not.toHaveProperty('cursor');
    expect(result).not.toHaveProperty('changes');
  });

  it('does not invent local records from a changes page', async () => {
    const { fetch } = install(() => jsonResponse({
      changes: [{ clientEntityId: 'ticket-1', body: { title: 'nope' } }],
      cursor: 'cursor-9',
    }));
    await expect(transport(fetch).pull({ destination, limit: 10 })).rejects.toMatchObject({
      code: 'sync_pull_invalid',
      url: PULL_URL,
    });
  });

  it('sends caller headers and strips a trailing slash from the base', async () => {
    const { calls, fetch } = install(() => jsonResponse([receipt]));
    const client = createHttpSyncTransport({
      fetch,
      baseUrl: `${BASE}/`,
      headers: async () => ({ Authorization: 'Bearer token', 'Content-Type': 'text/plain' }),
    });
    await client.push(batch);

    expect(calls[0]?.url).toBe(PUSH_URL);
    expect(calls[0]?.init.headers.Authorization).toBe('Bearer token');
    expect(calls[0]?.init.headers['content-type']).toBe('application/json');
    expect(calls[0]?.init.headers['Content-Type']).toBeUndefined();
  });

  it('refuses a non-absolute base before calling fetch', async () => {
    const { calls, fetch } = install(() => {
      throw new Error('fetch must not run');
    });
    const client = createHttpSyncTransport({ fetch, baseUrl: '/api' });
    await expect(client.push(batch)).rejects.toMatchObject({ code: 'sync_base_url_required', status: 0 });
    await expect(client.pull({ destination, limit: 1 })).rejects.toMatchObject({ code: 'sync_base_url_required' });
    expect(calls).toEqual([]);
  });

  it('targets the mounted sync routes and does not call a global fetch', () => {
    const source = readFileSync(new URL('./httpSyncTransport.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('globalThis.fetch');
    expect(source).not.toContain("'/sync/batch'");
    expect(source).toContain("'/api/sync/v1/push'");
    expect(source).toContain("'/api/sync/v1/pull'");
    expect(source).not.toMatch(/from ['"]\.\.\/\.\.\/api/);
  });
});
