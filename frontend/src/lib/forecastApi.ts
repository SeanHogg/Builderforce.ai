/**
 * Forecast lens client — thin wrapper over the shared authenticated `request`
 * helper (same pattern as insightsApi/roiApi in builderforceApi.ts). Talks to
 * /api/insights/forecast: the history + regression projection + z-score anomalies
 * for one metric, plus the dismiss/restore of an anomaly point.
 *
 * The endpoints are plan-gated (advancedInsights); on a miss `request` throws a
 * PlanLimitError which the ForecastPanel routes to <UpgradeGate>.
 */

import { request } from './builderforceApi';

export type ForecastMetric = 'cost' | 'cycle_time' | 'cfr' | 'throughput';
export type ForecastUnit = 'usd' | 'hours' | 'pct' | 'count';
export type ForecastCadence = 'daily' | 'weekly';

export interface ForecastPoint { day: string; value: number }
export interface ForecastAnomaly { day: string; value: number; z: number; acknowledged: boolean }

export interface ForecastInsights {
  metric: ForecastMetric;
  unit: ForecastUnit;
  cadence: ForecastCadence;
  history: ForecastPoint[];
  forecast: ForecastPoint[];
  anomalies: ForecastAnomaly[];
  slope: number;
  r2: number;
  projection: number;
}

export const forecastApi = {
  get: (metric: ForecastMetric, days = 90): Promise<ForecastInsights> =>
    request<ForecastInsights>(`/api/insights/forecast?metric=${metric}&days=${days}`),

  /** Dismiss an anomaly point so it stops surfacing on the panel. */
  ack: (metric: ForecastMetric, day: string, note?: string): Promise<{ acknowledged: boolean }> =>
    request(`/api/insights/forecast/ack`, { method: 'POST', body: JSON.stringify({ metric, day, note }) }),

  /** Restore a previously dismissed anomaly. */
  unack: (metric: ForecastMetric, day: string): Promise<{ acknowledged: boolean }> =>
    request(`/api/insights/forecast/ack?metric=${metric}&day=${encodeURIComponent(day)}`, { method: 'DELETE' }),
};
