/**
 * Utility functions for the Knowledge Extractor
 */

import { createHash } from "node:crypto";

/** The extractor's semantic version. Kept in sync with package.json. */
export const EXTRACTOR_VERSION = "2026.3.21";

/**
 * Generates a deterministic, globally-unique learning ID (FR-5.1).
 *
 * The ID is derived from `run_id + signal_type + content` via SHA-256, then
 * formatted as an RFC-4122-shaped UUID (version nibble forced to 4, variant
 * nibble forced to the 8/9/a/b range). Because it is a pure function of its
 * inputs, re-running extraction on the same run produces identical IDs — this
 * is what makes re-extraction idempotent (AC-10).
 */
export function createLearningId(runId: string, signalType: string, content: string): string {
  const hash = createHash("sha256")
    .update(`${runId}||${signalType}||${content}`)
    .digest("hex");

  // Build a UUID-shaped string from the first 32 hex chars of the digest.
  const hex = hash.slice(0, 32).split("");

  // Force version 4 nibble (index 12) and RFC-4122 variant nibble (index 16).
  hex[12] = "4";
  const variantNibble = parseInt(hex[16], 16);
  hex[16] = ((variantNibble & 0x3) | 0x8).toString(16);

  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/**
 * Gets the current extractor version (semver) (FR-5.3).
 * Stamped onto every record to enable schema migrations and cross-version
 * extraction-quality comparisons.
 */
export function getExtractorVersion(): string {
  return EXTRACTOR_VERSION;
}

/**
 * Returns current timestamp in ISO-8601 format.
 */
export function nowISO(): string {
  return new Date().toISOString();
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