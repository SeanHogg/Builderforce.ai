/**
 * G17 — import a ticket as history, not as a command.
 *
 * Direct insert/update of the `tasks` row. Does not call TaskService, does not
 * open a run, does not assign an agent, does not send a mention, and does not
 * file a remediation. Agent-assignment columns are never written, even if the
 * client payload carries them. A human assignee is written only when it is an
 * active member of the caller's tenant (`ticket_assignee_invalid` otherwise).
 *
 * Writes go through `tx`, the push's unit-of-work transaction, inside a
 * savepoint: a lost key race rolls back only this write, never the receipt
 * transaction around it.
 */

import { and, eq } from 'drizzle-orm';
import { CLIENT_REPORTED_EVIDENCE } from '../../../domain/sync/occurredAtGate';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import type { Tx } from '../../../infrastructure/database/connection';
import { tasks } from '../../../infrastructure/database/schema';
import { isUniqueViolation } from '../../../infrastructure/database/uniqueViolation';
import type { SyncEntityMappingRow, SyncEventInput, SyncImportContext, SyncStoreSet } from '../syncPorts';
import {
  appliedExisting,
  appliedNew,
  conflict,
  insertedId,
  mutateGate,
  preludeRejection,
  rejected,
  sameCanonical,
  serverNumericId,
  type BoundedImportOutcome,
} from './index';

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
type TicketPriority = (typeof PRIORITIES)[number];

export const TICKET_ENTITY_TYPES = ['ticket'] as const;

interface TicketPayload {
  projectId: string;
  title: string;
  description?: string;
  status: string;
  priority: TicketPriority;
  parentTicketId?: string;
  archived: boolean;
  assignedUserId?: string;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; detail: string };

function isPriority(value: string): value is TicketPriority {
  return (PRIORITIES as readonly string[]).includes(value);
}

function readTicket(payload: unknown, fallbackStatus: string | null): Parsed<TicketPayload> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, detail: 'payload_invalid' };
  const raw = payload as Record<string, unknown>;
  if (typeof raw.projectId !== 'string' || raw.projectId.trim() === '') return { ok: false, detail: 'ticket_project_required' };
  if (typeof raw.title !== 'string') return { ok: false, detail: 'ticket_title_invalid' };
  const title = raw.title.trim();
  if (title === '' || title.length > 500) return { ok: false, detail: 'ticket_title_invalid' };
  if (raw.description !== undefined && typeof raw.description !== 'string') return { ok: false, detail: 'ticket_description_invalid' };
  if (typeof raw.description === 'string' && raw.description.length > 100_000) return { ok: false, detail: 'ticket_description_invalid' };
  const status = raw.status === undefined ? fallbackStatus : raw.status;
  if (typeof status !== 'string' || status.trim() === '' || status.length > 64) return { ok: false, detail: 'ticket_status_invalid' };
  let priority: TicketPriority = 'medium';
  if (raw.priority !== undefined) {
    if (typeof raw.priority !== 'string' || !isPriority(raw.priority)) return { ok: false, detail: 'ticket_priority_invalid' };
    priority = raw.priority;
  }
  if (raw.parentTicketId !== undefined && (typeof raw.parentTicketId !== 'string' || raw.parentTicketId.trim() === '')) {
    return { ok: false, detail: 'parent_ticket_invalid' };
  }
  if (raw.archived !== undefined && typeof raw.archived !== 'boolean') return { ok: false, detail: 'ticket_archived_invalid' };
  if (raw.assignedUserId !== undefined && (typeof raw.assignedUserId !== 'string' || raw.assignedUserId.length === 0 || raw.assignedUserId.length > 36)) {
    return { ok: false, detail: 'ticket_assignee_invalid' };
  }
  return {
    ok: true,
    value: {
      projectId: raw.projectId,
      title,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      status,
      priority,
      parentTicketId: typeof raw.parentTicketId === 'string' ? raw.parentTicketId : undefined,
      archived: raw.archived === true,
      assignedUserId: typeof raw.assignedUserId === 'string' ? raw.assignedUserId : undefined,
    },
  };
}

function taskKey(clientEntityId: string): string {
  const suffix = clientEntityId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 90) || 'TICKET';
  return `SYNC-${suffix}`.slice(0, 100);
}

function canonical(
  payload: TicketPayload,
  projectServerId: number,
  parentServerId: number | null,
): Record<string, unknown> {
  return {
    projectId: String(projectServerId),
    title: payload.title,
    ...(payload.description !== undefined ? { description: payload.description } : {}),
    status: payload.status,
    priority: payload.priority,
    ...(parentServerId !== null ? { parentTicketId: String(parentServerId) } : {}),
    archived: payload.archived,
    ...(payload.assignedUserId !== undefined ? { assignedUserId: payload.assignedUserId } : {}),
  };
}

async function writeFailure(error: unknown, operation: string): Promise<BoundedImportOutcome> {
  if (isUniqueViolation(error)) return rejected('ticket_key_conflict');
  reportCaughtError(error, { source: 'application/sync/importers/importSyncedTicket.ts', operation });
  return rejected('ticket_write_failed');
}

