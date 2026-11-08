/**
 * Regression tests for the third review of the board-applicant import: a backlog that
 * needs more than one run (token paging), the Ashby filter id, a page that shares one
 * second, the quarantine cap, tenant-authored boards in the sweep, the query budget and the
 * lease that keeps two imports of one row from clobbering each other's state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { HIRING_CONNECTORS } from '../connectors/defaults/hiring';
import type { ConnectorManifest } from '../connectors/connectorManifest';

const recordApplication = vi.fn();
const admitBoardCandidate = vi.fn();
const saveImportState = vi.fn();
const saveBoardFilterId = vi.fn();
const touchPostedDistribution = vi.fn();
const listPostedDistributionsForSweep = vi.fn();
const listTenantBoardKeys = vi.fn();
const listConnectorsForTenant = vi.fn();

const ACME: ConnectorManifest = {
  ...HIRING_CONNECTORS.find((m) => m.key === 'ashby-postings')!,
  key: 'acme-ats',
};

vi.mock('../connectors/connectorRegistry', () => ({
  resolveConnector: vi.fn(async (_db: unknown, _tenant: number, key: string) => {
    const manifest = key === 'acme-ats' ? ACME : HIRING_CONNECTORS.find((m) => m.key === key);
    return manifest ? { manifest, status: 'published' } : null;
  }),
  listConnectorsForTenant: (...args: unknown[]) => listConnectorsForTenant(...args),
}));
vi.mock('./applications', () => ({ recordApplication: (...args: unknown[]) => recordApplication(...args) }));
vi.mock('./boardCandidate', () => ({
  admitBoardCandidate: (...args: unknown[]) => admitBoardCandidate(...args),
  boardCandidateRefs: vi.fn(async () => ({ primary: 'p', all: ['p'] })),
  candidateRefKey: async () => 'key',
  loadRoleIndex: vi.fn(async () => new Map()),
}));
vi.mock('./postingDistributionStore', () => ({ readPostingBoardCatalog: vi.fn(async () => []) }));
vi.mock('./postingDistributionSweepStore', () => ({
  listPostedDistributionsForSweep: (...args: unknown[]) => listPostedDistributionsForSweep(...args),
  listTenantBoardKeys: (...args: unknown[]) => listTenantBoardKeys(...args),
  readPostedDistributions: vi.fn(async () => []),
  saveImportState: (...args: unknown[]) => saveImportState(...args),
  saveBoardFilterId: (...args: unknown[]) => saveBoardFilterId(...args),
  touchPostedDistribution: (...args: unknown[]) => touchPostedDistribution(...args),
}));
vi.mock('./resolveBoardUrls', () => ({
  resolveDistributionUrl: vi.fn(),
  runUrlResolutionPass: vi.fn(async () => ({ checked: 0, linked: 0 })),
}));
vi.mock('./postingDistributionSupport', () => ({ requirePosting: vi.fn(async () => ({ id: 'p1' })) }));

import { importFromDistribution, runApplicantImportSweep } from './importBoardApplicants';
import { pruneFailures, planImportState, belongsToPosting, nextTokenOf } from './importCursor';
import { QUERIES_PER_APPLICANT, QUERIES_PER_PAGE, QUERIES_PER_ROW } from './importBudget';
import { importAction } from './importWorklist';
import type { PostedDistribution } from './postingDistributionSweepStore';

const ENV = {} as Env;
const DB = {} as never;
const ISO = (second: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, second)).toISOString();
const mappingOf = (key: string) => importAction(HIRING_CONNECTORS.find((m) => m.key === key)!.actions)!.applicants;
const run = (maxPerBoard = 1000, extra: { queries?: number } = {}) =>
  ({ budget: { remaining: 100_000, ...extra }, maxPerBoard, actorKind: 'system' as const });

const row = (over: Partial<PostedDistribution> = {}): PostedDistribution => ({
  tenantId: 1, postingId: 'p1', connectorKey: 'ashby-postings', connectionId: 'c1', externalId: 'POSTING-1', url: null,
  importCursor: null, importResumePage: null, importResumeToken: null, importPendingCursor: null, importFailures: {},
  boardFilterId: null, ...over,
});

const ashbyApps = (count: number, job: string, second = (i: number) => i) => Array.from({ length: count }, (_, i) => ({
  id: `app-${i}`, createdAt: ISO(second(i)), job: { id: job },
  candidate: { id: `cand-${i}`, name: `P${i}`, primaryEmailAddress: { value: `p${i}@example.test` } },
}));

const lastSaved = () => saveImportState.mock.calls.at(-1)?.[2] as {
  cursor?: string; resumePage: number | null; resumeToken?: string | null; pendingCursor: string | null; failures: Record<string, number>;
} | undefined;

beforeEach(() => {
  recordApplication.mockReset().mockResolvedValue({ created: true, applicationId: 1 });
  admitBoardCandidate.mockReset().mockImplementation(async (_db: unknown, input: { applicationId: string }) => ({ admitted: true, candidateRef: `ref-${input.applicationId}` }));
  saveImportState.mockReset().mockResolvedValue(true);
  saveBoardFilterId.mockReset().mockResolvedValue(undefined);
  touchPostedDistribution.mockReset().mockResolvedValue(null);
  listPostedDistributionsForSweep.mockReset().mockResolvedValue([]);
  listTenantBoardKeys.mockReset().mockResolvedValue([]);
  listConnectorsForTenant.mockReset().mockResolvedValue([]);
});

describe('regression: a token-paged newest-first board finishes a backlog across runs', () => {
  const leverItem = (n: number) => ({ id: `opp-${n}`, contact: `ct-${n}`, name: `L${n}`, emails: [`l${n}@example.test`], createdAt: Date.UTC(2026, 9, 1, 12) - n * 1000, posting: 'POST' });
  const page = (from: number, count: number) => Array.from({ length: count }, (_, i) => leverItem(from + i));
  /** Three pages (100, 100, 30) chained by Lever's `next`; the request's `offset` picks the page. */
  const board = () => vi.fn(async (args: { input: Record<string, unknown> }) => {
    const offset = args.input.offset as string | undefined;
    if (!offset) return { ok: true, status: 200, durationMs: 1, data: page(0, 100), bodyFields: { next: 'T2' } };
    if (offset === 'T2') return { ok: true, status: 200, durationMs: 1, data: page(100, 100), bodyFields: { next: 'T3' } };
    return { ok: true, status: 200, durationMs: 1, data: page(200, 30) };
  });

  it('stores the board\'s own token at a cap, resumes from it, and clears it when the walk ends', async () => {
    const execute = board();
    const deps = { execute: execute as never };
    let current = row({ connectorKey: 'lever-postings', externalId: 'POST' });
    const imported: string[] = [];
    recordApplication.mockImplementation(async (_d: unknown, _e: unknown, input: { externalId: string }) => { imported.push(input.externalId); return { created: true }; });

    // Run 1: 100 per run — page 1 is read to the end, page 2 is fetched but the cap stops it first.
    const first = await importFromDistribution(DB, ENV, current, run(100), deps);
    expect(first).toMatchObject({ fetched: 100, more: true });
    expect(lastSaved()?.resumeToken).toBe('T2');
    expect(lastSaved()?.cursor).toBeUndefined(); // newest-first: the cursor waits for the walk to end
    expect(lastSaved()?.pendingCursor).toBeTruthy();

    current = { ...current, importResumeToken: lastSaved()!.resumeToken ?? null, importPendingCursor: lastSaved()!.pendingCursor };
    const second = await importFromDistribution(DB, ENV, current, run(100), deps);
    expect(execute.mock.calls[2]![0].input).toMatchObject({ offset: 'T2' }); // continued, not restarted
    expect(second).toMatchObject({ fetched: 100, more: true });
    expect(lastSaved()?.resumeToken).toBe('T3');

    current = { ...current, importResumeToken: 'T3', importPendingCursor: lastSaved()!.pendingCursor };
    const third = await importFromDistribution(DB, ENV, current, run(100), deps);
    expect(third).toMatchObject({ fetched: 30, more: false });
    expect(lastSaved()?.resumeToken).toBeNull(); // reached the end: the token is cleared…
    expect(lastSaved()?.cursor).toBeTruthy(); // …and the cursor finally moves
    expect(new Set(imported).size).toBe(230); // the whole backlog, every person once
  });

  it('a full page with no token is the end only if the board has given a token; otherwise it is unfinished', async () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: `w-${i}`, name: `W${i}`, created_at: ISO(i), job: { shortcode: 'SHORT' } }));
    const execute = vi.fn(async () => ({ ok: true, status: 200, durationMs: 1, data: items }));
    const never = await importFromDistribution(DB, ENV, row({ connectorKey: 'workable', externalId: 'SHORT' }), run(), { execute: execute as never });
    expect(never.more).toBe(true);
    expect(lastSaved()?.cursor).toBeUndefined(); // moving it could skip people not yet read

    // …whereas a walk resumed from a token knows the board hands them out: no token is the last page.
    const resumed = await importFromDistribution(DB, ENV, row({ connectorKey: 'workable', externalId: 'SHORT', importResumeToken: '77' }), run(), { execute: execute as never });
    expect(resumed.more).toBe(false);
    expect(lastSaved()?.cursor).toBeTruthy();
    expect(lastSaved()?.resumeToken).toBeNull();
  });

  it('takes the token out of a URL the board built, and never requests that URL', () => {
    const workable = mappingOf('workable');
    expect(nextTokenOf(workable, { 'paging.next': 'https://acme.workable.com/spi/v3/candidates?limit=100&since_id=77' })).toBe('77');
    expect(nextTokenOf(workable, { 'paging.next': 'not a url' })).toBeNull();
    expect(nextTokenOf(workable, undefined)).toBeNull();
    expect(nextTokenOf(mappingOf('lever-postings'), { next: 'abc' })).toBe('abc');
  });
});

