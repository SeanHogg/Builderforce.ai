import { describe, expect, it } from 'vitest';
import { BROWSER_PREVIEW_RELAY_URL, serveBrowserPreviewOrigin } from './browserPreviewOrigin';

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
    expect(res.headers.get('content-security-policy')).toBeNull();
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
