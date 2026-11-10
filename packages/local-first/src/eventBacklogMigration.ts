/**
 * ONE-TIME migration of the journal's EVENT backlog (2026-11-10): payload copies become markers.
 *
 * Two kinds of event used to carry a full copy of a row's payload that the row itself already
 * holds, parsed on every open:
 *   - UNBOUND writes (before the marker rule of 2026-11-01, `journalRules.ts`): never sent — the
 *     coordinator refuses the unbound partition and a later bind replaces them with ONE import
 *     read from the record. A measured store held 23.5k such message events (47 MB).
 *   - BOUND `import`s (before record-payload markers, `recordPayloadMarker.ts`): an import IS the
 *     row as it is when sent, and the coordinator now reads it from the record at push time.
 *
 * The plan, computed from a committed snapshot (pure; the host appends it as ordinary delta
 * frames, so every reader of the journal applies it like any commit):
 *   - STRIP unbound: an unbound event of a marker-written type whose payload is EXACTLY its row's
 *     becomes the unbound marker the live write path writes (same id, sequence, key, deps).
 *   - STRIP bound: a pending bound `import` of a sync-bound type — never held, never materialized
 *     by this build — whose payload is EXACTLY what it would be sent with now (`importPayload` of
 *     the row and its binding) becomes a FENCED record-payload marker, and its partition gets its
 *     fence event. A held or materialized import was sent: the server holds its hash, so its copy
 *     is kept (a resend must carry the same bytes).
 *   - KEEP anything whose payload differs from the row — nothing is dropped unverified.
 *   - DROP (orphan): such an event whose row no longer exists (or, for an import, is deleted).
 *   - DROP (acknowledged): any event the store holds an `accepted` / `duplicate` receipt for.
 *
 * ONE-TIME: the last delta records `EVENT_BACKLOG_MIGRATED` in the store's cursors, and a store
 * carrying it is never planned again — so a later open can never re-mark an event this build sent
 * (a materialized import whose response was lost would otherwise go back to a marker, be filled
 * from a row that moved on, and be refused `event_payload_mismatch` on resend).
 *
 * RESIDUAL RISK (older builds): an import an OLDER build sent whose response it lost carries no
 * `materializedAt` and no hold, so this one migration can mark it. It is re-filled from the row;
 * only if that row changed since the older build's send does the resend carry a different hash
 * (`event_payload_mismatch`, dead-lettered — re-queueable as a new import of the row). The window
 * is one migration over imports in flight at that instant.
 */

import type { LocalFirstDelta } from './localFirstDelta.js';
import type { LocalFirstSnapshot } from './storeContract.js';
import { destinationKey, normalizeServerMapping, type EntityDestination, type JournalEvent, type LocalEntityType, type LocalRecord, type ServerMapping } from './records.js';
import { importPayload, unboundMarkerFields } from './journalRules.js';
import { SYNC_PASS_BIND_TYPES } from './dependencyGraph.js';
import { fencedDependsOn, isRecordPayloadFence, isRecordPayloadMarker, recordPayloadFenceEvent, recordPayloadMarker } from './recordPayloadMarker.js';
import { hashPayload } from './payloadHash.js';
import { mappingKey } from './storeState.js';

/** Types whose live unbound writes are markers (`journalWrite`): their old payload copies migrate. */
export const MARKER_WRITTEN_TYPES: ReadonlySet<LocalEntityType> = new Set<LocalEntityType>([
  'chat', 'message', 'usage', 'chat-ticket-link', 'attachment-manifest',
]);

/** Events per migration delta: each is one bounded journal frame. */
export const EVENT_MIGRATION_SLICE = 2000;

/**
 * The cursor key that records the migration ran (its value: when). A destination key never
 * contains `@`, so it collides with no pull cursor.
 */
export const EVENT_BACKLOG_MIGRATED = 'migration@event-backlog-v1';

export interface EventBacklogMigrationPlan {
  /** The deltas to commit, in order. Empty when there is nothing to do (or it already ran). */
  readonly deltas: readonly LocalFirstDelta[];
  /** Payload copies turned into markers (unbound and bound). */
  readonly stripped: number;
  /** Events dropped: orphans and acknowledged leftovers. */
  readonly dropped: number;
  /** Payload-carrying candidates kept because their payload is not the row's (or was sent). */
  readonly kept: number;
  /** The ids of the events turned into markers: the host keeps its backup until they have synced. */
  readonly markedEventIds: readonly string[];
}

/** Whether the store already ran the migration. */
export function eventBacklogMigrated(snapshot: Pick<LocalFirstSnapshot, 'cursors'>): boolean {
  return (snapshot.cursors ?? {})[EVENT_BACKLOG_MIGRATED] !== undefined;
}

const carriesPayload = (event: JournalEvent): boolean =>
  event.payload !== null && event.payload !== undefined && !isRecordPayloadMarker(event);

