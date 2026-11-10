/**
 * One transaction over a `CommittedState`: a copy-on-write DRAFT.
 *
 * Writes land in per-map overlays (`DraftMap`); reads consult the overlay first and fall
 * through to the long-lived committed Maps, so opening a transaction costs nothing in the
 * size of the store. Nothing here touches committed state — `delta()` reads the overlays
 * out as one `LocalFirstDelta`, and the store applies it (after its commit hook has made
 * it durable) or drops the transaction. A `work` that throws therefore publishes nothing.
 */

import { destinationKey, earliestMapping, normalizeServerMapping, type EntityDestination, type EntityScope, type JournalEvent, type LocalEntityType, type LocalRecord, type ServerMapping, type ServerMappingInput, type SyncConflict, type SyncReceipt } from './records.js';
import { parseEntityRef, parseSyncId, syncIdText, tierRefText } from './entityId.js';
import type { LocalFirstDelta } from './localFirstDelta.js';
import { DraftMap } from './draftMap.js';
import { CommittedState, PendingCounts, PendingEntityIndex, PendingKeyIndex, mappingKey, recordKey } from './storeState.js';
import { isJournalEventId, SCAN_STOP, type AppendJournalEvent, type LocalFirstTransaction, type PendingCount, type PendingLookup, type ScanPendingVisit, type ScanVisit } from './storeContract.js';
import { isRecordPayloadMarker, materializedEvent } from './recordPayloadMarker.js';
import { draftPendingCount, draftPendingLookup, visitPendingOf, type DraftPendingSources } from './draftPending.js';
import { clone } from './clone.js';
import { hashPayload } from './payloadHash.js';
import { indexKeyOf, type RecordIndex, type RecordIndexKey } from './recordIndex.js';

/**
 * The last-pull instant is stored beside the cursor, in the same map, under a key no
 * destination key can equal (a destination key never contains `@`, which `encodeURIComponent`
 * escapes), so it rides the existing delta / snapshot / journal paths unchanged.
 */
const lastPullKey = (destKey: string): string => `lastPullAt@${destKey}`;
/** A read mark (`setReadMark`) lives in the same map, under its own prefix. */
const readMarkKey = (key: string): string => `readMark@${key}`;

export class Transaction implements LocalFirstTransaction {
  private readonly records: DraftMap<LocalRecord>;
  private readonly events: DraftMap<JournalEvent>;
  private readonly mappings: DraftMap<ServerMapping>;
  private readonly receipts: DraftMap<SyncReceipt>;
  private readonly conflictRows: DraftMap<SyncConflict>;
  private readonly cursors: DraftMap<string>;
  /** Events THIS transaction appended, by key. Committed events are found in `base.pendingKeys`. */
  private readonly addedKeys = new PendingKeyIndex();
  /** Events THIS transaction appended, by row. Committed ones are in `base.pendingEntities`. */
  private readonly addedEntities = new PendingEntityIndex();
  /** What this draft changed in the per-partition counts (may be negative). */
  private readonly draftCounts = new PendingCounts();
  private nextSequence: number;
  /** The highest `mappedSeq` as of this transaction (committed, plus what it wrote). */
  private maxMappedSeq: number;

  constructor(private readonly base: CommittedState, private readonly mutable: boolean) {
    this.maxMappedSeq = base.maxMappedSeq;
    this.records = new DraftMap(base.records);
    this.events = new DraftMap(base.events);
    this.mappings = new DraftMap(base.mappings);
    this.receipts = new DraftMap(base.receipts);
    this.conflictRows = new DraftMap(base.conflicts);
    this.cursors = new DraftMap(base.cursors);
    this.nextSequence = base.nextSequence;
    // The pending events through the store's indexes, as this draft sees them (`draftPending.ts`).
    this.pendingSources = {
      current: (eventId) => this.events.get(eventId),
      committed: base,
      added: { entities: this.addedEntities, keys: this.addedKeys, counts: this.draftCounts },
    };
  }

  private readonly pendingSources: DraftPendingSources;

  async get<T>(entityType: LocalEntityType, id: string): Promise<LocalRecord<T> | undefined> {
    return clone(this.records.get(recordKey(entityType, id))) as LocalRecord<T> | undefined;
  }

  async list<T>(entityType?: LocalEntityType): Promise<LocalRecord<T>[]> {
    const rows: LocalRecord[] = [];
    await this.scan(entityType, (row) => { rows.push(row); });
    return clone(rows) as LocalRecord<T>[];
  }

