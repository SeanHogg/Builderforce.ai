/**
 * VSIX local project and ticket repository (review G05).
 *
 * The sidebar's project, task and board lists are API reads with short-lived memory
 * caches, so with the platform denied a user cannot create, move or archive a single
 * ticket. This module is the local system of record for that work: the same
 * `project` / `ticket` records and journal events the web app's `workManagement`
 * writes, committed through the injected transactional store.
 *
 * Rules this module owns:
 *
 *   • No network. `bfApi`, the gateway and `fetch` are NOT imported and nothing here
 *     reads them — a local write cannot become an API round trip by accident. The
 *     file imports only the shared record/journal contracts from
 *     `@builderforce/local-first`; `localWorkRepository.test.ts` asserts that.
 *   • Identity is DATA, not a live lookup. The destination comes from an argument:
 *     this module never asks who is signed in, never reads `projectState`'s selected
 *     project, and never fills in a tenant from a settings value. With no account
 *     argument the record lands in the UNBOUND partition and stays there (G10) —
 *     binding is the explicit `bindDestination` operation, never inference. A
 *     bound record is refused a different account or tenant, so a later sign-in
 *     cannot adopt work written by somebody else.
 *   • A ticket's destination is SNAPPED from its project at creation (G11), so a later
 *     sign-in or selection change cannot redirect work already written.
 *   • One transaction commits the record and its journal event, so a crash between
 *     them is not a state this layer can produce, and every mutation is a
 *     compare-and-set on the record version — the store refuses a stale writer with
 *     `ENTITY_VERSION_CONFLICT` rather than this module inventing a merge.
 *   • Ids are stable client UUIDs, minted once and never re-keyed: a record that
 *     later receives a server id keeps its client id, and the mapping lives in the
 *     store's mapping table, not in the record.
 *
 * The store is a PORT (`LocalFirstStore`): activation passes the VSIX snapshot store
 * from `localFirstStore.ts` (`localBrainApplication(ctx).store`), and a unit test
 * passes `createMemoryLocalFirstStore()`. Composition into the tree/board commands
 * belongs to `extension.ts`, which another slice owns — this module deliberately
 * imports nothing from `vscode` so it stays testable headlessly.
 *
 * Two differences from `frontend/src/lib/localFirst/workManagement.ts`, both
 * deliberate and both local to this file:
 *   1. `bindDestination` BUMPS THE VERSION AND APPENDS AN UPDATE EVENT. The web
 *      library rewrites the destination silently; here the reassignment is journaled
 *      so the bound destination is actually carried by something a later batch push
 *      (G15) can send. `bindDestination` also cascades to the project's unbound
 *      tickets so a bound project cannot own unbound children.
 *   2. Ticket statuses are validated against `LOCAL_TICKET_STATUSES` below, a copy of
 *      the `task_status` enum in `frontend/src/lib/taskStatus.ts`, because that list
 *      lives in the web app and this slice may not edit it.
 */

import {
  UNBOUND_DESTINATION,
  destinationKey,
  newLocalRecord,
  type DestinationBinding,
  type EntityDestination,
  type LocalFirstStore,
  type LocalFirstTransaction,
  type LocalRecord,
  type ProjectValue,
  type TicketValue,
} from "@builderforce/local-first";

export type LocalProject = LocalRecord<ProjectValue>;
export type LocalTicket = LocalRecord<TicketValue>;

/** The `task_status` Postgres enum, in kanban column order. */
export const LOCAL_TICKET_STATUSES = [
  "backlog",
  "todo",
  "ready",
  "in_progress",
  "in_review",
  "blocked",
  "done",
] as const;

export type LocalTicketStatus = (typeof LOCAL_TICKET_STATUSES)[number];

export const DEFAULT_TICKET_STATUS: LocalTicketStatus = "backlog";

