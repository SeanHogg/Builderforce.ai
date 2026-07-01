import { QualityMetric, RiskScoreConfig } from './config.js';

export type RiskLevel = 'High' | 'Medium' | 'Low';

export interface CalculatedScore {
  level: RiskLevel;
  score: number; // 0-100 approximate composite
  justification: string;
  metrics: Record<string, {
    value: number;
    weight: number;
    contribution: number;
  }>;
  rawScore: number;
}

export const RISK_LEVEL_BOUNDARIES = {
  HIGH: 70,
  MEDIUM: 40
};

function aggregatedScore(metrics: QualityMetric[]): number {
  if (metrics.length === 0) return 0;
  const totalWeight = metrics.reduce((sum, m) => sum + m.weight, 0);
  let weightedSum = 0;
  for (const metric of metrics) {
    // Normalize value 0-1 based on high threshold
    const normalized = clamp(metric.value, 0, metric.threshold.high);
    const rawContribution = (normalized / metric.weight) * metric.weight;
    weightedSum += rawContribution;
  }
  const score = (weightedSum / (totalWeight * metrics.length)) * 100;
  return clamp(score, 0, 100);
}

export const RISK_MESSAGES = {
  HIGH: (factors: { label: string; value: number }[]): string => {
    const topFactors = factors.slice(0, 3);
    if (topFactors.length === 0) return 'Critical quality concerns detected';
    const reasons = topFactors.map(f => `${f.label}: ${f.value}`).join(', ');
    return `High: ${reasons}`;
  },
  MEDIUM: (factors: { label: string; value: number }[]): string => {
    if (factors.length === 0) return 'Moderate quality concerns detected';
    return `Medium: ${factors.map(f => `${f.label}: ${f.value}`).join(', ')}`;
  },
  LOW: (factors: { label: string; value: number }[]): string => {
    return 'Quality posture meets baseline expectations';
  }
};

export function calculateScore(
  metrics: QualityMetric[],
  config: RiskScoreConfig
): CalculatedScore {
  if (metrics.length === 0) {
    return {
      level: 'Low',
      score: 0,
      justification: 'No quality metrics available for assessment',
      metrics: {},
      rawScore: 0
    };
  }

  const score = aggregatedScore(metrics);
  const level: RiskLevel = score >= RISK_LEVEL_BOUNDARIES.HIGH ? 'High' : 
                          score >= RISK_LEVEL_BOUNDARIES.MEDIUM ? 'Medium' : 'Low';
  
  // Identify top contributing factors for the explanation
  const contributingMetrics = metrics
    .map(m => ({
      label: m.name,
      value: m.value,
      weight: m.weight
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  return {
    level,
    score: Math.round(score),
    justification: RISK_MESSAGES[level](contributingMetrics),
    metrics: Object.fromEntries(
      metrics.map(m => [
        m.name,
        {
          value: m.value,
          weight: m.weight,
          contribution: ((m.value / m.threshold.high) * m.weight * 100).toFixed(1)
        }
      ])
    ),
    rawScore: Math.round(score)
  };
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}