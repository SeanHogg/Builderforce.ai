import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * attestRoleRun — the PLATFORM side of the participation loop: what happens to a role's
 * accountability slot when its run actually FINISHES.
 *
 * ── THE MEASURED FAILURE ─────────────────────────────────────────────────────────
 * Project 11, one local day: 110 agent runs COMPLETED, 0 failed, 0 forward lane moves,
 * 0 tickets finished, 0 pull requests merged. 678 of 695 active tickets stalled. The
 * agents were doing the work; nothing was recording that they had.
 *
 * The cause was that `in_progress` — the state a finished run leaves its slot in — had
 * NO EXIT TRANSITION the platform could take:
 *
 *   • `blocksCompletion()` counts it as outstanding, so the stage gate stays shut;
 *   • `pickSignoffCandidate()` skips it, and `coordinateTicket`'s `neverEngaged` guard
 *     refuses to rewind it;
 *   • the ONLY way out was the agent voluntarily calling the `kanban.signoff` MCP tool.
 *
 * That last line is the whole defect. A single voluntary tool call by a language model
 * was the sole transition out of the state every piece of work passes through, with no
 * timeout, no fallback and no ceiling. When the model did not call it — for any reason at
 * all: it finished its turn budget, it summarised instead of acting, the tool errored —
 * the ticket was wedged permanently. `signoffRequest.ts` already diagnosed this exact
 * loop once and fixed it by NAMING the tool in the instruction; the numbers above are
 * what that fix achieves in practice, because a prompt is not a state machine.
 *
 * ── WHAT THIS MODULE DOES ────────────────────────────────────────────────────────
 * It gives the state an exit, and writes it where it survives:
 *
 *   PRODUCER slots (owner / contributor) are CREDITED. A completed producer run IS the
 *   participation — that is what producing means — so it records an `approved` ledger
 *   entry citing the execution. Note this is not new permission: `recordRunAttribution`
 *   already completed a producer slot, but only when the ticket had a pull request, which
 *   made every non-code ticket (analysis, planning, research — most of this backlog)
 *   unsatisfiable BY CONSTRUCTION. Evidence is now evidence, not a precondition; a ticket
 *   that was SUPPOSED to produce code and did not is already caught, correctly, by
 *   `decideTicketReadiness` → `return_to_implementation`.
 *
 *   REVIEWER slots are NOT credited. Auto-approving a review is a rubber stamp, and with
 *   `allowAutoMerge` on it would merge code nobody judged. Instead an unattested reviewer
 *   run is counted as a FAILED ASK: the role is asked again, and at
 *   {@link MAX_UNATTESTED_RUNS} the slot is marked exhausted, which removes it from the
 *   dispatchable set and lets the existing escalation path hand it to a human. Asking a
 *   fourth time what has ignored three asks is the livelock this platform already named.
 *
 * ── WHY THE LEDGER AND NOT THE SLOT ──────────────────────────────────────────────
 * Credit is written to `ticket_role_signoffs`, never by setting `state = 'completed'`
 * directly, because a directly-written state DOES NOT SURVIVE. `syncStates` recomputes
 * every slot from the ledger and preserves only `in_progress`:
 *
 *     let state = r.state === 'in_progress' ? 'in_progress'
 *               : (r.assigneeRef ? 'assigned' : (r.required ? 'unstaffed' : 'pending'));
 *
 * so a `completed` with no ledger row behind it is silently reverted to `assigned`. And
 * `coordinateCompletedStage` calls `syncStates` as its FIRST act, immediately before
 * reading the manifest to decide whether to advance — so even the PR-backed producer
 * credit that already existed was erased microseconds before the advance check could see
 * it. The ledger is the only durable representation of "this role is done"; writing
 * anywhere else is writing to a value that is about to be recomputed away.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { ticketParticipants, ticketRoleSignoffs } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { TicketAuditService } from '../audit/ticketAuditService';
import { TicketParticipantsService } from './ticketParticipants';
import {
  ADVANCEABLE_PARTICIPANT_STATES, MAX_UNATTESTED_RUNS,
  isProducerResponsibility, readUnattestedRuns,
} from './participantStates';
import { roleDisplayName } from './roleCatalog';
import type { ParticipantState } from './ticketParticipants';

