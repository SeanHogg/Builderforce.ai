/**
 * Regression tests for the fourth review of the board-applicant import: the sweep running on
 * the row's FRESH state after its lease, a dead saved token not blocking a board forever, a run
 * with many failures keeping every one of them, an end-of-list flag on a full page, the manual
 * press re-reading a row whose link was just found, and the tenant catalogs resolved a few at a time.
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
const readPostedDistribution = vi.fn();
const readPostedDistributions = vi.fn();
const listPostedDistributionsForSweep = vi.fn();
const listTenantBoardKeys = vi.fn();
const listConnectorsForTenant = vi.fn();
const resolveDistributionUrl = vi.fn();
const reportCaughtError = vi.fn();

const ACME: ConnectorManifest = { ...HIRING_CONNECTORS.find((m) => m.key === 'ashby-postings')!, key: 'acme-ats' };

vi.mock('../connectors/connectorRegistry', () => ({
  resolveConnector: vi.fn(async (_db: unknown, _tenant: number, key: string) => {
    const manifest = key === 'acme-ats' ? ACME : HIRING_CONNECTORS.find((m) => m.key === key);
    return manifest ? { manifest, status: 'published' } : null;
  }),
  listConnectorsForTenant: (...args: unknown[]) => listConnectorsForTenant(...args),
}));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: (...args: unknown[]) => reportCaughtError(...args) }));
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
  readPostedDistribution: (...args: unknown[]) => readPostedDistribution(...args),
  readPostedDistributions: (...args: unknown[]) => readPostedDistributions(...args),
  saveImportState: (...args: unknown[]) => saveImportState(...args),
  saveBoardFilterId: (...args: unknown[]) => saveBoardFilterId(...args),
  touchPostedDistribution: (...args: unknown[]) => touchPostedDistribution(...args),
}));
vi.mock('./resolveBoardUrls', () => ({
  resolveDistributionUrl: (...args: unknown[]) => resolveDistributionUrl(...args),
  runUrlResolutionPass: vi.fn(async () => ({ checked: 0, linked: 0 })),
}));
vi.mock('./postingDistributionSupport', () => ({ requirePosting: vi.fn(async () => ({ id: 'p1' })) }));

import { importBoardApplicants, runApplicantImportSweep } from './importBoardApplicants';
import { importFromDistribution } from './importDistribution';
import { WORKLIST_CATALOG_CONCURRENCY, importAction } from './importWorklist';
import { cursorValue, encodePending, planImportState, pruneFailures } from './importCursor';
import type { PostedDistribution } from './postingDistributionSweepStore';

const ENV = {} as Env;
const DB = {} as never;
const ISO = (second: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, second)).toISOString();
const mappingOf = (key: string) => importAction(HIRING_CONNECTORS.find((m) => m.key === key)!.actions)!.applicants;
const run = (maxPerBoard = 1000) => ({ budget: { remaining: 100_000 }, maxPerBoard, actorKind: 'system' as const });

const row = (over: Partial<PostedDistribution> = {}): PostedDistribution => ({
  tenantId: 1, postingId: 'p1', connectorKey: 'ashby-postings', connectionId: 'c1', externalId: 'POSTING-1', url: null,
  importCursor: null, importResumePage: null, importResumeToken: null, importPendingCursor: null, importFailures: {},
  boardFilterId: 'JOB', ...over,
});
const leverRow = (over: Partial<PostedDistribution> = {}) => row({ connectorKey: 'lever-postings', externalId: 'POST', boardFilterId: null, ...over });

const ashbyApps = (count: number) => Array.from({ length: count }, (_, i) => ({
  id: `app-${i}`, createdAt: ISO(i + 10), job: { id: 'JOB' },
  candidate: { id: `cand-${i}`, name: `P${i}`, primaryEmailAddress: { value: `p${i}@example.test` } },
}));
const leverItems = (count: number, from = 0) => Array.from({ length: count }, (_, i) => ({
  id: `opp-${from + i}`, contact: `ct-${from + i}`, name: `L${from + i}`, emails: [`l${from + i}@example.test`],
  createdAt: Date.UTC(2026, 9, 1, 12) - (from + i) * 1000, posting: 'POST',
}));

type Saved = { cursor?: string; resumePage: number | null; resumeToken?: string | null; pendingCursor: string | null; failures: Record<string, number> };
const lastSaved = () => saveImportState.mock.calls.at(-1)?.[2] as Saved | undefined;

beforeEach(() => {
  recordApplication.mockReset().mockResolvedValue({ created: true, applicationId: 1 });
  admitBoardCandidate.mockReset().mockImplementation(async (_db: unknown, input: { applicationId: string }) => ({ admitted: true, candidateRef: `ref-${input.applicationId}` }));
  saveImportState.mockReset().mockResolvedValue(true);
  saveBoardFilterId.mockReset().mockResolvedValue(undefined);
  touchPostedDistribution.mockReset().mockImplementation(async (_db: unknown, r: PostedDistribution) => ({ ...r, importLease: 'L' }));
  readPostedDistribution.mockReset().mockResolvedValue(null);
  readPostedDistributions.mockReset().mockResolvedValue([]);
  listPostedDistributionsForSweep.mockReset().mockResolvedValue([]);
  listTenantBoardKeys.mockReset().mockResolvedValue([]);
  listConnectorsForTenant.mockReset().mockResolvedValue([]);
  resolveDistributionUrl.mockReset().mockResolvedValue('unresolved');
  reportCaughtError.mockReset();
});

describe('regression: the import runs on the row AS LEASED, never on the batch snapshot', () => {
  it('the sweep reads from the cursor a newer save left, not the one it listed', async () => {
    listPostedDistributionsForSweep.mockResolvedValueOnce([row({ importCursor: null })]); // the snapshot
    touchPostedDistribution.mockImplementation(async (_db: unknown, r: PostedDistribution) => ({ ...r, importCursor: ISO(30), importLease: 'L2' }));
    const execute = vi.fn(async () => ({ ok: true, status: 200, durationMs: 1, data: [] }));
    await runApplicantImportSweep(DB, ENV, { execute: execute as never });

    const input = (execute.mock.calls[0] as unknown as [{ input: Record<string, unknown> }])[0].input;
    expect(input[mappingOf('ashby-postings').cursorParam!]).toBe(cursorValue(mappingOf('ashby-postings'), ISO(30)));
  });

  it('a row that is gone by the time it is touched is skipped, not imported', async () => {
    listPostedDistributionsForSweep.mockResolvedValueOnce([row()]);
    touchPostedDistribution.mockResolvedValue(null);
    const execute = vi.fn();
    const result = await runApplicantImportSweep(DB, ENV, { execute: execute as never });
    expect(execute).not.toHaveBeenCalled();
    expect(result.checked).toBe(0);
  });

  it('reports a dropped state write (a newer run holds the row) through the reporter, as a warning', async () => {
    saveImportState.mockResolvedValue(false);
    const execute = vi.fn(async () => ({ ok: true, status: 200, durationMs: 1, data: ashbyApps(2) }));
    await importFromDistribution(DB, ENV, row(), run(), { execute: execute as never });
    expect(reportCaughtError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ operation: 'saveImportState', level: 'warning' }));
  });

  it('a saved state is not reported when it stood', async () => {
    const execute = vi.fn(async () => ({ ok: true, status: 200, durationMs: 1, data: ashbyApps(2) }));
    await importFromDistribution(DB, ENV, row(), run(), { execute: execute as never });
    expect(reportCaughtError).not.toHaveBeenCalled();
  });
});

describe('regression: a manual press re-reads the row after a link was found', () => {
  it('imports with the REPLACED external id and a cleared filter id, under the lease it already took', async () => {
    const stale = row({ externalId: 'OLD-TASK', boardFilterId: 'OLD-JOB', url: null });
    readPostedDistributions.mockResolvedValue([stale]);
    resolveDistributionUrl.mockResolvedValue('linked');
    readPostedDistribution.mockResolvedValue({ ...stale, externalId: 'REAL-9', boardFilterId: null, url: 'https://acme.test/j/9' });
    const execute = vi.fn(async (args: { actionKey: string }) => (args.actionKey === 'get_posting'
      ? { ok: true, status: 200, durationMs: 1, data: { jobId: 'JOB' } }
      : { ok: true, status: 200, durationMs: 1, data: [] }));
    await importBoardApplicants(DB, ENV, 1, 'p1', { execute: execute as never });

    expect(execute.mock.calls[0]![0]).toMatchObject({ actionKey: 'get_posting', input: { jobPostingId: 'REAL-9' } });
    expect(saveBoardFilterId.mock.calls[0]![1]).toMatchObject({ externalId: 'REAL-9', importLease: 'L' });
  });

  it('does not re-read when no link was found', async () => {
    readPostedDistributions.mockResolvedValue([row({ url: null })]);
    await importBoardApplicants(DB, ENV, 1, 'p1', { execute: vi.fn(async () => ({ ok: true, status: 200, durationMs: 1, data: [] })) as never });
    expect(readPostedDistribution).not.toHaveBeenCalled();
  });
});

describe('regression: a dead saved token does not block the board forever', () => {
  const dead = { ok: false, status: 400, durationMs: 1, data: null, error: 'invalid offset' };

  it('a run that started from a saved token and failed its FIRST page drops the walk', async () => {
    const saved = leverRow({ importResumeToken: 'DEAD', importPendingCursor: encodePending(Date.UTC(2026, 9, 1), null) });
    const outcome = await importFromDistribution(DB, ENV, saved, run(), { execute: vi.fn(async () => dead) as never });
    expect(outcome.error).toMatch(/invalid offset/);
    expect(lastSaved()).toMatchObject({ resumeToken: null, resumePage: null, pendingCursor: null });
  });

  it('…and the next run starts from the first page', async () => {
    const execute = vi.fn(async () => ({ ok: true, status: 200, durationMs: 1, data: leverItems(2) }));
    await importFromDistribution(DB, ENV, leverRow(), run(), { execute: execute as never });
    expect((execute.mock.calls[0] as unknown as [{ input: Record<string, unknown> }])[0].input.offset).toBeUndefined();
  });

  it('a failure on a LATER page keeps the walk where it was (nothing is rewritten, so the saved token stands)', async () => {
    const page = leverItems(100);
    const execute = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, durationMs: 1, data: page, bodyFields: { next: 'T2' } })
      .mockResolvedValueOnce(dead);
    const outcome = await importFromDistribution(DB, ENV, leverRow({ importResumeToken: 'T1' }), run(), { execute: execute as never });
    expect(outcome.error).toMatch(/invalid offset/);
    expect(saveImportState).not.toHaveBeenCalled();
  });

  it('a first-page failure of a run that did NOT start from a saved point changes nothing', async () => {
    await importFromDistribution(DB, ENV, leverRow(), run(), { execute: vi.fn(async () => dead) as never });
    expect(saveImportState).not.toHaveBeenCalled();
  });

  it('the same for a saved page number', () => {
    const plan = planImportState(mappingOf('greenhouse-job-board'), row({ connectorKey: 'greenhouse-job-board', importResumePage: 4, importPendingCursor: '1|' }), {
      descending: true, hasPageNumber: true, hasToken: false, exhausted: false, errored: true, resumePointFailed: true,
      nextPage: 4, nextToken: null, failures: {}, seen: [], failedNow: [],
    });
    expect(plan).toMatchObject({ resumePage: null, resumeToken: null, pendingCursor: null });
  });
});

describe('regression: only a REFUSED resume point is dropped; a throttle or outage keeps the walk', () => {
  const failing = (status: number) => ({ ok: false, status, durationMs: 1, data: null, error: `board answered ${status}` });
  const pending = encodePending(Date.UTC(2026, 9, 1), null);

  for (const status of [429, 500, 503, 0]) {
    it(`a ${status} on the first resumed page keeps the resume token and pendingCursor`, async () => {
      const saved = leverRow({ importResumeToken: 'T1', importPendingCursor: pending });
      await importFromDistribution(DB, ENV, saved, run(), { execute: vi.fn(async () => failing(status)) as never });
      // Nothing is rewritten, so the saved walk stands.
      expect(saveImportState).not.toHaveBeenCalled();
    });
  }

  it('a thrown error on the first resumed page keeps the walk', async () => {
    const saved = leverRow({ importResumeToken: 'T1', importPendingCursor: pending });
    await importFromDistribution(DB, ENV, saved, run(), { execute: vi.fn(async () => { throw new Error('timeout'); }) as never });
    expect(saveImportState).not.toHaveBeenCalled();
  });

  it('a 404 on the first resumed page clears the resume token and pendingCursor', async () => {
    const saved = leverRow({ importResumeToken: 'T1', importPendingCursor: pending });
    await importFromDistribution(DB, ENV, saved, run(), { execute: vi.fn(async () => failing(404)) as never });
    expect(lastSaved()).toMatchObject({ resumeToken: null, resumePage: null, pendingCursor: null });
  });

  it('a board that echoes its token ends the walk after one page and does not save that token', async () => {
    const execute = vi.fn(async () => ({ ok: true, status: 200, durationMs: 1, data: leverItems(100), bodyFields: { next: 'T1', hasNext: 'true' } }));
    await importFromDistribution(DB, ENV, leverRow({ importResumeToken: 'T1' }), run(), { execute: execute as never });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(lastSaved()?.resumeToken).toBeNull();
    expect(lastSaved()?.cursor).toBeTruthy();
  });
});

describe('regression: failures of this run are never pruned, however many', () => {
  it('pruneFailures keeps every must-keep entry past the cap and fills the rest from the others', () => {
    const mapping = mappingOf('ashby-postings');
    const failures = Object.fromEntries([
      ...Array.from({ length: 60 }, (_, i) => [`now-${i}`, 1]),
      ...Array.from({ length: 30 }, (_, i) => [`old-${i}`, 2]),
    ]);
    const mustKeep = new Set(Array.from({ length: 60 }, (_, i) => `now-${i}`));
    const kept = pruneFailures(mapping, failures, [], null, 50, mustKeep);
    expect(Object.keys(kept).filter((id) => id.startsWith('now-'))).toHaveLength(60);
    expect(Object.keys(kept).filter((id) => id.startsWith('old-'))).toHaveLength(0); // no room left for the older ones
  });

  it('more than 50 failing in one run: all are recorded and the cursor is pinned before the OLDEST of them', async () => {
    recordApplication.mockRejectedValue(new Error('constraint'));
    const execute = vi.fn(async () => ({ ok: true, status: 200, durationMs: 1, data: ashbyApps(60) }));
    const outcome = await importFromDistribution(DB, ENV, row(), run(), { execute: execute as never });

    expect(outcome.failedApplicants).toBe(60);
    const saved = lastSaved()!;
    expect(Object.keys(saved.failures)).toHaveLength(60); // none dropped
    expect(Date.parse(saved.cursor!)).toBe(Date.parse(ISO(10)) - 1); // just before the oldest failed person
    for (const id of Object.keys(saved.failures)) expect(saved.failures[id]).toBe(1);
  });

  it('older failures still make room: the cap holds when nobody failed this run', () => {
    const mapping = mappingOf('ashby-postings');
    const failures = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`old-${i}`, 1]));
    expect(Object.keys(pruneFailures(mapping, failures, [], null, 50))).toHaveLength(50);
  });
});

describe('regression: an end-of-list flag ends a walk on a FULL page', () => {
  it('Lever: hasNext false with a full page is the last page — the cursor moves and no token is kept', async () => {
    const execute = vi.fn(async () => ({ ok: true, status: 200, durationMs: 1, data: leverItems(100), bodyFields: { next: 'STALE', hasNext: 'false' } }));
    const outcome = await importFromDistribution(DB, ENV, leverRow(), run(), { execute: execute as never });
    expect(execute).toHaveBeenCalledTimes(1);
    expect((execute.mock.calls[0] as unknown as [{ captureBodyPaths: string[] }])[0].captureBodyPaths).toEqual(['next', 'hasNext']);
    expect(outcome.more).toBe(false);
    expect(lastSaved()?.cursor).toBeTruthy();
    expect(lastSaved()?.resumeToken).toBeNull();
  });

  it('hasNext true keeps walking on the token', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, durationMs: 1, data: leverItems(100), bodyFields: { next: 'T2', hasNext: 'true' } })
      .mockResolvedValueOnce({ ok: true, status: 200, durationMs: 1, data: leverItems(30, 100), bodyFields: { hasNext: 'false' } });
    await importFromDistribution(DB, ENV, leverRow(), run(), { execute: execute as never });
    expect(execute).toHaveBeenCalledTimes(2);
    expect((execute.mock.calls[1] as unknown as [{ input: Record<string, unknown> }])[0].input.offset).toBe('T2');
  });
});

describe('regression: tenant catalogs are resolved a few at a time', () => {
  it('resolves them in parallel, never more than the bound at once, and keeps the tenants\' order', async () => {
    const tenants = Array.from({ length: 12 }, (_, i) => i + 1);
    listTenantBoardKeys.mockResolvedValue(tenants.map((tenantId) => ({ tenantId, connectorKey: 'acme-ats' })));
    let inFlight = 0;
    let peak = 0;
    listConnectorsForTenant.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return [{ manifest: ACME, status: 'published' }];
    });
    await runApplicantImportSweep(DB, ENV, { execute: vi.fn() as never });

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(WORKLIST_CATALOG_CONCURRENCY);
    expect(listPostedDistributionsForSweep.mock.calls[0]![2].tenantBoards.map((b: { tenantId: number }) => b.tenantId)).toEqual(tenants);
  });

  it('one tenant\'s unreadable catalog is reported and does not take the others down', async () => {
    listTenantBoardKeys.mockResolvedValue([{ tenantId: 1, connectorKey: 'acme-ats' }, { tenantId: 2, connectorKey: 'acme-ats' }]);
    listConnectorsForTenant.mockImplementation(async (_db: unknown, tenantId: number) => {
      if (tenantId === 1) throw new Error('catalog down');
      return [{ manifest: ACME, status: 'published' }];
    });
    await runApplicantImportSweep(DB, ENV, { execute: vi.fn() as never });
    expect(listPostedDistributionsForSweep.mock.calls[0]![2].tenantBoards).toEqual([{ tenantId: 2, connectorKey: 'acme-ats' }]);
    expect(reportCaughtError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ context: { tenantId: 1 } }));
  });
});
