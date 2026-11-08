/**
 * The applicant import: what a manifest says to read (pure), and how a run behaves —
 * caps counted per item under a shared budget, paging, the cursor for ascending and
 * descending boards, the job guard, one bad applicant not pinning the cursor, and the
 * sweep rotating a row BEFORE it imports it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { HIRING_CONNECTORS } from '../connectors/defaults/hiring';
import { mapApplicant, parseAppliedAt } from '../connectors/connectorApplicantMapping';
import type { ConnectorManifest } from '../connectors/connectorManifest';

const calls: string[] = [];
const recordApplication = vi.fn();
const admitBoardCandidate = vi.fn();
const saveImportState = vi.fn();
const touchPostedDistribution = vi.fn();
const listPostedDistributionsForSweep = vi.fn();
const readPostedDistributions = vi.fn();
const resolveDistributionUrl = vi.fn();

/** A newest-first board WITH a page number: Greenhouse's shape, declared descending. */
const descendingBoard = (): ConnectorManifest => {
  const base = HIRING_CONNECTORS.find((m) => m.key === 'greenhouse-job-board')!;
  return {
    ...base,
    key: 'desc-board',
    actions: base.actions.map((a) => (a.key === 'list_applications' && a.applicants
      ? { ...a, applicants: { ...a.applicants, order: 'desc' as const } } : a)),
  };
};

vi.mock('../connectors/connectorRegistry', () => ({
  resolveConnector: vi.fn(async (_db: unknown, _tenant: number, key: string) => {
    const manifest = key === 'desc-board' ? descendingBoard() : HIRING_CONNECTORS.find((m) => m.key === key);
    return manifest ? { manifest, status: 'published' } : null;
  }),
}));
vi.mock('./applications', () => ({ recordApplication: (...args: unknown[]) => recordApplication(...args) }));
vi.mock('./boardCandidate', () => ({
  admitBoardCandidate: (...args: unknown[]) => admitBoardCandidate(...args),
  boardCandidateRefs: vi.fn(async () => ({ primary: 'p', all: ['p'] })),
  candidateRefKey: () => 'key',
  loadRoleIndex: vi.fn(async () => new Map()),
}));
vi.mock('./postingDistributionStore', () => ({ readPostingBoardCatalog: vi.fn(async () => []) }));
vi.mock('./postingDistributionSweepStore', () => ({
  listPostedDistributionsForSweep: (...args: unknown[]) => listPostedDistributionsForSweep(...args),
  readPostedDistributions: (...args: unknown[]) => readPostedDistributions(...args),
  saveImportState: (...args: unknown[]) => saveImportState(...args),
  touchPostedDistribution: (...args: unknown[]) => { calls.push('touch'); return touchPostedDistribution(...args); },
}));
vi.mock('./resolveBoardUrls', () => ({
  resolveDistributionUrl: (...args: unknown[]) => resolveDistributionUrl(...args),
  runUrlResolutionPass: vi.fn(async () => ({ checked: 0, linked: 0 })),
}));
vi.mock('./postingDistributionSupport', () => ({ requirePosting: vi.fn(async () => ({ id: 'p1' })) }));

import {
  IMPORTABLE_BOARD_KEYS,
  MANUAL_APPLICANT_BUDGET,
  MAX_APPLICANTS_PER_BOARD,
  MAX_MANUAL_URL_RESOLUTIONS,
  MAX_PAGES_PER_BOARD,
  importAction,
  importBoardApplicants,
  importFromDistribution,
  runApplicantImportSweep,
} from './importBoardApplicants';
import {
  belongsToPosting,
  cursorValue,
  decodePending,
  encodePending,
  failurePin,
  nextCursor,
  pageInput,
} from './importCursor';
import type { PostedDistribution } from './postingDistributionSweepStore';

const manifest = (key: string) => HIRING_CONNECTORS.find((m) => m.key === key)!;
const mappingOf = (key: string) => importAction(manifest(key).actions)!.applicants;
const ENV = {} as Env;
const DB = {} as never;
const ISO = (second: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, second)).toISOString();

const row = (over: Partial<PostedDistribution> = {}): PostedDistribution => ({
  tenantId: 1, postingId: 'p1', connectorKey: 'ashby-postings', connectionId: 'c1', externalId: 'JOB', url: null,
  importCursor: null, importResumePage: null, importPendingCursor: null, importFailures: {}, ...over,
});