const unboundCandidate = (event: JournalEvent): boolean =>
  event.destination?.kind === 'unbound' && MARKER_WRITTEN_TYPES.has(event.entityType) && carriesPayload(event);

const boundCandidate = (event: JournalEvent): boolean =>
  event.destination?.kind === 'bound' && event.operation === 'import' && SYNC_PASS_BIND_TYPES.has(event.entityType)
  && carriesPayload(event) && !event.deadLetter && event.materializedAt === undefined && (event.holdAttempts ?? 0) === 0;

const sameJson = (a: unknown, b: unknown): boolean => (JSON.stringify(a) ?? 'null') === (JSON.stringify(b) ?? 'null');

const EMPTY: EventBacklogMigrationPlan = { deltas: [], stripped: 0, dropped: 0, kept: 0, markedEventIds: [] };

export function planEventBacklogMigration(
  snapshot: Pick<LocalFirstSnapshot, 'records' | 'events' | 'receipts'> & Partial<Pick<LocalFirstSnapshot, 'mappings' | 'cursors' | 'nextSequence'>>,
  options: { slice?: number; at?: string; newId?: () => string } = {},
): EventBacklogMigrationPlan {
  if (eventBacklogMigrated({ cursors: snapshot.cursors ?? {} })) return EMPTY;
  const slice = options.slice ?? EVENT_MIGRATION_SLICE;
  const at = options.at ?? new Date().toISOString();
  const settled = new Set<string>();
  for (const receipt of snapshot.receipts) {
    if (receipt.status === 'accepted' || receipt.status === 'duplicate') settled.add(receipt.eventId);
  }
  const candidates = snapshot.events.filter((event) => settled.has(event.eventId) || unboundCandidate(event) || boundCandidate(event));
  // Only the rows a candidate names are looked up: no index of the whole store.
  const wanted = new Set(candidates.map((event) => `${event.entityType}:${event.clientEntityId}`));
  const rows = new Map<string, LocalRecord>();
  for (const record of snapshot.records) {
    const key = `${record.entityType}:${record.id}`;
    if (wanted.has(key)) rows.set(key, record);
  }
  const mappings = new Map<string, ServerMapping>();
  for (const raw of snapshot.mappings ?? []) {
    const mapping = normalizeServerMapping(raw);
    mappings.set(mappingKey(mapping), mapping);
  }

  const markers: JournalEvent[] = [];
  const drops: string[] = [];
  const fenced = new Map<string, EntityDestination>();
  let kept = 0;
  for (const event of candidates) {
    if (settled.has(event.eventId)) {
      drops.push(event.eventId);
      continue;
    }
    const row = rows.get(`${event.entityType}:${event.clientEntityId}`);
    if (event.destination.kind === 'unbound') {
      if (!row) {
        drops.push(event.eventId);
        continue;
      }
      // Verified equal, byte for byte, before the copy is let go.
      if (!sameJson(row.payload, event.payload)) kept += 1;
      else markers.push({ ...event, ...unboundMarkerFields(row.payload) } as JournalEvent);
      continue;
    }
    if (!row || row.deletedAt) {
      drops.push(event.eventId);
      continue;
    }
    const mapping = mappings.get(mappingKey({ entityType: row.entityType, clientEntityId: row.id, destination: row.destination }));
    if (!sameJson(importPayload(row, mapping), event.payload)) {
      kept += 1;
      continue;
    }
    fenced.set(destinationKey(event.destination), event.destination);
    markers.push({ ...event, ...recordPayloadMarker(), dependsOn: fencedDependsOn(event.dependsOn), payloadHash: hashPayload(null) } as JournalEvent);
  }

  // Each partition that now holds markers gets its fence (unless it has one).
  let nextSequence = snapshot.nextSequence
    ?? 1 + snapshot.events.reduce((highest, event) => Math.max(highest, event.localSequence), 0);
  const fences: JournalEvent[] = [];
  const hasFence = new Set(snapshot.events.filter(isRecordPayloadFence).map((event) => destinationKey(event.destination)));
  const newId = options.newId ?? (() => crypto.randomUUID());
  for (const [key, destination] of fenced) {
    if (hasFence.has(key)) continue;
    fences.push(recordPayloadFenceEvent(destination, newId(), nextSequence, at));
    nextSequence += 1;
  }

  const deltas: LocalFirstDelta[] = [];
  for (let start = 0; start < drops.length; start += slice) deltas.push({ acknowledgedEvents: drops.slice(start, start + slice) });
  // The fences land before (or with) the first markers that depend on them.
  if (fences.length > 0) deltas.push({ events: fences, nextSequence });
  for (let start = 0; start < markers.length; start += slice) deltas.push({ events: markers.slice(start, start + slice) });
  // The one-time flag rides the LAST frame: a kill before it leaves the rest for the next open.
  deltas.push({ cursors: { [EVENT_BACKLOG_MIGRATED]: at } });
  return { deltas, stripped: markers.length, dropped: drops.length, kept, markedEventIds: markers.map((event) => event.eventId) };
}
