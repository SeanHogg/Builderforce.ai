/**
 * Feature schema versions across a deploy (PRD 41 §D1): the server deploys on every push while VS Code clients update later,
 * so OLDER clients are the common case. Simulated here as a server at schema 3 that still lists 2: an older listed version
 * is accepted under its own ids and digest; an older UNLISTED one is refused for good; a NEWER one is refused as
 * retryable, which the importer answers `pending` (receipt `dependency_pending`: the device keeps the event and resends).
 */

import { describe, expect, it, vi } from 'vitest';

const V2_IDS = ['size.linesAdded', 'size.linesDeleted'];
const V3_IDS = ['size.linesAdded', 'size.linesDeleted', 'size.filesTouched'];

vi.mock('@builderforce/run-delta/predict', async (importOriginal) => {
  const real = await importOriginal<typeof import('@builderforce/run-delta/predict')>();
  return { ...real, RUN_FEATURES_SCHEMA_VERSION: 3, FEATURE_IDS_BY_SCHEMA: { 2: V2_IDS, 3: V3_IDS } };
});

const { featureDigest } = await import('@builderforce/run-delta/predict');
const { parseRunOutcomeRecord, RETRYABLE_RUN_OUTCOME_REFUSALS } = await import('./runOutcomeRecord');
const { importSyncedRunOutcome } = await import('../../application/runOutcomes/importSyncedRunOutcome');
const { ctx, event, stores } = await import('../../application/sync/importers/__fixtures__/importerHarness');
const { features, RECORD_ID, record } = await import('./__fixtures__/runOutcomeRecord');

const now = new Date('2026-10-18T00:00:00.000Z');
const versioned = (schemaVersion: number, ids: readonly string[]) => {
  const values = Object.fromEntries(ids.map((id, i) => [id, i + 1]));
  return record({ features: features({ schemaVersion, values, digest: featureDigest(values, ids) }) });
};
const refusal = (payload: unknown) => {
  const result = parseRunOutcomeRecord(payload, now);
  return result.ok ? null : result.detail;
};

describe('feature schema versions', () => {
  it('accepts an older version still listed, under its own ids and digest, and stores that version', () => {
    const result = parseRunOutcomeRecord(versioned(2, V2_IDS), now);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.features.schemaVersion).toBe(2);
    // A v3 id under v2 is not that version's vector.
    expect(refusal(versioned(2, V3_IDS))).toBe('run_features_value_id_unknown');
  });

  it('refuses an older version no longer listed, permanently', () => {
    expect(refusal(versioned(1, V2_IDS))).toBe('run_features_schema_version_unsupported');
    expect(RETRYABLE_RUN_OUTCOME_REFUSALS.has('run_features_schema_version_unsupported')).toBe(false);
  });

  it('refuses a newer version as retryable: the importer answers pending, so the event stays pending on the device', async () => {
    expect(refusal(versioned(4, V3_IDS))).toBe('run_features_schema_version_ahead');
    const writes: unknown[] = [];
    const outcome = await importSyncedRunOutcome(
      event({ entityType: 'run-outcome', operation: 'create', payload: versioned(4, V3_IDS), clientEntityId: RECORD_ID }),
      ctx(), stores(), { async write(...args) { writes.push(args); return { ok: true }; } },
    );
    expect(outcome).toEqual({ status: 'pending', detail: 'run_features_schema_version_ahead' });
    expect(writes).toHaveLength(0);
    const rejected = await importSyncedRunOutcome(
      event({ entityType: 'run-outcome', operation: 'create', payload: versioned(1, V2_IDS), clientEntityId: RECORD_ID }),
      ctx(), stores(), { async write() { return { ok: true }; } },
    );
    expect(rejected).toEqual({ status: 'rejected', detail: 'run_features_schema_version_unsupported' });
  });
});
