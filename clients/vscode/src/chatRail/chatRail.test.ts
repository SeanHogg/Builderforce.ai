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
import { touchesRail, watchRail } from "./railWatch";
import { watchRailFor } from "./railWebviewWatch";

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

  it("a body without a tickets array is a failed read: nothing is ingested, no link is tombstoned", async () => {
    const store = await seededStore();
    await refreshRail(store, platform({ tickets: [ticket(1)], runs: [] }), SERVER_CHAT);
    const before = await snapshotOf(store);
    for (const body of [{}, { tickets: null }, { tickets: "nope" }]) {
      const get = (async (path: string) => (path.endsWith("/tickets") ? body : { runs: [] })) as never;
      const outcome = await refreshRail(store, { ...platform({ tickets: [], runs: [] }), get }, SERVER_CHAT);
      expect(outcome.status).toBe("error");
    }
    const noRuns = (async (path: string) => (path.endsWith("/tickets") ? { tickets: [] } : {})) as never;
    expect((await refreshRail(store, { ...platform({ tickets: [], runs: [] }), get: noRuns }, SERVER_CHAT)).status).toBe("error");
    expect(await snapshotOf(store)).toBe(before);
  });

  it("one refresh is ONE store transaction: tickets, runs and links commit together", async () => {
    const store = await seededStore();
    let commits = 0;
    store.subscribe(() => { commits += 1; });
    await refreshRail(store, platform({ tickets: [ticket(1), ticket(2)], runs: [run(9)] }), SERVER_CHAT);
    expect(commits).toBe(1);
    const records = (await store.export()).records;
    expect(records.filter((r) => r.entityType === "chat-ticket-link" && !r.deletedAt)).toHaveLength(2);
  });

  it("a rail refresh keeps a locally authored ticket's own fields (it owns only title, status and progress)", async () => {
    const store = await seededStore();
    const LOCAL = "00000000-0000-4000-8000-0000000000d1";
    await store.transact(async (tx) => {
      await tx.put(newLocalRecord({
        id: LOCAL, entityType: "ticket", deviceId: "device-1", destination: DEST,
        payload: { projectId: "00000000-0000-4000-8000-0000000000e1", title: "Mine", description: "Written here", status: "todo", archived: true, chatClientId: CHAT },
      }));
      // The device's ticket reached the platform as task 1: its mapping names it.
      await tx.putMapping({ destination: DEST, entityType: "ticket", clientEntityId: LOCAL, serverId: "1", serverVersion: 1 });
    });
    await refreshRail(store, platform({ tickets: [ticket(1, { label: "Renamed on the platform", status: "done", progressPct: 100 })], runs: [] }), SERVER_CHAT);
    const merged = (await store.export()).records.find((r) => r.id === LOCAL)!.payload as Record<string, unknown>;
    expect(merged).toMatchObject({
      projectId: "00000000-0000-4000-8000-0000000000e1", description: "Written here", archived: true, chatClientId: CHAT,
      title: "Renamed on the platform", status: "done", progressPct: 100,
    });
  });

  it("a link to a tier with no numeric id carries its kind and ref for the importer", async () => {
    const store = await seededStore();
    await refreshRail(store, platform({ tickets: [ticket(1, { kind: "spec", ref: "abc-uuid" })], runs: [] }), SERVER_CHAT);
    const link = (await store.export()).records.find((r) => r.entityType === "chat-ticket-link")!;
    expect(link.payload).toMatchObject({ ticketKind: "spec", ticketRef: "abc-uuid", linkType: "linked" });
  });
});

const railChange = (types: string[], extra: { events?: boolean; syncState?: boolean; ids?: string[] } = {}) => ({
  records: new Map(types.map((type) => [type, new Set(extra.ids ?? ["x"])])) as never,
  events: extra.events ?? false,
  syncState: extra.syncState ?? false,
});

describe("touchesRail", () => {
  const scope = { ticketIds: new Set(["t1"]), runIds: new Set(["r1"]) };
  it("reposts at once for links, tickets and runs, never for the queue or the sync state alone", () => {
    expect(touchesRail(railChange(["chat-ticket-link"]))).toBe(true);
    expect(touchesRail(railChange(["ticket"]))).toBe(true);
    expect(touchesRail(railChange(["execution"]))).toBe(true);
    expect(touchesRail(railChange(["message", "chat"], { events: true, syncState: true }))).toBe(false);
    expect(touchesRail(undefined)).toBe(true);
  });

  it("a run reposts only when the last posted rail shows it (its run or ticket ids), or any link changed", () => {
    expect(touchesRail(railChange(["execution"], { ids: ["r1"] }), scope)).toBe(true);
    expect(touchesRail(railChange(["execution"], { ids: ["t1"] }), scope)).toBe(true);
    // Another chat's (or no chat's) local run checkpoint.
    expect(touchesRail(railChange(["execution"], { ids: ["r9"] }), scope)).toBe(false);
    expect(touchesRail(railChange(["execution", "chat-ticket-link"], { ids: ["r9"] }), scope)).toBe(true);
    // Before the first post nothing is known: any run counts.
    expect(touchesRail(railChange(["execution"], { ids: ["r9"] }), undefined)).toBe(true);
  });
});

