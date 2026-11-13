import { describe, expect, it } from "vitest";
import { rollupChatTicketHealth } from "@builderforce/agent-loop";
import {
  chatTicketLinkId, createMemoryLocalFirstStore, newLocalRecord, UNBOUND_DESTINATION,
  type ChatTicketLinkValue, type TicketValue,
} from "@builderforce/local-first";
import type { BrainChat } from "@seanhogg/builderforce-brain-embedded";
import { readRailFromFacts } from "./buildRail";
import { mergeLocalTicketSummary, withLocalTickets } from "./localTicketSummary";

const CHAT = "chat-client-1";

const chatRow = (extra: Partial<BrainChat> = {}): BrainChat =>
  ({ id: 1, title: "Chat", projectId: null, clientId: CHAT, ...extra }) as BrainChat;

interface SeedTicket {
  id: string;
  status: string;
  /** The chat the ticket was filed in (a device-created ticket carries it). */
  chatClientId?: string;
  /** The chat it is linked to (`chat-ticket-link`): what puts it on that chat's rail. */
  linkedTo?: string;
  /** Rail progress the platform listed (a mirrored server ticket). */
  progressPct?: number;
  done?: number;
  total?: number;
}

async function storeWith(tickets: SeedTicket[], mapped: string[] = []) {
  const store = createMemoryLocalFirstStore();
  await store.transact(async (tx) => {
    await tx.put(newLocalRecord({ id: CHAT, entityType: "chat", payload: { title: "Chat" }, deviceId: "d" }));
    for (const tk of tickets) {
      const payload = {
        projectId: "p", title: tk.id, status: tk.status,
        ...(tk.chatClientId ? { chatClientId: tk.chatClientId } : {}),
        ...(tk.progressPct !== undefined ? { progressPct: tk.progressPct, done: tk.done ?? 0, total: tk.total ?? 1 } : {}),
      } as TicketValue;
      await tx.put(newLocalRecord<TicketValue>({ id: tk.id, entityType: "ticket", payload, deviceId: "d" }));
      if (tk.linkedTo) {
        const link: ChatTicketLinkValue = { chatClientId: tk.linkedTo, ticketClientId: tk.id, linkType: "created" };
        await tx.put(newLocalRecord<ChatTicketLinkValue>({
          id: chatTicketLinkId(tk.linkedTo, tk.id), entityType: "chat-ticket-link", payload: link, deviceId: "d",
        }));
      }
    }
    for (const id of mapped) {
      await tx.putMapping({ destination: UNBOUND_DESTINATION, entityType: "ticket", clientEntityId: id, serverId: id, serverVersion: 1 });
    }
  });
  return store;
}

describe("withLocalTickets", () => {
  it("regression: a chat with 3 device-filed tickets (1 done, 2 open) shows ticketCount 3, open 2, done 1 on its row", async () => {
    // 2026-11-08: tickets filed on-device by a run and its sub-agents never reached the server
    // (sync not granted), so the server summary said 0 and the history row read "No tickets".
    const store = await storeWith([
      { id: "t1", status: "done", chatClientId: CHAT, linkedTo: CHAT },
      { id: "t2", status: "in_progress", chatClientId: CHAT, linkedTo: CHAT },
      { id: "t3", status: "backlog", chatClientId: CHAT, linkedTo: CHAT },
      { id: "other", status: "backlog", chatClientId: "another-chat", linkedTo: "another-chat" },
    ]);
    const [row] = await withLocalTickets(store, [chatRow()]);
    expect(row).toMatchObject({ ticketCount: 3, ticketOpenCount: 2, ticketDoneCount: 1, ticketProgressPct: 33 });
  });

  it("never counts a ticket twice: a ticket the server maps is counted once, from the store", async () => {
    const store = await storeWith([
      { id: "t1", status: "done", chatClientId: CHAT, linkedTo: CHAT },
      { id: "t2", status: "backlog", chatClientId: CHAT, linkedTo: CHAT },
    ], ["t1"]);
    const [row] = await withLocalTickets(store, [chatRow({ ticketCount: 1, ticketOpenCount: 0, ticketDoneCount: 1, ticketProgressPct: 100 })]);
    expect(row).toMatchObject({ ticketCount: 2, ticketOpenCount: 1, ticketDoneCount: 1, ticketProgressPct: 50 });
  });

  it("leaves a row with no tickets in the store untouched (the server summary stands)", async () => {
    const store = await storeWith([]);
    const chat = chatRow({ ticketCount: 4, ticketOpenCount: 1, ticketDoneCount: 3, ticketProgressPct: 75 });
    expect((await withLocalTickets(store, [chat]))[0]).toBe(chat);
    expect(mergeLocalTicketSummary(chat, [])).toBe(chat);
  });

  it("regression: a local-store row with no server summary and mirrored tickets at 100/100/75/75 reads the rail's 15%, not 0%", async () => {
    // 2026-11-08, chat #217 (VSIX 2026.10.149): the history row comes from the local store, so it
    // carries no server summary. Its rail held 24 tickets: 4 mirrored from the platform with real
    // progress (2 done, 2 in review at 75) and 20 filed on the device (backlog / in progress, no
    // progress). The row rolled up only the 20 unsynced ones and read 0%; the rail read 15%.
    const mirrored: SeedTicket[] = [
      { id: "s1", status: "done", progressPct: 100, done: 1, total: 1, linkedTo: CHAT },
      { id: "s2", status: "done", progressPct: 100, done: 1, total: 1, linkedTo: CHAT },
      { id: "s3", status: "in_review", progressPct: 75, done: 0, total: 1, linkedTo: CHAT },
      { id: "s4", status: "in_review", progressPct: 75, done: 0, total: 1, linkedTo: CHAT },
    ];
    const local: SeedTicket[] = Array.from({ length: 20 }, (_, n) => ({
      id: `l${n}`, status: n < 3 ? "in_progress" : "backlog", chatClientId: CHAT, linkedTo: CHAT,
    }));
    // A ticket filed in this chat by an older build, never linked: not on the rail, so not on the row.
    const unlinked: SeedTicket = { id: "u1", status: "backlog", chatClientId: CHAT };
    const store = await storeWith([...mirrored, ...local, unlinked], mirrored.map((tk) => tk.id));

    const [row] = await withLocalTickets(store, [chatRow()]);
    const rail = readRailFromFacts(await store.export(), CHAT);
    const railPct = rollupChatTicketHealth(rail.tickets).pct;

    expect(railPct).toBe(15);
    expect(row).toMatchObject({ ticketCount: rail.tickets.length, ticketProgressPct: railPct, ticketDoneCount: 2, ticketOpenCount: 22 });
  });

  it("regression: a ticket whose record has no status yet is drawn as backlog (not-started), not an empty status", async () => {
    // 2026-11-13: two tasks under an epic in the chat rail showed a blank / "not started" meta line
    // because their device-filed records carried no `status`. The rail must always present a lane:
    // the record's own status when present, the not-started lane otherwise.
    const noStatus = { id: "n1", status: "", chatClientId: CHAT, linkedTo: CHAT };
    const withStatus = { id: "n2", status: "in_progress", chatClientId: CHAT, linkedTo: CHAT };
    const store = await storeWith([noStatus, withStatus]);
    const rail = readRailFromFacts(await store.export(), CHAT);
    expect(rail.tickets.find((tk) => tk.clientId === "n1")?.status).toBe("backlog");
    expect(rail.tickets.find((tk) => tk.clientId === "n2")?.status).toBe("in_progress");
  });
});
