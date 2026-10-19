/**
 * Local work management — the web app's project/ticket use cases over the durable
 * local-first store (review G05: "Add durable local project/ticket repositories…
 * Support local project creation and later account/project binding").
 *
 * These are the SAME use cases the other modalities run: presentation submits a
 * command, this module enforces the domain rules, and the store commits the
 * record and its journal event in ONE transaction — a crash between the two is
 * not a state this layer can produce. No fetch, no React, no storage imports:
 * the store and the destination are injected, so the connected product reading
 * from the API and this local path never pick a persistence per account state.
 *
 * Domain rules enforced here:
 *   - IDs are stable client UUIDs, minted once at creation and never re-keyed —
 *     a record that later receives a server id keeps its client id, and the
 *     mapping lives in the store's mapping table, not in the record.
 *   - A ticket's destination is SNAPPED from its project at creation (G11): a
 *     later change of the signed-in account or the UI's selected project cannot
 *     redirect work already written.
 *   - Every mutation is a compare-and-set on the record's version; a stale
 *     writer gets ENTITY_VERSION_CONFLICT from the store, not a silent overwrite.
 *   - Deletes are tombstones with their own journal events, never row removal —
 *     sync has to be able to tell "deleted here" apart from "never known".
 *   - Never-connected (unbound) records stay unbound when a user signs in;
 *     `bindLocalWorkDestination` is the explicit, per-record reassignment (G10).
 */

import {
  UNBOUND_DESTINATION,
  newLocalRecord,
  type EntityDestination,
  type LocalFirstStore,
  type LocalFirstTransaction,
  type LocalRecord,
  type ProjectValue,
  type TicketValue,
} from '@builderforce/local-first';
import { TASK_STATUSES } from '../taskStatus';

export class LocalWorkError extends Error {
  constructor(
    readonly code: 'project_not_found' | 'ticket_not_found' | 'invalid_status' | 'invalid_title' | 'ticket_archived' | 'ticket_has_children' | 'cross_destination',
    message: string,
  ) {
    super(message);
    this.name = 'LocalWorkError';
  }
}

export interface LocalWorkManagementOptions {
  store: LocalFirstStore;
  deviceId: string;
  /** The account/tenant binding NEW records are created under; unbound by default. */
  destination?: EntityDestination;
  newId?: () => string;
  now?: () => Date;
}

export type LocalProject = LocalRecord<ProjectValue>;
export type LocalTicket = LocalRecord<TicketValue>;

const eventId = (entityType: 'project' | 'ticket', id: string, version: number): string =>
  `${entityType}:${id}:v${version}`;

/** The live (not tombstoned) records of one type. */
async function live<T>(tx: LocalFirstTransaction, entityType: 'project' | 'ticket'): Promise<LocalRecord<T>[]> {
  return (await tx.list<T>(entityType)).filter((record) => !record.deletedAt);
}

async function projectFor(tx: LocalFirstTransaction, id: string): Promise<LocalProject> {
  const record = await tx.get<ProjectValue>('project', id);
  if (!record || record.deletedAt) throw new LocalWorkError('project_not_found', `No such local project: ${id}`);
  return record;
}

async function ticketFor(tx: LocalFirstTransaction, id: string): Promise<LocalTicket> {
  const record = await tx.get<TicketValue>('ticket', id);
  if (!record || record.deletedAt) throw new LocalWorkError('ticket_not_found', `No such local ticket: ${id}`);
  return record;
}

function assertStatus(status: string): void {
  if (!(TASK_STATUSES as readonly string[]).includes(status)) {
    throw new LocalWorkError('invalid_status', `Unknown ticket status: ${status}`);
  }
}

