import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const executeGitProxy = vi.fn();
vi.mock('../../application/repos/gitProxy', () => ({ executeGitProxy: (opts: unknown) => executeGitProxy(opts) }));

import { GIT_PROXY_SUBPATHS, proxyGitSmartHttp } from './gitProxyHandler';
import type { ProxyRepo } from '../../application/repos/gitProxy';

const repo = { provider: 'github', owner: 'o', repo: 'r' } as unknown as ProxyRepo;

/** The ONE forwarding body every git smart-HTTP mount (browser, host, container) shares. */
describe('proxyGitSmartHttp', () => {
  const app = new Hono();
  for (const { subPath, method } of GIT_PROXY_SUBPATHS) {
    const path = `/x/${subPath}`;
    if (method === 'GET') app.get(path, (c) => proxyGitSmartHttp(c, repo, 'tok', subPath, method));
    else app.post(path, (c) => proxyGitSmartHttp(c, repo, 'tok', subPath, method));
  }

  it('forwards a GET with its query and the server-side token', async () => {
    executeGitProxy.mockResolvedValueOnce({ ok: true, response: new Response('refs', { status: 200 }) });
    const res = await app.request('/x/info/refs?service=git-upload-pack');
    expect(await res.text()).toBe('refs');
    expect(executeGitProxy).toHaveBeenLastCalledWith(expect.objectContaining({
      repo, token: 'tok', subPath: 'info/refs', method: 'GET', query: 'service=git-upload-pack', body: undefined,
    }));
  });

  it('forwards a POST body and maps an upstream refusal to 400', async () => {
    executeGitProxy.mockResolvedValueOnce({ ok: false, error: 'bad path' });
    const res = await app.request('/x/git-receive-pack', { method: 'POST', body: 'pack', headers: { 'Content-Type': 'application/x-git-receive-pack-request' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad path' });
    const opts = executeGitProxy.mock.lastCall?.[0] as { body: ArrayBuffer; contentType: string; query: unknown };
    expect(opts.contentType).toBe('application/x-git-receive-pack-request');
    expect(opts.query).toBeUndefined();
    expect(new TextDecoder().decode(opts.body)).toBe('pack');
  });
});