/** Ashby-shaped applications for job `job`, `count` of them from second `from`. */
const ashby = (count: number, from = 0, job = 'JOB') => Array.from({ length: count }, (_, i) => ({
  id: `app-${from + i}`, createdAt: ISO(from + i), job: { id: job },
  candidate: { id: `cand-${from + i}`, name: `Person ${from + i}`, primaryEmailAddress: { value: `p${from + i}@example.test` } },
}));
/** Workable-shaped candidates. */
const workable = (count: number, from = 0) => Array.from({ length: count }, (_, i) => ({
  id: `w-${from + i}`, name: `W ${from + i}`, created_at: ISO(from + i), job: { shortcode: 'SHORT' },
}));
/** Greenhouse-shaped applications. */
const greenhouse = (count: number, from = 0) => Array.from({ length: count }, (_, i) => ({
  id: from + i, candidate_id: 9000 + from + i, applied_at: ISO(from + i), jobs: [{ id: 4012 }],
}));

const executing = (pages: unknown[][]) => {
  let page = 0;
  const mock = vi.fn(async (..._args: unknown[]) => ({ ok: true, status: 200, data: pages[Math.min(page++, pages.length - 1)], durationMs: 1 }));
  return { execute: mock as never, mock };
};
const run = (maxPerBoard = 1000, remaining = 100_000) => ({ budget: { remaining }, maxPerBoard, actorKind: 'system' as const });
const savedState = () => saveImportState.mock.calls.at(-1)?.[2] as { cursor?: string; resumePage: number | null; pendingCursor: string | null; failures: Record<string, number> } | undefined;

beforeEach(() => {
  calls.length = 0;
  recordApplication.mockReset().mockResolvedValue({ created: true, applicationId: 1 });
  admitBoardCandidate.mockReset().mockImplementation(async (_db: unknown, input: { applicationId: string }) => ({ admitted: true, candidateRef: `ref-${input.applicationId}` }));
  saveImportState.mockReset().mockResolvedValue(undefined);
  touchPostedDistribution.mockReset().mockResolvedValue(undefined);
  listPostedDistributionsForSweep.mockReset().mockResolvedValue([]);
  readPostedDistributions.mockReset().mockResolvedValue([]);
  resolveDistributionUrl.mockReset().mockResolvedValue('unresolved');
});

describe('which boards are importable, and how they are declared', () => {
  it('declares an applicants mapping on exactly the boards whose list action can be driven', () => {
    const importable = HIRING_CONNECTORS.filter((m) => importAction(m.actions)).map((m) => m.key).sort();
    expect(importable).toEqual(['ashby-postings', 'greenhouse-job-board', 'job-feed', 'lever-postings', 'workable']);
    expect([...IMPORTABLE_BOARD_KEYS].sort()).toEqual(importable);
    expect(IMPORTABLE_BOARD_KEYS).not.toContain('indeed-jobs');
  });

  it('reads Lever through list_opportunities and the rest through list_applications', () => {
    expect(importAction(manifest('lever-postings').actions)?.key).toBe('list_opportunities');
    expect(importAction(manifest('workable').actions)?.key).toBe('list_applications');
    expect(importAction(manifest('indeed-jobs').actions)).toBeNull();
    expect(importAction(manifest('linkedin-jobs').actions)).toBeNull();
  });

  it('every importable board names the person, the job, the order and its page size', () => {
    for (const m of HIRING_CONNECTORS) {
      const action = importAction(m.actions);
      if (!action) continue;
      const a = action.applicants;
      expect(a.candidateId?.length, `${m.key} candidateId`).toBeGreaterThan(0);
      expect(a.postingIdField?.length, `${m.key} postingIdField`).toBeGreaterThan(0);
      expect(a.order, `${m.key} order`).toMatch(/^(asc|desc)$/);
      // Paged by number, or one `limit` per call — never a board with neither.
      expect(Boolean(a.page || a.limit), `${m.key} paging`).toBe(true);
    }
  });

  it('Ashby is declared in its camelCase RPC form, the cursor in epoch ms', () => {
    const action = manifest('ashby-postings').actions.find((a) => a.key === 'list_applications')!;
    expect(Object.keys(action.params)).toEqual(expect.arrayContaining(['jobId', 'createdAfter', 'limit']));
    expect(action.params).not.toHaveProperty('job_id');
    expect(action.params).not.toHaveProperty('created_after');
    // Epoch ms goes as a NUMBER: Ashby's JSON body wants 1790…, not "1790…".
    expect(pageInput(mappingOf('ashby-postings'), 'JOB', 1, ISO(10))).toEqual({
      jobId: 'JOB', limit: 100, createdAfter: Date.UTC(2026, 9, 1, 0, 0, 10),
    });
  });
});

