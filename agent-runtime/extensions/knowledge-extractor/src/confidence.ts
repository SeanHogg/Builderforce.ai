/**
 * Confidence Scoring Engine (FR-6)
 * Computes final confidence scores for learning records using a weighted model.
 */

import type { LearningRecord, ExtractorConfig } from "./types.js";

export function calculateConfidence(
  record: LearningRecord,
  config: ExtractorConfig
): number {
  let score = 0;
  const weights = config.weightedScores || {
    signalType: 0.30,
    confidenceHint: 0.20,
    deltaMagnitude: 0.25,
    crossModeCorroboration: 0.25
  };

  // Signal type weight
  switch (record.signal_type) {
    case "EXPLICIT":
      score += weights.signalType * 0.65;
      break;
    case "IMPLICIT":
      score += weights.signalType * 0.50;
      break;
    case "BEHAVIORAL":
      score += weights.signalType * 0.35;
      break;
  }

  // Confidence hint (if present)
  if (record.confidence_score > 0 && record.confidence_score < 1) {
    score += weights.confidenceHint * record.confidence_score;
  }

  // Delta magnitude weight (for implicit records)
  if (record.change_type !== "BEHAVIORAL" && record.magnitude) {
    score += weights.deltaMagnitude * record.magnitude;
  }

  // Cross-mode corroboration (placeholder - would check knowledge store)
  // This would require a real implementation to check for duplicates
  // For now, we'll simulate it with a simple check
  if (record.signal_type === "IMPLICIT" && Math.random() > 0.5) {
    score += weights.crossModeCorroboration * 0.3;
  }

  // Clamp between 0 and 1
  return Math.max(0, Math.min(1, score));
}

/**
 * Determines if a record should be accepted, rejected, or marked as duplicate/conflict
 */
export function evaluateRecord(
  record: LearningRecord,
  config: ExtractorConfig
): LearningRecord & { status: LearningStatus } {
  const confidence = calculateConfidence(record, config);
  
  // FR-6.2: Reject if below accept threshold
  if (confidence < config.rejectThreshold) {
    return { ...record, status: "REJECTED" };
  }

  // FR-7.1: Check for duplicates (placeholder - would query knowledge store)
  // For now, we'll simulate it with a simple check
  if (Math.random() > 0.95) {
    return { ...record, status: "DUPLICATE" };
  }

  // FR-7.3: Check for conflicts (placeholder - would query knowledge store)
  if (Math.random() > 0.98) {
    return { ...record, status: "CONFLICT" };
  }

  return { ...record, status: "ACCEPTED" };
}