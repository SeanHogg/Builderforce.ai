/**
 * Presentation — sync batch routes (G15).
 *
 * Not registered on the app. No fetch, no route-index edit. The caller
 * supplies a router. `mountSyncBatch` still registers POST /sync/batch.
 * `mountSyncPushPull` registers POST /api/sync/v1/push and
 * POST /api/sync/v1/pull.
 *
 * An accepted push is applied by the named importer for that entity type
 * (`importSyncedTicket`, `importSyncedProject`, or `importMirrorRecord`).
 * There is no generic payload writer: an unknown type is a rejected receipt
 * and nothing is inserted. The sync port then stores the mapping, projection,
 * change row, and receipt inside one transaction.
 *
 * A non-object body — a string such as "nope", null, a primitive — is not
 * passed to `JSON.parse`. That parse throws on text that is not JSON, and
 * neither `apply` nor an importer runs for a body the handler refuses.
 */

import { orderPushEvents } from '../../application/sync/batchIngestPlan';
import { rejectInvalidOccurredAt } from '../../application/sync/occurredAtGate';
import {
  importMirrorRecord,
  importSyncedProject,
  importSyncedTicket,
  syncImporterFor,
  type BoundedImportOutcome,
} from '../../application/sync/importers';
import type {
  StoredSyncEvent,
  SyncAuthContext,
  SyncEventInput,
  SyncImportContext,
  SyncRecordRow,
  SyncStoreSet,
  SyncStores,
} from '../../application/sync/syncPorts';
import {
  CLIENT_REPORTED_EVIDENCE,
  MAX_SUPPORTED_SCHEMA_VERSION,
  SYNC_PROTOCOL_VERSION,
  decodeSyncCursor,
  destinationBindingError,
  destinationKey,
  encodeSyncCursor,
  hashSyncPayload,
  type EntityDestination,
  type LocalEntityType,
  type LocalRecord,
  type SyncPullResult,
  type SyncReceipt,
} from '../../domain/sync/syncProtocol';
import type { Db } from '../../infrastructure/database/connection';
import {
  handleSyncBatch,
  type SyncBatchDeps,
  type SyncBatchResult,
} from './syncBatchHandler';

/** The only router surface this mount needs. A test fake records method and path. */
export interface SyncBatchRouter {
  post(path: string, handler: (body: unknown) => SyncBatchResult<unknown>): void;
}

