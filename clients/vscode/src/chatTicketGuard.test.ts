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

async function setup(chat: RunChat | null = THIS_CHAT, listAnswer: (args: Record<string, unknown>) => string = () => JSON.stringify({ tickets: [{ kind: "task", ref: "500" }, { kind: "spec", ref: "6520" }] })) {
  const current = chat ?? undefined;
  const store = createMemoryLocalFirstStore();
  await store.transact((tx) =>
    tx.put(newLocalRecord<TicketValue>({ id: OTHER_CHATS_TICKET, entityType: "ticket", payload: { projectId: "7", title: "Theirs", status: "backlog", chatClientId: "another-chat" }, deviceId: "d" })));
  const installed = installLocalDomainTools({ id: `guard-${Math.random()}` }, { localDeviceId: "device-1", localFirstStore: store });
  const update = serverTool("builtin_tasks_update", (args) => JSON.stringify({ ok: true, id: args.id }));
  const list = serverTool("builtin_chats_list_tickets", listAnswer, false);
  const move = serverTool("builtin_tasks_move", (args) => JSON.stringify({ ok: true, id: args.id }));
  const remove = serverTool("builtin_tasks_delete", (args) => JSON.stringify({ deleted: args.id }));
  const review = serverTool("builtin_reviews_record", (args) => JSON.stringify({ ok: true, taskId: args.taskId }));
  const identity = { localIdFor: async () => undefined, clientIdFor: async () => undefined };
  const tools = routeToLocalDomainTools(
    [update, list, move, remove, review],
    (request) => installed.execute(request),
    current?.clientChatId,
    ticketServerIdLookup(store),
    localChatTicketScope(store, identity, current),
  );
  const tool = (name: string) => tools.find((t) => t.name === name)!;
  return { tool, update, list, move, remove, review };
}

const REFUSED_6520 = "ticket #6520 is not linked to this chat (#219); link it first or ask the user";

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

describe("every ticket write the chat could close or remove another chat's ticket with is guarded", () => {
  it("builtin_tasks_move: another chat's ticket is refused, the chat's own moves", async () => {
    const { tool, move } = await setup();
    expect(JSON.parse(await tool("builtin_tasks_move").execute({ id: 6520, projectId: 9 }, ""))).toEqual({ ok: false, error: REFUSED_6520 });
    expect(move.calls).toHaveLength(0);
    await tool("builtin_tasks_move").execute({ id: 500, projectId: 9 }, "");
    expect(move.calls).toHaveLength(1);
  });

  it("builtin_tasks_delete: another chat's ticket is refused, the chat's own is deleted", async () => {
    const { tool, remove } = await setup();
    expect(JSON.parse(await tool("builtin_tasks_delete").execute({ id: 6520 }, ""))).toEqual({ ok: false, error: REFUSED_6520 });
    expect(remove.calls).toHaveLength(0);
    await tool("builtin_tasks_delete").execute({ id: 500 }, "");
    expect(remove.calls).toHaveLength(1);
  });

  it("builtin_reviews_record: a complete verdict on another chat's ticket is refused; a gaps verdict closes nothing and goes through", async () => {
    const { tool, review } = await setup();
    expect(JSON.parse(await tool("builtin_reviews_record").execute({ taskId: 6520, verdict: "complete" }, ""))).toEqual({ ok: false, error: REFUSED_6520 });
    expect(review.calls).toHaveLength(0);
    await tool("builtin_reviews_record").execute({ taskId: 6520, verdict: "gaps", gaps: [{ title: "no tests" }] }, "");
    await tool("builtin_reviews_record").execute({ taskId: 500, verdict: "complete" }, "");
    expect(review.calls.map((c) => c.taskId)).toEqual([6520, 500]);
  });

  it("ticket-update: the chat's own local ticket is patched; another chat's local ticket is refused", async () => {
    const { tool } = await setup();
    const created = JSON.parse(await tool("ticket-create").execute({ projectId: "7", title: "Mine" }, "")) as { id: string };
    expect(await tool("ticket-update").execute({ id: created.id, title: "Mine, renamed" }, "")).not.toContain("not linked");
    const refused = JSON.parse(await tool("ticket-update").execute({ id: OTHER_CHATS_TICKET, title: "Hijacked" }, "")) as { error: string };
    expect(refused.error).toBe(`ticket #${OTHER_CHATS_TICKET} is not linked to this chat (#219); link it first or ask the user`);
  });

  it("reads the account's link list WHOLE: a ticket linked on page 3 is not refused", async () => {
    const links = [{ kind: "task", ref: "500" }, { kind: "task", ref: "501" }, { kind: "task", ref: "6520" }];
    // One link per page, whatever the limit asked for — the server's `hasMore` says whether more follow.
    const { tool, update, list } = await setup(THIS_CHAT, (args) => {
      const offset = Number(args.offset ?? 0);
      return JSON.stringify({ tickets: links.slice(offset, offset + 1), total: links.length, matched: links.length, hasMore: offset + 1 < links.length });
    });
    expect(JSON.parse(await tool("builtin_tasks_update").execute({ id: 6520, status: "done" }, ""))).toMatchObject({ ok: true });
    expect(update.calls).toHaveLength(1);
    expect(list.calls.map((c) => c.offset)).toEqual([0, 1, 2]);
  });

  it("a link list longer than the guard reads is not evidence: the call goes through", async () => {
    const { tool, update } = await setup(THIS_CHAT, (args) =>
      JSON.stringify({ tickets: [{ kind: "task", ref: `x${String(args.offset)}` }], hasMore: true }));
    await tool("builtin_tasks_update").execute({ id: 6520, status: "done" }, "");
    expect(update.calls).toHaveLength(1);
  });
});
