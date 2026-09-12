/**
 * reviewGateAuthority — MAY THE MANAGER CLOSE A TICKET THROUGH A HUMAN-GATED REVIEW LANE?
 *
 * ── THE DECISION (operator, 2026-09-12) ─────────────────────────────────────────
 * "The autonomous Manager can review and close a ticket — this should be a setting the
 * ADMIN of the account sets." A board's review lane can be gated `human`, which means a
 * person approves every ticket there. Before this module three readers disagreed about
 * what that gate meant for the manager:
 *
 *   • stall triage + the census reported every such ticket as `human_gate` — a standing
 *     escalation, by design, because the manager must not override a gate a human set;
 *   • the manager's CONDUCT step never read the gate at all, and closed any review-ready
 *     ticket it judged complete — i.e. it silently did the very override the other two
 *     said it must not.
 *
 * Two readings of one rule is the defect class this codebase keeps paying for. So there
 * is now ONE answer, {@link decideReviewGate}, and every reader asks it:
 *
 *   • gate not `human`, or not a review lane      → `open`: nothing changes.
 *   • human-gated review lane, setting OFF        → `held_for_human`: the manager still
 *     REVIEWS (returns unfinished work, drives sign-offs) but a person closes the ticket.
 *   • human-gated review lane, setting ON         → `manager_authorized`: the manager's
 *     review verdict IS the approval; a passing ticket is closed under the workspace
 *     setting's authority, recorded on the ledger and the override audit trail.
 *
 * The setting is `managerMayCloseReviewedTickets` on the WORKSPACE tier only (see
 * `managerPolicy.ts`) — an account-admin decision, never a per-project one.
 *
 * Pure decision functions first (unit-tested without a database), then the two small IO
 * helpers the conduct step needs. Kept out of `ManagerService.ts` on purpose: that module
 * is already the manager's largest, and a policy is not a stage.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { swimlanes } from '../../infrastructure/database/schema';
import { findCanonicalBoard } from '../swimlane/canonicalBoard';
import { isReviewLane, REVIEW_CLASS, type TransitionActorInput } from '../task/taskLifecycle';
import { resolveManagerAssignee } from './managerPolicy';
import { recordManagerActionOnChange, stateFingerprint } from './managerActionJournal';
import { recordActivity, cloudAgentActor, hostAgentActor, SYSTEM_ACTOR } from '../activity/activityLog';
import { recordCloudToolEvent } from '../runtime/cloudToolEvents';
import { MANAGED_OVERRIDE_EVENT, systemInitiated, describeAuthority, type ExecutionAuthority } from '../runtime/executionAuthority';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** The authority a manager-closed review carries — names the setting, so an auditor can
 *  trace the close back to the admin decision that allowed it. */
export const MANAGER_REVIEW_CLOSE_SETTING = 'managerMayCloseReviewedTickets' as const;

/** The activity verb for a manager-authorized review close (ledger + audit timeline). */
export const MANAGER_REVIEW_CLOSE_VERB = 'manager.review_close' as const;

/** `manager_actions` state key for "reviewed and ready, held for a person". */
export const REVIEW_GATE_HELD_STATE_KEY = 'review_gate_held' as const;

export type ReviewGateVerdict = 'open' | 'held_for_human' | 'manager_authorized';

export interface ReviewGateInput {
  /** The ticket's lane key (`tasks.status`). */
  status: string | null | undefined;
  /** That lane's configured gate, or null/undefined when unknown (treated as not human). */
  laneGate: string | null | undefined;
  /** The workspace's effective `managerMayCloseReviewedTickets`. */
  managerMayCloseReviewedTickets: boolean;
}

/**
 * THE one answer. PURE.
 *
 * Only a REVIEW-class lane is in scope: a human gate anywhere else (the staging
 * `backlog`, say) is a different decision the operator did not delegate, and stays a
 * human's however this setting is configured.
 */
export function decideReviewGate(input: ReviewGateInput): ReviewGateVerdict {
  if (input.laneGate !== 'human' || !isReviewLane(input.status)) return 'open';
  return input.managerMayCloseReviewedTickets ? 'manager_authorized' : 'held_for_human';
}

/** True when the workspace handed this ticket's review gate to the manager. PURE. */
export function managerHoldsReviewGate(input: ReviewGateInput): boolean {
  return decideReviewGate(input) === 'manager_authorized';
}

/**
 * WHO the ledger credits for a manager-authorized close. PURE.
 *
 * The manager, when the manager is an agent that can be named (`c:` / `h:`) — it made
 * the decision. Otherwise (the system service, or a HUMAN designated as manager, who did
 * not act here) it falls back to the ticket's executor exactly as every other completion
 * does, so the row is still agent-attributed and never reads as a person's hop.
 */
export function reviewCloseActor(
  managerRef: string | null | undefined,
  executor: { assignedAgentRef: string | null; assignedAgentHostId: number | null },
): TransitionActorInput {
  const manager = resolveManagerAssignee(managerRef);
  if (manager.assignedAgentRef) return { actorAgentRef: manager.assignedAgentRef };
  if (manager.assignedAgentHostId != null) return { actorAgentHostId: manager.assignedAgentHostId };
  return { actorAgentRef: executor.assignedAgentRef, actorAgentHostId: executor.assignedAgentHostId };
}