async function resolveRefs(
  payload: TicketPayload,
  ctx: SyncImportContext,
): Promise<{ projectServerId: number; parentServerId: number | null } | BoundedImportOutcome> {
  if (payload.assignedUserId !== undefined && !(await ctx.isTenantMember(payload.assignedUserId))) {
    return rejected('ticket_assignee_invalid');
  }
  const projectServerId = await ctx.resolveProjectId(payload.projectId);
  if (projectServerId === null) return rejected('project_unresolved');
  if (payload.parentTicketId === undefined) return { projectServerId, parentServerId: null };
  const parentServerId = await ctx.resolveTaskId(payload.parentTicketId);
  if (parentServerId === null) return rejected('parent_ticket_unresolved');
  return { projectServerId, parentServerId };
}

async function createTicket(
  event: SyncEventInput,
  ctx: SyncImportContext,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
): Promise<BoundedImportOutcome> {
  const parsed = readTicket(event.payload, 'backlog');
  if (!parsed.ok) return rejected(parsed.detail);
  const payload = parsed.value;
  const refs = await resolveRefs(payload, ctx);
  if ('status' in refs) return refs;
  const stored = canonical(payload, refs.projectServerId, refs.parentServerId);
  if (mapping) {
    if (mapping.destinationKey !== ctx.destinationKey) return rejected('destination_mismatch');
    if (sameCanonical(mapping, stored)) return appliedExisting(mapping, stored);
    return conflict(mapping, 'entity_already_imported');
  }
  try {
    const rows = await tx.transaction((savepoint) => savepoint.insert(tasks).values({
      projectId: refs.projectServerId,
      tenantId: ctx.auth.tenantId,
      key: taskKey(event.clientEntityId),
      title: payload.title,
      description: payload.description ?? null,
      status: payload.status,
      priority: payload.priority,
      parentTaskId: refs.parentServerId,
      assignedUserId: payload.assignedUserId ?? null,
      archived: payload.archived,
      source: CLIENT_REPORTED_EVIDENCE,
      taskType: 'task',
      updatedAt: ctx.now,
    }).returning({ id: tasks.id }));
    const id = insertedId(rows);
    if (id === null) return rejected('ticket_insert_failed');
    return appliedNew(String(id), 1, ctx.destinationKey, stored);
  } catch (error) {
    return writeFailure(error, 'createTicket');
  }
}

async function updateTicket(
  event: SyncEventInput,
  ctx: SyncImportContext,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
): Promise<BoundedImportOutcome> {
  const gate = mutateGate(event, ctx, mapping);
  if (gate) return gate;
  const current = mapping as SyncEntityMappingRow;
  const id = serverNumericId(current.serverId);
  if (id === null) return rejected('server_id_invalid');
  const parsed = readTicket(event.payload, null);
  if (!parsed.ok) return rejected(parsed.detail);
  const payload = parsed.value;
  const refs = await resolveRefs(payload, ctx);
  if ('status' in refs) return refs;
  const stored = canonical(payload, refs.projectServerId, refs.parentServerId);
  if (sameCanonical(current, stored)) return appliedExisting(current, stored);
  try {
    const rows = await tx.transaction((savepoint) => savepoint.update(tasks).set({
      projectId: refs.projectServerId,
      title: payload.title,
      description: payload.description ?? null,
      status: payload.status,
      priority: payload.priority,
      parentTaskId: refs.parentServerId,
      assignedUserId: payload.assignedUserId ?? null,
      archived: payload.archived,
      updatedAt: ctx.now,
    }).where(and(eq(tasks.id, id), eq(tasks.tenantId, ctx.auth.tenantId))).returning({ id: tasks.id }));
    if (insertedId(rows) === null) return rejected('ticket_not_found');
    return appliedNew(current.serverId, current.serverVersion + 1, ctx.destinationKey, stored);
  } catch (error) {
    return writeFailure(error, 'updateTicket');
  }
}

async function deleteTicket(
  event: SyncEventInput,
  ctx: SyncImportContext,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
): Promise<BoundedImportOutcome> {
  const tombstone = { archived: true };
  const gate = mutateGate(event, ctx, mapping, tombstone);
  if (gate) return gate;
  const current = mapping as SyncEntityMappingRow;
  const id = serverNumericId(current.serverId);
  if (id === null) return rejected('server_id_invalid');
  try {
    const rows = await tx.transaction((savepoint) => savepoint.update(tasks).set({
      archived: true,
      updatedAt: ctx.now,
    }).where(and(eq(tasks.id, id), eq(tasks.tenantId, ctx.auth.tenantId))).returning({ id: tasks.id }));
    if (insertedId(rows) === null) return rejected('ticket_not_found');
    return appliedNew(current.serverId, current.serverVersion + 1, ctx.destinationKey, tombstone);
  } catch (error) {
    return writeFailure(error, 'deleteTicket');
  }
}

/**
 * Apply one already-validated ticket mutation through the unit-of-work `tx`.
 * The row is a historical fact: `source` is client-reported, `taskType` stays
 * `task`, and no agent column is set.
 */
export async function importSyncedTicket(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  tx: Tx,
): Promise<BoundedImportOutcome> {
  if (event.entityType !== 'ticket') return rejected('entity_type_rejected');
  const prelude = preludeRejection(event, ctx);
  if (prelude) return prelude;
  const mapping = await stores.findMapping(ctx.auth.tenantId, event.entityType, event.clientEntityId);
  if (event.operation === 'delete') return deleteTicket(event, ctx, tx, mapping);
  if (event.operation === 'update') return updateTicket(event, ctx, tx, mapping);
  if (event.operation === 'create' || event.operation === 'import') return createTicket(event, ctx, tx, mapping);
  return rejected('operation_unsupported');
}
