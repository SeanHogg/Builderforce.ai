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

export interface ServerMapping {
  destination: EntityDestination;
  entityType: LocalEntityType;
  clientEntityId: ClientEntityId;
  serverId: string;
  serverVersion: number;
}

export interface SyncReceipt {
  eventId: string;
  status: 'accepted' | 'duplicate' | 'conflict' | 'rejected' | 'dependency_pending';
  receivedAt: string;
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
