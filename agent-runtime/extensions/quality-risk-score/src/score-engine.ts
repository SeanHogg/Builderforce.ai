import type { QualityMetric, RiskScoreConfig } from './config.js';

export type RiskLevel = 'High' | 'Medium' | 'Low';

export interface CalculatedScore {
  level: RiskLevel;
  score: number; // 0-100
  justification: string;
  metrics: Record<
    string,
    {
      value: number;
      weight: number;
      contribution: number;
    }
  >;
  rawScore: number;
}

export const RISK_LEVEL_BOUNDARIES = {
  HIGH: 70,
  MEDIUM: 40,
} as const;

/**
 * Normalise a metric value onto a 0..1 risk scale.
 *
 * For `higher_is_worse` metrics (e.g. open bugs) a higher value = more risk,
 * so the linear ratio value/high is correct.
 * For `higher_is_better` metrics (e.g. test coverage) a HIGHER value means
 * LESS risk, so we invert: 1 − (value/high).
 */
function metricRiskRatio(metric: QualityMetric): number {
  const ratio = clamp(metric.value / metric.threshold.high, 0, 1);
  return metric.direction === 'higher_is_better' ? 1 - ratio : ratio;
}

function aggregatedScore(metrics: QualityMetric[]): number {
  if (metrics.length === 0) return 0;
  const totalWeight = metrics.reduce((sum, m) => sum + m.weight, 0);
  if (totalWeight === 0) return 0;

  let weightedSum = 0;
  for (const metric of metrics) {
    const risk = metricRiskRatio(metric);
    weightedSum += risk * metric.weight;
  }

  // Scale: 100 × Σ(risk_i × weight_i) / Σ(weight_i)
  // Each risk_i is already 0..1, so the weighted average is 0..1.
  const score = (weightedSum / totalWeight) * 100;
  return clamp(score, 0, 100);
}

export const RISK_MESSAGES: Record<
  RiskLevel,
  (factors: { label: string; value: number }[]) => string
> = {
  High: (factors) => {
    const top = factors.slice(0, 3);
    if (top.length === 0) return 'Critical quality concerns detected';
    return `High: ${top.map((f) => `${f.label}: ${f.value}`).join(', ')}`;
  },
  Medium: (factors) => {
    if (factors.length === 0) return 'Moderate quality concerns detected';
    return `Medium: ${factors.map((f) => `${f.label}: ${f.value}`).join(', ')}`;
  },
  Low: () => 'Quality posture meets baseline expectations',
};

export function calculateScore(
  metrics: QualityMetric[],
  _config?: RiskScoreConfig,
): CalculatedScore {
  if (metrics.length === 0) {
    return {
      level: 'Low',
      score: 0,
      justification: 'No quality metrics available for assessment',
      metrics: {},
      rawScore: 0,
    };
  }

  const score = aggregatedScore(metrics);
  const level: RiskLevel =
    score >= RISK_LEVEL_BOUNDARIES.HIGH
      ? 'High'
      : score >= RISK_LEVEL_BOUNDARIES.MEDIUM
        ? 'Medium'
        : 'Low';

  // Sort by *risk contribution* descending so the justification
  // highlights the metrics that drove the score up the most.
  const contributingMetrics = metrics
    .map((m) => ({
      label: m.name,
      value: m.value,
      riskRatio: metricRiskRatio(m),
    }))
    .sort((a, b) => b.riskRatio - a.riskRatio)
    .slice(0, 5);

  const contributions: Record<
    string,
    { value: number; weight: number; contribution: number }
  > = {};
  const totalWeight = metrics.reduce((sum, m) => sum + m.weight, 0);
  for (const m of metrics) {
    const risk = metricRiskRatio(m);
    contributions[m.name] = {
      value: m.value,
      weight: m.weight,
      contribution:
        totalWeight > 0
          ? Math.round((risk * m.weight) / totalWeight * 100)
          : 0,
    };
  }

  return {
    level,
    score: Math.round(score),
    justification: RISK_MESSAGES[level](contributingMetrics),
    metrics: contributions,
    rawScore: Math.round(score),
  };
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}
