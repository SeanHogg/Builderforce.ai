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

import type { DimensionId } from '../contract.js';

// ─── Features ────────────────────────────────────────────────────────────────

/** Bumped when a feature is added, removed or redefined. A model artifact names the schema it was trained on. */
export const RUN_FEATURES_SCHEMA_VERSION = 1;

/** Where the run was started (D1 "Run"). */
export type RunEntryPoint = 'vscode' | 'cloud' | 'web';

/**
 * The numeric feature ids of schema v1, in canonical order. `null` = not measured (never zero). `delta.<dim>.*` is one
 * triple per dimension of {@link FEATURE_DIMENSIONS}.
 */
export type RunFeatureId =
    | 'size.linesAdded' | 'size.linesDeleted' | 'size.filesTouched'
    | 'spread.entropy' | 'spread.entropyNormalized'
    | 'structure.centralitySum' | 'structure.centralityMax' | 'structure.entryPointsReached'
    | 'structure.layersTouched' | 'structure.crossPartitionEdgesChanged'
    | 'history.churn90d' | 'history.pastFollowupFixes' | 'history.ageDaysMean'
    | `delta.${DimensionId}.${'introduced' | 'resolved' | 'changed'}`
    | 'delta.integrityFindings' | 'delta.testsChanged' | 'delta.diffCoverage'
    | 'run.autonomous' | 'run.steps' | 'run.toolFailures'
    | 'people.priorRunsInRepo' | 'people.priorChangesToTouchedFiles' | 'people.tenureDays';

/**
 * Who took part in the run (D1 "People", decided 2026-11-06). Stored with the features under the access rules of D14;
 * a trained artifact never holds these ids, only the aggregate `people.*` experience values. Absent = unknown.
 */
export interface RunPeople {
    requesterId?: string;
    approverId?: string;
    reviewerId?: string;
    agentId?: string;
}

/**
 * The feature vector of one run in one repository, frozen at run end (`finalizedAt`). Every value was computed from
 * data available at `finalizedAt` (the leakage guard, `features.ts`).
 */
export interface RunFeatures {
    schemaVersion: typeof RUN_FEATURES_SCHEMA_VERSION;
    runId: string;
    /** The synced repository identity (remote URL, else `local:<hash>`), never a local path. */
    repository: string;
    /** ISO time the run ended; no feature reads anything later. */
    finalizedAt: string;
    /** Every {@link RunFeatureId}, in canonical order (`canonicalFeatures`). */
    values: Record<RunFeatureId, number | null>;
    /** Categorical run context. */
    run: { entryPoint: RunEntryPoint; mode: 'interactive' | 'autonomous'; modelTier: string | null };
    people: RunPeople;
    /** sha256 of the canonical numeric vector (`featureDigest`): the `inputDigest` a prediction carries (D0). */
    digest: string;
}

// ─── Commit attribution ──────────────────────────────────────────────────────

/**
 * Per-run commit attribution (D1, `followup-fix` step 4): a commit that holds content whose normalized hash equals the
 * run's `afterHash` for `path`. Recorded by the VSIX at commit time (git extension API) and by the cloud runtime at
 * `cloudFinalize` (the run's own per-execution commit marker).
 */
export interface CommitAttribution {
    commitSha: string;
    /** Root-relative POSIX path. */
    path: string;
    /** The commit's branch when known (a CI or review label finds the run's pull request by it). */
    branch?: string;
    /** Lines the run added to `path` in this commit (the `reverted` 50% rule's denominator). */
    addedLines?: number;
    /** ISO commit time. */
    committedAt: string;
    source: 'vscode-git' | 'cloud-finalize';
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export type RunLabelKind =
    | 'reverted'
    | 'followup-fix'
    | 'ci-red-after-merge'
    | 'review-rejected'
    | 'finding-actioned'
    | 'finding-marked-wrong'
    | 'finding-waived';

/** §12.10 label windows, in days. `review-rejected` runs until its pull request closes; panel actions are immediate. */
export const LABEL_WINDOW_DAYS: Readonly<Record<'reverted' | 'followup-fix' | 'ci-red-after-merge', number>> = {
    reverted: 30,
    'followup-fix': 30,
    'ci-red-after-merge': 7,
};

/** Bumped when a labeller's rule changes, so labels from different rules are never pooled silently. */
export const LABELLER_VERSION: Readonly<Record<RunLabelKind, number>> = {
    reverted: 1,
    'followup-fix': 1,
    'ci-red-after-merge': 1,
    'review-rejected': 1,
    'finding-actioned': 1,
    'finding-marked-wrong': 1,
    'finding-waived': 1,
};

/**
 * One label of one run (one row per run, repository and kind).
 *
 * CENSORING. `status` is `final` only once the window has ended (or the kind is immediate). Before that the run is
 * right-censored: `value` is `true` when the event was already observed (`eventAt`), else `null`, never `false`.
 * Classifiers train on `final` rows only; survival estimates use `eventAt` and the censoring time.
 */
export interface RunOutcomeLabel {
    kind: RunLabelKind;
    value: boolean | null;
    status: 'final' | 'censored';
    /** ISO time the event happened (the fixing / reverting commit, the failed CI run, the review). */
    eventAt?: string;
    /** ISO end of the window; absent while it is open-ended (`review-rejected` before its PR closes). */
    windowEndsAt?: string;
    /** Stable codes and ids, never content: e.g. `{ commit: '<sha>', rule: 'message-revert' }`. */
    evidence: Record<string, string | number>;
    labellerVersion: number;
    /** ISO time the label was computed. */
    computedAt: string;
}

// ─── The record ──────────────────────────────────────────────────────────────

/**
 * The natural key of a run's synced `run-outcome` row: `run-outcome:<runId>:<repoKey>`. The record id is its UUID-shaped
 * `stableEntityId` (local-first; every synced client entity id is a UUID), and the server keys rows by the payload's
 * `(runId, repository)`, never by the client id.
 */
export const runOutcomeKey = (runId: string, repoKey: string): string => `run-outcome:${runId}:${repoKey}`;

/**
 * The synced value of one run's outcome in one repository. `features` are written once at run end and never change;
 * `attribution` grows as the run's content is committed; `labels` hold the latest row per kind.
 *
 * `kind: 'run-outcome'` tells these rows apart from the device-only gate-ledger rows that share the entity type
 * (`brain-embedded` `RunOutcomeValue`, keyed by the bare run id and never journaled).
 */
export interface RunOutcomeRecordValue {
    kind: 'run-outcome';
    runId: string;
    repository: string;
    features: RunFeatures;
    attribution: CommitAttribution[];
    labels: RunOutcomeLabel[];
}

export const isRunOutcomeRecordValue = (p: unknown): p is RunOutcomeRecordValue =>
    !!p && typeof p === 'object' && (p as { kind?: unknown }).kind === 'run-outcome'
    && !!(p as { features?: unknown }).features;
