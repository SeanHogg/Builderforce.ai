/**
 * Grade a proof by what its visitors did (PRD 33 D12, §5.3.1).
 *
 * `evaluateProofMeasure` reads the proof's OWN hosted Insights site — never
 * another site of the workspace — and answers its `ProofMeasure`: how many
 * sampled visits there were (THE filter compiler, weighted by `sample_weight`
 * like every kept-recording read, D15), how many of them succeeded (the smart
 * event's predicate, or the funnel's last step), whether that clears the
 * threshold, and when the window that started with the first sampled visit
 * ends. The counts are cached under the site's replay version; the status is
 * recomputed against `now` on every call, because the window can close between
 * two reads with no new visit to bump the version.
 *
 * `missPatterns` is the one model call: cited patterns over the visitors who did
 * not succeed, through the segment summary (cached, budgeted). Only the verdict
 * sync calls it, and only for a `missed` grade.
 */

import { and, desc, eq, gte, lt, not, sql, type SQL } from 'drizzle-orm';
import {
  fnv1a64,
  nonConvertingFilter,
  parseProofMeasure,
  PROOF_EVIDENCE_RECORDINGS,
  proofStatus,
  proofValue,
  type ProofEvaluationDto,
  type ProofMeasure,
  type ProofPattern,
} from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replayRecordings } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { DAY_MS } from '../../domain/shared/time';
import type { ReplayScope } from '../../domain/replay/replayScope';
import { replayReadKeys } from '../replay/replayCacheKeys';
import { replayTelemetryDb } from '../replay/replayDatabase';
import { smartEventPredicate } from '../replay/replayFilterCompiler';
import { compileScopeFilter, siteSmartEventRows } from '../replay/replaySmartEventRules';
import { projectSiteDto } from '../replay/replaySiteAdmin';
import { ReplayFunnelService } from '../replay/ReplayFunnelService';
import { summarizeSegment } from '../replay/replaySummaries';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Row } from './realizationStore';

const SOURCE = 'application/realization/proofMeasure.ts';
const TTL = { kvTtlSeconds: 300, l1TtlMs: 30_000 };
/** The segment summary reads at most this many days back. */
const PATTERN_DAYS_MAX = 90;

/** The cached half: counts that only change when a visit arrives. */
interface MeasuredCounts {
  firstAt: string | null;
  sampleN: number;
  successN: number;
  releaseKeys: string[];
  evidenceRecordingIds: string[];
}

const EMPTY_COUNTS: MeasuredCounts = { firstAt: null, sampleN: 0, successN: 0, releaseKeys: [], evidenceRecordingIds: [] };

const num = (value: unknown): number => Math.round(Number(value ?? 0) || 0);
const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(String(value)));

/** The proof's own hosted site, as a scope — or null before it was published or recorded. */
export async function proofScope(env: Env, db: Db, row: Pick<Row, 'tenantId' | 'projectId'>): Promise<ReplayScope | null> {
  if (row.projectId == null) return null;
  const site = await projectSiteDto(env, db, row.tenantId, row.projectId);
  return site ? { tenantId: row.tenantId, siteId: site.id } : null;
}

/** "The recording succeeded": the smart event's predicate, or (funnel) the converted flag for evidence. */
async function successPredicate(env: Env, db: Db, scope: ReplayScope, measure: ProofMeasure): Promise<SQL> {
  if (measure.success.kind === 'funnel') return eq(replayRecordings.converted, true);
  const siteRules = await siteSmartEventRows(env, db, scope);
  return smartEventPredicate(measure.success.ref, { siteRules });
}

