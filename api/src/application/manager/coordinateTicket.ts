/**
 * The per-ticket Coordinator tick (PRD-coordinated-role-participation.md §5.5).
 *
 * Forces one coordination pass over a single ticket: ensures its participation
 * manifest is derived, then fires the SAME lane trigger the autonomous flow uses —
 * which runs the lane gate (`enforceLaneRequirements`), resolving + dispatching the
 * next required role-capable participant (producer or reviewer) and recording the
 * hand-off. The Coordinator sequences roles and drives advancement; it never
 * produces the work itself. Invoked by `POST /api/kanban/tasks/:id/coordinate`
 * ("drive this ticket now") and reusable from a light sweep.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';
import { tasks } from '../../infrastructure/database/schema';
import { TicketParticipantsService } from '../kanban/ticketParticipants';
import { maybeAutoRunOnLaneEntry } from '../../presentation/routes/taskRoutes';

export interface CoordinateResult {
  ok: boolean;
  status: string;
  dispatched: boolean;
  requiredOutstanding: number;
}

export async function coordinateTicket(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  args: { tenantId: number; taskId: number },
): Promise<CoordinateResult> {
  const [task] = await db
    .select({ projectId: tasks.projectId, status: tasks.status })
    .from(tasks)
    .where(eq(tasks.id, args.taskId))
    .limit(1);
  if (!task) return { ok: false, status: '', dispatched: false, requiredOutstanding: 0 };

  const participants = new TicketParticipantsService(db);
  // Ensure the manifest exists + is in step before we sequence the next role.
  const manifest = await participants.listParticipants(env, args.tenantId, args.taskId).catch(() => []);
  const done = new Set(['completed', 'waived', 'skipped']);
  const requiredOutstanding = manifest.filter((p) => p.required && !done.has(p.state)).length;

  // Drive the current lane: the gate resolves + dispatches the next required role
  // and records the hand-off; the normal auto-run covers a non-gated lane.
  const dispatched = await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
    tenantId: args.tenantId,
    projectId: task.projectId,
    taskId: args.taskId,
    status: task.status,
    submittedBy: 'system:coordinator',
  }).catch(() => false);

  return { ok: true, status: task.status, dispatched, requiredOutstanding };
}
