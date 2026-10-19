/**
 * Denied-network VSIX host boot.
 *
 * A scenario calls this without a live extension host, a platform session, or
 * `vscode.ExtensionContext`. The durable store is a snapshot file in
 * `directory` (global storage, once activation wires this in). A second boot
 * against the same directory reads that file back through a new store.
 *
 * Replay seals one local batch into a ledger beside the snapshot. It does not
 * acknowledge the journal and it does not call platform fetch, so a later
 * granted sync can still send the same events.
 *
 * Live activation still belongs to `extension.ts`. This module does not import
 * it, and it does not import `vscode`.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  LOCAL_FIRST_POLICY,
  createMemoryLocalFirstStore,
  createPlatformPolicy,
  newLocalRecord,
  type LocalFirstSnapshot,
  type LocalFirstStore,
} from "@builderforce/local-first";

export const VSIX_LOCAL_SNAPSHOT_FILE = "local-first-v1.json";

const REPLAY_LEDGER_FILE = "local-replay-v1.json";
const DEVICE_ID = "vsix-denied-host";
const LOCAL_REPLAY_PREFIX = "local_replay:";

export interface BootVsixHostOptions {
  /** Directory that outlives this process. The next boot must be given the same path. */
  directory: string;
  /** Denied: writes and replays stay on disk. Platform fetch is not called. */
  network: "denied";
}

export interface VsixDurableRecord {
  id: string;
  title: string;
}

export interface VsixReplayBatch {
  count: number;
  idempotencyKey: string;
}

export interface VsixHostBoot {
  ready(): Promise<void>;
  /** Write one local record and flush it to the snapshot file. Does not fetch. */
  writeDurable(input: { title: string; id?: string }): Promise<string>;
  /** Read a record back from the store this boot opened. */
  readRecord(id: string): Promise<VsixDurableRecord | undefined>;
  /** Replay one pending batch into the local ledger. Does not fetch. */
  replayBatch(): Promise<VsixReplayBatch>;
  /** The store this boot opened. A second boot opens a different store over the same directory. */
  store(): LocalFirstStore;
  stop(): void;
}

interface ReplayLedger {
  idempotencyKey: string;
  eventIds: string[];
}

export function bootVsixHost(options: BootVsixHostOptions): VsixHostBoot {
  if (options.network !== "denied") {
    throw new Error("vsix_boot_requires_denied_network");
  }
  const policy = createPlatformPolicy(LOCAL_FIRST_POLICY);
  if (policy.allows("synchronize")) {
    throw new Error("vsix_boot_requires_denied_network");
  }

  const directory = options.directory;
  const store = openDurableStore(directory);
  let stopped = false;

  const assertOpen = (): void => {
    if (stopped) throw new Error("vsix_boot_stopped");
  };

  return {
    ready: () => Promise.resolve(),
    async writeDurable(input) {
      assertOpen();
      const title = input.title.trim();
      if (!title) throw new Error("ticket_title_required");
      const id = input.id ?? crypto.randomUUID();
      await store.transact(async (tx) => {
        const record = newLocalRecord({
          id,
          entityType: "ticket",
          payload: { title },
          deviceId: DEVICE_ID,
        });
        await tx.put(record);
        await tx.append({
          eventId: `event:${id}`,
          clientEntityId: id,
          entityType: "ticket",
          operation: "create",
          schemaVersion: record.schemaVersion,
          occurredAt: record.occurredAt,
          dependsOn: [],
          destination: record.destination,
          payload: record.payload,
        });
      });
      return id;
    },
    async readRecord(id) {
      assertOpen();
      const record = await store.read((tx) => tx.get("ticket", id));
      if (!record) return undefined;
      const payload = record.payload as { title?: unknown };
      return {
        id: record.id,
        title: typeof payload.title === "string" ? payload.title : "",
      };
    },
    async replayBatch() {
      assertOpen();
      const pending = await store.read((tx) => tx.pending());
      const ledger = readLedger(directory);
      const covered = new Set(ledger.eventIds);
      const batch = pending.filter((event) => !covered.has(event.eventId));
      if (batch.length === 0) {
        return { count: 0, idempotencyKey: ledger.idempotencyKey };
      }
      const idempotencyKey = ledger.idempotencyKey || batch[0].eventId;
      writeJsonAtomic(path.join(directory, REPLAY_LEDGER_FILE), {
        idempotencyKey,
        eventIds: [...ledger.eventIds, ...batch.map((event) => event.eventId)],
        detail: `${LOCAL_REPLAY_PREFIX}${idempotencyKey}`,
      });
      return { count: batch.length, idempotencyKey };
    },
    store: () => store,
    stop() {
      stopped = true;
    },
  };
}

function openDurableStore(directory: string): LocalFirstStore {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, VSIX_LOCAL_SNAPSHOT_FILE);
  const memory = createMemoryLocalFirstStore(readSnapshot(file));
  const flush = async (): Promise<void> => {
    writeJsonAtomic(file, await memory.export());
  };
  return {
    read: (work) => memory.read(work),
    transact: async (work) => {
      const result = await memory.transact(work);
      await flush();
      return result;
    },
    export: () => memory.export(),
    subscribe: (listener) => memory.subscribe(listener),
  };
}

function readSnapshot(file: string): LocalFirstSnapshot | undefined {
  if (!existsSync(file)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error("local_first_snapshot_corrupt");
  }
  if (!isSnapshot(parsed)) throw new Error("local_first_snapshot_corrupt");
  return parsed;
}

function isSnapshot(value: unknown): value is LocalFirstSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<LocalFirstSnapshot>;
  return Array.isArray(snapshot.records)
    && Array.isArray(snapshot.events)
    && Array.isArray(snapshot.mappings)
    && Array.isArray(snapshot.receipts)
    && Array.isArray(snapshot.conflicts)
    && typeof snapshot.cursors === "object"
    && snapshot.cursors !== null
    && !Array.isArray(snapshot.cursors)
    && typeof snapshot.nextSequence === "number";
}

function readLedger(directory: string): ReplayLedger {
  const file = path.join(directory, REPLAY_LEDGER_FILE);
  if (!existsSync(file)) return { idempotencyKey: "", eventIds: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error("local_replay_ledger_corrupt");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("local_replay_ledger_corrupt");
  const ledger = parsed as Partial<ReplayLedger>;
  if (typeof ledger.idempotencyKey !== "string" || !Array.isArray(ledger.eventIds)) {
    throw new Error("local_replay_ledger_corrupt");
  }
  return { idempotencyKey: ledger.idempotencyKey, eventIds: ledger.eventIds.filter((id) => typeof id === "string") };
}

function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  try {
    renameSync(tmp, file);
  } catch {
    copyFileSync(tmp, file);
    unlinkSync(tmp);
  }
}
