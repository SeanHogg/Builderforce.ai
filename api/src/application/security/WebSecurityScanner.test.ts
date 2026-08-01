import { describe, it, expect } from 'vitest';
import {
  evaluateHeaders,
  evaluateBody,
  evaluateExposures,
  scoreFindings,
  normalizeScanTarget,
  webMarker,
  scanWebTarget,
  ScanTargetError,
  SENSITIVE_PROBES,
  SECURITY_TXT_PATH,
  type ScanContext,
  type ProbeResult,
} from './WebSecurityScanner';

// A fully-hardened context: HTTPS enforced + every recommended header present +
// a Secure/HttpOnly/SameSite cookie + no CORS. Should yield ZERO findings.
function cleanCtx(overrides: Partial<ScanContext> = {}): ScanContext {
  return {
    origin: 'https://example.com',
    finalUrl: 'https://example.com/',
    httpProbe: 'upgraded',
    headers: {
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'geolocation=()',
    },
    cookies: ['sid=abc; Secure; HttpOnly; SameSite=Lax'],
    ...overrides,
  };
}

const ids = (ctx: ScanContext) => new Set(evaluateHeaders(ctx).map((f) => f.checkId));

describe('normalizeScanTarget', () => {
  it('defaults a bare host to https', () => {
    expect(normalizeScanTarget('example.com')).toBe('https://example.com/');
  });
  it('preserves an explicit http scheme', () => {
    expect(normalizeScanTarget('http://example.com')).toBe('http://example.com/');
  });
  it('rejects an empty target', () => {
    expect(() => normalizeScanTarget('')).toThrow(ScanTargetError);
  });
  it('rejects a non-http scheme', () => {
    expect(() => normalizeScanTarget('ftp://example.com')).toThrow(/http/);
  });
  it.each([
    'localhost',
    'http://127.0.0.1',
    'http://10.1.2.3',
    'http://192.168.0.1',
    'http://172.16.5.5',
    'http://169.254.169.254', // cloud metadata
    'http://foo.internal',
    'http://[::1]',
  ])('blocks private/loopback/metadata host %s (SSRF guard)', (target) => {
    expect(() => normalizeScanTarget(target)).toThrow(ScanTargetError);
  });
  it('tags a blocked host with code blocked_host', () => {
    try { normalizeScanTarget('http://10.0.0.1'); } catch (e) {
      expect((e as ScanTargetError).code).toBe('blocked_host');
    }
  });
});

describe('evaluateHeaders', () => {
  it('finds nothing on a fully-hardened site', () => {
    expect(evaluateHeaders(cleanCtx())).toEqual([]);
  });

  it('flags every missing security header', () => {
    const bare = cleanCtx({ headers: {}, cookies: [] });
    const found = ids(bare);
    expect(found).toContain('hsts-missing');
    expect(found).toContain('csp-missing');
    expect(found).toContain('clickjacking');
    expect(found).toContain('nosniff-missing');
    expect(found).toContain('referrer-policy-missing');
    expect(found).toContain('permissions-policy-missing');
  });

  it('flags plain-HTTP delivery as high severity', () => {
    const f = evaluateHeaders(cleanCtx({ httpProbe: 'not-upgraded' })).find((x) => x.checkId === 'https-enforced');
    expect(f?.severity).toBe('high');
  });

  it('does not flag http enforcement when the probe is unknown', () => {
    expect(ids(cleanCtx({ httpProbe: 'unknown' }))).not.toContain('https-enforced');
  });

  it('flags a weak HSTS max-age but not a strong one', () => {
    const weak = cleanCtx({ headers: { ...cleanCtx().headers, 'strict-transport-security': 'max-age=1000' } });
    expect(ids(weak)).toContain('hsts-weak');
    expect(ids(cleanCtx())).not.toContain('hsts-weak');
  });

  it('accepts CSP frame-ancestors in place of X-Frame-Options', () => {
    const noXfo = cleanCtx({
      headers: { ...cleanCtx().headers, 'x-frame-options': undefined as unknown as string },
    });
    delete (noXfo.headers as Record<string, string>)['x-frame-options'];
    expect(ids(noXfo)).not.toContain('clickjacking');
  });

  it('flags insecure / non-HttpOnly / no-SameSite cookies distinctly', () => {
    const ctx = cleanCtx({ cookies: ['sid=x'] });
    const found = ids(ctx);
    expect(found).toContain('cookie-insecure');
    expect(found).toContain('cookie-not-httponly');
    expect(found).toContain('cookie-no-samesite');
  });

  it('escalates wildcard CORS + credentials to high', () => {
    const ctx = cleanCtx({
      headers: {
        ...cleanCtx().headers,
        'access-control-allow-origin': '*',
        'access-control-allow-credentials': 'true',
      },
    });
    const f = evaluateHeaders(ctx).find((x) => x.checkId === 'cors-wildcard-credentials');
    expect(f?.severity).toBe('high');
  });

  it('flags version disclosure only when a version number is present', () => {
    expect(ids(cleanCtx({ headers: { ...cleanCtx().headers, server: 'nginx/1.25.3' } }))).toContain('version-disclosure');
    expect(ids(cleanCtx({ headers: { ...cleanCtx().headers, server: 'cloudflare' } }))).not.toContain('version-disclosure');
  });
});

