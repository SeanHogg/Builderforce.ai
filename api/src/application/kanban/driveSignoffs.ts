/**
 * driveSignoffs — ASK the outstanding roles to sign off.
 *
 * This is the step whose absence made the whole accountability model inert. Producer
 * credit is automatic (a terminal run with PR evidence completes the slot via
 * `attributeRunToManifest`), but a REVIEWER slot only clears when an agent records a
 * verdict — and nothing was ever asking one to. Measured consequence: 487 required
 * slots across the tenant, zero ever satisfied.
 *
 * So for each outstanding slot with a resolved agent assignee, dispatch that agent AS
 * the role with an explicit instruction to record its sign-off, using the ONE shared
 * request contract in `signoffRequest.ts` (whose `laneKey` is what makes the verdict
 * land on the lane-scoped manifest slot rather than nowhere).
 *
 * Bounded to ONE dispatch per call: sign-offs are sequential judgements, and a burst
 * would spend N billable runs to answer one question. Slots with no agent assignee are
 * still skipped — dispatching nobody is not a fix for a staffing gap — but they are now
 * REPORTED (see {@link SignoffDriveResult}) rather than silently dropped, because a
 * ticket blocked on unstaffed or human-owed roles is not "being worked on", it is
 * waiting on a person who was never told.
 *
 * Lives in its own module (rather than inside `ManagerService`) because BOTH the
 * manager's review pass and its stall-triage stage drive sign-offs, and a shared
 * import from either into the other would be circular.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';
import type { SignoffGateResult, SignoffOwnership } from './signoffGate';
import { classifySignoffOwnership, describeSignoffOwnership } from './signoffGate';
import { requestRoleRun } from './requestRoleRun';
import { TicketParticipantsService } from './ticketParticipants';

/** The minimal ticket shape a sign-off request needs. */
export interface SignoffTargetTask {
  id: number;
  title: string;
  status: string;
  githubPrUrl: string | null;
}

/**
 * What driving the sign-offs achieved — and, when it achieved nothing, WHY.
 *
 * The bare `string[]` this used to return could not tell "the agent was asked" from
 * "there is no agent to ask", so every caller journalled the same unactionable line
 * either way. `ownership` carries the distinction to the feed, the stuck register and
 * the escalation decision.
 */
export interface SignoffDriveResult {
  /** Role names actually dispatched this call. Empty when nothing was dispatchable. */
  asked: string[];
  ownership: SignoffOwnership;
  /** True when at least one outstanding slot is agent-owned, asked or not. */
  dispatchable: boolean;
  /** One clause naming the blocker when nothing could be asked; '' otherwise. */
  blockedDetail: string;
}

/**
 * Which agent-owed slot to ask next. PURE.
 *
 * ALWAYS TAKING `dispatchable[0]` COULD NOT SATISFY A MULTI-ROLE GATE. `in_progress` is
 * the record that a slot has already been dispatched, and an asked-but-unanswered slot
 * stays outstanding — so the first-outstanding rule re-asked the SAME role on every pass
 * while slots 2..N were never asked once. On the measured tickets (10 required slots
 * each) that made "waiting on 10 of 10" a state the gate could never leave, however many
 * passes ran: nine of the ten roles had no path to being asked at all.
 *
 * So: prefer a slot nobody has asked yet, and fall back to re-asking only once every
 * agent-owed slot has had its turn.
 */
export function pickSignoffCandidate(ownership: SignoffOwnership): SignoffOwnership['dispatchable'][number] | null {
  return ownership.dispatchable.find((s) => s.state !== 'in_progress') ?? ownership.dispatchable[0] ?? null;
}

/**
 * Which contract the slot's agent gets. PURE.
 *
 * An owner/contributor slot must BUILD the stage's deliverable; only a reviewer judges
 * one. Every slot used to receive the reviewer instruction, which on a pre-review lane
 * asked the producer to "review the delivered work" that it had not written yet — an ask
 * it can only answer by approving nothing or doing nothing.
 */
export function contractFor(responsibility: string): 'reviewer' | 'producer' {
  return responsibility === 'reviewer' ? 'reviewer' : 'producer';
}

/**
 * Dispatch one outstanding agent-assigned role to record its verdict.
 * Never throws — a failed dispatch leaves the slot outstanding for the next pass.
 */
export async function driveOutstandingSignoffs(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  args: {
    tenantId: number;
    projectId: number;
    task: SignoffTargetTask;
    signoff: SignoffGateResult;
    managerRef: string | null;
  },
): Promise<SignoffDriveResult> {
  const participants = new TicketParticipantsService(db);
  const ownership = classifySignoffOwnership(args.signoff.outstanding);
  const result: SignoffDriveResult = {
    asked: [],
    ownership,
    dispatchable: ownership.dispatchable.length > 0,
    blockedDetail: describeSignoffOwnership(ownership),
  };
  const candidate = pickSignoffCandidate(ownership);
  if (!candidate?.assigneeRef) return result;
  try {
    // `candidate.stageKey` is the slot's OWN stage, which is the lane the verdict has
    // to match; the ticket's current status is only a fallback for a stage-less slot.
    //
    // `requestRoleRun` is what makes the round-trip WORK, not just fire: it marks the
    // slot `in_progress` on success, which is the record `pickSignoffCandidate` reads to
    // move on to the next role. Without it every pass re-picked slot #1 and roles 2..N
    // were never asked once — the "all reviewers assigned, none executing" state.
    const executionId = await requestRoleRun(env, db, runtimeService, participants, {
      tenantId: args.tenantId,
      projectId: args.projectId,
      taskId: args.task.id,
      taskTitle: args.task.title,
      roleKey: candidate.roleKey,
      roleName: candidate.roleName,
      agentRef: candidate.assigneeRef,
      laneKey: candidate.stageKey ?? args.task.status,
      kind: contractFor(candidate.responsibility),
      submittedBy: `manager:signoff-request:${args.managerRef ?? 'system'}`,
      prUrl: args.task.githubPrUrl,
    });
    // A REFUSAL is not an ask. The dispatcher returns null when the cloud-run cap, the
    // failure breaker or the re-run cooldown blocks it; reporting `asked` anyway is what
    // let the feed claim reviewers had been requested on passes where nothing started —
    // and, because the caller counts an ask as an applied remedy, it also counted an
    // attempt that never happened.
    if (executionId == null) {
      return {
        ...result,
        blockedDetail: `${result.blockedDetail} The dispatcher refused to start ${candidate.roleName}'s review — the ticket's failure breaker, re-run cooldown or the workspace's cloud-run allowance is blocking it.`.trim(),
      };
    }
    return { ...result, asked: [candidate.roleName] };
  } catch {
    return result;
  }
}
