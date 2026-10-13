/**
 * Roll the decisive call a proof's own console recorded back onto its
 * realization row — and, for a proof that declares a `ProofMeasure`, grade it
 * by what its visitors did (PRD 33 §5.3.2). ONE sync, both paths.
 *
 * ── THE ASYMMETRY THIS RELIES ON ─────────────────────────────────────────────
 * A generated console (the demand console, the POC harness) posts its verdict
 * through `/__api/collections/<name>` — the SAME public, same-origin,
 * unauthenticated write endpoint its own signup/request form already uses.
 * That write is not trusted on its own; `application/ide/siteData.ts` says so
 * plainly ("writes are public, reads are not"). This module is the one place
 * a console's write becomes part of the tenant's TRUSTED record: it reads the
 * collection back server-side, scoped by both tenant and the realization's own
 * project id, so nothing a console posts can name another tenant's or another
 * realization's row.
 *
 * ── MEASURED VERDICTS (a proof with a measure) ───────────────────────────────
 * Precedence, first match wins:
 *   1. a person's abandon stands;
 *   2. a person's early call (`earlyCallReason`, written) decides now;
 *   3. a posted console call is accepted when the sample is reached, or when it
 *      carries a written `reason` — and its numbers are REPLACED by the measured
 *      ones, so the figure on the record is never the one a page typed;
 *      otherwise it is HELD (`verdictMetric.held = 'sample_not_reached'`);
 *   4. at the window's end, with nothing decided, the measured verdict is written
 *      with `decidedAt = windowEndsAt` (the daily `proof-verdicts` sweep, so a
 *      proof nobody opens still gets graded).
 * A decided proof is only re-decided by a NEWER posted call or a new early call —
 * the window closing never overrides a call a person already made.
 *
 * ── WHY THIS IS NOT A HANDLER STEP ───────────────────────────────────────────
 * `application/backend/handlerSpec.ts` deliberately keeps the declarative
 * handler vocabulary narrow — llm, connector, set, data — because a handler
 * runs sandboxed, on shared infrastructure, against a spec any project
 * collaborator can edit. Writing to `realizations`, a core platform table, is
 * not a capability that vocabulary should ever gain. So the rollup happens
 * here, in the trusted application layer.
 */

import { and, desc, eq } from 'drizzle-orm';
import { parseProofMeasure, thresholdMet, type ProofEvaluationDto, type ProofEvidence, type ProofMeasure } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { siteCollections, siteRecords } from '../../infrastructure/database/schema';
import { invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { appsDatabaseOf } from '../ide/appsDatabase';
import { proofSiteKey } from '../replay/replayCacheKeys';
import {
  holdRealizationVerdict,
  isRealizationVerdict,
  setRealizationVerdict,
  type RealizationVerdict,
  type Row,
} from './realizationStore';
import { recordProofOutcome } from './proofOutcomes';
import { evaluateProofMeasure, missPatterns } from './proofMeasure';
import { boundedGradeMetadata } from './proofEvidence';
import { bumpJourneySignal } from './journeySignal';
import { VERDICT_COLLECTION } from './targets/shared';

interface DecidedRecord {
  verdict: RealizationVerdict;
  metric: Record<string, unknown>;
  decidedAt: Date;
}

/** Why a measured verdict was written. */
export type MeasuredCall = 'posted' | 'early' | 'window';

export interface SyncVerdictOptions {
  /** A person calling it before the window ends — a written reason is the price. */
  earlyCallReason?: string | null;
  now?: Date;
}

/** The longest early-call reason kept. */
export const EARLY_CALL_REASON_MAX = 500;

/** The most recent decisive call posted to this project's verdict collection,
 *  or null when there isn't one (no collection yet, no submission yet, or a
 *  submission that did not carry a verdict this platform recognises). */
async function latestVerdictRecord(db: Db, tenantId: number, projectId: number): Promise<DecidedRecord | null> {
  const apps = appsDatabaseOf(db);
  const [collection] = await apps
    .select({ id: siteCollections.id })
    .from(siteCollections)
    .where(and(
      eq(siteCollections.tenantId, tenantId),
      eq(siteCollections.projectId, projectId),
      eq(siteCollections.name, VERDICT_COLLECTION),
    ))
    .limit(1);
  if (!collection) return null;

  const [record] = await apps
    .select({ payload: siteRecords.payload, createdAt: siteRecords.createdAt })
    .from(siteRecords)
    .where(and(eq(siteRecords.collectionId, collection.id), eq(siteRecords.tenantId, tenantId)))
    .orderBy(desc(siteRecords.id))
    .limit(1);
  if (!record) return null;

  const payload = (record.payload ?? {}) as Record<string, unknown>;
  if (!isRealizationVerdict(payload.verdict)) return null;
  return { verdict: payload.verdict, metric: payload, decidedAt: new Date(record.createdAt) };
}

/** A written reason, trimmed and bounded; null when there is none. */
export function cleanReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const reason = raw.replace(/\s+/g, ' ').trim();
  return reason ? reason.slice(0, EARLY_CALL_REASON_MAX) : null;
}

