/**
 * The applicant import: what a manifest says to read (pure), and how a run behaves —
 * caps counted per item, paging, the cursor, one bad applicant not aborting a board, and
 * the sweep rotating a row BEFORE it imports it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { HIRING_CONNECTORS } from '../connectors/defaults/hiring';
import { mapApplicant, parseAppliedAt } from '../connectors/connectorApplicantMapping';

const calls: string[] = [];
const recordApplication = vi.fn();
const admitBoardCandidate = vi.fn();
const saveImportCursor = vi.fn();
const touchPostedDistribution = vi.fn();
const listPostedDistributionsForSweep = vi.fn();

vi.mock('../connectors/connectorRegistry', () => ({
  resolveConnector: vi.fn(async (_db: unknown, _tenant: number, key: string) => {
    const manifest = HIRING_CONNECTORS.find((m) => m.key === key);
    return manifest ? { manifest, status: 'published' } : null;
  }),
}));
vi.mock('./applications', () => ({ recordApplication: (...args: unknown[]) => recordApplication(...args) }));
vi.mock('./boardCandidate', () => ({ admitBoardCandidate: (...args: unknown[]) => admitBoardCandidate(...args) }));
vi.mock('./postingDistributionStore', () => ({
  listPostedDistributionsForSweep: (...args: unknown[]) => listPostedDistributionsForSweep(...args),
  readPostedDistributions: vi.fn(async () => []),
  readPostingBoardCatalog: vi.fn(async () => [{ key: 'workable', aliases: [] }]),
  saveImportCursor: (...args: unknown[]) => saveImportCursor(...args),
  touchPostedDistribution: (...args: unknown[]) => { calls.push('touch'); return touchPostedDistribution(...args); },
  recordResolvedLink: vi.fn(),
}));

import {
  MAX_PAGES_PER_BOARD,
  cursorValue,
  importAction,
  importFromDistribution,
  nextCursor,
  pageInput,
  runApplicantImportSweep,
} from './importBoardApplicants';
import type { PostedDistribution } from './postingDistributionStore';

const manifest = (key: string) => HIRING_CONNECTORS.find((m) => m.key === key)!;
const ENV = {} as Env;
const DB = {} as never;

const row = (over: Partial<PostedDistribution> = {}): PostedDistribution => ({
  tenantId: 1, postingId: 'p1', connectorKey: 'workable', connectionId: 'c1', externalId: 'SHORT', url: null, importCursor: null, ...over,
});

/** A Workable-shaped candidate list. */
const candidates = (count: number, from = 0) => Array.from({ length: count }, (_, i) => ({
  id: `cand-${from + i}`, name: `Person ${from + i}`, email: `p${from + i}@example.test`,
  created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, from + i)).toISOString(),
}));

const executing = (pages: unknown[][]) => {
  let page = 0;
  const execute = vi.fn(async () => ({ ok: true, status: 200, data: pages[Math.min(page++, pages.length - 1)], durationMs: 1 }));
  return { execute: execute as never, mock: execute };
};

beforeEach(() => {
  calls.length = 0;
  recordApplication.mockReset().mockResolvedValue({ created: true, applicationId: 1 });
  admitBoardCandidate.mockReset().mockImplementation(async (_db: unknown, input: { applicationId: string }) => ({ admitted: true, candidateRef: `ref-${input.applicationId}` }));
  saveImportCursor.mockReset();
  touchPostedDistribution.mockReset();
  listPostedDistributionsForSweep.mockReset();
});

describe('which boards are importable', () => {
  it('declares an applicants mapping on exactly the boards whose list action can be driven', () => {
    const importable = HIRING_CONNECTORS.filter((m) => importAction(m.actions)).map((m) => m.key).sort();
    expect(importable).toEqual(['ashby-postings', 'greenhouse-job-board', 'job-feed', 'lever-postings', 'workable']);
  });

  it('reads Lever through list_opportunities and the rest through list_applications', () => {
    expect(importAction(manifest('lever-postings').actions)?.key).toBe('list_opportunities');
    expect(importAction(manifest('workable').actions)?.key).toBe('list_applications');
    expect(importAction(manifest('indeed-jobs').actions)).toBeNull();
    expect(importAction(manifest('linkedin-jobs').actions)).toBeNull();
  });

  it('every importable board names the board person id, so erasure is per person', () => {
    for (const m of HIRING_CONNECTORS) {
      const action = importAction(m.actions);
      if (action) expect(action.applicants.candidateId?.length, m.key).toBeGreaterThan(0);
    }
  });
});

