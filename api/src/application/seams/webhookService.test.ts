import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  signWebhook,
  emitWebhookEvent,
  runWebhookRetrySweep,
  webhookRetryDelaySec,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_SIGNALLED_ATTEMPTS,
  parseEvents,
  isWebhookEvent,
  WEBHOOK_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from './webhookService';
import { fakeCronKv } from '../runtime/__fixtures__/fakeCronKv';

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
function makeDb(
  subs: Array<{ id: string; url: string; secret: string; events: string; segmentId?: string | null; sessionId?: string | null }>,
  /** Emulates `uq_webhook_delivery_event` refusing a duplicate occurrence: the
   *  insert returns no row, exactly as ON CONFLICT DO NOTHING does. */
  insertConflicts = false,
) {
  const inserts: any[] = [];
  const updates: any[] = [];
  let insertStatements = 0;
  const db = {
    select: () => ({ from: () => ({ where: async () => subs }) }),
    insert: () => ({
      values: (v: any) => {
        // One multi-row insert for every matched subscription.
        insertStatements += 1;
        const batch: any[] = Array.isArray(v) ? v : [v];
        inserts.push(...batch);
        const returning = async () => (insertConflicts ? [] : batch.map((r, i) => ({
          id: `deliv-${inserts.length - batch.length + i + 1}`,
          subscriptionId: r.subscriptionId,
        })));
        return { returning, onConflictDoNothing: () => ({ returning }) };
      },
    }),
    update: () => ({
      set: (s: any) => {
        updates.push(s);
        return { where: async () => undefined };
      },
    }),
  };
  return { db: db as any, inserts, updates, insertStatements: () => insertStatements };
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

  it('enqueues every matched subscription in ONE insert and stamps successes in ONE update', async () => {
    const ev = JSON.stringify(['sprint.completed']);
    const { db, inserts, updates, insertStatements } = makeDb([
      { id: 's1', url: 'https://host/a', secret: 'sec', events: ev },
      { id: 's2', url: 'https://host/b', secret: 'sec', events: ev },
    ]);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));

    await expect(emitWebhookEvent(db, input, { fetchImpl, nowSec: () => 5 })).resolves.toBe(2);

    expect(insertStatements()).toBe(1);
    expect(inserts).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: 'delivered', responseStatus: 200 });
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

/**
 * A failed first delivery is rescheduled five minutes out; with the Worker env the emit signals the
 * cron gate so that retry is picked up by the tick that can send it, not the 30-minute floor.
 */
