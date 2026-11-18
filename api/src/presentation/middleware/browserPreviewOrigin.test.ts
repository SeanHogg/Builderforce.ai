import { describe, expect, it } from 'vitest';
import { BROWSER_PREVIEW_RELAY_URL, handleBrowserPreviewOrigin, serveBrowserPreviewOrigin } from './browserPreviewOrigin';
import {
  DEFAULT_WORKER_EGRESS_POLICY, mintWorkerEgressPolicyId, normalizeDeclaredOrigin, resolveWorkerEgressPolicy,
} from '../../application/runtime/workerEgressPolicy';
import { base64UrlEncode } from '../../domain/shared/bytes';
import { hmacHex } from '../../infrastructure/crypto/hmac';

const CORS = 'https://builderforce.ai,https://www.builderforce.ai';
const get = (url: string, method = 'GET') => serveBrowserPreviewOrigin(new Request(url, { method }), CORS);

describe('serveBrowserPreviewOrigin', () => {
  it('serves the relay framable only by the app, and embeddable under COEP', async () => {
    const res = get(BROWSER_PREVIEW_RELAY_URL)!;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/^frame-ancestors /);
    expect(csp).toContain('https://builderforce.ai');
    expect(csp).toContain('https://www.builderforce.ai');
    expect(csp).not.toContain('*');
    expect(res.headers.get('cross-origin-embedder-policy')).toBe('credentialless');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(await res.text()).toContain('bfwc:relay-ready');
  });

  it('serves the worker uncached', async () => {
    const res = get('https://preview.builderforce.ai/__bfwc/sw.js')!;
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect((await res.text()).length).toBeGreaterThan(100);
  });

  it('serves the process worker beside the relay, so project code runs on the preview origin', async () => {
    const res = get('https://preview.builderforce.ai/__bfwc/process-worker.js')!;
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    expect(res.headers.get('content-security-policy')).toMatch(/^default-src 'none'/);
    expect((await res.text()).length).toBeGreaterThan(1000);
  });

  it.each(['python-worker.js', 'php-worker.js'])('serves the %s process worker beside the relay too', async (name) => {
    const res = get(`https://preview.builderforce.ai/__bfwc/${name}`)!;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    expect(res.headers.get('content-security-policy')).toMatch(/^default-src 'none'/);
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect((await res.text()).length).toBeGreaterThan(1000);
  });

  it.each(['python-worker.js', 'php-worker.js'])('serves the %s process worker beside the relay too', async (name) => {
    const res = get(`https://preview.builderforce.ai/__bfwc/${name}`)!;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect((await res.text()).length).toBeGreaterThan(1000);
  });

  it('never names "*" as an app origin, even when CORS is open', () => {
    const res = serveBrowserPreviewOrigin(new Request(BROWSER_PREVIEW_RELAY_URL), '*')!;
    expect(res.headers.get('content-security-policy')).not.toContain('*');
  });

  it('leaves every other host, path and method to the rest of the worker', () => {
    expect(get('https://api.builderforce.ai/__bfwc/relay.html')).toBeNull();
    expect(get('https://preview.builderforce.ai/abc.123.sig/index.html')).toBeNull();
    expect(get('https://preview.builderforce.ai/__bfwc/other.js')).toBeNull();
    expect(get('https://preview.builderforce.ai/__bfwc/constructor')).toBeNull();
    expect(get('https://preview.builderforce.ai/__bfwc/__proto__')).toBeNull();
    expect(get(BROWSER_PREVIEW_RELAY_URL, 'POST')).toBeNull();
  });
});

const WORKERS = ['process-worker.js', 'python-worker.js', 'php-worker.js'] as const;
const SECRET = 'test-secret';

/** `directive` → its source list, from a CSP header. */
function directives(csp: string): Map<string, string[]> {
  return new Map(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...sources]) => [name!, sources]));
}

