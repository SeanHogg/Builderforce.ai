import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from './apiClient';
import { ApiTransportError } from './errors/transportFailure';
import { recordedFailure, reportProductError } from './reportError';

describe('reportProductError', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports through the fixed product collector without tenant authentication', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ accepted: 1 }),
      { status: 202, headers: { 'Content-Type': 'application/json' } },
    ));

    await expect(reportProductError({
      title: '401',
      message: 'Missing Authorization header',
      url: 'https://api.builderforce.test/api/projects',
      level: 'error',
    }, 'https://api.builderforce.test/api/quality-ingest/')).resolves.toEqual({ accepted: 1 });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.builderforce.test/api/quality-ingest/product-report');
    expect(request).toMatchObject({
      method: 'POST',
    });
    const report = JSON.parse(String(request?.body));
    expect(report).toMatchObject({
      title: '401',
      message: 'Missing Authorization header',
      source: 'manual',
    });
    expect(report).not.toHaveProperty('projectId');
    expect(request?.headers).not.toHaveProperty('Authorization');
  });
});

/**
 * The report is the last thing standing between a crash and a lost diagnostic,
 * so it must survive a bad `message` rather than be rejected for one. The
 * gateway's nested 429 envelope put an OBJECT here and the ingest answered
 * `400 {"error":"message is required"}` — the report about the crash was itself
 * discarded by the crash.
 */
describe('reportProductError message floor', () => {
  afterEach(() => vi.restoreAllMocks());

  async function sentReport(message: unknown): Promise<{ message?: string }> {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ accepted: 1 }),
      { status: 202, headers: { 'Content-Type': 'application/json' } },
    ));
    await reportProductError(
      { title: 'crash', message: message as string },
      'https://api.builderforce.test/api/quality-ingest/',
    );
    return JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
  }

  it('serialises an object message instead of sending one the ingest rejects', async () => {
    const report = await sentReport({ message: 'cascade exhausted', code: 429, type: 'rate_limit_error' });
    expect(typeof report.message).toBe('string');
    expect(report.message).toContain('cascade exhausted');
  });

  it('unwraps an Error', async () => {
    expect((await sentReport(new Error('boom'))).message).toBe('boom');
  });

  it('never sends an empty message, so the report is accepted either way', async () => {
    for (const empty of [undefined, null, '', '   ']) {
      expect((await sentReport(empty)).message).toBeTruthy();
      vi.restoreAllMocks();
    }
  });
});

describe('recordedFailure', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resolves a rejected read to its fallback and records why, at warning level', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ accepted: 1 }),
      { status: 202, headers: { 'Content-Type': 'application/json' } },
    ));

    const rows = await Promise.reject(new Error('boom')).catch(recordedFailure('Reading the rows', [] as string[]));
    expect(rows).toEqual([]);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const report = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(report).toMatchObject({ message: 'Reading the rows: boom', level: 'warning' });
  });

  it('does not report a request failure the HTTP client already surfaced, but still resolves to the fallback', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 202 }));
    const http = await Promise.reject(new ApiRequestError('Not found', 404)).catch(recordedFailure('Reading', 'fallback'));
    const transport = await Promise.reject(new ApiTransportError('unreachable', '/api/x', 'GET')).catch(recordedFailure('Reading', 'fallback'));
    expect([http, transport]).toEqual(['fallback', 'fallback']);
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still resolves to the fallback when the report itself cannot be sent', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await expect(Promise.reject('plain').catch(recordedFailure('Reading', 7))).resolves.toBe(7);
  });
});
