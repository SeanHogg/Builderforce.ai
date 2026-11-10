/**
 * regression: the editor's id lookups resolve a SyncId in the ACTIVE account only
 * (docs/design/typed-entity-ids.md §3). Two tenants each numbered a chat and a ticket 40; the
 * older mapping belongs to tenant A, so an unscoped lookup used to hand tenant B's caller A's row.
 */

import { describe, expect, it } from "vitest";
import {
  createMemoryLocalFirstStore,
  newLocalRecord,
  type EntityDestination,
  type LocalFirstStore,
} from "@builderforce/local-first";
import { chatClientIdOf } from "./chatRail/buildRail";
import { resolveChat } from "./chatRail/resolveChat";
import { resolveLocalReference } from "./localEntityRefs";
import { ticketServerIdLookup } from "./localTicketIdBridge";

const A: EntityDestination = { kind: "bound", platformInstance: "https://api.example", tenantId: "7" };
const B: EntityDestination = { kind: "bound", platformInstance: "https://api.example", tenantId: "8" };
const CHAT_A = "00000000-0000-4000-8000-00000000000a";
const CHAT_B = "00000000-0000-4000-8000-00000000000b";
const TICKET_A = "11111111-1111-4111-8111-11111111111a";
const TICKET_B = "11111111-1111-4111-8111-11111111111b";

async function twoTenants(): Promise<LocalFirstStore> {
  const store = createMemoryLocalFirstStore();
  await store.transact(async (tx) => {
    for (const [id, destination] of [[CHAT_A, A], [CHAT_B, B]] as const) {
      await tx.put(newLocalRecord({ id, entityType: "chat", deviceId: "d", destination, payload: {} }));
    }
    for (const [id, destination] of [[TICKET_A, A], [TICKET_B, B]] as const) {
      await tx.put(newLocalRecord({ id, entityType: "ticket", deviceId: "d", destination, payload: { title: "t", status: "todo" } }));
    }
    // Tenant A's rows are mapped FIRST: the legacy (unscoped) lookup picks them.
    await tx.putMapping({ destination: A, entityType: "chat", clientEntityId: CHAT_A, syncId: 40, serverVersion: 1 });
    await tx.putMapping({ destination: A, entityType: "ticket", clientEntityId: TICKET_A, syncId: 40, serverVersion: 1 });
    await tx.putMapping({ destination: B, entityType: "chat", clientEntityId: CHAT_B, syncId: 40, serverVersion: 1 });
    await tx.putMapping({ destination: B, entityType: "ticket", clientEntityId: TICKET_B, syncId: 40, serverVersion: 1 });
  });
  return store;
}

describe("regression: id lookups stay inside the active account", () => {
  it("resolveChat and chatClientIdOf: server chat 40 is tenant B's chat for tenant B", async () => {
    const store = await twoTenants();
    expect((await store.read((tx) => resolveChat(tx, 40, { tenantId: "8" })))?.clientId).toBe(CHAT_B);
    expect((await store.read((tx) => resolveChat(tx, 40, { tenantId: "9" })))).toBeUndefined();
    const facts = await store.export();
    expect(chatClientIdOf(facts, 40, { tenantId: "8" })).toBe(CHAT_B);
    expect(chatClientIdOf(facts, 40, { tenantId: "7" })).toBe(CHAT_A);
  });

  it("resolveLocalReference: ticket 40 resolves to the active tenant's mirror", async () => {
    const store = await twoTenants();
    expect(await resolveLocalReference(store, "ticket", "40", { tenantId: "8" })).toBe(TICKET_B);
    // No mirror in this tenant: the integer text passes through as a server reference.
    expect(await resolveLocalReference(store, "ticket", "40", { tenantId: "9" })).toBe("40");
  });

  it("ticketServerIdLookup reads the scope per call (a workspace switch is seen at once)", async () => {
    const store = await twoTenants();
    let tenantId = "7";
    const lookup = ticketServerIdLookup(store, () => ({ tenantId }));
    expect(await lookup(TICKET_B)).toBeUndefined();
    tenantId = "8";
    expect(await lookup(TICKET_B)).toBe("40");
  });
});
