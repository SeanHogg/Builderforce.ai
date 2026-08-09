import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportProductError } from './reportError';

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
    }, {
      apiKey: 'bfq_builderforce_product',
      endpoint: 'https://api.builderforce.test/api/quality-ingest/',
    })).resolves.toEqual({ accepted: 1 });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.builderforce.test/api/quality-ingest/events');
    expect(request).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer bfq_builderforce_product',
        'Content-Type': 'application/json',
      },
    });
    const [event] = JSON.parse(String(request?.body));
    expect(event).toMatchObject({
      type: 'UserReportedError',
      message: '401 — Missing Authorization header',
      environment: 'user-report',
      source: 'native',
      context: { manual: true },
    });
    expect(event).not.toHaveProperty('projectId');
  });

  it('fails clearly when product reporting is not configured', async () => {
    await expect(reportProductError({ message: 'Broken' }, {
      apiKey: '',
      endpoint: 'https://api.builderforce.test/api/quality-ingest',
    })).rejects.toThrow('Product error reporting is not configured');
  });
});
