import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { UNBOUND_DESTINATION, type JournalEvent, type LocalFirstSnapshot, type LocalRecord, type SyncConflict, type SyncReceipt } from "@builderforce/local-first";
import { deriveRecordSyncStatus } from "@builderforce/local-first";
import {
  PRESENTED_SYNC_PRECEDENCE,
  PRESENTED_SYNC_STATUSES,
  presentDerivedSyncStatus,
  presentStoreSyncStatus,
  presentSurfaceSyncStatus,
  presentSyncStatus,
  presentedSyncShownAsDone,
  preferPresentedSyncStatus,
  type PresentedSyncStatus,
  type SyncStatusSurface,
} from "./syncStatusPresenter";

function record(entityType: LocalRecord["entityType"], id: string, payload: unknown = { title: id }): LocalRecord {
  return {
    id,
    entityType,
    schemaVersion: 1,
    version: 1,
    destination: UNBOUND_DESTINATION,
    occurredAt: "2026-10-19T00:00:00.000Z",
    updatedAt: "2026-10-19T00:00:00.000Z",
    payload,
    provenance: { deviceId: "device-1", source: "local" },
  };
}

function event(partial: Partial<JournalEvent> & Pick<JournalEvent, "eventId" | "clientEntityId" | "entityType">): JournalEvent {
  return {
    operation: "create",
    schemaVersion: 1,
    localSequence: 1,
    occurredAt: "2026-10-19T00:00:00.000Z",
    dependsOn: [],
    destination: UNBOUND_DESTINATION,
    payload: {},
    payloadHash: "fnv1a:00000000",
    ...partial,
  };
}

function receipt(eventId: string, status: SyncReceipt["status"]): SyncReceipt {
  return { eventId, status, receivedAt: "2026-10-19T00:01:00.000Z" };
}

function conflict(recordId: string, entityType: LocalRecord["entityType"], resolvedAt?: string): SyncConflict {
  const local = record(entityType, recordId);
  return {
    id: `conflict:${recordId}`,
    clientEntityId: recordId,
    entityType,
    local,
    remote: { ...local, version: 2, provenance: { deviceId: "remote", source: "imported" } },
    reason: "pending_local_mutation_overlaps_remote_version",
    createdAt: "2026-10-19T00:02:00.000Z",
    ...(resolvedAt ? { resolvedAt } : {}),
  };
}

function snapshot(partial: Partial<LocalFirstSnapshot> & Pick<LocalFirstSnapshot, "records">): LocalFirstSnapshot {
  return {
    records: partial.records,
    events: partial.events ?? [],
    mappings: [],
    receipts: partial.receipts ?? [],
    conflicts: partial.conflicts ?? [],
    cursors: {},
    nextSequence: 1,
  };
}

describe("preferPresentedSyncStatus", () => {
  it("ranks dead-letter over conflict over syncing over pending over synced", () => {
    const cases: Array<[PresentedSyncStatus[], PresentedSyncStatus]> = [
      [["synced", "pending", "syncing", "conflict", "dead-letter"], "dead-letter"],
      [["synced", "pending", "syncing", "conflict"], "conflict"],
      [["synced", "pending", "syncing"], "syncing"],
      [["synced", "pending"], "pending"],
      [["synced"], "synced"],
    ];
    for (const [statuses, winner] of cases) {
      expect(preferPresentedSyncStatus(statuses)).toBe(winner);
      expect(preferPresentedSyncStatus([...statuses].reverse())).toBe(winner);
    }
    expect([...PRESENTED_SYNC_PRECEDENCE]).toEqual(["dead-letter", "conflict", "syncing", "pending", "synced"]);
  });

  it("refuses to invent a status when nothing was observed", () => {
    expect(() => preferPresentedSyncStatus([])).toThrow(/sync_status_required/);
  });
});

describe("presentDerivedSyncStatus", () => {
  it("renames local to pending and passes the other store codes through", () => {
    expect(presentDerivedSyncStatus("local")).toBe("pending");
    expect(presentDerivedSyncStatus("syncing")).toBe("syncing");
    expect(presentDerivedSyncStatus("synced")).toBe("synced");
    expect(presentDerivedSyncStatus("conflict")).toBe("conflict");
    expect(presentDerivedSyncStatus("dead-letter")).toBe("dead-letter");
    expect([...PRESENTED_SYNC_STATUSES]).toEqual(["pending", "syncing", "synced", "conflict", "dead-letter"]);
  });
});

