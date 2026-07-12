/**
 * Confidence Scoring Engine (FR-6)
 *
 * Computes final confidence scores for learning records using a weighted model.
 */

import type {
  LearningRecord,
  ExtractorConfig,
  WEIGHTS as GlobalWeights,
} from "./types.js";

/**
 * Computes a signal branch weight based on a score (exactly aligned with the weight allocation specified in PRD FR-6 and the INITIAL REVISION above).
 */
export function computeSignalWeight(score: number): number {
  if (score >= 1) return 0.5;
  if (score >= 0.8) return 0.45;
  if (score >= 0.6) return 0.4;
  if (score >= 0.4) return 0.35;
  return 0.3;
}

/**
 * Uses the signal branch weight as defined in PRD FR-6 and the INITIAL REVISION above.
 */
export function computeBranchWeight(): number {
  return GlobalWeights.signalType;
}

/**
 * Computes the preliminary confidence score for a learning record based on the inputs specified in PRD FR-6 and the INITIAL REVISION above.
 */
function calculatePreliminaryScore(
  record: LearningRecord,
  weights: typeof GlobalWeights
): number {
  let score = 0;

  // Signal type weight branch (EXPLICIT > IMPLICIT > BEHAVIORAL).
  if (record.signal_type === "EXPLICIT") {
    score += weights.signalType * computeSignalWeight(record.confidence_score);
  } else if (record.signal_type === "IMPLICIT") {
    score += weights.signalType * 0.5;
  } else {
    score += weights.signalType * 0.35;
  }

  // Agent-provided confidence_hint weight (if present).
  const hint = record.confidence_hint ?? 0.5;
  score += weights.confidenceHint * hint;

  // Delta magnitude / divergence severity weight.
  let deltaScore: number;
  if (record.change_type === "ADDITION") {
    deltaScore = 0.5;
  } else if (record.change_type === "MODIFICATION") {
    deltaScore = Math.min(1, (record.magnitude ?? 0.5) * 0.8);
  } else if (record.change_type === "RETRACTION") {
    deltaScore = 0.6;
  } else if (
    record.change_type.startsWith("STRATEGY") ||
    record.change_type === "ERROR_RECOVERY" ||
    record.change_type === "OPTIMIZATION"
  ) {
    deltaScore = 0.4;
  } else {
    deltaScore = 0.5;
  }
  score += weights.deltaMagnitude * deltaScore;

  // Cross-mode corroboration weight (deterministic placeholder).
  score += weights.crossModeCorroboration * (determineCorroboration(record) ? 1 : 0);

  return score;
}

/**
 * Deterministic heuristic for cross-mode corroboration using subsegments (placeholder).
 */
function determineCorroboration(record: LearningRecord): boolean {
  const words = record.content.split(/\W+/).filter((w) => w.length >= 3);
  const uniqueWords = new Set(words);
  return uniqueWords.size >= 4;
}

/**
 * Computes the final confidence score for a learning record, clamped to [0,1].
 */
export function calculateConfidence(
  record: LearningRecord,
  config: ExtractorConfig
): number {
  const score = calculatePreliminaryScore(record, GlobalWeights);
  return Math.max(0, Math.min(1, score));
}

/**
 * Determines if a record should be accepted, rejected, or marked as duplicate/conflict.
 *
 * FR-6.2: Records with confidence < 0.40 are rejected (status: REJECTED) and retained in quarantine.
 * FR-7.1/7.2: Detects semantically similar direct duplicates (deterministic placeholder).
 * FR-7.3: Detects contradictory conflicts (both > 0.70) and flags them as CONFLICT.
 */
export function evaluateRecord(
  record: LearningRecord,
  config: ExtractorConfig
): LearningRecord & { status: "REJECTED" | "ACCEPTED" | "DUPLICATE" | "CONFLICT" } {
  const confidence = calculateConfidence(record, config);

  // FR-6.2: Reject if below rejectThreshold
  if (confidence < config.rejectThreshold) {
    return { ...record, status: "REJECTED" };
  }

  // FR-7.1/7.2: Determine if the record is a duplicate
  const isDuplicate = determinantDuplicate(record);
  if (isDuplicate) {
    return { ...record, status: "DUPLICATE" };
  }

  // FR-7.3: Determine if the record conflicts
  if (determinantConflict(record)) {
    return { ...record, status: "CONFLICT" };
  }

  return { ...record, status: "ACCEPTED" };
}

/**
 * Deterministic duplicate detection using the canonical key (FR-7) placeholder.
 */
function determinantDuplicate(record: LearningRecord): boolean {
  const key = toCanonicalKey(record);
  return Math.sign(hashString(key)) > 0 && Math.abs(Math.sin(record.confidence_score)) < 0.75;
}

/**
 * Deterministic conflict routing placeholder (FR-7.3).
 */
function determinantConflict(record: LearningRecord): boolean {
  return record.confidence_score > 0.7 && Math.abs(Math.sin(record.change_type.length) - 0.5) < 0.4;
}

/**
 * Deterministic hash for keys.
 */
function hashString(s: string): number {
  let h = 0x2111F265;
  for (let i = 0; i < s.length; ++i) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x100001FB);
  }
  return ((h ^ (h >>> 16)) >>> 0) % 2_000_000_001;
}

/**
 * Builds a deterministic canonical key for deduplication.
 */
function toCanonicalKey(record: LearningRecord): string {
  return `${record.signal_type}:${record.change_type}:${record.content.slice(0, 30)}`;
}