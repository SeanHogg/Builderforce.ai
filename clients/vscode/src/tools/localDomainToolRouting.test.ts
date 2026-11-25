import { describe, expect, it } from "vitest";
import { createMemoryLocalFirstStore } from "@builderforce/local-first";
import type { ToolDef } from "./fileTools";
import { installLocalDomainTools, type DomainToolRequest } from "./installLocalDomainTools";
import { LOCAL_DOMAIN_TOOL_SPECS, SERVER_TWIN_TOOL_NAMES, routeToLocalDomainTools } from "./localDomainToolRouting";

const serverTool = (name: string, mutating = true): ToolDef => ({
  name,
  description: name,
  parameters: { type: "object", properties: {} },
  mutating,
  remote: true,
  execute: async () => {
    throw new Error(`${name} must not reach the server`);
  },
});

/** The catalog as a signed-in editor with sync GRANTED sees it: the server's tools. */
const CATALOG: readonly ToolDef[] = [
  serverTool("builtin_tasks_create"),
  serverTool("builtin_tasks_update"),
  serverTool("builtin_chats_link_ticket"),
  serverTool("builtin_tasks_list", false),
  serverTool("builtin_chats_list_tickets", false),
  serverTool("builtin_tickets_from_delta"),
  { name: "read_file", description: "read", parameters: {}, mutating: false, execute: async () => "file" },
];

function host() {
  const store = createMemoryLocalFirstStore();
  const installed = installLocalDomainTools({ id: `routing-${Math.random()}` }, {
    localDeviceId: "device-1",
    localFirstStore: store,
  });
  const requests: DomainToolRequest[] = [];
  const tools = (chatClientId?: string) =>
    routeToLocalDomainTools(CATALOG, async (request) => {
      requests.push(request);
      return installed.execute(request);
    }, chatClientId);
  return { store, installed, requests, tools };
}

describe("routeToLocalDomainTools", () => {
  it("hides the server twins and keeps every read and unrelated tool", () => {
    const names = host().tools().map((tool) => tool.name);
    for (const twin of SERVER_TWIN_TOOL_NAMES) expect(names).not.toContain(twin);
    expect(SERVER_TWIN_TOOL_NAMES).toEqual(new Set(["builtin_tasks_create", "builtin_chats_link_ticket"]));
    // Server-only tickets are still editable: the server update stays offered.
    expect(names).toContain("builtin_tasks_update");
    expect(names).toEqual(expect.arrayContaining(["builtin_tasks_list", "builtin_chats_list_tickets", "builtin_tickets_from_delta", "read_file"]));
    expect(names).toEqual(expect.arrayContaining(LOCAL_DOMAIN_TOOL_SPECS.map((spec) => spec.name)));
  });

  it("runs ticket-create locally with sync granted: the store is written, nothing reaches the server", async () => {
    const { store, tools } = host();
    const create = tools().find((tool) => tool.name === "ticket-create");
    expect(create?.remote).toBeUndefined();
    const project = await tools().find((tool) => tool.name === "project-create")!.execute({ name: "Board" }, "");
    const projectId = (JSON.parse(project) as { id: string }).id;
    const out = await create!.execute({ projectId, title: "Phase 1", taskType: "epic" }, "");
    const ticketId = (JSON.parse(out) as { id: string }).id;
    const pending = await store.read((tx) => tx.pending());
    expect(pending.map((event) => `${event.entityType}:${event.operation}`).sort()).toEqual(["project:create", "ticket:create"]);
    const ticket = await store.read((tx) => tx.get("ticket", ticketId));
    expect(ticket?.payload).toMatchObject({ title: "Phase 1", taskType: "epic" });
  });

  it("stamps the run's chat on a created ticket and ignores a chat the model supplies", async () => {
    const { store, tools } = host();
    const create = tools("chat-of-this-run").find((tool) => tool.name === "ticket-create")!;
    const out = await create.execute({ projectId: "11", title: "Task", chatClientId: "chat-of-another-run" }, "");
    const ticket = await store.read((tx) => tx.get("ticket", (JSON.parse(out) as { id: string }).id));
    expect(ticket?.payload).toMatchObject({ projectId: "11", chatClientId: "chat-of-this-run" });

    const noChat = tools().find((tool) => tool.name === "ticket-create")!;
    const bare = await noChat.execute({ projectId: "11", title: "No chat", chatClientId: "forged" }, "");
    const bareTicket = await store.read((tx) => tx.get("ticket", (JSON.parse(bare) as { id: string }).id));
    expect(bareTicket?.payload).not.toHaveProperty("chatClientId");
  });

  it("never stamps a chat onto a tool that is not ticket-create", async () => {
    const { requests, tools } = host();
    const project = tools("chat-1").find((tool) => tool.name === "project-create")!;
    await project.execute({ name: "Board" }, "");
    expect(requests[0]?.args).not.toHaveProperty("chatClientId");
  });

  it("describes the tools as the ticket tools, not as a fallback for a denied platform", () => {
    for (const spec of LOCAL_DOMAIN_TOOL_SPECS) {
      expect(spec.description).not.toMatch(/platform is denied|Does not call the platform/i);
    }
    const create = LOCAL_DOMAIN_TOOL_SPECS.find((spec) => spec.name === "ticket-create")!;
    const properties = (create.parameters as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(properties)).toEqual(expect.arrayContaining(["taskType", "parentTicketId"]));
  });
});