describe('pageInput, the cursor and the job guard (pure)', () => {
  it('sends the board posting id, pages by number or by limit, and the cursor in the board’s format', () => {
    expect(pageInput(mappingOf('greenhouse-job-board'), '4012', 2)).toEqual({ job_id: '4012', page: 2, per_page: 100 });
    expect(pageInput(mappingOf('workable'), 'ABC', 1)).toEqual({ shortcode: 'ABC', limit: 100 });
    expect(pageInput(mappingOf('greenhouse-job-board'), '1', 1, ISO(5))).toMatchObject({ created_after: ISO(5) });
    expect(pageInput(mappingOf('lever-postings'), '1', 1, ISO(5))).toMatchObject({ updated_at_start: Date.UTC(2026, 9, 1, 0, 0, 5) });
    expect(cursorValue(mappingOf('lever-postings'), 'not a date')).toBeNull();
  });

  it('nextCursor: the newest seen less the margin, held back to just before the oldest failure', () => {
    const m = mappingOf('greenhouse-job-board');
    const seen = [{ externalId: '1', appliedAt: new Date(ISO(10)) }, { externalId: '2', appliedAt: new Date(ISO(30)) }];
    expect(nextCursor(m, seen)).toBe(ISO(29));
    expect(nextCursor(m, seen, [{ externalId: '1', appliedAt: new Date(ISO(10)) }])).toBe(new Date(Date.parse(ISO(10)) - 1).toISOString());
    // A failed person with no date proves nothing about where they sit: the cursor stays.
    expect(nextCursor(m, seen, [{ externalId: '9', appliedAt: null }])).toBeNull();
    expect(failurePin(m, [{ externalId: '9', appliedAt: null }])).toBe('blocked');
    expect(nextCursor(m, [])).toBeNull();
    expect(nextCursor({ ...m, cursorFrom: 'id' }, [{ externalId: '7', appliedAt: null }, { externalId: '12', appliedAt: null }])).toBe('12');
  });

  it('a newest-first walk’s unfinished state round-trips', () => {
    expect(decodePending(encodePending(1790, 1700))).toEqual({ newest: 1790, pin: 1700 });
    expect(decodePending(encodePending(1790, null))).toEqual({ newest: 1790, pin: null });
    expect(decodePending(null)).toEqual({ newest: null, pin: null });
  });

  it('belongsToPosting drops an item that names a DIFFERENT job and keeps one that names none', () => {
    const m = mappingOf('ashby-postings');
    expect(belongsToPosting(m, { job: { id: 'JOB' } }, 'JOB')).toBe(true);
    expect(belongsToPosting(m, { job: { id: 'OTHER' } }, 'JOB')).toBe(false);
    expect(belongsToPosting(m, { id: 'x' }, 'JOB')).toBe(true);
    expect(belongsToPosting(mappingOf('greenhouse-job-board'), { jobs: [{ id: 99 }] }, '4012')).toBe(false);
    expect(belongsToPosting(mappingOf('greenhouse-job-board'), { jobs: [{ id: 4012 }] }, '4012')).toBe(true);
  });
});

