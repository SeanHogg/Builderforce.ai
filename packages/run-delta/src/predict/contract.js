/**
 * predict/contract.ts — THE run-outcomes contract (PRD 41 §D1, §4): the frozen {@link RunFeatures} vector, the
 * {@link RunOutcomeLabel} rows, per-run commit attribution and the synced `run-outcome` record that carries all three.
 *
 * ONE OWNER. Run features and outcome labels belong to the run-outcomes bounded context: locally the `run-outcome`
 * record ({@link RunOutcomeRecordValue}), on the server the `run_features`, `run_outcome_labels` and
 * `run_commit_attributions` tables. The delta references them by `runId`; nothing else keeps a copy.
 *
 * D0: a prediction never sets or changes a verdict. Nothing under `engine/`, `rules/` or a verdict path may import
 * `predict/` (the `check:run-delta-layers` guard). This folder may import the delta contract, never the reverse.
 *
 * Pure types and constants: no I/O, no clock, no randomness.
 */
// ─── Features ────────────────────────────────────────────────────────────────
/** Bumped when a feature is added, removed or redefined. A model artifact names the schema it was trained on. */
export const RUN_FEATURES_SCHEMA_VERSION = 1;
/** §12.10 label windows, in days. `review-rejected` runs until its pull request closes; panel actions are immediate. */
export const LABEL_WINDOW_DAYS = {
    reverted: 30,
    'followup-fix': 30,
    'ci-red-after-merge': 7,
};
/** Bumped when a labeller's rule changes, so labels from different rules are never pooled silently. */
export const LABELLER_VERSION = {
    reverted: 1,
    'followup-fix': 1,
    'ci-red-after-merge': 1,
    'review-rejected': 1,
    'finding-actioned': 1,
    'finding-marked-wrong': 1,
    'finding-waived': 1,
};
// ─── The record ──────────────────────────────────────────────────────────────
/**
 * The natural key of a run's synced `run-outcome` row: `run-outcome:<runId>:<repoKey>`. The record id is its UUID-shaped
 * `stableEntityId` (local-first; every synced client entity id is a UUID), and the server keys rows by the payload's
 * `(runId, repository)`, never by the client id.
 */
export const runOutcomeKey = (runId, repoKey) => `run-outcome:${runId}:${repoKey}`;
export const isRunOutcomeRecordValue = (p) => !!p && typeof p === 'object' && p.kind === 'run-outcome'
    && !!p.features;
//# sourceMappingURL=contract.js.map