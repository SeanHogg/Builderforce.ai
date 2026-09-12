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
import { swimlanes, tasks } from '../../infrastructure/database/schema';
import { findCanonicalBoard } from '../swimlane/canonicalBoard';
import { completeTaskOnMerge, isReviewLane, REVIEW_CLASS, type TransitionActorInput } from '../task/taskLifecycle';
import { resolveManagerAssignee, resolveTenantManagerDefaults } from './managerPolicy';
import { getTenantManagerDefaults } from './managerPolicyStore';
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
  executor: TransitionActorInput,
): TransitionActorInput {
  const manager = resolveManagerAssignee(managerRef);
  if (manager.assignedAgentRef) return { actorAgentRef: manager.assignedAgentRef };
  if (manager.assignedAgentHostId != null) return { actorAgentHostId: manager.assignedAgentHostId };
  // Never `actorUserId`: nobody acted here, so the hop must not read as a person's.
  return { actorAgentRef: executor.actorAgentRef ?? null, actorAgentHostId: executor.actorAgentHostId ?? null };
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

// ── AUTOMATIC CLOSES: THE ONE RULE ──────────────────────────────────────────
//
// Every path by which automation moves a ticket to done asks the SAME question through
// this module — the manager's review step, the PR merge (the manager sweep), the green-CI
// auto-merge, the post-merge deploy, the delta-ticket merge webhook, the lifecycle-managed
// sign-off advance and the security re-scan. `completeTaskOnMerge` is the raw write; no
// automatic caller may reach it except through {@link closeTicketAutomatically} (pinned by
// a source test), so "may automation close this ticket?" is answered exactly once.

/** Every path by which automation — not a person — moves a ticket to done. */
export type AutoCloseSource =
  | 'manager_review'   // the manager's CONDUCT step
  | 'pr_merge'         // mergeRecordedPullRequest — the manager merge sweep
  | 'ci_merge'         // green-CI auto-merge (ingestRepoCiEvent, pre-merge)
  | 'deploy_success'   // a successful post-merge deploy (ingestRepoCiEvent, post-merge)
  | 'delta_merge'      // the merge webhook closing a delta ticket
  | 'stage_advance'    // lifecycle-managed sign-off advance into the terminal lane
  | 'security_rescan'; // a deterministic re-scan closing a resolved finding

/**
 * Who asked for the close. A PERSON's explicit act (the in-product Approve & Merge) IS the
 * approval a human gate waits for, so it always passes; the gate governs automation only.
 */
export type CloseInitiator = 'human' | 'automation';

/** The merge-family sources share one "merged, waiting for a person" journal state, so a
 *  merge followed by its deploy says it once rather than once per webhook. */
const MERGE_FAMILY: ReadonlySet<AutoCloseSource> = new Set(['pr_merge', 'ci_merge', 'deploy_success', 'delta_merge']);

const HELD_OPENING: Record<AutoCloseSource, string> = {
  manager_review: 'The manager reviewed it and it passes',
  pr_merge: 'Its pull request is merged (the merge is recorded)',
  ci_merge: 'Its pull request merged on green CI (the merge is recorded)',
  deploy_success: 'Its merged change deployed successfully (the merge is recorded)',
  delta_merge: 'The pull request carrying its change is merged (the merge is recorded)',
  stage_advance: 'Every required role has signed off',
  security_rescan: 'A re-scan no longer raises its finding',
};

/** What a close decision needs to know about the project — loadable once for a cohort. */
export interface CloseContext {
  /** Review-class lane gates for the project, or null when they could not be read. */
  laneGates: Map<string, string> | null;
  /** The workspace's effective `managerMayCloseReviewedTickets`. */
  managerMayCloseReviewedTickets: boolean;
}

/**
 * Load the close context for a project: one lane read (only when a ticket sits in a review
 * lane) and the cached workspace tier. A caller closing N tickets calls this once.
 */
export async function loadCloseContext(
  db: Db, env: Env | undefined,
  a: { tenantId: number; projectId: number; statuses: readonly string[] },
): Promise<CloseContext> {
  const needsGate = a.statuses.some((s) => isReviewLane(s));
  const [laneGates, managerMayCloseReviewedTickets] = await Promise.all([
    needsGate
      ? loadReviewLaneGates(db, a.tenantId, a.projectId).catch(() => null)
      : Promise.resolve(new Map<string, string>()),
    // Workspace-only, so the workspace fold alone is the answer. A failed read withholds —
    // the default — rather than granting.
    getTenantManagerDefaults(db, a.tenantId, env)
      .then((row) => resolveTenantManagerDefaults(row).managerMayCloseReviewedTickets)
      .catch(() => false),
  ]);
  return { laneGates, managerMayCloseReviewedTickets };
}

/**
 * THE verdict for one close. PURE.
 *
 * A person passes. Off a review lane nothing is gated. On a review lane whose gate could
 * not be read the close HOLDS — closing past a gate whose configuration is unknown is the
 * very override this setting governs — and says so via `gateUnreadable` (not journalled:
 * it is a read failure, not a policy state; the next attempt re-reads).
 */
export function decideAutomaticClose(input: {
  status: string; initiator: CloseInitiator; context: CloseContext;
}): { verdict: ReviewGateVerdict; gateUnreadable: boolean } {
  if (input.initiator === 'human' || !isReviewLane(input.status)) return { verdict: 'open', gateUnreadable: false };
  if (!input.context.laneGates) return { verdict: 'held_for_human', gateUnreadable: true };
  return {
    verdict: decideReviewGate({
      status: input.status,
      laneGate: input.context.laneGates.get(input.status),
      managerMayCloseReviewedTickets: input.context.managerMayCloseReviewedTickets,
    }),
    gateUnreadable: false,
  };
}

/**
 * Journal "ready to close — held for a person". A STATE, not an event: written once per
 * ticket (and once for the whole merge family) until something changes.
 */
export async function recordAutoCloseHeld(
  db: Db,
  a: {
    tenantId: number; projectId: number; taskId: number; runTaskId?: number | null;
    title: string | null; source: AutoCloseSource; detail?: string | null;
  },
): Promise<void> {
  const title = a.title ?? `ticket #${a.taskId}`;
  await recordManagerActionOnChange(db, {
    tenantId: a.tenantId, projectId: a.projectId, taskId: a.taskId, runTaskId: a.runTaskId ?? null,
    actionType: 'flag',
    summary: `${HELD_OPENING[a.source]}: "${title}" is ready to close${a.detail ? ` — ${a.detail}` : ''}. This board's review lane needs a person's approval and the workspace has not let the manager close reviewed tickets, so it stays in review, waiting for a person to close it.`,
    detail: {
      action: 'complete', reviewGate: 'held_for_human' satisfies ReviewGateVerdict,
      source: a.source, setting: MANAGER_REVIEW_CLOSE_SETTING,
    },
    stateKey: REVIEW_GATE_HELD_STATE_KEY,
    fingerprint: stateFingerprint([a.taskId, 'held_for_human', MERGE_FAMILY.has(a.source) ? 'merged' : a.source]),
  });
}

/**
 * Decide one close and journal a hold. Does NOT write the ticket — for the two callers that
 * move a ticket by their own write (the managed-board stage advance, the security re-scan's
 * bulk close). Everything that closes through `completeTaskOnMerge` uses
 * {@link closeTicketAutomatically} instead.
 */
export async function gateAutomaticClose(
  env: Env | undefined, db: Db,
  a: {
    tenantId: number; projectId: number; taskId: number; status: string; title: string | null;
    source: AutoCloseSource; initiator?: CloseInitiator; heldDetail?: string | null;
    runTaskId?: number | null; context?: CloseContext;
  },
): Promise<{ verdict: ReviewGateVerdict; gateUnreadable: boolean }> {
  const context = a.context
    ?? await loadCloseContext(db, env, { tenantId: a.tenantId, projectId: a.projectId, statuses: [a.status] });
  const decision = decideAutomaticClose({ status: a.status, initiator: a.initiator ?? 'automation', context });
  if (decision.verdict === 'held_for_human' && !decision.gateUnreadable) {
    await recordAutoCloseHeld(db, {
      tenantId: a.tenantId, projectId: a.projectId, taskId: a.taskId, runTaskId: a.runTaskId,
      title: a.title, source: a.source, detail: a.heldDetail,
    });
  }
  return decision;
}

export interface AutomaticCloseInput {
  tenantId: number;
  taskId: number;
  source: AutoCloseSource;
  /** Defaults to 'automation'. Only a person's own act passes as 'human'. */
  initiator?: CloseInitiator;
  /** Whom the caller would credit today (the merger, the executor). */
  actor?: TransitionActorInput;
  /** The manager designation the close is attributed to under delegated authority. */
  managerRef?: string | null;
  /** One sentence the hold journal carries (e.g. the review verdict). */
  heldDetail?: string | null;
  runTaskId?: number | null;
  /** Pre-loaded ticket + context, so a cohort costs one gate read (the conduct step). */
  known?: { status: string; projectId: number; title: string | null; context: CloseContext };
}

export interface AutomaticCloseResult {
  verdict: ReviewGateVerdict;
  /** True when the ticket was taken through the completion path. */
  closed: boolean;
  gateUnreadable?: boolean;
}

/**
 * THE automatic close. Gate → the one completion write → the override audit.
 *
 *   • held_for_human     — nothing is written to the ticket; the hold is journalled once.
 *                          Whatever the caller already recorded (the MERGE) stands.
 *   • open               — closed exactly as before this module existed.
 *   • manager_authorized — closed, credited to the manager (never to a person), and
 *                          audited like every managed-board override.
 */
export async function closeTicketAutomatically(
  env: Env, db: Db, input: AutomaticCloseInput,
): Promise<AutomaticCloseResult> {
  let known = input.known;
  if (!known) {
    const [t] = await db
      .select({ status: tasks.status, projectId: tasks.projectId, title: tasks.title })
      .from(tasks)
      .where(eq(tasks.id, input.taskId))
      .limit(1);
    if (!t) return { verdict: 'open', closed: false };
    known = {
      status: t.status, projectId: t.projectId, title: t.title ?? null,
      context: await loadCloseContext(db, env, { tenantId: input.tenantId, projectId: t.projectId, statuses: [t.status] }),
    };
  }
  const { verdict, gateUnreadable } = await gateAutomaticClose(env, db, {
    tenantId: input.tenantId, projectId: known.projectId, taskId: input.taskId, status: known.status,
    title: known.title, source: input.source, initiator: input.initiator, heldDetail: input.heldDetail,
    runTaskId: input.runTaskId, context: known.context,
  });
  if (verdict === 'held_for_human') return { verdict, closed: false, gateUnreadable };

  const actor = verdict === 'manager_authorized'
    ? reviewCloseActor(input.managerRef, input.actor ?? {})
    : (input.actor ?? {});
  await completeTaskOnMerge(env, db, { tenantId: input.tenantId, taskId: input.taskId, ...actor });
  if (verdict === 'manager_authorized') {
    await recordManagerReviewClose(env, db, {
      tenantId: input.tenantId, projectId: known.projectId, taskId: input.taskId,
      title: known.title ?? `ticket #${input.taskId}`, lane: known.status,
      managerRef: input.managerRef ?? null, actor, source: input.source,
    });
  }
  return { verdict, closed: true };
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
  env: Env | undefined,
  db: Db,
  a: {
    tenantId: number; projectId: number; taskId: number; title: string; lane: string;
    managerRef: string | null; managerLabel?: string | null;
    actor: TransitionActorInput;
    /** Which automatic path closed it — carried on both audit rows. */
    source?: AutoCloseSource;
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
      metadata: { authority, setting: MANAGER_REVIEW_CLOSE_SETTING, lane: a.lane, laneGate: 'human', managerRef: a.managerRef, source: a.source ?? 'manager_review' },
    }),
    recordCloudToolEvent(db, {
      tenantId: a.tenantId,
      cloudAgentRef: a.actor.actorAgentRef ?? 'manager',
      executionId: null,
      sessionKey: `task:${a.taskId}`,
      toolName: MANAGED_OVERRIDE_EVENT,
      category: 'planning',
      detail: { taskId: a.taskId, lane: a.lane, authority, setting: MANAGER_REVIEW_CLOSE_SETTING, source: a.source ?? 'manager_review' },
      result: `Human review gate passed by ${describeAuthority(authority)}`.slice(0, 300),
    }),
  ]).catch((error) => {
    reportCaughtError(error, {
      source: 'application/manager/reviewGateAuthority.ts', operation: 'recordManagerReviewClose',
      context: { logMessage: '[review-close] audit row failed to write', details: { tenantId: a.tenantId, taskId: a.taskId } },
    });
  });
}
