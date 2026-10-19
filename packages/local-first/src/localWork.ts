/**
 * Local projects and tickets (G05).
 *
 * A denied session has no platform to call. This module writes project and
 * ticket records through the injected local store only: one transaction puts
 * the record and appends its create event. A ticket whose project is not
 * already in that store is refused, and the refusal writes nothing.
 *
 * No network client is imported. Account binding is whatever destination the
 * caller passes in for the project; a ticket copies that snapshot.
 *
 * G10: `destination` is never left off. Both create paths resolve the
 * caller's destination through `resolveCreateDestination`, so a project
 * created offline stores `UNBOUND_DESTINATION` as an explicit value rather
 * than as an absent field. A ticket copies the destination snapshot already on
 * its project, which means an offline project's ticket is explicitly unbound
 * too — the two never disagree about where they live.
 */

import { resolveCreateDestination } from './creationDestination.js';
import {
  type EntityDestination,
  type LocalRecord,
  type ProjectValue,
  type TicketValue,
} from './records.js';
import { newLocalRecord, type LocalFirstStore, type LocalFirstTransaction } from './store.js';

export interface CreateLocalProjectInput {
  name: string;
  key?: string;
  status?: string;
  id?: string;
  deviceId: string;
  destination?: EntityDestination;
  occurredAt?: string;
}

export interface CreateLocalTicketInput {
  projectId: string;
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  parentTicketId?: string;
  id?: string;
  deviceId: string;
  occurredAt?: string;
}

export interface LocalWork {
  createProject(input: CreateLocalProjectInput): Promise<LocalRecord<ProjectValue>>;
  createTicket(input: CreateLocalTicketInput): Promise<LocalRecord<TicketValue>>;
}

function requireText(value: string, code: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(code);
  return trimmed;
}

function entityId(id: string | undefined): string {
  if (id === undefined) return crypto.randomUUID();
  if (!id.trim()) throw new Error('client_entity_id_must_be_stable_uuid');
  return id;
}

function projectNotFound(): never {
  throw Object.assign(new Error('project_not_found'), { code: 'project_not_found' });
}

function createEventId(entityType: 'project' | 'ticket', id: string, version: number): string {
  return `${entityType}:${id}:v${version}`;
}

async function appendCreate<T>(
  tx: LocalFirstTransaction,
  record: LocalRecord<T>,
  dependsOn: string[],
): Promise<void> {
  await tx.append({
    eventId: createEventId(record.entityType as 'project' | 'ticket', record.id, record.version),
    clientEntityId: record.id,
    entityType: record.entityType,
    operation: 'create',
    schemaVersion: record.schemaVersion,
    occurredAt: record.occurredAt,
    dependsOn,
    destination: record.destination,
    payload: record.payload,
  });
}

export function createLocalWork(store: LocalFirstStore): LocalWork {
  return {
    async createProject(input: CreateLocalProjectInput): Promise<LocalRecord<ProjectValue>> {
      const name = requireText(input.name, 'project_name_required');
      const deviceId = requireText(input.deviceId, 'device_id_required');
      const id = entityId(input.id);
      const payload: ProjectValue = {
        name,
        ...(input.key !== undefined && input.key.trim() ? { key: input.key.trim() } : {}),
        ...(input.status !== undefined && input.status.trim() ? { status: input.status.trim() } : {}),
      };
      return store.transact(async (tx) => {
        const record = newLocalRecord<ProjectValue>({
          id,
          entityType: 'project',
          payload,
          deviceId,
          destination: resolveCreateDestination(input.destination),
          ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
        });
        await tx.put(record);
        await appendCreate(tx, record, []);
        return record;
      });
    },

    async createTicket(input: CreateLocalTicketInput): Promise<LocalRecord<TicketValue>> {
      const title = requireText(input.title, 'ticket_title_required');
      const deviceId = requireText(input.deviceId, 'device_id_required');
      const projectId = input.projectId.trim();
      if (!projectId) projectNotFound();
      const id = entityId(input.id);
      const status = input.status?.trim() || 'backlog';
      return store.transact(async (tx) => {
        const project = await tx.get<ProjectValue>('project', projectId);
        if (!project) projectNotFound();
        const pending = await tx.pending();
        const projectCreate = pending.find(
          (event) => event.entityType === 'project' && event.clientEntityId === project.id && event.operation === 'create',
        );
        const payload: TicketValue = {
          projectId: project.id,
          title,
          status,
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.priority !== undefined && input.priority.trim() ? { priority: input.priority.trim() } : {}),
          ...(input.parentTicketId !== undefined ? { parentTicketId: input.parentTicketId } : {}),
        };
        const record = newLocalRecord<TicketValue>({
          id,
          entityType: 'ticket',
          payload,
          deviceId,
          // The project's own snapshot, resolved the same way. Never a new
          // destination chosen here: a ticket inherits, it does not decide.
          destination: resolveCreateDestination(project.destination),
          ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
        });
        await tx.put(record);
        await appendCreate(tx, record, projectCreate ? [projectCreate.eventId] : []);
        return record;
      });
    },
  };
}
