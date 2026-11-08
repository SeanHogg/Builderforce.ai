import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  bindWorkForSync,
  chatTicketLinkId,
  createMemoryLocalFirstStore,
  createPlatformPolicy,
  createSyncCoordinator,
  importKey,
  newLocalRecord,
  queueImport,
  UNBOUND_DESTINATION,
  type EntityDestination,
  type LocalFirstStore,
  type SyncPushBatch,
} from "@builderforce/local-first";
import { readRailFromFacts } from "./chatRail/buildRail";
import { createLocalWorkRepository } from "./localWorkRepository";
import { creationDestination, isSignedInTenantLure, LocalWorkRepositoryError } from "./localWorkShared";

/** A VS Code authentication session, the shape `auth.ts` actually builds. */
const SIGNED_IN_SESSION = {
  id: "builderforce",
  accessToken: "editor-key",
  account: { id: "builderforce", label: "BuilderForce" },
  scopes: ["gateway"],
  tenantId: "whoever-is-signed-in",
};

const ACCOUNT = Object.freeze({
  accountId: "acct-1",
  tenantId: "tenant-a",
  projectId: "server-project-9",
});

function harness() {
  const store = createMemoryLocalFirstStore();
  let tick = 0;
  let ids = 0;
  const repo = createLocalWorkRepository({
    store,
    deviceId: "device-1",
    now: () => new Date(Date.UTC(2026, 9, 18, 0, 0, tick++)),
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
  });
  return { store, repo };
}

