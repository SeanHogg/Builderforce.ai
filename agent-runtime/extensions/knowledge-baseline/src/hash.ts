/**
 * Knowledge Baseline — hashing + deterministic JSON utilities
 *
 * Used for content-addressing artifacts and computing the canonical
 * content hash of a snapshot. Everything is deterministic to guarantee
 * reproducibility (AC-02 / AC-06).
 */

import { createHash, randomUUID } from "node:crypto";

/**
 * Compute the SHA-256 digest of a byte array and return as a hex string.
 */
export function sha256Hex(data: Uint8Array | string): string {
  const hasher = createHash("sha256");
  if (data instanceof Uint8Array) {
    hasher.update(data);
  } else {
    hasher.update(data, "utf8");
  }
  return hasher.digest("hex");
}

/**
 * Compute a content-addressed artifact id from validated content.
 * Uses SHA-256 of the concatenation of source, type, mime, content length,
 * and the normalised UTF-8 content.
 */
export function computeArtifactId(
  source: string,
  type: string,
  mime: string,
  content: string,
): string {
  const payload = JSON.stringify({
    source,
    type,
    mime,
    size: content.length,
    content,
  });
  return sha256Hex(payload);
}

/**
 * Stringify a JSON-serializable value deterministically:
 *   - keys are sorted alphabetically
 *   - no trailing whitespace
 *   - 2-space indent for the canonical snapshot format
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(value, sortReplacer, 2);
}

function sortReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = (value as Record<string, unknown>)[k];
        return acc;
      }, {});
  }
  return value;
}

/**
 * Generate a fresh snapshot UUID.
 */
export function generateSnapshotUuid(): string {
  return randomUUID();
}
