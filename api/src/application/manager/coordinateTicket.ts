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
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { TicketParticipantsService } from '../kanban/ticketParticipants';
import { maybeAutoRunOnLaneEntry } from '../swimlane/laneEntryTrigger';
import { findCanonicalBoard } from '../swimlane/canonicalBoard';
import { blocksCompletion } from '../kanban/participantStates';
import { isParkedLane } from '../swimlane/nextLane';

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
  /** A billable run was started on entry to the destination lane. */
  dispatched: boolean;
}

export function decideCoordinatedAdvance(
  manifest: Array<{ required: boolean; stageKey: string | null; state: string; roleName: string }>,
  lanes: Array<{ key: string; isTerminal: boolean }>,
  fromStatus: string,
): { nextStatus: string | null; outstanding: string[] } {
  const stageOutstanding = manifest
    .filter((p) => p.stageKey === fromStatus && blocksCompletion(p))
    .map((p) => p.roleName);
  if (stageOutstanding.length) return { nextStatus: null, outstanding: stageOutstanding };
  const current = lanes.findIndex((l) => l.key === fromStatus);
  // Skip PARKED lanes (blocked / on-hold / cancelled) exactly as `resolveNextLaneKey`
  // does — they sit mid-order on the default board, and advancing a satisfied stage into
  // one is the trap described in {@link ../swimlane/nextLane.PARKED_LANE_KEYS}.
  let next: { key: string; isTerminal: boolean } | null = null;
  if (current >= 0) {
    for (let i = current + 1; i < lanes.length; i += 1) {
      const cand = lanes[i];
      if (!cand || isParkedLane(cand.key)) continue;
      next = cand;
      break;
    }
  }
  if (!next) return { nextStatus: null, outstanding: [] };
  if (next.isTerminal) {
    const allOutstanding = manifest.filter(blocksCompletion).map((p) => p.roleName);
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
  args: {
    tenantId: number; projectId: number; taskId: number; fromStatus: string;
    /** See {@link coordinateTicket}'s `dispatch`. Defaults to true. */
    dispatch?: boolean;
  },
): Promise<CoordinateCompletionResult> {
  const unchanged = (managed: boolean, outstanding: string[] = []): CoordinateCompletionResult => ({
    managed, advanced: false, fromStatus: args.fromStatus, toStatus: args.fromStatus, outstanding, dispatched: false,
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

  // The ADVANCE is a state change and always happens; only the destination lane's run is
  // subject to the caller's dispatch budget. Withholding the advance would be worse than
  // spending the run — a satisfied stage that cannot move is a new kind of stall.
  const dispatched = (args.dispatch ?? true) && !next.isTerminal
    ? await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
      tenantId: args.tenantId, projectId: args.projectId, taskId: args.taskId,
      status: next.key, originLaneKey: args.fromStatus, submittedBy: 'system:coordinator',
    })
    : false;
  return { managed: true, advanced: true, fromStatus: args.fromStatus, toStatus: next.key, outstanding: [], dispatched };
}

export async function coordinateTicket(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  args: {
    tenantId: number; taskId: number;
    /**
     * A HUMAN clicked "Dispatch reviewers" (POST /coordinate is manager-gated). The role
     * asks then override the failure breaker + re-run cooldown, exactly as "Run now"
     * does — without it the button is inert on precisely the tickets it exists for: one
     * whose last runs failed has its reviewer dispatch refused, so the click reports
     * "dispatched: false" and no reviewer can ever be asked. Autonomous callers (the
     * manager's coordinate remedy, the sign-off route) leave it unset.
     */
    force?: boolean;
    /**
     * May this coordination START a billable run? Defaults to true.
     *
     * ── WHY THIS PARAMETER EXISTS ────────────────────────────────────────────────
     * Coordination was classified as a remedy that "costs no run" — the triage stage
     * hands it `mayStartRun: false` on that basis — while in fact every one of its three
     * paths calls `maybeAutoRunOnLaneEntry` and starts one. It was the only branch of the
     * eight that consulted neither flag, so it spent outside the cap on every pass:
     * measured live on project 11, `{"dispatched":7,"dispatchCap":3}` on a `free` plan.
     * The remedy was classified by what it was INTENDED to cost, and nothing checked what
     * it actually cost.
     *
     * With `dispatch: false` the coordination still runs in full — it syncs the manifest,
     * rewinds to the earliest unmet stage, and advances a satisfied one. It simply does
     * not start the run at the end, and reports `dispatched: false` honestly, so the
     * caller's budget accounting matches what happened.
     */
    dispatch?: boolean;
  },
): Promise<CoordinateResult> {
  const mayDispatch = args.dispatch ?? true;
  const [task] = await db
    .select({ projectId: tasks.projectId, status: tasks.status })
    .from(tasks)
    .where(eq(tasks.id, args.taskId))
    .limit(1);
  if (!task) return { ok: false, status: '', dispatched: false, requiredOutstanding: 0 };

  const participants = new TicketParticipantsService(db);
  // Ensure the manifest exists + is in step before we sequence the next role.
  const manifest = await participants.listParticipants(env, args.tenantId, args.taskId).catch(() => []);
  const requiredOutstanding = manifest.filter(blocksCompletion).length;

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
    // ── THE REWIND, AND WHY IT IS NOW BOUNDED ────────────────────────────────────
    // Rewinding to the earliest unmet stage is right for a ticket that genuinely
    // skipped a stage. It is catastrophic for a ticket whose slots can never be
    // satisfied — and platform-wide, `ticket_role_signoffs` holds ZERO rows, so no
    // reviewer slot has ever completed. Every managed ticket therefore has an open
    // slot at its earliest stage, forever, and the rewind fired every pass: measured
    // 131 `in_review → ready` moves across 31 tickets in ~30 hours, each preceded by a
    // `manager:signoff-request` run, with 299 tickets currently eligible.
    //
    // A slot the manager has ALREADY ASKED (`in_progress` — the marker `requestRoleRun`
    // writes on dispatch) is not evidence the stage was skipped; it is evidence the ask
    // is outstanding. Dragging the ticket backwards does not make that verdict arrive,
    // it just undoes the work in front of it. So only a stage that has never been
    // engaged at all (`assigned`/`unstaffed`) justifies a rewind.
    const neverEngaged = (state: string): boolean => state !== 'in_progress';
    const earliest = manifest
      .filter((p) => p.stageKey && blocksCompletion(p) && neverEngaged(p.state) && position.has(p.stageKey))
      .sort((a, b) => position.get(a.stageKey!)! - position.get(b.stageKey!)!)[0];
    if (earliest?.stageKey && currentPosition != null && position.get(earliest.stageKey)! < currentPosition) {
      const moved = await db.update(tasks).set({ status: earliest.stageKey, updatedAt: new Date() })
        .where(and(eq(tasks.id, args.taskId), eq(tasks.status, task.status))).returning({ id: tasks.id });
      if (moved.length) {
        const dispatched = mayDispatch
          ? await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
            tenantId: args.tenantId, projectId: task.projectId, taskId: args.taskId,
            status: earliest.stageKey, originLaneKey: task.status, submittedBy: 'system:coordinator',
            ...(args.force ? { force: true } : {}),
          }).catch(() => false)
          : false;
        return { ok: true, status: earliest.stageKey, dispatched, requiredOutstanding };
      }
    }
  }

  // A sign-off or other out-of-band contribution may satisfy the stage after its
  // execution already finished. The explicit Coordinator tick must therefore try
  // the same verified advancement path, not merely re-run the current lane gate.
  const advancement = await coordinateCompletedStage(env, db, runtimeService, {
    tenantId: args.tenantId, projectId: task.projectId, taskId: args.taskId, fromStatus: task.status,
    dispatch: mayDispatch,
  }).catch(() => null);
  if (advancement?.advanced) {
    // Report the run that ACTUALLY started, not the advance. Reporting `true` here was
    // how an advance with no dispatch still debited the caller's budget.
    return { ok: true, status: advancement.toStatus, dispatched: advancement.dispatched, requiredOutstanding };
  }

  // Drive the current lane: the gate resolves + dispatches the next required role
  // and records the hand-off; the normal auto-run covers a non-gated lane.
  const dispatched = mayDispatch
    ? await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
      tenantId: args.tenantId,
      projectId: task.projectId,
      taskId: args.taskId,
      status: task.status,
      submittedBy: 'system:coordinator',
      ...(args.force ? { force: true } : {}),
    }).catch(() => false)
    : false;

  return { ok: true, status: task.status, dispatched, requiredOutstanding };
}
