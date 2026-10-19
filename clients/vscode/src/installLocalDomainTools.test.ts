import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMemoryLocalFirstStore } from "../../../packages/local-first/src/store.ts";
import {
  HOST_DOMAIN_TOOL_LINE,
  installLocalDomainTools,
  type DomainToolRequest,
} from "./installLocalDomainTools";

function deniedHost(deviceId = "device-1") {
  const store = createMemoryLocalFirstStore();
  const ctx = { id: `host-${deviceId}-${Math.random()}` };
  const calls: DomainToolRequest[] = [];
  const installed = installLocalDomainTools(ctx, {
    getConfig: (key) => (key === "builderforce.localDeviceId" ? deviceId : undefined),
    localFirstStore: store,
    policyAllows: false,
    platformTool: async (request) => {
      calls.push(request);
      return { platform: true };
    },
  });
  return { store, installed, calls };
}

describe("installLocalDomainTools", () => {
  it("writes a local project and ticket and queues sync events when the platform is denied", async () => {
    const { store, installed, calls } = deniedHost();
    const project = await installed.execute({
      tool: "project-create",
      args: { name: "Offline" },
      runId: "run-1",
    });
    expect(project.kind).toBe("local");
    if (project.kind !== "local") return;
    const ticket = await installed.execute({
      tool: "ticket-create",
      args: { projectId: project.id, title: "Ship offline" },
      runId: "run-1",
    });
    const fact = await installed.execute({
      tool: "memory-recall",
      args: { key: "owner", statement: "Sean" },
      runId: "run-1",
    });

    expect(calls).toEqual([]);
    expect(ticket.kind).toBe("local");
    expect(fact.kind).toBe("local");
    if (ticket.kind !== "local" || fact.kind !== "local") return;
    expect(ticket.record.payload).toMatchObject({ projectId: project.id, title: "Ship offline" });
    expect(project.record.provenance?.deviceId).toBe("device-1");

    const pending = await store.read((tx) => tx.pending());
    expect(pending.map((event) => `${event.entityType}:${event.operation}`).sort()).toEqual([
      "memory-fact:create",
      "project:create",
      "ticket:create",
    ]);
    expect(pending.every((event) => event.clientEntityId.length > 0)).toBe(true);
  });

  it("calls the platform tool and writes nothing when policy allows", async () => {
    const store = createMemoryLocalFirstStore();
    const calls: DomainToolRequest[] = [];
    const installed = installLocalDomainTools({ id: "allowed" }, {
      localDeviceId: "device-1",
      localFirstStore: store,
      policyAllows: true,
      platformTool: async (request) => {
        calls.push(request);
        return { platform: true };
      },
    });
    const outcome = await installed.execute({
      tool: "project-create",
      args: { name: "Online" },
    });
    expect(outcome).toEqual({ kind: "platform", tool: "project-create", value: { platform: true } });
    expect(calls).toHaveLength(1);
    expect(await store.read((tx) => tx.pending())).toEqual([]);
    expect(await store.read((tx) => tx.list("project"))).toEqual([]);
  });

  it("refuses an unknown tool without throwing or calling the platform", async () => {
    const { installed, calls, store } = deniedHost();
    const request = { tool: "not-a-tool", args: {} } as unknown as DomainToolRequest;
    const first = await installed.execute(request);
    const second = await installed.execute(request);
    expect(first).toEqual({ kind: "refused", reason: "not_a_local_domain_tool" });
    expect(second).toBe(first);
    expect(calls).toEqual([]);
    expect(await store.read((tx) => tx.pending())).toEqual([]);
  });

  it("reuses the host device id and does not mint another", async () => {
    const { installed } = deniedHost("device-9");
    const outcome = await installed.execute({
      tool: "project-create",
      args: { name: "Held" },
    });
    expect(outcome.kind).toBe("local");
    if (outcome.kind !== "local") return;
    expect(outcome.record.provenance?.deviceId).toBe("device-9");
  });

  it("installs once per host context", () => {
    const ctx = { id: "same" };
    const first = installLocalDomainTools(ctx, { localDeviceId: "device-1" });
    const second = installLocalDomainTools(ctx, { localDeviceId: "device-2" });
    expect(second).toBe(first);
  });

  it("does not import bfApi or modules absent from origin/main", () => {
    const source = readFileSync(new URL("./installLocalDomainTools.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'][^"']*bfApi/);
    expect(source).not.toMatch(/\bbfApi\b/);
    expect(source).not.toMatch(/localWork/);
    expect(source).not.toMatch(/localTools/);
    expect(source).not.toMatch(/from ["']vscode["']/);
    expect(source).toContain(HOST_DOMAIN_TOOL_LINE);
    expect(source).toContain("factProvenance.ts");
    expect(source).toContain("records.ts");
    expect(source).toContain("store.ts");
  });
});
