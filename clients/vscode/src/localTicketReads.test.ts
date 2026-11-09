import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMemoryLocalFirstStore, newLocalRecord, UNBOUND_DESTINATION, type TicketValue } from "@builderforce/local-first";
import type { ToolDef } from "./fileTools";
import { routeToLocalDomainTools } from "./localDomainToolRouting";
import { ticketServerIdLookup } from "./localTicketIdBridge";
import { localChatTicketScope, type RunChat } from "./localTicketScope";

const CHAT = "chat-client-61651";
const LOCAL_CHAT = 61651;
const SERVER_CHAT = 219;
const UNSYNCED = randomUUID();
const SYNCED = randomUUID();

/** The account's answer for chat #219: the synced ticket only (server id 500). */
const SERVER_PAGE = { tickets: [{ kind: "task", ref: "500", label: "Synced", status: "backlog", exists: true }], total: 1, matched: 1, hasMore: false };

function serverTool(name: string, answer: (args: Record<string, unknown>) => string): ToolDef & { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    name, description: name, parameters: { type: "object", properties: {} }, mutating: false, remote: true, calls,
    execute: async (args) => { calls.push(args); return answer(args); },
  };
}

async function setup(current: RunChat = { localChatId: LOCAL_CHAT, serverChatId: SERVER_CHAT, clientChatId: CHAT }, listAnswer?: (args: Record<string, unknown>) => string) {
  const store = createMemoryLocalFirstStore();
  await store.transact(async (tx) => {
    const put = (id: string, title: string, chatClientId: string) =>
      tx.put(newLocalRecord<TicketValue>({ id, entityType: "ticket", payload: { projectId: "7", title, status: "backlog", taskType: "task", chatClientId }, deviceId: "d" }));
    await put(UNSYNCED, "Filed here", CHAT);
    await put(SYNCED, "Synced", CHAT);
    await tx.putMapping({ destination: UNBOUND_DESTINATION, entityType: "ticket", clientEntityId: SYNCED, serverId: "500", serverVersion: 1 });
  });
  const identity = {
    localIdFor: async (serverId: number) => (serverId === SERVER_CHAT ? LOCAL_CHAT : undefined),
    clientIdFor: async (localId: number) => (localId === LOCAL_CHAT ? CHAT : undefined),
  };
  const list = serverTool("builtin_chats_list_tickets", listAnswer ?? ((args) =>
    Number(args.chatId) === SERVER_CHAT || Number(args.chatId) === LOCAL_CHAT ? JSON.stringify(SERVER_PAGE) : JSON.stringify({ tickets: [], total: 0, matched: 0, hasMore: false })));
  const hashtag = serverTool("builtin_chats_resolve_hashtag", (args) => JSON.stringify({ chatId: args.chatId, mode: "list", tickets: SERVER_PAGE.tickets }));
  const get = serverTool("builtin_tasks_get", (args) => JSON.stringify({ id: args.id, title: "from server" }));
  const tools = routeToLocalDomainTools(
    [list, hashtag, get],
    async () => ({}),
    current.clientChatId,
    ticketServerIdLookup(store),
    localChatTicketScope(store, identity, current),
  );
  const tool = (name: string) => tools.find((t) => t.name === name)!;
  return { tool, list, get };
}

const refs = (out: string) => (JSON.parse(out) as { tickets: Array<{ ref: string }> }).tickets.map((t) => t.ref);

describe("ticket reads union this device's unsynced tickets", () => {
  it("regression: an unsynced local ticket appears in list_tickets for its chat under the server id AND the local id", async () => {
    // 2026-11-08 chat #219 (local #61651): 10 tickets filed on-device, list_tickets returned none.
    const { tool } = await setup();
    for (const chatId of [SERVER_CHAT, LOCAL_CHAT, String(SERVER_CHAT)]) {
      const out = await tool("builtin_chats_list_tickets").execute({ chatId }, "");
      expect(refs(out)).toEqual(["500", UNSYNCED]);
      expect(JSON.parse(out)).toMatchObject({ total: 2, matched: 2, unsyncedOnDevice: 1 });
    }
  });

  it("never lists a synced ticket twice: the mapped one is the server's row only", async () => {
    const { tool } = await setup();
    const out = await tool("builtin_chats_list_tickets").execute({ chatId: SERVER_CHAT }, "");
    expect(refs(out)).not.toContain(SYNCED);
    expect(refs(out).filter((r) => r === "500")).toHaveLength(1);
  });

  it("leaves another chat's answer untouched", async () => {
    const { tool } = await setup();
    const out = await tool("builtin_chats_list_tickets").execute({ chatId: 218 }, "");
    expect(refs(out)).toEqual([]);
  });

  it("applies the list filters to local rows (a status filter drops a backlog one) and adds them on the first page only", async () => {
    const { tool } = await setup();
    const done = await tool("builtin_chats_list_tickets").execute({ chatId: SERVER_CHAT, status: "done" }, "");
    expect(refs(done)).toEqual(["500"]);
    const second = await tool("builtin_chats_list_tickets").execute({ chatId: SERVER_CHAT, offset: 50 }, "");
    expect(refs(second)).toEqual(["500"]);
  });

  it("answers from this device when the chat is not bound on the account yet", async () => {
    const { tool } = await setup({ localChatId: LOCAL_CHAT, serverChatId: null, clientChatId: CHAT }, () => "chat_not_synced: chat 61651 has no server binding yet");
    const out = await tool("builtin_chats_list_tickets").execute({ chatId: LOCAL_CHAT }, "");
    expect(refs(out)).toEqual([UNSYNCED]);
    expect(JSON.parse(out)).toMatchObject({ hasMore: false, serverError: expect.stringContaining("chat_not_synced") });
  });

  it("resolve_hashtag list mode includes the unsynced ticket; a #tag lookup stays the server's", async () => {
    const { tool } = await setup();
    expect(refs(await tool("builtin_chats_resolve_hashtag").execute({ chatId: LOCAL_CHAT }, ""))).toEqual(["500", UNSYNCED]);
    expect(refs(await tool("builtin_chats_resolve_hashtag").execute({ chatId: SERVER_CHAT, text: "#500" }, ""))).toEqual(["500"]);
  });

  it("tasks_get answers an unsynced local id from this device and sends a synced one to the server", async () => {
    const { tool, get } = await setup();
    expect(JSON.parse(await tool("builtin_tasks_get").execute({ id: UNSYNCED }, ""))).toMatchObject({ id: UNSYNCED, title: "Filed here", local: true });
    expect(get.calls).toHaveLength(0);
    expect(JSON.parse(await tool("builtin_tasks_get").execute({ id: SYNCED }, ""))).toMatchObject({ id: 500, title: "from server" });
  });
});
