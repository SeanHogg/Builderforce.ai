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
