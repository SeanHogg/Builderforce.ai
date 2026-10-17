/**
 * `@builderforce/workload` — read a call before it is dispatched.
 *
 * One {@link WorkloadProfile} per call (role · arc stage · action type · estimated
 * tokens · agentic), derived the same way by the gateway, the editor, the on-prem
 * runtime and an offline browser run. Hosts the lexical action classifier and the one
 * chars-per-token heuristic. Pure and I/O-free.
 */

export {
  CONTEXT_CHARS,
  CONTEXT_WEIGHT,
  INSTRUCTION_CHARS,
  MIN_CONFIDENCE,
  classifyRunAction,
  type ActionClassification,
} from './actionClassifier.js';
export { ARC_STAGES, isArcStage, type ArcStage } from './arcStage.js';
export {
  DEFAULT_OUTPUT_TOKENS,
  TYPICAL_OUTPUT_TOKENS,
  profileWorkload,
  type WorkloadInput,
  type WorkloadProfile,
} from './profile.js';
export { CHARS_PER_TOKEN, estimateTokensFromChars, estimateTokensFromText } from './tokens.js';
