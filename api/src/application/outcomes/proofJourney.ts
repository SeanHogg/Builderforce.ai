/**
 * proofJourney — "what actually happened to this idea", read back from the ledger.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────
 * `outcomeMetricContract.ts` can say a session's `gradedProofRate` is 0.4. It
 * cannot say WHICH idea in that session never got graded, WHERE it stalled, or
 * whether the founder chose the proof form the recommender actually advised.
 * Those facts already exist as rows in `creation_outcome_events` — this module
 * is the read that reconstructs one session's Read→Prove→Build→Measure journey
 * from them, the way `attributedOutcomes.ts` reconstructs "what this session's
 * work did for somebody" from `metric_facts`. It computes nothing that isn't
 * already in the ledger; it just answers the question the aggregate can't.
 *
 * ── WHY GROUPING BY REALIZATION ID WORKS ────────────────────────────────────
 * `proofOutcomes.ts` correlates `proof.choose`/`proof.build`/`proof.grade` on
 * the SAME id — `choose:<id>`, `build:<id>`, `grade:<id>` — because all three
 * are about one realization. Stripping the prefix off `correlationId` is
 * therefore enough to fold three actions into one "attempt" with no join and
 * no second table. `idea.read` is deliberately NOT part of any attempt: a read
 * happens before a realization row exists, and a session may read an idea
 * several times before (or instead of) choosing anything.
 *
 * ── WHY "TOP RECOMMENDED" IS READ FROM THE PRECEDING READ ───────────────────
 * The recommender's ranked list is transient by design (`recommendRealizations`
 * never persists it) except for the copy `realizationRoutes.ts` now writes into
 * `idea.read succeeded`'s `metadata.recommendations`. A `proof.choose` is
 * matched to the most recent read that happened BEFORE it — the one the
 * chooser actually saw — not to any other read in the session's history.
 */

import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { creationOutcomeEvents } from '../../infrastructure/database/schema';
import { PROOF_ACTIONS, type OutcomePhase } from './outcomeMetricContract';

/** Bounded like every other per-session read here — a session's own proof
 *  history is not a census, and 500 rows is far past anything the loop
 *  (read, choose, build, grade; occasionally repeated) will ever produce. */
const RAW_EVENT_LIMIT = 500;

export type ProofJourneyAction = (typeof PROOF_ACTIONS)[number];

