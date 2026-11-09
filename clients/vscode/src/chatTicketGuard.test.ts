import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMemoryLocalFirstStore, newLocalRecord, type TicketValue } from "@builderforce/local-first";
import type { ToolDef } from "./fileTools";
import { installLocalDomainTools } from "./installLocalDomainTools";
import { routeToLocalDomainTools } from "./localDomainToolRouting";
import { ticketServerIdLookup } from "./localTicketIdBridge";
import { localChatTicketScope, type RunChat } from "./localTicketScope";

const CHAT = "chat-client-61651";
const THIS_CHAT: RunChat = { localChatId: 61651, serverChatId: 219, clientChatId: CHAT };
const OTHER_CHATS_TICKET = randomUUID();

function serverTool(name: string, answer: (args: Record<string, unknown>) => string, mutating = true): ToolDef & { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    name, description: name, parameters: { type: "object", properties: {} }, mutating, remote: true, calls,
    execute: async (args) => { calls.push(args); return answer(args); },
  };
}

async function setup(chat: RunChat | null = THIS_CHAT, listAnswer: () => string = () => JSON.stringify({ tickets: [{ kind: "task", ref: "500" }, { kind: "spec", ref: "6520" }] })) {
  const current = chat ?? undefined;
  const store = createMemoryLocalFirstStore();
  await store.transact((tx) =>
    tx.put(newLocalRecord<TicketValue>({ id: OTHER_CHATS_TICKET, entityType: "ticket", payload: { projectId: "7", title: "Theirs", status: "backlog", chatClientId: "another-chat" }, deviceId: "d" })));
  const installed = installLocalDomainTools({ id: `guard-${Math.random()}` }, { localDeviceId: "device-1", localFirstStore: store });
  const update = serverTool("builtin_tasks_update", (args) => JSON.stringify({ ok: true, id: args.id }));
  const list = serverTool("builtin_chats_list_tickets", listAnswer, false);
  const identity = { localIdFor: async () => undefined, clientIdFor: async () => undefined };
  const tools = routeToLocalDomainTools(
    [update, list],
    (request) => installed.execute(request),
    current?.clientChatId,
    ticketServerIdLookup(store),
    localChatTicketScope(store, identity, current),
  );
  const tool = (name: string) => tools.find((t) => t.name === name)!;
  return { tool, update };
}

describe("a chat run changes the status only of its own chat's tickets", () => {
  it("regression: refuses builtin_tasks_update status=done on a ticket another chat owns, naming both ids", async () => {
    // 2026-11-08 chat #219: tickets 6520, 6514, 6508 (other chats') were set to done.
    const { tool, update } = await setup();
    const out = await tool("builtin_tasks_update").execute({ id: 6520, status: "done" }, "");
    expect(JSON.parse(out)).toEqual({ ok: false, error: "ticket #6520 is not linked to this chat (#219); link it first or ask the user" });
    expect(update.calls).toHaveLength(0);
  });

  it("lets a status change through on a ticket the chat links on the account", async () => {
    const { tool, update } = await setup();
    expect(JSON.parse(await tool("builtin_tasks_update").execute({ id: 500, status: "done" }, ""))).toMatchObject({ ok: true });
    expect(update.calls).toHaveLength(1);
  });

  it("does not guard an update that changes no status", async () => {
    const { tool, update } = await setup();
    await tool("builtin_tasks_update").execute({ id: 6520, title: "Rename" }, "");
    expect(update.calls).toHaveLength(1);
  });

  it("ticket-move: the chat's own local ticket moves; another chat's local ticket is refused", async () => {
    const { tool } = await setup();
    const created = JSON.parse(await tool("ticket-create").execute({ projectId: "7", title: "Mine" }, "")) as { id: string };
    expect(await tool("ticket-move").execute({ id: created.id, status: "done" }, "")).not.toContain("not linked");
    const refused = JSON.parse(await tool("ticket-move").execute({ id: OTHER_CHATS_TICKET, status: "done" }, "")) as { error: string };
    expect(refused.error).toBe(`ticket #${OTHER_CHATS_TICKET} is not linked to this chat (#219); link it first or ask the user`);
  });

  it("goes through when the account's link list cannot be read (refuses on evidence only)", async () => {
    const { tool, update } = await setup(THIS_CHAT, () => { throw new Error("offline"); });
    await tool("builtin_tasks_update").execute({ id: 6520, status: "done" }, "");
    expect(update.calls).toHaveLength(1);
  });

  it("an unbound chat links no server ticket: refused with the local chat id", async () => {
    const { tool, update } = await setup({ localChatId: 61651, serverChatId: null, clientChatId: CHAT });
    const out = JSON.parse(await tool("builtin_tasks_update").execute({ id: 6520, status: "done" }, "")) as { error: string };
    expect(out.error).toBe("ticket #6520 is not linked to this chat (#61651); link it first or ask the user");
    expect(update.calls).toHaveLength(0);
  });

  it("a run without a chat is not guarded", async () => {
    const { tool, update } = await setup(null);
    await tool("builtin_tasks_update").execute({ id: 6520, status: "done" }, "");
    expect(update.calls).toHaveLength(1);
  });
});
