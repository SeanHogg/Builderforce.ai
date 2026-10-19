import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutbox } from "./outbox.js";
import type { Outbox, OutboxStore } from "./types.js";
import { USER_WORK_QUEUES, type UserWorkQueue } from "./queueClass.js";
import { createRevokeGate, type RevokeGate } from "./revokeGate.js";
import { createMemoryOutboxStore } from "./stores.js";

/**
 * The two send paths that `./userWorkSendPermission.test.ts` does not sweep over every
 * user-work queue: the FINAL flush (the host is going away, so it sends immediately and
 * in parallel rather than queueing behind a request) and the PROBE the retry timer fires
 * after a transient failure. Both must pass the same `sendPermission` as the automatic,
 * manual and `drainWith` paths, and both must leave the outbox row and the local record
 * in place with no retry when `builderforce.platform.synchronize` flips off.
 */

/** Stand-in for the VSIX setting `builderforce.platform.synchronize`. */
function synchronizeSetting(initial: boolean): { permission: RevokeGate; set(synchronize: boolean): void } {
  const permission = createRevokeGate(initial ? "granted" : "revoked");
  return {
    permission,
    set(synchronize) {
      if (synchronize) permission.grant();
      else permission.revoke();
    },
  };
}

/** The user's saved copy. A send that is refused must not delete it. */
interface LocalRecord {
  queue: UserWorkQueue;
  body: string;
}

interface Lane {
  queue: UserWorkQueue;
  box: Outbox<string, UserWorkQueue>;
  store: OutboxStore<string, UserWorkQueue>;
  local: LocalRecord;
  id: string;
}

/** No numeric `status`, so the default retry rule treats it as worth another try. */
const transientFailure = (): Error => new Error("network_unreachable");

/**
 * A sender whose network is down until the work is explicitly released. Failing is what
 * retains the batch and arms the retry timer, which is the probe this test needs; once
 * released, the send succeeds so the drain after the re-grant is observable.
 */
function offlineUntilReleasedSender(
  queue: UserWorkQueue,
  calls: Map<UserWorkQueue, number>,
  released: () => boolean,
): () => void {
  return () => {
    calls.set(queue, (calls.get(queue) ?? 0) + 1);
    if (!released()) throw transientFailure();
  };
}

/**
 * Let the flush chain and its store writes settle. A grant arms its flush on a
 * microtask, so `ready()` alone can be read before that flush has persisted its ack.
 */
async function settle(lane: Lane): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await vi.advanceTimersByTimeAsync(0);
    await lane.box.ready();
  }
}

