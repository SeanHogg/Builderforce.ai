import { describe, it, expect, vi } from 'vitest';
import { makeExecutionBoardSink } from './executionBoardBroadcast';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { ExecutionSubscriberEvent } from './executionEvents';

/** Minimal DO namespace that records the room name + broadcast fetches. */
function fakeRoom() {
  const fetches: Array<{ room: string; url: string }> = [];
  const ns = {
    idFromName: (room: string) => ({ room }),
    get: (id: { room: string }) => ({
      fetch: (url: string) => {
        fetches.push({ room: id.room, url });
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    }),
  } as unknown as Env['SESSION_ROOM'];
  return { ns, fetches };
}

/** Db stub whose task→project lookup (join to projects for the tenant scope)
 *  returns a fixed {projectId, tenantId}, counting calls. */
function fakeDb(projectId: number, tenantId = 1) {
  let calls = 0;
  const db = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: () => {
              calls += 1;
              return Promise.resolve([{ projectId, tenantId }]);
            },
          }),
        }),
      }),
    }),
  } as unknown as Db;
  return { db, lookups: () => calls };
}

const statusEvent = (taskId: number): ExecutionSubscriberEvent => ({
  type: 'status_change',
  executionId: 1,
  status: 'running',
  execution: { id: 1, taskId },
  ts: '2026-06-14T00:00:00Z',
});

describe('makeExecutionBoardSink', () => {
  it('broadcasts to the run task’s project room on a status change', async () => {
    const { ns, fetches } = fakeRoom();
    const { db } = fakeDb(42);
    const sink = makeExecutionBoardSink({ SESSION_ROOM: ns } as Env, db);

    sink(statusEvent(7));
    await vi.waitFor(() => expect(fetches.length).toBe(1));
    // Tenant-scoped room — publish must match the subscribe side (projectRoomName).
    expect(fetches[0]?.room).toBe('project:1:42');
  });

  it('memoizes taskId→projectId so repeat events skip the DB lookup', async () => {
    const { ns, fetches } = fakeRoom();
    const { db, lookups } = fakeDb(99);
    const sink = makeExecutionBoardSink({ SESSION_ROOM: ns } as Env, db);

    sink(statusEvent(123));
    await vi.waitFor(() => expect(fetches.length).toBe(1)); // first populates the memo
    sink(statusEvent(123));
    await vi.waitFor(() => expect(fetches.length).toBe(2));
    expect(fetches.every((f) => f.room === 'project:1:99')).toBe(true);
    expect(lookups()).toBe(1); // second event served from the memo
  });

  it('ignores per-run deltas (message/file_change) that the board should not refetch on', async () => {
    const { ns, fetches } = fakeRoom();
    const { db } = fakeDb(5);
    const sink = makeExecutionBoardSink({ SESSION_ROOM: ns } as Env, db);

    sink({ type: 'message', executionId: 1, role: 'assistant', text: 'hi', ts: 't' });
    sink({ type: 'file_change', executionId: 1, path: 'a.ts', change: 'modified', ts: 't' });
    // Give any stray async work a tick; nothing should have broadcast.
    await new Promise((r) => setTimeout(r, 10));
    expect(fetches.length).toBe(0);
  });
});
