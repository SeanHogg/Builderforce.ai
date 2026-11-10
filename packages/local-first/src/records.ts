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
  | 'run-outcome';

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

export function destinationKey(destination: EntityDestination): string {
  if (destination.kind === 'unbound') return 'unbound';
  return [
    destination.platformInstance ?? '',
    destination.accountId ?? '',
    destination.tenantId ?? '',
    destination.projectId ?? '',
    destination.repository ?? '',
  ].map(encodeURIComponent).join(':');
}

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
  syncId: SyncId | null;
  serverVersion: number;
  /** A planning tier's `kind:ref` (portfolio, objective, initiative, roadmap, spec). */
  externalRef?: string;
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
  if (
    raw.syncId === syncId
    && loose.serverId === serverId
    && (loose.externalRef === externalRef || (externalRef === undefined && !('externalRef' in raw)))
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
  };
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
  /** The server's integer key for the entity, when it has one. */
  syncId?: number;
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
 * host left unfinished.
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
