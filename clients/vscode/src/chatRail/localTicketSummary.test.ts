import { describe, expect, it } from "vitest";
import { createMemoryLocalFirstStore, newLocalRecord, UNBOUND_DESTINATION, type TicketValue } from "@builderforce/local-first";
import type { BrainChat } from "@seanhogg/builderforce-brain-embedded";
import { mergeLocalTicketSummary, withLocalTickets } from "./localTicketSummary";

const CHAT = "chat-client-1";

const chatRow = (extra: Partial<BrainChat> = {}): BrainChat =>
  ({ id: 1, title: "Chat", projectId: null, clientId: CHAT, ...extra }) as BrainChat;

async function storeWith(tickets: Array<{ id: string; status: string; chatClientId?: string }>, mapped: string[] = []) {
  const store = createMemoryLocalFirstStore();
  await store.transact(async (tx) => {
    for (const tk of tickets) {
      const payload: TicketValue = { projectId: "p", title: tk.id, status: tk.status, ...(tk.chatClientId ? { chatClientId: tk.chatClientId } : {}) };
      await tx.put(newLocalRecord<TicketValue>({ id: tk.id, entityType: "ticket", payload, deviceId: "d" }));
    }
    for (const id of mapped) {
      await tx.putMapping({ destination: UNBOUND_DESTINATION, entityType: "ticket", clientEntityId: id, serverId: id, serverVersion: 1 });
    }
  });
  return store;
}

describe("withLocalTickets", () => {
  it("regression: a chat with 3 local unbound tickets (1 done, 2 open) shows ticketCount 3, open 2, done 1 on its row", async () => {
    // 2026-11-08: tickets filed on-device by a run and its sub-agents never reached the server
    // (sync not granted), so the server summary said 0 and the history row read "No tickets".
    const store = await storeWith([
      { id: "t1", status: "done", chatClientId: CHAT },
      { id: "t2", status: "in_progress", chatClientId: CHAT },
      { id: "t3", status: "backlog", chatClientId: CHAT },
      { id: "other", status: "backlog", chatClientId: "another-chat" },
    ]);
    const [row] = await withLocalTickets(store, [chatRow()]);
    expect(row).toMatchObject({ ticketCount: 3, ticketOpenCount: 2, ticketDoneCount: 1, ticketProgressPct: 33 });
  });

  it("never counts a ticket the server already maps (the server summary has it)", async () => {
    const store = await storeWith([
      { id: "t1", status: "done", chatClientId: CHAT },
      { id: "t2", status: "backlog", chatClientId: CHAT },
    ], ["t1"]);
    const [row] = await withLocalTickets(store, [chatRow({ ticketCount: 1, ticketOpenCount: 0, ticketDoneCount: 1, ticketProgressPct: 100 })]);
    expect(row).toMatchObject({ ticketCount: 2, ticketOpenCount: 1, ticketDoneCount: 1, ticketProgressPct: 50 });
  });

  it("leaves a row with no local unbound tickets untouched", async () => {
    const store = await storeWith([]);
    const chat = chatRow({ ticketCount: 4, ticketOpenCount: 1, ticketDoneCount: 3, ticketProgressPct: 75 });
    expect((await withLocalTickets(store, [chat]))[0]).toBe(chat);
    expect(mergeLocalTicketSummary(chat, [])).toBe(chat);
  });
});