describe('regression: Ashby filters applications by the JOB id, resolved once', () => {
  it('looks the job id up through jobPosting.info, caches it, uses it for the filter and the guard', async () => {
    const execute = vi.fn(async (args: { actionKey: string; input: Record<string, unknown> }) => (args.actionKey === 'get_posting'
      ? { ok: true, status: 200, durationMs: 1, data: { jobId: 'JOB-9', title: 'Engineer' } }
      : { ok: true, status: 200, durationMs: 1, data: ashbyApps(2, 'JOB-9') }));
    const outcome = await importFromDistribution(DB, ENV, row(), run(), { execute: execute as never });

    expect(outcome).toMatchObject({ fetched: 2, imported: 2, mismatched: 0, error: null });
    expect(execute.mock.calls[0]![0]).toMatchObject({ actionKey: 'get_posting', input: { jobPostingId: 'POSTING-1' } });
    expect(execute.mock.calls[1]![0]).toMatchObject({ actionKey: 'list_applications', input: { jobId: 'JOB-9' } });
    expect(saveBoardFilterId).toHaveBeenCalledTimes(1);
    expect(saveBoardFilterId.mock.calls[0]![2]).toBe('JOB-9');
  });

  it('does not look it up again once it is on the row', async () => {
    const execute = vi.fn(async () => ({ ok: true, status: 200, durationMs: 1, data: ashbyApps(2, 'JOB-9') }));
    await importFromDistribution(DB, ENV, row({ boardFilterId: 'JOB-9' }), run(), { execute: execute as never });
    await importFromDistribution(DB, ENV, row({ boardFilterId: 'JOB-9' }), run(), { execute: execute as never });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.every((call) => (call as unknown as [{ actionKey: string }])[0].actionKey === 'list_applications')).toBe(true);
    expect(saveBoardFilterId).not.toHaveBeenCalled();
  });

  it('imports nothing when the job id cannot be found, instead of filtering by the posting id', async () => {
    const execute = vi.fn(async () => ({ ok: true, status: 200, durationMs: 1, data: { title: 'no job id here' } }));
    const outcome = await importFromDistribution(DB, ENV, row(), run(), { execute: execute as never });
    expect(outcome.error).toMatch(/which job/);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(recordApplication).not.toHaveBeenCalled();
  });
});

