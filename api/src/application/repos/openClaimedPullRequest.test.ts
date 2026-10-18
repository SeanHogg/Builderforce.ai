/**
 * openClaimedPullRequest — the ONE claim → create → release step both task
 * finalize surfaces (Done-drag / host routes and the cloud run-end finalize) use.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';

vi.mock('./createPullRequest', () => ({ createPullRequest: vi.fn() }));

import { createPullRequest as createPullRequestImpl } from './createPullRequest';
import { openClaimedPullRequest } from './openTaskPullRequest';

const createPullRequest = vi.mocked(createPullRequestImpl);

interface Row { prOpeningAt: Date | null; githubPrUrl: string | null }

/** Same fake as the claim test: a set with a Date is the claim, a null is the release. */
function fakeDb(row: Row): Db {
  return {
    update: () => ({
      set: (vals: Partial<Row>) => ({
        where: () => {
          if (vals.prOpeningAt instanceof Date) {
            const won = row.prOpeningAt == null && row.githubPrUrl == null;
            if (won) row.prOpeningAt = vals.prOpeningAt;
            return { returning: async () => (won ? [{ id: 1 }] : []) };
          }
          if (row.githubPrUrl == null) row.prOpeningAt = null;
          return { catch: async () => undefined };
        },
      }),
    }),
  } as unknown as Db;
}

const PR = { provider: 'github', host: null, owner: 'o', repo: 'r', token: 't', head: 'b', base: 'main', title: 'T', body: 'B' };

beforeEach(() => createPullRequest.mockReset());

describe('openClaimedPullRequest', () => {
  it('opens the PR once the claim is won, and keeps the claim', async () => {
    const row: Row = { prOpeningAt: null, githubPrUrl: null };
    createPullRequest.mockResolvedValue({ ok: true, number: 7, url: 'https://x/pr/7' });
    await expect(openClaimedPullRequest(fakeDb(row), 1, 9, PR)).resolves.toEqual({ ok: true, number: 7, url: 'https://x/pr/7' });
    expect(row.prOpeningAt).toBeInstanceOf(Date);
  });

  it('never calls the provider when another path holds the claim', async () => {
    const row: Row = { prOpeningAt: new Date(), githubPrUrl: null };
    await expect(openClaimedPullRequest(fakeDb(row), 1, 9, PR)).resolves.toEqual({ ok: false, claimLost: true });
    expect(createPullRequest).not.toHaveBeenCalled();
  });

  it('releases the claim when the provider refuses, so a retry can re-attempt', async () => {
    const row: Row = { prOpeningAt: null, githubPrUrl: null };
    createPullRequest.mockResolvedValue({ ok: false, code: 'provider_error', reason: 'boom' });
    await expect(openClaimedPullRequest(fakeDb(row), 1, 9, PR)).resolves.toMatchObject({ ok: false, reason: 'boom' });
    expect(row.prOpeningAt).toBeNull();
  });

  it('treats a thrown create like a refusal and still releases the claim', async () => {
    const row: Row = { prOpeningAt: null, githubPrUrl: null };
    createPullRequest.mockRejectedValueOnce(new Error('network down'));
    await expect(openClaimedPullRequest(fakeDb(row), 1, 9, PR)).resolves.toMatchObject({ ok: false, code: 'provider_error', reason: 'network down' });
    expect(row.prOpeningAt).toBeNull();
  });
});
