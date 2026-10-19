/**
 * G17 — import a project as history, not as a command.
 *
 * Writes the `projects` row and nothing else. No board seed, no repo import,
 * no agent roster, no notification. Mapping, projection, change row and receipt
 * stay with the push transaction that calls this use case.
 */

import { and, eq } from 'drizzle-orm';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import type { Db } from '../../../infrastructure/database/connection';
import { projects } from '../../../infrastructure/database/schema';
import type { SyncEntityMappingRow, SyncEventInput, SyncImportContext, SyncStoreSet } from '../syncPorts';
import {
  appliedExisting,
  appliedNew,
  conflict,
  insertedId,
  isUniqueViolation,
  mutateGate,
  preludeRejection,
  rejected,
  sameCanonical,
  serverNumericId,
  type BoundedImportOutcome,
} from './index';

const PROJECT_STATUSES = ['active', 'completed', 'archived', 'on_hold'] as const;
type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_ENTITY_TYPES = ['project'] as const;

interface ProjectPayload {
  name: string;
  key?: string;
  status?: ProjectStatus;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; detail: string };

function isStatus(value: string): value is ProjectStatus {
  return (PROJECT_STATUSES as readonly string[]).includes(value);
}

function readProject(payload: unknown): Parsed<ProjectPayload> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, detail: 'payload_invalid' };
  const raw = payload as Record<string, unknown>;
  if (typeof raw.name !== 'string') return { ok: false, detail: 'project_name_invalid' };
  const name = raw.name.trim();
  if (name === '' || name.length > 255) return { ok: false, detail: 'project_name_invalid' };
  let key: string | undefined;
  if (raw.key !== undefined) {
    if (typeof raw.key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(raw.key)) {
      return { ok: false, detail: 'project_key_invalid' };
    }
    key = raw.key;
  }
  if (raw.status !== undefined) {
    if (typeof raw.status !== 'string' || !isStatus(raw.status)) return { ok: false, detail: 'project_status_invalid' };
    return { ok: true, value: { name, key, status: raw.status } };
  }
  return { ok: true, value: { name, key } };
}

function derivedKey(name: string, clientEntityId: string): string {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12) || 'PRJ';
  const suffix = clientEntityId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase() || 'SYNC';
  return `${slug}-${suffix}`.slice(0, 50);
}

function canonical(payload: ProjectPayload, status: ProjectStatus): { name: string; key?: string; status: ProjectStatus } {
  return payload.key
    ? { name: payload.name, key: payload.key, status }
    : { name: payload.name, status };
}

async function writeFailure(error: unknown, operation: string): Promise<BoundedImportOutcome> {
  if (isUniqueViolation(error)) return rejected('project_key_conflict');
  reportCaughtError(error, { source: 'application/sync/importers/importSyncedProject.ts', operation });
  return rejected('project_write_failed');
}

async function createProject(
  event: SyncEventInput,
  ctx: SyncImportContext,
  db: Db,
  mapping: SyncEntityMappingRow | null,
): Promise<BoundedImportOutcome> {
  const parsed = readProject(event.payload);
  if (!parsed.ok) return rejected(parsed.detail);
  const payload = parsed.value;
  const stored = canonical(payload, payload.status ?? 'active');
  if (mapping) {
    if (mapping.destinationKey !== ctx.destinationKey) return rejected('destination_mismatch');
    if (sameCanonical(mapping, stored)) return appliedExisting(mapping, stored);
    return conflict(mapping, 'entity_already_imported');
  }
  const key = payload.key ?? derivedKey(payload.name, event.clientEntityId);
  try {
    const rows = await db.insert(projects).values({
      tenantId: ctx.auth.tenantId,
      key,
      name: payload.name,
      status: payload.status ?? 'active',
      origin: 'imported',
      updatedAt: ctx.now,
    }).returning({ id: projects.id });
    const id = insertedId(rows);
    if (id === null) return rejected('project_insert_failed');
    const appliedPayload = { name: payload.name, key, status: payload.status ?? 'active' };
    return appliedNew(String(id), 1, ctx.destinationKey, appliedPayload);
  } catch (error) {
    return writeFailure(error, 'createProject');
  }
}

async function updateProject(
  event: SyncEventInput,
  ctx: SyncImportContext,
  db: Db,
  mapping: SyncEntityMappingRow | null,
): Promise<BoundedImportOutcome> {
  const gate = mutateGate(event, ctx, mapping);
  if (gate) return gate;
  const current = mapping as SyncEntityMappingRow;
  const id = serverNumericId(current.serverId);
  if (id === null) return rejected('server_id_invalid');
  const parsed = readProject(event.payload);
  if (!parsed.ok) return rejected(parsed.detail);
  const payload = parsed.value;
  if (!payload.status) return rejected('project_status_required');
  const stored = canonical(payload, payload.status);
  if (sameCanonical(current, stored)) return appliedExisting(current, stored);
  try {
    const rows = await db.update(projects).set({
      name: payload.name,
      status: payload.status,
      ...(payload.key ? { key: payload.key } : {}),
      updatedAt: ctx.now,
    }).where(and(eq(projects.id, id), eq(projects.tenantId, ctx.auth.tenantId))).returning({ id: projects.id });
    if (insertedId(rows) === null) return rejected('project_not_found');
    return appliedNew(current.serverId, current.serverVersion + 1, ctx.destinationKey, stored);
  } catch (error) {
    return writeFailure(error, 'updateProject');
  }
}

async function deleteProject(
  event: SyncEventInput,
  ctx: SyncImportContext,
  db: Db,
  mapping: SyncEntityMappingRow | null,
): Promise<BoundedImportOutcome> {
  const gate = mutateGate(event, ctx, mapping);
  if (gate) return gate;
  const current = mapping as SyncEntityMappingRow;
  const id = serverNumericId(current.serverId);
  if (id === null) return rejected('server_id_invalid');
  const tombstone = { status: 'archived' as const };
  try {
    const rows = await db.update(projects).set({
      status: 'archived',
      updatedAt: ctx.now,
    }).where(and(eq(projects.id, id), eq(projects.tenantId, ctx.auth.tenantId))).returning({ id: projects.id });
    if (insertedId(rows) === null) return rejected('project_not_found');
    return appliedNew(current.serverId, current.serverVersion + 1, ctx.destinationKey, tombstone);
  } catch (error) {
    return writeFailure(error, 'deleteProject');
  }
}

/**
 * Apply one already-validated project mutation. Returns applied, conflict, or
 * rejected plus the mapping fields the route persists. Does not write sync tables.
 */
export async function importSyncedProject(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  db: Db,
): Promise<BoundedImportOutcome> {
  if (event.entityType !== 'project') return rejected('entity_type_rejected');
  const prelude = preludeRejection(event, ctx);
  if (prelude) return prelude;
  const mapping = await stores.findMapping(ctx.auth.tenantId, event.entityType, event.clientEntityId);
  if (event.operation === 'delete') return deleteProject(event, ctx, db, mapping);
  if (event.operation === 'update') return updateProject(event, ctx, db, mapping);
  if (event.operation === 'create' || event.operation === 'import') return createProject(event, ctx, db, mapping);
  return rejected('operation_unsupported');
}
