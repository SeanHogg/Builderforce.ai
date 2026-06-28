/**
 * DevEx insights — the rollup behind the "DevEx Surveys & Insights" lens and the
 * "AI DevEx Analysis" feature (gate insights.devex).
 *
 * Reads the survey-framework tables (devex_campaigns / devex_responses, joined to
 * their templates for question→dimension tagging) and produces everything the
 * results visuals need:
 *   - the DevEx Index (overall score) with its trend and benchmark deltas,
 *   - per-dimension scores with rank, period trend, comment/question counts, and a
 *     negative/neutral/positive sentiment split,
 *   - eNPS, the AI-tools sentiment cut, response rate + average response time,
 *   - a per-period trend and a per-period per-dimension rank table (slope chart),
 *   - participation over time and by segment,
 *   - a segment heatmap (group / team / location / role) that respects the
 *     anonymity threshold,
 *   - a cross-tenant benchmark at a chosen percentile (50 / 75 / 90).
 *
 * The aggregation ({@link summarizeDevex}) is a pure function over already-fetched
 * rows so it is unit-testable without a DB; the route caches it.
 */

import { and, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  devexCampaigns, devexResponses, devexSurveyTemplates,
  ANONYMITY_THRESHOLD, DEVEX_SEGMENT_KINDS,
  type SurveyQuestion, type DevexDimension, type AnswerMap,
  type DevexSegments, type DevexSegmentKind,
} from '../devex/devexSurveys';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Benchmark percentiles the UI offers. */
export type BenchmarkPercentile = 50 | 75 | 90;
/** Window the cross-tenant benchmark cohort is gathered over. */
export const BENCHMARK_WINDOW_DAYS = 365;

/** Sentiment buckets for a 0..100 score: negative < 40, neutral < 70, else positive. */
const SENTIMENT_NEG = 40;
const SENTIMENT_POS = 70;

/** A campaign row + its template's questions, as the collector needs it. */
export interface CampaignWithQuestions {
  id: number;
  title: string;
  periodMonth: string | null;
  status: string;
  recipientCount: number | null;
  openedAt: Date | string | null;
  questions: SurveyQuestion[];
}

/** A response row as the collector needs it. */
export interface ResponseRow {
  campaignId: number;
  answers: AnswerMap;
  segments: DevexSegments;
  submittedAt: Date | string | null;
}

export interface DimensionSentiment {
  negative: number;
  neutral: number;
  positive: number;
}

export interface DimensionScore {
  dimension: DevexDimension;
  avgScore: number; // 0..100
  n: number;        // answered datapoints feeding the score
  rank: number;     // 1 = lowest score (highest priority / most attention needed)
  trendDelta: number | null;     // latest period − previous period (this dimension)
  benchmarkDelta: number | null; // tenant avg − benchmark at the chosen percentile
  questionCount: number;         // distinct questions tagged this dimension
  commentCount: number;          // free-text answers in this dimension
  sentiment: DimensionSentiment; // split of scored datapoints
}

export interface TrendPoint {
  periodMonth: string;
  avgScore: number; // 0..100 across all scored answers in the period
  enps: number;     // -100..100
  responses: number;
}

/** Per-period per-dimension scores + ranks — feeds the "priorities" slope chart. */
export interface DimensionTrendPoint {
  periodMonth: string;
  scores: Partial<Record<DevexDimension, number>>;
  ranks: Partial<Record<DevexDimension, number>>; // 1 = lowest score that period
}

export interface ParticipationPoint {
  date: string;       // YYYY-MM-DD
  responses: number;  // responses that day
  cumulative: number; // running total
}

export interface SegmentCount {
  label: string;
  count: number;
}

export interface SegmentScoreRow {
  label: string;
  n: number;
  overall: number; // avg across all scored answers for this group
  scores: Partial<Record<DevexDimension, number>>;
}

export interface DevexBenchmark {
  percentile: BenchmarkPercentile;
  index: number; // overall benchmark index (0..100)
  byDimension: Partial<Record<DevexDimension, number>>;
  companies: number; // tenants in the cohort
  windowDays: number;
}

