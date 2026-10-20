/**
 * G03: the VSIX host's local system of record for the entities that must
 * survive offline — chat, project, ticket, audit-run, and run (execution).
 *
 * What changed, and why it is not the JSON snapshot any more:
 * `createVsCodeLocalFirstStore` rewrote `globalStorage/local-first-v1.json`
 * in full on every transaction, for every entity type. That file was therefore
 * the store for the five kinds above: a chat write rewrote it, an audit write
 * rewrote it, and a process killed mid-write left a file that
 * `loadExistingSnapshot` could only copy aside. The snapshot is now a derived
 * cache of the journal, republished after a committed transaction, and those
 * five kinds are committed through {@link commitOfflineEntityWrite} — one
 * journal frame per transaction, record and journal event together.
 *
 * The commit is `commitWriteAndEnqueue` over this store, which is the same
 * `put` + `append` in one `transact` the rest of the host uses; the
 * difference is that `transact` here is durable before it resolves. There is
 * no API call, no `bfApi`, no `fetch`: a commit that survives a restart is
 * proven by reading the journal, not by asking a server.
 *
 * Nothing in this file may import `node:net`/`node:http`/an API client: the
 * test that proves "restart reads them back with no network" fails if it does.
 */

import {
  commitWriteAndEnqueue,
  createJournaledLocalFirstStore,
  decodeJournalFrames,
  newLocalRecord,
  UNBOUND_DESTINATION,
  type EnqueueEvent,
  type EntityDestination,
  type JournalIo,
  type JournaledLocalFirstStore,
  type LocalEntityType,
  type LocalFirstStore,
  type LocalRecord,
} from '@builderforce/local-first';
import nodeFs from 'node:fs';
import nodePath from 'node:path';
import { randomUUID } from 'node:crypto';

/** The five kinds whose record and journal event must land together. */
export const OFFLINE_COMMITTED_ENTITY_TYPES: readonly LocalEntityType[] = [
  'project',
  'ticket',
  'chat',
  'audit-run',
  'execution',
];

const JOURNAL_FILE = 'local-first-v2.journal';
const SNAPSHOT_FILE = 'local-first-v1.json';

export interface OfflineWrite<T = unknown> {
  readonly entityType: LocalEntityType;
  readonly payload: T;
  readonly id?: string;
  readonly destination?: EntityDestination;
  readonly occurredAt?: string;
  readonly dependsOn?: readonly string[];
}

export interface CommittedOfflineWrite {
  readonly records: readonly LocalRecord[];
  readonly events: readonly string[];
}

/** `entityType:clientId:version` — the same id `commitWriteAndEnqueue` plans. */
export function offlineEventId(record: LocalRecord): string {
  return `${record.entityType}:${record.id}:v${record.version}`;
}

export class OfflineCommitFailedError extends Error {
  readonly code = 'offline_commit_failed';
  constructor(readonly cause: unknown) {
    super('offline_commit_failed');
    this.name = 'offline_commit_failed';
  }
}

/**
 * Commit a write and its journal event in one transaction on a durable store.
 * Every kind in {@link OFFLINE_COMMITTED_ENTITY_TYPES} goes through here, so a
 * kill between the record and its event commits neither: the frame either
 * carries both or the restart sees the previous frame.
 */
export async function commitOfflineEntityWrite<T>(
  store: Pick<LocalFirstStore, 'transact'>,
  deviceId: string,
  write: OfflineWrite<T>,
): Promise<CommittedOfflineWrite> {
  const occurredAt = write.occurredAt ?? new Date().toISOString();
  const record = newLocalRecord<T>({
    id: write.id ?? randomUUID(),
    entityType: write.entityType,
    payload: write.payload,
    deviceId,
    destination: write.destination ?? UNBOUND_DESTINATION,
    occurredAt,
  });
  const event: EnqueueEvent<T> = {
    eventId: offlineEventId(record),
    clientEntityId: record.id,
    entityType: record.entityType,
    operation: record.version === 1 ? 'create' : 'update',
    schemaVersion: record.schemaVersion,
    occurredAt,
    dependsOn: [...(write.dependsOn ?? [])],
    destination: record.destination,
    payload: record.payload,
  };
  const committed = await commitWriteAndEnqueue<T, T>(store as LocalFirstStore, record, event);
  return { records: [record], events: [committed.eventId] };
}

/** Each kind in the set carries its own payload shape, so the batch is not one `T`. */
type OfflinePayload = Record<string, unknown>;

/**
 * The five kinds of ONE offline unit of work — project, ticket, chat, audit
 * and run that belong together — commit in ONE transaction, so a kill cannot
 * leave a chat with no run or an audit with no project.
 */
