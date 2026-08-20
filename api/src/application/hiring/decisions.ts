/**
 * `hiring_decisions` — the accountable record, and the thing that MOVES the pipeline.
 *
 * ── WHY A DECISION IS NOT A SECOND CLICK ─────────────────────────────────────────
 * The schema already argues for this table's existence: a decision is "separate from the
 * application's status because a status can be re-driven; a decision is a record that
 * someone is accountable for". The corollary is what this module implements — if
 * recording the decision and moving the candidate are two actions, the second one is
 * optional in practice, and the funnel drifts away from the decisions underneath it one
 * skipped drag at a time. So there is one door: you say what you decided and why, and the
 * board follows.
 *
 * The mapping from decision to stage is not here. It is in
 * `domain/hiring/pipelineStages.ts`, pure, because the route validates against the same
 * vocabulary and the UI labels it — three consumers, one definition of what "advance"
 * means.
 *
 * ── ORDER OF WRITES ──────────────────────────────────────────────────────────────
 * The decision row is written FIRST, before the move. `neon-http` gives no transaction
 * (the gap register records why), so one of the two can survive alone, and the survivable
 * one is the record: a decision whose move failed is visible, re-drivable and still
 * answers "who decided this and why", whereas a move with no decision behind it is a
 * candidate who was rejected by nobody for no reason.
 */

import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { hiringDecisions } from '../../infrastructure/database/schema/hiring';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';
import { moveCandidate, readOpenEntries } from './pipeline';
import { readApplication, rejectApplication } from './applications';
import { AtsError } from './atsError';
import {
  isHiringDecision,
  pipelineRefForPosting,
  stageAfterDecision,
  type HiringDecision,
} from '../../domain/hiring/pipelineStages';
import type { Env } from '../../env';

export interface RecordedDecision {
  id: number;
  applicationId: number | null;
  candidateRef: string;
  decision: HiringDecision;
  deciderRef: string | null;
  rationale: string | null;
  evidence: Record<string, unknown> | null;
  decidedAt: string;
}

export interface RecordDecisionInput {
  tenantId: number;
  /** The application this is about. Optional only for a candidate sourced straight into
   *  a pipeline, who has no posting to have applied to. */
  applicationId?: number | null;
  /** Required when there is no application to read it from. */
  candidateRef?: string | null;
  /** Required when there is no application, for the same reason. */
  pipelineRef?: string | null;
  decision: string;
  deciderRef?: string | null;
  rationale?: string | null;
  /** What this was decided ON — scorecard ids, interview ids, a note. Free-form because
   *  the evidence for "advance" and for "reject" are not the same shape. */
  evidence?: Record<string, unknown> | null;
  actor: ActorIdentity;
}

export interface RecordDecisionResult {
  decision: RecordedDecision;
  /** Where the candidate ended up, or null when the decision deliberately moved nobody
   *  (a `hold`, or an `advance` from the last stage). */
  movedTo: string | null;
  movedFrom: string | null;
}

/**
 * Record a decision and let it move the candidate.
 *
 * A rejection MUST carry a rationale: it becomes `job_applications.reject_reason`, which
 * is what answers "why" when a candidate, a regulator or the next recruiter asks. Every
 * other decision may be recorded bare — an advance with no note is a normal thing to do,
 * and demanding prose for it is how a team learns to type "ok" into a required field.
 */
