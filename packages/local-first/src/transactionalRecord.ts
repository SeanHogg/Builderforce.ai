/**
 * G03: the local system of record for chat, project, ticket, audit, and run.
 *
 * One call, {@link TransactionalRecordStore.commit}, writes all five records
 * and their create events inside a SINGLE transaction on the in-memory
 * `LocalFirstStore`. A caller that is offline has no other place to keep them,
 * so either the whole set lands or none of it does.
 *
 * Durability here is a commit BOUNDARY, not a file. `exportSnapshotBytes`
 * hands the host the bytes to persist atomically; a restart is simulated by
 * opening a new store from exactly those bytes
 * ({@link openTransactionalRecordStoreFromBytes}). No API, transport, or
 * network client is imported, and this module opens no file: the live VSIX
 * `globalStorage/local-first-v1.json` snapshot is a separate host concern and
 * is unchanged by this slice.
 *
 * Synchronization is a separate queue. Nothing here acknowledges an event or
 * claims a server accepted a write.
 */

import {
  UNBOUND_DESTINATION,
  type EntityDestination,
  type ExecutionValue,
  type JournalEvent,
  type LocalEntityType,
  type LocalRecord,
  type ProjectValue,
  type TicketValue,
} from './records.js';
import { resolveCreateDestination } from './creationDestination.js';
import { createMemoryLocalFirstStore, newLocalRecord, type LocalFirstSnapshot, type LocalFirstStore, type LocalFirstTransaction } from './store.js';

export const TRANSACTIONAL_SNAPSHOT_INVALID = 'transactional_record_snapshot_invalid';

/** Chat payload written by this module. Lineage is on the record (G03). */
export interface TransactionalChatValue {
  readonly title?: string;
  readonly projectId: string;
  readonly ticketId: string;
  readonly lineage: {
    readonly chatId: string;
    readonly projectId: string;
    readonly ticketId: string;
  };
}

/** Audit payload written by this module: an audit session over a local ticket. */
export interface TransactionalAuditValue {
  readonly auditKey: string;
  readonly projectId: string;
  readonly ticketId: string;
  readonly status: 'running' | 'completed';
  readonly startedAt: string;
  readonly closedAt?: string;
}

export interface TransactionalProjectInput {
  readonly id?: string;
  readonly name: string;
  readonly key?: string;
  readonly status?: string;
}

export interface TransactionalTicketInput {
  readonly id?: string;
  readonly title: string;
  readonly description?: string;
  readonly status?: string;
  readonly priority?: string;
  readonly parentTicketId?: string;
}

export interface TransactionalChatInput {
  readonly id?: string;
  readonly title?: string;
}

export interface TransactionalAuditInput {
  readonly id?: string;
  /** Definition key the local audit was started from. */
  readonly auditKey: string;
  readonly status?: 'running' | 'completed';
}

export interface TransactionalRunInput {
  readonly id?: string;
  readonly status?: ExecutionValue['status'];
  readonly checkpoint?: ExecutionValue['checkpoint'];
}

/** The five records one offline commit writes together. */
export interface CommitTransactionalRecordInput {
  readonly deviceId: string;
  readonly occurredAt?: string;
  /** Snapshotted onto every record of this commit (G11). */
  readonly destination?: EntityDestination;
  readonly project: TransactionalProjectInput;
  readonly ticket: TransactionalTicketInput;
  readonly chat: TransactionalChatInput;
  readonly audit: TransactionalAuditInput;
  readonly run: TransactionalRunInput;
}

export interface TransactionalRecordCommit {
  readonly project: LocalRecord<ProjectValue>;
  readonly ticket: LocalRecord<TicketValue>;
  readonly chat: LocalRecord<TransactionalChatValue>;
  readonly audit: LocalRecord<TransactionalAuditValue>;
  readonly run: LocalRecord<ExecutionValue>;
  readonly events: readonly JournalEvent[];
  /** First journal sequence this commit consumed; `0` when none was allocated. */
  readonly firstSequence: number;
}

/** Everything the commit wrote, read back with no network. */
export interface TransactionalRecordListing {
  readonly projects: readonly LocalRecord<ProjectValue>[];
  readonly tickets: readonly LocalRecord<TicketValue>[];
  readonly chats: readonly LocalRecord<TransactionalChatValue>[];
  readonly audits: readonly LocalRecord<TransactionalAuditValue>[];
  readonly runs: readonly LocalRecord<ExecutionValue>[];
  readonly events: readonly JournalEvent[];
}

