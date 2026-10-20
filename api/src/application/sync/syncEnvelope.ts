/**
 * Application — sync request envelopes: body reading and shape validation (G15).
 *
 * Everything here is decided from the request alone — no store, no auth. It is
 * the seam the push and pull use cases read through before they touch a row:
 *
 * - {@link readSyncBody}: raw request text → value, never throwing on bad JSON.
 * - {@link readPushBatch}: the push envelope (protocol version, batch/device
 *   ids, destination shape, event list, in-batch dependency order).
 * - {@link refuseBeforeInsert}: the per-event checks that refuse an event
 *   before any insert — shape, ids, operation, schema version, sequence,
 *   occurredAt (the ONE G25 gate), payload hash, destination, importer owner.
 * - {@link readPullRequest}: the pull envelope (destination, cursor, limit),
 *   with the page bounded by the ONE import bound.
 */

import { orderPushEvents } from './batchIngestPlan';
import { syncImporterFor } from './importers';
import { boundImportPage } from '../../domain/sync/importBounds';
import { occurredAtError } from '../../domain/sync/occurredAtGate';
import {
  MAX_SUPPORTED_SCHEMA_VERSION,
  SYNC_PROTOCOL_VERSION,
  hashSyncPayload,
  isJournalEventId,
  type EntityDestination,
  type LocalEntityType,
  type SyncReceipt,
} from '../../domain/sync/syncProtocol';
import type { SyncEventInput } from './syncPorts';

export const MAX_PUSH_EVENTS = 100;
export const MAX_PULL_RECORDS = 500;
const OPERATIONS = new Set(['create', 'update', 'delete', 'import']);
const DESTINATION_FIELDS = ['platformInstance', 'accountId', 'tenantId', 'projectId', 'repository'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse request text. Text that is not JSON is returned unchanged, so the
 * envelope readers refuse it as `invalid_batch` — a malformed body is a 400,
 * never a thrown 500.
 */
export function readSyncBody(text: string): unknown {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Deliberate: bad JSON becomes the raw string, which every reader refuses.
    return text;
  }
}

export function readDestination(value: unknown): EntityDestination | null {
  if (!isPlainObject(value)) return null;
  if (value.kind === 'unbound') return { kind: 'unbound' };
  if (value.kind !== 'bound') return null;
  const destination: EntityDestination = { kind: 'bound' };
  for (const key of DESTINATION_FIELDS) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string') return null;
    destination[key] = value[key];
  }
  return destination;
}

/** One pushed event after shape parsing. `shapeError` refuses it later, per event. */
export interface ParsedEvent {
  eventId: string;
  clientEntityId: string;
  entityType: string;
  operation: string;
  schemaVersion: number;
  localSequence: number;
  occurredAt: string;
  baseVersion?: number;
  dependsOn: string[];
  destination: EntityDestination | null;
  payload: unknown;
  payloadHash: string;
  deadLetter: boolean;
  shapeError: string | null;
}

export interface PushBatch {
  batchId: string;
  deviceId: string;
  destination: EntityDestination;
  /** Input order — receipts are answered in this order. */
  events: ParsedEvent[];
  /** Apply order — in-batch `dependsOn` edges first. */
  ordered: ParsedEvent[];
}

/**
 * Dependency ids with blanks dropped and whitespace trimmed; `null` when the
 * field is not a list of strings. (The rule `dependencyPark` carried.)
 */
function dependencyIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return null;
    const trimmed = entry.trim();
    if (trimmed !== '') ids.push(trimmed);
  }
  return ids;
}

function parseEvent(value: unknown): ParsedEvent | 'missing_id' {
  if (!isPlainObject(value) || typeof value.eventId !== 'string' || value.eventId.trim() === '') {
    return 'missing_id';
  }
  const dependsOn = dependencyIds(value.dependsOn);
  const destination = readDestination(value.destination);
  const shapeError = dependsOn === null || destination === null
    || typeof value.clientEntityId !== 'string'
    || typeof value.entityType !== 'string'
    || typeof value.operation !== 'string'
    || typeof value.schemaVersion !== 'number'
    || typeof value.localSequence !== 'number'
    || typeof value.occurredAt !== 'string'
    || typeof value.payloadHash !== 'string'
    || (value.baseVersion !== undefined && typeof value.baseVersion !== 'number')
    ? 'invalid_event'
    : null;
  return {
    eventId: value.eventId,
    clientEntityId: typeof value.clientEntityId === 'string' ? value.clientEntityId : '',
    entityType: typeof value.entityType === 'string' ? value.entityType : '',
    operation: typeof value.operation === 'string' ? value.operation : '',
    schemaVersion: typeof value.schemaVersion === 'number' ? value.schemaVersion : Number.NaN,
    localSequence: typeof value.localSequence === 'number' ? value.localSequence : Number.NaN,
    occurredAt: typeof value.occurredAt === 'string' ? value.occurredAt : '',
    ...(typeof value.baseVersion === 'number' ? { baseVersion: value.baseVersion } : {}),
    dependsOn: dependsOn ?? [],
    destination,
    payload: value.payload,
    payloadHash: typeof value.payloadHash === 'string' ? value.payloadHash : '',
    deadLetter: value.deadLetter != null,
    shapeError,
  };
}

export type ReadPushBatchResult = { ok: true; batch: PushBatch } | { ok: false; code: string };

