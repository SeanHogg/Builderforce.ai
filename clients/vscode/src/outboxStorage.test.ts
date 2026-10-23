import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRevokeGate } from "@builderforce/write-outbox";
import {
  bindOutboxSendPermission,
  bindOutboxStorage,
  boundOutboxSendPermission,
  createDurableOutbox,
  durableStepHost,
  outboxSendPermission,
  setOutboxScope,
} from "./outboxStorage";

/**
 * G12 for the VS Code host: a revoked SEND PERMISSION must abort a durable flush that
 * is already in flight. The sender here deliberately ignores `ctx.signal` — exactly the
 * host senders in `activity.ts` / `bfApi.ts` / `gateway.ts`, which have no abort plumbing
 * of their own — so this is the case that a bare `sendPermission` alone does not cover:
 * without the gate the request resolves after the ban and the row is acknowledged and
 * dropped.
 */

/** The slice of `Memento` a durable store actually touches. */
class MemoryMemento {
  readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, value);
  }

  keys(): readonly string[] {
    return [...this.values.keys()];
  }
}

const memento = new MemoryMemento();
const STORAGE_PREFIX = "builderforce.outbox.";

/** The rows still held in the snapshot the durable store wrote — i.e. not acknowledged. */
const storedRows = (name: string): number => {
  const snapshot = memento.get<unknown>(`${STORAGE_PREFIX}${name}`);
  return JSON.stringify(snapshot ?? null).match(/"text"/g)?.length ?? 0;
};

/** Binds the host's storage (first bind wins — the module holds one host) and a fresh gate. */
const host = (): ReturnType<typeof createRevokeGate> => {
  const gate = createRevokeGate();
  bindOutboxStorage({ workspaceState: memento, secrets: {} } as never);
  bindOutboxSendPermission(gate);
  // Stable across tests, so this only replays parked queues on the very first call.
  setOutboxScope({ workspace: 7, key: undefined });
  return gate;
};

/** A sender that has been entered and can be released later, ignoring the abort signal. */
function hangingSender() {
  const state = { calls: 0, release: (): void => undefined };
  const entered = new Promise<void>((resolve) => {
    state.release = () => resolve();
  });
  let open: () => void = () => undefined;
  const firstSend = new Promise<void>((resolve) => {
    open = () => resolve();
  });
  return {
    state,
    firstSend,
    openSend: () => open(),
    async send(): Promise<{ ok: true }> {
      state.calls += 1;
      open();
      await entered;
      return { ok: true };
    },
  };
}

