/**
 * `roadmap.align_tickets`'s SPEC mode (`specPath`): "does every open item of this spec have a
 * ticket?" for any markdown spec — its status-table rows, checklist items or gap register.
 *
 * The parse and the join are the shared ones (`@builderforce/agent-tools`
 * `parseSpecOpenItems` + `specTicketCoverage`, the same pair the Brain's finish gate reads),
 * so the tool and the gate cannot disagree on what "covered" means. This only shapes the
 * answer into the tool's capped lists.
 *
 * Pure: no db, no env.
 */
import { specItemsOwingTickets, specTicketCoverage, type CoverageTicket, type SpecOpenItem } from '@builderforce/agent-tools';
import { capped, type CappedList } from './alignTicketsToRoadmap';

export interface SpecTicketCoverageReport {
  projectId: number;
  specPath: string;
  /** Items the spec lists, any status. */
  items: number;
  /** Items still owing a ticket (incomplete + blocked). */
  openItems: number;
  itemsByStatus: Record<string, number>;
  tickets: number;
  covered: CappedList<{ itemId: string; ticketIds: Array<number | string> }>;
  missing: CappedList<{ itemId: string; title: string; status: string; section: string; line: number; blocker?: string }>;
}

export function specTicketCoverageReport(input: {
  projectId: number;
  specPath: string;
  items: readonly SpecOpenItem[];
  tickets: readonly CoverageTicket<number | string>[];
}): SpecTicketCoverageReport {
  const itemsByStatus: Record<string, number> = {};
  for (const i of input.items) itemsByStatus[i.status] = (itemsByStatus[i.status] ?? 0) + 1;
  const { covered, missing } = specTicketCoverage(input.items, input.tickets);
  return {
    projectId: input.projectId,
    specPath: input.specPath,
    items: input.items.length,
    openItems: specItemsOwingTickets(input.items).length,
    itemsByStatus,
    tickets: input.tickets.length,
    covered: capped(covered),
    missing: capped(missing.map((i) => ({
      itemId: i.id, title: i.title, status: i.status, section: i.section, line: i.line, ...(i.blocker ? { blocker: i.blocker } : {}),
    }))),
  };
}
