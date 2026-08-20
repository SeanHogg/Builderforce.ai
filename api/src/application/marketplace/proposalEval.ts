/**
 * Gig-Marketplace proposal evaluation — "the employer uses AI to evaluate the
 * proposal against the requirements of the item they published."
 *
 * Reuses the platform's RAG-eval judge (semanticEval.evaluateResponse) rather than
 * inventing a second scorer: map the posting's requirements → the "question", the
 * submitted proposal → the "answer", and the fuller published scope → the "context".
 * The composite then reads as: does the proposal address the requirements
 * (answer-relevance) and stay grounded in the actual scope rather than over-promising
 * unrelated things (faithfulness)? Degrades to the deterministic lexical backend when
 * no judge is available, so evaluation is always possible.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { evaluateResponse, type EvalJudge, type EvalScores } from '../eval/semanticEval';
import type { Db } from '../../infrastructure/database/connection';
import { jobPostings, jobProposals, proposalEvaluations } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

export interface ProposalEvalInput {
  /** The acceptance criteria / requirements the proposal must satisfy. */
  requirements: string;
  /** The fuller published scope (posting description, linked spec) used as grounding
   *  context. Falls back to `requirements` when omitted. */
  scope?: string;
  /** The proposal text under evaluation — a bid cover note or a deliverable body. */
  proposal: string;
}

/** Score a proposal against a posting's requirements. Pure given its inputs (the
 *  judge is injected) → unit-testable without a network. */
export async function evaluateProposal(
  input: ProposalEvalInput,
  opts?: { judge?: EvalJudge },
): Promise<EvalScores> {
  const context = (input.scope && input.scope.trim()) ? input.scope : input.requirements;
  return evaluateResponse(
    { question: input.requirements || '(no explicit requirements provided)', answer: input.proposal, context },
    opts,
  );
}

/** The 0..100 integer surfaced on lists/badges from a 0..1 composite. */
export const evalPercent = (overall: number): number => Math.round(Math.max(0, Math.min(1, overall)) * 100);

// ---------------------------------------------------------------------------
// The INSIGHTS lens over a posting's evaluations
// ---------------------------------------------------------------------------

/**
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────
 * The register recorded it: "Eval scores (`proposal_evaluations`) aren't yet surfaced on
 * an insights/analytics lens — only inline on the row." A chip beside each bid answers
 * "how good is this one" and nothing else. The questions an employer with fifteen bids
 * actually has are comparative — is this field strong or weak, is anything clustered at
 * the top, and can I TRUST these numbers — and none of them is answerable one row at a
 * time.
 *
 * ── THE THREE READINGS, AND WHY THE THIRD IS THE POINT ─────────────────────────
 *   DISTRIBUTION — the shape of the field. Five bands, because a histogram of fifteen
 *     bids into twenty buckets is noise wearing a chart.
 *   METHOD SPLIT — how many verdicts came from the LLM judge and how many from the
 *     deterministic lexical fallback. Mixing them silently is the trap: a lexical score
 *     and a judged score are not the same measurement, and a table sorted by a column
 *     that means two different things per row is worse than no ranking at all. So the
 *     split is stated, prominently, rather than averaged away.
 *   THE GAP — `job_proposals.last_eval_overall` is a CACHE of the newest evaluation, and
 *     a cache can be stale: a bid revised after its evaluation carries a number about a
 *     cover note that no longer exists. Comparing the cached value against the latest row
 *     in `proposal_evaluations` is the only way anyone can see that, and it is the
 *     reading that decides whether the other two mean anything.
 *
 * Both sides of the comparison go through {@link evalPercent} — the 0..1 real on the
 * evaluation and the 0..100 int on the proposal are the same quantity in two scales, and
 * re-deriving that conversion here is how the lens would come to disagree with the chip.
 */

export interface EvalBand {
  /** Inclusive lower bound of the 0..100 band. */
  from: number;
  /** Exclusive upper bound — except the top band, which includes 100. */
  to: number;
  count: number;
}

export interface EvalLensRow {
  proposalId: string;
  /** The value cached on the proposal, which is what every list renders. */
  cachedOverall: number | null;
  /** The value on the most recent `proposal_evaluations` row. */
  latestOverall: number | null;
  method: 'llm' | 'lexical' | null;
  evaluatedAt: Date | string | null;
  /** `|cached − latest|`. Non-zero means a list is showing a number the evidence does
   *  not support any more. */
  drift: number;
}

export interface ProposalEvalLens {
  /** Proposals on the posting that are live enough to compare (not withdrawn). */
  proposalCount: number;
  /** How many of those have ever been evaluated. */
  evaluatedCount: number;
  /** Mean and median of the LATEST score per proposal, 0..100. Null with nothing scored
   *  — a mean of zero would read as "every bid is terrible". */
  averageOverall: number | null;
  medianOverall: number | null;
  bands: EvalBand[];
  /** Verdicts by backend, over the LATEST evaluation of each proposal. */
  methodSplit: { llm: number; lexical: number };
  /** Total evaluation runs recorded, including superseded ones — the history the table
   *  preserves and the chip throws away. */
  totalRuns: number;
  /** Proposals whose cached headline disagrees with their newest evaluation. */
  driftedCount: number;
  /** The biggest single disagreement, 0..100. */
  maxDrift: number;
  rows: EvalLensRow[];
}