/** The declared authority a manager-authorized close carries. PURE. */
export function reviewCloseAuthority(taskTitle: string): ExecutionAuthority {
  return systemInitiated(
    'manager',
    `Closed "${taskTitle}" through the human-gated review lane: the workspace setting ${MANAGER_REVIEW_CLOSE_SETTING} lets the manager review and close tickets.`,
  );
}

// ── IO ──────────────────────────────────────────────────────────────────────

/**
 * The gates of the project's REVIEW-class lanes, keyed by lane key — one query for the
 * whole review cohort, so the conduct step never reads a lane per ticket.
 */
export async function loadReviewLaneGates(db: Db, tenantId: number, projectId: number): Promise<Map<string, string>> {
  const board = await findCanonicalBoard(db, projectId, tenantId);
  if (!board) return new Map();
  const rows = await db
    .select({ key: swimlanes.key, gate: swimlanes.gate })
    .from(swimlanes)
    .where(and(eq(swimlanes.boardId, board.id), inArray(swimlanes.key, [...REVIEW_CLASS])));
  return new Map(rows.map((r) => [r.key, r.gate]));
}

/**
 * Journal "reviewed and ready — held for a person". A STATE, not an event: written once
 * per ticket until something changes, never every five minutes.
 */
export async function recordReviewGateHeld(
  db: Db,
  a: { tenantId: number; projectId: number; taskId: number; runTaskId: number | null; title: string; detail: string },
): Promise<void> {
  await recordManagerActionOnChange(db, {
    tenantId: a.tenantId, projectId: a.projectId, taskId: a.taskId, runTaskId: a.runTaskId,
    actionType: 'flag',
    summary: `Reviewed "${a.title}" — ${a.detail} This board's review lane needs a person's approval, and the workspace has not let the manager close reviewed tickets, so it is waiting for someone to close it.`,
    detail: { action: 'complete', reviewGate: 'held_for_human' satisfies ReviewGateVerdict, setting: MANAGER_REVIEW_CLOSE_SETTING },
    stateKey: REVIEW_GATE_HELD_STATE_KEY,
    fingerprint: stateFingerprint([a.taskId, 'held_for_human']),
  });
}

/**
 * Audit a manager-authorized close, the way every managed-board override is audited:
 *
 *   1. an activity row on the ticket — the unified audit timeline AND the ticket's
 *      lifecycle ledger (which reads every activity row targeting the ticket), naming the
 *      manager as actor and the workspace setting as authority;
 *   2. a `managed.gate_override` tool-audit row, so "list every gate overridden on this
 *      board" returns these beside the human/system run overrides.
 *
 * Best-effort, like both writers it uses — the close has already been persisted, and a
 * failed audit write is reported rather than swallowed.
 */
export async function recordManagerReviewClose(
  env: Env,
  db: Db,
  a: {
    tenantId: number; projectId: number; taskId: number; title: string; lane: string;
    managerRef: string | null; managerLabel?: string | null;
    actor: TransitionActorInput;
  },
): Promise<void> {
  const authority = reviewCloseAuthority(a.title);
  const name = a.managerLabel || 'AI Manager';
  const actor = a.actor.actorAgentRef
    ? cloudAgentActor(a.actor.actorAgentRef, name)
    : a.actor.actorAgentHostId != null
      ? hostAgentActor(a.actor.actorAgentHostId, name)
      : { ...SYSTEM_ACTOR, name };
  await Promise.all([
    recordActivity(env, db, {
      tenantId: a.tenantId, projectId: a.projectId, actor,
      verb: MANAGER_REVIEW_CLOSE_VERB,
      targetType: 'task', targetId: a.taskId, targetLabel: a.title,
      summary: `The AI Manager reviewed and closed this ticket through the human-gated ${a.lane} lane, under the workspace setting ${MANAGER_REVIEW_CLOSE_SETTING}.`,
      metadata: { authority, setting: MANAGER_REVIEW_CLOSE_SETTING, lane: a.lane, laneGate: 'human', managerRef: a.managerRef },
    }),
    recordCloudToolEvent(db, {
      tenantId: a.tenantId,
      cloudAgentRef: a.actor.actorAgentRef ?? 'manager',
      executionId: null,
      sessionKey: `task:${a.taskId}`,
      toolName: MANAGED_OVERRIDE_EVENT,
      category: 'planning',
      detail: { taskId: a.taskId, lane: a.lane, authority, setting: MANAGER_REVIEW_CLOSE_SETTING },
      result: `Human review gate passed by ${describeAuthority(authority)}`.slice(0, 300),
    }),
  ]).catch((error) => {
    reportCaughtError(error, {
      source: 'application/manager/reviewGateAuthority.ts', operation: 'recordManagerReviewClose',
      context: { logMessage: '[review-close] audit row failed to write', details: { tenantId: a.tenantId, taskId: a.taskId } },
    });
  });
}
