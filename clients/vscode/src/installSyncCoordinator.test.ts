import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryLocalFirstStore,
  createPlatformPolicy,
  type EntityDestination,
  type LocalFirstStore,
  type SyncTransport,
} from "@builderforce/local-first";
import {
  drainQueuedCreates,
  installSyncCoordinator,
  type SyncCoordinatorHost,
} from "./installSyncCoordinator";

const { createSyncCoordinator } = vi.hoisted(() => ({
  createSyncCoordinator: vi.fn(),
}));

vi.mock("@builderforce/local-first", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@builderforce/local-first")>();
  createSyncCoordinator.mockImplementation(actual.createSyncCoordinator);
  return { ...actual, createSyncCoordinator };
});

const DESTINATION: EntityDestination = {
  kind: "bound",
  tenantId: "tenant-1",
  projectId: "project-1",
};
const OTHER: EntityDestination = {
  kind: "bound",
  tenantId: "tenant-1",
  projectId: "project-2",
};

function openLease(): SyncCoordinatorHost["lease"] {
  return { async run(_owner, work) { return work(); } };
}

function recordingTransport(): {
  transport: SyncTransport;
  pushed: Array<Array<{ eventId: string; operation: string }>>;
  pulls: () => number;
} {
  const pushed: Array<Array<{ eventId: string; operation: string }>> = [];
  let pulls = 0;
  return {
    pushed,
    pulls: () => pulls,
    transport: {
      async push(batch) {
        pushed.push(batch.events.map((event) => ({ eventId: event.eventId, operation: event.operation })));
        return batch.events.map((event) => ({
          eventId: event.eventId,
          status: "accepted" as const,
          receivedAt: "2026-01-01T00:00:00.000Z",
        }));
      },
      async pull() {
        pulls += 1;
        return { records: [] };
      },
    },
  };
}

function host(overrides: Partial<SyncCoordinatorHost> = {}): SyncCoordinatorHost {
  return {
    synchronizeGranted: true,
    deviceId: "device-a",
    store: createMemoryLocalFirstStore(),
    transport: {
      async push() { return []; },
      async pull() { return { records: [] }; },
    },
    policy: createPlatformPolicy({ synchronize: true }),
    lease: openLease(),
    ...overrides,
  };
}

async function queue(
  store: LocalFirstStore,
  event: {
    eventId: string;
    operation: "create" | "update";
    destination: EntityDestination;
    deadLetter?: { reason: string; at: string };
  },
): Promise<void> {
  await store.transact((tx) => tx.append({
    eventId: event.eventId,
    clientEntityId: event.eventId,
    entityType: "project",
    operation: event.operation,
    schemaVersion: 1,
    occurredAt: "2026-01-01T00:00:00.000Z",
    dependsOn: [],
    destination: event.destination,
    payload: { name: "Offline project" },
    ...(event.deadLetter ? { deadLetter: event.deadLetter } : {}),
  }));
}

function exportSlice(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`missing ${signature}`);
  const next = source.indexOf("\nexport ", start + signature.length);
  return source.slice(start, next === -1 ? source.length : next);
}

beforeEach(() => {
  createSyncCoordinator.mockClear();
});