describe("presentSyncStatus", () => {
  it("presents a record with no journal as pending, not synced", () => {
    const row = record("chat", "chat-1");
    expect(presentSyncStatus({ record: row })).toBe("pending");
    expect(presentSyncStatus({ record: row })).not.toBe("synced");
  });

  it("presents an unsettled journal row as syncing, which outranks pending", () => {
    const row = record("ticket", "ticket-1");
    const status = presentSyncStatus({
      record: row,
      events: [event({ eventId: "e1", clientEntityId: "ticket-1", entityType: "ticket" })],
    });
    expect(status).toBe("syncing");
    expect(status).not.toBe("pending");
    expect(presentedSyncShownAsDone(row, status)).toBe(false);
  });

  it("presents an accepted or duplicate receipt as synced when nothing newer is open", () => {
    const row = record("ticket", "ticket-1");
    const pending = [event({ eventId: "e1", clientEntityId: "ticket-1", entityType: "ticket" })];
    expect(presentSyncStatus({ record: row, events: pending, receipts: [receipt("e1", "accepted")] })).toBe("synced");
    expect(presentSyncStatus({ record: row, events: [], receipts: [receipt("e1", "duplicate")] })).toBe("synced");
    expect(presentedSyncShownAsDone(row, "synced")).toBe(true);
  });

  it("lets syncing outrank a settled older receipt", () => {
    const row = record("execution", "run-1");
    expect(presentSyncStatus({
      record: row,
      events: [
        event({ eventId: "e1", clientEntityId: "run-1", entityType: "execution", localSequence: 1 }),
        event({ eventId: "e2", clientEntityId: "run-1", entityType: "execution", localSequence: 2 }),
      ],
      receipts: [receipt("e1", "accepted")],
    })).toBe("syncing");
  });

  it("lets conflict outrank syncing", () => {
    const row = record("ticket", "ticket-1");
    expect(presentSyncStatus({
      record: row,
      events: [event({ eventId: "e1", clientEntityId: "ticket-1", entityType: "ticket" })],
      conflicts: [conflict("ticket-1", "ticket")],
    })).toBe("conflict");
    expect(presentedSyncShownAsDone(row, "conflict")).toBe(false);
  });

  it("lets dead-letter outrank an open conflict, which the store model would have preferred", () => {
    const row = record("chat", "chat-1");
    const input = {
      record: row,
      events: [event({
        eventId: "e1",
        clientEntityId: "chat-1",
        entityType: "chat" as const,
        deadLetter: { reason: "give-up", at: "2026-10-19T00:03:00.000Z" },
      })],
      receipts: [receipt("e1", "accepted")],
      conflicts: [conflict("chat-1", "chat")],
    };
    expect(deriveRecordSyncStatus(input)).toBe("conflict");
    expect(presentSyncStatus(input)).toBe("dead-letter");
    expect(presentedSyncShownAsDone(row, "dead-letter")).toBe(false);
  });

  it("does not treat an older dead letter as the winner once a newer event is unsettled", () => {
    const row = record("execution", "run-1");
    expect(presentSyncStatus({
      record: row,
      events: [
        event({
          eventId: "old",
          clientEntityId: "run-1",
          entityType: "execution",
          localSequence: 1,
          deadLetter: { reason: "rejected", at: "2026-10-19T00:03:00.000Z" },
        }),
        event({ eventId: "new", clientEntityId: "run-1", entityType: "execution", localSequence: 2 }),
      ],
    })).toBe("syncing");
  });

  it("presents a rejected receipt with no remaining event as dead-letter, not synced", () => {
    const row = record("audit-run", "audit-1");
    expect(presentSyncStatus({ record: row, events: [], receipts: [receipt("e1", "rejected")] })).toBe("dead-letter");
    expect(presentedSyncShownAsDone(row, "dead-letter")).toBe(false);
  });

  it("does not show a denied sync as done on chat, ticket, audit, or run", () => {
    const surfaces: Array<[SyncStatusSurface, LocalRecord["entityType"], string]> = [
      ["chat", "chat", "chat-denied"],
      ["ticket", "ticket", "ticket-denied"],
      ["audit", "audit-run", "audit-denied"],
      ["run", "execution", "run-denied"],
    ];
    for (const [surface, entityType, id] of surfaces) {
      const row = record(entityType, id);
      const pending = [event({ eventId: `${id}-e1`, clientEntityId: id, entityType })];
      const deniedWhilePending = presentSyncStatus({
        record: row,
        events: pending,
        receipts: [receipt(`${id}-e1`, "rejected")],
      });
      expect(deniedWhilePending).toBe("syncing");
      expect(deniedWhilePending).not.toBe("synced");
      expect(presentedSyncShownAsDone(row, deniedWhilePending)).toBe(false);

      const deniedAfterDrop = presentSyncStatus({
        record: row,
        events: [],
        receipts: [receipt(`${id}-e1`, "rejected")],
      });
      expect(deniedAfterDrop).toBe("dead-letter");
      expect(deniedAfterDrop).not.toBe("synced");
      expect(presentedSyncShownAsDone(row, deniedAfterDrop)).toBe(false);

      const stored = snapshot({
        records: [row],
        events: pending,
        receipts: [receipt(`${id}-e1`, "rejected")],
      });
      const fromStore = presentSurfaceSyncStatus(stored, surface, id);
      expect(fromStore).toBe("syncing");
      expect(presentedSyncShownAsDone(row, fromStore!)).toBe(false);
    }
  });

  it("ignores another record's event, receipt, and conflict", () => {
    const mine = record("ticket", "ticket-1");
    expect(presentSyncStatus({
      record: mine,
      events: [event({ eventId: "other", clientEntityId: "ticket-2", entityType: "ticket", localSequence: 9, deadLetter: { reason: "x", at: "2026-10-19T00:03:00.000Z" } })],
      receipts: [receipt("other", "accepted")],
      conflicts: [conflict("ticket-2", "ticket")],
    })).toBe("pending");
  });

  it("keeps a completed local audit done while pending, and not when conflict or dead-letter wins", () => {
    const completed = record("audit-run", "audit-1", { status: "completed" });
    expect(presentSyncStatus({ record: completed })).toBe("pending");
    expect(presentedSyncShownAsDone(completed, "pending")).toBe(true);
    expect(presentedSyncShownAsDone(completed, "syncing")).toBe(true);
    expect(presentedSyncShownAsDone(completed, "conflict")).toBe(false);
    expect(presentedSyncShownAsDone(completed, "dead-letter")).toBe(false);
  });
});

