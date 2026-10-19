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
  | 'remediation';

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
  eventId: string;
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

export interface TicketValue {
  projectId: ClientEntityId;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  parentTicketId?: ClientEntityId;
  archived?: boolean;
  assignedUserId?: string;
}

export interface ExecutionValue {
  chatId?: ClientEntityId;
  ticketId?: ClientEntityId;
  parentRunId?: ClientEntityId;
  status: 'queued' | 'running' | 'awaiting_input' | 'completed' | 'failed' | 'interrupted';
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