describe("installSyncCoordinator", () => {
  it("does not construct a coordinator when synchronize is not granted", () => {
    expect(installSyncCoordinator(host({ synchronizeGranted: false }))).toEqual({
      installed: false,
      reason: "synchronize_not_granted",
    });
    expect(createSyncCoordinator).not.toHaveBeenCalled();
  });

  it("treats a missing grant as not granted", () => {
    const { synchronizeGranted: _granted, ...input } = host();
    expect(installSyncCoordinator(input)).toEqual({
      installed: false,
      reason: "synchronize_not_granted",
    });
    expect(createSyncCoordinator).not.toHaveBeenCalled();
  });

  it("returns the coordinator and does not sync during install", async () => {
    const recorded = recordingTransport();
    const input = host({ transport: recorded.transport });
    const result = installSyncCoordinator(input);
    expect(result).toEqual({
      installed: true,
      started: true,
      coordinator: expect.any(Object),
    });
    expect(createSyncCoordinator).toHaveBeenCalledTimes(1);
    expect(recorded.pulls()).toBe(0);
    expect(recorded.pushed).toEqual([]);
    if (!result.installed || !result.started) throw new Error("coordinator was not started");
    const summary = await result.coordinator.synchronize(DESTINATION);
    expect(summary).toEqual({
      pushed: 0,
      pulled: 0,
      duplicates: 0,
      conflicts: 0,
      rejected: 0,
      dependencyPending: 0,
      bytes: 0,
      unboundRefused: 0,
    });
    expect(recorded.pulls()).toBe(1);
    expect(recorded.pushed).toEqual([]);
  });

  it("starts when this device already holds the lease, even past 30s", () => {
    const now = 1_700_000_030_000;
    const heldSince = 1_700_000_000_000;
    expect(installSyncCoordinator(host({ holder: "device-a", now, heldSince }))).toMatchObject({
      installed: true,
      started: true,
    });
    expect(createSyncCoordinator).toHaveBeenCalledTimes(1);
  });

  it("starts when no holder is recorded", () => {
    for (const holder of [undefined, null, ""] as const) {
      createSyncCoordinator.mockClear();
      expect(installSyncCoordinator(host({ holder }))).toMatchObject({ installed: true, started: true });
    }
  });

  it("does not start while another device holds the lease, including past 30s", () => {
    const heldSince = 1_700_000_000_000;
    for (const age of [0, 29_999, 30_000, 30_001, 3_600_000]) {
      createSyncCoordinator.mockClear();
      expect(installSyncCoordinator(host({
        holder: "device-b",
        now: heldSince + age,
        heldSince,
      }))).toEqual({
        installed: true,
        started: false,
        reason: "lease_busy",
      });
      expect(createSyncCoordinator).toHaveBeenCalledTimes(1);
    }
  });

  it("is not imported by extension activation and does not open the editor, IndexedDB, or the network", () => {
    const extension = readFileSync(fileURLToPath(new URL("./extension.ts", import.meta.url)), "utf8");
    expect(extension).not.toContain("installSyncCoordinator");
    expect(extension).not.toContain("drainQueuedCreates");
    const source = readFileSync(fileURLToPath(new URL("./installSyncCoordinator.ts", import.meta.url)), "utf8");
    expect(source).not.toContain('from "vscode"');
    expect(source).not.toMatch(/indexedDb|indexedDB/);
    expect(source).not.toContain("lockStolen");
    expect(source).not.toContain("leaseBusy");
    expect(source).not.toContain("durabilityContract");
    expect(source).not.toContain("packages/local-first");
    expect(source).not.toMatch(/from ["']\.\./);
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("node:fs");
    expect(source).not.toContain("30000");
    expect(source).not.toMatch(/now\s*-\s*heldSince/);
    const install = exportSlice(source, "export function installSyncCoordinator");
    expect(install).not.toContain(".synchronize(");
    const drain = exportSlice(source, "export async function drainQueuedCreates");
    expect(drain).toContain(".synchronize(");
  });
});

describe("drainQueuedCreates", () => {
  it("does not hand a queued create to synchronize when the grant is off", async () => {
    const store = createMemoryLocalFirstStore();
    await queue(store, { eventId: "evt-create", operation: "create", destination: DESTINATION });
    const recorded = recordingTransport();
    const result = await drainQueuedCreates(host({
      synchronizeGranted: false,
      store,
      transport: recorded.transport,
    }));
    expect(result).toEqual({ drained: false, reason: "synchronize_not_granted", handed: [] });
    expect(createSyncCoordinator).not.toHaveBeenCalled();
    expect(recorded.pulls()).toBe(0);
    expect(recorded.pushed).toEqual([]);
    expect(await store.read((tx) => tx.pending())).toHaveLength(1);
  });

  it("does not hand a queued create when the grant is missing", async () => {
    const store = createMemoryLocalFirstStore();
    await queue(store, { eventId: "evt-create", operation: "create", destination: DESTINATION });
    const recorded = recordingTransport();
    const { synchronizeGranted: _granted, ...input } = host({ store, transport: recorded.transport });
    expect(await drainQueuedCreates(input)).toEqual({
      drained: false,
      reason: "synchronize_not_granted",
      handed: [],
    });
    expect(recorded.pushed).toEqual([]);
  });

  it("does not hand a queued create when policy denies synchronize", async () => {
    const store = createMemoryLocalFirstStore();
    await queue(store, { eventId: "evt-create", operation: "create", destination: DESTINATION });
    const recorded = recordingTransport();
    const result = await drainQueuedCreates(host({
      synchronizeGranted: true,
      policy: createPlatformPolicy({ synchronize: false }),
      store,
      transport: recorded.transport,
    }));
    expect(result).toEqual({ drained: false, reason: "synchronize_not_granted", handed: [] });
    expect(recorded.pulls()).toBe(0);
    expect(recorded.pushed).toEqual([]);
    expect(await store.read((tx) => tx.pending())).toHaveLength(1);
  });

  it("hands a queued create to synchronize only when synchronize is granted", async () => {
    const store = createMemoryLocalFirstStore();
    await queue(store, { eventId: "evt-create", operation: "create", destination: DESTINATION });
    const recorded = recordingTransport();
    const result = await drainQueuedCreates(host({ store, transport: recorded.transport }));
    expect(result).toEqual({
      drained: true,
      handed: [{ eventId: "evt-create", destination: DESTINATION }],
    });
    expect(recorded.pushed).toEqual([[{ eventId: "evt-create", operation: "create" }]]);
    expect(recorded.pulls()).toBeGreaterThan(0);
  });

  it("does not steal a foreign lease by age, so the queued create stays unhanded", async () => {
    const heldSince = 1_700_000_000_000;
    for (const age of [0, 29_999, 30_000, 30_001, 3_600_000]) {
      const store = createMemoryLocalFirstStore();
      await queue(store, { eventId: "evt-create", operation: "create", destination: DESTINATION });
      const recorded = recordingTransport();
      const result = await drainQueuedCreates(host({
        holder: "device-b",
        now: heldSince + age,
        heldSince,
        store,
        transport: recorded.transport,
      }));
      expect(result).toEqual({ drained: false, reason: "lease_busy", handed: [] });
      expect(recorded.pulls()).toBe(0);
      expect(recorded.pushed).toEqual([]);
      expect(await store.read((tx) => tx.pending())).toHaveLength(1);
    }
  });

  it("hands the create when this device holds the lease, including past 30s", async () => {
    const store = createMemoryLocalFirstStore();
    await queue(store, { eventId: "evt-create", operation: "create", destination: DESTINATION });
    const recorded = recordingTransport();
    const result = await drainQueuedCreates(host({
      holder: "device-a",
      now: 1_700_000_030_001,
      heldSince: 1_700_000_000_000,
      store,
      transport: recorded.transport,
    }));
    expect(result.drained).toBe(true);
    expect(recorded.pushed).toEqual([[{ eventId: "evt-create", operation: "create" }]]);
  });

  it("does not call synchronize for an update, an unbound create, or a dead-letter create", async () => {
    const store = createMemoryLocalFirstStore();
    await queue(store, { eventId: "evt-update", operation: "update", destination: DESTINATION });
    await queue(store, { eventId: "evt-unbound", operation: "create", destination: { kind: "unbound" } });
    await queue(store, {
      eventId: "evt-dead",
      operation: "create",
      destination: OTHER,
      deadLetter: { reason: "rejected", at: "2026-01-01T00:00:00.000Z" },
    });
    const recorded = recordingTransport();
    const result = await drainQueuedCreates(host({ store, transport: recorded.transport }));
    expect(result).toEqual({ drained: true, handed: [] });
    expect(recorded.pulls()).toBe(0);
    expect(recorded.pushed).toEqual([]);
    expect(await store.read((tx) => tx.pending())).toHaveLength(3);
  });

  it("synchronizes each bound destination that has a queued create, once", async () => {
    const store = createMemoryLocalFirstStore();
    await queue(store, { eventId: "evt-a", operation: "create", destination: DESTINATION });
    await queue(store, { eventId: "evt-b", operation: "create", destination: DESTINATION });
    await queue(store, { eventId: "evt-c", operation: "create", destination: OTHER });
    const recorded = recordingTransport();
    const result = await drainQueuedCreates(host({ store, transport: recorded.transport }));
    expect(result).toEqual({
      drained: true,
      handed: [
        { eventId: "evt-a", destination: DESTINATION },
        { eventId: "evt-b", destination: DESTINATION },
        { eventId: "evt-c", destination: OTHER },
      ],
    });
    expect(recorded.pushed).toEqual([
      [
        { eventId: "evt-a", operation: "create" },
        { eventId: "evt-b", operation: "create" },
      ],
      [{ eventId: "evt-c", operation: "create" }],
    ]);
    expect(recorded.pulls()).toBeGreaterThanOrEqual(2);
  });
});
