/**
 * FO-B3 — the requisition's binding, and the two ways it must not fail.
 *
 * The claims worth a test are not the SQL (that is `check-tenant-scope`'s and the
 * database's) but the two decisions the module makes on top of it: a card whose
 * `postingId` does not resolve is refused rather than re-created, and a count is shaped
 * from the aggregate rather than from a row list. Both are silent when wrong — a second
 * requisition looks exactly like the first, and a wrong count looks like a fact.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../env';
import { atsDbStub } from './__fixtures__/atsDbStub';
import { AtsError } from './atsError';

// The factory is hoisted above every top-level binding, so the stand-in error class is
// declared INSIDE it — a `class` at module scope would be in the temporal dead zone by
// the time the mock is built.
vi.mock('../marketplace/jobPostings', () => ({
  BudgetShapeError: class BudgetShapeError extends Error {},
  upsertJobPosting: vi.fn(async () => ({ id: 'posting-new', posting: {}, reused: false })),
}));

import { upsertJobPosting } from '../marketplace/jobPostings';
import { listCanvasPostings, readCanvasPosting, syncCanvasPosting } from './postings';

const upserted = vi.mocked(upsertJobPosting);
const ENV = {} as Env;

/** A row as the grouped count read returns it. */
const countRow = (overrides: Record<string, unknown> = {}) => ({
  postingId: 'posting-a',
  title: 'Senior React Engineer',
  status: 'open',
  postingType: 'fte',
  engagementType: 'fte',
  discipline: 'engineering',
  specialty: null,
  experienceLevel: 'expert',
  visibility: 'public',
  applicantCount: 41,
  activeApplicantCount: 33,
  unreviewedCount: 9,
  rejectedCount: 8,
  lastApplicationAt: new Date('2026-08-24T18:02:00.000Z'),
  createdAt: new Date('2026-07-01T10:00:00.000Z'),
  updatedAt: new Date('2026-08-24T18:02:00.000Z'),
  ...overrides,
});

const sourceRow = (postingId: string, source: string, count: number) => ({ postingId, source, count });

describe('listCanvasPostings', () => {
  it('shapes the aggregate and attaches each posting its OWN sources', async () => {
    const { db } = atsDbStub({
      rows: [
        [countRow(), countRow({ postingId: 'posting-b', title: 'Designer', applicantCount: 3, activeApplicantCount: 3, unreviewedCount: 3, rejectedCount: 0 })],
        [sourceRow('posting-a', 'careers-site', 26), sourceRow('posting-a', 'referral', 15), sourceRow('posting-b', 'referral', 3)],
      ],
    });

    const postings = await listCanvasPostings(db, 7);

    expect(postings).toHaveLength(2);
    expect(postings[0]).toMatchObject({
      postingId: 'posting-a',
      applicantCount: 41,
      activeApplicantCount: 33,
      unreviewedCount: 9,
      rejectedCount: 8,
    });
    expect(postings[0]?.sources).toEqual([
      { source: 'careers-site', count: 26 },
      { source: 'referral', count: 15 },
    ]);
    // The join is per posting and not a pooled list: `posting-b`'s three referrals must
    // not appear under `posting-a`, which is the exact mistake a title-keyed map makes.
    expect(postings[1]?.sources).toEqual([{ source: 'referral', count: 3 }]);
  });

  it('makes the pipeline ref the posting id, so a shortlist and the ATS board share a key', async () => {
    const { db } = atsDbStub({ rows: [[countRow()], []] });
    const [posting] = await listCanvasPostings(db, 7);
    expect(posting?.pipelineRef).toBe('posting-a');
  });

  it('reads a posting with no applications as zero, with no sources invented', async () => {
    const { db } = atsDbStub({
      rows: [[countRow({ applicantCount: 0, activeApplicantCount: 0, unreviewedCount: 0, rejectedCount: 0, lastApplicationAt: null })], []],
    });
    const [posting] = await listCanvasPostings(db, 7);
    expect(posting?.applicantCount).toBe(0);
    expect(posting?.sources).toEqual([]);
    expect(posting?.lastApplicationAt).toBeNull();
  });

  it('filters by the posting\'s own status', async () => {
    const { db } = atsDbStub({
      rows: [[countRow(), countRow({ postingId: 'posting-b', status: 'filled' })], []],
    });
    const postings = await listCanvasPostings(db, 7, { status: 'filled' });
    expect(postings.map((p) => p.postingId)).toEqual(['posting-b']);
  });
});

describe('readCanvasPosting', () => {
  it('is null for an id this workspace does not own', async () => {
    const { db } = atsDbStub({ rows: [[], []] });
    expect(await readCanvasPosting(db, 7, 'someone-elses-posting')).toBeNull();
  });
});

describe('syncCanvasPosting', () => {
  beforeEach(() => { upserted.mockClear(); });

  it('refreshes an existing card without writing anything', async () => {
    const { db, writes } = atsDbStub({ rows: [[countRow()], []] });

    const result = await syncCanvasPosting(db, ENV, { tenantId: 7, actorUserId: 'user-1', postingId: 'posting-a' });

    expect(result.created).toBe(false);
    expect(result.posting.applicantCount).toBe(41);
    expect(upserted).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  /**
   * THE test this module exists for. A card carrying an id that no longer resolves is
   * refused — it does not fall through to "create a new one", because a second
   * requisition would split the applications already recorded against the original and
   * nothing about either board or seat would look wrong afterwards.
   */
  it('refuses an id that does not resolve rather than minting a second requisition', async () => {
    const { db } = atsDbStub({ rows: [[], []] });

    await expect(syncCanvasPosting(db, ENV, { tenantId: 7, actorUserId: 'user-1', postingId: 'posting-gone' }))
      .rejects.toThrow(AtsError);
    expect(upserted).not.toHaveBeenCalled();
  });

  it('mints the row through the one writer when the card has no id, then projects it', async () => {
    const { db } = atsDbStub({ rows: [[countRow({ postingId: 'posting-new', applicantCount: 0, activeApplicantCount: 0, unreviewedCount: 0, rejectedCount: 0 })], []] });

    const result = await syncCanvasPosting(db, ENV, {
      tenantId: 7,
      actorUserId: 'user-1',
      draft: { title: 'Senior React Engineer' },
    });

    expect(result.created).toBe(true);
    expect(result.posting.postingId).toBe('posting-new');
    // Through `upsertJobPosting` and not through an insert of its own: a posting created
    // from a canvas card must be the same row the marketplace door would have created.
    expect(upserted).toHaveBeenCalledTimes(1);
    expect(upserted.mock.calls[0]?.[2]).toMatchObject({ tenantId: 7, actorUserId: 'user-1' });
  });

  it('turns a titleless draft into a 400 a recruiter can act on', async () => {
    upserted.mockRejectedValueOnce(new Error('title required'));
    const { db } = atsDbStub({ rows: [[], []] });

    await expect(syncCanvasPosting(db, ENV, { tenantId: 7, actorUserId: 'user-1', draft: {} }))
      .rejects.toMatchObject({ name: 'AtsError', status: 400 });
  });

  it('treats a blank postingId as absent rather than as an id that failed to resolve', async () => {
    const { db } = atsDbStub({ rows: [[countRow({ postingId: 'posting-new' })], []] });
    const result = await syncCanvasPosting(db, ENV, { tenantId: 7, actorUserId: 'user-1', postingId: '  ', draft: { title: 'X' } });
    expect(result.created).toBe(true);
  });
});