describe("localWorkRepository", () => {
  it("does not import bfApi, vscode, or fetch", () => {
    for (const file of ["localWorkRepository", "localWorkShared", "localProjectRepository", "localTicketRepository", "localWorkOwnership"]) {
      const source = readFileSync(new URL(`./${file}.ts`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/from\s+["']\.\/bfApi["']/);
      expect(source, file).not.toMatch(/from\s+["']vscode["']/);
      expect(source, file).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it("creates a project and a ticket with no network call, and lists them back", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network must not be used"));
    const { store, repo } = harness();
    try {
      const project = await repo.createProject({ name: "  Offline  ", key: "OFF" });
      const ticket = await repo.createTicket({
        projectId: project.id,
        title: "  Write it down  ",
        description: "local only",
        priority: "high",
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(project.destination).toEqual(UNBOUND_DESTINATION);
      expect(project.payload).toEqual({ name: "Offline", key: "OFF" });
      expect(ticket.destination).toEqual(UNBOUND_DESTINATION);
      expect(ticket.payload).toMatchObject({
        projectId: project.id,
        title: "Write it down",
        status: "backlog",
        description: "local only",
        priority: "high",
      });

      expect(await repo.listProjects()).toEqual([project]);
      expect(await repo.listTickets()).toEqual([ticket]);

      const exported = await store.export();
      const create = exported.events.find((event) => event.clientEntityId === ticket.id);
      expect(create).toMatchObject({
        operation: "create",
        dependsOn: [`project:${project.id}:v1`],
        destination: UNBOUND_DESTINATION,
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("sets status and archive as local writes and hides archived tickets unless asked", async () => {
    const { repo } = harness();
    const project = await repo.createProject({ name: "Board" });
    const ticket = await repo.createTicket({ projectId: project.id, title: "Move me" });

    const moved = await repo.changeTicketStatus(ticket.id, "in_progress");
    expect(moved.payload.status).toBe("in_progress");
    expect(moved.version).toBe(ticket.version + 1);
    expect(moved.destination).toEqual(UNBOUND_DESTINATION);
    expect((await repo.listTickets({ status: "in_progress" })).map((row) => row.id)).toEqual([ticket.id]);

    const archived = await repo.setTicketArchived(ticket.id, true);
    expect(archived.payload.archived).toBe(true);
    expect(await repo.listTickets()).toEqual([]);
    expect(await repo.listTickets({ includeArchived: true })).toHaveLength(1);

    await expect(repo.changeTicketStatus(ticket.id, "done")).rejects.toMatchObject({ code: "ticket_archived" });
    await expect(repo.changeTicketStatus(ticket.id, "not-a-column")).rejects.toMatchObject({ code: "invalid_status" });
    expect((await repo.getTicket(ticket.id)).payload.status).toBe("in_progress");
  });

  it("stamps unbound when no account is known and refuses a signed-in tenant", async () => {
    const { store, repo } = harness();
    expect(isSignedInTenantLure(SIGNED_IN_SESSION)).toBe(true);
    expect(isSignedInTenantLure(ACCOUNT)).toBe(false);

    const project = await repo.createProject({ name: "Personal" });
    expect(project.destination).toEqual({ kind: "unbound" });
    expect(project.destination).not.toHaveProperty("tenantId");
    expect(project.destination).not.toHaveProperty("accountId");

    // A selected server project id is not an account. It must not become ownership.
    const stillUnbound = await repo.createProject({
      name: "Selected only",
      destination: { projectId: "the-selected-project" },
    });
    expect(stillUnbound.destination).toEqual(UNBOUND_DESTINATION);

    // kind: 'unbound' wins even if a tenant id was stuffed in beside it.
    const explicitUnbound = await repo.createProject({
      name: "Explicit unbound",
      destination: { kind: "unbound", tenantId: "whoever-is-signed-in" },
    });
    expect(explicitUnbound.destination).toEqual(UNBOUND_DESTINATION);

    await expect(
      repo.createProject({ name: "Stolen", destination: SIGNED_IN_SESSION as never }),
    ).rejects.toBeInstanceOf(LocalWorkRepositoryError);
    await expect(
      repo.createProject({ name: "Stolen", destination: SIGNED_IN_SESSION as never }),
    ).rejects.toMatchObject({ code: "signed_in_tenant_refused" });
    await expect(
      repo.createProject({ name: "Stolen", destination: { tenantId: "whoever-is-signed-in" } }),
    ).rejects.toMatchObject({ code: "signed_in_tenant_refused" });
    await expect(
      repo.bindDestination({ ids: [project.id], to: SIGNED_IN_SESSION as never }),
    ).rejects.toMatchObject({ code: "signed_in_tenant_refused" });
    await expect(
      repo.bindDestination({ ids: [project.id], to: { tenantId: "whoever-is-signed-in" } }),
    ).rejects.toMatchObject({ code: "signed_in_tenant_refused" });

    expect(await repo.listProjects()).toHaveLength(3);
    expect((await store.export()).records.every((record) => record.destination.kind === "unbound")).toBe(true);
    expect(creationDestination(undefined)).toEqual(UNBOUND_DESTINATION);
  });

  it("does not adopt whoever later signs in; binding is an explicit snapshot on the record", async () => {
    const { store, repo } = harness();
    const project = await repo.createProject({ name: "Written offline" });
    const ticket = await repo.createTicket({ projectId: project.id, title: "Already filed" });

    expect(() =>
      createLocalWorkRepository({ store, deviceId: "device-1", destination: SIGNED_IN_SESSION as never }),
    ).toThrow(LocalWorkRepositoryError);

    const signedIn = createLocalWorkRepository({
      store,
      deviceId: "device-1",
      destination: ACCOUNT,
      now: () => new Date("2026-10-18T12:00:00.000Z"),
      newId: () => "00000000-0000-4000-8000-000000000099",
    });
    expect((await signedIn.listProjects())[0]?.destination).toEqual(UNBOUND_DESTINATION);
    const filedAfterSignIn = await signedIn.createTicket({ projectId: project.id, title: "Still the project's" });
    expect(filedAfterSignIn.destination).toEqual(UNBOUND_DESTINATION);

    const bound = await repo.bindDestination({ ids: [project.id], to: ACCOUNT });
    expect(bound).toBe(3);
    const after = await store.export();
    for (const id of [project.id, ticket.id, filedAfterSignIn.id]) {
      expect(after.records.find((record) => record.id === id)?.destination).toEqual({ kind: "bound", ...ACCOUNT });
    }
    const bindEvent = after.events.find(
      (event) => event.clientEntityId === project.id && event.operation === "update",
    );
    expect(bindEvent?.destination).toEqual({ kind: "bound", ...ACCOUNT });

    const next = await signedIn.createTicket({ projectId: project.id, title: "Snapped after bind" });
    expect(next.destination).toEqual({ kind: "bound", ...ACCOUNT });

    await expect(
      repo.bindDestination({ ids: [project.id], to: { accountId: "acct-1", tenantId: "someone-else" } }),
    ).rejects.toMatchObject({ code: "destination_tenant_mismatch" });
    expect((await repo.getProject(project.id)).destination).toEqual({ kind: "bound", ...ACCOUNT });
  });

  it("refuses a missing project and writes nothing", async () => {
    const { store, repo } = harness();
    await expect(repo.createTicket({ projectId: "missing", title: "Orphan" })).rejects.toMatchObject({
      code: "project_not_found",
    });
    expect((await store.export()).records).toEqual([]);
    expect((await store.export()).events).toEqual([]);
  });

  it("accepts a decimal project id as a server reference without a local project", async () => {
    const { store, repo } = harness();
    const ticket = await repo.createTicket({ projectId: "11", title: "On the server project" });
    expect(ticket.payload).toMatchObject({ projectId: "11", title: "On the server project" });
    expect(ticket.destination).toEqual(UNBOUND_DESTINATION);
    // Nothing local to wait for: the server resolves the reference itself.
    const create = (await store.export()).events.find((event) => event.clientEntityId === ticket.id);
    expect(create?.dependsOn).toEqual([]);
    // A UUID is not a server reference: it must be a live local project.
    await expect(
      repo.createTicket({ projectId: "00000000-0000-4000-8000-0000000000ff", title: "Orphan" }),
    ).rejects.toMatchObject({ code: "project_not_found" });
  });

  it("takes a decimal parent as a server task id and still requires a local parent to exist", async () => {
    const { repo } = harness();
    const project = await repo.createProject({ name: "Board" });
    const child = await repo.createTicket({ projectId: project.id, title: "Child", parentTicketId: "42" });
    expect(child.payload.parentTicketId).toBe("42");
    await expect(
      repo.createTicket({ projectId: project.id, title: "Lost", parentTicketId: "00000000-0000-4000-8000-0000000000ee" }),
    ).rejects.toMatchObject({ code: "ticket_not_found" });
  });

  it("updates an already-imported ticket against the server's version and keeps one pending update", async () => {
    const store = createMemoryLocalFirstStore();
    const bound = { kind: "bound", accountId: "acct-1", tenantId: "tenant-a" } as const;
    const repo = createLocalWorkRepository({ store, deviceId: "device-1", destination: bound });
    const project = await repo.createProject({ name: "Board" });
    const ticket = await repo.createTicket({ projectId: project.id, title: "Original" });
    // The sync receipt: the server imported the ticket and holds version 5 of it.
    await store.transact(async (tx) => {
      await tx.acknowledge((await tx.pending()).map((event) => event.eventId));
      await tx.putMapping({ destination: bound, entityType: "ticket", clientEntityId: ticket.id, serverId: "77", serverVersion: 5 });
    });

    await repo.updateTicket(ticket.id, { title: "First edit" });
    await repo.changeTicketStatus(ticket.id, "done");
    const pending = (await store.read((tx) => tx.pending())).filter((event) => event.clientEntityId === ticket.id);
    // Both edits are based on what the server holds, and only the newest is still pending.
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ operation: "update", baseVersion: 5 });
    expect(pending[0]?.payload).toMatchObject({ title: "First edit", status: "done" });
  });

  it("persists taskType and the creating chat, and an old record without them still reads", async () => {
    const { repo } = harness();
    const project = await repo.createProject({ name: "Board" });
    const epic = await repo.createTicket({
      projectId: project.id,
      title: "Program",
      taskType: "epic",
      chatClientId: "11111111-1111-4111-8111-111111111111",
    });
    expect(epic.payload).toMatchObject({ taskType: "epic", chatClientId: "11111111-1111-4111-8111-111111111111" });
    const plain = await repo.createTicket({ projectId: project.id, title: "Plain" });
    expect(plain.payload).not.toHaveProperty("taskType");
    expect(plain.payload).not.toHaveProperty("chatClientId");
    expect((await repo.getTicket(plain.id)).payload.title).toBe("Plain");
  });

  it("persists a taskType patch on update", async () => {
    const { repo } = harness();
    const project = await repo.createProject({ name: "Board" });
    const ticket = await repo.createTicket({ projectId: project.id, title: "Grows up" });
    const updated = await repo.updateTicket(ticket.id, { taskType: "epic" });
    expect(updated.payload.taskType).toBe("epic");
    expect((await repo.getTicket(ticket.id)).payload.taskType).toBe("epic");
  });

  describe("a row bound by the sync pass whose import has not been received yet", () => {
    const boundTo = { kind: "bound", accountId: "acct-1", tenantId: "tenant-a" } as const;
    const CHAT = "22222222-2222-4222-8222-222222222222";

    async function boundHarness() {
      const { store, repo } = harness();
      const project = await repo.createProject({ name: "Board" });
      const ticket = await repo.createTicket({ projectId: project.id, title: "Original", chatClientId: CHAT });
      await bindWorkForSync(store, "device-1", boundTo);
      return { store, repo, project, ticket };
    }
    const pendingFor = async (store: ReturnType<typeof harness>["store"], id: string) =>
      (await store.read((tx) => tx.pending())).filter((event) => event.clientEntityId === id);

    it("REPLACES the pending import with the newest state instead of appending a local-baseVersion update", async () => {
      const { store, repo, project, ticket } = await boundHarness();
      await repo.updateTicket(ticket.id, { title: "Edited in the window" });
      await repo.changeTicketStatus(ticket.id, "done");
      const pending = await pendingFor(store, ticket.id);
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({ operation: "import", idempotencyKey: importKey("ticket", ticket.id) });
      expect(pending[0]?.payload).toMatchObject({ title: "Edited in the window", status: "done" });
      // It keeps the waits the bind gave it: the chat and the project.
      expect(pending[0]?.dependsOn).toEqual([importKey("chat", CHAT), importKey("project", project.id)]);
    });

    it("sends nothing for a ticket deleted before the server ever saw it", async () => {
      const { store, repo, ticket } = await boundHarness();
      await repo.deleteTicket(ticket.id);
      expect(await pendingFor(store, ticket.id)).toEqual([]);
    });

    it("makes a ticket created now wait on the project's and the chat's CURRENT pending event (the import)", async () => {
      const { store, repo, project } = await boundHarness();
      await store.transact(async (tx) => {
        const chat = newLocalRecord<unknown>({
          id: CHAT, entityType: "chat", payload: { clientId: CHAT }, deviceId: "device-1", destination: boundTo,
          occurredAt: "2026-11-07T00:00:00.000Z",
        });
        await tx.put(chat);
        await queueImport(tx, chat);
      });
      const child = await repo.createTicket({ projectId: project.id, title: "Created after bind", chatClientId: CHAT });
      const [event] = await pendingFor(store, child.id);
      expect(event?.operation).toBe("create");
      expect(event?.dependsOn).toEqual([importKey("project", project.id), importKey("chat", CHAT)]);
    });

    it("re-imports (never updates) a row whose import was held back or dead-lettered", async () => {
      const { store, repo, ticket } = await boundHarness();
      await store.transact(async (tx) => {
        const [held] = (await tx.pending()).filter((event) => event.clientEntityId === ticket.id);
        await tx.deadLetter(held!.eventId, "refused", "2026-11-07T00:00:00.000Z");
      });
      await repo.updateTicket(ticket.id, { title: "After the refusal" });
      const live = (await pendingFor(store, ticket.id)).filter((event) => !event.deadLetter);
      expect(live).toHaveLength(1);
      expect(live[0]).toMatchObject({ operation: "import" });
      expect(live[0]?.payload).toMatchObject({ title: "After the refusal" });
    });

    it("does not wait on a project or chat the server has already imported", async () => {
      const { store, repo, project, ticket } = await boundHarness();
      await store.transact(async (tx) => {
        await tx.acknowledge((await tx.pending()).map((event) => event.eventId));
        await tx.putMapping({ destination: boundTo, entityType: "project", clientEntityId: project.id, serverId: "5", serverVersion: 2 });
      });
      const child = await repo.createTicket({ projectId: project.id, title: "After import" });
      const [event] = await pendingFor(store, child.id);
      expect(event?.dependsOn).toEqual([]);
      expect(ticket.id).not.toBe(child.id);
    });
  });

  describe("a ticket created in a local chat is linked locally, in the same commit", () => {
    const boundTo = { kind: "bound", accountId: "acct-1", tenantId: "tenant-a" } as const;
    const CHAT = "33333333-3333-4333-8333-333333333333";

    /** A chat row the way the chat store writes it; bound chats get their import queued. */
    async function putChat(store: LocalFirstStore, destination: EntityDestination): Promise<void> {
      await store.transact(async (tx) => {
        const chat = newLocalRecord<unknown>({
          id: CHAT, entityType: "chat", payload: { clientId: CHAT, chat: { id: 4, title: "Planning" } },
          deviceId: "device-1", destination, occurredAt: "2026-11-07T00:00:00.000Z",
        });
        await tx.put(chat);
        if (destination.kind === "bound") await queueImport(tx, chat);
      });
    }

    /** Push everything pending, ONE event per push, so the order of the pushes is the dependency order. */
    async function pushAll(store: LocalFirstStore, destination: EntityDestination): Promise<SyncPushBatch["events"]> {
      const pushed: SyncPushBatch["events"] = [];
      const policy = createPlatformPolicy();
      policy.set({ synchronize: true });
      const coordinator = createSyncCoordinator({
        store,
        policy,
        deviceId: "device-1",
        maxEvents: 1,
        lease: { run: (_owner, work) => work() },
        transport: {
          async push(batch) {
            pushed.push(...batch.events);
            return batch.events.map((event) => ({ eventId: event.eventId, status: "accepted" as const, receivedAt: "2026-11-08T00:00:00.000Z" }));
          },
          async pull() {
            return { records: [] };
          },
        },
      });
      for (let pass = 0; pass < 10; pass += 1) {
        const before = pushed.length;
        await coordinator.synchronize(destination);
        if (pushed.length === before) break;
      }
      return pushed;
    }

    it("regression: a ticket-create in a live local chat writes its 'created' chat-ticket-link in the ticket's transaction", async () => {
      const { store, repo } = harness();
      await putChat(store, UNBOUND_DESTINATION);
      const project = await repo.createProject({ name: "Board" });
      const ticket = await repo.createTicket({ projectId: project.id, title: "From the chat", chatClientId: CHAT });

      const records = (await store.export()).records;
      const link = records.find((row) => row.entityType === "chat-ticket-link");
      expect(link?.id).toBe(chatTicketLinkId(CHAT, ticket.id));
      expect(link?.payload).toMatchObject({ chatClientId: CHAT, ticketClientId: ticket.id, linkType: "created" });
      expect(link?.provenance).toMatchObject({ deviceId: "device-1", source: "local" });
      expect(ticket.payload.chatClientId).toBe(CHAT);

      // ONE commit: when the link write fails, the ticket is not kept either.
      const refuseLinkPut = <T extends object>(tx: T): T => new Proxy(tx, {
        get(target, key) {
          const value = Reflect.get(target, key) as unknown;
          if (key !== "put" || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
          return async (record: { entityType: string }, ...rest: unknown[]) => {
            if (record.entityType === "chat-ticket-link") throw new Error("link write failed");
            return value.call(target, record, ...rest);
          };
        },
      });
      const failing = new Proxy(store, {
        get(target, key) {
          if (key === "transact") return ((work) => store.transact((tx) => work(refuseLinkPut(tx)))) as LocalFirstStore["transact"];
          const value = Reflect.get(target, key) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const failingRepo = createLocalWorkRepository({ store: failing, deviceId: "device-1", newId: () => "44444444-4444-4444-8444-444444444444" });
      await expect(failingRepo.createTicket({ projectId: project.id, title: "Torn", chatClientId: CHAT })).rejects.toThrow(/link write failed/);
      const after = (await store.export()).records;
      expect(after.some((row) => row.id === "44444444-4444-4444-8444-444444444444")).toBe(false);
      expect(after.filter((row) => row.entityType === "chat-ticket-link")).toHaveLength(1);
    });

    it("regression: a chatClientId naming no local chat creates the ticket, no link, and keeps chatClientId for the server", async () => {
      const { store, repo } = harness();
      const project = await repo.createProject({ name: "Board" });
      const ticket = await repo.createTicket({ projectId: project.id, title: "Server chat", chatClientId: CHAT });
      expect(ticket.payload.chatClientId).toBe(CHAT);
      const records = (await store.export()).records;
      expect(records.some((row) => row.entityType === "ticket" && row.id === ticket.id)).toBe(true);
      expect(records.some((row) => row.entityType === "chat-ticket-link")).toBe(false);
    });

    it("regression: a tombstoned local chat gets no link", async () => {
      const { store, repo } = harness();
      await putChat(store, UNBOUND_DESTINATION);
      await store.transact(async (tx) => {
        const chat = await tx.get("chat", CHAT);
        await tx.put({ ...chat!, version: chat!.version + 1, deletedAt: "2026-11-07T01:00:00.000Z" }, chat!.version);
      });
      const project = await repo.createProject({ name: "Board" });
      await repo.createTicket({ projectId: project.id, title: "Deleted chat", chatClientId: CHAT });
      expect((await store.export()).records.some((row) => row.entityType === "chat-ticket-link")).toBe(false);
    });

    it("regression: the chat rail lists the new ticket as linked before any sync", async () => {
      const { store, repo } = harness();
      await putChat(store, UNBOUND_DESTINATION);
      const project = await repo.createProject({ name: "Board" });
      const ticket = await repo.createTicket({ projectId: project.id, title: "Shows at once", chatClientId: CHAT });
      const rail = readRailFromFacts(await store.export(), CHAT);
      expect(rail.found).toBe(true);
      expect(rail.tickets.map((row) => ({ clientId: row.clientId, linkType: row.linkType, label: row.label }))).toEqual([
        { clientId: ticket.id, linkType: "created", label: "Shows at once" },
      ]);
      expect(rail.links).toEqual([expect.objectContaining({ clientId: chatTicketLinkId(CHAT, ticket.id), ticketClientId: ticket.id })]);
    });

    it("regression: BOUND — the link is pushed after the ticket's plain create and the chat's import", async () => {
      const { store, repo } = harness();
      const project = await repo.createProject({ name: "Board" });
      await bindWorkForSync(store, "device-1", boundTo);
      await putChat(store, boundTo);
      const ticket = await repo.createTicket({ projectId: project.id, title: "Bound", chatClientId: CHAT });
      const linkId = chatTicketLinkId(CHAT, ticket.id);

      const pending = await store.read((tx) => tx.pending());
      // The ticket journals a plain CREATE, not an import; the link waits on `ticket:<id>:import`.
      expect(pending.find((event) => event.clientEntityId === ticket.id)).toMatchObject({
        operation: "create",
        idempotencyKey: `ticket:${ticket.id}:v1`,
      });
      expect(pending.find((event) => event.clientEntityId === linkId)).toMatchObject({
        operation: "import",
        dependsOn: [importKey("chat", CHAT), importKey("ticket", ticket.id)],
      });

      const pushed = await pushAll(store, boundTo);
      const order = pushed.map((event) => event.clientEntityId);
      expect(order).toHaveLength(4);
      expect(order.indexOf(linkId)).toBeGreaterThan(order.indexOf(ticket.id));
      expect(order.indexOf(linkId)).toBeGreaterThan(order.indexOf(CHAT));
    });

    it("regression: BOUND — on the wire the link depends on the ticket's create and the chat's import event ids", async () => {
      const { store, repo } = harness();
      const project = await repo.createProject({ name: "Board" });
      await bindWorkForSync(store, "device-1", boundTo);
      await putChat(store, boundTo);
      const ticket = await repo.createTicket({ projectId: project.id, title: "Bound", chatClientId: CHAT });
      const linkId = chatTicketLinkId(CHAT, ticket.id);
      const pending = await store.read((tx) => tx.pending());
      const ticketCreate = pending.find((event) => event.clientEntityId === ticket.id)!;
      const chatImport = pending.find((event) => event.clientEntityId === CHAT)!;

      // One batch holding all four: the wire form of the link names both parents' real event ids
      // (the `ticket:<id>:import` key resolves to the ticket's plain create), so the server
      // applies the link after them even within a batch.
      const wire: SyncPushBatch["events"] = [];
      const policy = createPlatformPolicy();
      policy.set({ synchronize: true });
      await createSyncCoordinator({
        store, policy, deviceId: "device-1",
        lease: { run: (_owner, work) => work() },
        transport: {
          async push(batch) {
            wire.push(...batch.events);
            return batch.events.map((event) => ({ eventId: event.eventId, status: "accepted" as const, receivedAt: "2026-11-08T00:00:00.000Z" }));
          },
          async pull() {
            return { records: [] };
          },
        },
      }).synchronize(boundTo);
      const link = wire.find((event) => event.clientEntityId === linkId);
      expect(link?.dependsOn).toEqual(expect.arrayContaining([ticketCreate.eventId, chatImport.eventId]));
      expect(wire.findIndex((event) => event.clientEntityId === linkId)).toBeGreaterThan(wire.findIndex((event) => event.clientEntityId === ticket.id));
    });

    it("regression: UNBOUND — after the bind pass the link's import is pushed after the ticket's and the chat's imports", async () => {
      const { store, repo } = harness();
      await putChat(store, UNBOUND_DESTINATION);
      const project = await repo.createProject({ name: "Board" });
      const ticket = await repo.createTicket({ projectId: project.id, title: "Offline", chatClientId: CHAT });
      const linkId = chatTicketLinkId(CHAT, ticket.id);
      expect((await store.read((tx) => tx.get("chat-ticket-link", linkId)))?.destination).toEqual(UNBOUND_DESTINATION);

      // The bind: the chat history pass (`bindChatHistoryForSync`) re-imports the chat, then the work pass.
      await store.transact(async (tx) => {
        const chat = await tx.get("chat", CHAT);
        const moved = { ...chat!, destination: boundTo };
        await tx.put(moved);
        await queueImport(tx, moved);
      });
      await bindWorkForSync(store, "device-1", boundTo);

      const pushed = await pushAll(store, boundTo);
      const order = pushed.map((event) => event.clientEntityId);
      expect(order).toContain(linkId);
      expect(order.indexOf(linkId)).toBeGreaterThan(order.indexOf(ticket.id));
      expect(order.indexOf(linkId)).toBeGreaterThan(order.indexOf(CHAT));
      expect(pushed.find((event) => event.clientEntityId === linkId)?.operation).toBe("import");
    });
  });
});
