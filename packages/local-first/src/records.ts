import { parseEntityRef, parseSyncId, syncIdText, tierRefText, type SyncId } from './entityId.js';

export type ClientEntityId = string;

export type LocalEntityType =
  | 'project'
  | 'ticket'
  | 'chat'
  | 'message'
  | 'execution'
  | 'step'
  | 'approval'
  | 'audit-definition'
  | 'audit-run'
  | 'audit-finding'
  | 'change-set'
  | 'memory-fact'
  | 'attachment-manifest'
  | 'policy-snapshot'
  | 'remediation'
  /** A chat-to-ticket link (many-to-many with a `linkType`); unlink is a tombstone. Syncs. */
  | 'chat-ticket-link'
  /** One model call's token usage on this device (PRD 36 run usage ledger). */
  | 'usage'
  /** How one run ended on this device (succeeded / failed / stopped / budget-contained),
   *  keyed by its run id — read by the pipeline route report. Local only, never synced. */
  | 'run-outcome'
  /** One run's delta per repository (PRD 41 §C14), `run-delta:<runId>:<repoKey>`: immutable, synced as a mirror record. */
  | 'run-delta';

export interface DestinationBinding {
  platformInstance?: string;
  accountId?: string;
  tenantId?: string;
  projectId?: string;
  repository?: string;
}

export type EntityDestination =
  | { kind: 'unbound' }
  | ({ kind: 'bound' } & DestinationBinding);

export const UNBOUND_DESTINATION: EntityDestination = { kind: 'unbound' };

/**
 * Where an id lookup may look (typed-entity-ids §3):
 * - an `EntityDestination` — exactly that destination. `UNBOUND_DESTINATION` is the SIGNED-OUT
 *   scope: with no account there is no tenant to narrow to, so a lookup reads unbound rows only
 *   (never another account's bound ones);
 * - an ACCOUNT scope `{ tenantId, accountId?, platformInstance? }` — every bound destination of that
 *   tenant (narrowed by the fields given) PLUS the unbound one. The store cannot tell which account is
 *   active, so a caller without a destination MUST pass its tenant: a SyncId is only unique per
 *   tenant, and another account's ticket 40 is not this one's.
 * - omitted — every destination. LEGACY only (kept so callers migrate without breaking): it can
 *   resolve another tenant's entity. Do not use it in new code.
 */
export type EntityScope = EntityDestination | AccountScope;

export interface AccountScope {
  tenantId: string;
  accountId?: string;
  platformInstance?: string;
}

/** Whether a mapping / record in `destination` is inside `scope` (omitted ⇒ everywhere). */
export function inEntityScope(destination: EntityDestination, scope: EntityScope | undefined): boolean {
  if (scope === undefined) return true;
  if ('kind' in scope) return destinationKey(destination) === destinationKey(scope);
  if (destination.kind === 'unbound') return true;
  return destination.tenantId === scope.tenantId
    && (scope.accountId === undefined || destination.accountId === scope.accountId)
    && (scope.platformInstance === undefined || destination.platformInstance === scope.platformInstance);
}

export function destinationKey(destination: EntityDestination): string {
  if (destination.kind === 'unbound') return 'unbound';
  const parts = [
    destination.platformInstance ?? '',
    destination.accountId ?? '',
    destination.tenantId ?? '',
    destination.projectId ?? '',
    destination.repository ?? '',
  ];
  // Every pending event names its destination, and a sync round keys tens of thousands of them:
  // the five `encodeURIComponent`s are computed once per distinct destination, not per call.
  const raw = parts.join('\u0000');
  let key = DESTINATION_KEYS.get(raw);
  if (key === undefined) {
    key = parts.map(encodeURIComponent).join(':');
    if (DESTINATION_KEYS.size >= 1024) DESTINATION_KEYS.clear();
    DESTINATION_KEYS.set(raw, key);
  }
  return key;
}

/** `destinationKey` by its raw parts (bounded: a store names a handful of destinations). */
const DESTINATION_KEYS = new Map<string, string>();

export interface LocalRecord<T = unknown> {
  id: ClientEntityId;
  entityType: LocalEntityType;
  schemaVersion: number;
  version: number;
  baseVersion?: number;
  destination: EntityDestination;
  occurredAt: string;
  updatedAt: string;
  deletedAt?: string;
  payload: T;
  provenance?: {
    actorId?: string;
    deviceId: string;
    source: 'local' | 'imported';
    /**
     * Trust label. `client-reported` is what a client claimed; `server-observed`
     * is what the platform saw. Optional because records written before the label
     * existed carry none, and an absent label reads as "not client-reported" —
     * it is never upgraded to one.
     */
    evidence?: 'client-reported' | 'server-observed';
    policyVersion?: string;
    auditVersion?: string;
    modelVersion?: string;
    sequence?: number;
  };
}

