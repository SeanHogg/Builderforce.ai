/**
 * One transaction over a `CommittedState`: a copy-on-write DRAFT.
 *
 * Writes land in per-map overlays (`DraftMap`); reads consult the overlay first and fall
 * through to the long-lived committed Maps, so opening a transaction costs nothing in the
 * size of the store. Nothing here touches committed state — `delta()` reads the overlays
 * out as one `LocalFirstDelta`, and the store applies it (after its commit hook has made
 * it durable) or drops the transaction. A `work` that throws therefore publishes nothing.
 */

import { destinationKey, type EntityDestination, type JournalEvent, type LocalEntityType, type LocalRecord, type ServerMapping, type SyncConflict, type SyncReceipt } from './records.js';
import type { LocalFirstDelta } from './localFirstDelta.js';
import { DraftMap } from './draftMap.js';
import { CommittedState, PendingKeyIndex, mappingKey, recordKey } from './storeState.js';
import { isJournalEventId, type AppendJournalEvent, type LocalFirstTransaction } from './storeContract.js';

const clone = <T>(value: T): T => structuredClone(value);

function hashPayload(payload: unknown): string {
  const text = JSON.stringify(payload) ?? 'null';
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export class Transaction implements LocalFirstTransaction {
  private readonly records: DraftMap<LocalRecord>;
  private readonly events: DraftMap<JournalEvent>;
  private readonly mappings: DraftMap<ServerMapping>;
  private readonly receipts: DraftMap<SyncReceipt>;
  private readonly conflictRows: DraftMap<SyncConflict>;
  private readonly cursors: DraftMap<string>;
  /** Events THIS transaction appended, by key. Committed events are found in `base.pendingKeys`. */
  private readonly addedKeys = new PendingKeyIndex();
  private nextSequence: number;

  constructor(private readonly base: CommittedState, private readonly mutable: boolean) {
    this.records = new DraftMap(base.records);
    this.events = new DraftMap(base.events);
    this.mappings = new DraftMap(base.mappings);
    this.receipts = new DraftMap(base.receipts);
    this.conflictRows = new DraftMap(base.conflicts);
    this.cursors = new DraftMap(base.cursors);
    this.nextSequence = base.nextSequence;
  }

  async get<T>(entityType: LocalEntityType, id: string): Promise<LocalRecord<T> | undefined> {
    return clone(this.records.get(recordKey(entityType, id))) as LocalRecord<T> | undefined;
  }

  async list<T>(entityType?: LocalEntityType): Promise<LocalRecord<T>[]> {
    const rows: LocalRecord[] = [];
    for (const record of this.records.values()) {
      if (!entityType || record.entityType === entityType) rows.push(record);
    }
    return clone(rows) as LocalRecord<T>[];
  }

  async scan<T>(entityType: LocalEntityType | undefined, visit: (row: Readonly<LocalRecord<T>>) => void): Promise<void> {
    for (const record of this.records.values()) {
      if (!entityType || record.entityType === entityType) visit(record as LocalRecord<T>);
    }
  }

  async put<T>(record: LocalRecord<T>, expectedVersion?: number): Promise<void> {
    this.assertMutable();
    if (!record.id || typeof record.id !== 'string') throw new Error('client_entity_id_must_be_stable_uuid');
    const key = recordKey(record.entityType, record.id);
    const current = this.records.get(key);
    if (expectedVersion !== undefined && current?.version !== expectedVersion) {
      throw Object.assign(new Error('entity_version_conflict'), { code: 'ENTITY_VERSION_CONFLICT' });
    }
    this.records.set(key, clone(record));
  }

  async delete(entityType: LocalEntityType, id: string): Promise<boolean> {
    this.assertMutable();
    return this.records.delete(recordKey(entityType, id));
  }

  async append<T>(event: AppendJournalEvent<T>): Promise<JournalEvent<T>> {
    this.assertMutable();
    const { eventId: given, idempotencyKey: key, ...rest } = event;
    const wireId = isJournalEventId(given) ? given : undefined;
    const idempotencyKey = key ?? (given !== undefined && !wireId ? given : undefined);
    if (wireId && this.events.has(wireId)) return clone(this.events.get(wireId)) as JournalEvent<T>;
    if (idempotencyKey !== undefined) {
      const existing = this.pendingForKey(idempotencyKey);
      if (existing) return clone(existing) as JournalEvent<T>;
    }
    const stored: JournalEvent<T> = {
      ...clone(rest),
      eventId: wireId ?? crypto.randomUUID(),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      dependsOn: this.resolveDependencies(event.dependsOn),
      localSequence: this.nextSequence,
      payloadHash: event.payloadHash ?? hashPayload(event.payload),
    };
    this.nextSequence += 1;
    this.events.set(stored.eventId, stored);
    this.addedKeys.add(stored);
    return clone(stored);
  }

  /** The pending event a key names, as of this transaction (committed minus acknowledged, plus appended). */
  private pendingForKey(key: string): JournalEvent | undefined {
    const live = (event: JournalEvent): boolean => this.events.get(event.eventId) === event;
    return this.addedKeys.latest(key, live) ?? this.base.pendingKeys.latest(key, live);
  }

  /**
   * Rewrite `dependsOn` keys that name a PENDING event onto that event's wire id.
   * Anything else is kept as written: a key for an event appended later in the
   * same transaction (a forward reference) is resolved when the batch is built
   * (`wireDependencies` in `sync.ts`), which also drops a key whose event has
   * already been acknowledged.
   */
  private resolveDependencies(dependsOn: readonly string[]): string[] {
    const ids: string[] = [];
    for (const id of dependsOn) {
      const resolved = this.pendingForKey(id)?.eventId ?? id;
      if (!ids.includes(resolved)) ids.push(resolved);
    }
    return ids;
  }

  async pending(destination?: EntityDestination): Promise<JournalEvent[]> {
    const rows: JournalEvent[] = [];
    await this.scanPending((event) => { rows.push(event); }, destination);
    rows.sort((a, b) => a.localSequence - b.localSequence);
    return clone(rows);
  }

  async scanPending(visit: (event: Readonly<JournalEvent>) => void, destination?: EntityDestination): Promise<void> {
    const key = destination ? destinationKey(destination) : undefined;
    for (const event of this.events.values()) {
      if (!key || destinationKey(event.destination) === key) visit(event);
    }
  }

  async acknowledge(eventIds: readonly string[]): Promise<void> {
    this.assertMutable();
    for (const id of eventIds) {
      const event = this.events.get(id);
      if (!event) continue;
      this.events.delete(id);
      this.addedKeys.remove(event);
    }
  }

  async putMapping(mapping: ServerMapping): Promise<void> {
    this.assertMutable();
    this.mappings.set(mappingKey(mapping), clone(mapping));
  }

  async mapping(entityType: LocalEntityType, clientEntityId: string, destination: EntityDestination): Promise<ServerMapping | undefined> {
    return clone(this.mappings.get(mappingKey({ entityType, clientEntityId, destination })));
  }

  async putReceipt(receipt: SyncReceipt): Promise<void> {
    this.assertMutable();
    this.receipts.set(receipt.eventId, clone(receipt));
  }

  async putConflict(conflict: SyncConflict): Promise<void> {
    this.assertMutable();
    this.conflictRows.set(conflict.id, clone(conflict));
  }

  async conflicts(): Promise<SyncConflict[]> {
    return clone([...this.conflictRows.values()]);
  }

  async setCursor(destination: EntityDestination, cursor: string | undefined): Promise<void> {
    this.assertMutable();
    const key = destinationKey(destination);
    if (cursor === undefined) this.cursors.delete(key);
    else this.cursors.set(key, cursor);
  }

  async cursor(destination: EntityDestination): Promise<string | undefined> {
    return this.cursors.get(destinationKey(destination));
  }

  /** Everything this transaction changed, as one delta. Empty when it wrote nothing. */
  delta(): LocalFirstDelta {
    const delta: LocalFirstDelta = {};
    const records = [...this.records.upserts()].map(([, row]) => row);
    if (records.length > 0) delta.records = records;
    const deletedRecords = [...this.records.removedKeys()].map((key) => {
      const row = this.base.records.get(key)!;
      return { entityType: row.entityType, id: row.id };
    });
    if (deletedRecords.length > 0) delta.deletedRecords = deletedRecords;
    const events = [...this.events.upserts()].map(([, event]) => event);
    if (events.length > 0) delta.events = events;
    const acknowledgedEvents = [...this.events.removedKeys()];
    if (acknowledgedEvents.length > 0) delta.acknowledgedEvents = acknowledgedEvents;
    const mappings = [...this.mappings.upserts()].map(([, row]) => row);
    if (mappings.length > 0) delta.mappings = mappings;
    const receipts = [...this.receipts.upserts()].map(([, row]) => row);
    if (receipts.length > 0) delta.receipts = receipts;
    const conflicts = [...this.conflictRows.upserts()].map(([, row]) => row);
    if (conflicts.length > 0) delta.conflicts = conflicts;
    const cursors = Object.fromEntries(this.cursors.upserts());
    if (Object.keys(cursors).length > 0) delta.cursors = cursors;
    const unsetCursors = [...this.cursors.removedKeys()];
    if (unsetCursors.length > 0) delta.unsetCursors = unsetCursors;
    if (this.nextSequence !== this.base.nextSequence) delta.nextSequence = this.nextSequence;
    return delta;
  }

  private assertMutable(): void {
    if (!this.mutable) throw new Error('read_only_local_transaction');
  }
}
