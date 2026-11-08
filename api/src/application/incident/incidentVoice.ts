/**
 * The voice an incident timeline note carries when the incident is bridged to a board
 * ticket (`prod_incidents.board_task_id`). PRD 37 §5.5: the ticket's Coordinator owns the
 * outward communication, so a war-room note names the Coordinator on behalf of the agent
 * that wrote it. An incident with no bridged ticket keeps the acting label.
 *
 * Kept out of `IncidentService` (already large) — one lookup + the shared seam.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { prodIncidents } from '../../infrastructure/database/schema';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { resolveStakeholderVoice } from '../kanban/stakeholderVoice';

/** `incident_events.actor_ref` is varchar(128); a long composed label must not fail the write. */
const ACTOR_REF_MAX = 128;

export async function resolveIncidentVoice(
  db: Db,
  args: { tenantId: number; incidentId: string; actingLabel: string },
): Promise<string> {
  let boardTaskId: number | null = null;
  try {
    const [row] = await db
      .select({ boardTaskId: prodIncidents.boardTaskId })
      .from(prodIncidents)
      .where(and(eq(prodIncidents.id, args.incidentId), eq(prodIncidents.tenantId, args.tenantId)))
      .limit(1);
    boardTaskId = row?.boardTaskId ?? null;
  } catch (error) {
    // Best-effort: an unreadable incident keeps the acting label.
    reportCaughtError(error, {
      source: 'application/incident/incidentVoice.ts', operation: 'resolveIncidentVoice',
      level: 'warning', context: { tenantId: args.tenantId, incidentId: args.incidentId },
    });
  }
  const voiced = await resolveStakeholderVoice(db, { tenantId: args.tenantId, taskId: boardTaskId, actingLabel: args.actingLabel });
  return voiced.slice(0, ACTOR_REF_MAX);
}
