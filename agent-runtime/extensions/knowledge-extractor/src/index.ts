/**
 * Main Extraction Pipeline (FR-1)
 * Orchestrates all three modes, applies confidence scoring, and produces the final report
 */

import type {
  RunContext,
  LearningRecord,
  ExtractionReport,
  ExtractorConfig,
} from "./types.js";

import {
  extractExplicit,
  extractImplicit,
  extractBehavioral,
  calculateConfidence,
  evaluateRecord,
} from "./";

export function runExtraction(
  ctx: RunContext,
  config: ExtractorConfig = DEFAULT_EXTRACTOR_CONFIG
): ExtractionReport {
  const startTime = Date.now();
  const records: LearningRecord[] = [];

  // FR-1.1: Run all three modes
  records.push(...extractExplicit(ctx, config));
  records.push(...extractImplicit(ctx, config));
  records.push(...extractBehavioral(ctx, config));

  // FR-6: Apply confidence scoring and evaluation
  const scoredRecords = records.map(record => {
    const confidence = calculateConfidence(record, config);
    return evaluateRecord({ ...record, confidence_score: confidence }, config);
  });

  // FR-8.1: Persist accepted records (placeholder - would call knowledge store API)
  const acceptedRecords = scoredRecords.filter(r => r.status === "ACCEPTED");

  // FR-8.3: Log all records to audit log (placeholder - would append to file)
  // FR-8.2: Generate report
  const report: ExtractionReport = {
    run_id: ctx.run_id,
    task_id: ctx.task_id,
    agent_id: ctx.agent_id,
    counts_by_mode: {
      EXPLICIT: scoredRecords.filter(r => r.signal_type === "EXPLICIT").length,
      IMPLICIT: scoredRecords.filter(r => r.signal_type === "IMPLICIT").length,
      BEHAVIORAL: scoredRecords.filter(r => r.signal_type === "BEHAVIORAL").length,
    },
    counts_by_status: {
      CANDIDATE: scoredRecords.filter(r => r.status === "CANDIDATE").length,
      ACCEPTED: acceptedRecords.length,
      REJECTED: scoredRecords.filter(r => r.status === "REJECTED").length,
      DUPLICATE: scoredRecords.filter(r => r.status === "DUPLICATE").length,
      CONFLICT: scoredRecords.filter(r => r.status === "CONFLICT").length,
    },
    confidence_distribution: computeDistribution(
      scoredRecords.map(r => r.confidence_score)
    ),
    warnings: [] as ExtractionWarning[],
    extraction_duration_ms: Date.now() - startTime,
    timed_out: (Date.now() - startTime) > config.timeoutMs,
  };

  // FR-1.3: Handle timeout
  if (report.timed_out) {
    report.warnings.push("TIMEOUT");
  }

  return report;
}

/**
 * Compute basic distribution statistics over a numeric array.
 * Returns zeros for an empty input so downstream reports stay well-formed.
 */
export function computeDistribution(values: number[]): {
  min: number;
  max: number;
  mean: number;
  median: number;
} {
  if (values.length === 0) {
    return { min: 0, max: 0, mean: 0, median: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
    median,
  };
}