/** What the platform did about a finished role run. */
export type AttestationOutcome =
  /** A producer's completed run was recorded as its participation. */
  | 'credited'
  /** A reviewer returned no verdict; it has budget left and will be asked again. */
  | 'reask'
  /** A reviewer has now ignored {@link MAX_UNATTESTED_RUNS} asks — hand it to a human. */
  | 'exhausted'
  /** A verdict already covers this slot; nothing to do. */
  | 'already_attested'
  /** No slot this run could serve. */
  | 'not_applicable';

/**
 * What to do about ONE slot whose run just completed. PURE.
 *
 * Split out from the IO so every branch — especially "a reviewer is never auto-approved"
 * — is provable without a database. That branch is the governance boundary of this whole
 * change: it is what keeps `allowAutoMerge` from merging unreviewed code.
 */
export function decideRunAttestation(input: {
  responsibility: string | null | undefined;
  /** A ledger verdict already covers this slot. */
  hasVerdict: boolean;
  priorUnattestedRuns: number;
  maxUnattestedRuns?: number;
}): AttestationOutcome {
  if (input.hasVerdict) return 'already_attested';
  if (isProducerResponsibility(input.responsibility)) return 'credited';
  const max = input.maxUnattestedRuns ?? MAX_UNATTESTED_RUNS;
  return input.priorUnattestedRuns + 1 >= max ? 'exhausted' : 'reask';
}

/** A slot this finished run could serve. */
interface AttestableSlot {
  id: string;
  stageKey: string | null;
  responsibility: string;
  state: string;
  assigneeRef: string | null;
  assigneeName: string | null;
  evidence: unknown;
}

/**
 * Does the ledger already carry a verdict for this slot? Mirrors `syncStates`' matching
 * rule exactly — an exact `lane:role` row wins, and a lane-less row applies to the role
 * as a fallback — so this function and the state it is about to trigger can never
 * disagree about whether a verdict exists.
 */
function ledgerCovers(
  rows: ReadonlyArray<{ laneKey: string | null }>,
  stageKey: string | null,
): boolean {
  return rows.some((r) => r.laneKey === null || r.laneKey === stageKey);
}

export interface AttestRoleRunArgs {
  tenantId: number;
  projectId: number;
  taskId: number;
  /** The role the run ran AS. */
  roleKey: string;
  /** The lane the run served — the slot its record must land on. */
  laneKey: string | null;
  executionId?: number;
  /** The agent that ran, for the accountability record (never anonymous). */
  agentRef?: string | null;
  agentName?: string | null;
  /** Pull-request evidence when the work produced some. Evidence, NOT a precondition. */
  prUrl?: string | null;
  maxUnattestedRuns?: number;
}

/**
 * Close the loop for one finished, role-attributed run. Best-effort by contract: this
 * runs on the run-finalized path and must never throw into it.
 *
 * Returns the outcome per slot touched, so the caller can journal what actually happened
 * rather than assuming the happy path — the assumption that produced 110 completed runs
 * and zero recorded results.
 */
