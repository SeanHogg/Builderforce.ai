/**
 * Data Completeness Scoring Types
 */

export type RecordScoreData = {
  score: number;
  tier: TupleTier;
  missingFields: {
    name: string;
    weight: number;
  }[];
  topFieldGaps: {
    field: string;
    weight: number;
    impact: number;
  }[];
  rawData: object;
};

export type TupleTier = "critical" | "warning" | "passing";

export type ScoreThresholds = {
  critical: number;
  warning: number;
  passing: number;
};

export type FieldWeightConfig = Record<string, number>;

export type PlaceholderConfig = string[];

export type DatasetReport = {
  overallScore: number;
  minScore: number;
  maxScore: number;
  stdDev: number;
  perFieldCompleteness: Record<string, {
    totalCount: number;
    completedCount: number;
    completionRate: number;
  }>;
  recordScores: number[];
  summary: {
    criticalCount: number;
    warningCount: number;
    passingCount: number;
    avgScore: number;
  };
};

export type ScoringInput =
  | {
      record: Record<string, unknown>;
      fieldWeights?: FieldWeightConfig;
      placeholders?: PlaceholderConfig;
    }
  | {
      records: Record<string, unknown>[];
      fieldWeights?: FieldWeightConfig;
      placeholders?: PlaceholderConfig;
    };

export interface ScoreToolArguments {
  data: string;
  fieldWeightsJson?: string;
  placeholdersJson?: string;
  thresholdsJson?: string;
}