describe("user-work queues gate the final and probe sends too", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps the row and the local record when the setting flips off mid-FINAL-flush, and does not retry", async () => {
    const setting = synchronizeSetting(true);
    const calls = new Map<UserWorkQueue, number>();
    // `retry` is what makes a refused final send a requeue rather than a drop, and it
    // is what arms the retry timer the ban has to suppress.
    const build = (
      queue: UserWorkQueue,
      send: () => void,
    ): Lane & { release: () => void; started: Promise<void>; flushing: Promise<void> } => {
      const store = createMemoryOutboxStore<string, UserWorkQueue>();
      const local: LocalRecord = { queue, body: `${queue}:saved` };
      let release!: () => void;
      let markStarted!: () => void;
      let parked = false;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const box = createOutbox<string, UserWorkQueue>({
        work: queue,
        maxWaitMs: 0,
        retry: { baseMs: 1_000, maxMs: 60_000 },
        store,
        sendPermission: setting.permission,
        // The sender ignores ctx.signal, so only the outbox's own gate holds this. The
        // FIRST call parks until the test releases it, to catch the revoke in flight;
        // later calls settle at once so the post-re-grant drain is observable.
        send: () => {
          send();
          if (!parked) {
            parked = true;
            markStarted();
            return new Promise<void>((resolve) => {
              release = () => resolve();
            });
          }
          return Promise.resolve();
        },
      });
      return { queue, box, store, local, id: "", release: () => release(), started, flushing: Promise.resolve() };
    };

    // Built and READY before anything is queued, so the load-time backlog replay
    // (which is its own gated send path, covered above) cannot race the counts here.
    const lanes: (Lane & { release: () => void; started: Promise<void>; flushing: Promise<void> })[] = [];
    for (const queue of USER_WORK_QUEUES) {
      const lane = build(queue, () => {
        calls.set(queue, (calls.get(queue) ?? 0) + 1);
      });
      await lane.box.ready();
      lane.id = lane.box.enqueue(queue, lane.local.body);
      lanes.push(lane);
    }
    for (const lane of lanes) lane.flushing = lane.box.flush(lane.queue, { final: true });

    await Promise.all(lanes.map((lane) => lane.started));
    for (const queue of USER_WORK_QUEUES) expect(calls.get(queue) ?? 0).toBe(1);

    setting.set(false);
    for (const lane of lanes) lane.release();
    await Promise.all(lanes.map((lane) => lane.flushing));
    for (const lane of lanes) await settle(lane);

    for (const lane of lanes) {
      expect(lane.box.size()).toBe(1);
      expect(lane.box.stats()).toMatchObject({ deadLetters: 0, dropped: 0 });
      expect(lane.local).toEqual({ queue: lane.queue, body: `${lane.queue}:saved` });
      expect((await lane.store.load()).map((entry) => entry.id)).toEqual([lane.id]);
      expect((await lane.store.load()).map((entry) => entry.item)).toEqual([lane.local.body]);
    }

    // No retry is armed while the ban holds, however long we wait.
    await vi.advanceTimersByTimeAsync(120_000);
    for (const lane of lanes) await settle(lane);
    for (const queue of USER_WORK_QUEUES) expect(calls.get(queue) ?? 0).toBe(1);
    for (const lane of lanes) {
      expect(lane.box.size()).toBe(1);
      expect(lane.local.body).toBe(`${lane.queue}:saved`);
      expect((await lane.store.load()).map((entry) => entry.id)).toEqual([lane.id]);
    }

    // Re-granting is what releases the work, and only then is the saved copy dropped.
    setting.set(true);
    for (const lane of lanes) {
      await settle(lane);
      expect(lane.box.size()).toBe(0);
      expect(await lane.store.load()).toEqual([]);
      lane.box.close();
    }
    for (const queue of USER_WORK_QUEUES) expect(calls.get(queue)).toBe(2);
  });

  it("does not send from a retry PROBE that fires after the setting is off", async () => {
    const setting = synchronizeSetting(true);
    const calls = new Map<UserWorkQueue, number>();
    // The network stays down across the revoke so the retry timer is genuinely armed
    // and genuinely pending when the ban lands; it comes back only at the re-grant.
    let networkUp = false;
    const lanes: Lane[] = [];
    for (const queue of USER_WORK_QUEUES) {
      const store = createMemoryOutboxStore<string, UserWorkQueue>();
      const local: LocalRecord = { queue, body: `${queue}:saved` };
      const box = createOutbox<string, UserWorkQueue>({
        work: queue,
        maxWaitMs: 0,
        retry: { baseMs: 1_000, maxMs: 60_000 },
        store,
        sendPermission: setting.permission,
        send: offlineUntilReleasedSender(queue, calls, () => networkUp),
      });
      const lane: Lane = { queue, box, store, local, id: "" };
      // Ready before queueing, so the count below is this flush and nothing else.
      await box.ready();
      lane.id = box.enqueue(queue, local.body);
      lanes.push(lane);
    }

    // One transient failure per queue, which retains the batch and arms the retry
    // timer — that timer firing is the probe path.
    for (const lane of lanes) await lane.box.flush(lane.queue);
    for (const lane of lanes) await lane.box.ready();
    const afterFirstSend = new Map(calls);
    for (const queue of USER_WORK_QUEUES) expect(afterFirstSend.get(queue) ?? 0).toBe(1);

    // The ban lands while the probe is still pending.
    setting.set(false);
    await vi.advanceTimersByTimeAsync(120_000);
    for (const lane of lanes) await settle(lane);

    for (const lane of lanes) {
      expect(calls.get(lane.queue)).toBe(afterFirstSend.get(lane.queue));
      expect(lane.box.size()).toBe(1);
      expect(lane.box.stats()).toMatchObject({ deadLetters: 0, dropped: 0 });
      expect(lane.local).toEqual({ queue: lane.queue, body: `${lane.queue}:saved` });
      expect((await lane.store.load()).map((entry) => entry.id)).toEqual([lane.id]);
      expect((await lane.store.load()).map((entry) => entry.item)).toEqual([lane.local.body]);
    }

    // Re-granting releases the queue and the retained row is sent exactly once more.
    setting.set(true);
    networkUp = true;
    for (const lane of lanes) {
      await settle(lane);
      expect(lane.box.size()).toBe(0);
      expect(await lane.store.load()).toEqual([]);
      lane.box.close();
    }
    for (const queue of USER_WORK_QUEUES) expect(calls.get(queue)).toBe(2);
  });
});