export async function attestCompletedRoleRun(
  env: Env,
  db: Db,
  args: AttestRoleRunArgs,
): Promise<AttestationOutcome[]> {
  try {
    const slots: AttestableSlot[] = await db
      .select({
        id: ticketParticipants.id,
        stageKey: ticketParticipants.stageKey,
        responsibility: ticketParticipants.responsibility,
        state: ticketParticipants.state,
        assigneeRef: ticketParticipants.assigneeRef,
        assigneeName: ticketParticipants.assigneeName,
        evidence: ticketParticipants.evidence,
      })
      .from(ticketParticipants)
      .where(and(
        eq(ticketParticipants.tenantId, args.tenantId),
        eq(ticketParticipants.taskId, args.taskId),
        eq(ticketParticipants.roleKey, args.roleKey),
      ));
    if (!slots.length) return ['not_applicable'];

    // Only a slot that has not reached a terminal verdict can be advanced — the same
    // non-destructive rule `recordRunAttribution` follows. Prefer the slot for the exact
    // stage the run served; fall back to any advanceable slot for the role.
    const advanceable = slots.filter((s) => ADVANCEABLE_PARTICIPANT_STATES.has(s.state as ParticipantState));
    const exact = args.laneKey != null ? advanceable.filter((s) => s.stageKey === args.laneKey) : [];
    const targets = exact.length ? exact : advanceable;
    if (!targets.length) return ['not_applicable'];

    const verdicts = await db
      .select({ laneKey: ticketRoleSignoffs.laneKey })
      .from(ticketRoleSignoffs)
      .where(scopedToTenant(
        ticketRoleSignoffs,
        args.tenantId,
        eq(ticketRoleSignoffs.taskId, args.taskId),
        eq(ticketRoleSignoffs.roleKey, args.roleKey),
      ));

    const participants = new TicketParticipantsService(db);
    const outcomes: AttestationOutcome[] = [];
    let credited = false;

    for (const slot of targets) {
      const outcome = decideRunAttestation({
        responsibility: slot.responsibility,
        hasVerdict: ledgerCovers(verdicts, slot.stageKey),
        priorUnattestedRuns: readUnattestedRuns(slot.evidence),
        ...(args.maxUnattestedRuns != null ? { maxUnattestedRuns: args.maxUnattestedRuns } : {}),
      });
      outcomes.push(outcome);

      if (outcome === 'credited') {
        // THE durable write. `recordSignoff` is the same entry point the human route and
        // the MCP tool use, so this record is an ordinary ledger row in every downstream
        // reader — `syncStates` derives `completed` from it, the accountability report
        // shows it, and it survives the recompute that erased the old direct write.
        await new TicketAuditService(db).recordSignoff(env, args.tenantId, {
          taskId: args.taskId,
          roleKey: args.roleKey,
          laneKey: slot.stageKey ?? args.laneKey ?? null,
          verdict: 'approved',
          memberKind: 'agent',
          memberRef: args.agentRef ?? slot.assigneeRef ?? null,
          memberName: args.agentName ?? slot.assigneeName ?? null,
          summary:
            `${roleDisplayName(args.roleKey)} completed its assigned run for this stage. `
            + 'Recorded automatically from the finished execution: the run is the participation for a producing role, '
            + 'and the agent recorded no explicit verdict of its own.',
          contribution: {
            ...(args.executionId != null ? { executionId: args.executionId } : {}),
            ...(args.prUrl ? { prUrl: args.prUrl } : {}),
            autoAttested: true,
          },
        });
        credited = true;
        continue;
      }

      if (outcome === 'reask' || outcome === 'exhausted') {
        // Count the silence. This is what makes the ask BOUNDED: without a counter the
        // manager re-asks the same reviewer every five minutes forever, which is exactly
        // what the decision feed shows it doing (the same flag decision 5x in 2h20m).
        const evidence = {
          ...(slot.evidence && typeof slot.evidence === 'object' ? slot.evidence : {}),
          unattestedRuns: readUnattestedRuns(slot.evidence) + 1,
          ...(args.executionId != null ? { lastUnattestedExecutionId: args.executionId } : {}),
          ...(outcome === 'exhausted' ? { attestationExhaustedAt: new Date().toISOString() } : {}),
        };
        await db.update(ticketParticipants)
          .set({ evidence, updatedAt: new Date() })
          .where(scopedToTenant(ticketParticipants, args.tenantId, eq(ticketParticipants.id, slot.id)));
      }
    }

    if (credited) {
      // Re-derive the manifest from the ledger we just wrote, so the Coordinator's
      // advance check (which runs immediately after this on the finalize path) reads the
      // credit rather than racing it.
      await participants.syncStates(env, args.tenantId, args.taskId).catch(() => undefined);
    }
    await participants.invalidate(env, args.taskId).catch(() => undefined);
    return outcomes;
  } catch (error) {
    reportCaughtError(error, { source: 'application/kanban/attestRoleRun.ts', operation: 'attestCompletedRoleRun' });
    return ['not_applicable'];
  }
}
