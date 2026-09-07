/**
 * The fixed agent benchmark: the same task set, scored the same way, over time.
 *
 * `semanticEval`, `driftMonitor` and the variant promotion gate all score whatever
 * traffic arrived, so "did agent quality improve this month" has never had an answer
 * that was not confounded by which tickets came in. A benchmark case pins the task;
 * running the set on a schedule turns quality into a series rather than an anecdote.
 *
 * Two numbers per attempt, deliberately kept apart:
 *   - `coverage` — did the answer contain what the case says it must? Mechanical.
 *   - `score`    — the shared evaluator's judgement of the answer against the task.
 * A drop in one and not the other is diagnostic: coverage falling alone usually means
 * the rubric drifted from the product; score falling alone means the model got worse.
 */

import { and, desc, eq, gte } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { agentBenchmarkCases, agentBenchmarkResults } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { evaluateResponse, type EvalJudge } from './semanticEval';

export interface BenchmarkCase {
  id: string;
  slug: string;
  name: string;
  prompt: string;
  expectations: string[];
  category: string;
  projectId: number | null;
  enabled: boolean;
}

export interface BenchmarkAttempt {
  caseId: string;
  score: number;
  coverage: number;
  passed: boolean;
  answer: string;
  durationMs: number;
  model?: string | null;
  cloudAgentRef?: string | null;
  executionId?: number | null;
}

/** Coverage and score a case must both clear to count as a pass. */
export const BENCHMARK_PASS_FLOOR = 0.6;

/** Parse the stored JSON expectations, tolerating a malformed row. */
export function parseExpectations(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Fraction of a case's expectations present in the answer, case-insensitively. A
 * case with no expectations scores 1: it is asserting nothing, so it cannot fail
 * this half — the evaluator alone judges it.
 */
export function expectationCoverage(answer: string, expectations: readonly string[]): number {
  if (expectations.length === 0) return 1;
  const haystack = answer.toLowerCase();
  const hits = expectations.filter((e) => haystack.includes(e.trim().toLowerCase())).length;
  return hits / expectations.length;
}

/** The workspace's benchmark set. `enabledOnly` is what a scheduled run uses. */
export async function listCases(db: Db, tenantId: number, enabledOnly = false): Promise<BenchmarkCase[]> {
  const rows = await db
    .select()
    .from(agentBenchmarkCases)
    .where(scopedToTenant(agentBenchmarkCases, tenantId, enabledOnly ? eq(agentBenchmarkCases.enabled, true) : undefined))
    .orderBy(desc(agentBenchmarkCases.updatedAt))
    .limit(100);
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    prompt: row.prompt,
    expectations: parseExpectations(row.expectations),
    category: row.category,
    projectId: row.projectId,
    enabled: row.enabled,
  }));
}

/**
 * Score one answer against one case. Pure apart from the optional judge, so the
 * scoring rule is testable without a model: with no judge the shared evaluator
 * falls back to its lexical method, which is deterministic.
 */
export async function scoreAnswer(
  benchmarkCase: BenchmarkCase,
  answer: string,
  opts: { judge?: EvalJudge } = {},
): Promise<{ score: number; coverage: number; passed: boolean }> {
  const coverage = expectationCoverage(answer, benchmarkCase.expectations);
  const evaluated = await evaluateResponse(
    { question: benchmarkCase.prompt, answer, context: benchmarkCase.expectations.join('\n') },
    opts.judge ? { judge: opts.judge } : {},
  );
  const score = evaluated.overall;
  return { score, coverage, passed: score >= BENCHMARK_PASS_FLOOR && coverage >= BENCHMARK_PASS_FLOOR };
}

/** Persist one attempt. The regression series is these rows over time. */
export async function recordAttempt(db: Db, tenantId: number, attempt: BenchmarkAttempt): Promise<void> {
  await db.insert(agentBenchmarkResults).values({
    tenantId,
    caseId: attempt.caseId,
    cloudAgentRef: attempt.cloudAgentRef ?? null,
    model: attempt.model ?? null,
    executionId: attempt.executionId ?? null,
    score: attempt.score,
    coverage: attempt.coverage,
    passed: attempt.passed,
    answer: attempt.answer.slice(0, 4_000),
    durationMs: attempt.durationMs,
  });
}

