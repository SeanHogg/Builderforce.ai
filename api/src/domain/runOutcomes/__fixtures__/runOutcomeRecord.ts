/**
 * A valid synced `run-outcome` record (`RunOutcomeRecordValue`) for the run-outcomes tests,
 * plus the UUID-shaped entity id its sync event carries. Override any part with a shallow spread.
 */

import { featureDigest, type RunFeatureId } from '@builderforce/run-delta/predict';

export const RUN_ID = 'run-7f3a';
export const REPOSITORY = 'https://github.com/acme/app';
export const RECORD_ID = '55555555-5555-4555-8555-555555555555';
export const VALUES = { 'size.linesAdded': 12, 'size.linesDeleted': 3, 'delta.diffCoverage': null };
/** The server recomputes the digest, so a fixture's must be the real one. */
export const DIGEST = featureDigest(VALUES as Record<RunFeatureId, number | null>);

/** Features whose digest is recomputed over the (possibly overridden) values, unless `digest` is overridden too. */
export function features(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    schemaVersion: 1,
    runId: RUN_ID,
    repository: REPOSITORY,
    finalizedAt: '2026-10-10T12:00:00.000Z',
    values: VALUES,
    run: { entryPoint: 'vscode', mode: 'interactive', modelTier: 'frontier' },
    people: { requesterId: 'user-1', agentId: 'agent-9' },
    ...overrides,
  };
  return 'digest' in overrides ? merged : { ...merged, digest: featureDigest(merged.values as Record<RunFeatureId, number | null>) };
}

export function label(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'ci-red-after-merge',
    value: null,
    status: 'censored',
    windowEndsAt: '2026-10-20T00:00:00.000Z',
    evidence: { rule: 'first-post-merge-run' },
    labellerVersion: 1,
    computedAt: '2026-10-12T00:00:00.000Z',
    ...overrides,
  };
}

export function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'run-outcome',
    runId: RUN_ID,
    repository: REPOSITORY,
    features: features(),
    attribution: [{ commitSha: 'ABCDEF1234567', path: 'src/a.ts', branch: 'feature/x', addedLines: 10, committedAt: '2026-10-10T12:05:00.000Z', source: 'vscode-git' }],
    labels: [label()],
    ...overrides,
  };
}

/** The device-only gate-ledger row that shares the entity type (bare run id, no `kind`). */
export const gateLedgerRow = { runId: RUN_ID, gates: [{ id: 'tests', passed: true }], finishedAt: '2026-10-10T12:00:00.000Z' };
