import { describe, expect, it } from 'vitest';
import { parseRunOutcomeRecord } from './runOutcomeRecord';
import { features, gateLedgerRow, label, record } from './__fixtures__/runOutcomeRecord';

const now = new Date('2026-10-18T00:00:00.000Z');
const parse = (payload: unknown) => parseRunOutcomeRecord(payload, now);
const refusal = (payload: unknown) => {
  const result = parse(payload);
  return result.ok ? null : result.detail;
};

describe('parseRunOutcomeRecord', () => {
  it('reads a valid record into the stored rows', () => {
    const result = parse(record());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.features).toMatchObject({ entryPoint: 'vscode', mode: 'interactive', modelTier: 'frontier', schemaVersion: 1, requesterId: 'user-1', approverId: null, agentId: 'agent-9' });
    expect(result.value.features.values).toEqual({ 'size.linesAdded': 12, 'size.linesDeleted': 3, 'delta.diffCoverage': null });
    expect(result.value.attributions[0]).toMatchObject({ commitSha: 'abcdef1234567', path: 'src/a.ts', branch: 'feature/x', addedLines: 10 });
    expect(result.value.labels[0]).toMatchObject({ kind: 'ci-red-after-merge', status: 'censored', value: null });
  });

  it('refuses the device-only gate-ledger row that shares the entity type', () => {
    expect(refusal(gateLedgerRow)).toBe('run_outcome_not_a_record');
    expect(refusal({ ...record(), kind: undefined })).toBe('run_outcome_not_a_record');
  });

  it('refuses a run id in the cloud namespace', () => {
    expect(refusal(record({ runId: 'cloud:12', features: features({ runId: 'cloud:12' }) }))).toBe('run_outcome_run_id_reserved');
  });

  it('refuses a local path as the repository identity', () => {
    expect(refusal(record({ repository: 'C:\\code\\app', features: features({ repository: 'C:\\code\\app' }) }))).toBe('run_outcome_repository_is_path');
  });

  it('refuses a non-finite feature value', () => {
    expect(refusal(record({ features: features({ values: { 'size.linesAdded': Number.POSITIVE_INFINITY } }) }))).toBe('run_features_value_not_finite');
    expect(refusal(record({ features: features({ values: { 'size.linesAdded': '12' } }) }))).toBe('run_features_value_not_finite');
  });

  it('refuses features of another run, and a malformed digest', () => {
    expect(refusal(record({ features: features({ runId: 'x' }) }))).toBe('run_features_identity_mismatch');
    expect(refusal(record({ features: features({ digest: 'nothex' }) }))).toBe('run_features_digest_invalid');
  });

  it('admits only the contract\'s feature ids, under the known schema version, with the recomputed digest', () => {
    expect(refusal(record({ features: features({ values: { 'size.linesAdded': 1, 'repo.secretName': 3 } }) }))).toBe('run_features_value_id_unknown');
    // A version above the server's is a newer client: refused as RETRYABLE (runOutcomeRecord.versions.test.ts).
    expect(refusal(record({ features: features({ schemaVersion: 2 }) }))).toBe('run_features_schema_version_ahead');
    expect(refusal(record({ features: features({ digest: 'f'.repeat(64) }) }))).toBe('run_features_digest_mismatch');
    const tampered = features();
    expect(refusal(record({ features: { ...tampered, values: { 'size.linesAdded': 13 } } }))).toBe('run_features_digest_mismatch');
  });

  it('bounds lists and strings', () => {
    const many = Array.from({ length: 2001 }, (_, i) => ({ commitSha: 'abcdef1', path: `f${i}.ts`, committedAt: '2026-10-10T00:00:00.000Z', source: 'vscode-git' }));
    expect(refusal(record({ attribution: many }))).toBe('run_attribution_too_many');
    expect(refusal(record({ attribution: [{ commitSha: 'abcdef1', path: 'x'.repeat(1025), committedAt: '2026-10-10T00:00:00.000Z', source: 'vscode-git' }] }))).toBe('run_attribution_path_invalid');
    expect(refusal(record({ labels: [label(), label()] }))).toBe('run_label_kind_duplicate');
  });

  it('refuses a censored label that claims false, and an unknown kind', () => {
    expect(refusal(record({ labels: [label({ value: false })] }))).toBe('run_label_censored_false');
    expect(refusal(record({ labels: [label({ kind: 'vibes' })] }))).toBe('run_label_kind_invalid');
  });

  it('clamps a future computedAt to now but keeps a future window end', () => {
    const result = parse(record({ labels: [label({ computedAt: '2030-01-01T00:00:00.000Z', windowEndsAt: '2030-01-01T00:00:00.000Z' })] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.labels[0]!.computedAt).toEqual(now);
    expect(result.value.labels[0]!.windowEndsAt).toEqual(new Date('2030-01-01T00:00:00.000Z'));
  });
});
