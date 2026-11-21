import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  BROWSER_PREVIEW_RELAY_URL, browserPreviewOrigin, handleBrowserPreviewOrigin, type PreviewOriginOptions,
} from './browserPreviewOrigin';
import type { DotnetBundleBucket } from './dotnetBundleRoute';
import { appOrigins } from '../../application/shared/appOrigins';
import { CSP_REPORT_URL } from '../../application/runtime/workerCsp';
import {
  DEFAULT_WORKER_EGRESS_POLICY, mintWorkerEgressPolicyId, normalizeDeclaredOrigin, resolveWorkerEgressPolicy,
} from '../../application/runtime/workerEgressPolicy';

const CORS = 'https://builderforce.ai,https://www.builderforce.ai';
const SECRET = 'test-secret';
const APP_ID = 'app:42:0123456789abcdef';
const APP_KEY = '96c02ff6106da114d069c7a8eff3c26a'; // previewOriginKey('42', APP_ID)
const APP_HOST = `${APP_KEY}-preview.builderforce.ai`;
const OTHER_KEY = 'ffffffffffffffffffffffffffffffff';
const WORKERS = ['process-worker.js', 'python-worker.js', 'php-worker.js', 'dotnet-worker.js', 'rust-worker.js'] as const;
const REPORTING = `bfwc-csp="${CSP_REPORT_URL}"`;
// Production: the app's own origins, never local dev ones.
const FRAME_ANCESTORS = `frame-ancestors ${appOrigins(CORS, false).join(' ')}`;
const RELAY_SW = { mode: 'relay', report: CSP_REPORT_URL };
const OPTIONS: PreviewOriginOptions = { corsOrigins: CORS, secret: SECRET, perAppOrigins: true };

async function outcome(url: string, options: Partial<PreviewOriginOptions> = {}, method = 'GET') {
  return handleBrowserPreviewOrigin(new Request(url, { method }), { ...OPTIONS, ...options });
}

/** The response served here (throws when the request was passed on or not a preview host's). */
async function get(url: string, options: Partial<PreviewOriginOptions> = {}, method = 'GET'): Promise<Response> {
  const result = await outcome(url, options, method);
  if (result?.kind !== 'response') throw new Error(`not answered here: ${url}`);
  return result.response;
}

/** `directive` → its source list, from a CSP header. */
function directives(csp: string): Map<string, string[]> {
  return new Map(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...sources]) => [name!, sources]));
}

const mint = (origins: string[] = ['https://api.example.com'], applicationId = APP_ID) =>
  mintWorkerEgressPolicyId(SECRET, { tenantId: 7, projectId: 42, applicationId, origins });

const documentCsp = (host: string) => [
  "default-src 'self' https://esm.sh",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://esm.sh",
  "style-src 'self' 'unsafe-inline' blob: data: https://esm.sh",
  "img-src 'self' data: blob: https://esm.sh",
  "font-src 'self' data: https://esm.sh",
  "media-src 'self' data: blob: https://esm.sh",
  `connect-src 'self' ws://${host} wss://${host} blob: data: https://esm.sh`,
  "frame-src 'self' blob:",
  "form-action 'self' https://esm.sh",
  "worker-src 'self' blob:",
  FRAME_ANCESTORS,
  'report-to bfwc-csp',
].join('; ');

function expectDocumentHeaders(res: Response, host: string) {
  expect(res.headers.get('content-security-policy')).toBe(documentCsp(host));
  expect(res.headers.get('reporting-endpoints')).toBe(REPORTING);
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('origin-agent-cluster')).toBe('?1');
}

