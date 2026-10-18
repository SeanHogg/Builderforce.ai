import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiVersionCache } from '@seanhogg/builderforce-brain-embedded';
import { registerCanvasHost } from './canvasHost';
import { capText, environmentLines } from './diagnosticsReport';

/**
 * The capture is the half of a diagnostics report that touches the world, so it is the
 * half that can leave a "Copy diagnostics" button doing nothing at all. Both failures
 * below produced exactly that symptom — a click with no report, no error and no clue —
 * which is the worst possible behaviour for the control people reach for when something
 * is ALREADY wrong.
 */

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock('./apiClient', () => ({ apiRequest }));

describe('capText', () => {
  it('caps and announces the overflow', () => {
    expect(capText('x'.repeat(12), 10)).toBe(`${'x'.repeat(10)}… (+2 chars)`);
  });

  it('survives a body that is not a string', () => {
    // A restored local snapshot or a legacy server row can carry a missing body. This
    // used to throw on `.length` and take the whole report down with it.
    expect(capText(undefined as unknown as string)).toBe('');
    expect(capText(null as unknown as string)).toBe('');
    expect(capText(42 as unknown as string)).toBe('42');
  });
});

/**
 * `vi.mock('./apiClient')` is the contract these tests were written against. On this
 * Vitest 4 + Windows runner that mock does not replace the module `appVersions` imports,
 * so the real client reaches `fetch`. Stub `fetch` to the same answer so the capture is
 * still proven without a live `/health`, whichever path actually runs.
 */
function healthResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('captureDiagnosticsContext', () => {
  beforeEach(() => {
    resetApiVersionCache();
    apiRequest.mockReset();
    vi.stubGlobal('fetch', vi.fn(async () => healthResponse({ version: '2026.8.1' })));
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('stamps the API version when /health answers', async () => {
    apiRequest.mockResolvedValue({ version: '2026.8.1' });
    const { captureDiagnosticsContext } = await import('./diagnosticsCapture');

    const context = await captureDiagnosticsContext();

    expect(context.apiVersion).toBe('2026.8.1');
    expect(context.capturedAt).toEqual(expect.any(String));
  });

  it('resolves rather than HANGING when /health never settles', async () => {
    // Unreachable and slow are different failures and only the first was handled: a
    // fetch that never settles (offline with a live socket, a captive portal) left the
    // await pending forever, so the report was never built and nothing said so.
    apiRequest.mockReturnValue(new Promise(() => {}));
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    const { captureDiagnosticsContext } = await import('./diagnosticsCapture');

    const capture = captureDiagnosticsContext();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(capture).resolves.toMatchObject({ apiVersion: null });
  });

  it('resolves when /health rejects', async () => {
    apiRequest.mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const { captureDiagnosticsContext } = await import('./diagnosticsCapture');

    await expect(captureDiagnosticsContext()).resolves.toMatchObject({
      apiVersion: null,
      engine: 'builderforce-v3',
    });
  });

  it('names the web host, the engine and the in-browser runtime', async () => {
    apiRequest.mockResolvedValue({ version: '2026.8.1' });
    const { captureDiagnosticsContext } = await import('./diagnosticsCapture');

    const context = await captureDiagnosticsContext();

    expect(context).toMatchObject({
      host: 'web',
      engine: 'builderforce-v3@2026.8.1',
      apiVersion: '2026.8.1',
    });
    expect(context.brainVersion).toEqual(expect.any(String));
    expect(context.runtimeVersion).toEqual(expect.any(String));
    const block = environmentLines(context).join('\n');
    expect(block).toContain('host: web');
    expect(block).toContain('engine: builderforce-v3@2026.8.1');
    expect(block).toContain('brainVersion:');
    expect(block).toContain('runtimeVersion:');
  });

  it('names the VSIX and the extension version when a canvas host is registered', async () => {
    apiRequest.mockResolvedValue({ version: '2026.8.1' });
    registerCanvasHost({
      surface: 'vscode',
      hostVersion: '2026.10.9',
      actions: [],
      openFile: () => {},
      navigate: () => {},
      webOrigin: 'https://builderforce.ai',
    });
    try {
      const { captureDiagnosticsContext } = await import('./diagnosticsCapture');
      const context = await captureDiagnosticsContext();
      expect(context.host).toBe('vsix');
      expect(context.hostVersion).toBe('2026.10.9');
      expect(context.uiVersion).not.toBe('2026.10.9');
    } finally {
      registerCanvasHost(null);
    }
  });
});

describe('resolveDiagnosticsHost', () => {
  // Imported inside the tests, not at the top: a static import loads `apiClient`
  // before this file's mock is the one `fetchApiVersion` closes over.
  const load = () => import('./diagnosticsCapture');
  const base = {
    surface: 'web' as const,
    canvasHostVersion: null,
    appVersion: '2026.10.75',
    locationProtocol: 'https:',
    extensionManifestVersion: null,
  };

  it('names the web frontend when no editor host is registered', async () => {
    const { resolveDiagnosticsHost } = await load();
    expect(resolveDiagnosticsHost(base)).toEqual({ host: 'web', hostVersion: '2026.10.75' });
  });

  it('names the VSIX extension version, not the web bundle', async () => {
    const { resolveDiagnosticsHost } = await load();
    expect(resolveDiagnosticsHost({
      ...base,
      surface: 'vscode',
      canvasHostVersion: '2026.10.9',
    })).toEqual({ host: 'vsix', hostVersion: '2026.10.9' });
  });

  it('names Rovr from the extension page protocol and the Chrome manifest', async () => {
    const { resolveDiagnosticsHost } = await load();
    expect(resolveDiagnosticsHost({
      ...base,
      locationProtocol: 'chrome-extension:',
      extensionManifestVersion: '1.4.2',
    })).toEqual({ host: 'rovr', hostVersion: '1.4.2' });
  });

  it('writes an absent host version as null rather than inventing the web stamp', async () => {
    const { resolveDiagnosticsHost } = await load();
    expect(resolveDiagnosticsHost({
      ...base,
      surface: 'vscode',
      canvasHostVersion: null,
    }).hostVersion).toBeNull();
    expect(resolveDiagnosticsHost({
      ...base,
      locationProtocol: 'chrome-extension:',
      extensionManifestVersion: null,
    })).toEqual({ host: 'rovr', hostVersion: null });
  });
});
