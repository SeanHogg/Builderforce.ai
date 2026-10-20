import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createMemoryLocalFirstStore, UNBOUND_DESTINATION } from "@builderforce/local-first";
import {
  createLocalWorkRepository,
  creationDestination,
  isSignedInTenantLure,
  LocalWorkRepositoryError,
} from "./localWorkRepository";

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
    const source = readFileSync(new URL("./localWorkRepository.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["']\.\/bfApi["']/);
    expect(source).not.toMatch(/from\s+["']vscode["']/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
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
      const projectEvent = exported.events.find((event) => event.idempotencyKey === `project:${project.id}:v1`);
      expect(create).toMatchObject({
        operation: "create",
        dependsOn: [projectEvent?.eventId],
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
});
