import { apiRequest } from './apiClient';

/**
 * The fixed agent benchmark — the same task set scored the same way over time.
 *
 * Server counterpart: the `/benchmark` routes on `api/src/presentation/routes/evalRoutes.ts`.
 * Distinct from `/insights/benchmarking`, which compares a workspace to its
 * INDUSTRY; this one compares this workspace's agents to their own past.
 */

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

export interface BenchmarkPoint {
  caseId: string;
  /** The evaluator's judgement of the answer, 0–1. */
  score: number;
  /** Fraction of the case's stated expectations the answer contained, 0–1. */
  coverage: number;
  passed: boolean;
  model: string | null;
  cloudAgentRef: string | null;
  at: string;
}

export interface BenchmarkSummary {
  attempts: number;
  passRate: number;
  meanScore: number;
  meanCoverage: number;
  /** Older half's mean score minus the newer half's — positive is a regression. */
  regression: number;
}

export interface BenchmarkReport {
  windowDays: number;
  cases: BenchmarkCase[];
  points: BenchmarkPoint[];
  summary: BenchmarkSummary;
}

export interface BenchmarkCaseInput {
  slug: string;
  name: string;
  prompt: string;
  expectations?: string[];
  category?: string;
  projectId?: number | null;
  enabled?: boolean;
}

export const agentBenchmarkApi = {
  report: (windowDays = 30): Promise<BenchmarkReport> =>
    apiRequest(`/api/eval/benchmark?windowDays=${windowDays}`),

  /** Author or revise a case. Revising resets what its series measures. */
  upsertCase: (input: BenchmarkCaseInput): Promise<{ ok: boolean }> =>
    apiRequest('/api/eval/benchmark/cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
};
