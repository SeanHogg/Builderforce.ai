/**
 * LENS — Internal sentiment / pulse survey (EMP-15).
 *
 * A lightweight periodic pulse: a single-question survey on a 1..scale range that
 * any member answers ONCE, anonymously. This module rolls raw responses into an
 * aggregate (average, score distribution, eNPS-style promoter/detractor split) and
 * a cross-survey trend — never exposing a per-user score.
 *
 * ANONYMITY: {@link summarizePulse} takes only scores + comments (no identity), and
 * suppresses free-text comments below {@link MIN_ANON_RESPONSES} responses so a
 * comment can't be de-anonymised in a tiny group. The route never selects user_id
 * into an aggregate read.
 *
 * All aggregation is pure so it is unit-testable without a DB.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { pulseSurveys, pulseResponses } from '../../infrastructure/database/schema';

/** Below this many responses, comments are withheld to protect anonymity. */
export const MIN_ANON_RESPONSES = 3;

export interface PulseDistributionBin { score: number; count: number }

export interface PulseAggregate {
  surveyId: string;
  question: string;
  scale: number;
  active: boolean;
  responseCount: number;
  averageScore: number | null;
  /** eNPS-style: %promoters − %detractors, −100..100. Null with no responses. */
  enps: number | null;
  promoters: number;
  passives: number;
  detractors: number;
  distribution: PulseDistributionBin[];
  /** Anonymised comments (no identity), or [] when suppressed for anonymity. */
  comments: string[];
  commentsSuppressed: boolean;
}

/** Normalised 0..1 position of a raw score on a 1..scale range. */
function normalized(score: number, scale: number): number {
  return scale > 1 ? (score - 1) / (scale - 1) : 1;
}

/**
 * Pure: classify one normalised score into the eNPS band. Promoter ≥ 0.8 (top of
 * the range), detractor ≤ 0.5 (bottom half), passive in between — the standard
 * 9-10 / 7-8 / 0-6 split generalised to any scale.
 */
export function enpsBand(score: number, scale: number): 'promoter' | 'passive' | 'detractor' {
  const f = normalized(score, scale);
  if (f >= 0.8) return 'promoter';
  if (f <= 0.5) return 'detractor';
  return 'passive';
}

/** Pure: roll raw scores (+ optional comments) into the anonymous aggregate. */
export function summarizePulse(
  survey: { id: string; question: string; scale: number; active: boolean },
  responses: Array<{ score: number; comment: string | null }>,
): PulseAggregate {
  const scale = survey.scale > 0 ? survey.scale : 5;
  const scores = responses.map((r) => r.score).filter((s) => Number.isFinite(s));
  const responseCount = scores.length;

  let promoters = 0, passives = 0, detractors = 0;
  const bins = new Map<number, number>();
  for (const s of scores) {
    const clamped = Math.max(1, Math.min(scale, Math.round(s)));
    bins.set(clamped, (bins.get(clamped) ?? 0) + 1);
    const band = enpsBand(clamped, scale);
    if (band === 'promoter') promoters += 1;
    else if (band === 'detractor') detractors += 1;
    else passives += 1;
  }

  const distribution: PulseDistributionBin[] = [];
  for (let s = 1; s <= scale; s++) distribution.push({ score: s, count: bins.get(s) ?? 0 });

  const averageScore = responseCount ? scores.reduce((a, b) => a + b, 0) / responseCount : null;
  const enps = responseCount ? Math.round(((promoters - detractors) / responseCount) * 100) : null;

  const commentsSuppressed = responseCount < MIN_ANON_RESPONSES;
  const comments = commentsSuppressed
    ? []
    : responses.map((r) => r.comment?.trim()).filter((c): c is string => !!c);

  return {
    surveyId: survey.id,
    question: survey.question,
    scale,
    active: survey.active,
    responseCount,
    averageScore,
    enps,
    promoters,
    passives,
    detractors,
    distribution,
    comments,
    commentsSuppressed,
  };
}

/** I/O: aggregate one survey (anonymous — user_id is never selected). */
export async function computePulseAggregate(db: Db, tenantId: number, surveyId: string): Promise<PulseAggregate | null> {
  const [survey] = await db
    .select({ id: pulseSurveys.id, question: pulseSurveys.question, scale: pulseSurveys.scale, active: pulseSurveys.active })
    .from(pulseSurveys)
    .where(and(eq(pulseSurveys.id, surveyId), eq(pulseSurveys.tenantId, tenantId)))
    .limit(1);
  if (!survey) return null;

  const responses = await db
    .select({ score: pulseResponses.score, comment: pulseResponses.comment })
    .from(pulseResponses)
    .where(and(eq(pulseResponses.surveyId, surveyId), eq(pulseResponses.tenantId, tenantId)));

  return summarizePulse(survey, responses);
}

export interface PulseTrendPoint { surveyId: string; question: string; createdAt: string; averageScore: number | null; responseCount: number; enps: number | null }

/**
 * I/O: cross-survey trend — the average score + eNPS of each recent survey, oldest
 * first, so the widget can sparkline sentiment over time. Bounded to `limit`
 * surveys. Anonymous (per-survey aggregate only).
 */
export async function computePulseTrend(db: Db, tenantId: number, limit = 12): Promise<PulseTrendPoint[]> {
  const surveys = await db
    .select({ id: pulseSurveys.id, question: pulseSurveys.question, scale: pulseSurveys.scale, active: pulseSurveys.active, createdAt: pulseSurveys.createdAt })
    .from(pulseSurveys)
    .where(eq(pulseSurveys.tenantId, tenantId))
    .orderBy(desc(pulseSurveys.createdAt))
    .limit(limit);

  const points = await Promise.all(surveys.map(async (s) => {
    const responses = await db
      .select({ score: pulseResponses.score, comment: pulseResponses.comment })
      .from(pulseResponses)
      .where(and(eq(pulseResponses.surveyId, s.id), eq(pulseResponses.tenantId, tenantId)));
    const agg = summarizePulse(s, responses);
    return {
      surveyId: s.id,
      question: s.question,
      createdAt: new Date(s.createdAt).toISOString(),
      averageScore: agg.averageScore,
      responseCount: agg.responseCount,
      enps: agg.enps,
    };
  }));

  return points.reverse(); // oldest → newest for charting
}
