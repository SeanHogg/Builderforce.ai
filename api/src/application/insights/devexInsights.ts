/**
 * DevEx insights — the rollup behind the "DevEx Surveys & Insights" lens and the
 * "AI DevEx Analysis" feature (gate insights.devex).
 *
 * Reads the survey-framework tables (devex_campaigns / devex_responses, joined to
 * their templates for question→dimension tagging) and produces:
 *   - response rate (responses ÷ open-campaign reach, approximated by campaigns),
 *   - eNPS (%promoters − %detractors over nps-tagged questions),
 *   - per-dimension average score normalized 0..100,
 *   - a focused AI-tools sentiment cut (questions tagged `ai_tools`),
 *   - a per-period trend across campaigns.
 *
 * The aggregation ({@link summarizeDevex}) is a pure function over already-fetched
 * rows so it is unit-testable without a DB; the route caches it.
 */

import { and, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  devexCampaigns, devexResponses, devexSurveyTemplates,
  type SurveyQuestion, type DevexDimension, type AnswerMap,
} from '../devex/devexSurveys';

const HOUR_MS = 3_600_000;

/** A campaign row + its template's questions, as the collector needs it. */
export interface CampaignWithQuestions {
  id: number;
  title: string;
  periodMonth: string | null;
  status: string;
  questions: SurveyQuestion[];
}

/** A response row as the collector needs it. */
export interface ResponseRow {
  campaignId: number;
  answers: AnswerMap;
}

export interface DimensionScore {
  dimension: DevexDimension;
  avgScore: number; // 0..100
  n: number;        // answered datapoints feeding the score
}

export interface TrendPoint {
  periodMonth: string;
  avgScore: number; // 0..100 across all scored answers in the period
  enps: number;     // -100..100
  responses: number;
}