/**
 * MEASURE — the terminal that makes this method more than shipping.
 *
 * `validated` with 1 for met and 0 for missed, because BOTH are grades. Idempotent
 * through the ledger's own `(session, correlation, action, phase)` key, which
 * matters because this rolls up on every read of the realization.
 */
async function recordGrade(db: Db, tenantId: number, row: Row, updated: Row | null, verdict: RealizationVerdict, metadata: Record<string, unknown>) {
  await recordProofOutcome(db, {
    tenantId,
    userId: null,
    projectId: row.projectId,
    sessionId: (updated ?? row).sessionId,
    correlationId: `grade:${row.id}`,
    action: 'proof.grade',
    phase: 'validated',
    realizationId: row.id,
    targetKey: row.targetKey,
    metricKey: 'kill_condition_met',
    metricValue: verdict === 'met' ? 1 : 0,
    unit: 'count',
    metadata,
  });
}

/** The console-only path, unchanged: a proof with no measure trusts its console's call. */
async function syncFromConsole(env: Env | undefined, db: Db, tenantId: number, row: Row & { projectId: number }): Promise<Row> {
  const found = await latestVerdictRecord(db, tenantId, row.projectId);
  if (!found) return row;
  const rowDecidedAt = row.decidedAt ? new Date(row.decidedAt) : null;
  if (row.verdict === found.verdict && rowDecidedAt && rowDecidedAt.getTime() === found.decidedAt.getTime()) {
    return row;
  }
  const updated = await setRealizationVerdict(db, tenantId, row.id, {
    verdict: found.verdict,
    verdictMetric: found.metric,
    decidedAt: found.decidedAt,
  });
  await recordGrade(db, tenantId, row, updated, found.verdict, { verdict: found.verdict });
  await bumpJourneySignal(env, tenantId);
  return updated ?? row;
}

/** The number on the record: the measured one, in the console's familiar shape. */
function measuredMetric(measure: ProofMeasure, evaluation: ProofEvaluationDto, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    metricLabel: measure.success.ref,
    metricValue: evaluation.value,
    target: measure.threshold.value,
    sample: evaluation.sampleN,
    sampleMin: evaluation.sampleMin,
    unit: measure.threshold.unit,
    op: measure.threshold.op,
    measured: true,
    ...extra,
  };
}