describe("presentStoreSyncStatus", () => {
  it("reads one entity from a store snapshot and does not invent a status for a missing row", () => {
    const stored = snapshot({
      records: [record("chat", "chat-1"), record("ticket", "ticket-1")],
      events: [event({ eventId: "e1", clientEntityId: "ticket-1", entityType: "ticket" })],
    });
    expect(presentStoreSyncStatus(stored, { entityType: "chat", id: "chat-1" })).toBe("pending");
    expect(presentStoreSyncStatus(stored, { entityType: "ticket", id: "ticket-1" })).toBe("syncing");
    expect(presentStoreSyncStatus(stored, { entityType: "execution", id: "run-missing" })).toBeUndefined();
  });

  it("presents chat, ticket, audit, and run from the same snapshot", () => {
    const surfaces: Array<[SyncStatusSurface, LocalRecord["entityType"], string]> = [
      ["chat", "chat", "chat-1"],
      ["ticket", "ticket", "ticket-1"],
      ["audit", "audit-run", "audit-1"],
      ["run", "execution", "run-1"],
    ];
    const stored = snapshot({
      records: surfaces.map(([, entityType, id]) => record(entityType, id)),
      receipts: [receipt("run-accepted", "accepted")],
      events: [event({ eventId: "run-accepted", clientEntityId: "run-1", entityType: "execution" })],
    });
    expect(presentSurfaceSyncStatus(stored, "chat", "chat-1")).toBe("pending");
    expect(presentSurfaceSyncStatus(stored, "ticket", "ticket-1")).toBe("pending");
    expect(presentSurfaceSyncStatus(stored, "audit", "audit-1")).toBe("pending");
    expect(presentSurfaceSyncStatus(stored, "run", "run-1")).toBe("synced");
    expect(presentSurfaceSyncStatus(stored, "audit", "audit-finding-1")).toBeUndefined();
  });
});

describe("sync status presenter stays a pure derivation", () => {
  const source = fs.readFileSync(path.join(__dirname, "syncStatusPresenter.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("does not read platformRequestAccount, call the network, or localize", () => {
    expect(source).not.toContain("platformRequestAccount");
    expect(source).not.toContain("vscode");
    expect(source).not.toContain("l10n");
    expect(source).not.toMatch(/\bfetch\b/);
    expect(source).toContain("deriveRecordSyncStatus");
    expect(source).toContain("syncShownAsDone");
  });
});
