/**
 * `@builderforce/difficulty-router` — PRD D2: predict that the weak model will fail a
 * step's verifier and skip the wasted attempt. Pure; the api owns I/O
 * (`api/src/application/llm/difficultyGate.ts`, `difficultyTraining.ts`).
 */

export {
  DIFFICULTY_AXES,
  DIFFICULTY_NUMERIC_FEATURES,
  difficultyFeatureDim,
  featurize,
  vocabularyOf,
  type DifficultyFeatures,
  type DifficultyVocabulary,
  type VocabularyOptions,
} from './features.js';

export {
  DIFFICULTY_HEAD_VERSION,
  DIFFICULTY_POLICY,
  binaryFromSoftmaxParams,
  headTrusted,
  parseDifficultyHead,
  predictWeakFailure,
  skipWeakAttempt,
  trainLogistic,
  type DifficultyExample,
  type DifficultyHead,
  type DifficultyPolicy,
  type LogisticFit,
  type LogisticSample,
  type LogisticTrainer,
} from './head.js';
