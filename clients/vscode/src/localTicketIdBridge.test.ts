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

describe("routeToLocalDomainTools — only implemented names are repointed", () => {
  it("leaves a catalog tool the classifier calls local but this host does not implement", () => {
    const memoryRecall = serverTool("memory-recall", async () => "server");
    const routed = routeToLocalDomainTools([memoryRecall], async () => ({}));
    expect(routed.find((tool) => tool.name === "memory-recall")).toBe(memoryRecall);
  });
});
