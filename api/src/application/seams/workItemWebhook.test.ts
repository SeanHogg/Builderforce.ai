import { describe, expect, it, vi } from 'vitest';
import { releaseWorkItemWebhook } from './workItemWebhook';

/**
 * DB mock: the helper does ONE task select, then emitWebhookEvent does its own
 * subscription select + delivery insert/update. Both run through the same chained
 * `select().from().where().limit()` / `insert()/update()` surface, so we serve the
 * task row on the first select and subscriptions on the second.
 */
function makeDb(opts: {
  task: Record<string, unknown> | null;
  subs: Array<{ id: string; url: string; secret: string; events: string }>;
}) {
  let selectCall = 0;
  const inserts: any[] = [];
  const db = {
    select: () => {
      const call = selectCall++;
      return {
        from: () => ({
          // task select chains .where().limit(); subscription select chains .where()
          where: (..._a: unknown[]) => {
            const rows = call === 0 ? (opts.task ? [opts.task] : []) : opts.subs;
            const thenable = {
              limit: async () => rows,
              then: (res: (r: unknown[]) => void) => res(rows),
            };
            return thenable as any;
          },
        }),
      };
    },
    insert: () => ({
      values: (v: any) => {
        inserts.push(v);
        return { returning: async () => [{ id: `deliv-${inserts.length}` }] };
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  return { db: db as any, inserts };
}

describe('releaseWorkItemWebhook — emits workitem.released on done-class entry', () => {
  const sub = { id: 's1', url: 'https://host/wh', secret: 'sec', events: JSON.stringify(['workitem.released']) };

  it('fans out workitem.released to a subscribed segment with the task payload', async () => {
    const { db } = makeDb({
      task: { id: 42, key: 'PROJ-7', title: 'Ship it', status: 'done', projectId: 3, segmentId: 'seg-1', priority: 'high' },
      subs: [sub],
    });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));

    const count = await releaseWorkItemWebhook(db, { tenantId: 1, taskId: 42 }, { fetchImpl, nowSec: () => 100 });

    expect(count).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchImpl.mock.calls as any[])[0][1].body);
    expect(body.type).toBe('workitem.released');
    expect(body.id).toBe('42'); // eventId (logical source id for dedupe)
    expect(body.data).toMatchObject({ id: 42, key: 'PROJ-7', title: 'Ship it', status: 'done', priority: 'high' });
    expect(typeof body.data.releasedAt).toBe('string');
  });

  it('is a no-op (0, no fetch) for a single-mode task with no segment', async () => {
    const { db } = makeDb({
      task: { id: 9, key: 'X-1', title: 't', status: 'done', projectId: 1, segmentId: null, priority: 'low' },
      subs: [sub],
    });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));

    expect(await releaseWorkItemWebhook(db, { tenantId: 1, taskId: 9 }, { fetchImpl })).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('is a no-op when the task is missing', async () => {
    const { db } = makeDb({ task: null, subs: [sub] });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    expect(await releaseWorkItemWebhook(db, { tenantId: 1, taskId: 999 }, { fetchImpl })).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns 0 when the segment has no matching subscription', async () => {
    const { db } = makeDb({
      task: { id: 5, key: 'X-5', title: 't', status: 'done', projectId: 1, segmentId: 'seg-2', priority: 'medium' },
      subs: [{ id: 's2', url: 'https://host/x', secret: 'sec', events: JSON.stringify(['sprint.completed']) }],
    });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    expect(await releaseWorkItemWebhook(db, { tenantId: 1, taskId: 5 }, { fetchImpl })).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