  async scan<T>(entityType: LocalEntityType | undefined, visit: ScanVisit<T>): Promise<void> {
    if (entityType === undefined) {
      for (const record of this.records.values()) {
        if (visit(record as LocalRecord<T>) === SCAN_STOP) return;
      }
      return;
    }
    // Indexed path: read ONLY this type's rows (the per-type index names them in
    // committed order), never the other types'. Committed rows keep their order; rows
    // the draft DELETED or RELOCATED (delete + set again, so the base no longer yields
    // them) are skipped here and visited below, exactly where `values` would put them —
    // so a typed scan yields in `list` order, same as the old walk-everything loop.
    // The tail below reads ONLY the draft's tail upserts (isTailKey): iterating
    // `values()` here would re-yield the base rows the indexed pass already visited.
    const rows = this.base.typeRows(entityType);
    if (this.records.untouched) {
      // A read (or a transaction that wrote no row): the committed rows ARE the answer.
      for (const record of rows?.values() ?? []) {
        if (visit(record as LocalRecord<T>) === SCAN_STOP) return;
      }
      return;
    }
    if (rows) {
      for (const id of rows.keys()) {
        const key = recordKey(entityType, id);
        if (this.records.isTailKey(key)) continue;
        const record = this.records.get(key);
        if (record && visit(record as LocalRecord<T>) === SCAN_STOP) return;
      }
    }
    for (const [key, record] of this.records.upserts()) {
      if (this.records.isTailKey(key) && record.entityType === entityType && visit(record as LocalRecord<T>) === SCAN_STOP) return;
    }
  }

  async scanIndex<T>(index: RecordIndex<T>, key: RecordIndexKey, visit: ScanVisit<T>): Promise<void> {
    const group = this.base.indexGroup(index as RecordIndex, key);
    if (this.records.untouched) {
      for (const record of group?.values() ?? []) {
        if (visit(record as LocalRecord<T>) === SCAN_STOP) return;
      }
      return;
    }
    // The committed group as this draft sees it: rows it deleted, re-filed elsewhere or moved
    // to its tail are skipped here; rows it ADDED to the group (new, relocated, or updated
    // into it) follow. Order is unspecified by contract.
    const matches = (record: LocalRecord): boolean => indexKeyOf(index as RecordIndex, record) === key;
    if (group) {
      for (const [id, committed] of group) {
        const recordId = recordKey(index.entityType, id);
        if (this.records.isTailKey(recordId)) continue;
        const record = this.records.get(recordId);
        if (!record || (record !== committed && !matches(record))) continue;
        if (visit(record as LocalRecord<T>) === SCAN_STOP) return;
      }
    }
    for (const [recordId, record] of this.records.upserts()) {
      if (record.entityType !== index.entityType || !matches(record)) continue;
      if (!this.records.isTailKey(recordId) && group?.has(record.id)) continue; // visited above, in place
      if (visit(record as LocalRecord<T>) === SCAN_STOP) return;
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
      dependsOn: [...new Set(event.dependsOn)],
      localSequence: this.nextSequence,
      payloadHash: event.payloadHash ?? hashPayload(event.payload),
    };
    this.nextSequence += 1;
    this.events.set(stored.eventId, stored);
    this.addedKeys.add(stored);
    this.addedEntities.add(stored);
    this.draftCounts.add(stored);
    return clone(stored);
  }

  /** The pending event a key names, as of this transaction (committed minus acknowledged, plus appended). */
  private pendingForKey(key: string): JournalEvent | undefined {
    const live = (event: JournalEvent): boolean => !event.deadLetter && this.events.get(event.eventId) === event;
    return this.addedKeys.latest(key, live) ?? this.base.pendingKeys.latest(key, live);
  }

  async pending(destination?: EntityDestination): Promise<JournalEvent[]> {
    const rows: JournalEvent[] = [];
    await this.scanPending((event) => { rows.push(event); }, destination);
    rows.sort((a, b) => a.localSequence - b.localSequence);
    return clone(rows);
  }

  async scanPending(visit: ScanPendingVisit, destination?: EntityDestination): Promise<void> {
    const key = destination ? destinationKey(destination) : undefined;
    for (const event of this.events.values()) {
      if (!key || destinationKey(event.destination) === key) {
        if (visit(event) === SCAN_STOP) return;
      }
    }
  }

  async scanPendingOf(clientEntityId: string, visit: ScanPendingVisit, destination?: EntityDestination): Promise<void> {
    visitPendingOf(this.pendingSources, clientEntityId, visit, destination ? destinationKey(destination) : undefined);
  }

  pendingCount(destination?: EntityDestination): PendingCount {
    return draftPendingCount(this.pendingSources, destination);
  }

  pendingLookup(): PendingLookup {
    return draftPendingLookup(this.pendingSources);
  }

  async acknowledge(eventIds: readonly string[]): Promise<void> {
    this.assertMutable();
    for (const id of eventIds) {
      const event = this.events.get(id);
      if (!event) continue;
      this.events.delete(id);
      this.addedKeys.remove(event);
      this.draftCounts.remove(event);
    }
  }

  async deadLetter(eventId: string, reason: string, at: string): Promise<void> {
    this.assertMutable();
    const event = this.events.get(eventId);
    if (!event || event.deadLetter) return;
    const dead = { ...event, deadLetter: { reason, at } };
    this.events.set(eventId, dead);
    this.draftCounts.remove(event);
    this.draftCounts.add(dead);
  }

