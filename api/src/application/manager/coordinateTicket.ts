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
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';
import { boards, swimlanes, tasks } from '../../infrastructure/database/schema';
import { TicketParticipantsService } from '../kanban/ticketParticipants';
import { maybeAutoRunOnLaneEntry } from '../swimlane/laneEntryTrigger';
import { findCanonicalBoard } from '../swimlane/canonicalBoard';

export interface CoordinateResult {
  ok: boolean;
  status: string;
  dispatched: boolean;
  requiredOutstanding: number;
}

export interface CoordinateCompletionResult {
  managed: boolean;
  advanced: boolean;
  fromStatus: string;
  toStatus: string;
  outstanding: string[];
}

export function decideCoordinatedAdvance(
  manifest: Array<{ required: boolean; stageKey: string | null; state: string; roleName: string }>,
  lanes: Array<{ key: string; isTerminal: boolean }>,
  fromStatus: string,
): { nextStatus: string | null; outstanding: string[] } {
  const done = new Set(['completed', 'waived', 'skipped']);
  const stageOutstanding = manifest
    .filter((p) => p.required && p.stageKey === fromStatus && !done.has(p.state))
    .map((p) => p.roleName);
  if (stageOutstanding.length) return { nextStatus: null, outstanding: stageOutstanding };
  const current = lanes.findIndex((l) => l.key === fromStatus);
  const next = current >= 0 ? lanes[current + 1] : null;
  if (!next) return { nextStatus: null, outstanding: [] };
  if (next.isTerminal) {
    const allOutstanding = manifest.filter((p) => p.required && !done.has(p.state)).map((p) => p.roleName);
    if (allOutstanding.length) return { nextStatus: null, outstanding: allOutstanding };
  }
  return { nextStatus: next.key, outstanding: [] };
}

/**
 * The managed-ticket completion hand-off. This is the sole status writer for an
 * execution completing a lifecycle-managed stage: verify the CURRENT stage's
 * manifest slots, advance exactly one configured lane only when they are satisfied,
 * then trigger coordination in the destination lane.
 */
export async function coordinateCompletedStage(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  args: { tenantId: number; projectId: number; taskId: number; fromStatus: string },
): Promise<CoordinateCompletionResult> {
  const unchanged = (managed: boolean, outstanding: string[] = []): CoordinateCompletionResult => ({
    managed, advanced: false, fromStatus: args.fromStatus, toStatus: args.fromStatus, outstanding,
  });
  const board = await findCanonicalBoard(db, args.projectId, args.tenantId);
  if (!board?.lifecycleManaged) return unchanged(false);

  const participants = new TicketParticipantsService(db);
  await participants.syncStates(env, args.tenantId, args.taskId);
  const manifest = await participants.listParticipants(env, args.tenantId, args.taskId);
  const lanes = await db.select({ key: swimlanes.key, isTerminal: swimlanes.isTerminal })
    .from(swimlanes).where(eq(swimlanes.boardId, board.id)).orderBy(asc(swimlanes.position));
  const decision = decideCoordinatedAdvance(manifest, lanes, args.fromStatus);
  if (!decision.nextStatus) return unchanged(true, decision.outstanding);
  const next = lanes.find((l) => l.key === decision.nextStatus)!;

  const changed = await db.update(tasks).set({ status: next.key, updatedAt: new Date() })
    .where(and(eq(tasks.id, args.taskId), eq(tasks.status, args.fromStatus))).returning({ id: tasks.id });
  if (!changed.length) return unchanged(true);

  if (!next.isTerminal) {
    await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
      ...args, status: next.key, originLaneKey: args.fromStatus, submittedBy: 'system:coordinator',
    });
  }
  return { managed: true, advanced: true, fromStatus: args.fromStatus, toStatus: next.key, outstanding: [] };
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

  // Applying coordinated governance to an already-active legacy ticket can reveal
  // earlier BA/Design stages that never happened. Rewind to the earliest unmet
  // required stage before dispatching anything; otherwise a ticket already in
  // Implementation would run a Developer first and strand its BA/Architect slots.
  const board = await findCanonicalBoard(db, task.projectId, args.tenantId);
  if (board?.lifecycleManaged) {
    const lanes = await db.select({ key: swimlanes.key, position: swimlanes.position })
      .from(swimlanes).where(eq(swimlanes.boardId, board.id)).orderBy(asc(swimlanes.position));
    const position = new Map(lanes.map((lane) => [lane.key, lane.position]));
    const currentPosition = position.get(task.status);
    const earliest = manifest
      .filter((p) => p.required && p.stageKey && !done.has(p.state) && position.has(p.stageKey))
      .sort((a, b) => position.get(a.stageKey!)! - position.get(b.stageKey!)!)[0];
    if (earliest?.stageKey && currentPosition != null && position.get(earliest.stageKey)! < currentPosition) {
      const moved = await db.update(tasks).set({ status: earliest.stageKey, updatedAt: new Date() })
        .where(and(eq(tasks.id, args.taskId), eq(tasks.status, task.status))).returning({ id: tasks.id });
      if (moved.length) {
        const dispatched = await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
          tenantId: args.tenantId, projectId: task.projectId, taskId: args.taskId,
          status: earliest.stageKey, originLaneKey: task.status, submittedBy: 'system:coordinator',
        }).catch(() => false);
        return { ok: true, status: earliest.stageKey, dispatched, requiredOutstanding };
      }
    }
  }

  // A sign-off or other out-of-band contribution may satisfy the stage after its
  // execution already finished. The explicit Coordinator tick must therefore try
  // the same verified advancement path, not merely re-run the current lane gate.
  const advancement = await coordinateCompletedStage(env, db, runtimeService, {
    tenantId: args.tenantId, projectId: task.projectId, taskId: args.taskId, fromStatus: task.status,
  }).catch(() => null);
  if (advancement?.advanced) {
    return { ok: true, status: advancement.toStatus, dispatched: true, requiredOutstanding };
  }

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
