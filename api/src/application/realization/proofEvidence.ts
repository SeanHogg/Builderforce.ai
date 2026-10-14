/**
 * `proof.grade` metadata that always fits the ledger (PRD 33 §5.3.2).
 *
 * The outcome ledger drops metadata over its ceiling WHOLESALE
 * (`OUTCOME_METADATA_MAX_CHARS` → `{ truncated: true }`), which would throw away
 * the very numbers a grade is about to make a cited-pattern string fit. So the
 * evidence is trimmed here, least valuable first: pattern examples, then whole
 * patterns (last first), then recording ids, then release keys. The counts and
 * the threshold always survive.
 */

import type { ProofEvidence } from '@builderforce/interaction-contract';
import { OUTCOME_METADATA_MAX_CHARS } from '../outcomes/outcomeLedger';

/** Room left for what `recordProofOutcome` adds around it (`targetKey`). */
const HEADROOM = 200;
export const GRADE_METADATA_MAX_CHARS = OUTCOME_METADATA_MAX_CHARS - HEADROOM;

const fits = (value: unknown): boolean => JSON.stringify(value).length <= GRADE_METADATA_MAX_CHARS;

export function boundedGradeMetadata(input: { verdict: string; call: string; evidence: ProofEvidence }): Record<string, unknown> {
  const evidence: ProofEvidence = {
    ...input.evidence,
    releaseKeys: [...input.evidence.releaseKeys],
    recordingIds: [...input.evidence.recordingIds],
    patterns: input.evidence.patterns.map((p) => ({ text: p.text, examples: [...p.examples] })),
  };
  const shape = () => ({ verdict: input.verdict, call: input.call, evidence });
  if (fits(shape())) return shape();

  for (const pattern of evidence.patterns) pattern.examples = [];
  while (!fits(shape()) && evidence.patterns.length > 0) evidence.patterns.pop();
  while (!fits(shape()) && evidence.recordingIds.length > 0) evidence.recordingIds.pop();
  while (!fits(shape()) && evidence.releaseKeys.length > 0) evidence.releaseKeys.pop();
  return shape();
}
