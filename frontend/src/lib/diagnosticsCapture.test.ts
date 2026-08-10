import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiVersionCache } from '@seanhogg/builderforce-brain-embedded';
import { capText } from './diagnosticsReport';

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

describe('captureDiagnosticsContext', () => {
  beforeEach(() => {
    resetApiVersionCache();
    apiRequest.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
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
    const { captureDiagnosticsContext } = await import('./diagnosticsCapture');

    const capture = captureDiagnosticsContext();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(capture).resolves.toMatchObject({ apiVersion: null });
  });

  it('resolves when /health rejects', async () => {
    apiRequest.mockRejectedValue(new Error('offline'));
    const { captureDiagnosticsContext } = await import('./diagnosticsCapture');

    await expect(captureDiagnosticsContext()).resolves.toMatchObject({ apiVersion: null });
  });
});