describe('an ASCENDING board', () => {
  it('moves the cursor to the newest person seen even when a cap stopped the run mid-page', async () => {
    const { execute } = executing([ashby(10)]);
    const outcome = await importFromDistribution(DB, ENV, row(), run(3), { execute });
    expect(outcome).toMatchObject({ fetched: 3, more: true });
    expect(recordApplication).toHaveBeenCalledTimes(3);
    expect(savedState()?.cursor).toBe(ISO(1)); // the third person is second 2, less the 1s margin
  });

  it('a page-less board’s FULL page sets more, is not exhausted, and still moves the cursor', async () => {
    const { execute, mock } = executing([ashby(100)]);
    const outcome = await importFromDistribution(DB, ENV, row(), run(), { execute });
    expect(mock).toHaveBeenCalledTimes(1); // one page per run
    expect(outcome.more).toBe(true);
    expect(savedState()?.cursor).toBe(ISO(98)); // second 99, less the margin
  });

  it('a SHORT page is exhaustion: not more', async () => {
    const { execute } = executing([ashby(4)]);
    const outcome = await importFromDistribution(DB, ENV, row(), run(), { execute });
    expect(outcome).toMatchObject({ fetched: 4, imported: 4, more: false, error: null });
  });

  it('asks only for people newer than the saved cursor, never moves it backwards', async () => {
    const { execute, mock } = executing([ashby(2, 0)]);
    await importFromDistribution(DB, ENV, row({ importCursor: ISO(500) }), run(), { execute });
    expect(mock.mock.calls[0]![0]).toMatchObject({ input: { jobId: 'JOB', createdAfter: Date.parse(ISO(500)) }, actorKind: 'system' });
    expect(saveImportState.mock.calls.filter((c) => (c[2] as { cursor?: string }).cursor !== undefined)).toHaveLength(0);
  });

  it('pages a board with a page number until a short page, capped at MAX_PAGES_PER_BOARD', async () => {
    const full = mappingOf('greenhouse-job-board').page!.size!;
    const ghRow = row({ connectorKey: 'greenhouse-job-board', externalId: '4012' });
    const shortRun = executing([greenhouse(full), greenhouse(2, full)]);
    const a = await importFromDistribution(DB, ENV, ghRow, run(), { execute: shortRun.execute });
    expect(shortRun.mock).toHaveBeenCalledTimes(2);
    expect(a.more).toBe(false);

    const endless = executing([greenhouse(full)]);
    const b = await importFromDistribution(DB, ENV, ghRow, run(), { execute: endless.execute });
    expect(endless.mock).toHaveBeenCalledTimes(MAX_PAGES_PER_BOARD);
    expect(b.more).toBe(true);
  });
});

describe('a DESCENDING board', () => {
  it('a page-less board’s full page sets more and does NOT move the cursor', async () => {
    const { execute, mock } = executing([workable(100)]);
    const outcome = await importFromDistribution(DB, ENV, row({ connectorKey: 'workable', externalId: 'SHORT' }), run(), { execute });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(outcome.more).toBe(true);
    expect(saveImportState.mock.calls.some((c) => (c[2] as { cursor?: string }).cursor !== undefined)).toBe(false);
  });

  it('a short page ends the walk: the cursor moves to the newest person seen', async () => {
    const { execute } = executing([workable(5)]);
    const outcome = await importFromDistribution(DB, ENV, row({ connectorKey: 'workable', externalId: 'SHORT' }), run(), { execute });
    expect(outcome.more).toBe(false);
    expect(savedState()?.cursor).toBe(ISO(3)); // second 4, less the margin
  });

  it('a capped walk saves a resume page and the newest seen; the next run resumes there and finishes', async () => {
    const full = mappingOf('greenhouse-job-board').page!.size!;
    const ghRow = row({ connectorKey: 'desc-board', externalId: '4012' });
    const endless = executing([greenhouse(full, 50)]);
    const first = await importFromDistribution(DB, ENV, ghRow, run(), { execute: endless.execute });
    expect(first.more).toBe(true);
    const mid = savedState()!;
    expect(mid.cursor).toBeUndefined(); // not moved: only the newest have been seen
    expect(mid.resumePage).toBe(1 + MAX_PAGES_PER_BOARD);
    expect(decodePending(mid.pendingCursor).newest).toBe(Date.parse(ISO(50 + full - 1)));

    saveImportState.mockClear();
    const resumed = executing([greenhouse(3, 0)]);
    const second = await importFromDistribution(
      DB, ENV, { ...ghRow, importResumePage: mid.resumePage, importPendingCursor: mid.pendingCursor }, run(), { execute: resumed.execute },
    );
    expect(second.more).toBe(false);
    expect(resumed.mock.mock.calls[0]![0]).toMatchObject({ input: { page: mid.resumePage } }); // continued, not restarted
    const done = savedState()!;
    expect(done.cursor).toBe(ISO(50 + full - 2)); // the newest of the WHOLE walk, less the margin
    expect(done.resumePage).toBeNull();
    expect(done.pendingCursor).toBeNull();
  });
});

