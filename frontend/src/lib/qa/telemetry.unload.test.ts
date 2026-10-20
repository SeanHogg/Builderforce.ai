/**
 * @vitest-environment jsdom
 *
 * The page-unload flush goes through the AUTHENTICATED transport with keepalive —
 * never `sendBeacon`, which cannot carry the bearer (the server rejects such a batch).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiRequestStream } = vi.hoisted(() => ({ apiRequestStream: vi.fn(async () => new Response(null, { status: 201 })) }));

vi.mock('../apiClient', () => ({
  apiRequestStream,
  getAuthHeaders: () => ({ Authorization: 'Bearer tenant-token' }),
}));

import { qaCapture } from './telemetry';

describe('qaCapture unload flush', () => {
  const beacon = vi.fn(() => true);

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_QA_CAPTURE', '1');
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    apiRequestStream.mockClear();
    beacon.mockClear();
  });

  afterEach(() => {
    qaCapture.stop();
    vi.unstubAllEnvs();
  });

  it('sends the pagehide batch with keepalive through apiRequestStream, not sendBeacon', async () => {
    qaCapture.start();
    qaCapture.pageview('/dashboard');
    window.dispatchEvent(new Event('pagehide'));

    await vi.waitFor(() => expect(apiRequestStream).toHaveBeenCalled());
    const [path, init] = apiRequestStream.mock.calls[0] as unknown as [string, RequestInit & { keepalive?: boolean }];
    expect(path).toBe('/api/qa/events');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(String(init.body)).events[0]).toMatchObject({ type: 'pageview', route: '/dashboard' });
    expect(beacon).not.toHaveBeenCalled();
  });
});
