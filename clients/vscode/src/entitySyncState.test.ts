import { describe, expect, it } from "vitest";
import type { SyncReceipt } from "@builderforce/local-first";
import type { SyncStatusStore, SyncStatusStoreEvent } from "../../../packages/local-first/src/syncStatus.ts";
import { stamp, statusFor } from "./entitySyncState";

function store(
  events: readonly SyncStatusStoreEvent[],
  partial: Partial<SyncStatusStore> = {},
): SyncStatusStore {
  return { reachable: true, events, ...partial };
}

describe("statusFor", () => {
  it("is idle for a chat with no events", () => {
    const chat = { id: "chat-1", kind: "chat" as const, title: "empty" };
    expect(statusFor(chat, store([]))).toBe("idle");
    expect(statusFor(chat, store([], { reachable: false }))).toBe("idle");
  });

  it("is pending for an entity with one unsent event", () => {
    const ticket = { id: "ticket-1", kind: "ticket" as const };
    expect(statusFor(ticket, store([{ clientEntityId: "ticket-1", unsent: true }]))).toBe("pending");
  });

  it("is conflict for an entity in conflict even when other entities are idle", () => {
    const audit = { id: "audit-1", kind: "audit" as const };
    const idleRun = { id: "run-1", kind: "run" as const };
    const shared = store([
      { clientEntityId: "audit-1", conflict: true },
      { clientEntityId: "chat-9", sent: true },
    ]);
    expect(statusFor(audit, shared)).toBe("conflict");
    expect(statusFor(idleRun, shared)).toBe("idle");
    expect(statusFor({ id: "chat-9", kind: "chat" }, shared)).toBe("idle");
  });

  it("does not take another entity's unsent event or conflict", () => {
    const chat = { id: "chat-1", kind: "chat" as const };
    const shared = store([
      { clientEntityId: "ticket-1", unsent: true },
      { clientEntityId: "run-1", conflict: true },
    ]);
    expect(statusFor(chat, shared)).toBe("idle");
    expect(statusFor({ id: "ticket-1" }, shared)).toBe("pending");
    expect(statusFor({ id: "run-1" }, shared)).toBe("conflict");
  });

  it("does not read a syncStatus already cached on the entity", () => {
    const cached = { id: "chat-2", kind: "chat" as const, syncStatus: "synced" as const };
    expect(statusFor(cached, store([{ clientEntityId: "chat-2", unsent: true }]))).toBe("pending");
    expect(statusFor(cached, store([]))).toBe("idle");
  });

  it("does not treat a denied receipt as idle on chat, ticket, audit, or run", () => {
    const entities = [
      { id: "chat-denied", kind: "chat" as const },
      { id: "ticket-denied", kind: "ticket" as const },
      { id: "audit-denied", kind: "audit" as const },
      { id: "run-denied", kind: "run" as const },
    ];
    for (const entity of entities) {
      const denied: SyncReceipt = {
        eventId: `${entity.id}-e1`,
        status: "rejected",
        receivedAt: "2026-10-19T00:01:00.000Z",
      };
      const shared = store(
        [{ eventId: denied.eventId, clientEntityId: entity.id }],
        { receipts: [denied] },
      );
      const status = statusFor(entity, shared);
      expect(status).toBe("pending");
      expect(status).not.toBe("idle");
      expect(stamp(entity, shared).syncStatus).toBe("pending");
    }
  });
});

describe("stamp", () => {
  it("returns a new object and does not mutate the input", () => {
    const chat = { id: "chat-1", kind: "chat" as const, title: "local" };
    const before = { ...chat };
    const events = store([{ clientEntityId: "chat-1", unsent: true }]);
    const stamped = stamp(chat, events);
    expect(stamped).toEqual({ id: "chat-1", kind: "chat", title: "local", syncStatus: "pending" });
    expect(stamped).not.toBe(chat);
    expect(chat).toEqual(before);
    expect("syncStatus" in chat).toBe(false);
  });

  it("overwrites a cached syncStatus with the status derived from this entity's events", () => {
    const ticket = { id: "ticket-1", kind: "ticket" as const, syncStatus: "idle" as const };
    const shared = store([
      { clientEntityId: "ticket-1", conflict: true },
      { clientEntityId: "audit-1", unsent: true },
    ]);
    const stamped = stamp(ticket, shared);
    expect(stamped.syncStatus).toBe("conflict");
    expect(ticket.syncStatus).toBe("idle");
    expect(stamp({ id: "audit-1", kind: "audit" as const }, shared).syncStatus).toBe("pending");
    expect(stamp({ id: "run-1", kind: "run" as const }, shared).syncStatus).toBe("idle");
  });
});
