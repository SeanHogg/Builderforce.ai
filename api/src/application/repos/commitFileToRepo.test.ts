import { describe, it, expect, vi, afterEach } from 'vitest';
import { commitFileToRepo, deleteFileFromRepo } from './commitFileToRepo';

afterEach(() => vi.unstubAllGlobals());

function res(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const commitBase = {
  host: null, owner: 'acme', repo: 'app', token: 't',
  branch: 'feature', base: 'main', path: 'src/x.ts', content: 'hi', message: 'msg',
};

describe('commitFileToRepo — GitLab [non-github write]', () => {
  it('creates the branch off base, probes existence (404 → POST create)', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url.includes('/repository/branches?')) return res({ name: 'feature' }, 201);
      if (url.includes('/repository/files/') && (init?.method ?? 'GET') === 'GET') return res({ message: '404' }, 404);
      if (url.includes('/repository/files/')) return res({ file_path: 'src/x.ts', branch: 'feature' }, 201);
      return res({}, 404);
    }));
    const r = await commitFileToRepo({ ...commitBase, provider: 'gitlab' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.existed).toBe(false);
    // branch URL-encoded project path + create-branch + POST file
    expect(calls.some((c) => c.url.includes('/projects/acme%2Fapp/repository/branches'))).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/repository/files/src%2Fx.ts'))).toBe(true);
  });

  it('uses PUT (update) when the file already exists on the branch', async () => {
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/repository/branches?')) return res({}, 400); // already exists
      if (url.includes('/repository/files/') && (init?.method ?? 'GET') === 'GET') return res({ file_path: 'src/x.ts' }, 200);
      if (url.includes('/repository/files/')) { methods.push(init?.method ?? 'GET'); return res({ file_path: 'src/x.ts' }, 200); }
      return res({}, 404);
    }));
    const r = await commitFileToRepo({ ...commitBase, provider: 'gitlab' });
    expect(r.ok && r.existed).toBe(true);
    expect(methods).toContain('PUT');
  });

  it('refuses overwrite when the existence probe is not 404', async () => {
    const fileMethods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/repository/files/')) fileMethods.push(init?.method ?? 'GET');
      if (url.includes('/repository/branches?')) return res({}, 400);
      if (url.includes('/repository/files/') && (init?.method ?? 'GET') === 'GET') return res({ message: '500' }, 500);
      if (url.includes('/repository/files/')) return res({ file_path: 'src/x.ts' }, 200);
      return res({}, 404);
    }));
    const r = await commitFileToRepo({ ...commitBase, provider: 'gitlab' });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.code).toBe('unreadable');
    expect(fileMethods).toEqual(['GET']);
  });

  it('refuses replacing a large existing file with a much smaller body', async () => {
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET');
      if (url.includes('/repository/branches?')) return res({}, 400);
      if (url.includes('/repository/files/') && (init?.method ?? 'GET') === 'GET') {
        return res({ file_path: 'src/x.ts', size: 20000 }, 200);
      }
      if (url.includes('/repository/files/')) return res({ file_path: 'src/x.ts' }, 200);
      return res({}, 404);
    }));
    const r = await commitFileToRepo({ ...commitBase, provider: 'gitlab', content: 'tiny\n' });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.code).toBe('destructive_overwrite');
    expect(methods).not.toContain('PUT');
  });
});

describe('deleteFileFromRepo — GitLab', () => {
  it('DELETEs the file; maps 404 to not_found', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ message: '404 Not Found' }, 404)));
    const r = await deleteFileFromRepo({ host: null, owner: 'acme', repo: 'app', token: 't', branch: 'feature', path: 'src/x.ts', message: 'rm', provider: 'gitlab' });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.code).toBe('not_found');
  });

  it('returns ok on a successful delete', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ branch: 'feature' }, 200)));
    const r = await deleteFileFromRepo({ host: null, owner: 'acme', repo: 'app', token: 't', branch: 'feature', path: 'src/x.ts', message: 'rm', provider: 'gitlab' });
    expect(r.ok).toBe(true);
  });
});

describe('commitFileToRepo — Bitbucket Cloud (/src form-encoded)', () => {
  it('resolves base hash, creates the branch, commits via form-encoded /src', async () => {
    const calls: Array<{ url: string; method: string; ct?: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', ct: (init?.headers as Record<string, string>)?.['Content-Type'] });
      if (url.includes('/refs/branches/main')) return res({ target: { hash: 'basehash' } });
      if (url.endsWith('/refs/branches')) return res({ name: 'feature' }, 201);
      if (url.includes('/src/') && (init?.method ?? 'GET') === 'GET') return res({ path: 'src/x.ts' }, 404); // not existing
      if (url.endsWith('/src')) return res({}, 201);
      return res({}, 404);
    }));
    const r = await commitFileToRepo({ ...commitBase, provider: 'bitbucket' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.existed).toBe(false);
    const srcPost = calls.find((c) => c.method === 'POST' && c.url.endsWith('/src'));
    expect(srcPost?.ct).toBe('application/x-www-form-urlencoded');
  });

  it('rejects an unknown provider without calling fetch', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const r = await commitFileToRepo({ ...commitBase, provider: 'gitea' });
    expect(r.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('commitFileToRepo — GitHub overwrite guard', () => {
  function githubFetch(contents: Response, extra?: { put?: boolean }) {
    const put = extra?.put === true;
    return vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.includes('/git/ref/heads/')) return res({ object: { sha: 'basesha' } });
      if (url.endsWith('/git/refs') && method === 'POST') return res({ ref: 'refs/heads/feature' }, 201);
      if (url.includes('/contents/') && method === 'GET') return contents;
      if (url.includes('/contents/') && method === 'PUT') {
        if (!put) throw new Error('PUT should not have been sent');
        return res({ commit: { html_url: 'https://example/commit' } });
      }
      return res({}, 404);
    });
  }

  it('still creates when GitHub reports the path missing', async () => {
    vi.stubGlobal('fetch', githubFetch(res({ message: 'Not Found' }, 404), { put: true }));
    const r = await commitFileToRepo({ ...commitBase, provider: 'github' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.existed).toBe(false);
  });

  it('hard-stops when GitHub cannot read the existing file', async () => {
    vi.stubGlobal('fetch', githubFetch(res({ message: 'server error' }, 500)));
    const r = await commitFileToRepo({ ...commitBase, provider: 'github' });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.code).toBe('unreadable');
  });

  it('refuses shrinking a large GitHub file', async () => {
    vi.stubGlobal('fetch', githubFetch(res({ sha: 'filesha', size: 34000 })));
    const r = await commitFileToRepo({ ...commitBase, provider: 'github', content: '# tiny\n' });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.code).toBe('destructive_overwrite');
  });
});