async function measureCounts(
  env: Env,
  db: Db,
  scope: ReplayScope,
  measure: ProofMeasure,
  since: Date,
): Promise<MeasuredCounts> {
  const store = replayTelemetryDb(env, db);
  const { where: sampleWhere } = await compileScopeFilter(env, db, scope, measure.sample.filter);
  const sampled = and(
    eq(replayRecordings.tenantId, scope.tenantId),
    eq(replayRecordings.siteId, scope.siteId),
    gte(replayRecordings.startedAt, since),
    sampleWhere,
  );

  const [first] = await store
    .select({ firstAt: sql<Date | string | null>`min(${replayRecordings.startedAt})` })
    .from(replayRecordings)
    .where(sampled);
  if (!first?.firstAt) return EMPTY_COUNTS;
  const firstAt = toDate(first.firstAt);
  const inWindow = and(sampled, lt(replayRecordings.startedAt, new Date(firstAt.getTime() + measure.windowDays * DAY_MS)));

  const success = await successPredicate(env, db, scope, measure);
  const [counts] = await store
    .select({
      sampleN: sql<number>`coalesce(sum(${replayRecordings.sampleWeight}), 0)`,
      successN: sql<number>`coalesce(sum(${replayRecordings.sampleWeight}) filter (where ${success}), 0)`,
      releaseKeys: sql<string[] | null>`array_agg(distinct ${replayRecordings.releaseKey})`,
    })
    .from(replayRecordings)
    .where(inWindow);

  const misses = await store
    .select({ id: replayRecordings.id })
    .from(replayRecordings)
    .where(and(inWindow, not(success)))
    .orderBy(desc(replayRecordings.startedAt))
    .limit(PROOF_EVIDENCE_RECORDINGS);

  let successN = num(counts?.successN);
  if (measure.success.kind === 'funnel') {
    // The funnel's own fold over the sample: its last step is "succeeded".
    const days = Math.max(1, Math.ceil((Date.now() - firstAt.getTime()) / DAY_MS));
    const evaluation = await new ReplayFunnelService(env, db).evaluate(scope, measure.success.ref, {
      days,
      filter: measure.sample.filter,
    });
    successN = num(evaluation.steps[evaluation.steps.length - 1]?.visits);
  }

  return {
    firstAt: firstAt.toISOString(),
    sampleN: num(counts?.sampleN),
    successN,
    releaseKeys: (counts?.releaseKeys ?? []).filter((key): key is string => typeof key === 'string' && key.length > 0).sort(),
    evidenceRecordingIds: misses.map((m) => m.id),
  };
}

/** Patterns already cited on the row's measured grade (written by the verdict sync). */
function storedPatterns(row: Pick<Row, 'verdictMetric'>): ProofPattern[] {
  const metric = row.verdictMetric as { evidence?: { patterns?: unknown } } | null;
  const patterns = metric?.evidence?.patterns;
  return Array.isArray(patterns) ? (patterns as ProofPattern[]) : [];
}

/**
 * The proof's standing at `now`, or null when it declares no measure. A proof that
 * has no recorded site yet answers `collecting` with zero counts and no window.
 */
export async function evaluateProofMeasure(
  env: Env,
  db: Db,
  row: Row,
  opts: { now?: Date } = {},
): Promise<ProofEvaluationDto | null> {
  const measure = parseProofMeasure(row.measure);
  if (!measure) return null;
  const now = opts.now ?? new Date();
  const scope = await proofScope(env, db, row);
  const since = toDate(row.createdAt);

  let counts = EMPTY_COUNTS;
  if (scope) {
    const keys = await replayReadKeys(env, scope);
    const measureKey = fnv1a64(`${JSON.stringify(measure)}|${since.toISOString()}`);
    counts = await getOrSetCached(env, keys.proofMeasure(row.id, measureKey), () => measureCounts(env, db, scope, measure, since), TTL);
  }

  const windowEndsAt = counts.firstAt ? new Date(toDate(counts.firstAt).getTime() + measure.windowDays * DAY_MS) : null;
  const sampleReached = counts.sampleN >= measure.sample.min;
  const value = proofValue(counts.sampleN, counts.successN, measure.threshold.unit);
  return {
    realizationId: row.id,
    siteId: scope?.siteId ?? null,
    measure,
    sampleN: counts.sampleN,
    sampleMin: measure.sample.min,
    sampleReached,
    successN: counts.successN,
    value,
    threshold: measure.threshold,
    status: proofStatus({ sampleReached, value, threshold: measure.threshold, windowEndsAt }, now),
    windowStartedAt: counts.firstAt,
    windowEndsAt: windowEndsAt?.toISOString() ?? null,
    releaseKeys: counts.releaseKeys,
    evidenceRecordingIds: counts.evidenceRecordingIds,
    patterns: storedPatterns(row),
  };
}

/**
 * Cited patterns over the sampled visitors who did not succeed. Best-effort: the
 * segment summary may be out of budget or uncited, and a grade without patterns is
 * still a grade — so any failure answers `[]`.
 */
export async function missPatterns(
  env: Env,
  db: Db,
  row: Pick<Row, 'tenantId' | 'projectId'>,
  evaluation: Pick<ProofEvaluationDto, 'measure' | 'windowStartedAt'>,
  now: Date = new Date(),
): Promise<ProofPattern[]> {
  const scope = await proofScope(env, db, row);
  if (!scope || !evaluation.windowStartedAt) return [];
  const days = Math.min(PATTERN_DAYS_MAX, Math.max(1, Math.ceil((now.getTime() - toDate(evaluation.windowStartedAt).getTime()) / DAY_MS)));
  try {
    const summary = await summarizeSegment(env, db, scope, { days, filter: nonConvertingFilter(evaluation.measure) });
    return summary.patterns;
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'missPatterns', context: { siteId: scope.siteId } });
    return [];
  }
}
