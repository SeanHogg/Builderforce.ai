import { describe, expect, it } from "vitest";
import { createMemoryLocalFirstStore } from "@builderforce/local-first";
import { createLocalWorkRepository } from "../localWorkRepository";
import { boundChatOf, createLocalWorkModel } from "./localWorkModel";

function harness() {
  const store = createMemoryLocalFirstStore();
  let ids = 0;
  const repo = createLocalWorkRepository({
    store,
    deviceId: "device-1",
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
  });
  const model = createLocalWorkModel({ repo, facts: () => store.export() });
  return { store, repo, model };
}

describe("local work tree model (platform denied: nothing here reaches a network)", () => {
  it("lists projects, and each project's tickets with their presented sync status", async () => {
    const { repo, model } = harness();
    const project = await repo.createProject({ name: "Alpha" });
    await repo.createTicket({ projectId: project.id, title: "First", status: "todo" });
    await repo.createTicket({ projectId: project.id, title: "Second" });

    const roots = await model.roots();
    expect(roots.map((n) => [n.kind, n.label])).toEqual([["project", "Alpha"]]);
    const tickets = await model.children(roots[0]!);
    expect(tickets.map((n) => n.label).sort()).toEqual(["First", "Second"]);
    expect(tickets.find((n) => n.label === "First")).toMatchObject({ kind: "ticket", workStatus: "todo" });
    // Written on this device, never sent: it has a queued event, so it is syncing, not synced.
    for (const ticket of tickets) expect(ticket.sync).toBe("syncing");
  });

  it("hides archived tickets and puts tickets of an unknown project under one unfiled node", async () => {
    const { store, repo, model } = harness();
    const project = await repo.createProject({ name: "Alpha" });
    const keep = await repo.createTicket({ projectId: project.id, title: "Keep" });
    const gone = await repo.createTicket({ projectId: project.id, title: "Gone" });
    await repo.setTicketArchived(gone.id, true);
    // A platform ticket the rail ingested: no local project.
    await store.transact(async (tx) => {
      const base = (await tx.get("ticket", keep.id))!;
      await tx.put({ ...base, id: "00000000-0000-4000-8000-0000000000f1", payload: { ...(base.payload as object), projectId: "", title: "From platform" } });
    });

    const roots = await model.roots();
    expect(roots.map((n) => n.kind)).toEqual(["project", "unfiled"]);
    expect((await model.children(roots[0]!)).map((n) => n.label)).toEqual(["Keep"]);
    expect((await model.children(roots[1]!)).map((n) => n.label)).toEqual(["From platform"]);
  });

  it("an empty store lists nothing", async () => {
    expect(await harness().model.roots()).toEqual([]);
  });
});

describe("boundChatOf", () => {
  it("finds the chat a ticket was created in, by its local view key", async () => {
    const { store, repo } = harness();
    const project = await repo.createProject({ name: "Alpha" });
    await store.transact(async (tx) => {
      await tx.put({
        id: "chat-1", entityType: "chat", schemaVersion: 1, version: 1, destination: { kind: "unbound" },
        occurredAt: "2026-11-08T00:00:00.000Z", updatedAt: "2026-11-08T00:00:00.000Z",
        payload: { clientId: "chat-1", chat: { id: 42 } },
      });
    });
    const ticket = await repo.createTicket({ projectId: project.id, title: "From chat", chatClientId: "chat-1" });
    const facts = await store.export();
    expect(boundChatOf(facts, ticket.id)).toEqual({ chatClientId: "chat-1", localChatId: 42 });
    expect(boundChatOf(facts, "nope")).toBeUndefined();
  });
});