  async materializeEvent(eventId: string, payload: unknown): Promise<JournalEvent | undefined> {
    this.assertMutable();
    const event = this.events.get(eventId);
    if (!event || !isRecordPayloadMarker(event)) return undefined;
    const materialized = materializedEvent(event, payload);
    this.events.set(eventId, materialized);
    if (materialized.idempotencyKey !== undefined) this.addedKeys.add(materialized);
    return clone(materialized);
  }

  async hold(eventId: string, hold: { holdKind?: string; holdAttempts: number; heldSince: string; nextAttemptAt: string }): Promise<void> {
    this.assertMutable();
    const event = this.events.get(eventId);
    if (!event) return;
    const held = { ...event, ...hold };
    this.events.set(eventId, held);
    // The key index finds events by identity (`live`), so a replaced object must be re-registered
    // or the held event would vanish from `pendingForKey` for the rest of this transaction.
    if (event.idempotencyKey !== undefined) this.addedKeys.add(held);
  }

  async putMapping(input: ServerMappingInput): Promise<void> {
    this.assertMutable();
    const normal = normalizeServerMapping(clone(input));
    const key = mappingKey(normal);
    // `mappedSeq` is when this device FIRST mapped the entity: an update keeps it, so the earliest
    // mapping of a SyncId never moves; a new row takes the next one.
    const mappedSeq = normal.mappedSeq ?? this.mappings.get(key)?.mappedSeq ?? this.maxMappedSeq + 1;
    if (mappedSeq > this.maxMappedSeq) this.maxMappedSeq = mappedSeq;
    this.mappings.set(key, normal.mappedSeq === mappedSeq ? normal : { ...normal, mappedSeq });
  }

  async mapping(entityType: LocalEntityType, clientEntityId: string, destination: EntityDestination): Promise<ServerMapping | undefined> {
    return clone(this.mappings.get(mappingKey({ entityType, clientEntityId, destination })));
  }

  async mappingByServerId(entityType: LocalEntityType, serverId: string | number, scope?: EntityScope): Promise<ServerMapping | undefined> {
    const syncId = parseSyncId(serverId);
    if (syncId !== null) {
      // A row carrying the SyncId wins. Failing that, a row whose server said "not a SyncId of this
      // type" (`syncId: null`, a run step) but whose key text is this number: the same server row,
      // so an ingest of it must land on that row, not mint a second LocalId.
      const text = syncIdText(syncId);
      return this.earliestInScope(entityType, scope, (mapping) => mapping.syncId === syncId)
        ?? this.earliestInScope(entityType, scope, (mapping) => (mapping.syncId ?? null) === null && mapping.serverId === text);
    }
    if (typeof serverId !== 'string' || serverId.trim() === '') return undefined;
    const tier = parseEntityRef(serverId);
    const externalRef = tier && 'tier' in tier ? tierRefText(tier.tier) : undefined;
    return this.earliestInScope(entityType, scope, (mapping) =>
      mapping.serverId === serverId || (externalRef !== undefined && mapping.externalRef === externalRef));
  }

  async mappingByExternalRef(entityType: LocalEntityType, externalRef: string, scope?: EntityScope): Promise<ServerMapping | undefined> {
    if (typeof externalRef !== 'string' || externalRef.trim() === '') return undefined;
    return this.earliestInScope(entityType, scope, (mapping) => mapping.externalRef === externalRef);
  }

  /** The EARLIEST (`compareMappingAge`) mapping of `entityType` inside `scope` that `match` accepts. */
  private earliestInScope(
    entityType: LocalEntityType,
    scope: EntityScope | undefined,
    match: (mapping: ServerMapping) => boolean,
  ): ServerMapping | undefined {
    return clone(earliestMapping(this.mappings.values(), entityType, scope, match));
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

  async setCursor(destination: EntityDestination, cursor: string | undefined, pulledAt?: string): Promise<void> {
    this.assertMutable();
    const key = destinationKey(destination);
    if (cursor === undefined) this.cursors.delete(key);
    else this.cursors.set(key, cursor);
    // `pulledAt` given: that pull completed, whatever cursor it left. Both absent is the
    // resnapshot / reset path: the pull state is cleared together.
    if (pulledAt !== undefined) this.cursors.set(lastPullKey(key), pulledAt);
    else if (cursor === undefined) this.cursors.delete(lastPullKey(key));
  }

  async cursor(destination: EntityDestination): Promise<string | undefined> {
    return this.cursors.get(destinationKey(destination));
  }

  async lastPullAt(destination: EntityDestination): Promise<string | undefined> {
    return this.cursors.get(lastPullKey(destinationKey(destination)));
  }

  async setReadMark(key: string, at: string | undefined): Promise<void> {
    this.assertMutable();
    if (at === undefined) this.cursors.delete(readMarkKey(key));
    else this.cursors.set(readMarkKey(key), at);
  }

  async readMark(key: string): Promise<string | undefined> {
    return this.cursors.get(readMarkKey(key));
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
