/**
 * `evaluateProofMeasure` (PRD 33 §5.3.1): the sample through THE filter compiler,
 * success by the smart event's predicate, over the proof's OWN hosted site, with
 * the window running from the first sampled visit. The site lookup and the site's
 * smart-event rules are mocked; the counts come from a fake telemetry db.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProofMeasure } from '@builderforce/interaction-contract';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { Row } from './realizationStore';

const SITE = '11111111-1111-4111-8111-111111111111';
const mocks = vi.hoisted(() => ({ projectSiteDto: vi.fn() }));
vi.mock('../replay/replaySiteAdmin', () => ({ projectSiteDto: mocks.projectSiteDto }));
vi.mock('../replay/replaySmartEventRules', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../replay/replaySmartEventRules')>()),
  siteSmartEventRows: vi.fn(async () => []),
}));

const { evaluateProofMeasure } = await import('./proofMeasure');

const env = {} as Env;
const MEASURE: ProofMeasure = {
  sample: { filter: { all: [{ field: 'tag', op: 'neq', value: 'source=direct' }] }, min: 1000 },
  success: { kind: 'smartEvent', ref: 'sign up' },
  threshold: { op: '>=', value: 40, unit: 'count' },
  windowDays: 14,
};
const FIRST = new Date('2026-03-01T00:00:00Z');
const BEFORE_END = new Date('2026-03-10T00:00:00Z');
const AFTER_END = new Date('2026-03-16T00:00:00Z');

let seq = 0;
function proof(over: Partial<Row> = {}): Row {
  seq += 1;
  return {
    id: `real-${seq}`,
    tenantId: 3,
    projectId: 42,
    targetKey: 'smoke-test',
    status: 'built',
    measure: MEASURE,
    verdict: null,
    verdictMetric: null,
    createdAt: new Date('2026-02-28T00:00:00Z'),
    ...over,
  } as Row;
}

/** first-visit, counts, non-converting ids. */
function counts(sampleN: number, successN: number) {
  return fakeDb([
    [{ firstAt: FIRST }],
    [{ sampleN, successN, releaseKeys: ['rel-b', 'rel-a', null] }],
    [{ id: 'rec-1' }, { id: 'rec-2' }],
  ]);
}

beforeEach(() => {
  mocks.projectSiteDto.mockReset().mockResolvedValue({ id: SITE, kind: 'hosted', projectId: 42 });
});

describe('evaluateProofMeasure', () => {
  it('is null for a proof that declares no measure', async () => {
    expect(await evaluateProofMeasure(env, fakeDb([]) as unknown as Db, proof({ measure: null }))).toBeNull();
  });

  it('1,000 sampled / 31 signups / threshold 40: collecting before the window ends', async () => {
    const result = await evaluateProofMeasure(env, counts(1000, 31) as unknown as Db, proof(), { now: BEFORE_END });
    expect(result).toMatchObject({
      siteId: SITE,
      sampleN: 1000,
      sampleMin: 1000,
      sampleReached: true,
      successN: 31,
      value: 31,
      status: 'collecting',
      windowStartedAt: FIRST.toISOString(),
      windowEndsAt: '2026-03-15T00:00:00.000Z',
      releaseKeys: ['rel-a', 'rel-b'],
      evidenceRecordingIds: ['rec-1', 'rec-2'],
    });
  });

  it('1,000 sampled / 31 signups / threshold 40: missed after the window ends', async () => {
    const result = await evaluateProofMeasure(env, counts(1000, 31) as unknown as Db, proof(), { now: AFTER_END });
    expect(result?.status).toBe('missed');
  });

  it('30 visits / 40 signups is never met: collecting, then missed — the sample was never reached', async () => {
    const before = await evaluateProofMeasure(env, counts(30, 40) as unknown as Db, proof(), { now: BEFORE_END });
    expect(before).toMatchObject({ sampleReached: false, value: 40, status: 'collecting' });
    const after = await evaluateProofMeasure(env, counts(30, 40) as unknown as Db, proof(), { now: AFTER_END });
    expect(after?.status).toBe('missed');
  });

  it('reads only the proof\'s own hosted site, every statement scoped to it', async () => {
    const db = counts(1000, 45);
    await evaluateProofMeasure(env, db as unknown as Db, proof(), { now: BEFORE_END });
    expect(mocks.projectSiteDto).toHaveBeenCalledWith(env, db, 3, 42);
    expect(db.calls.map((c) => c.kind)).toEqual(['select', 'select', 'select']);
    expect(db.calls[2]!.chain).toEqual(expect.arrayContaining(['where', 'orderBy', 'limit']));
  });

  it('collects with no window and no query before the proof has a site', async () => {
    mocks.projectSiteDto.mockResolvedValue(null);
    const db = fakeDb([]);
    const result = await evaluateProofMeasure(env, db as unknown as Db, proof(), { now: AFTER_END });
    expect(result).toMatchObject({ siteId: null, sampleN: 0, status: 'collecting', windowEndsAt: null });
    expect(db.calls).toHaveLength(0);
  });

  it('collects with no window before the first sampled visit', async () => {
    const result = await evaluateProofMeasure(env, fakeDb([[{ firstAt: null }]]) as unknown as Db, proof(), { now: AFTER_END });
    expect(result).toMatchObject({ sampleN: 0, windowStartedAt: null, status: 'collecting' });
  });

  it('carries the patterns already cited on the grade', async () => {
    const patterns = [{ text: 'Left at the price', examples: [{ recordingId: 'rec-1', atMs: 10 }] }];
    const result = await evaluateProofMeasure(env, counts(1000, 31) as unknown as Db, proof({ verdict: 'missed', verdictMetric: { evidence: { patterns } } }), { now: AFTER_END });
    expect(result?.patterns).toEqual(patterns);
  });
});
