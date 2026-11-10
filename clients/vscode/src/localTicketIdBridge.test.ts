import { describe, expect, it, vi } from "vitest";
import { createMemoryLocalFirstStore } from "@builderforce/local-first";
import type { ToolDef } from "./fileTools";
import { installLocalDomainTools } from "./installLocalDomainTools";
import { routeToLocalDomainTools } from "./localDomainToolRouting";
import { SERVER_TICKET_ID_ARGS, bridgeLocalTicketIds, ticketServerIdLookup } from "./localTicketIdBridge";

const LOCAL = "00000000-0000-4000-8000-0000000000aa";

const serverTool = (name: string, execute: ToolDef["execute"]): ToolDef => ({
  name,
  description: name,
  parameters: { type: "object", properties: { id: { type: "number" }, taskId: { type: "number" } } },
  mutating: true,
  remote: true,
  execute,
});

describe("bridgeLocalTicketIds", () => {
  it("translates a synced local id to the server id before the call", async () => {
    const seen = vi.fn(async () => "ok");
    const [tool] = bridgeLocalTicketIds([serverTool("builtin_tasks_update", seen)], async (id) => (id === LOCAL ? "77" : undefined));
    await tool!.execute({ id: LOCAL, title: "x" }, "");
    expect(seen).toHaveBeenCalledWith({ id: 77, title: "x" }, "", undefined);
  });

  it("answers {ok:false} for an unsynced local id and never reaches the server", async () => {
    const seen = vi.fn(async () => "ok");
    const [tool] = bridgeLocalTicketIds([serverTool("builtin_kanban_coordinate", seen)], async () => undefined);
    const out = JSON.parse(await tool!.execute({ taskId: LOCAL }, "")) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toBe(
      `ticket ${LOCAL} has not synced to the account yet; sync runs within seconds when sync is on — retry shortly, or keep working with ticket-update`,
    );
    expect(seen).not.toHaveBeenCalled();
  });

  it("passes numeric ids and unrelated tools through untouched, and widens the id schema", async () => {
    const seen = vi.fn(async () => "ok");
    const lookup = vi.fn(async () => undefined);
    const [tool, other] = bridgeLocalTicketIds(
      [serverTool("builtin_tasks_update", seen), serverTool("builtin_tasks_list", seen)],
      lookup,
    );
    await tool!.execute({ id: 5 }, "");
    await other!.execute({ id: LOCAL }, "");
    expect(lookup).not.toHaveBeenCalled();
    expect((tool!.parameters.properties as Record<string, { type: unknown }>).id.type).toEqual(["number", "string"]);
    expect(Object.keys(SERVER_TICKET_ID_ARGS)).toEqual(expect.arrayContaining(["builtin_tasks_update", "builtin_tickets_from_delta"]));
  });

  it("reads the mapping the sync receipt wrote", async () => {
    const store = createMemoryLocalFirstStore();
    const installed = installLocalDomainTools({ id: `bridge-${Math.random()}` }, { localDeviceId: "d", localFirstStore: store });
    const project = await installed.execute("project-create", { name: "P" });
    const ticket = await installed.execute("ticket-create", { projectId: project.id, title: "T" });
    const lookup = ticketServerIdLookup(store);
    expect(await lookup(ticket.id)).toBeUndefined();
    await store.transact(async (tx) => {
      await tx.putMapping({ destination: ticket.record!.destination, entityType: "ticket", clientEntityId: ticket.id, serverId: "91", serverVersion: 1 });
    });
    expect(await lookup(ticket.id)).toBe("91");
  });
});

describe("bridgeLocalTicketIds — an unsynced ticket answers truthfully for the sync mode", () => {
  it("regression: sync off says the ticket stays local, not to retry (chat #61651: 10 of 12 reviews_record failed on 'retry shortly')", async () => {
    const seen = vi.fn(async () => "ok");
    const lookup = vi.fn(async () => undefined);
    const [tool] = bridgeLocalTicketIds([serverTool("builtin_reviews_record", seen)], lookup, { syncOn: () => false });
    const out = JSON.parse(await tool!.execute({ taskId: LOCAL, verdict: "complete" }, "")) as { ok: boolean; retryable: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.retryable).toBe(false);
    expect(out.error).toContain("sync is off in this mode");
    expect(out.error).toContain("retrying will not help");
    expect(out.error).toContain("ticket-update");
    expect(out.error).not.toContain("retry shortly");
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(seen).not.toHaveBeenCalled();
  });

  it("sync off on another tool names the local ticket tools", async () => {
    const [tool] = bridgeLocalTicketIds([serverTool("builtin_tasks_update", async () => "ok")], async () => undefined, { syncOn: () => false });
    const out = JSON.parse(await tool!.execute({ id: LOCAL, status: "done" }, "")) as { retryable: boolean; error: string };
    expect(out.retryable).toBe(false);
    expect(out.error).toContain("ticket-update, ticket-move");
  });

  it("sync on waits for the receipt: a mapping that lands after 1 s goes through with the server id", async () => {
    vi.useFakeTimers();
    try {
      const seen = vi.fn(async () => "ok");
      let mapped: string | undefined;
      setTimeout(() => { mapped = "88"; }, 1_000);
      const [tool] = bridgeLocalTicketIds([serverTool("builtin_reviews_record", seen)], async () => mapped, { syncOn: () => true });
      const pending = tool!.execute({ taskId: LOCAL, verdict: "complete" }, "");
      await vi.advanceTimersByTimeAsync(1_500);
      expect(await pending).toBe("ok");
      expect(seen).toHaveBeenCalledWith({ taskId: 88, verdict: "complete" }, "", undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sync on: a Stop mid-wait returns the stopped result within one interval", async () => {
    vi.useFakeTimers();
    try {
      const seen = vi.fn(async () => "ok");
      const stop = new AbortController();
      const [tool] = bridgeLocalTicketIds([serverTool("builtin_tasks_update", seen)], async () => undefined, { syncOn: () => true });
      let settled = false;
      const pending = tool!.execute({ id: LOCAL }, "", { signal: stop.signal }).finally(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(1_000);
      stop.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(true);
      expect(JSON.parse(await pending)).toEqual({ ok: false, aborted: true, error: "the run was stopped" });
      expect(seen).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sync on, never mapped: a non-retryable error after the wait, pointing at the local tools", async () => {
    vi.useFakeTimers();
    try {
      const seen = vi.fn(async () => "ok");
      const lookup = vi.fn(async () => undefined);
      const [tool] = bridgeLocalTicketIds([serverTool("builtin_tasks_update", seen)], lookup, { syncOn: () => true });
      let settled = false;
      const pending = tool!.execute({ id: LOCAL }, "").finally(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(4_000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1_500);
      const out = JSON.parse(await pending) as { ok: boolean; retryable: boolean; error: string };
      expect(out.ok).toBe(false);
      expect(out.retryable).toBe(false);
      expect(out.error).toContain("did not arrive within 5 s");
      expect(out.error).toContain("ticket-update, ticket-move");
      expect(out.error).not.toContain("retry shortly");
      expect(lookup.mock.calls.length).toBeGreaterThan(10);
      expect(seen).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("routeToLocalDomainTools — only implemented names are repointed", () => {
  it("leaves a catalog tool the classifier calls local but this host does not implement", () => {
    const memoryRecall = serverTool("memory-recall", async () => "server");
    const routed = routeToLocalDomainTools([memoryRecall], async () => ({}));
    expect(routed.find((tool) => tool.name === "memory-recall")).toBe(memoryRecall);
  });
});
