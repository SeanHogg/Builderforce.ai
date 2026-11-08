import { describe, expect, it, vi } from "vitest";
import {
  createMemoryLocalFirstStore,
  newLocalRecord,
  type EntityDestination,
  type LocalFirstStore,
} from "@builderforce/local-first";
import { buildSyncSummary } from "../sync/syncSummary";
import { refreshRail } from "./refreshRail";
import { createChatRailService } from "./railService";

const DEST: EntityDestination = { kind: "bound", platformInstance: "https://api.example", tenantId: "tenant-1" };
const CHAT = "00000000-0000-4000-8000-0000000000c1";
const SERVER_CHAT = 7;
const NOW = () => new Date("2026-11-08T12:00:00.000Z");

const ticket = (n: number, extra: object = {}) => ({
  linkId: 100 + n, kind: "task", ref: String(n), label: `Ticket ${n}`, status: "in_progress",
  progressPct: 40, done: 2, total: 5, exists: true, linkType: "linked", ...extra,
});
const run = (n: number) => ({
  executionId: n, taskId: 1, taskTitle: "Ticket 1", agentRef: "a1", agentName: "Coder", status: "completed",
  submittedBy: "user:1", source: "chat", executor: "container", hostId: null, hostName: null, produced: true,
  errorMessage: null, startedAt: "2026-11-08T10:00:00.000Z", completedAt: "2026-11-08T10:05:00.000Z", createdAt: "2026-11-08T10:00:00.000Z",
});

async function seededStore(): Promise<LocalFirstStore> {
  const store = createMemoryLocalFirstStore();
  await store.transact(async (tx) => {
    await tx.put(newLocalRecord({
      id: CHAT, entityType: "chat", deviceId: "device-1", destination: DEST,
      payload: { clientId: CHAT, chat: { id: 1, title: "A chat" } },
    }));
    await tx.putMapping({ destination: DEST, entityType: "chat", clientEntityId: CHAT, serverId: String(SERVER_CHAT), serverVersion: 1 });
  });
  return store;
}

/** A platform whose tickets and runs answers are the ones given; `fail` makes every read reject. */
function platform(answers: { tickets: unknown[]; runs: unknown[] }, options: { fail?: boolean; allowed?: boolean } = {}) {
  const get = vi.fn(async (path: string) => {
    if (options.fail) throw new Error("502");
    return path.endsWith("/tickets") ? { tickets: answers.tickets } : { runs: answers.runs };
  });
  return { get: get as never, platformAllowed: () => options.allowed ?? true, now: NOW, calls: get };
}

const snapshotOf = async (store: LocalFirstStore) => JSON.stringify(await store.export());

describe("refreshRail", () => {
  it("is idempotent: ingesting the same reads twice writes nothing the second time", async () => {
    const store = await seededStore();
    const ports = platform({ tickets: [ticket(1), ticket(2)], runs: [run(9)] });
    const first = await refreshRail(store, ports, SERVER_CHAT);
    expect(first.status).toBe("ok");
    const afterFirst = await snapshotOf(store);
    const second = await refreshRail(store, ports, SERVER_CHAT);
    expect(second).toEqual({ status: "ok", written: 0, tombstoned: 0 });
    expect(await snapshotOf(store)).toBe(afterFirst);
  });

  it("a failed read ingests nothing and the last copy stays", async () => {
    const store = await seededStore();
    await refreshRail(store, platform({ tickets: [ticket(1)], runs: [] }), SERVER_CHAT);
    const before = await snapshotOf(store);
    const failed = await refreshRail(store, platform({ tickets: [], runs: [] }, { fail: true }), SERVER_CHAT);
    expect(failed.status).toBe("error");
    expect(await snapshotOf(store)).toBe(before);
  });

  it("an empty answer is a failure, never an empty list that tombstones every link", async () => {
    const store = await seededStore();
    await refreshRail(store, platform({ tickets: [ticket(1)], runs: [] }), SERVER_CHAT);
    const before = await snapshotOf(store);
    const ports = { ...platform({ tickets: [], runs: [] }), get: (async () => undefined) as never };
    expect((await refreshRail(store, ports, SERVER_CHAT)).status).toBe("error");
    expect(await snapshotOf(store)).toBe(before);
  });

  it("does not touch the platform when it is not allowed", async () => {
    const store = await seededStore();
    const ports = platform({ tickets: [ticket(1)], runs: [] }, { allowed: false });
    expect(await refreshRail(store, ports, SERVER_CHAT)).toEqual({ status: "skipped" });
    expect(ports.calls).not.toHaveBeenCalled();
  });

  it("tombstones a link the platform no longer lists", async () => {
    const store = await seededStore();
    await refreshRail(store, platform({ tickets: [ticket(1), ticket(2)], runs: [] }), SERVER_CHAT);
    const again = await refreshRail(store, platform({ tickets: [ticket(1)], runs: [] }), SERVER_CHAT);
    expect(again).toMatchObject({ status: "ok", tombstoned: 1 });
  });
});

