import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMemoryLocalFirstStore, newLocalRecord, type TicketValue } from "@builderforce/local-first";
import type { ToolDef } from "./fileTools";
import { installLocalDomainTools } from "./installLocalDomainTools";
import { routeToLocalDomainTools } from "./localDomainToolRouting";
import { ticketServerIdLookup } from "./localTicketIdBridge";
import { localChatTicketScope, type RunChat } from "./localTicketScope";
import { textNamesTicket } from "./ticketChatOwnership";

const THIS_CHAT: RunChat = { localChatId: 61651, serverChatId: 219, clientChatId: "chat-client-61651" };
const OTHER_CHATS_TICKET = randomUUID();

function serverTool(name: string, answer: (args: Record<string, unknown>) => string, mutating = true): ToolDef & { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    name, description: name, parameters: { type: "object", properties: {} }, mutating, remote: true, calls,
    execute: async (args) => { calls.push(args); return answer(args); },
  };
}

/** Chat #219 links server ticket 500 on the account; 6520 belongs to another chat. */
async function setup(userText: string | undefined, runChat: RunChat | null = THIS_CHAT) {
  const chat = runChat ?? undefined;
  let textReads = 0;
  const store = createMemoryLocalFirstStore();
  await store.transact((tx) =>
    tx.put(newLocalRecord<TicketValue>({ id: OTHER_CHATS_TICKET, entityType: "ticket", payload: { projectId: "7", title: "Theirs", status: "backlog", chatClientId: "another-chat" }, deviceId: "d" })));
  const installed = installLocalDomainTools({ id: `ownership-${Math.random()}` }, { localDeviceId: "device-1", localFirstStore: store });
  const update = serverTool("builtin_tasks_update", (args) => JSON.stringify({ ok: true, id: args.id }));
  const signoff = serverTool("builtin_kanban_signoff", (args) => JSON.stringify({ ok: true, taskId: args.taskId }));
  const list = serverTool("builtin_chats_list_tickets", () => JSON.stringify({ tickets: [{ kind: "task", ref: "500" }] }), false);
  const identity = { localIdFor: async () => undefined, clientIdFor: async () => undefined };
  const tools = routeToLocalDomainTools(
    [update, signoff, list],
    (request) => installed.execute(request),
    chat?.clientChatId,
    ticketServerIdLookup(store),
    localChatTicketScope(store, identity, chat),
    { latestUserText: async () => { textReads += 1; return userText; } },
  );
  const tool = (name: string) => tools.find((t) => t.name === name)!;
  return { tool, update, signoff, reads: () => textReads };
}

describe("a chat run changes another chat's ticket only when the person names it", () => {
  it("regression: closing another chat's server ticket is refused (chat #61651 closed 6520/6514/6508)", async () => {
    const { tool, update } = await setup("are the 10 tickets of this chat done?");
    const out = JSON.parse(await tool("builtin_tasks_update").execute({ id: 6520, status: "done" }, "")) as { ok: boolean };
    expect(out.ok).toBe(false);
    expect(update.calls).toHaveLength(0);
  });

  it("the same call goes through when the person's latest message names #6520", async () => {
    const { tool, update } = await setup("please close #6520 too");
    expect(JSON.parse(await tool("builtin_tasks_update").execute({ id: 6520, status: "done" }, ""))).toEqual({ ok: true, id: 6520 });
    expect(update.calls).toHaveLength(1);
  });

  it("a bare number is not naming the ticket: '10 tickets' does not unlock ticket 10", async () => {
    const { tool, update } = await setup("are the 10 tickets of this chat done?");
    await tool("builtin_tasks_update").execute({ id: 10, status: "done" }, "");
    expect(update.calls).toHaveLength(0);
  });

  it("a number that merely contains the id is not naming it", async () => {
    const { tool, update } = await setup("close ticket 16520 and #65201");
    await tool("builtin_tasks_update").execute({ id: 6520, status: "done" }, "");
    expect(update.calls).toHaveLength(0);
  });

  it("a ticket linked to this chat goes through without reading the person's text", async () => {
    const { tool, update, reads } = await setup("close ticket 500");
    expect(JSON.parse(await tool("builtin_tasks_update").execute({ id: 500, status: "done" }, ""))).toMatchObject({ ok: true });
    expect(update.calls).toHaveLength(1);
    expect(reads()).toBe(0);
  });

  it("a run with no chat is not guarded", async () => {
    const { tool, update } = await setup(undefined, null);
    await tool("builtin_tasks_update").execute({ id: 6520, status: "done" }, "");
    expect(update.calls).toHaveLength(1);
  });

  it("a local ticket whose chat is another chat is refused, and goes through when the person names its local id", async () => {
    const refused = await setup("finish up");
    const out = JSON.parse(await refused.tool("ticket-move").execute({ id: OTHER_CHATS_TICKET, status: "done" }, "")) as { ok?: boolean; error?: string };
    expect(out.error).toContain("is not linked to this chat");
    const named = await setup(`move ${OTHER_CHATS_TICKET.toUpperCase()} to done`);
    expect(await named.tool("ticket-move").execute({ id: OTHER_CHATS_TICKET, status: "done" }, "")).not.toContain("not linked");
  });

  it("builtin_kanban_signoff on another chat's ticket is guarded too", async () => {
    const { tool, signoff } = await setup(undefined);
    expect(JSON.parse(await tool("builtin_kanban_signoff").execute({ taskId: 6520, verdict: "approve" }, ""))).toMatchObject({ ok: false });
    expect(signoff.calls).toHaveLength(0);
    await tool("builtin_kanban_signoff").execute({ taskId: 500, verdict: "approve" }, "");
    expect(signoff.calls).toHaveLength(1);
  });
});

describe("textNamesTicket", () => {
  it("matches #id, a ticket word + id and a local id in any case; never a bare number or a longer one", () => {
    const local = randomUUID();
    expect(textNamesTicket("#6520", ["6520"])).toBe(true);
    expect(textNamesTicket("close ticket 6520", ["6520"])).toBe(true);
    expect(textNamesTicket("Task #12 is done", ["12"])).toBe(true);
    expect(textNamesTicket("are the 10 tickets of this chat done?", ["10"])).toBe(false);
    expect(textNamesTicket("fix the 3 failing tests", ["3"])).toBe(false);
    expect(textNamesTicket("the server listens on port 8080", ["8080"])).toBe(false);
    expect(textNamesTicket("6520 is done", ["6520"])).toBe(false);
    expect(textNamesTicket("ticket 165201", ["6520"])).toBe(false);
    expect(textNamesTicket("ticket 65201", ["6520"])).toBe(false);
    expect(textNamesTicket(`see ${local.toUpperCase()}`, [local])).toBe(true);
    expect(textNamesTicket("nothing here", ["6520", local])).toBe(false);
  });
});