describe('evaluateBody', () => {
  const httpsCtx = cleanCtx();
  it('flags a directory listing', () => {
    const found = evaluateBody(httpsCtx, '<html><head><title>Index of /uploads</title></head></html>');
    expect(found.map((f) => f.checkId)).toContain('directory-listing');
  });
  it('flags mixed content on an https page', () => {
    const found = evaluateBody(httpsCtx, '<script src="http://cdn.evil.test/a.js"></script>');
    expect(found.map((f) => f.checkId)).toContain('mixed-content');
  });
  it('ignores the w3.org XML namespace URL (not a fetched resource)', () => {
    const found = evaluateBody(httpsCtx, '<html xmlns="http://www.w3.org/1999/xhtml"><body>ok</body></html>');
    expect(found.map((f) => f.checkId)).not.toContain('mixed-content');
  });
  it('does not flag mixed content on an http origin', () => {
    const http = cleanCtx({ origin: 'http://example.com' });
    expect(evaluateBody(http, '<img src="http://x.test/a.png">').map((f) => f.checkId)).not.toContain('mixed-content');
  });
  it('returns nothing for an empty body', () => {
    expect(evaluateBody(httpsCtx, '')).toEqual([]);
  });
});

describe('evaluateExposures', () => {
  const ctx = cleanCtx();
  const probe = (path: string, status: number, body: string): ProbeResult => ({ path, status, body });
  // A present, valid security.txt so the missing-contact info finding doesn't appear.
  const secTxtOk = probe(SECURITY_TXT_PATH, 200, 'Contact: mailto:security@example.com');

  it('flags an exposed .env with real dotenv content as critical', () => {
    const found = evaluateExposures(ctx, [probe('/.env', 200, 'DATABASE_URL=postgres://u:p@h/db\nAPI_KEY=sk_live_x'), secTxtOk]);
    const f = found.find((x) => x.checkId === 'exposed-dotenv');
    expect(f?.severity).toBe('critical');
  });
  it('does NOT flag .env when the body is an SPA index.html (200 catch-all)', () => {
    const found = evaluateExposures(ctx, [probe('/.env', 200, '<!doctype html><html><body>app</body></html>'), secTxtOk]);
    expect(found.map((x) => x.checkId)).not.toContain('exposed-dotenv');
  });
  it('flags an exposed .git/config', () => {
    const found = evaluateExposures(ctx, [probe('/.git/config', 200, '[core]\n\trepositoryformatversion = 0\n[remote "origin"]'), secTxtOk]);
    expect(found.map((x) => x.checkId)).toContain('exposed-git-config');
  });
  it('flags a missing security.txt as info', () => {
    const found = evaluateExposures(ctx, [probe(SECURITY_TXT_PATH, 404, 'Not found')]);
    const f = found.find((x) => x.checkId === 'security-txt-missing');
    expect(f?.severity).toBe('info');
  });
  it('does not flag exposures for a 404 sensitive path', () => {
    const found = evaluateExposures(ctx, [probe('/.env', 404, 'nope'), secTxtOk]);
    expect(found.map((x) => x.checkId)).not.toContain('exposed-dotenv');
  });
  it('every sensitive probe rejects an html body (no false positives)', () => {
    const html = '<!doctype html><html><body>x</body></html>';
    for (const spec of SENSITIVE_PROBES) {
      expect(spec.matches(html)).toBe(false);
    }
  });
});

describe('scoreFindings', () => {
  it('is 100 for a clean site', () => {
    expect(scoreFindings([])).toBe(100);
  });
  it('penalises by severity and clamps at 0', () => {
    const bare = evaluateHeaders(cleanCtx({ headers: {}, cookies: ['sid=x'], httpProbe: 'not-upgraded' }));
    const score = scoreFindings(bare);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(100);
  });
});

describe('webMarker', () => {
  it('is stable and lowercased on origin', () => {
    expect(webMarker('hsts-missing', 'https://Example.com')).toBe('[web:hsts-missing:https://example.com]');
  });
});

describe('scanWebTarget (IO with injected fetch)', () => {
  it('collects headers + set-cookie and probes http upgrade', async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url.startsWith('http://')) {
        // http probe → redirects to https (good)
        return new Response(null, { status: 301, headers: { location: 'https://example.com/' } });
      }
      const h = new Headers({ 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" });
      h.append('set-cookie', 'sid=x'); // insecure cookie
      const res = new Response('<html></html>', { status: 200, headers: h });
      Object.defineProperty(res, 'url', { value: 'https://example.com/' });
      return res;
    }) as unknown as typeof fetch;

    const result = await scanWebTarget('example.com', { fetchFn });
    expect(result.origin).toBe('https://example.com');
    expect(calls.some((u) => u.startsWith('http://'))).toBe(true);
    const found = new Set(result.findings.map((f) => f.checkId));
    // http upgraded → no https-enforced finding, but the insecure cookie + missing HSTS are caught.
    expect(found).not.toContain('https-enforced');
    expect(found).toContain('cookie-insecure');
    expect(found).toContain('hsts-missing');
    expect(result.score).toBeLessThan(100);
  });
});
