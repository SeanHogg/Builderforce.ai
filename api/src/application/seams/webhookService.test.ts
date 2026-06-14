import { describe, expect, it, vi } from 'vitest';
import {
  signWebhook,
  emitWebhookEvent,
  runWebhookRetrySweep,
  webhookRetryDelaySec,
  WEBHOOK_MAX_ATTEMPTS,
  parseEvents,
  isWebhookEvent,
  WEBHOOK_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from './webhookService';

describe('webhook signing', () => {
  it('signWebhook is deterministic and covers id.timestamp.body', async () => {
    const a = await signWebhook('secret', 'deliv-1', 1000, '{"x":1}');
    const b = await signWebhook('secret', 'deliv-1', 1000, '{"x":1}');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it('signature changes when the nonce, timestamp, or body changes (replay-proof inputs)', async () => {
    const base = await signWebhook('secret', 'deliv-1', 1000, '{"x":1}');
    expect(await signWebhook('secret', 'deliv-2', 1000, '{"x":1}')).not.toBe(base); // nonce
    expect(await signWebhook('secret', 'deliv-1', 1001, '{"x":1}')).not.toBe(base); // timestamp
    expect(await signWebhook('secret', 'deliv-1', 1000, '{"x":2}')).not.toBe(base); // body
    expect(await signWebhook('other', 'deliv-1', 1000, '{"x":1}')).not.toBe(base);  // secret
  });
});

describe('parseEvents / isWebhookEvent', () => {
  it('parseEvents tolerates malformed input', () => {
    expect(parseEvents(null)).toEqual([]);
    expect(parseEvents('nope')).toEqual([]);
    expect(parseEvents(JSON.stringify(['sprint.completed', 3]))).toEqual(['sprint.completed']);
  });
  it('isWebhookEvent gates the known set', () => {
    expect(isWebhookEvent('sprint.completed')).toBe(true);
    expect(isWebhookEvent('roadmap.published')).toBe(true);
    expect(isWebhookEvent('nope')).toBe(false);
  });
});

/** Minimal chainable Drizzle mock that serves canned subscription rows and
 *  captures delivery inserts/updates. */
function makeDb(subs: Array<{ id: string; url: string; secret: string; events: string }>) {
  const inserts: any[] = [];
  const updates: any[] = [];
  const db = {
    select: () => ({ from: () => ({ where: async () => subs }) }),
    insert: () => ({
      values: (v: any) => {
        inserts.push(v);
        return { returning: async () => [{ id: `deliv-${inserts.length}` }] };
      },
    }),
    update: () => ({
      set: (s: any) => {
        updates.push(s);
        return { where: async () => undefined };
      },
    }),
  };
  return { db: db as any, inserts, updates };
}

describe('emitWebhookEvent', () => {
  const input = {
    tenantId: 1,
    segmentId: 'seg-1',
    eventType: 'sprint.completed' as const,
    eventId: 'sprint-99',
    data: { id: 'sprint-99', status: 'completed' },
  };

  it('delivers only to subscriptions that subscribed to the event, with signed headers', async () => {
    const { db, inserts } = makeDb([
      { id: 's1', url: 'https://host/wh', secret: 'sec', events: JSON.stringify(['sprint.completed']) },
      { id: 's2', url: 'https://host/other', secret: 'sec', events: JSON.stringify(['roadmap.published']) },
    ]);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));

    const count = await emitWebhookEvent(db, input, { fetchImpl, nowSec: () => 1234 });

    expect(count).toBe(1); // only s1 matched
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl.mock.calls as any[])[0] as [string, RequestInit];
    expect(url).toBe('https://host/wh');
    const headers = init.headers as Record<string, string>;
    expect(headers[WEBHOOK_ID_HEADER]).toBe('deliv-1');
    expect(headers[WEBHOOK_TIMESTAMP_HEADER]).toBe('1234');
    expect(headers[WEBHOOK_SIGNATURE_HEADER]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(inserts[0].status).toBe('pending');
  });

  it('records a failed delivery when the endpoint errors, and never throws', async () => {
    const { db, updates } = makeDb([
      { id: 's1', url: 'https://host/wh', secret: 'sec', events: JSON.stringify(['sprint.completed']) },
    ]);
    const fetchImpl = vi.fn(async () => { throw new Error('network down'); });

    await expect(emitWebhookEvent(db, input, { fetchImpl, nowSec: () => 1 })).resolves.toBe(1);
    expect(updates.at(-1)).toMatchObject({ status: 'failed' });
  });

  it('returns 0 (no fetch) when nothing is subscribed', async () => {
    const { db } = makeDb([]);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    expect(await emitWebhookEvent(db, input, { fetchImpl })).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('persists the body and schedules a backoff retry on a non-2xx response', async () => {
    const { db, inserts, updates } = makeDb([
      { id: 's1', url: 'https://host/wh', secret: 'sec', events: JSON.stringify(['sprint.completed']) },
    ]);
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 503 }));

    await emitWebhookEvent(db, input, { fetchImpl, nowSec: () => 1000 });

    expect(inserts[0].payload).toContain('sprint-99');      // body persisted for retry
    const last = updates.at(-1);
    expect(last.status).toBe('failed');
    expect(last.responseStatus).toBe(503);
    // attempts=1 → next retry one base interval out, and NOT dead-lettered.
    expect(last.nextRetryAt).toBeInstanceOf(Date);
    expect((last.nextRetryAt as Date).getTime()).toBe((1000 + webhookRetryDelaySec(1)) * 1000);
  });
});

