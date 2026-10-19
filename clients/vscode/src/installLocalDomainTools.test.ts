import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createMemoryLocalFirstStore, UNBOUND_DESTINATION } from "@builderforce/local-first";
import { LOCAL_DOMAIN_TOOL_NAMES, LocalDomainToolError } from "./localDomainTools";
import {
  HOST_DOMAIN_TOOL_LINE,
  installLocalDomainTools,
  type DomainToolRequest,
} from "./installLocalDomainTools";

function deniedHost(deviceId = "device-1") {
  const store = createMemoryLocalFirstStore();
  const ctx = { id: `host-${deviceId}-${Math.random()}` };
  const platformTool = vi.fn(async () => ({ platform: true }));
  const installed = installLocalDomainTools(ctx, {
    getConfig: (key) => (key === "builderforce.localDeviceId" ? deviceId : undefined),
    localFirstStore: store,
    policyAllows: false,
    platformTool,
  });
  return { store, installed, platformTool };
}

describe("installLocalDomainTools", () => {
  it("installs the landed domain tools and writes a local project and ticket when the platform is denied", async () => {
    const { store, installed, platformTool } = deniedHost();
    expect([...installed.tools.localTools]).toEqual([...LOCAL_DOMAIN_TOOL_NAMES]);

    const project = await installed.execute({
      tool: "project-create",
      args: { name: "Offline" },
    });
    expect(project.kind).toBe("local");
    if (project.kind !== "local") return;
    const ticket = await installed.execute("ticket-create", {
      projectId: project.id,
      title: "Ship offline",
    });

    expect(platformTool).not.toHaveBeenCalled();
    expect(ticket.kind).toBe("local");
    if (ticket.kind !== "local") return;
    expect(ticket.record?.payload).toMatchObject({
      projectId: project.id,
      title: "Ship offline",
      status: "backlog",
    });
    expect(project.record?.provenance?.deviceId).toBe("device-1");
    expect(project.record?.destination).toEqual(UNBOUND_DESTINATION);
    expect(installed.syncQueue).toMatchObject({
      queued: expect.arrayContaining([
        expect.objectContaining({ entityType: "project", clientEntityId: project.id, operation: "create" }),
        expect.objectContaining({ entityType: "ticket", clientEntityId: ticket.id, operation: "create" }),
      ]),
    });

    const pending = await store.read((tx) => tx.pending());
    expect(pending.map((event) => `${event.entityType}:${event.operation}`).sort()).toEqual([
      "project:create",
      "ticket:create",
    ]);
  });

  it("calls the platform tool and writes nothing when policy allows", async () => {
    const store = createMemoryLocalFirstStore();
    const platformTool = vi.fn(async () => ({ platform: true }));
    const installed = installLocalDomainTools({ id: "allowed" }, {
      localDeviceId: "device-1",
      localFirstStore: store,
      policyAllows: true,
      platformTool,
    });
    const outcome = await installed.execute({
      tool: "project-create",
      args: { name: "Online" },
    });
    expect(outcome).toMatchObject({ kind: "platform", tool: "project-create", result: { platform: true } });
    expect(platformTool).toHaveBeenCalledTimes(1);
    expect(await store.read((tx) => tx.pending())).toEqual([]);
    expect(await store.read((tx) => tx.list("project"))).toEqual([]);
    expect(installed.syncQueue).toMatchObject({ queued: [] });
  });

  it("refuses an unknown tool without calling the platform", async () => {
    const { installed, platformTool, store } = deniedHost();
    const request = { tool: "not-a-tool", args: {} } satisfies DomainToolRequest;
    await expect(installed.execute(request)).rejects.toBeInstanceOf(LocalDomainToolError);
    await expect(installed.execute("cloud-execution", {})).rejects.toMatchObject({ code: "connected_only_tool" });
    expect(platformTool).not.toHaveBeenCalled();
    expect(await store.read((tx) => tx.pending())).toEqual([]);
  });

  it("reuses the host device id and does not mint another", async () => {
    const { installed } = deniedHost("device-9");
    const outcome = await installed.execute("project-create", { name: "Held" });
    expect(outcome.kind).toBe("local");
    if (outcome.kind !== "local") return;
    expect(outcome.record?.provenance?.deviceId).toBe("device-9");
  });

  it("installs once per host context", async () => {
    const ctx = { id: "same" };
    const store = createMemoryLocalFirstStore();
    const first = installLocalDomainTools(ctx, { localDeviceId: "device-1", localFirstStore: store });
    const second = installLocalDomainTools(ctx, {
      localDeviceId: "device-2",
      localFirstStore: createMemoryLocalFirstStore(),
    });
    expect(second).toBe(first);
    const outcome = await second.execute("project-create", { name: "Once" });
    expect(outcome.kind).toBe("local");
    if (outcome.kind !== "local") return;
    expect(outcome.record?.provenance?.deviceId).toBe("device-1");
    expect(await store.read((tx) => tx.list("project"))).toHaveLength(1);
  });

  it("requires a store and a device id before caching an install", () => {
    expect(() => installLocalDomainTools({ id: "nostore" }, { localDeviceId: "device-1" })).toThrow(
      "local_first_store_required",
    );
    expect(() => installLocalDomainTools({ id: "nodevice" }, { localFirstStore: createMemoryLocalFirstStore() })).toThrow(
      "local_device_id_required",
    );
  });

  it("imports only the landed domain-tool library", () => {
    const source = readFileSync(new URL("./installLocalDomainTools.ts", import.meta.url), "utf8");
    expect(source).toContain('from "./localDomainTools"');
    expect(source).toContain("createLocalDomainToolsWithRepository(");
    expect(source).toContain(HOST_DOMAIN_TOOL_LINE);
    expect(source).not.toMatch(/from ["'][^"']*bfApi/);
    expect(source).not.toMatch(/\bbfApi\b/);
    expect(source).not.toMatch(/factProvenance/);
    expect(source).not.toMatch(/localWork/);
    expect(source).not.toMatch(/from ["']vscode["']/);
    expect(source).not.toMatch(/brainRunHostPorts/);
    expect(source).not.toMatch(/from ["']\.\/extension["']/);
  });
});
