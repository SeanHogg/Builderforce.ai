import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { newLocalRecord, type EntityDestination } from "@builderforce/local-first";
import { createDurableLocalFirstStore } from "./durableLocalFirstStore";

const BOUND: EntityDestination = { kind: "bound", platformInstance: "https://example.test", tenantId: "1" };
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("compaction prunes settled receipts", () => {
  it("publishes a base without the receipts of synced rows, and the window drops them from its own state", async () => {
    const root = await mkdtemp(nodePath.join(tmpdir(), "bf-receipt-prune-"));
    directories.push(root);
    const store = createDurableLocalFirstStore(root, { compaction: { maxFrames: 1 } });
    // Three rows the server imported: each has its mapping and the receipt of its (acknowledged) import.
    await store.transact(async (tx) => {
      for (const [index, id] of ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"].entries()) {
        await tx.put({ ...newLocalRecord({ id, entityType: "message", payload: { n: index }, deviceId: "d" }), destination: BOUND });
        await tx.putMapping({ destination: BOUND, entityType: "message", clientEntityId: id, syncId: index + 1, serverVersion: 1 });
        await tx.putReceipt({ eventId: `e-${index}`, entityType: "message", clientEntityId: id, status: "accepted", receivedAt: `2026-11-1${index}T00:00:00.000Z` });
      }
    });
    expect((await store.export()).receipts).toHaveLength(3);
    await store.transact(async (tx) => { await tx.setReadMark("probe", "2026-11-13T00:00:00.000Z"); });
    await store.flush(); // the frame after the base tripped the policy: the compaction ran
    // The base keeps only the newest push ("last push" in the sync summary)...
    const reopened = createDurableLocalFirstStore(root);
    expect((await reopened.export()).receipts.map((receipt) => receipt.eventId)).toEqual(["e-2"]);
    // ...and the compacting window matches it.
    expect((await store.export()).receipts.map((receipt) => receipt.eventId)).toEqual(["e-2"]);
    expect((await store.export()).mappings).toHaveLength(3);
  });
});