/**
 * Commit progress, in write order. A host fault injector (or a test) throws on
 * one of these; the transaction is abandoned and nothing is published.
 */
export type TransactionalCommitStep =
  | 'validated'
  | 'project'
  | 'ticket'
  | 'chat'
  | 'audit'
  | 'run'
  | 'events';

export type TransactionalCommitHook = (step: TransactionalCommitStep) => void | Promise<void>;

export interface TransactionalRecordStoreOptions {
  /** State to open from, as if a previous process had persisted it. */
  readonly initial?: LocalFirstSnapshot;
  /** Called inside the transaction, after each step. Never called when `work` throws. */
  readonly onStep?: TransactionalCommitHook;
}

export interface TransactionalRecordStore {
  /** One transaction: chat, project, ticket, audit, run, and their events. */
  commit(input: CommitTransactionalRecordInput): Promise<TransactionalRecordCommit>;
  /** Read every record this module owns, without any API. */
  list(): Promise<TransactionalRecordListing>;
  get<T = unknown>(entityType: LocalEntityType, id: string): Promise<LocalRecord<T> | undefined>;
  /** Committed state, as bytes a host persists atomically. */
  exportSnapshotBytes(): Promise<Uint8Array>;
  snapshot(): Promise<LocalFirstSnapshot>;
  /** The underlying store, for a host that composes this with other writers. */
  readonly inner: LocalFirstStore;
}

const OWNED: readonly LocalEntityType[] = ['project', 'ticket', 'chat', 'audit-run', 'execution'];

function requireText(value: string | undefined, code: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) throw new Error(code);
  return trimmed;
}

function entityId(id: string | undefined): string {
  if (id === undefined) return crypto.randomUUID();
  if (!id.trim()) throw new Error('client_entity_id_must_be_stable_uuid');
  return id.trim();
}

function createEventId(entityType: LocalEntityType, id: string, version: number): string {
  return `${entityType}:${id}:v${version}`;
}

interface RecordSpec<T> {
  readonly step: TransactionalCommitStep;
  readonly entityType: LocalEntityType;
  readonly id: string;
  readonly payload: T;
  readonly deviceId: string;
  readonly occurredAt: string;
  readonly destination: EntityDestination;
  readonly dependsOn: readonly string[];
}

async function writeRecord<T>(tx: LocalFirstTransaction, spec: RecordSpec<T>): Promise<LocalRecord<T>> {
  const record = newLocalRecord<T>({
    id: spec.id,
    entityType: spec.entityType,
    payload: spec.payload,
    deviceId: spec.deviceId,
    destination: spec.destination,
    occurredAt: spec.occurredAt,
  });
  await tx.put(record);
  await tx.append({
    eventId: createEventId(spec.entityType, spec.id, record.version),
    clientEntityId: record.id,
    entityType: spec.entityType,
    operation: 'create',
    schemaVersion: record.schemaVersion,
    occurredAt: record.occurredAt,
    dependsOn: [...spec.dependsOn],
    destination: record.destination,
    payload: record.payload,
  });
  return record;
}

/**
 * Validate the whole input BEFORE opening the transaction, so a refused
 * commit writes nothing at all.
 */
