/**
 * The VSIX local TICKET repository: create / update / move / archive / delete, committed
 * through the shared commit helper (`localWorkShared.ts`). No network.
 *
 *   • A ticket's destination is SNAPPED from its project at creation (G11).
 *   • A decimal `projectId` / `parentTicketId` is a SERVER reference: stored verbatim,
 *     resolved by the sync importer as something the tenant owns. A UUID must be a live
 *     local record.
 *   • A ticket carries `taskType` (task | epic | gap) and the `chatClientId` of the chat it
 *     was created in, which sync turns into the chat↔ticket 'created' link.
 *   • A new ticket depends on the CURRENT pending event of its project, parent and chat —
 *     whatever that is (a create, an update, or the import a bind replaced them with).
 */

import {
  destinationKey,
  newLocalRecord,
  type DestinationBinding,
  type EntityDestination,
  type LocalRecord,
  type TicketTaskType,
  type TicketValue,
} from "@builderforce/local-first";
import {
  DEFAULT_TICKET_STATUS,
  LocalWorkRepositoryError,
  assertStatus,
  commitRecord,
  creationDestination,
  eventId,
  isServerReference,
  live,
  waitKeyOf,
  projectFor,
  requireText,
  ticketFor,
  type LocalTicket,
  type WorkRepoContext,
} from "./localWorkShared";

export interface CreateLocalTicketInput {
  /** A live local project's id, or a DECIMAL server project id (a server reference). */
  projectId: string;
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  /** A local ticket's id (must exist), or a DECIMAL server task id (a server reference). */
  parentTicketId?: string;
  taskType?: TicketTaskType;
  /** The client id of the chat the ticket is created in; sync links that chat to it. */
  chatClientId?: string;
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

export type LocalTicketPatch = Partial<Pick<TicketValue, "title" | "description" | "priority" | "assignedUserId" | "taskType">>;

export function createTicketRepository(ctx: WorkRepoContext) {
  return {
    async listTickets(filter: ListLocalTicketsFilter = {}): Promise<LocalTicket[]> {
      return ctx.store.read(async (tx) =>
        (await live<TicketValue>(tx, "ticket"))
          .filter((ticket) => !filter.projectId || ticket.payload.projectId === filter.projectId)
          .filter((ticket) => filter.includeArchived || !ticket.payload.archived)
          .filter((ticket) => !filter.status || ticket.payload.status === filter.status),
      );
    },

    async getTicket(id: string): Promise<LocalTicket> {
      return ctx.store.read((tx) => ticketFor(tx, id));
    },

    async createTicket(input: CreateLocalTicketInput): Promise<LocalTicket> {
      const title = requireText(input.title, "ticket_title_required", "A ticket needs a title.");
      const status = input.status ?? DEFAULT_TICKET_STATUS;
      assertStatus(status);
      const priority = input.priority?.trim();
      return ctx.store.transact(async (tx) => {
        // A decimal project id is a server reference: no local project to look up or
        // snap a destination from, so the ticket takes the repository's (or the call's).
        const projectRef = input.projectId.trim();
        const project = isServerReference(projectRef) ? undefined : await projectFor(tx, input.projectId);
        // The destination is the PROJECT's, snapped now. Never re-read at sync time,
        // and never taken from a caller's own account argument.
        if (input.destination !== undefined && project) {
          const proposed = creationDestination(input.destination);
          if (destinationKey(proposed) !== destinationKey(project.destination)) {
            throw new LocalWorkRepositoryError(
              "cross_destination",
              "A ticket belongs to its project's destination; bind the project instead.",
            );
          }
        }
        const stamp = ctx.now().toISOString();
        const parentRef = input.parentTicketId?.trim();
        const payload: TicketValue = {
          projectId: project?.id ?? projectRef,
          title,
          status,
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(priority ? { priority } : {}),
          ...(parentRef ? { parentTicketId: parentRef } : {}),
          ...(input.taskType ? { taskType: input.taskType } : {}),
          ...(input.chatClientId ? { chatClientId: input.chatClientId } : {}),
        };
        const record: LocalRecord<TicketValue> = newLocalRecord<TicketValue>({
          id: input.id?.trim() || ctx.newId(),
          entityType: "ticket",
          payload,
          deviceId: ctx.deviceId,
          destination: project ? project.destination : ctx.stampFor(input.destination),
          occurredAt: stamp,
        });
        // Wait on the referenced records' CURRENT pending events, so a later batch push
        // applies the project, the parent and the chat first even after they were updated
        // or re-keyed to an import by a bind. A server reference has nothing local to wait for.
        const dependsOn: string[] = [];
        const waitOn = async (entityType: "project" | "ticket" | "chat", id: string): Promise<void> => {
          const key = await waitKeyOf(tx, entityType, id);
          if (key && !dependsOn.includes(key)) dependsOn.push(key);
        };
        if (project) await waitOn("project", project.id);
        if (parentRef && !isServerReference(parentRef)) {
          const parent = await ticketFor(tx, parentRef);
          if (parent.payload.projectId !== payload.projectId) {
            throw new LocalWorkRepositoryError(
              "cross_destination",
              "A subticket belongs to its parent's project.",
            );
          }
          await waitOn("ticket", parent.id);
        }
        if (input.chatClientId) await waitOn("chat", input.chatClientId);
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

    async updateTicket(id: string, patch: LocalTicketPatch): Promise<LocalTicket> {
      if (patch.title !== undefined) requireText(patch.title, "ticket_title_required", "A ticket needs a title.");
      return ctx.store.transact(async (tx) => {
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
        if (patch.taskType !== undefined) payload.taskType = patch.taskType;
        return commitRecord(ctx, tx, current, payload, "update");
      });
    },

    /** Move a ticket in its board. A local write: the status never leaves this machine. */
    async changeTicketStatus(id: string, status: string): Promise<LocalTicket> {
      assertStatus(status);
      return ctx.store.transact(async (tx) => {
        const current = await ticketFor(tx, id);
        if (current.payload.archived) {
          throw new LocalWorkRepositoryError("ticket_archived", "Unarchive the ticket before moving it.");
        }
        return commitRecord(ctx, tx, current, { ...current.payload, status }, "update");
      });
    },

    async setTicketArchived(id: string, archived: boolean): Promise<LocalTicket> {
      return ctx.store.transact(async (tx) => {
        const current = await ticketFor(tx, id);
        return commitRecord(ctx, tx, current, { ...current.payload, archived }, "update");
      });
    },

    async deleteTicket(id: string): Promise<void> {
      await ctx.store.transact(async (tx) => {
        const current = await ticketFor(tx, id);
        const children = (await live<TicketValue>(tx, "ticket")).filter(
          (ticket) => ticket.payload.parentTicketId === id,
        );
        if (children.length > 0) {
          throw new LocalWorkRepositoryError("ticket_has_children", "Delete or move the subtickets first.");
        }
        await commitRecord(ctx, tx, current, current.payload, "delete");
      });
    },
  };
}
