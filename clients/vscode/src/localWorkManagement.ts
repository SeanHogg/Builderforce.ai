/**
 * VSIX local projects and tickets (review G05).
 *
 * The web use-case library is `createLocalWorkManagement` in
 * `frontend/src/lib/localFirst/workManagement.ts`. A relative import of that
 * module is not legal from this package. `@builderforce/local-first` is linked
 * only under `clients/vscode/node_modules`, and `tsc -p clients/vscode` resolves
 * a bare specifier from the file that imports it. Following the frontend file
 * would fail that resolution and would pull `taskStatus` (and the web API
 * types it names) into the extension-host project. This file is the thin host
 * adapter over the shared store types. It does not copy the web UI.
 *
 * Activation does not call this. `extension.ts` is owned by another slice;
 * a unit test passes `createMemoryLocalFirstStore()`, and a later composition
 * can pass the snapshot store from `localFirstStore.ts`. Nothing here imports
 * `vscode`, `bfApi`, or `fetch`, so a local write cannot become a platform call.
 *
 * A ticket's destination is the project's, snapped at creation. The record and
 * its journal event commit in one transaction. Ids are client UUIDs minted once.
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
} from "@builderforce/local-first";

export type LocalProject = LocalRecord<ProjectValue>;
export type LocalTicket = LocalRecord<TicketValue>;

export interface VsCodeLocalWorkOptions {
  store: LocalFirstStore;
  deviceId: string;
  /** Binding for NEW projects. Omitted means the unbound partition. */
  destination?: EntityDestination;
  newId?: () => string;
  now?: () => Date;
}

const DEFAULT_TICKET_STATUS = "backlog";

function eventId(entityType: "project" | "ticket", id: string, version: number): string {
  return `${entityType}:${id}:v${version}`;
}

function requireText(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

async function live<T>(tx: LocalFirstTransaction, entityType: "project" | "ticket"): Promise<LocalRecord<T>[]> {
  return (await tx.list<T>(entityType)).filter((record) => !record.deletedAt);
}

async function projectFor(tx: LocalFirstTransaction, id: string): Promise<LocalProject> {
  const record = await tx.get<ProjectValue>("project", id);
  if (!record || record.deletedAt) throw new Error(`No such local project: ${id}`);
  return record;
}

async function ticketFor(tx: LocalFirstTransaction, id: string): Promise<LocalTicket> {
  const record = await tx.get<TicketValue>("ticket", id);
  if (!record || record.deletedAt) throw new Error(`No such local ticket: ${id}`);
  return record;
}

export function createVsCodeLocalWorkManagement(options: VsCodeLocalWorkOptions) {
  const destination = options.destination ?? UNBOUND_DESTINATION;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date());

  async function commit<T>(
    tx: LocalFirstTransaction,
    current: LocalRecord<T>,
    payload: T,
    operation: "update" | "delete",
    dependsOn: string[] = [],
  ): Promise<LocalRecord<T>> {
    const stamp = now().toISOString();
    const next: LocalRecord<T> = {
      ...current,
      version: current.version + 1,
      baseVersion: current.version,
      updatedAt: stamp,
      ...(operation === "delete" ? { deletedAt: stamp } : {}),
      payload,
    };
    await tx.put(next, current.version);
    await tx.append({
      eventId: eventId(next.entityType as "project" | "ticket", next.id, next.version),
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
    async listProjects(): Promise<LocalProject[]> {
      return options.store.read((tx) => live<ProjectValue>(tx, "project"));
    },

    async readProject(id: string): Promise<LocalProject> {
      return options.store.read((tx) => projectFor(tx, id));
    },

    async createProject(input: { name: string; key?: string }): Promise<LocalProject> {
      const name = requireText(input.name, "A project needs a name.");
      return options.store.transact(async (tx) => {
        const stamp = now().toISOString();
        const record = newLocalRecord<ProjectValue>({
          id: newId(),
          entityType: "project",
          payload: { name, ...(input.key ? { key: input.key } : {}) },
          deviceId: options.deviceId,
          destination,
          occurredAt: stamp,
        });
        await tx.put(record);
        await tx.append({
          eventId: eventId("project", record.id, record.version),
          clientEntityId: record.id,
          entityType: "project",
          operation: "create",
          schemaVersion: record.schemaVersion,
          occurredAt: stamp,
          dependsOn: [],
          destination,
          payload: record.payload,
        });
        return record;
      });
    },

    async updateProject(id: string, patch: Partial<Pick<ProjectValue, "name" | "key" | "status">>): Promise<LocalProject> {
      return options.store.transact(async (tx) => {
        const current = await projectFor(tx, id);
        const name = patch.name === undefined ? current.payload.name : requireText(patch.name, "A project needs a name.");
        return commit(tx, current, { ...current.payload, ...patch, name }, "update");
      });
    },

    async listTickets(filter: { projectId?: string } = {}): Promise<LocalTicket[]> {
      return options.store.read(async (tx) =>
        (await live<TicketValue>(tx, "ticket")).filter(
          (ticket) => !filter.projectId || ticket.payload.projectId === filter.projectId,
        ),
      );
    },

    async readTicket(id: string): Promise<LocalTicket> {
      return options.store.read((tx) => ticketFor(tx, id));
    },

    async createTicket(input: {
      projectId: string;
      title: string;
      description?: string;
      status?: string;
      priority?: string;
    }): Promise<LocalTicket> {
      const title = requireText(input.title, "A ticket needs a title.");
      return options.store.transact(async (tx) => {
        const project = await projectFor(tx, input.projectId);
        const stamp = now().toISOString();
        const payload: TicketValue = {
          projectId: input.projectId,
          title,
          status: input.status ?? DEFAULT_TICKET_STATUS,
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
        };
        const record = newLocalRecord<TicketValue>({
          id: newId(),
          entityType: "ticket",
          payload,
          deviceId: options.deviceId,
          destination: project.destination,
          occurredAt: stamp,
        });
        await tx.put(record);
        await tx.append({
          eventId: eventId("ticket", record.id, record.version),
          clientEntityId: record.id,
          entityType: "ticket",
          operation: "create",
          schemaVersion: record.schemaVersion,
          occurredAt: stamp,
          dependsOn: [eventId("project", project.id, 1)],
          destination: record.destination,
          payload,
        });
        return record;
      });
    },

    async updateTicket(
      id: string,
      patch: Partial<Pick<TicketValue, "title" | "description" | "priority" | "status">>,
    ): Promise<LocalTicket> {
      return options.store.transact(async (tx) => {
        const current = await ticketFor(tx, id);
        const title = patch.title === undefined ? current.payload.title : requireText(patch.title, "A ticket needs a title.");
        return commit(tx, current, { ...current.payload, ...patch, title }, "update");
      });
    },
  };
}

export type VsCodeLocalWorkManagement = ReturnType<typeof createVsCodeLocalWorkManagement>;
