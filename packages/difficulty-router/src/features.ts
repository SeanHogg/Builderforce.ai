/**
 * What the cascade knows about a step BEFORE the weak model tries it, and how that
 * becomes the vector the difficulty head reads.
 *
 * Categorical fields (action type, model role) are one-hot over a vocabulary that is
 * learned from the training rows and stored ON the head ({@link DifficultyVocabulary}),
 * so this package carries no copy of the action-type taxonomy or the role list: a value
 * the head never saw encodes as all zeros and the head answers from its bias and the
 * numeric fields. Numeric fields sit on fixed log axes (the same formula as the engine's
 * `logScale`), so a weight means the same thing on every tenant and the global head is
 * meaningful as a fallback.
 */

/** The step's features — the ONE contract the cascade records outcomes with and asks with. */
export type DifficultyFeatures = {
  /** The task's action type (learned-routing taxonomy), e.g. `bugfix`. */
  actionType: string;
  /** The model role the step runs under, e.g. `code`. */
  role: string;
  /** Estimated prompt tokens of the step's request. */
  promptTokens: number;
  /** Tools advertised to the step. */
  toolCount: number;
  /** Position of the step in its run (0 = first). */
  turnIndex: number;
  /** Files in the repository the run works on, when known. */
  repoFileCount?: number;
  /** Recent share of this tenant's weak attempts that passed the verifier, in [0, 1]. */
  priorWeakPassRate?: number;
};

/** The categorical values a head was trained on, index-aligned with its one-hot slots. */
export interface DifficultyVocabulary {
  actionTypes: readonly string[];
  roles: readonly string[];
}

/** Names of the numeric slots that follow the one-hot blocks, in order. */
export const DIFFICULTY_NUMERIC_FEATURES = [
  'promptTokens',
  'toolCount',
  'turnIndex',
  'repoFileCount',
  'repoFileCountKnown',
  'priorWeakPassRate',
] as const;

/** Reference values of the log axes: a value at the reference scales to 1. */
export const DIFFICULTY_AXES = {
  promptTokens: 200_000,
  toolCount: 64,
  turnIndex: 100,
  repoFileCount: 100_000,
} as const;

function finite(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function logAxis(v: number | undefined, ref: number): number {
  return Math.log1p(Math.max(0, finite(v))) / Math.log1p(ref);
}

function oneHot(value: string, vocab: readonly string[]): number[] {
  return vocab.map((v) => (v === value ? 1 : 0));
}

/** Length of the vector {@link featurize} returns for `vocab`. */
export function difficultyFeatureDim(vocab: DifficultyVocabulary): number {
  return vocab.actionTypes.length + vocab.roles.length + DIFFICULTY_NUMERIC_FEATURES.length;
}

/** The feature vector of `f` under `vocab`: action one-hot · role one-hot · numeric axes. */
export function featurize(f: DifficultyFeatures, vocab: DifficultyVocabulary): number[] {
  const known = typeof f.repoFileCount === 'number' && Number.isFinite(f.repoFileCount);
  const prior = typeof f.priorWeakPassRate === 'number' && Number.isFinite(f.priorWeakPassRate) ? f.priorWeakPassRate : 0.5;
  return [
    ...oneHot(f.actionType, vocab.actionTypes),
    ...oneHot(f.role, vocab.roles),
    logAxis(f.promptTokens, DIFFICULTY_AXES.promptTokens),
    logAxis(f.toolCount, DIFFICULTY_AXES.toolCount),
    logAxis(f.turnIndex, DIFFICULTY_AXES.turnIndex),
    known ? logAxis(f.repoFileCount, DIFFICULTY_AXES.repoFileCount) : 0,
    known ? 1 : 0,
    Math.max(0, Math.min(1, prior)),
  ];
}

/** How a vocabulary is drawn from training rows. */
export interface VocabularyOptions {
  /** A value seen fewer times than this gets no slot of its own. */
  minCount: number;
  /** At most this many slots per field (the most frequent win). */
  max: number;
}

function topValues(values: readonly string[], opts: VocabularyOptions): string[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n >= opts.minCount)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, opts.max)
    .map(([v]) => v)
    .sort();
}

/** The vocabulary of a set of training rows — frequent values only, in a stable order. */
export function vocabularyOf(rows: readonly DifficultyFeatures[], opts: VocabularyOptions): DifficultyVocabulary {
  return {
    actionTypes: topValues(rows.map((r) => r.actionType), opts),
    roles: topValues(rows.map((r) => r.role), opts),
  };
}
