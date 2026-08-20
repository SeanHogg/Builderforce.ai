import { describe, it, expect, vi } from 'vitest';
import { makeExecutionRelaySink } from './executionRelayBroadcast';
import { makeExecutionBoardSink } from './executionBoardBroadcast';
import { notifyExecutionSubscribers, setExecutionEventSinks, type ExecutionSubscriberEvent } from './executionEvents';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** Minimal DO namespace recording the room name + the frame body it was handed. */
function fakeRoom() {
  const fetches: Array<{ room: string; body: string | null }> = [];
  const ns = {
    idFromName: (room: string) => ({ room }),
    get: (id: { room: string }) => ({
      fetch: (_url: string, init?: { body?: string }) => {
        fetches.push({ room: id.room, body: init?.body ?? null });
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    }),
  } as unknown as Env['SESSION_ROOM'];
  return { ns, fetches };
}

const toolEvent: ExecutionSubscriberEvent = {
  type: 'tool_event',
  executionId: 31,
  id: 900,
  cloudAgentRef: 'agent-a',
  toolName: 'repo.write',
  category: 'code',
  ts: '2026-08-19T10:00:00.000Z',
};

describe('makeExecutionRelaySink', () => {
  it('publishes the frame verbatim into the run’s own room', async () => {
    const { ns, fetches } = fakeRoom();
    makeExecutionRelaySink({ SESSION_ROOM: ns } as Env)(toolEvent);

    await vi.waitFor(() => expect(fetches.length).toBe(1));
    // Reuses the established per-execution DO name (`exec:<id>`, as CLOUD_RUNNER
    // does) rather than inventing a third id shape.
    expect(fetches[0]?.room).toBe('exec:31');
    // Verbatim: the room is a dumb relay, so the client parses what the emitter built.
    expect(JSON.parse(fetches[0]?.body ?? '{}')).toEqual(toolEvent);
  });

  it('is a no-op without the room binding (degrades to the client’s poll)', () => {
    expect(() => makeExecutionRelaySink({} as Env)(toolEvent)).not.toThrow();
  });
});

describe('notifyExecutionSubscribers', () => {
  it('fans one event out to every registered sink', async () => {
    const { ns, fetches } = fakeRoom();
    // Board sink: task→project lookup, so a lifecycle event also refreshes the board.
    const db = {
      select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: () => Promise.resolve([{ projectId: 5, tenantId: 2 }]) }) }) }) }),
    } as unknown as Db;
    setExecutionEventSinks(makeExecutionRelaySink({ SESSION_ROOM: ns } as Env), makeExecutionBoardSink({ SESSION_ROOM: ns } as Env, db));

    // A publisher that knows only the transition (crash recovery holds raw columns,
    // not a hydrated entity) names its task instead of shipping a partial execution.
    notifyExecutionSubscribers(31, { type: 'done', executionId: 31, status: 'failed', taskId: 8, ts: '2026-08-19T10:00:01.000Z' });

    await vi.waitFor(() => expect(fetches.length).toBe(2));
    expect(fetches.map((f) => f.room).sort()).toEqual(['exec:31', 'project:2:5']);
    setExecutionEventSinks();
  });

  it('one failing sink cannot stop another, nor throw into the run', async () => {
    const { ns, fetches } = fakeRoom();
    setExecutionEventSinks(() => { throw new Error('sink exploded'); }, makeExecutionRelaySink({ SESSION_ROOM: ns } as Env));

    expect(() => notifyExecutionSubscribers(31, toolEvent)).not.toThrow();
    await vi.waitFor(() => expect(fetches.length).toBe(1));
    setExecutionEventSinks();
  });
});