export interface ProofJourneyEvent {
  correlationId: string;
  action: ProofJourneyAction;
  phase: OutcomePhase;
  metricKey: string | null;
  metricValue: number | null;
  unit: string | null;
  artifactId: string | null;
  durationMs: number | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface ProofJourneyRecommendation {
  key: string;
  score: number;
  recommended: boolean;
}

export type ProofGradeResult = 'met' | 'missed' | 'abandoned';

export interface ProofJourneyAttempt {
  realizationId: string;
  targetKey: string | null;
  chosenAt: string | null;
  /** The recommender's top pick at the time of the PRECEDING read, if any. */
  topRecommendation: ProofJourneyRecommendation | null;
  /** Null when there was no preceding read to compare against. */
  chosenWasTopRecommended: boolean | null;
  build: {
    startedAt: string | null;
    succeededAt: string | null;
    failedAt: string | null;
    reachable: boolean | null;
  };
  grade: {
    startedAt: string | null;
    result: ProofGradeResult | null;
    resultAt: string | null;
  };
}

export type ProofJourneyStall =
  | 'not_chosen'
  | 'building'
  | 'build_failed'
  | 'not_reachable'
  | 'awaiting_grade'
  | 'abandoned';

export interface ProofJourneyVerdict {
  firstReadAt: string | null;
  readCount: number;
  /** The most recent read's ranked list — what the last chooser actually saw. */
  latestRecommendations: ProofJourneyRecommendation[];
  attemptCount: number;
  /** True once ANY attempt reached `validated` — met (1) or missed (0) both
   *  count, since both are a measurement. Abandoned never does. */
  reachedGradedProof: boolean;
  /** Where the MOST RECENT attempt (or the session, if none exists yet) is
   *  stuck. `null` once the latest attempt is graded, or when no idea has
   *  been read yet — there is nothing to call stalled before a first read. */
  stalledAt: ProofJourneyStall | null;
}

export interface ProofJourney {
  sessionId: string;
  events: ProofJourneyEvent[];
  attempts: ProofJourneyAttempt[];
  verdict: ProofJourneyVerdict;
}

function toIso(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseRecommendations(metadata: Record<string, unknown>): ProofJourneyRecommendation[] {
  const raw = metadata.recommendations;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => asRecord(entry))
    .filter((entry) => typeof entry.key === 'string')
    .map((entry) => ({
      key: entry.key as string,
      score: typeof entry.score === 'number' ? entry.score : 0,
      recommended: entry.recommended === true,
    }));
}

/** The realization id shared by a `choose:<id>` / `build:<id>` / `grade:<id>`
 *  correlation — `null` for `idea.read`'s own `read:<uuid>` scheme, which
 *  names no realization because none exists yet. */
function realizationIdOf(event: ProofJourneyEvent): string | null {
  if (event.action === 'idea.read') return null;
  const sep = event.correlationId.indexOf(':');
  return sep === -1 ? event.correlationId : event.correlationId.slice(sep + 1);
}

/**
 * Fold the raw ledger rows into the journey. Pure and exported separately from
 * the DB read below, for the same reason `shapeAttributedSeries` is: every
 * interesting case here is a data-shape case, and none of them needs a
 * database to be wrong.
 */
export function shapeProofJourney(sessionId: string, events: readonly ProofJourneyEvent[]): ProofJourney {
  const reads = events.filter((e) => e.action === 'idea.read' && e.phase === 'succeeded');

  const attemptsById = new Map<string, ProofJourneyAttempt>();
  const attemptOrder: string[] = [];
  const ensureAttempt = (realizationId: string): ProofJourneyAttempt => {
    let attempt = attemptsById.get(realizationId);
    if (!attempt) {
      attempt = {
        realizationId,
        targetKey: null,
        chosenAt: null,
        topRecommendation: null,
        chosenWasTopRecommended: null,
        build: { startedAt: null, succeededAt: null, failedAt: null, reachable: null },
        grade: { startedAt: null, result: null, resultAt: null },
      };
      attemptsById.set(realizationId, attempt);
      attemptOrder.push(realizationId);
    }
    return attempt;
  };

  /** The latest read that happened AT OR BEFORE `at` — the one its chooser saw. */
  const readBefore = (at: string) => {
    let best: ProofJourneyEvent | null = null;
    for (const read of reads) {
      if (read.occurredAt > at) break;
      best = read;
    }
    return best;
  };

  for (const event of events) {
    const realizationId = realizationIdOf(event);
    if (!realizationId) continue;
    const attempt = ensureAttempt(realizationId);
    const targetKey = typeof event.metadata.targetKey === 'string' ? event.metadata.targetKey : null;
    if (targetKey && !attempt.targetKey) attempt.targetKey = targetKey;

    if (event.action === 'proof.choose' && event.phase === 'succeeded') {
      attempt.chosenAt = event.occurredAt;
      const preceding = readBefore(event.occurredAt);
      if (preceding) {
        const recs = parseRecommendations(preceding.metadata);
        const top = recs.find((r) => r.recommended) ?? null;
        attempt.topRecommendation = top;
        attempt.chosenWasTopRecommended = top ? top.key === (targetKey ?? attempt.targetKey) : null;
      }
    } else if (event.action === 'proof.build') {
      if (event.phase === 'started') attempt.build.startedAt = event.occurredAt;
      else if (event.phase === 'succeeded') {
        attempt.build.succeededAt = event.occurredAt;
        attempt.build.reachable = event.metadata.reachable === true;
      } else if (event.phase === 'failed') attempt.build.failedAt = event.occurredAt;
    } else if (event.action === 'proof.grade') {
      if (event.phase === 'started') attempt.grade.startedAt = event.occurredAt;
      else if (event.phase === 'validated') {
        attempt.grade.result = (event.metricValue ?? 0) > 0 ? 'met' : 'missed';
        attempt.grade.resultAt = event.occurredAt;
      } else if (event.phase === 'failed') {
        // The only `proof.grade failed` emitter is the park/abandon path
        // (`PATCH /:id/verdict`), which always stamps `metadata.verdict`.
        attempt.grade.result = 'abandoned';
        attempt.grade.resultAt = event.occurredAt;
      }
    }
  }

  const attempts = attemptOrder.map((id) => attemptsById.get(id)!);
  const latest = attempts[attempts.length - 1] ?? null;
  const latestRead = reads[reads.length - 1] ?? null;

  let stalledAt: ProofJourneyStall | null = null;
  if (!latest) {
    if (reads.length) stalledAt = 'not_chosen';
  } else if (latest.grade.result === 'abandoned') {
    stalledAt = 'abandoned';
  } else if (latest.grade.result == null) {
    if (latest.build.failedAt) stalledAt = 'build_failed';
    else if (latest.build.succeededAt) stalledAt = latest.build.reachable ? 'awaiting_grade' : 'not_reachable';
    else if (latest.build.startedAt) stalledAt = 'building';
    else stalledAt = 'not_chosen';
  }
  // `stalledAt` stays null when `latest.grade.result` is 'met' or 'missed' —
  // both are a measurement, and a graded attempt is not stalled at anything.

  return {
    sessionId,
    events: [...events],
    attempts,
    verdict: {
      firstReadAt: reads[0]?.occurredAt ?? null,
      readCount: reads.length,
      latestRecommendations: latestRead ? parseRecommendations(latestRead.metadata) : [],
      attemptCount: attempts.length,
      reachedGradedProof: attempts.some((a) => a.grade.result === 'met' || a.grade.result === 'missed'),
      stalledAt,
    },
  };
}

/**
 * Read one session's proof-lifecycle events and fold them into its journey.
 *
 * The caller supplies the tenant, for the same reason `buildAttributedOutcomes`
 * does: a ledger row is tenant-scoped, and a session id alone must never let
 * one workspace read another's proof history.
 */
export async function buildProofJourney(db: Db, args: { tenantId: number; sessionId: string }): Promise<ProofJourney> {
  const rows = await db
    .select({
      correlationId: creationOutcomeEvents.correlationId,
      action: creationOutcomeEvents.action,
      phase: creationOutcomeEvents.phase,
      metricKey: creationOutcomeEvents.metricKey,
      metricValue: creationOutcomeEvents.metricValue,
      unit: creationOutcomeEvents.unit,
      artifactId: creationOutcomeEvents.artifactId,
      durationMs: creationOutcomeEvents.durationMs,
      metadata: creationOutcomeEvents.metadata,
      occurredAt: creationOutcomeEvents.occurredAt,
    })
    .from(creationOutcomeEvents)
    .where(and(
      eq(creationOutcomeEvents.tenantId, args.tenantId),
      eq(creationOutcomeEvents.sessionId, args.sessionId),
      inArray(creationOutcomeEvents.action, [...PROOF_ACTIONS]),
    ))
    .orderBy(asc(creationOutcomeEvents.occurredAt))
    .limit(RAW_EVENT_LIMIT);

  const events: ProofJourneyEvent[] = rows.map((row) => ({
    correlationId: row.correlationId,
    action: row.action as ProofJourneyAction,
    phase: row.phase as OutcomePhase,
    metricKey: row.metricKey ?? null,
    metricValue: row.metricValue == null ? null : Number(row.metricValue),
    unit: row.unit ?? null,
    artifactId: row.artifactId ?? null,
    durationMs: row.durationMs ?? null,
    metadata: asRecord(row.metadata),
    occurredAt: toIso(row.occurredAt),
  }));

  return shapeProofJourney(args.sessionId, events);
}