export interface DevexInsights {
  windowDays: number;
  responseRatePct: number;
  totalResponses: number;
  totalRecipients: number | null;
  avgResponseTimeSec: number | null;
  enps: number; // -100..100
  index: { score: number; trendDelta: number | null; benchmarkDelta: number | null };
  byDimension: DimensionScore[];
  aiToolsSentiment: { avgScore: number; n: number; positivePct: number };
  trend: TrendPoint[];
  dimensionTrend: DimensionTrendPoint[];
  participation: {
    timeline: ParticipationPoint[];
    bySegment: Partial<Record<DevexSegmentKind, SegmentCount[]>>;
  };
  segments: {
    threshold: number;
    byKind: Partial<Record<DevexSegmentKind, SegmentScoreRow[]>>;
  };
  benchmark: DevexBenchmark | null;
}

/**
 * Normalize a single answer to a 0..100 score for its question type.
 *   rating (1..5) → (v-1)/4 * 100
 *   nps    (0..10) → v/10 * 100
 *   boolean        → 100 | 0
 *   text           → not scored (returns null)
 */
export function answerScore(q: SurveyQuestion, raw: unknown): number | null {
  switch (q.type) {
    case 'rating': {
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      return ((Math.min(5, Math.max(1, n)) - 1) / 4) * 100;
    }
    case 'nps': {
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      return (Math.min(10, Math.max(0, n)) / 10) * 100;
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw ? 100 : 0;
      if (raw === 'true') return 100;
      if (raw === 'false') return 0;
      return null;
    }
    default:
      return null; // text
  }
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Push `v` into the array stored at `key`, creating it on first use. */
function bucket<K>(m: Map<K, number[]>, key: K, v: number): void {
  const arr = m.get(key);
  if (arr) arr.push(v);
  else m.set(key, [v]);
}

/** eNPS over a list of raw NPS scores (0..10): %promoters(9-10) − %detractors(0-6). */
function enpsOf(npsScores: number[]): number {
  if (!npsScores.length) return 0;
  const promoters = npsScores.filter((s) => s >= 9).length;
  const detractors = npsScores.filter((s) => s <= 6).length;
  return ((promoters - detractors) / npsScores.length) * 100;
}

/**
 * Pure: the percentile `p` (0..100) of `values` by linear interpolation between
 * the two nearest ranks. Returns null for an empty list. Used by the cross-tenant
 * DevEx benchmark (percentile of per-tenant averages).
 */
export function percentileOf(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (rank - lo) * (sorted[hi]! - sorted[lo]!);
}

function toDate(d: Date | string | null): Date | null {
  if (d == null) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Pure: turn campaign+question rows and response rows into the DevEx rollup.
 * Response rate uses the campaigns' recipient counts when present (responses ÷
 * recipients) and otherwise falls back to the responses ÷ campaigns proxy.
 * Priority rank is derived from score: rank 1 = the lowest-scoring dimension
 * (where attention is most needed) — we have no separate priority signal.
 */
export function summarizeDevex(
  campaigns: CampaignWithQuestions[],
  responses: ResponseRow[],
  windowDays: number,
): DevexInsights {
  const questionsByCampaign = new Map<number, Map<string, SurveyQuestion>>();
  const periodByCampaign = new Map<number, string>();
  const openedByCampaign = new Map<number, Date | null>();
  // Distinct question ids per dimension (for the "# questions" column).
  const questionIdsByDim = new Map<DevexDimension, Set<string>>();
  for (const c of campaigns) {
    questionsByCampaign.set(c.id, new Map(c.questions.map((q) => [q.id, q])));
    if (c.periodMonth) periodByCampaign.set(c.id, c.periodMonth);
    openedByCampaign.set(c.id, toDate(c.openedAt));
    for (const q of c.questions) {
      const set = questionIdsByDim.get(q.dimension) ?? questionIdsByDim.set(q.dimension, new Set()).get(q.dimension)!;
      set.add(q.id);
    }
  }

  const dimScores = new Map<DevexDimension, number[]>();
  const dimComments = new Map<DevexDimension, number>();
  const dimSentiment = new Map<DevexDimension, DimensionSentiment>();
  const npsScores: number[] = [];
  const aiScores: number[] = [];
  const allScores: number[] = [];
  const periodScores = new Map<string, number[]>();
  const periodNps = new Map<string, number[]>();
  const periodResponses = new Map<string, number>();
  // period → dimension → scores (for the slope chart)
  const periodDimScores = new Map<string, Map<DevexDimension, number[]>>();
  // participation
  const responsesByDay = new Map<string, number>();
  const responseTimesSec: number[] = [];
  // segments: kind → label → { scores, dimScores, count }
  type SegAcc = { count: number; scores: number[]; dim: Map<DevexDimension, number[]> };
  const segByKind = new Map<DevexSegmentKind, Map<string, SegAcc>>();

  const addSentiment = (dim: DevexDimension, s: number) => {
    const cur = dimSentiment.get(dim) ?? { negative: 0, neutral: 0, positive: 0 };
    if (s < SENTIMENT_NEG) cur.negative++;
    else if (s < SENTIMENT_POS) cur.neutral++;
    else cur.positive++;
    dimSentiment.set(dim, cur);
  };

  for (const r of responses) {
    const qmap = questionsByCampaign.get(r.campaignId);
    const period = periodByCampaign.get(r.campaignId) ?? '—';
    periodResponses.set(period, (periodResponses.get(period) ?? 0) + 1);

    const submitted = toDate(r.submittedAt);
    if (submitted) {
      const dk = dayKey(submitted);
      responsesByDay.set(dk, (responsesByDay.get(dk) ?? 0) + 1);
      const opened = openedByCampaign.get(r.campaignId) ?? null;
      if (opened) {
        const sec = (submitted.getTime() - opened.getTime()) / 1000;
        if (sec >= 0) responseTimesSec.push(sec);
      }
    }

    if (!qmap) continue;

    // Per-response accumulation also feeds the segment buckets.
    const segAccs: SegAcc[] = [];
    for (const kind of DEVEX_SEGMENT_KINDS) {
      const label = r.segments?.[kind];
      if (!label) continue;
      const byLabel = segByKind.get(kind) ?? segByKind.set(kind, new Map()).get(kind)!;
      const acc = byLabel.get(label) ?? byLabel.set(label, { count: 0, scores: [], dim: new Map() }).get(label)!;
      acc.count++;
      segAccs.push(acc);
    }

    for (const [qid, raw] of Object.entries(r.answers ?? {})) {
      const q = qmap.get(qid);
      if (!q) continue;

      if (q.type === 'text') {
        if (typeof raw === 'string' && raw.trim()) dimComments.set(q.dimension, (dimComments.get(q.dimension) ?? 0) + 1);
        continue;
      }

      if (q.type === 'nps') {
        const n = Number(raw);
        if (Number.isFinite(n)) {
          npsScores.push(n);
          bucket(periodNps, period, n);
        }
      }

      const s = answerScore(q, raw);
      if (s == null) continue;

      bucket(dimScores, q.dimension, s);
      bucket(periodScores, period, s);
      allScores.push(s);
      addSentiment(q.dimension, s);
      if (q.dimension === 'ai_tools') aiScores.push(s);

      const pdm = periodDimScores.get(period) ?? periodDimScores.set(period, new Map()).get(period)!;
      bucket(pdm, q.dimension, s);

      for (const acc of segAccs) {
        acc.scores.push(s);
        bucket(acc.dim, q.dimension, s);
      }
    }
  }

  // ── Per-dimension scores, ranked worst-first (rank 1 = lowest score) ──────
  const dims: Array<{ dimension: DevexDimension; avgScore: number; n: number }> = [...dimScores.entries()]
    .map(([dimension, xs]) => ({ dimension, avgScore: round1(mean(xs)), n: xs.length }))
    .sort((a, b) => a.avgScore - b.avgScore);

  // ── Per-period trend + per-period per-dimension ranks (slope chart) ───────
  const periods = [...periodResponses.keys()].filter((p) => p !== '—').sort();
  const trend: TrendPoint[] = periods.map((p) => ({
    periodMonth: p,
    avgScore: round1(mean(periodScores.get(p) ?? [])),
    enps: round1(enpsOf(periodNps.get(p) ?? [])),
    responses: periodResponses.get(p) ?? 0,
  }));

  const dimensionTrend: DimensionTrendPoint[] = periods.map((p) => {
    const pdm = periodDimScores.get(p) ?? new Map<DevexDimension, number[]>();
    const scored = [...pdm.entries()].map(([d, xs]) => ({ d, score: round1(mean(xs)) }))
      .sort((a, b) => a.score - b.score); // worst-first → rank 1
    const scores: Partial<Record<DevexDimension, number>> = {};
    const ranks: Partial<Record<DevexDimension, number>> = {};
    scored.forEach((e, i) => { scores[e.d] = e.score; ranks[e.d] = i + 1; });
    return { periodMonth: p, scores, ranks };
  });

  // Per-dimension trend delta = latest period − previous period (that dimension).
  const dimTrendDelta = (d: DevexDimension): number | null => {
    const pts = dimensionTrend.filter((t) => t.scores[d] != null);
    if (pts.length < 2) return null;
    const latest = pts[pts.length - 1]!.scores[d]!;
    const prev = pts[pts.length - 2]!.scores[d]!;
    return round1(latest - prev);
  };

  const byDimension: DimensionScore[] = dims.map((d, i) => ({
    dimension: d.dimension,
    avgScore: d.avgScore,
    n: d.n,
    rank: i + 1,
    trendDelta: dimTrendDelta(d.dimension),
    benchmarkDelta: null, // filled by computeDevexInsights once the benchmark is known
    questionCount: questionIdsByDim.get(d.dimension)?.size ?? 0,
    commentCount: dimComments.get(d.dimension) ?? 0,
    sentiment: dimSentiment.get(d.dimension) ?? { negative: 0, neutral: 0, positive: 0 },
  }));

  // ── AI-tools cut ─────────────────────────────────────────────────────────
  const aiPositive = aiScores.filter((s) => s >= 60).length;
  const aiToolsSentiment = {
    avgScore: round1(mean(aiScores)),
    n: aiScores.length,
    positivePct: aiScores.length ? round1((aiPositive / aiScores.length) * 100) : 0,
  };

  // ── Participation ──────────────────────────────────────────────────────────
  let cumulative = 0;
  const timeline: ParticipationPoint[] = [...responsesByDay.keys()].sort().map((date) => {
    const responsesThatDay = responsesByDay.get(date) ?? 0;
    cumulative += responsesThatDay;
    return { date, responses: responsesThatDay, cumulative };
  });

  const participationBySegment: Partial<Record<DevexSegmentKind, SegmentCount[]>> = {};
  const segmentScores: Partial<Record<DevexSegmentKind, SegmentScoreRow[]>> = {};
  for (const [kind, byLabel] of segByKind.entries()) {
    // Anonymity: only surface groups meeting the threshold.
    const rows = [...byLabel.entries()].filter(([, acc]) => acc.count >= ANONYMITY_THRESHOLD);
    if (!rows.length) continue;
    participationBySegment[kind] = rows
      .map(([label, acc]) => ({ label, count: acc.count }))
      .sort((a, b) => b.count - a.count);
    segmentScores[kind] = rows
      .map(([label, acc]) => {
        const scores: Partial<Record<DevexDimension, number>> = {};
        for (const [d, xs] of acc.dim.entries()) scores[d] = round1(mean(xs));
        return { label, n: acc.count, overall: round1(mean(acc.scores)), scores };
      })
      .sort((a, b) => b.overall - a.overall);
  }

  // ── Index + rates ──────────────────────────────────────────────────────────
  const totalResponses = responses.length;
  const recipientTotals = campaigns.map((c) => c.recipientCount).filter((n): n is number => n != null && n > 0);
  const totalRecipients = recipientTotals.length ? recipientTotals.reduce((a, b) => a + b, 0) : null;
  const responseRatePct = totalRecipients
    ? Math.min(100, round1((totalResponses / totalRecipients) * 100))
    : Math.min(100, round1((totalResponses / Math.max(1, campaigns.length)) * 100));

  const indexScore = round1(mean(allScores));
  const indexTrendDelta = trend.length >= 2
    ? round1(trend[trend.length - 1]!.avgScore - trend[trend.length - 2]!.avgScore)
    : null;

  return {
    windowDays,
    responseRatePct,
    totalResponses,
    totalRecipients,
    avgResponseTimeSec: responseTimesSec.length ? Math.round(mean(responseTimesSec)) : null,
    enps: round1(enpsOf(npsScores)),
    index: { score: indexScore, trendDelta: indexTrendDelta, benchmarkDelta: null },
    byDimension,
    aiToolsSentiment,
    trend,
    dimensionTrend,
    participation: { timeline, bySegment: participationBySegment },
    segments: { threshold: ANONYMITY_THRESHOLD, byKind: segmentScores },
    benchmark: null,
  };
}

// ---------------------------------------------------------------------------
// DB loaders
// ---------------------------------------------------------------------------

/** Hydrate campaigns (with their template questions) for a set of campaign rows. */
async function attachQuestions(
  db: Db,
  rows: Array<{ id: number; title: string; periodMonth: string | null; status: string; templateId: number | null; recipientCount: number | null; openedAt: Date | null }>,
): Promise<CampaignWithQuestions[]> {
  const templateIds = [...new Set(rows.map((c) => c.templateId).filter((x): x is number => x != null))];
  const templates = templateIds.length
    ? (await db
        .select({ id: devexSurveyTemplates.id, questions: devexSurveyTemplates.questions })
        .from(devexSurveyTemplates)
        .where(inArray(devexSurveyTemplates.id, templateIds))) as Array<{ id: number; questions: SurveyQuestion[] }>
    : [];
  const questionsByTemplate = new Map(templates.map((t) => [t.id, t.questions ?? []]));
  return rows.map((c) => ({
    id: c.id,
    title: c.title,
    periodMonth: c.periodMonth,
    status: c.status,
    recipientCount: c.recipientCount,
    openedAt: c.openedAt,
    questions: (c.templateId != null ? questionsByTemplate.get(c.templateId) : undefined) ?? [],
  }));
}

/**
 * Cross-tenant DevEx benchmark: for every tenant, average each dimension (and the
 * overall index) over the benchmark window, then take the requested percentile of
 * those per-tenant averages. Aggregate-only — no tenant is identifiable. Pure
 * computation extracted so it is testable; {@link computeDevexBenchmark} loads.
 */
export function summarizeBenchmark(
  perTenant: Array<{ index: number; byDimension: Partial<Record<DevexDimension, number>> }>,
  percentile: BenchmarkPercentile,
  windowDays: number,
): DevexBenchmark {
  const indexVals = perTenant.map((t) => t.index).filter((n) => Number.isFinite(n));
  const dimVals = new Map<DevexDimension, number[]>();
  for (const t of perTenant) {
    for (const [d, v] of Object.entries(t.byDimension) as Array<[DevexDimension, number]>) {
      if (Number.isFinite(v)) bucket(dimVals, d, v);
    }
  }
  const byDimension: Partial<Record<DevexDimension, number>> = {};
  for (const [d, xs] of dimVals.entries()) {
    const p = percentileOf(xs, percentile);
    if (p != null) byDimension[d] = round1(p);
  }
  return {
    percentile,
    index: round1(percentileOf(indexVals, percentile) ?? 0),
    byDimension,
    companies: perTenant.length,
    windowDays,
  };
}

/** Load + compute the cross-tenant benchmark (expensive; cache at the call site). */
export async function computeDevexBenchmark(db: Db, percentile: BenchmarkPercentile): Promise<DevexBenchmark> {
  const since = new Date(Date.now() - BENCHMARK_WINDOW_DAYS * DAY_MS);

  const campaignRows = (await db
    .select({
      id: devexCampaigns.id,
      tenantId: devexCampaigns.tenantId,
      title: devexCampaigns.title,
      periodMonth: devexCampaigns.periodMonth,
      status: devexCampaigns.status,
      templateId: devexCampaigns.templateId,
      recipientCount: devexCampaigns.recipientCount,
      openedAt: devexCampaigns.openedAt,
    })
    .from(devexCampaigns)
    .where(gte(devexCampaigns.openedAt, since))) as Array<{
      id: number; tenantId: number; title: string; periodMonth: string | null; status: string;
      templateId: number | null; recipientCount: number | null; openedAt: Date | null;
    }>;
  if (!campaignRows.length) return summarizeBenchmark([], percentile, BENCHMARK_WINDOW_DAYS);

  const tenantByCampaign = new Map(campaignRows.map((c) => [c.id, c.tenantId]));
  const campaigns = await attachQuestions(db, campaignRows);
  const campaignsById = new Map(campaigns.map((c) => [c.id, c]));
  const campaignIds = campaignRows.map((c) => c.id);

  const responseRows = (await db
    .select({ campaignId: devexResponses.campaignId, answers: devexResponses.answers })
    .from(devexResponses)
    .where(inArray(devexResponses.campaignId, campaignIds))) as Array<{ campaignId: number; answers: AnswerMap }>;

  // Accumulate per-tenant per-dimension scores.
  const byTenant = new Map<number, { all: number[]; dim: Map<DevexDimension, number[]> }>();
  for (const r of responseRows) {
    const tenantId = tenantByCampaign.get(r.campaignId);
    const campaign = campaignsById.get(r.campaignId);
    if (tenantId == null || !campaign) continue;
    const qmap = new Map(campaign.questions.map((q) => [q.id, q]));
    const acc = byTenant.get(tenantId) ?? byTenant.set(tenantId, { all: [], dim: new Map() }).get(tenantId)!;
    for (const [qid, raw] of Object.entries(r.answers ?? {})) {
      const q = qmap.get(qid);
      if (!q) continue;
      const s = answerScore(q, raw);
      if (s == null) continue;
      acc.all.push(s);
      bucket(acc.dim, q.dimension, s);
    }
  }

  const perTenant = [...byTenant.values()]
    .filter((t) => t.all.length > 0)
    .map((t) => {
      const byDimension: Partial<Record<DevexDimension, number>> = {};
      for (const [d, xs] of t.dim.entries()) byDimension[d] = mean(xs);
      return { index: mean(t.all), byDimension };
    });

  return summarizeBenchmark(perTenant, percentile, BENCHMARK_WINDOW_DAYS);
}

/** Merge benchmark deltas into a computed insights payload (in place, then return). */
function applyBenchmark(insights: DevexInsights, benchmark: DevexBenchmark): DevexInsights {
  insights.benchmark = benchmark;
  insights.index.benchmarkDelta = round1(insights.index.score - benchmark.index);
  for (const d of insights.byDimension) {
    const b = benchmark.byDimension[d.dimension];
    d.benchmarkDelta = b == null ? null : round1(d.avgScore - b);
  }
  return insights;
}

/**
 * Load + summarize DevEx insights for a tenant over the last `days`, optionally
 * attaching cross-tenant benchmark deltas at `percentile`. The benchmark itself is
 * expensive (cross-tenant); callers that want it should pass a pre-loaded
 * `benchmark` (cached separately) — when omitted, no benchmark deltas are set.
 */
export async function computeDevexInsights(
  db: Db,
  tenantId: number,
  days: number,
  benchmark?: DevexBenchmark | null,
): Promise<DevexInsights> {
  const since = new Date(Date.now() - days * DAY_MS);

  const campaignRows = (await db
    .select({
      id: devexCampaigns.id,
      title: devexCampaigns.title,
      periodMonth: devexCampaigns.periodMonth,
      status: devexCampaigns.status,
      templateId: devexCampaigns.templateId,
      recipientCount: devexCampaigns.recipientCount,
      openedAt: devexCampaigns.openedAt,
    })
    .from(devexCampaigns)
    .where(and(eq(devexCampaigns.tenantId, tenantId), gte(devexCampaigns.openedAt, since)))) as Array<{
      id: number; title: string; periodMonth: string | null; status: string;
      templateId: number | null; recipientCount: number | null; openedAt: Date | null;
    }>;

  const campaigns = await attachQuestions(db, campaignRows);
  const campaignIds = campaignRows.map((c) => c.id);

  const responses: ResponseRow[] = campaignIds.length
    ? ((await db
        .select({
          campaignId: devexResponses.campaignId,
          answers: devexResponses.answers,
          segments: devexResponses.segments,
          submittedAt: devexResponses.submittedAt,
        })
        .from(devexResponses)
        .where(and(eq(devexResponses.tenantId, tenantId), inArray(devexResponses.campaignId, campaignIds)))) as Array<{
          campaignId: number; answers: AnswerMap; segments: DevexSegments; submittedAt: Date | null;
        }>)
    : [];

  const insights = summarizeDevex(campaigns, responses, days);
  return benchmark ? applyBenchmark(insights, benchmark) : insights;
}