describe('the job guard', () => {
  it('drops and counts an item that names a different job, and does not let it move the cursor', async () => {
    const mixed = [...ashby(2, 0), ...ashby(2, 100, 'OTHER-JOB')];
    const { execute } = executing([mixed]);
    const outcome = await importFromDistribution(DB, ENV, row(), run(), { execute });
    expect(outcome).toMatchObject({ fetched: 4, imported: 2, mismatched: 2 });
    expect(recordApplication).toHaveBeenCalledTimes(2);
    expect(savedState()?.cursor).toBe(ISO(0)); // second 1, less the margin — not the other job's second 101
  });
});

describe('one bad applicant does not pin the cursor', () => {
  const failSecond = () => recordApplication
    .mockResolvedValueOnce({ created: true, applicationId: 1 })
    .mockRejectedValueOnce(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }))
    .mockResolvedValue({ created: true, applicationId: 3 });

  it('advances to just before the oldest failure, counts it, and carries on with the rest', async () => {
    failSecond();
    const { execute } = executing([ashby(4)]);
    const outcome = await importFromDistribution(DB, ENV, row(), run(), { execute });
    expect(outcome).toMatchObject({ fetched: 4, imported: 3, failedApplicants: 1 });
    const state = savedState()!;
    expect(state.failures).toEqual({ 'app-1': 1 });
    expect(state.cursor).toBe(new Date(Date.parse(ISO(1)) - 1).toISOString());
  });

  it('quarantines a person after three failures: counted on the row, skipped, and no longer a pin', async () => {
    recordApplication.mockImplementation(async (_db: unknown, _env: unknown, input: { externalId: string }) => {
      if (input.externalId === 'app-1') throw new Error('malformed');
      return { created: true, applicationId: 1 };
    });
    const third = await importFromDistribution(DB, ENV, row({ importFailures: { 'app-1': 2 } }), run(), { execute: executing([ashby(4)]).execute });
    expect(third.failedApplicants).toBe(1);
    expect(savedState()?.failures['app-1']).toBe(3);
    expect(savedState()?.cursor).toBe(ISO(2)); // the third failure no longer pins the cursor

    recordApplication.mockClear();
    const next = await importFromDistribution(DB, ENV, row({ importFailures: { 'app-1': 3 } }), run(), { execute: executing([ashby(4)]).execute });
    expect(next).toMatchObject({ quarantined: 1, failedApplicants: 0, imported: 3 });
  });

  it('does not import an erased person and does not count them as a failure', async () => {
    admitBoardCandidate.mockResolvedValueOnce({ admitted: false, candidateRef: 'erased' });
    const outcome = await importFromDistribution(DB, ENV, row(), run(), { execute: executing([ashby(2)]).execute });
    expect(outcome).toMatchObject({ fetched: 2, imported: 1, failedApplicants: 0 });
  });

  it('loads the board catalog ONCE and hands it to every application', async () => {
    await importFromDistribution(DB, ENV, row(), run(), { execute: executing([ashby(3)]).execute });
    const catalogs = recordApplication.mock.calls.map((call) => (call[2] as { boards: unknown }).boards);
    expect(new Set(catalogs).size).toBe(1);
  });
});

