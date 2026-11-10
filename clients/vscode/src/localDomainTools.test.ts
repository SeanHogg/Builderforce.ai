import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  chatTicketLinkId,
  createMemoryLocalFirstStore,
  newLocalRecord,
  queueImport,
  UNBOUND_DESTINATION,
  type LocalFirstStore,
} from "@builderforce/local-first";
import { readRailFromFacts } from "./chatRail/buildRail";
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

function harness() {
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
  const tools: LocalDomainTools = createLocalDomainTools({ repository, store, syncQueue });
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

  describe("local writes", () => {
    it("writes the local repository and queues a sync event, with no network", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("network must not be used"));

      const { store, repository, syncQueue, tools } = harness();

      try {
        const created = await tools.execute("project-create", { name: "  Offline  ", key: "OFF" });
        expect(created.kind).toBe("local");
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
        expect(syncQueue.queued[0].eventId).toBe(created.syncEvent!.eventId);

        // 3. The queued event is the journal event the local transaction appended —
        //    not a second, looser copy this module invented.
        const journal = await store.export();
        const journalEvent = journal.events.find((event) => event.eventId === created.syncEvent!.eventId);
        expect(journalEvent).toMatchObject({
          clientEntityId: created.id,
          entityType: "project",
          operation: "create",
        });
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
      expect(created.syncEvent!.operation).toBe("create");
      // The create depends on the project, so a later batch push orders them.
      const journal = await store.export();
      // `dependsOn` holds the project event's dedupe KEY; it is resolved to a wire id at send time.
      expect(journal.events.find((event) => event.eventId === created.syncEvent!.eventId)?.dependsOn).toEqual([
        `project:${project.id}:v1`,
      ]);

      const moved = await tools.execute("ticket-move", { id: created.id, status: "in_progress" });
      if (moved.kind !== "local") throw new Error("expected a local result");
      expect(moved.record?.payload).toMatchObject({ status: "in_progress" });
      // The ticket was never imported by the server, so the move REPLACES its pending create
      // with one import carrying the newest state (never an update against a version the server lacks).
      expect(moved.syncEvent!.operation).toBe("import");
      expect(moved.syncEvent!.eventId).not.toBe(created.syncEvent!.eventId);
      expect((await repository.getTicket(created.id)).version).toBe(2);

      expect(syncQueue.queued.map((event) => event.operation)).toEqual(["create", "import"]);
      const pendingIds = (await store.export()).events.map((event) => event.eventId);
      expect(pendingIds).toContain(moved.syncEvent!.eventId);
    });

    it("tombstones a never-synced project and ticket with nothing to sync, and reports it", async () => {
      const { store, repository, syncQueue, tools } = harness();
      const project = await repository.createProject({ name: "Retired" });
      await repository.createTicket({ projectId: project.id, title: "Doomed" });

      const archived = await tools.execute("project-archive", { id: project.id });
      expect(archived.record).toBeUndefined();
      // Nothing left this device, so there is no event to send — and that is not a failure.
      expect(archived.syncEvent).toBeUndefined();
      expect(archived.note).toMatch(/nothing to sync/);
      expect(syncQueue.queued).toEqual([]);

      const journal = await store.export();
      // A tombstone is never a row removal, and the project's tickets went with it.
      expect(journal.records.some((record) => record.entityType === "project" && !record.deletedAt)).toBe(false);
      expect(journal.records.some((record) => record.entityType === "ticket" && !record.deletedAt)).toBe(false);
      expect(journal.events).toEqual([]);
    });

    it("queues a delete event for a tombstoned project the server HAS imported", async () => {
      const { store, repository, tools } = harness();
      const project = await repository.createProject({ name: "Synced" });
      await store.transact(async (tx) => {
        await tx.acknowledge((await tx.pending()).map((event) => event.eventId));
        await tx.putMapping({ destination: ACCOUNT, entityType: "project", clientEntityId: project.id, serverId: "9", serverVersion: 3 });
      });
      const archived = await tools.execute("project-archive", { id: project.id });
      expect(archived.syncEvent).toMatchObject({ entityType: "project", operation: "delete" });
    });

    it("tombstones a ticket through ticket-archive and keeps it readable", async () => {
      const { repository, tools } = harness();
      const project = await repository.createProject({ name: "Board" });
      const ticket = await repository.createTicket({ projectId: project.id, title: "Later" });

      const archived = await tools.execute("ticket-archive", { id: ticket.id, archived: true });
      if (archived.kind !== "local") throw new Error("expected a local result");
      expect(archived.syncEvent!.operation).toBe("import");
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

    it("a refused write is not queued", async () => {
      const { repository, store, syncQueue } = harness();
      const tools = createLocalDomainTools({ repository, store, syncQueue });

      await expect(tools.execute("ticket-create", { projectId: "no-such-project", title: "Orphan" })).rejects.toThrow(
        /no such local project/i,
      );
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
    expect(created.syncEvent!.destination).toEqual(UNBOUND_DESTINATION);
    expect(created.syncEvent!.destinationKey).toBe("unbound");
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

  it("resolves a numeric server project id to the local UUID via the mapping", async () => {
    const { store, repository, syncQueue, tools } = harness();
    const project = await repository.createProject({ name: "Board" });
    await store.transact(async (tx) => {
      await tx.putMapping({
        destination: ACCOUNT,
        entityType: "project",
        clientEntityId: project.id,
        serverId: "11",
        serverVersion: 1,
      });
    });

    const created = await tools.execute("ticket-create", { projectId: "11", title: "From server id" });
    if (created.kind !== "local") throw new Error("expected a local result");
    expect(created.record?.payload).toMatchObject({ projectId: project.id, title: "From server id" });
    expect(syncQueue.queued).toHaveLength(1);
  });

  it("passes an unmapped numeric project id through as a server reference, and still refuses an unknown UUID", async () => {
    const { repository, syncQueue, tools } = harness();
    await repository.createProject({ name: "Board" });

    // No local mirror of server project 9999: the decimal id is a server reference the
    // sync importer resolves as the tenant's own — not looked up, not guessed at.
    const created = await tools.execute("ticket-create", { projectId: "9999", title: "On the server project" });
    if (created.kind !== "local") throw new Error("expected a local result");
    expect(created.record?.payload).toMatchObject({ projectId: "9999", title: "On the server project" });
    expect(syncQueue.queued).toHaveLength(1);

    await expect(
      tools.execute("ticket-create", { projectId: "00000000-0000-4000-8000-00000000dead", title: "Orphan" }),
    ).rejects.toMatchObject({ code: "project_not_found" });
    expect(syncQueue.queued).toHaveLength(1);
  });

  it("stamps taskType and the creating chat on the ticket, and refuses an unknown task type", async () => {
    const { repository, tools } = harness();
    const project = await repository.createProject({ name: "Board" });
    const created = await tools.execute("ticket-create", {
      projectId: project.id,
      title: "Program",
      taskType: "epic",
      chatClientId: "chat-client-1",
    });
    if (created.kind !== "local") throw new Error("expected a local result");
    expect(created.record?.payload).toMatchObject({ taskType: "epic", chatClientId: "chat-client-1" });
    await expect(
      tools.execute("ticket-create", { projectId: project.id, title: "Bad", taskType: "portfolio" }),
    ).rejects.toMatchObject({ code: "invalid_arguments" });
  });

  it("regression: ticket-create in a live local chat links that chat locally ('created'), in the create's commit", async () => {
    const { store, repository, tools } = harness();
    const chatId = "00000000-0000-4000-8000-0000000000c1";
    await store.transact(async (tx) => {
      const chat = newLocalRecord<unknown>({
        id: chatId, entityType: "chat", payload: { clientId: chatId, chat: { id: 3, title: "Planning" } },
        deviceId: "device-vsix", destination: ACCOUNT,
      });
      await tx.put(chat);
      await queueImport(tx, chat);
    });
    const project = await repository.createProject({ name: "Board" });
    let commits = 0;
    const unsubscribe = store.subscribe(() => { commits += 1; });
    const created = await tools.execute("ticket-create", { projectId: project.id, title: "From chat", chatClientId: chatId });
    unsubscribe();
    if (created.kind !== "local") throw new Error("expected a local result");

    const link = (await store.export()).records.find((row) => row.entityType === "chat-ticket-link");
    expect(link?.id).toBe(chatTicketLinkId(chatId, created.id));
    expect(link?.payload).toMatchObject({ chatClientId: chatId, ticketClientId: created.id, linkType: "created" });
    // Ticket and link are ONE commit; the tool layer writes nothing of its own.
    expect(commits).toBe(1);
    expect(readRailFromFacts(await store.export(), chatId).tickets.map((row) => row.clientId)).toEqual([created.id]);
  });

  it("still resolves an exact local UUID project id unchanged", async () => {
    const { repository, tools } = harness();
    const project = await repository.createProject({ name: "Board" });

    const created = await tools.execute("ticket-create", { projectId: project.id, title: "Local id" });
    if (created.kind !== "local") throw new Error("expected a local result");
    expect(created.record?.payload).toMatchObject({ projectId: project.id, title: "Local id" });
  });

  it("exposes LocalDomainToolError codes", () => {
    expect(new LocalDomainToolError("connected_only_tool", "no")).toBeInstanceOf(Error);
    expect(new LocalDomainToolError("unknown_domain_tool", "no")).toMatchObject({
      name: "LocalDomainToolError",
      code: "unknown_domain_tool",
    });
  });
});
describe("ticket-* tools and numeric ids", () => {
  it("maps a numeric id to the local mirror, and tells the model to use builtin_tasks_update for a server-only ticket", async () => {
    const { store, repository, tools } = harness();
    const project = await repository.createProject({ name: "P" });
    const ticket = await repository.createTicket({ projectId: project.id, title: "Mirrored" });
    await store.transact(async (tx) => {
      await tx.putMapping({ destination: ACCOUNT, entityType: "ticket", clientEntityId: ticket.id, serverId: "321", serverVersion: 1 });
    });
    const moved = await tools.execute("ticket-move", { id: "321", status: "done" });
    expect(moved.id).toBe(ticket.id);
    await tools.execute("ticket-update", { id: "321", taskType: "epic" });
    expect((await repository.getTicket(ticket.id)).payload).toMatchObject({ status: "done", taskType: "epic" });
    await expect(tools.execute("ticket-delete", { id: "999" })).rejects.toMatchObject({ code: "server_only_ticket" });
    await expect(tools.execute("ticket-update", { id: "999", title: "x" })).rejects.toThrow(/builtin_tasks_update/);
  });

  it("reports the server id and a note on a create result", async () => {
    const { tools } = harness();
    const project = await tools.execute("project-create", { name: "P" });
    const created = await tools.execute("ticket-create", { projectId: project.id, title: "T" });
    expect(created.note).toMatch(/LOCAL id/);
    expect(created.serverId).toBeUndefined();
  });

  it("regression: ticket-create / project-create results carry localId (= id), and syncId once mapped", async () => {
    const { store, tools } = harness();
    const project = await tools.execute("project-create", { name: "P" });
    expect(project.localId).toBe(project.id);
    expect(project.syncId).toBeUndefined();
    const created = await tools.execute("ticket-create", { projectId: project.id, title: "T" });
    expect(created.localId).toBe(created.id);
    expect(created.syncId).toBeUndefined();

    await store.transact(async (tx) => {
      await tx.putMapping({ destination: ACCOUNT, entityType: "project", clientEntityId: project.id, serverId: "12", serverVersion: 1 });
    });
    const again = await tools.execute("ticket-create", { projectId: "12", title: "On the mapped project" });
    expect(again.record?.payload).toMatchObject({ projectId: project.id });
    // A non-create result keeps its legacy text id only.
    const moved = await tools.execute("ticket-move", { id: created.id, status: "done" });
    expect(moved.localId).toBeUndefined();
  });
});