export interface DevexInsights {
  windowDays: number;
  responseRatePct: number;
  totalResponses: number;
  enps: number; // -100..100
  byDimension: DimensionScore[];
  aiToolsSentiment: { avgScore: number; n: number; positivePct: number };
  trend: TrendPoint[];
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

/** eNPS over a list of raw NPS scores (0..10): %promoters(9-10) − %detractors(0-6). */
function enpsOf(npsScores: number[]): number {
  if (!npsScores.length) return 0;
  const promoters = npsScores.filter((s) => s >= 9).length;
  const detractors = npsScores.filter((s) => s <= 6).length;
  return ((promoters - detractors) / npsScores.length) * 100;
}

/**
 * Pure: turn campaign+question rows and response rows into the DevEx rollup.
 * Response rate approximates reach by the number of campaigns covered (one
 * pulse per campaign expected per respondent) — without a roster table we use
 * responses ÷ (campaigns × 1) capped at 100% as an honest proxy; when there is
 * exactly one campaign it equals the raw response count's saturation.
 */
export function summarizeDevex(
  campaigns: CampaignWithQuestions[],
  responses: ResponseRow[],
  windowDays: number,
): DevexInsights {
  const questionsByCampaign = new Map<number, Map<string, SurveyQuestion>>();
  const periodByCampaign = new Map<number, string>();
  for (const c of campaigns) {
    questionsByCampaign.set(c.id, new Map(c.questions.map((q) => [q.id, q])));
    if (c.periodMonth) periodByCampaign.set(c.id, c.periodMonth);
  }

  // Per-dimension scored datapoints, global nps pool, ai-tools pool, per-period pools.
  const dimScores = new Map<DevexDimension, number[]>();
  const npsScores: number[] = [];
  const aiScores: number[] = [];
  const periodScores = new Map<string, number[]>();
  const periodNps = new Map<string, number[]>();
  const periodResponses = new Map<string, number>();

  for (const r of responses) {
    const qmap = questionsByCampaign.get(r.campaignId);
    const period = periodByCampaign.get(r.campaignId) ?? '—';
    periodResponses.set(period, (periodResponses.get(period) ?? 0) + 1);
    if (!qmap) continue;

    for (const [qid, raw] of Object.entries(r.answers ?? {})) {
      const q = qmap.get(qid);
      if (!q) continue;

      if (q.type === 'nps') {
        const n = Number(raw);
        if (Number.isFinite(n)) {
          npsScores.push(n);
          (periodNps.get(period) ?? periodNps.set(period, []).get(period)!).push(n);
        }
      }

      const s = answerScore(q, raw);
      if (s == null) continue;

      (dimScores.get(q.dimension) ?? dimScores.set(q.dimension, []).get(q.dimension)!).push(s);
      (periodScores.get(period) ?? periodScores.set(period, []).get(period)!).push(s);
      if (q.dimension === 'ai_tools') aiScores.push(s);
    }
  }

  const byDimension: DimensionScore[] = [...dimScores.entries()]
    .map(([dimension, xs]) => ({ dimension, avgScore: Math.round(mean(xs) * 10) / 10, n: xs.length }))
    .sort((a, b) => b.n - a.n);

  const aiPositive = aiScores.filter((s) => s >= 60).length;
  const aiToolsSentiment = {
    avgScore: Math.round(mean(aiScores) * 10) / 10,
    n: aiScores.length,
    positivePct: aiScores.length ? Math.round((aiPositive / aiScores.length) * 1000) / 10 : 0,
  };

  const trend: TrendPoint[] = [...new Set([...periodResponses.keys()])]
    .filter((p) => p !== '—')
    .sort()
    .map((p) => ({
      periodMonth: p,
      avgScore: Math.round(mean(periodScores.get(p) ?? []) * 10) / 10,
      enps: Math.round(enpsOf(periodNps.get(p) ?? []) * 10) / 10,
      responses: periodResponses.get(p) ?? 0,
    }));

  const totalResponses = responses.length;
  const campaignCount = Math.max(1, campaigns.length);
  const responseRatePct = Math.min(100, Math.round((totalResponses / campaignCount) * 10) / 10);

  return {
    windowDays,
    responseRatePct,
    totalResponses,
    enps: Math.round(enpsOf(npsScores) * 10) / 10,
    byDimension,
    aiToolsSentiment,
    trend,
  };
}

/** Load + summarize DevEx insights for a tenant over the last `days`. */
export async function computeDevexInsights(db: Db, tenantId: number, days: number): Promise<DevexInsights> {
  const since = new Date(Date.now() - days * 24 * HOUR_MS);

  // Campaigns reference templates for their questions — fetch the in-window
  // campaigns with their template link, then load those templates' questions.
  // (A campaign whose template was deleted (template_id NULL) simply has no
  // questions and contributes only to response counts / response rate.)
  const campaignRows = (await db
    .select({
      id: devexCampaigns.id,
      title: devexCampaigns.title,
      periodMonth: devexCampaigns.periodMonth,
      status: devexCampaigns.status,
      templateId: devexCampaigns.templateId,
    })
    .from(devexCampaigns)
    .where(and(eq(devexCampaigns.tenantId, tenantId), gte(devexCampaigns.openedAt, since)))) as Array<{
      id: number; title: string; periodMonth: string | null; status: string; templateId: number | null;
    }>;

  const campaignIds = campaignRows.map((c) => c.id);
  const templateIds = [...new Set(campaignRows.map((c) => c.templateId).filter((x): x is number => x != null))];
  const templates = templateIds.length
    ? (await db
        .select({ id: devexSurveyTemplates.id, questions: devexSurveyTemplates.questions })
        .from(devexSurveyTemplates)
        .where(inArray(devexSurveyTemplates.id, templateIds))) as Array<{ id: number; questions: SurveyQuestion[] }>
    : [];
  const questionsByTemplate = new Map(templates.map((t) => [t.id, t.questions ?? []]));

  const campaigns: CampaignWithQuestions[] = campaignRows.map((c) => ({
    id: c.id,
    title: c.title,
    periodMonth: c.periodMonth,
    status: c.status,
    questions: (c.templateId != null ? questionsByTemplate.get(c.templateId) : undefined) ?? [],
  }));

  const responses: ResponseRow[] = campaignIds.length
    ? ((await db
        .select({ campaignId: devexResponses.campaignId, answers: devexResponses.answers })
        .from(devexResponses)
        .where(and(eq(devexResponses.tenantId, tenantId), inArray(devexResponses.campaignId, campaignIds)))) as Array<{
          campaignId: number; answers: AnswerMap;
        }>)
    : [];

  return summarizeDevex(campaigns, responses, days);
}
