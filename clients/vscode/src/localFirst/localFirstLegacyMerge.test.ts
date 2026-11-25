import { describe, expect, it } from "vitest";
import { EMPTY_LOCAL_FIRST_SNAPSHOT, type JournalEvent, type LocalFirstSnapshot } from "@builderforce/local-first";
import { planLegacyMerge } from "./localFirstLegacyMerge";

const BOUND = { kind: "bound", platformInstance: "https://example.test", tenantId: "1" } as const;
const event = (eventId: string, clientEntityId: string, operation: JournalEvent["operation"]): JournalEvent => ({
  eventId, clientEntityId, entityType: "message", operation, schemaVersion: 1, localSequence: 1, occurredAt: "x",
  dependsOn: [], destination: BOUND, payload: { text: "x" }, payloadHash: "h",
} as JournalEvent);

describe("planLegacyMerge after receipts were pruned", () => {
  it("does not re-queue a creating write the server already imported (its mapping says so)", () => {
    const legacy: LocalFirstSnapshot = { ...EMPTY_LOCAL_FIRST_SNAPSHOT, events: [event("e-import", "row-1", "import"), event("e-update", "row-1", "update"), event("e-other", "row-2", "import")] };
    // v3 holds the row's imported mapping, but its receipt was pruned at compaction.
    const current: LocalFirstSnapshot = {
      ...EMPTY_LOCAL_FIRST_SNAPSHOT,
      mappings: [{ destination: BOUND, entityType: "message", clientEntityId: "row-1", syncId: 1, serverId: "1", serverVersion: 1 } as LocalFirstSnapshot["mappings"][number]],
    };
    const merged = planLegacyMerge({ rows: {}, eventIds: [] } as never, legacy, current);
    expect(merged?.events?.map((merge) => merge.eventId)).toEqual(["e-update", "e-other"]);
  });
});
