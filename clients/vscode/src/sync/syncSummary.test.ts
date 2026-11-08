import { describe, expect, it } from "vitest";
import type { JournalEvent, SyncConflict, SyncReceipt } from "@builderforce/local-first";
import { buildSyncSummary, readSyncSummary, summaryDestination } from "./syncSummary";

const event = (id: string, payload: unknown, extra: Partial<JournalEvent> = {}): JournalEvent => ({
  eventId: id, clientEntityId: id, entityType: "ticket", operation: "create", schemaVersion: 1, localSequence: 1,
  occurredAt: "2026-11-08T00:00:00.000Z", dependsOn: [], destination: { kind: "unbound" }, payload, payloadHash: id,
  ...extra,
});
const receipt = (eventId: string, status: SyncReceipt["status"], receivedAt: string): SyncReceipt => ({ eventId, status, receivedAt });
const conflict = (id: string, resolvedAt?: string): SyncConflict => ({
  id, clientEntityId: id, entityType: "ticket", reason: "x", createdAt: "2026-11-08T00:00:00.000Z",
  local: {} as never, remote: {} as never, ...(resolvedAt ? { resolvedAt } : {}),
});

describe("buildSyncSummary", () => {
  it("counts queued items and bytes, conflicts and dead letters, and the last push", () => {
    const summary = buildSyncSummary({
      events: [
        event("a", { title: "abc" }),
        event("b", { title: "é" }),
        event("c", { title: "dead" }, { deadLetter: { reason: "refused", at: "2026-11-08T00:00:00.000Z" } }),
      ],
      receipts: [
        receipt("x", "accepted", "2026-11-07T10:00:00.000Z"),
        receipt("y", "duplicate", "2026-11-08T09:00:00.000Z"),
        receipt("z", "rejected", "2026-11-09T09:00:00.000Z"),
      ],
      conflicts: [conflict("k1"), conflict("k2", "2026-11-08T01:00:00.000Z")],
    }, {
      mode: "hybrid",
      destination: { kind: "bound", tenantId: "tenant-1" },
      lastPullAt: "2026-11-08T08:00:00.000Z",
    });
    expect(summary.queued.items).toBe(2);
    // JSON bytes, UTF-8: {"title":"abc"} = 15, {"title":"é"} = 14.
    expect(summary.queued.bytes).toBe(15 + 14);
    expect(summary.deadLetters).toBe(1);
    expect(summary.conflicts).toBe(1);
    expect(summary.lastPushAt).toBe("2026-11-08T09:00:00.000Z");
    expect(summary.lastPullAt).toBe("2026-11-08T08:00:00.000Z");
    expect(summary.mode).toBe("hybrid");
    expect(summary.destination).toEqual({ kind: "bound", label: "tenant-1" });
  });

  it("an empty store is local-only with nothing queued and no push or pull", () => {
    const summary = buildSyncSummary({ events: [], receipts: [], conflicts: [] }, { mode: "local-only", destination: undefined });
    expect(summary).toEqual({
      mode: "local-only", destination: { kind: "unbound" }, queued: { items: 0, bytes: 0 }, conflicts: 0, deadLetters: 0,
    });
  });

  it("names the workspace, else the account, else the platform", () => {
    expect(summaryDestination({ kind: "bound", accountId: "acct", platformInstance: "https://p" })).toEqual({ kind: "bound", label: "acct" });
    expect(summaryDestination({ kind: "bound", platformInstance: "https://p" })).toEqual({ kind: "bound", label: "https://p" });
    expect(summaryDestination({ kind: "bound" })).toEqual({ kind: "unbound" });
  });
});

describe("readSyncSummary", () => {
  it("reads the last pull for the destination from the store port, and none without a destination", async () => {
    const facts = async () => ({ events: [], receipts: [], conflicts: [] });
    const bound = await readSyncSummary({
      facts, mode: () => "hybrid", destination: () => ({ kind: "bound", tenantId: "t" }), lastPullAt: async () => "2026-11-08T00:00:00.000Z",
    });
    expect(bound.lastPullAt).toBe("2026-11-08T00:00:00.000Z");
    const unbound = await readSyncSummary({
      facts, mode: () => "local-only", destination: () => undefined, lastPullAt: async () => "never-asked",
    });
    expect(unbound.lastPullAt).toBeUndefined();
  });
});
