import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutbox } from "./outbox.js";
import type { Outbox } from "./types.js";
import { USER_WORK_QUEUES, type UserWorkQueue } from "./queueClass.js";
import { createRevokeGate, type RevokeGate } from "./revokeGate.js";
import { createMemoryOutboxStore } from "./stores.js";
import type { OutboxStore } from "./types.js";

/**
 * Stand-in for the VSIX setting `builderforce.platform.synchronize`.
 * One administrative gate is the send permission for every user-work queue.
 */
interface SynchronizeSetting {
  /** The same object every user-work queue passes as `sendPermission`. */
  permission: RevokeGate;
  set(synchronize: boolean): void;
}

function synchronizeSetting(initial: boolean): SynchronizeSetting {
  const permission = createRevokeGate(initial ? "granted" : "revoked");
  return {
    permission,
    set(synchronize) {
      if (synchronize) permission.grant();
      else permission.revoke();
    },
  };
}

/** The user's saved copy. A flush must not delete it, even when sync is revoked. */
interface LocalRecord {
  queue: UserWorkQueue;
  body: string;
}

interface QueuedWork {
  queue: UserWorkQueue;
  box: Outbox<string, UserWorkQueue>;
  store: OutboxStore<string, UserWorkQueue>;
  local: LocalRecord;
  id: string;
  release: () => void;
  started: Promise<void>;
  flushing: Promise<void>;
}

describe("user-work queues share one send permission", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps the outbox row and the local record when builderforce.platform.synchronize flips off mid-flush, and does not retry", async () => {
    const setting = synchronizeSetting(true);
    const calls: UserWorkQueue[] = [];
    const delivered: UserWorkQueue[] = [];
    const queues: QueuedWork[] = USER_WORK_QUEUES.map((queue) => {
      const store = createMemoryOutboxStore<string, UserWorkQueue>();
      const local: LocalRecord = { queue, body: `${queue}:saved` };
      let release!: () => void;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const box = createOutbox<string, UserWorkQueue>({
        work: queue,
        maxWaitMs: 0,
        store,
        // Passing this permission is the gate. The sender ignores the abort signal.
        sendPermission: setting.permission,
        send: () => {
          calls.push(queue);
          markStarted();
          return new Promise<void>((resolve) => {
            release = () => resolve();
          });
        },
      });
      const id = box.enqueue(queue, local.body);
      const flushing = box.flush(queue);
      return { queue, box, store, local, id, release: () => release(), started, flushing };
    });

    expect(new Set(queues.map(() => setting.permission)).size).toBe(1);
    await Promise.all(queues.map((row) => row.started));
    expect(calls).toEqual([...USER_WORK_QUEUES]);

    setting.set(false);
    for (const row of queues) row.release();
    await Promise.all(queues.map((row) => row.flushing));
    await Promise.all(queues.map((row) => row.box.ready()));

    for (const row of queues) {
      // A host drops its local copy only if the outbox acknowledged the row.
      if (row.box.size() === 0) delivered.push(row.queue);
      expect(row.box.size()).toBe(1);
      expect(row.box.stats()).toMatchObject({ deadLetters: 0, dropped: 0 });
      expect(row.local).toEqual({ queue: row.queue, body: `${row.queue}:saved` });
      expect((await row.store.load()).map((entry) => entry.id)).toEqual([row.id]);
      expect((await row.store.load()).map((entry) => entry.item)).toEqual([row.local.body]);
    }
    expect(delivered).toEqual([]);
    expect(calls).toEqual([...USER_WORK_QUEUES]);

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.all(queues.map((row) => row.box.ready()));

    expect(calls).toEqual([...USER_WORK_QUEUES]);
    for (const row of queues) {
      expect(row.box.size()).toBe(1);
      expect(row.local.body).toBe(`${row.queue}:saved`);
      expect((await row.store.load()).map((entry) => entry.id)).toEqual([row.id]);
      row.box.close();
    }
  });

  it("refuses every send path while the setting is already off, and keeps the outbox row and the local record", async () => {
    const setting = synchronizeSetting(false);
    const calls = new Map<UserWorkQueue, number>();
    const counted = (queue: UserWorkQueue) => {
      calls.set(queue, (calls.get(queue) ?? 0) + 1);
    };
    const queued = USER_WORK_QUEUES.map((queue) => {
      const store = createMemoryOutboxStore<string, UserWorkQueue>();
      const local: LocalRecord = { queue, body: `${queue}:saved` };
      const box = createOutbox<string, UserWorkQueue>({
        work: queue,
        maxWaitMs: 0,
        store,
        sendPermission: setting.permission,
        send: () => counted(queue),
      });
      return { queue, box, store, local, id: box.enqueue(queue, local.body) };
    });

    // Off BEFORE the first send: automatic, manual, final and the drain that rides along
    // with a caller's own request are all refused. Nothing was ever in flight here.
    for (const row of queued) {
      await row.box.flush(row.queue);
      await expect(row.box.drainWith(row.queue, async () => "sent")).rejects.toThrow("platform_send_disabled");
      await row.box.flush(row.queue, { final: true });
      await row.box.ready();
    }
    await vi.advanceTimersByTimeAsync(60_000);

    for (const row of queued) {
      expect(calls.get(row.queue) ?? 0).toBe(0);
      expect(row.box.size()).toBe(1);
      expect(row.box.stats()).toMatchObject({ deadLetters: 0, dropped: 0 });
      expect(row.local).toEqual({ queue: row.queue, body: `${row.queue}:saved` });
      expect((await row.store.load()).map((entry) => entry.id)).toEqual([row.id]);
      expect((await row.store.load()).map((entry) => entry.item)).toEqual([row.local.body]);
    }

    // A backlog left by a previous session replays on load — that path is gated too.
    const first = queued[0]!;
    const replay = createOutbox<string, UserWorkQueue>({
      work: first.queue,
      maxWaitMs: 0,
      store: first.store,
      sendPermission: setting.permission,
      send: () => counted(first.queue),
    });
    await replay.ready();
    await vi.advanceTimersByTimeAsync(0);
    expect(replay.size()).toBe(1);
    expect(calls.get(first.queue) ?? 0).toBe(0);

    // Turn the setting back on. That is what releases the work — never online, never a
    // timer. The first outbox is closed first so the shared store's one row is owned by
    // the replaying outbox alone and is sent exactly once.
    first.box.close();
    setting.set(true);
    await vi.advanceTimersByTimeAsync(0);
    for (const row of queued.slice(1)) {
      await row.box.ready();
      expect(row.box.size()).toBe(0);
      expect(await row.store.load()).toEqual([]);
      row.box.close();
    }
    await replay.ready();
    expect(replay.size()).toBe(0);
    expect(await first.store.load()).toEqual([]);
    replay.close();
    for (const queue of USER_WORK_QUEUES) expect(calls.get(queue)).toBe(1);
  });
});
