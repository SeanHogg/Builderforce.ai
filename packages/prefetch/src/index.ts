/**
 * `@builderforce/prefetch` — deterministic-first PreFetch (docs/design/deterministic-prefetch.md).
 *
 * The action registry, the cheapest-tier-first confidence gate and per-action calibration.
 * Pure: a host runs actions through its `PrefetchExecutors`; brain-embedded's run
 * preamble (`runStore/prefetchGate.ts`) is the ONE place the gate is consulted.
 */

export type * from './types.js';
export { NEEDS_LLM, defineRegistry, offeredActions } from './registry.js';
export { DEFAULT_GATE_BUDGET_MS, classify } from './classify.js';
export { LEXICAL_FEATURES, REASK_SIMILARITY, isReask, lexicalFeatures, similarity, tokenize } from './lexical.js';
export { AMBIGUOUS_FLOOR, TIER3_CANDIDATES, TIER3_MIN_MS, labelProbabilities, logprobPrompt } from './logprob.js';
export {
  COLD_HEAD,
  COLD_START,
  MIN_CALIBRATION_N,
  TARGET_PRECISION,
  deserializeCalibration,
  emptyCalibration,
  headOf,
  predict,
  recalibrate,
  serializeCalibration,
  thresholdOf,
  updateHead,
} from './calibrate.js';
export { deadlineSignal, withinMs } from './deadline.js';
export { PREPARE_BUDGET_MS, PREVIEW_BUDGET_MS, belowAnswerThreshold, previewPrefetchAction, runGate, runPrefetchAction, type GateRanAction, type GateRunHooks, type GateRunResult } from './runGate.js';
export { prefetchConfirmOf, prefetchConfirmRequest, type PrefetchConfirm, type PrefetchConfirmArgs } from './confirmRequest.js';