describe('regression: a page that shares one second does not stall the cursor', () => {
  it('a board with no page to resume (Ashby) steps the cursor to the newest instant itself', async () => {
    // 100 people, all created in second 10; the cursor already sits at second 9 (newest − 1s).
    const execute = vi.fn(async () => ({ ok: true, status: 200, durationMs: 1, data: ashbyApps(100, 'JOB', () => 10) }));
    await importFromDistribution(DB, ENV, row({ boardFilterId: 'JOB', importCursor: ISO(9) }), run(), { execute: execute as never });
    expect(lastSaved()?.cursor).toBe(ISO(10));
  });

  it('a page-numbered board (Greenhouse) saves its page and resumes there, leaving the cursor', async () => {
    const same = () => Array.from({ length: 100 }, (_, i) => ({ id: i, candidate_id: 9000 + i, applied_at: ISO(10), jobs: [{ id: 4012 }] }));
    const execute = vi.fn(async () => ({ ok: true, status: 200, durationMs: 1, data: same() }));
    const stalled = row({ connectorKey: 'greenhouse-job-board', externalId: '4012', importCursor: ISO(9) });
    await importFromDistribution(DB, ENV, stalled, run(), { execute: execute as never });
    expect(lastSaved()).toMatchObject({ resumePage: 6 });
    expect(lastSaved()?.cursor).toBeUndefined();

    execute.mockClear();
    await importFromDistribution(DB, ENV, { ...stalled, importResumePage: 6 }, run(), { execute: execute as never });
    expect((execute.mock.calls[0] as unknown as [{ input: Record<string, unknown> }])[0].input).toMatchObject({ page: 6 });
  });

  it('plans a normal ascending run as before (the cursor moves with the margin)', () => {
    const plan = planImportState(mappingOf('ashby-postings'), row(), {
      descending: false, hasPageNumber: false, hasToken: false, exhausted: false, errored: false, nextPage: 1, nextToken: null,
      failures: {}, seen: [{ externalId: 'a', appliedAt: new Date(ISO(5)) }], failedNow: [],
    });
    expect(plan?.cursor).toBe(ISO(4));
  });
});

