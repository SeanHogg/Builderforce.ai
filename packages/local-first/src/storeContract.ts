/**
 * The local-first store's CONTRACT: the interfaces a host implements and a caller
 * reads through. No state, no behaviour beyond two tiny pure helpers.
 *
 * Split out of `store.ts` so the transaction (`storeTransaction.ts`), the
 * committed state (`storeState.ts`) and the delta vocabulary (`localFirstDelta.ts`)
 * can all name these types without importing each other in a cycle.
 * `store.ts` re-exports everything here, so `import … from './store.js'` is
 * still the one public path.
 */

import type {
  EntityDestination,
  JournalEvent,
  LocalEntityType,
  LocalRecord,
  ServerMapping,
  SyncConflict,
  SyncReceipt,
} from './records.js';
import type { LocalFirstChange } from './localFirstDelta.js';

export interface LocalFirstTransaction {
  get<T = unknown>(entityType: LocalEntityType, id: string): Promise<LocalRecord<T> | undefined>;
  list<T = unknown>(entityType?: LocalEntityType): Promise<LocalRecord<T>[]>;
  /**
   * Visit rows WITHOUT cloning them. `list` structuredClones every row it returns, which
   * is megabytes once a store holds a whole chat history; a caller that only filters,
   * counts or takes a maximum should scan, then clone just what it keeps
   * (`selectRecords`). The rows are the store's own: NEVER mutate or retain one past the
   * callback. The visit is synchronous, so nothing can change under it. `entityType`
   * undefined visits every row. Rows come in `list` order.
   */
  scan<T = unknown>(entityType: LocalEntityType | undefined, visit: (row: Readonly<LocalRecord<T>>) => void): Promise<void>;
  put<T>(record: LocalRecord<T>, expectedVersion?: number): Promise<void>;
  /**
   * Remove one local row. A pull tombstone calls this instead of `put`: writing
   * the row back would resurrect the entity the server deleted. Returns whether
   * a row was present. A missing row is not an error — the delete already won.
   */
  delete(entityType: LocalEntityType, id: string): Promise<boolean>;
  /**
   * Enqueue one journal event. The store MINTS the wire `eventId` (a UUID — the
   * server's `(tenant, device, event)` key). Callers name the logical write with
   * `idempotencyKey` (e.g. `ticket:<id>:v1`): a second append with a key that is
   * still pending returns the first event instead of enqueueing twice, and a
   * `dependsOn` entry naming a pending key is rewritten to that event's id.
   */
  append<T>(event: AppendJournalEvent<T>): Promise<JournalEvent<T>>;
  pending(destination?: EntityDestination): Promise<JournalEvent[]>;
  /**
   * `pending` without the clone, in no particular order: the store's own events, never
   * mutate or retain one. `selectPending` is the cloning, sequence-ordered form.
   */
  scanPending(visit: (event: Readonly<JournalEvent>) => void, destination?: EntityDestination): Promise<void>;
  acknowledge(eventIds: readonly string[]): Promise<void>;
  putMapping(mapping: ServerMapping): Promise<void>;
  mapping(entityType: LocalEntityType, clientEntityId: string, destination: EntityDestination): Promise<ServerMapping | undefined>;
  putReceipt(receipt: SyncReceipt): Promise<void>;
  putConflict(conflict: SyncConflict): Promise<void>;
  conflicts(): Promise<SyncConflict[]>;
  setCursor(destination: EntityDestination, cursor: string | undefined): Promise<void>;
  cursor(destination: EntityDestination): Promise<string | undefined>;
}

/**
 * What `append` takes. `eventId` is optional and kept only when it is already a
 * UUID (a replayed wire event); any other value is a legacy composite id and is
 * treated as the `idempotencyKey`.
 */
export type AppendJournalEvent<T = unknown> =
  Omit<JournalEvent<T>, 'localSequence' | 'payloadHash' | 'eventId' | 'idempotencyKey'> & {
    eventId?: string;
    idempotencyKey?: string;
    payloadHash?: string;
  };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isJournalEventId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export interface LocalFirstSnapshot {
  records: LocalRecord[];
  events: JournalEvent[];
  mappings: ServerMapping[];
  receipts: SyncReceipt[];
  conflicts: SyncConflict[];
  cursors: Record<string, string>;
  nextSequence: number;
}

/**
 * A store listener. `change` names what the commit touched so a listener decides
 * whether it cares WITHOUT reading the store. `undefined` means "unknown — assume
 * everything" (a host that reloaded the whole store). `() => void` listeners still fit.
 */
export type LocalFirstListener = (change?: LocalFirstChange) => void;

export interface LocalFirstStore {
  read<R>(work: (transaction: LocalFirstTransaction) => Promise<R>): Promise<R>;
  transact<R>(work: (transaction: LocalFirstTransaction) => Promise<R>): Promise<R>;
  export(): Promise<LocalFirstSnapshot>;
  subscribe(listener: LocalFirstListener): () => void;
}
