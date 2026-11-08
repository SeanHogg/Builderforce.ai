/**
 * The local work tree's DATA (G05 UI, G21/G23): projects, and the tickets under each, with every
 * row's presented sync status. Pure over a `LocalWorkRepository` and a facts snapshot, so the tree
 * lists the same rows offline, with the platform denied, and in a unit test. No `vscode`.
 *
 * - Tickets come from the repository (`listTickets`), never a platform read.
 * - A ticket whose project is not a local project (a platform project id, or none: the rail
 *   ingests platform tickets without one) goes under one "unfiled" node, so no row is dropped.
 * - A platform tier that only the rail shows (an objective, a spec ...) is not a work item here.
 * - Each row's status is `presentSurfaceSyncStatus` / `presentStoreSyncStatus` over a snapshot
 *   narrowed to that one record (the presenter scans `records` to find it).
 */

import type { LocalFirstSnapshot, LocalRecord } from "@builderforce/local-first";
import { isRailOnlyTicket } from "../chatRail/railPayloads";
import type { LocalWorkRepository } from "../localWorkRepository";
import { presentStoreSyncStatus, presentSurfaceSyncStatus, type PresentedSyncStatus } from "../syncStatusPresenter";

export type LocalWorkFacts = Pick<LocalFirstSnapshot, "records" | "events" | "receipts" | "conflicts">;

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

function narrow(facts: LocalWorkFacts, record: LocalRecord) {
  return { records: [record], events: facts.events, receipts: facts.receipts, conflicts: facts.conflicts };
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
      sync: presentSurfaceSyncStatus(narrow(facts, ticket), "ticket", ticket.id),
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
        sync: presentStoreSyncStatus(narrow(facts, project), { entityType: "project", id: project.id }),
      }));
      const projectIds = new Set(projects.map((project) => project.id));
      if (tickets.some((ticket) => !projectIds.has(ticket.payload.projectId))) {
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
        : tickets.filter((ticket) => !projectIds.has(ticket.payload.projectId));
      return mine.map((ticket) => ticketNode(ticket, facts));
    },
  };
}

/** The local chat a ticket is bound to: the chat it was created in, else a live link's chat. */
export function boundChatOf(
  facts: Pick<LocalFirstSnapshot, "records">,
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
