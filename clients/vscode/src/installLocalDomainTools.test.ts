import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createMemoryLocalFirstStore, UNBOUND_DESTINATION } from "@builderforce/local-first";
import { LOCAL_DOMAIN_TOOL_NAMES, LocalDomainToolError, classifyLocalDomainTool } from "./localDomainTools";
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
    expect(source).not.toMatch(/from ["'][^"']*bfApi/);
    expect(source).not.toMatch(/\bbfApi\b/);
    expect(source).not.toMatch(/factProvenance/);
    expect(source).not.toMatch(/localWork/);
    expect(source).not.toMatch(/from ["']vscode["']/);
    expect(source).not.toMatch(/brainRunHostPorts/);
    expect(source).not.toMatch(/from ["']\.\/extension["']/);
  });
});

/**
 * THE regression this ticket exists for. The earlier "imports only the landed
 * library" case read THIS file and asserted it contained a constant declared in
 * THIS file — it never opened the host, so it passed while nothing installed the
 * adapter anywhere. These cases read the real host file instead, so deleting the
 * wiring fails the suite.
 */
describe("the run host installs the local domain tools", () => {
  const HOST_FILE = "./brainRunHostPorts.ts";

  it("calls installLocalDomainTools on the tool-dispatch path", () => {
    const source = readFileSync(new URL(HOST_FILE, import.meta.url), "utf8");
    // Imported by the host…
    expect(source).toMatch(/import\s*\{[^}]*installLocalDomainTools[^}]*\}\s*from\s*"\.\/installLocalDomainTools"/);
    // …bound to this host's store…
    expect(source).toMatch(/installLocalDomainTools\(\s*ctx\s*,\s*\{[^}]*localFirstStore/);
    // …and actually executed on the dispatch path, verbatim.
    expect(source).toContain(HOST_DOMAIN_TOOL_LINE);
  });

  it("routes denied domain tools through the adapter from the catalog seam", () => {
    const source = readFileSync(new URL(HOST_FILE, import.meta.url), "utf8");
    // The tool list the run actually executes is wrapped, not merely built.
    expect(source).toMatch(/routeDeniedDomainTools\(\s*ctx\s*,\s*local\.store\s*,\s*catalog\s*\)/);
    expect(source).toMatch(/function routeDeniedDomainTools/);
    // A denial is decided by the platform policy, not by tool absence.
    expect(source).toMatch(/platformPolicy\(\)\.allows\(\s*"synchronize"\s*\)/);
    // Only a name the landed classifier calls "local" is repointed at the writer.
    expect(source).toMatch(/classifyLocalDomainTool\(\s*tool\.name\s*\)\s*===\s*"local"/);
  });

  it("advertises only tool names the landed library actually implements", () => {
    const source = readFileSync(new URL(HOST_FILE, import.meta.url), "utf8");
    const block = source.slice(
      source.indexOf("const LOCAL_DOMAIN_TOOL_SPECS"),
      source.indexOf("/**\n * When synchronize is denied"),
    );
    expect(block).not.toBe("");
    const advertised = [...block.matchAll(/name:\s*"([^"]+)"/g)].map((match) => match[1]);
    expect(advertised.length).toBeGreaterThan(0);
    // memory-recall is not landed: classifyLocalDomainTool answers "unknown", so
    // advertising it would offer the model a tool that always throws.
    expect(advertised).not.toContain("memory-recall");
    for (const name of advertised) {
      expect(classifyLocalDomainTool(name)).toBe("local");
    }
  });

  it("binds the adapter lazily so a fresh install cannot crash the host", () => {
    const source = readFileSync(new URL(HOST_FILE, import.meta.url), "utf8");
    const installBody = source.slice(
      source.indexOf("function installHostDomainTools"),
      source.indexOf("function runInstalledDomainTool"),
    );
    expect(installBody).toContain("return;");
    // No eager bind at host construction: localBrainApplication mints the device
    // id only after globalState persists it, so an unguarded call here throws
    // local_device_id_required and takes the extension host down.
    const constructor = source.slice(source.indexOf("export function createVsCodeRunHost"));
    expect(constructor.slice(0, constructor.indexOf("const streamForRoute"))).not.toMatch(
      /^ {2}installHostDomainTools\(/m,
    );
  });
});
