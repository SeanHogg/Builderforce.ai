import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_ERROR_EVENT, type ApiErrorEvent } from '@/lib/errors/apiErrorEvent';

const mocks = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  close: vi.fn(),
  init: vi.fn(),
}));
mocks.init.mockReturnValue({ captureMessage: mocks.captureMessage, close: mocks.close });

vi.mock('@seanhogg/builderforce-quality', () => ({ init: mocks.init }));

import { QualityErrorReporter } from './QualityErrorReporter';

describe('QualityErrorReporter', () => {
  afterEach(() => vi.clearAllMocks());

  it('records global API errors in the configured product collector', async () => {
    render(<QualityErrorReporter
      apiKey="bfq_builderforce_product"
      endpoint="https://api.builderforce.test/api/quality-ingest"
      environment="production"
    />);

    const detail: ApiErrorEvent = {
      timestamp: '2026-08-09T12:00:00.000Z',
      method: 'GET',
      url: 'https://api.builderforce.test/api/knowledge-market/listings',
      status: 401,
      message: 'Missing or malformed Authorization header',
      requestId: 'request-123',
    };
    window.dispatchEvent(new CustomEvent(API_ERROR_EVENT, { detail }));

    await waitFor(() => expect(mocks.captureMessage).toHaveBeenCalledWith(
      '401: Missing or malformed Authorization header',
      expect.objectContaining({
        level: 'error',
        url: detail.url,
        tags: { source: 'api-client', method: 'GET', status: '401' },
      }),
    ));
  });
});
