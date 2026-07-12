/**
 * Score Calculator
 * Calculates completeness scores for records and datasets
 */

import type {
  RecordScoreData,
  TupleTier,
  ScoreThresholds,
  DatasetReport,
  FieldWeightConfig,
  PlaceholderConfig,
} from "./types.js";

/**
 * Checks if a value is considered present (not missing/empty/placeholder)
 */
export function isValuePresent(
  value: unknown,
  placeholders: Set<string>
): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    // Empty or whitespace-only strings
    if (trimmed === "" || /^\s*$/.test(trimmed)) {
      return false;
    }
    // Check against placeholder list
    if (placeholders.has(trimmed.toLowerCase())) {
      return false;
    }
  }

  // Non-null/non-empty values are considered present
  return true;
}

/**
 * Calculates per-record completeness score
 * Formula: score = (Σ weight_i × present_i) / (Σ weight_i) × 100
 */
export function calculateRecordScore(
  record: Record<string, unknown>,
  fieldWeights: FieldWeightConfig,
  placeholders: Set<string>
): RecordScoreData {
  let totalWeight = 0;
  let presentWeightSum = 0;
  const missingFields: { name: string; weight: number }[] = [];
  const topFieldGaps: { field: string; weight: number; impact: number }[] = [];

  for (const [fieldName, weight] of Object.entries(fieldWeights)) {
    const weightNum = Number(weight);
    if (weightNum <= 0) {
      // Skip fields with zero weight
      continue;
    }

    totalWeight += weightNum;

    const value = record[fieldName];
    const isPresent = isValuePresent(value, placeholders);
    let impact = 0;

    if (!isPresent) {
      missingFields.push({ name: fieldName, weight: weightNum });
      impact = weightNum; // Impact is the weight contributed when missing
    } else {
      presentWeightSum += weightNum;
    }

    // Track fields that most impact score reduction
    topFieldGaps.push({ field: fieldName, weight: weightNum, impact });
  }

  // Sort gaps by impact descending for ranking
  topFieldGaps.sort((a, b) => b.impact - a.impact);

  let score = 100;
  if (totalWeight > 0) {
    score = (presentWeightSum / totalWeight) * 100;
  }

  // Round to 2 decimal places
  score = Math.round(score * 100) / 100;

  return {
    score,
    tier: getTier(score, thresholds),
    missingFields,
    topFieldGaps,
    rawData: record,
  };
}

/**
 * Computes aggregate dataset metrics from individual record scores
 */
export function calculateDatasetReport(
  recordScores: RecordScoreData[],
  fieldWeights: FieldWeightConfig,
  thresholds: ScoreThresholds
): DatasetReport {
  const scores = recordScores.map((s) => s.score);

  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);

  // Arithmetic mean
  const sum = scores.reduce((acc, s) => acc + s, 0);
  const avgScore = Math.round(sum / scores.length * 100) / 100;

  // Standard deviation
  const variance = scores.reduce((acc, s) => acc + Math.pow(s - avgScore, 2), 0) / scores.length;
  const stdDev = Math.sqrt(variance);
  const roundedStdDev = Math.round(stdDev * 1000) / 1000;

  // Per-field completeness rates
  const totalRecords = recordScores.length;
  const fieldTotals: Record<string, { completed: number; total: number }> = {};

  for (const record of recordScores.map((r) => r.rawData)) {
    for (const fieldName of Object.keys(fieldWeights)) {
      if (!fieldTotals[fieldName]) {
        fieldTotals[fieldName] = { completed: 0, total: 0 };
      }
      fieldTotals[fieldName].total++;
      // Check if field is present in individual record
      const value = record[fieldName];
      if (isValuePresent(value, new Set<string>())) {
        fieldTotals[fieldName].completed++;
      }
    }
  }

  const perFieldCompleteness: Record<string, {
    totalCount: number;
    completedCount: number;
    completionRate: number;
  }> = {};

  for (const [fieldName, totals] of Object.entries(fieldTotals)) {
    const rate = totals.completed / totals.total;
    perFieldCompleteness[fieldName] = {
      totalCount: totals.total,
      completedCount: totals.completed,
      completionRate: Math.round(rate * 1000) / 10, // ±0.1%
    };
  }

  // Summary statistics
  const summary = {
    criticalCount: 0,
    warningCount: 0,
    passingCount: 0,
    avgScore,
  };

  for (const s of scores) {
    if (s < thresholds.critical) {
      summary.criticalCount++;
    } else if (s < thresholds.warning) {
      summary.warningCount++;
    } else {
      summary.passingCount++;
    }
  }

  // Round overall score to match AC-6 tolerance
  const roundedOverallScore = Math.round(avgScore * 100) / 100;

  return {
    overallScore: roundedOverallScore,
    minScore,
    maxScore,
    stdDev: roundedStdDev,
    perFieldCompleteness,
    recordScores,
    summary,
  };
}

/**
 * Categorizes a score into its tier based on thresholds
 */
export function getTier(
  score: number,
  thresholds: ScoreThresholds
): TupleTier {
  if (score < thresholds.critical) {
    return "critical";
  } else if (score < thresholds.warning) {
    return "warning";
  }
  return "passing";
}

/**
 * Validates field weights - rejects negative/NaN
 */
export function validateWeights(weights: FieldWeightConfig): boolean {
  for (const weight of Object.values(weights)) {
    const num = Number(weight);
    if (isNaN(num) || !Number.isFinite(num) || num < 0) {
      return false;
    }
  }
  return true;
}