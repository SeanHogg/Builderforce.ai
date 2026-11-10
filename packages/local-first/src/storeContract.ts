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
  EntityScope,
  JournalEvent,
  LocalEntityType,
  LocalRecord,
  ServerMapping,
  ServerMappingInput,
  SyncConflict,
  SyncReceipt,
} from './records.js';
import { isLocalId } from './entityId.js';
import type { LocalFirstChange } from './localFirstDelta.js';
import type { RecordIndex, RecordIndexKey } from './recordIndex.js';

export interface LocalFirstTransaction {
  get<T = unknown>(entityType: LocalEntityType, id: string): Promise<LocalRecord<T> | undefined>;
  list<T = unknown>(entityType?: LocalEntityType): Promise<LocalRecord<T>[]>;
  /**
   * Visit rows WITHOUT cloning them. `list` structuredClones every row it returns, which
   * is megabytes once a store holds a whole chat history; a caller that only filters,
   * counts or takes a maximum should scan, then clone just what it keeps
   * (`selectRecords`). The rows are the store's own: NEVER mutate or retain one past the
   * callback. The visit is synchronous, so nothing can change under it. `entityType`
   * undefined visits every row; a named type reads ONLY that type's rows (a per-type
   * index), never the other types'. Rows come in `list` order.
   *
   * Return the `SCAN_STOP` sentinel from the callback to EXIT EARLY: the scan ends at
   * that row — a caller that only needs a first match (a pending event, any unbound
   * row) stops walking instead of visiting the rest.
   */
  scan<T = unknown>(entityType: LocalEntityType | undefined, visit: ScanVisit<T>): Promise<void>;
  /**
   * `scan` of ONE group of a secondary index (`defineRecordIndex`): only the rows of
   * `index.entityType` whose `keyOf` is `key`, without walking the type's other rows —
   * reading one chat's messages costs that chat. Same view rules and `SCAN_STOP` as
   * `scan`; rows come in committed order, then the ones this transaction wrote.
   * Optional so a hand-rolled transaction still fits: callers go through `scanByIndex`,
   * which falls back to a filtered `scan`.
   */
  scanIndex?<T = unknown>(index: RecordIndex<T>, key: RecordIndexKey, visit: ScanVisit<T>): Promise<void>;
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
   * mutate or retain one. `selectPending` is the cloning, sequence-ordered form. Return
   * `SCAN_STOP` from the callback to stop at the first match instead of walking the rest.
   */
  scanPending(visit: ScanPendingVisit, destination?: EntityDestination): Promise<void>;
  acknowledge(eventIds: readonly string[]): Promise<void>;
  /**
   * Give up on a pending event the server permanently refused: it stays in the journal (audit,
   * sync status `dead-letter`) but is no longer pending work — `selectPending` skips it, a
   * later append under its idempotency key is a new event. Idempotent; an unknown id is a no-op.
   */
  deadLetter(eventId: string, reason: string, at: string): Promise<void>;
  /**
   * Record that the server held a pending event: persists the attempt count, when it was first
   * held and the instant before which it must not be re-sent (backoff). A no-op for an unknown id.
   */
  hold(eventId: string, hold: { holdKind?: string; holdAttempts: number; heldSince: string; nextAttemptAt: string }): Promise<void>;
  /**
   * Write a mapping. The row goes through `normalizeServerMapping`, so it carries BOTH
   * `syncId` and `serverId` text (an older window sharing the journal reads `serverId`).
   */
  putMapping(mapping: ServerMappingInput): Promise<void>;
  mapping(entityType: LocalEntityType, clientEntityId: string, destination: EntityDestination): Promise<ServerMapping | undefined>;
  /**
   * The reverse of `mapping`: the EARLIEST row (`compareMappingAge`: `mappedSeq`, then key — the
   * same order in memory and after a reload) of `entityType` whose server key is `serverId`:
   * - a SyncId (number or decimal text) matches `syncId`; failing any such row, a row with
   *   `syncId: null` whose `serverId` text is that number (a run step's server row);
   * - any other text matches the legacy `serverId` text (a mirror row's UUID) or, for `kind:ref`,
   *   `externalRef`.
   * `scope` (see `EntityScope`): a destination, or an account (`{ tenantId }`: its destinations plus
   * unbound). Omitted ⇒ every destination — legacy, may cross tenants. Scans the mapping rows.
   */
  mappingByServerId(entityType: LocalEntityType, serverId: string | number, scope?: EntityScope): Promise<ServerMapping | undefined>;
  /**
   * The EARLIEST row of `entityType` whose `externalRef` is `externalRef` (a tier ticket's
   * `kind:ref`), inside `scope` (as `mappingByServerId`).
   */
  mappingByExternalRef(entityType: LocalEntityType, externalRef: string, scope?: EntityScope): Promise<ServerMapping | undefined>;
  putReceipt(receipt: SyncReceipt): Promise<void>;
  putConflict(conflict: SyncConflict): Promise<void>;
  conflicts(): Promise<SyncConflict[]>;
  /**
   * Set (or, with `undefined`, clear) the pull cursor. `pulledAt` (ISO) is the instant that
   * pull completed; it is stored beside the cursor (even when the cursor is undefined) and read
   * back by `lastPullAt`. Clearing the cursor WITHOUT `pulledAt` (resnapshot / reset) clears it too.
   */
  setCursor(destination: EntityDestination, cursor: string | undefined, pulledAt?: string): Promise<void>;
  cursor(destination: EntityDestination): Promise<string | undefined>;
  /** When the last pull for `destination` completed, or undefined when none has. */
  lastPullAt(destination: EntityDestination): Promise<string | undefined>;
  /**
   * Record (or, with `undefined`, clear) when a named read of the server last completed, beside
   * the pull cursor in the store's state, so it survives a reload. A refresh that changed no row
   * still counts as a read (the rail's "Updated <time>"). `key` is the caller's, e.g. `chatRail:<id>`.
   */
  setReadMark(key: string, at: string | undefined): Promise<void>;
  /** When the named read last completed, or undefined when it never has. */
  readMark(key: string): Promise<string | undefined>;
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

/** A wire event id is a LocalId-shaped UUID (case-insensitive): an alias of `isLocalId`. */
export const isJournalEventId: (value: unknown) => value is string = isLocalId;

/**
 * The early-exit sentinel a scan visitor returns to STOP the scan at that row.
 * Returning anything else (including undefined) continues to the next row.
 */
export const SCAN_STOP: ScanStop = Symbol.for('builderforce.local-first.scan-stop') as ScanStop;

/**
 * The sentinel's TYPE is structural, not `unique symbol`: a package that bundles this
 * contract's declarations (brain-embedded's rolled-up `.d.ts`) gets its OWN `unique symbol`,
 * which TypeScript treats as a different type from this one, so a store typed here would not
 * be assignable to the bundled `LocalFirstStore`. The runtime value is `Symbol.for`, shared.
 */
export type ScanStop = symbol & { readonly __builderforceScanStop: true };

/** What a `scan` / `scanPending` callback may return: nothing (continue) or `SCAN_STOP`. */
export type ScanVisit<T = unknown> = (row: Readonly<LocalRecord<T>>) => void | ScanStop;
/** What a `scanPending` callback may return: nothing (continue) or `SCAN_STOP`. */
export type ScanPendingVisit = (event: Readonly<JournalEvent>) => void | ScanStop;

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
  /**
   * Read through a transaction of the COMMITTED state. `read` never waits on a running
   * commit and may fold in another window's committed tail first, so two `read`s can
   * observe different snapshots — that is the point of the store. What each accessor
   * hands back, by contract:
   *   - CLONING accessors — `get`, `list`, `pending`, `mapping`, `cursor`, `conflicts` —
   *     structuredClone their results, so what a caller receives is caller-owned: mutate
   *     it, retain it, no effect on the store.
   *   - VIEW accessors — `scan`, `scanPending` — visit the COMMITTED Maps directly and
   *     hand the store's own rows to the callback without cloning (megabytes once the
   *     store holds a whole chat history). NEVER mutate a visited row and NEVER retain one
   *     past the callback: the next commit updates those Maps in place, so a retained row
   *     is silently stale. Treat `scan` as the current committed snapshot, not as
   *     caller-owned data; clone just the rows you keep (`selectRecords`).
   */
  read<R>(work: (transaction: LocalFirstTransaction) => Promise<R>): Promise<R>;
  transact<R>(work: (transaction: LocalFirstTransaction) => Promise<R>): Promise<R>;
  export(): Promise<LocalFirstSnapshot>;
  subscribe(listener: LocalFirstListener): () => void;
}