describe('webhookRetryDelaySec', () => {
  it('is capped exponential backoff from a 5-minute base', () => {
    expect(webhookRetryDelaySec(1)).toBe(300);    // 5m
    expect(webhookRetryDelaySec(2)).toBe(600);    // 10m
    expect(webhookRetryDelaySec(3)).toBe(1200);   // 20m
    expect(webhookRetryDelaySec(99)).toBe(6 * 60 * 60); // capped at 6h
  });
});

/** Mock for the sweep: serves canned join rows and captures update sets. */
function makeSweepDb(rows: any[]) {
  const updates: Array<{ id: string; set: any }> = [];
  const db = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: async () => rows }),
        }),
      }),
    }),
    update: () => ({
      set: (set: any) => ({
        where: (cond: any) => {
          updates.push({ id: cond?.__id ?? '?', set });
          return Promise.resolve(undefined);
        },
      }),
    }),
  };
  return { db: db as any, updates };
}

describe('runWebhookRetrySweep', () => {
  const env = {} as any;

  it('redelivers a due row and marks it delivered on success', async () => {
    const { db, updates } = makeSweepDb([
      { id: 'd1', attempts: 1, payload: '{"type":"sprint.completed"}', url: 'https://host/wh', secret: 'sec', active: true },
    ]);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));

    const attempted = await runWebhookRetrySweep(env, 2_000_000, { db, fetchImpl });

    expect(attempted).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const headers = (fetchImpl.mock.calls as any[])[0][1].headers as Record<string, string>;
    expect(headers[WEBHOOK_ID_HEADER]).toBe('d1');          // re-sent under the original nonce
    expect(updates.at(-1)!.set).toMatchObject({ status: 'delivered', attempts: 2, nextRetryAt: null });
  });

  it('dead-letters a due row whose subscription is inactive (no fetch)', async () => {
    const { db, updates } = makeSweepDb([
      { id: 'd2', attempts: 2, payload: '{"x":1}', url: 'https://host/wh', secret: 'sec', active: false },
    ]);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));

    const attempted = await runWebhookRetrySweep(env, 3_000_000, { db, fetchImpl });

    expect(attempted).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(updates.at(-1)!.set).toMatchObject({ nextRetryAt: null, lastError: 'subscription inactive' });
  });

  it('dead-letters once the attempt budget is exhausted', async () => {
    const { db, updates } = makeSweepDb([
      { id: 'd3', attempts: WEBHOOK_MAX_ATTEMPTS - 1, payload: '{"x":1}', url: 'https://host/wh', secret: 'sec', active: true },
    ]);
    const fetchImpl = vi.fn(async () => new Response('no', { status: 500 }));

    await runWebhookRetrySweep(env, 4_000_000, { db, fetchImpl });

    // attempts reaches WEBHOOK_MAX_ATTEMPTS → terminal, no further retry scheduled.
    expect(updates.at(-1)!.set).toMatchObject({ status: 'failed', attempts: WEBHOOK_MAX_ATTEMPTS, nextRetryAt: null });
  });
});