describe("watchRail", () => {
  function harness(scope?: () => { ticketIds: Set<string>; runIds: Set<string> } | undefined) {
    let listener: ((change?: unknown) => void) | undefined;
    const store = { subscribe: (fn: (change?: unknown) => void) => { listener = fn; return () => { listener = undefined; }; } };
    const repost = vi.fn();
    const stop = watchRail(store as never, repost, { debounceMs: 100, syncDebounceMs: 1_000, ...(scope ? { scope } : {}) });
    return { emit: (change: unknown) => listener?.(change), repost, stop };
  }

  it("reposts once per sync pass, after a 1 s trailing quiet period, and never for the queue alone", () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.emit(railChange(["message"], { events: true }));
      vi.advanceTimersByTime(2_000);
      expect(h.repost).not.toHaveBeenCalled();
      // One sync pass: many commits, each moving receipts / mappings.
      for (let i = 0; i < 5; i += 1) {
        h.emit(railChange([], { events: true, syncState: true }));
        vi.advanceTimersByTime(300);
      }
      expect(h.repost).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1_000);
      expect(h.repost).toHaveBeenCalledTimes(1);
      h.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("an immediate repost folds in a waiting sync repost", () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.emit(railChange([], { syncState: true }));
      h.emit(railChange(["ticket"]));
      vi.advanceTimersByTime(2_000);
      expect(h.repost).toHaveBeenCalledTimes(1);
      h.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a run checkpoint outside the posted rail does not repost; one it shows does", () => {
    vi.useFakeTimers();
    try {
      const h = harness(() => ({ ticketIds: new Set(["t1"]), runIds: new Set(["r1"]) }));
      h.emit(railChange(["execution"], { ids: ["r9"] }));
      vi.advanceTimersByTime(500);
      expect(h.repost).not.toHaveBeenCalled();
      h.emit(railChange(["execution"], { ids: ["r1"] }));
      vi.advanceTimersByTime(500);
      expect(h.repost).toHaveBeenCalledTimes(1);
      h.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("watchRailFor", () => {
  function harness() {
    const stops: string[] = [];
    const disposers: Array<() => void> = [];
    const source = { watch: vi.fn((ref: string | number) => () => { stops.push(String(ref)); }) };
    const webview = { postMessage: vi.fn() };
    const owner = { onDidDispose: vi.fn((listener: () => void) => { disposers.push(listener); }) };
    return { stops, disposers, source, webview, owner };
  }
  it("holds one watch per webview: a chat switch releases the previous one, dispose the last", () => {
    const h = harness();
    watchRailFor(h.source, h.webview, h.owner, 7);
    watchRailFor(h.source, h.webview, h.owner, 7);
    expect(h.source.watch).toHaveBeenCalledTimes(1);
    watchRailFor(h.source, h.webview, h.owner, CHAT);
    expect(h.stops).toEqual(["7"]);
    expect(h.owner.onDidDispose).toHaveBeenCalledTimes(1);
    h.disposers[0]!();
    expect(h.stops).toEqual(["7", CHAT]);
    watchRailFor(h.source, h.webview, h.owner, 8);
    expect(h.source.watch).toHaveBeenCalledTimes(2);
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

  it("freshness: a bound chat never read is not 'only on this device', and the read time survives a new service", async () => {
    const store = await seededStore();
    expect((await service(store, false).read(SERVER_CHAT)).freshness).toEqual({ source: "server-observed" });
    await service(store, true, { tickets: [], runs: [] }).refresh(SERVER_CHAT);
    // A refresh that listed nothing still counts as a read, and a fresh service (a reload) reads it from the store.
    expect((await service(store, false).read(SERVER_CHAT)).freshness).toEqual({ lastIngestedAt: "2026-11-08T12:00:00.000Z", source: "server-observed" });
  });

  it("a chat only on this device has a rail: it links by its client id, with no server chat and no bind", async () => {
    const store = createMemoryLocalFirstStore();
    const LOCAL_CHAT = "00000000-0000-4000-8000-0000000000c9";
    await store.transact(async (tx) => {
      await tx.put(newLocalRecord({
        id: LOCAL_CHAT, entityType: "chat", deviceId: "device-1", destination: { kind: "unbound" },
        payload: { clientId: LOCAL_CHAT, chat: { id: 3, title: "Local" } },
      }));
    });
    const local = service(store, false);
    expect(await local.link(LOCAL_CHAT, { kind: "task", ref: "55" }, "linked")).toEqual({ ok: true });
    const rail = await local.read(LOCAL_CHAT);
    expect(rail.found).toBe(true);
    expect(rail.tickets).toHaveLength(1);
    expect(rail.tickets[0]).toMatchObject({ kind: "task", ref: "55", label: "" });
    expect(rail.freshness).toEqual({ source: "device" });
  });

  it("refuses a link for a chat the store does not hold", async () => {
    const store = await seededStore();
    expect(await service(store, false).link(404, { kind: "task", ref: "1" }, "linked")).toEqual({ ok: false, error: "chat_not_found" });
  });
});
