import { describe, it, expect, vi, afterEach } from 'vitest';
import { getPullRequestDetail } from './getPullRequestDetail';
import type { Env } from '../../env';

afterEach(() => vi.unstubAllGlobals());

// No KV binding → the read-through cache falls straight through to the loader.
const env = {} as unknown as Env;

/**
 * PARITY ACROSS PROVIDERS.
 *
 * The PR detail was GitHub-shaped: GitLab reported a FILE count and no size, Bitbucket
 * reported state and nothing else, and neither reported the merge commit — so the same
 * screen showed a reviewer a diffstat and a CI light on one provider and a bare state
 * pill on the others, and post-merge build validation (which correlates a deploy event
 * through `pull_requests.merge_sha`) could never fire for them.
 */
function routed(routes: Array<[RegExp, unknown]>) {
  return vi.fn(async (url: string) => {
    for (const [pattern, body] of routes) {
      if (pattern.test(String(url))) return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
}

const gitlabCoords = { provider: 'gitlab', host: null, owner: 'acme', repo: 'app', token: 't', number: 7 };
const bitbucketCoords = { provider: 'bitbucket', host: null, owner: 'acme', repo: 'app', token: 't', number: 7 };
const githubCoords = { provider: 'github', host: null, owner: 'acme', repo: 'app', token: 't', number: 7 };

describe('getPullRequestDetail — GitLab', () => {
  it('derives additions/deletions from the per-file unified diffs', async () => {
    vi.stubGlobal('fetch', routed([
      [/\/merge_requests\/7\/changes$/, {
        changes: [
          { diff: '--- a/x.ts\n+++ b/x.ts\n+added one\n+added two\n-removed one\n context\n' },
          { diff: '--- a/y.ts\n+++ b/y.ts\n+added three\n' },
        ],
      }],
      [/\/merge_requests\/7$/, { state: 'opened', merge_status: 'can_be_merged', changes_count: '2' }],
    ]));
    const d = await getPullRequestDetail(env, 'pr-gl-1', 'v1', gitlabCoords);
    // The `+++`/`---` file headers must NOT be counted — that is the classic
    // over-report-by-two-per-file bug in a hand-rolled diffstat.
    expect(d.additions).toBe(3);
    expect(d.deletions).toBe(1);
    expect(d.changedFiles).toBe(2);
  });

  it('falls back to changes_count when the diffs cannot be read', async () => {
    vi.stubGlobal('fetch', routed([
      [/\/merge_requests\/7$/, { state: 'opened', changes_count: '5' }],
    ]));
    const d = await getPullRequestDetail(env, 'pr-gl-2', 'v1', gitlabCoords);
    expect(d.changedFiles).toBe(5);
    expect(d.additions).toBeNull();
    expect(d.deletions).toBeNull();
  });

  it('reports the merge commit once the MR is merged', async () => {
    vi.stubGlobal('fetch', routed([
      [/\/merge_requests\/7\/changes$/, { changes: [] }],
      [/\/merge_requests\/7$/, { state: 'merged', merged_at: '2026-01-01T00:00:00Z', merge_commit_sha: 'gl-merge-sha' }],
    ]));
    const d = await getPullRequestDetail(env, 'pr-gl-3', 'v1', gitlabCoords);
    expect(d.merged).toBe(true);
    expect(d.mergeSha).toBe('gl-merge-sha');
  });
});

describe('getPullRequestDetail — Bitbucket', () => {
  it('reports a diffstat and a combined build state', async () => {
    vi.stubGlobal('fetch', routed([
      [/\/pullrequests\/7\/diffstat/, { size: 3, values: [
        { lines_added: 10, lines_removed: 2 },
        { lines_added: 5, lines_removed: 0 },
      ] }],
      [/\/pullrequests\/7\/statuses/, { values: [{ state: 'SUCCESSFUL' }, { state: 'SUCCESSFUL' }] }],
      [/\/pullrequests\/7$/, { state: 'OPEN' }],
    ]));
    const d = await getPullRequestDetail(env, 'pr-bb-1', 'v1', bitbucketCoords);
    expect(d.additions).toBe(15);
    expect(d.deletions).toBe(2);
    // `size` is the WHOLE diffstat, not just the page that came back.
    expect(d.changedFiles).toBe(3);
    expect(d.checks).toBe('success');
    expect(d.checksTotal).toBe(2);
  });

  it('lets a single FAILED status decide the combined state', async () => {
    vi.stubGlobal('fetch', routed([
      [/\/pullrequests\/7\/diffstat/, { size: 1, values: [{ lines_added: 1, lines_removed: 0 }] }],
      [/\/pullrequests\/7\/statuses/, { values: [{ state: 'SUCCESSFUL' }, { state: 'FAILED' }] }],
      [/\/pullrequests\/7$/, { state: 'OPEN' }],
    ]));
    const d = await getPullRequestDetail(env, 'pr-bb-2', 'v1', bitbucketCoords);
    expect(d.checks).toBe('failure');
  });

  it('degrades to nulls — not an error — when neither extra endpoint answers', async () => {
    vi.stubGlobal('fetch', routed([
      [/\/pullrequests\/7$/, { state: 'MERGED', merge_commit: { hash: 'bb-merge-sha' } }],
    ]));
    const d = await getPullRequestDetail(env, 'pr-bb-3', 'v1', bitbucketCoords);
    expect(d.supported).toBe(true);
    expect(d.additions).toBeNull();
    expect(d.checks).toBeNull();
    expect(d.checksTotal).toBe(0);
    expect(d.merged).toBe(true);
    expect(d.mergeSha).toBe('bb-merge-sha');
  });
});

describe('getPullRequestDetail — GitHub merge commit', () => {
  it('reports merge_commit_sha only once the PR is actually merged', async () => {
    vi.stubGlobal('fetch', routed([
      [/\/commits\/.*\/status$/, { state: 'success', total_count: 1 }],
      [/\/pulls\/7$/, { state: 'closed', merged: true, merge_commit_sha: 'gh-merge-sha', head: { sha: 'head-sha' } }],
    ]));
    const merged = await getPullRequestDetail(env, 'pr-gh-1', 'v1', githubCoords);
    expect(merged.mergeSha).toBe('gh-merge-sha');

    // An OPEN PR also carries `merge_commit_sha` (GitHub's test-merge commit). Recording
    // it would stamp a sha no deploy will ever run on, so it must stay null.
    vi.stubGlobal('fetch', routed([
      [/\/commits\/.*\/status$/, { state: 'pending', total_count: 1 }],
      [/\/pulls\/7$/, { state: 'open', merged: false, merge_commit_sha: 'test-merge-sha', head: { sha: 'head-sha' } }],
    ]));
    const open = await getPullRequestDetail(env, 'pr-gh-2', 'v1', githubCoords);
    expect(open.mergeSha).toBeNull();
  });
});
