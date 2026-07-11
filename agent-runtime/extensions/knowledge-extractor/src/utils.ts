/**
 * Utility functions for the Knowledge Extractor
 */

import { createHash } from 'node:crypto';

/**
 * Generates a deterministic learning ID based on run context and content.
 * Format: learning_<hash>
 */
export function createLearningId(runId: string, signalType: string, content: string): string {
  // Create a hash of runId + signalType + content
  const hash = createHash('sha256')
    .update(`${runId}||${signalType}||${content}`)
    .digest('hex')
    .slice(0, 8);
  return `learning_${hash}`;
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