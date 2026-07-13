import { afterEach, describe, expect, it, vi } from 'vitest';
import { updatePullRequestBranch } from './updatePullRequestBranch';

const input = {
  provider: 'github', host: null, owner: 'acme', repo: 'app', token: 'secret', number: 39,
};

describe('updatePullRequestBranch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requests GitHub update-branch before merge', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(updatePullRequestBranch(input)).resolves.toEqual({ ok: true, updated: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/app/pulls/39/update-branch',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('allows a branch that is already current to proceed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{"message":"head branch is already up to date"}', { status: 422 }),
    ));
    await expect(updatePullRequestBranch(input)).resolves.toEqual({ ok: true, updated: false });
  });

  it('returns an actionable conflict when the base cannot be integrated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{"message":"merge conflict"}', { status: 422 }),
    ));
    const result = await updatePullRequestBranch(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('conflict');
  });
});