describe.each([['the shared host', 'preview.builderforce.ai'], ['an app host', APP_HOST]])('preview origin files on %s', (_label, host) => {
  it('serves relay.html with exactly the contract headers, framable only by the app', async () => {
    const res = await get(`https://${host}/__bfwc/relay.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'none'; script-src 'unsafe-inline'; worker-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; "
      + FRAME_ANCESTORS,
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('origin-agent-cluster')).toBe('?1');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('cross-origin-embedder-policy')).toBe('credentialless');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(await res.text()).toContain('bfwc:relay-ready');
  });

  it('serves sw.js in relay mode, reporting to the platform, with exactly the contract headers', async () => {
    const res = await get(`https://${host}/__bfwc/sw.js?${new URLSearchParams(RELAY_SW)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; connect-src 'self'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect((await res.text()).length).toBeGreaterThan(100);
  });

  it("serves sw.js carrying the runtime's own CDN and the platform report endpoint without a policy", async () => {
    const query = new URLSearchParams({ mode: 'relay', egress: 'https://esm.sh', report: CSP_REPORT_URL });
    expect((await get(`https://${host}/__bfwc/sw.js?${query}`)).status).toBe(200);
  });

  it.each([
    ['egress no policy grants', { egress: 'https://esm.sh https://api.example.com' }],
    ['a malformed egress source', { egress: "https://esm.sh 'unsafe-inline'" }],
    ['another report endpoint', { report: 'https://evil.example/report' }],
    ['an unverifiable policy', { policy: 'garbage' }],
    ['a mode other than relay', { mode: 'same-origin' }],
    ['no report endpoint', { report: '' }],
    ['a report endpoint on a preview host', { report: 'https://preview.builderforce.ai/api/runtime/csp-report' }],
    // Preview code can re-register sw.js with any query: report-only would switch its own CSP off.
    ['csp=report-only', { csp: 'report-only' }],
    ['csp=enforce (no csp key is ever granted)', { csp: 'enforce' }],
    ['a query key the gate does not know', { future: '1' }],
  ])('refuses sw.js with %s (403, document headers)', async (_case, params) => {
    const res = await get(`https://${host}/__bfwc/sw.js?${new URLSearchParams({ ...RELAY_SW, ...params })}`);
    expect(res.status).toBe(403);
    expectDocumentHeaders(res, host);
  });

  // The gate reads the first value of a key; the worker must never see a second one it did not check.
  it.each([
    ['a repeated egress', '&egress=https%3A%2F%2Fevil.example'],
    ['a repeated egress equal to the first', '&egress=https%3A%2F%2Fesm.sh'],
    ['a repeated mode', '&mode=relay'],
    ['a repeated report', `&report=${encodeURIComponent(CSP_REPORT_URL)}`],
  ])('regression: refuses sw.js with %s (403, document headers)', async (_case, repeat) => {
    const query = new URLSearchParams({ mode: 'relay', egress: 'https://esm.sh', report: CSP_REPORT_URL });
    expect((await get(`https://${host}/__bfwc/sw.js?${query}`)).status).toBe(200);
    const res = await get(`https://${host}/__bfwc/sw.js?${query}${repeat}`);
    expect(res.status).toBe(403);
    expectDocumentHeaders(res, host);
  });

  it.each(WORKERS)('serves %s with the contract worker CSP and its reporting endpoint', async (name) => {
    const res = await get(`https://${host}/__bfwc/${name}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript');
    expect(res.headers.get('reporting-endpoints')).toBe(REPORTING);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const d = directives(res.headers.get('content-security-policy')!);
    expect(d.get('default-src')).toEqual(["'none'"]);
    expect(d.get('script-src')!.slice(0, 4)).toEqual(["'self'", "'unsafe-eval'", "'wasm-unsafe-eval'", 'blob:']);
    expect(d.get('worker-src')).toEqual(["'self'", 'blob:']);
    expect(d.get('report-to')).toEqual(['bfwc-csp']);
    const connect = d.get('connect-src')!;
    expect(connect).toEqual(expect.arrayContaining([
      'https://registry.npmjs.org', 'https://cdn.jsdelivr.net', 'https://files.pythonhosted.org',
      'https://api.nuget.org', 'https://globalcdn.nuget.org',
      'https://github.com', 'https://api.github.com', 'https://codeload.github.com',
      'https://raw.githubusercontent.com', 'https://objects.githubusercontent.com',
    ]));
    expect(connect).not.toContain("'self'");
    expect(connect).not.toContain('https://www.nuget.org');
    expect(connect.join(' ')).not.toMatch(/crates\.io|\*/);
    // No platform origin, ever: only the .NET Worker gets a path-scoped `/dotnet/` source.
    const platform = connect.filter((source) => source.includes('builderforce.ai'));
    expect(platform).toEqual(name === 'dotnet-worker.js'
      ? [...new Set([`https://${host}/dotnet/`, 'https://preview.builderforce.ai/dotnet/'])]
      : []);
    expect(d.get('script-src')!.filter((source) => source.includes('builderforce.ai'))).toEqual(platform);
  });

  it('answers HEAD without a body', async () => {
    const res = await get(`https://${host}/__bfwc/process-worker.js`, {}, 'HEAD');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('serves the .NET runtime bundle with the preview document headers', async () => {
    const bucket = {
      head: async () => null,
      get: async (key: string) => (key === 'webcontainers/dotnet/2026.11.5/manifest.json'
        ? { body: new Response('{}').body, size: 2, httpEtag: '"e"' }
        : null),
    } as unknown as DotnetBundleBucket;
    const res = await get(`https://${host}/dotnet/2026.11.5/manifest.json`, { dotnetBundle: bucket });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/json/);
    expect(res.headers.get('etag')).toBe('"e"');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expectDocumentHeaders(res, host);
    const missing = await get(`https://${host}/dotnet/2026.11.5/nope.wasm`, { dotnetBundle: bucket });
    expect(missing.status).toBe(404);
    expectDocumentHeaders(missing, host);
  });

  it('never resolves an inherited name or an unknown script', async () => {
    for (const path of ['/__bfwc/constructor', '/__bfwc/__proto__', '/__bfwc/other.js']) {
      const result = await outcome(`https://${host}${path}`);
      if (result?.kind === 'response') expect(result.response.status).toBe(404);
      else expect(result?.kind).toBe('pass');
    }
  });
});

describe('per-policy worker CSP on an app host (W10 control 6)', () => {
  it('a policy minted for the app applies its declared origins to its Workers on its own origin', async () => {
    const { policy, originKey } = await mint();
    expect(originKey).toBe(APP_KEY);
    for (const name of WORKERS) {
      const csp = (await get(`https://${APP_HOST}/__bfwc/${name}?policy=${encodeURIComponent(policy)}`)).headers.get('content-security-policy')!;
      const d = directives(csp);
      expect(d.get('connect-src')).toContain('https://api.example.com');
      expect(d.get('script-src')).toContain('https://api.example.com');
    }
  });

  it('the same policy is the default on the shared host and on another app host', async () => {
    const { policy } = await mint();
    const query = `?policy=${encodeURIComponent(policy)}`;
    const defaultCsp = (await get(`https://${APP_HOST}/__bfwc/process-worker.js`)).headers.get('content-security-policy');
    for (const host of ['preview.builderforce.ai', `${OTHER_KEY}-preview.builderforce.ai`]) {
      const csp = (await get(`https://${host}/__bfwc/process-worker.js${query}`)).headers.get('content-security-policy')!;
      expect(csp).not.toContain('example');
    }
    expect(defaultCsp).not.toContain('example');
  });

  it('serves sw.js only when its policy verifies for this host and its egress is within the grant', async () => {
    const { policy } = await mint();
    const sw = (host: string, egress: string) =>
      get(`https://${host}/__bfwc/sw.js?${new URLSearchParams({ mode: 'relay', policy, egress, report: CSP_REPORT_URL })}`);
    expect((await sw(APP_HOST, 'https://esm.sh https://api.example.com')).status).toBe(200);
    expect((await sw(APP_HOST, 'https://esm.sh')).status).toBe(200);
    expect((await sw(APP_HOST, 'https://esm.sh https://api.example.com https://evil.example')).status).toBe(403);
    expect((await sw(`${OTHER_KEY}-preview.builderforce.ai`, 'https://esm.sh')).status).toBe(403);
    expect((await sw('preview.builderforce.ai', 'https://esm.sh')).status).toBe(403);
    const unsigned = await get(`https://${APP_HOST}/__bfwc/sw.js?${new URLSearchParams({ ...RELAY_SW, egress: 'https://esm.sh https://api.example.com' })}`);
    expect(unsigned.status).toBe(403);
  });

  it('binds to the exact app host: port, trailing-dot and lookalike hosts resolve to the default', async () => {
    const { policy } = await mint();
    for (const host of [`${APP_HOST}:443`, `${APP_HOST}.`, `${APP_HOST}.evil.com`, `x${APP_HOST}`, `${APP_KEY}-preview.builderforce.ai.evil.com`]) {
      expect(await resolveWorkerEgressPolicy(SECRET, policy, host)).toBe(DEFAULT_WORKER_EGRESS_POLICY);
    }
    // Lookalike and trailing-dot hosts are not preview hosts at all: the rest of the worker answers them.
    expect(await outcome(`https://${APP_HOST}.evil.com/__bfwc/process-worker.js?policy=${policy}`)).toBeNull();
    expect(await outcome(`https://${APP_HOST}./__bfwc/process-worker.js?policy=${policy}`)).toBeNull();
    // A URL's host is lowercased by parsing: an uppercase Host is the same origin, as in the browser.
    const upper = await get(`https://${APP_HOST.toUpperCase()}/__bfwc/process-worker.js?policy=${encodeURIComponent(policy)}`);
    expect(upper.headers.get('content-security-policy')).toContain('https://api.example.com');
  });

  it('refuses to sign a platform, IP, local or non-origin entry', async () => {
    for (const bad of ['https://preview.builderforce.ai', 'https://api.builderforce.ai', 'https://127.0.0.1', 'https://localhost',
      'http://api.example.com', 'https://*.example.com', 'https://api.example.com/path', 'https://user@api.example.com']) {
      expect(normalizeDeclaredOrigin(bad)).toBeNull();
      await expect(mint([bad])).rejects.toThrow();
    }
  });
});

describe('everything else on a preview host', () => {
  it('an app host answers anything but its files with a 404 carrying the document headers — never the API', async () => {
    for (const path of ['/', '/api/auth/me', '/index.html']) {
      const res = await get(`https://${APP_HOST}${path}`);
      expect(res.status).toBe(404);
      expectDocumentHeaders(res, APP_HOST);
    }
  });

  it('with PREVIEW_PER_APP_ORIGINS off, an app host serves nothing (404, document headers); the shared host is unchanged', async () => {
    const off = { perAppOrigins: false };
    const relay = await get(`https://${APP_HOST}/__bfwc/relay.html`, off);
    expect(relay.status).toBe(404);
    expectDocumentHeaders(relay, APP_HOST);
    expect((await get(BROWSER_PREVIEW_RELAY_URL, off)).status).toBe(200);
  });

  it('the shared host passes other requests on (the container ingress), with only nosniff and Origin-Agent-Cluster to apply', async () => {
    const result = await outcome('https://preview.builderforce.ai/abc.123.sig/index.html');
    expect(result).toEqual({ kind: 'pass', headers: { 'X-Content-Type-Options': 'nosniff', 'Origin-Agent-Cluster': '?1' } });
    expect((await outcome(BROWSER_PREVIEW_RELAY_URL, {}, 'POST'))?.kind).toBe('pass');
  });

  it('answers every /dotnet/ request itself: another method is a 405, never passed to the ingress', async () => {
    for (const host of ['preview.builderforce.ai', APP_HOST]) {
      const res = await get(`https://${host}/dotnet/2026.11.5/manifest.json`, {}, 'POST');
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('GET, HEAD');
    }
  });

  it('lets only the relay\'s sw.js be registered as a service worker', async () => {
    const asWorker = { headers: { 'Service-Worker': 'script' } };
    for (const name of ['process-worker.js', 'relay.html']) {
      const res = await handleBrowserPreviewOrigin(new Request(`https://preview.builderforce.ai/__bfwc/${name}`, asWorker), OPTIONS);
      expect(res?.kind === 'response' && res.response.status).toBe(403);
    }
    const sw = await handleBrowserPreviewOrigin(
      new Request(`https://preview.builderforce.ai/__bfwc/sw.js?${new URLSearchParams(RELAY_SW)}`, asWorker), OPTIONS,
    );
    expect(sw?.kind === 'response' && sw.response.status).toBe(200);
  });

  it('frames only the app: never "*" (even with open CORS), and local dev origins only in development', async () => {
    const csp = async (options: Partial<PreviewOriginOptions>) =>
      (await get(BROWSER_PREVIEW_RELAY_URL, options)).headers.get('content-security-policy')!;
    expect(await csp({ corsOrigins: '*' })).not.toContain('*');
    expect(await csp({})).not.toContain('localhost');
    expect(await csp({ environment: 'development' })).toContain('http://localhost:3000');
  });

  it('accepts only the exact report endpoints of the API hosts: never a published site or a preview host', async () => {
    const sw = (report: string, options: Partial<PreviewOriginOptions> = {}) =>
      get(`https://preview.builderforce.ai/__bfwc/sw.js?${new URLSearchParams({ mode: 'relay', report })}`, options);
    const staging = 'https://api-staging.builderforce.ai/api/runtime/csp-report';
    expect((await sw(staging)).status).toBe(403);
    expect((await sw(staging, { cspReportHosts: 'api-staging.builderforce.ai' })).status).toBe(200);
    expect((await sw('https://my-site.builderforce.ai/api/runtime/csp-report')).status).toBe(403);
    expect((await sw(`https://${APP_HOST}/api/runtime/csp-report`)).status).toBe(403);
    expect((await sw('https://api.builderforce.ai/api/runtime/other')).status).toBe(403);
    expect((await sw('https://api.builderforce.ai.evil.com/api/runtime/csp-report')).status).toBe(403);
  });

  it('leaves every other host to the rest of the worker', async () => {
    expect(await outcome('https://api.builderforce.ai/__bfwc/relay.html')).toBeNull();
    expect(await outcome('https://builderforce.ai/__bfwc/process-worker.js')).toBeNull();
  });

  it('the middleware heads the ingress\'s answers without touching their CSP or CORP', async () => {
    const app = new Hono<{ Bindings: { CORS_ORIGINS: string; JWT_SECRET: string } }>();
    app.use('*', browserPreviewOrigin as never);
    app.get('*', (c) => c.text('dev server', 200, { 'Content-Security-Policy': "default-src 'self'", 'Cross-Origin-Resource-Policy': 'same-origin' }));
    const env = { CORS_ORIGINS: CORS, JWT_SECRET: SECRET };
    const res = await app.request('https://preview.builderforce.ai/tok/index.html', {}, env);
    expect(await res.text()).toBe('dev server');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'self'");
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('origin-agent-cluster')).toBe('?1');
    const elsewhere = await app.request('https://api.builderforce.ai/x', {}, env);
    expect(elsewhere.headers.get('content-security-policy')).toBe("default-src 'self'");
    // App hosts are gated by PREVIEW_PER_APP_ORIGINS (unset here: off).
    expect((await app.request(`https://${APP_HOST}/__bfwc/relay.html`, {}, env)).status).toBe(404);
  });
});
