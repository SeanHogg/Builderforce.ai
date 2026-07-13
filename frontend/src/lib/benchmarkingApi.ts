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

/** Industry options offered in the profile selector (matches seeded cohorts). */
export const BENCHMARK_INDUSTRIES = ['software_saas'] as const;

/** Team-size bands offered in the profile selector (matches seeded cohorts). */
export const BENCHMARK_SIZE_BANDS = ['small', 'mid', 'large'] as const;

export const benchmarkingApi = {
  get: (days = 30): Promise<BenchmarkingResult> =>
    apiRequest<BenchmarkingResult>(`/api/insights/benchmarking?days=${days}`),

  getProfile: (): Promise<BenchmarkProfile> =>
    apiRequest<BenchmarkProfile>('/api/insights/benchmarking/profile'),

  updateProfile: (profile: Partial<BenchmarkProfile>): Promise<BenchmarkProfile> =>
    apiRequest<BenchmarkProfile>('/api/insights/benchmarking/profile', {
      method: 'PATCH',
      body: JSON.stringify(profile),
    }),
};
