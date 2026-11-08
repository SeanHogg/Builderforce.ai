/**
 * ONE SEAM for "who speaks for this ticket" (PRD 37 §5.5 / FR-5).
 *
 * The Coordinator owns the ticket's outward communication, so every ticket-scoped message
 * that reaches a stakeholder — approvals, `ask_human` escalations, run milestones in the
 * linked chat, external board comments, incident notes — names the Coordinator on behalf of
 * whatever acted, never whichever agent happened to be running. `coordinatorVoice` is the
 * pure label function; this is the lookup + label every caller goes through, so no site
 * resolves the coordinator itself.
 *
 * Not cached: a ticket's coordinator changes when it is reassigned, nothing here sits on a
 * hot path (a handful of messages per ticket), and a cached owner would name the PREVIOUS
 * assignee for a while after a handoff. Best-effort: an unresolvable coordinator (unowned
 * ticket, lookup error) keeps the caller's own label, so a message is never lost to this.
 */
import type { Db } from '../../infrastructure/database/connection';
import { reportedFallback } from '../observability/caughtErrorReporter';
import { coordinatorVoice, resolveTicketCoordinator } from './ticketCoordinator';

export interface StakeholderVoiceInput {
  tenantId: number;
  /** The ticket the message is about. Null/absent = not ticket-scoped: the label is kept. */
  taskId?: number | null;
  /** Who actually acted (agent name / requester label). Shown as "on behalf of". */
  actingLabel: string;
}

/** The label a ticket-scoped stakeholder message should carry. */
export async function resolveStakeholderVoice(db: Db, input: StakeholderVoiceInput): Promise<string> {
  if (input.taskId == null || !Number.isInteger(input.taskId) || input.taskId <= 0) return input.actingLabel;
  const coordinator = await resolveTicketCoordinator(db, input.tenantId, input.taskId).catch(reportedFallback(null, { source: 'application/kanban/stakeholderVoice.ts', operation: 'resolveTicketCoordinator', context: { taskId: input.taskId } }));
  return coordinatorVoice(coordinator, input.actingLabel);
}