function planCommit(input: CommitTransactionalRecordInput): {
  deviceId: string;
  occurredAt: string;
  destination: EntityDestination;
  projectId: string;
  ticketId: string;
  chatId: string;
  auditId: string;
  auditKey: string;
  auditStatus: 'running' | 'completed';
  runId: string;
  runStatus: ExecutionValue['status'];
  projectPayload: ProjectValue;
  ticketPayload: TicketValue;
  chatPayload: TransactionalChatValue;
  auditPayload: TransactionalAuditValue;
  runPayload: ExecutionValue;
} {
  const deviceId = requireText(input.deviceId, 'device_id_required');
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  // G10: an offline commit writes all five records explicitly UNBOUND rather
  // than omitting the field. They stay local, `partitionUnboundPending`
  // refuses to carry them, and `chooseDestination` moves record and events
  // together once a destination is stated.
  const destination = resolveCreateDestination(input.destination ?? UNBOUND_DESTINATION);

  const projectId = entityId(input.project?.id);
  const projectPayload: ProjectValue = {
    name: requireText(input.project?.name, 'project_name_required'),
    ...(input.project?.key?.trim() ? { key: input.project.key.trim() } : {}),
    ...(input.project?.status?.trim() ? { status: input.project.status.trim() } : {}),
  };

  const ticketId = entityId(input.ticket?.id);
  const ticketStatus = input.ticket?.status?.trim() || 'backlog';
  const ticketPayload: TicketValue = {
    projectId,
    title: requireText(input.ticket?.title, 'ticket_title_required'),
    status: ticketStatus,
    ...(input.ticket?.description !== undefined ? { description: input.ticket.description } : {}),
    ...(input.ticket?.priority?.trim() ? { priority: input.ticket.priority.trim() } : {}),
    ...(input.ticket?.parentTicketId?.trim() ? { parentTicketId: input.ticket.parentTicketId.trim() } : {}),
  };

  const chatId = entityId(input.chat?.id);
  const chatTitle = input.chat?.title?.trim();
  const chatPayload: TransactionalChatValue = {
    ...(chatTitle ? { title: chatTitle } : {}),
    projectId,
    ticketId,
    lineage: { chatId, projectId, ticketId },
  };

  const auditId = entityId(input.audit?.id);
  const auditKey = requireText(input.audit?.auditKey, 'audit_key_required');
  const auditStatus = input.audit?.status ?? 'running';
  const auditPayload: TransactionalAuditValue = {
    auditKey,
    projectId,
    ticketId,
    status: auditStatus,
    startedAt: occurredAt,
    ...(auditStatus === 'completed' ? { closedAt: occurredAt } : {}),
  };

  const runId = entityId(input.run?.id);
  const runStatus = input.run?.status ?? 'queued';
  const runPayload: ExecutionValue = {
    chatId,
    ticketId,
    status: runStatus,
    ...(input.run?.checkpoint ? { checkpoint: input.run.checkpoint } : {}),
  };

  return {
    deviceId,
    occurredAt,
    destination,
    projectId,
    ticketId,
    chatId,
    auditId,
    auditKey,
    auditStatus,
    runId,
    runStatus,
    projectPayload,
    ticketPayload,
    chatPayload,
    auditPayload,
    runPayload,
  };
}

export function createTransactionalRecordStore(
  options: TransactionalRecordStoreOptions = {},
): TransactionalRecordStore {
  const inner: LocalFirstStore = createMemoryLocalFirstStore(options.initial);
  const hook: TransactionalCommitHook = options.onStep ?? (() => undefined);

  return {
    inner,

    async commit(input: CommitTransactionalRecordInput): Promise<TransactionalRecordCommit> {
      // Validation is deliberately outside `transact`: a refusal opens no draft.
      const plan = planCommit(input);
      await hook('validated');

      return inner.transact(async (tx: LocalFirstTransaction) => {
        const common = {
          deviceId: plan.deviceId,
          occurredAt: plan.occurredAt,
          destination: plan.destination,
        };

        const project = await writeRecord(tx, {
          ...common,
          step: 'project',
          entityType: 'project',
          id: plan.projectId,
          payload: plan.projectPayload,
          dependsOn: [],
        });
        await hook('project');

        const projectEvent = createEventId('project', plan.projectId, project.version);
        const ticket = await writeRecord(tx, {
          ...common,
          step: 'ticket',
          entityType: 'ticket',
          id: plan.ticketId,
          payload: plan.ticketPayload,
          dependsOn: [projectEvent],
        });
        await hook('ticket');

        const ticketEvent = createEventId('ticket', plan.ticketId, ticket.version);
        const chat = await writeRecord(tx, {
          ...common,
          step: 'chat',
          entityType: 'chat',
          id: plan.chatId,
          payload: plan.chatPayload,
          dependsOn: [ticketEvent],
        });
        await hook('chat');

        const audit = await writeRecord(tx, {
          ...common,
          step: 'audit',
          entityType: 'audit-run',
          id: plan.auditId,
          payload: plan.auditPayload,
          dependsOn: [ticketEvent],
        });
        await hook('audit');

        const chatEvent = createEventId('chat', plan.chatId, chat.version);
        const auditEvent = createEventId('audit-run', plan.auditId, audit.version);
        const run = await writeRecord(tx, {
          ...common,
          step: 'run',
          entityType: 'execution',
          id: plan.runId,
          payload: plan.runPayload,
          dependsOn: [chatEvent, auditEvent],
        });
        await hook('run');

        const events = (await tx.pending(plan.destination)).filter((event) =>
          OWNED.includes(event.entityType) && event.clientEntityId !== undefined
          && [plan.projectId, plan.ticketId, plan.chatId, plan.auditId, plan.runId].includes(event.clientEntityId));
        await hook('events');

        return {
          project,
          ticket,
          chat,
          audit,
          run,
          events,
          firstSequence: events.length > 0 ? events[0].localSequence : 0,
        };
      });
    },

    async list(): Promise<TransactionalRecordListing> {
      return inner.read(async (tx) => {
        const rows = await tx.list();
        const live = (entityType: LocalEntityType): LocalRecord[] =>
          rows.filter((row) => row.entityType === entityType && !row.deletedAt);
        return {
          projects: live('project') as LocalRecord<ProjectValue>[],
          tickets: live('ticket') as LocalRecord<TicketValue>[],
          chats: live('chat') as LocalRecord<TransactionalChatValue>[],
          audits: live('audit-run') as LocalRecord<TransactionalAuditValue>[],
          runs: live('execution') as LocalRecord<ExecutionValue>[],
          events: await tx.pending(),
        };
      });
    },

    async get<T>(entityType: LocalEntityType, id: string): Promise<LocalRecord<T> | undefined> {
      return inner.read((tx) => tx.get<T>(entityType, id));
    },

    async snapshot(): Promise<LocalFirstSnapshot> {
      return inner.export();
    },

    async exportSnapshotBytes(): Promise<Uint8Array> {
      return encodeTransactionalSnapshot(await inner.export());
    },
  };
}

