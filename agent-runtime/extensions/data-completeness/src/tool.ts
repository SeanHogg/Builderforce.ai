/**
 * Tool registration: score_data_completeness
 */

import type { ToolHandlerContext } from "@seanhogg/builderforce-agents/plugin-sdk";
import {
  calculateRecordScore,
  calculateDatasetReport,
  validateWeights,
  DEFAULT_PLACEHOLDERS,
  DEFAULT_THRESHOLD_CRITICAL,
  DEFAULT_THRESHOLD_WARNING,
  DEFAULT_THRESHOLD_PASSING,
} from "./scoring-engine.js";
import type {
  ScoreToolArguments,
  DatasetReport,
  RecordScoreData,
  FieldWeightConfig,
  PlaceholderConfig,
  ScoreThresholds,
} from "./types.js";
import { z } from "zod";

/**
 * JSON string parsing helpers with error handling
 */
function parseJsonSafe<T>(input: string | undefined, defaultValue: T): T {
  if (!input) {
    return defaultValue;
  }
  try {
    return JSON.parse(input) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Build tool handler for score_data_completeness
 */
export function createDataCompletenessTool() {
  return async (
    ctx: ToolHandlerContext<ScoreToolArguments>
  ): Promise<DatasetReport | RecordScoreData> => {
    const { data, fieldWeightsJson, placeholdersJson, thresholdsJson } =
      ctx.params;

    if (!data || typeof data !== "string") {
      throw new Error("Input 'data' must be a non-empty JSON string.");
    }

    let payload: Record<string, unknown> | Record<string, unknown>[];
    try {
      payload = JSON.parse(data);
    } catch (err) {
      throw new Error("Failed to parse input data as JSON: " + (err as Error).message);
    }

    // Normalize to array form for uniform processing
    const records = Array.isArray(payload) ? payload : ([payload] as Record<string, unknown>[]);

    // Parse configurations
    const fieldWeights: FieldWeightConfig = parseJsonSafe<FieldWeightConfig>(
      fieldWeightsJson,
      {}
    );
    const placeholders: PlaceholderConfig = parseJsonSafe<PlaceholderConfig>(
      placeholdersJson,
      [...DEFAULT_PLACEHOLDERS]
    );
    const thresholds: ScoreThresholds = parseJsonSafe<ScoreThresholds>(
      thresholdsJson,
      {
        critical: DEFAULT_THRESHOLD_CRITICAL,
        warning: DEFAULT_THRESHOLD_WARNING,
        passing: DEFAULT_THRESHOLD_PASSING,
      }
    );

    // Validate field weights
    if (!validateWeights(fieldWeights)) {
      throw new Error("Field weights must be finite, non-negative numbers.");
    }

    // Use a Set for placeholder lookup
    const placeholderSet = new Set<string>(
      placeholders.map((p) => String(p).toLowerCase().trim())
    );

    // Compute individual record scores
    const recordScores: RecordScoreData[] = [];
    for (const record of records) {
      if (typeof record !== "object" || record === null) {
        throw new Error("Each record in the array must be a valid JSON object.");
      }
      const scoreData = calculateRecordScore(
        record as Record<string, unknown>,
        fieldWeights,
        placeholderSet
      );
      recordScores.push(scoreData);
    }

    // Return single-record packaging when the original input was not an array
    if (!Array.isArray(payload)) {
      return recordScores[0];
    }

    // Otherwise return dataset-level aggregated report
    const datasetReport = calculateDatasetReport(
      recordScores,
      fieldWeights,
      thresholds
    );
    return datasetReport;
  };
}

/**
 * Define schema for score_data_completeness
 */
export function defineToolSchema() {
  return z
    .object({
      data: z.string().min(1),
      fieldWeightsJson: z.string().optional(),
      placeholdersJson: z.string().optional(),
      thresholdsJson: z.string().optional(),
    })
    .required("data");
}