import { afterEach, describe, expect, it, vi } from 'vitest';
import { updatePullRequestBranch } from './updatePullRequestBranch';

const input = {
  provider: 'github', host: null, owner: 'acme', repo: 'app', token: 'secret', number: 39,
};

describe('updatePullRequestBranch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requests GitHub update-branch before merge', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"mergeable_state":"behind"}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(updatePullRequestBranch(input)).resolves.toEqual({ ok: true, updated: true });
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.github.com/repos/acme/app/pulls/39/update-branch',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('allows a branch that is already current to proceed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{"mergeable_state":"clean"}', { status: 200 }),
    ));
    await expect(updatePullRequestBranch(input)).resolves.toEqual({ ok: true, updated: false });
  });

  it('returns an actionable conflict when the base cannot be integrated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{"mergeable_state":"dirty"}', { status: 200 }),
    ));
    const result = await updatePullRequestBranch(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('conflict');
  });

  it('does not enqueue another GitLab rebase when the branch is current', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"diverged_commits_count":0,"rebase_in_progress":false}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(updatePullRequestBranch({ ...input, provider: 'gitlab' })).resolves.toEqual({ ok: true, updated: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
