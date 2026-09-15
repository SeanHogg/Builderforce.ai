import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_ERROR_EVENT, type ApiErrorEvent } from '@/lib/errors/apiErrorEvent';

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  init: vi.fn(),
  reportProductApiError: vi.fn(() => Promise.resolve({ accepted: 1 })),
}));
mocks.init.mockReturnValue({ close: mocks.close });

vi.mock('@seanhogg/builderforce-quality', () => ({ init: mocks.init }));
vi.mock('@/lib/reportError', () => ({ reportProductApiError: mocks.reportProductApiError }));

import { QualityErrorReporter } from './QualityErrorReporter';

describe('QualityErrorReporter', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('records global API errors in the configured product collector', async () => {
    render(<QualityErrorReporter
      apiKey=""
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

    await waitFor(() => expect(mocks.reportProductApiError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '401',
        message: 'Missing or malformed Authorization header',
        level: 'error',
        url: detail.url,
      }),
      'https://api.builderforce.test/api/quality-ingest',
    ));
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it('does not file a report for a database outage, which would refuse the report too', async () => {
    render(<QualityErrorReporter
      apiKey=""
      endpoint="https://api.builderforce.test/api/quality-ingest"
      environment="production"
    />);

    const detail: ApiErrorEvent = {
      timestamp: '2026-09-14T22:47:33.833Z',
      method: 'GET',
      url: 'https://api.builderforce.test/api/guest/messages?visitorId=v',
      status: 503,
      code: 'database_unavailable',
      message: 'Something went wrong on our side. The failure has been recorded.',
    };
    window.dispatchEvent(new CustomEvent(API_ERROR_EVENT, { detail }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.reportProductApiError).not.toHaveBeenCalled();
  });
});