export async function commitOfflineEntitySet(
  store: Pick<LocalFirstStore, 'transact'>,
  deviceId: string,
  writes: Readonly<Record<string, OfflineWrite<OfflinePayload>>>,
): Promise<CommittedOfflineWrite> {
  const occurredAt = new Date().toISOString();
  const prepared = Object.values(writes).map((write) => {
    const at = write.occurredAt ?? occurredAt;
    const record = newLocalRecord<OfflinePayload>({
      id: write.id ?? randomUUID(),
      entityType: write.entityType,
      payload: write.payload,
      deviceId,
      destination: write.destination ?? UNBOUND_DESTINATION,
      occurredAt: at,
    });
    const event: EnqueueEvent<OfflinePayload> = {
      eventId: offlineEventId(record),
      clientEntityId: record.id,
      entityType: record.entityType,
      operation: 'create',
      schemaVersion: record.schemaVersion,
      occurredAt: at,
      dependsOn: [...(write.dependsOn ?? [])],
      destination: record.destination,
      payload: record.payload,
    };
    return { record, event };
  });
  const committed = await store.transact(async (tx) => {
    const events: string[] = [];
    for (const entry of prepared) {
      await tx.put(entry.record);
      const event = await tx.append(entry.event);
      events.push(event.eventId);
    }
    return events;
  });
  return {
    records: prepared.map((entry) => entry.record),
    events: committed,
  };
}

/** `node:fs` adapter for {@link JournalIo}. Appends are opened in append mode. */
export function createNodeJournalIo(directory: string, fileName: string = JOURNAL_FILE): JournalIo {
  const file = nodePath.join(directory, fileName);
  return {
    async read(): Promise<Uint8Array | undefined> {
      try {
        return new Uint8Array(await nodeFs.promises.readFile(file));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async append(frame: Uint8Array): Promise<void> {
      await nodeFs.promises.mkdir(directory, { recursive: true });
      await nodeFs.promises.appendFile(file, frame);
    },
    async replace(frame: Uint8Array): Promise<void> {
      await nodeFs.promises.mkdir(directory, { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      await nodeFs.promises.writeFile(temporary, frame);
      await nodeFs.promises.rename(temporary, file);
    },
    async size(): Promise<number> {
      try {
        return (await nodeFs.promises.stat(file)).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
        throw error;
      }
    },
  };
}

export interface OfflineLocalFirstStoreOptions {
  readonly directory: string;
  /** Legacy `local-first-v1.json` imported once, when no journal frame exists. */
  readonly legacySnapshot?: () => Promise<unknown>;
  /**
   * Awaited before the first committed transaction (G04). The host passes the
   * `globalState.update` that makes the minted device id durable, so no frame
   * can exist that stamps an id a restart would not find.
   */
  readonly beforeWrite?: Promise<void> | (() => Promise<void>);
}

export interface OfflineLocalFirstStore extends JournaledLocalFirstStore {
  /** The derived JSON cache. Never the system of record. */
  readonly snapshotFile: string;
  readonly journalFile: string;
  /** Resolves once the cache has caught up with every committed transaction. */
  flush(): Promise<void>;
}

/**
 * Open the host store. The journal is the store; the JSON snapshot is a cache
 * republished after each commit so an older reader still sees the same rows.
 */
export function createOfflineLocalFirstStore(options: OfflineLocalFirstStoreOptions): OfflineLocalFirstStore {
  const store = createJournaledLocalFirstStore({
    io: createNodeJournalIo(options.directory),
    ...(options.beforeWrite === undefined ? {} : { beforeWrite: options.beforeWrite }),
  });
  let republished: Promise<unknown> = Promise.resolve();

  const republish = (): Promise<unknown> => {
    republished = republished.then(async () => {
      const snapshot = await store.export();
      const temporary = nodePath.join(options.directory, `${SNAPSHOT_FILE}.${process.pid}.tmp`);
      await nodeFs.promises.mkdir(options.directory, { recursive: true });
      await nodeFs.promises.writeFile(temporary, JSON.stringify(snapshot), { encoding: 'utf8' });
      await nodeFs.promises.rename(temporary, nodePath.join(options.directory, SNAPSHOT_FILE));
    });
    return republished;
  };

  store.subscribe(() => {
    void republish().catch(() => undefined);
  });

  return Object.assign(store, {
    snapshotFile: nodePath.join(options.directory, SNAPSHOT_FILE),
    journalFile: nodePath.join(options.directory, JOURNAL_FILE),
    flush: async () => {
      await republished;
    },
  });
}

/** Complete frames in a journal byte buffer. Exported for the restart test. */
export { decodeJournalFrames };