import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ScreenshotUnavailableError,
  bytesToBase64,
  captureWebScreenshot,
  isScreenshotViewport,
  readProviderError,
  screenshotViewportSize,
} from './webScreenshot';
import type { Env } from '../../env';

const CREDENTIALS = { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_BROWSER_API_TOKEN: 'token' } as unknown as Env;

/** A one-pixel JPEG's worth of bytes — enough to be "an image" without a fixture file. */
function imageResponse(bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])): Response {
  return new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } });
}

/**
 * Stub `fetch` for BOTH calls the capture makes.
 *
 * The SSRF guard resolves the hostname over DNS-over-HTTPS before anything is rendered,
 * so a test that stubs one response hands the DNS lookup the screenshot — and then reads
 * an already-consumed body. Routing by URL keeps the two apart and lets a test assert on
 * the render call specifically.
 */
function stubRenderer(render: () => Response): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async (url: string) => (String(url).includes('cloudflare-dns.com')
    ? new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }), { status: 200 })
    : render()));
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** The render call, ignoring the DNS lookups the guard made first. */
function renderCall(spy: ReturnType<typeof vi.fn>): [string, RequestInit] {
  const call = spy.mock.calls.find(([url]) => String(url).includes('browser-rendering'));
  if (!call) throw new Error('the renderer was never called');
  return call as [string, RequestInit];
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('screenshot viewports', () => {
  it('reads its widths from the shared canvas vocabulary', () => {
    // The point of the shared module: a capture and the frame it is compared against are
    // laid out at the same width, or the comparison flatters one of them for free.
    expect(screenshotViewportSize('desktop')).toEqual({ width: 1280, height: 800 });
    expect(screenshotViewportSize('mobile').width).toBe(390);
  });

  it('accepts only declared viewports', () => {
    expect(isScreenshotViewport('tablet')).toBe(true);
    expect(isScreenshotViewport('watch')).toBe(false);
    expect(isScreenshotViewport(undefined)).toBe(false);
  });
});

describe('captureWebScreenshot SSRF guard', () => {
  it('refuses loopback, private and metadata hosts before spending a render', async () => {
    const fetchSpy = stubRenderer(() => imageResponse());
    for (const url of [
      'http://localhost/x',
      'http://127.0.0.1/x',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.5/x',
      'https://192.168.1.1/x',
    ]) {
      await expect(captureWebScreenshot(CREDENTIALS, url), url).rejects.toThrow(/public host/);
    }
    // The guard refuses on the literal host, so nothing — not even the DNS lookup —
    // is spent on an address that could never have been captured.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('captureWebScreenshot configuration', () => {
  it('reports an unconfigured deployment as its own reason, not a generic failure', async () => {
    // The whole contract of this module: the caller relays the REAL reason, so an
    // operator fact must never arrive looking like "the page could not be captured".
    await expect(captureWebScreenshot({} as Env, 'https://example.com'))
      .rejects.toMatchObject({ reason: 'unconfigured' });
  });

  it('falls back to the Workers AI token when no browser-specific one is bound', async () => {
    const fetchSpy = stubRenderer(() => imageResponse());
    const env = { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_AI_API_TOKEN: 'shared' } as unknown as Env;
    await captureWebScreenshot(env, 'https://example.com');
    const [, init] = renderCall(fetchSpy);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer shared');
  });
});

describe('captureWebScreenshot rendering', () => {
  it('renders at the requested device width and returns a self-contained data URL', async () => {
    const fetchSpy = stubRenderer(() => imageResponse());
    const shot = await captureWebScreenshot(CREDENTIALS, 'https://example.com/', { viewport: 'mobile' });
    const [url, init] = renderCall(fetchSpy);
    expect(url).toContain('/accounts/acct/browser-rendering/screenshot');
    expect(JSON.parse(String(init.body))).toMatchObject({
      url: 'https://example.com/',
      viewport: { width: 390, height: 844 },
    });
    expect(shot.imageDataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(shot.width).toBe(390);
    expect(shot.viewport).toBe('mobile');
    expect(shot.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('captures a plain-http address — a small business site is exactly the kind still on it', async () => {
    stubRenderer(() => imageResponse());
    await expect(captureWebScreenshot(CREDENTIALS, 'http://example.com/')).resolves.toBeTruthy();
  });

  it('relays the renderer\'s own words when it refuses', async () => {
    stubRenderer(() => new Response(
      JSON.stringify({ success: false, errors: [{ code: 1, message: 'Navigation timeout of 30000 ms exceeded' }] }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ));
    await expect(captureWebScreenshot(CREDENTIALS, 'https://example.com'))
      .rejects.toThrow(/Navigation timeout/);
  });

  it('treats a 200 that is not an image as the failure it is', async () => {
    // Reported as a JSON envelope with a 200 — indistinguishable from success unless the
    // content type is checked, and a "capture" that is really an error blob would land on
    // the board as a broken before.
    stubRenderer(() => new Response(
      JSON.stringify({ success: false, errors: [{ message: 'Browser Rendering is not enabled' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    await expect(captureWebScreenshot(CREDENTIALS, 'https://example.com'))
      .rejects.toThrow(/not enabled/);
  });

  it('refuses a capture too large to live in a canvas object, and says so', async () => {
    stubRenderer(() => imageResponse(new Uint8Array(5 * 1024 * 1024)));
    await expect(captureWebScreenshot(CREDENTIALS, 'https://example.com', { fullPage: true }))
      .rejects.toMatchObject({ reason: 'too-large' });
  });

  it('refuses an empty render rather than staging a blank before', async () => {
    stubRenderer(() => imageResponse(new Uint8Array(0)));
    await expect(captureWebScreenshot(CREDENTIALS, 'https://example.com'))
      .rejects.toBeInstanceOf(ScreenshotUnavailableError);
  });
});

describe('readProviderError', () => {
  it('joins the provider\'s messages', async () => {
    const response = new Response(JSON.stringify({ errors: [{ message: 'a' }, { message: 'b' }] }), { status: 500 });
    expect(await readProviderError(response)).toBe('a; b');
  });

  it('falls back to the raw body, then to the status', async () => {
    expect(await readProviderError(new Response('gateway exploded', { status: 502 }))).toBe('gateway exploded');
    expect(await readProviderError(new Response('', { status: 503 }))).toBe('The page renderer returned HTTP 503');
  });
});

describe('bytesToBase64', () => {
  it('encodes a buffer larger than one chunk without blowing the stack', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 7).fill(65);
    expect(atob(bytesToBase64(bytes.buffer)).length).toBe(bytes.length);
  });
});
