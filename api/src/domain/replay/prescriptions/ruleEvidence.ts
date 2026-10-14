/**
 * The evidence helpers every prescription rule family shares (`rules.ts`,
 * `salesRules.ts`) and the vision review's subject key: a finding carries at
 * most `EVIDENCE_MAX` representative recordings, and a finding with no natural
 * id is keyed by a stable hash of its text. Pure.
 */

import type { Finding } from './types';

export const EVIDENCE_MAX = 3;

/** The first `EVIDENCE_MAX` recordings as a finding's evidence, from their start. */
export const evidenceOf = (ids: readonly string[]): Finding['evidence'] =>
  ids.slice(0, EVIDENCE_MAX).map((recordingId) => ({ recordingId, atMs: 0 }));

/** A short stable hash (djb2, hex) — a subject key for a finding with no natural id. */
export function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}