export interface BenchmarkTrendPoint {
  caseId: string;
  score: number;
  coverage: number;
  passed: boolean;
  model: string | null;
  cloudAgentRef: string | null;
  at: string;
}

/** Attempts since `since`, oldest first — the series a chart plots. */
export async function benchmarkTrend(db: Db, tenantId: number, since: Date): Promise<BenchmarkTrendPoint[]> {
  const rows = await db
    .select({
      caseId: agentBenchmarkResults.caseId,
      score: agentBenchmarkResults.score,
      coverage: agentBenchmarkResults.coverage,
      passed: agentBenchmarkResults.passed,
      model: agentBenchmarkResults.model,
      cloudAgentRef: agentBenchmarkResults.cloudAgentRef,
      createdAt: agentBenchmarkResults.createdAt,
    })
    .from(agentBenchmarkResults)
    .where(scopedToTenant(agentBenchmarkResults, tenantId, gte(agentBenchmarkResults.createdAt, since)))
    .orderBy(agentBenchmarkResults.createdAt)
    .limit(1_000);
  return rows.map((r) => ({
    caseId: r.caseId,
    score: r.score,
    coverage: r.coverage,
    passed: r.passed,
    model: r.model,
    cloudAgentRef: r.cloudAgentRef,
    at: new Date(r.createdAt).toISOString(),
  }));
}

export interface BenchmarkSummary {
  attempts: number;
  passRate: number;
  meanScore: number;
  meanCoverage: number;
  /** Mean score of the older half minus the newer half — positive means a regression. */
  regression: number;
}

/**
 * Summarise a series. The regression figure compares the two halves of the window
 * rather than the last two points, so one bad afternoon does not read as a trend.
 * Pure, so the arithmetic behind a red number on a dashboard is testable.
 */
export function summarizeTrend(points: readonly BenchmarkTrendPoint[]): BenchmarkSummary {
  if (points.length === 0) return { attempts: 0, passRate: 0, meanScore: 0, meanCoverage: 0, regression: 0 };
  const mean = (values: readonly number[]): number =>
    values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
  const scores = points.map((p) => p.score);
  const half = Math.floor(points.length / 2);
  const older = scores.slice(0, half);
  const newer = scores.slice(half);
  return {
    attempts: points.length,
    passRate: points.filter((p) => p.passed).length / points.length,
    meanScore: mean(scores),
    meanCoverage: mean(points.map((p) => p.coverage)),
    regression: half === 0 ? 0 : mean(older) - mean(newer),
  };
}

/** Add or revise a case. Revising resets what the series means, so it is explicit. */
export async function upsertCase(
  db: Db,
  tenantId: number,
  input: { slug: string; name: string; prompt: string; expectations?: string[]; category?: string; projectId?: number | null; enabled?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const slug = input.slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 255);
  if (!slug || !input.name.trim() || !input.prompt.trim()) {
    return { ok: false, error: 'slug, name and prompt are required' };
  }
  const values = {
    tenantId,
    projectId: input.projectId ?? null,
    slug,
    name: input.name.trim().slice(0, 255),
    prompt: input.prompt.trim(),
    expectations: JSON.stringify(input.expectations ?? []),
    category: (input.category ?? 'general').slice(0, 64),
    enabled: input.enabled ?? true,
    updatedAt: new Date(),
  };
  const [existing] = await db
    .select({ id: agentBenchmarkCases.id })
    .from(agentBenchmarkCases)
    .where(scopedToTenant(agentBenchmarkCases, tenantId, eq(agentBenchmarkCases.slug, slug)))
    .limit(1);
  if (existing) {
    await db
      .update(agentBenchmarkCases)
      .set(values)
      .where(and(eq(agentBenchmarkCases.tenantId, tenantId), eq(agentBenchmarkCases.id, existing.id)));
    return { ok: true };
  }
  await db.insert(agentBenchmarkCases).values(values);
  return { ok: true };
}