describe('pageInput and the cursor', () => {
  const greenhouse = importAction(manifest('greenhouse-job-board').actions)!.applicants;
  const lever = importAction(manifest('lever-postings').actions)!.applicants;

  it('sends the board posting id under the declared param, and pages only when declared', () => {
    expect(pageInput(greenhouse, '4012', 2)).toEqual({ job_id: '4012', page: 2, per_page: 100 });
    expect(pageInput(importAction(manifest('workable').actions)!.applicants, 'ABC123', 1)).toEqual({ shortcode: 'ABC123' });
  });

  it('adds the saved cursor under the declared param, in the format the board wants', () => {
    expect(pageInput(greenhouse, '1', 1, '2026-10-01T00:00:00.000Z')).toMatchObject({ created_after: '2026-10-01T00:00:00.000Z' });
    expect(pageInput(lever, '1', 1, '2026-10-01T00:00:00.000Z')).toMatchObject({ updated_at_start: String(Date.UTC(2026, 9, 1)) });
    expect(cursorValue(lever, 'not a date')).toBeNull();
    expect(cursorValue(lever, null)).toBeNull();
  });

  it('computes the next cursor from the newest applicant, minus the safety margin', () => {
    const seen = [
      { externalId: '1', appliedAt: new Date('2026-10-01T00:00:10.000Z') },
      { externalId: '2', appliedAt: new Date('2026-10-01T00:00:30.000Z') },
      { externalId: '3', appliedAt: null },
    ];
    expect(nextCursor(greenhouse, seen)).toBe('2026-10-01T00:00:29.000Z');
    expect(nextCursor(greenhouse, [])).toBeNull();
    expect(nextCursor({ ...greenhouse, cursorFrom: 'id' }, [{ externalId: '7', appliedAt: null }, { externalId: '12', appliedAt: null }])).toBe('12');
    // No cursor declared ⇒ none computed.
    const { cursorParam: _drop, ...noCursor } = greenhouse;
    expect(nextCursor(noCursor, seen)).toBeNull();
  });
});

describe('a run is bounded per ITEM, not per page', () => {
  it('stops mid-page at the cap, says more is pending, and does not advance the cursor', async () => {
    const { execute } = executing([candidates(10)]);
    const outcome = await importFromDistribution(DB, ENV, row(), { maxApplicants: 3, actorKind: 'user' }, { execute });
    expect(outcome.fetched).toBe(3);
    expect(recordApplication).toHaveBeenCalledTimes(3);
    expect(outcome.more).toBe(true);
    expect(saveImportCursor).not.toHaveBeenCalled();
  });

  it('a complete run under the cap saves the cursor and is not "more"', async () => {
    const { execute } = executing([candidates(4)]);
    const outcome = await importFromDistribution(DB, ENV, row(), { maxApplicants: 50, actorKind: 'system' }, { execute });
    expect(outcome).toMatchObject({ fetched: 4, imported: 4, more: false, error: null, failedApplicants: 0 });
    expect(saveImportCursor).toHaveBeenCalledTimes(1);
    expect(saveImportCursor.mock.calls[0]![2]).toBe(new Date(Date.UTC(2026, 9, 1, 0, 0, 3) - 1000).toISOString());
  });

  it('asks the board only for people newer than the saved cursor', async () => {
    const { execute, mock } = executing([[]]);
    await importFromDistribution(DB, ENV, row({ importCursor: '2026-10-01T00:00:00.000Z' }), { maxApplicants: 50, actorKind: 'system' }, { execute });
    expect(mock.mock.calls[0]![0]).toMatchObject({ input: { shortcode: 'SHORT', created_after: '2026-10-01T00:00:00.000Z' }, actorKind: 'system' });
  });

  it('pages a board that declares paging until a short page, capped at MAX_PAGES_PER_BOARD', async () => {
    const full = importAction(manifest('greenhouse-job-board').actions)!.applicants.page!.size!;
    const greenhouseRow = row({ connectorKey: 'greenhouse-job-board', externalId: '4012' });
    const shortRun = executing([candidates(full), candidates(2, full)]);
    const a = await importFromDistribution(DB, ENV, greenhouseRow, { maxApplicants: 10_000, actorKind: 'system' }, { execute: shortRun.execute });
    expect(shortRun.mock).toHaveBeenCalledTimes(2);
    expect(a.more).toBe(false);

    const endless = executing([candidates(full)]);
    const b = await importFromDistribution(DB, ENV, greenhouseRow, { maxApplicants: 10_000, actorKind: 'system' }, { execute: endless.execute });
    expect(endless.mock).toHaveBeenCalledTimes(MAX_PAGES_PER_BOARD);
    expect(b.more).toBe(true);
  });
});

