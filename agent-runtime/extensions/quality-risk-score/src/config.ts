export interface QualityMetric {
  name: string;
  value: number;
  weight: number;
  threshold: {
    low: number;
    medium: number;
    high: number;
  };
}

export interface RiskScoreConfig {
  metrics: QualityMetric[];
  overrideAllowed: boolean;
  reevaluationInterval: number; // in minutes
}

export const DEFAULT_CONFIG: RiskScoreConfig = {
  metrics: [],
  overrideAllowed: true,
  reevaluationInterval: 5
};