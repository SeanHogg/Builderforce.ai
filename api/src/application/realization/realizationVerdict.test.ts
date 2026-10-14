/**
 * The rollup that turns a console's own recorded call into the realization's
 * trusted verdict — and the invariants that make it safe to trust at all: it
 * is scoped to the realization's own project, it never overwrites a person's
 * own call to abandon, and it writes nothing when there is nothing new to say.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProofEvaluationDto, ProofMeasure } from '@builderforce/interaction-contract';
import { fakeDb } from '../../../test/fakeDb';
import type { Row } from './realizationStore';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const measured = vi.hoisted(() => ({
  evaluate: vi.fn(),
  patterns: vi.fn(async () => [] as Array<{ text: string; examples: Array<{ recordingId: string; atMs: number }> }>),
}));
vi.mock('./proofMeasure', () => ({ evaluateProofMeasure: measured.evaluate, missPatterns: measured.patterns }));

const { syncRealizationVerdict } = await import('./realizationVerdict');
const { GRADE_METADATA_MAX_CHARS } = await import('./proofEvidence');

const env = {} as Env;

function row(over: Partial<Row> = {}): Row {
  return {
    id: 'r1',
    tenantId: 1,
    challengeId: null,
    projectId: 42,
    targetKey: 'smoke-test',
    title: 'Acme Concierge',
    strategy: 'declarative',
    spec: {},
    plan: {},
    result: {},
    liveUrl: 'https://acme.example',
    status: 'built',
    error: null,
    verdict: null,
    verdictMetric: null,
    decidedAt: null,
    createdByUserId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  } as Row;
}

const submittedAt = new Date('2026-02-01T12:00:00Z');

describe('syncRealizationVerdict', () => {
  it('does nothing for a proof with no project — it never got a console', async () => {
    const db = fakeDb([]);
    const result = await syncRealizationVerdict(env, db as unknown as Db, 1, row({ projectId: null }));
    expect(result.verdict).toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  it('does nothing when the verdict collection was never created', async () => {
    const db = fakeDb([[]]); // siteCollections lookup: no row
    const result = await syncRealizationVerdict(env, db as unknown as Db, 1, row());
    expect(result.verdict).toBeNull();
    expect(db.calls.map((c) => c.kind)).toEqual(['select']);
  });

  it('does nothing when the collection exists but nothing has been recorded yet', async () => {
    const db = fakeDb([[{ id: 9 }], []]);
    const result = await syncRealizationVerdict(env, db as unknown as Db, 1, row());
    expect(result.verdict).toBeNull();
  });

  it('ignores a submission whose payload does not carry a verdict this platform recognises', async () => {
    const db = fakeDb([
      [{ id: 9 }],
      [{ payload: { count: 31 }, createdAt: submittedAt }], // no `verdict` key — e.g. a stray write
    ]);
    const result = await syncRealizationVerdict(env, db as unknown as Db, 1, row());
    expect(result.verdict).toBeNull();
  });

  it('rolls a decisive console call onto the row, with its own recorded date', async () => {
    const db = fakeDb([
      [{ id: 9 }], // siteCollections
      [{ payload: { verdict: 'met', metricLabel: 'Signups', metricValue: 31, target: 25 }, createdAt: submittedAt }],
      [row({ verdict: 'met', decidedAt: submittedAt })], // update … returning
    ]);
    const result = await syncRealizationVerdict(env, db as unknown as Db, 1, row());
    expect(result.verdict).toBe('met');
    expect(result.decidedAt).toEqual(submittedAt);

    const update = db.calls.find((c) => c.kind === 'update')!;
    expect(update.payload).toMatchObject({ verdict: 'met', verdictMetric: { metricLabel: 'Signups', metricValue: 31 } });
  });

  it('is a no-op once the row already matches the console record — no wasted write', async () => {
    const db = fakeDb([
      [{ id: 9 }],
      [{ payload: { verdict: 'met', metricValue: 31 }, createdAt: submittedAt }],
    ]);
    const already = row({ verdict: 'met', decidedAt: submittedAt });
    const result = await syncRealizationVerdict(env, db as unknown as Db, 1, already);
    expect(result).toBe(already);
    expect(db.calls.map((c) => c.kind)).toEqual(['select', 'select']); // no update issued
  });

  it('never lets a console resurrect an idea a person has already parked', async () => {
    const db = fakeDb([]);
    const abandoned = row({ verdict: 'abandoned', decidedAt: new Date('2026-03-01') });
    const result = await syncRealizationVerdict(env, db as unknown as Db, 1, abandoned);
    expect(result).toBe(abandoned);
    expect(db.calls).toHaveLength(0);
  });
});

// ── Measured verdicts (PRD 33 §5.3.2) ──────────────────────────────────────

const MEASURE: ProofMeasure = {
  sample: { filter: { all: [{ field: 'tag', op: 'neq', value: 'source=direct' }] }, min: 500 },
  success: { kind: 'smartEvent', ref: 'sign up' },
  threshold: { op: '>=', value: 25, unit: 'count' },
  windowDays: 14,
};
const WINDOW_END = '2026-02-15T00:00:00.000Z';

function evaluation(over: Partial<ProofEvaluationDto> = {}): ProofEvaluationDto {
  return {
    realizationId: 'r1',
    siteId: '11111111-1111-4111-8111-111111111111',
    measure: MEASURE,
    sampleN: 640,
    sampleMin: 500,
    sampleReached: true,
    successN: 31,
    value: 31,
    threshold: MEASURE.threshold,
    status: 'collecting',
    windowStartedAt: '2026-02-01T00:00:00.000Z',
    windowEndsAt: WINDOW_END,
    releaseKeys: ['rel-a'],
    evidenceRecordingIds: ['rec-1', 'rec-2'],
    patterns: [],
    ...over,
  };
}

const measuredRow = (over: Partial<Row> = {}) => row({ measure: MEASURE, sessionId: 's1', ...over } as Partial<Row>);
const beforeEnd = new Date('2026-02-10T00:00:00Z');
const afterEnd = new Date('2026-02-16T00:00:00Z');

describe('syncRealizationVerdict — measured', () => {
  beforeEach(() => {
    measured.evaluate.mockReset();
    measured.patterns.mockReset().mockResolvedValue([]);
  });

  it('a person abandoning the idea stands — nothing is measured', async () => {
    const db = fakeDb([]);
    const parked = measuredRow({ verdict: 'abandoned' });
    expect(await syncRealizationVerdict(env, db as unknown as Db, 1, parked)).toBe(parked);
    expect(measured.evaluate).not.toHaveBeenCalled();
  });

  it('accepts a posted call on a full sample, replacing its numbers with the measured ones', async () => {
    measured.evaluate.mockResolvedValue(evaluation());
    const db = fakeDb([
      [{ id: 9 }],
      [{ payload: { verdict: 'missed', metricLabel: 'Signups', metricValue: 12, target: 25 }, createdAt: submittedAt }],
      [measuredRow({ verdict: 'met', decidedAt: submittedAt })],
      [{ id: 'evt' }],
    ]);
    const result = await syncRealizationVerdict(env, db as unknown as Db, 1, measuredRow(), { now: beforeEnd });
    expect(result.verdict).toBe('met');
    const update = db.calls.find((c) => c.kind === 'update')!;
    // The page said 12 and "missed"; the record says what the visitors did: 31 >= 25.
    expect(update.payload).toMatchObject({
      verdict: 'met',
      decidedAt: submittedAt,
      verdictMetric: { metricValue: 31, target: 25, sample: 640, measured: true, call: 'posted', posted: { verdict: 'missed', metricValue: 12 } },
    });
  });

  it('holds a posted call that arrived before the sample did: verdictMetric.held, no verdict', async () => {
    measured.evaluate.mockResolvedValue(evaluation({ sampleN: 30, sampleReached: false, successN: 40, value: 40 }));
    const db = fakeDb([
      [{ id: 9 }],
      [{ payload: { verdict: 'met', metricValue: 40 }, createdAt: submittedAt }],
      [measuredRow({ verdictMetric: { held: 'sample_not_reached' } })],
    ]);
    await syncRealizationVerdict(env, db as unknown as Db, 1, measuredRow(), { now: beforeEnd });
    const update = db.calls.find((c) => c.kind === 'update')!;
    expect(update.payload).toMatchObject({ verdictMetric: { held: 'sample_not_reached', sample: 30, postedAt: submittedAt.toISOString() } });
    expect((update.payload as Record<string, unknown>).verdict).toBeUndefined();
    expect(db.calls.some((c) => c.kind === 'insert')).toBe(false);
  });

  it('does not rewrite a hold it already wrote for the same posted call', async () => {
    measured.evaluate.mockResolvedValue(evaluation({ sampleN: 30, sampleReached: false }));
    const db = fakeDb([[{ id: 9 }], [{ payload: { verdict: 'met' }, createdAt: submittedAt }]]);
    const held = measuredRow({ verdictMetric: { held: 'sample_not_reached', postedAt: submittedAt.toISOString() } });
    expect(await syncRealizationVerdict(env, db as unknown as Db, 1, held, { now: beforeEnd })).toBe(held);
    expect(db.calls.map((c) => c.kind)).toEqual(['select', 'select']);
  });

  it('accepts a posted call short of the sample when it carries a written early-call reason', async () => {
    measured.evaluate.mockResolvedValue(evaluation({ sampleN: 120, sampleReached: false, successN: 3, value: 3 }));
    const db = fakeDb([
      [{ id: 9 }],
      [{ payload: { verdict: 'missed', reason: 'Budget is gone; the channel is dead.' }, createdAt: submittedAt }],
      [measuredRow({ verdict: 'missed' })],
      [{ id: 'evt' }],
    ]);
    await syncRealizationVerdict(env, db as unknown as Db, 1, measuredRow(), { now: beforeEnd });
    expect(db.calls.find((c) => c.kind === 'update')!.payload).toMatchObject({
      verdict: 'missed',
      verdictMetric: { call: 'early', reason: 'Budget is gone; the channel is dead.', metricValue: 3 },
    });
  });

  it('a person calling it early decides now, with the reason on the record', async () => {
    measured.evaluate.mockResolvedValue(evaluation({ sampleN: 200, sampleReached: false, successN: 30, value: 30 }));
    const db = fakeDb([[], [measuredRow({ verdict: 'met' })], [{ id: 'evt' }]]);
    await syncRealizationVerdict(env, db as unknown as Db, 1, measuredRow(), { now: beforeEnd, earlyCallReason: '  We have our answer.  ' });
    expect(db.calls.find((c) => c.kind === 'update')!.payload).toMatchObject({
      verdict: 'met',
      decidedAt: beforeEnd,
      verdictMetric: { call: 'early', reason: 'We have our answer.' },
    });
  });

  it('writes nothing before the window ends when nothing was posted', async () => {
    measured.evaluate.mockResolvedValue(evaluation());
    const db = fakeDb([[]]);
    const untouched = measuredRow();
    expect(await syncRealizationVerdict(env, db as unknown as Db, 1, untouched, { now: beforeEnd })).toBe(untouched);
    expect(db.calls.some((c) => c.kind === 'update')).toBe(false);
  });

  it('at the window end writes the measured verdict, decidedAt = windowEndsAt, with cited evidence on a miss', async () => {
    measured.evaluate.mockResolvedValue(evaluation({ status: 'missed' }));
    measured.patterns.mockResolvedValue([{ text: 'Visitors left at the price', examples: [{ recordingId: 'rec-1', atMs: 4000 }] }]);
    const db = fakeDb([[], [measuredRow({ verdict: 'missed' })], [{ id: 'evt' }]]);
    await syncRealizationVerdict(env, db as unknown as Db, 1, measuredRow(), { now: afterEnd });

    expect(db.calls.find((c) => c.kind === 'update')!.payload).toMatchObject({
      verdict: 'missed',
      decidedAt: new Date(WINDOW_END),
      verdictMetric: { call: 'window', evidence: { sampleN: 640, successN: 31, recordingIds: ['rec-1', 'rec-2'], releaseKeys: ['rel-a'] } },
    });
    const grade = db.calls.find((c) => c.kind === 'insert')!.payload as { action: string; phase: string; metricValue: number; metadata: Record<string, unknown> };
    expect(grade).toMatchObject({ action: 'proof.grade', phase: 'validated', metricValue: 0 });
    expect(grade.metadata).toMatchObject({
      verdict: 'missed',
      evidence: { sampleN: 640, successN: 31, value: 31, threshold: MEASURE.threshold, patterns: [{ text: 'Visitors left at the price' }] },
    });
  });

  it('never lets the window override a call already made', async () => {
    measured.evaluate.mockResolvedValue(evaluation({ status: 'missed' }));
    const db = fakeDb([[]]);
    const called = measuredRow({ verdict: 'met', decidedAt: new Date('2026-02-05T00:00:00Z') });
    expect(await syncRealizationVerdict(env, db as unknown as Db, 1, called, { now: afterEnd })).toBe(called);
  });

  it('keeps the grade metadata under the ledger ceiling, trimming patterns first', async () => {
    const long = 'x'.repeat(900);
    measured.evaluate.mockResolvedValue(evaluation({ status: 'missed', evidenceRecordingIds: ['rec-1', 'rec-2', 'rec-3', 'rec-4', 'rec-5'] }));
    measured.patterns.mockResolvedValue([1, 2, 3, 4, 5, 6].map((n) => ({ text: `${n}${long}`, examples: [{ recordingId: `rec-${n}`, atMs: n }] })));
    const db = fakeDb([[], [measuredRow({ verdict: 'missed' })], [{ id: 'evt' }]]);
    await syncRealizationVerdict(env, db as unknown as Db, 1, measuredRow(), { now: afterEnd });

    const metadata = (db.calls.find((c) => c.kind === 'insert')!.payload as { metadata: { evidence: { patterns: unknown[]; recordingIds: string[]; sampleN: number } } }).metadata;
    // `recordProofOutcome` adds `targetKey` around the bounded grade.
    expect(JSON.stringify(metadata).length).toBeLessThanOrEqual(GRADE_METADATA_MAX_CHARS + 60);
    expect(metadata.evidence.patterns.length).toBeLessThan(6);
    expect(metadata.evidence.recordingIds).toHaveLength(5);
    expect(metadata.evidence.sampleN).toBe(640);
  });
});