describe('the budget is global, per item, and stops cleanly', () => {
  it('two boards share one budget: the second gets what is left and reports more', async () => {
    const budget = { remaining: 5 };
    const a = await importFromDistribution(DB, ENV, row(), { budget, maxPerBoard: 100, actorKind: 'system' }, { execute: executing([ashby(4)]).execute });
    const b = await importFromDistribution(DB, ENV, row({ postingId: 'p2' }), { budget, maxPerBoard: 100, actorKind: 'system' }, { execute: executing([ashby(4)]).execute });
    expect(a).toMatchObject({ fetched: 4, more: false });
    expect(b).toMatchObject({ fetched: 1, more: true });
    expect(budget.remaining).toBe(0);
  });

  it('the manual request has a smaller budget than the sweep, and defers the boards it cannot reach', async () => {
    expect(MANUAL_APPLICANT_BUDGET).toBeLessThan(MAX_APPLICANTS_PER_BOARD);
    readPostedDistributions.mockResolvedValue([
      row({ connectorKey: 'ashby-postings' }),
      row({ connectorKey: 'workable', externalId: 'SHORT' }),
    ]);
    const { execute, mock } = executing([ashby(MANUAL_APPLICANT_BUDGET + 50)]);
    const result = await importBoardApplicants(DB, ENV, 1, 'p1', { execute });
    expect(mock).toHaveBeenCalledTimes(1); // the second board was never called
    expect(result.boards[0]).toMatchObject({ fetched: MANUAL_APPLICANT_BUDGET, more: true });
    expect(result.boards[1]).toMatchObject({ fetched: 0, more: true });
    expect(result.more).toBe(true);
  });

  it('a press of the button finds links for only a few rows', async () => {
    readPostedDistributions.mockResolvedValue(Array.from({ length: 6 }, (_, i) => row({ postingId: `p${i}` })));
    await importBoardApplicants(DB, ENV, 1, 'p1', { execute: executing([[]]).execute });
    expect(resolveDistributionUrl).toHaveBeenCalledTimes(MAX_MANUAL_URL_RESOLUTIONS);
  });
});

describe('the sweep', () => {
  it('asks only for importable boards, and touches a row BEFORE it imports it', async () => {
    listPostedDistributionsForSweep.mockResolvedValueOnce([row()]);
    recordApplication.mockImplementation(async () => { calls.push('import'); return { created: true, applicationId: 1 }; });
    const result = await runApplicantImportSweep(DB, ENV, { execute: executing([ashby(1)]).execute });
    expect(listPostedDistributionsForSweep).toHaveBeenCalledWith(DB, expect.any(Number), { connectorKeys: IMPORTABLE_BOARD_KEYS });
    expect(calls.slice(0, 2)).toEqual(['touch', 'import']);
    expect(result).toMatchObject({ checked: 1, imported: 1, failed: 0, more: false });
  });
});

describe('mapApplicant', () => {
  it('reads a Workable candidate, including the person id', () => {
    const applicant = mapApplicant(mappingOf('workable'), {
      id: 'c9', name: 'Ada Lovelace', email: 'Ada@Example.com', created_at: '2026-10-01T09:00:00Z', job: { shortcode: 'ABC' },
    });
    expect(applicant).toEqual({
      externalId: 'c9', candidateId: 'c9', name: 'Ada Lovelace', email: 'ada@example.com', appliedAt: new Date('2026-10-01T09:00:00Z'),
    });
  });

  it('reads the person id apart from the application id where the board has both', () => {
    expect(mapApplicant(mappingOf('greenhouse-job-board'), { id: 7, candidate_id: 90 })).toMatchObject({ externalId: '7', candidateId: '90' });
    const lever = mapApplicant(mappingOf('lever-postings'), { id: 'o1', contact: 'ct1', name: 'Grace', emails: ['g@x.test'], createdAt: 1790000000000 });
    expect(lever).toMatchObject({ externalId: 'o1', candidateId: 'ct1' });
    expect(lever?.appliedAt?.getTime()).toBe(1790000000000);
    expect(mapApplicant(mappingOf('ashby-postings'), {
      id: 'a1', createdAt: '2026-10-02T00:00:00Z', candidate: { id: 'cn1', name: 'Linus', primaryEmailAddress: { value: 'l@x.test' } },
    })).toMatchObject({ externalId: 'a1', candidateId: 'cn1', name: 'Linus', email: 'l@x.test' });
  });

  it('joins first and last name; drops an item with no id; ignores a malformed email', () => {
    expect(mapApplicant(mappingOf('greenhouse-job-board'), { id: 7, candidate: { first_name: 'A', last_name: 'B' } }))
      .toMatchObject({ externalId: '7', name: 'A B', email: null, appliedAt: null });
    expect(mapApplicant(mappingOf('workable'), { name: 'No Id' })).toBeNull();
    expect(mapApplicant(mappingOf('workable'), { id: 'x', email: 'not-an-email' })?.email).toBeNull();
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