/** Read the push envelope. A failure here is a 400 and applies nothing. */
export function readPushBatch(body: unknown): ReadPushBatchResult {
  if (!isPlainObject(body)) return { ok: false, code: 'invalid_batch' };
  if (body.protocolVersion !== SYNC_PROTOCOL_VERSION) return { ok: false, code: 'protocol_version_unsupported' };
  if (typeof body.batchId !== 'string' || body.batchId.trim() === '' || body.batchId.length > 128) {
    return { ok: false, code: 'invalid_batch' };
  }
  if (typeof body.deviceId !== 'string' || body.deviceId.trim() === '' || body.deviceId.length > 128) {
    return { ok: false, code: 'invalid_batch' };
  }
  const destination = readDestination(body.destination);
  if (!destination) return { ok: false, code: 'invalid_batch' };
  if (!Array.isArray(body.events)) return { ok: false, code: 'invalid_batch' };
  if (body.events.length > MAX_PUSH_EVENTS) return { ok: false, code: 'batch_too_large' };

  const events: ParsedEvent[] = [];
  for (const raw of body.events) {
    const parsed = parseEvent(raw);
    if (parsed === 'missing_id') return { ok: false, code: 'invalid_batch' };
    events.push(parsed);
  }
  const ordered = orderPushEvents(events);
  if (!ordered.ok) return { ok: false, code: ordered.reason };
  return {
    ok: true,
    batch: { batchId: body.batchId, deviceId: body.deviceId, destination, events, ordered: ordered.events },
  };
}

export function receipt(
  eventId: string,
  status: SyncReceipt['status'],
  receivedAt: string,
  extra?: { serverId?: string | null; serverVersion?: number | null; detail?: string | null },
): SyncReceipt {
  const row: SyncReceipt = { eventId, status, receivedAt };
  if (extra?.serverId) row.serverId = extra.serverId;
  if (typeof extra?.serverVersion === 'number') row.serverVersion = extra.serverVersion;
  if (extra?.detail) row.detail = extra.detail;
  return row;
}

/**
 * The per-event refusals that need no store. Runs AFTER the replay lookup (a
 * replay is answered from its receipt) and BEFORE any insert. `destinationKeyOf`
 * normalises the event's own destination the same way the batch's was, so an
 * omitted tenant and the explicit one compare equal.
 */
export function refuseBeforeInsert(
  event: ParsedEvent,
  batchDestinationKey: string,
  destinationKeyOf: (destination: EntityDestination) => string | null,
  now: Date,
): SyncReceipt | null {
  const receivedAt = now.toISOString();
  const refuse = (detail: string) => receipt(event.eventId, 'rejected', receivedAt, { detail });
  if (event.shapeError) return refuse(event.shapeError);
  if (event.deadLetter) return refuse('dead_letter');
  if (!isJournalEventId(event.eventId) || !isJournalEventId(event.clientEntityId)) return refuse('event_id_invalid');
  if (!event.dependsOn.every((id) => isJournalEventId(id))) return refuse('depends_on_invalid');
  if (!OPERATIONS.has(event.operation)) return refuse('operation_unsupported');
  if (!Number.isInteger(event.schemaVersion) || event.schemaVersion < 1 || event.schemaVersion > MAX_SUPPORTED_SCHEMA_VERSION) {
    return refuse('schema_version_unsupported');
  }
  if (!Number.isSafeInteger(event.localSequence)) return refuse('invalid_event');
  const clock = occurredAtError(event.occurredAt, now);
  if (clock) return refuse(clock);
  if (event.payloadHash !== hashSyncPayload(event.payload)) return refuse('payload_hash_mismatch');
  if (!event.destination || destinationKeyOf(event.destination) !== batchDestinationKey) {
    return refuse('destination_mismatch');
  }
  if (syncImporterFor(event.entityType) === null) return refuse('entity_type_rejected');
  return null;
}

/** The wire event an importer sees, carrying the NORMALISED destination. */
export function asSyncEvent(event: ParsedEvent, destination: EntityDestination): SyncEventInput {
  return {
    eventId: event.eventId,
    clientEntityId: event.clientEntityId,
    entityType: event.entityType as LocalEntityType,
    operation: event.operation as SyncEventInput['operation'],
    schemaVersion: event.schemaVersion,
    localSequence: event.localSequence,
    occurredAt: event.occurredAt,
    ...(event.baseVersion !== undefined ? { baseVersion: event.baseVersion } : {}),
    dependsOn: [...event.dependsOn],
    destination,
    payload: event.payload,
    payloadHash: event.payloadHash,
  };
}

export interface PullRequest {
  destination: EntityDestination;
  /** A non-blank cursor string, or null to start a snapshot. */
  cursor: string | null;
  /** A cursor field that is present but not a string — answered with a resnapshot. */
  cursorMalformed: boolean;
  limit: number;
}

export type ReadPullRequestResult = { ok: true; request: PullRequest } | { ok: false; code: string };

/**
 * Read the pull envelope. A limit that is not a positive integer is a 400; a
 * limit above the server page is clamped by {@link boundImportPage}, never
 * served unbounded.
 */
export function readPullRequest(body: unknown): ReadPullRequestResult {
  if (!isPlainObject(body)) return { ok: false, code: 'invalid_batch' };
  const destination = readDestination(body.destination);
  if (!destination) return { ok: false, code: 'invalid_batch' };
  let requested: number | undefined;
  if (body.limit !== undefined) {
    if (typeof body.limit !== 'number' || !Number.isInteger(body.limit) || body.limit < 1) {
      return { ok: false, code: 'invalid_limit' };
    }
    requested = body.limit;
  }
  const raw = body.cursor;
  const blank = raw == null || (typeof raw === 'string' && raw.trim() === '');
  return {
    ok: true,
    request: {
      destination,
      cursor: !blank && typeof raw === 'string' ? raw : null,
      cursorMalformed: !blank && typeof raw !== 'string',
      limit: boundImportPage(requested, MAX_PULL_RECORDS),
    },
  };
}