export type JournalOperation = 'create' | 'update' | 'delete' | 'import';

export interface JournalEvent<T = unknown> {
  /** Wire id — a UUID minted by the store at append; the server's idempotency key. */
  eventId: string;
  /**
   * The caller's name for this logical write (`ticket:<id>:v1`, `fact:<id>:<v>`).
   * Dedupes a double-enqueue while the event is pending. Not a wire id.
   */
  idempotencyKey?: string;
  clientEntityId: ClientEntityId;
  entityType: LocalEntityType;
  operation: JournalOperation;
  schemaVersion: number;
  localSequence: number;
  occurredAt: string;
  baseVersion?: number;
  dependsOn: string[];
  destination: EntityDestination;
  payload: T;
  payloadHash: string;
  /**
   * `'record'`: a bound marker — `payload` is null and is read from the record when the event is
   * sent (`recordPayloadMarker.ts`). Absent: `payload` is the event's own.
   */
  payloadFrom?: 'record';
  /**
   * When a record-payload marker was filled for its first push (ISO). The payload then IS what the
   * server hashed: it is resent as is and never turned back into a marker.
   */
  materializedAt?: string;
  deadLetter?: { reason: string; at: string };
  /** How many times the server held this event (not dependency-met, conflict, a non-permanent refusal). Absent = never. */
  holdAttempts?: number;
  /** The receipt status that held it (`dependency_pending` | `conflict` | `rejected`); a change of kind restarts the hold clock. */
  holdKind?: string;
  /** When the first hold happened (ISO) — the 7-day give-up is measured from here. */
  heldSince?: string;
  /** Do not send before this instant (ISO): exponential backoff after a hold. */
  nextAttemptAt?: string;
}

/**
 * One entity's server mapping in one destination (typed-entity-ids §4). It exists for every
 * entity the server imported; `syncId` is null when the server row has no integer key (mirror
 * records, usage, tier tickets). Never guess a SyncId from an id's shape — read `syncId`.
 */
export interface ServerMapping {
  destination: EntityDestination;
  entityType: LocalEntityType;
  clientEntityId: ClientEntityId;
  /**
   * Always set (number or null) on a row the store hands out: `normalizeServerMapping` writes it.
   * Optional in the TYPE only so a fixture / an older reader's literal still fits; a reader treats
   * `undefined` exactly as `null` (`parseSyncId(mapping.syncId)`).
   */
  syncId?: SyncId | null;
  serverVersion: number;
  /** A planning tier's `kind:ref` (portfolio, objective, initiative, roadmap, spec). */
  externalRef?: string;
  /**
   * When this device first wrote the mapping, as a store-wide increasing number. THE "earliest
   * mapping" order (with the mapping key as tie-break): persisted with the row, so it survives a
   * restart and the canonical (sorted) snapshot encoding. Legacy rows get one on load, in load order.
   */
  mappedSeq?: number;
  /**
   * LEGACY text form, written beside `syncId` for one release so an older extension window that
   * shares the journal still reads the row. Also carries a non-integer server key (a mirror
   * record's UUID). New code reads `syncId`.
   */
  serverId?: string;
}

/** What `putMapping` takes: `syncId` may be left out (derived from `serverId`, like a stored legacy row). */
export type ServerMappingInput = Omit<ServerMapping, 'syncId'> & { syncId?: SyncId | number | string | null };

/**
 * THE tolerant reader of a mapping row — stored (journal / snapshot / IndexedDB), arriving in a
 * delta, or handed to `putMapping`. No row is ever dropped and nothing is upgraded on disk:
 * - `syncId = parseSyncId(raw.syncId) ?? parseSyncId(raw.serverId) ?? null`; an EXPLICIT
 *   `syncId: null` is kept (a step mapping's server id is not a message id, design §1);
 * - a `kind:ref` `serverId` is copied to `externalRef` (the legacy text stays for older readers);
 * - `serverId` text is filled from `syncId` when absent, so writes carry BOTH fields.
 * Returns the row itself when it is already normal.
 */