export function createLocalWorkManagement(options: LocalWorkManagementOptions) {
  const destination = options.destination ?? UNBOUND_DESTINATION;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date());

  /** Commit a mutated record and its journal event in the caller's transaction. */
  async function commit<T>(
    tx: LocalFirstTransaction,
    current: LocalRecord<T>,
    payload: T,
    operation: 'update' | 'delete',
    dependsOn: string[] = [],
  ): Promise<LocalRecord<T>> {
    const stamp = now().toISOString();
    const next: LocalRecord<T> = {
      ...current,
      version: current.version + 1,
      baseVersion: current.version,
      updatedAt: stamp,
      ...(operation === 'delete' ? { deletedAt: stamp } : {}),
      payload,
    };
    await tx.put(next, current.version);
    await tx.append({
      eventId: eventId(next.entityType as 'project' | 'ticket', next.id, next.version),
      clientEntityId: next.id,
      entityType: next.entityType,
      operation,
      schemaVersion: next.schemaVersion,
      occurredAt: stamp,
      baseVersion: current.version,
      dependsOn,
      destination: next.destination,
      payload,
    });
    return next;
  }

  return {
    // ── Projects ──────────────────────────────────────────────────────────

    async listProjects(): Promise<LocalProject[]> {
      return options.store.read((tx) => live<ProjectValue>(tx, 'project'));
    },

    async createProject(input: { name: string; key?: string }): Promise<LocalProject> {
      const name = input.name.trim();
      if (!name) throw new LocalWorkError('invalid_title', 'A project needs a name.');
      return options.store.transact(async (tx) => {
        const stamp = now().toISOString();
        const record = newLocalRecord<ProjectValue>({
          id: newId(),
          entityType: 'project',
          payload: { name, ...(input.key ? { key: input.key } : {}) },
          deviceId: options.deviceId,
          destination,
          occurredAt: stamp,
        });
        await tx.put(record);
        await tx.append({
          eventId: eventId('project', record.id, record.version),
          clientEntityId: record.id,
          entityType: 'project',
          operation: 'create',
          schemaVersion: record.schemaVersion,
          occurredAt: stamp,
          dependsOn: [],
          destination,
          payload: record.payload,
        });
        return record;
      });
    },

    async updateProject(id: string, patch: Partial<Pick<ProjectValue, 'name' | 'key' | 'status'>>): Promise<LocalProject> {
      return options.store.transact(async (tx) => {
        const current = await projectFor(tx, id);
        const payload = { ...current.payload, ...patch };
        if (patch.name !== undefined && !patch.name.trim()) {
          throw new LocalWorkError('invalid_title', 'A project needs a name.');
        }
        return commit(tx, current, payload, 'update');
      });
    },

    async deleteProject(id: string): Promise<void> {
      await options.store.transact(async (tx) => {
        const current = await projectFor(tx, id);
        const children = (await live<TicketValue>(tx, 'ticket')).filter((ticket) => ticket.payload.projectId === id);
        for (const ticket of children) {
          await commit(tx, ticket, ticket.payload, 'delete', [eventId('project', id, current.version + 1)]);
        }
        await commit(tx, current, current.payload, 'delete');
      });
    },

    // ── Tickets ───────────────────────────────────────────────────────────

    async listTickets(filter: { projectId?: string; includeArchived?: boolean } = {}): Promise<LocalTicket[]> {
      return options.store.read(async (tx) =>
        (await live<TicketValue>(tx, 'ticket'))
          .filter((ticket) => !filter.projectId || ticket.payload.projectId === filter.projectId)
          .filter((ticket) => filter.includeArchived || !ticket.payload.archived),
      );
    },

    async createTicket(input: {
      projectId: string;
      title: string;
      description?: string;
      status?: string;
      priority?: string;
      parentTicketId?: string;
    }): Promise<LocalTicket> {
      const title = input.title.trim();
      if (!title) throw new LocalWorkError('invalid_title', 'A ticket needs a title.');
      const status = input.status ?? 'backlog';
      assertStatus(status);
      return options.store.transact(async (tx) => {
        const project = await projectFor(tx, input.projectId);
        const dependsOn = [eventId('project', project.id, 1)];
        if (input.parentTicketId) {
          const parent = await ticketFor(tx, input.parentTicketId);
          if (parent.payload.projectId !== input.projectId) {
            throw new LocalWorkError('cross_destination', 'A subticket belongs to its parent’s project.');
          }
          dependsOn.push(eventId('ticket', parent.id, 1));
        }
        const stamp = now().toISOString();
        const payload: TicketValue = {
          projectId: input.projectId,
          title,
          status,
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.parentTicketId !== undefined ? { parentTicketId: input.parentTicketId } : {}),
        };
        const record = newLocalRecord<TicketValue>({
          id: newId(),
          entityType: 'ticket',
          payload,
          deviceId: options.deviceId,
          // The destination is the PROJECT's, snapped now — never re-read at sync time.
          destination: project.destination,
          occurredAt: stamp,
        });
        await tx.put(record);
        await tx.append({
          eventId: eventId('ticket', record.id, record.version),
          clientEntityId: record.id,
          entityType: 'ticket',
          operation: 'create',
          schemaVersion: record.schemaVersion,
          occurredAt: stamp,
          dependsOn,
          destination: record.destination,
          payload,
        });
        return record;
      });
    },

    async updateTicket(
      id: string,
      patch: Partial<Pick<TicketValue, 'title' | 'description' | 'priority' | 'assignedUserId'>>,
    ): Promise<LocalTicket> {
      return options.store.transact(async (tx) => {
        const current = await ticketFor(tx, id);
        if (current.payload.archived) throw new LocalWorkError('ticket_archived', 'Unarchive the ticket before editing it.');
        if (patch.title !== undefined && !patch.title.trim()) {
          throw new LocalWorkError('invalid_title', 'A ticket needs a title.');
        }
        return commit(tx, current, { ...current.payload, ...patch }, 'update');
      });
    },

    async changeTicketStatus(id: string, status: string): Promise<LocalTicket> {
      assertStatus(status);
      return options.store.transact(async (tx) => {
        const current = await ticketFor(tx, id);
        if (current.payload.archived) throw new LocalWorkError('ticket_archived', 'Unarchive the ticket before moving it.');
        return commit(tx, current, { ...current.payload, status }, 'update');
      });
    },

    async setTicketArchived(id: string, archived: boolean): Promise<LocalTicket> {
      return options.store.transact(async (tx) => {
        const current = await ticketFor(tx, id);
        return commit(tx, current, { ...current.payload, archived }, 'update');
      });
    },

    async deleteTicket(id: string): Promise<void> {
      await options.store.transact(async (tx) => {
        const current = await ticketFor(tx, id);
        const children = (await live<TicketValue>(tx, 'ticket')).filter((ticket) => ticket.payload.parentTicketId === id);
        if (children.length > 0) {
          throw new LocalWorkError('ticket_has_children', 'Delete or move the subtickets first.');
        }
        await commit(tx, current, current.payload, 'delete');
      });
    },

    // ── Ownership ─────────────────────────────────────────────────────────

    /**
     * The explicit destination assignment for never-connected work (G10): binds
     * the named records — and only them — to a chosen account. Bound records are
     * refused: ownership is written at creation and reassigned only here, never
     * inferred from whoever is signed in.
     */
    async bindLocalWorkDestination(ids: readonly string[], to: EntityDestination): Promise<number> {
      if (to.kind !== 'bound') throw new LocalWorkError('cross_destination', 'Binding requires an explicit account destination.');
      return options.store.transact(async (tx) => {
        let bound = 0;
        for (const id of ids) {
          const record = (await tx.get('project', id)) ?? (await tx.get('ticket', id));
          if (!record || record.deletedAt) continue;
          if (record.destination.kind !== 'unbound') {
            throw new LocalWorkError('cross_destination', `Record ${id} is already bound; its destination cannot be reassigned.`);
          }
          const rebound: LocalRecord = { ...record, destination: to };
          await tx.put(rebound, record.version);
          bound += 1;
        }
        return bound;
      });
    },
  };
}

export type LocalWorkManagement = ReturnType<typeof createLocalWorkManagement>;
