/**
 * Reverting work that already MERGED. These tests are mostly about what the module
 * REFUSES to do — it is the only part of the rollback story that writes new commits,
 * so the guarantees (never a push to base, never over newer work, never a silent
 * no-op on a provider that cannot do it) are pinned individually.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { revertMergedPullRequest, revertBranchName } from './revertMergedPullRequest';

const target = { host: null, owner: 'acme', repo: 'app', token: 't0k' };
const input = { ...target, number: 7, base: 'main', revertBranch: 'builderforce/revert-task-12-pr-7', title: 'Revert task #12', body: 'because' };

afterEach(() => { vi.unstubAllGlobals(); });

/** Route each request to the first matching (pattern → response) rule. */
function stubRoutes(rules: Array<[RegExp, { status?: number; body?: unknown }]>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const rule = rules.find(([re]) => re.test(`${init?.method ?? 'GET'} ${url}`));
    const status = rule?.[1].status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => rule?.[1].body ?? null,
      text: async () => (typeof rule?.[1].body === 'string' ? rule[1].body : JSON.stringify(rule?.[1].body ?? '')),
    };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('revertMergedPullRequest — refusals', () => {
  it('refuses a provider with no REST API at all', async () => {
    expect(await revertMergedPullRequest({ ...input, provider: 'gitea' }))
      .toMatchObject({ ok: false, code: 'unsupported' });
  });

  it('refuses Bitbucket SERVER only, naming the endpoint it lacks', async () => {
    // The refusal survives for the ONE dialect that genuinely cannot express a
    // revert. Cloud is served (see the Bitbucket Cloud block below), so a blanket
    // "Bitbucket cannot revert" would now be a defect rather than a limitation.
    const server = await revertMergedPullRequest({ ...input, provider: 'bitbucket', host: 'git.acme.internal' });
    expect(server).toMatchObject({ ok: false, code: 'unsupported' });
    if (!server.ok) {
      expect(server.reason).toMatch(/Bitbucket Server/);
      expect(server.reason).toMatch(/browse/);           // the write endpoint it does have
      expect(server.reason).toMatch(/delete-file|no delete/); // the one it does not
    }
  });

  it('NEVER commits onto the base branch', async () => {
    const fn = stubRoutes([]);
    expect(await revertMergedPullRequest({ ...input, provider: 'github', revertBranch: 'main' }))
      .toMatchObject({ ok: false, code: 'provider_error' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('refuses an unmerged PR (that is a close, not a revert)', async () => {
    stubRoutes([[/pulls\/7/, { body: { merged: false } }]]);
    expect(await revertMergedPullRequest({ ...input, provider: 'github' }))
      .toMatchObject({ ok: false, code: 'not_merged' });
  });

  it('refuses when newer work landed on the merged files', async () => {
    stubRoutes([
      [/pulls\/7/, { body: { merged: true, merge_commit_sha: 'm3rge' } }],
      [/commits\/m3rge/, { body: { parents: [{ sha: 'p4rent' }], files: [{ filename: 'src/a.ts' }] } }],
      [/compare\/m3rge/, { body: { files: [{ filename: 'src/a.ts' }] } }],
    ]);
    const r = await revertMergedPullRequest({ ...input, provider: 'github' });
    expect(r).toMatchObject({ ok: false, code: 'conflict' });
    if (!r.ok) expect(r.reason).toMatch(/src\/a\.ts/);
  });

  it('refuses when the pre-merge tree is too large for GitHub to list in full', async () => {
    stubRoutes([
      [/pulls\/7/, { body: { merged: true, merge_commit_sha: 'm3rge' } }],
      [/commits\/m3rge/, { body: { parents: [{ sha: 'p4rent' }], files: [{ filename: 'src/a.ts' }] } }],
      [/compare\/m3rge/, { body: { files: [] } }],
      [/git\/ref\/heads\/main/, { body: { object: { sha: 'h3ad' } } }],
      [/git\/commits\/h3ad/, { body: { tree: { sha: 'tr33' } } }],
      [/git\/trees\/p4rent/, { body: { truncated: true, tree: [] } }],
    ]);
    expect(await revertMergedPullRequest({ ...input, provider: 'github' }))
      .toMatchObject({ ok: false, code: 'provider_error' });
  });
});

describe('revertMergedPullRequest — GitHub', () => {
  it('restores the pre-merge blobs on a NEW branch and opens a PR against base', async () => {
    const fn = stubRoutes([
      [/GET .*pulls\/7$/, { body: { merged: true, merge_commit_sha: 'm3rge' } }],
      [/commits\/m3rge/, { body: { parents: [{ sha: 'p4rent' }], files: [{ filename: 'src/a.ts' }, { filename: 'src/new.ts' }] } }],
      [/compare\/m3rge/, { body: { files: [{ filename: 'docs/unrelated.md' }] } }],
      [/git\/ref\/heads\/main/, { body: { object: { sha: 'h3ad' } } }],
      [/git\/commits\/h3ad/, { body: { tree: { sha: 'tr33' } } }],
      [/git\/trees\/p4rent/, { body: { tree: [{ path: 'src/a.ts', mode: '100755', type: 'blob', sha: 'bl0b' }] } }],
      [/POST .*git\/trees$/, { body: { sha: 'newtr33' } }],
      [/POST .*git\/commits$/, { body: { sha: 'c0mmit' } }],
      [/POST .*git\/refs$/, { body: {} }],
      [/POST .*\/pulls$/, { body: { number: 42, html_url: 'https://gh/pr/42' } }],
    ]);

    const r = await revertMergedPullRequest({ ...input, provider: 'github' });
    expect(r).toEqual({
      ok: true, number: 42, url: 'https://gh/pr/42',
      branch: 'builderforce/revert-task-12-pr-7', revertedSha: 'm3rge',
    });

    const body = (call: RegExp) => JSON.parse(String((fn.mock.calls.find(([u, i]) =>
      call.test(`${(i as RequestInit | undefined)?.method ?? 'GET'} ${u}`)) as [string, RequestInit])[1].body));

    // The tree is written ON TOP of the base head's tree: a path present before the
    // merge is restored to its old blob (mode preserved), and a path the merge ADDED
    // is deleted (sha: null).
    expect(body(/POST .*git\/trees$/)).toEqual({
      base_tree: 'tr33',
      tree: [
        { path: 'src/a.ts', mode: '100755', type: 'blob', sha: 'bl0b' },
        { path: 'src/new.ts', mode: '100644', type: 'blob', sha: null },
      ],
    });
    // The commit parents the CURRENT base head — no history rewrite.
    expect(body(/POST .*git\/commits$/)).toMatchObject({ tree: 'newtr33', parents: ['h3ad'] });
    // The ref created is the revert branch, never `main`.
    expect(body(/POST .*git\/refs$/)).toEqual({ ref: 'refs/heads/builderforce/revert-task-12-pr-7', sha: 'c0mmit' });
    // And the PR targets base FROM that branch.
    expect(body(/POST .*\/pulls$/)).toMatchObject({ head: 'builderforce/revert-task-12-pr-7', base: 'main' });
  });

  it('reports the pushed branch honestly when only the PR-open step fails', async () => {
    stubRoutes([
      [/GET .*pulls\/7$/, { body: { merged: true, merge_commit_sha: 'm3rge' } }],
      [/commits\/m3rge/, { body: { parents: [{ sha: 'p4rent' }], files: [{ filename: 'src/a.ts' }] } }],
      [/compare\/m3rge/, { body: { files: [] } }],
      [/git\/ref\/heads\/main/, { body: { object: { sha: 'h3ad' } } }],
      [/git\/commits\/h3ad/, { body: { tree: { sha: 'tr33' } } }],
      [/git\/trees\/p4rent/, { body: { tree: [{ path: 'src/a.ts', mode: '100644', type: 'blob', sha: 'bl0b' }] } }],
      [/POST .*git\/trees$/, { body: { sha: 'newtr33' } }],
      [/POST .*git\/commits$/, { body: { sha: 'c0mmit' } }],
      [/POST .*git\/refs$/, { body: {} }],
      [/pulls/, { status: 500, body: 'boom' }],
    ]);
    const r = await revertMergedPullRequest({ ...input, provider: 'github' });
    expect(r).toMatchObject({ ok: false, code: 'provider_error' });
    if (!r.ok) expect(r.reason).toMatch(/was pushed to 'builderforce\/revert-task-12-pr-7'/);
  });
});

describe('revertMergedPullRequest — GitLab', () => {
  it('cuts a branch from base, reverts on it, and opens the MR', async () => {
    const fn = stubRoutes([
      [/GET .*merge_requests\/7$/, { body: { state: 'merged', merge_commit_sha: 'gl-m3rge' } }],
      [/POST .*repository\/branches/, { body: { name: 'builderforce/revert-task-12-pr-7' } }],
      [/commits\/gl-m3rge\/revert/, { body: { id: 'rev-sha' } }],
      [/POST .*merge_requests$/, { body: { iid: 9, web_url: 'https://gl/mr/9' } }],
    ]);
    expect(await revertMergedPullRequest({ ...input, provider: 'gitlab' }))
      .toEqual({ ok: true, number: 9, url: 'https://gl/mr/9', branch: 'builderforce/revert-task-12-pr-7', revertedSha: 'gl-m3rge' });
    expect(fn.mock.calls.some(([u]) => String(u).includes('ref=main'))).toBe(true);
  });

  it('reverses a SQUASHED MR via its squash commit', async () => {
    stubRoutes([
      [/GET .*merge_requests\/7$/, { body: { state: 'merged', merge_commit_sha: null, squash_commit_sha: 'sq-sha' } }],
      [/POST .*repository\/branches/, { body: {} }],
      [/commits\/sq-sha\/revert/, { body: {} }],
      [/POST .*merge_requests$/, { body: { iid: 9, web_url: 'https://gl/mr/9' } }],
    ]);
    expect(await revertMergedPullRequest({ ...input, provider: 'gitlab' })).toMatchObject({ ok: true, revertedSha: 'sq-sha' });
  });

  it('maps a GitLab revert conflict to `conflict` and cleans up the branch it cut', async () => {
    const fn = stubRoutes([
      [/GET .*merge_requests\/7$/, { body: { state: 'merged', merge_commit_sha: 'gl-m3rge' } }],
      [/POST .*repository\/branches/, { body: {} }],
      [/revert/, { status: 400, body: 'Sorry, we cannot revert this commit automatically. It may have already been reverted, or a more recent commit may have updated some of its content.' }],
    ]);
    expect(await revertMergedPullRequest({ ...input, provider: 'gitlab' }))
      .toMatchObject({ ok: false, code: 'conflict' });
    expect(fn.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'DELETE')).toBe(true);
  });
});

describe('revertBranchName', () => {
  it('is task- and PR-scoped so a retry collides instead of duplicating', () => {
    expect(revertBranchName(12, 7)).toBe('builderforce/revert-task-12-pr-7');
  });
});

describe('revertMergedPullRequest — Bitbucket Cloud', () => {
  const bb = { ...input, provider: 'bitbucket', host: 'bitbucket.org' };
  const PR = /GET .*\/repositories\/acme\/app\/pullrequests\/7$/;
  const MERGE_COMMIT = /GET .*\/commit\/m3rge$/;
  const DIFF_MERGE = /GET .*\/diffstat\/m3rge\.\.parent1/;
  const DIFF_SINCE = /GET .*\/diffstat\/main\.\.m3rge/;
  const BRANCH_HEAD = /GET .*\/refs\/branches\/main$/;

  const mergedPr = { state: 'MERGED', merge_commit: { hash: 'm3rge' } };
  const commit = { parents: [{ hash: 'parent1' }] };

  it('refuses a PR that is not merged', async () => {
    stubRoutes([[PR, { body: { state: 'OPEN' } }]]);
    expect(await revertMergedPullRequest(bb)).toMatchObject({ ok: false, code: 'not_merged' });
  });

  it('refuses when newer work landed on the same files after the merge', async () => {
    stubRoutes([
      [PR, { body: mergedPr }],
      [MERGE_COMMIT, { body: commit }],
      [DIFF_MERGE, { body: { values: [{ new: { path: 'src/a.ts' } }] } }],
      [DIFF_SINCE, { body: { values: [{ new: { path: 'src/a.ts' } }] } }],
    ]);
    const r = await revertMergedPullRequest(bb);
    expect(r).toMatchObject({ ok: false, code: 'conflict' });
    if (!r.ok) expect(r.reason).toMatch(/src\/a\.ts/);
  });

  it('restores pre-merge content and DELETES files the merge added, in one /src commit', async () => {
    // src/a.ts existed before the merge (restore its bytes); src/new.ts did not
    // (404 at the pre-merge sha), so reverting it means removing it.
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      const json = (body: unknown, status = 200) => ({
        ok: status >= 200 && status < 300, status,
        json: async () => body, text: async () => JSON.stringify(body),
        headers: new Headers(),
      });
      if (PR.test(key)) return json(mergedPr);
      if (MERGE_COMMIT.test(key)) return json(commit);
      if (DIFF_MERGE.test(key)) return json({ values: [{ new: { path: 'src/a.ts' } }, { new: { path: 'src/new.ts' } }] });
      if (DIFF_SINCE.test(key)) return json({ values: [] });
      if (BRANCH_HEAD.test(key)) return json({ target: { hash: 'head9' } });
      if (/GET .*\/src\/parent1\/src\/a\.ts$/.test(key)) {
        return { ok: true, status: 200, text: async () => 'export const a = 1;\n', json: async () => null, headers: new Headers() };
      }
      if (/GET .*\/src\/parent1\/src\/new\.ts$/.test(key)) {
        return { ok: false, status: 404, text: async () => '', json: async () => null, headers: new Headers() };
      }
      if (/POST .*\/repositories\/acme\/app\/src$/.test(key)) return json({});
      // The revert PR itself.
      if (/POST .*\/pullrequests$/.test(key)) return json({ id: 42, links: { html: { href: 'https://bitbucket.org/acme/app/pull-requests/42' } } });
      return json(null, 404);
    });
    vi.stubGlobal('fetch', fn);

    const r = await revertMergedPullRequest(bb);
    expect(r).toMatchObject({ ok: true, number: 42, branch: bb.revertBranch, revertedSha: 'm3rge' });

    const post = fn.mock.calls.find(([u, i]) => (i as RequestInit | undefined)?.method === 'POST' && String(u).endsWith('/src'));
    expect(post).toBeDefined();
    const form = new URLSearchParams(String((post![1] as RequestInit).body));
    expect(form.get('branch')).toBe(bb.revertBranch);
    // Parented to the CURRENT head of base, never rewriting base itself.
    expect(form.get('parents')).toBe('head9');
    expect(form.get('src/a.ts')).toBe('export const a = 1;\n');
    expect(form.getAll('files')).toEqual(['src/new.ts']);
    // The file being restored must NOT also be queued for deletion.
    expect(form.getAll('files')).not.toContain('src/a.ts');
  });

  it('never guesses: an unreadable pre-merge file aborts rather than committing', async () => {
    stubRoutes([
      [PR, { body: mergedPr }],
      [MERGE_COMMIT, { body: commit }],
      [DIFF_MERGE, { body: { values: [{ new: { path: 'src/a.ts' } }] } }],
      [DIFF_SINCE, { body: { values: [] } }],
      [BRANCH_HEAD, { body: { target: { hash: 'head9' } } }],
      [/GET .*\/src\/parent1\//, { status: 500 }],
    ]);
    const r = await revertMergedPullRequest(bb);
    expect(r).toMatchObject({ ok: false, code: 'provider_error' });
    if (!r.ok) expect(r.reason).toMatch(/pre-merge content/);
  });
});
