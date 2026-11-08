import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { vi } from 'vitest';

const executeGitProxy = vi.fn();
vi.mock('../repos/gitProxy', () => ({ executeGitProxy: (opts: unknown) => executeGitProxy(opts) }));

import { receivePackDenial, receivePackRefs } from './containerPushScope';
import { proxyGitSmartHttp } from '../../presentation/routes/gitProxyHandler';
import type { ProxyRepo } from '../repos/gitProxy';

const ZERO = '0'.repeat(40);
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const enc = new TextEncoder();

/** One pkt-line (4-hex length includes itself). */
const pkt = (s: string) => `${(s.length + 4).toString(16).padStart(4, '0')}${s}`;
/** A receive-pack body: commands, flush, then a stand-in pack. */
const body = (...commands: string[]) => enc.encode(`${commands.map((c, i) => pkt(i === 0 ? `${c}\0report-status side-band-64k agent=git/2` : c)).join('')}0000PACK-bytes`);
const update = (ref: string) => `${A} ${B} ${ref}`;

describe('receivePackRefs', () => {
  it('reads every command, ignoring capabilities and the pack', () => {
    expect(receivePackRefs(body(update('refs/heads/bf/5'), update('refs/tags/v1')))).toEqual(['refs/heads/bf/5', 'refs/tags/v1']);
  });

  it('refuses anything that is not a plain command list', () => {
    expect(receivePackRefs(enc.encode(''))).toBeNull();
    expect(receivePackRefs(enc.encode('0000'))).toBeNull(); // no commands
    expect(receivePackRefs(enc.encode('zzzz'))).toBeNull();
    expect(receivePackRefs(enc.encode(`${pkt('push-cert\0report-status')}0000`))).toBeNull(); // signed push
    expect(receivePackRefs(enc.encode(`${pkt('not a command')}0000`))).toBeNull();
    expect(receivePackRefs(enc.encode('00ff short'))).toBeNull(); // a length past the body
  });
});

describe('receivePackDenial', () => {
  it('allows an update of the run branch only', () => {
    expect(receivePackDenial(body(update('refs/heads/bf/5')), 'bf/5')).toBeNull();
  });

  it('refuses the base branch, another branch, a tag, and a delete of anything else', () => {
    for (const ref of ['refs/heads/main', 'refs/heads/bf/6', 'refs/tags/v1', 'refs/heads/bf/5-evil', 'refs/heads/bf/5/x']) {
      expect(receivePackDenial(body(update(ref)), 'bf/5'), ref).toMatch(/may push only refs\/heads\/bf\/5/);
    }
    expect(receivePackDenial(body(`${A} ${ZERO} refs/heads/main`), 'bf/5')).not.toBeNull();
  });

  it('refuses a push that ALSO updates the run branch beside a stray ref', () => {
    expect(receivePackDenial(body(update('refs/heads/bf/5'), update('refs/heads/main')), 'bf/5')).toMatch(/refs\/heads\/main/);
  });

  it('refuses an unreadable body', () => {
    expect(receivePackDenial(enc.encode('garbage'), 'bf/5')).toMatch(/could not be read/);
  });
});

describe('the container-git door applies the scope before anything is forwarded', () => {
  const repo = { provider: 'github', owner: 'o', repo: 'r' } as unknown as ProxyRepo;
  const app = new Hono();
  app.post('/x/git-receive-pack', (c) => proxyGitSmartHttp(c, repo, 'tok', 'git-receive-pack', 'POST', (b) => receivePackDenial(b, 'bf/5')));

  it('forwards a push to the run branch', async () => {
    executeGitProxy.mockResolvedValueOnce({ ok: true, response: new Response('ok') });
    const res = await app.request('/x/git-receive-pack', { method: 'POST', body: body(update('refs/heads/bf/5')) });
    expect(res.status).toBe(200);
    expect(executeGitProxy).toHaveBeenCalledTimes(1);
  });

  it('answers 403 and forwards NOTHING for another ref or a compressed body', async () => {
    executeGitProxy.mockClear();
    const stray = await app.request('/x/git-receive-pack', { method: 'POST', body: body(update('refs/heads/main')) });
    expect(stray.status).toBe(403);
    const gz = await app.request('/x/git-receive-pack', { method: 'POST', body: body(update('refs/heads/bf/5')), headers: { 'Content-Encoding': 'gzip' } });
    expect(gz.status).toBe(403);
    expect(executeGitProxy).not.toHaveBeenCalled();
  });
});