async function syncMeasured(
  env: Env,
  db: Db,
  tenantId: number,
  row: Row & { projectId: number },
  measure: ProofMeasure,
  opts: SyncVerdictOptions,
): Promise<Row> {
  const now = opts.now ?? new Date();
  const evaluation = await evaluateProofMeasure(env, db, row, { now });
  if (!evaluation) return row;
  const posted = await latestVerdictRecord(db, tenantId, row.projectId);

  const decided = row.verdict === 'met' || row.verdict === 'missed';
  const rowDecidedAt = row.decidedAt ? new Date(row.decidedAt).getTime() : null;
  const postedIsNew = !!posted && (!decided || rowDecidedAt === null || posted.decidedAt.getTime() > rowDecidedAt);
  const earlyReason = cleanReason(opts.earlyCallReason);

  let call: MeasuredCall | null = null;
  let decidedAt = now;
  let reason: string | null = null;
  if (earlyReason) {
    call = 'early';
    reason = earlyReason;
  } else if (posted && postedIsNew) {
    const postedReason = cleanReason(posted.metric.reason);
    if (evaluation.sampleReached || postedReason) {
      call = evaluation.sampleReached ? 'posted' : 'early';
      reason = evaluation.sampleReached ? null : postedReason;
      decidedAt = posted.decidedAt;
    } else if (!decided) {
      return hold(db, tenantId, row, measure, evaluation, posted);
    }
  } else if (!decided && evaluation.windowEndsAt && now.getTime() >= new Date(evaluation.windowEndsAt).getTime()) {
    call = 'window';
    decidedAt = new Date(evaluation.windowEndsAt);
  }
  if (!call) return row;

  // A window grade is the status the window closed on; a call is the threshold
  // against the measured number, whatever the page that posted it believed.
  const verdict: RealizationVerdict = call === 'window'
    ? (evaluation.status === 'met' ? 'met' : 'missed')
    : (thresholdMet(evaluation.value, measure.threshold) ? 'met' : 'missed');

  const evidence: ProofEvidence = {
    sampleN: evaluation.sampleN,
    successN: evaluation.successN,
    threshold: measure.threshold,
    value: evaluation.value,
    releaseKeys: evaluation.releaseKeys,
    recordingIds: evaluation.evidenceRecordingIds,
    patterns: verdict === 'missed' ? await missPatterns(env, db, row, evaluation, now) : [],
  };

  const updated = await setRealizationVerdict(db, tenantId, row.id, {
    verdict,
    verdictMetric: measuredMetric(measure, evaluation, {
      call,
      ...(reason ? { reason } : {}),
      ...(posted && call !== 'window' && !earlyReason ? { posted: { verdict: posted.verdict, metricValue: posted.metric.metricValue ?? null } } : {}),
      evidence,
    }),
    decidedAt,
  });
  await recordGrade(db, tenantId, row, updated, verdict, boundedGradeMetadata({ verdict, call, evidence }));
  await bumpJourneySignal(env, tenantId);
  // A graded proof is no longer live: its site stops recording on the house.
  if (evaluation.siteId) await invalidateCached(env, proofSiteKey(evaluation.siteId));
  return updated ?? row;
}

/** A posted call that arrived before the sample did: keep the numbers, not the verdict. */
async function hold(
  db: Db,
  tenantId: number,
  row: Row,
  measure: ProofMeasure,
  evaluation: ProofEvaluationDto,
  posted: DecidedRecord,
): Promise<Row> {
  const prior = (row.verdictMetric ?? null) as Record<string, unknown> | null;
  const postedAt = posted.decidedAt.toISOString();
  if (prior?.held === 'sample_not_reached' && prior.postedAt === postedAt) return row;
  const updated = await holdRealizationVerdict(db, tenantId, row.id, measuredMetric(measure, evaluation, {
    held: 'sample_not_reached',
    postedAt,
    posted: { verdict: posted.verdict, metricValue: posted.metric.metricValue ?? null },
  }));
  return updated ?? row;
}

/**
 * Sync one realization's verdict.
 *
 * Idempotent and a no-op on every call after the first: safe to call on every
 * read of a single realization — which is exactly how it is wired, from
 * `GET /api/realizations/:id` — and from the daily `proof-verdicts` sweep.
 */
export async function syncRealizationVerdict(
  env: Env,
  db: Db,
  tenantId: number,
  row: Row,
  opts: SyncVerdictOptions = {},
): Promise<Row> {
  if (row.projectId == null) return row;
  // A person's own call always stands — a console recomputing after an idea
  // was parked must not silently resurrect it.
  if (row.verdict === 'abandoned') return row;
  const owned = row as Row & { projectId: number };
  const measure = parseProofMeasure(row.measure);
  return measure ? syncMeasured(env, db, tenantId, owned, measure, opts) : syncFromConsole(env, db, tenantId, owned);
}
