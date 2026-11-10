import { describe, expect, it } from "vitest";
import {
  createMemoryLocalFirstStore,
  ingestServerRecords,
  newLocalRecord,
  type EntityDestination,
  type LocalFirstStore,
} from "@builderforce/local-first";
import { linkRailTicket, unlinkRailTicket } from "./railLinks";
import { ticketRows } from "./railRows";

const DEST: EntityDestination = { kind: "bound", platformInstance: "https://api.example", tenantId: "tenant-1" };
const CHAT = "00000000-0000-4000-8000-0000000000c1";
const AT = "2026-11-09T12:00:00.000Z";
const PORTS = { deviceId: "device-1", now: () => new Date(AT) };

async function chatStore(): Promise<LocalFirstStore> {
  const store = createMemoryLocalFirstStore();
  await store.transact(async (tx) => {
    await tx.put(newLocalRecord({
      id: CHAT, entityType: "chat", deviceId: "device-1", destination: DEST,
      payload: { clientId: CHAT, chat: { id: 1, title: "A chat" } },
    }));
  });
  return store;
}

const liveTickets = async (store: LocalFirstStore) =>
  (await store.export()).records.filter((row) => row.entityType === "ticket" && !row.deletedAt);

describe("rail tier tickets are found by their externalRef", () => {
  it("regression: a tier ticket is mapped with syncId null + externalRef kind:ref, and link/unlink find it by that ref", async () => {
    const store = await chatStore();
    // Task 5 and spec 5 share a ref but not an id space: they must stay two tickets.
    const ingested = await ingestServerRecords(store, ticketRows([{ kind: "spec", ref: "5" }, { kind: "task", ref: "5" }], DEST, AT));
    const [specId, taskId] = ingested.clientIds;
    expect(specId).toBeTruthy();
    expect(taskId).toBeTruthy();
    expect(specId).not.toBe(taskId);

    const mappings = (await store.export()).mappings.filter((row) => row.entityType === "ticket");
    expect(mappings.find((row) => row.clientEntityId === specId)).toMatchObject({ syncId: null, externalRef: "spec:5" });
    expect(mappings.find((row) => row.clientEntityId === taskId)).toMatchObject({ syncId: 5 });

    expect(await linkRailTicket(store, PORTS, CHAT, { kind: "spec", ref: "5" }, "linked")).toEqual({ ok: true });
    // No second stub: the link landed on the ingested spec ticket.
    expect(await liveTickets(store)).toHaveLength(2);
    const links = (await store.export()).records.filter((row) => row.entityType === "chat-ticket-link" && !row.deletedAt);
    expect(links.map((row) => (row.payload as { ticketClientId: string }).ticketClientId)).toEqual([specId]);

    expect(await unlinkRailTicket(store, PORTS, CHAT, { kind: "spec", ref: "5" })).toEqual({ ok: true });
  });
});
