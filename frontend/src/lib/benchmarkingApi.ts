/**
 * Industry Benchmarking API client — /api/insights/benchmarking*.
 *
 * Reads the tenant's percentile ranking vs a seeded industry/size-band cohort and
 * reads/updates the tenant's benchmark profile (industry + size band).
 */
import { apiRequest } from './apiClient';

export type BenchmarkRating = 'elite' | 'high' | 'medium' | 'low';

export interface BenchmarkMetric {
  metric: string;
  label: string;
  unit: string | null;
  value: number | null;
  percentile: number | null;
  rating: BenchmarkRating | null;
  p50: number | null;
  p90: number | null;
  higherIsBetter: boolean;
}

export interface BenchmarkingResult {
  industry: string;
  sizeBand: string;
  windowDays: number;
  metrics: BenchmarkMetric[];
}

export interface BenchmarkProfile {
  industry: string;
  sizeBand: string;
}

/**
 * The cohorts a tenant may select.
 *
 * SERVER-DERIVED, from the seeded `industry_benchmarks` rows. It was a hardcoded
 * `['software_saas']`, which had to be edited in lockstep with every cohort
 * migration — and was not: 0930 seeded five more industries that this list would
 * still have hidden. A constant here can also drift the other way and offer a
 * cohort with no distribution, after which every metric ranks against nothing.
 * The rows are the single source; this is a projection of them.
 */
export interface BenchmarkCohorts {
  industries: string[];
  sizeBands: string[];
}

export const benchmarkingApi = {
  get: (days = 30, projectId?: number | null): Promise<BenchmarkingResult> =>
    apiRequest<BenchmarkingResult>(`/api/insights/benchmarking?days=${days}${projectId != null ? `&projectId=${projectId}` : ''}`),

  /** The selectable cohorts, derived from the seeded distributions. */
  cohorts: (): Promise<BenchmarkCohorts> =>
    apiRequest<BenchmarkCohorts>('/api/insights/benchmarking/cohorts'),

  getProfile: (): Promise<BenchmarkProfile> =>
    apiRequest<BenchmarkProfile>('/api/insights/benchmarking/profile'),

  updateProfile: (profile: Partial<BenchmarkProfile>): Promise<BenchmarkProfile> =>
    apiRequest<BenchmarkProfile>('/api/insights/benchmarking/profile', {
      method: 'PATCH',
      body: JSON.stringify(profile),
    }),
};
