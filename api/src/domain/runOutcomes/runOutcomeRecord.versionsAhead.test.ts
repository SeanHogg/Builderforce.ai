/**
 * LOW2 — a client AHEAD of the server may carry a label kind (or attribution field) the server does not know
 * yet. The schema version is read FIRST, so such a record is the retryable `ahead` (pending on the device),
 * never a permanent `run_label_kind_invalid`. Simulated as a server at schema 3 (as the versions test does).
 */

import { describe, expect, it, vi } from 'vitest';

const V3_IDS = ['size.linesAdded', 'size.linesDeleted', 'size.filesTouched'];

vi.mock('@builderforce/run-delta/predict', async (importOriginal) => {
  const real = await importOriginal<typeof import('@builderforce/run-delta/predict')>();
  return { ...real, RUN_FEATURES_SCHEMA_VERSION: 3, FEATURE_IDS_BY_SCHEMA: { 3: V3_IDS } };
});

const { featureDigest } = await import('@builderforce/run-delta/predict');
const { parseRunOutcomeRecord, RETRYABLE_RUN_OUTCOME_REFUSALS } = await import('./runOutcomeRecord');
const { features, label, record } = await import('./__fixtures__/runOutcomeRecord');

const now = new Date('2026-10-18T00:00:00.000Z');
const values = Object.fromEntries(V3_IDS.map((id, i) => [id, i + 1]));
const refusal = (payload: unknown) => {
  const result = parseRunOutcomeRecord(payload, now);
  return result.ok ? null : result.detail;
};

describe('a record from a client ahead of the server', () => {
  it('schema version ahead + an unknown label kind is the retryable `ahead`, not run_label_kind_invalid', () => {
    const payload = record({
      features: features({ schemaVersion: 4, values, digest: featureDigest(values, V3_IDS) }),
      labels: [label({ kind: 'some-future-kind' })],
    });
    expect(refusal(payload)).toBe('run_features_schema_version_ahead');
    expect(RETRYABLE_RUN_OUTCOME_REFUSALS.has('run_features_schema_version_ahead')).toBe(true);
  });

  it('at this server\'s own version, an unknown label kind is still refused for good', () => {
    const payload = record({
      features: features({ schemaVersion: 3, values, digest: featureDigest(values, V3_IDS) }),
      labels: [label({ kind: 'some-future-kind' })],
    });
    expect(refusal(payload)).toBe('run_label_kind_invalid');
  });
});
