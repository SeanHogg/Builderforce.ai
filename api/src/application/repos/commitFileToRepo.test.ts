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

describe('commitFileToRepo — Bitbucket still unsupported (write API deferred)', () => {
  it('returns unsupported without calling fetch', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const r = await commitFileToRepo({ ...commitBase, provider: 'bitbucket' });
    expect(r.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