const BAND_EDGES = [0, 20, 40, 60, 80, 100] as const;

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const low = sorted[mid - 1];
  const high = sorted[mid];
  return low == null || high == null ? null : Math.round((low + high) / 2);
};

/**
 * The aggregate view of one posting's proposal evaluations.
 *
 * Two queries, never one per bid: the proposals for the posting, and every
 * `job_proposal` evaluation for those subjects newest-first. The per-proposal "latest"
 * is then the FIRST row seen per subject, which is why the ordering is part of the
 * query and not something the caller may change.
 *
 * Returns null when the posting is not this tenant's — the same shape every other
 * employer read on a posting uses, so the route needs no second ownership check.
 */
export async function readProposalEvalLens(
  db: Db,
  input: { tenantId: number; jobId: string },
): Promise<ProposalEvalLens | null> {
  const [job] = await db
    .select({ id: jobPostings.id })
    .from(jobPostings)
    .where(scopedToTenant(jobPostings, input.tenantId, eq(jobPostings.id, input.jobId)))
    .limit(1);
  if (!job) return null;

  const proposals = await db
    .select({ id: jobProposals.id, lastEvalOverall: jobProposals.lastEvalOverall, status: jobProposals.status })
    .from(jobProposals)
    .where(and(eq(jobProposals.jobId, input.jobId), inArray(jobProposals.status, ['saved', 'submitted', 'shortlisted', 'accepted', 'declined'])));

  const ids = proposals.map((p) => p.id);
  const evaluations = ids.length === 0 ? [] : await db
    .select({
      subjectId: proposalEvaluations.subjectId,
      overall: proposalEvaluations.overall,
      method: proposalEvaluations.method,
      createdAt: proposalEvaluations.createdAt,
    })
    .from(proposalEvaluations)
    .where(scopedToTenant(proposalEvaluations, input.tenantId,
      eq(proposalEvaluations.subjectType, 'job_proposal'),
      inArray(proposalEvaluations.subjectId, ids)))
    .orderBy(desc(proposalEvaluations.createdAt));

  const latest = new Map<string, { overall: number; method: string; createdAt: Date | null }>();
  for (const row of evaluations) {
    // Newest-first, so the first row seen for a subject IS its latest.
    if (latest.has(row.subjectId)) continue;
    latest.set(row.subjectId, {
      overall: evalPercent(Number(row.overall ?? 0)),
      method: row.method ?? 'lexical',
      createdAt: row.createdAt ?? null,
    });
  }

  const rows: EvalLensRow[] = proposals.map((proposal) => {
    const newest = latest.get(proposal.id) ?? null;
    const cachedOverall = proposal.lastEvalOverall == null ? null : Number(proposal.lastEvalOverall);
    const latestOverall = newest?.overall ?? null;
    return {
      proposalId: proposal.id,
      cachedOverall,
      latestOverall,
      method: newest ? (newest.method === 'llm' ? 'llm' : 'lexical') : null,
      evaluatedAt: newest?.createdAt ?? null,
      // Drift is only meaningful when BOTH numbers exist. A never-evaluated proposal
      // is not drifting, it is unmeasured, and reporting that as a 0 gap would say the
      // cache agrees with evidence that was never gathered.
      drift: cachedOverall != null && latestOverall != null ? Math.abs(cachedOverall - latestOverall) : 0,
    };
  });

  const scored = rows.map((r) => r.latestOverall).filter((v): v is number => v != null);
  const bands: EvalBand[] = [];
  for (let i = 0; i < BAND_EDGES.length - 1; i++) {
    const from = BAND_EDGES[i] ?? 0;
    const to = BAND_EDGES[i + 1] ?? 100;
    const isTop = i === BAND_EDGES.length - 2;
    bands.push({ from, to, count: scored.filter((v) => v >= from && (isTop ? v <= to : v < to)).length });
  }

  const methodSplit = { llm: 0, lexical: 0 };
  for (const value of latest.values()) {
    if (value.method === 'llm') methodSplit.llm += 1;
    else methodSplit.lexical += 1;
  }

  return {
    proposalCount: proposals.length,
    evaluatedCount: scored.length,
    averageOverall: scored.length === 0 ? null : Math.round(scored.reduce((a, b) => a + b, 0) / scored.length),
    medianOverall: median(scored),
    bands,
    methodSplit,
    totalRuns: evaluations.length,
    driftedCount: rows.filter((r) => r.drift > 0).length,
    maxDrift: rows.reduce((max, r) => Math.max(max, r.drift), 0),
    rows: rows.sort((a, b) => (b.latestOverall ?? -1) - (a.latestOverall ?? -1)),
  };
}