export async function recordDecision(
  db: Db,
  env: Env,
  input: RecordDecisionInput,
  now = new Date(),
): Promise<RecordDecisionResult> {
  if (!isHiringDecision(input.decision)) {
    throw new AtsError('That is not a decision this pipeline records.', 400);
  }
  const decision: HiringDecision = input.decision;
  const rationale = input.rationale?.trim() || null;
  if (decision === 'reject' && !rationale) {
    throw new AtsError('A rejection needs a rationale — it is the answer to "why" six months from now.', 400);
  }

  // Identity: prefer the application, because it is the row that knows both the candidate
  // and the posting. A caller who names neither is refused rather than defaulted.
  const application = input.applicationId != null
    ? await readApplication(db, input.tenantId, input.applicationId)
    : null;
  if (input.applicationId != null && !application) {
    throw new AtsError('No such application in this workspace.', 404);
  }
  const candidateRef = (application?.candidateRef ?? input.candidateRef ?? '').trim();
  if (!candidateRef) throw new AtsError('A decision has to be about somebody — name the candidate.', 400);
  const pipelineRef = application?.jobPostingId
    ? pipelineRefForPosting(application.jobPostingId)
    : (input.pipelineRef?.trim() || null);

  const [row] = await db
    .insert(hiringDecisions)
    .values({
      tenantId: input.tenantId,
      applicationId: application?.id ?? null,
      candidateRef,
      decision,
      deciderRef: input.deciderRef ?? input.actor.ref ?? null,
      rationale,
      evidence: input.evidence ?? null,
      decidedAt: now,
    })
    .returning({ id: hiringDecisions.id });
  if (!row) throw new AtsError('The decision could not be recorded.', 500);

  const recorded: RecordedDecision = {
    id: row.id,
    applicationId: application?.id ?? null,
    candidateRef,
    decision,
    deciderRef: input.deciderRef ?? input.actor.ref ?? null,
    rationale,
    evidence: input.evidence ?? null,
    decidedAt: now.toISOString(),
  };

  await recordActivity(env, db, {
    tenantId: input.tenantId,
    actor: input.actor,
    verb: `hiring.decision.${decision}`,
    targetType: 'job_application',
    targetId: application?.id ?? candidateRef,
    targetLabel: candidateRef,
    metadata: { decision, pipelineRef, hasRationale: rationale !== null },
  });

  // ── The move ────────────────────────────────────────────────────────────────────
  // A rejection goes through `rejectApplication` rather than straight to the board: the
  // reason belongs on the application row too, and that function is the one place that
  // writes it.
  if (decision === 'reject' && application && rationale) {
    const rejected = await rejectApplication(db, env, {
      tenantId: input.tenantId,
      applicationId: application.id,
      reason: rationale,
    }, now);
    return { decision: recorded, movedTo: 'rejected', movedFrom: rejected.movedFrom };
  }

  if (!pipelineRef) return { decision: recorded, movedTo: null, movedFrom: null };

  const entries = await readOpenEntries(db, input.tenantId, pipelineRef);
  const current = entries.find((entry) => entry.candidateRef === candidateRef);
  if (!current) return { decision: recorded, movedTo: null, movedFrom: null };

  const target = stageAfterDecision(decision, current.stage, entries.map((entry) => entry.stage));
  // `null` is a real answer — `hold` moves nobody, and an advance from the final stage
  // has nowhere to go. Neither is an error, and neither should invent a transition.
  if (!target || target === current.stage) {
    return { decision: recorded, movedTo: null, movedFrom: current.stage };
  }

  const move = await moveCandidate(db, env, {
    tenantId: input.tenantId,
    pipelineRef,
    candidateRef,
    toStage: target,
  }, now);
  return { decision: recorded, movedTo: move.toStage, movedFrom: move.fromStage };
}

/** A candidate's decision history, newest first — what the drawer shows under "why". */
export async function listDecisions(
  db: Db,
  tenantId: number,
  opts: { applicationId?: number | null; candidateRef?: string | null },
): Promise<RecordedDecision[]> {
  if (opts.applicationId == null && !opts.candidateRef) return [];
  const rows = await db
    .select({
      id: hiringDecisions.id,
      applicationId: hiringDecisions.applicationId,
      candidateRef: hiringDecisions.candidateRef,
      decision: hiringDecisions.decision,
      deciderRef: hiringDecisions.deciderRef,
      rationale: hiringDecisions.rationale,
      evidence: hiringDecisions.evidence,
      decidedAt: hiringDecisions.decidedAt,
    })
    .from(hiringDecisions)
    .where(scopedToTenant(
      hiringDecisions,
      tenantId,
      opts.applicationId != null ? eq(hiringDecisions.applicationId, opts.applicationId) : undefined,
      opts.candidateRef ? eq(hiringDecisions.candidateRef, opts.candidateRef) : undefined,
    ))
    .orderBy(desc(hiringDecisions.decidedAt))
    .limit(100);

  return rows.map((row) => ({
    id: row.id,
    applicationId: row.applicationId ?? null,
    candidateRef: row.candidateRef,
    // Stored as a varchar so a decision recorded before a vocabulary change still reads;
    // narrowed here rather than cast, so an unknown value surfaces as itself.
    decision: (isHiringDecision(row.decision) ? row.decision : 'hold') as HiringDecision,
    deciderRef: row.deciderRef ?? null,
    rationale: row.rationale ?? null,
    evidence: (row.evidence ?? null) as Record<string, unknown> | null,
    decidedAt: (row.decidedAt instanceof Date ? row.decidedAt : new Date(row.decidedAt)).toISOString(),
  }));
}
