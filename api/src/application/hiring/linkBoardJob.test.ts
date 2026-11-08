/**
 * Linking a posting to a job that already exists on a board: one board job belongs to one
 * posting, a posting holds one publication per board, the board must really list the job,
 * and a concurrent link that slips past the checks is arbitrated by the database (409).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { HIRING_CONNECTORS } from '../connectors/defaults/hiring';
import { AtsError } from './atsError';

const findPostingLinkedToBoardJob = vi.fn();
const readPostedDistributions = vi.fn();
const recordPostingDistribution = vi.fn();

vi.mock('../connectors/connectorRegistry', () => ({
  resolveConnector: vi.fn(async () => ({ manifest: HIRING_CONNECTORS.find((m) => m.key === 'workable'), status: 'published' })),
  listPublishedConnectors: vi.fn(async () => []),
}));
vi.mock('./postingDistributionStore', () => ({
  findPostingLinkedToBoardJob: (...args: unknown[]) => findPostingLinkedToBoardJob(...args),
  readPostedDistributions: (...args: unknown[]) => readPostedDistributions(...args),
  readPostingDistributions: vi.fn(async () => new Map()),
  recordPostingDistribution: (...args: unknown[]) => recordPostingDistribution(...args),
}));
vi.mock('./postingDistributionSupport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./postingDistributionSupport')>()),
  requirePosting: vi.fn(async () => ({ id: 'p1' })),
}));

import { linkBoardJob } from './linkBoardJob';

const ENV = {} as Env;
/** The connection lookup: select → from → where → orderBy → limit. */
const DB = {
  select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [{ id: 'conn-1' }] }) }) }) }),
} as never;

const jobs = [
  { shortcode: 'ABC', title: 'Senior Engineer', state: 'published' },
  { shortcode: 'DEF', title: 'Designer', state: 'published' },
];
const deps = (data: unknown = jobs) => ({
  execute: vi.fn(async () => ({ ok: true, status: 200, data, durationMs: 1 })) as never,
  loadConnection: vi.fn(async () => ({ id: 'conn-1', connectorKey: 'workable', name: 'W', auth: { subdomain: 'acme', token: 'secret' }, baseUrlOverride: null })) as never,
});
const input = (externalId = 'ABC') => ({ tenantId: 1, postingId: 'p1', connectorKey: 'workable', externalId });
const rejection = async (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error);

beforeEach(() => {
  findPostingLinkedToBoardJob.mockReset().mockResolvedValue(null);
  readPostedDistributions.mockReset().mockResolvedValue([]);
  recordPostingDistribution.mockReset().mockResolvedValue(undefined);
});

describe('linkBoardJob', () => {
  it('writes a confirmed publication with the board job id and the template link', async () => {
    await linkBoardJob(DB, ENV, input('ABC'), deps());
    expect(recordPostingDistribution).toHaveBeenCalledWith(DB, expect.objectContaining({
      postingId: 'p1', connectorKey: 'workable', connectionId: 'conn-1', status: 'posted', externalId: 'ABC',
      url: 'https://apply.workable.com/acme/j/ABC/',
    }));
  });

  it('refuses a board job already linked to ANOTHER posting (409), writing nothing', async () => {
    findPostingLinkedToBoardJob.mockResolvedValue('other-posting');
    const error = await rejection(linkBoardJob(DB, ENV, input(), deps()));
    expect(error).toBeInstanceOf(AtsError);
    expect(error).toMatchObject({ status: 409 });
    expect(recordPostingDistribution).not.toHaveBeenCalled();
  });

  it('allows re-linking the same job to the same posting (idempotent)', async () => {
    findPostingLinkedToBoardJob.mockResolvedValue('p1');
    readPostedDistributions.mockResolvedValue([{ connectorKey: 'workable', externalId: 'ABC' }]);
    await expect(linkBoardJob(DB, ENV, input('ABC'), deps())).resolves.toBeDefined();
  });

  it('refuses a SECOND job on a board the posting is already published on (409)', async () => {
    readPostedDistributions.mockResolvedValue([{ connectorKey: 'workable', externalId: 'ABC' }]);
    const error = await rejection(linkBoardJob(DB, ENV, input('DEF'), deps()));
    expect(error).toMatchObject({ status: 409 });
    expect(recordPostingDistribution).not.toHaveBeenCalled();
  });

  it('refuses a job the board does not list (404) — a typed id is not trusted', async () => {
    const error = await rejection(linkBoardJob(DB, ENV, input('NOPE'), deps()));
    expect(error).toMatchObject({ status: 404 });
    expect(recordPostingDistribution).not.toHaveBeenCalled();
  });

  it('maps the database unique violation of a concurrent link to a 409', async () => {
    recordPostingDistribution.mockRejectedValue(Object.assign(new Error('duplicate key value'), { code: '23505' }));
    const error = await rejection(linkBoardJob(DB, ENV, input(), deps()));
    expect(error).toBeInstanceOf(AtsError);
    expect(error).toMatchObject({ status: 409 });
  });

  it('lets any other write failure through as itself', async () => {
    recordPostingDistribution.mockRejectedValue(new Error('connection reset'));
    const error = await rejection(linkBoardJob(DB, ENV, input(), deps()));
    expect(error).not.toBeInstanceOf(AtsError);
  });
});