export type LocalWorkErrorCode =
  | "project_not_found"
  | "ticket_not_found"
  | "project_name_required"
  | "ticket_title_required"
  | "invalid_status"
  | "ticket_archived"
  | "ticket_has_children"
  | "cross_destination"
  | "destination_required"
  | "destination_account_mismatch"
  | "destination_tenant_mismatch"
  | "destination_rebind_refused"
  | "signed_in_tenant_refused";

export class LocalWorkRepositoryError extends Error {
  constructor(
    readonly code: LocalWorkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LocalWorkRepositoryError";
  }
}

export interface LocalWorkRepositoryOptions {
  /** The durable transactional store — VSIX snapshot store in the host, memory in tests. */
  store: LocalFirstStore;
  deviceId: string;
  /**
   * The account/tenant binding NEW records are created under. DATA, not a lookup:
   * omit it and every new record is stamped `UNBOUND_DESTINATION`.
   */
  destination?: EntityDestination | DestinationBinding;
  newId?: () => string;
  now?: () => Date;
}

export interface CreateLocalProjectInput {
  name: string;
  key?: string;
  status?: string;
  /** A per-call binding for this record only. Omitted → the repository default. */
  destination?: EntityDestination | DestinationBinding;
  /** Reuse a caller-minted id so a retry of one user action dedupes. */
  id?: string;
}

export interface CreateLocalTicketInput {
  projectId: string;
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  parentTicketId?: string;
  /**
   * Must match the project's snapshotted destination when given. A ticket is never
   * bound independently of its project.
   */
  destination?: EntityDestination | DestinationBinding;
  id?: string;
}

export interface ListLocalTicketsFilter {
  projectId?: string;
  includeArchived?: boolean;
  status?: string;
}

export interface BindDestinationInput {
  /** Records to bind: project ids and/or ticket ids. */
  ids: readonly string[];
  to: EntityDestination | DestinationBinding;
  /** Bind the named projects' unbound tickets too. Default true. */
  includeChildTickets?: boolean;
}

const SNAPSHOT_FIELDS = ["platformInstance", "accountId", "tenantId", "projectId", "repository"] as const;
type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];

const eventId = (entityType: "project" | "ticket", id: string, version: number): string =>
  `${entityType}:${id}:v${version}`;

/**
 * A destination argument that is really "whoever is signed in": a VS Code
 * authentication session, a secrets bag, or a live lookup function. Those are
 * not account snapshots and must not become a binding.
 */
export function isSignedInTenantLure(value: unknown): boolean {
  if (typeof value === "function") return true;
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  if ("accessToken" in raw || "scopes" in raw || "signedIn" in raw || "secrets" in raw) return true;
  const account = raw.account;
  if (account && typeof account === "object" && "label" in account && !("accountId" in raw)) return true;
  return false;
}

function refuseSignedInTenant(value: unknown): void {
  if (!isSignedInTenantLure(value)) return;
  throw new LocalWorkRepositoryError(
    "signed_in_tenant_refused",
    "Refusing to invent a tenant from whoever is signed in. Pass an explicit account snapshot, or leave the record unbound.",
  );
}

/**
 * The destination a NEW record may be stamped with. No account id means unbound —
 * a stray project id or platform instance is not an account, and a tenant id
 * without an account is the signed-in-user guess this module refuses.
 */
export function creationDestination(
  proposed: EntityDestination | DestinationBinding | undefined,
): EntityDestination {
  refuseSignedInTenant(proposed);
  const snapshot = localBindingSnapshot(proposed);
  if (snapshot.kind !== "bound") return UNBOUND_DESTINATION;
  if (!snapshot.accountId) {
    if (snapshot.tenantId) {
      throw new LocalWorkRepositoryError(
        "signed_in_tenant_refused",
        "A tenant id without an account is not a destination. Pass the account snapshot, or leave the record unbound.",
      );
    }
    return UNBOUND_DESTINATION;
  }
  return snapshot;
}

