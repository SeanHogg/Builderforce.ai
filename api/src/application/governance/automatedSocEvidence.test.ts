import { describe, expect, it, vi } from 'vitest';

vi.mock('./soc2Baseline', () => ({ ensureSoc2Baseline: vi.fn(async () => 0) }));
vi.mock('./mutationAudit', () => ({ recordGovernanceMutation: vi.fn(async () => undefined) }));

import { automatedSourceRef, controlRefsForEvidence, recordAutomatedEvidence } from './automatedSocEvidence';

/** A db whose evidence insert honours the (control_id, source_ref) unique index. */
function fakeDb(controls: Array<{ id: string; controlRef: string }>) {
  const seen = new Set<string>();
  const inserted: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({ from: () => ({ where: async () => controls }) }),
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            const key = `${row.controlId}|${row.sourceRef}`;
            if (seen.has(key)) return [];
            seen.add(key);
            inserted.push(row);
            return [{ id: `ev-${inserted.length}` }];
          },
        }),
      }),
    }),
  };
  return { db: db as never, inserted };
}

const input = { tenantId: 1, segmentId: 'seg', kind: 'merge' as const, sourceId: 'pr-1', url: 'https://x/pr/1', note: 'run 42' };

describe('automated SOC 2 evidence', () => {
  it('maps events onto CC8.1 / CC7.1', () => {
    expect(controlRefsForEvidence('merge')).toEqual(['CC8.1']);
    expect(controlRefsForEvidence('scan')).toEqual(['CC7.1', 'CC8.1']);
  });

  it('writes automated evidence with provenance in source_ref', async () => {
    const { db, inserted } = fakeDb([{ id: 'c1', controlRef: 'CC8.1' }]);
    expect(await recordAutomatedEvidence(undefined, db, input)).toBe(1);
    expect(inserted[0]).toMatchObject({
      evidenceType: 'automated', sourceRef: automatedSourceRef('merge', 'pr-1'), url: 'https://x/pr/1', controlId: 'c1',
    });
  });

  it('is idempotent: the same provenance never writes a second row', async () => {
    const { db, inserted } = fakeDb([{ id: 'c1', controlRef: 'CC8.1' }]);
    await recordAutomatedEvidence(undefined, db, input);
    expect(await recordAutomatedEvidence(undefined, db, input)).toBe(0);
    expect(inserted).toHaveLength(1);
  });

  it('writes one row per mapped control and skips a segment-less call', async () => {
    const { db, inserted } = fakeDb([{ id: 'c1', controlRef: 'CC7.1' }, { id: 'c2', controlRef: 'CC8.1' }]);
    expect(await recordAutomatedEvidence(undefined, db, { ...input, kind: 'scan', sourceId: 'scan-1' })).toBe(2);
    expect(inserted).toHaveLength(2);
    expect(await recordAutomatedEvidence(undefined, db, { ...input, segmentId: null })).toBe(0);
  });
});
