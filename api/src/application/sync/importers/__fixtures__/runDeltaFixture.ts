/**
 * A synced `run-delta` record for importer and push tests: a real `RunDelta` whose digest is RECOMPUTED with the
 * engine's own `digestOf` (the importer rejects any other), under the client id the payload's run and repo key name.
 */

import { digestOf, type DeltaFinding, type RunDelta } from '@builderforce/run-delta';
import { runDeltaClientId } from '../../../../domain/runDelta/runDeltaRecord';

export const RUN_ID = 'cloud:42';
export const REPO_KEY = '0123456789abcdef';
export const ENTITY = runDeltaClientId(RUN_ID, REPO_KEY);

export function finding(ruleId: string, lineage: DeltaFinding['lineage'], extra: Partial<DeltaFinding> = {}): DeltaFinding {
  const anchor = `${ruleId}@1:file:src/a.ts#k`;
  return {
    identity: { id: `${anchor}|src/a.ts`, anchor, anchorKind: 'file', members: ['src/a.ts'] },
    dimension: 'security', ruleId, ruleVersion: 1, severity: 'error', lineage, confidence: 'heuristic',
    params: { route: 'POST /x' },
    evidence: [{ side: 'after', path: 'src/a.ts', line: 7, snippet: '  router.post( "/x" ,\n   h )' }],
    ...extra,
  };
}

/** A delta with a valid digest; `mutate` edits the body BEFORE the digest is computed. */
export function delta(mutate: (d: Omit<RunDelta, 'digest'>) => void = () => undefined): RunDelta {
  const body: Omit<RunDelta, 'digest'> = {
    version: 1,
    runId: RUN_ID,
    before: { manifestGeneration: 'g1', merkleRoot: 'm1' },
    after: { manifestGeneration: 'g2', merkleRoot: 'm2' },
    impact: { changedFiles: ['src/a.ts'], renamed: [], dependents: [], entryPoints: [] },
    excluded: [],
    dimensions: [
      { id: 'quality', verdict: 'better', reasons: [], findings: [finding('test-skipped', 'resolved', { dimension: 'quality' })], metrics: [], measuredBy: [] },
      { id: 'security', verdict: 'worse', reasons: [], findings: [finding('guard-removed', 'introduced'), finding('weak-crypto', 'changed')], metrics: [], measuredBy: [] },
    ],
    headline: 'worse',
    summary: { verdict: 'worse', clauses: [], unchanged: [], notMeasured: [] },
    blastRadius: { score: 0.5, band: 'high', formula: 'v1', reasons: [] },
    blocking: ['guard-removed'],
  };
  mutate(body);
  return { ...body, digest: digestOf(body) };
}

/** The synced value (`RunDeltaRecordValue`). */
export function payload(extra: Record<string, unknown> = {}, d: RunDelta = delta()): Record<string, unknown> {
  return {
    runId: RUN_ID, repoKey: REPO_KEY, repository: 'https://github.com/o/r', changeSetId: `changeset:${RUN_ID}:${REPO_KEY}`, chatId: 1,
    mode: 'autonomous', delta: d, computedMs: 12, ...extra,
  };
}