describe('regression: Greenhouse matches ANY of an application\'s jobs', () => {
  const mapping = mappingOf('greenhouse-job-board');
  it('keeps a prospect whose second job is this posting, drops one with only other jobs', () => {
    expect(belongsToPosting(mapping, { jobs: [{ id: 1 }, { id: 4012 }] }, '4012')).toBe(true);
    expect(belongsToPosting(mapping, { jobs: [{ id: 1 }, { id: 2 }] }, '4012')).toBe(false);
    expect(belongsToPosting(mapping, { jobs: [] }, '4012')).toBe(true); // names no job: cannot contradict the filter
  });
});

describe('regression: the quarantine record keeps the MOST RECENT failures past the cap', () => {
  const mapping = mappingOf('ashby-postings');
  it('drops people the cursor has passed, then keeps the newest, so a new failure is still recorded', () => {
    const failures = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`old-${i}`, 1]));
    failures.fresh = 1;
    const seen = [
      ...Array.from({ length: 20 }, (_, i) => ({ externalId: `old-${i}`, appliedAt: new Date(ISO(i)) })),
      { externalId: 'fresh', appliedAt: new Date(ISO(500)) },
    ];
    const kept = pruneFailures(mapping, failures, seen, Date.parse(ISO(100)), 50);
    expect(Object.keys(kept)).toHaveLength(50);
    expect(kept.fresh).toBe(1);
    expect(Object.keys(kept).some((id) => Number(id.replace('old-', '')) < 20)).toBe(false); // passed ⇒ gone
  });

  it('keeps everything below the cap untouched', () => {
    const failures = { a: 3, b: 1 };
    expect(pruneFailures(mapping, failures, [], null, 50)).toEqual(failures);
  });
});

describe('regression: the sweep also visits tenant-authored boards', () => {
  it('resolves each tenant\'s catalog once and adds its importable boards to the worklist', async () => {
    listTenantBoardKeys.mockResolvedValue([
      { tenantId: 5, connectorKey: 'acme-ats' },
      { tenantId: 5, connectorKey: 'acme-feed-only' },
    ]);
    listConnectorsForTenant.mockResolvedValue([
      { manifest: ACME, status: 'published' },
      { manifest: { ...ACME, key: 'acme-feed-only', actions: ACME.actions.filter((a) => a.key === 'create_posting') }, status: 'published' },
    ]);
    await runApplicantImportSweep(DB, ENV, { execute: vi.fn() as never });
    expect(listConnectorsForTenant).toHaveBeenCalledTimes(1);
    expect(listPostedDistributionsForSweep.mock.calls[0]![2]).toMatchObject({ tenantBoards: [{ tenantId: 5, connectorKey: 'acme-ats' }] });
  });
});

describe('regression: the Worker subrequest budget stops a run cleanly', () => {
  it('stops mid-page when the query budget cannot cover another applicant, and reports more', async () => {
    const execute = vi.fn(async () => ({ ok: true, status: 200, durationMs: 1, data: ashbyApps(10, 'JOB') }));
    const queries = QUERIES_PER_ROW + QUERIES_PER_PAGE + 3 * QUERIES_PER_APPLICANT;
    const outcome = await importFromDistribution(DB, ENV, row({ boardFilterId: 'JOB' }), run(1000, { queries }), { execute: execute as never });
    expect(outcome).toMatchObject({ fetched: 3, more: true });
  });
});

describe('regression: two imports of one row cannot clobber each other', () => {
  it('the sweep takes the lease on touch and saves its state under it', async () => {
    touchPostedDistribution.mockResolvedValue('2026-11-08 10:00:00.123');
    listPostedDistributionsForSweep.mockResolvedValueOnce([row({ boardFilterId: 'JOB' })]);
    const execute = vi.fn(async () => ({ ok: true, status: 200, durationMs: 1, data: ashbyApps(2, 'JOB') }));
    await runApplicantImportSweep(DB, ENV, { execute: execute as never });
    expect(saveImportState.mock.calls[0]![1]).toMatchObject({ importLease: '2026-11-08 10:00:00.123' });
  });
});

describe('importAction', () => {
  it('finds the import action of a tenant-authored manifest by the same rule as a built-in', () => {
    expect(importAction(ACME.actions)?.key).toBe('list_applications');
  });
});
