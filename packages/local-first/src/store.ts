import {
  UNBOUND_DESTINATION,
  destinationKey,
  type EntityDestination,
  type JournalEvent,
  type LocalEntityType,
  type LocalRecord,
  type ServerMapping,
  type SyncConflict,
  type SyncReceipt,
} from './records.js';

export interface LocalFirstTransaction {
  get<T = unknown>(entityType: LocalEntityType, id: string): Promise<LocalRecord<T> | undefined>;
  list<T = unknown>(entityType?: LocalEntityType): Promise<LocalRecord<T>[]>;
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

export interface LocalFirstStore {
  read<R>(work: (transaction: LocalFirstTransaction) => Promise<R>): Promise<R>;
  transact<R>(work: (transaction: LocalFirstTransaction) => Promise<R>): Promise<R>;
  export(): Promise<LocalFirstSnapshot>;
  subscribe(listener: () => void): () => void;
}

interface State extends LocalFirstSnapshot {}

const clone = <T>(value: T): T => structuredClone(value);
const recordKey = (type: LocalEntityType, id: string): string => `${type}:${id}`;
const mappingKey = (mapping: Pick<ServerMapping, 'entityType' | 'clientEntityId' | 'destination'>): string =>
  `${destinationKey(mapping.destination)}:${mapping.entityType}:${mapping.clientEntityId}`;

function hashPayload(payload: unknown): string {
  const text = JSON.stringify(payload) ?? 'null';
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Rewrite `dependsOn` keys that name a PENDING event onto that event's wire id.
 * Anything else is kept as written: a key for an event appended later in the
 * same transaction (a forward reference) is resolved when the batch is built
 * (`wireDependencies` in `sync.ts`), which also drops a key whose event has
 * already been acknowledged.
 */
function resolveDependencies(dependsOn: readonly string[], pendingByKey: ReadonlyMap<string, JournalEvent>): string[] {
  const ids: string[] = [];
  for (const id of dependsOn) {
    const resolved = pendingByKey.get(id)?.eventId ?? id;
    if (!ids.includes(resolved)) ids.push(resolved);
  }
  return ids;
}

class Transaction implements LocalFirstTransaction {
  constructor(private readonly state: {
    records: Map<string, LocalRecord>;
    events: Map<string, JournalEvent>;
    mappings: Map<string, ServerMapping>;
    receipts: Map<string, SyncReceipt>;
    conflicts: Map<string, SyncConflict>;
    cursors: Map<string, string>;
    nextSequence: number;
  }, private readonly mutable: boolean) {}

  async get<T>(entityType: LocalEntityType, id: string): Promise<LocalRecord<T> | undefined> {
    return clone(this.state.records.get(recordKey(entityType, id))) as LocalRecord<T> | undefined;
  }

  async list<T>(entityType?: LocalEntityType): Promise<LocalRecord<T>[]> {
    const rows = [...this.state.records.values()].filter((record) => !entityType || record.entityType === entityType);
    return clone(rows) as LocalRecord<T>[];
  }

  async put<T>(record: LocalRecord<T>, expectedVersion?: number): Promise<void> {
    this.assertMutable();
    if (!record.id || typeof record.id !== 'string') throw new Error('client_entity_id_must_be_stable_uuid');
    const key = recordKey(record.entityType, record.id);
    const current = this.state.records.get(key);
    if (expectedVersion !== undefined && current?.version !== expectedVersion) {
      throw Object.assign(new Error('entity_version_conflict'), { code: 'ENTITY_VERSION_CONFLICT' });
    }
    this.state.records.set(key, clone(record));
  }

  async delete(entityType: LocalEntityType, id: string): Promise<boolean> {
    this.assertMutable();
    return this.state.records.delete(recordKey(entityType, id));
  }

  async append<T>(event: AppendJournalEvent<T>): Promise<JournalEvent<T>> {
    this.assertMutable();
    const { eventId: given, idempotencyKey: key, ...rest } = event;
    const wireId = isJournalEventId(given) ? given : undefined;
    const idempotencyKey = key ?? (given !== undefined && !wireId ? given : undefined);
    if (wireId && this.state.events.has(wireId)) return clone(this.state.events.get(wireId)) as JournalEvent<T>;
    const pendingByKey = this.pendingByKey();
    if (idempotencyKey !== undefined) {
      const existing = pendingByKey.get(idempotencyKey);
      if (existing) return clone(existing) as JournalEvent<T>;
    }
    const stored: JournalEvent<T> = {
      ...clone(rest),
      eventId: wireId ?? crypto.randomUUID(),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      dependsOn: resolveDependencies(event.dependsOn, pendingByKey),
      localSequence: this.state.nextSequence,
      payloadHash: event.payloadHash ?? hashPayload(event.payload),
    };
    this.state.nextSequence += 1;
    this.state.events.set(stored.eventId, stored);
    return clone(stored);
  }

  /** Pending events by their caller-side idempotency key. */
  private pendingByKey(): Map<string, JournalEvent> {
    const byKey = new Map<string, JournalEvent>();
    for (const pending of this.state.events.values()) {
      if (pending.idempotencyKey !== undefined) byKey.set(pending.idempotencyKey, pending);
    }
    return byKey;
  }

  async pending(destination?: EntityDestination): Promise<JournalEvent[]> {
    const key = destination ? destinationKey(destination) : undefined;
    return clone([...this.state.events.values()]
      .filter((event) => !key || destinationKey(event.destination) === key)
      .sort((a, b) => a.localSequence - b.localSequence));
  }

  async acknowledge(eventIds: readonly string[]): Promise<void> {
    this.assertMutable();
    for (const id of eventIds) this.state.events.delete(id);
  }

  async putMapping(mapping: ServerMapping): Promise<void> {
    this.assertMutable();
    this.state.mappings.set(mappingKey(mapping), clone(mapping));
  }

  async mapping(entityType: LocalEntityType, clientEntityId: string, destination: EntityDestination): Promise<ServerMapping | undefined> {
    return clone(this.state.mappings.get(mappingKey({ entityType, clientEntityId, destination })));
  }

  async putReceipt(receipt: SyncReceipt): Promise<void> {
    this.assertMutable();
    this.state.receipts.set(receipt.eventId, clone(receipt));
  }

  async putConflict(conflict: SyncConflict): Promise<void> {
    this.assertMutable();
    this.state.conflicts.set(conflict.id, clone(conflict));
  }

  async conflicts(): Promise<SyncConflict[]> {
    return clone([...this.state.conflicts.values()]);
  }

  async setCursor(destination: EntityDestination, cursor: string | undefined): Promise<void> {
    this.assertMutable();
    const key = destinationKey(destination);
    if (cursor === undefined) this.state.cursors.delete(key);
    else this.state.cursors.set(key, cursor);
  }

  async cursor(destination: EntityDestination): Promise<string | undefined> {
    return this.state.cursors.get(destinationKey(destination));
  }

  committed(): State {
    return snapshot(this.state);
  }

  private assertMutable(): void {
    if (!this.mutable) throw new Error('read_only_local_transaction');
  }
}

function transaction(state: State, mutable: boolean): Transaction {
  return new Transaction({
    records: new Map(state.records.map((record) => [recordKey(record.entityType, record.id), record])),
    events: new Map(state.events.map((event) => [event.eventId, event])),
    mappings: new Map(state.mappings.map((mapping) => [mappingKey(mapping), mapping])),
    receipts: new Map(state.receipts.map((receipt) => [receipt.eventId, receipt])),
    conflicts: new Map(state.conflicts.map((conflict) => [conflict.id, conflict])),
    cursors: new Map(Object.entries(state.cursors)),
    nextSequence: state.nextSequence,
  }, mutable);
}

function snapshot(state: {
  records: Map<string, LocalRecord>;
  events: Map<string, JournalEvent>;
  mappings: Map<string, ServerMapping>;
  receipts: Map<string, SyncReceipt>;
  conflicts: Map<string, SyncConflict>;
  cursors: Map<string, string>;
  nextSequence: number;
}): State {
  return {
    records: [...state.records.values()],
    events: [...state.events.values()],
    mappings: [...state.mappings.values()],
    receipts: [...state.receipts.values()],
    conflicts: [...state.conflicts.values()],
    cursors: Object.fromEntries(state.cursors),
    nextSequence: state.nextSequence,
  };
}

export function createMemoryLocalFirstStore(initial?: Partial<LocalFirstSnapshot>): LocalFirstStore {
  let state: State = {
    records: initial?.records ?? [],
    events: initial?.events ?? [],
    mappings: initial?.mappings ?? [],
    receipts: initial?.receipts ?? [],
    conflicts: initial?.conflicts ?? [],
    cursors: initial?.cursors ?? {},
    nextSequence: initial?.nextSequence ?? 1,
  };
  let tail: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  return {
    read: (work) => work(transaction(clone(state), false)),
    transact(work) {
      const run = tail.then(async () => {
        const draft = clone(state);
        const tx = transaction(draft, true);
        const result = await work(tx);
        state = tx.committed();
        for (const listener of [...listeners]) listener();
        return result;
      });
      tail = run.catch(() => undefined);
      return run;
    },
    export: async () => clone(state),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function newLocalRecord<T>(input: {
  id: string;
  entityType: LocalEntityType;
  payload: T;
  deviceId: string;
  destination?: EntityDestination;
  occurredAt?: string;
  schemaVersion?: number;
}): LocalRecord<T> {
  const at = input.occurredAt ?? new Date().toISOString();
  return {
    id: input.id,
    entityType: input.entityType,
    schemaVersion: input.schemaVersion ?? 1,
    version: 1,
    destination: input.destination ?? UNBOUND_DESTINATION,
    occurredAt: at,
    updatedAt: at,
    payload: input.payload,
    provenance: { deviceId: input.deviceId, source: 'local' },
  };
}