/**
 * Copy only the known identity fields of a proposed destination. Mirrors
 * `bindingSnapshot` in `packages/local-first/src/destinationBinding.ts`, which is
 * not re-exported from the package index (and which this slice may not edit).
 * `kind: 'unbound'` WINS even when identity fields are present — those fields are
 * not read. No known field means the unbound partition, never a partial guess.
 */
export function localBindingSnapshot(
  destination: EntityDestination | DestinationBinding | undefined,
): EntityDestination {
  if (!destination || typeof destination !== "object") return UNBOUND_DESTINATION;
  const raw = destination as unknown as Record<string, unknown>;
  if (raw.kind === "unbound") return UNBOUND_DESTINATION;
  const snapshot: { kind: "bound" } & DestinationBinding = { kind: "bound" };
  let known = false;
  for (const field of SNAPSHOT_FIELDS) {
    const value = raw[field];
    if (typeof value === "string" && value.trim()) {
      snapshot[field] = value.trim();
      known = true;
    }
  }
  return known ? Object.freeze(snapshot) : UNBOUND_DESTINATION;
}

function fieldOf(destination: EntityDestination, field: SnapshotField): string | undefined {
  return destination.kind === "bound" ? destination[field] : undefined;
}

/** The refusal code when `proposed` would replace a bound snapshot. null when it would not. */
function rebindRefusal(
  existing: EntityDestination,
  proposed: EntityDestination,
): "destination_tenant_mismatch" | "destination_account_mismatch" | "destination_rebind_refused" | null {
  if (existing.kind !== "bound") return null;
  if (fieldOf(existing, "tenantId") !== fieldOf(proposed, "tenantId")) return "destination_tenant_mismatch";
  if (fieldOf(existing, "accountId") !== fieldOf(proposed, "accountId")) return "destination_account_mismatch";
  if (destinationKey(existing) !== destinationKey(proposed)) return "destination_rebind_refused";
  return null;
}

function requireText(value: string | undefined, code: LocalWorkErrorCode, message: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) throw new LocalWorkRepositoryError(code, message);
  return trimmed;
}

function assertStatus(status: string): void {
  if (!(LOCAL_TICKET_STATUSES as readonly string[]).includes(status)) {
    throw new LocalWorkRepositoryError("invalid_status", `Unknown ticket status: ${status}`);
  }
}

/** The live (not tombstoned) records of one type. */
async function live<T>(tx: LocalFirstTransaction, entityType: "project" | "ticket"): Promise<LocalRecord<T>[]> {
  return (await tx.list<T>(entityType)).filter((record) => !record.deletedAt);
}

async function projectFor(tx: LocalFirstTransaction, id: string): Promise<LocalProject> {
  const record = await tx.get<ProjectValue>("project", id);
  if (!record || record.deletedAt) {
    throw new LocalWorkRepositoryError("project_not_found", `No such local project: ${id}`);
  }
  return record;
}

async function ticketFor(tx: LocalFirstTransaction, id: string): Promise<LocalTicket> {
  const record = await tx.get<TicketValue>("ticket", id);
  if (!record || record.deletedAt) {
    throw new LocalWorkRepositoryError("ticket_not_found", `No such local ticket: ${id}`);
  }
  return record;
}

/**
 * The VSIX local project/ticket repository. Reads and writes the shared
 * `project` / `ticket` records through `store` only — there is no code path from
 * here to `bfApi`, `fetch` or the gateway.
 */
