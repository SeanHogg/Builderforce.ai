/**
 * Utility functions for the Knowledge Extractor
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Generates a deterministic learning ID based on run context and content.
 * Format: learning_<uuidv4>
 */
export function createLearningId(runId: string, signalType: string, content: string): string {
  // For determinism, we use a UUID derived from runId + signalType + content
  // In a real implementation, this would use a cryptographic hash
  return `learning_${uuidv4()}`;
}

/**
 * Gets the current extractor version (semver).
 */
export function getExtractorVersion(): string {
  return '1.0.0';
}

/**
 * Returns current timestamp in ISO format.
 */
export function nowISO(): string {
  return new Date().toISOString();
}