describe('egress CSP on the preview scripts (W10 control 6)', () => {
  it.each(WORKERS)('%s gets default-src none, script-src, worker-src and a connect-src with no wildcard, own origin or write API', (name) => {
    const csp = get(`https://preview.builderforce.ai/__bfwc/${name}`)!.headers.get('content-security-policy')!;
    const d = directives(csp);
    expect(d.get('default-src')).toEqual(["'none'"]);
    expect(d.get('script-src')).toEqual(expect.arrayContaining(["'unsafe-eval'", "'wasm-unsafe-eval'", 'https://cdn.jsdelivr.net']));
    expect(d.get('worker-src')).toEqual(["'none'"]);
    const connect = d.get('connect-src')!;
    expect(connect).toEqual(expect.arrayContaining(['https://registry.npmjs.org', 'https://cdn.jsdelivr.net', 'https://files.pythonhosted.org']));
    expect(csp).not.toContain('*');
    expect(connect.join(' ')).not.toContain('api.github.com');
    expect(connect).not.toContain("'self'");
    expect(connect.join(' ')).not.toContain('preview.builderforce.ai');
    expect(d.get('report-uri')).toEqual(['https://api.builderforce.ai/api/runtime/csp-report']);
    expect(d.get('report-to')).toEqual(['bfwc-csp']);
  });

  it('declares the report-to endpoint on every script', () => {
    for (const name of [...WORKERS, 'sw.js', 'relay.html']) {
      expect(get(`https://preview.builderforce.ai/__bfwc/${name}`)!.headers.get('reporting-endpoints'))
        .toBe('bfwc-csp="https://api.builderforce.ai/api/runtime/csp-report"');
    }
  });

  it('locks the service worker down: it fetches and imports nothing itself', () => {
    const csp = get('https://preview.builderforce.ai/__bfwc/sw.js')!.headers.get('content-security-policy')!;
    expect(directives(csp).get('default-src')).toEqual(["'none'"]);
  });

  it('keeps the relay framable only by the app and lets it start only the preview scripts', () => {
    const d = directives(get(BROWSER_PREVIEW_RELAY_URL)!.headers.get('content-security-policy')!);
    expect(d.get('frame-ancestors')).toEqual(expect.arrayContaining(['https://builderforce.ai', 'https://www.builderforce.ai']));
    expect(d.get('worker-src')).toEqual([
      'https://preview.builderforce.ai/__bfwc/sw.js',
      'https://preview.builderforce.ai/__bfwc/process-worker.js',
      'https://preview.builderforce.ai/__bfwc/python-worker.js',
      'https://preview.builderforce.ai/__bfwc/php-worker.js',
    ]);
    expect(d.get('connect-src')).toEqual(["'none'"]);
    expect(d.has('default-src')).toBe(false); // the relay's one inline script must still run
  });

  it('a valid signed policy id extends connect-src with the app\'s declared origins', async () => {
    const policy = await mintWorkerEgressPolicyId(SECRET, ['https://api.example.com', 'wss://stream.example.com']);
    const res = (await handleBrowserPreviewOrigin(
      new Request(`https://preview.builderforce.ai/__bfwc/process-worker.js?policy=${policy}`), CORS, SECRET,
    ))!;
    const connect = directives(res.headers.get('content-security-policy')!).get('connect-src')!;
    expect(connect).toEqual(expect.arrayContaining(['https://registry.npmjs.org', 'https://api.example.com', 'wss://stream.example.com']));
  });

  it('a tampered, foreign-secret or absent policy id falls back to the default', async () => {
    const policy = await mintWorkerEgressPolicyId(SECRET, ['https://api.example.com']);
    const [id, sig] = [policy.slice(0, policy.lastIndexOf('.')), policy.slice(policy.lastIndexOf('.') + 1)];
    const forged = `${base64UrlEncode('https://evil.example')}.${sig}`;
    const flipped = `${id}.${sig.slice(0, -1)}${sig.endsWith('0') ? '1' : '0'}`;
    const defaultCsp = get('https://preview.builderforce.ai/__bfwc/process-worker.js')!.headers.get('content-security-policy');
    for (const [presented, secret] of [[forged, SECRET], [flipped, SECRET], [policy, 'other-secret'], ['garbage', SECRET], [policy, undefined]] as const) {
      const res = (await handleBrowserPreviewOrigin(
        new Request(`https://preview.builderforce.ai/__bfwc/process-worker.js?policy=${encodeURIComponent(presented)}`), CORS, secret,
      ))!;
      const csp = res.headers.get('content-security-policy');
      expect(csp).toBe(defaultCsp);
      expect(csp).not.toContain('example');
    }
  });

  it('refuses to sign or honour a platform, IP, local or non-origin entry', async () => {
    for (const bad of ['https://preview.builderforce.ai', 'https://api.builderforce.ai', 'https://127.0.0.1', 'https://localhost',
      'http://api.example.com', 'https://*.example.com', 'https://api.example.com/path', 'https://user@api.example.com']) {
      expect(normalizeDeclaredOrigin(bad)).toBeNull();
      await expect(mintWorkerEgressPolicyId(SECRET, [bad])).rejects.toThrow();
    }
    // Signed with the real secret but naming the platform: re-validated on verify, so still the default.
    const id = base64UrlEncode('https://preview.builderforce.ai');
    const signed = `${id}.${await hmacHex(SECRET, `bfwc-egress:${id}`)}`;
    expect(await resolveWorkerEgressPolicy(SECRET, signed)).toBe(DEFAULT_WORKER_EGRESS_POLICY);
  });

  it('applies the policy only to process workers, and leaves other hosts to the rest of the worker', async () => {
    const policy = await mintWorkerEgressPolicyId(SECRET, ['https://api.example.com']);
    const sw = (await handleBrowserPreviewOrigin(new Request(`https://preview.builderforce.ai/__bfwc/sw.js?policy=${policy}`), CORS, SECRET))!;
    expect(sw.headers.get('content-security-policy')).not.toContain('example');
    expect(await handleBrowserPreviewOrigin(new Request('https://api.builderforce.ai/__bfwc/process-worker.js'), CORS, SECRET)).toBeNull();
  });
});