export function createLocalWorkRepository(options: LocalWorkRepositoryOptions) {
  // Fail closed at construction: a host that stuffed the signed-in session into the
  // repository options must not be able to create a single record.
  const destination = creationDestination(options.destination);
  const newId = options.newId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date());

  /** The destination a new record takes: the explicit call, else the repository default. */
  const stampFor = (proposed?: EntityDestination | DestinationBinding): EntityDestination =>
    proposed === undefined ? destination : creationDestination(proposed);

  /**
   * Commit a mutated record and its journal event in the caller's transaction.
   * `bind` replaces the record's destination — used ONLY by bindDestination, so the
   * appended update event carries the NEW destination rather than the stale one.
   */
  async function commit<T>(
    tx: LocalFirstTransaction,
    current: LocalRecord<T>,
    payload: T,
    operation: "update" | "delete",
    dependsOn: string[] = [],
    bind?: EntityDestination,
  ): Promise<LocalRecord<T>> {
    const stamp = now().toISOString();
    const next: LocalRecord<T> = {
      ...current,
      version: current.version + 1,
      baseVersion: current.version,
      updatedAt: stamp,
      ...(bind ? { destination: bind } : {}),
      ...(operation === "delete" ? { deletedAt: stamp } : {}),
      payload,
    };
    // The store owns the optimistic-concurrency rule: a stale expectedVersion here
    // fails the whole transaction with ENTITY_VERSION_CONFLICT and writes nothing.
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
    /** The destination new records are stamped with: bound, or the unbound partition. */
    defaultDestination: destination,

    // ── Projects ────────────────────────────────────────────────────────────

    async listProjects(): Promise<LocalProject[]> {
      return options.store.read((tx) => live<ProjectValue>(tx, "project"));
    },

    async getProject(id: string): Promise<LocalProject> {
      return options.store.read((tx) => projectFor(tx, id));
    },

    async createProject(input: CreateLocalProjectInput): Promise<LocalProject> {
      const name = requireText(input.name, "project_name_required", "A project needs a name.");
      const key = input.key?.trim();
      const status = input.status?.trim();
      const record = await options.store.transact(async (tx) => {
        const stamp = now().toISOString();
        const created: LocalProject = newLocalRecord<ProjectValue>({
          id: input.id?.trim() || newId(),
          entityType: "project",
          payload: {
            name,
            ...(key ? { key } : {}),
            ...(status ? { status } : {}),
          },
          deviceId: options.deviceId,
          destination: stampFor(input.destination),
          occurredAt: stamp,
        });
        await tx.put(created);
        await tx.append({
          eventId: eventId("project", created.id, created.version),
          clientEntityId: created.id,
          entityType: "project",
          operation: "create",
          schemaVersion: created.schemaVersion,
          occurredAt: stamp,
          dependsOn: [],
          destination: created.destination,
          payload: created.payload,
        });
        return created;
      });
      return record;
    },

    async updateProject(
      id: string,
      patch: Partial<Pick<ProjectValue, "name" | "key" | "status">>,
    ): Promise<LocalProject> {
      if (patch.name !== undefined) requireText(patch.name, "project_name_required", "A project needs a name.");
      return options.store.transact(async (tx) => {
        const current = await projectFor(tx, id);
        const payload: ProjectValue = { ...current.payload };
        if (patch.name !== undefined) payload.name = patch.name.trim();
        if (patch.key !== undefined) {
          if (patch.key.trim()) payload.key = patch.key.trim();
          else delete payload.key;
        }
        if (patch.status !== undefined) {
          if (patch.status.trim()) payload.status = patch.status.trim();
          else delete payload.status;
        }
        return commit(tx, current, payload, "update");
      });
    },

    /** Tombstone the project and its tickets in one transaction — never a row removal. */
    async deleteProject(id: string): Promise<void> {
      await options.store.transact(async (tx) => {
        const current = await projectFor(tx, id);
        const projectDelete = eventId("project", id, current.version + 1);
        const children = (await live<TicketValue>(tx, "ticket")).filter(
          (ticket) => ticket.payload.projectId === id,
        );
        for (const ticket of children) {
          await commit(tx, ticket, ticket.payload, "delete", [projectDelete]);
        }
        await commit(tx, current, current.payload, "delete");
      });
    },

    // ── Tickets ─────────────────────────────────────────────────────────────

    async listTickets(filter: ListLocalTicketsFilter = {}): Promise<LocalTicket[]> {
      return options.store.read(async (tx) =>
        (await live<TicketValue>(tx, "ticket"))
          .filter((ticket) => !filter.projectId || ticket.payload.projectId === filter.projectId)
          .filter((ticket) => filter.includeArchived || !ticket.payload.archived)
          .filter((ticket) => !filter.status || ticket.payload.status === filter.status),
      );
    },

    async getTicket(id: string): Promise<LocalTicket> {
      return options.store.read((tx) => ticketFor(tx, id));
    },

    async createTicket(input: CreateLocalTicketInput): Promise<LocalTicket> {
      const title = requireText(input.title, "ticket_title_required", "A ticket needs a title.");
      const status = input.status ?? DEFAULT_TICKET_STATUS;
      assertStatus(status);
      const priority = input.priority?.trim();
      return options.store.transact(async (tx) => {
        const project = await projectFor(tx, input.projectId);
        // The destination is the PROJECT's, snapped now. Never re-read at sync time,
        // and never taken from a caller's own account argument.
        if (input.destination !== undefined) {
          const proposed = creationDestination(input.destination);
          if (destinationKey(proposed) !== destinationKey(project.destination)) {
            throw new LocalWorkRepositoryError(
              "cross_destination",
              "A ticket belongs to its project's destination; bind the project instead.",
            );
          }
        }
        const stamp = now().toISOString();
        const payload: TicketValue = {
          projectId: project.id,
          title,
          status,
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(priority ? { priority } : {}),
          ...(input.parentTicketId !== undefined ? { parentTicketId: input.parentTicketId } : {}),
        };
        const record: LocalTicket = newLocalRecord<TicketValue>({
          id: input.id?.trim() || newId(),
          entityType: "ticket",
          payload,
          deviceId: options.deviceId,
          destination: project.destination,
          occurredAt: stamp,
        });
        // Depend on the create events (always v1), so a later batch push applies the
        // parent before the child even after the parent has been updated.
        const dependsOn = [eventId("project", project.id, 1)];
        if (input.parentTicketId) {
          const parent = await ticketFor(tx, input.parentTicketId);
          if (parent.payload.projectId !== project.id) {
            throw new LocalWorkRepositoryError(
              "cross_destination",
              "A subticket belongs to its parent's project.",
            );
          }
          dependsOn.push(eventId("ticket", parent.id, 1));
        }
        await tx.put(record);
        await tx.append({
          eventId: eventId("ticket", record.id, record.version),
          clientEntityId: record.id,
          entityType: "ticket",
          operation: "create",
          schemaVersion: record.schemaVersion,
          occurredAt: stamp,
          dependsOn,
          destination: record.destination,
          payload: record.payload,
        });
        return record;
      });
    },

    async updateTicket(
      id: string,
      patch: Partial<Pick<TicketValue, "title" | "description" | "priority" | "assignedUserId">>,
    ): Promise<LocalTicket> {
      if (patch.title !== undefined) requireText(patch.title, "ticket_title_required", "A ticket needs a title.");
      return options.store.transact(async (tx) => {
        const current = await ticketFor(tx, id);
        if (current.payload.archived) {
          throw new LocalWorkRepositoryError("ticket_archived", "Unarchive the ticket before editing it.");
        }
        const payload: TicketValue = { ...current.payload };
        if (patch.title !== undefined) payload.title = patch.title.trim();
        if (patch.description !== undefined) payload.description = patch.description;
        if (patch.priority !== undefined) {
          if (patch.priority.trim()) payload.priority = patch.priority.trim();
          else delete payload.priority;
        }
        if (patch.assignedUserId !== undefined) payload.assignedUserId = patch.assignedUserId;
        return commit(tx, current, payload, "update");
      });
    },

    /** Move a ticket in its board. A local write: the status never leaves this machine. */
    async changeTicketStatus(id: string, status: string): Promise<LocalTicket> {
      assertStatus(status);
      return options.store.transact(async (tx) => {
        const current = await ticketFor(tx, id);
        if (current.payload.archived) {
          throw new LocalWorkRepositoryError("ticket_archived", "Unarchive the ticket before moving it.");
        }
        return commit(tx, current, { ...current.payload, status }, "update");
      });
    },

    async setTicketArchived(id: string, archived: boolean): Promise<LocalTicket> {
      return options.store.transact(async (tx) => {
        const current = await ticketFor(tx, id);
        return commit(tx, current, { ...current.payload, archived }, "update");
      });
    },

    async deleteTicket(id: string): Promise<void> {
      await options.store.transact(async (tx) => {
        const current = await ticketFor(tx, id);
        const children = (await live<TicketValue>(tx, "ticket")).filter(
          (ticket) => ticket.payload.parentTicketId === id,
        );
        if (children.length > 0) {
          throw new LocalWorkRepositoryError("ticket_has_children", "Delete or move the subtickets first.");
        }
        await commit(tx, current, current.payload, "delete");
      });
    },

    // ── Ownership ───────────────────────────────────────────────────────────

    /**
     * The explicit destination assignment for never-connected work (G10). Ownership is
     * DATA on the record: it is written when `createProject` is given a destination,
     * or reassigned here and only here. Nothing in this module infers an account from
     * whoever is signed in, so a later sign-in cannot adopt unbound work, and a bound
     * record is refused a different account or tenant.
     *
     * The reassignment is journaled (version bump + update event) so the new
     * destination rides on an event a later batch push can send, and it cascades to the
     * bound projects' still-unbound tickets so a project cannot own tickets in another
     * partition. Returns the number of records whose destination changed.
     */
    async bindDestination(input: BindDestinationInput): Promise<number> {
      refuseSignedInTenant(input.to);
      const to = creationDestination(input.to);
      if (to.kind !== "bound" || !to.accountId) {
        throw new LocalWorkRepositoryError(
          "destination_required",
          "Binding requires an explicit account snapshot. A signed-in session is not one.",
        );
      }
      return options.store.transact(async (tx) => {
        let bound = 0;
        const targets: LocalRecord[] = [];
        const foreignChildren: string[] = [];
        const queue: string[] = [...input.ids];
        while (queue.length > 0) {
          const id = queue.shift()!;
          if (targets.some((record) => record.id === id)) continue;
          const record = (await tx.get("project", id)) ?? (await tx.get("ticket", id));
          if (!record || record.deletedAt) continue;
          targets.push(record);
          if (input.includeChildTickets !== false && record.entityType === "project") {
            const children = (await live<TicketValue>(tx, "ticket")).filter(
              (ticket) => ticket.payload.projectId === id,
            );
            for (const child of children) {
              if (child.destination.kind === "bound" && destinationKey(child.destination) !== destinationKey(to)) {
                foreignChildren.push(child.id);
              } else if (child.destination.kind === "unbound") {
                queue.push(child.id);
              }
            }
          }
        }
        // A named record's own rebind refusal wins over a child's, so a later sign-in
        // is told the account or tenant does not match rather than a cascade detail.
        for (const record of targets) {
          if (record.destination.kind !== "bound") continue;
          const refusal = rebindRefusal(record.destination, to);
          if (!refusal) continue;
          throw new LocalWorkRepositoryError(
            refusal,
            `Record ${record.id} is already bound; refusing to reassign it.`,
          );
        }
        if (foreignChildren.length > 0) {
          throw new LocalWorkRepositoryError(
            "cross_destination",
            `Ticket ${foreignChildren[0]} is already bound to a different destination.`,
          );
        }
        for (const record of targets) {
          if (record.destination.kind === "bound") continue;
          await commit(tx, record, record.payload as never, "update", [], to);
          bound += 1;
        }
        return bound;
      });
    },
  };
}

export type LocalWorkRepository = ReturnType<typeof createLocalWorkRepository>;