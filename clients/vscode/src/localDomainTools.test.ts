import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createMemoryLocalFirstStore, UNBOUND_DESTINATION, type LocalFirstStore } from "@builderforce/local-first";
import { createLocalWorkRepository, type LocalWorkRepository } from "./localWorkRepository";
import {
  LocalDomainToolError,
  classifyLocalDomainTool,
  createInMemoryLocalSyncQueue,
  createLocalDomainTools,
  looksLikeServerMcpTool,
  type LocalDomainTools,
} from "./localDomainTools";

/** A destination an explicit Connect would bind to. The tools never invent one. */
const ACCOUNT = Object.freeze({ kind: "bound", accountId: "acct-1", tenantId: "tenant-a" } as const);

function harness(
  overrides: { policyAllows?: boolean } = {},
) {
  const store: LocalFirstStore = createMemoryLocalFirstStore();
  let tick = 0;
  let ids = 0;
  const repository: LocalWorkRepository = createLocalWorkRepository({
    store,
    deviceId: "device-vsix",
    destination: ACCOUNT,
    now: () => new Date(Date.UTC(2026, 9, 18, 0, 0, tick++)),
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
  });
  const syncQueue = createInMemoryLocalSyncQueue();
  // A denied policy is the default (G01) and the DEFAULT here: no policy object
  // at all means every domain tool runs locally.
  const tools: LocalDomainTools = createLocalDomainTools({
    repository,
    store,
    syncQueue,
    ...(overrides.policyAllows === undefined ? {} : { platformPolicy: { allows: () => overrides.policyAllows! } }),
  });
  return { store, repository, syncQueue, tools };
}