describe('emitWebhookEvent — arming the retry', () => {
  const input = {
    tenantId: 1, segmentId: 'seg-1', eventType: 'sprint.completed' as const, eventId: 'sprint-99', data: {},
  };
  const subs = [{ id: 's1', url: 'https://host/wh', secret: 'sec', events: JSON.stringify(['sprint.completed']) }];

  it('signals the cron gate when a delivery fails (non-2xx)', async () => {
    const { env, signalled } = fakeCronKv();
    const { db } = makeDb(subs);
    await emitWebhookEvent(db, input, { fetchImpl: vi.fn(async () => new Response('boom', { status: 503 })), nowSec: () => 1, env });
    expect(signalled()).toBe(true);
  });

  it('signals the cron gate when the endpoint cannot be reached at all', async () => {
    const { env, signalled } = fakeCronKv();
    const { db } = makeDb(subs);
    await emitWebhookEvent(db, input, { fetchImpl: vi.fn(async () => { throw new Error('network down'); }), nowSec: () => 1, env });
    expect(signalled()).toBe(true);
  });

  it('stays silent when every delivery succeeded, when nothing matched, and when the caller has no env', async () => {
    const ok = fakeCronKv();
    await emitWebhookEvent(makeDb(subs).db, input, { fetchImpl: vi.fn(async () => new Response(null, { status: 200 })), nowSec: () => 1, env: ok.env });
    expect(ok.signalled()).toBe(false);

    const none = fakeCronKv();
    await emitWebhookEvent(makeDb([]).db, input, { fetchImpl: vi.fn(), env: none.env });
    expect(none.signalled()).toBe(false);

    // No env to signal with: the floor sweep still retries, and the emit must not throw.
    await expect(emitWebhookEvent(makeDb(subs).db, input, { fetchImpl: vi.fn(async () => new Response('x', { status: 500 })), nowSec: () => 1 })).resolves.toBe(1);
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

/**
 * Cron-gate re-signal: a failed delivery waiting on a CLOSE retry keeps the next tick open; an empty
 * queue, or a retry far enough out that the floor sweep can pick it up, stays silent.
 */
describe('runWebhookRetrySweep — cron gate', () => {
  /** The sweep's due-rows select (`where().limit()`), plus the probe's (`where().orderBy().limit()`). */
  function makeProbeDb(dueRows: any[], nextRetryAt: Date | null) {
    return {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              limit: async () => dueRows,
              orderBy: () => ({ limit: async () => (nextRetryAt ? [{ at: nextRetryAt }] : []) }),
            }),
          }),
        }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
    } as any;
  }
  const NOW = 10_000_000;

  it('signals while a failed delivery is due for retry within the next tick or two', async () => {
    const { env, signalled } = fakeCronKv();
    await runWebhookRetrySweep(env, NOW, { db: makeProbeDb([], new Date(NOW + 5 * 60_000)) });
    expect(signalled()).toBe(true);
  });

  it('signals for a backlog already overdue (the batch limit left rows behind)', async () => {
    const { env, signalled } = fakeCronKv();
    await runWebhookRetrySweep(env, NOW, { db: makeProbeDb([], new Date(NOW - 60_000)) });
    expect(signalled()).toBe(true);
  });

  it('does NOT signal when no delivery is waiting to be retried', async () => {
    const { env, signalled } = fakeCronKv();
    await runWebhookRetrySweep(env, NOW, { db: makeProbeDb([], null) });
    expect(signalled()).toBe(false);
  });

  it('does NOT signal for a retry far enough out that the floor sweep covers it', async () => {
    const { env, signalled } = fakeCronKv();
    await runWebhookRetrySweep(env, NOW, { db: makeProbeDb([], new Date(NOW + 80 * 60_000)) });
    expect(signalled()).toBe(false);
  });

  /**
   * A dead URL on a sparse stream: its delivery keeps failing, and each retry is further out. Only the
   * first two retries (5 and 10 minutes) hold the gate open; from the third attempt on the backoff is
   * 20 minutes or more and the floor serves it. The fake applies the attempts bound the probe's WHERE
   * clause carries, so the bound the sweep actually sends is what decides.
   */
  describe('only the first two retries hold the gate open', () => {
    const probeDb = (waiting: Array<{ attempts: number; at: Date }>) => {
      const wheres: unknown[] = [];
      const db = {
        select: () => ({
          from: () => ({
            innerJoin: () => ({
              where: (condition: unknown) => {
                wheres.push(condition);
                const bound = new PgDialect().sqlToQuery(condition as SQL).params.find((p): p is number => typeof p === 'number');
                const eligible = waiting
                  .filter((row) => bound === undefined || row.attempts <= bound)
                  .sort((a, b) => a.at.getTime() - b.at.getTime());
                return {
                  limit: async () => [],
                  orderBy: () => ({ limit: async () => (eligible[0] ? [{ at: eligible[0].at }] : []) }),
                };
              },
            }),
          }),
        }),
        update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
      } as any;
      return { db, wheres };
    };

    it('the threshold is exactly the 5 and 10 minute backoffs', () => {
      expect(WEBHOOK_SIGNALLED_ATTEMPTS).toBe(2);
      expect(webhookRetryDelaySec(WEBHOOK_SIGNALLED_ATTEMPTS)).toBe(10 * 60);
      expect(webhookRetryDelaySec(WEBHOOK_SIGNALLED_ATTEMPTS + 1)).toBe(20 * 60);
    });

    it('signals for a delivery waiting on its first or second retry', async () => {
      for (const attempts of [1, 2]) {
        const { env, signalled } = fakeCronKv();
        await runWebhookRetrySweep(env, NOW, { db: probeDb([{ attempts, at: new Date(NOW + webhookRetryDelaySec(attempts) * 1000) }]).db });
        expect(signalled()).toBe(true);
      }
    });

    it('does NOT signal for a delivery past the second retry, even though its retry is inside the floor window', async () => {
      for (const attempts of [3, 4]) {
        const { env, signalled } = fakeCronKv();
        // 20 minutes is inside a 30-minute floor horizon: only the attempts bound keeps the gate shut.
        await runWebhookRetrySweep(env, NOW, { db: probeDb([{ attempts, at: new Date(NOW + 20 * 60_000) }]).db });
        expect(signalled()).toBe(false);
      }
    });

    it('still signals for an early-retry delivery when a later-backoff one is also waiting', async () => {
      const { env, signalled } = fakeCronKv();
      await runWebhookRetrySweep(env, NOW, {
        db: probeDb([{ attempts: 3, at: new Date(NOW + 20 * 60_000) }, { attempts: 1, at: new Date(NOW + 5 * 60_000) }]).db,
      });
      expect(signalled()).toBe(true);
    });
  });
});