describe('one bad applicant never aborts a board', () => {
  it('counts the failure, imports the rest, and keeps the cursor where it was', async () => {
    recordApplication
      .mockResolvedValueOnce({ created: true, applicationId: 1 })
      .mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }))
      .mockResolvedValue({ created: true, applicationId: 3 });
    const { execute } = executing([candidates(3)]);
    const outcome = await importFromDistribution(DB, ENV, row(), { maxApplicants: 50, actorKind: 'system' }, { execute });
    expect(outcome).toMatchObject({ fetched: 3, imported: 2, failedApplicants: 1, error: null });
    expect(saveImportCursor).not.toHaveBeenCalled();
  });

  it('does not import an erased person, and does not count them as a failure', async () => {
    admitBoardCandidate.mockResolvedValueOnce({ admitted: false, candidateRef: 'erased' });
    const { execute } = executing([candidates(2)]);
    const outcome = await importFromDistribution(DB, ENV, row(), { maxApplicants: 50, actorKind: 'system' }, { execute });
    expect(outcome).toMatchObject({ fetched: 2, imported: 1, failedApplicants: 0 });
  });

  it('loads the board catalog ONCE and hands it to every application', async () => {
    const { execute } = executing([candidates(3)]);
    await importFromDistribution(DB, ENV, row(), { maxApplicants: 50, actorKind: 'system' }, { execute });
    const catalogs = recordApplication.mock.calls.map((call) => (call[2] as { boards: unknown }).boards);
    expect(new Set(catalogs).size).toBe(1);
  });
});

describe('the sweep rotates a row BEFORE it imports it', () => {
  it('touches first, so a crash cannot pin the row to the front of the queue', async () => {
    listPostedDistributionsForSweep.mockResolvedValueOnce([row()]);
    const { execute } = executing([candidates(1)]);
    // The sweep's second pass (link finding) reads the same worklist; give it nothing.
    listPostedDistributionsForSweep.mockResolvedValueOnce([]);
    const original = recordApplication.getMockImplementation();
    recordApplication.mockImplementation(async () => { calls.push('import'); return { created: true, applicationId: 1 }; });
    const result = await runApplicantImportSweep(DB, ENV, { execute });
    expect(calls.slice(0, 2)).toEqual(['touch', 'import']);
    expect(result).toMatchObject({ checked: 1, imported: 1, failed: 0 });
    if (original) recordApplication.mockImplementation(original);
  });
});

describe('mapApplicant', () => {
  it('reads a Workable candidate, including the person id', () => {
    const applicant = mapApplicant(importAction(manifest('workable').actions)!.applicants, {
      id: 'c9', name: 'Ada Lovelace', email: 'Ada@Example.com', created_at: '2026-10-01T09:00:00Z', job: { shortcode: 'ABC' },
    });
    expect(applicant).toEqual({
      externalId: 'c9', candidateId: 'c9', name: 'Ada Lovelace', email: 'ada@example.com', appliedAt: new Date('2026-10-01T09:00:00Z'),
    });
  });

  it('reads the person id apart from the application id where the board has both', () => {
    const greenhouse = mapApplicant(importAction(manifest('greenhouse-job-board').actions)!.applicants, { id: 7, candidate_id: 90 });
    expect(greenhouse).toMatchObject({ externalId: '7', candidateId: '90' });
    const lever = mapApplicant(importAction(manifest('lever-postings').actions)!.applicants, { id: 'o1', contact: 'ct1', name: 'Grace', emails: ['g@x.test'], createdAt: 1790000000000 });
    expect(lever).toMatchObject({ externalId: 'o1', candidateId: 'ct1' });
    expect(lever?.appliedAt?.getTime()).toBe(1790000000000);
    const ashby = mapApplicant(importAction(manifest('ashby-postings').actions)!.applicants, {
      id: 'a1', createdAt: '2026-10-02T00:00:00Z', candidate: { id: 'cn1', name: 'Linus', primaryEmailAddress: { value: 'l@x.test' } },
    });
    expect(ashby).toMatchObject({ externalId: 'a1', candidateId: 'cn1', name: 'Linus', email: 'l@x.test' });
  });

  it('joins first and last name when only those are given', () => {
    const applicant = mapApplicant(importAction(manifest('greenhouse-job-board').actions)!.applicants, { id: 7, candidate: { first_name: 'A', last_name: 'B' } });
    expect(applicant).toMatchObject({ externalId: '7', name: 'A B', email: null, appliedAt: null });
  });

  it('drops an item with no id (it could not be deduped) and a malformed email', () => {
    const mapping = importAction(manifest('workable').actions)!.applicants;
    expect(mapApplicant(mapping, { name: 'No Id' })).toBeNull();
    expect(mapApplicant(mapping, { id: 'x', email: 'not-an-email' })?.email).toBeNull();
  });
});

describe('parseAppliedAt', () => {
  it('accepts ISO, epoch seconds and epoch milliseconds, and rejects junk', () => {
    expect(parseAppliedAt('1790000000')?.getTime()).toBe(1790000000000);
    expect(parseAppliedAt('2026-10-01')?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(parseAppliedAt('soon')).toBeNull();
    expect(parseAppliedAt(null)).toBeNull();
  });
});