function service(store: LocalFirstStore, allowed: boolean, answers = { tickets: [] as unknown[], runs: [] as unknown[] }) {
  const ports = platform(answers, { allowed });
  return createChatRailService({
    store,
    deviceId: "device-1",
    facts: () => store.export(),
    summary: async () => buildSyncSummary(await store.export(), { mode: "local-only", destination: DEST }),
    platform: ports,
  });
}

describe("chat rail service", () => {
  it("imported records present as synced, with link types, runs and freshness", async () => {
    const store = await seededStore();
    const live = service(store, true, { tickets: [ticket(1, { linkType: "created" })], runs: [run(9)] });
    const { rail } = await live.refresh(SERVER_CHAT);
    expect(rail.tickets).toHaveLength(1);
    expect(rail.tickets[0]).toMatchObject({ kind: "task", ref: "1", label: "Ticket 1", linkType: "created", linkId: 101, syncStatus: "synced" });
    expect(rail.links[0]).toMatchObject({ linkType: "created", syncStatus: "synced" });
    expect(rail.runHistory.runs.map((r) => r.executionId)).toEqual([9]);
    expect(rail.runHistory.executors).toEqual(["container"]);
    expect(rail.freshness).toEqual({ lastIngestedAt: "2026-11-08T12:00:00.000Z", source: "server-observed" });
  });

  it("readRail answers from the store with no platform at all", async () => {
    const store = await seededStore();
    await refreshRail(store, platform({ tickets: [ticket(1), ticket(2)], runs: [run(9)] }), SERVER_CHAT);
    const offline = service(store, false);
    const rail = await offline.read(SERVER_CHAT);
    expect(rail.found).toBe(true);
    expect(rail.tickets.map((t) => t.label).sort()).toEqual(["Ticket 1", "Ticket 2"]);
    expect(rail.runHistory.runs).toHaveLength(1);
    expect(rail.freshness.source).toBe("server-observed");
    expect((await offline.read(404)).found).toBe(false);
  });

  it("link and unlink write local chat-ticket-link records", async () => {
    const store = await seededStore();
    const local = service(store, false);
    // A work item the device has not seen lands as a minimal ticket, then the link is a LOCAL write.
    expect(await local.link(SERVER_CHAT, { kind: "task", ref: "55" }, "linked")).toEqual({ ok: true });
    let rail = await local.read(SERVER_CHAT);
    expect(rail.links).toHaveLength(1);
    expect(rail.links[0]).toMatchObject({ linkType: "linked", syncStatus: "syncing" });
    const links = (await store.export()).records.filter((r) => r.entityType === "chat-ticket-link");
    expect(links[0]!.provenance).toMatchObject({ source: "local", deviceId: "device-1" });
    expect((await store.export()).events.some((e) => e.entityType === "chat-ticket-link")).toBe(true);

    expect(await local.unlink(SERVER_CHAT, { kind: "task", ref: "55" })).toEqual({ ok: true });
    rail = await local.read(SERVER_CHAT);
    expect(rail.links).toHaveLength(0);
    const gone = (await store.export()).records.find((r) => r.entityType === "chat-ticket-link");
    expect(gone?.deletedAt).toBeTruthy();
  });

  it("refuses a link for a chat the store does not hold", async () => {
    const store = await seededStore();
    expect(await service(store, false).link(404, { kind: "task", ref: "1" }, "linked")).toEqual({ ok: false, error: "chat_not_found" });
  });
});
