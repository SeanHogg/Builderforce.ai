import { describe, expect, it, vi } from 'vitest';
import {
  signWebhook,
  emitWebhookEvent,
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
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://host/wh');
    const headers = init!.headers as Record<string, string>;
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
});
