import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutbox } from "./outbox.js";
import { isPermanentHttpFailure } from "./policy.js";
import {
  assertSendAllowed,
  createRevokeGate,
  filterSendable,
  gateOutboxSend,
  guardSend,
  isPermissionRevoked,
  permissionRevokedError,
} from "./revokeGate.js";
import { createMemoryOutboxStore } from "./stores.js";

describe("revokeGate", () => {
  it("sends every row when permission is granted and holds every row otherwise", () => {
    const rows = ["a", "b"];
    const granted = filterSendable(rows, "granted");
    expect(granted.send).toBe(rows);
    expect(granted.held).toEqual([]);

    const revoked = filterSendable(rows, "revoked");
    expect(revoked.send).toEqual([]);
    expect(revoked.held).toBe(rows);
    expect(rows).toEqual(["a", "b"]);
  });

  it("throws permission_revoked unless permission is granted", () => {
    expect(() => assertSendAllowed("granted")).not.toThrow();
    expect(() => assertSendAllowed("revoked")).toThrow(permissionRevokedError());
    expect(isPermissionRevoked(permissionRevokedError())).toBe(true);
    expect(isPermanentHttpFailure(permissionRevokedError())).toBe(false);
  });

  it("acknowledges a send while permission stays granted", async () => {
    const gate = createRevokeGate("granted");
    await expect(guardSend(gate, () => "sent")).resolves.toBe("sent");
  });

  it("does not call send when permission is already denied", async () => {
    const gate = createRevokeGate("revoked");
    let calls = 0;
    await expect(guardSend(gate, () => {
      calls += 1;
      return "sent";
    })).rejects.toMatchObject({ code: "permission_revoked" });
    await expect(gateOutboxSend(gate, () => {
      calls += 1;
    })("lane", ["row"], { final: false, idempotencyKey: "k", ids: ["1"] })).rejects.toMatchObject({
      code: "permission_revoked",
    });
    expect(calls).toBe(0);
  });

  it("rejects an in-flight send when permission flips and does not retry it", async () => {
    const gate = createRevokeGate("granted");
    let calls = 0;
    let release: (() => void) | undefined;
    const pending = guardSend(gate, () => {
      calls += 1;
      return new Promise<string>((resolve) => {
        release = () => resolve("sent");
      });
    });
    await Promise.resolve();
    expect(calls).toBe(1);
    gate.revoke();
    await expect(pending).rejects.toMatchObject({ code: "permission_revoked" });
    release?.();
    await Promise.resolve();
    await expect(guardSend(gate, () => {
      calls += 1;
      return "again";
    })).rejects.toMatchObject({ code: "permission_revoked" });
    expect(calls).toBe(1);
  });
});

describe("revokeGate — durable flush", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("aborts an in-flight flush when permission flips, does not retry, and keeps the durable row", async () => {
    const gate = createRevokeGate("granted");
    const store = createMemoryOutboxStore<string, string>();
    let calls = 0;
    let release: (() => void) | undefined;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const box = createOutbox<string>({
      maxWaitMs: 0,
      retry: { baseMs: 1_000, maxMs: 60_000 },
      store,
      sendPermission: gate,
      send: gateOutboxSend(gate, () => {
        calls += 1;
        started();
        return new Promise<void>((resolve) => {
          release = () => resolve();
        });
      }),
    });

    const id = await box.enqueueDurable("lane", "row");
    const flushing = box.flush("lane");
    await startedPromise;
    expect(calls).toBe(1);

    gate.revoke();
    await flushing;
    await box.ready();

    expect(calls).toBe(1);
    expect(box.size()).toBe(1);
    expect(box.stats()).toMatchObject({ deadLetters: 0, dropped: 0 });
    expect((await store.load()).map((entry) => entry.id)).toEqual([id]);

    release?.();
    await vi.advanceTimersByTimeAsync(60_000);
    await box.ready();

    expect(calls).toBe(1);
    expect(box.size()).toBe(1);
    expect((await store.load()).map((entry) => entry.item)).toEqual(["row"]);

    gate.grant();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    release?.();
    await vi.advanceTimersByTimeAsync(0);
    await box.ready();
    expect(box.size()).toBe(0);
    expect(await store.load()).toEqual([]);
    box.close();
  });
});