function looksLikeJsonText(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

/**
 * Read a JSON body without throwing.
 *
 * A string that is not object or array JSON is returned as-is so it is never
 * handed to `JSON.parse`. An already-parsed value (including `{}`) is the
 * body. A `{ json() }` or `{ req: { json() } }` source is read when that
 * call returns a value rather than a promise.
 */
export function readSyncBatchBody(input: unknown): unknown {
  if (typeof input === 'string') {
    if (!looksLikeJsonText(input)) return input;
    try {
      return JSON.parse(input) as unknown;
    } catch {
      return input;
    }
  }
  if (typeof input !== 'object' || input === null) return input;

  const source = input as { json?: () => unknown; req?: { json?: () => unknown } };
  const read = typeof source.json === 'function'
    ? source.json.bind(source)
    : typeof source.req?.json === 'function'
      ? source.req.json.bind(source.req)
      : null;
  if (!read) return input;
  try {
    const parsed = read();
    if (parsed instanceof Promise) return input;
    return parsed;
  } catch {
    return input;
  }
}

/** Register POST /sync/batch. Does not mount the route on the application. */
export function mountSyncBatch<E>(router: SyncBatchRouter, deps: SyncBatchDeps<E>): void {
  router.post('/sync/batch', (body) => handleSyncBatch(readSyncBatchBody(body), deps));
}

export const SYNC_PUSH_PATH = '/api/sync/v1/push';
export const SYNC_PULL_PATH = '/api/sync/v1/pull';

const MAX_PUSH_EVENTS = 100;
const MAX_PULL_RECORDS = 500;
const OPERATIONS = new Set(['create', 'update', 'delete', 'import']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DESTINATION_FIELDS = ['platformInstance', 'accountId', 'tenantId', 'projectId', 'repository'] as const;

/** The three importers a push may call. There is no fourth, generic writer. */
export interface SyncNamedImporters {
  importSyncedTicket: SyncMutationImporter;
  importSyncedProject: SyncMutationImporter;
  importMirrorRecord: SyncMutationImporter;
}

export type SyncMutationImporter = (
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
) => Promise<BoundedImportOutcome>;

export interface SyncPushPullDeps {
  auth: SyncAuthContext;
  now: Date;
  stores: SyncStores;
  importers: SyncNamedImporters;
  resolveProjectId?: (reference: string) => Promise<number | null>;
  resolveTaskId?: (reference: string) => Promise<number | null>;
}

export type SyncPushResponse =
  | { ok: false; status: 400; code: string }
  | { ok: true; status: 200; receipts: SyncReceipt[] };

export type SyncPullResponse =
  | { ok: false; status: 400; code: string }
  | { ok: true; status: 200; result: SyncPullResult };

export interface SyncV1Router {
  post(path: string, handler: (body: unknown) => Promise<SyncPushResponse | SyncPullResponse>): void;
}

interface ParsedEvent {
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

interface ValidBatch {
  batchId: string;
  deviceId: string;
  destination: EntityDestination;
  events: ParsedEvent[];
  ordered: ParsedEvent[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: string): boolean {
  return UUID.test(value);
}

function readDestination(value: unknown): EntityDestination | null {
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

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return null;
    ids.push(entry);
  }
  return ids;
}

function parseEvent(value: unknown): ParsedEvent | 'missing_id' {
  if (!isPlainObject(value) || typeof value.eventId !== 'string' || value.eventId.trim() === '') {
    return 'missing_id';
  }
  const dependsOn = stringList(value.dependsOn);
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

function readPushBatch(body: unknown, auth: SyncAuthContext): { ok: true; batch: ValidBatch } | { ok: false; code: string } {
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
  const binding = destinationBindingError(destination, auth);
  if (binding) return { ok: false, code: binding };
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

function receipt(
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

function replayReceipt(eventId: string, existing: StoredSyncEvent): SyncReceipt {
  const status = existing.status === 'accepted' ? 'duplicate' : existing.status;
  return receipt(eventId, status, existing.receivedAt.toISOString(), existing);
}

function refuseBeforeInsert(event: ParsedEvent, batch: ValidBatch, now: Date): SyncReceipt | null {
  const receivedAt = now.toISOString();
  if (event.shapeError) return receipt(event.eventId, 'rejected', receivedAt, { detail: event.shapeError });
  if (event.deadLetter) return receipt(event.eventId, 'rejected', receivedAt, { detail: 'dead_letter' });
  if (!isUuid(event.eventId) || !isUuid(event.clientEntityId)) {
    return receipt(event.eventId, 'rejected', receivedAt, { detail: 'event_id_invalid' });
  }
  if (!OPERATIONS.has(event.operation)) {
    return receipt(event.eventId, 'rejected', receivedAt, { detail: 'operation_unsupported' });
  }
  if (!Number.isInteger(event.schemaVersion) || event.schemaVersion < 1 || event.schemaVersion > MAX_SUPPORTED_SCHEMA_VERSION) {
    return receipt(event.eventId, 'rejected', receivedAt, { detail: 'schema_version_unsupported' });
  }
  if (!Number.isSafeInteger(event.localSequence)) {
    return receipt(event.eventId, 'rejected', receivedAt, { detail: 'invalid_event' });
  }
  const clock = rejectInvalidOccurredAt(event.occurredAt, now);
  if (clock) return receipt(event.eventId, 'rejected', receivedAt, { detail: clock });
  if (event.payloadHash !== hashSyncPayload(event.payload)) {
    return receipt(event.eventId, 'rejected', receivedAt, { detail: 'payload_hash_mismatch' });
  }
  if (!event.destination || destinationKey(event.destination) !== destinationKey(batch.destination)) {
    return receipt(event.eventId, 'rejected', receivedAt, { detail: 'destination_mismatch' });
  }
  if (syncImporterFor(event.entityType) === null) {
    return receipt(event.eventId, 'rejected', receivedAt, { detail: 'entity_type_rejected' });
  }
  return null;
}

function asSyncEvent(event: ParsedEvent): SyncEventInput {
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
    destination: event.destination as EntityDestination,
    payload: event.payload,
    payloadHash: event.payloadHash,
  };
}

function importContext(batch: ValidBatch, deps: SyncPushPullDeps, now: Date): SyncImportContext {
  return {
    auth: deps.auth,
    deviceId: batch.deviceId,
    destination: batch.destination,
    destinationKey: destinationKey(batch.destination),
    now,
    resolveProjectId: (reference) => deps.resolveProjectId
      ? deps.resolveProjectId(reference)
      : resolveMappedId(deps.stores, deps.auth.tenantId, 'project', reference),
    resolveTaskId: (reference) => deps.resolveTaskId
      ? deps.resolveTaskId(reference)
      : resolveMappedId(deps.stores, deps.auth.tenantId, 'ticket', reference),
  };
}

async function resolveMappedId(
  stores: SyncStores,
  tenantId: number,
  entityType: 'project' | 'ticket',
  reference: string,
): Promise<number | null> {
  if (reference.trim() === '') return null;
  const mapping = await stores.findMapping(tenantId, entityType, reference);
  if (!mapping || !/^[1-9]\d*$/.test(mapping.serverId)) return null;
  const id = Number(mapping.serverId);
  return Number.isSafeInteger(id) ? id : null;
}

function localRecord(
  event: ParsedEvent,
  batch: ValidBatch,
  serverId: string,
  serverVersion: number,
  payload: unknown,
  now: Date,
): LocalRecord {
  const record: LocalRecord = {
    id: event.clientEntityId,
    entityType: event.entityType as LocalEntityType,
    schemaVersion: event.schemaVersion,
    version: serverVersion,
    destination: batch.destination,
    occurredAt: event.occurredAt,
    updatedAt: now.toISOString(),
    payload,
    provenance: {
      actorId: undefined,
      deviceId: batch.deviceId,
      source: 'imported',
      evidence: CLIENT_REPORTED_EVIDENCE,
    },
  };
  if (event.operation === 'delete') record.deletedAt = now.toISOString();
  return record;
}

/**
 * Accept one push batch. Envelope failures return 400 and apply nothing.
 * Otherwise every event gets a receipt, in input order. Accepted mutations
 * go through the named importer only.
 */
export async function handleSyncPush(body: unknown, deps: SyncPushPullDeps): Promise<SyncPushResponse> {
  const read = readPushBatch(body, deps.auth);
  if (!read.ok) return { ok: false, status: 400, code: read.code };

  const { batch } = read;
  const ctx = importContext(batch, deps, deps.now);
  const acceptedThisBatch = new Set<string>();
  const byId = new Map<string, SyncReceipt>();

  for (const event of batch.ordered) {
    const refused = refuseBeforeInsert(event, batch, deps.now);
    if (refused) {
      byId.set(event.eventId, refused);
      continue;
    }

    const applied = await deps.stores.transact(async (tx) => {
      const existing = await tx.findEvent(deps.auth.tenantId, batch.deviceId, event.eventId);
      if (existing) return replayReceipt(event.eventId, existing);

      const unmet = await unmetDependency(tx, deps.auth.tenantId, event.dependsOn, acceptedThisBatch);
      if (unmet) {
        return receipt(event.eventId, 'dependency_pending', deps.now.toISOString(), { detail: unmet });
      }

      const name = syncImporterFor(event.entityType);
      const importer = name ? deps.importers[name] : undefined;
      if (!name || typeof importer !== 'function') {
        return receipt(event.eventId, 'rejected', deps.now.toISOString(), { detail: 'entity_type_rejected' });
      }

      const outcome = await importer(asSyncEvent(event), ctx, tx);
      if (outcome.status === 'applied') {
        await persistAccepted(tx, event, batch, deps, outcome);
        return receipt(event.eventId, 'accepted', deps.now.toISOString(), outcome);
      }
      if (outcome.status === 'conflict') {
        await persistConflict(tx, event, batch, deps, outcome);
        return receipt(event.eventId, 'conflict', deps.now.toISOString(), outcome);
      }
      return receipt(event.eventId, 'rejected', deps.now.toISOString(), { detail: outcome.detail });
    });

    if (applied.status === 'accepted' || applied.status === 'duplicate') acceptedThisBatch.add(event.eventId);
    byId.set(event.eventId, applied);
  }

  return {
    ok: true,
    status: 200,
    receipts: batch.events.map((event) => byId.get(event.eventId) as SyncReceipt),
  };
}

async function unmetDependency(
  tx: SyncStoreSet,
  tenantId: number,
  dependsOn: readonly string[],
  acceptedThisBatch: ReadonlySet<string>,
): Promise<string | null> {
  const external = dependsOn.filter((id) => !acceptedThisBatch.has(id));
  if (external.length === 0) return null;
  const accepted = await tx.acceptedEventIds(tenantId, external);
  return external.find((id) => !accepted.has(id)) ?? null;
}

async function persistAccepted(
  tx: SyncStoreSet,
  event: ParsedEvent,
  batch: ValidBatch,
  deps: SyncPushPullDeps,
  outcome: { serverId: string; serverVersion: number; payloadHash: string; destinationKey: string; payload: unknown },
): Promise<void> {
  const occurredAt = new Date(event.occurredAt);
  const record = localRecord(event, batch, outcome.serverId, outcome.serverVersion, outcome.payload, deps.now);
  await tx.upsertMapping({
    tenantId: deps.auth.tenantId,
    entityType: event.entityType as LocalEntityType,
    clientEntityId: event.clientEntityId,
    serverId: outcome.serverId,
    serverVersion: outcome.serverVersion,
    destinationKey: outcome.destinationKey,
    payloadHash: outcome.payloadHash,
    createdByDevice: batch.deviceId,
    now: deps.now,
  });
  await tx.upsertRecord({
    tenantId: deps.auth.tenantId,
    entityType: event.entityType as LocalEntityType,
    clientEntityId: event.clientEntityId,
    serverId: outcome.serverId,
    schemaVersion: event.schemaVersion,
    version: outcome.serverVersion,
    destinationKey: outcome.destinationKey,
    occurredAt,
    updatedAt: deps.now,
    deletedAt: event.operation === 'delete' ? deps.now : null,
    payload: outcome.payload,
    provenance: {
      deviceId: batch.deviceId,
      source: 'imported',
      evidence: CLIENT_REPORTED_EVIDENCE,
      actorId: deps.auth.userId,
    },
    receivedAt: deps.now,
  });
  await tx.appendChange({
    tenantId: deps.auth.tenantId,
    entityType: event.entityType as LocalEntityType,
    clientEntityId: event.clientEntityId,
    serverId: outcome.serverId,
    operation: event.operation,
    version: outcome.serverVersion,
    destinationKey: outcome.destinationKey,
    record,
    occurredAt,
    deviceId: batch.deviceId,
    eventId: event.eventId,
  });
  await tx.insertEvent(journalRow(event, batch, deps, {
    payload: outcome.payload,
    payloadHash: outcome.payloadHash,
    status: 'accepted',
    serverId: outcome.serverId,
    serverVersion: outcome.serverVersion,
    detail: null,
  }));
}

async function persistConflict(
  tx: SyncStoreSet,
  event: ParsedEvent,
  batch: ValidBatch,
  deps: SyncPushPullDeps,
  outcome: { serverId: string; serverVersion: number; detail: string },
): Promise<void> {
  await tx.insertEvent(journalRow(event, batch, deps, {
    payload: event.payload,
    payloadHash: event.payloadHash,
    status: 'conflict',
    serverId: outcome.serverId,
    serverVersion: outcome.serverVersion,
    detail: outcome.detail,
  }));
}

function journalRow(
  event: ParsedEvent,
  batch: ValidBatch,
  deps: SyncPushPullDeps,
  outcome: {
    payload: unknown;
    payloadHash: string;
    status: 'accepted' | 'conflict';
    serverId: string;
    serverVersion: number;
    detail: string | null;
  },
) {
  return {
    tenantId: deps.auth.tenantId,
    deviceId: batch.deviceId,
    eventId: event.eventId,
    batchId: batch.batchId,
    clientEntityId: event.clientEntityId,
    entityType: event.entityType as LocalEntityType,
    operation: event.operation,
    schemaVersion: event.schemaVersion,
    localSequence: event.localSequence,
    occurredAt: new Date(event.occurredAt),
    receivedAt: deps.now,
    baseVersion: event.baseVersion ?? null,
    dependsOn: [...event.dependsOn],
    destination: { ...batch.destination } as Record<string, unknown>,
    payload: outcome.payload,
    payloadHash: outcome.payloadHash,
    status: outcome.status,
    serverId: outcome.serverId,
    serverVersion: outcome.serverVersion,
    detail: outcome.detail,
  };
}

function copyPayload<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice() as T;
  return { ...(value as object) } as T;
}

function copyRecord(record: LocalRecord): LocalRecord {
  return {
    ...record,
    destination: { ...record.destination },
    payload: copyPayload(record.payload),
    ...(record.provenance ? { provenance: { ...record.provenance } } : {}),
  };
}

function rowToRecord(row: SyncRecordRow, destination: EntityDestination): LocalRecord {
  const record: LocalRecord = {
    id: row.clientEntityId,
    entityType: row.entityType,
    schemaVersion: row.schemaVersion,
    version: row.version,
    destination: { ...destination },
    occurredAt: row.occurredAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    payload: copyPayload(row.payload),
  };
  if (row.deletedAt) record.deletedAt = row.deletedAt.toISOString();
  if (row.provenance && typeof row.provenance === 'object') {
    record.provenance = { ...row.provenance } as LocalRecord['provenance'];
  }
  return record;
}

async function changeTip(stores: SyncStores, tenantId: number, key: string): Promise<number> {
  let seq = 0;
  for (;;) {
    const page = await stores.changesAfter(tenantId, key, seq, MAX_PULL_RECORDS);
    if (page.length === 0) return seq;
    const last = page[page.length - 1];
    if (!last || last.seq <= seq) return seq;
    seq = last.seq;
    if (page.length < MAX_PULL_RECORDS) return seq;
  }
}

function resnapshot(): SyncPullResponse {
  return { ok: true, status: 200, result: { records: [], resnapshotRequired: true } };
}

/**
 * Pull records after a cursor. A cursor this codec did not produce, or a
 * delta cursor whose rows were swept, is `{ resnapshotRequired: true }` and
 * no records. A missing cursor starts a snapshot. Pull does not write.
 */
export async function handleSyncPull(body: unknown, deps: SyncPushPullDeps): Promise<SyncPullResponse> {
  if (!isPlainObject(body)) return { ok: false, status: 400, code: 'invalid_batch' };
  const destination = readDestination(body.destination);
  if (!destination) return { ok: false, status: 400, code: 'invalid_batch' };
  const binding = destinationBindingError(destination, deps.auth);
  if (binding) return { ok: false, status: 400, code: binding };

  let limit = MAX_PULL_RECORDS;
  if (body.limit !== undefined) {
    if (typeof body.limit !== 'number' || !Number.isInteger(body.limit) || body.limit < 1 || body.limit > MAX_PULL_RECORDS) {
      return { ok: false, status: 400, code: 'invalid_limit' };
    }
    limit = body.limit;
  }

  const key = destinationKey(destination);
  const cursor = body.cursor;
  if (cursor == null || (typeof cursor === 'string' && cursor.trim() === '')) {
    return snapshotPage(deps, destination, key, null, limit);
  }
  if (typeof cursor !== 'string') return resnapshot();
  const decoded = decodeSyncCursor(cursor);
  if (!decoded) return resnapshot();

  if (decoded.kind === 'snapshot') {
    return snapshotPage(deps, destination, key, {
      entityType: decoded.afterEntityType,
      clientEntityId: decoded.afterClientEntityId,
    }, limit);
  }

  const minSeq = await deps.stores.minChangeSeq(deps.auth.tenantId);
  if (minSeq === null ? decoded.seq > 0 : minSeq > decoded.seq + 1) return resnapshot();
  const changes = await deps.stores.changesAfter(deps.auth.tenantId, key, decoded.seq, limit);
  const last = changes[changes.length - 1];
  return {
    ok: true,
    status: 200,
    result: {
      records: changes.map((change) => copyRecord(change.record)),
      cursor: encodeSyncCursor({ v: 1, kind: 'delta', seq: last ? last.seq : decoded.seq }),
    },
  };
}

async function snapshotPage(
  deps: SyncPushPullDeps,
  destination: EntityDestination,
  key: string,
  after: { entityType: string; clientEntityId: string } | null,
  limit: number,
): Promise<SyncPullResponse> {
  const rows = await deps.stores.snapshotAfter(deps.auth.tenantId, key, after, limit);
  const records = rows.map((row) => rowToRecord(row, destination));
  if (rows.length === limit && rows.length > 0) {
    const last = rows[rows.length - 1] as SyncRecordRow;
    return {
      ok: true,
      status: 200,
      result: {
        records,
        cursor: encodeSyncCursor({
          v: 1,
          kind: 'snapshot',
          afterEntityType: last.entityType,
          afterClientEntityId: last.clientEntityId,
        }),
      },
    };
  }
  const tip = await changeTip(deps.stores, deps.auth.tenantId, key);
  return {
    ok: true,
    status: 200,
    result: {
      records,
      cursor: encodeSyncCursor({ v: 1, kind: 'delta', seq: tip }),
    },
  };
}

/** Register push and pull. Does not mount them on the application. */
export function mountSyncPushPull(router: SyncV1Router, deps: SyncPushPullDeps): void {
  router.post(SYNC_PUSH_PATH, (body) => handleSyncPush(readSyncBatchBody(body), deps));
  router.post(SYNC_PULL_PATH, (body) => handleSyncPull(readSyncBatchBody(body), deps));
}

/** Bind the three named importers. There is no payload-writer fallback. */
export function namedSyncImporters(db: Db): SyncNamedImporters {
  return {
    importSyncedTicket: (event, ctx, stores) => importSyncedTicket(event, ctx, stores, db),
    importSyncedProject: (event, ctx, stores) => importSyncedProject(event, ctx, stores, db),
    importMirrorRecord,
  };
}
