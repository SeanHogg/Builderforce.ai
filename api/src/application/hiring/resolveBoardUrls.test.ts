/**
 * Finding a published row's link: nothing is written without a valid URL (a resolved id
 * never replaces the stored reference on its own), only boards that can resolve spend the
 * sweep's budget, and a row rotates before it is tried.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { HIRING_CONNECTORS } from '../connectors/defaults/hiring';

const calls: string[] = [];
const recordResolvedLink = vi.fn();
const markResolveConflict = vi.fn();
const touchPostedDistribution = vi.fn();
const listPostedDistributionsForSweep = vi.fn();

vi.mock('../connectors/connectorRegistry', () => ({
  resolveConnector: vi.fn(async (_db: unknown, _tenant: number, key: string) => {
    const manifest = HIRING_CONNECTORS.find((m) => m.key === key);
    return manifest ? { manifest, status: 'published' } : null;
  }),
}));
vi.mock('./postingDistributionSweepStore', () => ({
  listPostedDistributionsForSweep: (...args: unknown[]) => listPostedDistributionsForSweep(...args),
  recordResolvedLink: (...args: unknown[]) => recordResolvedLink(...args),
  markResolveConflict: (...args: unknown[]) => markResolveConflict(...args),
  touchPostedDistribution: (...args: unknown[]) => { calls.push('touch'); return touchPostedDistribution(...args); },
}));

import { RESOLVABLE_BOARD_KEYS, resolveDistributionUrl, runUrlResolutionPass } from './resolveBoardUrls';
import type { PostedDistribution } from './postingDistributionSweepStore';

const ENV = {} as Env;
const DB = {} as never;
const TASK = 'urn:li:simpleJobPostingTask:abc-123';

const linkedinRow = (over: Partial<PostedDistribution> = {}): PostedDistribution => ({
  tenantId: 1, postingId: 'p1', connectorKey: 'linkedin-jobs', connectionId: 'c1', externalId: TASK, url: null, importCursor: null,
  importResumePage: null, importPendingCursor: null, importFailures: {}, ...over,
});
const greenhouseRow = (over: Partial<PostedDistribution> = {}): PostedDistribution => ({
  tenantId: 1, postingId: 'p1', connectorKey: 'greenhouse-job-board', connectionId: 'c1', externalId: '4012', url: null, importCursor: null,
  importResumePage: null, importPendingCursor: null, importFailures: {}, ...over,
});

const deps = (data: unknown, auth: Record<string, string> = { token: 'x', company_id: 'urn:li:organization:1', board_token: 'acme' }) => {
  const execute = vi.fn(async (..._args: unknown[]) => {
    calls.push('execute');
    return { ok: true, status: 200, data, durationMs: 1 };
  });
  return {
    execute: execute as never,
    loadConnection: vi.fn(async () => ({ id: 'c1', connectorKey: 'x', name: 'n', auth, baseUrlOverride: null })) as never,
    mock: execute,
  };
};

beforeEach(() => {
  calls.length = 0;
  recordResolvedLink.mockReset().mockResolvedValue(undefined);
  markResolveConflict.mockReset().mockResolvedValue(undefined);
  touchPostedDistribution.mockReset().mockResolvedValue(undefined);
  listPostedDistributionsForSweep.mockReset();
});

describe('resolveDistributionUrl', () => {
  it('LinkedIn: writes the numeric job id TOGETHER with the link built from it', async () => {
    const d = deps({ results: { [TASK]: { id: TASK, status: 'SUCCEEDED', jobPosting: 'urn:li:jobPosting:4215800322' } } });
    expect(await resolveDistributionUrl(DB, ENV, linkedinRow(), d, 'system')).toBe('linked');
    expect(recordResolvedLink).toHaveBeenCalledWith(DB, expect.anything(), { url: 'https://www.linkedin.com/jobs/view/4215800322', externalId: '4215800322' });
    expect(d.mock.mock.calls[0]![0]).toMatchObject({ actionKey: 'resolve_url', actorKind: 'system' });
  });

  it('writes NOTHING while the task is still in progress — the task urn stays the reference', async () => {
    const d = deps({ results: { [TASK]: { id: TASK, status: 'IN_PROGRESS' } } });
    expect(await resolveDistributionUrl(DB, ENV, linkedinRow(), d)).toBe('unresolved');
    expect(recordResolvedLink).not.toHaveBeenCalled();
  });

  it('never replaces the id without a valid https URL (a job posting urn that yields no id, or a template with a hole)', async () => {
    const d = deps({ results: { [TASK]: { id: TASK, jobPosting: 'urn:li:jobPosting:' } } });
    expect(await resolveDistributionUrl(DB, ENV, linkedinRow(), d)).toBe('unresolved');
    expect(recordResolvedLink).not.toHaveBeenCalled();
  });

  it('Greenhouse: matches the stored JOB id and takes the public link, leaving the id alone', async () => {
    const d = deps({ jobs: [{ id: 9, internal_job_id: 4011, absolute_url: 'https://x.test/9' }, { id: 7, internal_job_id: 4012, absolute_url: 'https://boards.greenhouse.io/acme/jobs/7' }] });
    expect(await resolveDistributionUrl(DB, ENV, greenhouseRow(), d)).toBe('linked');
    expect(recordResolvedLink).toHaveBeenCalledWith(DB, expect.anything(), { url: 'https://boards.greenhouse.io/acme/jobs/7', externalId: null });
    // The public board is read with NO credential, and with the board token in the path.
    expect(d.mock.mock.calls[0]![0]).toMatchObject({ actionKey: 'resolve_url', input: { board_token: 'acme' } });
  });

  it('does not call the board when the connection lacks the token the call needs', async () => {
    const d = deps({ jobs: [] }, { token: 'x' });
    expect(await resolveDistributionUrl(DB, ENV, greenhouseRow(), d)).toBe('unresolved');
    expect(d.mock).not.toHaveBeenCalled();
  });

  it('drops a non-https link rather than writing it', async () => {
    const d = deps({ jobs: [{ id: 7, internal_job_id: 4012, absolute_url: 'http://boards.greenhouse.io/acme/jobs/7' }] });
    expect(await resolveDistributionUrl(DB, ENV, greenhouseRow(), d)).toBe('unresolved');
    expect(recordResolvedLink).not.toHaveBeenCalled();
  });

  it('is "unsupported" for a board with no resolve_url action', async () => {
    expect(await resolveDistributionUrl(DB, ENV, linkedinRow({ connectorKey: 'indeed-jobs' }), deps({}))).toBe('unsupported');
  });

  it('a resolved id another posting holds is recorded on the row and backed off — not retried every sweep', async () => {
    recordResolvedLink.mockRejectedValue(Object.assign(
      new Error('duplicate key value violates unique constraint "uq_job_posting_distributions_board_job"'), { code: '23505' },
    ));
    const d = deps({ results: { [TASK]: { id: TASK, jobPosting: 'urn:li:jobPosting:55' } } });
    expect(await resolveDistributionUrl(DB, ENV, linkedinRow(), d)).toBe('unresolved');
    expect(markResolveConflict).toHaveBeenCalledTimes(1);
  });

  it('a unique violation on some OTHER index is not mistaken for that conflict', async () => {
    recordResolvedLink.mockRejectedValue(Object.assign(new Error('duplicate key value violates unique constraint "other_idx"'), { code: '23505' }));
    const d = deps({ results: { [TASK]: { id: TASK, jobPosting: 'urn:li:jobPosting:55' } } });
    expect(await resolveDistributionUrl(DB, ENV, linkedinRow(), d)).toBe('unresolved');
    expect(markResolveConflict).not.toHaveBeenCalled();
  });

  it('encodes the LinkedIn task urn as a Rest.li List key, and takes the link only from the board’s own domain', async () => {
    const d = deps({ results: { [TASK]: { id: TASK, jobPosting: 'urn:li:jobPosting:77' } } });
    await resolveDistributionUrl(DB, ENV, linkedinRow(), d);
    expect(d.mock.mock.calls[0]![0]).toMatchObject({ input: { ids: `List(${encodeURIComponent(TASK)})` } });

    // A reported link on another domain is refused (Greenhouse's absolute_url can be a customer’s site).
    const off = deps({ jobs: [{ id: 7, internal_job_id: 4012, absolute_url: 'https://careers.acme.test/job?gh_jid=7' }] });
    expect(await resolveDistributionUrl(DB, ENV, greenhouseRow(), off)).toBe('unresolved');
    expect(recordResolvedLink).not.toHaveBeenCalledWith(DB, expect.anything(), expect.objectContaining({ url: expect.stringContaining('acme.test') }));
  });
});

describe('the link-finding pass', () => {
  it('only asks for rows whose board HAS a resolve_url action (Indeed never spends the budget)', async () => {
    listPostedDistributionsForSweep.mockResolvedValue([]);
    await runUrlResolutionPass(DB, ENV, deps({}), 7);
    expect(RESOLVABLE_BOARD_KEYS).toEqual(expect.arrayContaining(['greenhouse-job-board', 'linkedin-jobs']));
    expect(RESOLVABLE_BOARD_KEYS).not.toContain('indeed-jobs');
    expect(listPostedDistributionsForSweep).toHaveBeenCalledWith(DB, 7, { missingUrlOnly: true, connectorKeys: RESOLVABLE_BOARD_KEYS });
  });

  it('rotates each row BEFORE trying it, whatever the outcome', async () => {
    listPostedDistributionsForSweep.mockResolvedValue([linkedinRow(), greenhouseRow()]);
    const d = deps({ results: {} });
    const result = await runUrlResolutionPass(DB, ENV, d);
    expect(calls.filter((c) => c === 'touch' || c === 'execute').slice(0, 2)).toEqual(['touch', 'execute']);
    expect(touchPostedDistribution).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ checked: 2, linked: 0 });
  });
});