export function normalizeServerMapping(raw: ServerMappingInput | ServerMapping): ServerMapping {
  const loose = raw as ServerMappingInput & { serverId?: unknown; externalRef?: unknown };
  const serverIdText = typeof loose.serverId === 'number' ? String(loose.serverId) : loose.serverId;
  const syncId = loose.syncId === null
    ? null
    : parseSyncId(loose.syncId) ?? parseSyncId(serverIdText) ?? null;
  let externalRef = typeof loose.externalRef === 'string' && loose.externalRef !== '' ? loose.externalRef : undefined;
  if (externalRef === undefined && typeof serverIdText === 'string') {
    const ref = parseEntityRef(serverIdText);
    if (ref && 'tier' in ref) externalRef = tierRefText(ref.tier);
  }
  const serverId = typeof serverIdText === 'string' && serverIdText !== ''
    ? serverIdText
    : syncId !== null ? syncIdText(syncId) : undefined;
  const mappedSeq = typeof raw.mappedSeq === 'number' && Number.isSafeInteger(raw.mappedSeq) && raw.mappedSeq > 0
    ? raw.mappedSeq
    : undefined;
  if (
    raw.syncId === syncId
    && loose.serverId === serverId
    && (loose.externalRef === externalRef || (externalRef === undefined && !('externalRef' in raw)))
    && (raw.mappedSeq === mappedSeq || (mappedSeq === undefined && !('mappedSeq' in raw)))
  ) {
    return raw as ServerMapping;
  }
  return {
    destination: raw.destination,
    entityType: raw.entityType,
    clientEntityId: raw.clientEntityId,
    serverVersion: raw.serverVersion,
    syncId,
    ...(externalRef !== undefined ? { externalRef } : {}),
    ...(serverId !== undefined ? { serverId } : {}),
    ...(mappedSeq !== undefined ? { mappedSeq } : {}),
  };
}

/**
 * THE "earliest mapping" order: `mappedSeq` ascending (a row without one — never in a store, which
 * backfills — sorts last), then the mapping key. Deterministic in memory and after a reload.
 */
