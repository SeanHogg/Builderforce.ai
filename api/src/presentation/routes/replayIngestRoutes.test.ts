/**
 * `/api/replay-ingest` — the public edge: every chunk answers 202 `{ok:true}`
 * whatever happened to it, the config answer is the service's, and any origin may
 * reach the path (cors.ts PUBLIC_INGEST_PREFIXES).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ingest: vi.fn(),
  config: vi.fn(),
}));

vi.mock('../../application/replay/ReplayIngestService', () => ({
  ReplayIngestService: vi.fn(function ReplayIngestService() { return { ingest: mocks.ingest }; }),
}));
vi.mock('../../application/replay/ReplayConfigService', () => ({
  ReplayConfigService: vi.fn(function ReplayConfigService() { return { config: mocks.config }; }),
}));

import { createReplayIngestRoutes } from './replayIngestRoutes';
import { ALLOWED_REQUEST_HEADERS, resolveAllowedOrigin } from '../middleware/cors';

const app = () => createReplayIngestRoutes({} as never);

beforeEach(() => {
  mocks.ingest.mockReset();
  mocks.config.mockReset();
});

describe('POST /v1/chunks', () => {
  it.each(['kept', 'counted', 'duplicate', 'dropped'])('answers 202 when ingest says %s', async (outcome) => {
    mocks.ingest.mockResolvedValue(outcome);
    const res = await app().request('/v1/chunks?site=bfr_abc', {
      method: 'POST',
      headers: { Origin: 'https://shop.example.com', 'Content-Encoding': 'gzip', 'cf-connecting-ip': '203.0.113.9' },
      body: new Uint8Array([0x1f, 0x8b, 0x08]),
    }, {});
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('hands the raw request facts to the service', async () => {
    mocks.ingest.mockResolvedValue('counted');
    await app().request('/v1/chunks?site=hosted:abc', {
      method: 'POST',
      headers: { Origin: 'https://app.builderforce.ai', 'Content-Encoding': 'gzip', 'cf-connecting-ip': '203.0.113.9' },
      body: new Uint8Array([1, 2, 3]),
    }, {});
    expect(mocks.ingest).toHaveBeenCalledWith(expect.objectContaining({
      siteToken: 'hosted:abc',
      origin: 'https://app.builderforce.ai',
      ip: '203.0.113.9',
      contentEncoding: 'gzip',
      country: null,
    }));
    const body = mocks.ingest.mock.calls[0]![0].body as ArrayBuffer;
    expect(new Uint8Array(body)).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe('GET /v1/config', () => {
  it('returns the service answer, never cached', async () => {
    mocks.config.mockResolvedValue({ enabled: false });
    const res = await app().request('/v1/config?site=bfr_nope', { headers: { Origin: 'https://evil.example' } }, {});
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ enabled: false });
    expect(mocks.config).toHaveBeenCalledWith('bfr_nope', 'https://evil.example');
  });
});

describe('CORS', () => {
  it('lets any origin reach the ingest prefix and nothing that merely starts like it', () => {
    expect(resolveAllowedOrigin('https://customer.example', 'https://builderforce.ai', '/api/replay-ingest/v1/chunks')).toBe('*');
    expect(resolveAllowedOrigin('https://customer.example', 'https://builderforce.ai', '/api/replay-ingestion')).toBeNull();
  });

  it('allows the gzip header the recorder sends', () => {
    expect(ALLOWED_REQUEST_HEADERS.split(',')).toContain('Content-Encoding');
    expect(ALLOWED_REQUEST_HEADERS.split(',')).toContain('Content-Type');
  });
});