describe("localDomainTools", () => {
  it("does not import bfApi, the gateway relay, vscode, or fetch", () => {
    const source = readFileSync(new URL("./localDomainTools.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["']\.\/bfApi["']/);
    expect(source).not.toMatch(/from\s+["']\.\/platformTools["']/);
    expect(source).not.toMatch(/from\s+["']\.\/gateway["']/);
    expect(source).not.toMatch(/from\s+["']vscode["']/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });

  it("is not wired into extension activation", () => {
    const activation = readFileSync(new URL("./extension.ts", import.meta.url), "utf8");
    expect(activation).not.toContain("localDomainTools");
  });

  it("classifies local adapters, connected-only tools, and server MCP tools", () => {
    expect(classifyLocalDomainTool("ticket-create")).toBe("local");
    expect(classifyLocalDomainTool("ticket_move")).toBe("local");
    expect(classifyLocalDomainTool("  Project-Update ")).toBe("local");
    expect(classifyLocalDomainTool("cloud-execution")).toBe("connected-only");
    expect(classifyLocalDomainTool("meeting-join")).toBe("connected-only");
    expect(classifyLocalDomainTool("remote-session-read")).toBe("connected-only");
    // Dynamically fetched relay tools are never local adapters (G06).
    expect(classifyLocalDomainTool("builtin_tasks_create")).toBe("connected-only");
    expect(classifyLocalDomainTool("some_mcp_tool")).toBe("connected-only");
    expect(looksLikeServerMcpTool("builtin_tasks_update")).toBe(true);
    expect(classifyLocalDomainTool("read_file")).toBe("unknown");
    expect(classifyLocalDomainTool("")).toBe("unknown");
  });

  describe("with the platform denied", () => {
    it("writes the local repository, queues a sync event, and never calls the platform", async () => {
      const platformTool = vi.fn().mockRejectedValue(new Error("the platform must not be called"));
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("network must not be used"));

      // No platformPolicy at all — the G01 default. A platform caller IS wired,
      // so a denied run that reached it would fail this test loudly.
      const { store, repository, syncQueue, tools } = harness();
      const toolsWithCaller = createLocalDomainTools({
        repository,
        store,
        syncQueue,
        platformTool,
      });

      try {
        const created = await toolsWithCaller.execute("project-create", { name: "  Offline  ", key: "OFF" });
        expect(created.kind).toBe("local");
        expect(platformTool).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();

        if (created.kind !== "local") throw new Error("expected a local result");
        expect(created.tool).toBe("project-create");
        expect(created.entityType).toBe("project");
        expect(created.record?.payload).toEqual({ name: "Offline", key: "OFF" });
        expect(created.record?.destination).toEqual(ACCOUNT);

        // 1. The local repository really holds the write.
        const stored = await repository.getProject(created.id);
        expect(stored.payload).toEqual({ name: "Offline", key: "OFF" });

        // 2. A sync event is queued for it.
        expect(syncQueue.queued).toHaveLength(1);
        expect(syncQueue.queued[0]).toMatchObject({
          entityType: "project",
          clientEntityId: created.id,
          operation: "create",
          destination: ACCOUNT,
        });
        expect(syncQueue.queued[0].eventId).toBe(created.syncEvent.eventId);

        // 3. The queued event is the journal event the local transaction appended —
        //    not a second, looser copy this module invented.
        const journal = await store.export();
        const journalEvent = journal.events.find((event) => event.eventId === created.syncEvent.eventId);
        expect(journalEvent).toMatchObject({
          clientEntityId: created.id,
          entityType: "project",
          operation: "create",
        });
        expect(tools.isPlatformAllowed("project-create")).toBe(false);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it("writes a ticket, moves it, and queues one event per local write", async () => {
      const { store, repository, syncQueue, tools } = harness();
      const project = await repository.createProject({ name: "Board" });

      const created = await tools.execute("ticket-create", {
        projectId: project.id,
        title: "  Ship it  ",
        description: "local only",
        priority: "high",
      });
      if (created.kind !== "local") throw new Error("expected a local result");

      expect(created.entityType).toBe("ticket");
      expect(created.record?.payload).toMatchObject({
        projectId: project.id,
        title: "Ship it",
        status: "backlog",
        description: "local only",
        priority: "high",
      });
      // The ticket took the PROJECT's bound destination, snapped (G11).
      expect(created.record?.destination).toEqual(ACCOUNT);
      expect(created.syncEvent.operation).toBe("create");
      // The create depends on the project, so a later batch push orders them.
      const journal = await store.export();
      // `dependsOn` carries the project event's wire id (the store resolves the key).
      const projectEvent = journal.events.find((event) => event.idempotencyKey === `project:${project.id}:v1`);
      expect(journal.events.find((event) => event.eventId === created.syncEvent.eventId)?.dependsOn).toEqual([
        projectEvent?.eventId,
      ]);

      const moved = await tools.execute("ticket-move", { id: created.id, status: "in_progress" });
      if (moved.kind !== "local") throw new Error("expected a local result");
      expect(moved.record?.payload).toMatchObject({ status: "in_progress" });
      expect(moved.syncEvent.operation).toBe("update");
      expect(moved.syncEvent.eventId).not.toBe(created.syncEvent.eventId);
      expect((await repository.getTicket(created.id)).version).toBe(2);

      expect(syncQueue.queued.map((event) => event.operation)).toEqual(["create", "update"]);
      // The queued ids are the real journal events, in order.
      const pendingIds = (await store.export()).events.map((event) => event.eventId);
      expect(syncQueue.queued.map((event) => event.eventId)).toEqual([
        created.syncEvent.eventId,
        moved.syncEvent.eventId,
      ]);
      expect(pendingIds).toEqual(expect.arrayContaining(syncQueue.queued.map((event) => event.eventId)));
    });

    it("queues an archive event for a tombstoned project and a deleted ticket", async () => {
      const { store, repository, syncQueue, tools } = harness();
      const project = await repository.createProject({ name: "Retired" });
      const ticket = await repository.createTicket({ projectId: project.id, title: "Doomed" });

      const archived = await tools.execute("project-archive", { id: project.id });
      if (archived.kind !== "local") throw new Error("expected a local result");
      expect(archived.record).toBeUndefined();
      expect(archived.syncEvent).toMatchObject({ entityType: "project", operation: "delete" });

      const journal = await store.export();
      // A tombstone is a delete EVENT, never a row removal, and its tickets went too.
      expect(journal.records.some((record) => record.entityType === "project" && !record.deletedAt)).toBe(false);
      expect(journal.records.some((record) => record.entityType === "ticket" && !record.deletedAt)).toBe(false);
      expect(journal.events.filter((event) => event.operation === "delete").map((event) => event.entityType)).toEqual([
        "ticket",
        "project",
      ]);
      expect(syncQueue.queued.map((event) => event.eventId)).toContain(archived.syncEvent.eventId);
    });

    it("tombstones a ticket through ticket-archive and keeps it readable", async () => {
      const { repository, tools } = harness();
      const project = await repository.createProject({ name: "Board" });
      const ticket = await repository.createTicket({ projectId: project.id, title: "Later" });

      const archived = await tools.execute("ticket-archive", { id: ticket.id, archived: true });
      if (archived.kind !== "local") throw new Error("expected a local result");
      expect(archived.syncEvent.operation).toBe("update");
      expect((await repository.getTicket(ticket.id)).payload.archived).toBe(true);
      // An archived ticket is filtered out of the board, not deleted.
      expect(await repository.listTickets()).toHaveLength(0);
      expect(await repository.listTickets({ includeArchived: true })).toHaveLength(1);
    });

    it("refuses a connected-only or unknown tool instead of substituting a local write", async () => {
      const { syncQueue, tools } = harness();

      await expect(tools.execute("builtin_tasks_create", { title: "t" })).rejects.toMatchObject({
        code: "connected_only_tool",
      });
      await expect(tools.execute("meeting-join", {})).rejects.toMatchObject({ code: "connected_only_tool" });
      await expect(tools.execute("read_file", { path: "a" })).rejects.toMatchObject({
        code: "unknown_domain_tool",
      });
      // Nothing was queued and nothing was written as a stand-in.
      expect(syncQueue.queued).toEqual([]);
    });

    it("validates arguments before the store is touched", async () => {
      const { store, syncQueue, tools } = harness();
      const before = (await store.export()).events.length;

      await expect(tools.execute("project-create", {})).rejects.toMatchObject({
        code: "tool_arguments_required",
      });
      await expect(tools.execute("ticket-create", { projectId: "p", title: "  " })).rejects.toMatchObject({
        code: "tool_arguments_required",
      });
      await expect(tools.execute("ticket-move", { id: "t", status: "not-a-status" })).rejects.toMatchObject({
        code: "invalid_status",
      });
      await expect(tools.execute("ticket-update", { id: "t" })).rejects.toMatchObject({
        code: "tool_arguments_required",
      });
      await expect(tools.execute("ticket-move", { id: "t" })).rejects.toMatchObject({
        code: "tool_arguments_required",
      });

      expect((await store.export()).events).toHaveLength(before);
      expect(syncQueue.queued).toEqual([]);
    });

    it("a refused write is not queued and does not fall back to the platform", async () => {
      const platformTool = vi.fn().mockResolvedValue({ ok: true });
      const { repository, store, syncQueue } = harness();
      const tools = createLocalDomainTools({ repository, store, syncQueue, platformTool });

      await expect(tools.execute("ticket-create", { projectId: "no-such-project", title: "Orphan" })).rejects.toThrow(
        /no such local project/i,
      );
      expect(platformTool).not.toHaveBeenCalled();
      expect(syncQueue.queued).toEqual([]);
    });

    it("denies when the policy cannot answer, and when it grants only one tool", async () => {
      const platformTool = vi.fn().mockResolvedValue({ ok: true });
      const { repository, store, syncQueue } = harness();

      const throwing = createLocalDomainTools({
        repository,
        store,
        syncQueue,
        platformTool,
        platformPolicy: {
          allows() {
            throw new Error("policy store unreadable");
          },
        },
      });
      const denied = await throwing.execute("project-create", { name: "Still local" });
      expect(denied.kind).toBe("local");
      expect(platformTool).not.toHaveBeenCalled();

      const partial = createLocalDomainTools({
        repository,
        store,
        syncQueue,
        platformTool,
        platformPolicy: { allows: (tool) => tool === "ticket-create" },
      });
      const queuedAtStart = syncQueue.queued.length;
      const local = await partial.execute("project-create", { name: "Local write" });
      expect(local.kind).toBe("local");
      const queuedAfterLocal = syncQueue.queued.length;
      expect(queuedAfterLocal).toBe(queuedAtStart + 1);

      const remote = await partial.execute("ticket-create", { projectId: "p", title: "t" });
      expect(remote.kind).toBe("platform");
      expect(platformTool).toHaveBeenCalledTimes(1);
      expect(platformTool).toHaveBeenCalledWith("ticket-create", expect.objectContaining({ tool: "ticket-create" }));
      // The granted platform call queued NOTHING: the platform owns that write,
      // so there is no local record and no offline event to replay.
      expect(syncQueue.queued).toHaveLength(queuedAfterLocal);
    });
  });

  describe("with the platform allowed", () => {
    it("delegates to the platform caller and does not write locally", async () => {
      const { store, repository, syncQueue, tools } = harness({ policyAllows: true });
      const platformTool = vi.fn().mockResolvedValue({ id: 7 });

      const remote = await createLocalDomainTools({
        repository,
        store,
        syncQueue,
        platformPolicy: { allows: () => true },
        platformTool,
      }).execute("project-create", { name: "Server project" });

      expect(remote).toEqual({ kind: "platform", tool: "project-create", result: { id: 7 } });
      expect(platformTool).toHaveBeenCalledWith("project-create", { tool: "project-create", name: "Server project" });
      // The platform path owns the write; nothing local, nothing queued.
      expect(await repository.listProjects()).toEqual([]);
      expect(syncQueue.queued).toEqual([]);
      expect((await store.export()).events).toEqual([]);
    });

    it("fails closed when policy allows but no platform caller is wired", async () => {
      const { repository, store, syncQueue } = harness({ policyAllows: true });
      const tools = createLocalDomainTools({
        repository,
        store,
        syncQueue,
        platformPolicy: { allows: () => true },
      });

      await expect(tools.execute("project-create", { name: "Nowhere" })).rejects.toMatchObject({
        code: "platform_tool_required",
      });
      // It did NOT quietly fall back to a local write.
      expect(await repository.listProjects()).toEqual([]);
      expect(syncQueue.queued).toEqual([]);
    });
  });

  it("leaves never-connected work unbound and never infers a destination", async () => {
    const store: LocalFirstStore = createMemoryLocalFirstStore();
    let ids = 0;
    const repository = createLocalWorkRepository({
      store,
      deviceId: "device-vsix",
      newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    });
    const syncQueue = createInMemoryLocalSyncQueue();
    const tools = createLocalDomainTools({ repository, store, syncQueue });

    const created = await tools.execute("project-create", { name: "Never connected" });
    if (created.kind !== "local") throw new Error("expected a local result");

    expect(created.record?.destination).toEqual(UNBOUND_DESTINATION);
    expect(created.syncEvent.destination).toEqual(UNBOUND_DESTINATION);
    expect(created.syncEvent.destinationKey).toBe("unbound");
    // G10: unbound work waits for an explicit bind, it is not adopted later.
    expect(syncQueue.queued).toHaveLength(1);
  });

  it("reports a repository defect instead of inventing a sync event", async () => {
    const { repository, store, syncQueue } = harness();
    // A journal that lost the event — the record was written, the event was not.
    const journalBlind: LocalFirstStore = {
      ...store,
      read: (work) =>
        store.read(async (tx) => {
          const blind = Object.create(tx) as typeof tx;
          blind.pending = async () => [];
          return work(blind);
        }),
      transact: (work) => store.transact(work),
      export: () => store.export(),
      subscribe: (listener) => store.subscribe(listener),
    };
    const tools = createLocalDomainTools({ repository, store: journalBlind, syncQueue });

    await expect(tools.execute("project-create", { name: "Unjournalled" })).rejects.toThrow(
      /produced no journal event/,
    );
    // It refused to report unjournalled work as synced, and queued nothing.
    expect(syncQueue.queued).toEqual([]);
    // The write itself did land — the defect is reported, not silently swallowed.
    expect(await repository.listProjects()).toHaveLength(1);
  });

  it("exposes LocalDomainToolError codes", () => {
    expect(new LocalDomainToolError("connected_only_tool", "no")).toBeInstanceOf(Error);
    expect(new LocalDomainToolError("unknown_domain_tool", "no")).toMatchObject({
      name: "LocalDomainToolError",
      code: "unknown_domain_tool",
    });
  });
});