export function compareMappingAge(a: ServerMapping, b: ServerMapping): number {
  const sa = a.mappedSeq ?? Number.MAX_SAFE_INTEGER;
  const sb = b.mappedSeq ?? Number.MAX_SAFE_INTEGER;
  if (sa !== sb) return sa - sb;
  const ka = `${destinationKey(a.destination)}:${a.entityType}:${a.clientEntityId}`;
  const kb = `${destinationKey(b.destination)}:${b.entityType}:${b.clientEntityId}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * THE "earliest mapping in scope" pick: the first (`compareMappingAge`) row of `mappings` that is
 * of `entityType`, inside `scope` (`inEntityScope`) and accepted by `match`. The store's
 * `mappingByServerId` / `mappingByExternalRef` and any reader of a mapping snapshot share it, so
 * both give the same answer. Returns the row itself (no copy).
 */
export function earliestMapping(
  mappings: Iterable<ServerMapping>,
  entityType: LocalEntityType,
  scope: EntityScope | undefined,
  match: (mapping: ServerMapping) => boolean,
): ServerMapping | undefined {
  let earliest: ServerMapping | undefined;
  for (const mapping of mappings) {
    if (mapping.entityType !== entityType || !match(mapping) || !inEntityScope(mapping.destination, scope)) continue;
    if (!earliest || compareMappingAge(mapping, earliest) < 0) earliest = mapping;
  }
  return earliest;
}

export interface SyncReceipt {
  eventId: string;
  /**
   * The record the receipt settles. A receipt outlives its event (the event is acknowledged and
   * deleted, the receipt stays), so without the entity a later status read cannot tell whose it is.
   * Absent on a receipt written before the fields existed: such a receipt is never assumed to
   * belong to any particular record.
   */
  entityType?: LocalEntityType;
  clientEntityId?: ClientEntityId;
  status: 'accepted' | 'duplicate' | 'conflict' | 'rejected' | 'dependency_pending';
  receivedAt: string;
  /**
   * The server's integer key for the entity, when it has one. An EXPLICIT `null` means the server
   * says its `serverId` text is NOT a SyncId of this entity type (a Brain run step's id is a step
   * id, not a message id): nothing may derive one from `serverId` then.
   */
  syncId?: number | null;
  /** The server's key as text (legacy, and the only key of a mirror/usage row: a UUID). */
  serverId?: string;
  serverVersion?: number;
  detail?: string;
}

export interface SyncConflict {
  id: string;
  clientEntityId: ClientEntityId;
  entityType: LocalEntityType;
  local: LocalRecord;
  remote: LocalRecord;
  reason: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface ProjectValue {
  name: string;
  key?: string;
  status?: string;
}

/** How a chat relates to a ticket: it created it, or was linked to it later. */
export type ChatTicketLinkType = 'linked' | 'created';

export interface ChatTicketLinkValue {
  chatClientId: ClientEntityId;
  ticketClientId: ClientEntityId;
  /** The server ids, when the device holds a server mapping for the chat / ticket (a server-origin
   *  one it only ingested): the importer resolves these first, then the client ids. */
  chatServerId?: string;
  ticketServerId?: string;
  /** A work item of a tier other than task/epic/gap (spec, objective, roadmap ...) has no numeric
   *  server id: it is addressed by its tier and ref, which the importer resolves like the link route. */
  ticketKind?: string;
  ticketRef?: string;
  linkType: ChatTicketLinkType;
}

/** The planning tiers a device can create (the server's `task_type`); absent ⇒ `task`. */
export type TicketTaskType = 'task' | 'epic' | 'gap';

export interface TicketValue {
  /**
   * The local project's client id — or, when the project has no local mirror, a DECIMAL
   * server project id (a server reference the sync importer resolves as the tenant's own).
   */
  projectId: ClientEntityId;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  /** A local ticket's client id, or a DECIMAL server task id (same rule as `projectId`). */
  parentTicketId?: ClientEntityId;
  archived?: boolean;
  assignedUserId?: string;
  /** `task` | `epic` | `gap`. Old records omit it and read as `task`. */
  taskType?: TicketTaskType;
  /**
   * The client id of the chat the ticket was created in. Sync imports the ticket AND links
   * that chat to it as 'created', so the creator never needs a separate link call.
   */
  chatClientId?: ClientEntityId;
}

/**
 * Lifecycle of a local run. `completed`, `failed` and `cancelled` (a person pressed
 * Stop) are terminal; `interrupted` is what restart recovery writes for a run the dead
 * host left unfinished. `awaiting_input` with a `hold` is a run whose turn completed but
 * that waits on a person before it may count as finished (PRD 41 §12.5).
 */
export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'awaiting_input'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

/** The statuses a finished run carries. Recovery never rewrites one of these. */
export const TERMINAL_EXECUTION_STATUSES = ['completed', 'failed', 'cancelled'] as const satisfies readonly ExecutionStatus[];

export type TerminalExecutionStatus = (typeof TERMINAL_EXECUTION_STATUSES)[number];

export function isTerminalExecutionStatus(status: ExecutionStatus): status is TerminalExecutionStatus {
  return (TERMINAL_EXECUTION_STATUSES as readonly ExecutionStatus[]).includes(status);
}

export interface ExecutionValue {
  chatId?: ClientEntityId;
  ticketId?: ClientEntityId;
  parentRunId?: ClientEntityId;
  status: ExecutionStatus;
  checkpoint?: { step: number; safeToResume: boolean; state?: unknown };
  /**
   * Why a run whose own turn completed is held for a person (status `awaiting_input`) instead of being finished. A held
   * run is not in flight: restart recovery leaves it as it is. Kept after a release, next to its `waiver`.
   */
  hold?: RunHold;
  /** The audited release of a held run: it is then `completed`, and this says who released it, when, and over which rules. */
  waiver?: RunWaiver;
}

/**
 * A run held at its finalize gate: an autonomous run whose run delta computed blocking codes (PRD 41 §12.5). `rules` are
 * those blocking rule ids; `reason` names them (`run_delta_blocking:<ids>`). Carried by the run's execution record and,
 * for an audit, by its audit-run record.
 */
export interface RunHold {
  reason: string;
  rules: string[];
}

/** A person's audited release of a {@link RunHold}: who (a signed-in user id, else `local`), when (ISO), over which rules. */
export interface RunWaiver {
  by: string;
  at: string;
  rules: string[];
}

export interface ChangeSetValue {
  runId: ClientEntityId;
  repository: string;
  branch?: string;
  baseCommit?: string;
  files: Array<{
    path: string;
    beforeHash?: string;
    afterHash?: string;
    patchManifestId?: string;
  }>;
  author?: string;
}

export interface AuditFindingValue {
  auditRunId: ClientEntityId;
  fingerprint: string;
  severity: string;
  summary: string;
  evidence: unknown;
  remediationTicketId?: ClientEntityId;
}
