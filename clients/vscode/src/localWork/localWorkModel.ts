/**
 * The local work tree's DATA (G05 UI, G21/G23): projects, and the tickets under each, with every
 * row's presented sync status. Pure over a `LocalWorkRepository` and a facts snapshot, so the tree
 * lists the same rows offline, with the platform denied, and in a unit test. No `vscode`.
 *
 * - Tickets come from the repository (`listTickets`), never a platform read.
 * - A ticket whose project is not a local project (a platform project id, or none) goes under one
 *   "unfiled" node, but only when it is the DEVICE'S work: authored here, or bound to the chat it
 *   was created in. A ticket the rail merely read off the platform belongs to that chat's rail, not
 *   to this tree; otherwise every chat's linked tickets would flood "Unfiled".
 * - A platform tier that only the rail shows (an objective, a spec ...) is not a work item here.
 * - Each row's status is `presentRecordSyncStatus`, the ONE presenter over a record and the store's
 *   facts (only that record's events and receipts count).
 */

import type { LocalRecord, TicketValue } from "@builderforce/local-first";
import { isRailOnlyTicket } from "../chatRail/railPayloads";
import type { LocalFirstView } from "../localFirstView";
import type { LocalWorkRepository } from "../localWorkRepository";
import { presentRecordSyncStatus, type PresentedSyncStatus } from "../syncStatusPresenter";

export type LocalWorkFacts = Pick<LocalFirstView, "records" | "events" | "receipts" | "conflicts">;

/** A ticket with no local project shows under "Unfiled" only when it is this device's work. */
export function isUnfiledWork(ticket: Readonly<LocalRecord<TicketValue>>): boolean {
  return ticket.provenance?.source !== "imported" || Boolean((ticket.payload as { chatClientId?: string }).chatClientId);
}

export const UNFILED_NODE_ID = "unfiled";

export interface LocalWorkNode {
  /** Unique within the tree: `project:<id>`, `ticket:<id>` or `unfiled`. */
  key: string;
  kind: "project" | "ticket" | "unfiled";
  /** The record id (empty for the unfiled node). */
  id: string;
  label: string;
  /** A ticket's workflow status; a project's own status when it has one. */
  workStatus?: string;
  sync?: PresentedSyncStatus;
  archived?: boolean;
}

export interface LocalWorkModel {
  roots(): Promise<LocalWorkNode[]>;
  children(node: LocalWorkNode): Promise<LocalWorkNode[]>;
}

export function createLocalWorkModel(ports: {
  repo: Pick<LocalWorkRepository, "listProjects" | "listTickets">;
  facts(): Promise<LocalWorkFacts>;
}): LocalWorkModel {
  const { repo } = ports;

  async function workTickets() {
    return (await repo.listTickets()).filter((ticket) => !isRailOnlyTicket(ticket.payload));
  }

  function ticketNode(ticket: Awaited<ReturnType<typeof workTickets>>[number], facts: LocalWorkFacts): LocalWorkNode {
    return {
      key: `ticket:${ticket.id}`,
      kind: "ticket",
      id: ticket.id,
      label: ticket.payload.title,
      workStatus: ticket.payload.status,
      sync: presentRecordSyncStatus(facts, ticket),
      archived: ticket.payload.archived === true,
    };
  }

  return {
    async roots() {
      const [projects, tickets, facts] = await Promise.all([repo.listProjects(), workTickets(), ports.facts()]);
      const nodes: LocalWorkNode[] = projects.map((project) => ({
        key: `project:${project.id}`,
        kind: "project",
        id: project.id,
        label: project.payload.name,
        ...(project.payload.status ? { workStatus: project.payload.status } : {}),
        sync: presentRecordSyncStatus(facts, project),
      }));
      const projectIds = new Set(projects.map((project) => project.id));
      if (tickets.some((ticket) => !projectIds.has(ticket.payload.projectId) && isUnfiledWork(ticket))) {
        nodes.push({ key: UNFILED_NODE_ID, kind: "unfiled", id: "", label: "" });
      }
      return nodes;
    },

    async children(node) {
      if (node.kind === "ticket") return [];
      const [tickets, projects, facts] = await Promise.all([workTickets(), repo.listProjects(), ports.facts()]);
      const projectIds = new Set(projects.map((project) => project.id));
      const mine = node.kind === "project"
        ? tickets.filter((ticket) => ticket.payload.projectId === node.id)
        : tickets.filter((ticket) => !projectIds.has(ticket.payload.projectId) && isUnfiledWork(ticket));
      return mine.map((ticket) => ticketNode(ticket, facts));
    },
  };
}

/** The local chat a ticket is bound to: the chat it was created in, else a live link's chat. */
export function boundChatOf(
  facts: Pick<LocalFirstView, "records">,
  ticketId: string,
): { chatClientId: string; localChatId: number } | undefined {
  const ticket = facts.records.find((row) => row.entityType === "ticket" && row.id === ticketId && !row.deletedAt);
  if (!ticket) return undefined;
  const created = (ticket.payload as { chatClientId?: string }).chatClientId;
  const candidates: string[] = created ? [created] : [];
  for (const row of facts.records) {
    if (row.entityType !== "chat-ticket-link" || row.deletedAt) continue;
    const link = row.payload as { chatClientId: string; ticketClientId: string; linkType: string };
    if (link.ticketClientId === ticketId) candidates.push(link.chatClientId);
  }
  for (const chatClientId of candidates) {
    const chat = facts.records.find((row) => row.entityType === "chat" && row.id === chatClientId && !row.deletedAt);
    const localChatId = (chat?.payload as { chat?: { id?: number } } | undefined)?.chat?.id;
    if (typeof localChatId === "number") return { chatClientId, localChatId };
  }
  return undefined;
}
