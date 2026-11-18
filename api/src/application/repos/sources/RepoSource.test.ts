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
import { readRepoFile } from '../readRepoContents';

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

  it('expands subtrees when the recursive root tree is truncated [1552]', async () => {
    const fetchFn: FetchLike = vi.fn(async (url: string) => {
      // 1) recursive root → truncated with only a partial listing
      if (url.includes('/git/trees/main?recursive=1')) {
        return jsonResponse({ truncated: true, tree: [{ path: 'README.md', type: 'blob', size: 10 }] });
      }
      // 2) per-subdir recursive subtree (by sha) → the files the root call dropped
      if (url.includes('/git/trees/sha-src?recursive=1')) {
        return jsonResponse({ truncated: false, tree: [
          { path: 'a.ts', type: 'blob', size: 5 },
          { path: 'b.ts', type: 'blob', size: 7 },
        ] });
      }
      // 3) non-recursive root → top-level listing carrying subdir shas
      if (url.includes('/git/trees/main')) {
        return jsonResponse({ tree: [
          { path: 'README.md', type: 'blob', size: 10 },
          { path: 'src', type: 'tree', sha: 'sha-src' },
        ] });
      }
      return jsonResponse({}, 404);
    });
    const src = createRepoSource('github', { owner: 'o', repo: 'r', token: 't' }, fetchFn);
    const tree = await src.getTree('main');
    const paths = tree.entries.map((e) => e.path).sort();
    expect(paths).toEqual(['README.md', 'src', 'src/a.ts', 'src/b.ts']); // subtree files re-rooted + deduped
    expect(tree.truncated).toBe(false); // fully recovered within the fetch cap
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

  describe('Server: /raw 404s', () => {
    const NO_SUCH_PATH = { errors: [{ exceptionName: 'com.atlassian.bitbucket.content.NoSuchPathException', message: 'gone' }] };
    const serverWith = (raw404: () => Response) => {
      const calls: string[] = [];
      const fetchFn: FetchLike = vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes('/raw/')) return raw404();
        return jsonResponse({ lines: [{ text: 'from browse' }], isLastPage: true });
      });
      return { calls, src: createRepoSource('bitbucket', { owner: 'PRJ', repo: 'r', token: 't', host: 'git.acme.internal' }, fetchFn) };
    };

    it("Server's own NoSuchPathException is a miss, with no /browse call", async () => {
      const { calls, src } = serverWith(() => jsonResponse(NO_SUCH_PATH, 404));
      expect(await src.getFileContent('gone.txt', 'main')).toBeNull();
      expect(calls).toHaveLength(1);
    });

    it.each([
      ['an HTML 404 (a proxy without /raw)', () => new Response('<html>Not Found</html>', { status: 404, headers: { 'Content-Type': 'text/html' } })],
      ['an empty 404 (an old Data Center build)', () => new Response(null, { status: 404 })],
      ['a JSON 404 naming another error', () => jsonResponse({ errors: [{ exceptionName: 'com.atlassian.OtherException' }] }, 404)],
    ])('%s still goes to /browse', async (_name, raw404) => {
      const { calls, src } = serverWith(raw404);
      expect(await src.getFileContent('kept.txt', 'main')).toBe('from browse');
      expect(calls.some((url) => url.includes('/browse/'))).toBe(true);
    });

    it.each([
      ['the page cap', (n: number) => jsonResponse({ lines: [{ text: `p${n}` }], isLastPage: false, nextPageStart: n * 1000 })],
      ['a refused page (429) after the first', (n: number) => (n === 1 ? jsonResponse({ lines: [{ text: 'p1' }], isLastPage: false, nextPageStart: 1000 }) : new Response(null, { status: 429 }))],
    ])('/browse stopped by %s is truncated, and readRepoFile reports it', async (_name, page) => {
      let browsed = 0;
      const fetch: FetchLike = vi.fn(async (url: string) => {
        if (url.includes('/raw/')) return new Response(null, { status: 404 });
        browsed += 1;
        return page(browsed);
      });
      const src = createRepoSource('bitbucket', { owner: 'PRJ', repo: 'r', token: 't', host: 'git.acme.internal', maxBrowsePages: 2 }, fetch);
      expect(await src.readFile!('big.txt', 'main')).toMatchObject({ truncated: true });
      browsed = 0;
      const read = await readRepoFile({ provider: 'bitbucket', host: 'git.acme.internal', owner: 'PRJ', repo: 'r', token: 't', ref: 'main', fetch, browsePageLimit: 2 }, 'big.txt');
      expect(read).toMatchObject({ ok: true, truncated: true, truncatedReason: 'incomplete' });
    });

    it('/browse read to its last page is whole', async () => {
      const fetch: FetchLike = vi.fn(async (url: string) => (url.includes('/raw/')
        ? new Response(null, { status: 404 })
        : jsonResponse({ lines: [{ text: 'all' }], isLastPage: true })));
      const read = await readRepoFile({ provider: 'bitbucket', host: 'git.acme.internal', owner: 'PRJ', repo: 'r', token: 't', ref: 'main', fetch }, 'small.txt');
      expect(read).toEqual({ ok: true, path: 'small.txt', content: 'all', truncated: false });
    });

    it('a file past the read cap is truncated for size, not as incomplete', async () => {
      const big = 'x'.repeat(70_000);
      const fetch: FetchLike = vi.fn(async () => textResponse(big));
      const read = await readRepoFile({ provider: 'bitbucket', host: 'git.acme.internal', owner: 'PRJ', repo: 'r', token: 't', ref: 'main', fetch }, 'big.txt');
      expect(read).toMatchObject({ ok: true, truncated: true, truncatedReason: 'size' });
    });

    it('maxBrowsePages bounds the /browse pages of one file', async () => {
      let browsed = 0;
      const fetchFn: FetchLike = vi.fn(async (url: string) => {
        if (url.includes('/raw/')) return new Response(null, { status: 404 });
        browsed += 1;
        return jsonResponse({ lines: [{ text: `p${browsed}` }], isLastPage: false, nextPageStart: browsed * 1000 });
      });
      const src = createRepoSource('bitbucket', { owner: 'PRJ', repo: 'r', token: 't', host: 'git.acme.internal', maxBrowsePages: 2 }, fetchFn);
      expect(await src.getFileContent('big.txt', 'main')).toBe('p1\np2');
      expect(browsed).toBe(2);
    });
  });
});