describe("durable host outbox — revoked send permission", () => {
  it("aborts a flush that is in flight, and does not acknowledge the row", async () => {
    vi.useFakeTimers();
    try {
      const gate = host();
      const sender = hangingSender();
      const outbox = createDurableOutbox<{ text: string }, string>("g12-inflight", {
        maxItems: 10,
        maxWaitMs: 0,
        send: sender.send,
      });

      // The durable store loads asynchronously (the host binds at activation), so wait
      // for the backlog load before queueing — otherwise the load replaces the lane.
      await outbox.ready();
      await outbox.enqueueDurable("chat-1", { text: "hello" });
      expect(outbox.size()).toBe(1);
      expect(storedRows("g12-inflight")).toBe(1);

      const flushed = outbox.flush();
      await sender.firstSend;
      expect(sender.state.calls).toBe(1);

      // The ban lands while the request is open. The sender ignores the abort and resolves.
      gate.revoke();
      sender.state.release();
      await flushed;

      expect(sender.state.calls).toBe(1);
      expect(outbox.size()).toBe(1);
      expect(storedRows("g12-inflight")).toBe(1);

      // …and nothing retries it while the ban holds.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(sender.state.calls).toBe(1);
      expect(outbox.size()).toBe(1);
      expect(storedRows("g12-inflight")).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never starts a send once the permission is revoked", async () => {
    const gate = host();
    gate.revoke();
    const sender = hangingSender();
    const outbox = createDurableOutbox<{ text: string }, string>("g12-never", {
      maxItems: 10,
      maxWaitMs: 0,
      send: sender.send,
    });

    await outbox.enqueueDurable("chat-1", { text: "queued while banned" });
    await outbox.flush();

    expect(sender.state.calls).toBe(0);
    expect(outbox.size()).toBe(1);
    expect(storedRows("g12-never")).toBe(1);
  });

  it("rejects an in-flight drain instead of reporting a success", async () => {
    const gate = host();
    const sender = hangingSender();
    const outbox = createDurableOutbox<{ text: string }, string>("g12-drain", {
      maxItems: 10,
      maxWaitMs: 0,
      send: sender.send,
    });

    await outbox.enqueueDurable("chat-1", { text: "rides along" });
    const drained = outbox.drainWith("chat-1", (items) =>
      sender.send().then(() => ({ sent: items.length })),
    );
    await sender.firstSend;

    gate.revoke();
    sender.state.release();

    // The drain must REJECT — a revoke can never be reported to a caller as a success.
    // The code is `permission_revoked` from the host's `guardSend`; the outbox core also
    // re-checks after the request resolves and may raise its own `platform_send_disabled`.
    await expect(drained).rejects.toThrow(/permission_revoked|platform_send_disabled/);
    expect(outbox.size()).toBe(1);
  });
});

/**
 * The fail-closed default: an outbox store with NO permission bound has not been told
 * sends are allowed, so it must not send. Clearing the binding restores that state, which
 * is how the extension's deactivation leaves the store too.
 */
describe("durable host outbox — unbound send permission", () => {
  // The module-level store is shared, and the suite above leaves a gate bound on it.
  beforeEach(() => bindOutboxSendPermission(null));

  it("denies while nothing is bound, and refuses a send rather than defaulting to allowed", async () => {
    const sender = hangingSender();
    const outbox = createDurableOutbox<{ text: string }, string>("g12-unbound", {
      maxItems: 10,
      maxWaitMs: 0,
      send: sender.send,
    });

    expect(boundOutboxSendPermission()).toBeNull();
    expect(outboxSendPermission.isAllowed()).toBe(false);

    await outbox.enqueueDurable("chat-1", { text: "never sent" });
    await outbox.flush();

    expect(sender.state.calls).toBe(0);
    expect(outbox.size()).toBe(1);
    expect(storedRows("g12-unbound")).toBe(1);

    // …and a drain reports the refusal, it never resolves as a success.
    await expect(
      outbox.drainWith("chat-1", (items) => Promise.resolve({ sent: items.length })),
    ).rejects.toMatchObject({ code: "PLATFORM_SEND_DISABLED" });
  });

  it("closes again when a bound permission is cleared", async () => {
    const gate = createRevokeGate();
    bindOutboxSendPermission(gate);
    expect(outboxSendPermission.isAllowed()).toBe(true);

    bindOutboxSendPermission(null);
    expect(boundOutboxSendPermission()).toBeNull();
    expect(outboxSendPermission.isAllowed()).toBe(false);
  });
});
describe("the Brain step queue writes the LOCAL store", () => {
  it("is not held on the platform send gate: a denied gate never refuses a run's step rows", async () => {
    // 2026.10.57: a signed-in Hybrid run (sync off) ended `agent.run failed:
    // platform_send_disabled` — its closing write drained this queue through the gate.
    bindOutboxSendPermission(null);
    expect(outboxSendPermission.isAllowed()).toBe(false);
    const sent: Array<{ chatId: number; rows: number }> = [];
    const host = durableStepHost(async (chatId, rows) => {
      sent.push({ chatId, rows: rows.length });
      return [];
    });
    expect(host.sendPermission).toBeUndefined();
    expect(host.online).toBeUndefined();
    await host.sendRows!(7, [{ role: "tool", content: "step" }], "tenant:1");
    expect(sent).toEqual([{ chatId: 7, rows: 1 }]);
  });
});
