import { describe, expect, it } from "vitest";
import type { SyncStatusStoreEvent } from "@builderforce/local-first";
import { labelFor } from "./syncStatusLabel";

describe("labelFor", () => {
  it("labels three event lists and does not mutate them", () => {
    const idle: SyncStatusStoreEvent[] = [];
    const pending: SyncStatusStoreEvent[] = [{ clientEntityId: "ticket-1", unsent: true }];
    const conflict: SyncStatusStoreEvent[] = [{ clientEntityId: "audit-1", conflict: true }];
    const lists = [idle, pending, conflict];
    const before = lists.map((events) => events.map((event) => ({ ...event })));
    const elementRefs = lists.map((events) => events.slice());

    expect(labelFor(idle)).toBe("Local");
    expect(labelFor(pending)).toBe("Waiting to sync");
    expect(labelFor(conflict)).toBe("Needs review");

    const denied: SyncStatusStoreEvent[] = [{
      clientEntityId: "chat-denied",
      status: "rejected",
      deadLetter: { reason: "denied", at: "2026-10-19T00:03:00.000Z" },
    }];
    expect(labelFor(denied)).toBe("Waiting to sync");
    expect(labelFor(denied)).not.toBe("Local");

    expect(lists.map((events) => events.map((event) => ({ ...event })))).toEqual(before);
    for (let i = 0; i < lists.length; i++) {
      expect(lists[i]).toHaveLength(elementRefs[i].length);
      for (let j = 0; j < lists[i].length; j++) {
        expect(lists[i][j]).toBe(elementRefs[i][j]);
      }
    }
  });
});
