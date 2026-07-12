/**
 * Scoring engine constants and rule defaults
 */

export const DEFAULT_THRESHOLD_CRITICAL = 50;
export const DEFAULT_THRESHOLD_WARNING = 50;
export const DEFAULT_THRESHOLD_PASSING = 80;

export const DEFAULT_PLACEHOLDERS = [
  "N/A",
  "n/a",
  "unknown",
  "Unknown",
  "NA",
  "na",
  "-",
  "NULL",
  "null",
  "",
  "  ",
];

export const MAX_BATCH_SIZE_RECOMMENDED = 100000;
export const BENCHMARK_TARGET_RPS = 16667; // 1M records in 60 seconds = 16667 RPS