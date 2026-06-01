import { describe, expect, it, vi } from 'vitest';
import {
  createRepoSource,
  selectEvidence,
  isSecretPath,
  isBinaryPath,
  isExcludedPath,
  type FetchLike,
  type RepoTreeEntry,
} from './RepoSource';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}
function b64(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64');
}

describe('selectEvidence', () => {
  const tree: RepoTreeEntry[] = [
    { path: 'package.json', type: 'file', bytes: 400 },
    { path: 'README.md', type: 'file', bytes: 800 },
    { path: 'src/index.ts', type: 'file', bytes: 1200 },
    { path: 'src/big-module.ts', type: 'file', bytes: 9000 },
    { path: 'src/util.ts', type: 'file', bytes: 300 },
    { path: 'node_modules/dep/index.js', type: 'file', bytes: 50000 },
    { path: 'logo.png', type: 'file', bytes: 4000 },
    { path: '.env', type: 'file', bytes: 100 },
    { path: 'src', type: 'dir' },
  ];

  it('prioritizes manifests and entrypoints over plain modules', () => {
    const picked = selectEvidence(tree, { maxFiles: 4, maxTokens: 100000 });
    const paths = picked.map((p) => p.path);
    expect(paths).toContain('package.json');
    expect(paths).toContain('README.md');
    expect(paths).toContain('src/index.ts');
    // manifests/entrypoints rank above the larger plain module within the budget
    expect(paths.indexOf('package.json')).toBeLessThan(paths.indexOf('src/index.ts') + 1);
  });

  it('excludes vendored, binary, and secret files', () => {
    const picked = selectEvidence(tree, { maxFiles: 20, maxTokens: 1_000_000 });
    const paths = picked.map((p) => p.path);
    expect(paths).not.toContain('node_modules/dep/index.js');
    expect(paths).not.toContain('logo.png');
    expect(paths).not.toContain('.env');
    expect(paths).not.toContain('src'); // directories are not files
  });

  it('respects the file count budget', () => {
    const picked = selectEvidence(tree, { maxFiles: 2, maxTokens: 1_000_000 });
    expect(picked).toHaveLength(2);
  });

  it('classifier helpers behave', () => {
    expect(isSecretPath('config/.env')).toBe(true);
    expect(isSecretPath('deploy/server.pem')).toBe(true);
    expect(isBinaryPath('assets/logo.png')).toBe(true);
    expect(isBinaryPath('app.min.js')).toBe(true);
    expect(isExcludedPath('dist/bundle.js')).toBe(true);
    expect(isExcludedPath('src/index.ts')).toBe(false);
  });
});

describe('GitHubRepoSource', () => {
  it('reads default branch, tree, file content, and commits', async () => {
    const fetchFn: FetchLike = vi.fn(async (url: string) => {
      if (url.endsWith('/repos/o/r')) return jsonResponse({ default_branch: 'develop' });
      if (url.includes('/git/trees/develop')) {
        return jsonResponse({
          truncated: false,
          tree: [
            { path: 'package.json', type: 'blob', size: 100 },
            { path: 'src', type: 'tree' },
          ],
        });
      }
      if (url.includes('/contents/package.json')) {
        return jsonResponse({ encoding: 'base64', size: 20, content: b64('{"name":"x"}') });
      }
      if (url.includes('/commits')) {
        return jsonResponse([{ sha: 'abc', commit: { message: 'init', author: { date: '2024-01-01' } } }]);
      }
      return jsonResponse({}, 404);
    });
    const src = createRepoSource('github', { owner: 'o', repo: 'r', token: 'tok' }, fetchFn);

    expect(await src.getDefaultBranch()).toBe('develop');
    const tree = await src.getTree('develop');
    expect(tree.entries).toEqual([
      { path: 'package.json', type: 'file', bytes: 100 },
      { path: 'src', type: 'dir', bytes: undefined },
    ]);
    expect(await src.getFileContent('package.json', 'develop')).toBe('{"name":"x"}');
    const commits = await src.listCommits('develop', 5);
    expect(commits[0]).toEqual({ sha: 'abc', message: 'init', date: '2024-01-01' });
  });

  it('throws RepoSourceError on tree failure', async () => {
    const fetchFn: FetchLike = vi.fn(async () => jsonResponse({ message: 'boom' }, 500));
    const src = createRepoSource('github', { owner: 'o', repo: 'r', token: 't' }, fetchFn);
    await expect(src.getTree('main')).rejects.toThrow(/tree fetch failed/);
  });
});

describe('GitLabRepoSource', () => {
  it('paginates the tree via x-next-page and decodes files', async () => {
    const fetchFn: FetchLike = vi.fn(async (url: string) => {
      if (/\/projects\/o%2Fr$/.test(url)) return jsonResponse({ default_branch: 'main' });
      if (url.includes('/repository/tree')) {
        if (url.includes('&page=1')) {
          return jsonResponse([{ path: 'a.ts', type: 'blob' }], 200, { 'x-next-page': '2' });
        }
        return jsonResponse([{ path: 'b.ts', type: 'blob' }], 200); // no x-next-page → last page
      }
      if (url.includes('/repository/files/')) {
        return jsonResponse({ encoding: 'base64', size: 5, content: b64('hello') });
      }
      return jsonResponse([], 200);
    });
    const src = createRepoSource('gitlab', { owner: 'o', repo: 'r', token: 't' }, fetchFn);
    const tree = await src.getTree('main');
    expect(tree.entries.map((e) => e.path)).toEqual(['a.ts', 'b.ts']);
    expect(await src.getFileContent('a.ts', 'main')).toBe('hello');
  });
});

describe('BitbucketRepoSource', () => {
  it('reads mainbranch, src listing, raw file, and commits', async () => {
    const fetchFn: FetchLike = vi.fn(async (url: string) => {
      if (/\/repositories\/o\/r$/.test(url)) return jsonResponse({ mainbranch: { name: 'trunk' } });
      if (url.includes('/src/') && url.includes('max_depth')) {
        return jsonResponse({
          values: [
            { path: 'main.py', type: 'commit_file', size: 50 },
            { path: 'pkg', type: 'commit_directory' },
          ],
        });
      }
      if (url.includes('/src/') && url.includes('main.py')) return textResponse('print(1)');
      if (url.includes('/commits/')) return jsonResponse({ values: [{ hash: 'h1', message: 'm', date: '2024-02-02' }] });
      return jsonResponse({}, 404);
    });
    const src = createRepoSource('bitbucket', { owner: 'o', repo: 'r', token: 't', username: 'u' }, fetchFn);
    expect(await src.getDefaultBranch()).toBe('trunk');
    const tree = await src.getTree('trunk');
    expect(tree.entries).toEqual([{ path: 'main.py', type: 'file', bytes: 50 }]); // dir filtered
    expect(await src.getFileContent('main.py', 'trunk')).toBe('print(1)');
    const commits = await src.listCommits('trunk', 5);
    expect(commits[0]).toEqual({ sha: 'h1', message: 'm', date: '2024-02-02' });
  });
});