/**
 * Restart simulation: a NEW store opened from the bytes a previous store
 * committed. It reads the records back with no API and no network client.
 */
export function openTransactionalRecordStoreFromBytes(bytes: Uint8Array): TransactionalRecordStore {
  return createTransactionalRecordStore({ initial: decodeTransactionalSnapshot(bytes) });
}

/**
 * Canonical, order-stable encoding, so two exports of the same state are the
 * same bytes. A commit that throws leaves the previous bytes byte-identical.
 */
export function encodeTransactionalSnapshot(snapshot: LocalFirstSnapshot): Uint8Array {
  const byEntity = (a: LocalRecord, b: LocalRecord): number =>
    a.entityType === b.entityType ? a.id.localeCompare(b.id) : a.entityType.localeCompare(b.entityType);
  const canonical = {
    records: [...snapshot.records].sort(byEntity),
    events: [...snapshot.events].sort((a, b) => a.localSequence - b.localSequence),
    mappings: [...snapshot.mappings].sort((a, b) =>
      `${a.entityType}:${a.clientEntityId}`.localeCompare(`${b.entityType}:${b.clientEntityId}`)),
    receipts: [...snapshot.receipts].sort((a, b) => a.eventId.localeCompare(b.eventId)),
    conflicts: [...snapshot.conflicts].sort((a, b) => a.id.localeCompare(b.id)),
    cursors: Object.fromEntries(Object.entries(snapshot.cursors ?? {}).sort(([a], [b]) => a.localeCompare(b))),
    nextSequence: snapshot.nextSequence,
  };
  return new TextEncoder().encode(JSON.stringify(canonical));
}

function isLocalFirstSnapshot(value: unknown): value is LocalFirstSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<LocalFirstSnapshot>;
  return Array.isArray(snapshot.records)
    && Array.isArray(snapshot.events)
    && Array.isArray(snapshot.mappings)
    && Array.isArray(snapshot.receipts)
    && Array.isArray(snapshot.conflicts)
    && !!snapshot.cursors
    && typeof snapshot.cursors === 'object'
    && typeof snapshot.nextSequence === 'number';
}

export function decodeTransactionalSnapshot(bytes: Uint8Array): LocalFirstSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error(TRANSACTIONAL_SNAPSHOT_INVALID);
  }
  if (!isLocalFirstSnapshot(value)) throw new Error(TRANSACTIONAL_SNAPSHOT_INVALID);
  return value;
}