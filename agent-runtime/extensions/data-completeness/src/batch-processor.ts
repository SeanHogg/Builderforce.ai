/**
 * Batch Processing Support
 * Streaming-friendly processing for large datasets
 */

import type {
  FieldWeightConfig,
  PlaceholderConfig,
  ScoreThresholds,
  RecordScoreData,
  DatasetReport,
} from "./types.js";
import {
  calculateRecordScore,
  calculateDatasetReport,
  validateWeights,
  DEFAULT_THRESHOLDS,
} from "./scoring-engine.js";

/**
 * Streams scoring results for large record collections
 * Designed to avoid loading entire dataset into memory simultaneously
 */
export interface ScoredRecord {
  record: Record<string, unknown>;
  scoreData: RecordScoreData;
}

/**
 * Asynchronously score records incrementally
 * Returns async generator for each scored record
 */
export async function* batchScoreRecords(
  records: AsyncIterable<Record<string, unknown>>,
  fieldWeights: FieldWeightConfig,
  placeholders: string[],
  thresholds: ScoreThresholds = DEFAULT_THRESHOLDS
): AsyncGenerator<ScoredRecord> {
  const validatedWeights = validateWeights(fieldWeights);
  if (!validatedWeights) {
    throw new Error("Invalid field weights provided");
  }

  const placeholderSet = new Set<string>(
    placeholders.map((p) => String(p).toLowerCase().trim())
  );

  for await (const record of records) {
    if (typeof record !== "object" || record === null) {
      throw new Error("Each record must be a valid JSON object");
    }

    const scoreData = calculateRecordScore(
      record as Record<string, unknown>,
      fieldWeights,
      placeholderSet,
      thresholds
    );

    yield {
      record,
      scoreData,
    };
  }
}

/**
 * Collect metadata incrementally without storing full records
 * Useful when you only need aggregate statistics
 */
export class IncrementalMetricsCollector {
  private totalRecords = 0;
  private sumScores = 0;
  private minScore = Infinity;
  private maxScore = -Infinity;

  constructor(
    private fieldWeights: FieldWeightConfig,
    private placeholders: string[],
    private thresholds: ScoreThresholds = DEFAULT_THRESHOLDS
  ) {}

  /**
   * Process a single record and update metrics
   */
  processRecord(record: Record<string, unknown>): void {
    this.totalRecords++;

    // Compute score using a lightweight approach
    // We reuse the scoring logic but we don't need to return full metadata each time
    const placeholderSet = new Set<string>(
      this.placeholders.map((p) => String(p).toLowerCase().trim())
    );

    const scoreData = calculateRecordScore(record, this.fieldWeights, placeholderSet, this.thresholds);

    this.sumScores += scoreData.score;

    if (scoreData.score < this.minScore) {
      this.minScore = scoreData.score;
    }

    if (scoreData.score > this.maxScore) {
      this.maxScore = scoreData.score;
    }
  }

  /**
   * Finalize and return the aggregate dataset report
   */
  finalize(): DatasetReport {
    if (this.totalRecords === 0) {
      // Return zeros/min-infinity dummy report
      const dummy: DatasetReport = {
        overallScore: 0,
        minScore: 0,
        maxScore: 0,
        stdDev: 0,
        perFieldCompleteness: {},
        recordScores: [],
        summary: {
          criticalCount: 0,
          warningCount: 0,
          passingCount: 0,
          avgScore: 0,
        },
      };
      return dummy;
    }

    // Compute mean
    const mean = this.sumScores / this.totalRecords;

    // Std dev computed in final step
    const report = this.computeStdDevAndBuildReport(mean);

    return report;
  }

  private computeStdDevAndBuildReport(mean: number): DatasetReport {
    // We can't compute exact std dev without storing all scores
    // This is an approximation for the incremental collector
    const stdDev = 0; // Placeholder - full std dev requires storing all scores

    const report: DatasetReport = {
      overallScore: Math.round(mean * 100) / 100,
      minScore: this.minScore === Infinity ? 0 : this.minScore,
      maxScore: this.maxScore === -Infinity ? 0 : this.maxScore,
      stdDev,
      perFieldCompleteness: {},
      recordScores: [],
      summary: {
        criticalCount: 0,
        warningCount: 0,
        passingCount: 0,
        avgScore: mean,
      },
    };

    return report;
  }

  getStats() {
    return {
      totalRecords: this.totalRecords,
      sumScores: this.sumScores,
      minScore: this.minScore === Infinity ? 0 : this.minScore,
      maxScore: this.maxScore === -Infinity ? 0 : this.maxScore,
      avgScore: this.totalRecords > 0 ? (this.sumScores / this.totalRecords) : 0,
    };
  }
}
